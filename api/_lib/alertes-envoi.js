/**
 * Les alertes, portées dans l'application ET sur Telegram — une seule fois.
 *
 * Appelé à la fin de chaque passage planifié de l'auto-post (`api/autopost.js`,
 * voie `tick`, ~9 h et ~18 h à Moanda), APRÈS les publications. Il n'y a pas de
 * fonction serverless à lui : le plan Hobby plafonne à 12, et les 2 tâches
 * planifiées autorisées sont déjà celles de l'auto-post.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⛔ TROIS PROMESSES, ET CE QUI LES TIENT
 * ════════════════════════════════════════════════════════════════════════════
 *
 * 1. **Ne jamais empêcher de publier.** `verifierAlertesDuPassage()` ne lève
 *    JAMAIS, tourne APRÈS la publication, et se donne un budget qu'il retranche
 *    de ce qui reste de la minute de la fonction. S'il ne reste pas assez de
 *    temps, il ne fait rien et le dit (`reportee`) : le passage suivant, neuf
 *    heures plus tard, reprendra — les alertes sont calculées sur la donnée,
 *    pas sur un souvenir.
 *
 * 2. **Jamais deux fois la même alerte.** L'idempotence se fonde sur le TÉMOIN
 *    ÉCRIT de l'effet, jamais sur un statut en mémoire :
 *      - la trace de l'alerte (collection `alertes`) a un identifiant de ligne
 *        DÉRIVÉ de l'identifiant d'alerte (UUID v5) : deux passages qui la
 *        créent en même temps se heurtent à la clé primaire, un seul gagne ;
 *      - la notification de la cloche (`notifications_app`) a, elle aussi, un
 *        identifiant dérivé : elle ne peut exister qu'une fois ;
 *      - l'envoi Telegram est d'abord RÉSERVÉ sur la trace (`en_cours`), par une
 *        écriture conditionnée à la version lue (`updated_at`) : si un autre
 *        passage a touché la trace entre-temps, on n'envoie pas. Puis l'issue
 *        est écrite : `envoye` est le témoin, et un témoin `envoye` n'est
 *        jamais renvoyé.
 *
 * 3. **Le jeton ne fuit pas.** Tout motif qui sort d'ici passe par
 *    `masquerJeton()`. Le bilan rendu au gestionnaire (et donc à la réponse
 *    HTTP du passage) ne porte que des statuts et des identifiants d'alerte.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CE QUI EST ÉCRIT, ET OÙ
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   `app_data`, collection `alertes`, deux sortes de lignes :
 *     - `type_ligne: 'alerte'` — une par alerte : quand elle a été vue, si la
 *       cloche a été prévenue, où en est Telegram, quand elle s'est résolue ;
 *     - `type_ligne: 'etat'`   — UNE ligne : le dernier passage, et si Telegram
 *       est configuré. C'est elle que le tableau de bord lit pour dire
 *       « Telegram non configuré » et « la vérification n'a pas tourné depuis… ».
 *   `app_data`, collection `notifications_app` — la notification de la cloche,
 *     destinataire `all_staff`, au format que lit `getNotifications()`.
 *
 * Aucune migration : `app_data` accepte n'importe quelle collection.
 */
import { createHash } from 'node:crypto';
import { evaluerAlertes, identifierAlertes, texteTelegram } from './alertes.js';
import { creerClientTelegram, lireConfigurationTelegram, masquerJeton } from './telegram.js';
import { DUREE_MAX_FONCTION_MS } from './autopost-alimentation.js';
import { supabaseAdmin } from './supabase-admin.js';
import { ligneAppData } from '../../src/services/ligne-app-data.js';

export const COLLECTION_ALERTES = 'alertes';

/** Budget maximal des alertes dans un passage : « quelques secondes ». */
export const BUDGET_ALERTES_MS = 5_000;

/** Ce qu'on laisse à la fonction pour rendre sa réponse après les alertes. */
export const MARGE_REPONSE_MS = 2_000;

/** En dessous, on ne commence pas : on ne ferait que des lectures perdues. */
export const BUDGET_MINIMAL_MS = 1_500;

/** Un envoi Telegram refusé est retenté au plus ce nombre de fois au total. */
export const TENTATIVES_TELEGRAM_MAX = 3;

/** Statuts Telegram qui interdisent tout nouvel envoi. */
const STATUTS_TELEGRAM_CLOS = new Set(['envoye', 'incertain', 'en_cours', 'abandonne']);

/* ── Identifiants de ligne dérivés (UUID v5, RFC 4122) ─────────────────────── */

/** Espace de noms propre aux alertes OGOOUÉ. Fixe : le changer recréerait tout. */
const ESPACE_UUID = 'b3a1c7e2-5d4f-4a8b-9c6e-0f1e2d3c4b5a';

export function uuidDerive(nom) {
  const ns = Buffer.from(ESPACE_UUID.replace(/-/g, ''), 'hex');
  const h = createHash('sha1').update(ns).update(String(nom), 'utf8').digest();
  h[6] = (h[6] & 0x0f) | 0x50; // version 5
  h[8] = (h[8] & 0x3f) | 0x80; // variante RFC 4122
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

export const idLigneTrace = (alerteId) => uuidDerive(`alerte:${alerteId}`);
export const idLigneNotification = (alerteId) => uuidDerive(`notification:${alerteId}`);
export const ID_LIGNE_ETAT = uuidDerive('alertes:etat');

/* ── Le dépôt Supabase ─────────────────────────────────────────────────────── */

/**
 * Le dépôt réel. Les tests en fournissent une doublure en mémoire qui respecte
 * le même contrat — clé primaire unique, écriture conditionnée à la version.
 */
export function depotSupabaseAlertes(supabase) {
  const table = () => supabase.from('app_data');
  return {
    async lireRapports() {
      // Projection : `lignes` et `historique` pèsent, on ne veut que la date
      // et la caisse. Les plus récents d'abord : c'est le dernier qui compte.
      const { data, error } = await table()
        .select('date:data->>date, activite:data->>activite')
        .eq('collection', 'rapports')
        .order('data->>date', { ascending: false })
        .limit(1000);
      if (error) throw new Error(`lecture des rapports : ${error.message}`);
      return data || [];
    },
    async lireProduits() {
      const { data, error } = await table().select('data').eq('collection', 'produits').limit(1000);
      if (error) throw new Error(`lecture des produits : ${error.message}`);
      return (data || []).map((r) => r.data);
    },
    async lireTraces() {
      const { data, error } = await table()
        .select('id, updated_at, data')
        .eq('collection', COLLECTION_ALERTES)
        .order('created_at', { ascending: false })
        .limit(1000);
      if (error) throw new Error(`lecture des alertes : ${error.message}`);
      return (data || []).map((r) => ({ row_id: r.id, version: r.updated_at, data: r.data || {} }));
    },
    /** Insère, ou dit que la ligne existe déjà (clé primaire). */
    async inserer(collection, id, data, instantIso) {
      // `ligneAppData()` : la colonne `id` et `data.id` portent la MÊME valeur
      // (sinon « marquer comme lu » ne retrouve pas la notification).
      const { data: lignes, error } = await supabase.from('app_data')
        .insert(ligneAppData({ id, collection, data, created_at: instantIso, updated_at: instantIso }))
        .select('updated_at');
      if (error) {
        if (error.code === '23505') return { cree: false, version: null };
        throw new Error(`écriture ${collection} : ${error.message}`);
      }
      return { cree: true, version: lignes?.[0]?.updated_at ?? null };
    },
    /** Remplace la trace SEULEMENT si personne ne l'a touchée depuis la lecture. */
    async remplacerSiVersion(id, data, version) {
      if (!version) return { ok: false, version: null };
      const { data: lignes, error } = await table()
        .update({ data })
        .eq('id', id)
        .eq('collection', COLLECTION_ALERTES)
        .eq('updated_at', version)
        .select('updated_at');
      if (error) throw new Error(`réservation de l'envoi : ${error.message}`);
      return lignes?.length === 1 ? { ok: true, version: lignes[0].updated_at } : { ok: false, version: null };
    },
    async remplacer(id, data) {
      const { error } = await table().update({ data }).eq('id', id).eq('collection', COLLECTION_ALERTES);
      if (error) throw new Error(`mise à jour de l'alerte : ${error.message}`);
    },
    async ecrireEtat(id, data, instantIso) {
      const { error } = await supabase.from('app_data')
        .upsert(ligneAppData({ id, collection: COLLECTION_ALERTES, data, updated_at: instantIso }));
      if (error) throw new Error(`écriture de l'état des alertes : ${error.message}`);
    },
  };
}

/* ── Les lignes écrites ────────────────────────────────────────────────────── */

function traceInitiale(alerte, rowId, instantIso) {
  const { id, cle_episode: cle, famille, activite, gravite, titre, message, lien, ...details } = alerte;
  return {
    id: rowId,
    type_ligne: 'alerte',
    alerte_id: id,
    cle_episode: cle,
    famille,
    activite,
    gravite,
    titre,
    message,
    lien,
    details,
    detectee_le: instantIso,
    resolue_le: null,
    notification: { statut: 'a_ecrire', ecrite_le: null },
    telegram: { statut: 'a_envoyer', tentatives: 0, dernier_essai_le: null, envoye_le: null, motif: null },
    created_at: instantIso,
  };
}

function notificationDe(alerte, rowId, instantIso) {
  return {
    id: rowId,
    type: `alerte_${alerte.famille}`,
    message: `${alerte.gravite === 'haute' ? '🔴' : '🟠'} ${alerte.message}`,
    // `all_staff` : qui est devant l'écran peut agir (saisir un rapport,
    // réapprovisionner). Aucun `destinataire_id` : c'est une diffusion, voir
    // le cloisonnement de `getNotifications()`.
    destinataire: 'all_staff',
    lu: false,
    lien: alerte.lien,
    icon: alerte.gravite === 'haute' ? '🔴' : '🟠',
    meta: { type: 'alerte', alerte_id: alerte.id },
    created_at: instantIso,
    updated_at: instantIso,
  };
}

/* ── Le passage ────────────────────────────────────────────────────────────── */

/**
 * Évalue les règles et porte chaque alerte active dans l'application et sur
 * Telegram. LÈVE si la base est illisible : c'est `verifierAlertesDuPassage()`
 * qui enveloppe.
 *
 * @param {object} p
 * @param {object} p.depot
 * @param {{configure: boolean, envoyer: Function}} p.telegram
 * @param {Date} p.instant
 * @param {() => number} [p.restantMs] temps encore disponible (pour borner Telegram)
 */
export async function verifierAlertes({ depot, telegram, instant, restantMs = () => BUDGET_ALERTES_MS, jeton = '' }) {
  const instantIso = instant.toISOString();
  const [rapports, produits, traces] = await Promise.all([
    depot.lireRapports(), depot.lireProduits(), depot.lireTraces(),
  ]);

  const tracesAlerte = traces.filter((t) => t.data?.type_ligne === 'alerte');
  const { date_du_jour: dateDuJour, alertes: brutes, caisses, seuils } = evaluerAlertes({ rapports, produits, instant });
  const alertes = identifierAlertes(brutes, tracesAlerte.map((t) => t.data), dateDuJour);

  const parAlerteId = new Map(tracesAlerte.map((t) => [t.data.alerte_id, t]));
  const bilan = {
    date_du_jour: dateDuJour,
    actives: alertes.map((a) => ({ id: a.id, famille: a.famille, titre: a.titre })),
    nouvelles: 0,
    notifications_ecrites: 0,
    telegram: { configure: telegram.configure, envoyees: 0, echecs: 0, incertaines: 0 },
    resolues: 0,
    concurrence: 0,
  };

  for (const alerte of alertes) {
    const rowId = idLigneTrace(alerte.id);
    let trace = parAlerteId.get(alerte.id);

    if (!trace) {
      const data = traceInitiale(alerte, rowId, instantIso);
      const { cree, version } = await depot.inserer(COLLECTION_ALERTES, rowId, data, instantIso);
      if (!cree) {
        // Un autre passage vient de la créer : c'est lui qui la porte.
        bilan.concurrence += 1;
        continue;
      }
      bilan.nouvelles += 1;
      trace = { row_id: rowId, version, data };
    }

    let data = { ...trace.data };
    let change = false;

    // Une alerte résolue qui revient le même jour : même épisode, rouvert.
    if (data.resolue_le) { data = { ...data, resolue_le: null, rouverte_le: instantIso }; change = true; }

    // ── La cloche. Le témoin est la ligne elle-même (identifiant dérivé). ──
    if (data.notification?.statut !== 'ecrite') {
      await depot.inserer('notifications_app', idLigneNotification(alerte.id), notificationDe(alerte, idLigneNotification(alerte.id), instantIso), instantIso);
      data = { ...data, notification: { statut: 'ecrite', ecrite_le: instantIso } };
      bilan.notifications_ecrites += 1;
      change = true;
    }

    // ── Telegram. ──
    const tg = data.telegram || { statut: 'a_envoyer', tentatives: 0 };
    if (STATUTS_TELEGRAM_CLOS.has(tg.statut)) {
      if (change) await depot.remplacer(trace.row_id, data);
      continue;
    }
    if (!telegram.configure) {
      if (tg.statut !== 'non_configure') {
        data = { ...data, telegram: { ...tg, statut: 'non_configure', motif: 'Telegram non configuré' } };
        change = true;
      }
      if (change) await depot.remplacer(trace.row_id, data);
      continue;
    }
    if ((tg.tentatives || 0) >= TENTATIVES_TELEGRAM_MAX) {
      data = { ...data, telegram: { ...tg, statut: 'abandonne' } };
      await depot.remplacer(trace.row_id, data);
      continue;
    }

    // Réserver l'envoi : écriture conditionnée à la version LUE.
    const reserve = {
      ...data,
      telegram: { ...tg, statut: 'en_cours', tentatives: (tg.tentatives || 0) + 1, dernier_essai_le: instantIso },
    };
    const { ok } = await depot.remplacerSiVersion(trace.row_id, reserve, trace.version);
    if (!ok) {
      bilan.concurrence += 1;
      continue;
    }

    const delaiMs = Math.max(250, Math.min(4_000, restantMs() - 750));
    const issue = await telegram.envoyer(texteTelegram(alerte), { delaiMs });
    const final = {
      ...reserve,
      telegram: {
        ...reserve.telegram,
        statut: issue.statut,
        envoye_le: issue.statut === 'envoye' ? instantIso : reserve.telegram.envoye_le ?? null,
        motif: issue.motif ? masquerJeton(issue.motif, jeton) : null,
      },
    };
    await depot.remplacer(trace.row_id, final);
    if (issue.statut === 'envoye') bilan.telegram.envoyees += 1;
    else if (issue.statut === 'incertain') bilan.telegram.incertaines += 1;
    else bilan.telegram.echecs += 1;
  }

  // ── Résolution : ce qui n'est plus actif se ferme (témoin : `resolue_le`). ──
  const idsActifs = new Set(alertes.map((a) => a.id));
  for (const t of tracesAlerte) {
    if (t.data.resolue_le || idsActifs.has(t.data.alerte_id)) continue;
    await depot.remplacer(t.row_id, { ...t.data, resolue_le: instantIso });
    bilan.resolues += 1;
  }

  bilan.caisses = caisses;
  bilan.seuils = seuils;
  return bilan;
}

function avecDelai(promesse, ms) {
  let minuterie;
  const delai = new Promise((resoudre) => {
    minuterie = setTimeout(() => resoudre({ __delai_depasse: true }), ms);
  });
  return Promise.race([promesse, delai]).finally(() => clearTimeout(minuterie));
}

/**
 * Le point d'entrée du passage. NE LÈVE JAMAIS.
 *
 * @param {object} p
 * @param {Date} p.instant         l'instant du passage (le même que la publication)
 * @param {number} p.debutMs        `Date.now()` au début du passage
 * @param {() => number} [p.horloge] `Date.now` (tests : horloge simulée)
 * @param {object} [p.depot]        dépôt (tests : doublure). Défaut : Supabase.
 * @param {object} [p.telegram]     client Telegram (tests : doublure). Défaut : variables Vercel.
 * @param {object} [p.env]
 * @returns {Promise<object>} un bilan sans aucun secret
 */
export async function verifierAlertesDuPassage({
  instant, debutMs, horloge = () => Date.now(), depot = null, telegram = null, env = process.env,
} = {}) {
  const t0 = horloge();
  const { jeton } = lireConfigurationTelegram(env);
  const restantFonction = () => DUREE_MAX_FONCTION_MS - (horloge() - (debutMs ?? t0)) - MARGE_REPONSE_MS;
  const budget = Math.min(BUDGET_ALERTES_MS, restantFonction());
  const client = telegram || creerClientTelegram({ env });

  if (budget < BUDGET_MINIMAL_MS) {
    return {
      statut: 'reportee',
      motif: `la minute du passage est consommée par la publication (${Math.max(0, Math.round(budget))} ms restantes) — reprise au passage suivant`,
      telegram: { configure: client.configure },
      duree_ms: 0,
    };
  }

  let d = depot;
  try {
    if (!d) d = depotSupabaseAlertes(supabaseAdmin());
  } catch (err) {
    return { statut: 'panne', motif: masquerJeton(err?.message || err, jeton), telegram: { configure: client.configure }, duree_ms: horloge() - t0 };
  }

  const fin = t0 + budget;
  let bilan;
  try {
    const resultat = await avecDelai(
      verifierAlertes({ depot: d, telegram: client, instant, restantMs: () => fin - horloge(), jeton }),
      budget,
    );
    bilan = resultat?.__delai_depasse
      ? { statut: 'delai_depasse', motif: `alertes interrompues après ${budget} ms — reprise au passage suivant` }
      : { statut: 'ok', ...resultat };
  } catch (err) {
    bilan = { statut: 'panne', motif: masquerJeton(err?.message || err, jeton) };
  }
  bilan.telegram = { ...(bilan.telegram || {}), configure: client.configure };
  bilan.duree_ms = horloge() - t0;

  // Le témoin du guetteur lui-même : sans lui, une vérification qui ne tourne
  // plus ressemblerait à « aucune alerte ». Best effort, dans le budget restant.
  if (fin - horloge() > 200) {
    try {
      await avecDelai(d.ecrireEtat(ID_LIGNE_ETAT, {
        id: ID_LIGNE_ETAT,
        type_ligne: 'etat',
        dernier_passage_le: instant.toISOString(),
        statut: bilan.statut,
        motif: bilan.motif || null,
        telegram_configure: client.configure,
        actives: Array.isArray(bilan.actives) ? bilan.actives.length : null,
        duree_ms: bilan.duree_ms,
      }, instant.toISOString()), Math.max(200, fin - horloge()));
    } catch (err) {
      bilan.etat_non_ecrit = masquerJeton(err?.message || err, jeton);
    }
  }
  return bilan;
}
