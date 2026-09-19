/**
 * Auto-poster — L'APPROBATION : le geste humain, et la serrure qui le tient.
 *
 * ── Ce qui manquait, exactement ───────────────────────────────────────────
 *
 * Au 19/09/2026, `autopost-contrat.js` exportait `signerApprobation()` avec le
 * commentaire « Utilisée par l'écran d'approbation ». Cet écran n'existait pas :
 * `grep -rn signerApprobation src api` ne rendait AUCUN appelant. Conséquence
 * mesurable : la sélection écartait chaque ligne avec `non_approuve`, et
 * personne, dans toute l'application, ne pouvait lever ce refus. La chaîne était
 * complète sauf le seul geste qu'elle exige d'un humain.
 *
 * ── Ce que ces tests protègent ────────────────────────────────────────────
 *
 *   1. UNE APPROBATION DONNÉE EST ACCEPTÉE — prouvé par `travauxDus()`, la
 *      fonction que le passage horaire appelle réellement, pas par une
 *      reformulation de la règle.
 *   2. ELLE SE DÉFAIT. Approuver par erreur à 08 h 55 doit s'annuler avant
 *      09 h 00.
 *   3. ELLE PORTE L'EMPREINTE DU CONTENU APPROUVÉ. Changer la légende, le
 *      média, le créneau, le compte cible ou la version INVALIDE l'approbation
 *      au lieu de la traîner. Cinq tests, un par cause.
 *   4. ELLE NE VAUT QUE POUR LE CANAL APPROUVÉ.
 *   5. LE REFUS EST CÔTÉ SERVEUR. Un bouton caché n'est pas une serrure : ces
 *      tests montent le vrai gestionnaire HTTP et lui présentent un employé,
 *      un visiteur sans session, et — cas le plus important — le secret de la
 *      TÂCHE PLANIFIÉE. Aucun des trois ne doit pouvoir approuver.
 *   6. CE QUI EST PARTI NE S'APPROUVE PLUS. Retirer une approbation après coup
 *      ne dépublierait rien : ce serait mentir sur l'état réel.
 *
 * ⛔ ZÉRO RÉSEAU, ZÉRO BASE : le dépôt est une doublure en mémoire.
 *
 * Lancer :  node --test tests/autopost-approbation.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  construireApprobation,
  construireRetrait,
  traiterApprobation,
  cleSignatureApprobation,
  REFUS,
} from '../api/_lib/autopost-approbation.js';
import {
  verifierApprobation, empreinteCanonique, cleIdempotence, approbationARetenir, ORIGINE_ECRAN,
} from '../api/_lib/autopost-contrat.js';
import { ETATS_MODIFIABLES } from '../api/_lib/autopost-alimentation.js';
import { travauxDus, RAISONS } from '../api/_lib/autopost-selection.js';
import { instantUtcDepuisCreneau } from '../src/lib/dates.js';

/* Des ÉTIQUETTES, pas des numéros — voir `tests/autopost-comptes-cibles.test.mjs`. */
const PAGE_ID = 'PAGE_IMPRIMERIE';
const IG_ID = 'IG_IMPRIMERIE';

/** L'instant du geste : samedi 19/09/2026, 08 h 55 locales — cinq minutes avant. */
const INSTANT = '2026-09-19T07:55:00Z';

/* ═══════════════════════════════════════════════════════════════════════════
   Le matériel
   ═══════════════════════════════════════════════════════════════════════════ */

function manifeste({
  id = 'PUB-2026-S38-6-01',
  date = '2026-09-19',
  heure = '09:00',
  version = 1,
  legendeSha = 'b'.repeat(64),
  mediaSha = 'a'.repeat(64),
  canaux = [{ canal: 'facebook', compte_cible_id: PAGE_ID, surface: 'feed' }],
} = {}) {
  return {
    schema_version: '2.0',
    publication_id: id,
    version_contenu: version,
    semaine_iso: '2026-S38',
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
    mode_execution: 'dry_run',
    medias: [{
      role: 'principal',
      canal_cible: ['facebook', 'instagram'],
      chemin_relatif: '2026-09-19_OGOOUE_Textile.jpg',
      sha256: mediaSha,
      mime_type: 'image/jpeg',
      ordre_carrousel: 1,
      origine: 'chatgpt',
    }],
    captions: { facebook: { chemin_relatif: 'caption_facebook.txt', sha256: legendeSha } },
    cta: 'Envoyez la date, les quantités et votre logo',
    code_provenance: 'OG-01-S38',
    offres: [{ offre_id: null, prix_affiche: false, valide_jusqu_au_local: null }],
    canaux,
  };
}

/** Une ligne de file telle que l'alimentation l'écrit. */
function ligne(pub, { canal = 'facebook', compte = PAGE_ID, ...sur } = {}) {
  return {
    cle_idempotence: cleIdempotence(pub, { canal, compte_cible_id: compte }),
    publication_id: pub.publication_id,
    version_contenu: pub.version_contenu,
    canal,
    compte_cible_id: compte,
    surface: 'feed',
    instant_utc: pub.creneau.instant_utc,
    date_locale: pub.date_locale,
    tolerance_minutes: 90,
    etat: 'scheduled',
    tentatives: 0,
    tentatives_max: 3,
    id_distant: null,
    legende: 'Flocage textile à Moanda.',
    url_media: 'https://exemple.supabase.co/storage/v1/object/public/publications/x.jpg',
    publication: pub,
    approbation: null,
    resultat: null,
    derniere_erreur: null,
    ...sur,
  };
}

/**
 * Dépôt en mémoire. Il reproduit la garantie qui compte : l'écriture de
 * l'approbation est CONDITIONNELLE à l'état et à l'absence de témoin, comme
 * l'UPDATE conditionnel de `autopost-depot.js`.
 */
function depotFactice({ lignes = [] } = {}) {
  const file = new Map(lignes.map((l) => [l.cle_idempotence, { ...l }]));
  const journal = [];
  const ecritures = [];
  return {
    file,
    journal,
    ecritures,
    async lirePourApprobation(cle) {
      const l = file.get(cle);
      return l ? { ...l } : null;
    },
    async ecrireApprobation(cle, approbation) {
      const l = file.get(cle);
      if (!l || l.id_distant || !ETATS_MODIFIABLES.includes(l.etat)) return false;
      l.approbation = approbation;
      ecritures.push({ cle, approbation });
      return true;
    },
    async journaliser(e) { journal.push(e); },
  };
}

const approuver = (depot, cle, options = {}) => traiterApprobation({
  depot, cle, approuve: true, parQui: 'u-admin', instant: INSTANT, ...options,
});
const retirer = (depot, cle, options = {}) => traiterApprobation({
  depot, cle, approuve: false, parQui: 'u-admin', instant: INSTANT, ...options,
});

/* ═══════════════════════════════════════════════════════════════════════════
   1. LE CAS NOMINAL — et la preuve qu'il débloque VRAIMENT la publication
   ═══════════════════════════════════════════════════════════════════════════ */

test('approuver écrit une approbation SIGNÉE DU CONTENU, jamais un « approuve: true » nu', async () => {
  const pub = manifeste();
  const depot = depotFactice({ lignes: [ligne(pub)] });
  const cle = [...depot.file.keys()][0];

  const issue = await approuver(depot, cle);

  assert.equal(issue.statut, 200);
  const a = depot.file.get(cle).approbation;
  assert.equal(a.approuve, true);
  assert.equal(a.publication_id, 'PUB-2026-S38-6-01');
  assert.equal(a.version_contenu, 1);
  assert.deepEqual(a.canaux_approuves, ['facebook']);
  // ⛔ LE CŒUR : l'empreinte du contenu approuvé, recalculée par le serveur sur
  //    le manifeste qu'il a lui-même rangé — pas envoyée par le navigateur.
  assert.equal(a.payload_sha256, empreinteCanonique(pub));
  assert.equal(a.creneau_approuve.date_locale, '2026-09-19');
  assert.equal(a.creneau_approuve.heure_locale, '09:00');
  assert.equal(a.origine, ORIGINE_ECRAN);
  assert.equal(a.approuve_par, 'u-admin');
});

test('⛔ LA PREUVE : une ligne approuvée n est plus écartée par la SÉLECTION', async () => {
  const pub = manifeste();
  const depot = depotFactice({ lignes: [ligne(pub)] });
  const cle = [...depot.file.keys()][0];

  // Avant : la sélection refuse, avec le motif que l'écran affiche.
  const avant = travauxDus({ file: [depot.file.get(cle)], instant: '2026-09-19T08:10:00Z' });
  assert.equal(avant.aPublier.length, 0);
  assert.equal(avant.ecartes[0].raison, RAISONS.NON_APPROUVE);
  assert.equal(avant.ecartes[0].detail, 'approbation_absente');

  await approuver(depot, cle);

  // Après : la MÊME fonction, celle que le passage horaire appelle, accepte.
  const apres = travauxDus({ file: [depot.file.get(cle)], instant: '2026-09-19T08:10:00Z' });
  assert.equal(apres.ecartes.length, 0, `écarté : ${JSON.stringify(apres.ecartes[0] || null)}`);
  assert.equal(apres.aPublier.length, 1);
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. L'APPROBATION SE DÉFAIT — 08 h 55, on revient en arrière
   ═══════════════════════════════════════════════════════════════════════════ */

test('retirer une approbation la défait, et la sélection refuse à nouveau', async () => {
  const pub = manifeste();
  const depot = depotFactice({ lignes: [ligne(pub)] });
  const cle = [...depot.file.keys()][0];

  await approuver(depot, cle);
  const issue = await retirer(depot, cle);

  assert.equal(issue.statut, 200);
  const a = depot.file.get(cle).approbation;
  assert.equal(a.approuve, false);
  assert.equal(a.retire_par, 'u-admin');
  // On garde la trace de ce qui a été retiré : une colonne remise à `null`
  // effacerait l'histoire au moment précis où elle devient intéressante.
  assert.equal(a.approbation_retiree.approuve_par, 'u-admin');

  const apres = travauxDus({ file: [depot.file.get(cle)], instant: '2026-09-19T08:10:00Z' });
  assert.equal(apres.aPublier.length, 0);
  assert.equal(apres.ecartes[0].raison, RAISONS.NON_APPROUVE);
  // `approbation_refusee`, et non `approbation_absente` : le refus est EXPLICITE.
  assert.equal(apres.ecartes[0].detail, 'approbation_refusee');
});

test('le journal porte les deux gestes, avec qui et quand', async () => {
  const pub = manifeste();
  const depot = depotFactice({ lignes: [ligne(pub)] });
  const cle = [...depot.file.keys()][0];

  await approuver(depot, cle);
  await retirer(depot, cle);

  assert.deepEqual(depot.journal.map((e) => e.evenement),
    ['approbation_donnee', 'approbation_retiree']);
  assert.equal(depot.journal[0].instant_utc, INSTANT);
  assert.match(depot.journal[0].resume, /u-admin/);
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. CE QUI INVALIDE UNE APPROBATION — cinq causes, cinq tests

   C'est tout l'intérêt de l'empreinte : une correction après approbation ne
   part pas toute seule. Chaque test approuve, MODIFIE, puis vérifie avec la
   fonction que le passage horaire appelle.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Approuve une ligne, applique une modification au manifeste, rend le motif. */
async function motifApresModification(modifier, { canal = 'facebook' } = {}) {
  const pub = manifeste();
  const depot = depotFactice({ lignes: [ligne(pub)] });
  const cle = [...depot.file.keys()][0];
  await approuver(depot, cle);
  const l = depot.file.get(cle);
  l.publication = modifier(structuredClone(pub));
  return verifierApprobation({
    publication: l.publication, approbation: l.approbation, canal,
  }).raison;
}

test('⛔ la LÉGENDE modifiée après approbation invalide l approbation', async () => {
  const raison = await motifApresModification((p) => {
    p.captions.facebook.sha256 = 'c'.repeat(64);
    return p;
  });
  assert.equal(raison, 'contenu_modifie_depuis_approbation');
});

test('⛔ le MÉDIA remplacé après approbation invalide l approbation', async () => {
  const raison = await motifApresModification((p) => {
    p.medias[0].sha256 = 'f'.repeat(64);
    return p;
  });
  assert.equal(raison, 'contenu_modifie_depuis_approbation');
});

test('⛔ le COMPTE CIBLE changé après approbation invalide l approbation', async () => {
  // Publier sur la page de TOPSHOP GABON au lieu de celle de l'imprimerie n'est
  // pas un détail : c'est une affiche d'imprimerie sur la page d'une autre
  // entreprise. L'empreinte canonique porte le compte cible, exprès.
  const raison = await motifApresModification((p) => {
    p.canaux[0].compte_cible_id = '999999999999999';
    return p;
  });
  assert.equal(raison, 'contenu_modifie_depuis_approbation');
});

test('⛔ le CRÉNEAU déplacé après approbation invalide l approbation', async () => {
  const raison = await motifApresModification((p) => {
    p.creneau.heure_locale = '17:30';
    p.creneau.instant_utc = instantUtcDepuisCreneau({
      date_locale: p.creneau.date_locale, heure_locale: '17:30', offset_utc: '+01:00',
    });
    return p;
  });
  // L'empreinte canonique porte déjà le créneau : c'est elle qui mord la
  // première. Le contrôle `creneau_modifie_depuis_approbation` est la ceinture
  // par-dessus les bretelles, et les deux sont des refus.
  assert.ok(
    ['contenu_modifie_depuis_approbation', 'creneau_modifie_depuis_approbation'].includes(raison),
    `motif inattendu : ${raison}`,
  );
});

test('⛔ une CORRECTION (version_contenu incrémentée) périme l approbation', async () => {
  const raison = await motifApresModification((p) => {
    p.version_contenu = 2;
    return p;
  });
  assert.equal(raison, 'approbation_perimee_version_contenu');
});

test('⛔ approuver Facebook n approuve PAS Instagram', async () => {
  const pub = manifeste({
    canaux: [
      { canal: 'facebook', compte_cible_id: PAGE_ID, surface: 'feed' },
      { canal: 'instagram', compte_cible_id: IG_ID, surface: 'feed' },
    ],
  });
  const depot = depotFactice({
    lignes: [ligne(pub), ligne(pub, { canal: 'instagram', compte: IG_ID })],
  });
  const cleFb = cleIdempotence(pub, { canal: 'facebook', compte_cible_id: PAGE_ID });
  const cleIg = cleIdempotence(pub, { canal: 'instagram', compte_cible_id: IG_ID });

  await approuver(depot, cleFb);

  assert.equal(depot.file.get(cleFb).approbation.approuve, true);
  assert.equal(depot.file.get(cleIg).approbation, null, 'l autre canal ne doit pas être touché');

  // Et même si l'approbation de Facebook se retrouvait sur la ligne Instagram,
  // elle ne vaudrait rien : `canaux_approuves` ne contient pas ce canal.
  assert.equal(
    verifierApprobation({
      publication: pub, approbation: depot.file.get(cleFb).approbation, canal: 'instagram',
    }).raison,
    'canal_non_approuve',
  );
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. LA SIGNATURE — et ce qu'elle vaut quand la clé est absente
   ═══════════════════════════════════════════════════════════════════════════ */

test('avec AUTOPOST_CLE_APPROBATION, l approbation est signée et la signature est vérifiée', async () => {
  const pub = manifeste();
  const depot = depotFactice({ lignes: [ligne(pub)] });
  const cle = [...depot.file.keys()][0];
  const secret = 'clé-de-test-uniquement-jamais-en-production';

  await approuver(depot, cle, { cleSignature: secret });
  const a = depot.file.get(cle).approbation;

  assert.equal(a.signature, 'hmac_sha256');
  assert.equal(typeof a.signature_hmac_sha256, 'string');
  assert.equal(a.signature_hmac_sha256.length, 64);
  assert.equal(
    verifierApprobation({ publication: pub, approbation: a, canal: 'facebook', cleSignature: secret }).approuve,
    true,
  );
  // Une autre clé ne valide pas : la signature sert bien à distinguer l'auteur.
  assert.equal(
    verifierApprobation({
      publication: pub, approbation: a, canal: 'facebook', cleSignature: 'une-autre-clé-de-test',
    }).raison,
    'signature_approbation_invalide',
  );
});

test('⛔ SANS la clé, l approbation est écrite « signature: absente » — jamais une signature vide', async () => {
  const pub = manifeste();
  const depot = depotFactice({ lignes: [ligne(pub)] });
  const cle = [...depot.file.keys()][0];

  const issue = await approuver(depot, cle, { cleSignature: null });
  const a = depot.file.get(cle).approbation;

  // `null` explicite : une chaîne vide ressemblerait à une signature.
  assert.equal(a.signature_hmac_sha256, null);
  assert.equal(a.signature, 'absente');
  assert.equal(issue.corps.signature, 'absente');
  // Et on le DIT dans le journal, plutôt que de laisser croire à une serrure.
  assert.match(depot.journal[0].resume, /SANS signature/);
  assert.match(depot.journal[0].piste, /AUTOPOST_CLE_APPROBATION/);
});

test('cleSignatureApprobation() ne fabrique aucun secret : absente → null', () => {
  const avant = process.env.AUTOPOST_CLE_APPROBATION;
  delete process.env.AUTOPOST_CLE_APPROBATION;
  assert.equal(cleSignatureApprobation(), null);
  process.env.AUTOPOST_CLE_APPROABTION_INEXISTANTE = '';
  process.env.AUTOPOST_CLE_APPROBATION = '   ';
  assert.equal(cleSignatureApprobation(), null, 'une clé vide de blancs n est pas une clé');
  process.env.AUTOPOST_CLE_APPROBATION = 'secret';
  assert.equal(cleSignatureApprobation(), 'secret');
  if (avant === undefined) delete process.env.AUTOPOST_CLE_APPROBATION;
  else process.env.AUTOPOST_CLE_APPROBATION = avant;
  delete process.env.AUTOPOST_CLE_APPROABTION_INEXISTANTE;
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. CE QU'ON N'APPROUVE PAS
   ═══════════════════════════════════════════════════════════════════════════ */

test('⛔ une publication DÉJÀ PARTIE ne s approuve ni ne se désapprouve', async () => {
  const pub = manifeste();
  const depot = depotFactice({
    lignes: [ligne(pub, { etat: 'published', id_distant: '100_777' })],
  });
  const cle = [...depot.file.keys()][0];

  const donner = await approuver(depot, cle);
  const defaire = await retirer(depot, cle);

  assert.equal(donner.statut, 409);
  assert.equal(donner.corps.motif, REFUS.DEJA_PARTIE);
  assert.equal(defaire.statut, 409);
  assert.equal(depot.ecritures.length, 0, 'aucune écriture ne doit partir');
});

test('⛔ une ligne EN VOL (executing) ne s approuve pas pendant qu elle part', async () => {
  const pub = manifeste();
  const depot = depotFactice({ lignes: [ligne(pub, { etat: 'executing' })] });
  const cle = [...depot.file.keys()][0];

  const issue = await approuver(depot, cle);

  assert.equal(issue.statut, 409);
  assert.equal(issue.corps.motif, REFUS.ETAT_NON_MODIFIABLE);
  assert.equal(depot.ecritures.length, 0);
});

test('⛔ sans manifeste sur la ligne, AUCUNE approbation — une empreinte ne se devine pas', async () => {
  const pub = manifeste();
  const depot = depotFactice({ lignes: [ligne(pub, { publication: null })] });
  const cle = [...depot.file.keys()][0];

  const issue = await approuver(depot, cle);

  assert.equal(issue.statut, 409);
  assert.equal(issue.corps.motif, REFUS.MANIFESTE_ABSENT);
  assert.equal(depot.ecritures.length, 0);
});

test('une clé inconnue rend 404, et n écrit rien', async () => {
  const depot = depotFactice({ lignes: [] });
  const issue = await approuver(depot, 'PUB-INEXISTANTE|v1|facebook|1|2026-09-19T08:00:00Z');
  assert.equal(issue.statut, 404);
  assert.equal(issue.corps.motif, REFUS.LIGNE_INCONNUE);
});

test('une clé absente ou vide rend 400', async () => {
  const depot = depotFactice({ lignes: [] });
  assert.equal((await approuver(depot, '')).statut, 400);
  assert.equal((await approuver(depot, undefined)).statut, 400);
});

test('⛔ l AUTO-CONTRÔLE : on n écrit jamais une approbation qui serait refusée', async () => {
  // Un manifeste sans `publication_id` : l'objet fabriqué porterait
  // `publication_id: null`, et `verifierApprobation()` le refuserait au moment
  // de publier. Mieux vaut refuser maintenant que laisser croire au gérant que
  // la ligne est débloquée.
  const pub = manifeste();
  const casse = { ...structuredClone(pub), publication_id: undefined };
  const depot = depotFactice({ lignes: [ligne(pub, { publication: casse })] });
  const cle = [...depot.file.keys()][0];

  const issue = await approuver(depot, cle);

  assert.equal(issue.statut, 409);
  assert.equal(issue.corps.motif, REFUS.APPROBATION_INOPERANTE);
  assert.equal(issue.corps.detail, 'approbation_pour_une_autre_publication');
  assert.equal(depot.ecritures.length, 0);
});

/* ═══════════════════════════════════════════════════════════════════════════
   6. LE REFUS EST CÔTÉ SERVEUR — un bouton caché n'est pas une serrure

   Ces tests montent le VRAI gestionnaire HTTP de `api/autopost.js`, avec ses
   dépendances injectées. Aucun réseau, aucune base.
   ═══════════════════════════════════════════════════════════════════════════ */

function repFactice() {
  const rep = { statut: null, corps: null, entetes: {} };
  rep.status = (c) => { rep.statut = c; return rep; };
  rep.json = (c) => { rep.corps = c; return rep; };
  rep.setHeader = (k, v) => { rep.entetes[k] = v; return rep; };
  rep.end = () => rep;
  return rep;
}

const SECRET_SESSION = 'secret-de-session-de-test-au-moins-32-caracteres';

async function jetonDe(role) {
  const avant = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = SECRET_SESSION;
  const { signerSession } = await import('../api/_lib/session.js');
  const jeton = signerSession({ id: `u-${role}`, role });
  if (avant === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = avant;
  return jeton;
}

/** Appelle la voie « approuver » avec les en-têtes fournis. */
async function appelerApprouver({ depot, entetes = {}, corps = {}, methode = 'POST' }) {
  const { creerGestionnaireAutopost } = await import('../api/autopost.js');
  const avantSecret = process.env.SESSION_SECRET;
  const avantCron = process.env.CRON_SECRET;
  process.env.SESSION_SECRET = SECRET_SESSION;
  process.env.CRON_SECRET = 'secret-de-tache-planifiee';

  const rep = repFactice();
  await creerGestionnaireAutopost({ depot, client: { disponible: false }, maintenant: () => new Date(INSTANT) })(
    { url: '/api/autopost-approuver', method: methode, headers: entetes, query: {}, body: corps },
    rep,
  );

  if (avantSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = avantSecret;
  if (avantCron === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = avantCron;
  return rep;
}

test('la voie « approuver » est atteinte par son chemin ET par son paramètre', async () => {
  const { voieAutopost } = await import('../api/autopost.js');
  assert.equal(voieAutopost({ url: '/api/autopost-approuver', query: {} }), 'approuver');
  assert.equal(voieAutopost({ url: '/api/autopost', query: { voie: 'approuver' } }), 'approuver');
});

test('un ADMINISTRATEUR connecté approuve — c est le seul chemin qui aboutit', async () => {
  const pub = manifeste();
  const depot = depotFactice({ lignes: [ligne(pub)] });
  const cle = [...depot.file.keys()][0];

  const rep = await appelerApprouver({
    depot,
    entetes: { authorization: `Bearer ${await jetonDe('admin')}` },
    corps: { cle_idempotence: cle, approuve: true },
  });

  assert.equal(rep.statut, 200, JSON.stringify(rep.corps));
  assert.equal(rep.corps.ok, true);
  assert.equal(depot.file.get(cle).approbation.approuve, true);
  assert.equal(depot.file.get(cle).approbation.approuve_par, 'u-admin');
});

test('⛔ un EMPLOYÉ connecté ne peut pas approuver — 403, et rien n est écrit', async () => {
  const pub = manifeste();
  const depot = depotFactice({ lignes: [ligne(pub)] });
  const cle = [...depot.file.keys()][0];

  const rep = await appelerApprouver({
    depot,
    entetes: { authorization: `Bearer ${await jetonDe('employe')}` },
    corps: { cle_idempotence: cle, approuve: true },
  });

  assert.equal(rep.statut, 403);
  assert.equal(depot.ecritures.length, 0);
  assert.equal(depot.file.get(cle).approbation, null);
});

test('⛔ sans session, aucune approbation — 401', async () => {
  const pub = manifeste();
  const depot = depotFactice({ lignes: [ligne(pub)] });
  const cle = [...depot.file.keys()][0];

  const rep = await appelerApprouver({
    depot, entetes: {}, corps: { cle_idempotence: cle, approuve: true },
  });

  assert.equal(rep.statut, 401);
  assert.equal(depot.ecritures.length, 0);
});

test('⛔⛔ LE SECRET DE LA TÂCHE PLANIFIÉE N APPROUVE PAS. La chaîne ne s approuve pas elle-même.', async () => {
  // C'est la différence de fond avec `tick` et `alimenter`, qui l'acceptent :
  // `CRON_SECRET` est présenté par une MACHINE, plusieurs fois par jour. S'il
  // ouvrait cette porte, tout le dispositif d'approbation serait décoratif —
  // exactement ce que le fichier séparé `APPROBATION.json` cherche à empêcher.
  const pub = manifeste();
  const depot = depotFactice({ lignes: [ligne(pub)] });
  const cle = [...depot.file.keys()][0];

  const rep = await appelerApprouver({
    depot,
    entetes: { authorization: 'Bearer secret-de-tache-planifiee' },
    corps: { cle_idempotence: cle, approuve: true },
  });

  assert.ok([401, 403].includes(rep.statut), `attendu 401/403, reçu ${rep.statut}`);
  assert.equal(depot.ecritures.length, 0, 'la tâche planifiée ne doit RIEN pouvoir approuver');
  assert.equal(depot.file.get(cle).approbation, null);
});

test('⛔ un rôle posé dans le CORPS de la requête ne donne aucun droit', async () => {
  const pub = manifeste();
  const depot = depotFactice({ lignes: [ligne(pub)] });
  const cle = [...depot.file.keys()][0];

  const rep = await appelerApprouver({
    depot,
    entetes: { authorization: `Bearer ${await jetonDe('employe')}` },
    corps: { cle_idempotence: cle, approuve: true, role: 'admin', user: { role: 'admin' } },
  });

  assert.equal(rep.statut, 403, 'le rôle se lit dans le jeton signé, jamais dans le corps');
  assert.equal(depot.ecritures.length, 0);
});

test('une lecture (GET) sur la voie « approuver » est refusée en 405', async () => {
  const depot = depotFactice({ lignes: [] });
  const rep = await appelerApprouver({
    depot, methode: 'GET', entetes: { authorization: `Bearer ${await jetonDe('admin')}` },
  });
  assert.equal(rep.statut, 405);
  assert.equal(rep.entetes.Allow, 'POST');
});

test('un corps sans « approuve » booléen est refusé en 400 : approuver et retirer ne se devinent pas', async () => {
  const pub = manifeste();
  const depot = depotFactice({ lignes: [ligne(pub)] });
  const cle = [...depot.file.keys()][0];

  const rep = await appelerApprouver({
    depot,
    entetes: { authorization: `Bearer ${await jetonDe('admin')}` },
    corps: { cle_idempotence: cle },
  });

  assert.equal(rep.statut, 400);
  assert.equal(depot.ecritures.length, 0);
});

/* ═══════════════════════════════════════════════════════════════════════════
   7. LE PLAFOND DES 12 FONCTIONS, ET LE ROUTAGE
   ═══════════════════════════════════════════════════════════════════════════ */

test('⛔ `api/` compte toujours 12 fonctions : une voie de plus, jamais un fichier de plus', async () => {
  const { readdirSync } = await import('node:fs');
  const dossier = fileURLToPath(new URL('../api', import.meta.url));
  const fonctions = readdirSync(dossier).filter((f) => f.endsWith('.js'));
  assert.equal(fonctions.length, 12,
    `le plan Hobby plafonne à 12 : ${fonctions.join(', ')}`);
});

test('vercel.json : /api/autopost-approuver est réécrit, AVANT l attrape-tout', () => {
  const conf = JSON.parse(readFileSync(fileURLToPath(new URL('../vercel.json', import.meta.url)), 'utf8'));
  const generique = conf.rewrites.findIndex((r) => r.source === '/api/(.*)');
  const i = conf.rewrites.findIndex((r) => r.source === '/api/autopost-approuver');
  assert.ok(i !== -1, 'la règle manque : le chemin tomberait dans l attrape-tout');
  assert.equal(conf.rewrites[i].destination, '/api/autopost?voie=approuver');
  assert.ok(i < generique, 'la première règle qui correspond gagne');
});

/* ═══════════════════════════════════════════════════════════════════════════
   8. L'APPROBATION SURVIT À LA RELECTURE DU DRIVE

   Sans cette règle, l'écran d'approbation ne tiendrait pas une heure : le
   passage relit le Drive AVANT de sélectionner, et ChatGPT n'y dépose jamais
   `APPROBATION.json` (il en a l'interdiction).
   ═══════════════════════════════════════════════════════════════════════════ */

test('⛔ approbationARetenir : un dépôt SANS approbation n efface pas celle de l application', () => {
  const donnee = { approuve: true, origine: ORIGINE_ECRAN };
  assert.deepEqual(approbationARetenir(null, donnee), donnee);
  assert.deepEqual(approbationARetenir(undefined, donnee), donnee);
});

test('approbationARetenir : une approbation DÉPOSÉE dans le Drive reste prioritaire', () => {
  const duDrive = { approuve: true, origine: 'depot_drive' };
  const delEcran = { approuve: true, origine: ORIGINE_ECRAN };
  assert.deepEqual(approbationARetenir(duDrive, delEcran), duDrive);
});

test('approbationARetenir : rien d autre n est conservé — pas de résurrection', () => {
  assert.equal(approbationARetenir(null, null), null);
  // Une approbation d'une autre origine, sur une ligne réécrite par le dépôt,
  // n'est pas conservée : seul ce que l'application a écrit l'est.
  assert.equal(approbationARetenir(null, { approuve: true, origine: 'inconnue' }), null);
});

/* ═══════════════════════════════════════════════════════════════════════════
   9. LES FABRIQUES, isolément
   ═══════════════════════════════════════════════════════════════════════════ */

test('construireApprobation rend un objet que verifierApprobation accepte', () => {
  const pub = manifeste();
  const a = construireApprobation({
    publication: pub, canal: 'facebook', approuvePar: 'u-admin', instant: INSTANT,
  });
  assert.equal(verifierApprobation({ publication: pub, approbation: a, canal: 'facebook' }).approuve, true);
});

test('construireRetrait rend un objet que verifierApprobation REFUSE', () => {
  const pub = manifeste();
  const r = construireRetrait({
    publication: pub, approbationActuelle: null, retirePar: 'u-admin', instant: INSTANT,
  });
  assert.equal(
    verifierApprobation({ publication: pub, approbation: r, canal: 'facebook' }).raison,
    'approbation_refusee',
  );
});
