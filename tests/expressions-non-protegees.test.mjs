/**
 * Deux fichiers portent, à quelques lignes d'écart, LA MÊME expression écrite
 * deux fois : une fois protégée, une fois non. La version non protégée imprime
 * « undefined » à l'écran, dans un PDF remis au client, et — pire — l'ENREGISTRE
 * en base.
 *
 *   src/features/client-portal/messagerie.jsx
 *     protégé      : l. 45  `${user?.prenom || ''} ${user?.nom || ''}`
 *                    l. 111 idem
 *     NON protégé  : l. 82  client_nom  → écrit en base
 *                    l. 86  sujet       → écrit en base
 *                    l. 95  auteur      → écrit en base, affiché à l'écran
 *
 *   src/services/export-pdf.js
 *     protégé      : l. 573 `Fiche Client — ${client.nom || '—'}`  (titre du corps)
 *     NON protégé  : l. 622 `Fiche Client — ${client.nom}`         (titre du document)
 *
 * Les deux cas se déclenchent sur des données RÉELLES : un compte client créé
 * depuis le comptoir n'a ni `prenom` ni `nom` séparés, et une fiche client
 * importée sans nom existe en base.
 *
 * Ce qui est écrit en base ne se répare pas par un correctif d'affichage :
 * c'est pour cela que le test regarde le JOURNAL D'ÉCRITURE, et pas seulement
 * le texte rendu.
 *
 * Lancer :  node --test tests/expressions-non-protegees.test.mjs
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rendreEcran, texteVivant } from './outils/rendu-ecran.mjs';

const RACINE = resolve(fileURLToPath(new URL('..', import.meta.url)));

/* ═══════════════════════════════════════════════════════════════════════════
   1. MESSAGERIE DU PORTAIL CLIENT — « undefined undefined » écrit en base
   ═══════════════════════════════════════════════════════════════════════════ */

const ECRAN_MESSAGERIE = 'src/features/client-portal/messagerie.jsx';

/**
 * Le client tel qu'il existe RÉELLEMENT en base.
 *
 * Relevé du 18/09/2026 sur bcwkrrqmjpaohmafcncw :
 *   SELECT count(*), count(*) FILTER (WHERE data ? 'prenom') FROM app_data
 *   WHERE collection = 'clients';   →   14 lignes, 0 avec `prenom`.
 *
 * Les 14 clients ont un `nom` et AUCUN `prenom`. `${user?.prenom}` rend donc
 * la chaîne « undefined » pour chacun d'eux. `undefined` est déjà présent dans
 * 17 lignes de la base (notifications_app 6, audit_logs 6, paiements_singpay 3,
 * taches 2) : ce n'est pas une hypothèse, c'est un dégât en cours.
 */
const CLIENT_SANS_PRENOM = {
  id: 'user-1', role: 'client', email: 'mairie@moanda.ga',
  prenom: undefined,          // le champ n'existe pas : retiré par le harnais
  nom: 'Mairie de Moanda',
};

function champTexte(v) {
  const doc = v.conteneur.ownerDocument;
  return [...doc.body.querySelectorAll('input')]
    .find((i) => i.type !== 'file' && !i.disabled) || null;
}

function saisir(v, champ, valeur) {
  const proto = v.conteneur.ownerDocument.defaultView.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(champ, valeur);
  champ.dispatchEvent(new globalThis.Event('input', { bubbles: true }));
}

function boutonEnvoyer(v) {
  const doc = v.conteneur.ownerDocument;
  const tous = [...doc.body.querySelectorAll('button')];
  return tous.find((b) => /envoyer/i.test(b.textContent || ''))
    || tous.find((b) => b.type === 'submit')
    || tous[tous.length - 1];
}

async function vidanger(v, tours = 6) {
  for (let i = 0; i < tours; i++) {
    await v.act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}

test('messagerie client — aucun « undefined » n’est écrit en base', async () => {
  const v = await rendreEcran({
    ecran: ECRAN_MESSAGERIE,
    utilisateur: CLIENT_SANS_PRENOM,
    donnees: { conversations: [], messages_conv: [] },
    routeur: true,
  });
  try {
    const champ = champTexte(v);
    assert.ok(champ, 'le champ de saisie du message est introuvable : le scénario ne teste rien');
    await v.act(async () => { saisir(v, champ, 'Bonjour, où en est ma commande ?'); });
    await vidanger(v, 2);

    const envoyer = boutonEnvoyer(v);
    assert.ok(envoyer, 'le bouton d’envoi est introuvable');
    await v.act(async () => { envoyer.click(); await new Promise((r) => setTimeout(r, 0)); });
    await vidanger(v);

    assert.ok(v.journal.ecritures.length > 0, 'aucune écriture : le message n’est pas parti');

    const fautives = v.journal.ecritures.filter(
      (e) => JSON.stringify(e.data || {}).includes('undefined'),
    );
    assert.deepEqual(
      fautives.map((e) => ({ collection: e.collection, data: e.data })), [],
      '« undefined » a été enregistré en base — un correctif d’affichage ne le réparera pas',
    );
  } finally { await v.demonter(); }
});

test('messagerie client — aucun « undefined » n’est affiché à l’écran', async () => {
  const v = await rendreEcran({
    ecran: ECRAN_MESSAGERIE,
    utilisateur: CLIENT_SANS_PRENOM,
    donnees: {
      conversations: [{ id: 'c1', client_id: 'user-1', client_nom: 'Mairie de Moanda' }],
      messages_conv: [
        { id: 'm1', conversation_id: 'c1', type: 'entrant', contenu: 'Bonjour', auteur: '', created_at: '2026-09-17T08:00:00.000Z' },
      ],
    },
    routeur: true,
  });
  try {
    const texte = texteVivant(v);
    assert.ok(texte.length > 0, 'écran blanc');
    assert.ok(!/undefined/.test(texte), 'l’écran affiche « undefined » : ' + texte.slice(0, 300));
  } finally { await v.demonter(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. ACCUEIL DU PORTAIL CLIENT — « Bienvenue, undefined ! »
   ═══════════════════════════════════════════════════════════════════════════

   ⚠️ TROISIÈME FICHIER, non nommé dans la commande.

   La commande annonçait « trois fichiers » et n'en listait que deux. Celui-ci
   porte exactement le même défaut, et au même endroit du logiciel :

     src/features/client-portal/dashboard.jsx
       protégé      : l. 66  `${user?.prenom || ''} ${user?.nom || ''}`
       NON protégé  : l. 146 `Bienvenue, ${user?.prenom} !`

   C'est la PREMIÈRE LIGNE que voit un client en ouvrant son espace. Les
   14 clients en base n'ont pas de `prenom` : tous lisaient
   « Bienvenue, undefined ! ».                                              */

const ECRAN_ACCUEIL_CLIENT = 'src/features/client-portal/dashboard.jsx';

test('accueil du portail client — pas de « Bienvenue, undefined »', async () => {
  const v = await rendreEcran({
    ecran: ECRAN_ACCUEIL_CLIENT,
    utilisateur: CLIENT_SANS_PRENOM,
    donnees: { commandes: [], factures: [], devis: [], conversations: [], notifications_app: [] },
    routeur: true,
  });
  try {
    const texte = texteVivant(v);
    assert.ok(texte.length > 0, 'écran blanc');
    assert.ok(
      !/undefined/.test(texte),
      'le client lit « undefined » sur sa page d’accueil : ' + texte.slice(0, 300),
    );
  } finally { await v.demonter(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. FICHE CLIENT PDF — « Fiche Client — undefined » en titre du document
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * `export-pdf.js` importe `@/services/mouvements-financiers` : Node ne sait pas
 * résoudre l'alias `@/`, c'est Vite qui le fait. On compile donc le module comme
 * Vite le compile, une seule fois pour tout le fichier de test.
 */
let moduleExportPdf = null;
let nettoyerExportPdf = null;
async function chargerExportPdf() {
  if (moduleExportPdf) return moduleExportPdf;
  const dossier = await mkdtemp(join(RACINE, '.tmp-export-pdf-'));
  const sortie = join(dossier, 'export-pdf.mjs');
  await build({
    entryPoints: [resolve(RACINE, 'src/services/export-pdf.js')],
    outfile: sortie,
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
    logLevel: 'silent', loader: { '.js': 'jsx' },
    alias: { '@': resolve(RACINE, 'src') },
  });
  moduleExportPdf = await import(pathToFileURL(sortie).href);
  nettoyerExportPdf = () => rm(dossier, { recursive: true, force: true });
  return moduleExportPdf;
}

/**
 * Monte un DOM le temps de l'export, puis rend le HTML réellement écrit dans
 * l'iframe d'impression. On regarde le document PRODUIT, pas la source.
 */
async function htmlImprime(appel) {
  const mod = await chargerExportPdf();
  // `printHTML` arme deux timers (300 ms puis 2 s) qui appellent `focus()`,
  // `print()` — non implémentés dans jsdom — et retirent l'iframe. On les fait
  // mourir avec la fenêtre : `dom.window.close()` à la fin. La console
  // virtuelle est muette pour ne pas noyer la sortie des tests.
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://exemple.test/', pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
  });
  const w = dom.window;
  const anciens = {};
  const globales = {
    window: w, document: w.document, navigator: w.navigator,
    localStorage: w.localStorage,
  };
  for (const [k, val] of Object.entries(globales)) {
    anciens[k] = globalThis[k];
    try { globalThis[k] = val; } catch { /* globale non inscriptible */ }
  }
  try {
    appel(mod);
    const iframe = w.document.querySelector('iframe');
    if (!iframe) return '';
    const d = iframe.contentDocument;
    return (d?.title || '') + '\n' + (d?.documentElement?.innerHTML || '');
  } finally {
    for (const [k, val] of Object.entries(anciens)) {
      try { globalThis[k] = val; } catch { /* globale non inscriptible */ }
    }
    w.close();
  }
}

after(async () => { await nettoyerExportPdf?.(); });

test('fiche client PDF — un client sans nom ne produit pas « undefined »', async () => {
  // Une fiche client sans `nom` existe en base : import Excel, création rapide
  // au comptoir. Le PDF part au client tel quel.
  const html = await htmlImprime((m) => m.exportFicheClientPDF({ id: 'cli-x' }, [], []));
  assert.ok(html.length > 0, 'aucun document produit : le test ne prouve rien');
  assert.ok(
    !/undefined/.test(html),
    '« undefined » figure dans le PDF remis au client : ' + html.slice(0, 300),
  );
});

test('fiche client PDF — un client nommé garde son nom', async () => {
  const html = await htmlImprime((m) => m.exportFicheClientPDF({ id: 'cli-y', nom: 'Mairie de Moanda' }, [], []));
  assert.ok(html.includes('Mairie de Moanda'), 'le nom du client a disparu du document');
  assert.ok(!/undefined/.test(html));
});
