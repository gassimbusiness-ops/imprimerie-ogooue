/**
 * Chargement des ecrans : un echec de lecture se VOIT, se LIT en francais, et
 * se REESSAIE.
 *
 * ── Pourquoi ce module existe ─────────────────────────────────────────────
 *
 * Recensement du 17/09/2026 sur `src/features/**` : 130 lectures de donnees ne
 * sont dans aucun `try`, dont 86 au montage d'un ecran. Mais le `try` manquant
 * n'etait pas le vrai probleme — la cause racine etait une ligne de
 * `src/services/db.js` qui rendait `[]` sur une panne reseau. Voir
 * `src/services/erreur-lecture.js` pour le detail, et `db.listOuLeve()` pour
 * le remede cote donnees.
 *
 * Ce module porte la couche REACT du remede :
 *   - `useChargeur` : le cycle « je charge / j'ai echoue / je recommence » ;
 *   - `executerAction` : une action qui echoue le DIT, et ne peut plus afficher
 *     « Enregistre » quand rien ne l'a ete.
 *
 * Le panneau visible est `src/features/partages/etat-chargement.jsx`.
 *
 * ── La regle centrale du depot ────────────────────────────────────────────
 *
 * Un meme comportement ne s'ecrit qu'a un seul endroit (la panne des
 * notifications venait d'une regle recopiee a deux endroits). Ce module ne
 * redefinit donc NI les libelles de collections, NI le message d'echec
 * d'ecriture, NI le verdict d'affichage : il les importe. Les reexports
 * ci-dessous sont la pour qu'un ecran n'ait qu'un seul import a ecrire, pas
 * pour dupliquer quoi que ce soit.
 *
 * Teste par tests/chargement.test.mjs (logique) et
 * tests/rendu-ecran-chargement.test.mjs (comportement a l'ecran).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { LIBELLES_COLLECTION, estErreurEcriture } from './erreur-ecriture';
import {
  ErreurLecture, estErreurLecture, messageEchecChargement, verdictChargement,
} from './erreur-lecture';

export { ErreurLecture, estErreurLecture, messageEchecChargement, verdictChargement };

/**
 * Libelle francais d'une collection, pour les messages.
 * Source unique : la table de `erreur-ecriture.js`.
 *
 * @param {string} collection
 * @returns {string}
 */
export function libelleCollection(collection) {
  return LIBELLES_COLLECTION[collection] || `« ${collection} »`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Le HOOK de chargement
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Gere le cycle « je charge / j'ai echoue / je recommence » d'un ecran.
 *
 * Le chargeur passe en parametre ne s'occupe QUE de lire et de ranger ses
 * donnees. Il ne pose pas de `try`, ne met pas de drapeau `loading`, ne toaste
 * rien : tout cela est ici, une seule fois.
 *
 * ⚠️ Le chargeur doit utiliser `listOuLeve()` / `filterOuLeve()`. Avec `list()`,
 * une panne rendrait `[]` sans lever, et ce hook n'aurait rien a attraper.
 *
 * @param {() => Promise<any>} chargeur
 * @param {{auto?: boolean}} [options] `auto: false` pour declencher a la main
 * @returns {{enCours: boolean, erreur: any, recharger: () => Promise<any>}}
 */
export function useChargeur(chargeur, options = {}) {
  const { auto = true } = options;
  const [enCours, setEnCours] = useState(auto);
  const [erreur, setErreur] = useState(null);

  // Le chargeur est relu a chaque rendu sans re-declencher l'effet : une
  // fonction redefinie a chaque rendu (le cas courant) ne doit pas provoquer
  // une boucle de chargement.
  const refChargeur = useRef(chargeur);
  refChargeur.current = chargeur;

  // React.StrictMode monte, demonte, remonte. Le drapeau doit donc etre REMIS
  // a vrai au montage : le fixer une seule fois a la declaration laisserait le
  // second montage avec un composant considere comme demonte, donc muet.
  const monte = useRef(true);
  useEffect(() => {
    monte.current = true;
    return () => { monte.current = false; };
  }, []);

  const recharger = useCallback(async () => {
    setEnCours(true);
    try {
      const valeur = await refChargeur.current();
      if (monte.current) setErreur(null);
      return valeur;
    } catch (e) {
      // La cause technique reste en console — elle ne va PAS a l'ecran.
      console.error('[chargement] lecture refusée :', e);
      if (monte.current) setErreur(e || new Error('lecture refusée'));
      return undefined;
    } finally {
      if (monte.current) setEnCours(false);
    }
  }, []);

  useEffect(() => { if (auto) recharger(); }, [auto, recharger]);

  return { enCours, erreur, recharger };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Les ACTIONS qui ecrivent
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Message montre quand une action utilisateur echoue.
 *
 * Un echec d'ecriture connu porte deja son message (il nomme la collection et
 * l'operation) : on ne le reecrit pas. Pour tout le reste, on dit ce qui n'a
 * pas ete fait, sans jargon ni code d'erreur.
 *
 * @param {*} erreur
 * @param {string} [quoi] ex. « La clôture de caisse »
 * @returns {string}
 */
export function messageEchecAction(erreur, quoi) {
  if (estErreurEcriture(erreur)) return String(erreur.message);
  const sujet = quoi || 'Cette action';
  return `${sujet} n'a pas été enregistré. Vérifiez la connexion, puis recommencez.`;
}

/**
 * Execute une action utilisateur qui ecrit en base.
 *
 * ── Pourquoi passer par ici plutot que par un `try` recopie ───────────────
 *
 * Recensement du 17/09/2026 : 121 ecritures ne sont dans aucun `try`. Le pire
 * cas n'est pas l'absence de message, c'est le message FAUX : le handler
 * s'arrete au milieu, ou bien il continue et affiche « Enregistre » alors que
 * rien ne l'a ete. Ici, le `toast.success` n'est atteint QUE si l'operation a
 * abouti — la regle tient a un seul endroit.
 *
 * Ne leve jamais : l'appelant lit `ok`.
 *
 * @param {() => Promise<any>} operation
 * @param {{succes?: string, quoi?: string}} [options]
 * @returns {Promise<{ok: boolean, valeur?: any, erreur?: any}>}
 */
export async function executerAction(operation, options = {}) {
  const { succes, quoi } = options;
  try {
    const valeur = await operation();
    if (succes) toast.success(succes);
    return { ok: true, valeur };
  } catch (erreur) {
    console.error('[action] écriture refusée :', erreur);
    // Duree longue : le gerant doit avoir le temps de lire avant de resaisir.
    toast.error(messageEchecAction(erreur, quoi), { duration: 10000 });
    return { ok: false, erreur };
  }
}
