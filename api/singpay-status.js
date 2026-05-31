/**
 * Vercel Serverless Function — Verification statut transaction SingPay
 * GET /api/singpay-status?reference=OGO-xxx-xxx
 *
 * Le frontend interroge cet endpoint en polling pour suivre le paiement.
 *
 * Strategie :
 *  1. Si la transaction est deja marquee 'paid' / 'failed' en local (callback recu),
 *     on retourne le statut local sans appeler SingPay.
 *  2. Sinon on interroge SingPay via :
 *     GET /v1/transaction/api/search/by-reference/{reference}
 *     puis on mappe le `result` SingPay vers nos statuts locaux.
 *
 * Mapping result SingPay -> statut interne :
 *  - Success        -> paid
 *  - PasswordError  -> failed   (mot de passe Airtel/Moov incorrect)
 *  - BalanceError   -> failed   (fonds insuffisants)
 *  - TimeOutError   -> expired  (le client n'a pas confirme a temps)
 *  - Error          -> failed   (erreur generique)
 *  - undefined      -> pending  (transaction en cours, pas encore terminee)
 */
import { getSingPayHeaders, SINGPAY_BASE_URL } from '../src/lib/singpayAuth.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

function mapResultToStatus(result, status) {
  // SingPay envoie soit `result` (final), soit `status` ('Start' | 'Partenaire' | 'Terminate' | ...)
  // Tant que status n'est pas 'Terminate', la transaction est pending.
  if (!result) {
    if (status === 'Terminate') return 'failed'; // termine sans result = anormal
    return 'pending';
  }
  switch (result) {
    case 'Success':       return 'paid';
    case 'PasswordError': return 'failed';
    case 'BalanceError':  return 'failed';
    case 'TimeOutError':  return 'expired';
    case 'Error':         return 'failed';
    default:              return 'pending';
  }
}

export default async function handler(req, res) {
  const { reference } = req.query;
  if (!reference) return res.status(400).json({ error: 'Reference manquante' });

  try {
    // 1) Lookup local d'abord
    const { data: allPaiements } = await supabase
      .from('app_data')
      .select('id, data')
      .eq('collection', 'paiements_singpay');

    const paiementRow = (allPaiements || []).find((row) =>
      row.data?.payment_reference === reference
    );
    const paiement = paiementRow?.data;

    // Court-circuit si statut final deja connu
    if (paiement?.status === 'paid') {
      return res.json({ status: 'paid', paid_at: paiement.paid_at });
    }
    if (['failed', 'expired', 'cancelled'].includes(paiement?.status)) {
      return res.json({ status: paiement.status });
    }

    // 2) Sinon, interrogation SingPay
    try {
      const lookupUrl = `${SINGPAY_BASE_URL}/transaction/api/search/by-reference/${encodeURIComponent(reference)}`;
      const r = await fetch(lookupUrl, {
        method: 'GET',
        headers: getSingPayHeaders({ includeWallet: false }),
      });

      if (r.ok) {
        const data = await r.json();
        // La reponse peut etre un objet transaction direct OU un wrapper { transaction, status }
        const tx = data.transaction || data;
        const result = tx.result;
        const txStatus = tx.status;
        const mapped = mapResultToStatus(result, txStatus);

        // Sync local si necessaire
        if (paiementRow && mapped !== paiement?.status) {
          await supabase.from('app_data').update({
            data: {
              ...paiement,
              status: mapped,
              singpay_result: result,
              singpay_status: txStatus,
              paid_at: mapped === 'paid' ? new Date().toISOString() : paiement?.paid_at || null,
              updated_at: new Date().toISOString(),
            },
            updated_at: new Date().toISOString(),
          }).eq('id', paiementRow.id);
        }

        return res.json({
          status: mapped,
          result,
          singpay_status: txStatus,
          airtel_money_id: tx.airtel_money_id,
        });
      }

      console.warn('[SingPay Status] HTTP', r.status, 'pour ref', reference);
    } catch (apiErr) {
      console.warn('[SingPay Status] API check failed, fallback local:', apiErr.message);
    }

    // 3) Fallback : statut local connu
    res.json({ status: paiement?.status || 'pending' });

  } catch (err) {
    console.error('[SingPay Status] Error:', err);
    res.status(500).json({ error: err.message });
  }
}
