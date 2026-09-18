/**
 * activites.js — Les deux activites de l'entreprise, ecrites une seule fois.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Jusqu'au 18/09/2026, ce logiciel ne connaissait qu'une activite. Chaque
 * vente, chaque mouvement d'argent, chaque ligne de caisse etait IMPLICITEMENT
 * de l'imprimerie — non pas parce qu'un champ le disait, mais parce qu'il n'y
 * avait rien d'autre.
 *
 * Le dirigeant ouvre une deuxieme activite, la PAPETERIE, dans les memes murs.
 * Sa consigne : « la caisse papeterie est separee — plus tot on le code, moins
 * il y aura a demeler ». Sans champ d'appartenance pose AVANT le premier franc
 * encaisse, les deux chiffres d'affaires se melangent dans une meme table et
 * plus personne ne peut les separer ensuite : ni le logiciel, ni un humain qui
 * relirait 237 rapports trois mois plus tard.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * LA REGLE N°1 : L'ABSENCE DU CHAMP VAUT « IMPRIMERIE »
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * [MESURE le 18/09/2026 sur le projet Supabase de production, en LECTURE SEULE]
 *
 *     select collection, count(*), count(*) filter (where data ? 'activite')
 *     from app_data group by collection;
 *
 *   audit_logs 3339 · rapports 237 · produits_catalogue 195 ·
 *   notifications_app 92 · produits 45 · mouvements_stock 44 ·
 *   mouvements_financiers 32 · clients 14 · comptes_bancaires 11 ·
 *   factures 7 · charges_fixes 5 · commandes 5 · devis 4 …
 *
 *   → AUCUNE ligne, dans AUCUNE collection, ne porte de champ `activite`.
 *
 * Tout l'existant est donc de l'imprimerie. On ne le reecrit PAS en base : on
 * le LIT par defaut. Une migration de donnees sur 4 083 lignes serait une
 * occasion de se tromper ; une valeur par defaut a la lecture n'en est pas une,
 * et elle reste juste meme si une ligne ancienne remonte d'une sauvegarde.
 *
 * Corollaire, teste : une ligne sans champ n'apparait JAMAIS dans la papeterie.
 * Une piece d'avant l'ouverture ne peut pas appartenir a un commerce qui
 * n'existait pas.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ LE PIEGE DE NOM — a lire avant de toucher a un ecran de rapports
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `rapport.categories.imprimerie` EXISTE DEJA, et ce n'est pas une activite :
 * c'est une categorie de PRESTATION, a cote de `copies`, `scan`,
 * `badges_plastification`, `marchandises`… (voir CATEGORIES_RAPPORT dans
 * src/services/finance-calc.js).
 *
 * Un rapport de la PAPETERIE peut parfaitement contenir une recette dans la
 * categorie `imprimerie` — un client qui achete un cahier et fait faire trois
 * photocopies au meme comptoir. Confondre les deux ferait glisser du chiffre
 * d'affaires d'une caisse a l'autre sans lever la moindre erreur : un chiffre
 * faux ne plante pas, il s'affiche.
 *
 *     activite  = A QUELLE CAISSE appartient la ligne   → ce module
 *     categorie = CE QUI A ETE VENDU                    → finance-calc.js
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * « LES DEUX » N'EST PAS UNE ACTIVITE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `TOUTES_ACTIVITES` est une VUE de lecture, jamais une valeur stockable.
 * `avecActivite()` refuse de l'ecrire : une ligne qui appartiendrait aux deux
 * caisses n'appartiendrait en realite a aucune, et c'est precisement le
 * demelage que cette intervention existe pour eviter.
 *
 * Module PUR : aucun import, aucun acces base, aucun React.
 * Teste par tests/activites.test.mjs.
 */

/** La caisse historique. Valeur par defaut de tout l'existant. */
export const ACTIVITE_IMPRIMERIE = 'imprimerie';

/** La caisse ouverte en septembre 2026. */
export const ACTIVITE_PAPETERIE = 'papeterie';

/** Les seules valeurs qui ont le droit d'etre ECRITES en base. */
export const ACTIVITES = [ACTIVITE_IMPRIMERIE, ACTIVITE_PAPETERIE];

/** Ce que vaut une ligne qui ne dit rien. Voir « LA REGLE N°1 » ci-dessus. */
export const ACTIVITE_DEFAUT = ACTIVITE_IMPRIMERIE;

/**
 * Vue consolidee des deux caisses. JAMAIS stockee sur une ligne.
 * Le prefixe `__` la rend impossible a confondre avec une valeur metier si
 * elle atterrit par accident dans une chaine affichee ou une cle d'URL.
 */
export const TOUTES_ACTIVITES = '__toutes__';

/** Libelles destines au gerant, pas a la base. */
const LIBELLES = {
  [ACTIVITE_IMPRIMERIE]: 'Imprimerie',
  [ACTIVITE_PAPETERIE]: 'Papeterie',
  [TOUTES_ACTIVITES]: 'Les deux',
};

/**
 * Est-ce une activite STOCKABLE ?
 * `TOUTES_ACTIVITES` rend `false` : c'est une vue, pas une caisse.
 * @param {unknown} valeur
 * @returns {boolean}
 */
export function estActiviteConnue(valeur) {
  return typeof valeur === 'string' && ACTIVITES.includes(valeur.trim().toLowerCase());
}

/**
 * Normalise n'importe quelle entree en une activite stockable.
 *
 * Tolerante a la casse et aux espaces (une saisie « Papeterie » ou un import
 * Excel « PAPETERIE » ne doivent pas fabriquer une troisieme caisse), et
 * SILENCIEUSE sur l'inconnu : elle retombe sur l'imprimerie plutot que de
 * lever. Un ecran d'argent qui casse a l'affichage est pire qu'un ecran qui
 * montre la caisse historique.
 *
 * @param {unknown} valeur
 * @returns {'imprimerie'|'papeterie'}
 */
export function normaliserActivite(valeur) {
  if (typeof valeur !== 'string') return ACTIVITE_DEFAUT;
  const v = valeur.trim().toLowerCase();
  return ACTIVITES.includes(v) ? v : ACTIVITE_DEFAUT;
}

/**
 * Activite d'un enregistrement — rapport, commande, mouvement, article, charge.
 *
 * C'est LA fonction a appeler partout : elle porte la regle « l'absence vaut
 * imprimerie » en un seul endroit. Un `x.activite === 'papeterie'` ecrit a la
 * main dans un ecran marche aussi, jusqu'au jour ou la valeur arrive en
 * majuscules d'un import.
 *
 * @param {object|null|undefined} enregistrement
 * @returns {'imprimerie'|'papeterie'}
 */
export function activiteDe(enregistrement) {
  return normaliserActivite(enregistrement?.activite);
}

/** Libelle affichable d'une activite, ou de la vue consolidee. */
export function libelleActivite(valeur) {
  if (valeur === TOUTES_ACTIVITES) return LIBELLES[TOUTES_ACTIVITES];
  return LIBELLES[normaliserActivite(valeur)];
}

/**
 * Filtre une liste sur une activite.
 *
 * @param {Array|null|undefined} liste
 * @param {string} activite une activite, ou `TOUTES_ACTIVITES` pour tout rendre
 * @returns {Array} une liste vide si l'entree est absente — pas une exception
 */
export function filtrerParActivite(liste, activite) {
  if (!Array.isArray(liste)) return [];
  if (activite === TOUTES_ACTIVITES) return liste;
  const cible = normaliserActivite(activite);
  return liste.filter((x) => activiteDe(x) === cible);
}

/**
 * Repartit une mesure sur les deux activites.
 *
 * Invariant TESTE : `imprimerie + papeterie === total`. Un franc qui ne serait
 * d'aucun cote serait un franc disparu ; un franc des deux cotes serait un
 * franc invente. C'est cet invariant qui permet d'afficher les trois chiffres
 * cote a cote sans qu'un lecteur ait a se demander lequel croire.
 *
 * Une mesure non numerique compte pour 0 : `NaN` affiche dans un ecran d'argent
 * est un chiffre faux, pas une erreur visible.
 *
 * @param {Array|null|undefined} liste
 * @param {(x: any) => number} mesurer montant a compter pour un element
 * @returns {{imprimerie: number, papeterie: number, total: number}}
 */
export function repartirParActivite(liste, mesurer) {
  const r = { [ACTIVITE_IMPRIMERIE]: 0, [ACTIVITE_PAPETERIE]: 0, total: 0 };
  if (!Array.isArray(liste) || typeof mesurer !== 'function') return r;
  for (const x of liste) {
    const brut = Number(mesurer(x));
    const montant = Number.isFinite(brut) ? brut : 0;
    r[activiteDe(x)] += montant;
    r.total += montant;
  }
  return r;
}

/**
 * Pose l'activite sur un payload qui part en base.
 *
 * Toujours passer par ici plutot que par `{ ...data, activite }` : cette
 * fonction NORMALISE (une valeur inconnue devient `imprimerie` au lieu d'etre
 * ecrite telle quelle) et refuse `TOUTES_ACTIVITES`, qui n'est pas une caisse.
 *
 * Ne mute pas l'entree.
 *
 * @param {object} data
 * @param {string} activite
 * @returns {object} une copie portant `activite`
 */
export function avecActivite(data, activite) {
  return { ...(data || {}), activite: normaliserActivite(activite) };
}
