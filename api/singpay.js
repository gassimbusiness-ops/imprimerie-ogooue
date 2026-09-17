/**
 * Vercel Serverless Function — POINT D'ENTRÉE UNIQUE DES TROIS VOIES SINGPAY.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⛔ CE FICHIER N'EST PAS UN CHOIX D'ARCHITECTURE. C'EST UNE CONTRAINTE DE PLAN.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Le plan **Vercel Hobby plafonne le projet à 12 fonctions serverless**. Le
 * dossier `api/` en a compté 13 le 17/09/2026, à l'ajout de `api/meta-webhook.js`.
 * Résultat mesuré sur le commit `c97fae8` : le build réussit
 * (`✓ built in 12.97s`, `Build Completed`) puis le déploiement échoue à
 * « Deploying outputs », statut ERROR. Le déploiement de production précédent
 * portait `"lambdaRuntimeStats": {"nodejs": 12}` — pile à la limite.
 *
 * Tant que ce plafond n'était pas respecté, **plus aucun déploiement ne
 * passait**, quel que soit le contenu du commit.
 *
 * Les trois voies SingPay ont donc été regroupées derrière ce fichier :
 * 3 fonctions → 1, soit deux places rendues (avec la fusion `zakat-analyse`
 * dans `api/ai.js`, le total passe de 13 à 10).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ LES TROIS URL PUBLIQUES N'ONT PAS CHANGÉ — ET NE DOIVENT PAS CHANGER
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   /api/singpay-initiate   →  voie « initiate »
 *   /api/singpay-status     →  voie « status »
 *   /api/singpay-callback   →  voie « callback »
 *
 * Ce ne sont pas de simples URL internes :
 *
 * `/api/singpay-callback` est **enregistrée chez SingPay**, sur le portefeuille
 * (`transaction.portefeuille.callbackURL`, relevée en base sur les 3
 * transactions réelles du 31/05/2026). Elle ne vit pas dans ce dépôt. Si ce
 * chemin cessait de répondre, le rappel serveur-à-serveur n'arriverait plus le
 * jour du GoLive — et personne ne s'en apercevrait avant qu'un client ait payé
 * sans que sa commande parte en production.
 *
 * `/api/singpay-initiate` et `/api/singpay-status` sont appelées par l'écran
 * `src/features/paiements/page.jsx` et le portail client
 * `src/features/client-portal/commandes.jsx` — y compris par les versions déjà
 * installées en PWA sur les téléphones de l'atelier, qu'un déploiement ne met
 * pas à jour instantanément.
 *
 * La conservation des chemins se fait dans `vercel.json`, section `rewrites`,
 * AVANT la règle générique `/api/(.*)` (la première règle qui correspond gagne) :
 *
 *   { "source": "/api/singpay-initiate", "destination": "/api/singpay?voie=initiate" }
 *   { "source": "/api/singpay-status",   "destination": "/api/singpay?voie=status"   }
 *   { "source": "/api/singpay-callback", "destination": "/api/singpay?voie=callback" }
 *
 * Vercel fusionne la chaîne de requête d'origine avec celle de la destination :
 * `?reference=…` (sondage) et `?token=…` (secret du rappel) arrivent intacts.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CE QUI N'A PAS BOUGÉ D'UN OCTET
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Les trois logiques métier sont les mêmes fichiers, déplacés tels quels dans
 * `api/_lib/` — un dossier préfixé par `_`, que Vercel n'expose pas comme
 * fonction et qui ne compte donc pas dans le plafond :
 *
 *   api/singpay-initiate.js  →  api/_lib/singpay-initiate.js
 *   api/singpay-status.js    →  api/_lib/singpay-status.js
 *   api/singpay-callback.js  →  api/_lib/singpay-callback.js
 *
 * Seuls leurs chemins d'import relatifs ont été ajustés. Les gardes de sécurité
 * restent à l'identique et dans le même ordre : vérification du secret de
 * rappel, plafonds opérateur avant appel à la passerelle, limitation de débit
 * du sondage, idempotence de l'encaissement arbitrée par l'insertion du
 * mouvement de trésorerie (`api/_lib/singpay-encaissement.js`).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 🔁 CE QU'IL FAUDRA DÉFAIRE LE JOUR DU PASSAGE AU PLAN PRO
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Le plan Pro porte la limite à 1000 fonctions. Le regroupement n'a alors plus
 * aucune justification et il vaut mieux revenir à un fichier par endpoint —
 * c'est plus lisible, et le routage interne cesse d'être une pièce à maintenir.
 * Procédure, dans cet ordre :
 *
 *   1. remonter les trois fichiers : `api/_lib/singpay-*.js` → `api/singpay-*.js`,
 *      et rétablir leurs imports (`./x.js` → `./_lib/x.js`,
 *      `../../src/lib/singpayAuth.js` → `../src/lib/singpayAuth.js`) ;
 *   2. supprimer les trois `rewrites` SingPay de `vercel.json` (les fichiers
 *      reprennent leur chemin naturel, la réécriture devient inutile) ;
 *   3. supprimer ce fichier ;
 *   4. faire de même pour `zakat-analyse` (voir l'en-tête de `api/ai.js`) ;
 *   5. `api/_lib/routage.js` n'a alors plus d'appelant : le supprimer aussi ;
 *   6. déployer en PRÉVISUALISATION et vérifier que les trois chemins répondent
 *      AVANT de promouvoir. Ne jamais changer `callbackURL` chez SingPay :
 *      les chemins publics sont identiques dans les deux montages.
 *
 * Tests de non-régression du routage : `tests/routage-api.test.mjs`.
 */
import { voieDemandee } from './_lib/routage.js';
import initiate from './_lib/singpay-initiate.js';
import status from './_lib/singpay-status.js';
import callback from './_lib/singpay-callback.js';

/** Liste blanche des voies servies. Une valeur hors liste n'est jamais routée. */
export const VOIES_SINGPAY = Object.freeze(['initiate', 'status', 'callback']);

/**
 * Chemins publics historiques → voie.
 * ⚠️ `/api/singpay` (le point d'entrée lui-même) n'y figure pas : il est la
 * destination des trois réécritures, il ne peut donc pas désigner une voie.
 */
export const CHEMINS_SINGPAY = Object.freeze({
  '/api/singpay-initiate': 'initiate',
  '/api/singpay-status': 'status',
  '/api/singpay-callback': 'callback',
});

const HANDLERS = { initiate, status, callback };

/**
 * Résout la voie demandée. Exportée pour être testée sans réseau ni base.
 * @param {{url?: string, query?: object}} req
 * @returns {'initiate'|'status'|'callback'|null}
 */
export function voieSingPay(req) {
  return voieDemandee(req, {
    cheminsConnus: CHEMINS_SINGPAY,
    voies: VOIES_SINGPAY,
    defaut: null, // pas de voie par défaut : mieux vaut un 404 net qu'une écriture au hasard
  });
}

export default async function handler(req, res) {
  const voie = voieSingPay(req);

  if (!voie) {
    /* Aucune voie reconnue. On refuse explicitement plutôt que de laisser la
       requête tomber sur une branche arbitraire : ces trois voies écrivent en
       base et touchent de l'argent. Un 404 bruyant se diagnostique ; un
       encaissement appliqué à la mauvaise transaction, non. */
    console.warn('[SingPay] Voie inconnue pour %s %s', req?.method, req?.url);
    return res.status(404).json({
      error: 'Voie SingPay inconnue',
      detail: 'Utilisez /api/singpay-initiate, /api/singpay-status ou /api/singpay-callback',
    });
  }

  return HANDLERS[voie](req, res);
}
