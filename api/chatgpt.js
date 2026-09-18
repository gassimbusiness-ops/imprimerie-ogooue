/**
 * Vercel Serverless Function — LE PONT CHATGPT. Un seul fichier, sept voies.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CE QUE LE DIRIGEANT A DEMANDÉ, ET CE QUI A ÉTÉ CONSTRUIT
 * ════════════════════════════════════════════════════════════════════════════
 *
 * « On veut directement connecter l'application avec ChatGPT. Comme ça il sait
 * tout et ça ne nous dérange pas… il donne accès à tous, pas juste un sujet
 * mais vraiment tous. »
 *
 * Il veut écrire « ce mois on a fait combien ? » dans ChatGPT et obtenir LE
 * vrai chiffre. Il a été averti du risque et a tranché. Ce fichier construit ce
 * qu'il a demandé, sans le rediscuter : salaires, trésorerie, fichier clients,
 * journal d'audit — tout est lisible par ce pont.
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
 *  1. LECTURE SEULE. Toute méthode autre que GET est refusée AVANT la moindre
 *     lecture. Un assistant qui se trompe de verbe ne supprime pas une facture.
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

/** Liste blanche des voies servies. Une valeur hors liste n'est jamais routée. */
export const VOIES_CHATGPT = Object.freeze([
  'inventaire',
  'collection',
  'ca-mois',
  'caisse',
  'commandes',
  'stock',
  'schema',
]);

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

/* ═══════════════════════════════════════════════════════════════════════════
   Les voies
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Sert une voie. Rend `{ statut, corps }` — jamais de réponse HTTP directement,
 * pour que l'enveloppe (date de calcul, assainissement) soit posée à UN SEUL
 * endroit, celui qui ne peut pas être oublié.
 */
async function servir(voie, req, depot, ctx) {
  switch (voie) {
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

/* ═══════════════════════════════════════════════════════════════════════════
   Le gestionnaire
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Fabrique le gestionnaire.
 *
 * `depot` et `maintenant` sont injectables : c'est la seule façon de prouver
 * sans base de données qu'une requête POST n'atteint AUCUNE lecture, et qu'un
 * « aujourd'hui » du serveur en UTC ne devient pas la date de Moanda par
 * accident.
 */
export function creerGestionnairePont({ depot = null, maintenant = () => new Date() } = {}) {
  return async function handler(req, res) {
    /* 1. LECTURE SEULE — avant tout le reste, y compris avant de savoir qui appelle. */
    if (req.method !== 'GET') {
      return res.status(405).json({
        error: 'Méthode non autorisée',
        detail: 'Ce pont est en lecture seule : seul GET est accepté.',
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

    /* 3. Limite de débit, avec une portée à soi. */
    if (limiteDepassee(req, { max: 60, fenetreMs: 60_000, portee: 'chatgpt' })) {
      return res.status(429).json({ error: 'Trop de requêtes' });
    }

    /* 4. Le jeton, comparé à temps constant. */
    const entete = req.headers?.authorization || req.headers?.Authorization || '';
    const presente = typeof entete === 'string' && entete.startsWith('Bearer ') ? entete.slice(7) : '';
    if (!presente || !empreintesEgales(presente, attendu)) {
      return res.status(401).json({ error: 'Jeton du pont invalide ou absent' });
    }

    /* 5. La voie. */
    const voie = voieChatGPT(req);
    if (!voie) {
      return res.status(404).json({
        error: 'Voie inconnue',
        detail: `Voies servies : ${VOIES_CHATGPT.join(', ')}.`,
      });
    }

    const ctx = contexteTemporel(maintenant());

    let resultat;
    try {
      resultat = await servir(voie, req, depot || depotLecture(), ctx);
    } catch (e) {
      console.error('[pont ChatGPT] %s :', voie, e?.message);
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
