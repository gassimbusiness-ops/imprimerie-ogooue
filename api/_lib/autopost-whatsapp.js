/**
 * La story WhatsApp du jour, remise dans le groupe Telegram « OGOOUÉ Alertes ».
 *
 * ════════════════════════════════════════════════════════════════════════════
 * POURQUOI — décision de Gassim du 28/09/2026 (option A)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * WhatsApp ne laisse aucune application publier un statut. ChatGPT prépare
 * pourtant chaque jour une story 1080×1920 (canal `whatsapp_handoff`, « remise
 * à un humain ») — et jusqu'ici PERSONNE ne la recevait : 16 lignes « Prévu »
 * dont 9 déjà passées, au 28/09. Désormais, au passage de 9 h, l'image et son
 * texte partent dans le groupe Telegram ; Ibrahim l'enregistre et la poste dans
 * le statut WhatsApp de l'imprimerie.
 *
 * ── Ce que ce module NE touche PAS ──────────────────────────────────────────
 *
 * La file des canaux qui publient (`lireFile`, Facebook et Instagram) : lecture
 * séparée (`lireRemisesWhatsApp`), exécuteur Meta inchangé. Une panne ici ne
 * peut ni retarder ni empêcher une publication : le module est appelé APRÈS
 * elle, borné dans le temps, et ne lève jamais.
 *
 * ── Les règles ──────────────────────────────────────────────────────────────
 *
 * - l'arrêt d'urgence (`autopost_controle.actif = false`) arrête aussi les
 *   remises ; en simulation (`mode = dry_run`, ou manifeste resté en
 *   `"mode_execution": "dry_run"`), rien ne part ;
 * - l'approbation est vérifiée comme pour Facebook : un « Retirer
 *   l'approbation » à l'écran empêche la remise ;
 * - jamais avant le créneau ; toute la journée ensuite (un statut WhatsApp
 *   n'a pas la contrainte d'heure d'un fil d'actualité) ;
 * - une story dont le jour est passé sans remise passe en `expired`, avec la
 *   raison — elle ne s'envoie pas en retard, et elle ne reste pas « Prévu » ;
 * - Telegram pas encore branché : la story du jour ATTEND (elle partira au
 *   passage suivant de la journée si le groupe est trouvé entre-temps) ;
 * - prise conditionnelle (`scheduled` → `executing`) : deux passages
 *   simultanés n'envoient pas deux fois ; un envoi `incertain` n'est pas
 *   refait (même règle que les alertes) ;
 * - trois refus de Telegram → `failed`, avec le motif.
 */
import { verifierApprobation } from './autopost-contrat.js';
import { cleSignatureApprobation } from './autopost-approbation.js';
import { DUREE_MAX_FONCTION_MS } from './autopost-alimentation.js';
import { depotSupabaseAlertes, resoudreGroupeTelegram, MARGE_REPONSE_MS } from './alertes-envoi.js';
import { creerClientTelegram, lireConfigurationTelegram } from './telegram.js';
import { supabaseAdmin } from './supabase-admin.js';
import { dateLocaleDepuisInstantUtc, formaterInstantUtc, msDepuisInstantUtc } from '../../src/lib/dates.js';

export const CANAL_WHATSAPP = 'whatsapp_handoff';

/** Au-delà, on ne commence pas un envoi : la réponse du passage doit partir. */
export const RESERVE_MS = 1_500;

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/** « lundi 28/09 » depuis `2026-09-28`. */
export function jourLisible(dateLocale) {
  const [a, m, j] = String(dateLocale || '').split('-').map(Number);
  if (!a || !m || !j) return String(dateLocale || '');
  const jour = JOURS[new Date(Date.UTC(a, m - 1, j)).getUTCDay()];
  return `${jour} ${String(j).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

/**
 * Le texte qui accompagne l'image dans Telegram.
 *
 * La légende d'une photo est limitée à 1 024 caractères : si le texte de la
 * story ne tient pas, l'image part avec l'en-tête seul et le texte suit dans un
 * second message (`suite`). Jamais de texte tronqué en silence.
 *
 * @returns {{legende: string, suite: string|null}}
 */
export function texteRemise(ligne) {
  const entete = `📲 STORY WHATSAPP — ${jourLisible(ligne?.date_locale)}\n`
    + 'À poster dans le statut WhatsApp de l\'imprimerie : enregistre l\'image, '
    + 'puis WhatsApp → Actus → Mon statut.';
  const texte = String(ligne?.legende || ligne?.publication?.cta || '').trim();
  if (!texte) return { legende: `${entete}\n\n(Aucun texte prévu : l'image suffit.)`, suite: null };
  const complet = `${entete}\n\nTexte à mettre avec :\n${texte}`;
  if (complet.length <= 1024) return { legende: complet, suite: null };
  return { legende: `${entete}\n\nLe texte à mettre avec suit dans le message suivant.`, suite: texte };
}

/**
 * @param {object} p
 * @param {object} p.depot         dépôt autopost (lireArretGlobal, lireRemisesWhatsApp, prendre,
 *                                 relacher, enregistrerPublication, expirer, journaliser)
 * @param {{configure: boolean, envoyerPhoto: Function, envoyer: Function}} p.telegram
 * @param {Date} p.instant
 * @param {() => number} p.restantMs
 * @param {string|null} [p.cleSignature]
 * @returns {Promise<object>} un bilan, sans aucun secret
 */
export async function remettreStoriesWhatsApp({ depot, telegram, instant, restantMs, cleSignature = null }) {
  const bilan = { statut: 'ok', expirees: 0, remises: 0, en_attente: 0, echecs: 0, ecartees: 0, motif: null };
  try {
    const arret = await depot.lireArretGlobal();
    if (!arret?.actif) return { ...bilan, statut: 'arretee', motif: 'arrêt d\'urgence actif' };

    const instantIso = formaterInstantUtc(instant);
    const aujourdhui = dateLocaleDepuisInstantUtc(instantIso);
    const lignes = await depot.lireRemisesWhatsApp();

    for (const ligne of lignes) {
      if (restantMs() < RESERVE_MS) { bilan.motif = 'temps du passage épuisé — suite au passage suivant'; break; }

      /* ── Le jour est passé : jamais remise, et on le dit ─────────────── */
      if (ligne.date_locale && aujourdhui && ligne.date_locale < aujourdhui) {
        const fait = await depot.expirer(ligne.cle_idempotence, {
          code: 'remise_whatsapp_passee',
          message: `Story WhatsApp du ${jourLisible(ligne.date_locale)} jamais remise : son jour est passé `
            + '(le groupe Telegram n\'était pas encore branché, ou aucun passage n\'a eu lieu ce jour-là).',
        });
        if (fait) bilan.expirees += 1;
        continue;
      }

      /* ── Pas encore l'heure : on n'envoie jamais avant le créneau ────── */
      const creneauMs = msDepuisInstantUtc(ligne.instant_utc);
      if (creneauMs === null || creneauMs > instant.getTime()) continue;

      const appro = verifierApprobation({
        publication: ligne.publication, approbation: ligne.approbation, canal: CANAL_WHATSAPP, cleSignature,
      });
      if (!appro.approuve) { bilan.ecartees += 1; continue; }

      if (arret.mode !== 'live') { bilan.en_attente += 1; bilan.motif = 'mode simulation : rien ne part'; continue; }
      // Le verrou PAR PUBLICATION, comme pour Facebook/Instagram : un manifeste
      // resté en "dry_run" est simulé là-bas — sa story ne part pas seule ici.
      // Mesuré le 28/09 : toute la semaine S40 était encore en "dry_run".
      if (ligne.publication?.mode_execution !== 'live') {
        bilan.en_attente += 1;
        bilan.motif = 'manifeste en "dry_run" : publication simulée, story retenue';
        continue;
      }
      if (!telegram?.configure) { bilan.en_attente += 1; bilan.motif = 'Telegram pas encore branché'; continue; }
      if (!ligne.url_media) {
        await depot.relacher(ligne.cle_idempotence, {
          etat: 'failed', tentatives: ligne.tentatives ?? 0,
          erreur: { code: 'image_absente', message: 'aucune image hébergée pour cette story' },
        });
        bilan.echecs += 1;
        continue;
      }

      if (!(await depot.prendre(ligne.cle_idempotence, { instant: instantIso }))) continue;
      const tentatives = (ligne.tentatives ?? 0) + 1;
      const { legende, suite } = texteRemise(ligne);
      const delaiMs = Math.max(250, Math.min(6_000, restantMs() - RESERVE_MS));
      const r = await telegram.envoyerPhoto(ligne.url_media, legende, { delaiMs });

      if (r.statut === 'envoye' || r.statut === 'incertain') {
        if (suite && r.statut === 'envoye' && restantMs() > RESERVE_MS) {
          await telegram.envoyer(suite, { delaiMs: Math.max(250, Math.min(3_000, restantMs() - RESERVE_MS)) });
        }
        await depot.enregistrerPublication(ligne.cle_idempotence, {
          id_distant: r.message_id ? `telegram:${r.message_id}` : 'telegram:incertain',
          tentatives,
          remis_par: 'telegram',
          remis_le_utc: instantIso,
          incertain: r.statut === 'incertain',
        });
        bilan.remises += 1;
        await journaliserSansLever(depot, {
          instant_utc: instantIso, cle_idempotence: ligne.cle_idempotence, publication_id: ligne.publication_id,
          canal: CANAL_WHATSAPP, evenement: 'remise_telegram',
          resume: r.statut === 'envoye'
            ? 'story WhatsApp remise dans le groupe Telegram'
            : `remise incertaine (${r.motif}) — pas renvoyée`,
        });
        continue;
      }

      // Refus ou coupure avant tout échange : on pourra réessayer, trois fois en tout.
      const max = ligne.tentatives_max ?? 3;
      await depot.relacher(ligne.cle_idempotence, {
        etat: tentatives >= max ? 'failed' : 'scheduled',
        tentatives,
        erreur: { code: 'telegram_refuse', message: String(r.motif || r.statut).slice(0, 300) },
      });
      bilan.echecs += 1;
    }
  } catch (err) {
    return { ...bilan, statut: 'panne', motif: String(err?.message || err).slice(0, 300) };
  }
  return bilan;
}

async function journaliserSansLever(depot, entree) {
  try { await depot.journaliser(entree); } catch { /* le journal ne doit pas défaire une remise faite */ }
}

/**
 * Le point d'entrée du passage horaire. NE LÈVE JAMAIS.
 *
 * Le groupe Telegram est celui des alertes : la variable `TELEGRAM_CHAT_ID`
 * si elle est posée, sinon celui que les alertes ont trouvé et gardé sur leur
 * ligne d'état (elles tournent juste avant, dans le même passage).
 */
export async function remettreWhatsAppDuPassage({ depot, instant, debutMs, env = process.env }) {
  try {
    const restantMs = () => DUREE_MAX_FONCTION_MS - (Date.now() - debutMs) - MARGE_REPONSE_MS;
    const { jeton, chatId } = lireConfigurationTelegram(env);
    let telegram = creerClientTelegram({ env });
    if (!telegram.configure && jeton) {
      const groupe = await resoudreGroupeTelegram({
        depot: depotSupabaseAlertes(supabaseAdmin()), jeton, chatVariable: chatId, delaiMs: 1_500,
      });
      if (groupe.chat_id) telegram = creerClientTelegram({ env: { ...env, TELEGRAM_CHAT_ID: groupe.chat_id } });
    }
    return await remettreStoriesWhatsApp({
      depot, telegram, instant, restantMs, cleSignature: cleSignatureApprobation(),
    });
  } catch (err) {
    return { statut: 'panne', motif: String(err?.message || err).slice(0, 300) };
  }
}
