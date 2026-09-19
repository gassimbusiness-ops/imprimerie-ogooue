/**
 * Auto-poster — DONNER et RETIRER une approbation, depuis l'écran du gérant.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LE MAILLON QUI MANQUAIT
 * ════════════════════════════════════════════════════════════════════════════
 *
 * `autopost-contrat.js` sait VÉRIFIER une approbation depuis le 18/09/2026, et
 * son commentaire annonçait « l'écran d'approbation » — qui n'existait pas.
 * `signerApprobation()` n'avait aucun appelant. Résultat mesurable : la
 * sélection écartait chaque ligne avec `non_approuve`, et personne, dans toute
 * l'application, ne pouvait lever ce refus. La chaîne était complète sauf le
 * geste humain qu'elle exige.
 *
 * Ce module est ce geste, et rien d'autre. Il ne publie pas, n'appelle aucune
 * API, ne lit pas le Drive. Il fabrique l'objet d'approbation prévu au §B.6,
 * l'écrit dans la colonne `approbation` de la ligne de file, et sait le retirer.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⛔ LES TROIS RÈGLES QUI TIENNENT CE FICHIER
 * ════════════════════════════════════════════════════════════════════════════
 *
 * 1. **L'approbation porte l'empreinte de ce qui est approuvé.** On ne stocke
 *    JAMAIS un `approuve: true` nu. `empreinteCanonique(publication)` est
 *    recalculée ici, sur le manifeste réellement rangé dans la ligne : changer
 *    une légende, un média, un créneau ou un compte cible fait diverger
 *    l'empreinte et INVALIDE l'approbation (`contenu_modifie_depuis_approbation`)
 *    au lieu de la traîner.
 *
 * 2. **On n'écrit jamais une approbation qui ne serait pas acceptée.** Avant
 *    l'écriture, l'objet fabriqué repasse par `verifierApprobation()` — la
 *    MÊME fonction que la sélection appellera au prochain passage. Si elle
 *    refuse, on refuse : une approbation écrite mais inopérante serait un faux
 *    témoin de plus, et le gérant croirait la publication débloquée.
 *
 * 3. **Une publication PARTIE ne s'approuve ni ne se désapprouve.** Le témoin
 *    de l'effet (`id_distant`) est définitif. Retirer une approbation après
 *    coup ne dépublierait rien : ce serait mentir sur l'état réel.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 🔴 LA SIGNATURE, ET CE QU'ELLE VAUT QUAND LA CLÉ EST ABSENTE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * `verifierApprobation()` ne contrôle la signature QUE si on lui passe une clé.
 * Celle-ci vient de `AUTOPOST_CLE_APPROBATION` (voir `autopost-executeur.js`).
 * Elle n'est pas posée aujourd'hui, et ce fichier n'en invente aucune.
 *
 * Conséquence, écrite ici pour ne pas être découverte plus tard : **sans cette
 * variable, la signature n'est ni produite ni vérifiée**. Ce qui protège alors
 * est ailleurs, et il faut le nommer :
 *
 *   - la porte HTTP, réservée à un administrateur connecté côté SERVEUR ;
 *   - la policy Supabase, qui réserve l'écriture de `autopost_file` au rôle de
 *     service — la clé `anon` du bundle public n'y touche pas ;
 *   - l'empreinte du contenu, qui, elle, est contrôlée en toutes circonstances.
 *
 * Ce que la clé absente laisse ouvert, précisément : un `APPROBATION.json`
 * déposé dans le Drive vaut alors autant que celle-ci. La serrure qui distingue
 * « approuvé par un humain » de « approuvé par le générateur de contenu »,
 * c'est la signature HMAC — pas le champ `origine`, que n'importe quel
 * déposant peut recopier. L'objet écrit le dit donc en toutes lettres
 * (`signature: 'absente'`), et l'écran l'affiche au lieu d'un voyant vert.
 */
import {
  empreinteCanonique, signerApprobation, verifierApprobation, ORIGINE_ECRAN,
} from './autopost-contrat.js';
import { ETATS_MODIFIABLES } from './autopost-alimentation.js';
import { formaterInstantUtc } from '../../src/lib/dates.js';

/** Motifs de refus propres à ce geste — distincts des 8 motifs du contrat. */
export const REFUS = Object.freeze({
  LIGNE_INCONNUE: 'ligne_inconnue',
  DEJA_PARTIE: 'deja_partie',
  ETAT_NON_MODIFIABLE: 'etat_non_modifiable',
  MANIFESTE_ABSENT: 'manifeste_absent',
  APPROBATION_INOPERANTE: 'approbation_inoperante',
  ECRITURE_REFUSEE: 'ecriture_refusee',
});

/** Phrases françaises des refus ci-dessus, pour l'écran du gérant. */
export const PHRASES_REFUS = Object.freeze({
  [REFUS.LIGNE_INCONNUE]: 'Cette ligne n\'est plus dans la file.',
  [REFUS.DEJA_PARTIE]: 'Cette publication est déjà partie : l\'approbation ne se change plus.',
  [REFUS.ETAT_NON_MODIFIABLE]: 'Cette ligne est en cours de traitement ou annulée : on n\'y touche pas maintenant.',
  [REFUS.MANIFESTE_ABSENT]: 'Le fichier publication.json manque sur cette ligne : sans lui, aucune empreinte ne peut être calculée, et une approbation sans empreinte ne vaut rien.',
  [REFUS.APPROBATION_INOPERANTE]: 'L\'approbation fabriquée serait refusée au moment de publier. Rien n\'a été écrit.',
  [REFUS.ECRITURE_REFUSEE]: 'La ligne a changé pendant l\'enregistrement. Rien n\'a été écrit — actualisez et recommencez.',
});

/**
 * Horodate un geste, en acceptant aussi bien un `Date` que la chaîne `…Z` que
 * les tests et les appelants internes manipulent.
 *
 * ⛔ Un instant illisible LÈVE, au lieu de produire `NaN-NaN-NaN`. Une date
 * fabriquée dans une approbation serait exactement le genre de valeur qu'on
 * relit six mois plus tard sans pouvoir dire ce qui s'est passé.
 */
function horodater(instant) {
  const d = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`instant illisible pour l'approbation : ${instant}`);
  }
  return formaterInstantUtc(d);
}

/** La clé de signature, ou `null`. Aucune valeur n'est fabriquée ici. */
export function cleSignatureApprobation() {
  return (process.env.AUTOPOST_CLE_APPROBATION || '').trim() || null;
}

/**
 * Fabrique l'objet d'approbation du §B.6 pour UNE ligne de file.
 *
 * Les six champs du haut sont ceux que `verifierApprobation()` lit. Les
 * suivants sont de la traçabilité : ils ne changent rien à l'acceptation, et
 * c'est voulu — un contrôle qui dépendrait de « qui a cliqué » serait un
 * contrôle qu'on peut recopier.
 *
 * @param {object} arg
 * @param {object} arg.publication  le manifeste rangé dans la ligne
 * @param {string} arg.canal  le canal de CETTE ligne, et lui seul
 * @param {string} arg.approuvePar  identifiant de session de l'administrateur
 * @param {Date|string} arg.instant
 * @param {string|null} [arg.cleSignature]
 * @returns {object}
 */
export function construireApprobation({
  publication, canal, approuvePar, instant, cleSignature = null,
}) {
  const c = publication?.creneau || {};
  const base = {
    approuve: true,
    publication_id: publication?.publication_id ?? null,
    version_contenu: publication?.version_contenu ?? null,
    canaux_approuves: [canal],
    payload_sha256: empreinteCanonique(publication),
    creneau_approuve: {
      date_locale: c.date_locale ?? null,
      heure_locale: c.heure_locale ?? null,
      offset_utc: c.offset_utc ?? null,
      fuseau: c.fuseau ?? null,
    },
  };

  return {
    ...base,
    // ⛔ `null` explicite, jamais une chaîne vide qui ressemblerait à une
    //    signature vide mais valide. Et la mention en clair à côté.
    signature_hmac_sha256: cleSignature ? signerApprobation(base, cleSignature) : null,
    signature: cleSignature ? 'hmac_sha256' : 'absente',
    origine: ORIGINE_ECRAN,
    approuve_par: approuvePar ?? null,
    approuve_le_utc: horodater(instant),
  };
}

/**
 * Fabrique le RETRAIT d'approbation.
 *
 * On écrit un objet `approuve: false` plutôt que `null` : la sélection le lit
 * comme `approbation_refusee` (et non `approbation_absente`), et la trace de
 * qui a retiré, et quand, reste sur la ligne. Une colonne remise à `null`
 * effacerait l'histoire au moment précis où elle devient intéressante.
 */
export function construireRetrait({ publication, approbationActuelle, retirePar, instant }) {
  return {
    approuve: false,
    publication_id: publication?.publication_id ?? null,
    version_contenu: publication?.version_contenu ?? null,
    canaux_approuves: [],
    origine: ORIGINE_ECRAN,
    retire_par: retirePar ?? null,
    retire_le_utc: horodater(instant),
    approbation_retiree: approbationActuelle?.approuve === true
      ? {
        approuve_par: approbationActuelle.approuve_par ?? null,
        approuve_le_utc: approbationActuelle.approuve_le_utc ?? null,
        payload_sha256: approbationActuelle.payload_sha256 ?? null,
      }
      : null,
  };
}

/**
 * Donne ou retire l'approbation d'une ligne de file.
 *
 * Rend `{ statut, corps }` — jamais une réponse HTTP : l'enveloppe est posée
 * par `api/autopost.js`, et cette fonction se teste sans réseau ni base.
 *
 * @param {object} arg
 * @param {object} arg.depot  dépôt Supabase (rôle de service)
 * @param {string} arg.cle  clé d'idempotence de la ligne
 * @param {boolean} arg.approuve  true = approuver, false = retirer
 * @param {string} arg.parQui  identifiant de session de l'administrateur
 * @param {Date|string} arg.instant
 * @param {string|null} [arg.cleSignature]
 */
export async function traiterApprobation({
  depot, cle, approuve, parQui, instant, cleSignature = null,
}) {
  if (typeof cle !== 'string' || cle.trim() === '') {
    return { statut: 400, corps: { error: 'cle_idempotence manquante' } };
  }

  const ligne = await depot.lirePourApprobation(cle);
  if (!ligne) return refus(404, REFUS.LIGNE_INCONNUE);

  /* ── 1. Le témoin de l'effet, avant tout le reste ────────────────────── */
  if (ligne.id_distant) return refus(409, REFUS.DEJA_PARTIE);
  if (!ETATS_MODIFIABLES.includes(ligne.etat)) return refus(409, REFUS.ETAT_NON_MODIFIABLE);

  /* ── 2. Sans manifeste, aucune empreinte — donc aucune approbation ───── */
  const publication = ligne.publication;
  if (!publication || typeof publication !== 'object') {
    return refus(409, REFUS.MANIFESTE_ABSENT);
  }

  const nouvelle = approuve
    ? construireApprobation({
      publication, canal: ligne.canal, approuvePar: parQui, instant, cleSignature,
    })
    : construireRetrait({
      publication, approbationActuelle: ligne.approbation, retirePar: parQui, instant,
    });

  /* ── 3. L'AUTO-CONTRÔLE. La même fonction que la sélection appellera. ──
     Une approbation écrite mais refusée au moment de publier serait pire que
     pas d'approbation du tout : le gérant croirait la ligne débloquée. */
  if (approuve) {
    const controle = verifierApprobation({
      publication, approbation: nouvelle, canal: ligne.canal, cleSignature,
    });
    if (!controle.approuve) {
      return {
        statut: 409,
        corps: {
          error: PHRASES_REFUS[REFUS.APPROBATION_INOPERANTE],
          motif: REFUS.APPROBATION_INOPERANTE,
          detail: controle.raison,
        },
      };
    }
  }

  /* ── 4. L'écriture, CONDITIONNELLE : la ligne a pu bouger entre-temps ── */
  const ecrite = await depot.ecrireApprobation(cle, nouvelle);
  if (!ecrite) return refus(409, REFUS.ECRITURE_REFUSEE);

  await depot.journaliser({
    instant_utc: horodater(instant),
    cle_idempotence: cle,
    publication_id: publication.publication_id ?? null,
    canal: ligne.canal ?? null,
    evenement: approuve ? 'approbation_donnee' : 'approbation_retiree',
    resume: approuve
      ? `approuvée par ${parQui || 'inconnu'} pour ${ligne.canal}`
        + `${cleSignature ? '' : ' — SANS signature (AUTOPOST_CLE_APPROBATION absente)'}`
      : `approbation retirée par ${parQui || 'inconnu'}`,
    piste: approuve && !cleSignature
      ? 'Tant que AUTOPOST_CLE_APPROBATION est absente, la signature n\'est ni produite ni vérifiée.'
      : null,
  });

  return {
    statut: 200,
    corps: {
      ok: true,
      cle_idempotence: cle,
      approuve,
      signature: approuve ? nouvelle.signature : null,
      approbation: nouvelle,
    },
  };
}

function refus(statut, motif) {
  return { statut, corps: { error: PHRASES_REFUS[motif], motif } };
}
