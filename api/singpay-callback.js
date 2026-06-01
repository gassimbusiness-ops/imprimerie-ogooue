/**
 * Vercel Serverless Function — Webhook callback SingPay
 *
 * URL a renseigner dans SingPay Workspace -> Portefeuille -> Callback URL :
 *   https://imprimerie-ogooue-app.vercel.app/api/singpay-callback
 *
 * SingPay POST cet endpoint a la fin du cycle de transaction
 * (Terminate) avec un objet de type `transaction` (cf. swagger).
 *
 * Format de payload attendu (transaction) :
 * {
 *   _id, id, reference, amount, client_msisdn,
 *   status: 'Start' | 'Partenaire' | 'Terminate' | 'Disbursement' | 'Refund',
 *   result: 'Success' | 'PasswordError' | 'BalanceError' | 'TimeOutError' | 'Error',
 *   airtel_money_id, isTransfer, portefeuille, created_at, updated_at
 * }
 *
 * Possibles wrappers : { transaction: {...}, status: {...} } ou objet direct.
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

function mapResultToStatus(result, txStatus) {
  if (!result) return txStatus === 'Terminate' ? 'failed' : 'pending';
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
  // SingPay peut envoyer GET ou POST
  const payload = req.method === 'POST' ? req.body : req.query;
  console.log('[SingPay Callback] Recu:', JSON.stringify(payload));

  // Le payload peut etre :
  //   - objet transaction direct : { reference, result, status, ... }
  //   - wrapper :                  { transaction: {...}, status: {...} }
  const tx = payload?.transaction || payload || {};
  const reference = tx.reference || payload?.reference;
  const transactionId = tx._id || tx.id || payload?.transaction_id;
  const result = tx.result || payload?.result;
  const txStatus = tx.status || payload?.status;
  const amount = tx.amount || payload?.amount;
  const phoneNumber = tx.client_msisdn || payload?.client_msisdn || payload?.phone_number;

  if (!reference && !transactionId) {
    console.error('[SingPay Callback] Reference et transaction_id manquants:', payload);
    return res.status(400).json({ error: 'Reference ou transaction_id requis' });
  }

  const mappedStatus = mapResultToStatus(result, txStatus);

  try {
    // ── Recherche du paiement (par reference OU singpay_transaction_id)
    const { data: allPaiements } = await supabase
      .from('app_data')
      .select('id, data')
      .eq('collection', 'paiements_singpay');

    const paiementRow = (allPaiements || []).find((row) => {
      const d = row.data;
      return (
        (transactionId && d.singpay_transaction_id === transactionId) ||
        (reference && d.payment_reference === reference)
      );
    });

    if (!paiementRow) {
      console.error('[SingPay Callback] Transaction non trouvee:', reference, transactionId);
      // On renvoie 200 pour eviter que SingPay reessaie en boucle sur une transaction inconnue
      return res.status(200).json({ success: false, error: 'Transaction non trouvee' });
    }

    const paiement = paiementRow.data;

    // ── Idempotence : eviter le double traitement
    if (paiement.status === 'paid' && mappedStatus === 'paid') {
      return res.status(200).json({ success: true, message: 'Deja traite' });
    }

    // ── Maj du paiement
    await supabase.from('app_data').update({
      data: {
        ...paiement,
        status: mappedStatus,
        singpay_result: result,
        singpay_status: txStatus,
        paid_at: mappedStatus === 'paid' ? new Date().toISOString() : paiement.paid_at || null,
        raw_callback: payload,
        updated_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    }).eq('id', paiementRow.id);

    // ── Maj de la commande liee
    const { data: cmdRow } = await supabase
      .from('app_data')
      .select('id, data')
      .eq('id', paiement.commande_id)
      .eq('collection', 'commandes')
      .maybeSingle();

    if (mappedStatus === 'paid' && cmdRow) {
      await supabase.from('app_data').update({
        data: {
          ...cmdRow.data,
          statut: 'en_production',
          paye_le: new Date().toISOString(),
          historique_statuts: [
            ...(cmdRow.data.historique_statuts || []),
            {
              statut: 'en_production',
              date: new Date().toISOString(),
              auteur: 'SingPay (paiement confirme)',
            },
          ],
          updated_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      }).eq('id', cmdRow.id);

      // ── Reconciliation tresorerie : crediter le compte encaisseur (FINAM par
      //    defaut, ou le compte Mobile Money correspondant) + creer un mouvement.
      //    Idempotent via reference 'singpay:<reference>'.
      try {
        const montantPaye = Number(amount || paiement.amount) || 0;
        const refMvt = `singpay:${paiement.payment_reference || transactionId}`;
        const { data: mvtsExist } = await supabase
          .from('app_data')
          .select('id, data')
          .eq('collection', 'mouvements_financiers');
        const dejaCredite = (mvtsExist || []).some((m) => m.data?.reference === refMvt);

        if (!dejaCredite && montantPaye > 0) {
          // Trouver le compte encaisseur : FINAM en priorite, sinon 1er compte 'caisse/liquide'
          const { data: comptes } = await supabase
            .from('app_data')
            .select('id, data')
            .eq('collection', 'comptes_bancaires');
          const findCompte = (kw) => (comptes || []).find((c) => (c.data?.nom || '').toLowerCase().includes(kw));
          const compteRow = findCompte('finam') || findCompte('caisse') || findCompte('liquide') || (comptes || [])[0];

          if (compteRow) {
            // Crediter le solde
            await supabase.from('app_data').update({
              data: { ...compteRow.data, solde: (compteRow.data.solde || 0) + montantPaye },
              updated_at: new Date().toISOString(),
            }).eq('id', compteRow.id);

            // Creer le mouvement entree
            await supabase.from('app_data').insert({
              id: crypto.randomUUID(),
              collection: 'mouvements_financiers',
              data: {
                id: crypto.randomUUID(),
                type: 'entree',
                montant: montantPaye,
                description: `Paiement Mobile Money — ${paiement.nom_client || 'Client'}${cmdRow.data.numero ? ` — ${cmdRow.data.numero}` : ''}`,
                compte_id: compteRow.id,
                date: new Date().toISOString().slice(0, 10),
                reference: refMvt,
                categorie: 'encaissement_singpay',
                source: 'singpay',
                pointe: true,
                created_at: new Date().toISOString(),
              },
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
          }
        }
      } catch (recErr) {
        console.error('[SingPay Callback] Reconciliation tresorerie echouee:', recErr.message);
      }

      // Notification admin
      await supabase.from('app_data').insert({
        id: crypto.randomUUID(),
        collection: 'notifications_app',
        data: {
          id: crypto.randomUUID(),
          type: 'paiement_confirme',
          titre: 'Paiement Mobile Money confirme',
          message: `${paiement.nom_client || 'Client'} — ${amount || paiement.amount} FCFA — commande en production`,
          destinataire: 'admin',
          lu: false,
          commande_id: paiement.commande_id,
          created_at: new Date().toISOString(),
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // Notification client
      if (cmdRow.data.client_id) {
        await supabase.from('app_data').insert({
          id: crypto.randomUUID(),
          collection: 'notifications_app',
          data: {
            id: crypto.randomUUID(),
            type: 'paiement_confirme_client',
            titre: 'Paiement recu',
            message: 'Votre paiement a ete confirme. Votre commande est en production.',
            destinataire: 'client',
            destinataire_id: cmdRow.data.client_id,
            lu: false,
            commande_id: paiement.commande_id,
            created_at: new Date().toISOString(),
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }

    } else if (['failed', 'expired', 'cancelled'].includes(mappedStatus) && cmdRow) {
      await supabase.from('app_data').update({
        data: {
          ...cmdRow.data,
          statut: 'validee_attente_paiement',
          historique_statuts: [
            ...(cmdRow.data.historique_statuts || []),
            {
              statut: 'validee_attente_paiement',
              date: new Date().toISOString(),
              auteur: `SingPay (paiement ${mappedStatus}${result ? ` — ${result}` : ''})`,
            },
          ],
          updated_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      }).eq('id', cmdRow.id);

      if (cmdRow.data.client_id) {
        const messages = {
          failed: result === 'PasswordError'
            ? 'Mot de passe Mobile Money incorrect. Reessayez avec votre code PIN.'
            : result === 'BalanceError'
              ? 'Solde insuffisant sur votre compte Mobile Money.'
              : 'Paiement echoue. Veuillez reessayer.',
          expired: 'Le delai pour confirmer le paiement a expire. Veuillez relancer.',
          cancelled: 'Paiement annule.',
        };
        await supabase.from('app_data').insert({
          id: crypto.randomUUID(),
          collection: 'notifications_app',
          data: {
            id: crypto.randomUUID(),
            type: 'paiement_echoue',
            titre: 'Paiement non abouti',
            message: messages[mappedStatus] || 'Paiement non abouti.',
            destinataire: 'client',
            destinataire_id: cmdRow.data.client_id,
            lu: false,
            commande_id: paiement.commande_id,
            created_at: new Date().toISOString(),
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
    }

    // SingPay attend un HTTP 200
    res.status(200).json({ success: true, status: mappedStatus });

  } catch (err) {
    console.error('[SingPay Callback] Error:', err);
    res.status(500).json({ error: err.message });
  }
}
