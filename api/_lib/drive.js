/**
 * Auto-poster — LE LECTEUR GOOGLE DRIVE. La moitié de la chaîne qui manquait.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CE QU'IL CORRIGE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Jusqu'au 18/09/2026, `api/autopost.js` VÉRIFIAIT la présence de trois
 * variables Google et affichait « Accès Drive configuré » quand elles y
 * étaient. Aucune ligne n'allait chercher un fichier dans le Drive : le voyant
 * pouvait passer au vert sans que rien ne fonctionne. C'est le même faux témoin
 * que le badge « Sans mdp » et que le score fabriqué à 0, corrigés cette
 * semaine. Ce module remplace la vérification par une LECTURE RÉELLE.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CE QUE CE MODULE FAIT — ET CE QU'IL NE FERA JAMAIS
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   ✅ signer un JWT RS256 et l'échanger contre un jeton d'accès Google ;
 *   ✅ lister un dossier, télécharger un fichier ;
 *   ✅ valider ce qu'il lit contre le contrat v2.0 (`autopost-contrat.js`) ;
 *   ✅ garder le jeton en mémoire tant qu'il est valable.
 *
 *   ⛔ il n'écrit RIEN dans le Drive. La portée demandée est
 *      `drive.readonly`, et le partage est en Lecteur. Deux verrous, pas un.
 *      Un test échoue si une portée en écriture apparaît dans cette source, et
 *      un autre échoue si un appel autre que l'échange de jeton n'est pas GET ;
 *   ⛔ il n'écrit RIEN en base. Il rend des objets, la décision appartient à
 *      `autopost-selection.js` ;
 *   ⛔ il ne RÉPARE rien. Un fichier hors contrat est écarté avec un motif
 *      lisible. Une publication « réparée » en silence est une publication que
 *      personne n'a approuvée.
 *
 * Aucune dépendance npm : `node:crypto` signe le JWT. Le dépôt n'a pas
 * `googleapis` et n'a aucune raison de l'installer pour trois appels HTTP.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ LE PIÈGE N°1 : LE FORMAT DE LA CLÉ PRIVÉE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Le JSON du compte de service porte la clé avec des `\n` ÉCHAPPÉS (deux
 * caractères : une barre oblique inverse, puis un `n`). Selon la façon dont
 * elle a été collée dans Vercel, la variable d'environnement contient :
 *
 *   - soit de VRAIS retours à la ligne (collage depuis le presse-papier) ;
 *   - soit la suite littérale `\n` (copie du JSON tel quel) ;
 *   - soit l'une des deux, ENTOURÉE de guillemets (copie avec les délimiteurs).
 *
 * `normaliserClePrivee()` accepte les trois. Une clé mal lue ne produit pas un
 * message clair : elle produit une erreur de signature incompréhensible, ou un
 * `invalid_grant` qu'on passe une heure à attribuer au partage du dossier.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 🔴 CE QUI COMPTE PLUS QUE LE CODE : QUATRE PANNES, QUATRE PHRASES
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Chacune appelle un geste DIFFÉRENT. Un message unique pour quatre causes fait
 * perdre une heure.
 *
 *   | Diagnostic              | Ce qui se passe                | Le geste |
 *   |-------------------------|--------------------------------|----------|
 *   | `non_configure`         | une variable manque            | Gassim les pose dans Vercel |
 *   | `cle_refusee`           | Google refuse la signature     | recoller la clé, ou la régénérer |
 *   | `dossier_inaccessible`  | jeton bon, dossier introuvable | **partager le dossier** — le cas le plus probable |
 *   | `dossier_vide`          | tout marche, rien n'est déposé | attendre ChatGPT |
 *
 * `sonderDrive()` ne lève JAMAIS : un écran ne doit pas blanchir parce que
 * Google tousse (leçon du 14/09 : 112 tests verts, application entièrement
 * blanche en production).
 */
import crypto from 'node:crypto';
import { formaterInstantUtc, dateLocaleDepuisInstantUtc } from '../../src/lib/dates.js';
import { validerManifeste, lireDeclarationLegende } from './autopost-contrat.js';
import { enParalleleBorne, CONCURRENCE_PAR_DEFAUT } from './concurrence.js';

/* ═══════════════════════════════════════════════════════════════════════════
   CONSTANTES
   ═══════════════════════════════════════════════════════════════════════════ */

/** ⛔ LECTURE SEULE. Le partage Drive est en Lecteur ; la portée le redit. */
export const PORTEE_DRIVE_LECTURE = 'https://www.googleapis.com/auth/drive.readonly';

/** Le point d'échange « JWT signé → jeton d'accès » du compte de service. */
export const URL_JETON = 'https://oauth2.googleapis.com/token';

/** API Drive v3. Épinglée : une version flottante change sous les pieds. */
export const BASE_DRIVE = 'https://www.googleapis.com/drive/v3';

/** Le type MIME d'un dossier Drive. Un dossier est un « fichier » chez Google. */
export const MIME_DOSSIER = 'application/vnd.google-apps.folder';

/** Le manifeste, et l'approbation qui ne doit JAMAIS être écrite par ChatGPT. */
export const NOM_MANIFESTE = 'publication.json';
export const NOM_APPROBATION = 'APPROBATION.json';

/** Les trois variables, dans l'ordre où elles sont réclamées. */
export const VARIABLES_REQUISES = Object.freeze([
  'GOOGLE_SERVICE_ACCOUNT_EMAIL',
  'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
  'DRIVE_DOSSIER_PUBLICATIONS_ID',
]);

/** Les états possibles. Chacun mène à un geste différent. */
export const DIAGNOSTICS = Object.freeze({
  OK: 'ok',
  NON_CONFIGURE: 'non_configure',
  CLE_REFUSEE: 'cle_refusee',
  DOSSIER_INACCESSIBLE: 'dossier_inaccessible',
  DOSSIER_VIDE: 'dossier_vide',
  /**
   * ⛔ Le cinquième état, ajouté le 18/09/2026 sur relevé terrain : ChatGPT a
   * déposé 77 fichiers, et AUCUN ne respecte le contrat. Dire « aucune
   * publication déposée » dans ce cas envoie Gassim revérifier un partage de
   * dossier qui marche très bien. « Des fichiers sont là, rien n'est
   * publiable » est une panne complètement différente — celle d'un dépôt qui ne
   * suit pas le format, pas celle d'un accès.
   */
  RIEN_DE_CONFORME: 'rien_de_conforme',
  PANNE: 'panne',
});

/**
 * Marge avant expiration. Un jeton qui expire dans 40 secondes ne doit pas
 * partir en vol : l'appel qui l'utilise peut durer plus longtemps que ça.
 */
const MARGE_EXPIRATION_MS = 60_000;

/** Durée de vie demandée pour le JWT. Google plafonne à une heure. */
const DUREE_JWT_S = 3600;

/**
 * Garde-fous de parcours. Une fonction serverless a un temps borné et le plan
 * Hobby une facture : on ne se promène pas indéfiniment dans une arborescence.
 */
const PROFONDEUR_MAX = 4;
const REQUETES_MAX = 150;

/**
 * 🔴 COMBIEN DE DOSSIERS DE PUBLICATION ON EXAMINE À LA FOIS.
 *
 * Ce n'est PAS une optimisation de confort : c'est la correction du défaut
 * mesuré le 19/09/2026 à 13 h 29 — 51 714 ms de lecture pour 16 publications,
 * dans une fonction plafonnée à 60 s. Le temps venait d'une file indienne :
 * chaque dossier attendait que le précédent ait rendu son manifeste, alors
 * qu'aucun ne dépend d'aucun autre.
 *
 * Le nombre d'appels ne change pas d'un seul : c'est leur PROFONDEUR qui tombe.
 * Voir `api/_lib/concurrence.js` pour pourquoi la borne existe (les quotas
 * Drive) et `tests/autopost-cout-lecture.test.mjs` pour la mesure avant/après.
 */
const CONCURRENCE_DRIVE = CONCURRENCE_PAR_DEFAUT;

/**
 * Combien de dossiers-FEUILLES sans manifeste la lecture par recherche accepte
 * d'ouvrir pour dire ce qui y traîne.
 *
 * Elle n'en a pas besoin pour trouver les publications — la recherche par nom
 * les lui donne. Elle les ouvre pour ne pas TAIRE un jour où ChatGPT a déposé
 * une affiche sans son `publication.json` : ce dossier-là doit s'afficher au
 * gérant avec son motif. Dans une semaine propre il n'y en a aucun. La borne
 * existe pour qu'un Drive encombré ne transforme pas une lecture en inventaire.
 */
const INSPECTION_FEUILLES_MAX = 40;

/**
 * Budget de listings du SONDAGE (celui qui alimente l'écran). Beaucoup plus
 * serré que le parcours complet : ouvrir un écran ne doit jamais coûter
 * l'inventaire intégral d'un Drive. Au-delà, le sondage dit qu'il a tronqué
 * plutôt que de rendre un compte faux.
 *
 * ⚠️ 12 ne suffisait pas, et ça s'est vu en production le 18/09/2026. Le Drive
 * réel demande, pour atteindre un manifeste :
 *     1  la racine 10_PUBLICATIONS
 *   + 6  ses sous-dossiers (_CONTROLE, _INBOX_CHATGPT, 4 semaines)
 *   + 1  _INBOX_CHATGPT
 *   + 7  les jours de la semaine déposée
 *   = 15 listings AVANT de trouver le premier publication.json.
 * Le sondage s'arrêtait donc à « 1 fichier trouvé », ce qui était vrai et
 * trompeur : 77 fichiers attendaient deux niveaux plus bas. Porté à 30, ce qui
 * laisse de la marge sans transformer l'ouverture d'un écran en inventaire —
 * le parcours s'arrête de toute façon au premier manifeste rencontré.
 */
const SONDAGE_LISTINGS_MAX = 30;

/* ═══════════════════════════════════════════════════════════════════════════
   L'ERREUR QUI PORTE SON DIAGNOSTIC AVEC ELLE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Une erreur Drive n'est utile que si elle dit LAQUELLE des quatre pannes elle
 * est, et quel geste la répare. Le brut de Google est toujours conservé dans
 * `detail` : la piste est une hypothèse posée À CÔTÉ du fait, jamais à sa place.
 */
export class ErreurDrive extends Error {
  constructor({ diagnostic, message, piste = null, detail = null, statut = null }) {
    super(message);
    this.name = 'ErreurDrive';
    this.diagnostic = diagnostic;
    this.piste = piste;
    this.detail = detail;
    this.statut = statut;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   LA CONFIGURATION
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Lit les trois variables et dit LESQUELLES manquent.
 *
 * Une variable présente mais vide compte comme absente : une chaîne vide dans
 * Vercel est le résultat habituel d'un copier-coller raté, pas une intention.
 *
 * @param {object} [env]
 * @returns {{configure: boolean, manquantes: string[], email: string, cleBrute: string, dossierId: string}}
 */
export function lireConfigurationDrive(env = process.env) {
  const lire = (nom) => String(env?.[nom] ?? '').trim();
  const email = lire('GOOGLE_SERVICE_ACCOUNT_EMAIL');
  // ⚠️ La clé N'EST PAS `trim()`ée sur son contenu interne : seuls les blancs
  // de bord partent, et `normaliserClePrivee` s'occupe du reste.
  const cleBrute = String(env?.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ?? '').trim();
  const dossierId = lire('DRIVE_DOSSIER_PUBLICATIONS_ID');

  const valeurs = { GOOGLE_SERVICE_ACCOUNT_EMAIL: email, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: cleBrute, DRIVE_DOSSIER_PUBLICATIONS_ID: dossierId };
  const manquantes = VARIABLES_REQUISES.filter((nom) => valeurs[nom] === '');

  return { configure: manquantes.length === 0, manquantes, email, cleBrute, dossierId };
}

/**
 * Remet une clé privée PEM dans la forme que `node:crypto` sait lire, quel que
 * soit le chemin qu'elle a pris jusqu'à la variable d'environnement.
 *
 * Accepte les DEUX formats du piège n°1 :
 *   - vrais retours à la ligne (collage depuis le presse-papier) ;
 *   - suite littérale `\n` en deux caractères (copie du JSON tel quel).
 * Et, dans les deux cas, d'éventuels guillemets englobants.
 *
 * @param {unknown} brute
 * @returns {string|null} la clé PEM, ou `null` si ce n'en est pas une.
 */
export function normaliserClePrivee(brute) {
  if (typeof brute !== 'string') return null;
  let cle = brute.trim();
  if (cle === '') return null;

  // Guillemets englobants : le copier-coller qui emporte les délimiteurs JSON.
  if ((cle.startsWith('"') && cle.endsWith('"')) || (cle.startsWith("'") && cle.endsWith("'"))) {
    cle = cle.slice(1, -1);
  }

  // LE point du piège n°1 : la barre oblique inverse suivie d'un `n` devient un
  // vrai saut de ligne. Une clé où elle reste littérale ne se signe pas — et
  // l'erreur rendue par OpenSSL ne dit pas pourquoi.
  cle = cle.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\r\n/g, '\n');
  cle = cle.trim();

  if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(cle)) return null;
  if (!/-----END [A-Z ]*PRIVATE KEY-----/.test(cle)) return null;

  return `${cle}\n`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   LE JWT, ET SON ÉCHANGE CONTRE UN JETON D'ACCÈS
   ═══════════════════════════════════════════════════════════════════════════ */

function base64url(valeur) {
  return Buffer.from(valeur).toString('base64url');
}

/**
 * Construit et signe l'assertion JWT RS256 attendue par Google.
 *
 * @param {object} arg
 * @param {string} arg.email       adresse du compte de service (`iss`)
 * @param {string} arg.clePrivee   la clé, dans l'un ou l'autre des deux formats
 * @param {string} [arg.portee]    `scope` — lecture seule par défaut
 * @param {number} [arg.maintenantMs]
 * @param {string} [arg.audience]
 * @returns {string} le JWT compact `entete.charge.signature`
 * @throws {ErreurDrive} diagnostic `cle_refusee` si la clé est illisible
 */
export function construireJwt({
  email,
  clePrivee,
  portee = PORTEE_DRIVE_LECTURE,
  maintenantMs = Date.now(),
  audience = URL_JETON,
}) {
  const cle = normaliserClePrivee(clePrivee);
  if (!cle) {
    throw new ErreurDrive({
      diagnostic: DIAGNOSTICS.CLE_REFUSEE,
      message: MESSAGES.cle_refusee,
      detail: 'la valeur de GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ne ressemble pas à une clé PEM '
        + '(les lignes -----BEGIN PRIVATE KEY----- / -----END PRIVATE KEY----- sont introuvables)',
      piste: PISTES.cle_refusee,
    });
  }

  const iat = Math.floor(maintenantMs / 1000);
  const entete = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const charge = base64url(JSON.stringify({
    iss: email,
    scope: portee,
    aud: audience,
    iat,
    exp: iat + DUREE_JWT_S,
  }));

  try {
    const signature = crypto.sign('RSA-SHA256', Buffer.from(`${entete}.${charge}`), cle);
    return `${entete}.${charge}.${signature.toString('base64url')}`;
  } catch (err) {
    // Une clé tronquée ou d'un autre type arrive ici. Le message d'OpenSSL est
    // incompréhensible seul : on le garde en `detail`, pas en `message`.
    throw new ErreurDrive({
      diagnostic: DIAGNOSTICS.CLE_REFUSEE,
      message: MESSAGES.cle_refusee,
      detail: `signature impossible : ${err?.message || err}`,
      piste: PISTES.cle_refusee,
    });
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   LES PHRASES. Elles sont lues par le gérant, pas par un développeur.
   ═══════════════════════════════════════════════════════════════════════════ */

export const MESSAGES = Object.freeze({
  ok: 'Accès Drive opérationnel.',
  non_configure: 'Accès Drive non configuré.',
  cle_refusee: 'La clé privée est refusée par Google.',
  dossier_inaccessible: "Le dossier n'est pas partagé avec le robot.",
  dossier_vide: 'Aucune publication déposée dans le dossier.',
  rien_de_conforme: 'Des fichiers sont déposés, mais aucun ne forme une publication conforme au contrat.',
  panne: "Google n'a pas répondu.",
});

const PISTES = Object.freeze({
  cle_refusee: 'Recoller GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY dans Vercel depuis le JSON du compte '
    + 'de service (la valeur du champ private_key, entière, de -----BEGIN à -----END), puis '
    + 'redéployer. Si elle a été révoquée dans la console Google, en générer une nouvelle. '
    + "Vérifier aussi que l'adresse du compte de service est celle du même projet.",
  panne: 'Ce n\'est pas une erreur de configuration : Google n\'a pas répondu. Réessayer au '
    + 'prochain passage. Si cela dure, vérifier l\'état des services Google.',
});

function pisteDossier(dossierId, email) {
  return `Ouvrir le dossier 10_PUBLICATIONS dans le Drive, cliquer sur Partager, et ajouter `
    + `${email} en LECTEUR. Vérifier ensuite que DRIVE_DOSSIER_PUBLICATIONS_ID vaut bien `
    + `l'identifiant de ce dossier (interrogé : ${dossierId}) — c'est la partie de l'URL qui `
    + `suit /folders/. C'est l'erreur la plus fréquente : le partage du dossier est oublié, ou `
    + `l'identifiant est celui d'un dossier voisin.`;
}

/**
 * La piste d'un dépôt qui ne suit pas le format. Elle décrit le repère que le
 * lecteur cherche — `publication.json` — sans jamais nommer un chemin : la
 * disposition des dossiers a déjà changé deux fois (nommage ISO le 17/09, puis
 * un niveau `_INBOX_CHATGPT` en plus le 18/09). Le lecteur descend, il ne suit
 * pas une carte.
 */
function pisteRienDeConforme(echantillon) {
  const exemples = echantillon.length ? ` Exemples trouvés : ${echantillon.join(', ')}.` : '';
  return `Le robot LIT le Drive : l'accès et le partage sont bons. Ce sont les FICHIERS qui ne `
    + `forment pas une publication. Chaque publication vit dans son propre dossier et ce dossier `
    + `doit contenir un fichier nommé exactement « ${NOM_MANIFESTE} », qui déclare le créneau, les `
    + `canaux et les médias.${exemples} Peu importe où ce dossier se trouve dans l'arborescence : `
    + `le lecteur descend jusqu'à lui.`;
}

function pisteNonConfigure(manquantes) {
  return `Poser ${manquantes.join(', ')} dans Vercel (Production ET Preview), sans préfixe VITE_, `
    + `puis redéployer. Tant que ces valeurs manquent, la chaîne ne bricole aucun accès : elle le `
    + `dit et s'arrête là. Le dépôt manuel depuis l'application reste disponible.`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   LE JETON GARDÉ EN MÉMOIRE
   ═══════════════════════════════════════════════════════════════════════════

   Une instance serverless sert plusieurs requêtes avant d'être recyclée :
   redemander un jeton à chaque appel, c'est un aller-retour de plus chez Google
   pour rien, et une raison de plus de tomber. Le cache vit dans le module, donc
   dans l'instance, et disparaît avec elle — il n'est écrit nulle part. */

const cacheJetons = new Map();

/** Vide le cache. Utilisé par les tests, et par un redéploiement implicite. */
export function viderCacheJeton() {
  cacheJetons.clear();
}

/* ═══════════════════════════════════════════════════════════════════════════
   LE CLIENT
   ═══════════════════════════════════════════════════════════════════════════ */

async function lireCorps(reponse) {
  try {
    return await reponse.text();
  } catch {
    return '';
  }
}

/** Résumé court et brut d'une réponse d'erreur. Jamais un roman, jamais rien. */
function resumerEchec(statut, corps) {
  const brut = String(corps || '').replace(/\s+/g, ' ').trim();
  return `HTTP ${statut} : ${brut.slice(0, 400) || '(corps vide)'}`;
}

/**
 * Crée le client Drive.
 *
 * @param {object} [arg]
 * @param {object} [arg.env]        par défaut `process.env`
 * @param {Function} [arg.fetchImpl] injecté dans les tests — ZÉRO appel réseau
 * @param {Function} [arg.maintenant]
 * @param {number} [arg.profondeurMax]
 * @param {number} [arg.requetesMax]
 * @param {number} [arg.concurrence] dossiers examinés à la fois — voir
 *   `CONCURRENCE_DRIVE`. `1` reproduit exactement la file indienne d'avant le
 *   19/09/2026 au soir : c'est ce que le banc de coût utilise pour mesurer
 *   l'AVANT sans avoir à garder deux versions du code.
 * @returns {object}
 */
export function creerClientDrive({
  env = process.env,
  fetchImpl = null,
  maintenant = () => new Date(),
  profondeurMax = PROFONDEUR_MAX,
  requetesMax = REQUETES_MAX,
  sondageListingsMax = SONDAGE_LISTINGS_MAX,
  feuillesMax = INSPECTION_FEUILLES_MAX,
  concurrence = CONCURRENCE_DRIVE,
} = {}) {
  const configuration = lireConfigurationDrive(env);
  const appeler = fetchImpl || globalThis.fetch;
  let requetes = 0;
  /** Demandes de jeton en cours, par clé. Voir `jeton()`. */
  const jetonEnVol = new Map();

  function exigerConfiguration() {
    if (!configuration.configure) {
      throw new ErreurDrive({
        diagnostic: DIAGNOSTICS.NON_CONFIGURE,
        message: `${MESSAGES.non_configure} Il manque : ${configuration.manquantes.join(', ')}.`,
        piste: pisteNonConfigure(configuration.manquantes),
        detail: null,
      });
    }
  }

  function compterRequete() {
    requetes += 1;
    if (requetes > requetesMax) {
      throw new ErreurDrive({
        diagnostic: DIAGNOSTICS.PANNE,
        message: MESSAGES.panne,
        detail: `plus de ${requetesMax} requêtes Drive pour un seul passage : le parcours a été `
          + 'interrompu plutôt que de faire expirer la fonction',
        piste: 'Vérifier la profondeur de l\'arborescence de 10_PUBLICATIONS.',
      });
    }
  }

  /** Enveloppe d'appel : compte, exécute, et traduit une panne réseau. */
  async function requete(url, options) {
    compterRequete();
    try {
      return await appeler(url, options);
    } catch (err) {
      throw new ErreurDrive({
        diagnostic: DIAGNOSTICS.PANNE,
        message: MESSAGES.panne,
        detail: `appel réseau impossible : ${err?.message || err}`,
        piste: PISTES.panne,
      });
    }
  }

  /**
   * Le jeton d'accès, pris dans le cache s'il y est encore valable.
   * @returns {Promise<string>}
   */
  async function jeton() {
    exigerConfiguration();
    const cle = `${configuration.email}|${PORTEE_DRIVE_LECTURE}`;
    const maintenantMs = maintenant().getTime();
    const enCache = cacheJetons.get(cle);
    if (enCache && enCache.expireMs - MARGE_EXPIRATION_MS > maintenantMs) {
      return enCache.valeur;
    }

    /* 🔴 UN SEUL JETON, MÊME QUAND SIX APPELS PARTENT ENSEMBLE.
       Depuis que les dossiers sont examinés en parallèle, six appels peuvent
       trouver le cache vide au même instant. Sans ce verrou, ils demanderaient
       six jetons à Google — six requêtes pour rien, et six chances de plus de
       toucher le quota d'authentification. On retient donc la PROMESSE en
       cours, pas seulement le résultat : le premier demande, les autres
       attendent la même réponse. */
    if (jetonEnVol.has(cle)) return jetonEnVol.get(cle);
    const promesse = obtenirJeton(cle, maintenantMs).finally(() => jetonEnVol.delete(cle));
    jetonEnVol.set(cle, promesse);
    return promesse;
  }

  /** L'aller-retour réel vers Google. Appelé par `jeton()`, une fois à la fois. */
  async function obtenirJeton(cle, maintenantMs) {
    // `construireJwt` lève un `cle_refusee` AVANT tout appel réseau si la clé
    // est illisible : inutile de déranger Google pour l'apprendre.
    const assertion = construireJwt({
      email: configuration.email,
      clePrivee: configuration.cleBrute,
      maintenantMs,
    });

    const corpsRequete = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString();

    const reponse = await requete(URL_JETON, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: corpsRequete,
    });

    const corps = await lireCorps(reponse);
    if (!reponse.ok) {
      // `invalid_grant` est la réponse réelle de Google quand la signature ne
      // correspond pas, quand l'adresse du compte de service est mauvaise, ou
      // quand l'horloge dérive. Toutes ces causes se réparent du même côté :
      // celui de la clé et de son compte — jamais du côté du partage.
      throw new ErreurDrive({
        diagnostic: DIAGNOSTICS.CLE_REFUSEE,
        message: MESSAGES.cle_refusee,
        detail: resumerEchec(reponse.status, corps),
        piste: PISTES.cle_refusee,
        statut: reponse.status,
      });
    }

    let charge;
    try {
      charge = JSON.parse(corps);
    } catch {
      throw new ErreurDrive({
        diagnostic: DIAGNOSTICS.PANNE,
        message: MESSAGES.panne,
        detail: `réponse de jeton illisible : ${String(corps).slice(0, 200)}`,
        piste: PISTES.panne,
      });
    }

    if (!charge?.access_token) {
      throw new ErreurDrive({
        diagnostic: DIAGNOSTICS.CLE_REFUSEE,
        message: MESSAGES.cle_refusee,
        detail: `réponse sans access_token : ${String(corps).slice(0, 200)}`,
        piste: PISTES.cle_refusee,
      });
    }

    const dureeS = Number(charge.expires_in);
    cacheJetons.set(cle, {
      valeur: charge.access_token,
      expireMs: maintenantMs + (Number.isFinite(dureeS) && dureeS > 0 ? dureeS : 600) * 1000,
    });
    return charge.access_token;
  }

  /** En-têtes d'un appel Drive. Le jeton va LÀ, jamais dans l'URL. */
  async function entetes() {
    return { Authorization: `Bearer ${await jeton()}`, Accept: 'application/json' };
  }

  /** Traduit un échec HTTP de l'API Drive en diagnostic. */
  function erreurDrive(statut, corps, dossierId) {
    if (statut === 401) {
      // Le jeton a été rejeté : c'est du côté de la clé, pas du partage.
      cacheJetons.clear();
      return new ErreurDrive({
        diagnostic: DIAGNOSTICS.CLE_REFUSEE,
        message: MESSAGES.cle_refusee,
        detail: resumerEchec(statut, corps),
        piste: PISTES.cle_refusee,
        statut,
      });
    }
    if (statut === 403 || statut === 404) {
      // ⛔ LE CAS LE PLUS PROBABLE. Le jeton est bon, Google répond, et le
      // robot ne voit pas le dossier : soit il n'est pas partagé avec lui,
      // soit l'identifiant posé dans Vercel est celui d'un autre dossier.
      return new ErreurDrive({
        diagnostic: DIAGNOSTICS.DOSSIER_INACCESSIBLE,
        message: MESSAGES.dossier_inaccessible,
        detail: resumerEchec(statut, corps),
        piste: pisteDossier(dossierId ?? configuration.dossierId, configuration.email),
        statut,
      });
    }
    return new ErreurDrive({
      diagnostic: DIAGNOSTICS.PANNE,
      message: MESSAGES.panne,
      detail: resumerEchec(statut, corps),
      piste: PISTES.panne,
      statut,
    });
  }

  /**
   * Liste le contenu direct d'un dossier — sous-dossiers ET fichiers.
   * Suit la pagination : une page manquante, ce sont des publications perdues.
   *
   * @param {string} idDossier
   * @returns {Promise<Array<{id: string, name: string, mimeType: string, size?: string}>>}
   */
  async function listerDossier(idDossier) {
    exigerConfiguration();
    const entrees = [];
    let pageToken = null;

    do {
      const parametres = new URLSearchParams({
        q: `'${idDossier}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType, size, md5Checksum, modifiedTime)',
        pageSize: '200',
        orderBy: 'name',
        // Un Drive partagé (Shared Drive) ne rend rien sans ces deux drapeaux :
        // la réponse est un 200 avec zéro fichier, donc « dossier vide » — une
        // panne muette exactement du genre qu'on refuse ici.
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
      });
      if (pageToken) parametres.set('pageToken', pageToken);

      const reponse = await requete(`${BASE_DRIVE}/files?${parametres.toString()}`, {
        method: 'GET',
        headers: await entetes(),
      });
      const corps = await lireCorps(reponse);
      if (!reponse.ok) throw erreurDrive(reponse.status, corps, idDossier);

      let charge;
      try {
        charge = JSON.parse(corps);
      } catch {
        throw new ErreurDrive({
          diagnostic: DIAGNOSTICS.PANNE,
          message: MESSAGES.panne,
          detail: `listing illisible : ${String(corps).slice(0, 200)}`,
          piste: PISTES.panne,
        });
      }
      for (const fichier of charge.files || []) entrees.push(fichier);
      pageToken = charge.nextPageToken || null;
    } while (pageToken);

    return entrees;
  }

  /**
   * DEMANDER PLUTÔT QUE FOUILLER — la recherche par nom.
   *
   * Pourquoi cette fonction existe, et pourquoi elle remplace le parcours dans
   * le sondage. Le 18/09/2026, l'écran affichait « 3 fichiers trouvés, aucun ne
   * contient publication.json » alors que 77 publications attendaient. Le
   * parcours en largeur épuisait son budget AVANT d'atteindre le niveau des
   * manifestes : le Drive réel a 4 semaines × 7 jours × 1 dossier de
   * publication, donc plus de 30 dossiers rien qu'au deuxième niveau. Relever
   * le budget était une course perdue d'avance : chaque semaine déposée en
   * ajoute sept.
   *
   * Google sait répondre à « où sont les fichiers nommés publication.json ? »
   * en UNE requête. On la pose. Le parcours reste utilisé là où il faut
   * vraiment tout voir ; le sondage, lui, n'a besoin que de cette réponse.
   *
   * ⚠️ La recherche porte sur tout ce que le robot peut voir, c'est-à-dire
   * uniquement ce qui lui a été partagé. C'est exactement le dossier des
   * publications et sa descendance — pas le Drive entier de l'imprimerie.
   *
   * @param {string} nom nom exact recherché
   * @param {number} [maxRequetes] plafond de pages, pour ne pas fouiller sans fin
   * @returns {Promise<Array<{id: string, name: string, parents?: string[]}>>}
   */
  async function rechercherParNom(nom, maxRequetes = 5) {
    exigerConfiguration();
    const trouves = [];
    let pageToken = null;
    let requetes = 0;

    do {
      const parametres = new URLSearchParams({
        q: `name = '${String(nom).replace(/'/g, "\\'")}' and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType, parents, modifiedTime)',
        pageSize: '200',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
      });
      if (pageToken) parametres.set('pageToken', pageToken);

      const reponse = await requete(`${BASE_DRIVE}/files?${parametres.toString()}`, {
        method: 'GET',
        headers: await entetes(),
      });
      const corps = await lireCorps(reponse);
      if (!reponse.ok) throw erreurDrive(reponse.status, corps, configuration.dossierId);

      let charge;
      try {
        charge = JSON.parse(corps);
      } catch {
        throw new ErreurDrive({
          diagnostic: DIAGNOSTICS.PANNE,
          message: MESSAGES.panne,
          detail: `recherche illisible : ${String(corps).slice(0, 200)}`,
          piste: PISTES.panne,
        });
      }
      for (const fichier of charge.files || []) trouves.push(fichier);
      pageToken = charge.nextPageToken || null;
      requetes += 1;
    } while (pageToken && requetes < maxRequetes);

    return trouves;
  }

  /**
   * Télécharge le contenu d'un fichier, en texte.
   * @param {string} idFichier
   * @returns {Promise<string>}
   */
  async function telechargerFichier(idFichier) {
    exigerConfiguration();
    const parametres = new URLSearchParams({ alt: 'media', supportsAllDrives: 'true' });
    const reponse = await requete(
      `${BASE_DRIVE}/files/${encodeURIComponent(idFichier)}?${parametres.toString()}`,
      { method: 'GET', headers: await entetes() },
    );
    const corps = await lireCorps(reponse);
    if (!reponse.ok) throw erreurDrive(reponse.status, corps, idFichier);
    return corps;
  }

  /**
   * Télécharge le contenu d'un fichier, en OCTETS.
   *
   * Même appel que `telechargerFichier` — `files.get?alt=media`, en GET, dans
   * la portée `drive.readonly` — mais le corps n'est pas décodé en texte : une
   * image passée par `response.text()` revient corrompue, et le fichier
   * réhébergé ne s'ouvrirait pas.
   *
   * ⛔ La portée N'EST PAS élargie pour autant : lire des octets est la même
   *    permission que lire du texte. Rien ici n'écrit dans le Drive.
   *
   * @param {string} idFichier
   * @returns {Promise<Uint8Array>}
   */
  async function telechargerOctets(idFichier) {
    exigerConfiguration();
    const parametres = new URLSearchParams({ alt: 'media', supportsAllDrives: 'true' });
    const reponse = await requete(
      `${BASE_DRIVE}/files/${encodeURIComponent(idFichier)}?${parametres.toString()}`,
      // `Accept: */*` remplace le `application/json` des appels d'API : ce
      // qu'on demande ici est un fichier, pas un document JSON.
      { method: 'GET', headers: { ...(await entetes()), Accept: '*/*' } },
    );
    if (!reponse.ok) {
      const corps = await lireCorps(reponse);
      throw erreurDrive(reponse.status, corps, idFichier);
    }
    return new Uint8Array(await reponse.arrayBuffer());
  }

  /** L'instant de cette lecture, et la date qu'il est À MOANDA à cet instant. */
  function horodatage() {
    const instant = formaterInstantUtc(maintenant());
    return { verifie_le_utc: instant, date_locale: dateLocaleDepuisInstantUtc(instant) };
  }

  /** Enveloppe d'une panne : la même forme que le succès, jamais une exception. */
  function etatDepuisErreur(err) {
    const e = err instanceof ErreurDrive ? err : new ErreurDrive({
      diagnostic: DIAGNOSTICS.PANNE,
      message: MESSAGES.panne,
      detail: `erreur inattendue : ${err?.message || err}`,
      piste: PISTES.panne,
    });
    return {
      diagnostic: e.diagnostic,
      message: e.message,
      piste: e.piste,
      detail: e.detail,
      dossier_id: configuration.dossierId || null,
      ...horodatage(),
    };
  }

  /**
   * LE SONDAGE — l'inventaire que l'écran du gérant affiche.
   *
   * ⛔ Il ne télécharge RIEN. Il ne fait que LISTER, et son budget de listings
   * est borné (`sondageListingsMax`) : une lecture d'écran ne doit pas coûter
   * cent requêtes ni faire expirer la fonction.
   *
   * Pourquoi il descend quand même, alors qu'un seul listing suffirait à dire
   * « le dossier est partagé » : parce que le 18/09/2026, 77 fichiers ont été
   * déposés sous un niveau `_INBOX_CHATGPT` que le contrat ne prévoit pas. Un
   * sondage qui ne regarde que la racine aurait dit « 1 dossier », ce qui est
   * vrai et parfaitement inutile. Ce qu'il faut savoir tient en une question :
   * **y a-t-il, quelque part là-dedans, un dossier qui porte un
   * `publication.json` ?** S'il y a des fichiers et aucun manifeste, ce n'est
   * pas « vide » : c'est un dépôt hors format, et c'est un autre geste.
   *
   * ⛔ Ne lève jamais.
   */
  async function sonder() {
    try {
      exigerConfiguration();
      // Le listing de la RACINE est décisif : s'il échoue, c'est le partage ou
      // l'identifiant qui est en cause, et on le dit. Les échecs plus bas, non.
      const racine = await listerDossier(configuration.dossierId);
      if (racine.length === 0) {
        return {
          diagnostic: DIAGNOSTICS.DOSSIER_VIDE,
          message: MESSAGES.dossier_vide,
          piste: 'Le robot LIT bien le dossier : la configuration est bonne. Il n\'y a simplement '
            + 'rien dedans. C\'est à ChatGPT de déposer les publications de la semaine.',
          detail: null,
          dossier_id: configuration.dossierId,
          sous_dossiers: 0,
          fichiers: 0,
          publications_trouvees: 0,
          ...horodatage(),
        };
      }

      /* ── ON DEMANDE AVANT DE FOUILLER ────────────────────────────────────
         Une requête à Google : « où sont les fichiers nommés publication.json ? »
         S'il en existe, la question du sondage est réglée, et aucun parcours
         n'est nécessaire.

         Pourquoi ce raccourci a été ajouté. Le 18/09/2026, l'écran affichait
         « 3 fichiers trouvés, aucun ne contient publication.json » alors que 77
         publications attendaient deux niveaux plus bas. Le parcours en largeur
         épuisait son budget au DEUXIÈME niveau : 4 semaines × 7 jours font déjà
         28 dossiers avant d'atteindre celui qui porte le manifeste. Relever le
         budget ne réglait rien — chaque semaine déposée en rajoute sept.

         L'échec de la recherche n'est PAS une panne : on retombe simplement sur
         le parcours, qui sait dire pourquoi. ────────────────────────────────── */
      try {
        const manifestes = await rechercherParNom(NOM_MANIFESTE);
        if (manifestes.length > 0) {
          return {
            diagnostic: DIAGNOSTICS.OK,
            message: `${MESSAGES.ok} ${manifestes.length} publication(s) trouvée(s) dans le Drive.`,
            piste: null,
            detail: null,
            dossier_id: configuration.dossierId,
            sous_dossiers: racine.filter((x) => x.mimeType === MIME_DOSSIER).length,
            fichiers: racine.filter((x) => x.mimeType !== MIME_DOSSIER).length,
            publications_trouvees: manifestes.length,
            ...horodatage(),
          };
        }
      } catch {
        // La recherche n'a pas abouti : le parcours ci-dessous prend le relais
        // et produira un diagnostic, ce que la recherche seule ne sait pas faire.
      }

      let sousDossiers = 0;
      let fichiers = 0;
      let publicationsTrouvees = 0;
      let inaccessibles = 0;
      let tronque = false;
      const echantillon = [];

      let listings = 1;
      const file = [{ entrees: racine, profondeur: 0 }];

      while (file.length > 0) {
        const { entrees, profondeur } = file.shift();
        const dossiers = entrees.filter((x) => x.mimeType === MIME_DOSSIER);
        const plats = entrees.filter((x) => x.mimeType !== MIME_DOSSIER);
        sousDossiers += dossiers.length;
        fichiers += plats.length;
        for (const plat of plats) {
          if (echantillon.length < 4 && plat.name !== NOM_MANIFESTE) echantillon.push(plat.name);
        }
        if (plats.some((x) => x.name === NOM_MANIFESTE)) {
          publicationsTrouvees += 1;
          // Un dossier de publication ne se fouille pas plus loin.
          continue;
        }
        if (profondeur >= profondeurMax) continue;

        for (const sous of dossiers) {
          if (listings >= sondageListingsMax) { tronque = true; break; }
          listings += 1;
          try {
            file.push({ entrees: await listerDossier(sous.id), profondeur: profondeur + 1 });
          } catch {
            // Une branche illisible n'invalide pas ce qu'on a déjà vu.
            inaccessibles += 1;
          }
        }
      }

      const suffixeTronque = tronque
        ? ' L\'inventaire a été interrompu (arborescence trop large pour un sondage d\'écran).'
        : '';
      const suffixeInaccessible = inaccessibles
        ? ` ${inaccessibles} sous-dossier(s) n'ont pas pu être lus.`
        : '';

      if (publicationsTrouvees > 0) {
        return {
          diagnostic: DIAGNOSTICS.OK,
          message: `${MESSAGES.ok} ${publicationsTrouvees} dossier(s) de publication trouvé(s), `
            + `${fichiers} fichier(s) au total.${suffixeInaccessible}${suffixeTronque}`,
          piste: null,
          detail: null,
          dossier_id: configuration.dossierId,
          sous_dossiers: sousDossiers,
          fichiers,
          publications_trouvees: publicationsTrouvees,
          ...horodatage(),
        };
      }

      if (fichiers > 0) {
        // 🔴 LE CAS DU 18/09. Des fichiers, aucun manifeste : l'accès marche,
        //    c'est le FORMAT du dépôt qui ne va pas. Ne jamais dire « vide ».
        return {
          diagnostic: DIAGNOSTICS.RIEN_DE_CONFORME,
          message: `${fichiers} fichier(s) trouvé(s) dans le Drive, mais aucun dossier ne contient `
            + `« ${NOM_MANIFESTE} » : rien n'est conforme au contrat de publication.`
            + `${suffixeInaccessible}${suffixeTronque}`,
          piste: pisteRienDeConforme(echantillon),
          detail: null,
          dossier_id: configuration.dossierId,
          sous_dossiers: sousDossiers,
          fichiers,
          publications_trouvees: 0,
          ...horodatage(),
        };
      }

      return {
        diagnostic: DIAGNOSTICS.DOSSIER_VIDE,
        message: `${MESSAGES.dossier_vide}${suffixeInaccessible}${suffixeTronque}`,
        piste: 'Le robot LIT bien le dossier : la configuration est bonne. Il n\'y a aucun fichier '
          + 'dedans. C\'est à ChatGPT de déposer les publications de la semaine.',
        detail: null,
        dossier_id: configuration.dossierId,
        sous_dossiers: sousDossiers,
        fichiers: 0,
        publications_trouvees: 0,
        ...horodatage(),
      };
    } catch (err) {
      return { sous_dossiers: 0, fichiers: 0, publications_trouvees: 0, ...etatDepuisErreur(err) };
    }
  }

  /* ─────────────────────────────────────────────────────────────────────────
     LA LECTURE DES PUBLICATIONS

     L'arborescence réelle a changé le 17/09/2026 : WEEK_05-11Oct / Lundi_21_Sept
     / 1_POST_09H00 a remplacé un nommage ISO. Plutôt que de coder en dur une
     profondeur qui redeviendra fausse, on DESCEND jusqu'à trouver un dossier qui
     porte `publication.json`. Le nommage peut changer encore, le repère non.
     ───────────────────────────────────────────────────────────────────────── */

  /**
   * Examine un dossier qui porte un `publication.json`.
   * @returns {Promise<{publication?: object, ecartee?: object}>}
   */
  async function examinerDossierPublication(noeud, entrees) {
    const base = { dossier_id: noeud.id, dossier_nom: noeud.nom, chemin: noeud.chemin };
    const ecarter = (motif) => ({ ecartee: { ...base, motif } });

    const fichierManifeste = entrees.find((x) => x.name === NOM_MANIFESTE);
    const brut = await telechargerFichier(fichierManifeste.id);

    let publication;
    try {
      publication = JSON.parse(brut);
    } catch (err) {
      return ecarter(`${NOM_MANIFESTE} illisible : ${err?.message || 'JSON invalide'}`);
    }

    /* ── Le contrat v2.0, à la lettre. Aucune réparation, aucune tolérance ── */
    const controle = validerManifeste(publication);
    if (!controle.valide) {
      return ecarter(`${NOM_MANIFESTE} hors contrat : ${controle.erreurs.join(' · ')}`);
    }

    /* ── Chaque média annoncé doit EXISTER dans le dossier ─────────────────
       Un manifeste qui cite un fichier absent n'est pas « presque bon » : il
       est faux, et la panne se découvrirait au moment de publier. */
    const parNom = new Map(entrees.map((x) => [x.name, x]));
    const medias = [];
    const avertissementsLegendes = [];
    for (const media of publication.medias) {
      const fichier = parNom.get(media.chemin_relatif);
      if (!fichier) {
        return ecarter(`le média « ${media.chemin_relatif} » annoncé par ${NOM_MANIFESTE} `
          + `n'est pas dans le dossier ${noeud.nom}`);
      }
      // ⛔ Le STATUT est le dernier segment du nom de fichier, et ChatGPT dépose
      //    TOUJOURS en BROUILLON. Un média qui s'annonce APPROUVE est une
      //    auto-approbation : c'est précisément ce que l'APPROBATION.json
      //    séparée et signée existe pour empêcher.
      if (/_APPROUVE(\.[A-Za-z0-9]+)?$/.test(fichier.name)) {
        return ecarter(`le média « ${fichier.name} » porte le statut APPROUVE alors qu'un dépôt `
          + 'automatique est TOUJOURS en BROUILLON : seule une approbation humaine signée approuve');
      }
      medias.push({
        chemin_relatif: media.chemin_relatif,
        fichier_id: fichier.id,
        mime_type: fichier.mimeType || media.mime_type || null,
        taille: fichier.size ? Number(fichier.size) : null,
        md5: fichier.md5Checksum || null,
      });
    }

    /* ── Les légendes : REPÉRÉES ici, téléchargées ailleurs ───────────────
       Le manifeste déclare un fichier de légende par canal (`captions`). On se
       contente d'associer chaque déclaration au fichier réel du dossier, sans
       le télécharger : ce parcours sert aussi au sondage d'écran, et une
       lecture d'écran n'a pas à coûter le texte de 14 publications.
       L'alimentation de la file (`autopost-alimentation.js`) télécharge ce
       dont elle a besoin, au moment où elle en a besoin.

       Un fichier annoncé mais absent donne `fichier_id: null` — un fait, pas
       une réparation. C'est l'appelant qui décide ce qu'il en fait, et il
       l'écarte avec un motif plutôt que de publier une affiche sans un mot. */
    const captions = {};
    for (const [canal, declaration] of Object.entries(publication.captions || {})) {
      /* 🔴 DEUX FORMES ADMISES, et c'est le contrat qui dit laquelle est
         laquelle — pas ce fichier. Une légende EN LIGNE est déjà là : elle ne
         coûte aucun téléchargement, ni ici ni à l'alimentation. C'est la forme
         que ChatGPT dépose depuis que le document 37 la lui a montrée, et
         celle qui, à 16 publications × 3 canaux, retire jusqu'à 48 appels
         réseau d'un passage. Voir `lireDeclarationLegende()`. */
      const lue = lireDeclarationLegende(declaration);

      if (lue.forme === 'en_ligne') {
        captions[canal] = {
          chemin_relatif: null,
          fichier_id: null,
          taille: null,
          // ⛔ Le TEXTE, rendu tel quel. Ce module ne le retaille pas, ne le
          //    nettoie pas et n'y ajoute rien : une légende modifiée ici serait
          //    une légende que personne n'a approuvée.
          texte: lue.texte,
        };
        continue;
      }

      if (lue.forme === 'absente') {
        captions[canal] = { chemin_relatif: null, fichier_id: null, taille: null, texte: null };
        continue;
      }

      if (lue.forme === 'invalide') {
        // ⛔ On ne DEVINE pas une légende. Le fait est rendu à l'appelant, qui
        //    écarte ce canal-là avec son motif — et le dépôt entier survit.
        captions[canal] = {
          chemin_relatif: null, fichier_id: null, taille: null, texte: null, invalide: lue.detail,
        };
        avertissementsLegendes.push(`la légende annoncée pour ${canal} est inutilisable : ${lue.detail}`);
        continue;
      }

      const nom = lue.chemin_relatif;
      const fichier = parNom.get(nom);
      captions[canal] = {
        chemin_relatif: nom,
        fichier_id: fichier?.id ?? null,
        taille: fichier?.size ? Number(fichier.size) : null,
        texte: null,
      };
      if (!fichier) {
        avertissementsLegendes.push(`la légende « ${nom} » annoncée pour ${canal} n'est pas dans le dossier`);
      }
    }

    /* ── L'approbation : absente veut dire NULL, jamais « approuvé » ─────── */
    let approbation = null;
    const avertissements = [...avertissementsLegendes];
    const fichierApprobation = entrees.find((x) => x.name === NOM_APPROBATION);
    if (fichierApprobation) {
      const brutAppro = await telechargerFichier(fichierApprobation.id);
      try {
        approbation = JSON.parse(brutAppro);
      } catch (err) {
        // Illisible ⇒ on ne la devine pas. Elle reste `null`, donc la sélection
        // refusera de publier — et on DIT pourquoi au lieu de le taire.
        approbation = null;
        avertissements.push(`${NOM_APPROBATION} illisible : ${err?.message || 'JSON invalide'}`);
      }
    }

    return { publication: { ...base, publication, approbation, medias, captions, avertissements } };
  }

  /**
   * Parcourt le dossier des publications et rend ce qui est lisible, et ce qui
   * ne l'est pas — avec le motif.
   *
   * ⛔ Ne lève jamais : rend un objet qui porte le diagnostic.
   *
   * @param {object} [arg]
   * @param {string} [arg.idDossier] par défaut `DRIVE_DOSSIER_PUBLICATIONS_ID`
   */
  /**
   * Le motif d'écartement d'un dossier qui porte des fichiers mais AUCUN
   * manifeste. Écrit une seule fois, et servi par les DEUX façons de trouver
   * les dossiers : le gérant de Moanda lit exactement la même phrase, que le
   * Drive ait été interrogé par recherche ou parcouru à la main.
   *
   * Le motif NOMME ce qui est là. Un simple « aucune publication » devant 77
   * fichiers déposés fait chercher au mauvais endroit : le gérant irait
   * revérifier un partage de dossier qui marche très bien.
   */
  function motifSansManifeste(fichiers) {
    const echantillon = fichiers.slice(0, 4).map((x) => x.name);
    const reste = fichiers.length - echantillon.length;
    return `aucun fichier ${NOM_MANIFESTE} dans ce dossier, alors que ${fichiers.length} `
      + `fichier(s) y sont déposés : ${echantillon.join(', ')}`
      + `${reste > 0 ? `, et ${reste} autre(s)` : ''}. Rien n'est publiable tant qu'un `
      + `${NOM_MANIFESTE} ne déclare pas le créneau, les canaux et les médias.`;
  }

  /**
   * L'INDEX DES DOSSIERS — une requête pour TOUS les noms et TOUTES les
   * filiations que le robot peut voir.
   *
   * Pourquoi il existe. La recherche par nom rend `parents` : chaque manifeste
   * trouvé porte l'identifiant de son dossier. Un identifiant Google n'est pas
   * un chemin lisible : le gérant doit lire un emplacement, pas
   * `1aB2cD3eF4...`. Plutôt que de remonter la filiation dossier par dossier
   * (un appel par ancêtre), on demande une fois la liste des dossiers visibles
   * et on reconstruit les chemins hors ligne. Une requête, pas vingt.
   *
   * ⚠️ Comme la recherche par nom, elle ne voit QUE ce qui est partagé avec le
   *    robot — le dossier des publications et sa descendance.
   *
   * @returns {Promise<Map<string, {nom: string, parents: string[]}>>}
   */
  async function indexerDossiers(maxRequetes = 5) {
    exigerConfiguration();
    const index = new Map();
    let pageToken = null;
    let requetes = 0;

    do {
      const parametres = new URLSearchParams({
        q: `mimeType = '${MIME_DOSSIER}' and trashed = false`,
        fields: 'nextPageToken, files(id, name, parents)',
        pageSize: '1000',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
      });
      if (pageToken) parametres.set('pageToken', pageToken);

      const reponse = await requete(`${BASE_DRIVE}/files?${parametres.toString()}`, {
        method: 'GET',
        headers: await entetes(),
      });
      const corps = await lireCorps(reponse);
      if (!reponse.ok) throw erreurDrive(reponse.status, corps, configuration.dossierId);

      let charge;
      try {
        charge = JSON.parse(corps);
      } catch {
        throw new ErreurDrive({
          diagnostic: DIAGNOSTICS.PANNE,
          message: MESSAGES.panne,
          detail: `index des dossiers illisible : ${String(corps).slice(0, 200)}`,
          piste: PISTES.panne,
        });
      }
      for (const dossier of charge.files || []) {
        index.set(dossier.id, { nom: dossier.name || '', parents: dossier.parents || [] });
      }
      pageToken = charge.nextPageToken || null;
      requetes += 1;
    } while (pageToken && requetes < maxRequetes);

    return index;
  }

  /** Mémoire des métadonnées de dossiers, pour ne jamais redemander un ancêtre. */
  const memoireDossiers = new Map();

  /**
   * Le nom et la filiation d'UN dossier. Pris dans l'index s'il y est ; sinon
   * demandé à Google, une fois, et retenu.
   *
   * Un 404 rend `null` : c'est un fait, pas une panne. Une vraie panne réseau
   * remonte, elle, parce qu'insister n'apporterait rien.
   */
  async function metaDossier(id, index = null) {
    if (memoireDossiers.has(id)) return memoireDossiers.get(id);
    if (index && index.has(id)) {
      memoireDossiers.set(id, index.get(id));
      return index.get(id);
    }

    const parametres = new URLSearchParams({ fields: 'id, name, parents', supportsAllDrives: 'true' });
    const reponse = await requete(
      `${BASE_DRIVE}/files/${encodeURIComponent(id)}?${parametres.toString()}`,
      { method: 'GET', headers: await entetes() },
    );
    const corps = await lireCorps(reponse);
    let meta = null;
    if (reponse.ok) {
      try {
        const charge = JSON.parse(corps);
        meta = { nom: charge.name || '', parents: charge.parents || [] };
      } catch {
        meta = null;
      }
    }
    memoireDossiers.set(id, meta);
    return meta;
  }

  /**
   * SITUER un dossier : son nom, son chemin LISIBLE relatif à la racine, et la
   * réponse à la seule question de sécurité qui compte — est-il bien SOUS la
   * racine demandée ?
   *
   * Le chemin rendu a exactement la forme de celui que produisait le parcours,
   * parce que c'est celui-là qui s'affiche au gérant.
   */
  async function situerDossier(id, racineId, index) {
    const segments = [];
    const vus = new Set();
    let courant = id;
    let sousRacine = false;

    while (courant && !vus.has(courant) && segments.length < 32) {
      if (courant === racineId) { sousRacine = true; break; }
      vus.add(courant);
      const meta = await metaDossier(courant, index);
      // Filiation inconnue : on rend ce qu'on a plutôt que rien. Un chemin
      // partiel reste lisible ; un identifiant Google ne l'est pas.
      if (!meta) break;
      segments.unshift(meta.nom);
      courant = (meta.parents || [])[0] || null;
    }

    return {
      chemin: segments.join('/'),
      nom: segments.length > 0 ? segments[segments.length - 1] : '',
      sousRacine,
    };
  }

  /**
   * ON DEMANDE PLUTÔT QUE DE FOUILLER — la lecture par recherche.
   *
   * Pourquoi cette voie remplace le parcours. Le 19/09/2026, l'écran affichait
   * DEUX choses contradictoires : « 14 publication(s) trouvée(s) » (le sondage,
   * corrigé la veille, qui DEMANDE à Google) et « aucune publication conforme,
   * 53 dossier(s) écarté(s) » (la lecture, restée sur le parcours en largeur,
   * qui s'arrêtait à la profondeur 4 sans jamais atteindre les manifestes).
   *
   * La correction n'est pas de relever le plafond : la disposition déposée
   * compte 4 ou 5 niveaux selon l'endroit où pointe la racine, et une semaine
   * de plus en rajoute. Google sait répondre en UNE requête à « où sont les
   * fichiers nommés publication.json ? », et chaque réponse porte
   * l'identifiant de son dossier parent. On liste CES dossiers-là, et eux
   * seuls.
   *
   *   • aucune limite de profondeur : la question ne se pose plus ;
   *   • le coût ne suit plus le nombre de semaines déposées, mais le nombre de
   *     publications réellement trouvées.
   */
  async function lireParRecherche(racine, manifestes, publications, ecartees) {
    // L'index sert aux CHEMINS, pas à trouver les publications : s'il manque,
    // on lit quand même — un chemin approximatif vaut mieux qu'un Drive muet.
    let index = null;
    try {
      index = await indexerDossiers();
    } catch {
      index = null;
    }

    /* ── Un dossier par manifeste, sans doublon ─────────────────────────── */
    const dossiers = new Map();
    for (const manifeste of manifestes) {
      const parent = (manifeste.parents || [])[0];
      if (!parent) continue;
      if (!dossiers.has(parent)) dossiers.set(parent, manifeste);
    }

    /* ── QUELS DOSSIERS, ET OÙ ILS SONT — hors ligne quand l'index répond ──
       `situerDossier()` remonte la filiation dans l'index : aucun appel dans le
       cas normal. On le fait AVANT la phase parallèle pour que la mémoire des
       dossiers (`memoireDossiers`) se remplisse sans course, et pour que le
       repli `files.get` reste une file indienne — il est rare, et six `files.get`
       simultanés sur un index absent ne rendraient pas la lecture plus juste. */
    const aExaminer = [];
    for (const id of dossiers.keys()) {
      const situation = await situerDossier(id, racine, index);
      // Hors périmètre : la recherche voit tout ce qui est partagé avec le
      // robot, la lecture ne rend QUE ce qui est sous la racine demandée.
      // Une filiation qu'on n'a pas su remonter n'est pas une preuve
      // d'exclusion : dans le doute, on garde la publication.
      const filiationConnue = situation.chemin !== '';
      if (!situation.sousRacine && filiationConnue && index) continue;
      aExaminer.push({ id, nom: situation.nom, chemin: situation.chemin });
    }

    /* 🔴 LES DOSSIERS SONT EXAMINÉS EN PARALLÈLE, PAR PAQUETS BORNÉS.
       Chaque dossier coûte deux allers-retours qui ne dépendent d'aucun autre
       dossier : le listing, puis le téléchargement du manifeste. Les enchaîner
       en file indienne, c'est ce qui a fait 51 714 ms pour 16 publications le
       19/09/2026. Le nombre d'appels est le MÊME ; c'est leur profondeur qui
       tombe. La borne existe pour les quotas Drive — voir `concurrence.js`.

       ⚠️ L'ORDRE est préservé : chaque dossier rend son issue à SA place, et on
       range ensuite. L'écran du gérant ne doit pas changer d'ordre d'un passage
       à l'autre sans que rien n'ait changé dans le Drive. */
    const issues = await enParalleleBorne(aExaminer, concurrence, async (noeud) => {
      let entrees;
      try {
        entrees = await listerDossier(noeud.id);
      } catch (err) {
        return {
          ecartee: {
            dossier_id: noeud.id,
            dossier_nom: noeud.nom,
            chemin: noeud.chemin,
            motif: `dossier inaccessible : ${err?.detail || err?.message || err}`,
          },
        };
      }

      if (!entrees.some((x) => x.name === NOM_MANIFESTE)) {
        // Le manifeste a disparu entre la recherche et le listing. On le DIT.
        const fichiers = entrees.filter((x) => x.mimeType !== MIME_DOSSIER);
        if (fichiers.length === 0) return {};
        return {
          ecartee: {
            dossier_id: noeud.id,
            dossier_nom: noeud.nom,
            chemin: noeud.chemin,
            motif: motifSansManifeste(fichiers),
          },
        };
      }

      try {
        return await examinerDossierPublication(noeud, entrees);
      } catch (err) {
        // Même règle que le parcours : un manifeste qu'on n'arrive pas à
        // TÉLÉCHARGER n'emporte pas les autres ; une clé refusée ou une panne
        // réseau touchent TOUT, et on remonte.
        if (err?.diagnostic === DIAGNOSTICS.CLE_REFUSEE
          || err?.diagnostic === DIAGNOSTICS.NON_CONFIGURE
          || err?.diagnostic === DIAGNOSTICS.PANNE) throw err;
        return {
          ecartee: {
            dossier_id: noeud.id,
            dossier_nom: noeud.nom,
            chemin: noeud.chemin,
            motif: `${NOM_MANIFESTE} inaccessible : ${err?.detail || err?.message || err}`,
          },
        };
      }
    });

    for (const issue of issues) {
      if (issue?.publication) publications.push(issue.publication);
      else if (issue?.ecartee) ecartees.push(issue.ecartee);
    }

    await inspecterFeuilles(racine, index, new Set(dossiers.keys()), ecartees);
  }

  /**
   * CE QUE LA RECHERCHE NE DIT PAS — les dossiers déposés SANS manifeste.
   *
   * La recherche ne rend que les dossiers qui portent un `publication.json`.
   * Un jour où ChatGPT a déposé une affiche et oublié le manifeste
   * disparaîtrait alors de l'écran en silence — et une publication muette est
   * exactement ce que ce module refuse.
   *
   * L'index des dossiers suffit à les DÉSIGNER sans rien fouiller : ce sont
   * les FEUILLES (aucun sous-dossier) qui ne portent pas de manifeste. Dans une
   * semaine propre, il n'y en a aucune, et ça ne coûte rien.
   *
   * ⚠️ Et quand il y en a, on ne les LISTE pas une par une. Dix semaines de
   *    dossiers-jours préparés à l'avance feraient soixante-dix listings pour
   *    n'y rien trouver — le coût qui recommence à suivre le calendrier, c'est
   *    exactement ce qu'on vient de corriger. On pose donc la question inverse
   *    à Google, UNE fois : « où sont les fichiers qui ne sont pas des
   *    dossiers ? ». Chacun porte son parent, et on sait tout.
   */
  async function inspecterFeuilles(racine, index, dossiersDePublication, ecartees) {
    if (!index || index.size === 0) return;

    const parents = new Set();
    for (const meta of index.values()) {
      for (const parent of meta.parents || []) parents.add(parent);
    }

    /* ── Les feuilles à inspecter. Aucun appel : de l'arithmétique sur l'index ── */
    const feuilles = [];
    for (const [id, meta] of index) {
      if (id === racine) continue;
      if (dossiersDePublication.has(id)) continue;
      if (parents.has(id)) continue;
      const situation = await situerDossier(id, racine, index);
      if (!situation.sousRacine) continue;
      feuilles.push({ id, nom: meta.nom, chemin: situation.chemin });
    }
    if (feuilles.length === 0) return;

    /* ── Une requête pour savoir ce que TOUTES portent ─────────────────── */
    let parDossier = null;
    try {
      parDossier = await indexerFichiersPlats();
    } catch {
      parDossier = null;
    }

    let inspectes = 0;
    for (const feuille of feuilles) {
      let fichiers;

      if (parDossier) {
        fichiers = parDossier.get(feuille.id) || [];
      } else {
        // L'index des fichiers n'a pas répondu : on retombe sur le listing,
        // borné, plutôt que de TAIRE un dépôt qui ne sera jamais publié.
        if (inspectes >= feuillesMax) break;
        inspectes += 1;
        try {
          fichiers = (await listerDossier(feuille.id)).filter((x) => x.mimeType !== MIME_DOSSIER);
        } catch (err) {
          ecartees.push({
            dossier_id: feuille.id,
            dossier_nom: feuille.nom,
            chemin: feuille.chemin,
            motif: `dossier inaccessible : ${err?.detail || err?.message || err}`,
          });
          continue;
        }
      }

      // Un dossier vide est NORMAL : un jour sans publication n'est pas une
      // anomalie, et ne doit pas encombrer l'écran du gérant.
      if (fichiers.length === 0) continue;
      if (fichiers.some((x) => x.name === NOM_MANIFESTE)) continue;

      ecartees.push({
        dossier_id: feuille.id,
        dossier_nom: feuille.nom,
        chemin: feuille.chemin,
        motif: motifSansManifeste(fichiers),
      });
    }
  }

  /**
   * L'INDEX DES FICHIERS — tout ce qui n'est PAS un dossier, rangé par parent.
   *
   * La question symétrique de `indexerDossiers()`. Elle coûte une requête et
   * remplace un listing par dossier suspect. Elle n'est posée que s'il y a des
   * feuilles à inspecter : une semaine propre ne la déclenche jamais.
   *
   * @returns {Promise<Map<string, Array<{id: string, name: string}>>>}
   */
  async function indexerFichiersPlats(maxRequetes = 5) {
    exigerConfiguration();
    const parDossier = new Map();
    let pageToken = null;
    let requetes = 0;

    do {
      const parametres = new URLSearchParams({
        q: `mimeType != '${MIME_DOSSIER}' and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType, parents)',
        pageSize: '1000',
        // Le MÊME ordre que le listing : le motif d'écartement nomme les
        // premiers fichiers, et il ne doit pas dépendre du chemin pris.
        orderBy: 'name',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
      });
      if (pageToken) parametres.set('pageToken', pageToken);

      const reponse = await requete(`${BASE_DRIVE}/files?${parametres.toString()}`, {
        method: 'GET',
        headers: await entetes(),
      });
      const corps = await lireCorps(reponse);
      if (!reponse.ok) throw erreurDrive(reponse.status, corps, configuration.dossierId);

      let charge;
      try {
        charge = JSON.parse(corps);
      } catch {
        throw new ErreurDrive({
          diagnostic: DIAGNOSTICS.PANNE,
          message: MESSAGES.panne,
          detail: `index des fichiers illisible : ${String(corps).slice(0, 200)}`,
          piste: PISTES.panne,
        });
      }
      for (const fichier of charge.files || []) {
        for (const parent of fichier.parents || []) {
          if (!parDossier.has(parent)) parDossier.set(parent, []);
          parDossier.get(parent).push({ id: fichier.id, name: fichier.name, mimeType: fichier.mimeType });
        }
      }
      pageToken = charge.nextPageToken || null;
      requetes += 1;
    } while (pageToken && requetes < maxRequetes);

    return parDossier;
  }

  /**
   * LE REPLI — le parcours en largeur, inchangé.
   *
   * Il reste là parce qu'un Drive lisible d'une façon vaut mieux qu'un Drive
   * illisible proprement : si la recherche par nom échoue (droit, panne,
   * quota) ou ne rend rien, c'est lui qui prend le relais — et lui seul sait
   * dire POURQUOI un dépôt n'est pas publiable quand il n'y a aucun manifeste.
   *
   * ⚠️ Sa profondeur reste bornée : c'est la limite qui a causé la panne du
   *    19/09/2026. Elle ne gêne plus, parce qu'il n'est plus le chemin normal.
   */
  async function lireParParcours(racine, publications, ecartees) {
    const aVisiter = [{ id: racine, nom: '', chemin: '', profondeur: 0 }];

    while (aVisiter.length > 0) {
      const noeud = aVisiter.shift();

      let entrees;
      try {
        entrees = await listerDossier(noeud.id);
      } catch (err) {
        // ⛔ La RACINE est décisive : si elle ne se lit pas, c'est le partage
        //    ou l'identifiant, et tout le reste est sans objet.
        if (noeud.profondeur === 0) throw err;
        // Plus bas, une branche illisible est un incident LOCAL. L'écarter en
        // le disant vaut mieux que de jeter les branches lisibles avec elle.
        ecartees.push({
          dossier_id: noeud.id,
          dossier_nom: noeud.nom,
          chemin: noeud.chemin,
          motif: `dossier inaccessible : ${err?.detail || err?.message || err}`,
        });
        continue;
      }

      const sousDossiers = entrees.filter((x) => x.mimeType === MIME_DOSSIER);
      const fichiers = entrees.filter((x) => x.mimeType !== MIME_DOSSIER);

      if (fichiers.some((x) => x.name === NOM_MANIFESTE)) {
        try {
          const issue = await examinerDossierPublication(noeud, entrees);
          if (issue.publication) publications.push(issue.publication);
          else ecartees.push(issue.ecartee);
        } catch (err) {
          // Un manifeste qu'on n'arrive pas à TÉLÉCHARGER (droit sur le
          // fichier, fichier supprimé entre le listing et la lecture) ne doit
          // pas emporter les autres publications de la semaine. En revanche,
          // une clé refusée ou une panne réseau touchent TOUT : on remonte,
          // parce qu'insister sur les dossiers suivants ne donnerait que la
          // même erreur, cinquante fois.
          if (err?.diagnostic === DIAGNOSTICS.CLE_REFUSEE
            || err?.diagnostic === DIAGNOSTICS.NON_CONFIGURE
            || err?.diagnostic === DIAGNOSTICS.PANNE) throw err;
          ecartees.push({
            dossier_id: noeud.id,
            dossier_nom: noeud.nom,
            chemin: noeud.chemin,
            motif: `${NOM_MANIFESTE} inaccessible : ${err?.detail || err?.message || err}`,
          });
        }
        continue;
      }

      if (sousDossiers.length > 0 && noeud.profondeur < profondeurMax) {
        for (const sous of sousDossiers) {
          aVisiter.push({
            id: sous.id,
            nom: sous.name,
            chemin: noeud.chemin ? `${noeud.chemin}/${sous.name}` : sous.name,
            profondeur: noeud.profondeur + 1,
          });
        }
        continue;
      }

      // Un dossier de feuille qui porte des fichiers mais pas de manifeste :
      // quelqu'un a déposé quelque chose qui ne sera jamais publié. On le
      // DIT. Un dossier vide, lui, est normal — un jour sans publication.
      if (fichiers.length > 0 && noeud.profondeur > 0) {
        ecartees.push({
          dossier_id: noeud.id,
          dossier_nom: noeud.nom,
          chemin: noeud.chemin,
          motif: motifSansManifeste(fichiers),
        });
      }
    }
  }

  /**
   * Parcourt le dossier des publications et rend ce qui est lisible, et ce qui
   * ne l'est pas — avec le motif.
   *
   * ⛔ Ne lève jamais : rend un objet qui porte le diagnostic.
   *
   * @param {object} [arg]
   * @param {string} [arg.idDossier] par défaut `DRIVE_DOSSIER_PUBLICATIONS_ID`
   */
  async function lirePublications({ idDossier = null } = {}) {
    const publications = [];
    const ecartees = [];
    try {
      exigerConfiguration();
      const racine = idDossier || configuration.dossierId;

      /* ── ON DEMANDE AVANT DE FOUILLER ───────────────────────────────────
         Exactement ce que fait le sondage depuis le 18/09/2026. Une requête :
         « où sont les fichiers nommés publication.json ? ». L'échec de la
         recherche n'est PAS une panne — le parcours prend le relais. */
      let manifestes = null;
      try {
        manifestes = await rechercherParNom(NOM_MANIFESTE);
      } catch {
        manifestes = null;
      }

      if (manifestes && manifestes.length > 0) {
        await lireParRecherche(racine, manifestes, publications, ecartees);
      }

      // Rien du tout : soit la recherche n'a rien rendu, soit ce qu'elle a
      // rendu était hors périmètre. Le parcours sait dire POURQUOI.
      if (publications.length === 0 && ecartees.length === 0) {
        await lireParParcours(racine, publications, ecartees);
      }
    } catch (err) {
      return { publications, ecartees, ...etatDepuisErreur(err) };
    }

    if (publications.length === 0 && ecartees.length === 0) {
      return {
        diagnostic: DIAGNOSTICS.DOSSIER_VIDE,
        message: MESSAGES.dossier_vide,
        piste: 'Le robot LIT bien le dossier. Il n\'y a rien à publier : c\'est à ChatGPT de déposer.',
        detail: null,
        dossier_id: configuration.dossierId || null,
        publications,
        ecartees,
        ...horodatage(),
      };
    }

    if (publications.length === 0) {
      // 🔴 Des dossiers ont été examinés, aucun n'a produit de publication. Ce
      //    n'est PAS « rien de déposé » : c'est « rien de conforme », et le
      //    geste qui répare n'est pas le même. Les motifs disent quoi.
      return {
        diagnostic: DIAGNOSTICS.RIEN_DE_CONFORME,
        message: `${MESSAGES.rien_de_conforme} ${ecartees.length} dossier(s) écarté(s).`,
        piste: pisteRienDeConforme([]),
        detail: null,
        dossier_id: configuration.dossierId || null,
        publications,
        ecartees,
        ...horodatage(),
      };
    }

    return {
      diagnostic: DIAGNOSTICS.OK,
      message: `${publications.length} publication(s) lue(s), ${ecartees.length} écartée(s).`,
      piste: null,
      detail: null,
      dossier_id: configuration.dossierId || null,
      publications,
      ecartees,
      ...horodatage(),
    };
  }

  return {
    configuration,
    jeton,
    listerDossier,
    rechercherParNom,
    telechargerFichier,
    telechargerOctets,
    sonder,
    lirePublications,
  };
}

/**
 * Le sondage, en une ligne, pour l'écran du gérant.
 * ⛔ Ne lève jamais — c'est tout l'intérêt.
 * @param {object} [options] voir `creerClientDrive`
 */
export async function sonderDrive(options = {}) {
  try {
    return await creerClientDrive(options).sonder();
  } catch (err) {
    // Filet de dernier recours : même une erreur de construction du client ne
    // doit pas remonter jusqu'à l'écran.
    const instant = formaterInstantUtc(options.maintenant ? options.maintenant() : new Date());
    return {
      diagnostic: DIAGNOSTICS.PANNE,
      message: MESSAGES.panne,
      piste: PISTES.panne,
      detail: `erreur inattendue : ${err?.message || err}`,
      dossier_id: null,
      sous_dossiers: 0,
      fichiers: 0,
      verifie_le_utc: instant,
      date_locale: dateLocaleDepuisInstantUtc(instant),
    };
  }
}
