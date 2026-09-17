/**
 * Mouvements financiers — nature d'un mouvement et effet sur les soldes.
 *
 * ── L'arbitrage n°13 ─────────────────────────────────────────────────────
 *
 * Q3, posee a Gassim le 14/09/2026 : « `depot_hebdo` = depot a la banque,
 * remise au proprietaire, ou apport ? »
 *
 *     Reponse : un depot a la banque.
 *
 * Un depot a la banque ne cree pas d'argent : il en DEPLACE. La caisse baisse
 * exactement du montant dont le compte bancaire monte. C'est un transfert
 * interne — la meme operation que le type `transfert`, sous un autre nom.
 *
 * `finances/page.jsx` le traitait comme une ENTREE simple : le compte etait
 * credite, la caisse n'etait jamais debitee, et le montant s'ajoutait au total
 * des entrees. L'argent existait donc deux fois — une fois dans un tiroir qui
 * n'avait pas baisse, une fois a la banque — et chaque depot gonflait le total
 * des recettes affiche.
 *
 * ── La convention, identique a celle du type `transfert` ─────────────────
 *
 *     `compte_id`      = d'ou l'argent SORT  (la caisse)
 *     `compte_dest_id` = ou l'argent ARRIVE  (la banque)
 *
 * ⚠️ Pour `depot_hebdo`, c'est l'INVERSE du sens qu'avait `compte_id` avant
 * cette correction (il designait le compte credite). Cette reinterpretation
 * n'est sans danger que parce qu'aucune donnee n'existe :
 *
 * [MESURE le 18/09/2026 sur la base de production, en lecture seule]
 *   `mouvements_financiers` : 32 lignes — 30 `sortie`, 2 `entree`.
 *   **Aucune ligne de type `depot_hebdo`.**
 *   `rapports` : 237 lignes, **aucune ne porte le champ `depot_hebdo`**.
 *
 * Le type figurait au menu sans avoir jamais servi. Aucun franc deja saisi
 * n'est deplace, aucun solde affiche ne change : la correction ferme la porte
 * avant le premier depot, elle ne repare rien derriere elle. Si un depot avait
 * ete saisi, il aurait fallu d'abord decider, ligne par ligne, quel compte
 * etait la source — ce que personne ne peut faire retrospectivement.
 *
 * ── Pourquoi un module, pour si peu ──────────────────────────────────────
 *
 * La regle vivait a quatre endroits de `finances/page.jsx` (total, creation,
 * edition, suppression) plus un dans `export-pdf.js`. Cinq copies d'une meme
 * phrase : la sixieme aurait ete oubliee, et un solde faux ne leve aucune
 * erreur — il s'affiche.
 *
 * Module pur : aucun import. Teste par tests/depot-hebdomadaire.test.mjs.
 */

/**
 * Vrai si ce type de mouvement fait ENTRER de l'argent dans l'entreprise.
 *
 * Un transfert interne n'en fait pas partie : il deplace de l'argent deja la.
 * Le compter en entree revient a annoncer une recette a chaque fois qu'on
 * porte la caisse a la banque.
 */
export function estEntreeDeTresorerie(type) {
  return type === 'entree';
}

/**
 * Vrai si ce type deplace de l'argent entre deux comptes de l'entreprise.
 * `depot_hebdo` en fait partie depuis Q3.
 */
export function estTransfertInterne(type) {
  return type === 'transfert' || type === 'depot_hebdo';
}

/**
 * Effet d'un mouvement sur les soldes des comptes.
 *
 * @param {object} mouvement  `{ type, montant, compte_id, compte_dest_id }`
 * @param {object} [options]
 * @param {boolean} [options.inverser] rendre l'effet INVERSE — pour annuler un
 *        mouvement supprime, ou defaire l'ancien avant d'appliquer le nouveau
 *        lors d'une modification.
 * @returns {Record<string, number>} deltas par identifiant de compte. Un objet
 *        vide signifie « sans effet » : c'est un resultat valide, pas un echec.
 */
export function effetSurSoldes(mouvement, { inverser = false } = {}) {
  const deltas = {};
  if (!mouvement) return deltas;

  const montant = Number(mouvement.montant);
  if (!Number.isFinite(montant) || montant === 0) return deltas;

  const signe = inverser ? -1 : 1;
  const ajouter = (compteId, valeur) => {
    if (!compteId) return;
    deltas[compteId] = (deltas[compteId] || 0) + valeur;
  };

  const { type, compte_id: source, compte_dest_id: destination } = mouvement;

  if (estTransfertInterne(type)) {
    // Un transfert incomplet ne doit RIEN faire. Debiter une caisse sans
    // crediter personne ferait disparaitre l'argent des totaux — une panne
    // silencieuse, et impossible a retrouver ensuite.
    if (!source || !destination) return deltas;
    ajouter(source, -montant * signe);
    ajouter(destination, +montant * signe);
    return deltas;
  }

  if (type === 'entree') ajouter(source, +montant * signe);
  else if (type === 'sortie') ajouter(source, -montant * signe);

  return deltas;
}
