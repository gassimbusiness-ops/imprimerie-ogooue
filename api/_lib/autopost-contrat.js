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

/**
 * ════════════════════════════════════════════════════════════════════════════
 * 🔴 LES COMPTES CIBLES — DES ÉTIQUETTES, PLUS JAMAIS DES NUMÉROS
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Le 19/09/2026 au soir, la première publication réelle a traversé toute la
 * chaîne — Drive, file, approbation, hébergement du média, bon créneau — et
 * Meta a répondu :
 *
 *   code=100 subcode=33 : Object with ID 'IG_IMPRIMERIE' does not exist
 *
 * `IG_IMPRIMERIE` n'est pas un identifiant, c'est une ÉTIQUETTE. ChatGPT
 * l'écrivait dans `canaux[].compte_cible_id` et l'exécuteur la passait telle
 * quelle à Graph. Il ne manquait qu'un numéro.
 *
 * Le défaut n'était pas dans ce que ChatGPT a écrit : c'était de lui demander
 * un numéro. Un générateur de contenu n'a aucune raison de connaître
 * l'identifiant d'une Page Meta — c'est une donnée d'INFRASTRUCTURE, elle
 * change si l'entreprise change de Page, elle n'a aucun sens éditorial, et la
 * lui confier crée une classe d'erreur entière pour rien.
 *
 * Depuis, `compte_cible_id` est une étiquette symbolique, et c'est
 * l'APPLICATION qui la résout, au moment de publier, depuis ses propres
 * variables d'environnement. Les mêmes que le bot Messenger lit déjà
 * (`api/_lib/bot-executeur.js`) — aucun nom nouveau n'a été inventé.
 *
 * ⛔ CE QUE CETTE TABLE INTERDIT, ET QUI COMPTE PLUS QUE LE CONFORT :
 *    le jeton de Page voit AUSSI la Page TopShop GABON, et plus largement
 *    toute Page à laquelle il donne accès. Tant qu'un numéro arbitraire était
 *    accepté, un manifeste erroné — ou altéré — pouvait publier une affiche
 *    d'imprimerie sur n'importe quelle Page du portefeuille. Avec une liste
 *    fermée d'étiquettes, la seule chose que ChatGPT peut demander, c'est
 *    « la Page de l'imprimerie » ou « l'Instagram de l'imprimerie ». Il ne
 *    peut plus DÉSIGNER une destination, seulement en NOMMER une connue.
 */
export const COMPTES_CIBLES = Object.freeze({
  PAGE_IMPRIMERIE: Object.freeze({ canal: 'facebook', variable: 'META_PAGE_ID' }),
  IG_IMPRIMERIE: Object.freeze({ canal: 'instagram', variable: 'META_INSTAGRAM_ID' }),
  // Remise à un humain : aucun appel réseau, donc rien à résoudre. L'étiquette
  // existe pour que le manifeste puisse la nommer sans être refusé.
  WA_IMPRIMERIE: Object.freeze({ canal: 'whatsapp_handoff', variable: null }),
});

/** Les étiquettes qui existent, dans l'ordre où on les montre au gérant. */
export const ETIQUETTES_COMPTES = Object.freeze(Object.keys(COMPTES_CIBLES));

/**
 * Pourquoi un compte cible n'a pas pu être résolu.
 *
 * ⛔ QUATRE MOTIFS, PAS UN SEUL, PARCE QUE CE SONT QUATRE GESTES DIFFÉRENTS :
 *   - `compte_cible_absent`        : le manifeste ne dit rien → corriger le dépôt ;
 *   - `compte_cible_inconnu`       : le manifeste dit autre chose qu'une étiquette
 *                                    connue (y compris un numéro en clair) → corriger le dépôt ;
 *   - `compte_cible_mauvais_canal` : l'étiquette existe mais désigne un autre
 *                                    réseau → corriger le dépôt ;
 *   - `compte_cible_non_configure` : l'étiquette est bonne, la variable
 *                                    d'environnement manque → poser la variable
 *                                    dans Vercel, RIEN à corriger dans le dépôt.
 *
 * Le gérant de Moanda doit pouvoir lire le motif et savoir lequel des deux
 * gestes il a à faire. Un motif unique l'obligerait à les essayer tous les deux.
 */
export const MOTIFS_COMPTE = Object.freeze({
  ABSENT: 'compte_cible_absent',
  INCONNU: 'compte_cible_inconnu',
  MAUVAIS_CANAL: 'compte_cible_mauvais_canal',
  NON_CONFIGURE: 'compte_cible_non_configure',
});

const RE_NUMERIQUE = /^\d{5,}$/;

/** La liste des étiquettes, écrite pour être lue dans un message d'erreur. */
function listeEtiquettes() {
  return ETIQUETTES_COMPTES.join(', ');
}

/**
 * Résout l'étiquette d'un canal en identifiant réel de compte Meta.
 *
 * ⛔ FONCTION PURE : elle ne lit PAS `process.env`. La table `comptes` lui est
 *    donnée par l'appelant (`comptesDepuisEnvironnement()` dans l'exécuteur).
 *    C'est ce qui permet de tester les quatre refus sans toucher au processus.
 *
 * ⛔ AUCUNE SUPPOSITION. Une étiquette inconnue n'est jamais rapprochée de la
 *    plus proche : publier sur « la page qui ressemble le plus » est exactement
 *    l'accident qu'on veut rendre impossible.
 *
 * @param {object} arg
 * @param {*} arg.etiquette  la valeur de `compte_cible_id`
 * @param {string} [arg.canal]  le canal de la ligne ('facebook' | 'instagram' | …)
 * @param {Record<string,string>|null} [arg.comptes]  étiquette → identifiant réel.
 *        `null`/absent = l'appelant ne connaît pas l'environnement : l'étiquette
 *        est quand même contrôlée, la présence de la variable ne l'est pas.
 * @returns {{resolu: boolean, etiquette: string|null, id: string|null, motif: string|null, detail: string|null}}
 */
export function resoudreCompteCible({ etiquette, canal = null, comptes = null }) {
  const refus = (motif, detail) => ({
    resolu: false, etiquette: typeof etiquette === 'string' ? etiquette : null, id: null, motif, detail,
  });

  const brut = typeof etiquette === 'string' ? etiquette.trim() : '';
  if (brut === '') {
    return refus(MOTIFS_COMPTE.ABSENT,
      `aucune étiquette de compte sur cette ligne. Les étiquettes qui existent : ${listeEtiquettes()}.`);
  }

  const definition = COMPTES_CIBLES[brut];
  if (!definition) {
    // Un numéro en clair est refusé COMME UN INCONNU, et c'est le point de
    // toute cette table : accepter un numéro arbitraire rendrait à l'émetteur
    // du manifeste le pouvoir de choisir n'importe quelle Page du portefeuille.
    const detail = RE_NUMERIQUE.test(brut)
      ? 'un identifiant numérique écrit en clair n\'est plus accepté : le manifeste nomme '
        + `un compte par son étiquette, jamais par son numéro. Étiquettes admises : ${listeEtiquettes()}.`
      : `« ${brut} » n'est pas une étiquette connue. Étiquettes admises : ${listeEtiquettes()}. `
        + 'Aucune n\'est devinée par ressemblance.';
    return refus(MOTIFS_COMPTE.INCONNU, detail);
  }

  if (canal && definition.canal !== canal) {
    return refus(MOTIFS_COMPTE.MAUVAIS_CANAL,
      `l'étiquette ${brut} désigne un compte ${definition.canal}, elle ne peut pas servir `
      + `au canal ${canal}. À corriger dans publication.json.`);
  }

  // Canal de remise à un humain : il n'y a rien à résoudre, et c'est normal.
  if (!definition.variable) {
    return { resolu: true, etiquette: brut, id: null, motif: null, detail: null };
  }

  if (comptes === null || comptes === undefined) {
    // L'appelant ne dit rien de l'environnement. L'étiquette est valide ; on ne
    // prétend pas savoir si la variable est posée.
    return { resolu: true, etiquette: brut, id: null, motif: null, detail: null };
  }

  const id = typeof comptes[brut] === 'string' ? comptes[brut].trim() : '';
  if (id === '') {
    return refus(MOTIFS_COMPTE.NON_CONFIGURE,
      `l'étiquette ${brut} est valide, mais la variable d'environnement ${definition.variable} `
      + 'n\'est pas posée sur le serveur. Rien à corriger dans le dépôt : c\'est une variable à '
      + 'poser dans Vercel (Production ET Preview), puis à redéployer.');
  }

  return { resolu: true, etiquette: brut, id, motif: null, detail: null };
}

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
/**
 * 🔴 LES VALEURS QUI RESSEMBLENT À UNE DONNÉE ET N'EN SONT PAS.
 *
 * Le 19/09/2026 au matin, quatre lignes ont été écartées parce que
 * `publication.json` annonçait la chaîne littérale `"undefined"` comme nom de
 * fichier de légende. Ce n'est pas un nom : c'est le résultat d'une
 * concaténation JavaScript ratée chez l'émetteur, arrivé jusqu'au disque.
 *
 * Le refus était le bon comportement, et il le reste. Mais depuis que les
 * légendes peuvent aussi être EN LIGNE (voir `lireDeclarationLegende()`), la
 * même chaîne pourrait passer non plus comme nom de fichier mais comme TEXTE —
 * et « undefined » partirait sur la page Facebook de l'imprimerie. On refuse
 * donc ces valeurs des DEUX côtés, à un seul endroit.
 */
export const VALEURS_FANTOMES = Object.freeze(['undefined', 'null', 'none', 'nan', 'nil', '[object object]']);

/** Une chaîne qui n'est ni vide ni un fantôme d'émetteur. */
function chaineReelle(valeur) {
  if (typeof valeur !== 'string') return null;
  const propre = valeur.trim();
  if (propre === '') return null;
  if (VALEURS_FANTOMES.includes(propre.toLowerCase())) return null;
  return valeur;
}

/**
 * Un texte de légende est-il publiable ?
 *
 * ⛔ Sert aussi au texte TÉLÉCHARGÉ, pas seulement au texte déclaré en ligne :
 *    un `caption_facebook.txt` qui ne contient que le mot « undefined » est
 *    exactement le même accident, arrivé par l'autre chemin — et il partirait
 *    sur la page de l'imprimerie.
 *
 * @param {*} texte
 * @returns {boolean}
 */
export function legendeUtilisable(texte) {
  return chaineReelle(texte) !== null;
}

/**
 * ⛔ CE QU'UNE ENTRÉE DE `captions` DÉCLARE — les DEUX formes, pas une.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * POURQUOI DEUX FORMES, ET POURQUOI ON N'EN CHOISIT PAS UNE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Deux documents de référence se contredisent : le 31 décrit un OBJET qui
 * désigne un fichier du dossier, le 37 montre une CHAÎNE qui est la légende
 * elle-même. ChatGPT a suivi le 37, fidèlement, et le code n'attendait que la
 * forme du 31 : `declaration?.chemin_relatif` valait `undefined`, la ligne
 * était écartée en `legende_absente`, et une publication prévue ne pouvait pas
 * partir.
 *
 * Trancher pour une seule forme voudrait dire, soit casser ce que ChatGPT
 * dépose aujourd'hui, soit renoncer aux légendes en fichier que d'autres dépôts
 * utilisent déjà. On accepte donc les deux, et c'est ICI — un seul endroit —
 * qu'on dit laquelle est laquelle.
 *
 * ⚠️ Et la forme en ligne n'est pas qu'une tolérance : elle SUPPRIME un
 *    téléchargement par canal et par publication. C'est le même sujet que le
 *    temps de lecture, pas un chantier à part.
 *
 * Quatre issues, jamais de réparation :
 *
 *   `{ forme: 'en_ligne', texte }`       la légende est là, rien à télécharger ;
 *   `{ forme: 'fichier', chemin_relatif }` un fichier du dossier la porte ;
 *   `{ forme: 'absente' }`               rien n'est déclaré pour ce canal ;
 *   `{ forme: 'invalide', detail }`      quelque chose est déclaré, et ce
 *                                        quelque chose n'est pas utilisable.
 *
 * ⛔ « invalide » n'est PAS « absente » : le gérant doit savoir qu'il y a
 *    quelque chose à corriger dans le dépôt, pas croire qu'il manque une ligne.
 *
 * @param {*} declaration la valeur de `publication.captions[canal]`
 * @returns {{forme: string, texte?: string, chemin_relatif?: string, detail?: string}}
 */
export function lireDeclarationLegende(declaration) {
  if (declaration === null || declaration === undefined) return { forme: 'absente' };

  /* ── La forme EN LIGNE : la légende est la valeur elle-même ───────────── */
  if (typeof declaration === 'string') {
    const texte = chaineReelle(declaration);
    if (texte === null) {
      return {
        forme: 'invalide',
        detail: `la légende déclarée en ligne vaut « ${declaration.trim() || '(vide)'} » : `
          + 'ce n\'est pas un texte publiable',
      };
    }
    return { forme: 'en_ligne', texte };
  }

  /* ── La forme FICHIER : un nom, qui doit être dans le dossier ─────────── */
  if (typeof declaration === 'object' && !Array.isArray(declaration)) {
    const nom = chaineReelle(declaration.chemin_relatif);
    if (nom !== null) return { forme: 'fichier', chemin_relatif: nom };
    const brut = declaration.chemin_relatif;
    return {
      forme: 'invalide',
      detail: brut === undefined || brut === null
        ? 'la légende déclarée ne dit ni un texte ni un chemin_relatif'
        : `« ${String(brut).trim() || '(vide)'} » n'est pas un nom de fichier utilisable`,
    };
  }

  return {
    forme: 'invalide',
    detail: `une légende se déclare par un texte ou par un chemin_relatif, pas par ${typeof declaration}`,
  };
}

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

  /* 🔴 LA LÉGENDE ENTRE DANS LE SCEAU — LES DEUX FORMES.
     Forme fichier : c'est le `sha256` déclaré à côté du nom, comme depuis le
     début. Forme EN LIGNE : le texte EST la légende, et il n'a pas de `sha256`
     à côté de lui — `?.sha256` y vaudrait `undefined`, donc la chaîne vide, et
     on pourrait alors réécrire entièrement une légende SANS invalider
     l'approbation qui la couvre. On scelle donc l'empreinte du texte.
     ⚠️ Aucune approbation existante n'en est affectée : jusqu'au 19/09/2026 au
     soir, une légende en ligne faisait ÉCARTER la ligne — aucune n'est jamais
     entrée en file, donc aucune n'a jamais été approuvée. */
  Object.keys(pub?.captions || {}).sort().forEach((nom) => {
    const declaration = pub.captions[nom];
    if (typeof declaration === 'string') {
      lignes.push(crypto.createHash('sha256').update(declaration, 'utf8').digest('hex'));
      return;
    }
    lignes.push(String(declaration?.sha256 ?? ''));
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
 * Marque de provenance d'une approbation POSÉE PAR LA MACHINE, à l'entrée en
 * file (`api/_lib/autopost-alimentation.js`, réglage `approbation_automatique`).
 *
 * 🔴 ELLE EXISTE POUR UNE SEULE RAISON : pouvoir toujours répondre à « qui a
 * approuvé cette publication ? ». Une approbation automatique porte
 * `origine: 'automatique'` et `approuve_par: null` ; une approbation humaine
 * porte `origine: 'ecran_administrateur'` et l'identifiant de session de celui
 * qui a cliqué. L'écran affiche l'un ou l'autre, jamais un vert indistinct.
 *
 * ⚠️ Comme `ORIGINE_ECRAN`, ce n'est pas une PREUVE : c'est du texte, qu'un
 * `APPROBATION.json` déposé dans le Drive pourrait recopier. Ce qui prouve
 * reste la signature HMAC — donc `AUTOPOST_CLE_APPROBATION`, toujours absente.
 */
export const ORIGINE_AUTOMATIQUE = 'automatique';

/**
 * Une approbation (ou un retrait) décidée par un HUMAIN depuis l'écran.
 *
 * ⛔ C'est le prédicat qui fait gagner le bouton « Retirer l'approbation »
 * contre l'approbation automatique : tant qu'il rend `true`, aucun passage ne
 * réécrit cette décision. Sans lui, un retrait à 08 h 55 serait réapprouvé par
 * le passage de 09 h 00 — et le bouton ne servirait à rien.
 */
export function estDecisionHumaine(approbation) {
  return approbation?.origine === ORIGINE_ECRAN;
}

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
 * ⛔ Depuis le 19/09/2026, une approbation AUTOMATIQUE est conservée elle aussi.
 * Sans ça, l'alimentation la reposerait à chaque passage avec un horodatage
 * neuf : la file serait réécrite deux fois par jour pour rien, et `updated_at`
 * ne dirait plus quand la ligne a réellement changé.
 *
 * @param {object|null} approbationDuDepot
 * @param {object|null} approbationDeLaLigne
 * @returns {object|null}
 */
export function approbationARetenir(approbationDuDepot, approbationDeLaLigne) {
  if (approbationDuDepot) return approbationDuDepot;
  const o = approbationDeLaLigne?.origine;
  if (o === ORIGINE_ECRAN || o === ORIGINE_AUTOMATIQUE) return approbationDeLaLigne;
  return null;
}
