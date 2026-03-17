/**
 * Vercel Serverless Function — Vérification statut transaction SingPay
 * GET /api/singpay-status?reference=OGO-xxx-xxx
 *
 * Le frontend interroge cet endpoint en polling pour suivre le paiement.
 */
import { getSingPayToken } from '../src/lib/singpayAuth.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  const { reference } = req.query;
  if (!reference) return res.status(400).json({ error: 'Reference manquante' });

  try {
    // D'abord verifier dans Supabase (le callback a peut-etre deja mis a jour)
    const { data: allPaiements } = await supabase
      .from('app_data')
      .select('id, data')
      .eq('collection', 'paiements_singpay');

    const paiementRow = (allPaiements || []).find((row) =>
      row.data?.payment_reference === reference
    );

    const paiement = paiementRow?.data;

    // Si deja confirme en local, pas besoin d'appeler SingPay
    if (paiement?.status === 'paid') {
      return res.json({ status: 'paid', paid_at: paiement.paid_at });
    }
    if (paiement?.status === 'failed' || paiement?.status === 'expired' || paiement?.status === 'cancelled') {
      return res.json({ status: paiement.status });
    }

    // Sinon, verifier aupres de SingPay
    try {
      const token = await getSingPayToken();
      const baseUrl = process.env.SINGPAY_BASE_URL || 'https://client.singpay.ga';

      const statusResponse = await fetch(
        `${baseUrl}/api/transactions/${reference}/status`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );

      if (statusResponse.ok) {
        const statusData = await statusResponse.json();
        return res.json({
          status: statusData.status || paiement?.status || 'pending',
          data: statusData,
        });
      }
    } catch (apiErr) {
      console.warn('[SingPay Status] API check failed, using local status:', apiErr.message);
    }

    // Fallback : retourner le statut local
    res.json({
      status: paiement?.status || 'pending',
    });

  } catch (err) {
    console.error('[SingPay Status] Error:', err);
    res.status(500).json({ error: err.message });
  }
}
