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
  // SingPay attend le format LOCAL avec 0 initial : 065537128 (9 chiffres)
  // (vu dans la reponse status SingPay : client_msisdn = "065537128")
  let telClean = '';
  if (operateur === 'airtel' || operateur === 'moov') {
    if (!telephone) return res.status(400).json({ error: 'Telephone requis pour airtel/moov' });
    // 1. Retirer espaces, tirets, +
    telClean = telephone.replace(/[\s\-+]/g, '');
    // 2. Retirer indicatif international si present
    if (telClean.startsWith('00241')) telClean = telClean.slice(5);
    else if (telClean.startsWith('241')) telClean = telClean.slice(3);
    // 3. Si format 8 chiffres (sans 0 initial), preprend le 0
    if (/^[0-9]{8}$/.test(telClean)) telClean = '0' + telClean;
    // 4. Validation finale : format gabonais 9 chiffres commencant par 0
    if (!/^0[0-9]{8}$/.test(telClean)) {
      return res.status(400).json({
        error: 'Numero de telephone invalide. Format attendu : 06XXXXXXXX, 07XXXXXXXX ou avec indicatif 241XXXXXXXX',
      });
    }
  }

  try {
    // Sanitize : meme logique que dans singpayAuth.js (resilient aux commentaires)
    const walletId = (process.env.SINGPAY_WALLET_ID || '').trim().split(/\s/)[0];
    const reference = `OGO-${commandeId.slice(0, 8)}-${Date.now()}`;

    /* ── L'ADRESSE DE RAPPEL NE SE MET PAS ICI ─────────────────────────────
       Ce bloc construisait une variable `callbackUrl` qui n'était envoyée dans
       aucun des deux corps de requête. La tentation était de l'ajouter au body.
       Il ne faut pas : SingPay ne lit aucune adresse de rappel dans la requête
       de paiement. Elle est une propriété DU PORTEFEUILLE, et la passerelle le
       dit elle-même — toute réponse de paiement renvoie `transaction.portefeuille`
       avec le champ `callbackURL` (relevé en base sur les 3 transactions du
       31/05/2026, déjà correctement renseigné, d'où les `raw_callback` reçus).

       Inventer un nom de champ ici aurait été pire que de n'en envoyer aucun :
       une passerelle de paiement peut rejeter la requête entière sur un champ
       inconnu, et on aurait cassé un encaissement qui marchait.

       Le Swagger officiel le confirme champ par champ
       (https://client.singpay.ga/doc/reference/src/swagger.json, v1.0.0) :
         - definition `paiement` (endpoints 74 et 62) :
             amount, reference, client_msisdn, portefeuille, disbursement, isTransfer
         - definition `ext` :
             portefeuille, reference, redirect_success, redirect_error, amount,
             disbursement, logoURL, isTransfer
         - definition `callback` = { callbackURL }, posée par
             PUT /v1/portefeuille/api/{walletId}  « Modifier l'URL de la callback »

       ⚠️ `redirect_success` / `redirect_error` ne sont PAS des rappels : ce sont
       des redirections de NAVIGATEUR. Un client qui ferme son onglet ne les
       déclenche jamais. Elles ne valent aucune preuve de paiement — c'est
       exactement pour cela que le rappel serveur-à-serveur est indispensable.

       ⚠️ `disbursement` est marqué « Obligatoire en production » dans le Swagger,
       et n'est envoyé ni ici ni dans le corps `/ext`. Le portefeuille actuel est
       un portefeuille de TEST (`goLive: "Wait"`), donc cela ne bloque rien
       aujourd'hui ; la valeur attendue doit être demandée à SingPay AVANT le
       GoLive, sous peine de voir les paiements réels refusés au passage en
       production. Voir livrables_claude/20_PAIEMENTS_MOBILES_GABON.md.

       Où la régler  : espace client SingPay → Portefeuille → Callback URL,
                       ou `node scripts/test-singpay.mjs callback <url>`
       Où la vérifier : `node scripts/test-singpay.mjs verifier`  (lecture seule,
                       compare le portefeuille à SINGPAY_CALLBACK_URL)
       Qui la traite  : api/singpay-callback.js
       ──────────────────────────────────────────────────────────────────────── */

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
    console.log('[SingPay] POST', endpoint, 'body:', JSON.stringify(body));
    const paymentResponse = await fetch(endpoint, {
      method: 'POST',
      headers: getSingPayHeaders(),
      body: JSON.stringify(body),
    });

    // Capture du body brut pour bien diagnostiquer en cas d'erreur non-JSON
    const responseText = await paymentResponse.text();
    let paymentData;
    try {
      paymentData = responseText ? JSON.parse(responseText) : {};
    } catch (parseErr) {
      paymentData = { _raw: responseText.slice(0, 500), _parseError: parseErr.message };
    }

    if (!paymentResponse.ok || paymentData?.status?.success === false) {
      console.error('[SingPay] Initiation failed:', paymentResponse.status, responseText.slice(0, 500));
      const detailMsg = paymentData?.status?.message
        || paymentData?.message
        || paymentData?.error
        || paymentData?._raw
        || `HTTP ${paymentResponse.status}`;
      return res.status(502).json({
        error: 'Erreur SingPay',
        detail: typeof detailMsg === 'string' ? detailMsg.slice(0, 200) : 'Format inconnu',
        httpStatus: paymentResponse.status,
        endpoint,
      });
    }

    // ── Extraction des identifiants de transaction
    // Reponse paiement USSD : { transaction: {...}, status: {code, message, success, result_code} }
    // Reponse ext           : { link, exp }
    const tx = paymentData.transaction || {};
    const transactionId = tx._id || tx.id || reference;
    const externalLink = paymentData.link || null;
    const expiresAt = paymentData.exp || null;

    /* ── ÉTAT RÉEL DU PORTEFEUILLE, TEL QUE LA PASSERELLE LE RENVOIE ────────
       SingPay joint l'objet `portefeuille` à chaque réponse de paiement. Il
       porte `goLive` : « Wait » signifie que le portefeuille N'EST PAS EN
       PRODUCTION et qu'aucun franc ne peut être encaissé.

       C'est l'état du portefeuille branché aujourd'hui (`TEST460`, `goLive:
       "Wait"`, `airtel_status: "Aucun"`). Les 3 essais du 31/05 ont donc tous
       échoué — avec le message « le compte client n'a pas suffisamment de
       balance », qui accuse le client alors que la cause est la configuration.
       Ce drapeau remonte l'information jusqu'à l'écran au lieu de la laisser
       dans la console du prestataire.

       ⚠️ On ne teste QUE la valeur « Wait », la seule observée et dont le sens
       est certain. La valeur que prend `goLive` une fois le portefeuille en
       production n'est documentée nulle part : écrire `!== 'Accept'` aurait
       été une devinette, et aurait pu afficher « mode test » sur un
       portefeuille bien réel. Toute autre valeur donne `null` — on ne sait
       pas, et on ne prétend pas savoir. */
    const portefeuille = tx.portefeuille || {};
    const modeTest = portefeuille.goLive === 'Wait' ? true : null;
    if (modeTest) {
      console.warn(
        '[SingPay] PORTEFEUILLE DE TEST (goLive=%s, code=%s) — aucun encaissement reel possible.',
        portefeuille.goLive, portefeuille.merchant_code,
      );
    }

    // ── Persistance dans Supabase (en best-effort : si echec, on log mais on continue
    //    car la transaction SingPay est deja creee et le frontend va polling le statut)
    try {
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

      // Mise a jour de la commande
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
    } catch (supabaseErr) {
      console.error('[SingPay] Supabase persistance failed (transaction SingPay reste valide):', supabaseErr.message);
    }

    res.json({
      success: true,
      reference,
      transactionId,
      externalLink, // non-null si operateur='ext'
      expiresAt,
      modeTest, // true = portefeuille non passe en production, aucun encaissement possible
      message: modeTest
        ? 'Portefeuille SingPay en mode TEST (goLive non validé) — ce paiement ne peut pas aboutir.'
        : operateur === 'ext'
          ? 'Lien de paiement genere'
          : 'Paiement initie — confirmez sur votre telephone via USSD',
    });

  } catch (err) {
    console.error('[SingPay] Initiation error:', err);
    res.status(500).json({ error: err.message });
  }
}
