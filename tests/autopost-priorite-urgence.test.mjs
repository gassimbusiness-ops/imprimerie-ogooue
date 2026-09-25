/**
 * Auto-poster — L'IMAGE DU JOUR PASSE EN PREMIER.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CE QUI S'EST PASSÉ LES 20/09 ET 21/09/2026 (audit 41, mesuré en base)
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   1. ChatGPT a réécrit les 47 manifestes le matin même : nouvelle version,
 *      nouvelle image, donc nouveau chemin d'objet → tout est à réhéberger ;
 *   2. le passage de 9 h 53 a consommé ses 25 s d'hébergement sur des images de
 *      semaines futures, parcourues dans l'ordre des dossiers du Drive ;
 *   3. l'image DU JOUR a été reportée → `url_media_absente` sur Facebook ET
 *      Instagram ;
 *   4. le passage de 18 h 18 ne pouvait plus rattraper : tolérance dépassée.
 *
 * Deux jours sans publication, sur les deux réseaux.
 *
 * ⛔ ZÉRO RÉSEAU, ZÉRO BASE. Le Drive, le stockage, Meta et la base sont des
 *    doublures en mémoire. Le `fetch` de Meta est injecté ; aucun test de ce
 *    fichier ne peut publier quoi que ce soit.
 *
 * Lancer :  node --test tests/autopost-priorite-urgence.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  alimenterFile, ETATS_MODIFIABLES, urgenceDuCreneau, RANGS_URGENCE, MOTIFS_REPORT,
  DUREE_MAX_FONCTION_MS, RESERVE_PUBLICATION_MS, BUDGET_HEBERGEMENT_MS,
  RESERVE_PUBLICATION_MINIMALE_MS, PLAFOND_URGENCE_MS, DUREE_PUBLICATION_MESUREE_MS,
  MARGE_TELEVERSEMENT_EN_COURS_MS, phraseDeclencheur,
} from '../api/_lib/autopost-alimentation.js';
import { executerPassage } from '../api/_lib/autopost-executeur.js';
import { depotSupabaseAutopost } from '../api/_lib/autopost-depot.js';
import { creerClientMeta } from '../api/_lib/autopost-meta.js';
import { cleIdempotence } from '../api/_lib/autopost-contrat.js';
import { cheminObjet } from '../api/_lib/autopost-medias.js';
import { instantUtcDepuisCreneau } from '../src/lib/dates.js';

const NUMERO_PAGE = '100000000000001';
const NUMERO_IG = '178000000000001';
const RACINE_BUCKET = 'https://exemple.supabase.co/storage/v1/object/public/publications';

/** Le passage du 20/09/2026 : 08:53:13Z, soit 9 h 53 à Moanda — mesuré. */
const PASSAGE_DU_20 = '2026-09-20T08:53:13Z';

const SECRET_SESSION = 'secret-de-session-de-test-au-moins-32-caracteres';

function muet() { /* les tests n'ont pas à parler */ }

/* ═══════════════════════════════════════════════════════════════════════════
   Le matériel
   ═══════════════════════════════════════════════════════════════════════════ */

function manifeste({ id, date, heure = '09:00', version = 1 }) {
  return {
    schema_version: '2.0',
    publication_id: id,
    campagne_id: 'CAMP-RENTREE-2026-09',
    version_contenu: version,
    semaine_iso: '2026-S38',
    annee_iso: 2026,
    numero_semaine_iso: 38,
    jour_iso: 7,
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
      role: 'principal',
      canal_cible: ['facebook', 'instagram'],
      chemin_relatif: `${id}_1080x1350.jpg`,
      sha256: 'a'.repeat(64),
      mime_type: 'image/jpeg',
      largeur_px: 1080,
      hauteur_px: 1350,
      ordre_carrousel: 1,
      origine: 'chatgpt',
    }],
    captions: {
      facebook: `Imprimerie Ogooué — ${id} · OG-${id}`,
      instagram: `Imprimerie Ogooué ✨ — ${id} · OG-${id}`,
    },
    cta: 'Envoyez la date, les quantités et votre logo',
    code_provenance: `OG-${id}`,
    offres: [{ offre_id: null, libelle: 'sans offre chiffrée', prix_affiche: false, valide_jusqu_au_local: null }],
    canaux: [
      { canal: 'facebook', compte_cible_id: 'PAGE_IMPRIMERIE', surface: 'feed' },
      { canal: 'instagram', compte_cible_id: 'IG_IMPRIMERIE', surface: 'feed' },
    ],
  };
}

/** Une publication telle que `drive.js` la rend. Le md5 est celui que Google mesure. */
function deposee(pub, md5) {
  return {
    dossier_id: `d-${pub.publication_id}`,
    dossier_nom: pub.publication_id,
    chemin: `WEEK/${pub.publication_id}`,
    publication: pub,
    approbation: null,
    medias: [{
      chemin_relatif: pub.medias[0].chemin_relatif,
      fichier_id: `f-${pub.publication_id}`,
      mime_type: 'image/jpeg',
      taille: 240_000,
      md5,
    }],
    captions: {
      facebook: { chemin_relatif: null, fichier_id: null, texte: pub.captions.facebook },
      instagram: { chemin_relatif: null, fichier_id: null, texte: pub.captions.instagram },
    },
    avertissements: [],
  };
}

function urlDe(pub, md5) {
  return `${RACINE_BUCKET}/${cheminObjet({
    publicationId: pub.publication_id,
    version: pub.version_contenu,
    empreinte: md5,
    nom: pub.medias[0].chemin_relatif,
  })}`;
}

/** Une ligne de file déjà en place : la version d'AVANT la réécriture, hébergée. */
function ligneEnFile(pub, canal, md5) {
  const compte = canal === 'facebook' ? 'PAGE_IMPRIMERIE' : 'IG_IMPRIMERIE';
  return {
    cle_idempotence: cleIdempotence(pub, { canal, compte_cible_id: compte }),
    publication_id: pub.publication_id,
    version_contenu: pub.version_contenu,
    canal,
    compte_cible_id: compte,
    surface: 'feed',
    instant_utc: pub.creneau.instant_utc,
    date_locale: pub.creneau.date_locale,
    tolerance_minutes: 90,
    etat: 'scheduled',
    tentatives: 0,
    tentatives_max: 3,
    id_distant: null,
    id_conteneur: null,
    legende: pub.captions[canal],
    url_media: urlDe(pub, md5),
    publication: pub,
    approbation: null,
    resultat: null,
    derniere_erreur: null,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Les doublures — une seule horloge pour tout le passage
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * L'horloge du passage, en millisecondes écoulées depuis son début. Chaque
 * doublure l'avance du temps que son geste coûte en vrai : on mesure ainsi la
 * durée de la FONCTION entière, alimentation ET publication, sans dormir.
 */
function horlogeDuPassage() {
  let t = 0;
  return {
    lire: () => t,
    avancer: (ms) => { t += ms; },
  };
}

/** Client Drive : le listing coûte `listingMs`, les légendes sont en ligne. */
function driveFactice({ publications, horloge, listingMs = 6_000 }) {
  return {
    async lirePublications() {
      horloge.avancer(listingMs);
      return { diagnostic: 'ok', message: 'lu', piste: null, detail: null, publications, ecartees: [] };
    },
    async telechargerFichier(id) { throw new Error(`aucun fichier attendu : ${id}`); },
  };
}

/**
 * Hébergeur : chaque téléversement coûte `televersementMs`. Il rend l'adresse
 * que le VRAI module calculerait (même `cheminObjet`) — une doublure qui
 * inventerait son chemin mentirait sur la décision « l'objet est-il le bon ? ».
 */
function hebergeurFactice({ horloge, televersementMs = 2_000 }) {
  const appels = [];
  const engages = [];
  return {
    appels,
    engages,
    async heberger({ depose, canal }) {
      const pub = depose.publication;
      appels.push(`${pub.publication_id}|${canal}`);
      engages.push(horloge.lire());
      horloge.avancer(televersementMs);
      const chemin = cheminObjet({
        publicationId: pub.publication_id,
        version: pub.version_contenu,
        empreinte: depose.medias[0].md5,
        nom: pub.medias[0].chemin_relatif,
      });
      return {
        url: `${RACINE_BUCKET}/${chemin}`, chemin, deja_present: false, televerse: true,
        motif: null, detail: null, piste: null,
      };
    },
  };
}

/**
 * La base, en mémoire, avec les deux ports : celui de l'alimentation et celui
 * de l'exécuteur. Les écritures conditionnelles le sont comme dans
 * `autopost-depot.js` : un UPDATE ne mord que sur une ligne modifiable et sans
 * témoin, la prise n'a lieu que depuis `scheduled`.
 */
function baseEnMemoire(lignes, { plafond = 8 } = {}) {
  const file = new Map(lignes.map((l) => [l.cle_idempotence, { ...l }]));
  const journal = [];
  const copie = (l) => JSON.parse(JSON.stringify(l));
  return {
    file,
    journal,
    async lireReglages() {
      return { actif: true, mode: 'live', plafond, approbation_automatique: true, reglage_approbation: 'en_base' };
    },
    async lireArretGlobal() { return this.lireReglages(); },
    async lireFile({ limite = 50 } = {}) {
      return [...file.values()]
        .filter((l) => l.etat === 'scheduled')
        .sort((a, b) => String(a.instant_utc).localeCompare(String(b.instant_utc)))
        .slice(0, limite)
        .map(copie);
    },
    async lireAReconcilier() { return []; },
    async compterPubliesLe(d) {
      return [...file.values()].filter((l) => l.etat === 'published' && l.date_locale === d).length;
    },
    async lireLignesDePublications(ids) {
      return [...file.values()].filter((l) => ids.includes(l.publication_id)).map(copie);
    },
    async inserer(ligne) {
      if (file.has(ligne.cle_idempotence)) return { insere: false, conflit: true };
      file.set(ligne.cle_idempotence, copie({ tentatives_max: 3, resultat: null, ...ligne }));
      return { insere: true, conflit: false };
    },
    async mettreAJourDepuisDepot(cle, champs) {
      const l = file.get(cle);
      if (!l || l.id_distant || !ETATS_MODIFIABLES.includes(l.etat)) return false;
      Object.assign(l, copie(champs));
      return true;
    },
    async annulerLigne(cle, details) {
      const l = file.get(cle);
      if (!l || l.id_distant || !ETATS_MODIFIABLES.includes(l.etat)) return false;
      l.etat = 'cancelled';
      l.derniere_erreur = details;
      return true;
    },
    async expirer(cle, details) {
      const l = file.get(cle);
      if (!l || l.id_distant || l.etat !== 'scheduled') return false;
      l.etat = 'expired';
      l.derniere_erreur = details;
      return true;
    },
    async prendre(cle) {
      const l = file.get(cle);
      if (!l || l.etat !== 'scheduled') return false;
      l.etat = 'executing';
      return true;
    },
    async relacher(cle, { etat, tentatives, erreur }) {
      Object.assign(file.get(cle), { etat, tentatives, derniere_erreur: erreur ?? null });
    },
    async noterConteneur(cle, id) { file.get(cle).id_conteneur = id; },
    async enregistrerPublication(cle, resultat) {
      Object.assign(file.get(cle), {
        etat: 'published', id_distant: resultat.id_distant, id_conteneur: resultat.id_conteneur ?? null, resultat,
      });
    },
    async journaliser(e) { journal.push(copie(e)); },
  };
}

/**
 * Meta, en doublure : un `fetch` qui répond selon l'adresse, et qui avance
 * l'horloge d'une seconde par appel. Aucun octet ne sort du processus.
 */
function metaFactice({ horloge, appelMs = 1_000, jetonConfigure = 'JETON-CONFIGURE' } = {}) {
  const appels = [];
  let n = 0;
  const ok = (corps) => ({ ok: true, status: 200, json: async () => corps });
  const fetchImpl = async (url, options = {}) => {
    horloge.avancer(appelMs);
    const u = new URL(url);
    const chemin = u.pathname.replace(/^\/v[\d.]+\//, '');
    const methode = options.method || 'GET';
    appels.push(`${methode} ${chemin}`);
    if (methode === 'GET' && chemin === NUMERO_PAGE && u.searchParams.get('fields') === 'access_token') {
      return ok({ id: NUMERO_PAGE, access_token: 'JETON-DE-PAGE-OBTENU' });
    }
    if (methode === 'POST' && chemin === `${NUMERO_PAGE}/photos`) {
      n += 1;
      return ok({ id: `photo-${n}`, post_id: `${NUMERO_PAGE}_${n}` });
    }
    if (methode === 'POST' && chemin === `${NUMERO_IG}/media`) { n += 1; return ok({ id: `conteneur-${n}` }); }
    if (methode === 'POST' && chemin === `${NUMERO_IG}/media_publish`) { n += 1; return ok({ id: `ig-${n}` }); }
    if (methode === 'GET' && chemin.startsWith('conteneur-')) return ok({ status_code: 'FINISHED' });
    if (methode === 'GET') return ok({ id: chemin, permalink_url: `https://exemple.invalid/${chemin}` });
    return { ok: false, status: 400, json: async () => ({ error: { message: `inattendu : ${methode} ${chemin}`, code: 100 } }) };
  };
  const client = creerClientMeta({
    jeton: jetonConfigure,
    fetchImpl,
    attendre: async (ms) => { horloge.avancer(ms); },
  });
  return { client, appels };
}

function repFactice() {
  const rep = { statut: null, corps: null, entetes: {} };
  rep.status = (c) => { rep.statut = c; return rep; };
  rep.json = (c) => { rep.corps = c; return rep; };
  rep.setHeader = (k, v) => { rep.entetes[k] = v; return rep; };
  rep.end = () => rep;
  return rep;
}

/** L'environnement d'un passage réel — posé, puis rendu tel qu'il était. */
async function avecEnvironnement(fn) {
  const noms = ['CRON_SECRET', 'AUTOPOST_MODE', 'META_PAGE_ID', 'META_INSTAGRAM_ID', 'AUTOPOST_CLE_APPROBATION',
    'SESSION_SECRET'];
  const avant = Object.fromEntries(noms.map((n) => [n, process.env[n]]));
  process.env.CRON_SECRET = 'secret-de-test';
  process.env.SESSION_SECRET = SECRET_SESSION;
  process.env.AUTOPOST_MODE = 'live';
  process.env.META_PAGE_ID = NUMERO_PAGE;
  process.env.META_INSTAGRAM_ID = NUMERO_IG;
  delete process.env.AUTOPOST_CLE_APPROBATION;
  try {
    return await fn();
  } finally {
    for (const n of noms) {
      if (avant[n] === undefined) delete process.env[n]; else process.env[n] = avant[n];
    }
  }
}

/**
 * Le passage complet, par le VRAI gestionnaire HTTP : alimentation réelle
 * (`alimenterFile`), sélection réelle, exécuteur réel, client Meta réel — seuls
 * le Drive, le stockage, la base et le `fetch` sont des doublures.
 */
async function passageComplet({ base, drive, hebergeur, meta, horloge, instant, requete = null }) {
  const { creerGestionnaireAutopost } = await import('../api/autopost.js');
  const gestionnaire = creerGestionnaireAutopost({
    depot: base,
    client: meta.client,
    maintenant: () => new Date(instant),
    alimente: (arg) => alimenterFile({
      ...arg, client: drive, medias: hebergeur, horloge: horloge.lire, tracer: muet,
    }),
  });
  const rep = repFactice();
  await gestionnaire(requete || {
    url: '/api/autopost-tick',
    method: 'GET',
    headers: { authorization: 'Bearer secret-de-test' },
    query: {},
  }, rep);
  return rep;
}

/**
 * Le Drive du 20/09 au matin : 47 publications réécrites en version 2, avec une
 * image neuve. Les dossiers sont rangés par NOM — l'ordre du Drive — et celui
 * du jour n'est pas en tête : c'est exactement ce qui l'a fait reporter.
 */
function driveDu20Septembre() {
  const pubs = [];
  for (let i = 0; i < 46; i += 1) {
    const jour = 21 + Math.floor(i / 2);            // 21/09 → 13/10
    const mois = jour > 30 ? '10' : '09';
    const j = jour > 30 ? jour - 30 : jour;
    pubs.push({
      // Le motif du contrat : PUB-AAAA-Snn-J-nn. Une par jour de semaine, sept par semaine.
      id: `PUB-2026-S${39 + Math.floor(i / 7)}-${(i % 7) + 1}-01`,
      date: `2026-${mois}-${String(j).padStart(2, '0')}`,
      heure: i % 2 === 0 ? '09:00' : '15:00',
    });
  }
  const duJour = { id: 'PUB-2026-S38-7-01', date: '2026-09-20', heure: '09:00' };
  // Rangée en 31e position : 30 dossiers passent avant elle dans l'ordre du Drive.
  pubs.splice(30, 0, duJour);
  return { pubs, duJour };
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. LE REJEU DU 20/09 — le test qui échouait sur le code d'avant
   ═══════════════════════════════════════════════════════════════════════════ */

test('🔴🔴 REJEU DU 20/09 : 47 manifestes réécrits, 25 s de budget — l image du jour est hébergée ET publiée au même passage', async () => {
  await avecEnvironnement(async () => {
    const { pubs, duJour } = driveDu20Septembre();
    assert.equal(pubs.length, 47, 'le rejeu porte sur les 47 manifestes de l audit');

    // La file d'AVANT : version 1, image 'a…', déjà hébergée.
    const v1 = pubs.map((p) => manifeste({ ...p, version: 1 }));
    const base = baseEnMemoire(v1.flatMap((p) => [
      ligneEnFile(p, 'facebook', 'a'.repeat(32)),
      ligneEnFile(p, 'instagram', 'a'.repeat(32)),
    ]));

    // Le Drive du matin : version 2, image 'b…' — tout est à réhéberger.
    const horloge = horlogeDuPassage();
    const v2 = pubs.map((p) => manifeste({ ...p, version: 2 }));
    const drive = driveFactice({ publications: v2.map((p) => deposee(p, 'b'.repeat(32))), horloge });
    const hebergeur = hebergeurFactice({ horloge });
    const meta = metaFactice({ horloge });

    const rep = await passageComplet({ base, drive, hebergeur, meta, horloge, instant: PASSAGE_DU_20 });
    assert.equal(rep.statut, 200, JSON.stringify(rep.corps));

    const duJourV2 = v2.find((p) => p.publication_id === duJour.id);
    const lignesDuJour = [...base.file.values()]
      .filter((l) => l.publication_id === duJour.id && l.version_contenu === 2);
    assert.equal(lignesDuJour.length, 2, 'Facebook et Instagram du jour sont en file');

    for (const l of lignesDuJour) {
      assert.equal(l.url_media, urlDe(duJourV2, 'b'.repeat(32)),
        `${l.canal} : l image DU JOUR doit être hébergée à ce passage-ci — c est elle qui a manqué le 20/09`);
      assert.equal(l.etat, 'published',
        `${l.canal} : la publication du jour doit partir AU MÊME PASSAGE (état ${l.etat}, `
        + `erreur ${l.derniere_erreur?.code_erreur ?? 'aucune'})`);
      assert.ok(l.id_distant, `${l.canal} : le témoin de l effet doit être posé`);
    }
    assert.equal(rep.corps.bilan.publies, 2, 'deux publications ce matin-là, une par réseau');

    // Et le budget normal a bien été ÉPUISÉ : le rejeu n'est pas un cas facile.
    assert.ok(rep.corps.bilan.alimentation.medias.reportes > 0,
      'le budget doit mordre, sinon ce test ne rejoue pas le 20/09');
    assert.deepEqual(rep.corps.bilan.alimentation.medias.urgents_reportes, [],
      'aucune image urgente ne doit rester sans adresse');
    // L'image du jour est la PREMIÈRE demandée au stockage.
    assert.equal(hebergeur.appels[0], `${duJour.id}|facebook`);

    // La fonction entière — alimentation ET publication — tient dans sa minute.
    assert.ok(horloge.lire() <= DUREE_MAX_FONCTION_MS,
      `le passage a duré ${horloge.lire()} ms sur ${DUREE_MAX_FONCTION_MS}`);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. L'ORDRE — l'urgence du créneau, jamais le nom du dossier
   ═══════════════════════════════════════════════════════════════════════════ */

test('urgenceDuCreneau : dû ou dans les 24 h = urgent ; au-delà = à venir ; hors tolérance = révolu', () => {
  const maintenant = Date.parse(PASSAGE_DU_20);
  const rang = (date, heure) => urgenceDuCreneau(manifeste({ id: 'PUB-2026-S38-7-01', date, heure }), maintenant).rang;

  assert.equal(rang('2026-09-20', '09:00'), RANGS_URGENCE.URGENT, 'dû il y a 53 min, tolérance 90 : urgent');
  assert.equal(rang('2026-09-21', '09:00'), RANGS_URGENCE.URGENT, 'demain 9 h, dans 23 h 07 : urgent');
  assert.equal(rang('2026-09-21', '15:00'), RANGS_URGENCE.A_VENIR, 'dans 29 h : à venir');
  assert.equal(rang('2026-09-30', '09:00'), RANGS_URGENCE.A_VENIR, 'J+10 : à venir');
  assert.equal(rang('2026-09-20', '07:00'), RANGS_URGENCE.REVOLU, 'passé de 173 min, tolérance 90 : révolu');
  assert.equal(urgenceDuCreneau({ creneau: { instant_utc: 'pas une date' } }, maintenant).rang,
    RANGS_URGENCE.ILLISIBLE);
});

test('🔴 une image à J+10 ne passe JAMAIS avant l image du jour, quel que soit l ordre du Drive', async () => {
  const horloge = horlogeDuPassage();
  // L'ordre du Drive, volontairement le pire : du plus lointain au plus proche.
  const pubs = [
    manifeste({ id: 'PUB-2026-S40-3-01', date: '2026-09-30' }),                  // J+10
    manifeste({ id: 'PUB-2026-S38-6-01', date: '2026-09-19', heure: '09:00' }),  // révolu
    manifeste({ id: 'PUB-2026-S39-5-01', date: '2026-09-25' }),                  // J+5
    manifeste({ id: 'PUB-2026-S39-1-01', date: '2026-09-21' }),                  // demain
    manifeste({ id: 'PUB-2026-S38-7-01', date: '2026-09-20' }),                  // le jour
  ];
  const hebergeur = hebergeurFactice({ horloge });

  await alimenterFile({
    depot: baseEnMemoire([]),
    client: driveFactice({ publications: pubs.map((p) => deposee(p, 'b'.repeat(32))), horloge }),
    medias: hebergeur,
    horloge: horloge.lire,
    instant: PASSAGE_DU_20,
    tracer: muet,
  });

  assert.deepEqual(hebergeur.appels.map((a) => a.split('|')[0]), [
    'PUB-2026-S38-7-01', // le jour
    'PUB-2026-S39-1-01', // demain
    'PUB-2026-S39-5-01', // J+5
    'PUB-2026-S40-3-01', // J+10
    'PUB-2026-S38-6-01', // ce qui ne partira plus : en dernier
  ], 'l hébergement doit suivre l urgence du créneau, pas le nom des dossiers');
});

test('🔴 budget ordinaire ÉPUISÉ : les lignes des 24 h sont hébergées quand même, J+10 attend', async () => {
  const horloge = horlogeDuPassage();
  const pubs = [
    manifeste({ id: 'PUB-2026-S40-3-01', date: '2026-09-30' }),
    manifeste({ id: 'PUB-2026-S39-1-01', date: '2026-09-21' }),
    manifeste({ id: 'PUB-2026-S38-7-01', date: '2026-09-20' }),
  ];
  const base = baseEnMemoire([]);
  const hebergeur = hebergeurFactice({ horloge });

  const bilan = await alimenterFile({
    depot: base,
    client: driveFactice({ publications: pubs.map((p) => deposee(p, 'b'.repeat(32))), horloge, listingMs: 26_000 }),
    medias: hebergeur,
    horloge: horloge.lire,
    instant: PASSAGE_DU_20,
    tracer: muet,
  });

  // Le listing seul a mangé les 25 s : sans la règle d'urgence, RIEN n'était hébergé.
  assert.deepEqual(hebergeur.appels.map((a) => a.split('|')[0]), ['PUB-2026-S38-7-01', 'PUB-2026-S39-1-01']);
  assert.equal(bilan.medias.urgents_hors_budget, 2, 'le dépassement a servi, et il est compté');
  assert.equal(bilan.medias.motif_report, MOTIFS_REPORT.BUDGET_TEMPS, 'J+10, lui, est reporté');
  const j10 = [...base.file.values()].filter((l) => l.publication_id === 'PUB-2026-S40-3-01');
  assert.ok(j10.every((l) => l.url_media === null), 'J+10 entre en file sans adresse, et attend');
  assert.equal(j10.every((l) => l.derniere_erreur === null), true, 'un report n est pas une erreur');
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. LA MINUTE DE LA FONCTION — jamais dépassée
   ═══════════════════════════════════════════════════════════════════════════ */

test('⛔ les chiffres tiennent ensemble : plafond d urgence + réserve minimale = maxDuration de vercel.json', () => {
  const config = JSON.parse(readFileSync(fileURLToPath(new URL('../vercel.json', import.meta.url)), 'utf8'));
  assert.equal(config.functions['api/autopost.js'].maxDuration * 1000, DUREE_MAX_FONCTION_MS);

  assert.equal(RESERVE_PUBLICATION_MINIMALE_MS, DUREE_PUBLICATION_MESUREE_MS + MARGE_TELEVERSEMENT_EN_COURS_MS);
  assert.equal(PLAFOND_URGENCE_MS + RESERVE_PUBLICATION_MINIMALE_MS, DUREE_MAX_FONCTION_MS,
    'le plafond d engagement des urgences est ce qui reste une fois la publication servie');
  assert.ok(PLAFOND_URGENCE_MS >= BUDGET_HEBERGEMENT_MS, 'l urgence ne peut pas avoir MOINS que le budget ordinaire');
  assert.ok(RESERVE_PUBLICATION_MINIMALE_MS <= RESERVE_PUBLICATION_MS,
    'l urgence entame la réserve ordinaire, jamais au-delà de sa part mesurée');
});

test('⛔ 47 images à réhéberger, TOUTES dans les 24 h : aucun engagement après le plafond, la minute tient', async () => {
  await avecEnvironnement(async () => {
    // Le pire cas : ChatGPT réécrit 47 publications, une toutes les 30 min à
    // partir de 9 h aujourd'hui — toutes urgentes. Listing lent (20 s),
    // téléversements de 2,5 s, un appel Meta à 1 s, sondage Instagram à 3 s.
    const pubs = Array.from({ length: 47 }, (_, i) => {
      const minutes = 9 * 60 + i * 30;
      const jour = 20 + Math.floor(minutes / (24 * 60));
      const m = minutes % (24 * 60);
      return {
        id: `PUB-2026-S${39 + Math.floor(i / 7)}-${(i % 7) + 1}-01`,
        date: `2026-09-${jour}`,
        heure: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`,
      };
    }).filter((p) => Date.parse(`${p.date}T${p.heure}:00+01:00`) <= Date.parse(PASSAGE_DU_20) + 24 * 3600 * 1000);

    const v1 = pubs.map((p) => manifeste({ ...p, version: 1 }));
    const base = baseEnMemoire(v1.flatMap((p) => [
      ligneEnFile(p, 'facebook', 'a'.repeat(32)), ligneEnFile(p, 'instagram', 'a'.repeat(32)),
    ]));
    const horloge = horlogeDuPassage();
    const v2 = pubs.map((p) => manifeste({ ...p, version: 2 }));
    const hebergeur = hebergeurFactice({ horloge, televersementMs: 2_500 });

    const rep = await passageComplet({
      base,
      drive: driveFactice({ publications: v2.map((p) => deposee(p, 'b'.repeat(32))), horloge, listingMs: 20_000 }),
      hebergeur,
      meta: metaFactice({ horloge }),
      horloge,
      instant: PASSAGE_DU_20,
    });

    assert.equal(rep.statut, 200);
    assert.ok(pubs.length >= 40, `le cas doit être lourd : ${pubs.length} publications dans les 24 h`);
    for (const t of hebergeur.engages) {
      assert.ok(t < PLAFOND_URGENCE_MS, `téléversement engagé à ${t} ms, au-delà du plafond ${PLAFOND_URGENCE_MS}`);
    }
    const m = rep.corps.bilan.alimentation.medias;
    assert.ok(m.urgents_reportes.length > 0, 'des urgences restent pour le passage suivant — c est le prix de la minute');
    assert.equal(m.motif_report, MOTIFS_REPORT.PLAFOND_URGENCE);
    assert.ok(horloge.lire() <= DUREE_MAX_FONCTION_MS,
      `la fonction a duré ${horloge.lire()} ms : au-delà de ${DUREE_MAX_FONCTION_MS}, Vercel la tue`);

    // Les deux publications DUES (9 h et 9 h 30) sont hébergées en premier, et parties.
    const parties = [...base.file.values()].filter((l) => l.etat === 'published');
    assert.deepEqual(parties.map((l) => `${l.publication_id} ${l.canal}`).sort(), [
      `${pubs[0].id} facebook`, `${pubs[0].id} instagram`,
      `${pubs[1].id} facebook`, `${pubs[1].id} instagram`,
    ].sort());

    // ⚠️ Et le journal dit, en tête, qu'une urgence attend.
    const alimentation = base.journal.find((e) => e.evenement === 'alimentation');
    assert.match(alimentation.resume, /^⚠️ \d+ média\(s\) URGENT\(S\)/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. CE QUI NE PARTIRA PLUS NE RESTE PAS « PRÉVU »
   ═══════════════════════════════════════════════════════════════════════════ */

/** Une ligne telle que l'audit l'a trouvée : 20/09, jamais partie, toujours `scheduled`. */
function ligneOubliee(canal = 'facebook') {
  const pub = manifeste({ id: 'PUB-2026-S38-7-01', date: '2026-09-20', version: 2 });
  const l = ligneEnFile(pub, canal, 'b'.repeat(32));
  l.approbation = null;
  l.tentatives = 1;
  l.derniere_erreur = {
    code_erreur: 'url_media_absente',
    message_erreur: 'url_media absente : …',
    piste: null,
    a_utc: PASSAGE_DU_20,
  };
  return l;
}

const PASSAGE_DU_25 = '2026-09-25T08:53:13Z';

test('🔴 une ligne au créneau dépassé passe en « expired », avec son motif ET la cause du dernier essai', async () => {
  const base = baseEnMemoire([ligneOubliee('facebook'), ligneOubliee('instagram')]);
  const client = creerClientMeta({ jeton: '', fetchImpl: async () => { throw new Error('aucun appel attendu'); } });

  const bilan = await executerPassage({
    depot: base, client, instant: PASSAGE_DU_25, tracer: muet, options: { declencheur: { par: 'cron' } },
  });

  assert.equal(bilan.expirees.length, 2);
  for (const l of base.file.values()) {
    assert.equal(l.etat, 'expired', `${l.canal} doit être « Périmé », plus « Prévu »`);
    assert.equal(l.derniere_erreur.code_erreur, 'creneau_depasse');
    assert.match(l.derniere_erreur.message_erreur, /retard \d+ min > tolérance 90 min/);
    assert.equal(l.derniere_erreur.cause_precedente, 'url_media_absente',
      'la ligne du 20/09 doit continuer de dire POURQUOI elle n est pas partie');
    assert.match(l.derniere_erreur.message_erreur, /url_media_absente/);
    assert.equal(l.id_distant, null, 'rien n a été publié, et rien ne le prétend');
  }
  assert.equal(base.journal.filter((e) => e.evenement === 'expiration').length, 2);
  assert.match(base.journal.find((e) => e.evenement === 'passage').resume, /2 ligne\(s\) passée\(s\) en périmé/);

  // Le passage suivant ne les recompte plus : elles ont quitté la file.
  const suivant = await executerPassage({ depot: base, client, instant: '2026-09-25T17:18:00Z', tracer: muet });
  assert.equal(suivant.expirees.length, 0);
  assert.equal(suivant.ecartes.filter((e) => e.raison === 'hors_tolerance').length, 0);
});

test('⛔ l expiration ne touche NI une ligne encore dans sa tolérance, NI une remise WhatsApp, NI la chaîne à l arrêt', async () => {
  const dueMaintenant = ligneEnFile(manifeste({ id: 'PUB-2026-S39-5-01', date: '2026-09-25' }), 'facebook', 'b'.repeat(32));
  dueMaintenant.url_media = null; // ne partira pas ce passage-ci, mais peut encore partir au suivant
  const whatsapp = {
    ...ligneOubliee('facebook'),
    cle_idempotence: 'PUB-2026-S38-7-01|v2|whatsapp_handoff|WA_IMPRIMERIE|2026-09-20T08:00:00Z',
    canal: 'whatsapp_handoff',
    compte_cible_id: 'WA_IMPRIMERIE',
    derniere_erreur: null,
  };
  const base = baseEnMemoire([dueMaintenant, whatsapp]);
  const client = creerClientMeta({ jeton: '', fetchImpl: async () => { throw new Error('aucun appel attendu'); } });

  await executerPassage({ depot: base, client, instant: PASSAGE_DU_25, tracer: muet });

  assert.equal(base.file.get(whatsapp.cle_idempotence).etat, 'scheduled',
    'une remise à un humain n est pas « périmée » : personne ne sait si le relais a été fait');
  assert.notEqual(base.file.get(dueMaintenant.cle_idempotence).etat, 'expired',
    'dans sa tolérance, une ligne peut encore partir');

  // Chaîne à l'arrêt : on ne touche à rien, pas même pour ranger.
  const aLArret = baseEnMemoire([ligneOubliee('facebook')]);
  aLArret.lireArretGlobal = async () => ({ actif: false, mode: 'live', plafond: 8 });
  await executerPassage({ depot: aLArret, client, instant: PASSAGE_DU_25, tracer: muet });
  assert.equal([...aLArret.file.values()][0].etat, 'scheduled');
});

test('⛔ l adaptateur Supabase expire par un UPDATE CONDITIONNEL : scheduled ET sans témoin', async () => {
  const requetes = [];
  const supabase = {
    from(table) {
      const req = { table, donnees: null, filtres: [] };
      requetes.push(req);
      const chaine = {
        update(d) { req.donnees = d; return chaine; },
        eq(c, v) { req.filtres.push(['eq', c, v]); return chaine; },
        is(c, v) { req.filtres.push(['is', c, v]); return chaine; },
        select() { return chaine; },
        then(ok, ko) { return Promise.resolve({ data: [{ cle_idempotence: 'k' }], error: null }).then(ok, ko); },
      };
      return chaine;
    },
  };

  const fait = await depotSupabaseAutopost(supabase).expirer('k', { code_erreur: 'creneau_depasse' });

  assert.equal(fait, true);
  const [req] = requetes;
  assert.equal(req.table, 'autopost_file');
  assert.equal(req.donnees.etat, 'expired', 'un état prévu par la contrainte de la migration 008');
  assert.deepEqual(req.donnees.derniere_erreur, { code_erreur: 'creneau_depasse' });
  assert.deepEqual(req.filtres, [
    ['eq', 'cle_idempotence', 'k'],
    ['eq', 'etat', 'scheduled'],
    ['is', 'id_distant', null],
  ], 'sans ces conditions, une ligne prise ou partie entre-temps serait écrasée');
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. LE JOURNAL DIT QUI A DÉCLENCHÉ, ET D'OÙ VENAIT LE JETON DE PAGE
   ═══════════════════════════════════════════════════════════════════════════ */

test('🔴 le journal d un passage porte son déclencheur : la tâche planifiée', async () => {
  await avecEnvironnement(async () => {
    const horloge = horlogeDuPassage();
    const pub = manifeste({ id: 'PUB-2026-S38-7-01', date: '2026-09-20' });
    const base = baseEnMemoire([]);

    const rep = await passageComplet({
      base,
      drive: driveFactice({ publications: [deposee(pub, 'b'.repeat(32))], horloge }),
      hebergeur: hebergeurFactice({ horloge }),
      meta: metaFactice({ horloge }),
      horloge,
      instant: PASSAGE_DU_20,
    });

    assert.equal(rep.corps.declenche_par, 'cron');
    const passage = base.journal.find((e) => e.evenement === 'passage');
    assert.deepEqual(passage.bilan.declencheur, { par: 'cron' });
    assert.match(passage.resume, /déclenché par la tâche planifiée/,
      'l écran n affiche que la phrase : elle doit porter le déclencheur');
    const alimentation = base.journal.find((e) => e.evenement === 'alimentation');
    assert.match(alimentation.resume, /déclenché par la tâche planifiée/);
  });
});

test('🔴 le journal d un passage porte son déclencheur : un administrateur, NOMMÉ par sa session signée', async () => {
  await avecEnvironnement(async () => {
    const { signerSession } = await import('../api/_lib/session.js');
    const jeton = signerSession({ id: 'u-admin-gassim', role: 'admin' });
    const horloge = horlogeDuPassage();
    const base = baseEnMemoire([]);

    const rep = await passageComplet({
      base,
      drive: driveFactice({ publications: [], horloge }),
      hebergeur: hebergeurFactice({ horloge }),
      meta: metaFactice({ horloge }),
      horloge,
      instant: PASSAGE_DU_20,
      requete: {
        url: '/api/autopost-tick',
        method: 'POST',
        // ⛔ Un corps qui prétend autre chose n'y change rien : c'est la session qui fait foi.
        headers: { authorization: `Bearer ${jeton}` },
        body: { declencheur: { par: 'cron' } },
        query: {},
      },
    });

    assert.equal(rep.statut, 200, JSON.stringify(rep.corps));
    assert.equal(rep.corps.declenche_par, 'admin');
    const passage = base.journal.find((e) => e.evenement === 'passage');
    assert.deepEqual(passage.bilan.declencheur, { par: 'admin', utilisateur_id: 'u-admin-gassim' });
    assert.match(passage.resume, /déclenché par un administrateur \(u-admin-gassim\)/);
  });
});

test('phraseDeclencheur : deux déclencheurs, et un aveu quand on ne sait pas', () => {
  assert.equal(phraseDeclencheur({ par: 'cron' }), 'déclenché par la tâche planifiée');
  assert.equal(phraseDeclencheur({ par: 'admin', utilisateur_id: 'u-1' }), 'déclenché par un administrateur (u-1)');
  assert.equal(phraseDeclencheur(null), 'déclencheur non précisé');
});

test('🔴 Facebook : le journal dit si le jeton de Page a été ÉCHANGÉ — sans jamais écrire le jeton', async () => {
  await avecEnvironnement(async () => {
    const horloge = horlogeDuPassage();
    const pub = manifeste({ id: 'PUB-2026-S38-7-01', date: '2026-09-20' });
    const base = baseEnMemoire([]);
    const meta = metaFactice({ horloge }); // Meta rend un jeton de Page DIFFÉRENT du configuré

    await passageComplet({
      base,
      drive: driveFactice({ publications: [deposee(pub, 'b'.repeat(32))], horloge }),
      hebergeur: hebergeurFactice({ horloge }),
      meta,
      horloge,
      instant: PASSAGE_DU_20,
    });

    const fb = base.journal.find((e) => e.evenement === 'publication' && e.canal === 'facebook');
    const ig = base.journal.find((e) => e.evenement === 'publication' && e.canal === 'instagram');
    assert.match(fb.resume, /jeton de Page obtenu par échange/);
    assert.doesNotMatch(ig.resume, /jeton de Page/, 'Instagram n échange rien : il ne dit rien');
    const ligneFb = [...base.file.values()].find((l) => l.canal === 'facebook');
    assert.equal(ligneFb.resultat.jeton_page, 'echange');

    // ⛔ Aucun jeton, configuré ou obtenu, nulle part dans ce qui est écrit.
    const tout = JSON.stringify({ journal: base.journal, file: [...base.file.values()] });
    assert.ok(!tout.includes('JETON-DE-PAGE-OBTENU'), 'le jeton de Page a fuité dans le journal ou la file');
    assert.ok(!tout.includes('JETON-CONFIGURE'), 'le jeton configuré a fuité dans le journal ou la file');
  });
});

test('Facebook : le journal dit aussi quand le jeton configuré ÉTAIT déjà un jeton de Page', async () => {
  await avecEnvironnement(async () => {
    const horloge = horlogeDuPassage();
    const pub = manifeste({ id: 'PUB-2026-S38-7-01', date: '2026-09-20' });
    const base = baseEnMemoire([]);
    // Meta rend EXACTEMENT le jeton configuré : c'était déjà celui de la Page.
    const meta = metaFactice({ horloge, jetonConfigure: 'JETON-DE-PAGE-OBTENU' });

    await passageComplet({
      base,
      drive: driveFactice({ publications: [deposee(pub, 'b'.repeat(32))], horloge }),
      hebergeur: hebergeurFactice({ horloge }),
      meta,
      horloge,
      instant: PASSAGE_DU_20,
    });

    const fb = base.journal.find((e) => e.evenement === 'publication' && e.canal === 'facebook');
    assert.match(fb.resume, /le jeton configuré était déjà un jeton de Page/);
    assert.ok(!JSON.stringify(base.journal).includes('JETON-DE-PAGE-OBTENU'));
  });
});
