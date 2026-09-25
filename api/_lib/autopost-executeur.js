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
 *   expirer(cle, details)             → boolean   ← CONDITIONNEL (scheduled, sans témoin)
 *   journaliser(entree)
 *
 * Chaque implémentation réelle doit garantir que `prendre()` est atomique. La
 * version Supabase le fait par un UPDATE conditionnel qui renvoie les lignes
 * modifiées (`autopost-depot.js`).
 */
import { travauxDus, resumerDecision, RAISONS } from './autopost-selection.js';
import { COMPTES_CIBLES, resoudreCompteCible } from './autopost-contrat.js';
import { phraseDeclencheur } from './autopost-alimentation.js';
import { formaterInstantUtc, formaterInstantLocal, msDepuisInstantUtc, dateLocaleDepuisInstantUtc } from '../../src/lib/dates.js';

/** Modes d'exécution. `dry_run` est le défaut, partout, toujours. */
export const MODE_SIMULATION = 'dry_run';
export const MODE_REEL = 'live';

/**
 * ⛔ LE SEUL ENDROIT DE LA CHAÎNE QUI LIT LES IDENTIFIANTS DE COMPTE META.
 *
 * Le manifeste porte des étiquettes (`PAGE_IMPRIMERIE`), la base porte des
 * étiquettes, l'écran affiche des étiquettes. Le numéro n'apparaît qu'ici, au
 * moment de composer l'appel — et il repart masqué dans tout ce qui est
 * journalisé ou rendu à l'écran (voir `masquerComptes`).
 *
 * Les noms de variables ne sont pas nouveaux : ce sont EXACTEMENT ceux que le
 * bot Messenger lit déjà (`api/_lib/bot-executeur.js`). Deux modules, un seul
 * couple de variables — en inventer un second ferait deux vérités.
 *
 * @param {object} [env]
 * @returns {Record<string,string>} étiquette → identifiant, uniquement les posées
 */
export function comptesDepuisEnvironnement(env = process.env) {
  const table = {};
  for (const [etiquette, definition] of Object.entries(COMPTES_CIBLES)) {
    if (!definition.variable) continue;
    const valeur = String(env?.[definition.variable] ?? '').trim();
    if (valeur !== '') table[etiquette] = valeur;
  }
  return table;
}

/**
 * Remplace tout identifiant de compte réel par son étiquette, dans un texte.
 *
 * 🔴 POURQUOI : un identifiant de Page Facebook n'est pas un secret, mais il
 * n'a rien à faire dans un écran, un journal ni une réponse d'API — et on ne
 * prend pas l'habitude. Le message d'erreur de Meta, lui, contient l'objet visé
 * (« Object with ID '…' »), et le bilan d'un passage remonte jusqu'au
 * navigateur par `api/autopost.js`.
 *
 * ⚠️ Ce qui est masqué, c'est le TEXTE rendu. La colonne `id_distant` de la
 * base garde la valeur brute : c'est le témoin de l'effet, et l'index unique
 * qui empêche une double publication est posé dessus.
 *
 * @param {*} texte
 * @param {Record<string,string>} comptes
 * @returns {*} le texte, identifiants remplacés par leur étiquette
 */
export function masquerComptes(texte, comptes) {
  if (typeof texte !== 'string' || texte === '') return texte;
  let sortie = texte;
  for (const [etiquette, id] of Object.entries(comptes || {})) {
    if (typeof id !== 'string' || id === '') continue;
    sortie = sortie.split(id).join(etiquette);
  }
  return sortie;
}

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
 * Le jeton de Page d'une publication Facebook, en français. Deux mots possibles,
 * rendus par `publierPhotoFacebook()` — jamais le jeton lui-même.
 */
const PHRASES_JETON_PAGE = Object.freeze({
  echange: 'jeton de Page obtenu par échange',
  deja_jeton_de_page: 'le jeton configuré était déjà un jeton de Page',
});

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
  /* ⛔ QUI A DEMANDÉ CE PASSAGE. `api/autopost.js` le sait (`autorisationTick()`
     ou la session d'un administrateur) et le passe ici ; le journal le porte
     dans le bilan ET dans la phrase, parce que l'écran n'affiche que la phrase. */
  const declencheur = options.declencheur ?? null;
  const signature = phraseDeclencheur(declencheur);
  const bilan = {
    instant_utc: instantUtc,
    declencheur,
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
    // Lignes passées de `scheduled` à `expired` à ce passage. Voir plus bas.
    expirees: [],
  };

  /* ── 0 bis. LA TABLE DES COMPTES — lue UNE fois, au début du passage ───
     Elle sert à trois choses, et à rien d'autre : écarter avant tout appel une
     étiquette qu'on ne sait pas résoudre, composer l'appel avec le vrai
     identifiant, et masquer ce même identifiant dans tout ce qui est écrit. */
  const comptes = comptesDepuisEnvironnement();
  const masquer = (texte) => masquerComptes(texte, comptes);

  /* ── 0. ARRÊT GLOBAL ──────────────────────────────────────────────────── */
  const controle = await depot.lireArretGlobal();
  const modeGlobal = modeGlobalEffectif(controle);
  bilan.mode = modeGlobal;

  if (controle?.actif === false) {
    tracer('[autopost] ARRÊT GLOBAL actif — aucun travail examiné.');
    bilan.arret_global = true;
    await depot.journaliser({
      instant_utc: instantUtc, evenement: 'passage', resume: `arrêt global actif · ${signature}`, bilan,
    });
    return bilan;
  }

  /* ── 1. RÉCONCILIATION avant toute création ───────────────────────────── */
  if (typeof depot.lireAReconcilier === 'function') {
    const aReconcilier = await depot.lireAReconcilier();
    for (const ligne of aReconcilier || []) {
      const issue = await reconcilierLigne({ ligne, client, depot, instantUtc, tracer, comptes });
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
      // ⛔ Toujours passée, jamais omise : sans elle, la sélection contrôlerait
      //    l'étiquette mais pas la présence de la variable, et une publication
      //    partirait vers un identifiant vide.
      comptes,
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
      const sortie = await publierUnCanal({ travail, client, depot, cle, comptes });
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
        /* ⛔ Facebook seulement : le jeton de Page a-t-il été OBTENU PAR ÉCHANGE,
           ou le jeton configuré en était-il déjà un ? Un MOT, jamais le jeton.
           L'audit 41 (§4) n'a pu que le supposer ; désormais le journal le dit. */
        jeton_page: sortie.jetonPage ?? null,
      };

      // Relecture : elle prouve que l'objet EXISTE, pas qu'il est visible.
      // `pageId` n'est posé que par le chemin Facebook : il fait relire le post
      // avec le JETON DE PAGE, celui-là même qui l'a écrit. Instagram n'en pose
      // pas et garde le jeton configuré, qui fonctionne.
      const relu = await client.relire(sortie.idDistant, { pageId: sortie.pageId ?? null });
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
        // Masqué : l'identifiant d'un post Facebook porte celui de la Page en
        // préfixe. La valeur brute reste dans la colonne `id_distant`.
        resume: masquer(`publié — id_distant=${sortie.idDistant} · visibilité publique NON vérifiée`
          + (sortie.jetonPage ? ` · ${PHRASES_JETON_PAGE[sortie.jetonPage] || `jeton de Page : ${sortie.jetonPage}`}` : '')),
      });
      bilan.publies += 1;
      bilan.details.push({
        cle,
        issue: 'publie',
        id_distant: masquer(sortie.idDistant),
        ...(sortie.jetonPage ? { jeton_page: sortie.jetonPage } : {}),
      });
      tracer('[autopost] PUBLIÉ %s %s id=%s', travail.publication_id, travail.canal, masquer(sortie.idDistant));
    } catch (err) {
      const incertain = err?.incertain === true;
      const max = travail.tentatives_max ?? 3;
      const etat = incertain ? 'reconciling' : (tentatives >= max ? 'failed' : 'scheduled');

      await depot.relacher(cle, {
        etat,
        tentatives,
        erreur: {
          code_erreur: err?.codeMeta ?? 'inconnu',
          // Le message de Meta nomme l'objet visé (« Object with ID '…' ») : il
          // est rendu au gérant avec l'étiquette, pas avec le numéro.
          message_erreur: masquer(err?.message ?? String(err)),
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
        resume: masquer(`${err?.codeMeta ?? 'inconnu'} — ${err?.message ?? err}`),
        piste: err?.piste ?? null,
      });

      if (incertain) bilan.incertains += 1; else bilan.echecs += 1;
      bilan.details.push({ cle, issue: incertain ? 'incertain' : 'echec', code: err?.codeMeta, piste: err?.piste });
      tracer('[autopost] %s %s %s : %s', incertain ? 'INCERTAIN' : 'ÉCHEC',
        travail.publication_id, travail.canal, masquer(err?.message));
    }
  }

  /* ── 7. CE QUI NE PARTIRA PLUS NE RESTE PAS « PRÉVU » ─────────────────
     🔴 L'audit 41 a trouvé 5 lignes Facebook/Instagram en `scheduled` avec un
     créneau passé depuis des jours (19, 20 et 21/09). Chaque passage les
     recomptait en `hors_tolerance`, et l'écran les affichait « Prévu » : le
     gérant pouvait croire qu'elles allaient partir. Un état faux est un faux
     témoin.

     Elles passent donc en `expired` (l'état « Périmé » de l'écran, prévu par
     la contrainte de la migration 008), avec le motif ET la cause du dernier
     essai — la ligne du 20/09 doit continuer de dire `url_media_absente`.

     Ce que ce bloc ne fait PAS :
       - il ne touche qu'aux lignes que la sélection vient d'écarter pour
         `hors_tolerance` — donc des canaux PUBLIANTS, `scheduled`, sans
         témoin, dont le manifeste est valide et le créneau cohérent. Les
         remises à un humain (`whatsapp_handoff`) n'y passent pas : personne ne
         sait si le relais a été fait, et « Périmé » serait une autre fausseté ;
       - il n'écrit que par un UPDATE CONDITIONNEL (`scheduled` et sans
         `id_distant`) : une ligne prise entre-temps n'est pas écrasée ;
       - il tourne APRÈS les publications : le temps d'un passage va d'abord à
         ce qui peut encore partir. */
  const perimes = decision.ecartes.filter((e) => e.raison === RAISONS.HORS_TOLERANCE);
  if (perimes.length > 0 && typeof depot.expirer === 'function') {
    const lues = new Map((file || []).map((l) => [l.cle_idempotence, l]));
    for (const ecartee of perimes) {
      const ligne = lues.get(ecartee.cle_idempotence);
      const cause = ligne?.derniere_erreur?.code_erreur ?? null;
      const details = {
        code_erreur: 'creneau_depasse',
        message_erreur: `Créneau passé sans publication (${ecartee.detail}) : cette ligne ne partira plus.`
          + (cause ? ` Dernier motif connu : ${cause}.` : ''),
        piste: 'Rien n\'a été publié. Pour la publier quand même, la reprogrammer : redéposer le '
          + 'manifeste avec un nouveau créneau (nouvelle version) dans le Drive.',
        cause_precedente: cause,
        a_utc: instantUtc,
      };
      let fait = false;
      try {
        fait = await depot.expirer(ecartee.cle_idempotence, details);
      } catch (err) {
        // Une écriture d'état qui échoue ne fait pas tomber le passage : les
        // publications sont déjà faites. Le passage suivant réessaiera.
        tracer('[autopost] expiration impossible pour %s : %s', ecartee.cle_idempotence, err?.message);
      }
      if (!fait) continue;
      bilan.expirees.push({
        cle_idempotence: ecartee.cle_idempotence,
        publication_id: ecartee.publication_id,
        canal: ecartee.canal,
        instant_utc: ecartee.instant_utc,
        cause_precedente: cause,
      });
      await depot.journaliser({
        instant_utc: instantUtc,
        cle_idempotence: ecartee.cle_idempotence,
        publication_id: ecartee.publication_id,
        canal: ecartee.canal,
        evenement: 'expiration',
        resume: `périmée — ${details.message_erreur}`,
        piste: details.piste,
      });
    }
  }

  await depot.journaliser({
    instant_utc: instantUtc,
    evenement: 'passage',
    resume: resumerDecision(decision)
      + (bilan.expirees.length ? ` · ${bilan.expirees.length} ligne(s) passée(s) en périmé` : '')
      + ` · ${signature}`,
    bilan,
  });
  return bilan;
}


/** Aiguillage par canal. Le média doit être accessible publiquement par Meta. */
async function publierUnCanal({ travail, client, depot, cle, comptes = {} }) {
  /* 🔴 LA LIGNE QUI MANQUAIT LE 19/09/2026 AU SOIR.
     `travail.compte_cible_id` vaut `IG_IMPRIMERIE` : une étiquette. Elle partait
     telle quelle dans l'URL Graph, et Meta répondait « Object with ID
     'IG_IMPRIMERIE' does not exist ». On résout ICI, et on ne passe JAMAIS
     `travail.compte_cible_id` au client.
     La sélection a déjà écarté ce qui n'est pas résolvable ; ce contrôle est la
     ceinture par-dessus les bretelles, pour le jour où un autre appelant
     arrivera par un autre chemin. */
  const compte = resoudreCompteCible({
    etiquette: travail.compte_cible_id, canal: travail.canal, comptes,
  });
  if (!compte.resolu || !compte.id) {
    const e = new Error(compte.detail
      || `compte cible « ${travail.compte_cible_id} » non résolu : aucun appel n'est tenté`);
    e.codeMeta = compte.motif || 'compte_cible_non_resolu';
    e.piste = 'Voir api/_lib/autopost-contrat.js : le manifeste nomme un compte par son '
      + 'étiquette, et l\'application la résout avec ses propres variables d\'environnement.';
    throw e;
  }

  const legende = travail.legende || '';
  const urlMedia = travail.url_media || null;
  if (!urlMedia) {
    const e = new Error('url_media absente : Instagram exige une URL publiquement accessible, '
      + 'et Facebook la demande aussi dans ce chemin. Elle est produite au moment d\'ALIMENTER la '
      + 'file (le média est recopié du Drive vers le bucket « publications »), pas au moment de '
      + 'publier — improviser une adresse ici serait publier un fichier que personne n\'a vu.');
    e.codeMeta = 'url_media_absente';
    e.piste = 'La ligne porte le motif dans `derniere_erreur` : type non admis, média trop lourd, '
      + 'Drive ou stockage injoignable, ou report au prochain passage. Voir '
      + 'api/_lib/autopost-medias.js.';
    throw e;
  }

  if (travail.canal === 'facebook') {
    return client.publierPhotoFacebook({
      pageId: compte.id, urlMedia, legende,
    });
  }
  return client.publierPhotoInstagram({
    igId: compte.id,
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
async function reconcilierLigne({ ligne, client, depot, instantUtc, tracer, comptes = {} }) {
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
      // Même règle que pour publier : on CHERCHE sur un identifiant résolu, pas
      // sur une étiquette. Non résolue, la ligne reste en `reconciling` — un
      // état à part entière, avec une tâche humaine, pas un échec.
      const compte = resoudreCompteCible({
        etiquette: ligne.compte_cible_id, canal: 'facebook', comptes,
      });
      if (!compte.resolu || !compte.id) {
        tracer('[autopost] réconciliation impossible pour %s : %s',
          ligne.cle_idempotence, compte.detail || 'compte cible non résolu');
        return 'compte_cible_non_resolu';
      }
      const depuis = msDepuisInstantUtc(ligne.instant_utc) || 0;
      const trouve = await client.chercherParCodeProvenance({
        pageId: compte.id, code, depuisMs: depuis,
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
