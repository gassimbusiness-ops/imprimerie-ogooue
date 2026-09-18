/**
 * Vercel Serverless Function — LE PONT CHATGPT. Un seul fichier, deux moitiés.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CE QUE LE DIRIGEANT A DEMANDÉ, ET CE QUI A ÉTÉ CONSTRUIT
 * ════════════════════════════════════════════════════════════════════════════
 *
 * D'abord, la lecture :
 *
 * « On veut directement connecter l'application avec ChatGPT. Comme ça il sait
 * tout et ça ne nous dérange pas… il donne accès à tous, pas juste un sujet
 * mais vraiment tous. »
 *
 * Puis l'écriture :
 *
 * « On aimerait, depuis ChatGPT, demander de changer quelque chose dans
 * l'application. Par exemple : "Aujourd'hui j'ai payé 100 000 francs de
 * travaux, donc tu mets dans la partie Travaux." Ou : "Cette semaine on n'a pas
 * pu faire le dépôt sur la banque, on a gardé en cash." » — et, sur la
 * confirmation : « sans confirmation, il écrit direct, mais qu'on puisse quand
 * même modifier si c'est mal fait. »
 *
 * Il veut écrire « ce mois on a fait combien ? » dans ChatGPT et obtenir LE
 * vrai chiffre. Il a été averti du risque et a tranché. Ce fichier construit ce
 * qu'il a demandé, sans le rediscuter : salaires, trésorerie, fichier clients,
 * journal d'audit — tout est lisible par ce pont, et cinq gestes nommés y sont
 * écrivables sans confirmation.
 *
 * ⚠️ L'OBJECTION, POSÉE UNE FOIS : un assistant conversationnel se trompe de
 * montant, de compte et de date sans jamais hésiter, et ici personne ne relit
 * avant que ça tombe dans une caisse réelle. Le travail est fait comme demandé.
 * Ce qui remplace la confirmation — provenance, journal préalable, annulation,
 * idempotence — vit dans `api/_lib/chatgpt-ecriture.js` et
 * `src/services/chatgpt-gestes.js`, et l'écran « Ce que ChatGPT a écrit »
 * (`/chatgpt-ecritures`) donne au gérant le bouton pour défaire.
 *
 * Une seule chose ne sort jamais : les EMPREINTES DE MOTS DE PASSE et leurs
 * sels. Ce n'est pas une donnée de l'entreprise, c'est le matériel qui protège
 * les comptes. Autoriser la lecture de sa trésorerie n'est pas autoriser
 * quelqu'un à se faire passer pour soi. Voir `api/_lib/chatgpt-lecture.js`.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⛔ UN SEUL FICHIER — CE N'EST PAS UN CHOIX D'ARCHITECTURE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Le plan **Vercel Hobby plafonne le projet à 12 fonctions serverless**, et
 * seuls les fichiers à la RACINE d'`api/` comptent. Le dossier en comptait 11
 * avant ce pont : il restait EXACTEMENT une place.
 *
 * Le 17/09/2026, à 13 fonctions, le déploiement du commit `c97fae8` a échoué à
 * « Deploying outputs » avec un build vert (`✓ built in 12.97s`). Plus aucun
 * déploiement ne passait, quel que soit le contenu du commit. C'est pour cela
 * que les sept voies de ce pont vivent derrière un seul fichier, et que toute
 * la logique métier est dans `api/_lib/` — un dossier préfixé par `_`, que
 * Vercel n'expose pas comme fonction et qui ne consomme donc aucune place.
 *
 * Le patron est celui de `api/singpay.js` et `api/ai.js` : `api/_lib/routage.js`
 * dit quelle voie servir, et `vercel.json` conserve une URL publique distincte
 * par voie — ce qui permet au schéma OpenAPI d'avoir une opération par voie,
 * chacune avec sa description. C'est cette description qui fait que ChatGPT
 * appelle la bonne.
 *
 * 🔁 À DÉFAIRE AU PASSAGE AU PLAN PRO (1000 fonctions) : voir la procédure
 * complète en tête de `api/singpay.js`. Tant qu'on est sur Hobby, ne jamais
 * ajouter un treizième fichier ici.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LE CONTRAT, DANS L'ORDRE OÙ IL EST APPLIQUÉ
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  1. LE VERBE DIT LA MOITIÉ DU PONT. Toute méthode autre que GET ou POST est
 *     refusée AVANT tout le reste. Ensuite, GET ne sert QUE les voies de
 *     lecture et POST QUE les voies d'écriture — jamais l'inverse. Un
 *     assistant qui se trompe de verbe ne tombe pas par hasard sur la bonne
 *     porte, et une voie de lecture ne peut pas devenir une voie d'écriture
 *     par distraction.
 *
 *  2. UNE PORTE SANS SERRURE RESTE FERMÉE. Si `CHATGPT_BRIDGE_TOKEN` est absent
 *     ou trop court, le pont répond 503 et ne sert RIEN — pas même le schéma.
 *     Le réflexe inverse (« pas de jeton configuré ⇒ pas de contrôle ») aurait
 *     ouvert la trésorerie, les salaires et le fichier clients à Internet au
 *     premier déploiement où quelqu'un oublie la variable.
 *
 *  3. LIMITE DE DÉBIT par IP, avec une portée à soi : le pont n'emprunte le
 *     plafond d'aucun autre endpoint et ne prête pas le sien.
 *
 *  4. JETON comparé À TEMPS CONSTANT (`empreintesEgales`, le même que la
 *     signature de session). Une comparaison naïve fuite le secret octet par
 *     octet à qui mesure le temps de réponse.
 *
 *  5. VOIE inconnue ⇒ 404 net, sans rien lire.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 🔴 COMMENT COUPER L'ACCÈS EN DIX SECONDES
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Vercel → le projet → Settings → Environment Variables → `CHATGPT_BRIDGE_TOKEN`
 * → changer la valeur (ou la supprimer) → Redeploy. Le GPT n'a plus le bon
 * jeton : chaque appel repart en 401, et si la variable est supprimée, en 503.
 * Aucune modification de code n'est nécessaire. Mode d'emploi complet :
 * `livrables_claude/PONT_CHATGPT.md`.
 *
 * Tests : `tests/chatgpt-pont.test.mjs`.
 */
import { readFileSync } from 'node:fs';
import { voieDemandee } from './_lib/routage.js';
import { limiteDepassee } from './_lib/limite.js';
import { empreintesEgales } from './_lib/session.js';
import {
  depotLecture,
  sansIdentifiants,
  champValide,
  collectionValide,
} from './_lib/chatgpt-lecture.js';
import {
  contexteTemporel,
  chiffreAffairesDuMois,
  etatCaisseParActivite,
  commandesParStatut,
  alertesStock,
} from './_lib/chatgpt-syntheses.js';
import {
  VOIES_ECRITURE,
  depotEcriture as creerDepotEcriture,
  executerGeste,
  annulerEcriture,
  journalDesEcritures,
} from './_lib/chatgpt-ecriture.js';

/**
 * Longueur minimale du jeton. 32 caractères, comme `SESSION_SECRET` : un secret
 * de huit lettres n'est pas une serrure, c'est une décoration.
 */
const LONGUEUR_MINI_JETON = 32;

/**
 * Taille maximale servie, en octets. 4 Mo, sous la limite de réponse de Vercel.
 * Au-delà, la plateforme rejette elle-même la réponse avec une erreur opaque :
 * on préfère un refus qui explique comment demander moins.
 */
const LIMITE_REPONSE_OCTETS = 4 * 1024 * 1024;

/**
 * Les voies servies en LECTURE. GET, et rien d'autre.
 *
 * `journal` est ici, et pas du côté écriture, bien qu'elle parle des écritures :
 * elle ne fait que LIRE ce que ChatGPT a déjà écrit. C'est par elle qu'il
 * retrouve l'identifiant d'une écriture à défaire.
 */
export const VOIES_LECTURE = Object.freeze([
  'inventaire',
  'collection',
  'ca-mois',
  'caisse',
  'commandes',
  'stock',
  'schema',
  'journal',
]);

/**
 * Les voies servies en ÉCRITURE. POST, et rien d'autre.
 * La liste vient de `api/_lib/chatgpt-ecriture.js` : les cinq gestes fermés du
 * dirigeant, plus l'annulation qui les défait.
 */
export { VOIES_ECRITURE };

/**
 * Liste blanche des voies servies. Une valeur hors liste n'est jamais routée.
 *
 * ⚠️ Les deux moitiés ne se recouvrent JAMAIS : une voie est soit en lecture,
 * soit en écriture. Une voie qui serait dans les deux accepterait les deux
 * verbes, et le contrôle de méthode ne voudrait plus rien dire.
 */
export const VOIES_CHATGPT = Object.freeze([...VOIES_LECTURE, ...VOIES_ECRITURE]);

/**
 * URL publique → voie. Chaque voie a la sienne pour que le schéma OpenAPI
 * puisse décrire une opération par voie ; les réécritures sont dans
 * `vercel.json`, AVANT la règle générique `/api/(.*)`.
 *
 * ⚠️ `/api/chatgpt` (le point d'entrée lui-même) n'y figure pas : il est la
 * destination des réécritures, il ne peut donc pas désigner une voie.
 */
export const CHEMINS_CHATGPT = Object.freeze({
  '/api/chatgpt-inventaire': 'inventaire',
  '/api/chatgpt-collection': 'collection',
  '/api/chatgpt-ca-mois': 'ca-mois',
  '/api/chatgpt-caisse': 'caisse',
  '/api/chatgpt-commandes': 'commandes',
  '/api/chatgpt-stock': 'stock',
  '/api/chatgpt-schema': 'schema',
  '/api/chatgpt-journal': 'journal',
  '/api/chatgpt-depense': 'depense',
  '/api/chatgpt-recette': 'recette',
  '/api/chatgpt-caisse-mouvement': 'caisse-mouvement',
  '/api/chatgpt-travaux': 'travaux',
  '/api/chatgpt-tache': 'tache',
  '/api/chatgpt-annuler': 'annuler',
  '/api/chatgpt-projet-travaux': 'projet-travaux',
  '/api/chatgpt-catalogue': 'catalogue',
  '/api/chatgpt-stock-mouvement': 'stock-mouvement',
  '/api/chatgpt-rapport': 'rapport',
  '/api/chatgpt-commande': 'commande',
  '/api/chatgpt-client': 'client',
  '/api/chatgpt-evenement': 'evenement',
  '/api/chatgpt-prospect': 'prospect',
  '/api/chatgpt-objectif': 'objectif',
  '/api/chatgpt-cloture-caisse': 'cloture-caisse',
  '/api/chatgpt-devis': 'devis',
  '/api/chatgpt-facture': 'facture',
});

/**
 * Résout la voie demandée. Exportée pour être testée sans réseau ni base.
 * Pas de voie par défaut : `/api/chatgpt` nu répond 404 plutôt que de servir
 * une voie au hasard.
 */
export function voieChatGPT(req) {
  return voieDemandee(req, {
    cheminsConnus: CHEMINS_CHATGPT,
    voies: VOIES_CHATGPT,
    defaut: null,
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   Le schéma OpenAPI — un seul exemplaire, celui du dépôt
   ═══════════════════════════════════════════════════════════════════════════ */

let schemaEnCache = null;

/**
 * Lit `api/_lib/chatgpt-openapi.json`.
 *
 * Le fichier est la SOURCE UNIQUE : la voie `schema` le sert tel quel, et un
 * test vérifie que les deux ne divergent pas. Deux schémas qui divergent, c'est
 * un GPT qui appelle dans le vide sans que personne le voie.
 *
 * `vercel.json` déclare `includeFiles` sur cette fonction pour garantir que le
 * fichier parte bien dans le paquet serverless.
 */
function schemaOpenApi() {
  if (schemaEnCache) return schemaEnCache;
  const chemin = new URL('./_lib/chatgpt-openapi.json', import.meta.url);
  schemaEnCache = JSON.parse(readFileSync(chemin, 'utf8'));
  return schemaEnCache;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Lecture des paramètres de requête
   ═══════════════════════════════════════════════════════════════════════════ */

/** Première valeur d'un paramètre (un paramètre répété arrive en tableau). */
function param(req, nom) {
  const v = req?.query?.[nom];
  const brut = Array.isArray(v) ? v[0] : v;
  return brut === undefined || brut === null ? null : String(brut);
}

/** Entier borné, avec repli sur le défaut si la valeur est absurde. */
function entier(valeur, { defaut, min, max }) {
  const n = Number.parseInt(String(valeur ?? ''), 10);
  if (!Number.isFinite(n)) return defaut;
  return Math.min(max, Math.max(min, n));
}

const RE_MOIS = /^\d{4}-\d{2}$/;

/**
 * Le corps JSON d'une requête d'écriture.
 *
 * Vercel analyse déjà `application/json` et pose l'objet sur `req.body` ; les
 * tests le posent directement. On tolère la chaîne pour les exécutions locales
 * où l'analyse n'a pas eu lieu — et un JSON illisible rend `null`, ce que la
 * couche d'écriture refuse avec un message qui dit quoi envoyer.
 */
function corpsJson(req) {
  const brut = req?.body;
  if (brut === undefined || brut === null || brut === '') return null;
  if (typeof brut === 'string') {
    try { return JSON.parse(brut); } catch { return null; }
  }
  if (typeof brut === 'object') return brut;
  return null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Les voies
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Sert une voie de LECTURE. Rend `{ statut, corps }` — jamais de réponse HTTP
 * directement, pour que l'enveloppe (date de calcul, assainissement) soit posée
 * à UN SEUL endroit, celui qui ne peut pas être oublié.
 */
async function servir(voie, req, depot, ctx, depotE) {
  switch (voie) {
    case 'journal':
      return journalDesEcritures({
        depot: depotE,
        limite: entier(param(req, 'limite'), { defaut: 100, min: 1, max: 300 }),
      });

    case 'schema':
      return { statut: 200, corps: { schema: schemaOpenApi() } };

    case 'inventaire': {
      const collections = await depot.listerCollections();
      return {
        statut: 200,
        corps: {
          collections,
          total_lignes: collections.reduce((s, c) => s + c.lignes, 0),
          comment_lire:
            "Utiliser l'opération lireUneCollection avec le nom exact d'une collection ci-dessus. "
            + 'Pour un chiffre du mois, préférer les synthèses : ca-mois, caisse, commandes, stock.',
        },
      };
    }

    case 'collection': {
      const collection = param(req, 'collection');
      if (!collection) {
        return {
          statut: 400,
          corps: {
            error: 'Paramètre `collection` requis',
            detail: "Appeler d'abord inventaireDesDonnees pour connaître les collections disponibles.",
          },
        };
      }
      if (!collectionValide(collection)) {
        return { statut: 400, corps: { error: 'Nom de collection invalide', detail: 'Lettres, chiffres et tirets bas uniquement.' } };
      }
      const champ = param(req, 'champ');
      if (champ !== null && !champValide(champ)) {
        return { statut: 400, corps: { error: 'Nom de champ invalide', detail: 'Lettres, chiffres et tirets bas uniquement.' } };
      }
      const valeur = param(req, 'valeur');
      const limite = entier(param(req, 'limite'), { defaut: 50, min: 1, max: 200 });
      const decalage = entier(param(req, 'decalage'), { defaut: 0, min: 0, max: 1_000_000 });

      const filtre = champ ? { champ, valeur } : {};
      const [lignes, total] = await Promise.all([
        depot.lirePage(collection, { limite, decalage, ...filtre }),
        depot.compter(collection, filtre),
      ]);

      return {
        statut: 200,
        corps: {
          collection,
          total,
          limite,
          decalage,
          filtre: champ ? { champ, valeur } : null,
          lignes,
          page_suivante: decalage + lignes.length < total
            ? { decalage: decalage + lignes.length, limite }
            : null,
        },
      };
    }

    case 'ca-mois': {
      const demande = param(req, 'mois');
      const mois = demande && RE_MOIS.test(demande) ? demande : ctx.mois_local;
      const [factures, commandes, rapports] = await Promise.all([
        depot.lireTout('factures'),
        depot.lireTout('commandes'),
        depot.lireTout('rapports'),
      ]);
      return {
        statut: 200,
        corps: chiffreAffairesDuMois({ mois, factures, commandes, rapports }),
      };
    }

    case 'caisse': {
      const [rapports, clotures, comptes] = await Promise.all([
        depot.lireTout('rapports'),
        depot.lireTout('clotures_caisse'),
        depot.lireTout('comptes_bancaires'),
      ]);
      return {
        statut: 200,
        corps: etatCaisseParActivite({ rapports, clotures, comptes, aujourdhui: ctx.date_locale }),
      };
    }

    case 'commandes': {
      const commandes = await depot.lireTout('commandes');
      return { statut: 200, corps: commandesParStatut({ commandes, aujourdhui: ctx.date_locale }) };
    }

    case 'stock': {
      const produits = await depot.lireTout('produits');
      return { statut: 200, corps: alertesStock({ produits }) };
    }

    /* c8 ignore next 2 — `voie` vient d'une liste blanche, ce cas est injoignable */
    default:
      return { statut: 404, corps: { error: 'Voie inconnue' } };
  }
}

/**
 * Sert une voie d'ÉCRITURE. Même contrat de retour que `servir()` : la décision
 * et l'exécution vivent dans `api/_lib/chatgpt-ecriture.js`, ce fichier ne fait
 * que router et poser l'enveloppe.
 */
async function servirEcriture(voie, req, depotE, ctx) {
  const corps = corpsJson(req);
  if (voie === 'annuler') return annulerEcriture({ corps, depot: depotE, ctx });
  return executerGeste({ geste: voie, corps, depot: depotE, ctx });
}

/* ═══════════════════════════════════════════════════════════════════════════
   Le gestionnaire
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Fabrique le gestionnaire.
 *
 * `depot`, `depotEcriture` et `maintenant` sont injectables : c'est la seule
 * façon de prouver sans base de données qu'un GET n'atteint AUCUNE écriture,
 * qu'une même clé d'idempotence n'écrit qu'une fois, et qu'un « aujourd'hui »
 * du serveur en UTC ne devient pas la date de Moanda par accident.
 */
export function creerGestionnairePont({
  depot = null, depotEcriture = null, maintenant = () => new Date(),
} = {}) {
  return async function handler(req, res) {
    /* 1. LE VERBE, avant tout le reste — y compris avant de savoir qui appelle.
     *
     * Le pont n'accepte que deux verbes en tout. PUT, PATCH, DELETE, OPTIONS et
     * HEAD sont refusés ici, sans jamais atteindre ni une lecture ni une
     * écriture. Le contrôle FIN (GET pour la lecture, POST pour l'écriture) a
     * lieu une fois la voie connue, à l'étape 5 : il exige de savoir laquelle,
     * et savoir laquelle après s'être authentifié évite d'apprendre à un
     * inconnu quelles voies existent. */
    if (req.method !== 'GET' && req.method !== 'POST') {
      return res.status(405).json({
        error: 'Méthode non autorisée',
        detail: 'Ce pont accepte GET pour lire et POST pour écrire, rien d\'autre.',
      });
    }

    /* 2. Une porte sans serrure reste fermée. */
    const attendu = process.env.CHATGPT_BRIDGE_TOKEN;
    if (!attendu || attendu.length < LONGUEUR_MINI_JETON) {
      return res.status(503).json({
        error: 'Pont ChatGPT non configuré',
        detail:
          `CHATGPT_BRIDGE_TOKEN est absent ou fait moins de ${LONGUEUR_MINI_JETON} caractères. `
          + "Tant qu'aucun jeton n'est défini, ce point d'accès ne sert rien.",
      });
    }

    /* 3. Limite de débit, avec une portée à soi — et deux plafonds.
     *
     * L'écriture a le sien, plus serré : une boucle d'appels en lecture coûte
     * du temps de fonction, une boucle d'appels en écriture coûte des lignes
     * dans une caisse. Les deux portées sont distinctes pour que l'une ne
     * consomme jamais le plafond de l'autre — c'est la raison d'être du
     * paramètre `portee` de `api/_lib/limite.js`. */
    const enEcriture = req.method === 'POST';
    const plafond = enEcriture
      ? { max: 20, fenetreMs: 60_000, portee: 'chatgpt-ecriture' }
      : { max: 60, fenetreMs: 60_000, portee: 'chatgpt' };
    if (limiteDepassee(req, plafond)) {
      return res.status(429).json({ error: 'Trop de requêtes' });
    }

    /* 4. Le jeton, comparé à temps constant.
     *
     * Le refus DIT CE QU'IL A REÇU — le schéma, jamais la valeur. Sans ça, un
     * GPT configuré en « Basic » au lieu de « Bearer » (le défaut de ChatGPT)
     * rend le même « jeton invalide » qu'une clé réellement fausse, et on
     * cherche du mauvais côté. Le schéma n'est pas un secret : il voyage en
     * clair dans l'en-tête. La valeur, elle, ne sort jamais.
     */
    const entete = req.headers?.authorization || req.headers?.Authorization || '';
    const brut = typeof entete === 'string' ? entete : '';
    const presente = brut.startsWith('Bearer ') ? brut.slice(7) : '';
    if (!presente || !empreintesEgales(presente, attendu)) {
      const schemaRecu = brut ? (brut.split(' ')[0] || '(sans schéma)') : null;
      return res.status(401).json({
        error: 'Jeton du pont invalide ou absent',
        detail: schemaRecu === null
          ? "Aucun en-tête Authorization n'est arrivé. Dans le GPT : Action → "
            + 'Authentification → Clé API, puis colle la clé.'
          : schemaRecu === 'Bearer'
            ? 'Le schéma Bearer est correct : c\'est la VALEUR de la clé qui ne '
              + "correspond pas à CHATGPT_BRIDGE_TOKEN. Vérifie qu'aucun espace "
              + "ne traîne, et que Vercel a été redéployé depuis le dernier changement."
            : `Reçu « ${schemaRecu} », attendu « Bearer ». Dans le GPT : `
              + 'Authentification → Clé API → Type d\'authentification → Bearer. '
              + "C'est le piège le plus courant : ChatGPT propose Basic par défaut.",
      });
    }

    /* 5. La voie, puis LE VERBE QUI LUI CORRESPOND.
     *
     * C'est le contrôle qui empêche les deux moitiés du pont de se recouvrir :
     * une voie de lecture refuse POST, une voie d'écriture refuse GET. Sans
     * lui, un GET sur `/api/chatgpt-depense` tomberait dans la branche
     * d'écriture avec un corps vide — et un jour, avec un corps. */
    const voie = voieChatGPT(req);
    if (!voie) {
      return res.status(404).json({
        error: 'Voie inconnue',
        detail: `Voies servies : ${VOIES_CHATGPT.join(', ')}.`,
      });
    }

    const voieEcriture = VOIES_ECRITURE.includes(voie);
    if (voieEcriture !== enEcriture) {
      return res.status(405).json({
        error: 'Méthode non autorisée pour cette voie',
        detail: voieEcriture
          ? `« ${voie} » écrit dans l'application : elle s'appelle en POST, avec un corps JSON.`
          : `« ${voie} » est une voie de lecture : elle s'appelle en GET.`,
      });
    }

    const ctx = contexteTemporel(maintenant());

    let resultat;
    try {
      resultat = voieEcriture
        ? await servirEcriture(voie, req, depotEcriture || creerDepotEcriture(), ctx)
        : await servir(voie, req, depot || depotLecture(), ctx, depotEcriture || creerDepotEcriture());
    } catch (e) {
      console.error('[pont ChatGPT] %s :', voie, e?.message);
      if (voieEcriture) {
        return res.status(500).json({
          error: 'Écriture impossible',
          detail: "La base n'a pas répondu. RIEN n'a peut-être été écrit — ou une partie seulement : "
            + "consulte le journal des écritures ChatGPT avant de réessayer, et si tu réessaies, "
            + 'reprends LA MÊME clé d\'idempotence pour ne pas écrire deux fois.',
          calcule_le: ctx,
        });
      }
      return res.status(500).json({
        error: 'Lecture impossible',
        detail: "La base n'a pas répondu. Le chiffre n'est PAS zéro : il est inconnu.",
        calcule_le: ctx,
      });
    }

    /* L'enveloppe, posée à un seul endroit : la date de calcul et le filtre des
       identifiants s'appliquent à TOUTES les voies, sans exception possible. */
    const corps = sansIdentifiants({ calcule_le: ctx, ...resultat.corps });

    /* Garde-fou de taille. `produits_catalogue` contient 195 lignes dont UNE de
       3,2 Mo d'images en base64 (mesuré le 17/09/2026) : une page de 50 lignes
       peut donc dépasser la limite de réponse de Vercel, qui la rejette alors
       avec une erreur de plateforme opaque — ChatGPT afficherait « l'outil n'a
       pas répondu » sans que personne sache pourquoi. Mieux vaut un refus qui
       dit quoi faire. */
    const octets = Buffer.byteLength(JSON.stringify(corps), 'utf8');
    if (octets > LIMITE_REPONSE_OCTETS && resultat.statut === 200) {
      return res.status(413).json({
        error: 'Réponse trop volumineuse',
        detail:
          `Cette lecture pèse ${Math.round(octets / 1024)} Ko, au-dessus de la limite servie. `
          + 'Rappeler avec une `limite` plus petite (par exemple 5), ou filtrer avec `champ` et `valeur`. '
          + 'Certaines collections contiennent des images en base64 sur une seule ligne.',
        calcule_le: ctx,
      });
    }

    return res.status(resultat.statut).json(corps);
  };
}

export default creerGestionnairePont();
