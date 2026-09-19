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
import { cheminObjet } from '../api/_lib/autopost-medias.js';
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
      // ⛔ Le chemin est celui du VRAI module, calculé par `cheminObjet()` sur
      //    le md5 que la doublure de `drive.js` rend. Une doublure qui
      //    inventerait un chemin à elle serait une doublure qui ment : c'est
      //    exactement ce qui a laissé passer la perte des six adresses du
      //    19/09/2026 — la décision « l'objet est-il encore le bon ? » se prend
      //    sur ce chemin, et un test bâti sur un autre ne l'exerce pas.
      const chemin = cheminObjet({
        publicationId: pub.publication_id,
        version: pub.version_contenu,
        empreinte: (depose?.medias || [])[0]?.md5,
        nom: pub.medias[0].chemin_relatif,
      });
      return {
        url: `${RACINE_BUCKET}/${chemin}`,
        chemin,
        deja_present: dejaLa,
        televerse: !dejaLa,
        motif: null,
        detail: null,
        piste: null,
      };
    },
  };
}

/** L'adresse que l'hébergement RÉEL produirait pour ce dépôt. */
function urlHebergee(pub, { md5 = 'd'.repeat(32) } = {}) {
  return `${RACINE_BUCKET}/${cheminObjet({
    publicationId: pub.publication_id,
    version: pub.version_contenu,
    empreinte: md5,
    nom: pub.medias[0].chemin_relatif,
  })}`;
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
   5. RIEN NE S'AUTO-APPROUVE SANS CONSIGNE EXPLICITE

   ⚠️ Depuis le 19/09/2026, l'alimentation SAIT approuver — mais seulement si
   l'appelant le lui demande (`approbationAutomatique: true`, lu en base par
   `api/autopost.js`). Ces tests appellent `passage()`, qui ne le demande PAS :
   ils protègent donc le défaut du module, c'est-à-dire qu'aucun appelant
   distrait — un script de reprise, un outil, un test — ne puisse approuver par
   omission. La politique par défaut du SYSTÈME, elle, est `true` ; elle vit en
   base et elle a sa propre section, la 14.
   ═══════════════════════════════════════════════════════════════════════════ */

test('⛔ sans consigne, sans APPROBATION.json : la ligne entre en file et n est PAS approuvée', async () => {
  const pub = manifeste();
  const depot = depotFactice();
  const client = clientFactice({ publications: [deposee(pub, { approbation: null })] });

  await passage(depot, client);

  const ligne = [...depot.file.values()][0];
  assert.equal(ligne.etat, 'scheduled', 'elle entre en file : le gérant doit la voir');
  assert.equal(ligne.approbation, null, 'et elle n est pas approuvée');
});

test('⛔ sans consigne, AUCUNE ligne ne porte une approbation que le Drive n a pas déposée', async () => {
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
  assert.equal(ligne.url_media, `${urlHebergee(pub)}`);
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
  assert.equal(ligne.url_media, `${urlHebergee(pub)}`);
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
    `${urlHebergee(pub)}`);
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
    lignes: [ligneExistante(pub, { approbation: approbationEcran, url_media: urlHebergee(pub) })],
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
      url_media: urlHebergee(pub),
    })],
  });
  const client = clientFactice({ publications: [deposee(pub, { approbation: duDrive })] });

  await passage(depot, client, hebergeurFactice());

  const l = [...depot.file.values()][0];
  assert.equal(l.approbation.payload_sha256, duDrive.payload_sha256);
  assert.equal(l.approbation.origine, undefined, 'c est bien le dépôt qui est rangé');
});

test('⛔ SANS CONSIGNE, rien ne s auto-approuve : une ligne NEUVE entre non approuvée', async () => {
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
    lignes: [ligneExistante(v1, { approbation: approbationEcran, url_media: urlHebergee(v1) })],
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

/* ═══════════════════════════════════════════════════════════════════════════
   13. LE BUDGET D'HÉBERGEMENT, COMPTÉ EN TEMPS

   ⛔ CE QU'ON PROTÈGE ICI N'EST PAS L'ALIMENTATION, C'EST LA PUBLICATION.
   L'alimentation tourne DANS la même fonction serverless que la publication, et
   AVANT elle. Une alimentation qui fait expirer la fonction n'empêche pas
   seulement d'alimenter : elle empêche de publier ce qui est DÉJÀ en file, et
   ça, c'est un rendez-vous manqué sur la page de l'entreprise.

   Le 19/09/2026, un plafond de SIX téléversements par passage avait été posé par
   prudence, SANS mesure. Mesure faite la nuit suivante : 33 lignes sur 42
   attendaient encore un média. Un plafond en nombre de fichiers ne dit rien du
   temps consommé — six petites images ne coûtent pas ce que coûtent six vidéos.
   ═══════════════════════════════════════════════════════════════════════════ */

test('🔴 le budget de temps du code est EXACTEMENT le maxDuration déclaré dans vercel.json', async () => {
  // Ce test existe parce que le chiffre d'origine (6) était une supposition.
  // La documentation Vercel donne, avec fluid compute, un plan Hobby à 300 s ;
  // sans fluid compute, 60 s. L'API Vercel ne dit pas lequel s'applique. On ne
  // devine donc pas : `vercel.json` DÉCLARE 60 — accepté sous les deux régimes —
  // et le code recopie ce chiffre. Si l'un des deux bouge sans l'autre, le
  // budget serait calculé sur une durée qui n'existe pas.
  const {
    DUREE_MAX_FONCTION_MS, RESERVE_PUBLICATION_MS, BUDGET_HEBERGEMENT_MS,
  } = await import('../api/_lib/autopost-alimentation.js');

  const config = JSON.parse(readFileSync(
    fileURLToPath(new URL('../vercel.json', import.meta.url)), 'utf8',
  ));
  const declare = config.functions?.['api/autopost.js']?.maxDuration;

  assert.equal(typeof declare, 'number',
    'sans maxDuration déclaré, la fonction tourne à un défaut que personne ne connaît');
  assert.equal(DUREE_MAX_FONCTION_MS, declare * 1000,
    `vercel.json déclare ${declare} s, le code calcule sur ${DUREE_MAX_FONCTION_MS} ms`);
  assert.ok(declare <= 60,
    '60 s est le plafond Hobby SANS fluid compute : au-delà, le déploiement peut refuser');
  assert.ok(RESERVE_PUBLICATION_MS > BUDGET_HEBERGEMENT_MS,
    'la marge gardée pour publier doit rester plus grande que le budget dépensé à héberger');
  assert.equal(BUDGET_HEBERGEMENT_MS, DUREE_MAX_FONCTION_MS - RESERVE_PUBLICATION_MS);
});

/** Un chronomètre qu'on fait avancer à la main : aucun test ne dort. */
function chronometre(pas = 0) {
  let t = 0;
  return { horloge: () => { const v = t; t += pas; return v; }, avancer: (ms) => { t += ms; } };
}

test('🔴 le budget de temps épuisé REPORTE proprement : la ligne entre, sans erreur', async () => {
  const pubs = [
    manifeste({ id: 'PUB-2026-S39-1-01' }),
    manifeste({ id: 'PUB-2026-S39-2-01', date: '2026-09-22' }),
    manifeste({ id: 'PUB-2026-S39-3-01', date: '2026-09-23' }),
  ];
  const depot = depotFactice();
  const client = clientFactice({ publications: pubs.map((p) => deposee(p)) });
  const medias = hebergeurFactice();

  // Chaque lecture d'horloge avance de 4 s : le premier hébergement passe,
  // les suivants tombent hors budget.
  const bilan = await alimenterFile({
    depot,
    client,
    medias,
    instant: INSTANT,
    tracer: muet,
    budgetHebergementMs: 5_000,
    horloge: chronometre(4_000).horloge,
  });

  assert.equal(bilan.creees, 3, 'les trois lignes entrent en file : héberger et alimenter sont deux gestes');
  assert.ok(bilan.medias.reportes >= 1, 'au moins un média doit être reporté');
  assert.equal(bilan.medias.motif_report, 'budget_temps_epuise',
    'sans le motif, « 2 reporté(s) » ne dit pas s il faut allonger le budget ou lever le plafond');
  assert.deepEqual(bilan.medias.ecartes, [],
    'un report n est PAS un écartement : rien ne doit apparaître comme refusé');

  // ⛔ LE POINT QUI COMPTE : un report ne pose AUCUNE erreur sur la ligne.
  // Un bandeau rouge pour une décision volontaire est un faux témoin, dans
  // l'autre sens — le gérant chercherait une panne qui n'existe pas.
  const sansMedia = [...depot.file.values()].filter((l) => !l.url_media);
  assert.ok(sansMedia.length >= 1, 'les lignes reportées entrent bien sans adresse');
  for (const l of sansMedia) {
    assert.equal(l.derniere_erreur, null, `${l.publication_id} porte une erreur pour un simple report`);
  }
});

test('le plafond en NOMBRE reste la ceinture si le chronomètre ment (horloge gelée)', async () => {
  const pubs = [
    manifeste({ id: 'PUB-2026-S39-1-01' }),
    manifeste({ id: 'PUB-2026-S39-2-01', date: '2026-09-22' }),
    manifeste({ id: 'PUB-2026-S39-3-01', date: '2026-09-23' }),
  ];
  const depot = depotFactice();
  const client = clientFactice({ publications: pubs.map((p) => deposee(p)) });

  const bilan = await alimenterFile({
    depot,
    client,
    medias: hebergeurFactice(),
    instant: INSTANT,
    tracer: muet,
    // Horloge gelée : le budget de temps ne se déclenchera JAMAIS.
    horloge: () => 0,
    budgetHebergementMs: 25_000,
    televersementsMax: 1,
  });

  assert.equal(bilan.medias.heberges, 1);
  assert.equal(bilan.medias.reportes, 2);
  assert.equal(bilan.medias.motif_report, 'plafond_televersements_atteint',
    'le plafond en nombre est ce qui reste quand le chronomètre est inutilisable');
});

test('un passage qui tient dans son budget héberge TOUT — c est le cas nominal', async () => {
  const pubs = Array.from({ length: 12 }, (_, i) => manifeste({
    id: `PUB-2026-S39-${(i % 7) + 1}-0${Math.floor(i / 7) + 1}`,
    date: `2026-09-${21 + (i % 5)}`,
  }));
  const depot = depotFactice();
  const client = clientFactice({ publications: pubs.map((p) => deposee(p)) });

  const bilan = await alimenterFile({
    depot,
    client,
    medias: hebergeurFactice(),
    instant: INSTANT,
    tracer: muet,
    // 200 ms par lecture d'horloge : douze hébergements restent loin du budget.
    horloge: chronometre(200).horloge,
  });

  assert.equal(bilan.creees, 12);
  assert.equal(bilan.medias.heberges, 12,
    'douze fichiers doivent passer en un seul passage : c est tout l objet du changement');
  assert.equal(bilan.medias.reportes, 0);
  assert.equal(bilan.medias.motif_report, null);
  assert.equal(bilan.medias.budget_ms, 25_000, 'le bilan dit le budget sur lequel il a compté');
});

/* ═══════════════════════════════════════════════════════════════════════════
   14. L'APPROBATION AUTOMATIQUE

   Décision de Gassim, 19/09/2026, mot pour mot : « automatique tout de suite ».
   Sa raison : ChatGPT vérifie déjà le manifeste avant de déposer. La réserve lui
   a été exposée — ChatGPT vérifie le FORMAT, pas le JUGEMENT — et il a tranché.

   Ces tests ne rediscutent pas la décision. Ils tiennent les trois choses qui
   font la différence entre « automatique » et « aveugle » :

     1. l'empreinte du contenu est calculée et portée par l'approbation ;
     2. une décision HUMAINE n'est JAMAIS réécrite par un passage suivant ;
     3. l'objet écrit dit QUI a approuvé — machine ou humain.
   ═══════════════════════════════════════════════════════════════════════════ */

const passageAuto = (depot, client, medias = null, sur = {}) => alimenterFile({
  depot, client, medias, instant: INSTANT, tracer: muet, approbationAutomatique: true, ...sur,
});

test('🔴 approbation automatique : une ligne NEUVE entre en file DÉJÀ approuvée', async () => {
  const pub = manifeste();
  const depot = depotFactice();
  const client = clientFactice({ publications: [deposee(pub, { approbation: null })] });

  const bilan = await passageAuto(depot, client, hebergeurFactice());

  const l = [...depot.file.values()][0];
  assert.equal(l.approbation?.approuve, true, 'elle doit entrer approuvée');
  assert.equal(bilan.approbation_auto.posees, 1);
  assert.equal(bilan.approbation_auto.reglage, 'activee');

  // ⛔ L'EMPREINTE. C'est elle qui fait qu'« automatique » n'est pas « aveugle ».
  assert.equal(l.approbation.payload_sha256, empreinteCanonique(pub),
    'sans empreinte, l approbation couvrirait n importe quel contenu');
  assert.deepEqual(l.approbation.canaux_approuves, ['facebook'],
    'elle n approuve QUE le canal de cette ligne');
  assert.equal(l.approbation.creneau_approuve.heure_locale, pub.creneau.heure_locale);

  // 🔴 QUI a approuvé : la machine, et on peut le dire.
  assert.equal(l.approbation.origine, 'automatique');
  assert.equal(l.approbation.approuve_par, null,
    'une machine n a pas d identifiant de session ; lui en inventer un serait un faux témoin');
  assert.equal(l.approbation.signature, 'absente',
    'AUTOPOST_CLE_APPROBATION n est pas posée — l écran doit le dire, pas afficher un vert');

  // Et elle est OPÉRANTE : la même fonction que la sélection appellera l accepte.
  const { verifierApprobation } = await import('../api/_lib/autopost-contrat.js');
  assert.equal(
    verifierApprobation({ publication: l.publication, approbation: l.approbation, canal: 'facebook' }).approuve,
    true, 'une approbation écrite mais refusée au moment de publier serait un faux témoin');
});

test('🔴 les lignes DÉJÀ EN FILE sont rattrapées — sinon il faudrait cliquer 42 fois', async () => {
  // Le cas mesuré du 19/09/2026 : 42 lignes en file, aucune approuvée. Si le
  // code n approuvait que les lignes NEUVES, le gérant devrait toutes les
  // reprendre à la main, et le changement ne servirait à rien ce matin-là.
  const pub = manifeste();
  const depot = depotFactice({
    lignes: [ligneExistante(pub, { approbation: null, url_media: urlHebergee(pub) })],
  });
  const client = clientFactice({ publications: [deposee(pub, { approbation: null })] });

  const bilan = await passageAuto(depot, client, hebergeurFactice());

  assert.equal(bilan.creees, 0, 'aucune ligne neuve : c est bien un rattrapage');
  assert.equal(bilan.mises_a_jour, 1);
  assert.equal(bilan.approbation_auto.posees, 1);
  assert.equal([...depot.file.values()][0].approbation?.approuve, true);
});

test('une approbation automatique DÉJÀ VALIDE n est pas reposée à chaque passage', async () => {
  // Reposer, ce serait réécrire la ligne toutes les heures avec un horodatage
  // neuf : `updated_at` ne dirait plus quand la ligne a vraiment changé.
  const pub = manifeste();
  const depot = depotFactice({
    lignes: [ligneExistante(pub, { approbation: null, url_media: urlHebergee(pub) })],
  });
  const client = clientFactice({ publications: [deposee(pub, { approbation: null })] });

  await passageAuto(depot, client, hebergeurFactice());
  const posee = { ...[...depot.file.values()][0].approbation };

  const bilan2 = await passageAuto(depot, client, hebergeurFactice());

  assert.equal(bilan2.inchangees, 1, 'le second passage ne doit rien réécrire');
  assert.equal(bilan2.mises_a_jour, 0);
  assert.equal(bilan2.approbation_auto.posees, 0);
  assert.deepEqual([...depot.file.values()][0].approbation, posee,
    'l horodatage de la première approbation doit survivre');
});

test('⛔ contenu modifié après approbation automatique → l approbation TOMBE', async () => {
  const v1 = manifeste();
  const depot = depotFactice({
    lignes: [ligneExistante(v1, { approbation: null, url_media: urlHebergee(v1) })],
  });
  const client = clientFactice({ publications: [deposee(v1, { approbation: null })] });
  await passageAuto(depot, client, hebergeurFactice());

  const approuvee = [...depot.file.values()][0].approbation;
  assert.equal(approuvee.approuve, true);

  // ChatGPT corrige l'affiche : MÊME clé, contenu différent. L'approbation
  // posée sur l'ancien contenu ne doit plus valoir.
  const corrige = manifeste();
  corrige.captions.facebook.sha256 = 'c'.repeat(64);

  const { verifierApprobation } = await import('../api/_lib/autopost-contrat.js');
  assert.equal(
    verifierApprobation({ publication: corrige, approbation: approuvee, canal: 'facebook' }).raison,
    'contenu_modifie_depuis_approbation',
    'sans ce refus, on publierait la nouvelle affiche sous un accord qui ne la couvrait pas');

  // ⚠️ Dit en clair, parce que c'est la conséquence de « automatique tout de
  //    suite » : au passage SUIVANT, la machine réapprouve — sur le contenu
  //    corrigé, avec une empreinte NEUVE. L'empreinte ne remplace pas une
  //    relecture humaine ; elle garantit qu'aucun octet ne part sous un accord
  //    qui ne le couvrait pas.
  const client2 = clientFactice({ publications: [deposee(corrige, { approbation: null })] });
  await passageAuto(depot, client2, hebergeurFactice());
  const apres = [...depot.file.values()][0].approbation;
  assert.equal(apres.payload_sha256, empreinteCanonique(corrige),
    'l approbation reposée doit porter l empreinte du contenu CORRIGÉ, pas de l ancien');
  assert.notEqual(apres.payload_sha256, approuvee.payload_sha256);
});

test('⛔⛔ UN RETRAIT HUMAIN SURVIT À TROIS RELECTURES DU DRIVE', async () => {
  // C'est le test qui fait que le bouton « Retirer l'approbation » sert à
  // quelque chose. Sans lui, un retrait à 08 h 55 serait réapprouvé par le
  // passage de 09 h 00, et le gérant n'aurait aucun moyen d'arrêter une
  // publication autrement qu'en coupant toute la chaîne.
  const pub = manifeste();
  const retraitHumain = {
    approuve: false,
    publication_id: pub.publication_id,
    version_contenu: pub.version_contenu,
    canaux_approuves: [],
    origine: 'ecran_administrateur',
    retire_par: 'u-admin',
    retire_le_utc: '2026-09-21T05:55:00Z',
    approbation_retiree: null,
  };
  const depot = depotFactice({
    lignes: [ligneExistante(pub, { approbation: retraitHumain, url_media: urlHebergee(pub) })],
  });
  const client = clientFactice({ publications: [deposee(pub, { approbation: null })] });

  for (const tour of [1, 2, 3]) {
    const bilan = await passageAuto(depot, client, hebergeurFactice());
    const l = [...depot.file.values()][0];
    assert.deepEqual(l.approbation, retraitHumain,
      `relecture n°${tour} : le retrait humain a été réécrit par la machine`);
    assert.equal(bilan.approbation_auto.posees, 0,
      `relecture n°${tour} : la machine ne doit rien poser sur une décision humaine`);
    assert.equal(bilan.approbation_auto.humaines_respectees, 1);
    assert.equal(bilan.mises_a_jour, 0, `relecture n°${tour} : aucune écriture n était nécessaire`);
  }
});

test('une APPROBATION humaine (et pas seulement un retrait) n est pas réécrite non plus', async () => {
  const pub = manifeste();
  const humaine = {
    approuve: true,
    publication_id: pub.publication_id,
    version_contenu: pub.version_contenu,
    canaux_approuves: ['facebook'],
    payload_sha256: empreinteCanonique(pub),
    creneau_approuve: { date_locale: pub.creneau.date_locale, heure_locale: pub.creneau.heure_locale },
    signature: 'absente',
    signature_hmac_sha256: null,
    origine: 'ecran_administrateur',
    approuve_par: 'u-admin',
    approuve_le_utc: '2026-09-21T05:55:00Z',
  };
  const depot = depotFactice({
    lignes: [ligneExistante(pub, { approbation: humaine, url_media: urlHebergee(pub) })],
  });
  const client = clientFactice({ publications: [deposee(pub, { approbation: null })] });

  await passageAuto(depot, client, hebergeurFactice());

  const l = [...depot.file.values()][0];
  assert.equal(l.approbation.origine, 'ecran_administrateur');
  assert.equal(l.approbation.approuve_par, 'u-admin',
    'le nom de celui qui a approuvé ne doit pas être remplacé par « automatique »');
});

test('un APPROBATION.json déposé dans le Drive reste prioritaire sur l automatique', async () => {
  const pub = manifeste();
  const duDrive = approbationDe(pub);
  const depot = depotFactice();
  const client = clientFactice({ publications: [deposee(pub, { approbation: duDrive })] });

  const bilan = await passageAuto(depot, client, hebergeurFactice());

  const l = [...depot.file.values()][0];
  assert.equal(l.approbation.approuve_par, 'compte-applicatif-gassim');
  assert.equal(l.approbation.origine, undefined, 'c est bien le dépôt qui est rangé');
  assert.equal(bilan.approbation_auto.posees, 0);
});

test('⛔ approbation_automatique = false : AUCUNE approbation n est posée', async () => {
  // Le retour arrière du dirigeant, celui qui ne demande pas de redéploiement.
  const pub = manifeste();
  const depot = depotFactice();
  const client = clientFactice({ publications: [deposee(pub, { approbation: null })] });

  const bilan = await alimenterFile({
    depot, client, medias: hebergeurFactice(), instant: INSTANT, tracer: muet,
    approbationAutomatique: false,
  });

  assert.equal([...depot.file.values()][0].approbation, null);
  assert.equal(bilan.approbation_auto.posees, 0);
  assert.equal(bilan.approbation_auto.reglage, 'desactivee');
});

test('les DEUX canaux d une publication sont approuvés séparément, chacun pour lui-même', async () => {
  // Une approbation qui porterait `canaux_approuves: ['facebook','instagram']`
  // sur la ligne Facebook approuverait Instagram sans que rien ne l ait examiné.
  const pub = manifeste({
    canaux: [
      { canal: 'facebook', compte_cible_id: PAGE_ID, surface: 'feed' },
      { canal: 'instagram', compte_cible_id: IG_ID, surface: 'feed' },
    ],
    captions: {
      facebook: { chemin_relatif: 'caption_facebook.txt', sha256: 'b'.repeat(64) },
      instagram: { chemin_relatif: 'caption_instagram.txt', sha256: 'e'.repeat(64) },
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
    fichiers: { 'cap-fb': 'Texte Facebook', 'cap-ig': 'Texte Instagram' },
  });

  const bilan = await passageAuto(depot, client, hebergeurFactice());

  assert.equal(bilan.approbation_auto.posees, 2);
  for (const l of depot.file.values()) {
    assert.deepEqual(l.approbation.canaux_approuves, [l.canal],
      'chaque approbation ne couvre QUE le canal de sa ligne');
  }
});

test('le journal DIT que la machine a approuvé — ça ne se fait pas en silence', async () => {
  const pub = manifeste();
  const depot = depotFactice();
  const client = clientFactice({ publications: [deposee(pub, { approbation: null })] });

  await passageAuto(depot, client, hebergeurFactice());

  const entree = depot.journal.find((e) => e.evenement === 'alimentation');
  assert.ok(entree, 'un passage qui approuve doit écrire au journal');
  assert.match(entree.resume, /approbation automatique activée : 1 posée/);
  assert.equal(entree.bilan.approbation_auto.posees, 1,
    'le bilan rangé en base doit porter le détail, pas seulement la phrase');
});

test('⛔ l alimentation n appelle TOUJOURS aucun verrou, même pour approuver', async () => {
  // La politique d'approbation est lue par `api/autopost.js` et PASSÉE en
  // paramètre. Si ce module lisait lui-même la ligne de contrôle, alimenter
  // dépendrait de l'interrupteur — et on ne pourrait plus rien vérifier chaîne
  // à l'arrêt, donc on ouvrirait les verrous à l'aveugle.
  const pub = manifeste();
  const depot = depotFactice();
  const client = clientFactice({ publications: [deposee(pub, { approbation: null })] });

  await passageAuto(depot, client, hebergeurFactice());

  assert.equal(depot.appels.includes('lireArretGlobal'), false);
  assert.equal(depot.appels.includes('lireReglages'), false);
});

test('🔴 le gestionnaire HTTP lit le réglage en base et le passe à l alimentation', async () => {
  const { creerGestionnaireAutopost } = await import('../api/autopost.js');
  const avant = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'secret-de-test';

  const vus = [];
  const depot = {
    journal: [],
    async lireReglages() {
      return { actif: false, mode: 'dry_run', plafond: 4, approbation_automatique: false };
    },
    async lireArretGlobal() { return { actif: false, mode: 'dry_run', plafond: 4 }; },
    async lireFile() { return []; },
    async lireAReconcilier() { return []; },
    async compterPubliesLe() { return 0; },
    async journaliser(e) { depot.journal.push(e); },
  };

  const gestionnaire = creerGestionnaireAutopost({
    depot,
    client: { disponible: false },
    alimente: async (arg) => { vus.push(arg.approbationAutomatique); return { creees: 0, ecartees: [] }; },
  });

  const rep = repFactice();
  await gestionnaire(
    { url: '/api/autopost-tick', method: 'GET', headers: { authorization: 'Bearer secret-de-test' }, query: {} },
    rep,
  );

  if (avant === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = avant;
  assert.equal(rep.statut, 200);
  assert.deepEqual(vus, [false],
    'un false posé en base doit arriver jusqu au module, sans redéploiement');
});

test('🔴 réglages illisibles : on applique le DÉFAUT du système, on n invente rien', async () => {
  const { creerGestionnaireAutopost } = await import('../api/autopost.js');
  const avant = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'secret-de-test';

  const vus = [];
  const depot = depotAlArret();
  depot.lireReglages = async () => { throw new Error('base injoignable'); };

  const gestionnaire = creerGestionnaireAutopost({
    depot,
    client: { disponible: false },
    alimente: async (arg) => { vus.push(arg.approbationAutomatique); return { creees: 0, ecartees: [] }; },
  });

  const rep = repFactice();
  await gestionnaire(
    { url: '/api/autopost-tick', method: 'GET', headers: { authorization: 'Bearer secret-de-test' }, query: {} },
    rep,
  );

  if (avant === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = avant;
  assert.equal(rep.statut, 200, 'une lecture de réglage ratée ne doit pas faire tomber le passage');
  assert.deepEqual(vus, [true], 'le défaut du système est true — décision de Gassim du 19/09/2026');
});

test('⛔ approuver n est pas publier : l alimentation ne touche ni actif ni mode', async () => {
  const pub = manifeste();
  const depot = depotFactice({ actif: false, mode: 'dry_run' });
  const client = clientFactice({ publications: [deposee(pub, { approbation: null })] });

  await passageAuto(depot, client, hebergeurFactice());

  const l = [...depot.file.values()][0];
  assert.equal(l.approbation?.approuve, true);
  assert.equal(l.etat, 'scheduled', 'approuvée, oui — partie, non');
  assert.equal(l.id_distant, null, 'aucun témoin d effet ne doit naître d une approbation');
});

/* ═══════════════════════════════════════════════════════════════════════════
   13. 🔴 LE DÉFAUT DU 19/09/2026 À 13 H 29 — la file ne convergeait pas

   Mesuré en production, sur la base réelle :

     avant le passage : 42 lignes ·  0 approuvée · 9 avec url_media · 6 objets
     après le passage : 44 lignes · 44 approuvées · 3 avec url_media · 8 objets

   Six adresses perdues, et AUCUN objet retiré du bucket (6 → 8). L'approbation
   automatique, en s'ajoutant aux 42 lignes, faisait changer l'empreinte de la
   LIGNE ; le code lisait ce changement comme « le contenu déposé a changé »,
   redemandait un hébergement, le budget était épuisé, l'hébergement était
   REPORTÉ — et la règle « dépôt changé + réhébergement reporté ⇒ l'adresse
   tombe » effaçait une adresse parfaitement valable.

   Chaque passage défaisait donc le travail du précédent. Ces tests exigent la
   distinction qui manquait : « le MÉDIA a changé » n'est pas « la ligne a été
   réécrite ».
   ═══════════════════════════════════════════════════════════════════════════ */

test('🔴🔴 média INCHANGÉ + hébergement REPORTÉ : l adresse est GARDÉE', async () => {
  // Le cas exact de 13 h 29 : la ligne est réécrite parce qu'une approbation
  // automatique vient s'y ajouter, et le budget de téléversements est épuisé.
  // Aucun fichier n'a bougé : l'objet du bucket est toujours le bon.
  const pub = manifeste();
  const adresse = urlHebergee(pub);
  const depot = depotFactice({
    lignes: [ligneExistante(pub, { approbation: null, url_media: adresse })],
  });
  const client = clientFactice({ publications: [deposee(pub, { approbation: null })] });
  const medias = hebergeurFactice();

  const bilan = await passageAuto(depot, client, medias, { televersementsMax: 0 });

  const l = [...depot.file.values()][0];
  assert.equal(l.url_media, adresse,
    '⛔ l adresse d un média inchangé ne se perd pas parce que la ligne a été réécrite');
  assert.equal(l.approbation?.approuve, true, 'et l approbation a bien été posée');
  assert.deepEqual(medias.appels, [],
    'le chemin attendu est déjà celui de l adresse : rien à redemander au stockage');
  assert.equal(bilan.medias.reportes, 0,
    'on ne REPORTE pas un hébergement qu on n a aucune raison de demander');
});

test('🔴 média CHANGÉ + hébergement REPORTÉ : l ancienne adresse TOMBE (règle d origine)', async () => {
  // La règle de la nuit du 19/09 tient toujours, et c est elle qui empêche de
  // publier la vieille affiche sous la nouvelle légende. Ici les octets ont
  // vraiment changé : Google rend une AUTRE empreinte pour le même nom.
  const pub = manifeste();
  const depot = depotFactice({
    lignes: [ligneExistante(pub, { approbation: null, url_media: urlHebergee(pub) })],
  });
  const redepose = deposee(pub, { approbation: null });
  redepose.medias[0].md5 = 'e'.repeat(32); // l affiche a été corrigée dans le Drive
  const client = clientFactice({ publications: [redepose] });

  const bilan = await passageAuto(depot, client, hebergeurFactice(), { televersementsMax: 0 });

  const l = [...depot.file.values()][0];
  assert.equal(l.url_media, null,
    'une adresse qui pointe sur l image d avant la correction ne se garde pas');
  assert.equal(bilan.medias.reportes, 1, 'l hébergement a bien été demandé, puis reporté');
  assert.equal(l.derniere_erreur, null, 'un report volontaire n est pas une erreur');
});

test('🔴 média CHANGÉ sans que le MANIFESTE bouge : l adresse tombe quand même', async () => {
  // Le cas que `version_contenu` ne verrait pas : ChatGPT remplace l image sans
  // toucher publication.json. L empreinte de la LIGNE est identique, et
  // pourtant l objet hébergé n est plus le bon. C est le md5 mesuré par Google
  // qui tranche — pas un numéro de version que l émetteur peut oublier.
  const pub = manifeste();
  const depot = depotFactice({
    lignes: [ligneExistante(pub, { approbation: null, url_media: urlHebergee(pub) })],
  });
  const redepose = deposee(pub, { approbation: null });
  redepose.medias[0].md5 = 'f'.repeat(32);
  const client = clientFactice({ publications: [redepose] });
  const medias = hebergeurFactice();

  // Passage SANS approbation automatique : rien d autre ne change sur la ligne.
  await passage(depot, client, medias);

  assert.deepEqual(medias.appels, ['PUB-2026-S39-1-01|facebook'],
    'des octets différents doivent faire redemander une adresse, manifeste identique ou non');
  assert.equal([...depot.file.values()][0].url_media, urlHebergee(pub, { md5: 'f'.repeat(32) }));
});

test('🔴🔴 DEUX PASSAGES SUCCESSIFS CONVERGENT : le second ne défait pas le premier', async () => {
  // La forme EXACTE du 19/09 à 13 h 29 : des lignes DÉJÀ en file, aucune
  // approuvée, une PARTIE déjà hébergée — et l'approbation automatique qui
  // vient s'ajouter à toutes. Le budget n'en laisse héberger qu'une par
  // passage : la file doit MONTER puis TENIR, jamais redescendre.
  const pubs = ['09', '10', '11'].map((h, i) => manifeste({
    id: `PUB-2026-S39-1-0${i + 1}`, heure: `${h}:00`,
  }));
  const deposes = pubs.map((p, i) => deposee(p, { dossier: `p${i}` }));
  const depot = depotFactice({
    lignes: pubs.map((p, i) => ligneExistante(p, {
      approbation: null,
      // La dernière est déjà hébergée — comme 9 des 42 lignes ce midi-là.
      url_media: i === 2 ? urlHebergee(p) : null,
    })),
  });
  const client = clientFactice({ publications: deposes });

  const avecAdresse = () => [...depot.file.values()].filter((l) => l.url_media).length;
  assert.equal(avecAdresse(), 1, 'point de départ : une seule ligne hébergée');

  const vues = [];
  for (let tour = 0; tour < 4; tour += 1) {
    await passageAuto(depot, client, hebergeurFactice(), { televersementsMax: 1 });
    vues.push(avecAdresse());
  }

  assert.deepEqual(vues, [2, 3, 3, 3],
    `la file doit MONTER puis TENIR ; observé : 1 → ${vues.join(' → ')}`);
  assert.equal(depot.file.size, 3, 'et toujours trois lignes, pas une de plus');
  assert.equal([...depot.file.values()].every((l) => l.approbation?.approuve), true);
});

test('🔴 un passage qui ne change RIEN ne réécrit rien — même avec l approbation déjà posée', async () => {
  const pub = manifeste();
  const depot = depotFactice();
  const client = clientFactice({ publications: [deposee(pub, { approbation: null })] });

  await passageAuto(depot, client, hebergeurFactice());
  const bilan2 = await passageAuto(depot, client, hebergeurFactice());

  assert.equal(bilan2.inchangees, 1);
  assert.equal(bilan2.mises_a_jour, 0);
  assert.equal([...depot.file.values()][0].url_media, urlHebergee(pub));
});

test('⛔ empreinte md5 ABSENTE : on retombe sur la règle d avant, on ne devine pas', async () => {
  // Sans empreinte, la question « est-ce le même fichier ? » n est pas
  // décidable. `null` ne veut pas dire « inchangé » : le code retombe alors
  // exactement sur la règle d avant (l empreinte de la ligne), qui est la plus
  // prudente des deux. Ici le dépôt n a pas bougé : l adresse se garde.
  const pub = manifeste();
  const adresse = urlHebergee(pub);
  const depot = depotFactice({
    lignes: [ligneExistante(pub, { approbation: null, url_media: adresse })],
  });
  const sansEmpreinte = deposee(pub, { approbation: null });
  sansEmpreinte.medias[0].md5 = null;
  const client = clientFactice({ publications: [sansEmpreinte] });
  const medias = hebergeurFactice();

  await passage(depot, client, medias);

  assert.equal([...depot.file.values()][0].url_media, adresse);
  assert.deepEqual(medias.appels, [], 'dépôt inchangé : rien à redemander');
});

/* ═══════════════════════════════════════════════════════════════════════════
   14. 🔴 LES DEUX FORMES DE LÉGENDE — la contradiction des documents 31 et 37

   Le document 31 décrit `captions: { facebook: { chemin_relatif: "…" } }` :
   un fichier du dossier. Le document 37 montre `captions: { facebook: "🎒 …" }` :
   le texte lui-même. ChatGPT a suivi le 37, fidèlement, et le code n'attendait
   que le 31 : `declaration?.chemin_relatif` valait `undefined`, la ligne était
   écartée en `legende_absente`, et une publication prévue le lendemain matin ne
   pouvait pas partir.

   On accepte donc les DEUX. Et la forme en ligne n'est pas qu'une tolérance :
   elle supprime un téléchargement par canal et par publication.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Le manifeste tel que ChatGPT le dépose depuis le document 37 : du texte. */
function manifesteLegendeEnLigne(texte = '🎒 Rentrée : commençons par une liste claire\n\nFamilles, écoles…') {
  return manifeste({ captions: { facebook: texte } });
}

test('🔴🔴 une légende EN LIGNE (une chaîne) entre en file, telle quelle', async () => {
  const pub = manifesteLegendeEnLigne();
  const depot = depotFactice();
  // ⛔ Le dossier ne porte AUCUN fichier de légende : c'est tout l'intérêt.
  const client = clientFactice({
    publications: [deposee(pub, { captions: { facebook: { chemin_relatif: null, fichier_id: null, texte: pub.captions.facebook } } })],
    fichiers: {},
  });

  const bilan = await passage(depot, client, hebergeurFactice());

  assert.equal(bilan.creees, 1, `écartée : ${JSON.stringify(bilan.ecartees)}`);
  assert.equal([...depot.file.values()][0].legende, pub.captions.facebook,
    'la légende doit être celle du manifeste, au caractère près');
  assert.equal(client.appels.filter((a) => a.startsWith('telecharger:')).length, 0,
    '🔴 une légende déjà là ne coûte AUCUN téléchargement');
});

test('la forme FICHIER continue de marcher exactement comme avant', async () => {
  const pub = manifeste(); // captions = { facebook: { chemin_relatif: … } }
  const depot = depotFactice();
  const client = clientFactice({ publications: [deposee(pub)] });

  const bilan = await passage(depot, client, hebergeurFactice());

  assert.equal(bilan.creees, 1);
  assert.match([...depot.file.values()][0].legende, /Flocage textile/);
  assert.deepEqual(client.appels.filter((a) => a.startsWith('telecharger:')), ['telecharger:cap-fb']);
});

test('⛔⛔ la chaîne littérale « undefined » est REFUSÉE comme légende', async () => {
  // Elle ne vient pas d'un humain : c'est une concaténation ratée chez
  // l'émetteur, arrivée jusqu'au disque. La publier, ce serait poster le mot
  // « undefined » sur la page Facebook de l'imprimerie.
  for (const fantome of ['undefined', 'null', 'None', '   ', '']) {
    const pub = manifeste({ captions: { facebook: fantome } });
    const depot = depotFactice();
    const client = clientFactice({
      publications: [deposee(pub, { captions: { facebook: { chemin_relatif: null, fichier_id: null, texte: null, invalide: 'x' } } })],
    });

    const bilan = await passage(depot, client, hebergeurFactice());

    assert.equal(bilan.creees, 0, `« ${fantome} » ne doit JAMAIS entrer en file`);
    assert.equal(bilan.ecartees[0].motif, MOTIFS.LEGENDE_INVALIDE,
      `« ${fantome} » : le motif doit dire qu il y a à corriger, pas qu il manque une ligne`);
  }
});

test('⛔ « undefined » comme NOM DE FICHIER est refusé aussi, et avec son motif', async () => {
  // Le cas mesuré ce matin-là sur PUB-2026-S38-6-01 et PUB-2026-S38-7-01.
  const pub = manifeste({ captions: { facebook: { chemin_relatif: 'undefined' } } });
  const depot = depotFactice();
  const client = clientFactice({ publications: [deposee(pub, { captions: { facebook: {} } })] });

  const bilan = await passage(depot, client, hebergeurFactice());

  assert.equal(bilan.creees, 0);
  assert.equal(bilan.ecartees[0].motif, MOTIFS.LEGENDE_INVALIDE);
  assert.match(bilan.ecartees[0].detail, /undefined/,
    'le motif doit NOMMER ce qui a été déclaré — sinon on cherche au mauvais endroit');
});

test('⛔ un FICHIER de légende qui ne contient que « undefined » est refusé', async () => {
  // Le même accident, par l'autre chemin. Le fichier existe, il se lit, et ce
  // qu'il dit n'est pas publiable.
  const pub = manifeste();
  const depot = depotFactice();
  const client = clientFactice({
    publications: [deposee(pub)],
    fichiers: { 'cap-fb': 'undefined' },
  });

  const bilan = await passage(depot, client, hebergeurFactice());

  assert.equal(bilan.creees, 0);
  assert.equal(bilan.ecartees[0].motif, MOTIFS.LEGENDE_INVALIDE);
});

test('⛔ une légende déclarée par un nombre est refusée — on ne la convertit pas', async () => {
  const pub = manifeste({ captions: { facebook: 42 } });
  const depot = depotFactice();
  const client = clientFactice({ publications: [deposee(pub, { captions: { facebook: {} } })] });

  const bilan = await passage(depot, client, hebergeurFactice());
  assert.equal(bilan.creees, 0);
  assert.equal(bilan.ecartees[0].motif, MOTIFS.LEGENDE_INVALIDE);
});

test('🔴 une légende EN LIGNE modifiée INVALIDE l approbation qui la couvrait', async () => {
  // Sans ça, une légende en ligne pourrait être entièrement réécrite après
  // approbation et partir quand même : elle n a pas de `sha256` à côté d elle,
  // donc le sceau doit porter l empreinte du TEXTE.
  const { verifierApprobation } = await import('../api/_lib/autopost-contrat.js');
  const v1 = manifesteLegendeEnLigne('Rentrée : listes scolaires, devis en 24 h.');
  const approbation = approbationDe(v1);
  assert.equal(
    verifierApprobation({ publication: v1, approbation, canal: 'facebook' }).approuve, true,
  );

  const corrige = manifesteLegendeEnLigne('Rentrée : PROMO -50 %, aujourd hui seulement !');
  assert.equal(
    verifierApprobation({ publication: corrige, approbation, canal: 'facebook' }).raison,
    'contenu_modifie_depuis_approbation',
    'une légende en ligne réécrite ne doit pas passer sous un accord ancien');
});

test('un canal de REMISE sans légende n est toujours pas écarté', async () => {
  // La règle d avant : personne ne publie sur un canal de remise, donc
  // l absence de texte n empêche rien. La forme en ligne ne l a pas changée.
  const pub = manifeste({
    canaux: [{ canal: 'whatsapp_handoff', compte_cible_id: null, surface: 'feed' }],
    captions: {},
  });
  const depot = depotFactice();
  const client = clientFactice({ publications: [deposee(pub, { captions: {} })] });

  const bilan = await passage(depot, client, hebergeurFactice());
  assert.equal(bilan.creees, 1, `écartée : ${JSON.stringify(bilan.ecartees)}`);
  assert.equal([...depot.file.values()][0].legende, null);
});

test('🔴 DEUX CANAUX, UNE SEULE AFFICHE : le stockage n est interrogé qu une fois', async () => {
  // Facebook et Instagram publient la même image : même fichier, même md5, donc
  // le MÊME objet dans le bucket. Une question par canal, c était un
  // aller-retour de plus par publication pour une réponse déjà connue.
  const pub = manifeste({
    canaux: [
      { canal: 'facebook', compte_cible_id: PAGE_ID, surface: 'feed' },
      { canal: 'instagram', compte_cible_id: IG_ID, surface: 'feed' },
    ],
    captions: {
      facebook: 'Flocage textile à Moanda — OG-01-S39',
      instagram: 'Flocage textile à Moanda ✨ — OG-01-S39',
    },
  });
  const depot = depotFactice();
  const client = clientFactice({
    publications: [deposee(pub, {
      captions: {
        facebook: { chemin_relatif: null, fichier_id: null, texte: pub.captions.facebook },
        instagram: { chemin_relatif: null, fichier_id: null, texte: pub.captions.instagram },
      },
    })],
  });
  const medias = hebergeurFactice();

  const bilan = await passage(depot, client, medias);

  assert.equal(bilan.creees, 2, `écartées : ${JSON.stringify(bilan.ecartees)}`);
  assert.equal(medias.appels.length, 1,
    `une seule question au stockage pour un seul objet : ${medias.appels.join(', ')}`);
  // ⛔ Et les DEUX lignes portent bien l adresse : partager la réponse ne doit
  //    pas priver le second canal de son média.
  assert.equal([...depot.file.values()].filter((l) => l.url_media === urlHebergee(pub)).length, 2);
});
