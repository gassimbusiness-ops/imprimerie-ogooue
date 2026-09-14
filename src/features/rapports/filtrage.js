/**
 * filtrage.js — Filtrage des rapports journaliers : plage de dates + recherche par mot.
 *
 * Module PUR (aucun import React, aucun accès base) pour être testable en Node :
 *   node --test tests/filtrage.test.mjs
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ RÈGLE DE DATES (cf. src/lib/dates.js)
 *
 * `rapport.date` est une **date métier** `YYYY-MM-DD`, sans heure et sans fuseau.
 * Ce module ne construit JAMAIS d'objet `Date` à partir d'une date métier : la
 * comparaison de deux chaînes `YYYY-MM-DD` est déjà chronologique (ordre
 * lexicographique = ordre calendaire, longueurs égales, champs zéro-paddés).
 * C'est ce qui garantit un résultat identique à Libreville, Paris, UTC ou
 * Kiritimati. Passer par `new Date(...)` réintroduirait le décalage d'un jour
 * qui a déjà coûté 55 300 F d'écart entre deux écrans.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ RÈGLE DES VALEURS INDISPONIBLES
 *
 * Une mesure calculée sur zéro rapport n'est pas « 0 F », elle est indisponible.
 * `totauxFiltres()` renvoie `null` dans ce cas ; l'écran doit afficher « — ».
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { todayISO, startOfMonthISO } from '../../lib/dates.js';

/** Une date métier valide : exactement `YYYY-MM-DD`. */
const RE_DATE_METIER = /^\d{4}-\d{2}-\d{2}$/;

/** Marques diacritiques combinantes produites par NFD (accents, cédille…). */
const RE_DIACRITIQUES = /[̀-ͯ]/g;

/** Ligatures que NFD ne décompose pas. */
const LIGATURES = [
  [/œ/g, 'oe'], // œ
  [/Œ/g, 'oe'], // Œ
  [/æ/g, 'ae'], // æ
  [/Æ/g, 'ae'], // Æ
];

/**
 * Est-ce une date métier exploitable ? Une borne vide ou mal formée est
 * traitée comme « pas de borne » plutôt que comme « aucun résultat » — sinon
 * la liste se viderait pendant la saisie.
 * @param {unknown} d
 * @returns {boolean}
 */
export function estDateMetier(d) {
  return typeof d === 'string' && RE_DATE_METIER.test(d);
}

/**
 * Normalise un texte pour la recherche : minuscules, sans accents, sans
 * ligatures, espaces compactés.
 *
 * « Dépôt Génération » → « depot generation », ce qui rend la recherche
 * insensible à la casse ET aux accents dans les deux sens : on retrouve
 * « dépôt » en tapant « depot », et « depot » en tapant « dépôt ».
 *
 * @param {unknown} v
 * @returns {string}
 */
export function normaliserTexte(v) {
  if (v == null) return '';
  let s = String(v);
  for (const [re, rep] of LIGATURES) s = s.replace(re, rep);
  return s
    .normalize('NFD')
    .replace(RE_DIACRITIQUES, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Concatène tout ce qui est textuel dans un rapport, sous forme normalisée.
 *
 * Champs couverts :
 *  - `operateur_nom`        — l'employé qui a saisi le rapport
 *  - `lignes[].description` — les libellés de lignes du tableur
 *  - `depenses[].description` — les libellés de sorties de caisse
 *  - `commentaire` / `note` / `notes` / `remarque` — notes libres si présentes
 *  - `valide_par` / `cloture_par` / `deverrouille_par` — qui a agi sur le rapport
 *
 * La date n'est volontairement PAS indexée : c'est le rôle de la plage.
 *
 * @param {object} rapport
 * @returns {string} texte normalisé, prêt pour un `includes()`
 */
export function texteRecherchable(rapport) {
  if (!rapport) return '';
  const morceaux = [
    rapport.operateur_nom,
    rapport.commentaire,
    rapport.note,
    rapport.notes,
    rapport.remarque,
    rapport.valide_par,
    rapport.cloture_par,
    rapport.deverrouille_par,
  ];
  for (const l of rapport.lignes || []) morceaux.push(l?.description);
  for (const d of rapport.depenses || []) morceaux.push(d?.description);
  return normaliserTexte(morceaux.filter(Boolean).join(' '));
}

/**
 * Pré-calcule le texte recherchable de chaque rapport.
 *
 * Il y a plus de 600 rapports, chacun avec une trentaine de lignes : refaire
 * la normalisation à chaque frappe reviendrait à normaliser ~18 000 chaînes
 * par caractère tapé. L'index se calcule UNE fois par jeu de données.
 *
 * @param {Array<object>} rapports
 * @returns {Map<object, string>} rapport → texte normalisé
 */
export function indexerRapports(rapports = []) {
  const index = new Map();
  for (const r of rapports || []) index.set(r, texteRecherchable(r));
  return index;
}

/**
 * Remet une plage à l'endroit.
 *
 * Si le gérant saisit « du 15 au 05 », on ne renvoie pas une liste vide : on
 * inverse les bornes et on le signale (`inversee`) pour que l'écran l'affiche.
 * Une borne absente ou mal formée devient `''` = borne ouverte.
 *
 * @param {string} debut
 * @param {string} fin
 * @returns {{debut: string, fin: string, inversee: boolean}}
 */
export function normaliserPlage(debut, fin) {
  const d = estDateMetier(debut) ? debut : '';
  const f = estDateMetier(fin) ? fin : '';
  if (d && f && d > f) return { debut: f, fin: d, inversee: true };
  return { debut: d, fin: f, inversee: false };
}

/**
 * Une date métier est-elle dans la plage ? **Bornes incluses des deux côtés** :
 * « du 05 au 15/04 » contient le 05 ET le 15.
 *
 * Comparaison de chaînes uniquement — voir l'avertissement en tête de fichier.
 *
 * @param {string} date  date métier `YYYY-MM-DD`
 * @param {string} debut borne basse incluse ('' = pas de borne)
 * @param {string} fin   borne haute incluse ('' = pas de borne)
 * @returns {boolean}
 */
export function dansPlage(date, debut, fin) {
  if (!estDateMetier(date)) return false;
  if (debut && date < debut) return false;
  if (fin && date > fin) return false;
  return true;
}

/**
 * La plage est-elle réellement active (au moins une borne exploitable) ?
 * @param {string} debut
 * @param {string} fin
 */
export function plageActive(debut, fin) {
  return estDateMetier(debut) || estDateMetier(fin);
}

/**
 * Filtre une liste de rapports. Tous les critères se combinent en **ET**.
 *
 * @param {Array<object>} rapports
 * @param {object} criteres
 * @param {string} [criteres.debut]  borne basse incluse `YYYY-MM-DD`
 * @param {string} [criteres.fin]    borne haute incluse `YYYY-MM-DD`
 * @param {string} [criteres.mot]    mot recherché (casse et accents indifférents ; vide = pas de filtre)
 * @param {string} [criteres.statut] statut exact, ou 'all' / '' pour ne pas filtrer
 * @param {string} [criteres.mois]   repli `YYYY-MM` utilisé UNIQUEMENT si aucune borne de plage n'est fournie
 * @param {Map<object, string>} [index] index produit par `indexerRapports`
 * @returns {Array<object>}
 */
export function filtrerRapports(rapports = [], criteres = {}, index = null) {
  const { debut, fin, inversee: _inversee } = normaliserPlage(criteres.debut, criteres.fin);
  const mot = normaliserTexte(criteres.mot);
  const statut = criteres.statut && criteres.statut !== 'all' ? criteres.statut : '';
  const mois = criteres.mois || '';
  const utilisePlage = !!(debut || fin);

  return (rapports || []).filter((r) => {
    if (!r) return false;

    if (statut && r.statut !== statut) return false;

    if (utilisePlage) {
      if (!dansPlage(r.date, debut, fin)) return false;
    } else if (mois) {
      // Repli : le mois affiché par la navigation ← →
      if (!(typeof r.date === 'string' && r.date.startsWith(mois))) return false;
    }

    if (mot) {
      const texte = index?.get(r) ?? texteRecherchable(r);
      if (!texte.includes(mot)) return false;
    }

    return true;
  });
}

/**
 * Plage par défaut proposée à l'ouverture : du 1er du mois en cours à aujourd'hui.
 * Calculée via `src/lib/dates.js`, donc sans passage par UTC.
 * @returns {{debut: string, fin: string}}
 */
export function plageParDefaut() {
  return { debut: startOfMonthISO(), fin: todayISO() };
}

/**
 * Rend une date métier en `JJ/MM/AAAA` sans construire d'objet `Date`.
 * @param {string} d
 * @returns {string} '' si la date est inexploitable
 */
export function formatJour(d) {
  if (!estDateMetier(d)) return '';
  const [y, m, j] = d.split('-');
  return `${j}/${m}/${y}`;
}

/**
 * Libellé lisible de la période effectivement appliquée, à afficher en clair.
 * Ex. : « du 05/04/2026 au 15/04/2026 », « le 05/04/2026 », « jusqu'au 15/04/2026 ».
 *
 * @param {string} debut
 * @param {string} fin
 * @returns {string} '' si aucune borne
 */
export function libellePlage(debut, fin) {
  const p = normaliserPlage(debut, fin);
  if (p.debut && p.fin) {
    return p.debut === p.fin
      ? `le ${formatJour(p.debut)}`
      : `du ${formatJour(p.debut)} au ${formatJour(p.fin)}`;
  }
  if (p.debut) return `à partir du ${formatJour(p.debut)}`;
  if (p.fin) return `jusqu'au ${formatJour(p.fin)}`;
  return '';
}

/**
 * Totaux d'un ensemble de rapports filtrés.
 *
 * Sur un ensemble VIDE, les montants valent `null` (indisponible → « — »),
 * jamais `0` : afficher « 0 F » laisserait croire à une journée sans recette
 * alors qu'aucun rapport ne correspond à la recherche.
 *
 * Les montants réutilisent `caRapport` / `depensesRapport` (source unique de
 * vérité) injectés par l'appelant, pour ne pas recalculer un CA à la main ici.
 *
 * @param {Array<object>} rapports ensemble déjà filtré
 * @param {{ca: (r: object) => number, depenses: (r: object) => number}} calc
 * @returns {{count: number, recettes: number|null, depenses: number|null, solde: number|null}}
 */
export function totauxFiltres(rapports, calc) {
  const liste = rapports || [];
  if (liste.length === 0) {
    return { count: 0, recettes: null, depenses: null, solde: null };
  }
  const recettes = liste.reduce((s, r) => s + (Number(calc.ca(r)) || 0), 0);
  const depenses = liste.reduce((s, r) => s + (Number(calc.depenses(r)) || 0), 0);
  return { count: liste.length, recettes, depenses, solde: recettes - depenses };
}
