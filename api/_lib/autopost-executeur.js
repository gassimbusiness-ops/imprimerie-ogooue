/**
 * Auto-poster — l'exécuteur : ce qui se passe à chaque passage de la tâche.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * L'ORDRE DES GESTES, ET POURQUOI IL EST CELUI-LÀ
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   0. ARRÊT GLOBAL  — lu EN BASE, à chaque passage. Une variable
 *      d'environnement n'aurait d'effet qu'après redéploiement : un arrêt
 *      d'urgence qui exige un déploiement n'est pas un arrêt d'urgence.
 *   1. RÉCONCILIATION — d'abord les lignes dont on ne sait pas si elles sont
 *      parties. Chercher AVANT de créer, jamais l'inverse.
 *   2. SÉLECTION     — `travauxDus()`, fonction pure, testée à part.
 *   3. PRISE         — compare-and-swap en base : `scheduled → executing`.
 *      0 ligne modifiée = quelqu'un d'autre l'a prise. On passe au suivant,
 *      sans rien publier. C'est ce qui rend deux exécutions concurrentes sûres.
 *   4. TRACE AVANT   — la prise écrit la tentative et son instant AVANT le
 *      premier appel réseau. Un processus qui meurt au milieu laisse une trace,
 *      pas un trou.
 *   5. APPEL         — Facebook en un temps, Instagram en deux.
 *   6. RÉSULTAT      — succès : `id_distant` écrit, c'est LE TÉMOIN ;
 *      échec net : retour en file, tentative comptée ;
 *      incertain : `reconciling`, et AUCUNE nouvelle création.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * L'IDEMPOTENCE, EN UNE PHRASE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Ce qui prouve qu'une publication est partie, c'est l'identifiant rendu par
 * Meta, enregistré — pas un drapeau « en cours ». L'état `executing` empêche
 * deux départs simultanés ; c'est `id_distant` qui empêche un second départ
 * plus tard. Les deux servent, ils ne servent pas à la même chose.
 *
 * (Leçon de l'encaissement SingPay du 16/09 : l'idempotence portait sur un état
 * intermédiaire qu'un second chemin pouvait poser, et deux chemins ont écrit
 * deux fois. `migrations/005` a posé l'index unique qui manquait ; la migration
 * 008 fait la même chose pour la file de publication, dès le premier jour.)
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LE CONTRAT DU DÉPÔT (le port, injecté — jamais Supabase en dur ici)
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   lireArretGlobal()                 → { actif: boolean, mode: 'dry_run'|'live', plafond: number }
 *   lireFile({ limite })              → ligne[]   (les lignes 'scheduled')
 *   lireAReconcilier()                → ligne[]   (les lignes 'reconciling')
 *   compterPubliesLe(dateLocale)      → number
 *   prendre(cle, { instant })         → boolean   ← compare-and-swap ATOMIQUE
 *   relacher(cle, { etat, tentatives, erreur })
 *   noterConteneur(cle, idConteneur)
 *   enregistrerPublication(cle, resultat)
 *   journaliser(entree)
 *
 * Chaque implémentation réelle doit garantir que `prendre()` est atomique. La
 * version Supabase le fait par un UPDATE conditionnel qui renvoie les lignes
 * modifiées (`autopost-depot.js`).
 */
import { travauxDus, resumerDecision, RAISONS } from './autopost-selection.js';
import { formaterInstantUtc, formaterInstantLocal, msDepuisInstantUtc, dateLocaleDepuisInstantUtc } from '../../src/lib/dates.js';

/** Modes d'exécution. `dry_run` est le défaut, partout, toujours. */
export const MODE_SIMULATION = 'dry_run';
export const MODE_REEL = 'live';

/**
 * Mode demandé par l'environnement. Absent → simulation.
 *
 * ⚠️ Cette variable ne suffit pas à publier, et c'est volontaire : elle ne peut
 * que RESTREINDRE, jamais autoriser à elle seule. Voir `modeGlobalEffectif()`.
 */
export function modeGlobalDemande() {
  return (process.env.AUTOPOST_MODE || '').trim() === MODE_REEL ? MODE_REEL : MODE_SIMULATION;
}

/**
 * Le mode réellement appliqué : `live` seulement si **la base ET
 * l'environnement** le disent.
 *
 * Deux verrous indépendants, et il en faut deux :
 *
 *   - la ligne `autopost_controle` est le verrou d'exploitation. Elle se
 *     bascule en 10 secondes, sans redéploiement, depuis la console ou l'écran.
 *     C'est le kill-switch ;
 *   - `AUTOPOST_MODE` est le cran de sûreté de déploiement. Il vit dans Vercel,
 *     et changer sa valeur exige un redéploiement — précisément ce qui en fait
 *     un mauvais arrêt d'urgence et une bonne sécurité de fond.
 *
 * Aucun des deux ne peut ouvrir seul. Une ligne de base modifiée par erreur ne
 * suffit donc pas à mettre la Page de l'entreprise en ligne, et une variable
 * oubliée à `live` dans Vercel non plus.
 *
 * @param {{mode?: string}|null} controle
 * @returns {'dry_run'|'live'}
 */
export function modeGlobalEffectif(controle) {
  const base = controle?.mode === MODE_REEL;
  const environnement = modeGlobalDemande() === MODE_REEL;
  return base && environnement ? MODE_REEL : MODE_SIMULATION;
}

/**
 * Exécute un passage complet.
 *
 * @param {object} arg
 * @param {object} arg.depot   le port décrit ci-dessus
 * @param {object} arg.client  client Meta (`autopost-meta.js`)
 * @param {Date|string} [arg.instant]  l'instant d'évaluation
 * @param {object} [arg.options]
 * @param {Function} [arg.tracer]  journal technique (console par défaut)
 * @returns {Promise<object>} bilan du passage
 */
export async function executerPassage({
  depot,
  client,
  instant = new Date(),
  options = {},
  tracer = (...a) => console.log(...a),
}) {
  const instantUtc = typeof instant === 'string' ? instant : formaterInstantUtc(instant);
  const bilan = {
    instant_utc: instantUtc,
    mode: MODE_SIMULATION,
    jeton_present: Boolean(client?.disponible),
    examines: 0,
    publies: 0,
    simules: 0,
    echecs: 0,
    incertains: 0,
    reconcilies: 0,
    pris_ailleurs: 0,
    ecartes: [],
    alertes: [],
    details: [],
  };

  /* ── 0. ARRÊT GLOBAL ──────────────────────────────────────────────────── */
  const controle = await depot.lireArretGlobal();
  const modeGlobal = modeGlobalEffectif(controle);
  bilan.mode = modeGlobal;

  if (controle?.actif === false) {
    tracer('[autopost] ARRÊT GLOBAL actif — aucun travail examiné.');
    bilan.arret_global = true;
    await depot.journaliser({
      instant_utc: instantUtc, evenement: 'passage', resume: 'arrêt global actif', bilan,
    });
    return bilan;
  }

  /* ── 1. RÉCONCILIATION avant toute création ───────────────────────────── */
  if (typeof depot.lireAReconcilier === 'function') {
    const aReconcilier = await depot.lireAReconcilier();
    for (const ligne of aReconcilier || []) {
      const issue = await reconcilierLigne({ ligne, client, depot, instantUtc, tracer });
      if (issue === 'publie') bilan.reconcilies += 1;
      bilan.details.push({ cle: ligne.cle_idempotence, issue: `reconciliation_${issue}` });
    }
  }

  /* ── 2. SÉLECTION (pure) ──────────────────────────────────────────────── */
  const file = await depot.lireFile({ limite: options.limite ?? 50 });
  const dateLocale = dateLocaleDepuisInstantUtc(instantUtc) || '';
  const dejaPubliesAujourdhui = typeof depot.compterPubliesLe === 'function'
    ? await depot.compterPubliesLe(dateLocale)
    : 0;

  const decision = travauxDus({
    file: file || [],
    instant: instantUtc,
    options: {
      arretGlobal: false,
      plafondJournalier: controle?.plafond ?? options.plafondJournalier ?? 4,
      dejaPubliesAujourdhui,
      cleSignature: options.cleSignature ?? (process.env.AUTOPOST_CLE_APPROBATION || null),
    },
  });

  bilan.examines = (file || []).length;
  bilan.ecartes = decision.ecartes;
  bilan.alertes = decision.alertes;
  tracer('[autopost] %s — %s', instantUtc, resumerDecision(decision));

  // Les tolérances trop courtes pour la cadence sont dites AVANT que le créneau
  // ne passe. Une publication perdue en silence est le pire des résultats.
  for (const a of decision.alertes) {
    tracer('[autopost] ⚠️ %s %s : %s', a.publication_id, a.canal, a.detail);
  }

  /* ── 3 à 6. Pour chaque travail dû ────────────────────────────────────── */
  for (const travail of decision.aPublier) {
    const cle = travail.cle_idempotence;

    // PRISE — compare-and-swap. C'est ici, et nulle part ailleurs, que se joue
    // la concurrence entre deux exécutions simultanées.
    const pris = await depot.prendre(cle, { instant: instantUtc });
    if (!pris) {
      bilan.pris_ailleurs += 1;
      bilan.ecartes.push({
        cle_idempotence: cle,
        publication_id: travail.publication_id,
        canal: travail.canal,
        raison: 'pris_par_une_autre_execution',
        detail: 'une autre exécution tenait déjà cette ligne — rien n\'a été publié ici',
      });
      continue;
    }

    const modePublication = travail.publication?.mode_execution === MODE_REEL ? MODE_REEL : MODE_SIMULATION;
    const reel = client?.disponible === true && modeGlobal === MODE_REEL && modePublication === MODE_REEL;

    if (!reel) {
      /* ── SIMULATION : aucun appel réseau, aucun témoin posé ───────────── */
      // La raison est nommée précisément : « c'est simulé » sans dire lequel des
      // quatre verrous est fermé oblige à les essayer un par un.
      let raison;
      if (!client?.disponible) raison = 'jeton_absent';
      else if (controle?.mode !== MODE_REEL) raison = 'interrupteur_base_en_dry_run';
      else if (modeGlobalDemande() !== MODE_REEL) raison = 'variable_AUTOPOST_MODE_en_dry_run';
      else raison = 'mode_publication_dry_run';
      await depot.relacher(cle, { etat: 'scheduled', tentatives: travail.tentatives || 0, erreur: null });
      await depot.journaliser({
        instant_utc: instantUtc,
        cle_idempotence: cle,
        publication_id: travail.publication_id,
        canal: travail.canal,
        evenement: 'simulation',
        resume: `simulé (${raison}) — aucun appel réseau, aucun identifiant posé`,
      });
      bilan.simules += 1;
      bilan.details.push({ cle, issue: 'simule', raison });
      tracer('[autopost] SIMULÉ %s %s (%s)', travail.publication_id, travail.canal, raison);
      continue;
    }

    /* ── APPEL RÉEL ───────────────────────────────────────────────────── */
    const tentatives = (travail.tentatives || 0) + 1;
    try {
      const sortie = await publierUnCanal({ travail, client, depot, cle });
      const resultat = {
        etat_final: 'published',
        id_distant: sortie.idDistant,
        id_conteneur: sortie.idConteneur ?? null,
        url_publique: null,
        publie_a_utc: instantUtc,
        publie_a_local: formaterInstantLocal(instantUtc, travail.publication?.creneau?.offset_utc || '+01:00'),
        verifie_le_utc: null,
        methode_verification: null,
        // 🔴 Ce champ n'est PAS de la prudence décorative : tant que le test de
        // 5 minutes du §2.2 n'a pas été fait, une réponse 200 d'une application
        // non publiée ne prouve pas qu'un client de Moanda voit le post.
        visibilite_publique: 'non_verifiee',
        code_erreur: null,
        message_erreur: null,
        reconcilie: Boolean(sortie.reconcilie),
      };

      // Relecture : elle prouve que l'objet EXISTE, pas qu'il est visible.
      const relu = await client.relire(sortie.idDistant);
      if (relu?.existe) {
        resultat.verifie_le_utc = instantUtc;
        resultat.methode_verification = 'relecture_api';
        resultat.url_publique = relu.permalien;
      }

      await depot.enregistrerPublication(cle, { ...resultat, tentatives });
      await depot.journaliser({
        instant_utc: instantUtc,
        cle_idempotence: cle,
        publication_id: travail.publication_id,
        canal: travail.canal,
        evenement: 'publication',
        resume: `publié — id_distant=${sortie.idDistant} · visibilité publique NON vérifiée`,
      });
      bilan.publies += 1;
      bilan.details.push({ cle, issue: 'publie', id_distant: sortie.idDistant });
      tracer('[autopost] PUBLIÉ %s %s id=%s', travail.publication_id, travail.canal, sortie.idDistant);
    } catch (err) {
      const incertain = err?.incertain === true;
      const max = travail.tentatives_max ?? 3;
      const etat = incertain ? 'reconciling' : (tentatives >= max ? 'failed' : 'scheduled');

      await depot.relacher(cle, {
        etat,
        tentatives,
        erreur: {
          code_erreur: err?.codeMeta ?? 'inconnu',
          message_erreur: err?.message ?? String(err),
          piste: err?.piste ?? null,
          statut_http: err?.statut ?? null,
          a_utc: instantUtc,
        },
      });
      await depot.journaliser({
        instant_utc: instantUtc,
        cle_idempotence: cle,
        publication_id: travail.publication_id,
        canal: travail.canal,
        evenement: incertain ? 'incertain' : 'echec',
        resume: `${err?.codeMeta ?? 'inconnu'} — ${err?.message ?? err}`,
        piste: err?.piste ?? null,
      });

      if (incertain) bilan.incertains += 1; else bilan.echecs += 1;
      bilan.details.push({ cle, issue: incertain ? 'incertain' : 'echec', code: err?.codeMeta, piste: err?.piste });
      tracer('[autopost] %s %s %s : %s', incertain ? 'INCERTAIN' : 'ÉCHEC',
        travail.publication_id, travail.canal, err?.message);
    }
  }

  await depot.journaliser({
    instant_utc: instantUtc, evenement: 'passage', resume: resumerDecision(decision), bilan,
  });
  return bilan;
}

/** Aiguillage par canal. Le média doit être accessible publiquement par Meta. */
async function publierUnCanal({ travail, client, depot, cle }) {
  const legende = travail.legende || '';
  const urlMedia = travail.url_media || null;
  if (!urlMedia) {
    const e = new Error('url_media absente : Instagram exige une URL publiquement accessible, '
      + 'et Facebook la demande aussi dans ce chemin. Elle est produite au moment de l\'approbation '
      + '(stockage privé + URL signée courte), pas au moment de publier.');
    e.codeMeta = 'url_media_absente';
    e.piste = 'Voir la recommandation d\'accès au Drive en tête de api/autopost.js.';
    throw e;
  }

  if (travail.canal === 'facebook') {
    return client.publierPhotoFacebook({
      pageId: travail.compte_cible_id, urlMedia, legende,
    });
  }
  return client.publierPhotoInstagram({
    igId: travail.compte_cible_id,
    urlMedia,
    legende,
    // L'ancre écrite AVANT `media_publish` : sans elle, un timeout au mauvais
    // moment laisse un conteneur orphelin qu'on ne sait plus interroger.
    surConteneur: (idConteneur) => depot.noterConteneur(cle, idConteneur),
  });
}

/**
 * Réconcilie une ligne dont le résultat distant est incertain.
 * CHERCHER d'abord, ne jamais recréer. En cas de doute qui persiste, on laisse
 * en `reconciling` avec une tâche humaine : le dossier le permet, c'est un état
 * à part entière, pas un échec.
 */
async function reconcilierLigne({ ligne, client, depot, instantUtc, tracer }) {
  if (!client?.disponible) return 'jeton_absent';

  try {
    if (ligne.id_conteneur) {
      const etat = await client.relire(ligne.id_conteneur);
      if (etat?.existe) {
        await depot.enregistrerPublication(ligne.cle_idempotence, {
          etat_final: 'published',
          id_distant: ligne.id_conteneur,
          id_conteneur: ligne.id_conteneur,
          url_publique: etat.permalien || null,
          publie_a_utc: instantUtc,
          publie_a_local: formaterInstantLocal(instantUtc),
          verifie_le_utc: instantUtc,
          methode_verification: 'recherche_conteneur',
          visibilite_publique: 'non_verifiee',
          code_erreur: null,
          message_erreur: null,
          reconcilie: true,
        });
        return 'publie';
      }
    }

    const code = ligne.publication?.code_provenance;
    if (ligne.canal === 'facebook' && code) {
      const depuis = msDepuisInstantUtc(ligne.instant_utc) || 0;
      const trouve = await client.chercherParCodeProvenance({
        pageId: ligne.compte_cible_id, code, depuisMs: depuis,
      });
      if (trouve) {
        await depot.enregistrerPublication(ligne.cle_idempotence, {
          etat_final: 'published',
          id_distant: trouve.idDistant,
          id_conteneur: null,
          url_publique: null,
          publie_a_utc: instantUtc,
          publie_a_local: formaterInstantLocal(instantUtc),
          verifie_le_utc: instantUtc,
          methode_verification: 'recherche_code_provenance',
          visibilite_publique: 'non_verifiee',
          code_erreur: null,
          message_erreur: null,
          reconcilie: true,
        });
        return 'publie';
      }
    }
  } catch (err) {
    tracer('[autopost] réconciliation impossible pour %s : %s', ligne.cle_idempotence, err?.message);
    return 'erreur';
  }

  // Rien trouvé. On NE republie PAS automatiquement : une publication non encore
  // indexée dans le flux ressemble exactement à une publication qui n'a pas eu
  // lieu. C'est une décision humaine.
  return 'non_trouve';
}

export { RAISONS };
