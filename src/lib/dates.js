/**
 * Dates métier — IMPRIMERIE OGOOUÉ
 *
 * ⚠️ POURQUOI CE FICHIER EXISTE
 *
 * `new Date(2026, 8, 1)` construit minuit **en heure locale**.
 * `.toISOString()` convertit ensuite en **UTC**.
 * Sur une machine à UTC+1 (Gabon) ou UTC+2 (Europe l'été), minuit local du 1er septembre
 * devient `2026-08-31T22:00:00Z`, et `.slice(0, 10)` renvoie **"2026-08-31"**.
 *
 * Résultat constaté en production : le Tableau de bord et Rapports & Analyses affichaient
 * deux chiffres d'affaires différents pour « ce mois » — l'un incluait le dernier jour du
 * mois précédent, l'autre non. Écart observé : 55 300 F CFA.
 *
 * Les dates de ce logiciel (`rapport.date`, `commande.date`…) sont des **dates métier**
 * au format `YYYY-MM-DD`, sans heure. Elles ne doivent jamais transiter par UTC.
 *
 * RÈGLE : pour transformer un objet Date en date métier, utiliser `toISODate()`.
 * Ne jamais utiliser `.toISOString().slice(0, 10)` ni `.toISOString().split('T')[0]`.
 */

/** Fuseau de référence de l'entreprise. */
export const FUSEAU_METIER = 'Africa/Libreville';

/**
 * Convertit un objet Date en date métier `YYYY-MM-DD`, en conservant le jour local.
 * @param {Date} d
 * @returns {string}
 */
export function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const j = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${j}`;
}

/** Date métier d'aujourd'hui. */
export function todayISO() {
  return toISODate(new Date());
}

/** Premier jour du mois de `d` (par défaut : le mois en cours). */
export function startOfMonthISO(d = new Date()) {
  return toISODate(new Date(d.getFullYear(), d.getMonth(), 1));
}

/** Date métier décalée de `n` jours (n négatif pour reculer). */
export function addDaysISO(n, d = new Date()) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return toISODate(x);
}
