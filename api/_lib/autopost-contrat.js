/**
 * Auto-poster — le contrat `publication.json` v2.0, et l'approbation.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CE QUE CE MODULE FAIT, ET CE QU'IL NE FAIT PAS
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Il LIT et VALIDE le document que ChatGPT dépose dans le Drive. Il ne publie
 * rien, n'appelle aucun réseau, ne lit aucune base. C'est délibéré : la
 * validation doit pouvoir tourner en test, hors ligne, des centaines de fois.
 *
 * Le contrat de référence est `livrables_claude/31_AUTOPOST_QUI_FAIT_QUOI.md`
 * §4 et `livrables_claude/meta/ARCHITECTURE_CHAINE_AUTOPOST.md` §B. Les règles
 * dures reprises ici :
 *
 *   - `schema_version` doit valoir exactement "2.0". Un poster qui ignore les
 *     champs qu'il ne connaît pas publie du contenu qu'il n'a pas compris.
 *   - Le bloc `creneau` porte CINQ champs redondants. La redondance est un
 *     CAPTEUR : on recalcule `instant_utc` à partir de date + heure + offset et
 *     on compare. Écart → refus, jamais de publication « au plus probable ».
 *   - `mode_execution` vaut "dry_run" chez ChatGPT. Le passage en "live" est un
 *     geste humain, pas un champ que le générateur de contenu peut écrire.
 *   - `offres[].prix_affiche` doit être `false` tant que le catalogue validé
 *     n'existe pas. Il n'existe pas au 18/09/2026.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * L'APPROBATION — POURQUOI ELLE EST UN FICHIER SÉPARÉ ET SIGNÉ
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Si l'approbation était un champ de `publication.json`, ChatGPT — qui écrit ce
 * fichier — pourrait s'approuver lui-même. Elle vit donc dans `APPROBATION.json`,
 * que ChatGPT a interdiction d'écrire, et elle porte l'empreinte de ce qui a été
 * approuvé (§B.6) : changer la légende, le média, le créneau ou le compte cible
 * INVALIDE l'approbation au lieu de la traîner.
 *
 * ⚠️ L'interdiction faite à ChatGPT est une consigne, pas une serrure. La
 * serrure, c'est `empreinteCanonique()` : une approbation qui ne correspond pas
 * au contenu ne vaut rien, quel que soit celui qui l'a écrite.
 */
import crypto from 'node:crypto';
import { instantUtcDepuisCreneau } from '../../src/lib/dates.js';

/** La seule version de schéma que ce poster sait lire. */
export const SCHEMA_ATTENDU = '2.0';

/** Canaux qui appellent réellement une API de publication. */
export const CANAUX_PUBLIANTS = Object.freeze(['facebook', 'instagram']);

/**
 * Canaux de remise à un humain : ils n'appellent AUCUNE API de publication.
 * Reprise littérale du `$comment` du schéma d'origine.
 */
export const CANAUX_HANDOFF = Object.freeze(['tiktok_handoff', 'whatsapp_handoff']);

/** Origines de média admises. Le champ est obligatoire et ne se devine pas. */
export const ORIGINES_MEDIA = Object.freeze([
  'chatgpt', 'photo_reelle', 'wavespeed', 'higgsfield', 'montage',
]);

const RE_PUBLICATION_ID = /^PUB-\d{4}-S\d{2}-[1-7]-\d{2}$/;
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RE_SEMAINE = /^\d{4}-S\d{2}$/;

/**
 * Valide un manifeste `publication.json`.
 *
 * Rend TOUTES les erreurs, pas seulement la première : un aller-retour par
 * faute de frappe avec quelqu'un qui n'est pas développeur est intenable.
 *
 * @param {object} pub
 * @returns {{valide: boolean, erreurs: string[]}}
 */
export function validerManifeste(pub) {
  const e = [];
  if (!pub || typeof pub !== 'object') return { valide: false, erreurs: ['manifeste absent ou illisible'] };

  if (pub.schema_version !== SCHEMA_ATTENDU) {
    e.push(`schema_version attendu "${SCHEMA_ATTENDU}", reçu "${pub.schema_version}"`);
  }
  if (typeof pub.publication_id !== 'string' || !RE_PUBLICATION_ID.test(pub.publication_id)) {
    e.push('publication_id absent ou hors motif PUB-AAAA-Snn-J-nn');
  }
  if (typeof pub.version_contenu !== 'number' || pub.version_contenu < 1) {
    e.push('version_contenu doit être un entier ≥ 1');
  }
  if (typeof pub.semaine_iso !== 'string' || !RE_SEMAINE.test(pub.semaine_iso)) {
    e.push('semaine_iso absent ou hors motif AAAA-Snn');
  }
  if (typeof pub.date_locale !== 'string' || !RE_DATE.test(pub.date_locale)) {
    e.push('date_locale absente ou hors motif AAAA-MM-JJ');
  }

  /* ── Le bloc créneau : le capteur du §B.3 ──────────────────────────────── */
  const c = pub.creneau;
  if (!c || typeof c !== 'object') {
    e.push('creneau absent');
  } else {
    if (c.fuseau !== 'Africa/Libreville') e.push(`creneau.fuseau doit valoir "Africa/Libreville" (reçu "${c.fuseau}")`);
    if (c.date_locale !== pub.date_locale) e.push('creneau.date_locale diffère de date_locale');
    const recalcule = instantUtcDepuisCreneau(c);
    if (recalcule === null) {
      e.push('creneau illisible : date_locale, heure_locale ou offset_utc absent ou mal formé');
    } else if (typeof c.instant_utc !== 'string' || !/Z$/.test(c.instant_utc)) {
      e.push('creneau.instant_utc absent ou ne finit pas par Z');
    } else if (normaliserInstant(c.instant_utc) !== recalcule) {
      // ⛔ Le cœur du contrôle. Un écart ici veut dire qu'une conversion de
      //    fuseau a déjà mal tourné en amont. On refuse, on ne « corrige » pas :
      //    on ne sait pas laquelle des deux valeurs est la bonne.
      e.push(`creneau.instant_utc (${c.instant_utc}) ne correspond pas au recalcul `
        + `${c.date_locale} ${c.heure_locale} ${c.offset_utc} → ${recalcule}`);
    }
    if (c.tolerance_minutes !== undefined
      && (typeof c.tolerance_minutes !== 'number' || c.tolerance_minutes < 0)) {
      e.push('creneau.tolerance_minutes doit être un entier ≥ 0');
    }
  }

  /* ── Mode d'exécution ──────────────────────────────────────────────────── */
  if (pub.mode_execution !== 'dry_run' && pub.mode_execution !== 'live') {
    e.push('mode_execution doit valoir "dry_run" ou "live"');
  }

  /* ── Médias ───────────────────────────────────────────────────────────── */
  if (!Array.isArray(pub.medias) || pub.medias.length === 0) {
    e.push('medias vide : rien à publier');
  } else {
    pub.medias.forEach((m, i) => {
      if (!m || typeof m !== 'object') { e.push(`medias[${i}] illisible`); return; }
      if (typeof m.chemin_relatif !== 'string' || m.chemin_relatif === '') {
        e.push(`medias[${i}].chemin_relatif absent`);
      }
      if (/^([a-z]+:)?\/\//i.test(m.chemin_relatif || '') || (m.chemin_relatif || '').startsWith('/')) {
        e.push(`medias[${i}].chemin_relatif doit être relatif au dossier de publication`);
      }
      if (!ORIGINES_MEDIA.includes(m.origine)) {
        e.push(`medias[${i}].origine absente ou hors liste (${ORIGINES_MEDIA.join(', ')})`);
      }
      // 📗 Instagram : « JPEG is the only image format supported ». Un PNG doit
      //    être converti AVANT approbation, pas découvert au moment de publier.
      const cibleIG = Array.isArray(m.canal_cible) && m.canal_cible.includes('instagram');
      if (cibleIG && typeof m.mime_type === 'string' && m.mime_type.startsWith('image/')
        && m.mime_type !== 'image/jpeg') {
        e.push(`medias[${i}].mime_type "${m.mime_type}" : Instagram n'accepte que image/jpeg`);
      }
    });
  }

  /* ── Offres — l'interdit le plus dur du dossier ────────────────────────── */
  if (Array.isArray(pub.offres)) {
    pub.offres.forEach((o, i) => {
      if (o?.prix_affiche === true && !o.version_catalogue) {
        e.push(`offres[${i}].prix_affiche vrai sans version_catalogue : `
          + 'aucun prix ne peut être publié tant que le catalogue validé est vide');
      }
    });
  }

  /* ── Canaux ───────────────────────────────────────────────────────────── */
  if (!Array.isArray(pub.canaux) || pub.canaux.length === 0) {
    e.push('canaux vide : aucune destination');
  } else {
    pub.canaux.forEach((k, i) => {
      const connus = [...CANAUX_PUBLIANTS, ...CANAUX_HANDOFF];
      if (!connus.includes(k?.canal)) e.push(`canaux[${i}].canal hors liste (${connus.join(', ')})`);
      if (!['feed', 'reel', 'story'].includes(k?.surface)) e.push(`canaux[${i}].surface hors liste (feed, reel, story)`);
    });
  }

  return { valide: e.length === 0, erreurs: e };
}

/** `2026-09-21T08:00:00.000Z` et `2026-09-21T08:00:00Z` sont le même instant. */
function normaliserInstant(instant) {
  return String(instant).replace(/\.\d+Z$/, 'Z');
}

/**
 * La clé d'idempotence d'un canal : le quintuplet exact du dossier.
 *
 * ⚠️ Cette chaîne ne garantit rien par elle-même. Ce qui garantit, c'est
 * l'index UNIQUE posé dessus par `migrations/008_autopost_file_publication.sql`.
 * « Une clé d'idempotence sans index unique n'est pas une clé, c'est un
 * commentaire. »
 *
 * @param {object} pub
 * @param {object} canal
 * @returns {string}
 */
export function cleIdempotence(pub, canal) {
  return [
    pub?.publication_id ?? '',
    `v${pub?.version_contenu ?? ''}`,
    canal?.canal ?? '',
    canal?.compte_cible_id ?? '',
    normaliserInstant(pub?.creneau?.instant_utc ?? ''),
  ].join('|');
}

/**
 * La « charge canonique » du §B.6 : la concaténation, dans un ordre FIXE et
 * TRIÉ, de tout ce qui est approuvé.
 *
 * L'ordre fixe n'est pas de la coquetterie : sans lui, deux sérialisations du
 * même contenu donnent deux hachages, l'approbation devient non reproductible,
 * donc inutilisable comme contrôle.
 *
 * Absents volontairement : `brief.md`, `avertissements`, `genere_le`. Corriger
 * une faute de frappe dans le brief ne doit pas invalider une approbation.
 * Modifier une légende, un média, un créneau ou un compte cible, si.
 *
 * @param {object} pub
 * @returns {string}
 */
export function chargeCanonique(pub) {
  const lignes = [];
  lignes.push(String(pub?.publication_id ?? ''));
  lignes.push(String(pub?.version_contenu ?? ''));
  const c = pub?.creneau || {};
  lignes.push(`${c.date_locale ?? ''}T${c.heure_locale ?? ''}${c.offset_utc ?? ''}`);

  [...(pub?.canaux || [])]
    .sort((a, b) => String(a?.canal).localeCompare(String(b?.canal)))
    .forEach((k) => lignes.push(`${k?.canal ?? ''}|${k?.compte_cible_id ?? ''}|${k?.surface ?? ''}`));

  [...(pub?.medias || [])]
    .sort((a, b) => (a?.ordre_carrousel ?? 0) - (b?.ordre_carrousel ?? 0)
      || String(a?.chemin_relatif).localeCompare(String(b?.chemin_relatif)))
    .forEach((m) => lignes.push(String(m?.sha256 ?? '')));

  Object.keys(pub?.captions || {}).sort().forEach((nom) => {
    lignes.push(String(pub.captions[nom]?.sha256 ?? ''));
  });

  lignes.push(String(pub?.cta ?? ''));
  lignes.push(String(pub?.code_provenance ?? ''));

  [...(pub?.offres || [])]
    .sort((a, b) => String(a?.offre_id).localeCompare(String(b?.offre_id)))
    .forEach((o) => lignes.push(`${o?.offre_id ?? ''}|${o?.valide_jusqu_au_local ?? ''}`));

  return lignes.join('\n');
}

/** SHA-256 hexadécimal de la charge canonique. */
export function empreinteCanonique(pub) {
  return crypto.createHash('sha256').update(chargeCanonique(pub), 'utf8').digest('hex');
}

/**
 * Vérifie qu'une publication est approuvée POUR CE CANAL, à CETTE version, avec
 * CE contenu.
 *
 * ⛔ Règle non négociable du dossier : rien ne se publie sans approbation. Une
 * approbation absente n'est pas une approbation implicite — c'est un refus.
 *
 * @param {object} arg
 * @param {object} arg.publication  le manifeste
 * @param {object|null} arg.approbation  le contenu de `APPROBATION.json`
 * @param {string} arg.canal  'facebook' | 'instagram'
 * @param {string|null} [arg.cleSignature]  secret HMAC, si la signature est exigée
 * @returns {{approuve: boolean, raison: string|null}}
 */
export function verifierApprobation({ publication, approbation, canal, cleSignature = null }) {
  if (!approbation || typeof approbation !== 'object') {
    return { approuve: false, raison: 'approbation_absente' };
  }
  if (approbation.approuve !== true) {
    return { approuve: false, raison: 'approbation_refusee' };
  }
  if (approbation.publication_id !== publication?.publication_id) {
    return { approuve: false, raison: 'approbation_pour_une_autre_publication' };
  }
  // C'est ce contrôle qui fait qu'une correction après approbation ne part pas
  // toute seule : `version_contenu` est incrémenté à chaque modification.
  if (approbation.version_contenu !== publication?.version_contenu) {
    return { approuve: false, raison: 'approbation_perimee_version_contenu' };
  }
  if (!Array.isArray(approbation.canaux_approuves) || !approbation.canaux_approuves.includes(canal)) {
    return { approuve: false, raison: 'canal_non_approuve' };
  }

  const attendue = empreinteCanonique(publication);
  if (approbation.payload_sha256 !== attendue) {
    return { approuve: false, raison: 'contenu_modifie_depuis_approbation' };
  }

  // Le créneau approuvé doit être celui qu'on s'apprête à tenir. Déplacer une
  // publication d'une heure, c'est une décision éditoriale, pas un détail.
  const ca = approbation.creneau_approuve || {};
  const cp = publication?.creneau || {};
  if (ca.date_locale !== cp.date_locale || ca.heure_locale !== cp.heure_locale) {
    return { approuve: false, raison: 'creneau_modifie_depuis_approbation' };
  }

  if (cleSignature) {
    const signee = crypto.createHmac('sha256', cleSignature)
      .update(`${approbation.publication_id}|${approbation.version_contenu}|${approbation.payload_sha256}`, 'utf8')
      .digest('hex');
    const a = Buffer.from(String(approbation.signature_hmac_sha256 ?? ''));
    const b = Buffer.from(signee);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { approuve: false, raison: 'signature_approbation_invalide' };
    }
  }

  return { approuve: true, raison: null };
}

/**
 * Fabrique la signature d'une approbation. Utilisée par l'écran d'approbation
 * et par les tests — jamais par ChatGPT, qui n'a pas la clé.
 * @param {object} approbation
 * @param {string} cleSignature
 * @returns {string}
 */
export function signerApprobation(approbation, cleSignature) {
  return crypto.createHmac('sha256', cleSignature)
    .update(`${approbation.publication_id}|${approbation.version_contenu}|${approbation.payload_sha256}`, 'utf8')
    .digest('hex');
}

/**
 * Marque de provenance d'une approbation donnée depuis l'écran d'administration
 * de l'application (`api/_lib/autopost-approbation.js`).
 *
 * ⚠️ Ce n'est PAS une preuve d'origine : un `APPROBATION.json` déposé dans le
 * Drive peut porter la même chaîne, c'est du texte. La seule chose qui
 * distingue cryptographiquement un approbateur d'un autre est la signature
 * HMAC, donc la présence de `AUTOPOST_CLE_APPROBATION`. Cette constante ne sert
 * qu'à deux gestes honnêtes : l'afficher, et ne pas effacer par mégarde une
 * approbation que l'application vient d'écrire (voir `approbationARetenir`).
 */
export const ORIGINE_ECRAN = 'ecran_administrateur';

/**
 * Ce que l'alimentation doit RANGER dans la colonne `approbation` d'une ligne
 * de file déjà présente, quand elle réécrit cette ligne depuis le Drive.
 *
 * ⛔ Sans cette règle, l'écran d'approbation ne tiendrait pas une heure. La
 * relecture du Drive réécrit la ligne avec l'approbation du dépôt — or ChatGPT
 * a INTERDICTION de déposer `APPROBATION.json`, donc ce champ est presque
 * toujours absent. Une approbation donnée à 08 h 55 serait effacée par le
 * passage de 09 h 00, juste avant d'être lue.
 *
 * La règle : le dépôt gagne quand il apporte une approbation ; sinon on
 * conserve celle qui vient de l'application. Ce n'est pas un contournement :
 * l'approbation conservée porte `payload_sha256`, donc si le dépôt a modifié le
 * contenu, `verifierApprobation()` la refuse d'elle-même avec
 * `contenu_modifie_depuis_approbation`.
 *
 * @param {object|null} approbationDuDepot
 * @param {object|null} approbationDeLaLigne
 * @returns {object|null}
 */
export function approbationARetenir(approbationDuDepot, approbationDeLaLigne) {
  if (approbationDuDepot) return approbationDuDepot;
  if (approbationDeLaLigne?.origine === ORIGINE_ECRAN) return approbationDeLaLigne;
  return null;
}
