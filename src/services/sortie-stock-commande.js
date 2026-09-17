/**
 * Sortie de stock a la livraison d'une commande — regles pures.
 *
 * ── L'arbitrage n°5, et pourquoi il etait applique A L'ENVERS ─────────────
 *
 * Q4, posee a Gassim le 14/09/2026 : « Les supports et consommables d'une
 * commande personnalisee sont-ils deduits du stock ? »
 *
 *     Reponse : NON.
 *
 * `syncStockFromCommande()` les deduisait pourtant, a chaque passage en
 * « Livree ». Le code ne faisait pas rien : il faisait le contraire de la
 * pratique declaree.
 *
 * C'est la panne la plus chere des deux. Un comportement absent se voit — un
 * chiffre qui ne bouge pas finit par etre remarque. Un comportement inverse ne
 * se voit pas : il produit un inventaire theorique qui descend regulierement,
 * d'un air parfaitement normal. Et c'est exactement le chiffre qu'on regarde
 * en cas de suspicion de vol.
 *
 * S'y ajoutait l'appariement par sous-chaine de nom (constat 8b.4, toujours
 * present dans `sync-stock-commande.js`) : une ligne « Papier » decremente
 * « Papier opaque », « Papier laminage » ou « Papier autocollant » selon
 * l'ordre de la liste. Le mauvais article baissait, silencieusement.
 *
 * ── Ce qui est decide ici, et ce qui ne l'est pas ─────────────────────────
 *
 * DECIDE — la sortie automatique est fermee par defaut. C'est l'application
 * directe de Q4, qui fait autorite : elle ne demande aucun arbitrage nouveau.
 * Comme pour la reprise dans le rapport journalier, la regle du projet interdit
 * de supprimer : le chemin de code reste entier et se rallume en changeant une
 * seule constante.
 *
 * PAS DECIDE, et volontairement laisse ouvert — le modele a trois temps
 * (reservation / consommation / livraison) et la distinction entre la vente au
 * comptoir (qui, elle, devrait deduire a la finalisation) et la commande
 * personnalisee (qui ne deduit pas). Ces deux points demandent une reponse que
 * personne n'a donnee, a commencer par celle-ci : puisque les supports ne sont
 * pas deduits, comment l'imprimerie sait-elle quand racheter du papier ?
 * Tant qu'elle manque, l'interrupteur reste ferme pour TOUTES les commandes.
 *
 * [MESURE le 18/09/2026 sur la base de production, en lecture seule]
 *   `mouvements_stock` : 44 lignes, dont 0 portant `commande_id` et 0 portant
 *   une reference `commande:…`. Aucune sortie automatique n'a encore ete
 *   ecrite — fermer l'interrupteur ne corrige aucun chiffre deja affiche et
 *   n'en fait bouger aucun. La correction est preventive.
 *
 * Module pur : aucun import. Teste par tests/sortie-stock-commande.test.mjs.
 */

/**
 * Interrupteur de la sortie de stock automatique a la livraison.
 *
 * `false` = le stock appartient a l'inventaire physique ; une livraison de
 * commande n'y touche pas. La commande reste tracee ailleurs : son statut,
 * `historique_statuts`, sa facture, et l'encaissement en tresorerie.
 *
 * Passer a `true` UNIQUEMENT apres que le modele a trois temps ait ete tranche
 * ET que l'appariement par sous-chaine ait ete remplace par `produit_id` —
 * rallumer sans cela ferait baisser le mauvais article.
 */
export const SORTIE_STOCK_AUTO_COMMANDE = false;

/** Les lignes d'une commande, quel que soit le schema utilise. */
export function lignesCommande(commande) {
  const items = commande?.lignes || commande?.produits || [];
  return Array.isArray(items) ? items : [];
}

/**
 * Faut-il sortir du stock pour cette commande livree ?
 *
 * @param {object} params
 * @param {object} params.commande
 * @param {boolean} [params.actif] etat de l'interrupteur
 * @returns {{action: 'ignorer'|'sortir', motif: string}}
 */
export function decisionSortieStock({ commande, actif = SORTIE_STOCK_AUTO_COMMANDE } = {}) {
  if (!actif) {
    return {
      action: 'ignorer',
      motif:
        'sortie de stock automatique désactivée — Q4 : les supports d’une commande '
        + 'personnalisée ne sont pas déduits du stock',
    };
  }

  if (lignesCommande(commande).length === 0) {
    return { action: 'ignorer', motif: 'la commande ne porte aucune ligne à sortir' };
  }

  if (!commande?.id) {
    return {
      action: 'ignorer',
      motif:
        'commande sans identifiant : aucune référence d’idempotence n’est calculable, '
        + 'la sortie serait rejouable à chaque tentative',
    };
  }

  return { action: 'sortir', motif: 'sortie de stock à la livraison' };
}
