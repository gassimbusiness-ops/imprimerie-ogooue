/**
 * Auto-poster — LES COMPTES CIBLES : une étiquette, jamais un numéro.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CE QUE CES TESTS PROTÈGENT, ET POURQUOI ILS EXISTENT
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Le 19/09/2026 au soir, la première publication réelle a traversé TOUTE la
 * chaîne — lecture du Drive, file, approbation, hébergement du média, bon
 * créneau — et a réellement appelé Meta. Réponse, mot pour mot :
 *
 *   code=100 subcode=33 type=GraphMethodException : Unsupported post request.
 *   Object with ID 'IG_IMPRIMERIE' does not exist, cannot be loaded due to
 *   missing permissions, or does not support this operation.
 *
 * L'authentification était acceptée, la requête bien formée. Il ne manquait
 * qu'un numéro : `IG_IMPRIMERIE` est une ÉTIQUETTE, et elle partait telle
 * quelle dans l'URL Graph.
 *
 * Le défaut n'était pas dans ce que ChatGPT a écrit — c'était de lui demander
 * un numéro. Les tests ci-dessous verrouillent la conception qui remplace ça :
 *
 *   1. chaque étiquette connue résout vers SA variable d'environnement ;
 *   2. une étiquette inconnue est un REFUS, jamais une supposition ;
 *   3. une variable absente est un refus DISTINCT — deux gestes, deux motifs ;
 *   4. un identifiant numérique en clair est refusé (décision du 19/09 au soir :
 *      l'accepter rendrait à l'émetteur du manifeste le pouvoir de publier sur
 *      n'importe quelle Page du portefeuille) ;
 *   5. le canal de remise à un humain n'est pas affecté ;
 *   6. l'échec exact de production ne peut plus se reproduire ;
 *   7. l'empreinte d'approbation porte l'ÉTIQUETTE : les approbations déjà en
 *      base ne tombent pas ;
 *   8. aucun identifiant réel ne ressort dans un journal ni dans un bilan.
 *
 * ⛔ ZÉRO APPEL RÉSEAU : le `fetch` est injecté et compte ses appels.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { executerPassage, comptesDepuisEnvironnement, masquerComptes } from '../api/_lib/autopost-executeur.js';
import { creerClientMeta } from '../api/_lib/autopost-meta.js';
import {
  cleIdempotence, empreinteCanonique, chargeCanonique,
  resoudreCompteCible, MOTIFS_COMPTE, COMPTES_CIBLES,
} from '../api/_lib/autopost-contrat.js';
import { travauxDus, RAISONS } from '../api/_lib/autopost-selection.js';
import { instantUtcDepuisCreneau } from '../src/lib/dates.js';

/* Les deux verrous de déploiement ouverts : ces tests observent le chemin RÉEL,
   celui où l'étiquette devait devenir un numéro. */
process.env.AUTOPOST_MODE = 'live';

const NUMERO_PAGE = '100000000000001';
const NUMERO_IG = '178000000000001';
const INSTANT = '2026-09-21T16:45:00Z';

function muet() { /* les tests n'ont pas à parler */ }

/** Pose les deux variables, rend la fonction qui remet l'environnement d'aplomb. */
function poserComptes({ page = NUMERO_PAGE, ig = NUMERO_IG } = {}) {
  const avant = { page: process.env.META_PAGE_ID, ig: process.env.META_INSTAGRAM_ID };
  if (page === null) delete process.env.META_PAGE_ID; else process.env.META_PAGE_ID = page;
  if (ig === null) delete process.env.META_INSTAGRAM_ID; else process.env.META_INSTAGRAM_ID = ig;
  return () => {
    if (avant.page === undefined) delete process.env.META_PAGE_ID;
    else process.env.META_PAGE_ID = avant.page;
    if (avant.ig === undefined) delete process.env.META_INSTAGRAM_ID;
    else process.env.META_INSTAGRAM_ID = avant.ig;
  };
}

function manifeste({ canal = 'facebook', compte = 'PAGE_IMPRIMERIE' } = {}) {
  const date = '2026-09-21';
  const heure = '17:30';
  return {
    schema_version: '2.0',
    publication_id: 'PUB-2026-S39-1-02',
    campagne_id: 'CAMP-RENTREE-2026-09',
    version_contenu: 1,
    semaine_iso: '2026-S39',
    annee_iso: 2026,
    numero_semaine_iso: 39,
    jour_iso: 1,
    date_locale: date,
    creneau: {
      date_locale: date,
      heure_locale: heure,
      fuseau: 'Africa/Libreville',
      offset_utc: '+01:00',
      instant_utc: instantUtcDepuisCreneau({ date_locale: date, heure_locale: heure, offset_utc: '+01:00' }),
      tolerance_minutes: 90,
    },
    format: 'photo',
    mode_execution: 'live',
    medias: [{
      role: 'principal', canal_cible: [canal === 'instagram' ? 'instagram' : 'facebook'],
      chemin_relatif: 'a.jpg', sha256: 'a'.repeat(64), mime_type: 'image/jpeg',
      largeur_px: 1080, hauteur_px: 1350, duree_s: null, ordre_carrousel: 1,
      deja_publie: false, origine: 'photo_reelle', droits: null,
    }],
    captions: {
      [canal]: { chemin_relatif: 'c.txt', sha256: 'b'.repeat(64), caracteres: 300, hashtags: 2, mentions: 0 },
    },
    cta: 'Envoyez la date, les quantités et votre logo',
    code_provenance: 'OG-01-S39',
    offres: [{ offre_id: null, libelle: 'sans offre', prix_affiche: false, valide_jusqu_au_local: null }],
    canaux: [{ canal, compte_cible_id: compte, type_cible: 'page', surface: 'feed', etat: 'scheduled' }],
    genere_par: 'chatgpt',
    avertissements: [],
  };
}

function ligneDe(pub, { canal = 'facebook', compte = 'PAGE_IMPRIMERIE' } = {}) {
  return {
    cle_idempotence: cleIdempotence(pub, { canal, compte_cible_id: compte }),
    publication_id: pub.publication_id,
    version_contenu: pub.version_contenu,
    canal,
    compte_cible_id: compte,
    surface: 'feed',
    instant_utc: pub.creneau.instant_utc,
    date_locale: pub.date_locale,
    tolerance_minutes: pub.creneau.tolerance_minutes,
    etat: 'scheduled',
    tentatives: 0,
    tentatives_max: 3,
    id_distant: null,
    id_conteneur: null,
    legende: 'Flocage textile à Moanda. 📞 060 44 46 34 — OG-01-S39',
    url_media: 'https://exemple.invalid/signee.jpg',
    publication: pub,
    approbation: {
      publication_id: pub.publication_id,
      version_contenu: pub.version_contenu,
      approuve: true,
      approuve_par: 'compte-applicatif-gassim',
      canaux_approuves: [canal],
      creneau_approuve: {
        date_locale: pub.creneau.date_locale,
        heure_locale: pub.creneau.heure_locale,
        fuseau: 'Africa/Libreville',
        instant_utc: pub.creneau.instant_utc,
      },
      payload_sha256: empreinteCanonique(pub),
    },
  };
}

function depotMemoire(lignes) {
  const file = new Map(lignes.map((l) => [l.cle_idempotence, { ...l }]));
  const journal = [];
  return {
    file,
    journal,
    async lireArretGlobal() { return { actif: true, mode: 'live', plafond: 4 }; },
    async lireFile() { return [...file.values()].filter((l) => l.etat === 'scheduled').map((l) => ({ ...l })); },
    async lireAReconcilier() { return []; },
    async compterPubliesLe() { return 0; },
    prendre(cle) {
      const l = file.get(cle);
      if (!l || l.etat !== 'scheduled') return Promise.resolve(false);
      l.etat = 'executing';
      return Promise.resolve(true);
    },
    async relacher(cle, { etat, tentatives, erreur }) {
      Object.assign(file.get(cle), { etat, tentatives, derniere_erreur: erreur ?? null });
    },
    async noterConteneur(cle, id) { file.get(cle).id_conteneur = id; },
    async enregistrerPublication(cle, resultat) {
      Object.assign(file.get(cle), { etat: 'published', id_distant: resultat.id_distant, resultat });
    },
    async journaliser(e) { journal.push(e); },
  };
}

function fauxFetch(reponses) {
  const appels = [];
  const impl = async (url, options = {}) => {
    appels.push({ url, methode: options.method || 'GET' });
    const suite = reponses.shift();
    if (typeof suite === 'function') return suite(url, options);
    if (suite instanceof Error) throw suite;
    return suite;
  };
  impl.appels = appels;
  return impl;
}

const ok = (corps) => ({ ok: true, status: 200, json: async () => corps });
const ko = (status, error) => ({ ok: false, status, json: async () => ({ error }) });

/* ⛔ DEPUIS LE 19/09/2026, TOUTE SÉQUENCE FACEBOOK COMMENCE PAR L'ÉCHANGE.
   `GET /{page-id}?fields=access_token` : l'application obtient elle-même le
   jeton de PAGE à partir du jeton configuré. Les séquences ci-dessous le
   portent en tête, explicitement — la doublure ne le devine pas. */
const JETON_DE_PAGE = 'JETON-DE-PAGE-OBTENU-PAR-ECHANGE';
const echangeOk = () => ok({ id: NUMERO_PAGE, access_token: JETON_DE_PAGE });

/* ═══════════════════════════════════════════════════════════════════════════
   1. CHAQUE ÉTIQUETTE CONNUE RÉSOUT VERS SA VARIABLE
   ═══════════════════════════════════════════════════════════════════════════ */

test('PAGE_IMPRIMERIE → META_PAGE_ID : l\'appel Facebook porte le NUMÉRO, pas l\'étiquette', async () => {
  const remettre = poserComptes();
  try {
    const p = manifeste();
    const depot = depotMemoire([ligneDe(p)]);
    const appel = fauxFetch([
      echangeOk(),
      ok({ post_id: `${NUMERO_PAGE}_900001` }),
      ok({ id: `${NUMERO_PAGE}_900001`, permalink_url: 'https://exemple.invalid/post' }),
    ]);
    const client = creerClientMeta({ jeton: 'jeton-de-test', fetchImpl: appel });

    const bilan = await executerPassage({ depot, client, instant: INSTANT, tracer: muet });

    assert.equal(bilan.publies, 1, `écarté : ${JSON.stringify(bilan.ecartes[0] || null)}`);
    // L'échange vise le NUMÉRO lui aussi : l'étiquette ne sort jamais du dépôt.
    assert.ok(appel.appels[0].url.includes(`/${NUMERO_PAGE}?`),
      `l'échange doit viser le numéro de la Page : ${appel.appels[0].url}`);
    assert.ok(appel.appels[1].url.includes(`/${NUMERO_PAGE}/photos`),
      `l'appel doit viser le numéro de la Page : ${appel.appels[1].url}`);
    assert.ok(!appel.appels.some((a) => a.url.includes('PAGE_IMPRIMERIE')),
      'aucune URL Graph ne doit jamais porter l\'étiquette');
  } finally { remettre(); }
});

test('IG_IMPRIMERIE → META_INSTAGRAM_ID : les deux temps Instagram visent le NUMÉRO', async () => {
  const remettre = poserComptes();
  try {
    const p = manifeste({ canal: 'instagram', compte: 'IG_IMPRIMERIE' });
    const depot = depotMemoire([ligneDe(p, { canal: 'instagram', compte: 'IG_IMPRIMERIE' })]);
    const appel = fauxFetch([
      ok({ id: 'CONTENEUR-1' }),
      ok({ status_code: 'FINISHED' }),
      ok({ id: 'IG-POST-1' }),
      ok({ id: 'IG-POST-1', permalink_url: 'https://exemple.invalid/ig' }),
    ]);
    const client = creerClientMeta({ jeton: 'jeton-de-test', fetchImpl: appel, attendre: async () => {} });

    const bilan = await executerPassage({ depot, client, instant: INSTANT, tracer: muet });

    assert.equal(bilan.publies, 1, `écarté : ${JSON.stringify(bilan.ecartes[0] || null)}`);
    assert.ok(appel.appels[0].url.includes(`/${NUMERO_IG}/media`));
    assert.ok(appel.appels[2].url.includes(`/${NUMERO_IG}/media_publish`));
  } finally { remettre(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. L'ÉCHEC EXACT DE PRODUCTION, REJOUÉ
   ═══════════════════════════════════════════════════════════════════════════ */

test('⛔ REJEU DU 19/09 : `IG_IMPRIMERIE` ne peut PLUS partir tel quel chez Meta', async () => {
  const remettre = poserComptes();
  try {
    const p = manifeste({ canal: 'instagram', compte: 'IG_IMPRIMERIE' });
    const depot = depotMemoire([ligneDe(p, { canal: 'instagram', compte: 'IG_IMPRIMERIE' })]);
    const appel = fauxFetch([
      ok({ id: 'CONTENEUR-1' }), ok({ status_code: 'FINISHED' }), ok({ id: 'IG-POST-1' }), ok({ id: 'IG-POST-1' }),
    ]);
    const client = creerClientMeta({ jeton: 'jeton-de-test', fetchImpl: appel, attendre: async () => {} });

    await executerPassage({ depot, client, instant: INSTANT, tracer: muet });

    // C'est CE test qui tient la panne fermée : plus aucune URL ne porte
    // l'étiquette, donc Meta ne peut plus répondre « Object with ID
    // 'IG_IMPRIMERIE' does not exist ».
    for (const a of appel.appels) {
      assert.ok(!a.url.includes('IG_IMPRIMERIE'), `étiquette partie chez Meta : ${a.url}`);
    }
    assert.ok(appel.appels.length > 0, 'le chemin réel doit bien avoir été emprunté');
  } finally { remettre(); }
});

test('⛔ REJEU DU 19/09, variante sans variable : refus AVANT le réseau, zéro appel', async () => {
  // Le soir du 19/09, `META_INSTAGRAM_ID` n'était pas posée. Dans cet état, la
  // chaîne ne doit plus appeler Meta du tout : elle doit refuser en le disant.
  const remettre = poserComptes({ ig: null });
  try {
    const p = manifeste({ canal: 'instagram', compte: 'IG_IMPRIMERIE' });
    const depot = depotMemoire([ligneDe(p, { canal: 'instagram', compte: 'IG_IMPRIMERIE' })]);
    const appel = fauxFetch([]);
    const client = creerClientMeta({ jeton: 'jeton-de-test', fetchImpl: appel });

    const bilan = await executerPassage({ depot, client, instant: INSTANT, tracer: muet });

    assert.equal(appel.appels.length, 0, 'aucun appel réseau ne doit être tenté');
    assert.equal(bilan.publies, 0);
    assert.equal(bilan.ecartes[0].raison, RAISONS.COMPTE_CIBLE_NON_CONFIGURE);
    assert.ok(bilan.ecartes[0].detail.includes('META_INSTAGRAM_ID'),
      'le motif doit NOMMER la variable à poser');
    // La ligne n'est ni prise, ni comptée en échec : elle attend la variable.
    const l = [...depot.file.values()][0];
    assert.equal(l.etat, 'scheduled');
    assert.equal(l.tentatives, 0);
  } finally { remettre(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. LES REFUS — UN MOTIF PAR GESTE
   ═══════════════════════════════════════════════════════════════════════════ */

test('⛔ une étiquette INCONNUE est un refus, jamais une supposition', async () => {
  const remettre = poserComptes();
  try {
    const p = manifeste({ compte: 'PAGE_IMPRIMERI' }); // une lettre en moins
    const depot = depotMemoire([ligneDe(p, { compte: 'PAGE_IMPRIMERI' })]);
    const appel = fauxFetch([]);
    const client = creerClientMeta({ jeton: 'jeton-de-test', fetchImpl: appel });

    const bilan = await executerPassage({ depot, client, instant: INSTANT, tracer: muet });

    assert.equal(appel.appels.length, 0);
    assert.equal(bilan.ecartes[0].raison, RAISONS.COMPTE_CIBLE_INCONNU);
    assert.ok(bilan.ecartes[0].detail.includes('PAGE_IMPRIMERI'), 'le motif nomme ce qui a été reçu');
    assert.ok(bilan.ecartes[0].detail.includes('PAGE_IMPRIMERIE'), 'et liste ce qui existe');
    assert.ok(bilan.ecartes[0].detail.includes('IG_IMPRIMERIE'));
  } finally { remettre(); }
});

test('⛔ DEUX MOTIFS DIFFÉRENTS : étiquette inconnue ≠ variable absente', () => {
  // Corriger le dépôt et poser une variable dans Vercel sont deux gestes. Le
  // gérant de Moanda doit savoir lequel faire sans les essayer tous les deux.
  const inconnue = resoudreCompteCible({ etiquette: 'PAGE_TOPSHOP', canal: 'facebook', comptes: {} });
  const absente = resoudreCompteCible({ etiquette: 'PAGE_IMPRIMERIE', canal: 'facebook', comptes: {} });

  assert.equal(inconnue.motif, MOTIFS_COMPTE.INCONNU);
  assert.equal(absente.motif, MOTIFS_COMPTE.NON_CONFIGURE);
  assert.notEqual(inconnue.motif, absente.motif);
  assert.ok(absente.detail.includes('META_PAGE_ID'));
  assert.ok(absente.detail.includes('Vercel'));
  assert.ok(!absente.detail.includes('dépôt') || absente.detail.includes('Rien à corriger dans le dépôt'));
});

test('⛔ un identifiant NUMÉRIQUE en clair est refusé — c\'est la décision, et elle est testée', () => {
  // L'accepter redonnerait à un manifeste erroné ou altéré le pouvoir de
  // publier sur n'importe quelle Page que le jeton voit — TopShop GABON
  // comprise. Une liste fermée d'étiquettes le rend impossible.
  const r = resoudreCompteCible({
    etiquette: NUMERO_PAGE, canal: 'facebook', comptes: { PAGE_IMPRIMERIE: NUMERO_PAGE },
  });
  assert.equal(r.resolu, false);
  assert.equal(r.motif, MOTIFS_COMPTE.INCONNU);
  assert.ok(r.detail.includes('numérique'), `motif illisible : ${r.detail}`);
  assert.equal(r.id, null);
});

test('⛔ un identifiant numérique en clair ne publie RIEN, même bien formé', async () => {
  const remettre = poserComptes();
  try {
    const p = manifeste({ compte: NUMERO_PAGE });
    const depot = depotMemoire([ligneDe(p, { compte: NUMERO_PAGE })]);
    const appel = fauxFetch([]);
    const client = creerClientMeta({ jeton: 'jeton-de-test', fetchImpl: appel });

    const bilan = await executerPassage({ depot, client, instant: INSTANT, tracer: muet });

    assert.equal(appel.appels.length, 0, 'le numéro en clair ne doit ouvrir aucun appel');
    assert.equal(bilan.publies, 0);
    assert.equal(bilan.ecartes[0].raison, RAISONS.COMPTE_CIBLE_INCONNU);
  } finally { remettre(); }
});

test('⛔ une étiquette du BON format mais du MAUVAIS canal est refusée', async () => {
  const remettre = poserComptes();
  try {
    // L'Instagram de l'imprimerie sur le canal Facebook : les deux existent,
    // l'appariement est faux. Sans ce refus, on publierait sur l'objet d'à côté.
    const p = manifeste({ canal: 'facebook', compte: 'IG_IMPRIMERIE' });
    const depot = depotMemoire([ligneDe(p, { canal: 'facebook', compte: 'IG_IMPRIMERIE' })]);
    const appel = fauxFetch([]);
    const client = creerClientMeta({ jeton: 'jeton-de-test', fetchImpl: appel });

    const bilan = await executerPassage({ depot, client, instant: INSTANT, tracer: muet });

    assert.equal(appel.appels.length, 0);
    assert.equal(bilan.ecartes[0].raison, RAISONS.COMPTE_CIBLE_MAUVAIS_CANAL);
  } finally { remettre(); }
});

test('un compte cible absent garde SON motif d\'origine', () => {
  const r = resoudreCompteCible({ etiquette: null, canal: 'facebook', comptes: {} });
  assert.equal(r.motif, MOTIFS_COMPTE.ABSENT);
  assert.ok(r.detail.includes('PAGE_IMPRIMERIE'), 'le motif dit ce qui existe');
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. LE CANAL WHATSAPP N'EST PAS AFFECTÉ
   ═══════════════════════════════════════════════════════════════════════════ */

test('la remise WhatsApp reste une remise à un humain — aucune résolution, aucun appel', async () => {
  const remettre = poserComptes({ page: null, ig: null });
  try {
    const p = manifeste({ canal: 'whatsapp_handoff', compte: 'WA_IMPRIMERIE' });
    const ligne = ligneDe(p, { canal: 'whatsapp_handoff', compte: 'WA_IMPRIMERIE' });
    const depot = depotMemoire([ligne]);
    const appel = fauxFetch([]);
    const client = creerClientMeta({ jeton: 'jeton-de-test', fetchImpl: appel });

    const bilan = await executerPassage({ depot, client, instant: INSTANT, tracer: muet });

    assert.equal(appel.appels.length, 0);
    assert.equal(bilan.publies, 0);
    // Le motif est celui d'AVANT ce chantier : le canal ne publie pas, un point
    // c'est tout. Aucun des nouveaux refus ne doit s'y substituer.
    assert.equal(bilan.ecartes[0].raison, RAISONS.CANAL_SANS_PUBLICATION);
    const l = [...depot.file.values()][0];
    assert.equal(l.etat, 'scheduled', 'la ligne n\'est ni prise ni abîmée');
  } finally { remettre(); }
});

test('WA_IMPRIMERIE se résout sans exiger aucune variable d\'environnement', () => {
  const r = resoudreCompteCible({ etiquette: 'WA_IMPRIMERIE', canal: 'whatsapp_handoff', comptes: {} });
  assert.equal(r.resolu, true);
  assert.equal(r.id, null, 'rien à appeler : il n\'y a pas d\'identifiant à porter');
  assert.equal(COMPTES_CIBLES.WA_IMPRIMERIE.variable, null);
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. L'EMPREINTE D'APPROBATION — LES 48 APPROBATIONS EN BASE
   ═══════════════════════════════════════════════════════════════════════════ */

test('⛔ l\'empreinte d\'approbation porte l\'ÉTIQUETTE : rien n\'est resigné', () => {
  // `chargeCanonique()` scelle `canal|compte_cible_id|surface`. Comme la
  // résolution n'a lieu qu'au MOMENT DE PUBLIER et ne réécrit jamais le
  // manifeste, la charge scellée est exactement celle d'avant ce chantier :
  // les approbations déjà en base restent valables, à la lettre près.
  const p = manifeste();
  const charge = chargeCanonique(p);

  assert.ok(charge.includes('facebook|PAGE_IMPRIMERIE|feed'),
    `la charge doit sceller l'étiquette : ${charge}`);
  assert.ok(!charge.includes(NUMERO_PAGE),
    'aucun numéro de compte ne doit entrer dans l\'empreinte — sinon changer de Page invaliderait tout');

  // Et l'empreinte ne bouge pas selon l'environnement : même manifeste, mêmes
  // octets, que les variables soient posées ou non.
  const remettre = poserComptes({ page: null, ig: null });
  const sansEnv = empreinteCanonique(p);
  remettre();
  assert.equal(empreinteCanonique(p), sansEnv);
});

test('⛔ une approbation scellée sur l\'étiquette reste honorée par la sélection', () => {
  const p = manifeste();
  const l = ligneDe(p); // son `payload_sha256` a été calculé sur l'étiquette
  const d = travauxDus({
    file: [l], instant: INSTANT, options: { comptes: { PAGE_IMPRIMERIE: NUMERO_PAGE } },
  });
  assert.equal(d.aPublier.length, 1, `écarté : ${JSON.stringify(d.ecartes[0] || null)}`);
});

/* ═══════════════════════════════════════════════════════════════════════════
   6. AUCUN IDENTIFIANT RÉEL NE RESSORT
   ═══════════════════════════════════════════════════════════════════════════ */

test('⛔ le message d\'erreur de Meta revient avec l\'ÉTIQUETTE, pas avec le numéro', async () => {
  const remettre = poserComptes();
  try {
    const p = manifeste();
    const depot = depotMemoire([ligneDe(p)]);
    // Meta nomme l'objet visé dans son message : c'est exactement la forme de
    // l'erreur du 19/09, mais avec le numéro cette fois.
    const appel = fauxFetch([echangeOk(), ko(400, {
      code: 100,
      error_subcode: 33,
      type: 'GraphMethodException',
      message: `Unsupported post request. Object with ID '${NUMERO_PAGE}' does not exist`,
    })]);
    const client = creerClientMeta({ jeton: 'jeton-de-test', fetchImpl: appel });

    const bilan = await executerPassage({ depot, client, instant: INSTANT, tracer: muet });

    assert.equal(bilan.echecs, 1);
    const journalise = depot.journal.find((e) => e.evenement === 'echec');
    assert.ok(!journalise.resume.includes(NUMERO_PAGE), `numéro dans le journal : ${journalise.resume}`);
    assert.ok(journalise.resume.includes('PAGE_IMPRIMERIE'));

    const enBase = [...depot.file.values()][0].derniere_erreur;
    assert.ok(!enBase.message_erreur.includes(NUMERO_PAGE));
    assert.ok(enBase.message_erreur.includes('PAGE_IMPRIMERIE'));
  } finally { remettre(); }
});

test('⛔ le bilan rendu à l\'écran ne porte aucun identifiant réel', async () => {
  const remettre = poserComptes();
  try {
    const p = manifeste();
    const depot = depotMemoire([ligneDe(p)]);
    const appel = fauxFetch([
      echangeOk(),
      ok({ post_id: `${NUMERO_PAGE}_900001` }),
      ok({ id: `${NUMERO_PAGE}_900001`, permalink_url: 'https://exemple.invalid/post' }),
    ]);
    const client = creerClientMeta({ jeton: 'jeton-de-test', fetchImpl: appel });

    const bilan = await executerPassage({ depot, client, instant: INSTANT, tracer: muet });

    assert.equal(bilan.publies, 1);
    assert.ok(!JSON.stringify(bilan).includes(JETON_DE_PAGE),
      'le jeton OBTENU est un secret au même titre que le configuré');
    assert.ok(!JSON.stringify(bilan).includes(NUMERO_PAGE),
      `le bilan remonte jusqu'au navigateur : ${JSON.stringify(bilan.details)}`);
    const publie = depot.journal.find((e) => e.evenement === 'publication');
    assert.ok(!publie.resume.includes(NUMERO_PAGE));

    // ⚠️ MAIS la colonne `id_distant` garde la valeur BRUTE : c'est le témoin de
    //    l'effet, et l'index unique qui empêche une double publication est posé
    //    dessus. Masquer là serait casser l'idempotence pour un confort d'écran.
    assert.equal([...depot.file.values()][0].id_distant, `${NUMERO_PAGE}_900001`);
  } finally { remettre(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   7. LA TABLE DE L'ENVIRONNEMENT
   ═══════════════════════════════════════════════════════════════════════════ */

test('comptesDepuisEnvironnement ne retient que les variables réellement posées', () => {
  assert.deepEqual(
    comptesDepuisEnvironnement({ META_PAGE_ID: NUMERO_PAGE, META_INSTAGRAM_ID: '  ' }),
    { PAGE_IMPRIMERIE: NUMERO_PAGE },
  );
  assert.deepEqual(comptesDepuisEnvironnement({}), {});
  // Les noms sont ceux que le bot Messenger lit déjà : aucun nom inventé.
  assert.equal(COMPTES_CIBLES.PAGE_IMPRIMERIE.variable, 'META_PAGE_ID');
  assert.equal(COMPTES_CIBLES.IG_IMPRIMERIE.variable, 'META_INSTAGRAM_ID');
});

test('masquerComptes remplace chaque identifiant par son étiquette, et rien d\'autre', () => {
  const comptes = { PAGE_IMPRIMERIE: NUMERO_PAGE, IG_IMPRIMERIE: NUMERO_IG };
  assert.equal(
    masquerComptes(`objet ${NUMERO_PAGE} et ${NUMERO_IG}`, comptes),
    'objet PAGE_IMPRIMERIE et IG_IMPRIMERIE',
  );
  assert.equal(masquerComptes('rien à masquer', comptes), 'rien à masquer');
  assert.equal(masquerComptes(null, comptes), null);
});
