/**
 * Les pages PUBLIQUES déclarées à Meta — et pourquoi elles ne sont pas des écrans React.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CE QUE META LIT
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Le tableau de bord Meta exige trois URL avant de publier l'application
 * « OGOOUE Scheduler » : politique de confidentialité, conditions de service,
 * instructions de suppression des données. Le robot de Meta lit le HTML servi,
 * il n'exécute pas l'application : un écran React ne lui montrerait que la
 * coquille vide de `index.html` (1 656 octets, titre « Imprimerie Ogooue -
 * Gestion »). C'est exactement ce que servait `/politique-confidentialite` au
 * 26/09/2026, alors que cette URL était déjà déclarée à Meta.
 *
 * Les trois pages sont donc des fichiers statiques de `public/`, lisibles sans
 * JavaScript et sans session. Chacune a DEUX adresses :
 *   - `/…html`   — servie par une règle explicite de `vercel.json` (défaut du
 *                  17/09, voir `tests/routage-api.test.mjs`) ;
 *   - un chemin propre, ci-dessous — réécrit vers le fichier par `vercel.json`.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LE SERVICE WORKER
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Une fois la PWA installée, toute NAVIGATION est interceptée par le service
 * worker, qui répond `index.html` — donc l'écran de connexion. Les `/…html`
 * y échappent parce qu'ils sont précachés sous leur propre nom (la route de
 * précache passe avant la route de navigation). Les chemins propres, eux, ne
 * correspondent à aucun fichier précaché : sans la liste ci-dessous, passée à
 * `navigateFallbackDenylist` dans `vite.config.js`, un employé qui ouvre le
 * lien depuis son téléphone verrait l'application au lieu de la page.
 *
 * ⚠️ `vercel.json` ne peut pas importer ce fichier : ses trois règles sont
 *    recopiées, et `tests/pages-legales-meta.test.mjs` vérifie que les deux
 *    listes disent la même chose.
 */
export const PAGES_PUBLIQUES = Object.freeze([
  Object.freeze({ chemin: '/politique-confidentialite', fichier: '/confidentialite.html' }),
  Object.freeze({ chemin: '/conditions-utilisation', fichier: '/conditions.html' }),
  Object.freeze({ chemin: '/suppression-donnees', fichier: '/suppression-donnees.html' }),
]);

/** Navigations que le service worker doit laisser au réseau (donc à Vercel). */
export const NAVIGATIONS_HORS_APPLICATION = PAGES_PUBLIQUES.map(
  ({ chemin }) => new RegExp(`^${chemin.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}/?$`),
);
