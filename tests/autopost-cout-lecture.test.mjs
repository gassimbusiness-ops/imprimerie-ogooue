/**
 * LE BANC DE COÛT D'UN PASSAGE — et pourquoi un chiffre sans mesure ne vaut rien.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LE DÉFAUT MESURÉ EN PRODUCTION, LE 19/09/2026 À 13 H 29
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Journal du passage réel, mot pour mot :
 *
 *   « 41 reporté(s) au prochain passage (budget temps épuisé,
 *     **51714 ms** sur un budget de 25000 ms) »
 *
 * Le chronomètre part au DÉBUT de l'alimentation. Le budget d'hébergement
 * (25 s) était donc entièrement consommé par la lecture du Drive, avant le
 * premier téléversement — d'où 41 médias reportés et 2 seulement hébergés.
 *
 * Mais le report n'est pas le vrai danger. `vercel.json` déclare
 * `maxDuration: 60` pour `api/autopost.js`, et la lecture seule en prenait 52
 * pour **16 publications** : 86 % du plafond. À 20 publications la fonction
 * EXPIRE — et une fonction qui expire n'empêche pas seulement d'alimenter, elle
 * empêche de PUBLIER ce qui est déjà en file.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 🔴 CE QUE CE BANC MESURE, ET POURQUOI CE N'EST PAS LE NOMBRE D'APPELS
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Le temps d'un passage ne vient pas d'un calcul : il vient d'allers-retours
 * réseau. Et ce qui coûte, ce n'est pas COMBIEN il y en a — c'est combien
 * attendent les uns derrière les autres. Six appels lancés ensemble coûtent le
 * temps d'UN ; six appels en file indienne coûtent six fois plus.
 *
 * Ce banc mesure donc les DEUX, et les deux sont des mesures, pas des
 * estimations :
 *
 *   • `total` — le nombre d'appels Google, compté par `compter()` sur le
 *     registre du faux serveur ;
 *   • `profondeur` — la longueur de la plus longue CHAÎNE d'appels, obtenue
 *     avec une horloge virtuelle : chaque appel coûte exactement 1, les appels
 *     lancés au même instant virtuel se déroulent ensemble. C'est le temps du
 *     passage, en unités d'aller-retour.
 *
 * ⛔ L'AVANT N'EST PAS RACONTÉ, IL EST MESURÉ. Plutôt que de garder deux
 *    versions du code, le banc rejoue l'ancien comportement en posant la borne
 *    de concurrence à 1 : une borne de 1, c'est exactement la file indienne
 *    d'avant. Les deux chiffres du rapport sortent donc du même banc, le même
 *    jour, sur le même Drive simulé.
 *
 * ⛔ ZÉRO RÉSEAU : `fetch` est injecté (`tests/outils/faux-google.mjs`), et
 *    l'hébergement des médias est débranché — ce banc mesure la LECTURE.
 *
 * Lancer :  node --test tests/autopost-cout-lecture.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { creerClientDrive, viderCacheJeton } from '../api/_lib/drive.js';
import { alimenterFile } from '../api/_lib/autopost-alimentation.js';
import { enParalleleBorne, CONCURRENCE_PAR_DEFAUT } from '../api/_lib/concurrence.js';
import { instantUtcDepuisCreneau } from '../src/lib/dates.js';
import { fauxGoogle, f, d, compter } from './outils/faux-google.mjs';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const CLE = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const DOSSIER = '1RacinePublications';
const PAGE_ID = '100000000000001';
const IG_ID = '178000000000001';
const INSTANT = '2026-09-21T06:00:00Z';

const env = () => ({
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'robot@exemple.iam.gserviceaccount.com',
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: CLE,
  DRIVE_DOSSIER_PUBLICATIONS_ID: DOSSIER,
});

function muet() { /* un banc ne parle pas */ }

/* ═══════════════════════════════════════════════════════════════════════════
   L'HORLOGE VIRTUELLE — la profondeur, mesurée sans attendre une seconde

   Chaque appel réseau coûte 1 unité de temps virtuel. Les appels lancés au même
   instant se déroulent ENSEMBLE ; un appel lancé après la réponse d'un autre
   compte pour 1 de plus. L'horloge à la fin donne la longueur de la plus longue
   chaîne — c'est le temps du passage exprimé en allers-retours.

   ⚠️ Rien n'est chronométré en millisecondes RÉELLES : un test qui mesurerait
      la vraie horloge serait au bon vouloir de la machine, et un banc qui
      change de verdict selon la charge du portable ne mesure rien.
   ═══════════════════════════════════════════════════════════════════════════ */

async function mesurerProfondeur(executer) {
  let horloge = 0;
  let attentes = [];
  let fini = false;

  /** À intercaler dans le faux fetch : « cet appel prend un aller-retour ». */
  const unAllerRetour = () => new Promise((resoudre) => {
    attentes.push({ echeance: horloge + 1, resoudre });
  });

  const travail = (async () => executer(unAllerRetour))().finally(() => { fini = true; });

  let gardeFou = 0;
  while (!fini && gardeFou < 200_000) {
    gardeFou += 1;
    // Laisse toutes les microtâches se vider : les continuations des appels
    // déjà résolus doivent avoir lancé leurs propres appels avant qu'on
    // n'avance l'horloge, sinon on compterait deux vagues là où il n'y en a une.
    await new Promise((r) => setImmediate(r));
    if (fini || attentes.length === 0) continue;
    horloge = Math.min(...attentes.map((a) => a.echeance));
    const prets = attentes.filter((a) => a.echeance <= horloge);
    attentes = attentes.filter((a) => a.echeance > horloge);
    for (const a of prets) a.resoudre();
  }
  assert.ok(gardeFou < 200_000, 'le banc n a pas convergé : le travail ne finit pas');

  return { resultat: await travail, profondeur: horloge };
}

/* ═══════════════════════════════════════════════════════════════════════════
   LE DRIVE SIMULÉ — la disposition RÉELLE, telle que ChatGPT la dépose
   ═══════════════════════════════════════════════════════════════════════════ */

const MEDIA = 'OGOOUE_Textile_1080x1350_v01_BROUILLON.jpg';

function manifeste(n, { legendesEnLigne = false } = {}) {
  // `publication_id` suit le motif du contrat : PUB-AAAA-Snn-J-nn, où J est le
  // jour ISO (1 à 7). Un identifiant hors motif serait écarté par
  // `validerManifeste()`, et le banc mesurerait alors le coût d'un refus.
  const jourIso = 1 + (n % 7);
  const date = `2026-09-${String(20 + jourIso).padStart(2, '0')}`;
  const heure = `${String(8 + (n % 9)).padStart(2, '0')}:00`;
  return {
    schema_version: '2.0',
    publication_id: `PUB-2026-S39-${jourIso}-${String(n).padStart(2, '0')}`,
    campagne_id: 'CAMP-RENTREE-2026-09',
    version_contenu: 1,
    semaine_iso: '2026-S39',
    annee_iso: 2026,
    numero_semaine_iso: 39,
    jour_iso: jourIso,
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
      chemin_relatif: MEDIA,
      sha256: 'a'.repeat(64),
      mime_type: 'image/jpeg',
      largeur_px: 1080,
      hauteur_px: 1350,
      ordre_carrousel: 1,
      origine: 'chatgpt',
    }],
    // 🔴 Les DEUX formes admises depuis le 19/09/2026 au soir. La forme EN
    //    LIGNE ne coûte AUCUN téléchargement : c'est ce que le banc mesure.
    captions: legendesEnLigne
      ? {
        facebook: `🎒 Rentrée ${n} : commençons par une liste claire.`,
        instagram: `🎒 Rentrée ${n} ✨ — devis en 24 h.`,
        whatsapp_handoff: `Bonjour, voici la liste de la rentrée ${n}.`,
      }
      : {
        facebook: { chemin_relatif: 'caption_facebook.txt', sha256: 'b'.repeat(64) },
        instagram: { chemin_relatif: 'caption_instagram.txt', sha256: 'c'.repeat(64) },
        whatsapp_handoff: { chemin_relatif: 'caption_whatsapp.txt', sha256: 'e'.repeat(64) },
      },
    cta: 'Envoyez la date, les quantités et votre logo',
    code_provenance: `OG-${n}-S39`,
    offres: [{ offre_id: null, libelle: 'sans offre chiffrée', prix_affiche: false, valide_jusqu_au_local: null }],
    canaux: [
      { canal: 'facebook', compte_cible_id: PAGE_ID, surface: 'feed' },
      { canal: 'instagram', compte_cible_id: IG_ID, surface: 'feed' },
      { canal: 'whatsapp_handoff', compte_cible_id: null, surface: 'feed' },
    ],
  };
}

/**
 * Un Drive de `combien` publications, rangées comme dans le vrai :
 * `10_PUBLICATIONS / SEMAINE / JOUR / 1_POST_09H00 /` avec, dans le dernier
 * dossier, le manifeste, l'affiche et les DEUX fichiers de légende.
 */
function driveDe(combien, { legendesEnLigne = false } = {}) {
  const listes = { [DOSSIER]: [] };
  const dossiers = [];
  const manifestes = [];
  const fichiers = {};

  listes[DOSSIER] = [d('sem', 'WEEK_21-27Sept')];
  dossiers.push({ id: 'sem', name: 'WEEK_21-27Sept', parents: [DOSSIER] });
  listes.sem = [];

  for (let n = 1; n <= combien; n += 1) {
    const jour = `j${n}`;
    const post = `p${n}`;
    listes.sem.push(d(jour, `Jour_${n}`));
    dossiers.push({ id: jour, name: `Jour_${n}`, parents: ['sem'] });
    listes[jour] = [d(post, `${n}_POST`)];
    dossiers.push({ id: post, name: `${n}_POST`, parents: [jour] });

    listes[post] = [
      f(`json${n}`, 'publication.json', 'application/json'),
      f(`media${n}`, MEDIA, 'image/jpeg', { size: '240000', md5Checksum: 'd'.repeat(32) }),
      f(`capfb${n}`, 'caption_facebook.txt', 'text/plain'),
      f(`capig${n}`, 'caption_instagram.txt', 'text/plain'),
      f(`capwa${n}`, 'caption_whatsapp.txt', 'text/plain'),
    ];
    manifestes.push({ id: `json${n}`, name: 'publication.json', mimeType: 'application/json', parents: [post] });
    fichiers[`json${n}`] = JSON.stringify(manifeste(n, { legendesEnLigne }));
    fichiers[`capfb${n}`] = `Flocage textile à Moanda. 📞 060 44 46 34 — OG-${n}-S39`;
    fichiers[`capig${n}`] = `Flocage textile à Moanda ✨ — OG-${n}-S39`;
    fichiers[`capwa${n}`] = `Bonjour, voici notre offre rentrée — OG-${n}-S39`;
  }

  return { listes, dossiers, manifestes, fichiers };
}

/** Le dépôt : une file vide, en mémoire, qui accepte tout. */
function depotVide() {
  const file = new Map();
  return {
    file,
    async lireLignesDePublications() { return []; },
    async inserer(ligne) { file.set(ligne.cle_idempotence, ligne); return { insere: true, conflit: false }; },
    async mettreAJourDepuisDepot() { return true; },
    async annulerLigne() { return true; },
    async journaliser() { /* le journal n'est pas l'objet de ce banc */ },
  };
}

/**
 * UN PASSAGE COMPLET, mesuré : lecture du Drive + lecture des légendes.
 *
 * `borne` vaut 1 pour rejouer la file indienne d'AVANT, et
 * `CONCURRENCE_PAR_DEFAUT` pour l'APRÈS. Rien d'autre ne change.
 */
async function passageMesure(combien, borne, { legendesEnLigne = false } = {}) {
  viderCacheJeton();
  const depot = depotVide();
  const { listes, dossiers, manifestes, fichiers } = driveDe(combien, { legendesEnLigne });
  const g = fauxGoogle({
    listes,
    fichiers,
    dossiers,
    recherche: { 'publication.json': manifestes },
  });

  const { resultat, profondeur } = await mesurerProfondeur(async (unAllerRetour) => {
    const fetchMesure = async (url, options) => {
      // L'appel est LANCÉ maintenant ; il rendra sa réponse un aller-retour
      // plus tard. C'est exactement ce que fait le réseau.
      await unAllerRetour();
      return g.impl(url, options);
    };
    const client = creerClientDrive({ env: env(), fetchImpl: fetchMesure, concurrence: borne });
    return alimenterFile({
      depot,
      client,
      medias: null, // ce banc mesure la LECTURE, pas l'hébergement
      concurrenceLegendes: borne,
      instant: INSTANT,
      tracer: muet,
    });
  });

  return { bilan: resultat, cout: compter(g.appels), profondeur, cles: [...depot.file.keys()] };
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. LE BANC LUI-MÊME — on ne mesure pas avec un instrument non vérifié
   ═══════════════════════════════════════════════════════════════════════════ */

test('l horloge virtuelle compte une file indienne pour ce qu elle est', async () => {
  const { profondeur } = await mesurerProfondeur(async (tour) => {
    await tour(); await tour(); await tour();
  });
  assert.equal(profondeur, 3, 'trois appels enchaînés : trois allers-retours');
});

test('l horloge virtuelle compte des appels simultanés pour UN seul aller-retour', async () => {
  const { profondeur } = await mesurerProfondeur(async (tour) => {
    await Promise.all([tour(), tour(), tour(), tour(), tour(), tour()]);
  });
  assert.equal(profondeur, 1, 'six appels lancés ensemble ne coûtent que le temps d un');
});

test('la borne de concurrence borne VRAIMENT — six à la fois, jamais sept', async () => {
  let enCours = 0;
  let maximum = 0;
  await enParalleleBorne([...Array(30).keys()], 6, async () => {
    enCours += 1;
    maximum = Math.max(maximum, enCours);
    await new Promise((r) => setImmediate(r));
    enCours -= 1;
  });
  assert.equal(maximum, 6, `un parallélisme sans borne se ferait refuser par Google : ${maximum}`);
});

test('la concurrence bornée PRÉSERVE l ordre des résultats', async () => {
  // L'écran du gérant ne doit pas changer d'ordre d'un passage à l'autre sans
  // que rien n'ait changé dans le Drive.
  const ordre = await enParalleleBorne([5, 1, 4, 2, 3, 0, 6], 3, async (n) => {
    for (let i = 0; i < n; i += 1) await new Promise((r) => setImmediate(r));
    return n;
  });
  assert.deepEqual(ordre, [5, 1, 4, 2, 3, 0, 6]);
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. 🔴 LA MESURE — 16 PUBLICATIONS, AVANT ET APRÈS
   ═══════════════════════════════════════════════════════════════════════════ */

test('🔴🔴 16 PUBLICATIONS : le nombre d appels ne bouge pas, leur PROFONDEUR s effondre', async () => {
  const avant = await passageMesure(16, 1);
  const apres = await passageMesure(16, CONCURRENCE_PAR_DEFAUT);

  /* ── Le passage fait le même travail dans les deux cas ─────────────────── */
  assert.equal(avant.bilan.lues, 16, 'les 16 publications doivent être lues');
  assert.equal(apres.bilan.lues, 16);
  assert.equal(avant.bilan.creees, 48, '16 publications × 3 canaux = 48 lignes');
  assert.equal(apres.bilan.creees, 48);
  assert.equal(avant.bilan.ecartees.length, 0);
  assert.equal(apres.bilan.ecartees.length, 0);

  /* ── ⛔ EXACTEMENT LES MÊMES APPELS : on ne gagne rien en lisant moins ───
     1 jeton + 1 recherche + 1 index des dossiers + 16 listings
     + 16 manifestes + 48 légendes = 83. */
  assert.equal(apres.cout.total, avant.cout.total,
    `le nombre d appels doit être IDENTIQUE : ${avant.cout.total} → ${apres.cout.total}`);
  assert.equal(avant.cout.listings, 16, 'un listing par dossier de publication');
  assert.equal(avant.cout.telechargements, 16 + 48, '16 manifestes et 48 fichiers de légende');
  assert.equal(avant.cout.recherches, 1, 'une seule recherche par nom');
  assert.equal(avant.cout.index, 1, 'un seul index des dossiers — pas un par dossier');
  assert.equal(avant.cout.fiches, 0, 'l index répond : aucun files.get un par un');

  /* ── 🔴 UN SEUL JETON, même quand six appels partent ensemble ─────────── */
  assert.equal(apres.cout.jetons, 1,
    `six appels simultanés ne doivent demander qu un jeton : ${apres.cout.jetons}`);

  /* ── 🔴 CE QUI CHANGE : LA PROFONDEUR ──────────────────────────────────
     C'est elle, et elle seule, qui faisait 51 714 ms. */
  assert.ok(avant.profondeur >= 80,
    `l AVANT doit bien être une file indienne : ${avant.profondeur} allers-retours`);
  assert.ok(apres.profondeur <= avant.profondeur / 4,
    `la profondeur doit être divisée par au moins 4 : ${avant.profondeur} → ${apres.profondeur}`);

  // Le rapport porte ces chiffres : ils sont imprimés, pas racontés.
  console.log('[banc] 16 publications — appels : %d → %d · profondeur : %d → %d allers-retours',
    avant.cout.total, apres.cout.total, avant.profondeur, apres.profondeur);
});

test('🔴 LE VRAI DANGER : à 24 publications, la profondeur reste loin du plafond', async () => {
  // À 20 publications, la lecture en file indienne faisait EXPIRER la fonction
  // de 60 s — et une fonction qui expire n'empêche pas seulement d'alimenter :
  // elle empêche de publier ce qui est déjà en file.
  const avant = await passageMesure(24, 1);
  const apres = await passageMesure(24, CONCURRENCE_PAR_DEFAUT);

  assert.equal(apres.bilan.lues, 24);
  assert.ok(avant.profondeur > 118,
    `l AVANT devait dépasser le plafond : ${avant.profondeur} allers-retours`);
  assert.ok(apres.profondeur < avant.profondeur / 4,
    `${avant.profondeur} → ${apres.profondeur}`);

  console.log('[banc] 24 publications — appels : %d → %d · profondeur : %d → %d allers-retours',
    avant.cout.total, apres.cout.total, avant.profondeur, apres.profondeur);
});

test('la profondeur croît en PALIERS de six, pas d une marche par publication', async () => {
  // La preuve que le gain n'est pas un hasard de mesure : douze publications ne
  // coûtent pas deux fois six publications, elles coûtent deux paliers de plus.
  const six = await passageMesure(6, CONCURRENCE_PAR_DEFAUT);
  const douze = await passageMesure(12, CONCURRENCE_PAR_DEFAUT);
  const dixHuit = await passageMesure(18, CONCURRENCE_PAR_DEFAUT);

  const marches = [six.profondeur, douze.profondeur, dixHuit.profondeur];
  assert.ok(douze.profondeur - six.profondeur <= 6
    && dixHuit.profondeur - douze.profondeur <= 6,
  `chaque paquet de six ne doit ajouter que quelques allers-retours : ${marches.join(' / ')}`);
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. ⛔ LA CONCURRENCE NE DOIT RIEN CHANGER D'AUTRE

   Une optimisation qui change une réponse n'est pas une optimisation.
   ═══════════════════════════════════════════════════════════════════════════ */

test('⛔ même Drive, même résultat, même ORDRE — quelle que soit la borne', async () => {
  const serie = await passageMesure(16, 1);
  const parallele = await passageMesure(16, CONCURRENCE_PAR_DEFAUT);

  // 🔴 Les MÊMES lignes, dans le MÊME ordre d'insertion. C'est la seule chose
  //    qu'un parallélisme mal fait casserait en silence.
  assert.equal(serie.cles.length, 48);
  assert.deepEqual(serie.cles, parallele.cles,
    'la borne de concurrence ne doit changer ni les lignes ni leur ordre');
  assert.deepEqual(serie.bilan.ecartees, parallele.bilan.ecartees);
  assert.deepEqual(serie.bilan.ecartees_par_le_lecteur, parallele.bilan.ecartees_par_le_lecteur);
  assert.equal(serie.bilan.diagnostic, parallele.bilan.diagnostic);
  assert.equal(serie.bilan.message, parallele.bilan.message);
});

test('⛔ un dossier illisible n emporte pas les autres, même en parallèle', async () => {
  viderCacheJeton();
  const { listes, dossiers, manifestes, fichiers } = driveDe(8);
  // Le cinquième dossier refuse de se lister : Google rend un 404.
  listes.p5 = { statut: 404, corps: { error: { code: 404, message: 'File not found' } } };

  const g = fauxGoogle({ listes, fichiers, dossiers, recherche: { 'publication.json': manifestes } });
  const client = creerClientDrive({ env: env(), fetchImpl: g.impl });
  const bilan = await alimenterFile({
    depot: depotVide(), client, medias: null, instant: INSTANT, tracer: muet,
  });

  assert.equal(bilan.lues, 7, 'les sept autres publications doivent être lues');
  assert.equal(bilan.creees, 21);
  assert.equal(bilan.ecartees_par_le_lecteur.length, 1, 'et le dossier fautif est DIT, pas tu');
  assert.match(bilan.ecartees_par_le_lecteur[0].detail, /dossier inaccessible/);
});

test('⛔ une légende illisible n écarte QUE son canal, même lues en parallèle', async () => {
  viderCacheJeton();
  const { listes, dossiers, manifestes, fichiers } = driveDe(4);
  delete fichiers.capig3; // la légende Instagram de la 3ᵉ a disparu du Drive

  const g = fauxGoogle({ listes, fichiers, dossiers, recherche: { 'publication.json': manifestes } });
  const client = creerClientDrive({ env: env(), fetchImpl: g.impl });
  const bilan = await alimenterFile({
    depot: depotVide(), client, medias: null, instant: INSTANT, tracer: muet,
  });

  assert.equal(bilan.creees, 11, '4 × 3 canaux moins le seul canal privé de légende');
  assert.equal(bilan.ecartees.length, 1);
  assert.equal(bilan.ecartees[0].canal, 'instagram');
  assert.equal(bilan.ecartees[0].publication_id, manifeste(3).publication_id);
  assert.equal(bilan.ecartees[0].motif, 'legende_introuvable');
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. 🔴 LA LÉGENDE EN LIGNE — ce qu'elle retire d'un passage

   Elle n'a pas été acceptée pour faire plaisir à un document : elle SUPPRIME un
   téléchargement par canal et par publication. Sur le Drive réel — 16
   publications, trois canaux — c'est 48 allers-retours qui disparaissent, sur
   les 83 que coûtait un passage.
   ═══════════════════════════════════════════════════════════════════════════ */

test('🔴🔴 16 PUBLICATIONS × 3 CANAUX : la légende en ligne retire 48 appels', async () => {
  const enFichier = await passageMesure(16, CONCURRENCE_PAR_DEFAUT);
  const enLigne = await passageMesure(16, CONCURRENCE_PAR_DEFAUT, { legendesEnLigne: true });

  // ⛔ Le MÊME travail : les mêmes lignes, avec les mêmes légendes dedans.
  assert.equal(enLigne.bilan.creees, 48, `écartées : ${JSON.stringify(enLigne.bilan.ecartees)}`);
  assert.deepEqual(enLigne.cles, enFichier.cles, 'les mêmes 48 lignes, aux mêmes clés');

  assert.equal(enFichier.cout.telechargements - enLigne.cout.telechargements, 48,
    `48 téléchargements doivent disparaître : ${enFichier.cout.telechargements} → ${enLigne.cout.telechargements}`);
  assert.equal(enLigne.cout.telechargements, 16, 'il ne reste que les 16 manifestes');

  assert.ok(enLigne.profondeur < enFichier.profondeur,
    `${enFichier.profondeur} → ${enLigne.profondeur} allers-retours`);

  console.log('[banc] 16 publications × 3 canaux — légendes en FICHIER : %d appels, %d de profondeur '
    + '· légendes EN LIGNE : %d appels, %d de profondeur',
  enFichier.cout.total, enFichier.profondeur, enLigne.cout.total, enLigne.profondeur);
});

test('🔴 LE CUMUL DES DEUX CORRECTIONS, sur le Drive réel de 16 publications', async () => {
  // C'est le chiffre qui compte pour Gassim : ce que coûtait un passage avant,
  // et ce qu'il coûte maintenant que ChatGPT dépose des légendes en ligne.
  const avant = await passageMesure(16, 1);
  const apres = await passageMesure(16, CONCURRENCE_PAR_DEFAUT, { legendesEnLigne: true });

  assert.ok(apres.profondeur <= avant.profondeur / 8,
    `la profondeur doit être divisée par au moins 8 : ${avant.profondeur} → ${apres.profondeur}`);

  console.log('[banc] CUMUL 16 publications — appels : %d → %d · profondeur : %d → %d allers-retours',
    avant.cout.total, apres.cout.total, avant.profondeur, apres.profondeur);
});
