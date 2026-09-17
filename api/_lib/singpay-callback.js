/**
 * Vercel Serverless Function — rappel (webhook) SingPay.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * OÙ SE RÈGLE L'ADRESSE DE RAPPEL — ET POURQUOI PAS DANS LA REQUÊTE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * L'adresse de rappel est une propriété DU PORTEFEUILLE SingPay, pas du corps
 * de la requête de paiement. La preuve vient de SingPay elle-même : toute
 * réponse de paiement contient l'objet `transaction.portefeuille`, et cet objet
 * porte le champ
 *
 *     "callbackURL": "https://imprimerie-ogooue-app.vercel.app/api/singpay-callback"
 *
 * (relevé dans `app_data`, collection `paiements_singpay`, les 3 transactions
 * du 31/05/2026 — et chacune de ces 3 transactions porte bien un `raw_callback`
 * reçu 2 à 5 secondes après l'initiation : le rappel fonctionne).
 *
 * Elle se règle donc UNE FOIS :
 *   - dans l'espace client SingPay (Portefeuille → Callback URL), ou
 *   - `node scripts/test-singpay.mjs callback <url>`   (PUT sur le portefeuille)
 * Vérification en lecture seule : `node scripts/test-singpay.mjs verifier`
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CE QUE CET ENDPOINT NE FAIT PAS
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Il ne croit rien de ce qu'on lui envoie. Le corps du message sert à savoir
 * QUELLE transaction re-vérifier ; le statut appliqué est toujours celui que
 * SingPay confirme sur `GET /transaction/api/search/by-reference/{ref}`.
 * Toute la logique d'écriture vit dans `api/_lib/singpay-encaissement.js`,
 * partagée avec le sondage (`singpay-status.js`) pour que les deux chemins ne
 * puissent pas encaisser deux fois.
 */
import { createClient } from '@supabase/supabase-js';
import {
  depotSupabase,
  lireMessageRappel,
  verifierSecretCallback,
  verifierAupresDeSingPay,
  appliquerStatutPaiement,
} from './singpay-encaissement.js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY,
);

export default async function handler(req, res) {
  // ── 1. Authentification du rappel (secret partagé dans l'URL enregistrée)
  const auth = verifierSecretCallback(req);
  if (!auth.ok) {
    console.warn('[SingPay Callback] Rappel refusé :', auth.raison);
    // 401 explicite : SingPay ré-essaiera, et le refus est visible dans les logs.
    return res.status(401).json({ error: 'Rappel non authentifié' });
  }
  if (auth.mode === 'ouvert') {
    console.warn(
      '[SingPay Callback] SINGPAY_CALLBACK_SECRET absent : endpoint ouvert. '
      + 'Le statut reste re-vérifié auprès de SingPay, mais poser ce secret est recommandé.',
    );
  }

  // SingPay peut envoyer GET ou POST.
  const payload = req.method === 'POST' ? req.body : req.query;
  const { reference, transactionId, resultAnnonce, statutAnnonce } = lireMessageRappel(payload);
  console.log('[SingPay Callback] Reçu ref=%s tx=%s annonce=%s/%s', reference, transactionId, statutAnnonce, resultAnnonce);

  if (!reference && !transactionId) {
    return res.status(400).json({ error: 'Reference ou transaction_id requis' });
  }

  try {
    const depot = depotSupabase(supabase);
    const paiementRow = await depot.lirePaiement({ reference, transactionId });

    if (!paiementRow) {
      console.error('[SingPay Callback] Transaction inconnue:', reference, transactionId);
      // 200 volontaire : une transaction qu'on ne connaît pas ne sera jamais
      // connue, inutile que SingPay la rejoue indéfiniment.
      return res.status(200).json({ success: false, error: 'Transaction non trouvee' });
    }

    // ── 2. Source de vérité : SingPay, pas le message reçu.
    const refVerif = paiementRow.data?.payment_reference || reference;
    const verif = await verifierAupresDeSingPay(refVerif);

    if (!verif.joignable) {
      console.error('[SingPay Callback] Re-vérification impossible (%s) — aucune écriture', verif.erreur);
      // 502 : SingPay rejouera. Ne rien écrire est le comportement sûr.
      return res.status(502).json({ success: false, error: 'Verification SingPay indisponible' });
    }

    // ── 3. Écriture, par le chemin unique partagé avec le sondage.
    const resultat = await appliquerStatutPaiement({
      depot,
      paiementRow,
      statutVerifie: verif.statut,
      montantVerifie: verif.montant,
      result: verif.result,
      statutTransaction: verif.statutTransaction,
      rawCallback: payload,
      origine: 'rappel',
    });

    return res.status(200).json({
      success: true,
      status: resultat.statut,
      applique: resultat.applique,
      mouvement_cree: resultat.mouvementCree,
      ...(resultat.raison ? { detail: resultat.raison } : {}),
    });

  } catch (err) {
    console.error('[SingPay Callback] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}
