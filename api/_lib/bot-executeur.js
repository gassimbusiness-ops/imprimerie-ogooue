/**
 * Bot Messenger / Instagram — L'EXÉCUTEUR : ce qui part, et ce qui ne part pas.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * L'ORDRE DES CONTRÔLES, ET POURQUOI IL EST CELUI-LÀ
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   0. EST-CE UNE QUESTION ?   un écho, un accusé de lecture, une réaction ou
 *      une pièce jointe seule ne sont pas des questions. Rien ne part.
 *   1. INTERRUPTEUR            lu EN BASE, à chaque passage. Une variable
 *      d'environnement n'aurait d'effet qu'après redéploiement : un arrêt
 *      d'urgence qui exige un déploiement n'est pas un arrêt d'urgence.
 *      ⛔ Interrupteur introuvable = bot ÉTEINT. Il démarre éteint.
 *   2. COMPTE RECONNU          le jeton de Page voit DEUX Pages (l'imprimerie
 *      et TopShop, même portefeuille). On ne répond que là où on est déclaré.
 *   3. DÉJÀ RÉPONDU ?          le témoin de l'effet — l'identifiant du message
 *      SORTANT rendu par Meta — décide. Jamais un statut posé par nous.
 *   4. HUMAIN EN CHARGE ?      si le gérant a repris la conversation, le bot
 *      se tait (07_SCHEDULER_ET_BOTS_SPEC.md, « Transfert humain »).
 *   5. COMPOSITION             fiches validées uniquement.
 *   6. VERROU DE CATALOGUE     un texte hors catalogue n'est JAMAIS envoyé.
 *   7. ENVOI ou SIMULATION
 *   8. JOURNAL                 dans tous les cas, y compris quand rien ne part.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * L'IDEMPOTENCE, EN UNE PHRASE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Ce qui prouve qu'une réponse est partie, c'est l'identifiant rendu par Meta,
 * enregistré au journal — pas un drapeau « traité ». C'est la leçon SingPay du
 * 16/09 (`tasks/lessons.md`) : « l'idempotence se fonde sur le témoin de
 * l'effet, pas sur un état intermédiaire qu'un autre chemin peut écrire ».
 *
 * Et comme chez l'auto-poster, le témoin ne fait pas tout le travail : la
 * lecture préalable referme la fenêtre du REJEU (Meta relivre quelques secondes
 * plus tard), pas la course vraie entre deux instances serverless simultanées.
 * Celle-là est fermée par la RÉSERVATION — une insertion exclusive faite AVANT
 * le premier appel réseau. La réservation empêche un double départ maintenant ;
 * le témoin empêche un second départ plus tard.
 *
 * ⚠️ La réservation ne vaut que par son index unique. Tant que
 * `migrations/013_bot_meta_messagerie.sql` n'est pas appliquée, l'insertion réussit
 * toujours et la prise n'exclut personne : le rejeu reste couvert par le
 * témoin, la course simultanée non. C'est écrit dans le rapport de livraison,
 * pas caché — « une clé d'idempotence sans index unique n'est pas une clé,
 * c'est un commentaire ».
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LES DEUX VERROUS DU MODE RÉEL
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Exactement le patron de l'auto-poster, pour la même raison :
 *
 *   - la ligne `bot_controle` est le verrou d'EXPLOITATION. Elle se bascule en
 *     dix secondes, sans redéploiement, depuis la console ou l'écran ;
 *   - `BOT_META_MODE` est le cran de sûreté de DÉPLOIEMENT. Il vit dans Vercel,
 *     et le changer exige un redéploiement — ce qui en fait un mauvais arrêt
 *     d'urgence et une bonne sécurité de fond.
 *
 * Aucun des deux n'ouvre seul.
 *
 * ⛔ CE QUE CE MODULE NE FAIT JAMAIS : créer une commande, un client, un devis,
 *    ou écrire quoi que ce soit d'autre que son propre journal. Le contrat du
 *    dépôt ci-dessous n'expose aucun geste métier — c'est la serrure, pas la
 *    consigne.
 *
 * ── LE CONTRAT DU DÉPÔT (injecté ; jamais Supabase en dur ici) ─────────────
 *
 *   lireInterrupteur()                  → { actif, mode } | null
 *   temoinReponse(messageIdEntrant)     → ligne | null   ← le témoin de l'effet
 *   humainAPrisLaMain({ canal, conversationId, depuis }) → boolean
 *   reserver(entree)                    → { reserve: boolean, id: string|null }
 *   confirmer(id, complement)           → void
 *   journaliser(entree)                 → void
 *
 * ⛔ Aucun geste métier dans ce contrat : ni commande, ni client, ni devis.
 *    C'est une serrure, pas une consigne.
 */
import { texteDuMessage, analyserMessage, composerReponse, estReponseServable, contientPromesseInterdite } from './bot-reponse.js';
import { dateLocaleDepuisInstantUtc, formaterInstantUtc } from '../../src/lib/dates.js';

/** Modes. `dry_run` est le défaut, partout, toujours. */
export const MODE_SIMULATION = 'dry_run';
export const MODE_REEL = 'live';

/** Collections de rangement dans `app_data`. Nommées une seule fois. */
export const COLLECTION_BOT_CONTROLE = 'bot_controle';
export const COLLECTION_BOT_JOURNAL = 'bot_journal';

/**
 * Mode demandé par l'environnement. Absent → simulation.
 * ⚠️ Cette variable ne peut que RESTREINDRE, jamais autoriser à elle seule.
 */
export function modeBotDemande() {
  return (process.env.BOT_META_MODE || '').trim() === MODE_REEL ? MODE_REEL : MODE_SIMULATION;
}

/**
 * Le mode réellement appliqué : `live` seulement si la base ET l'environnement
 * le disent.
 * @param {{mode?: string}|null} controle
 * @returns {'dry_run'|'live'}
 */
export function modeBotEffectif(controle) {
  const base = controle?.mode === MODE_REEL;
  const environnement = modeBotDemande() === MODE_REEL;
  return base && environnement ? MODE_REEL : MODE_SIMULATION;
}

/**
 * Le compte visé est-il l'un des nôtres ?
 *
 * Quand `META_PAGE_ID` / `META_INSTAGRAM_ID` ne sont pas posés, on répond là où
 * on a été écrit : c'est le comportement sûr AVANT que les identifiants soient
 * confirmés par l'API (deux d'entre eux sont encore « à confirmer » au dossier).
 * Dès qu'une variable est posée, elle fait loi.
 *
 * @param {string} canal
 * @param {string|null} compteId
 * @returns {boolean}
 */
export function compteReconnu(canal, compteId) {
  const attendu = canal === 'instagram'
    ? (process.env.META_INSTAGRAM_ID || '').trim()
    : (process.env.META_PAGE_ID || '').trim();
  if (!attendu) return true;
  return String(compteId || '') === attendu;
}

/** Le compte qui a REÇU le message : on répond là, jamais ailleurs. */
function compteDestinataire(range) {
  return range?.evenement?.recipient?.id
    ? String(range.evenement.recipient.id)
    : (range?.destinataire_id || range?.page_id || null);
}

/** L'interlocuteur : PSID côté Messenger, IGSID côté Instagram. */
function interlocuteur(range) {
  return range?.evenement?.sender?.id
    ? String(range.evenement.sender.id)
    : (range?.expediteur_id || null);
}

/**
 * Répond aux événements déjà normalisés par `api/meta-webhook.js`.
 *
 * @param {object} arg
 * @param {object} arg.depot        le port décrit en tête de fichier
 * @param {object} arg.client       client d'envoi (`bot-envoi.js`)
 * @param {Array<object>} arg.evenements
 * @param {Date} [arg.instant]
 * @param {Function} [arg.tracer]
 * @returns {Promise<{examines: number, envoyes: number, simules: number, ecartes: number, echecs: number}>}
 */
export async function repondreAuxEvenements({
  depot,
  client,
  evenements,
  instant = new Date(),
  tracer = (...a) => console.log(...a),
}) {
  const bilan = {
    examines: 0, envoyes: 0, simules: 0, ecartes: 0, echecs: 0,
  };
  const liste = Array.isArray(evenements) ? evenements : [];
  if (liste.length === 0) return bilan;

  const instantUtc = formaterInstantUtc(instant);
  // ⛔ Date de MOANDA. Sur Vercel, l'horloge du processus est en UTC : une date
  //    fabriquée à partir d'elle compte la veille entre 23 h et minuit locales.
  const dateLocale = dateLocaleDepuisInstantUtc(instantUtc);

  const controle = await depot.lireInterrupteur();
  const actif = controle?.actif === true;
  const mode = modeBotEffectif(controle);

  /** Les identifiants déjà servis DANS CE LOT — Meta peut grouper. */
  const vusDansLeLot = new Set();

  for (const range of liste) {
    const messageId = range?.message_id;
    if (!messageId) continue;

    const question = texteDuMessage(range?.evenement);
    if (question === null) continue; // écho, accusé, réaction, pièce jointe seule
    bilan.examines += 1;

    const socle = {
      canal: range.canal || 'inconnu',
      message_id_entrant: messageId,
      expediteur_id: interlocuteur(range),
      compte_id: compteDestinataire(range),
      recu_le: range.recu_le || instantUtc,
      date_locale: dateLocale,
      mode,
    };

    const ecarter = async (motif) => {
      bilan.ecartes += 1;
      await journaliserSans(depot, socle, { action: 'ignore', motif });
    };

    if (vusDansLeLot.has(messageId)) { await ecarter('doublon_dans_le_lot'); continue; }
    vusDansLeLot.add(messageId);

    if (!actif) { await ecarter('bot_eteint'); continue; }

    if (!compteReconnu(socle.canal, socle.compte_id)) {
      await ecarter('compte_non_reconnu');
      continue;
    }

    // ── LE TÉMOIN DE L'EFFET. Voir l'en-tête.
    let temoin = null;
    try {
      temoin = await depot.temoinReponse(messageId);
    } catch (err) {
      // Une lecture de témoin en échec ne doit PAS ouvrir la porte à un envoi :
      // on ne saurait pas si le client a déjà reçu la réponse.
      await ecarter('temoin_illisible');
      tracer('[Bot Meta] Témoin illisible (%s) : %s', messageId, err?.message);
      continue;
    }
    if (temoin) { await ecarter('deja_repondu'); continue; }

    let humain = false;
    try {
      humain = await depot.humainAPrisLaMain({
        canal: socle.canal,
        conversationId: socle.expediteur_id,
        depuis: socle.recu_le,
      });
    } catch { humain = false; }
    if (humain) { await ecarter('humain_en_charge'); continue; }

    /* ── COMPOSITION ─────────────────────────────────────────────────────── */
    const analyse = analyserMessage(question);
    const reponse = composerReponse(analyse);

    // ⛔ LE VERROU. Un texte hors catalogue ne part pas, quoi qu'il arrive.
    if (!estReponseServable(reponse.texte)) {
      bilan.ecartes += 1;
      await journaliserSans(depot, socle, {
        action: 'refuse',
        motif: 'texte_hors_catalogue',
        intention: analyse.intention,
        erreur: `interdits=${contientPromesseInterdite(reponse.texte).join(',') || 'aucun'}`,
      });
      tracer('[Bot Meta] Texte hors catalogue REFUSÉ (%s) — aucun envoi.', messageId);
      continue;
    }

    /* ── SIMULATION ──────────────────────────────────────────────────────── */
    if (mode !== MODE_REEL || client?.disponible !== true) {
      bilan.simules += 1;
      // ⛔ Aucun témoin posé : sinon la vraie réponse ne partirait jamais.
      await depot.journaliser({
        ...socle,
        intention: analyse.intention,
        fiche_id: reponse.fiche_id,
        action: 'simule',
        motif: client?.disponible === true ? 'mode_simulation' : 'jeton_meta_absent',
        texte: reponse.texte,
        id_message_sortant: null,
        erreur: null,
        repondu_le: null,
      });
      continue;
    }

    /* ── RÉSERVATION, PUIS ENVOI ─────────────────────────────────────────── */
    // ⛔ La ligne est écrite AVANT le premier appel réseau. Deux raisons, et
    //    elles ne se recouvrent pas :
    //      - un processus qui meurt au milieu laisse une TRACE, pas un trou ;
    //      - la prise est exclusive (index unique de la migration 013) : deux
    //        exécutions simultanées ne peuvent pas partir toutes les deux.
    //    La réservation empêche un double départ MAINTENANT ; le témoin
    //    (`id_message_sortant`) empêche un second départ PLUS TARD. Les deux
    //    servent, ils ne servent pas à la même chose.
    const reservation = await depot.reserver({
      ...socle,
      intention: analyse.intention,
      fiche_id: reponse.fiche_id,
      action: 'en_cours',
      motif: null,
      texte: reponse.texte,
      id_message_sortant: null,
      erreur: null,
      piste: null,
      repondu_le: null,
    });
    if (!reservation?.reserve) { await ecarter('pris_par_une_autre_execution'); continue; }

    try {
      const envoi = await client.envoyerMessage({
        canal: socle.canal,
        destinataireId: socle.expediteur_id,
        texte: reponse.texte,
        compteId: socle.compte_id,
      });
      bilan.envoyes += 1;
      await depot.confirmer(reservation.id, {
        action: reponse.action === 'repondre' ? 'repondu' : 'passer_la_main',
        id_message_sortant: envoi.idMessage, // ← LE TÉMOIN
        repondu_le: formaterInstantUtc(new Date()),
      });
    } catch (err) {
      bilan.echecs += 1;
      await depot.confirmer(reservation.id, {
        action: 'echec',
        motif: err?.incertain ? 'resultat_incertain' : 'envoi_refuse',
        // Le message BRUT de Meta, jamais résumé : c'est lui qui se diagnostique.
        erreur: String(err?.message || err),
        piste: err?.piste || null,
      });
      tracer('[Bot Meta] Envoi en échec (%s, %s) : %s', socle.canal, messageId, err?.message);
    }
  }

  tracer('[Bot Meta] examinés=%d envoyés=%d simulés=%d écartés=%d échecs=%d (mode=%s)',
    bilan.examines, bilan.envoyes, bilan.simules, bilan.ecartes, bilan.echecs, mode);
  return bilan;
}

/**
 * Journalise un cas où RIEN n'est parti.
 *
 * ⚠️ `id_message_sortant` reste `null` : c'est ce qui permet une reprise quand
 * la cause disparaît (bot rallumé, jeton posé, panne réseau passée).
 */
async function journaliserSans(depot, socle, complement) {
  await depot.journaliser({
    intention: null,
    fiche_id: null,
    texte: null,
    erreur: null,
    piste: null,
    repondu_le: null,
    ...socle,
    ...complement,
    id_message_sortant: null,
  });
}
