/**
 * Vercel Serverless Function — Initiation paiement SingPay Mobile Money
 * POST /api/singpay-initiate
 *
 * Body: { commandeId, montant, telephone, operateur, nomClient }
 */
import { getSingPayToken } from '../src/lib/singpayAuth.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { commandeId, montant, telephone, operateur, nomClient } = req.body;

  // Validation
  if (!commandeId || !montant || !telephone || !operateur) {
    return res.status(400).json({ error: 'Parametres manquants (commandeId, montant, telephone, operateur)' });
  }

  if (!['airtel', 'moov'].includes(operateur)) {
    return res.status(400).json({ error: 'Operateur invalide. Valeurs acceptees : airtel, moov' });
  }

  // Validation telephone gabonais (8 chiffres, avec ou sans indicatif 241)
  const telClean = telephone.replace(/[\s\-\+]/g, '');
  if (!/^(00241|241)?[0-9]{8}$/.test(telClean)) {
    return res.status(400).json({ error: 'Numero de telephone invalide (format gabonais attendu)' });
  }

  try {
    const token = await getSingPayToken();
    const baseUrl = process.env.SINGPAY_BASE_URL || 'https://client.singpay.ga';
    const callbackUrl = process.env.SINGPAY_CALLBACK_URL || 'https://imprimerie-ogooue-app.vercel.app/api/singpay-callback';

    // Reference unique pour cette transaction
    const reference = `OGO-${commandeId.slice(0, 8)}-${Date.now()}`;

    // Appel API SingPay — initiation paiement
    const paymentResponse = await fetch(`${baseUrl}/api/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        wallet_id: process.env.SINGPAY_WALLET_ID,
        amount: Math.round(montant),
        phone_number: telClean,
        operator: operateur,
        reference: reference,
        description: `Commande Imprimerie Ogooue #${commandeId.slice(0, 8)}`,
        customer_name: nomClient || 'Client',
        callback_url: callbackUrl,
      }),
    });

    const paymentData = await paymentResponse.json();

    if (!paymentResponse.ok) {
      console.error('[SingPay] Initiation failed:', paymentResponse.status, paymentData);
      throw new Error(paymentData.message || paymentData.error || 'Erreur SingPay');
    }

    // Sauvegarder la transaction dans Supabase (table app_data, collection paiements_singpay)
    const transactionId = paymentData.transaction_id || paymentData.id || reference;
    await supabase.from('app_data').insert({
      id: crypto.randomUUID(),
      collection: 'paiements_singpay',
      data: {
        id: crypto.randomUUID(),
        commande_id: commandeId,
        singpay_transaction_id: transactionId,
        payment_reference: reference,
        wallet_id: process.env.SINGPAY_WALLET_ID,
        phone_number: telClean,
        operateur: operateur,
        amount: Math.round(montant),
        status: 'pending',
        nom_client: nomClient || 'Client',
        raw_response: paymentData,
        created_at: new Date().toISOString(),
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Mettre a jour la commande dans app_data
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
          updated_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      }).eq('id', commandeId);
    }

    res.json({
      success: true,
      reference,
      transactionId,
      message: 'Paiement initie — confirmez sur votre telephone',
    });

  } catch (err) {
    console.error('[SingPay] Initiation error:', err);
    res.status(500).json({ error: err.message });
  }
}
