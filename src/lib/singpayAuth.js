/**
 * SingPay Client — helpers cote serveur uniquement (Vercel Serverless Functions).
 * /!\ NE JAMAIS importer ce fichier dans le frontend React (expose les secrets).
 *
 * L'API SingPay n'utilise PAS un flow OAuth2 token Bearer.
 * Les credentials voyagent dans CHAQUE requete via 3 headers :
 *   - x-client-id     : Client ID OAuth 2.0
 *   - x-client-secret : Client Secret OAuth 2.0
 *   - x-wallet        : Wallet ID du portefeuille
 *
 * Base URL officielle : https://gateway.singpay.ga/v1
 * Doc : https://client.singpay.ga/doc/reference/index.html
 */

// Sanitize : retire espaces de debut/fin + tout ce qui suit le premier espace
// (resilient aux env vars copiees avec un commentaire entre parentheses, ex :
//  "69bab43545318bccb8e8ab94 (wallet TEST OA3247)" devient "69bab43545318bccb8e8ab94")
function clean(v) {
  return (v || '').trim().split(/\s/)[0];
}

export const SINGPAY_BASE_URL = clean(process.env.SINGPAY_BASE_URL) || 'https://gateway.singpay.ga/v1';

/**
 * Construit les headers d'auth SingPay.
 * Tous les endpoints (paiement, status, portefeuille) en ont besoin.
 */
export function getSingPayHeaders({ includeWallet = true } = {}) {
  const clientId = clean(process.env.SINGPAY_CLIENT_ID);
  const clientSecret = clean(process.env.SINGPAY_CLIENT_SECRET);
  const walletId = clean(process.env.SINGPAY_WALLET_ID);

  if (!clientId || !clientSecret) {
    throw new Error('SINGPAY_CLIENT_ID et SINGPAY_CLIENT_SECRET requis (Vercel Env Vars)');
  }
  if (includeWallet && !walletId) {
    throw new Error('SINGPAY_WALLET_ID requis (Vercel Env Vars)');
  }

  const headers = {
    'Content-Type': 'application/json',
    'x-client-id': clientId,
    'x-client-secret': clientSecret,
  };
  if (includeWallet) headers['x-wallet'] = walletId;
  return headers;
}

/**
 * Resout l'endpoint paiement selon l'operateur choisi par le client.
 *  - 74 = Airtel Money (prefixe Gabon)
 *  - 62 = Moov Money (prefixe Gabon)
 *  - ext = page de paiement externe (multi-operateurs hostee par SingPay)
 */
export function getPaiementEndpoint(operateur) {
  switch (operateur) {
    case 'airtel':
    case 'airtel_money':
      return `${SINGPAY_BASE_URL}/74/paiement`;
    case 'moov':
    case 'moov_money':
      return `${SINGPAY_BASE_URL}/62/paiement`;
    case 'ext':
    case 'external':
      return `${SINGPAY_BASE_URL}/ext`;
    default:
      throw new Error(`Operateur SingPay invalide: ${operateur}. Valeurs: airtel | moov | ext`);
  }
}
