/**
 * Echec d'ecriture en base — type et message.
 *
 * ── Pourquoi ce module existe ─────────────────────────────────────────────
 *
 * `src/services/db.js` avalait les echecs d'ecriture :
 *
 *     if (error) { console.error(`[db] update ${this.name}:`, error.message); return null; }
 *     if (error) { console.error(`[db] delete ${this.name}:`, error.message); return false; }
 *
 * Aucun des 99 appelants ne testait ce retour. Resultat, constat C6 de l'audit
 * VAGUE 2 : sur une coupure reseau a Moanda, sur un refus RLS, sur une ligne
 * absente, l'ecriture echouait, `null` revenait, et le toast VERT s'affichait
 * quand meme. Le cas le plus couteux mesure : gouvernance/page.jsx:327, ou le
 * remboursement est cree mais le solde de la dette n'est pas recalcule — et
 * l'ecran annonce « Remboursement enregistre ».
 *
 * La couche de donnees leve desormais. Ce module porte le type de l'erreur et
 * son message, pour que :
 *   - le message nomme la collection et l'operation, pas « Erreur » ;
 *   - le filet global de src/services/filet-ecriture.js puisse reconnaitre
 *     une erreur d'ecriture parmi les autres rejets.
 *
 * Module pur : aucun import. Teste par tests/erreur-ecriture.test.mjs.
 */

/**
 * Libelles francais des collections, pour un message comprehensible.
 *
 * EXPORTE depuis le 17/09/2026 : `src/services/chargement.js` compose les
 * messages d'echec de LECTURE a partir de la meme table. Deux tables auraient
 * diverge — c'est exactement ce qui a casse les notifications (voir
 * tasks/lessons.md). Un seul endroit, donc.
 */
export const LIBELLES_COLLECTION = Object.freeze({
  rapports: 'le rapport journalier',
  rapport_lignes: 'les lignes du rapport',
  commandes: 'la commande',
  clients: 'la fiche client',
  factures: 'la facture',
  devis: 'le devis',
  produits: "l'article de stock",
  mouvements_stock: 'le mouvement de stock',
  comptes_bancaires: 'le compte bancaire',
  mouvements_financiers: "l'écriture de trésorerie",
  dettes: 'la dette',
  dettes_associes: 'la dette envers un associé',
  remboursements_associes: 'le remboursement',
  charges_fixes: 'la charge fixe',
  demandes_rh: 'la demande RH',
  employes: "la fiche employé",
  pointages: 'le pointage',
  taches: 'la tâche',
  clotures_caisse: 'la clôture de caisse',
  fidelite_clients: 'les points de fidélité',
  objectifs: "l'objectif",
  performances_employes: "l'évaluation de performance",
  produits_catalogue: 'le produit du catalogue',
  notifications_app: 'la notification',
  // Ajouts du 17/09/2026 : collections lues par les ecrans repris (chargement).
  users: "le compte d'utilisateur",
  parametres: 'les paramètres',
  audit_logs: "le journal d'activité",
  paiements_mobile: 'le paiement mobile',
  prospects: 'le prospect',
  conversations: 'la conversation',
  messages_conv: 'le message',
  evenements: "l'événement",
  projets_travaux: 'le chantier',
  etapes_travaux: "l'étape de chantier",
  tarifs_clients: 'le tarif client',
  actionnaires: "l'associé",
  investissements: "l'investissement",
  apports_associes: "l'apport d'associé",
  investisseurs: "l'investisseur",
  depots_hebdo: 'le dépôt hebdomadaire',
  campagnes_prospection: 'la campagne de prospection',
  actions_marketing: "l'action marketing",
});

/** Verbes francais des operations. */
const LIBELLES_OPERATION = Object.freeze({
  update: 'La modification de',
  delete: 'La suppression de',
  create: "L'enregistrement de",
});

/**
 * Compose le message montre au gerant.
 *
 * Il doit repondre a trois questions en une phrase : QUOI a echoue, SUR QUOI,
 * et QUE FAIRE. « Erreur lors de l'enregistrement » ne repond a aucune des trois.
 *
 * @param {string} collection nom technique de la collection
 * @param {string} operation 'update' | 'delete' | 'create'
 * @param {string} [cause] message technique remonte par Supabase
 * @returns {string}
 */
export function messageEchecEcriture(collection, operation, cause) {
  const quoi = LIBELLES_COLLECTION[collection] || `« ${collection} »`;
  const verbe = LIBELLES_OPERATION[operation] || 'L\'écriture de';
  const detail = cause ? ` (${cause})` : '';
  return `${verbe} ${quoi} n'a PAS été enregistrée${detail}. `
    + 'Vérifiez votre connexion et recommencez : rien n\'a été modifié.';
}

/**
 * Erreur levee par la couche de donnees quand une ecriture echoue.
 *
 * On expose `collection`, `operation` et `id` pour que l'appelant — ou le filet
 * global — puisse decider quoi afficher sans reanalyser un message.
 */
export class ErreurEcriture extends Error {
  /**
   * @param {{collection: string, operation: string, id?: string, cause?: any}} infos
   */
  constructor({ collection, operation, id, cause }) {
    const causeTexte = cause && cause.message ? String(cause.message)
      : (typeof cause === 'string' ? cause : undefined);
    super(messageEchecEcriture(collection, operation, causeTexte));
    this.name = 'ErreurEcriture';
    this.collection = collection;
    this.operation = operation;
    this.id = id;
    this.causeTexte = causeTexte;
    // `estErreurEcriture` permet de reconnaitre l'erreur meme apres un passage
    // par une frontiere de module ou une serialisation structuree.
    this.estErreurEcriture = true;
  }
}

/**
 * Vrai si la valeur est un echec d'ecriture en base.
 * On ne se fie pas a `instanceof` seul : en developpement, Vite peut servir
 * deux instances du meme module, et `instanceof` echouerait alors.
 *
 * @param {*} valeur
 * @returns {boolean}
 */
export function estErreurEcriture(valeur) {
  return Boolean(valeur && typeof valeur === 'object' && valeur.estErreurEcriture === true);
}
