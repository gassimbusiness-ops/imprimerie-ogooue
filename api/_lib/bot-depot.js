/**
 * Bot Messenger / Instagram — LE DÉPÔT (Supabase).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * POURQUOI `app_data` ET PAS DEUX TABLES DÉDIÉES
 * ════════════════════════════════════════════════════════════════════════════
 *
 * L'auto-poster a ses propres tables, et la migration 008 explique pourquoi :
 * `app_data` est lisible ET modifiable par quiconque présente la clé `anon`,
 * laquelle est dans le bundle public. Une file qui décide de ce qui part sur la
 * Page de l'entreprise n'a rien à y faire.
 *
 * Le bot y vit quand même, et l'arbitrage est écrit ici plutôt que découvert
 * plus tard. Trois raisons, dans l'ordre de poids :
 *
 *   1. l'écran doit pouvoir LIRE le journal. Les tables du rôle de service ne
 *      sont lisibles que par une fonction serverless — et le plan Vercel Hobby
 *      est à 12 fonctions sur 12. Un journal que personne ne peut ouvrir ne
 *      remplit pas la règle « on doit savoir ce que le bot a raconté » ;
 *   2. rien de neuf n'est exposé : `messages_meta` — qui contient le CONTENU
 *      des messages clients — est déjà dans `app_data`. Le journal du bot n'y
 *      ajoute que nos propres textes et des identifiants pseudonymes ;
 *   3. l'interrupteur n'ouvre rien à lui seul. Même basculé par un tiers, le
 *      bot reste muet tant que `BOT_META_MODE=live` n'est pas posé dans Vercel.
 *      Le pire qu'un accès `anon` puisse faire, c'est COUPER le bot — ou le
 *      rallumer pour qu'il serve huit textes validés.
 *
 * Deux collections :
 *
 *   `bot_controle` — une seule ligne, marquée `cle: 'global'`. L'interrupteur.
 *   `bot_journal`  — une ligne par message examiné, répondu ou non.
 *
 * ⚠️ `app_data` n'a AUCUNE contrainte d'unicité native : c'est
 * `migrations/013_bot_meta_messagerie.sql` qui pose l'index partiel dont dépend
 * `reserver()`. Tant qu'elle n'est pas appliquée, la prise n'exclut personne.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LE TÉMOIN
 * ════════════════════════════════════════════════════════════════════════════
 *
 * `temoinReponse()` ne cherche PAS « ai-je déjà vu ce message ». Il cherche
 * « existe-t-il une ligne portant un IDENTIFIANT DE MESSAGE SORTANT pour ce
 * message entrant ». La nuance est toute la leçon SingPay du 16/09 : une ligne
 * « examiné, pas répondu » ne doit pas empêcher une réponse plus tard, quand le
 * bot sera rallumé ou le jeton posé.
 */
import crypto from 'node:crypto';
import { ligneAppData } from '../../src/services/ligne-app-data.js';
import { COLLECTION_BOT_CONTROLE, COLLECTION_BOT_JOURNAL, MODE_SIMULATION } from './bot-executeur.js';
// ⚠️ Cycle assumé : `meta-webhook.js` importe ce module, et ce module lui
//    emprunte le nom de sa collection. Les deux sont des `const` lues à
//    l'exécution d'une méthode, jamais à l'évaluation du module : ESM le
//    supporte. L'alternative — recopier la chaîne 'messages_meta' — ferait
//    exactement ce que le dossier interdit : un fait écrit à deux endroits.
import { COLLECTION_MESSAGES } from '../meta-webhook.js';

const TABLE = 'app_data';

/** Fenêtre de recherche d'une reprise humaine. Au-delà, la question est vieille. */
const FENETRE_REPRISE_MS = 24 * 60 * 60 * 1000;

/**
 * @param {object} supabase  client du rôle de SERVICE (`supabaseAdmin()`)
 * @returns {object} le port attendu par `repondreAuxEvenements()`
 */
export function depotSupabaseBot(supabase) {
  return {
    /**
     * L'interrupteur, lu à CHAQUE passage.
     *
     * ⛔ Absent, illisible, ou mal formé → `{ actif: false }`. Un bot dont on ne
     * trouve pas l'interrupteur ne répond pas « par défaut », il se tait. C'est
     * ce qui le fait DÉMARRER ÉTEINT : tant que personne n'a créé la ligne,
     * aucun client ne reçoit rien.
     */
    async lireInterrupteur() {
      // ⚠️ La ligne se reconnaît à `data->>'cle' = 'global'`, PAS à son
      //    identifiant : `app_data.id` est un UUID, et `db.js` exige côté
      //    écran que `data.id` soit égal à cet UUID pour pouvoir mettre la
      //    ligne à jour (c'est ce qui rend le bouton « Couper » possible).
      const { data, error } = await supabase
        .from(TABLE)
        .select('data')
        .eq('collection', COLLECTION_BOT_CONTROLE)
        .eq('data->>cle', 'global')
        .limit(1);
      if (error) {
        // Une base injoignable n'autorise pas à parler aux clients.
        console.error('[Bot Meta] Interrupteur illisible — bot considéré à l\'arrêt : %s', error.message);
        return { actif: false, mode: MODE_SIMULATION };
      }
      const ligne = (data || [])[0]?.data;
      if (!ligne) return { actif: false, mode: MODE_SIMULATION };
      return {
        actif: ligne.actif === true,
        mode: ligne.mode === 'live' ? 'live' : MODE_SIMULATION,
      };
    },

    /**
     * Le témoin de l'effet : une réponse RÉELLEMENT partie pour ce message.
     * @param {string} messageIdEntrant
     * @returns {Promise<object|null>}
     */
    async temoinReponse(messageIdEntrant) {
      const { data, error } = await supabase
        .from(TABLE)
        .select('data')
        .eq('collection', COLLECTION_BOT_JOURNAL)
        .eq('data->>message_id_entrant', messageIdEntrant)
        .not('data->>id_message_sortant', 'is', null)
        .limit(1);
      if (error) throw new Error(`lecture ${COLLECTION_BOT_JOURNAL} : ${error.message}`);
      return (data || [])[0]?.data || null;
    },

    /**
     * Le gérant a-t-il repris la conversation ?
     *
     * On cherche un ÉCHO — un message envoyé par la Page — destiné à ce client,
     * récent, et dont l'identifiant n'est pas l'un des nôtres. Un écho qui
     * porte l'identifiant d'une de nos réponses, c'est le bot qui se voit
     * lui-même : ça ne prouve aucune reprise humaine.
     *
     * ⚠️ Ce contrôle ne peut rien voir tant que le champ webhook
     * `message_echoes` n'est pas abonné chez Meta — seuls `messages` et
     * `messaging_postbacks` le sont au dossier. Il rend alors `false`, et le
     * bot continue de répondre. C'est dit ici plutôt que découvert plus tard.
     */
    async humainAPrisLaMain({ canal, conversationId, depuis } = {}) {
      if (!conversationId) return false;
      const borne = new Date(Date.parse(depuis || '') - FENETRE_REPRISE_MS);
      const depuisIso = Number.isFinite(borne.getTime())
        ? borne.toISOString()
        : new Date(Date.now() - FENETRE_REPRISE_MS).toISOString();

      const { data, error } = await supabase
        .from(TABLE)
        .select('data')
        .eq('collection', COLLECTION_MESSAGES)
        .eq('data->>type', 'echo')
        .eq('data->>canal', canal)
        .eq('data->>destinataire_id', String(conversationId))
        .gte('data->>recu_le', depuisIso)
        .limit(25);
      if (error) throw new Error(`lecture ${COLLECTION_MESSAGES} (échos) : ${error.message}`);

      const echos = (data || []).map((l) => l.data?.message_id).filter(Boolean);
      if (echos.length === 0) return false;

      // Lesquels de ces échos sont les nôtres ?
      const { data: miens, error: err2 } = await supabase
        .from(TABLE)
        .select('data')
        .eq('collection', COLLECTION_BOT_JOURNAL)
        .in('data->>id_message_sortant', echos);
      if (err2) throw new Error(`lecture ${COLLECTION_BOT_JOURNAL} (échos) : ${err2.message}`);

      const nous = new Set((miens || []).map((l) => l.data?.id_message_sortant));
      return echos.some((mid) => !nous.has(mid));
    },

    /**
     * PREND le message, de façon exclusive, AVANT tout appel réseau.
     *
     * L'exclusivité ne vient pas de ce code : elle vient de l'index unique posé
     * par `migrations/013_bot_meta_messagerie.sql` sur `data->>'message_id_entrant'`, pour
     * les seules lignes qui représentent une tentative d'envoi. Une seconde
     * insertion pour le même message revient en violation d'unicité — et c'est
     * le RÉSULTAT ATTENDU, pas une panne : elle dit « quelqu'un d'autre s'en
     * occupe », et l'appelant passe au suivant sans rien envoyer.
     *
     * ⚠️ Tant que la migration n'est pas appliquée, l'insertion réussit
     * toujours : la prise n'exclut personne. Le rejeu reste couvert par le
     * témoin ; la course simultanée, non.
     *
     * @param {object} entree
     * @returns {Promise<{reserve: boolean, id: string|null}>}
     */
    async reserver(entree) {
      const id = crypto.randomUUID();
      const maintenant = new Date().toISOString();
      const { error } = await supabase.from(TABLE).insert(ligneAppData({
        collection: COLLECTION_BOT_JOURNAL,
        data: { ...entree, id },
        created_at: maintenant,
        updated_at: maintenant,
      }));
      if (error) {
        if (/duplicate key|unique constraint/i.test(error.message || '')) {
          return { reserve: false, id: null };
        }
        throw new Error(`réservation ${COLLECTION_BOT_JOURNAL} : ${error.message}`);
      }
      return { reserve: true, id };
    },

    /**
     * Complète la ligne réservée : témoin d'envoi, ou motif d'échec.
     * ⚠️ C'est une mise à jour de NOTRE ligne, identifiée par son identifiant
     * de réservation. Aucune autre ligne de la base n'est touchée.
     */
    async confirmer(idReservation, complement) {
      const { data, error } = await supabase
        .from(TABLE)
        .select('data')
        .eq('id', idReservation)
        .eq('collection', COLLECTION_BOT_JOURNAL)
        .maybeSingle();
      if (error) throw new Error(`relecture ${COLLECTION_BOT_JOURNAL} : ${error.message}`);
      if (!data) throw new Error(`réservation introuvable : ${idReservation}`);

      const { error: err2 } = await supabase
        .from(TABLE)
        .update({ data: { ...data.data, ...complement }, updated_at: new Date().toISOString() })
        .eq('id', idReservation)
        .eq('collection', COLLECTION_BOT_JOURNAL);
      if (err2) throw new Error(`écriture ${COLLECTION_BOT_JOURNAL} : ${err2.message}`);
    },

    /**
     * Écrit une ligne de journal pour un cas où RIEN n'est parti.
     *
     * ⚠️ Aucune écriture métier n'est possible depuis ce port : il n'expose ni
     * commande, ni client, ni devis. C'est une serrure, pas une consigne.
     */
    async journaliser(entree) {
      const maintenant = new Date().toISOString();
      // UN identifiant, colonne et `data.id` (src/services/ligne-app-data.js).
      const { error } = await supabase.from(TABLE).insert(ligneAppData({
        collection: COLLECTION_BOT_JOURNAL,
        data: { ...entree, id: crypto.randomUUID() },
        created_at: maintenant,
        updated_at: maintenant,
      }));
      // Quand l'index unique existera, un doublon simultané sera rejeté ici :
      // c'est le résultat attendu, pas une panne.
      if (error && !/duplicate key|unique constraint/i.test(error.message || '')) {
        throw new Error(`écriture ${COLLECTION_BOT_JOURNAL} : ${error.message}`);
      }
    },
  };
}
