/**
 * Vercel Serverless Function — Initiation paiement SingPay Mobile Money
 * POST /api/singpay-initiate
 *
 * Body: { commandeId, montant, telephone, operateur, nomClient }
 *  - operateur : 'airtel' | 'moov' | 'ext'
 *  - telephone : numero gabonais (8 chiffres, avec ou sans 241)
 *  - montant   : F CFA (XAF)
 *
 * API officielle SingPay :
 *   POST https://gateway.singpay.ga/v1/74/paiement   (Airtel)
 *   POST https://gateway.singpay.ga/v1/62/paiement   (Moov)
 *   POST https://gateway.singpay.ga/v1/ext            (Lien de paiement externe)
 *
 * Headers : x-client-id, x-client-secret, x-wallet
 * Body    : { amount, reference, client_msisdn, portefeuille, isTransfer }
 */
import { getSingPayHeaders, getPaiementEndpoint, SINGPAY_BASE_URL } from '../src/lib/singpayAuth.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { commandeId, montant, telephone, operateur, nomClient } = req.body || {};

  // ── Validation
  if (!commandeId || !montant || !operateur) {
    return res.status(400).json({ error: 'Parametres manquants (commandeId, montant, operateur)' });
  }
  if (!['airtel', 'moov', 'ext'].includes(operateur)) {
    return res.status(400).json({ error: 'Operateur invalide. Valeurs : airtel | moov | ext' });
  }

  // Telephone obligatoire pour airtel/moov, optionnel pour ext (saisi sur la page SingPay)
  let telClean = '';
  if (operateur === 'airtel' || operateur === 'moov') {
    if (!telephone) return res.status(400).json({ error: 'Telephone requis pour airtel/moov' });
    telClean = telephone.replace(/[\s\-+]/g, '');
    // Format : on accepte 8 chiffres, ou 241XXXXXXXX, ou 00241XXXXXXXX → on normalise vers 241XXXXXXXX
    if (!/^(00241|241)?[0-9]{8}$/.test(telClean)) {
      return res.status(400).json({ error: 'Numero de telephone invalide (format gabonais attendu)' });
    }
    if (telClean.startsWith('00241')) telClean = telClean.slice(5);
    if (telClean.startsWith('241')) telClean = telClean.slice(3);
    // SingPay attend les 8 chiffres locaux sans indicatif (a verifier en test)
    // Si jamais SingPay veut 241XXXXXXXX, decommenter :
    // telClean = '241' + telClean;
  }

  try {
    const walletId = process.env.SINGPAY_WALLET_ID;
    const callbackUrl = process.env.SINGPAY_CALLBACK_URL || 'https://imprimerie-ogooue-app.vercel.app/api/singpay-callback';
    const reference = `OGO-${commandeId.slice(0, 8)}-${Date.now()}`;

    // ── Construction du body selon endpoint
    let endpoint;
    let body;
    if (operateur === 'ext') {
      // Page de paiement externe SingPay (le client choisit l'operateur sur la page hostee)
      endpoint = `${SINGPAY_BASE_URL}/ext`;
      body = {
        portefeuille: walletId,
        reference,
        amount: Math.round(montant),
        redirect_success: `https://imprimerie-ogooue-app.vercel.app/client/commandes?paiement=success&ref=${reference}`,
        redirect_error: `https://imprimerie-ogooue-app.vercel.app/client/commandes?paiement=error&ref=${reference}`,
        isTransfer: false,
      };
    } else {
      // USSD push direct sur Airtel ou Moov
      endpoint = getPaiementEndpoint(operateur);
      body = {
        amount: Math.round(montant),
        reference,
        client_msisdn: telClean,
        portefeuille: walletId,
        isTransfer: false,
      };
    }

    // ── Appel SingPay
    const paymentResponse = await fetch(endpoint, {
      method: 'POST',
      headers: getSingPayHeaders(),
      body: JSON.stringify(body),
    });

    const paymentData = await paymentResponse.json().catch(() => ({}));

    if (!paymentResponse.ok || paymentData?.status?.success === false) {
      console.error('[SingPay] Initiation failed:', paymentResponse.status, paymentData);
      return res.status(502).json({
        error: paymentData?.status?.message || paymentData?.message || 'Erreur SingPay',
        details: paymentData,
      });
    }

    // ── Extraction des identifiants de transaction
    // Reponse paiement USSD : { transaction: {...}, status: {code, message, success, result_code} }
    // Reponse ext           : { link, exp }
    const tx = paymentData.transaction || {};
    const transactionId = tx._id || tx.id || reference;
    const externalLink = paymentData.link || null;
    const expiresAt = paymentData.exp || null;

    // ── Persistance dans Supabase
    await supabase.from('app_data').insert({
      id: crypto.randomUUID(),
      collection: 'paiements_singpay',
      data: {
        id: crypto.randomUUID(),
        commande_id: commandeId,
        singpay_transaction_id: transactionId,
        payment_reference: reference,
        wallet_id: walletId,
        phone_number: telClean,
        operateur,
        amount: Math.round(montant),
        status: 'pending',
        nom_client: nomClient || 'Client',
        external_link: externalLink,
        expires_at: expiresAt,
        raw_response: paymentData,
        created_at: new Date().toISOString(),
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // ── Mise a jour de la commande
    const { data: cmdRow } = await supabase
      .from('app_data')
      .select('id, data')
      .eq('id', commandeId)
      .eq('collection', 'commandes')
      .maybeSingle();

    if (cmdRow) {
      await supabase.from('app_data').update({
        data: {
          ...cmdRow.data,
          statut: 'paiement_initie',
          operateur_paiement: operateur,
          telephone_paiement: telClean,
          singpay_reference: reference,
          singpay_transaction_id: transactionId,
          updated_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      }).eq('id', commandeId);
    }

    res.json({
      success: true,
      reference,
      transactionId,
      externalLink, // non-null si operateur='ext'
      expiresAt,
      message: operateur === 'ext'
        ? 'Lien de paiement genere'
        : 'Paiement initie — confirmez sur votre telephone via USSD',
    });

  } catch (err) {
    console.error('[SingPay] Initiation error:', err);
    res.status(500).json({ error: err.message });
  }
}
