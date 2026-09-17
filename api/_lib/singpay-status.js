/**
 * Vercel Serverless Function — statut d'une transaction SingPay.
 * GET /api/singpay-status?reference=OGO-xxx-xxx
 *
 * Le navigateur du client sonde cet endpoint toutes les 5 secondes pendant le
 * paiement (`src/features/client-portal/commandes.jsx`, `src/features/paiements/page.jsx`).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LE SONDAGE EST UN FILET, PLUS LE MÉCANISME PRINCIPAL
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Avant : cet endpoint constatait le paiement et se contentait de le noter.
 * Il ne passait pas la commande en production, ne créditait pas la trésorerie,
 * ne notifiait personne. Or il gagne presque toujours la course contre le
 * rappel réseau. Le rappel arrivait ensuite, voyait `status === 'paid'`,
 * répondait « déjà traité » et repartait sans rien faire : le client avait
 * payé, l'argent était parti de son compte, et la commande restait bloquée.
 *
 * Maintenant les deux chemins appellent la MÊME fonction
 * (`appliquerStatutPaiement`), et c'est l'insertion du mouvement de trésorerie
 * qui arbitre l'unicité. Celui qui arrive le premier encaisse ; le second
 * constate et ne fait rien. Le client peut fermer son onglet : le rappel
 * termine le travail.
 *
 * Cet endpoint n'écrit jamais un statut qu'il n'a pas obtenu de SingPay.
 */
import { createClient } from '@supabase/supabase-js';
import { limiteDepassee } from './limite.js';
import {
  depotSupabase,
  verifierAupresDeSingPay,
  appliquerStatutPaiement,
  STATUTS_FINAUX,
} from './singpay-encaissement.js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY,
);

export default async function handler(req, res) {
  // Un sondage légitime, c'est 12 appels/minute et par onglet. Le plafond est
  // volontairement très haut (≈ 25 onglets simultanés derrière une même IP,
  // cas du wifi de l'atelier) : il borne l'abus sans jamais gêner l'usage réel.
  if (limiteDepassee(req, { max: 300, fenetreMs: 60_000, portee: 'singpay-status' })) {
    return res.status(429).json({ error: 'Trop de requetes, reessayez dans une minute' });
  }

  const { reference } = req.query;
  if (!reference) return res.status(400).json({ error: 'Reference manquante' });

  try {
    const depot = depotSupabase(supabase);
    const paiementRow = await depot.lirePaiement({ reference });
    const paiement = paiementRow?.data;

    /* ── 1. Statut final déjà connu : on répond sans déranger SingPay.
       Sauf si ce statut a été posé par l'ANCIEN code, reconnaissable à
       l'absence de `confirme_par` : ces paiements-là ont pu être marqués `paid`
       sans que la commande parte en production ni que la trésorerie soit
       créditée. On les laisse retomber dans le chemin complet ci-dessous, qui
       répare l'état sans rien encaisser deux fois (l'insertion du mouvement
       arbitre). C'est la voie de rattrapage des commandes bloquées. */
    const dejaTraiteParLeNouveauChemin = paiement?.confirme_par || paiement?.status !== 'paid';
    if (paiement && STATUTS_FINAUX.includes(paiement.status) && dejaTraiteParLeNouveauChemin) {
      return res.json({
        status: paiement.status,
        ...(paiement.status === 'paid' ? { paid_at: paiement.paid_at } : {}),
        result: paiement.singpay_result || undefined,
      });
    }

    // ── 2. Sinon, on demande à SingPay.
    const verif = await verifierAupresDeSingPay(reference);

    if (!verif.joignable) {
      console.warn('[SingPay Status] Verification indisponible (%s) pour ref %s', verif.erreur, reference);
      return res.json({ status: paiement?.status || 'pending' });
    }

    // ── 3. Si la transaction est terminée, on applique TOUS les effets —
    //       exactement comme le ferait le rappel, et sans doubler ce qu'il
    //       aurait déjà fait.
    if (paiementRow && verif.statut !== 'pending') {
      const resultat = await appliquerStatutPaiement({
        depot,
        paiementRow,
        statutVerifie: verif.statut,
        montantVerifie: verif.montant,
        result: verif.result,
        statutTransaction: verif.statutTransaction,
        origine: 'sondage',
      });
      return res.json({
        status: resultat.statut,
        result: verif.result,
        singpay_status: verif.statutTransaction,
        airtel_money_id: verif.transaction?.airtel_money_id,
      });
    }

    return res.json({
      status: verif.statut,
      result: verif.result,
      singpay_status: verif.statutTransaction,
      airtel_money_id: verif.transaction?.airtel_money_id,
    });

  } catch (err) {
    console.error('[SingPay Status] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}
