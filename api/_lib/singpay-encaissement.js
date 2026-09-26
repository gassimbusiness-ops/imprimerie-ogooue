/**
 * Encaissement Mobile Money SingPay — noyau partagé par le rappel (webhook) et
 * le sondage (polling).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * 1. LE RAPPEL N'ÉTAIT PAS MORT — MAIS IL ÉTAIT CROYABLE SUR PAROLE
 *
 *    `api/_lib/singpay-initiate.js` construisait une variable `callbackUrl` et ne
 *    l'envoyait nulle part. Il était tentant d'en conclure que SingPay n'était
 *    jamais rappelée. La base de production dit le contraire : les 3 paiements
 *    de la collection `paiements_singpay` portent tous un `raw_callback` reçu
 *    2 à 5 secondes après l'initiation. Le rappel FONCTIONNE.
 *
 *    La raison est dans la réponse même de SingPay, champ `transaction.portefeuille` :
 *
 *        "callbackURL": "https://imprimerie-ogooue-app.vercel.app/api/singpay-callback"
 *
 *    L'adresse de rappel est une propriété DU PORTEFEUILLE, pas du corps de la
 *    requête de paiement. Elle se règle une fois (console SingPay, ou
 *    `node scripts/test-singpay.mjs callback`), pas à chaque transaction.
 *    Envoyer un champ inventé dans le corps n'aurait rien réparé et aurait pu
 *    faire rejeter la requête par la passerelle.
 *
 * 2. CE QUI ÉTAIT RÉELLEMENT CASSÉ : LA CONVERGENCE SONDAGE / RAPPEL
 *
 *    Deux chemins écrivaient le même paiement sans se connaître :
 *
 *      - `singpay-callback.js` : mettait le paiement à jour ET passait la
 *        commande `en_production`, créditait la trésorerie, notifiait.
 *      - `singpay-status.js` (sondé toutes les 5 s par le navigateur du client) :
 *        mettait le paiement à `paid`… et RIEN D'AUTRE.
 *
 *    Le sondage gagne presque toujours la course (5 s de période contre un
 *    rappel réseau). Le paiement passait donc à `paid` par le sondage, puis le
 *    rappel arrivait, voyait `status === 'paid'`, répondait « Déjà traité » et
 *    repartait — SANS passer la commande en production, SANS créditer la
 *    trésorerie, SANS notifier. Le client payait, l'argent partait de son
 *    compte, et la commande restait bloquée. Le sondage empoisonnait le test
 *    d'idempotence du rappel.
 *
 *    Correction : les EFFETS d'un encaissement vivent ici, dans une fonction
 *    unique appelée par les deux chemins, et l'idempotence ne porte plus sur le
 *    statut du paiement mais sur l'existence du mouvement de trésorerie.
 *
 * 3. UN ENDPOINT DE RAPPEL EST UNE PORTE OUVERTE SUR INTERNET
 *
 *    `/api/singpay-callback` est joignable par n'importe qui. L'ancien code
 *    re-vérifiait auprès de SingPay avant de créditer un `paid` — bien — mais
 *    acceptait SANS AUCUNE VÉRIFICATION un `result: 'Error'`. Une référence
 *    de paiement se lit dans le reçu PDF remis au client : un POST suffisait
 *    à faire retomber une commande payée en `validee_attente_paiement` et à
 *    envoyer au client un « paiement échoué » mensonger.
 *
 *    Trois verrous sont posés ici :
 *      a. secret partagé (`SINGPAY_CALLBACK_SECRET`) — voir `verifierSecretCallback`
 *      b. re-vérification systématique auprès de SingPay, pour TOUS les statuts
 *         et non plus seulement pour `paid` ;
 *      c. un paiement `paid` n'est JAMAIS rétrogradé par un rappel.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * FORME DU MODULE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Les accès base passent par un « dépôt » (`depot`) injecté, pas par le client
 * Supabase directement. Ce n'est pas de l'abstraction gratuite : c'est ce qui
 * permet à `tests/singpay-encaissement.test.mjs` de rejouer un webhook répété,
 * une course sondage/rappel et un rappel non signé sans réseau ni base.
 * `depotSupabase()` en bas du fichier fabrique le dépôt réel.
 */
import crypto from 'node:crypto';
import { getSingPayHeaders, SINGPAY_BASE_URL } from '../../src/lib/singpayAuth.js';
// `src/services/compte-client.js` est un module PUR (ni React, ni accès base) :
// il est importable ici, dans une fonction serverless, comme dans le navigateur.
// C'est tout l'intérêt — la règle « fiche → compte » n'existe qu'à un endroit.
import { resoudreCompteClient } from '../../src/services/compte-client.js';
// Date metier a Libreville. `src/lib/dates.js` est un module pur, importable
// ici comme dans le navigateur — et c'est le seul endroit ou la regle vit.
import { dateLocaleDepuisInstantUtc } from '../../src/lib/dates.js';
import { ligneAppData } from '../../src/services/ligne-app-data.js';

/* ═══════════════════════════════════════════════════════════════════════════
   1. STATUTS
   ═══════════════════════════════════════════════════════════════════════════ */

/** Statuts internes au-delà desquels un paiement ne bouge plus. */
export const STATUTS_FINAUX = Object.freeze(['paid', 'failed', 'expired', 'cancelled']);

/**
 * Traduit le couple (`result`, `status`) de SingPay vers nos statuts internes.
 *
 * `status` décrit l'avancement ('Start' → 'Partenaire' → 'Terminate'),
 * `result` le verdict final. Tant que `result` est absent, la transaction est
 * en cours : c'est le cas normal pendant les quelques secondes où le client
 * tape son code PIN.
 *
 * @param {string} [result]
 * @param {string} [statutTransaction]
 * @returns {'paid'|'failed'|'expired'|'pending'}
 */
export function mapResultatVersStatut(result, statutTransaction) {
  if (!result) return statutTransaction === 'Terminate' ? 'failed' : 'pending';
  switch (result) {
    case 'Success': return 'paid';
    case 'PasswordError': return 'failed';
    case 'BalanceError': return 'failed';
    case 'TimeOutError': return 'expired';
    case 'Error': return 'failed';
    default: return 'pending';
  }
}

/**
 * Un paiement déjà encaissé ne redescend jamais.
 *
 * Sans cette règle, un POST forgé `{reference, result:'Error'}` sur l'endpoint
 * public annulait un encaissement réel. Un remboursement est une décision
 * humaine (et une écriture de contre-passation), pas un effet de bord de webhook.
 *
 * @param {string} statutActuel
 * @param {string} statutVise
 * @returns {boolean}
 */
export function transitionAutorisee(statutActuel, statutVise) {
  if (statutActuel === 'paid') return statutVise === 'paid';
  if (statutActuel === statutVise) return true;
  return STATUTS_FINAUX.includes(statutVise) || statutVise === 'pending';
}

/* ═══════════════════════════════════════════════════════════════════════════
   1 bis. PLAFONDS DES OPÉRATEURS — refuser honnêtement plutôt qu'échouer
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Plafond par transaction, en francs CFA, relevé sur les grilles officielles
 * des opérateurs le 16/09/2026.
 *
 * 📗 Airtel Money Gabon — 500 000 F par transaction.
 *    Grille : https://www.airtel.ga/airtelmoney/transaction_fees
 *    Et, mot pour mot, l'article 3.5 des conditions d'abonnement :
 *    « Le plafond des transactions Airtel money est de 500 000 F CFA ».
 *
 * 📗 Moov Money Gabon — 1 000 000 F par opération de paiement.
 *    Grille : https://moovmoney.ga/grille-tarifaire-client/
 *    ⚠️ Moov Money Online ajoute « Plafond : les paiements par Moov Money sont
 *    plafonnés à 1 000 000 F/jr ET PAR CLIENT » : une facture d'un million
 *    consomme 100 % du plafond quotidien du payeur, et échoue s'il a fait la
 *    moindre autre opération dans la journée. D'où l'avertissement ci-dessous
 *    bien avant d'atteindre le plafond dur.
 *
 * POURQUOI REFUSER AU LIEU DE LAISSER PASSER
 *
 * Une commande de 700 000 F envoyée à Airtel ne produit pas « montant trop
 * élevé ». Elle produit le message que l'imprimerie a déjà vu trois fois en
 * base : « Le compte client n'a pas suffisamment de balance ». L'application
 * accuse alors un directeur d'école d'être à découvert, alors que la cause est
 * un plafond réglementaire. Refuser en amont, avec le vrai motif, coûte une
 * condition et évite une conversation pénible.
 *
 * Les valeurs sont surchargeables par variables d'environnement : une grille
 * opérateur change sans prévenir, et personne ne doit attendre un déploiement.
 */
export const PLAFONDS_PAR_DEFAUT = Object.freeze({
  airtel: 500_000,
  moov: 1_000_000,
  ext: 1_000_000, // le client choisit son opérateur sur la page SingPay
});

/** Seuil au-delà duquel un paiement passe, mais mérite d'être annoncé fragile. */
export const SEUIL_AVERTISSEMENT = 500_000;

function plafondOperateur(operateur, env = process.env) {
  const parEnv = {
    airtel: env.SINGPAY_PLAFOND_AIRTEL,
    moov: env.SINGPAY_PLAFOND_MOOV,
    ext: env.SINGPAY_PLAFOND_EXT,
  }[operateur];
  const n = Number(parEnv);
  return Number.isFinite(n) && n > 0 ? n : PLAFONDS_PAR_DEFAUT[operateur];
}

/**
 * Le montant demandé peut-il passer chez cet opérateur ?
 *
 * @param {number} montant en francs CFA
 * @param {'airtel'|'moov'|'ext'} operateur
 * @param {object} [env]
 * @returns {{accepte: boolean, plafond: number, motif?: string, avertissement?: string}}
 */
export function controlerPlafond(montant, operateur, env = process.env) {
  const plafond = plafondOperateur(operateur, env);
  const m = Math.round(Number(montant) || 0);

  if (m > plafond) {
    const nom = { airtel: 'Airtel Money', moov: 'Moov Money', ext: 'Mobile Money' }[operateur] || operateur;
    return {
      accepte: false,
      plafond,
      motif:
        `Montant supérieur au plafond ${nom} (${plafond.toLocaleString('fr-FR')} F par transaction). `
        + `Ce n'est pas un problème de solde : l'opérateur refuserait la transaction. `
        + `Pour ${m.toLocaleString('fr-FR')} F, régler par virement bancaire.`,
    };
  }

  if (m > SEUIL_AVERTISSEMENT) {
    return {
      accepte: true,
      plafond,
      avertissement:
        'Montant élevé : Moov Money plafonne aussi à 1 000 000 F par jour et par client, '
        + "et Airtel Money refuse au-delà de 500 000 F. Prévoir le virement bancaire en repli.",
    };
  }

  return { accepte: true, plafond };
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. AUTHENTIFICATION DU RAPPEL
   ═══════════════════════════════════════════════════════════════════════════ */

/** Comparaison à temps constant, tolérante aux longueurs différentes. */
function egalConstant(a, b) {
  const ba = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (ba.length !== bb.length) {
    // On compare quand même pour ne pas fuiter la longueur par le temps de réponse.
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Vérifie que le rappel vient bien de SingPay.
 *
 * ⚠️ ÉTAT DE LA DOCUMENTATION SINGPAY — à lire avant de juger ce choix.
 *
 * SingPay ne signe pas ses rappels. Ce n'est pas une supposition : le Swagger
 * officiel (https://client.singpay.ga/doc/reference/src/swagger.json, v1.0.0)
 * porte `securityDefinitions: null` et ne contient aucune occurrence de
 * « signature », « hmac » ou « x-sign ». Aucun en-tête de signature, aucun
 * secret partagé, aucune liste d'adresses IP n'est documenté. Le tutoriel
 * officiel (github.com/singdev/tuto-singpay) répond `200` au rappel sans la
 * moindre vérification.
 *
 * Inventer un nom d'en-tête aurait donné une fausse sécurité : on aurait
 * vérifié une signature que personne n'envoie — donc on aurait tout rejeté,
 * ou, pire, cru vérifier alors qu'on acceptait tout.
 *
 * La technique retenue est celle qu'on applique à toute passerelle sans HMAC :
 * **le secret voyage dans l'URL de rappel elle-même**. L'adresse enregistrée
 * dans le portefeuille SingPay devient
 *
 *     https://…/api/singpay-callback?token=<SINGPAY_CALLBACK_SECRET>
 *
 * Cette URL n'est connue que de SingPay et de Vercel. Elle ne circule ni dans
 * le navigateur du client, ni dans un reçu PDF, contrairement à la référence
 * de paiement. Un en-tête `x-callback-token` est également accepté, au cas où
 * SingPay proposerait un jour des en-têtes personnalisés.
 *
 * C'est la solution que retiennent les autres intégrateurs de SingPay faute de
 * mieux (le plugin WooCommerce public, lui, se contente de comparer l'en-tête
 * `Origin` — qui s'usurpe en une ligne de curl et ne protège rien).
 *
 * DRAPEAU DE FONCTIONNALITÉ : le contrôle s'active en posant la variable
 * `SINGPAY_CALLBACK_SECRET` dans Vercel. Tant qu'elle est absente, l'endpoint
 * continue d'accepter les rappels comme avant (aucune régression de production
 * le jour du déploiement), mais il refuse toujours de croire le corps du
 * message : le statut appliqué est celui que SingPay confirme, jamais celui
 * qu'on nous annonce. Retour arrière = supprimer la variable.
 *
 * ORDRE DE DÉPLOIEMENT (l'ordre compte) :
 *   1. déployer ce code ;
 *   2. régler l'URL de rappel du portefeuille avec `?token=…` ;
 *   3. seulement ensuite, poser `SINGPAY_CALLBACK_SECRET` dans Vercel.
 * Inverser 2 et 3 fait rejeter tous les rappels entre les deux étapes.
 *
 * @param {{headers?: object, query?: object}} req
 * @param {{secret?: string}} [options]
 * @returns {{ok: boolean, mode: 'strict'|'ouvert', raison?: string}}
 */
export function verifierSecretCallback(req, { secret = process.env.SINGPAY_CALLBACK_SECRET } = {}) {
  const attendu = (secret || '').trim();
  if (!attendu) {
    return { ok: true, mode: 'ouvert', raison: 'SINGPAY_CALLBACK_SECRET non configuré' };
  }
  const headers = req?.headers || {};
  const query = req?.query || {};
  const fourni = headers['x-callback-token'] || headers['X-Callback-Token'] || query.token || query.secret;
  if (!fourni) {
    return { ok: false, mode: 'strict', raison: 'jeton de rappel absent' };
  }
  if (!egalConstant(fourni, attendu)) {
    return { ok: false, mode: 'strict', raison: 'jeton de rappel invalide' };
  }
  return { ok: true, mode: 'strict' };
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. LECTURE DU MESSAGE ENTRANT
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Normalise un message de rappel SingPay.
 *
 * Deux formes observées en production : l'objet transaction nu, et l'enveloppe
 * `{ status: {...}, transaction: {...} }` (c'est celle que SingPay envoie
 * réellement, cf. `raw_callback` en base).
 *
 * ⚠️ Ce que cette fonction renvoie sert UNIQUEMENT à retrouver l'enregistrement
 * local. Le montant et le statut annoncés ne sont jamais appliqués tels quels.
 *
 * @param {object} payload
 * @returns {{reference: string|null, transactionId: string|null, resultAnnonce: string|null, statutAnnonce: string|null}}
 */
export function lireMessageRappel(payload) {
  const p = payload || {};
  const tx = p.transaction || p;
  return {
    reference: tx.reference || p.reference || null,
    transactionId: tx._id || tx.id || p.transaction_id || null,
    resultAnnonce: tx.result || p.result || null,
    statutAnnonce: (typeof tx.status === 'string' ? tx.status : null) || (typeof p.status === 'string' ? p.status : null),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. RE-VÉRIFICATION AUPRÈS DE SINGPAY
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Demande à SingPay l'état réel d'une transaction.
 *
 * C'est LA source de vérité. Le corps du rappel ne sert qu'à savoir QUELLE
 * transaction re-vérifier. Si SingPay est injoignable, on ne conclut rien :
 * `joignable: false`, et l'appelant laisse le paiement en l'état. Ne rien faire
 * est le comportement sûr — le sondage ou un rappel ultérieur repassera.
 *
 * @param {string} reference
 * @param {{fetchImpl?: Function, baseUrl?: string, headers?: object}} [options]
 * @returns {Promise<{joignable: boolean, statut: string|null, result: string|null, statutTransaction: string|null, montant: number|null, transaction: object|null, erreur?: string}>}
 */
export async function verifierAupresDeSingPay(reference, options = {}) {
  const {
    fetchImpl = fetch,
    baseUrl = SINGPAY_BASE_URL,
    headers = null,
  } = options;

  const vide = { joignable: false, statut: null, result: null, statutTransaction: null, montant: null, transaction: null };
  if (!reference) return { ...vide, erreur: 'référence absente' };

  try {
    const url = `${baseUrl}/transaction/api/search/by-reference/${encodeURIComponent(reference)}`;
    const r = await fetchImpl(url, {
      method: 'GET',
      headers: headers || getSingPayHeaders({ includeWallet: false }),
    });
    if (!r.ok) return { ...vide, erreur: `HTTP ${r.status}` };
    const data = await r.json();
    const tx = data?.transaction || data || {};
    return {
      joignable: true,
      statut: mapResultatVersStatut(tx.result, tx.status),
      result: tx.result || null,
      statutTransaction: tx.status || null,
      montant: typeof tx.amount === 'number' ? tx.amount : null,
      transaction: tx,
    };
  } catch (err) {
    return { ...vide, erreur: err?.message || 'erreur inconnue' };
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. APPLICATION DE L'ENCAISSEMENT — chemin unique
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Référence d'idempotence du mouvement de trésorerie.
 *
 * ⚠️ NE PAS CHANGER CE FORMAT. `src/features/commandes/page.jsx:578` s'en sert
 * pour ne pas ré-encaisser à la livraison une commande déjà payée en Mobile
 * Money. Changer la forme ici recrée un double comptage du chiffre d'affaires.
 *
 * @param {object} paiement
 * @returns {string|null}
 */
export function referenceMouvement(paiement) {
  const ref = paiement?.payment_reference || paiement?.singpay_transaction_id;
  return ref ? `singpay:${ref}` : null;
}

const MESSAGES_ECHEC = {
  PasswordError: 'Mot de passe Mobile Money incorrect. Reessayez avec votre code PIN.',
  BalanceError: 'Solde insuffisant sur votre compte Mobile Money.',
};

function messageEchec(statut, result) {
  if (MESSAGES_ECHEC[result]) return MESSAGES_ECHEC[result];
  if (statut === 'expired') return 'Le delai pour confirmer le paiement a expire. Veuillez relancer.';
  if (statut === 'cancelled') return 'Paiement annule.';
  return 'Paiement echoue. Veuillez reessayer.';
}

/**
 * Applique à la base l'état d'un paiement confirmé par SingPay.
 *
 * Appelée par LES DEUX chemins — `singpay-callback.js` et `singpay-status.js`.
 * Deux appels concurrents produisent un seul encaissement : c'est l'insertion
 * du mouvement de trésorerie qui arbitre, pas une lecture préalable.
 *
 * @param {object} args
 * @param {object} args.depot            dépôt de données (voir `depotSupabase`)
 * @param {{id: string, data: object}} args.paiementRow
 * @param {string} args.statutVerifie    statut CONFIRMÉ par SingPay, jamais annoncé
 * @param {number|null} [args.montantVerifie] montant confirmé par SingPay
 * @param {string|null} [args.result]
 * @param {string|null} [args.statutTransaction]
 * @param {object} [args.rawCallback]    message brut, archivé pour la traçabilité
 * @param {string} [args.origine]        'rappel' | 'sondage'
 * @returns {Promise<{applique: boolean, statut: string, mouvementCree: boolean, raison?: string}>}
 */
export async function appliquerStatutPaiement({
  depot,
  paiementRow,
  statutVerifie,
  montantVerifie = null,
  result = null,
  statutTransaction = null,
  rawCallback = null,
  origine = 'rappel',
}) {
  const paiement = paiementRow?.data || {};
  const statutActuel = paiement.status || 'pending';

  if (!transitionAutorisee(statutActuel, statutVerifie)) {
    return {
      applique: false,
      statut: statutActuel,
      mouvementCree: false,
      raison: `transition ${statutActuel} -> ${statutVerifie} refusée`,
    };
  }

  if (statutVerifie === 'pending') {
    return { applique: false, statut: statutActuel, mouvementCree: false, raison: 'transaction encore en cours' };
  }

  /* ── Contrôle de montant ────────────────────────────────────────────────
     On crédite TOUJOURS le montant de notre propre enregistrement, jamais
     celui annoncé par le message entrant. Si SingPay confirme un montant
     différent de celui qu'on a initié, quelque chose ne va pas : on n'écrit
     pas d'argent, on alerte un humain. */
  const montantAttendu = Number(paiement.amount) || 0;
  const ecartMontant = montantVerifie !== null
    && Number.isFinite(montantVerifie)
    && Math.round(montantVerifie) !== Math.round(montantAttendu);

  /* ── 1. Le paiement lui-même ─────────────────────────────────────────── */
  const maintenant = new Date().toISOString();
  const paiementMaj = {
    ...paiement,
    status: statutVerifie,
    singpay_result: result ?? paiement.singpay_result ?? null,
    singpay_status: statutTransaction ?? paiement.singpay_status ?? null,
    paid_at: statutVerifie === 'paid' ? (paiement.paid_at || maintenant) : (paiement.paid_at || null),
    confirme_par: origine,
    updated_at: maintenant,
  };
  if (rawCallback) paiementMaj.raw_callback = rawCallback;
  await depot.majPaiement(paiementRow.id, paiementMaj);

  if (statutVerifie !== 'paid') {
    await appliquerEchec({ depot, paiement, statutVerifie, result });
    return { applique: true, statut: statutVerifie, mouvementCree: false };
  }

  if (ecartMontant) {
    // Le sondage repasse toutes les 5 secondes : sans ce témoin, le gérant
    // recevrait une alerte par passage. On alerte une fois, pas douze par minute.
    if (!paiement.montant_incoherent_signale) {
      paiementMaj.montant_incoherent_signale = true;
      await depot.majPaiement(paiementRow.id, paiementMaj);
      await depot.insererNotification({
        type: 'paiement_montant_incoherent',
        titre: 'Paiement à vérifier — montant incohérent',
        message: `SingPay confirme ${montantVerifie} F pour la référence ${paiement.payment_reference}, `
          + `alors que la demande portait sur ${montantAttendu} F. Aucune écriture de trésorerie n'a été faite.`,
        destinataire: 'admin',
        lu: false,
        commande_id: paiement.commande_id || null,
        created_at: maintenant,
      });
    }
    return {
      applique: true,
      statut: 'paid',
      mouvementCree: false,
      raison: 'montant confirmé différent du montant initié — encaissement suspendu',
    };
  }

  /* ── 2. Les effets « argent » : un seul chemin, une seule fois ────────── */
  const effets = await appliquerEncaissementConfirme({ depot, paiement, montant: montantAttendu, origine });

  return { applique: true, statut: 'paid', mouvementCree: effets.mouvementCree };
}

/**
 * À quel COMPTE du portail doit partir la notification client d'un paiement ?
 *
 * ⚠️ `commande.client_id` N'EST PAS TOUJOURS UN IDENTIFIANT DE COMPTE.
 *
 * Pour une commande saisie au COMPTOIR, l'employé choisit une FICHE dans
 * l'annuaire : `client_id` porte alors `clients.id`. Pour une commande du
 * PORTAIL, c'est `users.id`. Or le panneau de notifications filtre sur
 * `user.id` (`getNotifications`, src/services/notifications.js) : écrire
 * `destinataire_id: client_id` sans traduction laissait « Votre paiement a été
 * confirmé » adressé à un identifiant que personne ne porte. La ligne existait
 * en base, aucune erreur n'était levée, et le client n'en voyait jamais rien.
 *
 * `resoudreCompteClient()` est la SEULE règle du dépôt (src/services/compte-client.js).
 *
 * Ne lève jamais et ne bloque jamais l'encaissement : l'argent est entré, c'est
 * ce qui compte ; prévenir est un confort. Si l'annuaire est illisible, on
 * garde l'identifiant tel quel — strictement le comportement d'avant.
 *
 * @param {object} depot
 * @param {object|null} cmdRow ligne `app_data` de la commande
 * @returns {Promise<{compteId: string, raison: string}>} `compteId` vide =
 *   personne à prévenir ; `raison` (vide si la commande n'a simplement aucun
 *   client) dit pourquoi, en français affichable au gérant.
 */
async function compteClientDeLaCommande(depot, cmdRow) {
  const clientId = cmdRow?.data?.client_id;
  if (!clientId) return { compteId: '', raison: '' };

  let clients = [];
  try {
    clients = await depot.listerClients();
  } catch (err) {
    console.error('[singpay] annuaire client illisible, identifiant conserve tel quel:', err?.message || err);
    return { compteId: String(clientId), raison: '' };
  }

  const { compteId, raison } = resoudreCompteClient(clients, clientId);
  return { compteId, raison };
}

/**
 * Effets d'un paiement confirmé : commande en production, trésorerie créditée,
 * notifications. Idempotent par construction.
 */
async function appliquerEncaissementConfirme({ depot, paiement, montant, origine }) {
  const maintenant = new Date().toISOString();
  const cmdRow = paiement.commande_id ? await depot.lireCommande(paiement.commande_id) : null;

  /* ── Trésorerie ─────────────────────────────────────────────────────────
     L'insertion est tentée D'ABORD. Si l'index unique de la migration 005 est
     en place, PostgreSQL rejette le doublon (code 23505) et `insere` vaut
     false : le solde n'est pas crédité deux fois, même si deux rappels
     arrivent en même temps sur deux instances serverless différentes.
     Le solde n'est touché QUE si l'insertion a réellement eu lieu. */
  const reference = referenceMouvement(paiement);
  let mouvementCree = false;

  if (reference && montant > 0) {
    const comptes = await depot.listerComptes();
    const trouver = (mot) => (comptes || []).find((c) => (c.data?.nom || '').toLowerCase().includes(mot));
    const operateur = (paiement.operateur || '').toLowerCase();
    const compteRow =
      (operateur.includes('airtel') && trouver('airtel'))
      || (operateur.includes('moov') && trouver('moov'))
      || trouver('finam')
      || trouver('caisse')
      || trouver('liquide')
      || (comptes || [])[0];

    if (compteRow) {
      const numero = cmdRow?.data?.numero ? ` — ${cmdRow.data.numero}` : '';
      const resultat = await depot.insererMouvement({
        type: 'entree',
        montant,
        description: `Paiement Mobile Money — ${paiement.nom_client || 'Client'}${numero}`,
        compte_id: compteRow.id,
        // ⚠️ JAMAIS `maintenant.slice(0, 10)`, qui est la date UTC.
        //
        // Cette fonction tourne sur Vercel, c'est-a-dire en UTC, pendant que
        // l'imprimerie vit a Libreville (UTC+1, sans heure d'ete). Un paiement
        // encaisse a 00 h 30 a Moanda est 23 h 30 UTC la VEILLE : le mouvement
        // de tresorerie tombait dans la journee precedente, en pleine plage
        // d'achats en ligne. Le rapprochement de caisse du lendemain ne le
        // trouvait pas.
        //
        // `dateLocaleDepuisInstantUtc` convertit l'instant en date metier a
        // +01:00 : le resultat ne depend ni du fuseau du serveur, ni de celui
        // du navigateur. Voir l'en-tete de src/lib/dates.js.
        date: dateLocaleDepuisInstantUtc(maintenant) || maintenant.slice(0, 10),
        reference,
        categorie: 'encaissement_singpay',
        source: 'singpay',
        origine_confirmation: origine,
        pointe: true,
        created_at: maintenant,
      });
      mouvementCree = resultat?.insere === true;
      if (mouvementCree) {
        await depot.crediterCompte(compteRow.id, montant, compteRow.data?.solde || 0);
      }
    }
  }

  /* ── Commande + notifications : seulement au premier passage ──────────────
     `mouvementCree` est le témoin d'unicité. S'il est faux, un autre chemin
     (rappel ou sondage) a déjà tout fait : on ne renotifie pas le client. */
  if (!mouvementCree) return { mouvementCree: false };

  if (cmdRow && cmdRow.data?.statut !== 'en_production') {
    await depot.majCommande(cmdRow.id, {
      ...cmdRow.data,
      statut: 'en_production',
      paye_le: maintenant,
      historique_statuts: [
        ...(cmdRow.data.historique_statuts || []),
        {
          statut: 'en_production',
          date: maintenant,
          auteur: `SingPay (paiement confirme — ${origine})`,
        },
      ],
      updated_at: maintenant,
    });
  }

  // Résolu AVANT la notification du gérant : si le client est injoignable en
  // ligne, c'est cette notification-là — celle qu'un humain lit vraiment — qui
  // doit le dire. Un `console.warn` dans une fonction Vercel ne prévient personne.
  const cible = await compteClientDeLaCommande(depot, cmdRow);

  await depot.insererNotification({
    type: 'paiement_confirme',
    titre: 'Paiement Mobile Money confirme',
    message: `${paiement.nom_client || 'Client'} — ${montant} FCFA — commande en production`
      + (cible.raison ? ` — ⚠️ Client non prévenu : ${cible.raison}` : ''),
    destinataire: 'admin',
    lu: false,
    commande_id: paiement.commande_id || null,
    created_at: maintenant,
  });

  if (cible.compteId) {
    await depot.insererNotification({
      type: 'paiement_confirme_client',
      titre: 'Paiement recu',
      message: 'Votre paiement a ete confirme. Votre commande est en production.',
      destinataire: 'client',
      // Un id de COMPTE, jamais un id de fiche : voir `compteClientDeLaCommande`.
      destinataire_id: cible.compteId,
      lu: false,
      commande_id: paiement.commande_id || null,
      created_at: maintenant,
    });
  } else if (cmdRow?.data?.client_id) {
    console.warn(
      `[singpay] paiement ${paiement.payment_reference} encaisse, client NON prevenu`
      + ` (commande ${cmdRow?.data?.numero || cmdRow?.id}) : ${cible.raison || 'aucun compte portail'}`,
    );
  }

  return { mouvementCree: true };
}

/** Remet la commande en attente de paiement et prévient le client. */
async function appliquerEchec({ depot, paiement, statutVerifie, result }) {
  if (!paiement.commande_id) return;
  const cmdRow = await depot.lireCommande(paiement.commande_id);
  if (!cmdRow) return;
  const maintenant = new Date().toISOString();

  // Une commande déjà en production a été payée : un échec tardif ne la retire pas.
  if (cmdRow.data?.statut === 'en_production') return;

  await depot.majCommande(cmdRow.id, {
    ...cmdRow.data,
    statut: 'validee_attente_paiement',
    historique_statuts: [
      ...(cmdRow.data.historique_statuts || []),
      {
        statut: 'validee_attente_paiement',
        date: maintenant,
        auteur: `SingPay (paiement ${statutVerifie}${result ? ` — ${result}` : ''})`,
      },
    ],
    updated_at: maintenant,
  });

  // Même piège que sur le chemin « payé » : `client_id` peut être un id de
  // FICHE. Sans traduction, l'avis d'échec n'atteignait personne.
  const cible = await compteClientDeLaCommande(depot, cmdRow);
  if (cible.compteId) {
    await depot.insererNotification({
      type: 'paiement_echoue',
      titre: 'Paiement non abouti',
      message: messageEchec(statutVerifie, result),
      destinataire: 'client',
      destinataire_id: cible.compteId,
      lu: false,
      commande_id: paiement.commande_id,
      created_at: maintenant,
    });
  } else if (cmdRow.data?.client_id) {
    // Aucun argent n'a bougé : le journal serveur suffit ici.
    console.warn(
      `[singpay] echec de paiement ${paiement.payment_reference}, client NON prevenu`
      + ` (commande ${cmdRow.data?.numero || cmdRow.id}) : ${cible.raison || 'aucun compte portail'}`,
    );
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. DÉPÔT SUPABASE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Ramène un solde à un nombre — quelle que soit la forme qu'il a prise en base.
 *
 * ⚠️ CE N'EST PAS UNE PRÉCAUTION THÉORIQUE. Mesuré le 2026-09-16 en production :
 * les comptes « Airtel Money » et « Moov Money » — précisément les deux comptes
 * que le Mobile Money crédite — portent `solde: ""`, la chaîne vide, et non 0.
 *
 * En JavaScript, `"" ?? 0` vaut `""` (la chaîne vide n'est pas nullish), et
 * `"" + 7000` vaut la CHAÎNE `"7000"`. Le solde serait devenu du texte, et le
 * crédit suivant aurait produit `"70007000"`. L'ancien code écrivait
 * `(solde || 0) + montant` et échappait au piège par accident ; le `??`, plus
 * moderne, l'aurait réintroduit. D'où ce passage explicite par `Number`.
 */
export function soldeNumerique(valeur) {
  const n = Number(valeur);
  return Number.isFinite(n) ? n : 0;
}

/** Codes PostgreSQL / PostgREST signalant une violation d'unicité. */
function estViolationUnicite(error) {
  if (!error) return false;
  return error.code === '23505' || /duplicate key|unique constraint/i.test(error.message || '');
}

/**
 * Fabrique le dépôt réel au-dessus d'un client Supabase.
 *
 * @param {object} supabase client `@supabase/supabase-js`
 */
export function depotSupabase(supabase) {
  return {
    async lirePaiement({ reference, transactionId }) {
      const { data } = await supabase
        .from('app_data')
        .select('id, data')
        .eq('collection', 'paiements_singpay');
      return (data || []).find((row) => {
        const d = row.data || {};
        return (transactionId && d.singpay_transaction_id === transactionId)
          || (reference && d.payment_reference === reference);
      }) || null;
    },

    async majPaiement(id, data) {
      await supabase.from('app_data')
        .update({ data, updated_at: new Date().toISOString() })
        .eq('id', id);
    },

    async lireCommande(id) {
      const { data } = await supabase
        .from('app_data')
        .select('id, data')
        .eq('id', id)
        .eq('collection', 'commandes')
        .maybeSingle();
      return data || null;
    },

    async majCommande(id, data) {
      await supabase.from('app_data')
        .update({ data, updated_at: new Date().toISOString() })
        .eq('id', id);
    },

    async listerComptes() {
      const { data } = await supabase
        .from('app_data')
        .select('id, data')
        .eq('collection', 'comptes_bancaires');
      return data || [];
    },

    /**
     * L'annuaire client, pour traduire un `client_id` de FICHE en id de COMPTE.
     *
     * Rend les objets `data` (et non les lignes) : c'est la forme que
     * `db.clients.list()` rend au navigateur, et donc celle qu'attend
     * `resoudreCompteClient()`. Une seule forme, une seule règle.
     *
     * Le `.order('created_at')` reprend l'ordonnancement stable de
     * `lireCollection` (api/_lib/supabase-admin.js) : sans lui, Postgres rend
     * les lignes dans un ordre non garanti et un annuaire contenant des fiches
     * en double — la base en contient — résoudrait au hasard d'un appel à
     * l'autre. Un tri stable rend le défaut reproductible plutôt qu'aléatoire.
     *
     * Remonte l'erreur plutôt que de rendre une liste vide : l'appelant
     * (`compteClientDeLaCommande`) la journalise et conserve l'identifiant tel
     * quel. Une liste vide silencieuse ferait passer une panne pour un
     * « client inconnu ».
     */
    async listerClients() {
      const { data, error } = await supabase
        .from('app_data')
        .select('id, data')
        .eq('collection', 'clients')
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      return (data || []).map((r) => r.data);
    },

    /**
     * Insère le mouvement de trésorerie, et dit s'il a RÉELLEMENT été créé.
     *
     * ⚠️ TANT QUE LA MIGRATION 005 N'EST PAS APPLIQUÉE, CE N'EST PAS UNE
     * GARANTIE. Sans index unique, deux insertions simultanées passent toutes
     * les deux : PostgreSQL n'a alors aucune raison d'en refuser une. La
     * lecture préalable ci-dessous referme la fenêtre la plus courante (un
     * rappel rejoué quelques secondes plus tard), pas la course vraie.
     * `migrations/005_idempotence_encaissements.sql` pose l'index qui, lui,
     * la referme pour de bon.
     */
    async insererMouvement(mouvement) {
      const { data: existants } = await supabase
        .from('app_data')
        .select('id, data')
        .eq('collection', 'mouvements_financiers');
      const deja = (existants || []).some((m) => m.data?.reference === mouvement.reference);
      if (deja) return { insere: false, raison: 'mouvement déjà présent' };

      const { error } = await supabase.from('app_data').insert(ligneAppData({
        collection: 'mouvements_financiers',
        data: mouvement,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

      if (error) {
        if (estViolationUnicite(error)) return { insere: false, raison: 'doublon rejeté par la base' };
        throw new Error(error.message);
      }
      return { insere: true };
    },

    /**
     * Crédite le solde du compte.
     *
     * Passe par la fonction SQL `crediter_compte` (migration 005) quand elle
     * existe : l'incrément est alors atomique côté PostgreSQL. Sans elle, on
     * retombe sur lire-modifier-écrire, qui perd une mise à jour si deux
     * crédits tombent en même temps. Le repli est volontairement conservé pour
     * que le déploiement du code ne dépende pas de l'ordre de la migration.
     */
    async crediterCompte(compteId, montant, soldeConnu) {
      const { error } = await supabase.rpc('crediter_compte', {
        p_compte_id: compteId,
        p_montant: montant,
      });
      if (!error) return;

      const { data: compte } = await supabase
        .from('app_data')
        .select('id, data')
        .eq('id', compteId)
        .maybeSingle();
      const base = compte?.data || {};
      await supabase.from('app_data')
        .update({
          data: { ...base, solde: soldeNumerique(base.solde ?? soldeConnu) + montant },
          updated_at: new Date().toISOString(),
        })
        .eq('id', compteId);
    },

    async insererNotification(notification) {
      await supabase.from('app_data').insert(ligneAppData({
        collection: 'notifications_app',
        data: notification,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));
    },
  };
}
