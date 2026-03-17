/**
 * SingPay OAuth2 Authentication — côté serveur uniquement (Vercel Serverless Functions)
 * ⚠️ Ne JAMAIS importer ce fichier dans le frontend React
 *
 * OAuth2 client_credentials flow avec cache de token.
 * Doc SingPay : https://client.singpay.ga/doc/reference/index.html
 */

let cachedToken = null;
let tokenExpiresAt = null;

export async function getSingPayToken() {
  // Réutiliser le token si encore valide (marge de 60 secondes)
  if (cachedToken && tokenExpiresAt && Date.now() < tokenExpiresAt - 60000) {
    return cachedToken;
  }

  const clientId = process.env.SINGPAY_CLIENT_ID;
  const clientSecret = process.env.SINGPAY_CLIENT_SECRET;
  const baseUrl = process.env.SINGPAY_BASE_URL || 'https://client.singpay.ga';

  if (!clientId || !clientSecret) {
    throw new Error('SINGPAY_CLIENT_ID et SINGPAY_CLIENT_SECRET requis');
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await fetch(`${baseUrl}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`,
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('[SingPay] Auth failed:', response.status, error);
    throw new Error(`SingPay auth failed (${response.status}): ${error}`);
  }

  const data = await response.json();

  cachedToken = data.access_token;
  // expires_in en secondes → timestamp ms
  tokenExpiresAt = Date.now() + (data.expires_in * 1000);

  console.log('[SingPay] Token obtenu, expire dans', data.expires_in, 'secondes');
  return cachedToken;
}
