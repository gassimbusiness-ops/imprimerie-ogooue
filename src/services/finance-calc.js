/**
 * finance-calc.js — Source UNIQUE de vérité pour les calculs financiers transverses.
 *
 * Avant ce module, les calculs de trésorerie, valeur de stock et valorisation
 * d'entreprise étaient dupliqués (et divergents) dans gouvernance, associe-portal,
 * zakat, dashboard et finances. Ce fichier centralise la logique pour garantir
 * que TOUS les écrans affichent les MÊMES chiffres pour les mêmes données.
 *
 * Règles métier :
 * - Trésorerie "Imprimerie" = comptes locaux (whitelist) hors comptes internationaux
 *   (blacklist). Un compte peut aussi être inclus via le flag appartient_imprimerie.
 * - Le stock est TOUJOURS valorisé au COÛT (prix d'achat), jamais au prix de vente.
 * - Les machines & outils sont comptés UNE seule fois (ligne séparée des consommables).
 * - Le passif (dette) n'est jamais négatif (borné à 0).
 */

const COMPTES_IMPRIMERIE = ['finam', 'bgfi', 'airtel', 'moov', 'caisse', 'liquide'];
const COMPTES_EXCLUS = ['wise', 'mercury', 'paypal', 'stripe', 'airwallex'];

/** Un compte fait-il partie de la trésorerie "Imprimerie" ? */
export function isCompteImprimerie(compte) {
  const nom = (compte?.nom || '').toLowerCase();
  if (COMPTES_EXCLUS.some((k) => nom.includes(k))) return false;
  return COMPTES_IMPRIMERIE.some((k) => nom.includes(k)) || compte?.appartient_imprimerie === true;
}

/** Un compte est-il un compte de caisse/liquide (vs compte bancaire) ? */
export function isCompteCaisse(compte) {
  const nom = (compte?.nom || '').toLowerCase();
  return nom.includes('caisse') || nom.includes('liquide');
}

/**
 * Trésorerie Imprimerie : { compte, caisse, total }.
 * @param {Array} comptes - comptes_bancaires
 */
export function tresorerieImprimerie(comptes = []) {
  const imprimerie = (comptes || []).filter(isCompteImprimerie);
  const compte = imprimerie.filter((c) => !isCompteCaisse(c)).reduce((s, c) => s + (c.solde || 0), 0);
  const caisse = imprimerie.filter(isCompteCaisse).reduce((s, c) => s + (c.solde || 0), 0);
  return { compte, caisse, total: compte + caisse, comptes: imprimerie };
}

/** Est-ce une machine/outil (immobilisation) plutôt qu'un consommable ? */
export function isMachine(produit) {
  return (produit?.type_article || 'consommable') === 'machine';
}

/**
 * Valeur d'UN produit au COÛT (prix d'achat).
 * Priorité : valeur_stock_achat (pré-calculée à l'import) sinon prix_unitaire × qte.
 * On n'utilise prix_vente qu'en ultime fallback (produit sans coût renseigné).
 */
export function valeurAchatProduit(produit) {
  if (produit?.valeur_stock_achat != null) return Number(produit.valeur_stock_achat) || 0;
  const qte = produit?.quantite ?? produit?.stock ?? 0;
  const prix = produit?.prix_achat ?? produit?.prix_unitaire ?? produit?.prix_vente ?? 0;
  return (Number(prix) || 0) * (Number(qte) || 0);
}

/**
 * Valeur totale du stock CONSOMMABLE (machines exclues), au coût.
 */
export function valeurStockConsommables(produits = []) {
  return (produits || []).reduce((s, p) => (isMachine(p) ? s : s + valeurAchatProduit(p)), 0);
}

/**
 * Valeur totale des MACHINES & OUTILS, au coût.
 */
export function valeurMachines(produits = []) {
  return (produits || []).reduce((s, p) => (isMachine(p) ? s + valeurAchatProduit(p) : s), 0);
}

/**
 * Valeur totale de TOUT le stock (consommables + machines), au coût.
 * = ce qu'affiche le module Stocks. Garantit l'égalité Stocks ↔ Gouvernance.
 */
export function valeurStockTotal(produits = []) {
  return (produits || []).reduce((s, p) => s + valeurAchatProduit(p), 0);
}

/**
 * Valorisation complète de l'entreprise (source unique pour Gouvernance,
 * Associé, Zakat).
 * @param {Object} opts
 * @param {Array} opts.produits
 * @param {Array} opts.comptes
 * @param {number} opts.detteRestant - reste à payer de la dette associé (peut être négatif en entrée)
 * @returns {{ inventaire, machines, tresorerie, tresorerieCompte, tresorerieCaisse, actifs, passifs, valeurNette }}
 */
export function valorisationEntreprise({ produits = [], comptes = [], detteRestant = 0 } = {}) {
  const inventaire = valeurStockConsommables(produits); // consommables au coût, machines exclues
  const machines = valeurMachines(produits);            // machines au coût (comptées 1 seule fois)
  const tr = tresorerieImprimerie(comptes);
  const actifs = inventaire + machines + tr.total;
  const passifs = Math.max(0, Number(detteRestant) || 0); // jamais négatif
  return {
    inventaire,
    machines,
    tresorerie: tr.total,
    tresorerieCompte: tr.compte,
    tresorerieCaisse: tr.caisse,
    actifs,
    passifs,
    valeurNette: actifs - passifs,
  };
}

/**
 * Normalise une charge fixe en montant MENSUEL (pour comparaisons et prévisionnel).
 */
export function chargeMensuelle(charge) {
  const m = Number(charge?.montant) || 0;
  const p = (charge?.periodicite || charge?.frequence || 'mensuelle').toLowerCase();
  if (p.startsWith('annu')) return m / 12;
  if (p.startsWith('trim')) return m / 3;
  return m; // mensuel par défaut
}

/**
 * Normalise une charge fixe en montant ANNUEL (pour le P&L de Gouvernance).
 */
export function chargeAnnuelle(charge) {
  return chargeMensuelle(charge) * 12;
}
