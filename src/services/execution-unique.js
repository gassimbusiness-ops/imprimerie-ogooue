/**
 * Verrou d'execution unique (single-flight) pour les operations qui touchent
 * a l'argent.
 *
 * ── Pourquoi l'idempotence « lire-puis-ecrire » ne suffit pas ─────────────
 *
 * `executerChargesDues()` et `executerPrelevementsDus()` se protegent d'un
 * double prelevement ainsi :
 *
 *     const mouvements = await db.mouvements_financiers.list();   // (1) LIRE
 *     ...
 *     const deja = mouvements.some((m) => m.reference === reference);
 *     if (!deja) await db.mouvements_financiers.create({ reference, ... }); // (2) ECRIRE
 *
 * Entre (1) et (2) il y a un aller-retour reseau. Si un SECOND appel demarre
 * pendant cet intervalle, il fait son propre (1) — et la ligne n'est pas encore
 * ecrite. Les deux appels concluent « pas encore preleve » et ecrivent tous les
 * deux. La reference est unique dans le CODE, pas dans la BASE : rien ne rejette
 * le doublon. C'est un « check-then-act » classique, et il perd la course.
 *
 * Trois facons reelles de declencher cette course dans cette application :
 *   1. React.StrictMode (src/main.jsx) monte deux fois chaque composant en
 *      developpement : deux `useEffect`, deux appels concurrents.
 *   2. Deux onglets, ou le telephone et le PC du gerant, ouverts ensemble.
 *   3. Un double-clic sur le bouton d'execution.
 *
 * ── Ce que ce verrou corrige, et ce qu'il ne corrige pas ──────────────────
 *
 * CORRIGE : les cas 1 et 3, et tout appel concurrent a l'interieur d'un meme
 * onglet. Tant qu'une execution est en vol, tout autre appel de la meme cle
 * recoit LA MEME promesse — l'operation n'a lieu qu'une fois, et les deux
 * appelants voient le meme resultat.
 *
 * NE CORRIGE PAS : le cas 2. Deux onglets sont deux contextes JavaScript
 * distincts, avec chacun son propre Map. La seule protection durable est une
 * contrainte d'unicite cote base sur `mouvements_financiers.reference`
 * (index unique partiel), qui fait rejeter le second INSERT par PostgreSQL.
 * Voir migrations/ et le rapport d'intervention.
 *
 * Le verrou est libere des que l'operation se termine (succes ou echec) : une
 * execution volontaire ulterieure reste possible, et elle est alors sequentielle
 * — donc sa lecture (1) voit bien l'ecriture (2) precedente.
 *
 * Module pur : aucun import. Teste par tests/execution-unique.test.mjs.
 */

/**
 * Cree un verrou independant.
 *
 * @returns {{
 *   executerUneSeuleFois: (cle: string, operation: () => Promise<any>) => Promise<any>,
 *   enCours: (cle: string) => boolean,
 *   nombreEnCours: () => number
 * }}
 */
export function creerVerrouExecution() {
  /** @type {Map<string, Promise<any>>} */
  const enVol = new Map();

  function executerUneSeuleFois(cle, operation) {
    if (typeof operation !== 'function') {
      return Promise.reject(new TypeError('executerUneSeuleFois attend une fonction'));
    }
    const k = String(cle);

    // Appel concurrent : on rend la promesse deja en vol. L'operation n'est
    // PAS relancee — c'est tout l'objet du verrou.
    const dejaEnVol = enVol.get(k);
    if (dejaEnVol) return dejaEnVol;

    // `Promise.resolve().then(...)` garantit que meme une operation qui leve
    // de facon synchrone ressort en promesse rejetee, jamais en exception
    // remontant jusqu'a l'appelant (regle : aucune exception ne casse un ecran).
    const promesse = Promise.resolve()
      .then(operation)
      .finally(() => { enVol.delete(k); });

    enVol.set(k, promesse);
    return promesse;
  }

  return {
    executerUneSeuleFois,
    enCours: (cle) => enVol.has(String(cle)),
    nombreEnCours: () => enVol.size,
  };
}

/**
 * Verrou partage par l'application pour les prelevements automatiques.
 * Les deux services (mensualites de credit et charges fixes) ecrivent dans la
 * meme collection `mouvements_financiers` : ils partagent donc le meme verrou.
 */
export const verrouPrelevements = creerVerrouExecution();

export const CLE_PRELEVEMENTS = 'prelevements-financiers';
