/**
 * Lecture des seuils d'alerte de stock — sans jamais ecrire.
 *
 * ── Pourquoi ce module existe ─────────────────────────────────────────────
 * src/features/stocks/page.jsx:249-272 contenait, DANS `load()`, une
 * « auto-correction » qui reecrivait EN BASE le seuil d'alerte de chaque
 * consommable a 10 et reclassait des articles en « machine », a chaque
 * ouverture de l'ecran.
 *
 * Degats mesures le 15/09/2026 sur la production : 26 articles sur 45 portent
 * un `quantite_minimum` valant exactement 10, et aucun consommable ne descend
 * sous 10. Le gerant reglait « Papier opaque » a 3, l'ecran le remontait a 10,
 * puis l'alertait « 9/10 ».
 *
 * ── La regle ──────────────────────────────────────────────────────────────
 * Un ecran de consultation ne fait aucune ecriture. Ce module ne contient donc
 * QUE des fonctions pures : elles lisent, elles ne modifient ni la base, ni
 * meme les objets qu'on leur passe.
 *
 * Teste par tests/stocks-seuils.test.mjs.
 */

/** Type par defaut quand `type_article` est absent en base. */
export const TYPE_PAR_DEFAUT = 'consommable';

/**
 * Seuil d'alerte reel d'un article.
 *
 * Aucune valeur n'est imposee : un article sans seuil vaut 0 (= pas d'alerte),
 * pas 10. C'est le parametrage du gerant qui fait autorite, y compris quand il
 * vaut 0, 1 ou 3.
 *
 * @param {object} article
 * @returns {number} seuil >= 0
 */
export function seuilArticle(article) {
  const brut = article?.quantite_minimum ?? article?.stock_min;
  if (brut === null || brut === undefined || brut === '') return 0;
  const n = Number(brut);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Quantite en stock d'un article (deux noms de champ coexistent en base).
 * @param {object} article
 * @returns {number}
 */
export function quantiteArticle(article) {
  const brut = article?.quantite ?? article?.stock;
  const n = Number(brut);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Type d'article tel qu'il doit etre AFFICHE.
 * Aucune reclassification automatique : ce qui est en base est ce qui s'affiche.
 * @param {object} article
 * @returns {string}
 */
export function typeArticle(article) {
  return article?.type_article || TYPE_PAR_DEFAUT;
}

/**
 * Niveau d'alerte d'un article.
 * @param {number} quantite
 * @param {number} seuil
 * @returns {'rupture'|'bas'|'ok'}
 */
export function niveauStock(quantite, seuil) {
  const q = Number(quantite) || 0;
  const s = Number(seuil) || 0;
  if (q <= 0) return 'rupture';
  if (q <= s) return 'bas';
  return 'ok';
}

/**
 * Prepare la liste des articles pour l'affichage.
 *
 * Contrat, verifie par les tests :
 *  - ne retourne jamais un article dont le seuil differe de celui recu ;
 *  - ne modifie jamais les objets recus (pas de mutation) ;
 *  - n'ecrit rien nulle part (aucun import de `db` dans ce fichier).
 *
 * @param {Array<object>} produits
 * @returns {Array<object>} nouveaux objets, enrichis de champs de LECTURE seule
 */
export function preparerArticlesPourAffichage(produits) {
  if (!Array.isArray(produits)) return [];
  return produits.map((article) => {
    const seuil = seuilArticle(article);
    const quantite = quantiteArticle(article);
    return {
      ...article,
      // Champs derives, prefixes `_` : ils servent a l'affichage et ne sont
      // jamais renvoyes en base par handleSave(), qui construit son payload
      // champ par champ.
      _seuil: seuil,
      _quantite: quantite,
      _type: typeArticle(article),
      _niveau: niveauStock(quantite, seuil),
    };
  });
}

/**
 * Articles en alerte (rupture ou bas), pour les compteurs de l'ecran.
 * @param {Array<object>} produits
 * @returns {Array<object>}
 */
export function articlesEnAlerte(produits) {
  return preparerArticlesPourAffichage(produits).filter((a) => a._niveau !== 'ok');
}
