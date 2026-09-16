/**
 * Filet global des echecs d'ecriture.
 *
 * ── Pourquoi ce filet existe ──────────────────────────────────────────────
 *
 * Faire lever `db.update()` et `db.delete()` (constat C6) ne suffit pas : 76
 * des 99 appels d'ecriture de l'application ne sont dans AUCUN `try`. Sans
 * filet, on remplacerait « un toast vert sur un echec » par « aucun message du
 * tout » — le handler s'arrete au milieu, le dialogue reste ouvert, la liste
 * n'est pas rechargee, et le gerant ne sait toujours pas ce qui s'est passe.
 *
 * Reprendre les 76 sites un par un dans une seule intervention, c'est 76
 * occasions de casser un ecran. La regle du projet est l'inverse : petit,
 * testable, rollbackable. On procede donc en deux temps :
 *
 *   1. CE FILET, pose une fois, attrape TOUT rejet non rattrape qui est un
 *      `ErreurEcriture` et l'affiche. Plus aucun echec d'ecriture ne peut etre
 *      silencieux, nulle part, des le premier jour.
 *   2. Les sites qui touchent a l'argent sont repris explicitement, pour dire
 *      quelque chose de plus precis que le message generique.
 *
 * ── Ce que le filet ne fait pas ───────────────────────────────────────────
 *
 * Il n'avale rien : les autres rejets (bug de code, reseau, promesse tierce)
 * gardent leur comportement d'origine et continuent d'apparaitre en console.
 * Il ne remplace pas un `try/catch` local — il garantit seulement un plancher.
 *
 * ── Regle du 14/09 ────────────────────────────────────────────────────────
 *
 * Ce module est appele depuis main.jsx. Il ne doit JAMAIS pouvoir empecher le
 * rendu : `installerFiletEcriture` ne leve pas, meme sans `window`, meme si
 * l'affichage du message echoue.
 *
 * La logique de decision est pure et testee par tests/filet-ecriture.test.mjs.
 */
import { estErreurEcriture } from './erreur-ecriture.js';

/**
 * Faut-il signaler ce rejet au gerant ?
 *
 * Fonction pure, sans DOM : c'est elle qu'on teste.
 *
 * @param {*} raison la valeur portee par le rejet
 * @returns {{signaler: boolean, message: string|null}}
 */
export function verdictRejet(raison) {
  if (!estErreurEcriture(raison)) return { signaler: false, message: null };
  return { signaler: true, message: String(raison.message || 'Écriture refusée.') };
}

/**
 * Deduplique les messages identiques rapproches dans le temps.
 *
 * Une coupure reseau fait echouer plusieurs ecritures d'affilee (le solde ET
 * le mouvement, par exemple). Empiler cinq toasts identiques n'informe pas
 * davantage, ca cache l'ecran.
 *
 * @param {number} [fenetreMs]
 * @returns {(message: string, maintenant?: number) => boolean} vrai s'il faut afficher
 */
export function creerAntiRepetition(fenetreMs = 4000) {
  const vus = new Map();
  return function afficher(message, maintenant = Date.now()) {
    const precedent = vus.get(message);
    if (precedent !== undefined && maintenant - precedent < fenetreMs) return false;
    vus.set(message, maintenant);
    // Purge : on ne garde pas indefiniment les messages passes.
    for (const [cle, t] of vus) {
      if (maintenant - t >= fenetreMs * 4) vus.delete(cle);
    }
    return true;
  };
}

/**
 * Pose le filet sur `window`. Idempotent : deux appels ne posent qu'un seul
 * ecouteur (React.StrictMode monte deux fois en developpement).
 *
 * @param {(message: string) => void} afficherErreur typiquement `toast.error`
 * @returns {() => void} fonction de retrait
 */
export function installerFiletEcriture(afficherErreur) {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => {};
  }
  if (window.__filetEcriturePose) return window.__filetEcriturePose;

  const doitAfficher = creerAntiRepetition();

  const gestionnaire = (evenement) => {
    try {
      const { signaler, message } = verdictRejet(evenement?.reason);
      if (!signaler) return;
      // On empeche le « Uncaught (in promise) » : le message est desormais
      // montre a l'utilisateur, la console garde la trace explicite ci-dessous.
      if (typeof evenement.preventDefault === 'function') evenement.preventDefault();
      console.error('[db] écriture refusée :', evenement.reason);
      if (doitAfficher(message)) afficherErreur(message);
    } catch (e) {
      // Un filet qui leve serait pire que pas de filet.
      console.error('[filet-ecriture] le filet lui-meme a echoue :', e);
    }
  };

  window.addEventListener('unhandledrejection', gestionnaire);
  const retirer = () => {
    window.removeEventListener('unhandledrejection', gestionnaire);
    window.__filetEcriturePose = null;
  };
  window.__filetEcriturePose = retirer;
  return retirer;
}
