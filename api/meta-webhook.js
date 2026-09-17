/**
 * Vercel Serverless Function — adresse de rappel (webhook) Meta.
 * Messenger (objet `page`) et messages privés Instagram (objet `instagram`).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⛔ CE BOT NE RÉPOND À PERSONNE. IL N'EST PAS EN SERVICE.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Cet endpoint **reçoit et range**, rien d'autre. Aucun message n'est envoyé,
 * aucune réponse automatique n'est produite, aucune écriture métier n'est faite.
 *
 * Pourquoi : sur les 19 fiches de connaissance du bot, **4 seulement** sont
 * marquées exportables. La règle du projet est « un bot qui invente une réponse
 * est pire que pas de bot ». Tant qu'il n'y a pas de réponses validées à servir,
 * répondre serait une régression, pas une fonctionnalité.
 *
 * Ce que cela change concrètement : quand cet endpoint est enregistré chez Meta,
 * les clients qui écrivent sur Messenger ou Instagram ne reçoivent RIEN de plus
 * qu'avant — c'est toujours un humain qui répond. Leurs messages sont
 * simplement journalisés dans la collection `messages_meta`, ce qui permettra
 * plus tard de mesurer le volume réel et d'écrire les réponses sur des cas vrais.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LES TROIS PIÈGES DE CE PROTOCOLE — ET COMMENT ILS SONT TRAITÉS ICI
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ── PIÈGE 1 : le `hub.challenge` doit repartir BRUT ─────────────────────────
 * À l'enregistrement de l'URL, Meta appelle en GET avec `hub.mode`,
 * `hub.verify_token` et `hub.challenge`, et compare octet pour octet ce qu'on
 * renvoie au `hub.challenge` envoyé. Répondre `res.json(challenge)` renvoie
 * `"1234567890"` — AVEC les guillemets — et l'écran Meta refuse l'URL sans
 * jamais dire pourquoi. C'est la cause d'échec numéro un de cette étape.
 * → Ici : `Content-Type: text/plain`, corps = la chaîne nue, pas de JSON.
 *
 * ── PIÈGE 2 : la signature se calcule sur le corps BRUT ─────────────────────
 * `X-Hub-Signature-256` est un HMAC-SHA256 des octets exacts reçus. Un hôte qui
 * analyse le JSON puis qu'on re-sérialise (`JSON.stringify(req.body)`) ne rend
 * PAS les mêmes octets : ordre des clés, espaces, échappement Unicode diffèrent.
 * La signature ne correspond alors jamais, et le symptôme est « Meta envoie des
 * messages non signés » — ce qui est faux.
 * → Ici : `lireCorpsBrut()` lit le flux AVANT que quoi que ce soit ne touche
 *   `req.body` (sur Vercel, `req.body` est un accesseur paresseux : tant qu'on
 *   ne le lit pas, le flux reste intact). Si le corps brut est introuvable, on
 *   REFUSE en le disant dans les logs — jamais on ne « vérifie » une signature
 *   sur un corps reconstruit, ce qui serait un contrôle décoratif.
 *
 * ── PIÈGE 3 : 200 immédiat, sinon Meta REJOUE ───────────────────────────────
 * Meta attend un 200 rapide. Si la réponse tarde, il renvoie le même événement,
 * plusieurs fois. C'est exactement le motif qui a produit la course
 * sondage/rappel sur SingPay (`tasks/lessons.md`, 16/09) : deux chemins, deux
 * instances serverless, même effet écrit deux fois.
 * → Ici : la signature vérifiée, on répond 200 tout de suite ; l'analyse et le
 *   rangement se font APRÈS la réponse. Et le rangement est idempotent sur
 *   l'identifiant du message.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * IDEMPOTENCE — LA LEÇON SINGPAY APPLIQUÉE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * « L'idempotence se fonde sur le témoin de l'effet, pas sur un état
 * intermédiaire qu'un autre chemin peut écrire » (lessons.md, 16/09).
 * Ici l'effet unique produit est **la ligne rangée dans `messages_meta`** :
 * c'est donc sa présence, cherchée sur `message_id`, qui arbitre — pas un
 * statut, pas un drapeau « déjà vu » posé à côté.
 *
 * ⚠️ Comme pour les mouvements de trésorerie avant la migration 005, la lecture
 * préalable referme la fenêtre courante (un rejeu quelques secondes plus tard),
 * pas la course vraie entre deux instances simultanées. La garantie durable est
 * un index unique sur `data->>'message_id'` pour la collection `messages_meta`.
 * Tant qu'il n'existe pas, un doublon reste possible — et il est sans gravité
 * ici, puisque cet endpoint ne produit aucun effet métier.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * DONNÉES PERSONNELLES
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Le contenu des messages appartient aux clients de l'imprimerie. Il est rangé
 * en base (c'est l'objet de cet endpoint) mais **jamais recopié dans les logs** :
 * les traces ne portent que le canal, le nombre d'événements, l'identifiant
 * technique du message et le type. Les logs Vercel sont lisibles par toute
 * personne ayant accès au projet ; la base, elle, est déjà le lieu des données
 * de l'entreprise.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * VARIABLES D'ENVIRONNEMENT (à poser dans Vercel — jamais dans le dépôt)
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   META_VERIFY_TOKEN — chaîne aléatoire QUE NOUS CHOISISSONS, saisie à
 *       l'identique dans « Verify Token » du tableau de bord Meta. Elle ne sert
 *       qu'à la vérification GET. Absente → l'endpoint refuse tout (403).
 *
 *   META_APP_SECRET  — « Clé secrète de l'application », fournie PAR Meta
 *       (Tableau de bord → Paramètres → Général). Sert à vérifier la signature
 *       des POST. Absente → l'endpoint refuse tout POST (403).
 *
 * Détail documenté dans `livrables_claude/meta/WEBHOOK_META_ENDPOINT.md`.
 */
import crypto from 'node:crypto';
import { empreintesEgales } from './_lib/session.js';
import { supabaseAdmin } from './_lib/supabase-admin.js';
import { toISODate } from '../src/lib/dates.js';

/**
 * Indication pour les hôtes de type Next : ne pas analyser le corps.
 * ⚠️ Le code NE DÉPEND PAS de cette ligne — `lireCorpsBrut()` fonctionne avec ou
 * sans. Elle est là parce qu'elle ne coûte rien et supprime le cas « l'hôte a
 * déjà consommé le flux » là où elle est honorée.
 */
export const config = { api: { bodyParser: false } };

/** Collection de rangement dans `app_data`. */
export const COLLECTION_MESSAGES = 'messages_meta';

/* ═══════════════════════════════════════════════════════════════════════════
   1. LECTURE DE LA REQUÊTE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Paramètres de requête, sans dépendre d'un helper de l'hôte.
 *
 * `req.query` existe sur Vercel, mais pas en test ni derrière un autre hôte.
 * On retombe alors sur l'analyse de `req.url`, qui est toujours là.
 *
 * @param {{ query?: Record<string, unknown>, url?: string }} req
 * @returns {Record<string, string>}
 */
export function lireParametres(req) {
  const q = req?.query;
  if (q && typeof q === 'object' && Object.keys(q).length > 0) {
    const plat = {};
    for (const [cle, valeur] of Object.entries(q)) {
      plat[cle] = Array.isArray(valeur) ? String(valeur[0] ?? '') : String(valeur ?? '');
    }
    return plat;
  }
  try {
    const url = new URL(req?.url || '/', 'http://local');
    return Object.fromEntries(url.searchParams.entries());
  } catch {
    return {};
  }
}

/**
 * Le corps BRUT, en octets. Voir PIÈGE 2 en tête de fichier.
 *
 * L'ordre des tentatives n'est pas indifférent :
 *   1. `req.rawBody` quand l'hôte le fournit déjà (certains le font) ;
 *   2. le flux, s'il n'a pas encore été consommé — c'est le cas normal sur
 *      Vercel tant qu'on n'a pas touché `req.body` ;
 *   3. `req.body` SEULEMENT s'il est déjà une chaîne ou un Buffer, donc non
 *      transformé.
 *
 * Il n'y a volontairement PAS de repli `JSON.stringify(req.body)` : il
 * produirait une signature qui ne correspond jamais, et donnerait à croire que
 * Meta envoie des messages invalides. Mieux vaut un `null` explicite, refusé et
 * journalisé, qu'un contrôle qui ment.
 *
 * @param {any} req
 * @returns {Promise<Buffer|null>}
 */
export async function lireCorpsBrut(req) {
  if (!req) return null;

  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (typeof req.rawBody === 'string') return Buffer.from(req.rawBody, 'utf8');

  const flotLisible = typeof req[Symbol.asyncIterator] === 'function'
    && req.readableEnded !== true
    && req.readable !== false;

  if (flotLisible) {
    const morceaux = [];
    for await (const morceau of req) {
      morceaux.push(Buffer.isBuffer(morceau) ? morceau : Buffer.from(String(morceau), 'utf8'));
    }
    return Buffer.concat(morceaux);
  }

  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body, 'utf8');

  return null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. AUTHENTIFICATION
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Vérifie `X-Hub-Signature-256`.
 *
 * Comparaison à temps constant via `empreintesEgales()` (api/_lib/session.js) :
 * un `===` sur une signature s'arrête au premier octet différent, ce qui la
 * rend devinable octet par octet par mesure du temps de réponse. Une seule
 * implémentation de cette comparaison dans le dépôt, réutilisée ici.
 *
 * @param {Buffer|null} corpsBrut
 * @param {unknown} entete valeur de l'en-tête X-Hub-Signature-256
 * @param {string} secret  META_APP_SECRET
 * @returns {boolean}
 */
export function signatureValide(corpsBrut, entete, secret) {
  if (!Buffer.isBuffer(corpsBrut)) return false;
  if (typeof entete !== 'string' || !entete.startsWith('sha256=')) return false;
  if (!secret) return false;
  const attendue = `sha256=${crypto.createHmac('sha256', secret).update(corpsBrut).digest('hex')}`;
  return empreintesEgales(entete, attendue);
}

/** Lit l'en-tête de signature quelle que soit la casse rendue par l'hôte. */
export function lireEnteteSignature(req) {
  const h = req?.headers || {};
  return h['x-hub-signature-256'] || h['X-Hub-Signature-256'] || null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. NORMALISATION DES ÉVÉNEMENTS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Canal d'origine, d'après l'objet d'abonnement déclaré par Meta.
 * `page` = Messenger, `instagram` = messages privés Instagram.
 *
 * @param {string} [objet]
 * @returns {'messenger'|'instagram'|'inconnu'}
 */
export function canalDepuisObjet(objet) {
  if (objet === 'page') return 'messenger';
  if (objet === 'instagram') return 'instagram';
  return 'inconnu';
}

/** Type d'événement, pour pouvoir compter sans ouvrir le contenu. */
export function typeEvenement(evenement) {
  if (!evenement || typeof evenement !== 'object') return 'inconnu';
  if (evenement.message) return evenement.message.is_echo ? 'echo' : 'message';
  if (evenement.postback) return 'postback';
  if (evenement.reaction) return 'reaction';
  if (evenement.read) return 'lecture';
  if (evenement.delivery) return 'accuse_reception';
  if (evenement.referral) return 'referral';
  if (evenement.optin) return 'optin';
  return 'autre';
}

/**
 * Identifiant stable d'un événement — la clé d'idempotence.
 *
 * Un message porte un `mid` attribué par Meta : c'est lui qui fait foi, et un
 * rejeu porte le même. Les événements sans `mid` (postback, accusé de lecture)
 * reçoivent une empreinte déterministe de leur contenu : deux livraisons du
 * même événement donnent la même empreinte, deux événements différents non.
 *
 * @param {string} canal
 * @param {string} pageId
 * @param {object} evenement
 * @returns {string}
 */
export function identifiantEvenement(canal, pageId, evenement) {
  const mid = evenement?.message?.mid;
  if (typeof mid === 'string' && mid) return mid;
  const empreinte = crypto.createHash('sha256')
    .update(JSON.stringify({ canal, pageId, evenement }))
    .digest('hex');
  return `evt_${empreinte.slice(0, 32)}`;
}

/**
 * Aplatit la charge utile Meta en une liste d'événements rangés.
 *
 * Forme reçue : `{ object, entry: [ { id, time, messaging|changes: [...] } ] }`.
 * Rien n'est supposé : chaque niveau est vérifié, une charge malformée rend une
 * liste vide plutôt qu'une exception (on a déjà répondu 200 à ce stade).
 *
 * @param {any} charge
 * @param {{ recuLe: Date }} contexte
 * @returns {Array<object>}
 */
export function normaliserCharge(charge, { recuLe }) {
  const canal = canalDepuisObjet(charge?.object);
  const entrees = Array.isArray(charge?.entry) ? charge.entry : [];
  const horodatage = recuLe.toISOString();
  // Date métier : `toISODate` et jamais `.toISOString().slice(0,10)`, qui
  // décalerait d'un jour toute réception après 23 h à Libreville (src/lib/dates.js).
  const dateMetier = toISODate(recuLe);

  const documents = [];
  for (const entree of entrees) {
    const pageId = entree?.id ? String(entree.id) : null;
    const evenements = [
      ...(Array.isArray(entree?.messaging) ? entree.messaging : []),
      ...(Array.isArray(entree?.standby) ? entree.standby : []),
      ...(Array.isArray(entree?.changes) ? entree.changes : []),
    ];
    for (const evenement of evenements) {
      if (!evenement || typeof evenement !== 'object') continue;
      documents.push({
        message_id: identifiantEvenement(canal, pageId, evenement),
        canal,
        objet_abonnement: charge?.object ? String(charge.object) : null,
        page_id: pageId,
        expediteur_id: evenement?.sender?.id ? String(evenement.sender.id) : null,
        destinataire_id: evenement?.recipient?.id ? String(evenement.recipient.id) : null,
        type: typeEvenement(evenement),
        horodatage_meta: Number.isFinite(evenement?.timestamp) ? evenement.timestamp : (entree?.time ?? null),
        recu_le: horodatage,
        date_reception: dateMetier,
        traite: false,          // aucun traitement n'existe encore : voir en-tête.
        evenement,              // charge brute conservée pour un traitement ultérieur.
      });
    }
  }
  return documents;
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. RANGEMENT IDEMPOTENT
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Range les événements, une seule fois chacun.
 *
 * @param {{ depot: { existe(id: string): Promise<boolean>, inserer(doc: object): Promise<void> }, evenements: Array<object> }} args
 * @returns {Promise<{ ranges: number, ignores: number, erreurs: number }>}
 */
export async function rangerEvenements({ depot, evenements }) {
  let ranges = 0;
  let ignores = 0;
  let erreurs = 0;
  const vus = new Set();

  for (const doc of evenements) {
    // Deux fois le même identifiant DANS LE MÊME message : Meta peut grouper.
    if (vus.has(doc.message_id)) { ignores += 1; continue; }
    vus.add(doc.message_id);
    try {
      if (await depot.existe(doc.message_id)) { ignores += 1; continue; }
      await depot.inserer(doc);
      ranges += 1;
    } catch (err) {
      erreurs += 1;
      console.error('[Meta Webhook] Rangement impossible (id=%s) : %s', doc.message_id, err?.message);
    }
  }
  return { ranges, ignores, erreurs };
}

/** Dépôt réel : table `app_data`, collection `messages_meta`. */
export function depotSupabaseMeta(supabase) {
  return {
    async existe(messageId) {
      const { data, error } = await supabase
        .from('app_data')
        .select('id')
        .eq('collection', COLLECTION_MESSAGES)
        .eq('data->>message_id', messageId)
        .limit(1);
      if (error) throw new Error(error.message);
      return (data || []).length > 0;
    },

    async inserer(doc) {
      const maintenant = new Date().toISOString();
      const { error } = await supabase.from('app_data').insert({
        id: crypto.randomUUID(),
        collection: COLLECTION_MESSAGES,
        data: { id: crypto.randomUUID(), ...doc },
        created_at: maintenant,
        updated_at: maintenant,
      });
      // Quand l'index unique existera, un doublon simultané sera rejeté ici :
      // c'est le résultat attendu, pas une panne.
      if (error && !/duplicate key|unique constraint/i.test(error.message || '')) {
        throw new Error(error.message);
      }
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. GESTIONNAIRE HTTP
   ═══════════════════════════════════════════════════════════════════════════ */

/** Réponse en texte brut, sans JSON ni guillemets (PIÈGE 1). */
function repondreTexte(res, code, texte) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  return res.status(code).send(texte);
}

/**
 * Fabrique le gestionnaire. Le dépôt est injectable pour que
 * `tests/meta-webhook.test.mjs` rejoue un webhook signé, un rejeu et une
 * signature invalide sans réseau ni base.
 */
export function creerGestionnaireMetaWebhook({ depot: depotFourni = null, maintenant = () => new Date() } = {}) {
  return async function gestionnaireMetaWebhook(req, res) {
    /* ── GET : vérification d'abonnement ─────────────────────────────────── */
    if (req.method === 'GET') {
      const attendu = (process.env.META_VERIFY_TOKEN || '').trim();
      if (!attendu) {
        // Un endpoint qui accepterait n'importe quel jeton faute de variable
        // serait pire que pas d'endpoint : n'importe qui enregistrerait cette
        // URL sous SA propre application Meta.
        console.error('[Meta Webhook] META_VERIFY_TOKEN absent de l\'environnement : '
          + 'toute vérification est refusée. Poser la variable dans Vercel (Production ET Preview).');
        return repondreTexte(res, 403, 'Forbidden');
      }

      const p = lireParametres(req);
      const mode = p['hub.mode'];
      const jeton = p['hub.verify_token'];
      const challenge = p['hub.challenge'];

      if (mode !== 'subscribe' || !empreintesEgales(jeton, attendu)) {
        // Aucun détail : ni « mauvais jeton », ni « mauvais mode ». Un refus qui
        // explique ce qui a échoué est un oracle offert à qui sonde l'URL.
        console.warn('[Meta Webhook] Vérification refusée (mode=%s)', mode ? 'fourni' : 'absent');
        return repondreTexte(res, 403, 'Forbidden');
      }

      if (typeof challenge !== 'string' || challenge === '') {
        console.warn('[Meta Webhook] Jeton correct mais hub.challenge absent.');
        return repondreTexte(res, 400, 'Bad Request');
      }

      console.log('[Meta Webhook] Vérification d\'abonnement réussie.');
      // ⛔ Le challenge repart NU. Pas de res.json(), pas de String template.
      return repondreTexte(res, 200, challenge);
    }

    /* ── POST : réception d'événements ───────────────────────────────────── */
    if (req.method === 'POST') {
      const secret = (process.env.META_APP_SECRET || '').trim();
      if (!secret) {
        console.error('[Meta Webhook] META_APP_SECRET absent de l\'environnement : '
          + 'aucune signature ne peut être vérifiée, tout POST est refusé. Poser la variable dans Vercel.');
        return repondreTexte(res, 403, 'Forbidden');
      }

      // ⚠️ AVANT toute lecture de req.body : voir PIÈGE 2.
      const corpsBrut = await lireCorpsBrut(req);
      if (!corpsBrut) {
        console.error('[Meta Webhook] Corps brut indisponible (flux déjà consommé par l\'hôte). '
          + 'Signature invérifiable — refus. Ne jamais vérifier sur un corps re-sérialisé.');
        return repondreTexte(res, 403, 'Forbidden');
      }

      if (!signatureValide(corpsBrut, lireEnteteSignature(req), secret)) {
        console.warn('[Meta Webhook] Signature invalide ou absente — rejeté.');
        return repondreTexte(res, 403, 'Forbidden');
      }

      // ── 200 IMMÉDIAT (PIÈGE 3). Rien de long au-dessus de cette ligne.
      res.status(200).json({ received: true });

      // ── Puis seulement : analyse et rangement.
      try {
        const charge = JSON.parse(corpsBrut.toString('utf8'));
        const evenements = normaliserCharge(charge, { recuLe: maintenant() });

        // Journal SANS contenu de message : canal, compte, types. Jamais le texte.
        console.log('[Meta Webhook] %s — %d événement(s) : %s',
          canalDepuisObjet(charge?.object),
          evenements.length,
          evenements.map((e) => e.type).join(',') || 'aucun');

        if (evenements.length === 0) return;

        const depot = depotFourni || depotSupabaseMeta(supabaseAdmin());
        const bilan = await rangerEvenements({ depot, evenements });
        console.log('[Meta Webhook] Rangés=%d ignorés(déjà connus)=%d erreurs=%d',
          bilan.ranges, bilan.ignores, bilan.erreurs);
      } catch (err) {
        // La réponse est déjà partie : Meta ne rejouera pas. C'est assumé —
        // le seul effet perdu est une ligne de journal, aucun effet métier.
        console.error('[Meta Webhook] Traitement après réponse en échec :', err?.message);
      }
      return undefined;
    }

    res.setHeader('Allow', 'GET, POST');
    return repondreTexte(res, 405, 'Method Not Allowed');
  };
}

export default creerGestionnaireMetaWebhook();
