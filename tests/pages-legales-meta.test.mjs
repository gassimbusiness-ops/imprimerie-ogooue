/**
 * LES TROIS PAGES DÉCLARÉES À META — servies, lisibles sans session, et VRAIES.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Le bouton « Publier » de l'application Meta « OGOOUE Scheduler » reste grisé
 * tant que trois URL ne pointent pas vers de vraies pages : confidentialité,
 * conditions de service, instructions de suppression des données.
 *
 * Mesure du 26/09/2026 en production : l'URL de confidentialité déjà déclarée
 * à Meta, `/politique-confidentialite`, répondait 200… avec la coquille de
 * l'application (1 656 octets, « Imprimerie Ogooue - Gestion »). Un 200 n'est
 * pas une page. Ce fichier vérifie donc trois choses, qui échouent chacune en
 * silence :
 *
 *   1. ROUTAGE — chaque chemin atterrit sur SON fichier, avant l'attrape-tout ;
 *   2. SERVICE WORKER — une PWA installée ne remplace pas la page par l'écran
 *      de connexion ;
 *   3. VÉRITÉ — ce que les pages disent des données Meta correspond à ce que le
 *      code range réellement. « Une page qui décrit un traitement différent de
 *      la réalité est pire que pas de page. »
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

import { PAGES_PUBLIQUES, NAVIGATIONS_HORS_APPLICATION } from '../src/lib/pages-publiques.js';
import { normaliserCharge } from '../api/meta-webhook.js';
import { repondreAuxEvenements } from '../api/_lib/bot-executeur.js';
import { MENTION_AUTOMATIQUE } from '../api/_lib/bot-connaissances.js';

const racine = new URL('../', import.meta.url);
const lire = (chemin) => readFileSync(fileURLToPath(new URL(chemin, racine)), 'utf8');
const existe = (chemin) => existsSync(fileURLToPath(new URL(chemin, racine)));

/* ═══════════════════════════════════════════════════════════════════════════
   1. ROUTAGE VERCEL
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * La première règle de `vercel.json` qui correspond gagne — comme chez Vercel.
 *
 * ⚠️ Chaque `source` est lue comme une expression ancrée. C'est exact pour les
 *    sources présentes (littérales, `/api/(.*)`, `/((?!api/).*)`) ; le test
 *    suivant échoue si une source apparaît qu'on ne sait pas lire ainsi.
 */
function premiereRegle(rewrites, chemin) {
  return rewrites.find((r) => new RegExp(`^${r.source}$`).test(chemin)) || null;
}

test('vercel.json : chaque source de rewrite se lit comme une expression ancrée', () => {
  const { rewrites } = JSON.parse(lire('vercel.json'));
  for (const r of rewrites) {
    assert.doesNotThrow(() => new RegExp(`^${r.source}$`), `source illisible : ${r.source}`);
    assert.ok(!/:[a-z]/i.test(r.source),
      `${r.source} utilise un paramètre nommé : premiereRegle() ne sait pas le simuler`);
  }
});

test('chaque URL déclarée à Meta atterrit sur SA page, pas sur l application', () => {
  const { rewrites } = JSON.parse(lire('vercel.json'));
  const attrapeTout = rewrites.findIndex((r) => r.destination === '/index.html');

  for (const { chemin, fichier } of PAGES_PUBLIQUES) {
    for (const url of [chemin, fichier]) {
      const regle = premiereRegle(rewrites, url);
      assert.ok(regle, `${url} ne correspond à aucune règle`);
      assert.equal(regle.destination, fichier,
        `${url} est servi par « ${regle.source} » → ${regle.destination} au lieu de ${fichier}`);
      assert.ok(rewrites.indexOf(regle) < attrapeTout, `${url} doit passer AVANT l attrape-tout`);
    }
    assert.ok(existe(`public${fichier}`), `public${fichier} n existe pas : la réécriture mènerait au vide`);
  }
});

test('vercel.json et src/lib/pages-publiques.js disent la même chose', () => {
  const { rewrites } = JSON.parse(lire('vercel.json'));
  const fichiers = new Set(PAGES_PUBLIQUES.map((p) => p.fichier));
  const cheminsPropres = rewrites
    .filter((r) => fichiers.has(r.destination) && r.source !== r.destination)
    .map((r) => `${r.source} → ${r.destination}`)
    .sort();
  const attendus = PAGES_PUBLIQUES.map((p) => `${p.chemin} → ${p.fichier}`).sort();
  assert.deepEqual(cheminsPropres, attendus,
    'une page ajoutée d un côté seulement : le service worker ou Vercel ne la connaît pas');
});

test('les écrans de l application ne sont pas détournés vers une page légale', () => {
  const { rewrites } = JSON.parse(lire('vercel.json'));
  for (const url of ['/', '/login', '/commandes', '/client/profil', '/autopost', '/messagerie']) {
    assert.equal(premiereRegle(rewrites, url)?.destination, '/index.html', url);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. SERVICE WORKER
   ═══════════════════════════════════════════════════════════════════════════ */

test('service worker : les chemins propres sont laissés au réseau', () => {
  for (const { chemin } of PAGES_PUBLIQUES) {
    for (const url of [chemin, `${chemin}/`]) {
      assert.ok(NAVIGATIONS_HORS_APPLICATION.some((re) => re.test(url)),
        `${url} serait servi par le service worker avec index.html — l écran de connexion`);
    }
  }
});

test('service worker : les écrans de l application restent servis hors ligne', () => {
  for (const url of ['/', '/login', '/commandes', '/client/profil', '/suppression-donnees-test',
    '/conditions-utilisation/autre', '/politique-confidentialite-bis']) {
    assert.ok(!NAVIGATIONS_HORS_APPLICATION.some((re) => re.test(url)),
      `${url} ne doit PAS sortir de l application`);
  }
});

test('vite.config.js branche bien la liste sur navigateFallbackDenylist', () => {
  const source = lire('vite.config.js');
  assert.match(source, /navigateFallbackDenylist:\s*NAVIGATIONS_HORS_APPLICATION/);
  assert.match(source, /from '\.\/src\/lib\/pages-publiques\.js'/);
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. RENDU SANS SESSION
   ═══════════════════════════════════════════════════════════════════════════ */

/** La page telle qu'un robot la lit : HTML seul, AUCUN script exécuté. */
function rendre(fichier) {
  const html = lire(`public${fichier}`);
  const { document } = new JSDOM(html).window;
  return { html, document, texte: document.body.textContent.replace(/\s+/g, ' ') };
}

test('les trois pages s affichent sans JavaScript et sans session', () => {
  for (const { fichier } of PAGES_PUBLIQUES) {
    const { document, texte } = rendre(fichier);
    assert.equal(document.querySelectorAll('script').length, 0,
      `${fichier} contient un script : son contenu ne doit dépendre ni de JS ni d une session`);
    assert.ok(document.querySelector('h1')?.textContent.trim(), `${fichier} n a pas de titre`);
    assert.ok(texte.length > 3000, `${fichier} : ${texte.length} caractères, trop peu pour une vraie page`);
    assert.match(texte, /IMPRIMERIE OGOOUÉ/);
    assert.match(texte, /imprimerieogooue@gmail\.com/);
    assert.notEqual(document.title, 'Imprimerie Ogooue - Gestion',
      `${fichier} porte le titre de l application : c est la coquille, pas la page`);
    assert.equal(document.querySelector('#root'), null, `${fichier} contient le point de montage de l application`);
  }
});

test('l identité juridique est la même sur les pages qui la portent', () => {
  for (const fichier of ['/conditions.html', '/confidentialite.html']) {
    const { texte } = rendre(fichier);
    assert.match(texte, /RCCM : RG\/FCV 2023A0407/, fichier);
    assert.match(texte, /NIF : 256598 U/, fichier);
    assert.match(texte, /Senoussi ABAKAR GASSIM/, fichier);
    assert.match(texte, /[Ee]ntreprise individuelle/, fichier);
  }
});

test('conditions : les usages Facebook et Instagram sont décrits', () => {
  const { texte } = rendre('/conditions.html');
  assert.match(texte, /Nos usages de Facebook et d'Instagram/);
  assert.match(texte, /publiées automatiquement/);
  assert.match(texte, /ne donne jamais de prix, de délai ou de disponibilité/);
});

test('suppression : la marche à suivre et les délais sont là', () => {
  const { texte, document } = rendre('/suppression-donnees.html');
  assert.ok(document.querySelector('a[href^="mailto:imprimerieogooue@gmail.com"]'), 'lien e-mail absent');
  assert.match(texte, /Suppression de mes données/);
  assert.match(texte, /7 jours/);
  assert.match(texte, /30 jours/);
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. VÉRITÉ — LES PAGES CONTRE LE CODE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ Si l'un de ces deux tests casse, ce n'est pas le test qu'il faut changer
 *    d'abord : ce sont `public/suppression-donnees.html` et
 *    `public/confidentialite.html`, qui décrivent champ par champ ce qui est
 *    rangé. Puis la liste ci-dessous.
 */
test('messages_meta : les champs rangés sont ceux que les pages décrivent', () => {
  const [doc] = normaliserCharge({
    object: 'page',
    entry: [{ id: 'PAGE', time: 1, messaging: [{ sender: { id: 'PSID' }, recipient: { id: 'PAGE' }, timestamp: 2, message: { mid: 'm.1', text: 'Bonjour' } }] }],
  }, { recuLe: new Date('2026-09-26T10:00:00Z') });

  assert.deepEqual(Object.keys(doc).sort(), [
    'canal', 'date_reception', 'destinataire_id', 'evenement', 'expediteur_id',
    'horodatage_meta', 'message_id', 'objet_abonnement', 'page_id', 'recu_le', 'traite', 'type',
  ], 'un champ a été ajouté ou retiré : mettre à jour les pages déclarées à Meta');
});

test('bot_journal : les champs sont ceux décrits, et le texte du client n y est JAMAIS recopié', async () => {
  const QUESTION = 'Bonjour, vous ouvrez à quelle heure samedi ?';
  const journal = [];
  const depot = {
    async lireInterrupteur() { return { actif: true, mode: 'dry_run' }; },
    async temoinReponse() { return null; },
    async humainAPrisLaMain() { return false; },
    async reserver() { throw new Error('aucune réservation en simulation'); },
    async confirmer() { throw new Error('aucune confirmation en simulation'); },
    async journaliser(entree) { journal.push(entree); },
  };
  const evenement = (mid) => ({
    message_id: mid, canal: 'messenger', page_id: 'PAGE', expediteur_id: 'PSID',
    destinataire_id: 'PAGE', type: 'message', recu_le: '2026-09-26T10:00:00.000Z',
    evenement: { sender: { id: 'PSID' }, recipient: { id: 'PAGE' }, timestamp: 2, message: { mid, text: QUESTION } },
  });

  // Deux passages : une réponse simulée, puis un doublon écarté.
  await repondreAuxEvenements({
    depot, client: { disponible: false }, evenements: [evenement('m.1'), evenement('m.1')], tracer: () => {},
  });
  assert.equal(journal.length, 2);

  const DECRITS = new Set([
    'canal', 'message_id_entrant', 'expediteur_id', 'compte_id', 'recu_le', 'date_locale', 'mode',
    'intention', 'fiche_id', 'action', 'motif', 'texte', 'id_message_sortant', 'erreur', 'piste',
    'repondu_le',
  ]);
  for (const ligne of journal) {
    for (const cle of Object.keys(ligne)) {
      assert.ok(DECRITS.has(cle), `bot_journal porte « ${cle} », que les pages ne décrivent pas`);
    }
    for (const valeur of Object.values(ligne)) {
      assert.ok(!(typeof valeur === 'string' && valeur.includes(QUESTION)),
        'le texte du client est recopié dans le journal : les pages affirment le contraire');
    }
  }
});

test('la mention citée par les pages est celle que le bot envoie vraiment', () => {
  const coeur = MENTION_AUTOMATIQUE.replace(/^—\s*/, '').replace(/\.$/, '');
  for (const fichier of ['/conditions.html', '/confidentialite.html']) {
    assert.ok(rendre(fichier).texte.includes(coeur), `${fichier} ne cite pas « ${coeur} »`);
  }
});

test('confidentialité : plus aucune phrase qui nie la réponse automatique', () => {
  const { texte } = rendre('/confidentialite.html');
  assert.doesNotMatch(texte, /aucune réponse automatique n'est envoyée/,
    'le bot répond depuis le 19/09/2026 : cette phrase est fausse');
});
