/**
 * Auto-poster — LE NOYAU : « qu'est-ce qui est à publier, maintenant ? »
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CE FICHIER EST PUR. C'EST SA SEULE QUALITÉ IMPORTANTE.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Aucun réseau, aucune base, aucun `Date.now()`, aucun `process.env`. On lui
 * donne une file et un instant, il rend une décision. Tout ce qui peut mal
 * tourner dans une chaîne de publication — un créneau raté, un brouillon parti,
 * un doublon — se décide ICI, et se teste donc sans allumer quoi que ce soit.
 *
 * Le reste du poster (appel Meta, écriture en base, cron) est de la plomberie
 * autour de cette fonction.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LES DEUX RÈGLES QUI NE SE NÉGOCIENT PAS
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ── 1. RIEN NE PART SANS APPROBATION ────────────────────────────────────────
 * ChatGPT écrit `publication.json` ; il n'a PAS le droit d'écrire
 * `APPROBATION.json`. Un contenu non approuvé ne part pas, même si l'heure est
 * passée, même s'il est parfait, même si la file est vide par ailleurs. Une
 * approbation absente n'est pas une approbation implicite : c'est un refus.
 *
 * ── 2. L'IDEMPOTENCE PORTE SUR LE TÉMOIN DE L'EFFET ─────────────────────────
 * C'est la leçon de l'encaissement SingPay (`tasks/lessons.md`, 16/09) : deux
 * chemins ont écrit deux fois parce que l'idempotence portait sur un état
 * intermédiaire qu'un autre chemin pouvait poser.
 *
 * Ici, ce qui PROUVE qu'une publication est partie, c'est **l'identifiant rendu
 * par Meta** (`id_distant`), enregistré. Pas un drapeau « en cours », pas un
 * état `executing`, pas une date de tentative. Le contrôle ligne 1 de la
 * sélection est donc : `id_distant` présent → on ne republie jamais, quel que
 * soit l'état affiché à côté.
 *
 * L'état `executing`, lui, sert à autre chose : empêcher DEUX exécutions
 * simultanées de partir ensemble. Et cela ne se règle pas ici mais dans la base,
 * par un compare-and-swap sur une clé UNIQUE (voir `autopost-executeur.js` et
 * `migrations/008_autopost_file_publication.sql`).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LA PRÉCISION HORAIRE — CE QU'ON PEUT PROMETTRE, ET CE QU'ON NE PEUT PAS
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Une tâche planifiée Vercel en plan Hobby se déclenche **une fois par jour, à
 * l'heure près** : un `cron` réglé sur `16 * * *` part n'importe quand entre
 * 16 h 00 et 16 h 59 UTC. On ne peut donc PAS tenir 17 h 30 à la minute.
 *
 * La conception retenue en tient compte au lieu de la contourner : **une tâche
 * qui passe souvent et publie ce qui est dû**, pas une tâche par créneau. Le
 * projet déclare donc une tâche par heure (`vercel.json`), et cette fonction
 * publie tout ce qui est échu et encore dans sa tolérance.
 *
 * Ce que cela donne, calculé et non promis :
 *
 *   | Créneau local | Instant UTC | Retard garanti au pire | Retard typique |
 *   |---------------|-------------|------------------------|----------------|
 *   | 09 h 00       | 08:00Z      | **59 min**             | ~30 min        |
 *   | 17 h 30       | 16:30Z      | **89 min**             | ~30 min        |
 *
 * ⚠️ CONSÉQUENCE DIRECTE SUR LE CONTRAT : la tolérance par défaut de
 * `publication.json` est de **30 minutes**. Avec des passages horaires, une
 * publication de 17 h 30 sur deux tomberait donc en `perime` — jetée, sans que
 * personne ne l'ait décidé. `toleranceRecommandeeMinutes()` calcule le minimum
 * réel, et la sélection SIGNALE les publications dont la tolérance est trop
 * courte **avant** que leur créneau ne passe, au lieu de les perdre en silence.
 *
 * 📙 Le passage au plan Vercel Pro (≈ 20 $/mois) ramènerait la précision à la
 * minute. C'est une décision de Gassim, pas une correction de code.
 */
import { instantUtcDepuisCreneau, msDepuisInstantUtc } from '../../src/lib/dates.js';
import { validerManifeste, verifierApprobation, CANAUX_PUBLIANTS } from './autopost-contrat.js';

/**
 * Pourquoi un travail n'est pas parti. Ces chaînes sont écrites telles quelles
 * dans le journal et affichées au gérant : elles sont de la documentation, pas
 * des codes internes.
 */
export const RAISONS = Object.freeze({
  ARRET_GLOBAL: 'arret_global',
  CANAL_SANS_PUBLICATION: 'canal_sans_publication',
  DEJA_PUBLIE: 'deja_publie',
  ETAT_NON_ELIGIBLE: 'etat_non_eligible',
  TENTATIVES_EPUISEES: 'tentatives_epuisees',
  MANIFESTE_INVALIDE: 'manifeste_invalide',
  CRENEAU_INCOHERENT: 'creneau_incoherent',
  CRENEAU_FUTUR: 'creneau_futur',
  HORS_TOLERANCE: 'hors_tolerance',
  OFFRE_PERIMEE: 'offre_perimee',
  NON_APPROUVE: 'non_approuve',
  COMPTE_CIBLE_ABSENT: 'compte_cible_absent',
  PLAFOND_JOURNALIER: 'plafond_journalier',
});

/** Seul état depuis lequel un travail peut partir. */
export const ETATS_ELIGIBLES = Object.freeze(['scheduled']);

/**
 * Cadence des passages : une tâche planifiée par heure (`vercel.json`).
 * `JITTER_MINUTES` est l'imprécision documentée du plan Hobby.
 */
export const CADENCE_MINUTES = 60;
export const JITTER_MINUTES = 59;

/**
 * Retard maximal GARANTI pour un créneau, compte tenu de la cadence et de
 * l'imprécision. C'est un plafond démontré, pas une estimation.
 *
 * Un créneau à la minute `m` de l'heure est certainement vu :
 *   - si m = 0 : par la tâche de la même heure, qui part entre H:00 et H:59 ;
 *   - sinon    : par la tâche de l'heure suivante, au plus tard à H+1:59.
 *
 * @param {string} instantUtc
 * @param {number} [cadence]
 * @param {number} [jitter]
 * @returns {number} minutes
 */
export function retardMaxGarantiMinutes(instantUtc, cadence = CADENCE_MINUTES, jitter = JITTER_MINUTES) {
  const ms = msDepuisInstantUtc(instantUtc);
  if (ms === null) return cadence + jitter;
  const minute = new Date(ms).getUTCMinutes();
  return minute === 0 ? jitter : (cadence - minute) + jitter;
}

/**
 * Tolérance minimale pour qu'un créneau ne soit JAMAIS perdu à cause de la
 * cadence. En dessous, la publication est jouée à pile ou face.
 * @param {string} instantUtc
 * @returns {number} minutes
 */
export function toleranceRecommandeeMinutes(instantUtc) {
  return retardMaxGarantiMinutes(instantUtc);
}

/** Tolérance effective d'une ligne de file (défaut du contrat : 30 min). */
function tolerance(travail) {
  const t = travail?.tolerance_minutes ?? travail?.publication?.creneau?.tolerance_minutes;
  return typeof t === 'number' && t >= 0 ? t : 30;
}

function ecart(travail, raison, detail = null) {
  return {
    cle_idempotence: travail?.cle_idempotence ?? null,
    publication_id: travail?.publication_id ?? travail?.publication?.publication_id ?? null,
    canal: travail?.canal ?? null,
    instant_utc: travail?.instant_utc ?? null,
    raison,
    detail,
  };
}

/**
 * ⛔ LE CŒUR. Décide, pour un instant donné, ce qui part et ce qui ne part pas.
 *
 * @param {object} arg
 * @param {Array<object>} arg.file  lignes de la file : une par (publication, canal)
 * @param {string} arg.instant  instant UTC de l'évaluation (`…Z`)
 * @param {object} [arg.options]
 * @param {boolean} [arg.options.arretGlobal]  interrupteur lu en base à chaque passage
 * @param {number} [arg.options.plafondJournalier]  garde-fou : max de publications par jour
 * @param {number} [arg.options.dejaPubliesAujourdhui]
 * @param {string|null} [arg.options.cleSignature]  secret HMAC des approbations
 * @returns {{aPublier: object[], ecartes: object[], alertes: object[]}}
 */
export function travauxDus({ file = [], instant, options = {} }) {
  const maintenantMs = msDepuisInstantUtc(instant);
  const aPublier = [];
  const ecartes = [];
  const alertes = [];

  if (maintenantMs === null) {
    // Un instant illisible ne doit pas se traduire par « rien n'est dû » — ce
    // serait une panne silencieuse. On écarte tout, en le disant.
    return {
      aPublier: [],
      ecartes: file.map((t) => ecart(t, RAISONS.CRENEAU_INCOHERENT, `instant d'évaluation illisible : ${instant}`)),
      alertes: [],
    };
  }

  if (options.arretGlobal === true) {
    // Couche 1 du kill-switch : une ligne en base, lue à chaque passage. Pas
    // une variable d'environnement — celle-là exigerait un redéploiement, et un
    // arrêt d'urgence qui exige un déploiement n'est pas un arrêt d'urgence.
    return { aPublier: [], ecartes: file.map((t) => ecart(t, RAISONS.ARRET_GLOBAL)), alertes: [] };
  }

  // Les plus anciens d'abord : si le plafond journalier mord, il doit mordre
  // sur les plus récents, pas au hasard de l'ordre de lecture en base.
  const ordonnee = [...file].sort((a, b) => String(a?.instant_utc).localeCompare(String(b?.instant_utc)));

  const plafond = typeof options.plafondJournalier === 'number' ? options.plafondJournalier : Infinity;
  let budget = plafond - (options.dejaPubliesAujourdhui || 0);

  for (const t of ordonnee) {
    /* ── 1. LE TÉMOIN DE L'EFFET. Avant tout le reste. ─────────────────────
       Un identifiant rendu par Meta et enregistré est la preuve que le post est
       parti. Aucun état, aucun compteur, aucune date ne peut contredire ça. */
    if (t?.id_distant) {
      ecartes.push(ecart(t, RAISONS.DEJA_PUBLIE, `id_distant=${t.id_distant}`));
      continue;
    }

    /* ── 2. Canal qui ne publie pas ────────────────────────────────────── */
    if (!CANAUX_PUBLIANTS.includes(t?.canal)) {
      ecartes.push(ecart(t, RAISONS.CANAL_SANS_PUBLICATION,
        `${t?.canal} est une remise à un humain, aucune API n'est appelée`));
      continue;
    }

    /* ── 3. État et reprises bornées ───────────────────────────────────── */
    if (!ETATS_ELIGIBLES.includes(t?.etat)) {
      ecartes.push(ecart(t, RAISONS.ETAT_NON_ELIGIBLE, `etat=${t?.etat}`));
      continue;
    }
    const max = typeof t?.tentatives_max === 'number' ? t.tentatives_max : 3;
    if ((t?.tentatives || 0) >= max) {
      ecartes.push(ecart(t, RAISONS.TENTATIVES_EPUISEES, `${t.tentatives}/${max}`));
      continue;
    }

    /* ── 4. Le manifeste tient-il debout ? ─────────────────────────────── */
    const controle = validerManifeste(t?.publication);
    if (!controle.valide) {
      ecartes.push(ecart(t, RAISONS.MANIFESTE_INVALIDE, controle.erreurs.join(' · ')));
      continue;
    }

    /* ── 5. Le créneau : redondance recalculée, puis comparée à la ligne ─
       La ligne de file et le manifeste doivent dire la même heure. S'ils
       divergent, on ne choisit pas « le plus probable » : on refuse.        */
    const recalcule = instantUtcDepuisCreneau(t.publication.creneau);
    const declareLigne = String(t?.instant_utc || '').replace(/\.\d+Z$/, 'Z');
    if (recalcule !== declareLigne) {
      ecartes.push(ecart(t, RAISONS.CRENEAU_INCOHERENT,
        `file=${declareLigne} manifeste=${recalcule}`));
      continue;
    }
    const creneauMs = msDepuisInstantUtc(recalcule);

    /* ── 6. Trop tôt : on ne publie JAMAIS en avance ───────────────────── */
    if (maintenantMs < creneauMs) {
      ecartes.push(ecart(t, RAISONS.CRENEAU_FUTUR, `dans ${Math.round((creneauMs - maintenantMs) / 60000)} min`));
      // Signalé AVANT que le créneau ne passe : une tolérance trop courte pour
      // la cadence est un piège connu, pas une fatalité à découvrir après coup.
      const requise = toleranceRecommandeeMinutes(recalcule);
      if (tolerance(t) < requise) {
        alertes.push({
          publication_id: t.publication_id ?? t.publication.publication_id,
          canal: t.canal,
          instant_utc: recalcule,
          alerte: 'tolerance_insuffisante',
          detail: `tolerance_minutes=${tolerance(t)} alors que la cadence horaire `
            + `garantit au pire ${requise} min de retard. Porter la tolérance à ${requise} `
            + 'ou passer au plan Vercel Pro.',
        });
      }
      continue;
    }

    /* ── 7. Trop tard : périmé, pas rattrapé ───────────────────────────── */
    const retardMin = Math.round((maintenantMs - creneauMs) / 60000);
    if (retardMin > tolerance(t)) {
      const requise = toleranceRecommandeeMinutes(recalcule);
      ecartes.push(ecart(t, RAISONS.HORS_TOLERANCE,
        `retard ${retardMin} min > tolérance ${tolerance(t)} min`
        + (tolerance(t) < requise
          ? ` — ⚠️ cette tolérance est plus courte que les ${requise} min que la cadence horaire peut coûter`
          : '')));
      continue;
    }

    /* ── 8. Offre périmée — comparaison EN DATE LOCALE, jamais en UTC ──── */
    const dateCreneauLocale = t.publication.creneau.date_locale;
    const offrePerimee = (t.publication.offres || []).find((o) => {
      if (!o?.valide_jusqu_au_local) return false;
      return o.valide_jusqu_au_local < dateCreneauLocale;
    });
    if (offrePerimee) {
      ecartes.push(ecart(t, RAISONS.OFFRE_PERIMEE,
        `offre valide jusqu'au ${offrePerimee.valide_jusqu_au_local}, créneau du ${dateCreneauLocale}`));
      continue;
    }

    /* ── 9. L'APPROBATION. Aucune exception. ───────────────────────────── */
    const appro = verifierApprobation({
      publication: t.publication,
      approbation: t.approbation,
      canal: t.canal,
      cleSignature: options.cleSignature || null,
    });
    if (!appro.approuve) {
      ecartes.push(ecart(t, RAISONS.NON_APPROUVE, appro.raison));
      continue;
    }

    /* ── 10. Le compte cible doit être NUMÉRIQUE et présent ─────────────
       TopShop GABON partage le même environnement Meta que l'imprimerie. Une
       erreur de cible ne publie pas « au mauvais endroit » : elle publie une
       affiche d'imprimerie sur la page d'une autre entreprise. Sans compte
       cible explicite, on ne part pas. */
    if (!t.compte_cible_id) {
      ecartes.push(ecart(t, RAISONS.COMPTE_CIBLE_ABSENT,
        'aucun Page ID / IG Business Account ID sur la ligne'));
      continue;
    }

    /* ── 11. Plafond journalier — couche 2 du kill-switch ──────────────── */
    if (budget <= 0) {
      ecartes.push(ecart(t, RAISONS.PLAFOND_JOURNALIER, `plafond ${plafond}/jour atteint`));
      continue;
    }
    budget -= 1;

    aPublier.push(t);
  }

  return { aPublier, ecartes, alertes };
}

/**
 * Résumé lisible d'un passage, pour le journal et pour l'écran.
 * @param {{aPublier: object[], ecartes: object[], alertes: object[]}} decision
 * @returns {string}
 */
export function resumerDecision(decision) {
  const parRaison = {};
  for (const e of decision.ecartes) parRaison[e.raison] = (parRaison[e.raison] || 0) + 1;
  const detail = Object.entries(parRaison).map(([r, n]) => `${r}=${n}`).join(' ');
  return `à publier=${decision.aPublier.length} écartés=${decision.ecartes.length}`
    + (detail ? ` (${detail})` : '')
    + (decision.alertes.length ? ` alertes=${decision.alertes.length}` : '');
}
