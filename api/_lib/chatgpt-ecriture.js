/**
 * COUCHE D'ÉCRITURE DU PONT CHATGPT — et tout ce qui la retient.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CE QUE LE DIRIGEANT A DEMANDÉ, ET CE QUI A ÉTÉ CONSTRUIT
 * ════════════════════════════════════════════════════════════════════════════
 *
 * « On aimerait, depuis ChatGPT, demander de changer quelque chose dans
 * l'application. […] Sans confirmation, il écrit direct — mais qu'on puisse
 * quand même modifier si c'est mal fait. »
 *
 * C'est sa décision, prise en connaissance de cause, et elle n'est pas
 * rediscutée ici : aucune étape de confirmation n'existe dans ce fichier.
 *
 * ⚠️ L'OBJECTION, POSÉE UNE FOIS : un assistant conversationnel se trompe de
 * montant, de compte et de date sans jamais hésiter, et ici personne ne relit
 * avant que ça tombe dans une caisse réelle. Le travail a été fait quand même,
 * comme demandé — mais ce qui REMPLACE la confirmation doit tenir, et c'est ce
 * fichier qui le porte :
 *
 *   1. PROVENANCE. Chaque ligne écrite porte le marqueur « via ChatGPT », la
 *      phrase exacte de l'utilisateur, et l'horodatage EN HEURE DE MOANDA.
 *   2. JOURNAL AVANT L'EFFET. La trace part dans `audit_logs` AVANT l'écriture,
 *      comme le fait l'import administrateur : si l'écriture échoue au milieu,
 *      on sait quand même ce qui a été tenté, par quoi, et sur quel montant.
 *   3. ANNULABLE. Chaque geste rend un identifiant, et la voie `annuler` le
 *      défait — en CONTRE-PASSANT, jamais en effaçant.
 *   4. IDEMPOTENT. La même clé deux fois ne produit qu'une écriture.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * L'IDEMPOTENCE SE FONDE SUR LE TÉMOIN DE L'EFFET
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Règle de la maison, et elle est stricte : on ne pose JAMAIS un drapeau
 * « réservé » avant d'agir pour s'en servir ensuite comme preuve. Un drapeau
 * posé puis abandonné (instance qui expire, réseau coupé) bloque le geste pour
 * toujours, sans que rien n'ait eu lieu.
 *
 * Le témoin est donc la LIGNE RÉELLEMENT ÉCRITE :
 *
 *   - pour un mouvement d'argent : sa `reference`, protégée par l'index unique
 *     partiel `idx_mouvements_reference_unique` (migration 005, vérifié
 *     `indisvalid = true` en production le 18/09/2026). Deux instances
 *     serverless simultanées : PostgreSQL en rejette une avec le code 23505 ;
 *   - pour une tâche, une étape ou un constat de caisse : son champ
 *     `chatgpt_cle`, cherché avant d'écrire.
 *
 * ⚠️ Pour ces trois dernières collections, aucun index unique n'existe encore :
 * la lecture préalable referme la fenêtre courante (une relance quelques
 * secondes plus tard) mais PAS la course vraie. Le verrou d'exécution unique
 * ci-dessous couvre les appels concurrents d'une même instance. Ce qui reste
 * non couvert, et qui est dit franchement dans le rapport : deux instances
 * serverless distinctes qui reçoivent la même clé à la même milliseconde
 * peuvent créer deux tâches. Aucun franc n'est en jeu dans ce cas — l'argent,
 * lui, est protégé par l'index.
 *
 * ── Pourquoi ce fichier est dans `api/_lib/` ──────────────────────────────
 * Le plan Vercel Hobby plafonne le projet à 12 fonctions serverless, et seuls
 * les fichiers à la RACINE d'`api/` comptent. `ls api/*.js | wc -l` en rend
 * exactement 12 : il n'y a plus une seule place. Un treizième fichier fait
 * échouer le déploiement ENTIER, avec un build vert — c'est arrivé le
 * 17/09/2026. Voir l'en-tête de `api/chatgpt.js`.
 *
 * La DÉCISION (quels gestes, quels champs, quelles opérations) vit dans
 * `src/services/chatgpt-gestes.js`, module pur partagé avec l'écran « Ce que
 * ChatGPT a écrit ». Ce fichier-ci ne fait qu'EXÉCUTER.
 *
 * Testé par `tests/chatgpt-ecriture.test.mjs`.
 */
import { supabaseAdmin } from './supabase-admin.js';
import { creerVerrouExecution } from '../../src/services/execution-unique.js';
import {
  GESTES,
  BESOINS_CONTEXTE,
  COLLECTIONS_ECRITURES,
  CHAMP_MARQUEUR,
  CHAMP_CLE,
  CHAMPS_RESUME,
  preparerGeste,
  planAnnulation,
  identifiantDe,
  cleDepuisIdentifiant,
  resumerEcriture,
  parPlusRecent,
} from '../../src/services/chatgpt-gestes.js';

/** Les voies servies en POST. `journal` est en lecture : elle n'est pas ici. */
export const VOIES_ECRITURE = Object.freeze([...GESTES, 'annuler']);

/**
 * Verrou d'exécution unique, partagé par toutes les écritures du pont.
 *
 * Deux appels concurrents portant la même clé reçoivent LA MÊME promesse :
 * l'opération n'a lieu qu'une fois. C'est le patron de
 * `src/services/execution-unique.js`, écrit pour les prélèvements automatiques
 * et réemployé ici pour la même raison — ChatGPT relance volontiers une requête
 * dont la réponse tarde.
 */
const verrouEcritures = creerVerrouExecution();

/** Codes PostgreSQL / PostgREST signalant une violation d'unicité. */
function estViolationUnicite(error) {
  if (!error) return false;
  return error.code === '23505' || /duplicate key|unique constraint/i.test(error.message || '');
}

/**
 * Solde numérique d'un compte.
 *
 * ⚠️ `Number(valeur)` et pas `valeur ?? 0` : mesuré le 16/09/2026, plusieurs
 * comptes portent `solde: ""` (la chaîne vide). En JavaScript `"" ?? 0` vaut
 * `""`, et `"" + 7000` vaut la CHAÎNE `"7000"` — le solde suivant deviendrait
 * `"70007000"`.
 */
export function soldeNumerique(valeur) {
  const n = Number(valeur);
  return Number.isFinite(n) ? n : 0;
}

/* ═══════════════════════════════════════════════════════════════════════════
   LE DÉPÔT RÉEL
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Dépôt d'écriture au-dessus de Supabase (clé de service).
 *
 * Isolé derrière une interface pour que les tests le remplacent par un double
 * en mémoire — c'est la seule façon de prouver sans base qu'un GET n'atteint
 * AUCUNE écriture, et qu'une clé renvoyée deux fois n'écrit qu'une fois.
 */
export function depotEcriture() {
  const sb = () => supabaseAdmin();
  const maintenant = () => new Date().toISOString();

  return {
    async listerComptes() {
      const { data, error } = await sb()
        .from('app_data')
        .select('id, data')
        .eq('collection', 'comptes_bancaires')
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      return (data || []).map((r) => ({
        id: r.id,
        nom: r.data?.nom || '',
        solde: soldeNumerique(r.data?.solde),
      }));
    },

    async listerProjets() {
      const { data, error } = await sb()
        .from('app_data')
        .select('id, data')
        .eq('collection', 'projets_travaux')
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      return (data || []).map((r) => ({ id: r.id, nom: r.data?.nom || '' }));
    },

    /**
     * Une collection, réduite aux champs demandés.
     *
     * ⚠️ Le `data` complet n'est JAMAIS rapatrié. `produits_catalogue` pèse
     * 20 Mo pour 195 lignes — dont une seule à 3,2 Mo d'images en base64. Lire
     * la table entière pour retrouver un produit par son nom ferait expirer la
     * fonction, et ferait payer la connexion de Moanda pour rien.
     *
     * PostgREST sait projeter à l'intérieur du jsonb (`alias:data->>champ`).
     * `id` vient de la COLONNE, jamais de `data.id` : c'est lui que `modifier`
     * utilise ensuite pour retrouver la ligne.
     */
    async listerLeger(collection, champs) {
      const projection = ['id', ...champs.map((c) => `${c}:data->${c}`)].join(', ');
      const { data, error } = await sb()
        .from('app_data')
        .select(projection)
        .eq('collection', collection)
        .order('created_at', { ascending: true })
        .limit(2000);
      if (error) throw new Error(error.message);
      return data || [];
    },

    /**
     * Les rapports d'UNE journée — jamais les 237.
     *
     * Sans date, on rend une liste vide plutôt que tout : une fabrique qui
     * chercherait « le rapport du jour » dans une liste vide refusera
     * proprement, alors qu'un `select` sans filtre sur cette collection est un
     * coût qu'on ne veut jamais payer par distraction.
     */
    async listerRapportsDuJour(date) {
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
      const { data, error } = await sb()
        .from('app_data')
        .select('id, data')
        .eq('collection', 'rapports')
        .eq('data->>date', date);
      if (error) throw new Error(error.message);
      return (data || []).map((r) => ({ ...r.data, id: r.id }));
    },

    /** LE TÉMOIN, pour les collections sans index unique. */
    async chercherParCle(collection, cle) {
      if (!COLLECTIONS_ECRITURES.includes(collection)) return null;
      const { data, error } = await sb()
        .from('app_data')
        .select('id, data')
        .eq('collection', collection)
        .eq(`data->>${CHAMP_CLE}`, String(cle))
        .limit(1);
      if (error) throw new Error(error.message);
      const ligne = (data || [])[0];
      return ligne ? { id: ligne.id, data: ligne.data } : null;
    },

    /** LE TÉMOIN de l'argent : la référence, unique en base. */
    async chercherMouvementParReference(reference) {
      const { data, error } = await sb()
        .from('app_data')
        .select('id, data')
        .eq('collection', 'mouvements_financiers')
        .eq('data->>reference', String(reference))
        .limit(1);
      if (error) throw new Error(error.message);
      const ligne = (data || [])[0];
      return ligne ? { id: ligne.id, data: ligne.data } : null;
    },

    async lireLigne(collection, id) {
      const { data, error } = await sb()
        .from('app_data')
        .select('id, data')
        .eq('collection', collection)
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? { id: data.id, data: data.data } : null;
    },

    /**
     * Écrit une ligne, et DIT si elle a réellement été créée.
     *
     * Le même identifiant est posé dans la colonne `id` ET dans `data.id` :
     * c'est la convention de `src/services/db.js`, celle que les écrans
     * connaissent. (`api/_lib/singpay-encaissement.js` en pose deux
     * différents ; une ligne écrite ainsi ne se retrouve jamais par
     * `db.getById`. On ne reprend pas cette divergence.)
     */
    async creer(collection, data) {
      const quand = maintenant();
      const { error } = await sb().from('app_data').insert({
        id: data.id,
        collection,
        data,
        created_at: quand,
        updated_at: quand,
      });
      if (error) {
        if (estViolationUnicite(error)) {
          return { insere: false, id: null, raison: 'doublon rejeté par la base' };
        }
        throw new Error(error.message);
      }
      return { insere: true, id: data.id };
    },

    /** Fusionne des champs dans une ligne existante, sans jamais la retirer. */
    async modifier(collection, id, champs) {
      const existante = await this.lireLigne(collection, id);
      if (!existante) throw new Error(`ligne introuvable : ${collection}/${id}`);
      const fusion = { ...existante.data, ...champs, updated_at: maintenant() };
      const { error } = await sb()
        .from('app_data')
        .update({ data: fusion, updated_at: fusion.updated_at })
        .eq('collection', collection)
        .eq('id', id);
      if (error) throw new Error(error.message);
      return fusion;
    },

    /**
     * Ajoute `delta` au solde d'un compte — un nombre, et rien d'autre.
     *
     * Passe par la fonction SQL `crediter_compte` (migration 005) : l'addition
     * est faite DANS PostgreSQL, sur la ligne verrouillée par l'UPDATE
     * lui-même. En lire-modifier-écrire, deux ajustements simultanés lisent le
     * même solde et le second écrase le premier — un débit disparaîtrait.
     * Le repli existe pour que ce code fonctionne même si la fonction manque.
     *
     * ⚠️ C'est la SEULE chose que le pont a le droit de changer sur un compte
     * bancaire. Créer un compte, le renommer, réécrire son solde à la main :
     * interdit, et aucun chemin d'ici n'y mène.
     */
    async ajusterSolde(compteId, delta) {
      const { error } = await sb().rpc('crediter_compte', {
        p_compte_id: compteId,
        p_montant: delta,
      });
      if (!error) return;

      const ligne = await this.lireLigne('comptes_bancaires', compteId);
      if (!ligne) throw new Error(`compte introuvable : ${compteId}`);
      const solde = soldeNumerique(ligne.data?.solde) + delta;
      const { error: err2 } = await sb()
        .from('app_data')
        .update({ data: { ...ligne.data, solde }, updated_at: maintenant() })
        .eq('collection', 'comptes_bancaires')
        .eq('id', compteId);
      if (err2) throw new Error(err2.message);
    },

    /** La trace d'audit, à la forme exacte de `src/services/audit.js`. */
    async journaliser(entree) {
      const id = crypto.randomUUID();
      const { error } = await sb().from('app_data').insert({
        id,
        collection: 'audit_logs',
        data: { ...entree, id },
        created_at: maintenant(),
        updated_at: maintenant(),
      });
      if (error) throw new Error(error.message);
    },

    /**
     * Tout ce que ChatGPT a écrit, toutes collections confondues.
     *
     * ⚠️ PROJETÉ, jamais `select('id, data')`. Depuis que le pont sait corriger
     * un prix, une ligne de `produits_catalogue` peut porter le marqueur — et
     * cette collection pèse 20 Mo pour 195 lignes, dont une seule à 3,2 Mo
     * d'images en base64. Rapatrier le `data` complet de chaque ligne marquée
     * pour en afficher le libellé ferait expirer la fonction le jour où le
     * gérant aura corrigé quelques prix.
     *
     * La liste ne sert qu'à AFFICHER et à RETROUVER : l'annulation, elle, relit
     * la ligne entière par son identifiant.
     */
    async listerEcritures() {
      const projection = ['id', ...CHAMPS_RESUME.map((c) => `${c}:data->${c}`)].join(', ');
      const tout = [];
      for (const collection of COLLECTIONS_ECRITURES) {
        const { data, error } = await sb()
          .from('app_data')
          .select(projection)
          .eq('collection', collection)
          .eq(`data->>${CHAMP_MARQUEUR}`, 'true')
          .order('created_at', { ascending: false })
          .limit(500);
        if (error) throw new Error(error.message);
        for (const r of data || []) tout.push({ collection, data: r });
      }
      return tout;
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   L'EXÉCUTION D'UN PLAN
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Applique la liste d'opérations décidée par le module pur.
 *
 * ⚠️ L'ORDRE N'EST PAS DÉCORATIF : la ligne d'argent part D'ABORD, le solde
 * ne bouge QUE si elle a réellement été insérée (`conditionne_par`). C'est le
 * modèle de `api/_lib/singpay-encaissement.js`, et c'est l'inverse de
 * `src/features/finances/page.jsx`, qui ajuste le solde avant d'écrire et
 * laisse les deux diverger quand l'écriture échoue.
 */
async function appliquer(operations, depot) {
  const inserees = new Map();
  const ecrites = [];

  for (const op of operations) {
    if (op.op === 'creer') {
      const id = crypto.randomUUID();
      const quand = new Date().toISOString();
      const data = { ...op.data, id, created_at: quand, updated_at: quand };
      const r = await depot.creer(op.collection, data);
      if (op.id_op) inserees.set(op.id_op, r.insere === true);
      if (r.insere) ecrites.push({ collection: op.collection, id });
      continue;
    }
    if (op.op === 'modifier') {
      /* Une modification peut dépendre d'une création, exactement comme un
         ajustement de solde : décrémenter un stock dont le mouvement a été
         rejeté en doublon ferait disparaître des articles sans qu'aucune ligne
         ne l'explique, et l'écart ne se verrait qu'au comptage suivant. */
      if (op.conditionne_par && inserees.get(op.conditionne_par) !== true) continue;
      await depot.modifier(op.collection, op.id, op.champs);
      continue;
    }
    if (op.op === 'solde') {
      // Le solde ne bouge que si l'écriture dont il dépend a bien eu lieu.
      // Sans cette garde, un doublon rejeté par la base débiterait quand même.
      if (op.conditionne_par && inserees.get(op.conditionne_par) !== true) continue;
      await depot.ajusterSolde(op.compte_id, op.delta);
    }
  }

  return ecrites;
}

/** Cherche le témoin d'un plan déjà appliqué. Rend la ligne, ou `null`. */
async function chercherTemoin(temoin, depot) {
  if (!temoin) return null;
  if (temoin.reference) return depot.chercherMouvementParReference(temoin.reference);
  return depot.chercherParCle(temoin.collection, temoin.cle);
}

/**
 * Retrouve une écriture ChatGPT à partir de sa clé.
 *
 * L'ordre compte : une étape de travaux payée a produit DEUX lignes (l'étape et
 * le mouvement). Si on cherchait le mouvement d'abord, on annulerait l'argent
 * sans marquer l'étape, qui resterait « payée » à l'écran — et la modifier
 * ensuite y déclencherait une seconde contre-passation.
 */
async function trouverEcriture(cle, depot) {
  /* Toutes les collections SAUF `mouvements_financiers`, cherchée en dernier
     par sa référence. Une étape de travaux payée a produit DEUX lignes : si on
     trouvait le mouvement d'abord, on annulerait l'argent sans marquer l'étape,
     qui resterait « payée » à l'écran — et la modifier ensuite y déclencherait
     une seconde contre-passation. */
  const aChercher = COLLECTIONS_ECRITURES.filter((c) => c !== 'mouvements_financiers');
  for (const collection of aChercher) {
    const ligne = await depot.chercherParCle(collection, cle);
    if (!ligne) continue;
    const lies = [];
    const mvt = await depot.chercherMouvementParReference(identifiantDe(cle));
    if (mvt) lies.push({ ...mvt.data, id: mvt.id });
    return { collection, data: { ...ligne.data, id: ligne.id }, lies };
  }
  const mvt = await depot.chercherMouvementParReference(identifiantDe(cle));
  if (mvt) return { collection: 'mouvements_financiers', data: { ...mvt.data, id: mvt.id }, lies: [] };
  return null;
}

/**
 * Ce que chaque clé de contexte coûte en lecture.
 *
 * Une entrée par clé de `BESOINS_CONTEXTE`. Une clé demandée par une fabrique
 * mais absente d'ici lèverait — plutôt que de rendre un tableau vide, qui
 * ferait refuser le geste pour une raison fausse (« projet inconnu » alors que
 * c'est la lecture qui manque).
 */
const LECTEURS_CONTEXTE = {
  comptes: (depot) => depot.listerComptes(),
  projets: (depot) => depot.listerProjets(),
  catalogue: (depot) => depot.listerLeger('produits_catalogue', ['nom', 'prix']),
  articles: (depot) => depot.listerLeger('produits', ['nom', 'quantite', 'stock', 'quantite_minimum', 'type_article']),
  clients: (depot) => depot.listerLeger('clients', ['nom', 'user_id']),
  prospects: (depot) => depot.listerLeger('prospects', ['nomOuEntreprise', 'historiqueInteractions']),
  commandes: (depot) => depot.listerLeger('commandes', ['numero', 'statut', 'client_nom', 'historique_statuts', 'livraison_traitee', 'est_test']),
  factures: (depot) => depot.listerLeger('factures', ['numero', 'statut', 'client_nom', 'total']),
  rapports: (depot, corps, ctx) => depot.listerRapportsDuJour(corps?.date || ctx?.date_locale),
  clotures: (depot) => depot.listerLeger('clotures_caisse', ['date', 'activite', 'ecart', 'statut']),
};

/**
 * Lit UNIQUEMENT ce dont le geste a besoin.
 *
 * Tout lire à chaque appel coûterait, sur la connexion de Moanda, la lecture du
 * catalogue entier (195 lignes dont une de 3,2 Mo d'images en base64) pour
 * créer une tâche de deux lignes.
 */
async function chargerContexte(geste, depot, corps, ctx) {
  const besoins = BESOINS_CONTEXTE[geste] || [];
  const valeurs = await Promise.all(besoins.map((cle) => {
    const lecteur = LECTEURS_CONTEXTE[cle];
    if (!lecteur) throw new Error(`contexte « ${cle} » demandé par ${geste} mais aucun lecteur ne le sert`);
    return lecteur(depot, corps, ctx);
  }));
  return Object.fromEntries(besoins.map((cle, i) => [cle, valeurs[i]]));
}

/** L'entrée d'audit, à la forme de `src/services/audit.js`. */
function traceAudit(journal, { cle, phrase, ctx, identifiant }) {
  return {
    timestamp: ctx.instant_utc,
    user_id: 'chatgpt',
    user_nom: 'ChatGPT (pont)',
    action: journal.action,
    module: journal.module,
    entity_id: identifiant,
    entity_label: journal.entity_label,
    details: `${journal.details} — écrit par ChatGPT sans confirmation, le ${ctx.lisible}`,
    metadata: { ...journal.metadata, cle, phrase, identifiant, heure_moanda: ctx.lisible },
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   LES TROIS ENTRÉES PUBLIQUES
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Exécute un geste. Rend `{ statut, corps }`, jamais une réponse HTTP.
 *
 * @param {object} arg
 * @param {string} arg.geste
 * @param {object} arg.corps  le corps JSON reçu
 * @param {object} arg.depot
 * @param {object} arg.ctx    `contexteTemporel()` — l'heure de MOANDA
 */
export async function executerGeste({ geste, corps, depot, ctx }) {
  const contexte = { ctx, ...(await chargerContexte(geste, depot, corps, ctx)) };
  const plan = preparerGeste(geste, corps, contexte);
  if (!plan.ok) {
    return { statut: plan.statut || 400, corps: { error: plan.erreur, detail: plan.detail } };
  }

  return verrouEcritures.executerUneSeuleFois(plan.identifiant, async () => {
    const deja = await chercherTemoin(plan.temoin, depot);
    if (deja) {
      return {
        statut: 200,
        corps: {
          enregistre: true,
          deja_fait: true,
          identifiant: plan.identifiant,
          geste: plan.geste,
          resume: `Déjà enregistré : ${plan.resume}`,
          pour_annuler: `Pour défaire : annulerEcritureChatGPT avec identifiant « ${plan.identifiant} ».`,
        },
      };
    }

    // LA TRACE D'ABORD. Si ce qui suit échoue au milieu, on saura quand même
    // ce qui a été tenté, sur quel montant, et à partir de quelle phrase.
    await depot.journaliser(traceAudit(plan.journal, {
      cle: plan.cle, phrase: corps.phrase, ctx, identifiant: plan.identifiant,
    }));

    await appliquer(plan.operations, depot);

    return {
      statut: 201,
      corps: {
        enregistre: true,
        deja_fait: false,
        identifiant: plan.identifiant,
        geste: plan.geste,
        resume: plan.resume,
        pour_annuler: `Pour défaire : annulerEcritureChatGPT avec identifiant « ${plan.identifiant} ».`,
        a_dire: "C'est enregistré dans l'application. Redis le montant et la date à voix haute, et "
          + "l'identifiant, pour qu'on puisse revenir dessus si ce n'est pas ça.",
      },
    };
  });
}

/**
 * Annule une écriture — en la COMPENSANT.
 *
 * Aucune ligne ne disparaît : le mouvement inverse s'ajoute, la ligne d'origine
 * reçoit la date de son annulation, et son libellé le dit à l'écran. C'est la
 * règle comptable du dépôt (voir `src/services/contre-passation-commande.js`),
 * et c'est ce qui rend tenable une écriture partie sans confirmation : on peut
 * toujours montrer ce qui a été écrit, et ce qui a été défait.
 */
export async function annulerEcriture({ corps, depot, ctx }) {
  const cle = cleDepuisIdentifiant(corps?.identifiant);
  if (!cle) {
    return {
      statut: 400,
      corps: {
        error: 'Identifiant requis',
        detail: "Fournis `identifiant`, celui rendu au moment de l'écriture (il commence par « chatgpt: »). "
          + 'La voie journalDesEcrituresChatGPT les liste tous.',
      },
    };
  }
  const phrase = typeof corps?.phrase === 'string' ? corps.phrase.trim().slice(0, 1000) : '';
  if (!phrase) {
    return {
      statut: 400,
      corps: { error: 'Phrase requise', detail: "Dis pourquoi on annule : c'est ce qui restera au journal." },
    };
  }

  return verrouEcritures.executerUneSeuleFois(`annuler:${cle}`, async () => {
    const ecriture = await trouverEcriture(cle, depot);
    if (!ecriture) {
      return {
        statut: 404,
        corps: {
          error: 'Écriture introuvable',
          detail: `Aucune écriture ChatGPT ne porte l'identifiant « ${identifiantDe(cle)} ».`,
        },
      };
    }

    // LE TÉMOIN DE L'ANNULATION : la ligne d'origine porte déjà sa date
    // d'annulation. Annuler deux fois ne rembourse donc pas deux fois.
    if (ecriture.data.annule_le) {
      return {
        statut: 200,
        corps: {
          annule: true,
          deja_fait: true,
          identifiant: identifiantDe(cle),
          resume: `Déjà annulé le ${ecriture.data.annule_le_lisible || ecriture.data.annule_le}.`,
        },
      };
    }

    const plan = planAnnulation(ecriture, { ctx, phrase });
    if (!plan.ok) {
      return { statut: plan.statut || 400, corps: { error: plan.erreur, detail: plan.detail } };
    }

    await depot.journaliser(traceAudit(plan.journal, {
      cle, phrase, ctx, identifiant: identifiantDe(cle),
    }));

    await appliquer(plan.operations, depot);

    return {
      statut: 200,
      corps: {
        annule: true,
        deja_fait: false,
        identifiant: identifiantDe(cle),
        resume: plan.resume,
        contre_passees: plan.contre_passees,
      },
    };
  });
}

/**
 * Tout ce que ChatGPT a écrit, du plus récent au plus ancien.
 *
 * Sert deux lecteurs : ChatGPT, qui doit pouvoir retrouver l'identifiant d'une
 * écriture à défaire, et l'écran « Ce que ChatGPT a écrit », qui montre la même
 * liste au gérant avec un bouton pour annuler.
 */
export async function journalDesEcritures({ depot, limite = 100 }) {
  const brut = await depot.listerEcritures();
  const ecritures = brut
    .map(resumerEcriture)
    .sort(parPlusRecent)
    .slice(0, limite);

  return {
    statut: 200,
    corps: {
      total: brut.length,
      ecritures,
      comment_annuler: "Reprendre `identifiant` et appeler annulerEcritureChatGPT. L'annulation "
        + "compense : la ligne d'origine reste en base, marquée annulée.",
    },
  };
}
