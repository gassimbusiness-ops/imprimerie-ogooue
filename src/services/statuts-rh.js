/**
 * Statuts des demandes RH — source unique de verite.
 *
 * ── Pourquoi ce module existe ─────────────────────────────────────────────
 * Deux ecrans manipulaient la meme collection `demandes_rh` avec deux
 * orthographes differentes :
 *
 *   src/features/performance-rh/page.jsx:279   ecrivait  'approuve'  / 'rejete'
 *   src/features/demandes-rh/page.jsx:106,329  lisait    'approuvee' / 'rejetee'
 *
 * Consequence mesuree le 15/09/2026 sur la base de production : les 4 demandes
 * existantes (200 000 F de charges) portent 'approuve'. L'ecran Demandes RH ne
 * les comptait donc dans aucun total, et le bouton « Marquer payee », qui exige
 * `statut === 'approuvee'`, ne s'affichait jamais. Une avance salariale
 * approuvee depuis Performance RH n'etait, pour la meme raison, jamais deduite
 * du salaire.
 *
 * ── Le contrat ────────────────────────────────────────────────────────────
 * 1. ON ECRIT toujours une valeur canonique de STATUT_RH.
 * 2. ON LIT toujours a travers `normaliserStatutRH()`, qui accepte les deux
 *    orthographes, les accents, la casse et les anciens alias anglais.
 *
 * Ainsi les lignes deja en base redeviennent visibles SANS aucune ecriture de
 * reparation : la tolerance est en lecture, pas en base.
 *
 * Ce module est volontairement pur : aucun import, aucun acces reseau, aucun
 * acces DOM. Il est teste par tests/statuts-rh.test.mjs.
 */

/** Valeurs canoniques — les seules qui doivent etre ECRITES en base. */
export const STATUT_RH = Object.freeze({
  EN_ATTENTE: 'en_attente',
  APPROUVEE: 'approuvee',
  REJETEE: 'rejetee',
  PAYEE: 'payee',
});

/** Libelles d'affichage (francais). */
export const LIBELLES_STATUT_RH = Object.freeze({
  [STATUT_RH.EN_ATTENTE]: 'En attente',
  [STATUT_RH.APPROUVEE]: 'Approuvée',
  [STATUT_RH.REJETEE]: 'Rejetée',
  [STATUT_RH.PAYEE]: 'Payée',
});

/**
 * Table des variantes acceptees EN LECTURE.
 * Cle = forme reduite (minuscule, sans accent, sans espace) ; valeur = canonique.
 * Toute valeur ajoutee ici doit etre justifiee par une donnee reellement
 * rencontree en base ou ecrite par une version anterieure du code.
 */
const VARIANTES = Object.freeze({
  // ── En attente ──
  en_attente: STATUT_RH.EN_ATTENTE,
  enattente: STATUT_RH.EN_ATTENTE,
  attente: STATUT_RH.EN_ATTENTE,
  pending: STATUT_RH.EN_ATTENTE, // lu par performance-rh/page.jsx:160
  // ── Approuvee ──
  approuve: STATUT_RH.APPROUVEE, // ecrit par performance-rh/page.jsx:279 (bug C7)
  approuvee: STATUT_RH.APPROUVEE,
  approved: STATUT_RH.APPROUVEE,
  valide: STATUT_RH.APPROUVEE,
  validee: STATUT_RH.APPROUVEE,
  // ── Rejetee ──
  rejete: STATUT_RH.REJETEE, // ecrit par performance-rh/page.jsx:279 (bug C7)
  rejetee: STATUT_RH.REJETEE,
  rejected: STATUT_RH.REJETEE,
  refuse: STATUT_RH.REJETEE,
  refusee: STATUT_RH.REJETEE,
  // ── Payee ──
  paye: STATUT_RH.PAYEE,
  payee: STATUT_RH.PAYEE,
  paid: STATUT_RH.PAYEE,
});

/** Reduit une chaine : minuscules, accents retires, espaces/tirets en `_`. */
function reduire(valeur) {
  return String(valeur ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

/**
 * Vrai si la valeur correspond a un statut connu.
 * Sert a distinguer « absent / inconnu » de « reellement en attente ».
 * @param {*} valeur
 * @returns {boolean}
 */
export function estStatutRHConnu(valeur) {
  return Object.prototype.hasOwnProperty.call(VARIANTES, reduire(valeur));
}

/**
 * Normalise n'importe quelle orthographe vers une valeur canonique.
 *
 * Choix de repli deliberé : une valeur absente ou inconnue devient
 * EN_ATTENTE, JAMAIS approuvee ni payee. Une erreur de lecture ne doit pas
 * pouvoir declencher un paiement.
 *
 * @param {*} valeur
 * @returns {string} une valeur de STATUT_RH
 */
export function normaliserStatutRH(valeur) {
  return VARIANTES[reduire(valeur)] ?? STATUT_RH.EN_ATTENTE;
}

/** Normalise le statut d'une demande (objet). */
export function statutDemande(demande) {
  return normaliserStatutRH(demande?.statut);
}

export function estEnAttente(demande) {
  return statutDemande(demande) === STATUT_RH.EN_ATTENTE;
}

export function estApprouvee(demande) {
  return statutDemande(demande) === STATUT_RH.APPROUVEE;
}

export function estRejetee(demande) {
  return statutDemande(demande) === STATUT_RH.REJETEE;
}

export function estPayee(demande) {
  return statutDemande(demande) === STATUT_RH.PAYEE;
}

/**
 * Vrai si la demande engage l'argent de l'entreprise : elle est approuvee ou
 * deja payee. C'est le predicat utilise pour la deduction sur salaire et pour
 * les totaux de charges.
 */
export function estEngageante(demande) {
  const s = statutDemande(demande);
  return s === STATUT_RH.APPROUVEE || s === STATUT_RH.PAYEE;
}

/** Libelle d'affichage d'une demande, quelle que soit l'orthographe stockee. */
export function libelleStatutDemande(demande) {
  return LIBELLES_STATUT_RH[statutDemande(demande)];
}
