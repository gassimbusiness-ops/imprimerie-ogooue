/**
 * Echec de LECTURE en base — type, message, et verdict d'affichage.
 *
 * ── Pourquoi ce module existe ─────────────────────────────────────────────
 *
 * `src/services/db.js` avalait les echecs de lecture :
 *
 *     if (error) { console.error(`[db] list ${this.name}:`, error.message); return []; }
 *
 * `list()` n'echouait donc JAMAIS. Sur une coupure reseau a Moanda — assez
 * frequentes pour que l'equipe tienne ses rapports sur Excel les jours de
 * coupure — elle rendait un tableau VIDE, et l'ecran affichait « Aucun rapport
 * ce mois-ci ».
 *
 * « Aucun rapport ce mois-ci » et « je n'ai pas pu charger les rapports » sont
 * deux phrases differentes. Les confondre a deja fait conclure faux dans ce
 * dossier (lecon du 13/09 : une absence constatee n'est pas une absence).
 * Ajouter un `try/catch` dans les 130 ecrans concernes n'y aurait rien change :
 * il n'y avait rien a attraper.
 *
 * Module PUR : aucun import, pas de React, pas de toast — pour que `db.js`
 * puisse en dependre sans tirer l'interface. La couche React est dans
 * `src/services/chargement.js`, qui reexporte ce fichier.
 *
 * Teste par tests/chargement.test.mjs.
 */

/**
 * Compose le message montre au gerant quand une LECTURE echoue.
 *
 * Il doit dire trois choses, et surtout ne pas en dire une quatrieme :
 *   - ce qui n'a pas pu etre lu ;
 *   - que la donnee n'est pas perdue (sinon on croit a un effacement) ;
 *   - quoi faire.
 * Il ne doit JAMAIS contenir « aucun », « aucune » ni « vide » : c'est
 * exactement la confusion qu'on corrige.
 *
 * @param {string} quoi libelle francais de ce qu'on chargeait
 * @returns {string}
 */
export function messageEchecChargement(quoi) {
  const sujet = quoi || 'les données';
  return `Impossible de charger ${sujet}. La connexion n'a pas répondu — `
    + "rien n'a été effacé. Vérifiez la connexion, puis réessayez.";
}

/** Erreur levee par la couche de donnees quand une LECTURE echoue. */
export class ErreurLecture extends Error {
  /**
   * @param {{collection: string, operation?: string, libelle?: string, cause?: any}} infos
   */
  constructor({ collection, operation = 'list', libelle, cause }) {
    const causeTexte = cause && cause.message ? String(cause.message)
      : (typeof cause === 'string' ? cause : undefined);
    super(messageEchecChargement(libelle || `« ${collection} »`));
    this.name = 'ErreurLecture';
    this.collection = collection;
    this.operation = operation;
    this.causeTexte = causeTexte;
    // Comme pour ErreurEcriture : on ne se fie pas a `instanceof` seul, Vite
    // pouvant servir deux instances du meme module en developpement.
    this.estErreurLecture = true;
  }
}

/**
 * Vrai si la valeur est un echec de lecture en base.
 * @param {*} valeur
 * @returns {boolean}
 */
export function estErreurLecture(valeur) {
  return Boolean(valeur && typeof valeur === 'object' && valeur.estErreurLecture === true);
}

/**
 * Decide ce qu'un ecran doit afficher. Fonction PURE — c'est elle qu'on teste.
 *
 * L'ordre compte : l'erreur passe AVANT le vide. Un chargement rate laisse
 * forcement une liste vide ; si le vide gagnait, on afficherait « aucune
 * donnee » sur une panne reseau, c'est-a-dire le bug qu'on corrige.
 *
 * @param {{enCours?: boolean, erreur?: any, nombre?: number, quoi?: string}} etat
 * @returns {{mode: 'chargement'|'erreur'|'vide'|'donnees', message: string|null}}
 */
export function verdictChargement({ enCours, erreur, nombre, quoi } = {}) {
  if (erreur) {
    const message = quoi
      ? messageEchecChargement(quoi)
      : String((erreur && erreur.message) || messageEchecChargement(null));
    return { mode: 'erreur', message };
  }
  if (enCours) return { mode: 'chargement', message: null };
  if (!nombre) return { mode: 'vide', message: null };
  return { mode: 'donnees', message: null };
}
