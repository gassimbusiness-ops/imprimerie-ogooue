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
import { validerManifeste } from './autopost-contrat.js';

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
 * @returns {object}
 */
export function creerClientDrive({
  env = process.env,
  fetchImpl = null,
  maintenant = () => new Date(),
  profondeurMax = PROFONDEUR_MAX,
  requetesMax = REQUETES_MAX,
  sondageListingsMax = SONDAGE_LISTINGS_MAX,
} = {}) {
  const configuration = lireConfigurationDrive(env);
  const appeler = fetchImpl || globalThis.fetch;
  let requetes = 0;

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

    /* ── L'approbation : absente veut dire NULL, jamais « approuvé » ─────── */
    let approbation = null;
    const avertissements = [];
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

    return { publication: { ...base, publication, approbation, medias, avertissements } };
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
          // Le motif NOMME ce qui est là. Un simple « aucune publication »
          // devant 77 fichiers déposés fait chercher au mauvais endroit : le
          // gérant irait revérifier un partage de dossier qui marche.
          const echantillon = fichiers.slice(0, 4).map((x) => x.name);
          const reste = fichiers.length - echantillon.length;
          ecartees.push({
            dossier_id: noeud.id,
            dossier_nom: noeud.nom,
            chemin: noeud.chemin,
            motif: `aucun fichier ${NOM_MANIFESTE} dans ce dossier, alors que ${fichiers.length} `
              + `fichier(s) y sont déposés : ${echantillon.join(', ')}`
              + `${reste > 0 ? `, et ${reste} autre(s)` : ''}. Rien n'est publiable tant qu'un `
              + `${NOM_MANIFESTE} ne déclare pas le créneau, les canaux et les médias.`,
          });
        }
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
    telechargerFichier,
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
