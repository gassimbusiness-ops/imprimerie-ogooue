/**
 * LA CONCURRENCE BORNÉE — et pourquoi elle est bornée.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LE PROBLÈME MESURÉ, LE 19/09/2026 À 13 H 29
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Journal du passage réel : « 41 reporté(s) au prochain passage (budget temps
 * épuisé, **51714 ms** sur un budget de 25000 ms) ». Le chronomètre part au
 * début de l'alimentation : le budget d'hébergement était donc ENTIÈREMENT
 * consommé par la lecture du Drive, avant le premier téléversement.
 *
 * `maxDuration` vaut 60 s. La lecture seule en prenait 52, pour 16
 * publications — 86 % du plafond. À 20 publications la fonction EXPIRE, et une
 * fonction qui expire n'empêche pas seulement d'alimenter : elle empêche de
 * PUBLIER ce qui est déjà en file.
 *
 * Le temps ne venait pas d'un calcul lourd : il venait d'une FILE INDIENNE
 * d'appels réseau. Pour 16 publications, la lecture enchaînait un listing de
 * dossier puis un téléchargement de manifeste par publication, puis un
 * téléchargement de légende par canal — chacun attendant le précédent alors
 * qu'aucun ne dépend de l'autre. Le coût n'est pas le nombre d'appels : c'est
 * leur PROFONDEUR.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 🔴 POURQUOI UNE BORNE, ET PAS `Promise.all()` SUR TOUT
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Google impose des quotas par utilisateur et par projet (Drive API : 12 000
 * requêtes par minute et par projet, et un plafond par utilisateur plus bas).
 * Lâcher 64 requêtes d'un coup, c'est se faire refuser en 403
 * `userRateLimitExceeded` — et un refus de quota ressemble, dans les motifs
 * affichés au gérant, à un dossier non partagé. On échangerait un défaut de
 * lenteur contre un défaut de mensonge.
 *
 * Une concurrence BORNÉE garde les deux propriétés : la profondeur tombe d'un
 * facteur égal à la borne, et le débit instantané reste sous le quota.
 *
 * ⚠️ Cette fonction préserve l'ORDRE des résultats. Les motifs d'écartement et
 *    les publications sont affichés au gérant de Moanda dans l'ordre où le
 *    Drive les rend : un parallélisme qui les mélangerait rendrait l'écran
 *    différent à chaque passage sans que rien n'ait changé.
 */

/**
 * La borne retenue pour les appels Google. Assez haut pour diviser la
 * profondeur par six, assez bas pour rester très loin des quotas Drive.
 * Ce n'est pas un chiffre magique : c'est le compromis entre « une file
 * indienne » (1) et « un refus de quota » (l'infini).
 */
export const CONCURRENCE_PAR_DEFAUT = 6;

/**
 * Applique `travail` à chaque élément, au plus `borne` à la fois.
 *
 * ⛔ NE LÈVE JAMAIS À LA PLACE DU TRAVAIL : une exception levée par `travail`
 *    remonte telle quelle, mais les travaux déjà lancés vont à leur terme
 *    (aucun n'est abandonné en vol). C'est ce que fait déjà `lireParRecherche`
 *    avec son `try` par dossier : la décision « cette panne emporte-t-elle les
 *    autres ? » appartient à l'appelant, pas à l'ordonnanceur.
 *
 * @template T, R
 * @param {T[]} elements
 * @param {number} borne  nombre maximum de travaux simultanés (≥ 1)
 * @param {(element: T, index: number) => Promise<R>} travail
 * @returns {Promise<R[]>} les résultats, DANS L'ORDRE des éléments
 */
export async function enParalleleBorne(elements, borne, travail) {
  const liste = [...elements];
  const resultats = new Array(liste.length);
  if (liste.length === 0) return resultats;

  const largeur = Math.max(1, Math.min(Math.floor(borne) || 1, liste.length));
  let prochain = 0;
  let premiereErreur = null;

  /* Chaque « couloir » tire le prochain élément disponible plutôt que de se
     voir attribuer une tranche fixe : un dossier lent ne bloque pas les autres
     de sa tranche. */
  async function couloir() {
    for (;;) {
      const i = prochain;
      prochain += 1;
      if (i >= liste.length) return;
      try {
        resultats[i] = await travail(liste[i], i);
      } catch (err) {
        // On retient la PREMIÈRE erreur et on laisse les autres couloirs finir :
        // abandonner en vol laisserait des requêtes sans lecteur, et le
        // compteur de requêtes du client ne compterait plus ce qui est parti.
        if (premiereErreur === null) premiereErreur = err;
        return;
      }
    }
  }

  await Promise.all(Array.from({ length: largeur }, couloir));
  if (premiereErreur !== null) throw premiereErreur;
  return resultats;
}
