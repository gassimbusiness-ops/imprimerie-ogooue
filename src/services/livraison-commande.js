/**
 * Livraison d'une commande — regles pures.
 *
 * ── Pourquoi ce module existe ─────────────────────────────────────────────
 *
 * Le bouton « Livrée » de src/features/commandes/page.jsx declenchait, en un
 * seul clic, SIX ecritures d'argent :
 *
 *   1. une facture              (db.factures.create)
 *   2. un encaissement          (mouvements_financiers + solde du compte)
 *   3. une sortie de stock      (db.produits + mouvements_stock)
 *   4. des points de fidelite   (db.fidelite_clients)
 *   5. une reprise dans le rapport journalier (categories.imprimerie)
 *   6. la cloture de la tache liee
 *
 * Trois defauts empiles, constats C3/C4/C5 de l'audit VAGUE 2 :
 *
 * (a) DOUBLE COMPTAGE. Le bouton n'avait pas de `disabled`, et la garde
 *     `dejaLivree` lisait l'objet DU RENDU, pas la base. Deux clics rapides
 *     partaient du meme etat : deux fois le CA, deux fois la sortie de stock,
 *     deux fois les points, deux entrees de tresorerie. Aucun des six effets
 *     n'etait idempotent, sauf la facture et l'encaissement.
 *
 * (b) ECHEC SILENCIEUX. Les quatre effets partaient en `.catch(console.error)`.
 *     Le toast vert s'affichait quoi qu'il arrive. Pire : `livraison_traitee:
 *     true` etait pose AVANT que les effets tournent, donc repasser la commande
 *     en « Livrée » ne rejouait jamais ce qui avait echoue. La perte etait
 *     definitive et invisible.
 *
 * (c) AUCUNE CONTRE-PASSATION. Annuler ou supprimer une commande livree ne
 *     defaisait rien : l'argent d'une commande annulee restait dans la
 *     tresorerie et dans le CA du mois.
 *
 * ── Le contrat pose ici ───────────────────────────────────────────────────
 *
 * 1. CHAQUE effet porte une REFERENCE stable, derivee de l'identifiant de la
 *    commande. Avant d'ecrire, on cherche cette reference. Un effet deja
 *    applique n'est jamais rejoue. C'est ce qui rend un double-clic, un
 *    rechargement, ou une reprise apres echec partiel, sans consequence.
 *
 * 2. `livraison_traitee` n'est pose QUE si TOUS les effets ont reussi. Un
 *    echec partiel laisse le drapeau a false : la reprise reste possible, et
 *    l'idempotence de (1) garantit qu'elle ne double rien.
 *
 * 3. Le message d'erreur NOMME l'effet qui a echoue. « Erreur » ne dit rien a
 *    quelqu'un qui doit decider s'il ressaisit une facture a la main.
 *
 * Module volontairement pur : aucun import, aucun acces reseau, aucun DOM.
 * Teste par tests/livraison-commande.test.mjs.
 */

/**
 * Les effets declenches par le passage au statut « Livrée », dans l'ordre ou
 * ils sont lances. Le libelle est celui qu'on montre au gerant : il doit se
 * lire dans une phrase francaise, pas ressembler a un nom de variable.
 */
export const EFFETS_LIVRAISON = Object.freeze([
  Object.freeze({ cle: 'facture', libelle: 'la facture' }),
  Object.freeze({ cle: 'encaissement', libelle: "l'encaissement en trésorerie" }),
  Object.freeze({ cle: 'stock', libelle: 'la sortie de stock' }),
  Object.freeze({ cle: 'fidelite', libelle: 'les points de fidélité' }),
  Object.freeze({ cle: 'rapport', libelle: 'la reprise dans le rapport journalier' }),
  Object.freeze({ cle: 'tache', libelle: 'la clôture de la tâche liée' }),
]);

const LIBELLE_PAR_CLE = Object.freeze(
  Object.fromEntries(EFFETS_LIVRAISON.map((e) => [e.cle, e.libelle])),
);

/* ═══════════════════════════════════════════════════════════════════════════
   Statuts — tolerance en lecture
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Reduit une valeur de statut : minuscules, accents retires, espaces en `_`.
 * La base contient des orthographes historiques (`livre`, `annule`) et des
 * formes accentuees. On lit large, on ecrit etroit.
 */
function reduire(valeur) {
  return String(valeur ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

/** Vrai si le statut designe une commande livree, quelle que soit l'orthographe. */
export function estStatutLivree(statut) {
  const s = reduire(statut);
  return s === 'livree' || s === 'livre';
}

/** Vrai si le statut designe une commande annulee, quelle que soit l'orthographe. */
export function estStatutAnnulee(statut) {
  const s = reduire(statut);
  return s === 'annulee' || s === 'annule';
}

/* ═══════════════════════════════════════════════════════════════════════════
   Declenchement
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Vrai si les effets de livraison ont deja ete appliques ET confirmes.
 *
 * ATTENTION au sens exact : `livraison_traitee === true` signifie « les six
 * effets ont tous reussi ». Une commande au statut `livree` dont le drapeau est
 * absent est une commande dont la livraison a ete INTERROMPUE : il faut pouvoir
 * la reprendre. C'est pour cela qu'on ne regarde ici que le drapeau, et non le
 * statut — l'ancienne garde `livraison_traitee === true || statut === 'livree'`
 * interdisait precisement ce rattrapage.
 *
 * @param {object} cmd
 * @returns {boolean}
 */
export function livraisonDejaConfirmee(cmd) {
  return cmd?.livraison_traitee === true;
}

/**
 * Faut-il declencher les effets de livraison pour ce changement de statut ?
 *
 * @param {object} cmd commande telle qu'en base
 * @param {string} nouveauStatut statut vise
 * @returns {boolean}
 */
export function doitDeclencherLivraison(cmd, nouveauStatut) {
  if (!estStatutLivree(nouveauStatut)) return false;
  return !livraisonDejaConfirmee(cmd);
}

/**
 * Faut-il contre-passer les effets d'argent ?
 *
 * On contre-passe quand une commande QUI A ETE LIVREE (drapeau pose, ou statut
 * livree en base) part vers `annulee`. Les effets sont recherches par leur
 * reference : si rien n'a ete ecrit, la contre-passation ne trouve rien et ne
 * fait rien — elle est donc sans danger meme sur une commande jamais livree.
 *
 * @param {object} cmd
 * @param {string} nouveauStatut
 * @returns {boolean}
 */
export function doitContrePasser(cmd, nouveauStatut) {
  if (!estStatutAnnulee(nouveauStatut)) return false;
  return livraisonDejaConfirmee(cmd) || estStatutLivree(cmd?.statut);
}

/* ═══════════════════════════════════════════════════════════════════════════
   References d'idempotence
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Reference stable d'un effet d'argent rattache a une commande.
 *
 * C'est la cle de voute de tout le module : avant d'ecrire, on cherche cette
 * chaine dans la collection cible. Si elle y est, l'effet a deja eu lieu.
 *
 * Elle doit etre DERIVEE de l'identifiant de la commande et de rien d'autre :
 * ni la date, ni le montant, ni le numero — qui peuvent changer entre deux
 * tentatives et casseraient la deduplication.
 *
 * @param {object|string} commandeOuId
 * @param {string} cle  une cle de EFFETS_LIVRAISON
 * @param {string} [detail] discriminant optionnel (ex. l'id du produit sorti)
 * @returns {string|null} null si la commande n'a pas d'identifiant utilisable
 */
export function referenceEffet(commandeOuId, cle, detail) {
  const id = typeof commandeOuId === 'string' ? commandeOuId : commandeOuId?.id;
  if (!id) return null;
  const base = `commande:${id}`;
  if (cle === 'encaissement') return base; // compatibilite : reference historique
  return detail ? `${base}:${cle}:${detail}` : `${base}:${cle}`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Lecture du resultat de Promise.allSettled
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Transforme le retour de `Promise.allSettled` en verdict lisible.
 *
 * @param {Array<{cle: string, resultat: {status: string, reason?: any}}>} entrees
 * @returns {{tousReussis: boolean, echecs: Array<{cle,libelle,message}>, message: string|null}}
 */
export function resumerEffets(entrees) {
  const liste = Array.isArray(entrees) ? entrees : [];
  const echecs = liste
    .filter((e) => e?.resultat?.status === 'rejected')
    .map((e) => ({
      cle: e.cle,
      libelle: LIBELLE_PAR_CLE[e.cle] || e.cle,
      message: messageErreur(e.resultat.reason),
    }));

  if (echecs.length === 0) {
    return { tousReussis: true, echecs: [], message: null };
  }

  const noms = echecs.map((e) => e.libelle);
  const enumeration = noms.length === 1
    ? noms[0]
    : `${noms.slice(0, -1).join(', ')} et ${noms[noms.length - 1]}`;

  return {
    tousReussis: false,
    echecs,
    message:
      `Livraison incomplète : ${enumeration} n'a pas pu être enregistré${noms.length > 1 ? 's' : ''}. `
      + `La commande reste rattrapable — recliquez sur « Livrée » quand le réseau est revenu. `
      + `Détail : ${echecs.map((e) => e.message).join(' · ')}`,
  };
}

/** Extrait un message lisible de n'importe quelle valeur rejetee. */
function messageErreur(raison) {
  if (!raison) return 'cause inconnue';
  if (typeof raison === 'string') return raison;
  if (raison.message) return String(raison.message);
  try { return JSON.stringify(raison); } catch { return 'cause inconnue'; }
}

/* ═══════════════════════════════════════════════════════════════════════════
   Commandes de test
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Vrai si la commande est marquee comme un essai.
 *
 * ⚠️ Seul le drapeau EXPLICITE `est_test` compte. L'ancienne heuristique
 * (`description` contenant « test », ou montant nul) est conservee ici
 * UNIQUEMENT pour proposer un marquage, jamais pour supprimer : une vraie
 * commande « test daltonien » ou « test couleur » — deux prestations reelles
 * d'imprimerie — tombait dans le filet.
 *
 * @param {object} cmd
 * @returns {boolean}
 */
export function estCommandeTest(cmd) {
  return cmd?.est_test === true;
}

/**
 * Vrai si la commande RESSEMBLE a un essai. Sert a PROPOSER un marquage, a
 * afficher un bandeau d'avertissement — jamais a declencher une suppression.
 *
 * @param {object} cmd
 * @returns {boolean}
 */
export function ressembleACommandeTest(cmd) {
  if (estCommandeTest(cmd)) return true;
  const texte = `${cmd?.description || ''} ${cmd?.client_nom || ''}`.toLowerCase();
  return /\btests?\b/.test(texte);
}

/**
 * Peut-on supprimer definitivement cette commande ?
 *
 * Constat 8b.2 : supprimer une commande livree laisse en base le mouvement de
 * tresorerie `commande:<id>`, la facture, la sortie de stock et les points —
 * et DETRUIT la reference d'idempotence, si bien qu'une re-saisie ré-encaisse.
 * On interdit donc la suppression de tout ce qui a touche a l'argent.
 *
 * @param {object} cmd
 * @returns {{autorise: boolean, motif: string|null}}
 */
export function suppressionAutorisee(cmd) {
  if (livraisonDejaConfirmee(cmd) || estStatutLivree(cmd?.statut)) {
    return {
      autorise: false,
      motif:
        'Cette commande a été livrée : son encaissement, sa facture et sa sortie de '
        + 'stock sont déjà enregistrés. La supprimer laisserait cet argent sans '
        + 'justificatif. Annulez-la plutôt — l\'annulation contre-passe les écritures.',
    };
  }
  const montant = Number(cmd?.montant_total ?? cmd?.total ?? 0);
  if (montant > 0 && !estStatutAnnulee(cmd?.statut)) {
    return {
      autorise: false,
      motif:
        `Cette commande porte un montant de ${montant} F. Annulez-la d'abord : `
        + 'une commande supprimée disparaît des totaux sans laisser de trace.',
    };
  }
  return { autorise: true, motif: null };
}

/**
 * Selection des commandes qu'une purge de test a le droit de supprimer.
 *
 * L'ancien `handlePurgeTests` supprimait EN LOT toute commande dont la
 * description contenait « test » — y compris de vraies commandes livrees et
 * encaissees. Ici on croise deux conditions : marquee test ET supprimable.
 *
 * @param {Array<object>} commandes
 * @returns {Array<object>}
 */
export function commandesPurgeables(commandes) {
  return (Array.isArray(commandes) ? commandes : [])
    .filter((c) => estCommandeTest(c))
    .filter((c) => suppressionAutorisee(c).autorise);
}
