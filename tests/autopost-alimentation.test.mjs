/**
 * Auto-poster — L'ALIMENTATION DE LA FILE : le dernier maillon.
 *
 * ── Ce que ce maillon fait ────────────────────────────────────────────────
 *
 * ChatGPT dépose dans le Drive. `api/_lib/drive.js` sait lire ce dépôt. La file
 * `autopost_file` sait porter un travail. Entre les deux, jusqu'au 18/09/2026,
 * il n'y avait RIEN : 14 publications attendaient dans le Drive et la file était
 * vide. `alimenterFile()` est ce chaînon, et rien d'autre — elle ne publie pas,
 * elle n'approuve pas, elle n'ouvre aucun verrou.
 *
 * ── Ce que ces tests protègent, et pourquoi chacun compte ─────────────────
 *
 *   1. ALIMENTER DEUX FOIS NE CRÉE QU'UNE LIGNE. Le passage tourne toutes les
 *      heures : c'est la propriété la plus sollicitée de tout le module.
 *      Et elle se fonde sur la PRÉSENCE DE LA LIGNE, jamais sur un drapeau
 *      « déjà traité » qu'on se serait posé à soi-même (leçon SingPay du 16/09).
 *   2. CE QUI EST PARTI NE REPART PAS. Une publication publiée, puis redéposée
 *      dans le Drive — même avec une nouvelle version — ne revient pas en file.
 *      C'est le risque le plus cher : un client de Moanda qui voit deux fois la
 *      même affiche.
 *   3. UN DÉPÔT NON CONFORME EST ÉCARTÉ AVEC SON MOTIF, jamais réparé.
 *   4. RIEN NE S'AUTO-APPROUVE. Sans `APPROBATION.json`, la ligne entre en file
 *      et n'est pas approuvée. Une ligne qui s'auto-approuverait serait le pire
 *      défaut possible de cette chaîne.
 *   5. L'ALIMENTATION MARCHE CHAÎNE À L'ARRÊT. Sinon on ne peut rien vérifier
 *      avant d'ouvrir les verrous — et on les ouvrirait à l'aveugle.
 *
 * ⛔ ZÉRO RÉSEAU, ZÉRO BASE : le client Drive et le dépôt sont des doublures en
 *    mémoire. Aucun test de ce fichier ne peut écrire chez Google ni chez
 *    Supabase.
 *
 * Lancer :  node --test tests/autopost-alimentation.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  alimenterFile,
  MOTIFS,
  ETATS_MODIFIABLES,
} from '../api/_lib/autopost-alimentation.js';
import { cleIdempotence, empreinteCanonique } from '../api/_lib/autopost-contrat.js';
import { instantUtcDepuisCreneau } from '../src/lib/dates.js';

const PAGE_ID = '100000000000001';
const IG_ID = '178000000000001';

/** Le passage qui alimente : 21/09/2026 à 07 h 00 locales, avant les créneaux. */
const INSTANT = '2026-09-21T06:00:00Z';

function muet() { /* les tests n'ont pas à parler */ }

/* ═══════════════════════════════════════════════════════════════════════════
   Le matériel : un manifeste conforme au contrat v2.0
   ═══════════════════════════════════════════════════════════════════════════ */

function manifeste({
  id = 'PUB-2026-S39-1-01',
  date = '2026-09-21',
  heure = '09:00',
  version = 1,
  canaux = [{ canal: 'facebook', compte_cible_id: PAGE_ID, surface: 'feed' }],
  captions = { facebook: { chemin_relatif: 'caption_facebook.txt', sha256: 'b'.repeat(64) } },
  offres = [{ offre_id: null, libelle: 'sans offre chiffrée', prix_affiche: false, valide_jusqu_au_local: null }],
} = {}) {
  return {
    schema_version: '2.0',
    publication_id: id,
    campagne_id: 'CAMP-RENTREE-2026-09',
    version_contenu: version,
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
    mode_execution: 'dry_run',
    medias: [{
      role: 'principal',
      canal_cible: ['facebook', 'instagram'],
      chemin_relatif: '2026-09-21_OGOOUE_Textile_1080x1350_v01_BROUILLON.jpg',
      sha256: 'a'.repeat(64),
      mime_type: 'image/jpeg',
      largeur_px: 1080,
      hauteur_px: 1350,
      ordre_carrousel: 1,
      origine: 'chatgpt',
    }],
    captions,
    cta: 'Envoyez la date, les quantités et votre logo',
    code_provenance: 'OG-01-S39',
    offres,
    canaux,
  };
}

function approbationDe(pub, canaux = ['facebook']) {
  return {
    publication_id: pub.publication_id,
    version_contenu: pub.version_contenu,
    approuve: true,
    approuve_par: 'compte-applicatif-gassim',
    canaux_approuves: canaux,
    creneau_approuve: {
      date_locale: pub.creneau.date_locale,
      heure_locale: pub.creneau.heure_locale,
      fuseau: 'Africa/Libreville',
      instant_utc: pub.creneau.instant_utc,
    },
    payload_sha256: empreinteCanonique(pub),
  };
}

/**
 * Une publication telle que `drive.js` la rend : le manifeste, l'approbation
 * (ou `null`), les médias résolus, et les fichiers de légende repérés.
 */
function deposee(pub, {
  approbation = null,
  captions = { facebook: { chemin_relatif: 'caption_facebook.txt', fichier_id: 'cap-fb' } },
  dossier = 'p1',
} = {}) {
  return {
    dossier_id: dossier,
    dossier_nom: '1_POST_09H00',
    chemin: 'WEEK_21-27Sept/Lundi_21_Sept/1_POST_09H00',
    publication: pub,
    approbation,
    medias: [{
      chemin_relatif: pub.medias[0].chemin_relatif,
      fichier_id: 'f-media',
      mime_type: 'image/jpeg',
      taille: 240_000,
      md5: 'd'.repeat(32),
    }],
    captions,
    avertissements: [],
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Les doublures
   ═══════════════════════════════════════════════════════════════════════════ */

/** Client Drive de test. Ne sort jamais du processus. */
function clientFactice({
  publications = [],
  diagnostic = 'ok',
  message = 'lu',
  ecartees = [],
  fichiers = { 'cap-fb': 'Flocage textile à Moanda. 📞 060 44 46 34 — OG-01-S39' },
  jeteSurLecture = null,
} = {}) {
  const appels = [];
  return {
    appels,
    async lirePublications() {
      appels.push('lirePublications');
      if (jeteSurLecture) throw jeteSurLecture;
      return { diagnostic, message, piste: null, detail: null, publications, ecartees };
    },
    async telechargerFichier(id) {
      appels.push(`telecharger:${id}`);
      if (!(id in fichiers)) {
        const e = new Error('File not found');
        e.diagnostic = 'dossier_inaccessible';
        throw e;
      }
      return fichiers[id];
    },
  };
}

/**
 * Dépôt en mémoire. Il reproduit les deux garanties de la vraie base :
 *   - l'insertion d'une clé déjà présente ÉCHOUE (l'index unique de la 008) ;
 *   - la mise à jour et l'annulation sont CONDITIONNELLES à l'état et à
 *     l'absence de témoin, comme l'UPDATE conditionnel de `autopost-depot.js`.
 */
function depotFactice({ lignes = [], actif = false, mode = 'dry_run' } = {}) {
  const file = new Map(lignes.map((l) => [l.cle_idempotence, { ...l }]));
  const journal = [];
  const appels = [];
  return {
    file,
    journal,
    appels,
    async lireArretGlobal() { appels.push('lireArretGlobal'); return { actif, mode, plafond: 4 }; },
    async lireLignesDePublications(ids) {
      appels.push(`lireLignesDePublications:${[...ids].join(',')}`);
      return [...file.values()]
        .filter((l) => ids.includes(l.publication_id))
        .map((l) => ({ ...l }));
    },
    async inserer(ligne) {
      appels.push(`inserer:${ligne.cle_idempotence}`);
      if (file.has(ligne.cle_idempotence)) return { insere: false, conflit: true };
      file.set(ligne.cle_idempotence, { ...ligne });
      return { insere: true, conflit: false };
    },
    async mettreAJourDepuisDepot(cle, champs) {
      appels.push(`mettreAJour:${cle}`);
      const l = file.get(cle);
      if (!l || l.id_distant || !ETATS_MODIFIABLES.includes(l.etat)) return false;
      Object.assign(l, champs);
      return true;
    },
    async annulerLigne(cle, details) {
      appels.push(`annuler:${cle}`);
      const l = file.get(cle);
      if (!l || l.id_distant || !ETATS_MODIFIABLES.includes(l.etat)) return false;
      l.etat = 'cancelled';
      l.derniere_erreur = details;
      return true;
    },
    async journaliser(e) { journal.push(e); },
  };
}

/** Racine du bucket public tel que Supabase le sert. */
const RACINE_BUCKET = 'https://exemple.supabase.co/storage/v1/object/public/publications';

/**
 * Hébergeur de médias de test.
 *
 * ⛔ Il ne parle ni à Google ni à Supabase : ce fichier teste le CÂBLAGE (ce
 *    que l'alimentation fait du résultat), pas l'hébergement lui-même — celui-là
 *    a son propre fichier, `tests/autopost-medias.test.mjs`.
 */
function hebergeurFactice({ resultat = null, dejaLa = false } = {}) {
  const appels = [];
  return {
    appels,
    async heberger({ depose, canal }) {
      const pub = depose?.publication;
      appels.push(`${pub?.publication_id}|${canal}`);
      if (resultat) return resultat;
      return {
        url: `${RACINE_BUCKET}/${pub.publication_id}/v${pub.version_contenu}/objet.jpg`,
        chemin: `${pub.publication_id}/v${pub.version_contenu}/objet.jpg`,
        deja_present: dejaLa,
        televerse: !dejaLa,
        motif: null,
        detail: null,
        piste: null,
      };
    },
  };
}

/** Raccourci : une ligne de file déjà en place, telle que l'alimentation l'écrit. */
function ligneExistante(pub, { canal = 'facebook', compte = PAGE_ID, ...sur } = {}) {
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
    id_conteneur: null,
    legende: 'Flocage textile à Moanda. 📞 060 44 46 34 — OG-01-S39',
    url_media: null,
    publication: pub,
    approbation: null,
    resultat: null,
    derniere_erreur: null,
    ...sur,
  };
}

const passage = (depot, client, medias = null) => alimenterFile({
  depot, client, medias, instant: INSTANT, tracer: muet,
});

/* ═══════════════════════════════════════════════════════════════════════════
   1. LE CAS NOMINAL — le maillon qui manquait
   ═══════════════════════════════════════════════════════════════════════════ */

test('une publication conforme du Drive devient une ligne de file', async () => {
  const pub = manifeste();
  const depot = depotFactice();
  const client = clientFactice({ publications: [deposee(pub)] });

  const bilan = await passage(depot, client);

  assert.equal(bilan.creees, 1, `attendu 1 création : ${JSON.stringify(bilan.ecartees)}`);
  assert.equal(depot.file.size, 1);
  const ligne = [...depot.file.values()][0];
  assert.equal(ligne.cle_idempotence, cleIdempotence(pub, { canal: 'facebook', compte_cible_id: PAGE_ID }));
  assert.equal(ligne.publication_id, 'PUB-2026-S39-1-01');
  assert.equal(ligne.canal, 'facebook');
  assert.equal(ligne.compte_cible_id, PAGE_ID);
  assert.equal(ligne.surface, 'feed');
  assert.equal(ligne.etat, 'scheduled');
  assert.equal(ligne.instant_utc, '2026-09-21T08:00:00Z');
  // ⛔ La date MÉTIER du créneau (Moanda), pas la date du serveur Vercel.
  assert.equal(ligne.date_locale, '2026-09-21');
  assert.deepEqual(ligne.publication, pub, 'le manifeste est rangé tel quel, jamais réécrit');
});

test('un manifeste à deux canaux produit DEUX lignes, une par canal', async () => {
  const pub = manifeste({
    canaux: [
      { canal: 'facebook', compte_cible_id: PAGE_ID, surface: 'feed' },
      { canal: 'instagram', compte_cible_id: IG_ID, surface: 'feed' },
    ],
    captions: {
      facebook: { chemin_relatif: 'caption_facebook.txt' },
      instagram: { chemin_relatif: 'caption_instagram.txt' },
    },
  });
  const depot = depotFactice();
  const client = clientFactice({
    publications: [deposee(pub, {
      captions: {
        facebook: { chemin_relatif: 'caption_facebook.txt', fichier_id: 'cap-fb' },
        instagram: { chemin_relatif: 'caption_instagram.txt', fichier_id: 'cap-ig' },
      },
    })],
    fichiers: { 'cap-fb': 'légende facebook', 'cap-ig': 'légende instagram' },
  });

  const bilan = await passage(depot, client);

  assert.equal(bilan.creees, 2, JSON.stringify(bilan.ecartees));
  const canaux = [...depot.file.values()].map((l) => l.canal).sort();
  assert.deepEqual(canaux, ['facebook', 'instagram']);
  const ig = [...depot.file.values()].find((l) => l.canal === 'instagram');
  assert.equal(ig.compte_cible_id, IG_ID, 'chaque canal porte SON compte cible');
  assert.equal(ig.legende, 'légende instagram', 'chaque canal porte SA légende');
});

test('la légende est lue depuis le fichier du Drive, pas inventée', async () => {
  const pub = manifeste();
  const depot = depotFactice();
  const client = clientFactice({
    publications: [deposee(pub)],
    fichiers: { 'cap-fb': 'Flocage textile à Moanda.\n\n#Moanda #Gabon' },
  });

  await passage(depot, client);

  assert.equal([...depot.file.values()][0].legende, 'Flocage textile à Moanda.\n\n#Moanda #Gabon');
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. L'IDEMPOTENCE — la propriété la plus sollicitée du module
   ═══════════════════════════════════════════════════════════════════════════ */

test('⛔ alimenter DEUX FOIS ne crée qu UNE ligne', async () => {
  const pub = manifeste();
  const depot = depotFactice();
  const client = clientFactice({ publications: [deposee(pub)] });

  const premier = await passage(depot, client);
  const second = await passage(depot, client);

  assert.equal(premier.creees, 1);
  assert.equal(second.creees, 0, 'le second passage ne doit RIEN créer');
  assert.equal(depot.file.size, 1, 'une seule ligne pour une seule publication');
  assert.equal(second.inchangees, 1);
});

test('⛔ alimenter DIX FOIS ne crée toujours qu UNE ligne', async () => {
  const pub = manifeste();
  const depot = depotFactice();
  const client = clientFactice({ publications: [deposee(pub)] });

  for (let i = 0; i < 10; i += 1) await passage(depot, client);

  assert.equal(depot.file.size, 1);
});

test('⛔ l idempotence se fonde sur la PRÉSENCE DE LA LIGNE, pas sur un état intermédiaire', async () => {
  // Leçon SingPay du 16/09 : l'idempotence portait sur un état qu'un autre
  // chemin pouvait poser, et deux chemins ont écrit deux fois. Ici, quel que
  // soit l'état de la ligne — y compris `failed`, y compris `executing` —,
  // la ligne EXISTE, donc on n'en crée pas une seconde.
  const pub = manifeste();
  for (const etat of ['draft', 'scheduled', 'executing', 'failed', 'expired', 'suspended', 'reconciling']) {
    const depot = depotFactice({ lignes: [ligneExistante(pub, { etat })] });
    const client = clientFactice({ publications: [deposee(pub)] });
    const bilan = await passage(depot, client);
    assert.equal(bilan.creees, 0, `état ${etat} : aucune ligne ne doit être créée`);
    assert.equal(depot.file.size, 1, `état ${etat} : la file a doublé`);
  }
});

test('⛔ une insertion refusée par l index unique (course entre deux passages) n est pas une erreur', async () => {
  // Deux passages simultanés lisent tous les deux « la ligne n'existe pas »,
  // puis insèrent. PostgreSQL en refuse une. Ce refus est le filet, et le
  // deuxième passage doit le vivre comme « rien à faire », pas comme une panne.
  const pub = manifeste();
  const depot = depotFactice();
  const client = clientFactice({ publications: [deposee(pub)] });
  const cle = cleIdempotence(pub, { canal: 'facebook', compte_cible_id: PAGE_ID });

  // Le dépôt ment sur la lecture (file vide) mais dit vrai sur l'insertion.
  depot.file.set(cle, ligneExistante(pub));
  const lectureAveugle = { ...depot, async lireLignesDePublications() { return []; } };

  const bilan = await alimenterFile({ depot: lectureAveugle, client, instant: INSTANT, tracer: muet });

  assert.equal(bilan.creees, 0);
  assert.equal(bilan.conflits, 1, 'le conflit d index est compté, pas jeté');
  assert.equal(depot.file.size, 1);
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. CE QUI EST PARTI NE REPART PAS — le risque le plus cher
   ═══════════════════════════════════════════════════════════════════════════ */

test('⛔ une publication DÉJÀ PARTIE, redéposée telle quelle, ne revient pas en file', async () => {
  const pub = manifeste();
  const depot = depotFactice({
    lignes: [ligneExistante(pub, { etat: 'published', id_distant: '100_777' })],
  });
  const client = clientFactice({ publications: [deposee(pub)] });

  const bilan = await passage(depot, client);

  assert.equal(bilan.creees, 0);
  assert.equal(depot.file.size, 1);
  assert.equal(bilan.ecartees[0].motif, MOTIFS.DEJA_PARTI);
});

test('⛔ une publication déjà partie, redéposée avec une NOUVELLE VERSION, ne repart pas', async () => {
  // Le cas qui coûte cher : ChatGPT corrige et redépose une affiche déjà
  // publiée. La clé d'idempotence CHANGE (elle porte la version), donc l'index
  // unique ne protège plus rien. C'est au code de refuser.
  const v1 = manifeste({ version: 1 });
  const v2 = manifeste({ version: 2 });
  const depot = depotFactice({
    lignes: [ligneExistante(v1, { etat: 'published', id_distant: '100_777' })],
  });
  const client = clientFactice({ publications: [deposee(v2)] });

  const bilan = await passage(depot, client);

  assert.equal(bilan.creees, 0, 'un client de Moanda ne doit pas voir deux fois la même affiche');
  assert.equal(depot.file.size, 1);
  assert.equal(bilan.ecartees[0].motif, MOTIFS.DEJA_PARTI);
});

test('⛔ déjà partie sur Facebook n empêche PAS d entrer en file pour Instagram', async () => {
  // Le témoin vaut pour un couple (publication, canal) — pas pour la
  // publication entière. Refuser Instagram parce que Facebook est parti
  // supprimerait la moitié du plan sans que personne ne l'ait décidé.
  const pub = manifeste({
    canaux: [
      { canal: 'facebook', compte_cible_id: PAGE_ID, surface: 'feed' },
      { canal: 'instagram', compte_cible_id: IG_ID, surface: 'feed' },
    ],
    captions: {
      facebook: { chemin_relatif: 'caption_facebook.txt' },
      instagram: { chemin_relatif: 'caption_instagram.txt' },
    },
  });
  const depot = depotFactice({
    lignes: [ligneExistante(pub, { etat: 'published', id_distant: '100_777' })],
  });
  const client = clientFactice({
    publications: [deposee(pub, {
      captions: {
        facebook: { chemin_relatif: 'caption_facebook.txt', fichier_id: 'cap-fb' },
        instagram: { chemin_relatif: 'caption_instagram.txt', fichier_id: 'cap-ig' },
      },
    })],
    fichiers: { 'cap-fb': 'fb', 'cap-ig': 'ig' },
  });

  const bilan = await passage(depot, client);

  assert.equal(bilan.creees, 1);
  assert.equal([...depot.file.values()].filter((l) => l.canal === 'instagram').length, 1);
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. UN DÉPÔT NON CONFORME EST ÉCARTÉ AVEC SON MOTIF
   ═══════════════════════════════════════════════════════════════════════════ */

test('⛔ un manifeste hors contrat est écarté AVEC le motif du contrat, et rien n entre en file', async () => {
  const pub = manifeste();
  pub.schema_version = '1.0';
  const depot = depotFactice();
  const client = clientFactice({ publications: [deposee(pub)] });

  const bilan = await passage(depot, client);

  assert.equal(depot.file.size, 0);
  assert.equal(bilan.ecartees.length, 1);
  assert.equal(bilan.ecartees[0].motif, MOTIFS.MANIFESTE_INVALIDE);
  assert.match(bilan.ecartees[0].detail, /schema_version attendu "2\.0"/,
    'le motif doit porter la phrase du contrat, pas un code interne');
});

test('⛔ un créneau incohérent est écarté — on ne publie jamais « au plus probable »', async () => {
  const pub = manifeste();
  pub.creneau.instant_utc = '2026-09-21T09:00:00Z'; // une heure de trop
  const depot = depotFactice();
  const client = clientFactice({ publications: [deposee(pub)] });

  const bilan = await passage(depot, client);

  assert.equal(depot.file.size, 0);
  assert.equal(bilan.ecartees[0].motif, MOTIFS.MANIFESTE_INVALIDE);
  assert.match(bilan.ecartees[0].detail, /ne correspond pas au recalcul/);
});

test('⛔ la validation est IMPORTÉE du contrat, jamais recopiée dans l alimentation', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../api/_lib/autopost-alimentation.js', import.meta.url)), 'utf8',
  );
  assert.match(source, /import \{[^}]*validerManifeste/s, 'validerManifeste doit être importé');
  // Une seconde liste de règles, c'est deux vérités : la copie dérive, et un
  // jour le poster publie ce que le contrat refuse.
  assert.equal(/pub\.schema_version\s*!==/.test(source), false,
    'la source réimplémente un contrôle de schéma au lieu d appeler validerManifeste');
  assert.equal(/RE_PUBLICATION_ID|PUB-\\d\{4\}/.test(source), false,
    'la source réimplémente le motif de publication_id');
});

test('une légende annoncée mais introuvable écarte le canal — elle ne part pas vide', async () => {
  const pub = manifeste();
  const depot = depotFactice();
  const client = clientFactice({
    publications: [deposee(pub, { captions: { facebook: { chemin_relatif: 'caption_facebook.txt', fichier_id: null } } })],
  });

  const bilan = await passage(depot, client);

  assert.equal(depot.file.size, 0);
  assert.equal(bilan.ecartees[0].motif, MOTIFS.LEGENDE_INTROUVABLE);
});

test('un canal sans aucune légende déclarée est écarté — publier un texte vide est pire que ne rien publier', async () => {
  const pub = manifeste({ captions: {} });
  const depot = depotFactice();
  const client = clientFactice({ publications: [deposee(pub, { captions: {} })] });

  const bilan = await passage(depot, client);

  assert.equal(depot.file.size, 0);
  assert.equal(bilan.ecartees[0].motif, MOTIFS.LEGENDE_ABSENTE);
});

test('deux canaux identiques dans un même manifeste : le second est écarté, il n écrase pas le premier', async () => {
  // La clé d'idempotence porte (publication, version, canal, compte, instant) —
  // PAS la surface. Deux entrées `facebook/feed` et `facebook/story` sur le
  // même compte produisent donc la même clé. Sans ce contrôle, la seconde
  // écraserait silencieusement la première.
  const pub = manifeste({
    canaux: [
      { canal: 'facebook', compte_cible_id: PAGE_ID, surface: 'feed' },
      { canal: 'facebook', compte_cible_id: PAGE_ID, surface: 'story' },
    ],
  });
  const depot = depotFactice();
  const client = clientFactice({ publications: [deposee(pub)] });

  const bilan = await passage(depot, client);

  assert.equal(bilan.creees, 1);
  assert.equal(depot.file.size, 1);
  assert.equal([...depot.file.values()][0].surface, 'feed', 'la première entrée gagne');
  assert.equal(bilan.ecartees[0].motif, MOTIFS.CLE_EN_DOUBLE);
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. RIEN NE S'AUTO-APPROUVE
   ═══════════════════════════════════════════════════════════════════════════ */

test('⛔ sans APPROBATION.json, la ligne entre en file et n est PAS approuvée', async () => {
  const pub = manifeste();
  const depot = depotFactice();
  const client = clientFactice({ publications: [deposee(pub, { approbation: null })] });

  await passage(depot, client);

  const ligne = [...depot.file.values()][0];
  assert.equal(ligne.etat, 'scheduled', 'elle entre en file : le gérant doit la voir');
  assert.equal(ligne.approbation, null, 'et elle n est pas approuvée');
});

test('⛔ AUCUNE ligne écrite par l alimentation ne porte une approbation que le Drive n a pas déposée', async () => {
  const pubs = [
    manifeste({ id: 'PUB-2026-S39-1-01' }),
    manifeste({ id: 'PUB-2026-S39-2-01', date: '2026-09-22' }),
    manifeste({ id: 'PUB-2026-S39-3-01', date: '2026-09-23' }),
  ];
  const depot = depotFactice();
  const client = clientFactice({ publications: pubs.map((p) => deposee(p)) });

  await passage(depot, client);

  assert.equal(depot.file.size, 3);
  for (const l of depot.file.values()) {
    assert.notEqual(l.approbation?.approuve, true, `${l.publication_id} s est auto-approuvée`);
  }
});

test('une approbation DÉPOSÉE est reprise telle quelle — elle n est ni fabriquée ni jetée', async () => {
  const pub = manifeste();
  const appro = approbationDe(pub);
  const depot = depotFactice();
  const client = clientFactice({ publications: [deposee(pub, { approbation: appro })] });

  await passage(depot, client);

  assert.deepEqual([...depot.file.values()][0].approbation, appro);
});

test('🔴 une approbation déposée APRÈS coup rejoint la ligne déjà en file', async () => {
  // Sans ça, rien ne pourrait jamais être approuvé par le chemin du Drive : la
  // ligne resterait éternellement « non approuvée » alors que le fichier existe.
  const pub = manifeste();
  const depot = depotFactice({ lignes: [ligneExistante(pub, { approbation: null })] });
  const appro = approbationDe(pub);
  const client = clientFactice({ publications: [deposee(pub, { approbation: appro })] });

  const bilan = await passage(depot, client);

  assert.equal(bilan.creees, 0);
  assert.equal(bilan.mises_a_jour, 1);
  assert.deepEqual([...depot.file.values()][0].approbation, appro);
});

/* ═══════════════════════════════════════════════════════════════════════════
   6. UN DÉPÔT MODIFIÉ — la décision, écrite et testée
   ═══════════════════════════════════════════════════════════════════════════ */

test('un dépôt corrigé SANS changer de version met à jour la ligne encore en file', async () => {
  const pub = manifeste();
  const depot = depotFactice({ lignes: [ligneExistante(pub, { legende: 'ancienne légende' })] });
  const client = clientFactice({
    publications: [deposee(pub)],
    fichiers: { 'cap-fb': 'nouvelle légende corrigée' },
  });

  const bilan = await passage(depot, client);

  assert.equal(bilan.mises_a_jour, 1);
  assert.equal(depot.file.size, 1, 'une correction ne crée pas une seconde ligne');
  assert.equal([...depot.file.values()][0].legende, 'nouvelle légende corrigée');
});

test('⛔ une ligne EN VOL ou DÉJÀ PARTIE n est jamais modifiée par une correction du Drive', async () => {
  const pub = manifeste();
  for (const etat of ['executing', 'reconciling', 'published']) {
    const depot = depotFactice({
      lignes: [ligneExistante(pub, { etat, legende: 'légende au moment du départ', id_distant: etat === 'published' ? '100_777' : null })],
    });
    const client = clientFactice({
      publications: [deposee(pub)],
      fichiers: { 'cap-fb': 'légende changée pendant le vol' },
    });

    await passage(depot, client);

    assert.equal([...depot.file.values()][0].legende, 'légende au moment du départ',
      `état ${etat} : le contenu a été changé sous une ligne qu'on ne maîtrise plus`);
  }
});

test('une NOUVELLE VERSION annule la ligne précédente au lieu de coexister avec elle', async () => {
  // Deux lignes approuvées pour la même publication et le même canal, c'est
  // DEUX publications. La v1 encore en file est annulée, la v2 la remplace.
  const v1 = manifeste({ version: 1 });
  const v2 = manifeste({ version: 2 });
  const depot = depotFactice({ lignes: [ligneExistante(v1)] });
  const client = clientFactice({ publications: [deposee(v2)] });

  const bilan = await passage(depot, client);

  assert.equal(bilan.creees, 1);
  assert.equal(bilan.remplacees, 1);
  const parVersion = Object.fromEntries([...depot.file.values()].map((l) => [l.version_contenu, l.etat]));
  assert.equal(parVersion[1], 'cancelled', 'la v1 doit être annulée');
  assert.equal(parVersion[2], 'scheduled');
  const vivantes = [...depot.file.values()].filter((l) => l.etat === 'scheduled');
  assert.equal(vivantes.length, 1, 'une seule ligne vivante par (publication, canal)');
});

test('⛔ une version ANTÉRIEURE à celle déjà en file est refusée', async () => {
  const v1 = manifeste({ version: 1 });
  const v2 = manifeste({ version: 2 });
  const depot = depotFactice({ lignes: [ligneExistante(v2)] });
  const client = clientFactice({ publications: [deposee(v1)] });

  const bilan = await passage(depot, client);

  assert.equal(bilan.creees, 0);
  assert.equal(bilan.ecartees[0].motif, MOTIFS.VERSION_ANTERIEURE);
  assert.equal(depot.file.size, 1);
});

test('un créneau déplacé à version égale remplace la ligne — il n en ajoute pas une seconde', async () => {
  const matin = manifeste({ heure: '09:00' });
  const soir = manifeste({ heure: '17:30' });
  const depot = depotFactice({ lignes: [ligneExistante(matin)] });
  const client = clientFactice({ publications: [deposee(soir)] });

  const bilan = await passage(depot, client);

  assert.equal(bilan.remplacees, 1);
  const vivantes = [...depot.file.values()].filter((l) => l.etat === 'scheduled');
  assert.equal(vivantes.length, 1);
  assert.equal(vivantes[0].instant_utc, '2026-09-21T16:30:00Z');
});

/* ═══════════════════════════════════════════════════════════════════════════
   7. L'ALIMENTATION MARCHE CHAÎNE À L'ARRÊT
   ═══════════════════════════════════════════════════════════════════════════ */

test('⛔ chaîne À L ARRÊT et mode SIMULATION : la file est quand même alimentée', async () => {
  // Sinon on ne peut RIEN vérifier avant d'ouvrir les verrous, et on les
  // ouvrirait à l'aveugle. Alimenter n'est pas publier.
  const pub = manifeste();
  const depot = depotFactice({ actif: false, mode: 'dry_run' });
  const client = clientFactice({ publications: [deposee(pub)] });

  const bilan = await passage(depot, client);

  assert.equal(bilan.creees, 1);
  assert.equal(depot.file.size, 1);
  assert.equal(depot.appels.includes('lireArretGlobal'), false,
    'l alimentation n a aucune raison de consulter l interrupteur : elle ne publie pas');
});

test('⛔ l alimentation ne publie RIEN et ne pose aucun témoin', async () => {
  const pub = manifeste({ version: 1 });
  const depot = depotFactice();
  const client = clientFactice({ publications: [deposee(pub, { approbation: approbationDe(pub) })] });

  await passage(depot, client);

  const ligne = [...depot.file.values()][0];
  assert.equal(ligne.id_distant, null, 'aucun identifiant distant ne peut naître ici');
  assert.equal(ligne.id_conteneur, null);
  assert.equal(ligne.etat, 'scheduled', 'jamais « published »');
});

/* ═══════════════════════════════════════════════════════════════════════════
   8. LE MÉDIA — la vérité, écrite dans la ligne
   ═══════════════════════════════════════════════════════════════════════════ */

test('🔴 SANS hébergeur injecté, url_media reste VIDE — on n invente pas d adresse', async () => {
  // Instagram ne reçoit pas de fichier : il va CHERCHER une URL publiquement
  // joignable. Un lien Drive privé n'en est pas une. Quand l'hébergement n'est
  // pas câblé, la ligne entre en file SANS url_media, l'exécuteur refuse de
  // publier (`url_media_absente`) au lieu d'improviser — et le bilan DIT que
  // l'hébergement est absent, plutôt que de laisser croire à une panne Google.
  const pub = manifeste();
  const depot = depotFactice();
  const client = clientFactice({ publications: [deposee(pub)] });

  const bilan = await passage(depot, client);

  const ligne = [...depot.file.values()][0];
  assert.equal(ligne.url_media, null);
  assert.equal(ligne.derniere_erreur, null, 'aucun hébergement tenté : aucun motif à inventer');
  assert.equal(bilan.medias.hebergement, 'absent');
});

test('⛔ aucune URL googleapis / drive.google ne peut se glisser dans url_media', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../api/_lib/autopost-alimentation.js', import.meta.url)), 'utf8',
  );

  // ⛔ LA RÈGLE, ET SA SEULE ÉVOLUTION DEPUIS LE 18/09 : `url_media` n'est plus
  //    forcément `null`, mais ce qui y entre reste INTERDIT D'ÊTRE FABRIQUÉ
  //    ICI. La seule valeur non nulle admise est l'adresse rendue par
  //    l'hébergeur — l'objet réellement déposé dans notre bucket. Aucune chaîne
  //    écrite à la main ne peut atterrir dans cette colonne.
  const code = source.split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n');
  const ecritures = [...code.matchAll(/url_media\s*[:=]\s*([^,;\n]+)/g)].map((m) => m[1].trim());
  assert.notEqual(ecritures.length, 0, 'le module doit bien écrire url_media quelque part');
  ecritures.forEach((valeur) => {
    assert.equal(/['"`]/.test(valeur), false,
      `url_media ne reçoit jamais une chaîne écrite ici : « ${valeur} »`);
    assert.match(valeur, /^(null|[\w$]+(\??\.url)?(\s*\?\?\s*null)?)$/,
      `url_media ne reçoit que null ou l adresse rendue par l hébergeur : « ${valeur} »`);

    // Une simple variable ne prouve rien par elle-même : on remonte à sa
    // déclaration, et elle doit venir du `.url` de l'hébergeur. Sans ce
    // contrôle, `url_media: adresse` passerait quelle que soit son origine.
    const nu = valeur.replace(/\s*\?\?\s*null$/, '');
    if (/^[\w$]+$/.test(nu) && nu !== 'null') {
      assert.match(code, new RegExp(`const ${nu} = [^;]*\\.url`),
        `« ${nu} » doit être déclarée à partir de l adresse rendue par l hébergeur`);
    }
  });
  assert.equal(/https?:\/\//.test(code), false,
    'aucune adresse en dur dans le code de ce module : elles viennent du stockage');

  // Sur le CODE, pas sur les commentaires : l'en-tête du module explique
  // justement pourquoi un lien Drive n'est pas une adresse publique, et un test
  // qui interdirait d'en parler interdirait d'expliquer.
  assert.equal(/drive\.google\.com|googleusercontent|uc\?export=download/.test(code), false,
    'un lien Drive n est pas une URL publique : ne jamais en fabriquer une');
});

test('🔴 le média hébergé entre dans la ligne, et rien d autre n y entre', async () => {
  const pub = manifeste();
  const depot = depotFactice();
  const client = clientFactice({ publications: [deposee(pub)] });
  const medias = hebergeurFactice();

  const bilan = await passage(depot, client, medias);

  const ligne = [...depot.file.values()][0];
  assert.equal(ligne.url_media, `${RACINE_BUCKET}/PUB-2026-S39-1-01/v1/objet.jpg`);
  assert.equal(ligne.derniere_erreur, null);
  assert.equal(bilan.medias.heberges, 1);
  assert.equal(bilan.medias.hebergement, 'cable');
  assert.deepEqual(medias.appels, ['PUB-2026-S39-1-01|facebook']);
});

test('🔴 DEUX PASSAGES : le second ne redemande rien et ne réécrit pas la ligne', async () => {
  const pub = manifeste();
  const depot = depotFactice();
  const client = clientFactice({ publications: [deposee(pub)] });

  await passage(depot, client, hebergeurFactice());
  const medias2 = hebergeurFactice();
  const bilan2 = await passage(depot, client, medias2);

  assert.equal(depot.file.size, 1);
  assert.equal(bilan2.creees, 0);
  assert.equal(bilan2.inchangees, 1);
  assert.deepEqual(medias2.appels, [],
    'la ligne a déjà une adresse et le dépôt n a pas bougé : on ne redemande rien');
});

test('🔴 UNE PANNE D HÉBERGEMENT NE FAIT PAS PERDRE LE DÉPÔT', async () => {
  // Alimenter et héberger sont deux gestes. La ligne entre quand même en file,
  // sans adresse, et le motif est écrit LÀ OÙ L ÉCRAN LE MONTRE.
  const pub = manifeste();
  const depot = depotFactice();
  const client = clientFactice({ publications: [deposee(pub)] });
  const medias = hebergeurFactice({
    resultat: {
      url: null,
      motif: 'hebergement_indisponible',
      detail: 'le stockage n a pas répondu : connexion perdue',
      piste: 'La ligne reste en file : le prochain passage réessaiera.',
    },
  });

  const bilan = await passage(depot, client, medias);

  assert.equal(bilan.creees, 1, 'la ligne existe : une panne d image n annule pas un dépôt');
  const ligne = [...depot.file.values()][0];
  assert.equal(ligne.url_media, null, '⛔ jamais d adresse pour un objet non déposé');
  assert.equal(ligne.derniere_erreur.code_erreur, 'hebergement_indisponible');
  assert.match(ligne.derniere_erreur.message_erreur, /connexion perdue/);
  assert.equal(ligne.derniere_erreur.a_utc, INSTANT);
  assert.equal(bilan.medias.ecartes.length, 1);
  assert.equal(bilan.medias.ecartes[0].canal, 'facebook');
});

test('🔴 un hébergeur qui LÈVE ne fait pas tomber l alimentation', async () => {
  const pub = manifeste();
  const depot = depotFactice();
  const client = clientFactice({ publications: [deposee(pub)] });
  const medias = { appels: [], async heberger() { throw new Error('Storage 500'); } };

  const bilan = await passage(depot, client, medias);

  assert.equal(bilan.creees, 1);
  const ligne = [...depot.file.values()][0];
  assert.equal(ligne.url_media, null);
  assert.match(ligne.derniere_erreur.message_erreur, /Storage 500/);
});

test('🔴 une ligne DÉJÀ en file sans média reçoit son adresse au passage suivant', async () => {
  // Les 14 publications entrées avant l'hébergement ne doivent pas rester
  // bloquées pour toujours : sans ce rattrapage, la file resterait pleine de
  // lignes qui ne peuvent pas partir.
  const pub = manifeste();
  const depot = depotFactice({ lignes: [ligneExistante(pub, { url_media: null })] });
  const client = clientFactice({ publications: [deposee(pub)] });

  const bilan = await passage(depot, client, hebergeurFactice());

  assert.equal(bilan.creees, 0, 'aucune ligne en double');
  assert.equal(bilan.mises_a_jour, 1);
  assert.equal(bilan.medias.heberges, 1);
  const ligne = [...depot.file.values()][0];
  assert.equal(ligne.url_media, `${RACINE_BUCKET}/PUB-2026-S39-1-01/v1/objet.jpg`);
});

test('un motif de média qui disparaît est EFFACÉ — mais jamais l erreur de l exécuteur', async () => {
  const pub = manifeste();
  const avecMotifMedia = ligneExistante(pub, {
    url_media: null,
    derniere_erreur: { code_erreur: 'media_illisible_dans_le_drive', message_erreur: 'x', a_utc: INSTANT },
  });
  const depot = depotFactice({ lignes: [avecMotifMedia] });
  const client = clientFactice({ publications: [deposee(pub)] });

  await passage(depot, client, hebergeurFactice());

  assert.equal([...depot.file.values()][0].derniere_erreur, null,
    'notre propre motif ne se traîne pas une fois le média hébergé');

  // Et l'inverse : une erreur laissée par l'exécuteur raconte une tentative de
  // PUBLICATION. Ce n'est pas à l'alimentation de la faire disparaître.
  const erreurExecuteur = { code_erreur: 'meta_refuse', message_erreur: 'jeton expiré', a_utc: INSTANT };
  const depot2 = depotFactice({
    lignes: [ligneExistante(pub, { url_media: null, etat: 'failed', derniere_erreur: erreurExecuteur })],
  });
  await passage(depot2, clientFactice({ publications: [deposee(pub)] }), hebergeurFactice());
  assert.deepEqual([...depot2.file.values()][0].derniere_erreur, erreurExecuteur);
});

test('🔴 contenu changé + média NON réhébergé : l ANCIENNE adresse est RETIRÉE', async () => {
  // Le cas qui publierait la mauvaise image. L'adresse porte l'empreinte du
  // fichier : garder l'ancienne « en attendant », ce serait poster la vieille
  // affiche sous la nouvelle légende. Une ligne sans adresse ne part pas — et
  // c'est le bon échec.
  const pub = manifeste();
  const enFile = ligneExistante(pub, { url_media: `${RACINE_BUCKET}/vieille/v1/objet.jpg` });
  const depot = depotFactice({ lignes: [enFile] });
  const client = clientFactice({
    publications: [deposee(pub)],
    fichiers: { 'cap-fb': 'Une légende corrigée — OG-01-S39' },
  });
  const medias = hebergeurFactice({
    resultat: {
      url: null,
      motif: 'media_illisible_dans_le_drive',
      detail: 'Google n a pas rendu le fichier',
      piste: 'La ligne reste en file : le prochain passage réessaiera.',
    },
  });

  await passage(depot, client, medias);

  const ligne = [...depot.file.values()][0];
  assert.equal(ligne.url_media, null,
    'une adresse qui pointe sur l image d avant la correction ne se garde pas');
  assert.equal(ligne.derniere_erreur.code_erreur, 'media_illisible_dans_le_drive');
});

test('🔴 contenu changé + média REPORTÉ faute de budget : l ancienne adresse part aussi', async () => {
  const pub = manifeste();
  const enFile = ligneExistante(pub, { url_media: `${RACINE_BUCKET}/vieille/v1/objet.jpg` });
  const depot = depotFactice({ lignes: [enFile] });
  const client = clientFactice({
    publications: [deposee(pub)],
    fichiers: { 'cap-fb': 'Une légende corrigée — OG-01-S39' },
  });

  const bilan = await alimenterFile({
    depot,
    client,
    medias: hebergeurFactice(),
    televersementsMax: 0, // budget épuisé d'avance
    instant: INSTANT,
    tracer: muet,
  });

  assert.equal(bilan.medias.reportes, 1);
  const ligne = [...depot.file.values()][0];
  assert.equal(ligne.url_media, null);
  assert.equal(ligne.derniere_erreur, null, 'un report n est pas une erreur');
});

test('🔴 LE BUDGET DE TÉLÉVERSEMENTS : au-delà, on REPORTE — sans inventer une erreur', async () => {
  // Alimenter tourne dans la même fonction serverless que publier. Une
  // alimentation qui fait expirer la fonction n'empêche pas seulement
  // d'alimenter : elle empêche de PUBLIER ce qui est déjà en file.
  const pubs = ['09', '10', '11'].map((h, i) => manifeste({ id: `PUB-2026-S39-1-0${i + 1}`, heure: `${h}:00` }));
  const depot = depotFactice();
  const client = clientFactice({ publications: pubs.map((p, i) => deposee(p, { dossier: `p${i}` })) });
  const medias = hebergeurFactice();

  const bilan = await alimenterFile({
    depot, client, medias, televersementsMax: 2, instant: INSTANT, tracer: muet,
  });

  assert.equal(bilan.creees, 3, 'les trois lignes entrent en file : un report n annule rien');
  assert.equal(bilan.medias.heberges, 2);
  assert.equal(bilan.medias.reportes, 1);
  assert.equal(bilan.medias.ecartes.length, 0, 'un report n est PAS un écartement');

  const reportee = [...depot.file.values()].find((l) => !l.url_media);
  assert.equal(reportee.derniere_erreur, null,
    'un bandeau rouge pour une décision volontaire serait un faux témoin dans l autre sens');
});

test('un média DÉJÀ hébergé ne consomme pas le budget de téléversements', async () => {
  const pubs = ['09', '10', '11'].map((h, i) => manifeste({ id: `PUB-2026-S39-1-0${i + 1}`, heure: `${h}:00` }));
  const depot = depotFactice();
  const client = clientFactice({ publications: pubs.map((p, i) => deposee(p, { dossier: `p${i}` })) });
  // Tout est déjà dans le bucket : trois questions, zéro dépôt.
  const medias = hebergeurFactice({ dejaLa: true });

  const bilan = await alimenterFile({
    depot, client, medias, televersementsMax: 1, instant: INSTANT, tracer: muet,
  });

  assert.equal(bilan.medias.deja_presents, 3);
  assert.equal(bilan.medias.reportes, 0, 'une question au bucket ne coûte pas un téléversement');
  assert.equal([...depot.file.values()].filter((l) => l.url_media).length, 3);
});

test('🔴 un dépôt dont le CONTENU a changé fait redemander une adresse', async () => {
  // Le chemin de l'objet porte l'empreinte du fichier : une affiche corrigée a
  // une autre adresse. Garder l'ancienne, ce serait publier l'image d'avant.
  const pub = manifeste();
  const enFile = ligneExistante(pub, { url_media: 'https://exemple.invalid/ancienne.jpg' });
  // Même clé (même version, même créneau, même compte) mais légende différente :
  // l'empreinte du dépôt change, donc le contenu a bougé.
  const depot = depotFactice({ lignes: [enFile] });
  const client = clientFactice({
    publications: [deposee(pub)],
    fichiers: { 'cap-fb': 'Une légende corrigée — OG-01-S39' },
  });
  const medias = hebergeurFactice();

  const bilan = await passage(depot, client, medias);

  assert.equal(bilan.mises_a_jour, 1);
  assert.deepEqual(medias.appels, ['PUB-2026-S39-1-01|facebook'],
    'le contenu a changé : on redemande l adresse au lieu de garder l ancienne');
  assert.equal([...depot.file.values()][0].url_media,
    `${RACINE_BUCKET}/PUB-2026-S39-1-01/v1/objet.jpg`);
});

/* ═══════════════════════════════════════════════════════════════════════════
   9. LE DRIVE EN PANNE — dire, ne pas inventer
   ═══════════════════════════════════════════════════════════════════════════ */

test('⛔ Drive inaccessible : aucune écriture, le diagnostic est rendu, rien n est jeté', async () => {
  const depot = depotFactice();
  const client = clientFactice({
    diagnostic: 'dossier_inaccessible',
    message: 'Le dossier n est pas partagé avec le robot.',
    publications: [],
  });

  const bilan = await passage(depot, client);

  assert.equal(depot.file.size, 0);
  assert.equal(bilan.creees, 0);
  assert.equal(bilan.diagnostic, 'dossier_inaccessible');
  assert.match(bilan.message, /pas partagé/);
});

test('⛔ une exception du client Drive ne fait pas tomber le passage', async () => {
  const depot = depotFactice();
  const client = clientFactice({ jeteSurLecture: new Error('réseau coupé') });

  const bilan = await passage(depot, client);

  assert.equal(bilan.diagnostic, 'panne');
  assert.match(bilan.detail, /réseau coupé/);
  assert.equal(depot.file.size, 0);
});

test('un dossier vide n est pas une panne : zéro création, zéro écartement, zéro bruit', async () => {
  const depot = depotFactice();
  const client = clientFactice({ diagnostic: 'dossier_vide', message: 'Aucune publication déposée.', publications: [] });

  const bilan = await passage(depot, client);

  assert.equal(bilan.creees, 0);
  assert.equal(bilan.ecartees.length, 0);
  assert.equal(depot.journal.length, 0, 'un passage sans rien de neuf n encombre pas le journal');
});

/* ═══════════════════════════════════════════════════════════════════════════
   10. LE JOURNAL — ce qui change est dit, ce qui ne change pas se tait
   ═══════════════════════════════════════════════════════════════════════════ */

test('une création est journalisée ; le passage suivant, qui ne change rien, ne l est pas', async () => {
  const pub = manifeste();
  const depot = depotFactice();
  const client = clientFactice({ publications: [deposee(pub)] });

  await passage(depot, client);
  const apresPremier = depot.journal.length;
  await passage(depot, client);

  assert.ok(apresPremier >= 1, 'une création doit laisser une trace');
  assert.equal(depot.journal.length, apresPremier,
    'un passage horaire qui ne change rien ne doit pas remplir le journal');
  assert.equal(depot.journal[0].evenement, 'alimentation');
});

test('le journal porte l instant du passage, pas une date fabriquée', async () => {
  const pub = manifeste();
  const depot = depotFactice();
  const client = clientFactice({ publications: [deposee(pub)] });

  await passage(depot, client);

  assert.equal(depot.journal[0].instant_utc, INSTANT);
});

/* ═══════════════════════════════════════════════════════════════════════════
   11. LE DÉCLENCHEMENT — deux portes, et une seule qui publie

   L'alimentation doit se déclencher AU PASSAGE (avant la sélection) et À LA
   DEMANDE depuis l'écran. Ces tests montent le vrai gestionnaire HTTP, avec ses
   dépendances injectées : aucun réseau, aucune base.
   ═══════════════════════════════════════════════════════════════════════════ */

function repFactice() {
  const rep = { statut: null, corps: null, entetes: {} };
  rep.status = (c) => { rep.statut = c; return rep; };
  rep.json = (c) => { rep.corps = c; return rep; };
  rep.setHeader = (k, v) => { rep.entetes[k] = v; return rep; };
  rep.end = () => rep;
  return rep;
}

/** Dépôt minimal pour l'exécuteur : la chaîne est à l'ARRÊT, comme en vrai. */
function depotAlArret() {
  const journal = [];
  return {
    journal,
    async lireArretGlobal() { return { actif: false, mode: 'dry_run', plafond: 4 }; },
    async lireFile() { return []; },
    async lireAReconcilier() { return []; },
    async compterPubliesLe() { return 0; },
    async journaliser(e) { journal.push(e); },
  };
}

test('⛔ le passage ALIMENTE AVANT de sélectionner — sinon un dépôt attend une heure de plus', async () => {
  const { creerGestionnaireAutopost } = await import('../api/autopost.js');
  const avant = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'secret-de-test';

  const ordre = [];
  const depot = depotAlArret();
  const ancienLire = depot.lireArretGlobal;
  depot.lireArretGlobal = async () => { ordre.push('selection'); return ancienLire(); };

  const gestionnaire = creerGestionnaireAutopost({
    depot,
    client: { disponible: false },
    alimente: async () => { ordre.push('alimentation'); return { creees: 2, ecartees: [] }; },
  });

  const rep = repFactice();
  await gestionnaire(
    { url: '/api/autopost-tick', method: 'GET', headers: { authorization: 'Bearer secret-de-test' }, query: {} },
    rep,
  );

  if (avant === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = avant;
  assert.equal(rep.statut, 200);
  assert.deepEqual(ordre, ['alimentation', 'selection'],
    'la file doit être remplie avant d être regardée');
  assert.equal(rep.corps.bilan.alimentation.creees, 2, 'le bilan du passage doit porter l alimentation');
});

test('⛔ un Drive en panne n empêche PAS le passage de traiter ce qui est déjà en file', async () => {
  const { creerGestionnaireAutopost } = await import('../api/autopost.js');
  const avant = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'secret-de-test';

  const gestionnaire = creerGestionnaireAutopost({
    depot: depotAlArret(),
    client: { disponible: false },
    alimente: async () => { throw new Error('Google injoignable'); },
  });

  const rep = repFactice();
  await gestionnaire(
    { url: '/api/autopost-tick', method: 'GET', headers: { authorization: 'Bearer secret-de-test' }, query: {} },
    rep,
  );

  if (avant === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = avant;
  assert.equal(rep.statut, 200, 'le passage doit aboutir malgré la panne Drive');
  assert.equal(rep.corps.bilan.alimentation.diagnostic, 'panne');
  assert.match(rep.corps.bilan.alimentation.detail, /Google injoignable/);
});

test('la voie « alimenter » remplit la file et NE PUBLIE PAS', async () => {
  const { creerGestionnaireAutopost, voieAutopost } = await import('../api/autopost.js');
  const avant = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'secret-de-test';

  assert.equal(voieAutopost({ url: '/api/autopost-alimenter', query: {} }), 'alimenter');
  assert.equal(voieAutopost({ url: '/api/autopost', query: { voie: 'alimenter' } }), 'alimenter');

  const depot = depotAlArret();
  let selectionAppelee = false;
  depot.lireFile = async () => { selectionAppelee = true; return []; };

  const gestionnaire = creerGestionnaireAutopost({
    depot,
    client: { disponible: false },
    alimente: async () => ({ creees: 1, ecartees: [], diagnostic: 'ok' }),
  });

  const rep = repFactice();
  await gestionnaire(
    { url: '/api/autopost-alimenter', method: 'POST', headers: { authorization: 'Bearer secret-de-test' }, query: {} },
    rep,
  );

  if (avant === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = avant;
  assert.equal(rep.statut, 200);
  assert.equal(rep.corps.alimentation.creees, 1);
  assert.equal(selectionAppelee, false, 'alimenter n est pas publier : aucune sélection ne doit tourner');
});

test('⛔ la voie « alimenter » n est pas ouverte à un visiteur sans droit', async () => {
  const { creerGestionnaireAutopost } = await import('../api/autopost.js');
  const avant = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'secret-de-test';

  let alimenteAppelee = false;
  const gestionnaire = creerGestionnaireAutopost({
    depot: depotAlArret(),
    client: { disponible: false },
    alimente: async () => { alimenteAppelee = true; return {}; },
  });

  const rep = repFactice();
  await gestionnaire({ url: '/api/autopost-alimenter', method: 'POST', headers: {}, query: {} }, rep);

  if (avant === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = avant;
  assert.equal(alimenteAppelee, false, 'aucune lecture du Drive sans session valide');
  assert.ok([401, 403].includes(rep.statut), `attendu 401/403, reçu ${rep.statut}`);
});

test('vercel.json : /api/autopost-alimenter est réécrit vers la voie alimenter, avant l attrape-tout', async () => {
  const conf = JSON.parse(readFileSync(fileURLToPath(new URL('../vercel.json', import.meta.url)), 'utf8'));
  const generique = conf.rewrites.findIndex((r) => r.source === '/api/(.*)');
  const i = conf.rewrites.findIndex((r) => r.source === '/api/autopost-alimenter');
  assert.ok(i !== -1, 'la règle manque : le chemin tomberait dans l attrape-tout');
  assert.equal(conf.rewrites[i].destination, '/api/autopost?voie=alimenter');
  assert.ok(i < generique, 'la première règle qui correspond gagne');
});

test('⛔ le plafond du plan Hobby est tenu : api/ compte 12 fichiers, pas 13', async () => {
  const { readdirSync } = await import('node:fs');
  const dossier = fileURLToPath(new URL('../api', import.meta.url));
  const fonctions = readdirSync(dossier).filter((n) => n.endsWith('.js'));
  assert.equal(fonctions.length, 12,
    `13 fonctions font échouer le déploiement, build vert compris : ${fonctions.join(', ')}`);
});

/* ═══════════════════════════════════════════════════════════════════════════
   12. L'APPROBATION DONNÉE DEPUIS L'APPLICATION SURVIT À LA RELECTURE

   ⛔ Le passage horaire ALIMENTE AVANT DE SÉLECTIONNER. Tant que cette boucle
   réécrivait `approbation` avec ce que portait le dépôt — c'est-à-dire presque
   toujours `null`, puisque ChatGPT a INTERDICTION de déposer
   `APPROBATION.json` — une approbation donnée à 08 h 55 était effacée par le
   passage de 09 h 00, juste avant d'être lue. L'écran d'approbation n'aurait
   pas tenu une heure.
   ═══════════════════════════════════════════════════════════════════════════ */

test('⛔ une approbation donnée dans l application n est PAS effacée par la relecture du Drive', async () => {
  const pub = manifeste();
  const approbationEcran = {
    approuve: true,
    publication_id: pub.publication_id,
    version_contenu: pub.version_contenu,
    canaux_approuves: ['facebook'],
    payload_sha256: empreinteCanonique(pub),
    creneau_approuve: { date_locale: pub.creneau.date_locale, heure_locale: pub.creneau.heure_locale },
    signature_hmac_sha256: null,
    signature: 'absente',
    origine: 'ecran_administrateur',
    approuve_par: 'u-admin',
    approuve_le_utc: '2026-09-21T05:55:00Z',
  };
  const depot = depotFactice({
    lignes: [ligneExistante(pub, { approbation: approbationEcran, url_media: 'https://x/y.jpg' })],
  });
  // Le dépôt du Drive ne porte AUCUNE approbation — le cas normal.
  const client = clientFactice({ publications: [deposee(pub, { approbation: null })] });

  await passage(depot, client, hebergeurFactice());

  const l = [...depot.file.values()][0];
  assert.equal(l.approbation?.approuve, true, 'la relecture du Drive a effacé l approbation');
  assert.equal(l.approbation.approuve_par, 'u-admin');
});

test('une approbation DÉPOSÉE dans le Drive reste prioritaire sur celle de l application', async () => {
  const pub = manifeste();
  const duDrive = approbationDe(pub);
  const depot = depotFactice({
    lignes: [ligneExistante(pub, {
      approbation: { approuve: true, origine: 'ecran_administrateur', approuve_par: 'u-admin' },
      url_media: 'https://x/y.jpg',
    })],
  });
  const client = clientFactice({ publications: [deposee(pub, { approbation: duDrive })] });

  await passage(depot, client, hebergeurFactice());

  const l = [...depot.file.values()][0];
  assert.equal(l.approbation.payload_sha256, duDrive.payload_sha256);
  assert.equal(l.approbation.origine, undefined, 'c est bien le dépôt qui est rangé');
});

test('⛔ RIEN NE S AUTO-APPROUVE : une ligne NEUVE sans APPROBATION.json entre non approuvée', async () => {
  const pub = manifeste();
  const depot = depotFactice();
  const client = clientFactice({ publications: [deposee(pub, { approbation: null })] });

  await passage(depot, client, hebergeurFactice());

  const l = [...depot.file.values()][0];
  assert.equal(l.approbation, null, 'l alimentation ne doit JAMAIS fabriquer une approbation');
});

test('⛔ une approbation conservée devient invalide si le dépôt a CHANGÉ le contenu', async () => {
  const v1 = manifeste();
  const approbationEcran = {
    approuve: true,
    publication_id: v1.publication_id,
    version_contenu: v1.version_contenu,
    canaux_approuves: ['facebook'],
    payload_sha256: empreinteCanonique(v1),
    creneau_approuve: { date_locale: v1.creneau.date_locale, heure_locale: v1.creneau.heure_locale },
    origine: 'ecran_administrateur',
    approuve_par: 'u-admin',
  };
  const depot = depotFactice({
    lignes: [ligneExistante(v1, { approbation: approbationEcran, url_media: 'https://x/y.jpg' })],
  });

  // MÊME clé (même version, même créneau, même canal, même compte) mais la
  // légende a changé : la ligne est réécrite, l'approbation est conservée…
  const corrige = manifeste();
  corrige.captions.facebook.sha256 = 'c'.repeat(64);
  const client = clientFactice({ publications: [deposee(corrige, { approbation: null })] });

  await passage(depot, client, hebergeurFactice());

  const l = [...depot.file.values()][0];
  assert.equal(l.approbation?.approuve, true, 'elle est conservée…');
  // … et elle ne vaut plus rien, parce qu'elle porte l'empreinte du contenu
  // approuvé. Conserver n'est pas contourner.
  const { verifierApprobation } = await import('../api/_lib/autopost-contrat.js');
  assert.equal(
    verifierApprobation({ publication: l.publication, approbation: l.approbation, canal: 'facebook' }).raison,
    'contenu_modifie_depuis_approbation',
  );
});
