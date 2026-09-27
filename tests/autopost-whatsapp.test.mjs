/**
 * LA STORY WHATSAPP DU JOUR, REMISE DANS TELEGRAM — décision de Gassim du 28/09/2026.
 *
 * WhatsApp ne laisse aucune application publier un statut. Au 28/09, 16 stories
 * `whatsapp_handoff` restaient « Prévu » — dont 9 déjà passées — et personne ne
 * les recevait. Désormais le passage de 9 h envoie celle du jour dans le groupe
 * Telegram « OGOOUÉ Alertes », et les jours passés sont dits « jamais remise ».
 *
 * Les lignes ci-dessous reprennent la file RÉELLE du 28/09 (relue en base) :
 * `PUB-2026-S40-1-01`, créneau 2026-09-28T08:00:00Z, image hébergée, légende
 * `null` parce que ChatGPT la range sous `captions.whatsapp`.
 *
 * Lancer : node --test tests/autopost-whatsapp.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { remettreStoriesWhatsApp, texteRemise, jourLisible, CANAL_WHATSAPP } from '../api/_lib/autopost-whatsapp.js';
import { construireApprobation, construireRetrait } from '../api/_lib/autopost-approbation.js';
import { cleLegende } from '../api/_lib/autopost-alimentation.js';

const URL_STORY = 'https://bcwkrrqmjpaohmafcncw.supabase.co/storage/v1/object/public/publications/'
  + 'PUB-2026-S40-1-01/v5/b9c4-2026-09-28_OGOOUE_Ecoles_1080x1920_v02.jpg';

function publication(date, id) {
  return {
    publication_id: id,
    version_contenu: 5,
    date_locale: date,
    cta: 'Préparez vos besoins et vos quantités.',
    creneau: { date_locale: date, heure_locale: '09:00', offset_utc: '+01:00', fuseau: 'Africa/Libreville' },
    canaux: [{ canal: 'whatsapp_handoff', surface: 'story', compte_cible_id: 'WA_IMPRIMERIE' }],
    captions: { whatsapp: { chemin_relatif: 'caption_whatsapp.txt' } },
  };
}

function ligne(date, { legende = null, url = URL_STORY, approuvee = true, tentatives = 0 } = {}) {
  const id = `PUB-${date}`;
  const pub = publication(date, id);
  return {
    cle_idempotence: `${id}|whatsapp_handoff`,
    publication_id: id,
    canal: CANAL_WHATSAPP,
    surface: 'story',
    date_locale: date,
    instant_utc: `${date}T08:00:00Z`,
    etat: 'scheduled',
    tentatives,
    tentatives_max: 3,
    legende,
    url_media: url,
    publication: pub,
    approbation: approuvee
      ? construireApprobation({ publication: pub, canal: CANAL_WHATSAPP, approuvePar: 'machine', instant: '2026-09-21T08:53:13Z', origine: 'automatique' })
      : null,
    id_distant: null,
  };
}

/** Doublure du dépôt autopost : mêmes écritures CONDITIONNELLES que la base. */
function depot({ lignes, actif = true, mode = 'live' }) {
  const table = new Map(lignes.map((l) => [l.cle_idempotence, structuredClone(l)]));
  const journal = [];
  return {
    table, journal,
    async lireArretGlobal() { return { actif, mode, plafond: 8 }; },
    async lireRemisesWhatsApp() {
      return [...table.values()].filter((l) => l.etat === 'scheduled' && l.canal === CANAL_WHATSAPP)
        .sort((a, b) => (a.instant_utc < b.instant_utc ? -1 : 1)).map((l) => structuredClone(l));
    },
    async expirer(cle, details) {
      const l = table.get(cle);
      if (!l || l.etat !== 'scheduled' || l.id_distant) return false;
      l.etat = 'expired'; l.derniere_erreur = details; return true;
    },
    async prendre(cle) {
      const l = table.get(cle);
      if (!l || l.etat !== 'scheduled') return false;
      l.etat = 'executing'; return true;
    },
    async relacher(cle, { etat, tentatives, erreur }) {
      const l = table.get(cle); l.etat = etat; l.tentatives = tentatives; l.derniere_erreur = erreur;
    },
    async enregistrerPublication(cle, resultat) {
      const l = table.get(cle); l.etat = 'published'; l.id_distant = resultat.id_distant;
      l.tentatives = resultat.tentatives; l.resultat = resultat;
    },
    async journaliser(e) { journal.push(e); },
  };
}

/** Doublure de Telegram : note chaque photo et chaque texte. */
function telegram({ configure = true, reponses = [] } = {}) {
  const photos = [];
  const textes = [];
  return {
    configure, photos, textes,
    async envoyerPhoto(url, legende) {
      photos.push({ url, legende });
      return reponses.shift() || { statut: 'envoye', motif: null, message_id: 900 + photos.length };
    },
    async envoyer(texte) { textes.push(texte); return { statut: 'envoye', motif: null }; },
  };
}

const PASSAGE_DE_9H = new Date('2026-09-28T08:53:13Z');
const JOURS_PASSES = ['2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23',
  '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27'];

function passer(d, t, instant = PASSAGE_DE_9H) {
  return remettreStoriesWhatsApp({ depot: d, telegram: t, instant, restantMs: () => 20_000 });
}

test('🔴 rejeu 28/09 : 9 stories passées dites « jamais remise », celle du jour part UNE fois dans le groupe, demain attend', async () => {
  const d = depot({ lignes: [...JOURS_PASSES.map((j) => ligne(j)), ligne('2026-09-28', { legende: 'Cartes scolaires et listes de fournitures.' }), ligne('2026-09-29')] });
  const t = telegram();
  const b = await passer(d, t);

  assert.equal(b.expirees, 9);
  assert.equal(b.remises, 1);
  assert.equal(t.photos.length, 1, 'une seule image envoyée — pas les 9 en retard');
  assert.equal(t.photos[0].url, URL_STORY);
  assert.match(t.photos[0].legende, /STORY WHATSAPP — lundi 28\/09/);
  assert.match(t.photos[0].legende, /statut WhatsApp/);
  assert.match(t.photos[0].legende, /Cartes scolaires et listes de fournitures\./);

  const jour = d.table.get('PUB-2026-09-28|whatsapp_handoff');
  assert.equal(jour.etat, 'published');
  assert.equal(jour.id_distant, 'telegram:901', 'le témoin : le message Telegram');
  assert.equal(jour.resultat.remis_par, 'telegram');
  assert.equal(d.table.get('PUB-2026-09-29|whatsapp_handoff').etat, 'scheduled', 'demain n est pas touché');
  const passee = d.table.get('PUB-2026-09-19|whatsapp_handoff');
  assert.equal(passee.etat, 'expired');
  assert.match(passee.derniere_erreur.message, /jamais remise/);
  assert.equal(d.journal[0].evenement, 'remise_telegram');
});

test('jamais avant le créneau : à 8 h 30 (Moanda) rien ne part', async () => {
  const d = depot({ lignes: [ligne('2026-09-28')] });
  const t = telegram();
  await passer(d, t, new Date('2026-09-28T07:30:00Z'));
  assert.equal(t.photos.length, 0);
  assert.equal(d.table.get('PUB-2026-09-28|whatsapp_handoff').etat, 'scheduled');
});

test('deux passages le même jour : la story ne part qu UNE fois', async () => {
  const d = depot({ lignes: [ligne('2026-09-28')] });
  const t = telegram();
  await passer(d, t);
  await passer(d, t, new Date('2026-09-28T17:18:00Z'));
  assert.equal(t.photos.length, 1);
});

test('Telegram pas encore branché : la story du jour ATTEND, les jours passés sont quand même dits', async () => {
  const d = depot({ lignes: [ligne('2026-09-27'), ligne('2026-09-28')] });
  const t = telegram({ configure: false });
  const b = await passer(d, t);
  assert.equal(b.en_attente, 1);
  assert.equal(b.expirees, 1);
  assert.equal(d.table.get('PUB-2026-09-28|whatsapp_handoff').etat, 'scheduled', 'elle partira au passage de 18 h si le groupe est trouvé');
  assert.equal(t.photos.length, 0);
});

test('⛔ « Retirer l approbation » à l écran empêche la remise', async () => {
  const l = ligne('2026-09-28');
  l.approbation = construireRetrait({ publication: l.publication, approbationActuelle: l.approbation, retirePar: 'gassim', instant: '2026-09-28T07:00:00Z' });
  const d = depot({ lignes: [l] });
  const t = telegram();
  const b = await passer(d, t);
  assert.equal(b.ecartees, 1);
  assert.equal(t.photos.length, 0);
});

test('⛔ arrêt d urgence : rien ne part, rien n est touché', async () => {
  const d = depot({ lignes: [ligne('2026-09-27'), ligne('2026-09-28')], actif: false });
  const t = telegram();
  const b = await passer(d, t);
  assert.equal(b.statut, 'arretee');
  assert.equal(t.photos.length, 0);
  assert.equal(d.table.get('PUB-2026-09-27|whatsapp_handoff').etat, 'scheduled');
});

test('mode simulation : rien ne part', async () => {
  const d = depot({ lignes: [ligne('2026-09-28')], mode: 'dry_run' });
  const t = telegram();
  await passer(d, t);
  assert.equal(t.photos.length, 0);
  assert.equal(d.table.get('PUB-2026-09-28|whatsapp_handoff').etat, 'scheduled');
});

test('Telegram refuse : nouvel essai, puis « failed » au troisième refus, avec le motif', async () => {
  const refus = () => ({ statut: 'echec', motif: 'Telegram refuse : Bad Request: wrong file identifier/HTTP URL specified' });
  const d = depot({ lignes: [ligne('2026-09-28')] });
  const t = telegram({ reponses: [refus(), refus(), refus()] });
  await passer(d, t);
  assert.equal(d.table.get('PUB-2026-09-28|whatsapp_handoff').etat, 'scheduled');
  assert.equal(d.table.get('PUB-2026-09-28|whatsapp_handoff').tentatives, 1);
  await passer(d, t);
  await passer(d, t);
  const l = d.table.get('PUB-2026-09-28|whatsapp_handoff');
  assert.equal(l.etat, 'failed');
  assert.match(l.derniere_erreur.message, /wrong file identifier/);
  assert.equal(t.photos.length, 3);
});

test('envoi incertain (délai expiré) : pas renvoyé — jamais deux fois la même story', async () => {
  const d = depot({ lignes: [ligne('2026-09-28')] });
  const t = telegram({ reponses: [{ statut: 'incertain', motif: 'pas de réponse' }] });
  await passer(d, t);
  await passer(d, t, new Date('2026-09-28T17:18:00Z'));
  assert.equal(t.photos.length, 1);
  assert.equal(d.table.get('PUB-2026-09-28|whatsapp_handoff').resultat.incertain, true);
});

test('un texte trop long pour la légende d une photo part dans un second message, jamais tronqué', async () => {
  const long = 'Texte de story. '.repeat(90);
  const { legende, suite } = texteRemise({ date_locale: '2026-09-28', legende: long });
  assert.ok(legende.length <= 1024);
  assert.equal(suite, long.trim());
  const d = depot({ lignes: [ligne('2026-09-28', { legende: long })] });
  const t = telegram();
  await passer(d, t);
  assert.equal(t.textes.length, 1);
  assert.equal(t.textes[0], long.trim());
});

test('sans légende : le CTA du manifeste, sinon « l image suffit »', () => {
  assert.match(texteRemise({ date_locale: '2026-09-28', publication: { cta: 'Préparez vos besoins.' } }).legende, /Préparez vos besoins\./);
  assert.match(texteRemise({ date_locale: '2026-09-28' }).legende, /l'image suffit/);
  assert.equal(jourLisible('2026-10-04'), 'dimanche 04/10');
});

test('LÉGENDE : ChatGPT range la story sous « whatsapp », le canal s appelle « whatsapp_handoff »', () => {
  assert.equal(cleLegende({ whatsapp: {}, facebook: {} }, 'whatsapp_handoff'), 'whatsapp');
  assert.equal(cleLegende({ whatsapp_handoff: {}, whatsapp: {} }, 'whatsapp_handoff'), 'whatsapp_handoff', 'le nom exact gagne');
  assert.equal(cleLegende({ whatsapp: {} }, 'facebook'), 'facebook', 'les canaux qui publient ne changent pas');
  assert.equal(cleLegende(undefined, 'instagram'), 'instagram');
});

test('⛔ la file Facebook/Instagram n est PAS touchée, et une story remise ne mange pas leur plafond', () => {
  const depotSrc = readFileSync(new URL('../api/_lib/autopost-depot.js', import.meta.url), 'utf8');
  const lireFile = depotSrc.slice(depotSrc.indexOf('async lireFile('), depotSrc.indexOf('async lireRemisesWhatsApp('));
  assert.match(lireFile, /\.in\('canal', \[\.\.\.CANAUX_PUBLIANTS\]\)/, 'lireFile ne lit toujours que les canaux qui publient');
  const compter = depotSrc.slice(depotSrc.indexOf('async compterPubliesLe('), depotSrc.indexOf('L\'ALIMENTATION DEPUIS LE DRIVE'));
  assert.match(compter, /\.in\('canal', \[\.\.\.CANAUX_PUBLIANTS\]\)/);
});

test('passage : la remise tourne APRÈS les alertes, son bilan est dans celui du passage, et sa panne ne fait rien tomber', async () => {
  const { creerGestionnaireAutopost } = await import('../api/autopost.js');
  const avant = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'secret-de-test';
  const ordre = [];
  const depotArrete = {
    async lireArretGlobal() { return { actif: false, mode: 'dry_run', plafond: 4 }; },
    async lireFile() { return []; }, async lireAReconcilier() { return []; },
    async compterPubliesLe() { return 0; }, async journaliser() {},
  };
  const rep = { statut: null, corps: null };
  rep.status = (c) => { rep.statut = c; return rep; };
  rep.json = (c) => { rep.corps = c; return rep; };
  rep.setHeader = () => rep; rep.end = () => rep;
  const requete = { url: '/api/autopost-tick', method: 'GET', headers: { authorization: 'Bearer secret-de-test' }, query: {} };
  try {
    await creerGestionnaireAutopost({
      depot: depotArrete, client: { disponible: false }, alimente: async () => ({ creees: 0, ecartees: [] }),
      alertes: async () => { ordre.push('alertes'); return { statut: 'ok' }; },
      whatsapp: async () => { ordre.push('whatsapp'); return { statut: 'ok', remises: 1 }; },
    })(requete, rep);
    assert.deepEqual(ordre, ['alertes', 'whatsapp']);
    assert.equal(rep.corps.bilan.whatsapp.remises, 1);

    await creerGestionnaireAutopost({
      depot: depotArrete, client: { disponible: false }, alimente: async () => ({ creees: 0, ecartees: [] }),
      alertes: async () => ({ statut: 'ok' }),
      whatsapp: async () => { throw new Error('Telegram injoignable'); },
    })(requete, rep);
    assert.equal(rep.statut, 200);
    assert.equal(rep.corps.bilan.whatsapp.statut, 'panne');
  } finally {
    if (avant === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = avant;
  }
});
