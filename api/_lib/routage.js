/**
 * Routage interne d'un point d'entrée qui en sert plusieurs.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE — CE N'EST PAS UN CHOIX D'ARCHITECTURE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Le plan Vercel Hobby plafonne le projet à 12 fonctions serverless. Le dossier
 * `api/` en comptait 13 le 17/09/2026 : le déploiement du commit `c97fae8` a
 * échoué à l'étape « Deploying outputs » alors que le build avait réussi
 * (`✓ built in 12.97s`). Plus aucun déploiement ne passait — ni le webhook Meta,
 * ni rien d'autre.
 *
 * On a donc regroupé plusieurs endpoints derrière un seul fichier, et conservé
 * les URL publiques par des `rewrites` dans `vercel.json`. Ce module est la
 * pièce qui dit, à l'intérieur du fichier fusionné, quelle logique servir.
 *
 * ⚠️ Le jour du passage au plan Pro (1000 fonctions), ce regroupement n'a plus
 * aucune raison d'être : voir la procédure de démontage en tête de
 * `api/singpay.js`.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * COMMENT LA VOIE EST DÉTERMINÉE, ET DANS QUEL ORDRE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * 1. LE CHEMIN DEMANDÉ, s'il est l'un des chemins historiques.
 *    C'est la source la plus fiable : c'est l'adresse que l'appelant a
 *    réellement composée, et pour `/api/singpay-callback` c'est celle qui est
 *    ENREGISTRÉE CHEZ SINGPAY sur le portefeuille. Sur Vercel, la réécriture
 *    remplace normalement le chemin par celui de la destination, donc ce cas ne
 *    se présente pas en production — mais s'il se présentait (exécution locale,
 *    proxy, futur changement du moteur de routage), on veut qu'il gagne.
 *
 * 2. LE PARAMÈTRE `voie`, posé par le `rewrite` dans la destination.
 *    C'est le chemin nominal en production : `/api/singpay-callback` est
 *    réécrit en `/api/singpay?voie=callback`, et Vercel fusionne la chaîne de
 *    requête d'origine (`?token=…`, `?reference=…`) avec celle de la
 *    destination.
 *
 * 3. LE DÉFAUT, uniquement là où le point d'entrée garde une identité propre
 *    (`/api/ai` sans paramètre reste le proxy IA). Là où il n'y en a pas
 *    (`/api/singpay` nu), le défaut est `null` : l'appel est refusé en 404
 *    plutôt que d'atterrir au hasard sur une branche qui écrit en base.
 *
 * Une valeur non listée dans `voies` est ignorée à chaque étape : un appelant
 * ne peut pas inventer une branche.
 */

/**
 * Chemin de la requête, sans la chaîne de requête ni l'origine.
 * Tolère les trois formes rencontrées : '/api/x', '/api/x?a=1',
 * 'https://hôte/api/x?a=1'.
 *
 * @param {{url?: string}} req
 * @returns {string} chemin normalisé, ou '' si indéterminable
 */
export function cheminDemande(req) {
  const brut = typeof req?.url === 'string' ? req.url : '';
  if (!brut) return '';
  const sansRequete = brut.split('?')[0].split('#')[0];
  // Forme absolue : on ne garde que le chemin.
  const absolue = sansRequete.match(/^[a-z][a-z0-9+.-]*:\/\/[^/]+(\/.*)?$/i);
  const chemin = absolue ? (absolue[1] || '/') : sansRequete;
  // Une barre oblique finale ne change pas la ressource demandée.
  return chemin.length > 1 ? chemin.replace(/\/+$/, '') : chemin;
}

/**
 * Première valeur valide parmi celles reçues pour un paramètre de requête.
 * Un paramètre répété (`?voie=a&voie=b`) arrive sous forme de tableau selon
 * l'hôte : on ne prend jamais une valeur hors liste blanche.
 *
 * @param {string|string[]|undefined} valeur
 * @param {string[]} voies
 * @returns {string|null}
 */
function premiereVoieValide(valeur, voies) {
  const candidats = Array.isArray(valeur) ? valeur : (valeur === undefined || valeur === null ? [] : [valeur]);
  for (const c of candidats) {
    if (typeof c === 'string' && voies.includes(c)) return c;
  }
  return null;
}

/**
 * Détermine la voie à servir.
 *
 * @param {{url?: string, query?: object}} req
 * @param {object} config
 * @param {Record<string,string>} config.cheminsConnus  chemin historique → voie.
 *        Ne JAMAIS y mettre le chemin du point d'entrée lui-même : il est la
 *        destination des réécritures, donc il porterait toutes les voies.
 * @param {string[]} config.voies  liste blanche des voies servies.
 * @param {string|null} [config.defaut]  voie servie quand rien n'est précisé.
 * @param {string} [config.parametre]  nom du paramètre de requête (défaut 'voie').
 * @returns {string|null} la voie, ou null si la demande ne correspond à rien.
 */
export function voieDemandee(req, { cheminsConnus = {}, voies = [], defaut = null, parametre = 'voie' } = {}) {
  // 1. Chemin historique.
  const chemin = cheminDemande(req);
  if (chemin && Object.prototype.hasOwnProperty.call(cheminsConnus, chemin)) {
    const voie = cheminsConnus[chemin];
    if (voies.includes(voie)) return voie;
  }

  // 2. Paramètre posé par le rewrite.
  const parParametre = premiereVoieValide(req?.query?.[parametre], voies);
  if (parParametre) return parParametre;

  // 3. Défaut explicite, ou rien.
  return defaut !== null && voies.includes(defaut) ? defaut : null;
}
