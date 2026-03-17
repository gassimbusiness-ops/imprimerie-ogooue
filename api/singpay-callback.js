/**
 * Vercel Serverless Function — SingPay Webhook Callback
 * URL à renseigner dans SingPay : https://imprimerie-ogooue-app.vercel.app/api/singpay-callback
 *
 * Reçoit les notifications de paiement (paid, failed, expired, cancelled)
 * et met à jour la commande + notifications en conséquence.
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  // SingPay peut envoyer GET ou POST
  const payload = req.method === 'POST' ? req.body : req.query;

  console.log('[SingPay Callback] Recu:', JSON.stringify(payload));

  const {
    transaction_id,
    reference,
    status, // paid | failed | expired | cancelled | pending
    amount,
    phone_number,
  } = payload;

  // Verification de base
  if (!reference && !transaction_id) {
    return res.status(400).json({ error: 'Reference manquante' });
  }

  try {
    // Chercher la transaction dans app_data (collection paiements_singpay)
    const { data: allPaiements } = await supabase
      .from('app_data')
      .select('id, data')
      .eq('collection', 'paiements_singpay');

    const paiementRow = (allPaiements || []).find((row) => {
      const d = row.data;
      return (
        (transaction_id && d.singpay_transaction_id === transaction_id) ||
        (reference && d.payment_reference === reference)
      );
    });

    if (!paiementRow) {
      console.error('[SingPay Callback] Transaction non trouvee:', reference, transaction_id);
      return res.status(404).json({ error: 'Transaction non trouvee' });
    }

    const paiement = paiementRow.data;

    // Eviter le double traitement
    if (paiement.status === 'paid') {
      return res.json({ success: true, message: 'Deja traite' });
    }

    // Mettre a jour le statut du paiement
    await supabase.from('app_data').update({
      data: {
        ...paiement,
        status: status,
        paid_at: status === 'paid' ? new Date().toISOString() : null,
        raw_callback: payload,
        updated_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    }).eq('id', paiementRow.id);

    // Chercher la commande
    const { data: cmdRow } = await supabase
      .from('app_data')
      .select('id, data')
      .eq('id', paiement.commande_id)
      .eq('collection', 'commandes')
      .maybeSingle();

    if (status === 'paid') {
      // Paiement confirme → passer en production
      if (cmdRow) {
        await supabase.from('app_data').update({
          data: {
            ...cmdRow.data,
            statut: 'en_production',
            paye_le: new Date().toISOString(),
            historique_statuts: [
              ...(cmdRow.data.historique_statuts || []),
              { statut: 'en_production', date: new Date().toISOString(), auteur: 'SingPay (paiement confirme)' },
            ],
            updated_at: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        }).eq('id', cmdRow.id);
      }

      // Notification admin
      await supabase.from('app_data').insert({
        id: crypto.randomUUID(),
        collection: 'notifications_app',
        data: {
          id: crypto.randomUUID(),
          type: 'paiement_confirme',
          titre: 'Paiement Mobile Money confirme',
          message: `Paiement confirme — ${paiement.nom_client || 'Client'} — ${amount || paiement.amount} FCFA — Commande en production`,
          destinataire: 'admin',
          lu: false,
          commande_id: paiement.commande_id,
          created_at: new Date().toISOString(),
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // Notification client
      if (cmdRow?.data?.client_id) {
        await supabase.from('app_data').insert({
          id: crypto.randomUUID(),
          collection: 'notifications_app',
          data: {
            id: crypto.randomUUID(),
            type: 'paiement_confirme_client',
            titre: 'Paiement recu !',
            message: 'Votre paiement a ete confirme. Votre commande est maintenant en production.',
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

    } else if (['failed', 'expired', 'cancelled'].includes(status)) {
      // Paiement echoue → remettre en attente de paiement
      if (cmdRow) {
        await supabase.from('app_data').update({
          data: {
            ...cmdRow.data,
            statut: 'validee_attente_paiement',
            historique_statuts: [
              ...(cmdRow.data.historique_statuts || []),
              { statut: 'validee_attente_paiement', date: new Date().toISOString(), auteur: `SingPay (paiement ${status})` },
            ],
            updated_at: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        }).eq('id', cmdRow.id);
      }

      // Notification client
      if (cmdRow?.data?.client_id) {
        const messages = {
          failed: 'Paiement echoue. Veuillez reessayer ou contacter le 060 44 46 34.',
          expired: 'Paiement expire. Veuillez relancer le paiement.',
          cancelled: 'Paiement annule. Contactez-nous si necessaire.',
        };
        await supabase.from('app_data').insert({
          id: crypto.randomUUID(),
          collection: 'notifications_app',
          data: {
            id: crypto.randomUUID(),
            type: 'paiement_echoue',
            titre: 'Paiement non abouti',
            message: messages[status] || 'Paiement non abouti.',
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

    // SingPay attend un HTTP 200 pour confirmer reception
    res.status(200).json({ success: true, status });

  } catch (err) {
    console.error('[SingPay Callback] Error:', err);
    res.status(500).json({ error: err.message });
  }
}
