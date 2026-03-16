/**
 * Service Mobile Money — Airtel Money & Moov Money (Gabon)
 * Prepare pour integration API reelle quand credentials disponibles.
 */

export async function initierPaiementAirtelMoney({ montant, telephone, commandeId }) {
  // TODO: Appeler l'API Airtel Money quand credentials disponibles
  // const response = await fetch('https://api.airtel.com/merchant/v1/payments/request', ...)
  return { success: true, reference: `AM-${Date.now()}`, status: 'pending' };
}

export async function initierPaiementMoovMoney({ montant, telephone, commandeId }) {
  // TODO: Appeler l'API Moov Money quand credentials disponibles
  // const response = await fetch('https://api.moov-money.com/merchant/v1/payments', ...)
  return { success: true, reference: `MM-${Date.now()}`, status: 'pending' };
}

export async function initierPaiement({ operateur, montant, telephone, commandeId }) {
  if (operateur === 'airtel') {
    return initierPaiementAirtelMoney({ montant, telephone, commandeId });
  }
  if (operateur === 'moov') {
    return initierPaiementMoovMoney({ montant, telephone, commandeId });
  }
  throw new Error('Operateur non supporte');
}
