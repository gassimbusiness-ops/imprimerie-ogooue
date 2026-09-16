/**
 * import-excel.js — Saisie hors ligne des rapports journaliers.
 *
 * ── POURQUOI CE FICHIER EXISTE ───────────────────────────────────────────────
 *
 * Moanda subit des coupures de courant. L'application est en ligne ; le comptoir,
 * lui, ne s'arrete pas. Les jours de coupure, le rapport est tenu sur Excel, puis
 * importe ici. Ce module transforme un fichier tableur en une DECISION LISIBLE
 * (ce qui sera cree, ce qui sera modifie, ce qui est refuse) — et rien d'autre.
 * Il n'ecrit pas, il n'affiche pas : c'est l'ecran qui applique, apres
 * confirmation explicite.
 *
 * ── CE QUE CE MODULE NE FERA JAMAIS, ET POURQUOI ─────────────────────────────
 *
 * 1. IL N'ECRIT AUCUN TOTAL EN BASE.
 *
 *    L'import de mars (src/features/admin-import/page.jsx, lignes 218-220)
 *    recopiait tels quels `total_recettes`, `total_depenses` et `caisse_journee`
 *    depuis le fichier source, A COTE de `categories`. Les deux ne se
 *    controlaient pas l'un l'autre.
 *
 *    [MESURE le 16/09/2026 sur la base de production, projet bcwkrrqmjpaohmafcncw]
 *    Sur les 50 rapports encore marques `source = 'import_historique'`, 16 portent
 *    `total_recettes = 3 x caisse_journee`. Exemple, rapport du 2026-01-05
 *    (id 1385703c-c9d6-4f57-b3a9-cc5a4018adfb) :
 *        categories      = les 8 cles, TOUTES A ZERO
 *        lignes          = []
 *        caisse_journee  = 30 600
 *        total_recettes  = 91 800          ← 3 x 30 600, adosse a RIEN
 *    Les ecrans, eux, somment `categories` via `caRapport()` : ils affichent 0 F
 *    pour cette journee. Le chiffre de 91 800 F n'existait que dans un champ que
 *    plus personne ne lisait, et aucun detail ne permettait de trancher.
 *
 *    REGLE : un rapport porte son DETAIL (`lignes`), et ses agregats
 *    (`categories`, `depenses`) sont DERIVES de ce detail, ici, par addition.
 *    Les totaux affiches sont recalcules a la lecture par
 *    `caRapport()` / `depensesRapport()` de src/services/finance-calc.js.
 *    Aucun champ `total_*` n'est ecrit. `payloadSansTotauxFiges()` le verifie.
 *
 * 2. IL NE FAIT PASSER AUCUNE DATE PAR UTC.
 *
 *    Cf. src/lib/dates.js : `new Date(...).toISOString().slice(0,10)` renvoie la
 *    VEILLE a Libreville (UTC+1). Ce defaut a deja coute 55 300 F d'ecart entre
 *    deux ecrans, et un second cas a ete trouve dans les prelevements.
 *    Une date de ce module est une chaine `YYYY-MM-DD` construite par
 *    arithmetique entiere (`dateDepuisJoursEpoch`) ou par decoupage de texte.
 *    Aucun `Date` n'est construit a partir d'une date metier.
 *
 * 3. IL N'ECRASE RIEN TOUT SEUL.
 *
 *    Une date deja presente en base ne produit pas une ecriture : elle produit un
 *    CONFLIT, que l'ecran soumet au gerant (remplacer / fusionner / ignorer).
 *    `ecrituresDuPlan()` refuse de rendre une ecriture pour un conflit non
 *    tranche — c'est une erreur de programmation, pas un defaut par defaut.
 *
 * Module PUR : aucun import React, aucun acces base, aucun DOM.
 *   node --test tests/import-excel.test.mjs
 */

import { CATEGORIES_RAPPORT, caRapport, depensesRapport } from '../../services/finance-calc.js';
import { toISODate } from '../../lib/dates.js';

/* ═══════════════════════════════════════════════════════════════════════════
   1. LE MODELE — quelles colonnes, dans quel ordre, sous quel nom
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Libelle lisible de chaque categorie, dans l'ordre d'affichage du tableur.
 * Les CLES viennent de `CATEGORIES_RAPPORT` (finance-calc.js) : ajouter une 9e
 * categorie la-bas la fait apparaitre ici, dans le modele, et dans l'import.
 * `tests/import-excel.test.mjs` verifie que les deux listes coincident.
 */
const LIBELLES_CATEGORIES = {
  copies: 'Copies',
  marchandises: 'Marchandises',
  scan: 'Scan',
  tirage_saisies: 'Tirage / Saisies',
  badges_plastification: 'Badges / Plastification',
  demi_photos: 'Demi-photos',
  maintenance: 'Maintenance',
  imprimerie: 'Imprimerie',
};

/** Orthographes acceptees a l'import, en plus du libelle et de la cle. */
const SYNONYMES = {
  date: ['jour', 'date du jour'],
  copies: ['copie', 'photocopies', 'photocopie'],
  marchandises: ['marchandise', 'vente', 'ventes'],
  scan: ['scanner', 'numerisation', 'scans'],
  tirage_saisies: ['tirage', 'saisies', 'saisie', 'tirage saisie', 'tirages'],
  badges_plastification: ['badges', 'badge', 'plastification', 'plastif', 'badge plastification'],
  demi_photos: ['photos', 'photo', 'demi photo', 'demi photos', 'photographie'],
  maintenance: ['entretien', 'reparation', 'reparations'],
  imprimerie: ['impression', 'impressions', 'travaux imprimerie'],
  sorties: ['sortie', 'depense', 'depenses', 'sorties depenses', 'retrait', 'retraits'],
  description: ['libelle', 'motif', 'commentaire', 'observation', 'observations', 'detail', 'details'],
};

/**
 * Les colonnes du modele Excel, dans l'ordre.
 * @type {Array<{cle: string, libelle: string, role: 'date'|'categorie'|'depense'|'texte'}>}
 */
export const COLONNES_MODELE = [
  { cle: 'date', libelle: 'Date', role: 'date' },
  ...CATEGORIES_RAPPORT.map((cle) => ({
    cle,
    libelle: LIBELLES_CATEGORIES[cle] || cle,
    role: 'categorie',
  })),
  { cle: 'sorties', libelle: 'Sorties (depenses)', role: 'depense' },
  { cle: 'description', libelle: 'Description', role: 'texte' },
];

/** Nom de la feuille de donnees dans le modele. */
export const FEUILLE_DONNEES = 'Rapports';
/** Nom de la feuille de consignes dans le modele. */
export const FEUILLE_CONSIGNES = "Mode d'emploi";

/**
 * Consignes ecrites DANS le fichier, pour quelqu'un qui tient un comptoir.
 * Pas de jargon, pas de format a deviner : des phrases et un exemple.
 */
export const CONSIGNES_MODELE = [
  ['MODE D\'EMPLOI — Rapport journalier hors ligne'],
  [''],
  ['A quoi sert ce fichier'],
  ['Les jours de coupure de courant, notez ici les recettes de la journee.'],
  ['Quand le courant et internet reviennent, importez ce fichier dans'],
  ['l\'application : menu « Rapports journaliers », bouton « Importer Excel ».'],
  [''],
  ['Comment le remplir'],
  ['1. Allez sur l\'onglet « ' + FEUILLE_DONNEES + '  » (en bas de l\'ecran).'],
  ['2. Une LIGNE = une entree. Ecrivez la date de la journee sur chaque ligne.'],
  ['3. Plusieurs lignes peuvent porter la MEME date : elles seront additionnees'],
  ['   dans un seul rapport pour cette journee, exactement comme a l\'ecran.'],
  ['4. Montants en francs CFA, sans decimales. « 12 500 » ou « 12500 ».'],
  ['5. Case vide = zero. Ne mettez rien si la journee n\'a pas eu cette recette.'],
  ['6. Colonne « Sorties » : l\'argent qui SORT (achats, depot, depense).'],
  ['   Une sortie doit toujours avoir une Description a cote.'],
  ['7. N\'effacez pas la ligne de titres (ligne 1) et ne renommez pas les colonnes.'],
  [''],
  ['La date'],
  ['Ecrivez-la comme vous la dites : 21/09/2026.'],
  ['Le format 2026-09-21 est aussi accepte.'],
  [''],
  ['Ce qui se passe a l\'import'],
  ['L\'application vous montre D\'ABORD ce qu\'elle va faire, ligne par ligne,'],
  ['avec les montants. Rien n\'est enregistre tant que vous n\'avez pas confirme.'],
  ['Si un rapport existe deja pour une journee, elle vous demande quoi faire :'],
  ['remplacer, fusionner, ou ignorer. Elle ne decide jamais toute seule.'],
  ['Apres l\'import, le rapport reste modifiable, comme une saisie a la main.'],
  [''],
  ['Si une ligne est mal remplie, seule CETTE ligne est refusee, avec sa raison.'],
  ['Les autres lignes s\'importent normalement.'],
];

/**
 * Exemple pre-rempli place sous l'en-tete du modele, pour montrer la forme
 * attendue sans avoir a l'expliquer. La date est volontairement ancienne et
 * ronde : personne ne la prendra pour une vraie journee.
 */
export const LIGNE_EXEMPLE = (() => {
  const l = { date: '01/01/2020', description: 'EXEMPLE — effacez cette ligne' };
  for (const c of COLONNES_MODELE) {
    if (c.role === 'categorie') l[c.cle] = '';
  }
  l.copies = 2500;
  l.imprimerie = 16000;
  l.sorties = '';
  return COLONNES_MODELE.map((c) => (l[c.cle] === undefined ? '' : l[c.cle]));
})();

/**
 * Matrice complete du modele : en-tete + ligne d'exemple.
 * Rendue ici (et non dans l'ecran) pour etre verifiable par un test.
 * @returns {Array<Array<string|number>>}
 */
export function matriceModele() {
  return [COLONNES_MODELE.map((c) => c.libelle), LIGNE_EXEMPLE];
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. LECTURE D'UNE DATE — sans jamais passer par UTC
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Conversion en texte qui ne LEVE jamais.
 *
 * `String(valeur)` leve sur un `Symbol` et sur tout objet dont `toString` jette.
 * Une cellule ne contient normalement rien de tel — mais « normalement » est
 * exactement le mot qui a precede l'ecran blanc du 14/09/2026. Une donnee
 * inattendue doit produire un refus nomme, jamais une exception.
 * @param {unknown} v
 * @returns {string}
 */
function texte(v) {
  if (v === null || v === undefined) return '';
  try { return String(v); } catch { return '[valeur illisible]'; }
}

const MOIS_FR = [
  'janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre',
];

/** Nombre de jours du mois `m` (1-12) de l'annee `a`, bissextiles comprises. */
export function joursDansMois(a, m) {
  if (m === 2) return (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0 ? 29 : 28;
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

/**
 * Jours depuis 1970-01-01 -> date civile `YYYY-MM-DD`.
 *
 * Arithmetique entiere pure (algorithme civil_from_days de Howard Hinnant).
 * AUCUN objet `Date` : le resultat est identique a Libreville, Paris, UTC,
 * Kiritimata (UTC+14) et Baker Island (UTC-12). C'est precisement ce que
 * `new Date(serie * 86400000).toISOString()` ne garantit pas.
 *
 * @param {number} z jours depuis l'epoque Unix
 * @returns {string} `YYYY-MM-DD`
 */
export function dateDepuisJoursEpoch(z) {
  let jours = Math.trunc(z) + 719468;
  const era = Math.floor(jours / 146097);
  const doe = jours - era * 146097;                                   // 0..146096
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524)
    - Math.floor(doe / 146096)) / 365);                               // 0..399
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)); // 0..365
  const mp = Math.floor((5 * doy + 2) / 153);                         // 0..11
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;                 // 1..31
  const m = mp < 10 ? mp + 3 : mp - 9;                                // 1..12
  const annee = m <= 2 ? y + 1 : y;
  return `${String(annee).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Numero de serie Excel -> date metier.
 *
 * Excel numerote les jours a partir du 1900-01-01 = 1, MAIS il compte un
 * 29 fevrier 1900 qui n'a jamais existe (compatibilite Lotus 1-2-3). Le
 * decalage n'est donc pas constant : 25568 avant ce jour fantome, 25569 apres.
 * La serie 60 designe le 1900-02-29 lui-meme — une date qui n'existe pas.
 *
 * Aucune journee de l'imprimerie n'est concernee ; la conversion est faite juste
 * quand meme, parce qu'un helper de dates qui ment sur une plage « qu'on
 * n'utilisera pas » finit toujours par etre appele ailleurs.
 *
 * @param {number} serie
 * @returns {string|null} `YYYY-MM-DD`, ou null pour le 1900-02-29 fantome
 */
export function dateDepuisSerieExcel(serie) {
  const s = Math.floor(serie);
  if (s === 60) return null; // le 29 fevrier 1900 d'Excel n'existe pas
  return dateDepuisJoursEpoch(s - (s < 60 ? 25568 : 25569));
}

/**
 * Lit une date de cellule, quelle que soit sa forme.
 *
 * Accepte : `2026-09-21`, `21/09/2026`, `21-09-2026`, `21.09.2026`, `21/09/26`,
 * un numero de serie Excel, un objet `Date` (via `toISODate`, jamais via UTC).
 *
 * @param {unknown} brut
 * @returns {{ok: true, date: string} | {ok: false, message: string}}
 */
export function lireDate(brut) {
  if (brut === null || brut === undefined || brut === '') {
    return { ok: false, message: 'la date est vide' };
  }

  // Objet Date (lecteur configure avec cellDates) : jour LOCAL, cf. lib/dates.js.
  if (brut instanceof Date || (typeof brut === 'object' && typeof brut?.getFullYear === 'function')) {
    if (Number.isNaN(brut.getTime?.())) return { ok: false, message: 'la date du tableur est illisible' };
    return { ok: true, date: toISODate(brut) };
  }

  if (typeof brut === 'number') {
    if (!Number.isFinite(brut)) return { ok: false, message: 'la date du tableur est illisible' };
    // 1 = 1900-01-01 ; 2958465 = 9999-12-31. Hors de la, ce n'est pas une date.
    if (brut < 1 || brut > 2958465) {
      return { ok: false, message: `« ${brut} » n'est pas une date` };
    }
    const converti = dateDepuisSerieExcel(brut);
    if (!converti) return { ok: false, message: `« ${brut} » designe le 29 fevrier 1900, qui n'existe pas` };
    const annee = Number(converti.slice(0, 4));
    if (annee < 2000 || annee > 2100) {
      return { ok: false, message: `« ${brut} » donne le ${converti} : annee improbable` };
    }
    return { ok: true, date: converti };
  }

  const t = texte(brut).trim();
  if (!t) return { ok: false, message: 'la date est vide' };

  let a; let m; let j;

  const iso = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  const fr = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);

  if (iso) {
    a = Number(iso[1]); m = Number(iso[2]); j = Number(iso[3]);
  } else if (fr) {
    j = Number(fr[1]); m = Number(fr[2]); a = Number(fr[3]);
    if (fr[3].length === 2) a += 2000;
  } else if (/^\d{1,2}[-/.]\d{1,2}$/.test(t)) {
    return { ok: false, message: `la date « ${t} » n'a pas d'annee — ecrivez par exemple 21/09/2026` };
  } else if (/^\d+$/.test(t)) {
    return lireDate(Number(t));
  } else {
    return { ok: false, message: `« ${t} » n'est pas une date — ecrivez par exemple 21/09/2026` };
  }

  if (m < 1 || m > 12) {
    return { ok: false, message: `la date « ${t} » n'existe pas : il n'y a pas de mois ${m}` };
  }
  const max = joursDansMois(a, m);
  if (j < 1 || j > max) {
    return {
      ok: false,
      message: `la date « ${t} » n'existe pas : ${MOIS_FR[m - 1]} ${a} n'a que ${max} jours`,
    };
  }
  if (a < 2000 || a > 2100) {
    return { ok: false, message: `la date « ${t} » a une annee improbable (${a})` };
  }

  return {
    ok: true,
    date: `${String(a).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(j).padStart(2, '0')}`,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. LECTURE D'UN MONTANT
   ═══════════════════════════════════════════════════════════════════════════ */

/** Espaces utilises comme separateur de milliers, insecables comprises. */
const ESPACES = /[\s   ]/g;

/**
 * Lit un montant de cellule.
 *
 * Accepte : `12500`, `12 500` (espace normale, insecable ou fine), `12 500 F`,
 * `12500 FCFA`, `12.500` (separateur de milliers), `12500,50` (virgule
 * decimale). Le franc CFA n'a pas de subdivision : le resultat est arrondi a
 * l'unite.
 *
 * Refuse : un montant negatif (une recette negative est une erreur de saisie,
 * une sortie se note dans la colonne Sorties), un texte non numerique.
 *
 * @param {unknown} brut
 * @returns {{ok: true, montant: number} | {ok: false, message: string}}
 */
export function lireMontant(brut) {
  if (brut === null || brut === undefined || brut === '') return { ok: true, montant: 0 };

  if (typeof brut === 'number') {
    if (!Number.isFinite(brut)) return { ok: false, message: 'montant illisible' };
    if (brut < 0) return { ok: false, message: `montant negatif (${brut})` };
    return { ok: true, montant: Math.round(brut) };
  }

  let t = texte(brut).trim();
  if (!t) return { ok: true, montant: 0 };

  const negatif = t.startsWith('-');
  // Devise et signe retires avant analyse : « 12 500 F CFA » reste un nombre.
  t = t.replace(/^[+-]/, '')
    .replace(/(f\s*cfa|fcfa|xaf|francs?|f)\s*$/i, '')
    .trim();

  const sansEspaces = t.replace(ESPACES, '');
  if (!sansEspaces) return { ok: true, montant: 0 };

  let normalise;
  if (/^\d{1,3}(\.\d{3})+$/.test(sansEspaces)) {
    // « 12.500 » : le point separe les milliers (usage courant), pas les decimales.
    normalise = sansEspaces.replace(/\./g, '');
  } else {
    // Sinon la virgule est decimale — « 12500,50 ».
    normalise = sansEspaces.replace(',', '.');
  }

  if (!/^\d+(\.\d+)?$/.test(normalise)) {
    return { ok: false, message: `« ${texte(brut).trim()} » n'est pas un montant` };
  }
  const n = Number(normalise);
  if (!Number.isFinite(n)) return { ok: false, message: `« ${texte(brut).trim()} » n'est pas un montant` };
  if (negatif && n !== 0) return { ok: false, message: `montant negatif (${texte(brut).trim()})` };
  return { ok: true, montant: Math.round(n) };
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. RECONNAISSANCE DES COLONNES
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Forme comparable d'un en-tete : minuscules, sans accents, sans ponctuation.
 * « Tirage / Saisies », « TIRAGE-SAISIES » et « tirage_saisies » deviennent la
 * meme chaine : le gerant ne doit pas avoir a reproduire une orthographe.
 * @param {unknown} s
 * @returns {string}
 */
export function normaliserEntete(s) {
  return texte(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Associe chaque colonne du modele a son index dans la ligne d'en-tete.
 * @param {Array<unknown>} entetes ligne 1 du fichier
 * @returns {{index: Record<string, number>, manquantes: string[], inconnues: Array<{libelle: string, colonne: number}>}}
 */
export function reconnaitreColonnes(entetes = []) {
  const normalisees = (entetes || []).map(normaliserEntete);
  const index = {};
  const utilisees = new Set();

  for (const col of COLONNES_MODELE) {
    const candidats = new Set([
      normaliserEntete(col.libelle),
      normaliserEntete(col.cle),
      ...(SYNONYMES[col.cle] || []).map(normaliserEntete),
    ]);
    let trouve = -1;
    // Egalite exacte d'abord : « Scan » ne doit pas etre attrape par « Scanner »
    // si une colonne « Scan » existe reellement ailleurs dans la feuille.
    for (let i = 0; i < normalisees.length; i++) {
      if (utilisees.has(i)) continue;
      if (candidats.has(normalisees[i])) { trouve = i; break; }
    }
    if (trouve === -1) {
      for (let i = 0; i < normalisees.length; i++) {
        if (utilisees.has(i) || !normalisees[i]) continue;
        if ([...candidats].some((c) => c && normalisees[i].includes(c))) { trouve = i; break; }
      }
    }
    if (trouve !== -1) { index[col.cle] = trouve; utilisees.add(trouve); }
  }

  const manquantes = COLONNES_MODELE.filter((c) => index[c.cle] === undefined).map((c) => c.cle);
  const inconnues = [];
  for (let i = 0; i < normalisees.length; i++) {
    if (utilisees.has(i)) continue;
    if (!normalisees[i]) continue;
    inconnues.push({ libelle: texte(entetes[i]).trim(), colonne: i + 1 });
  }
  return { index, manquantes, inconnues };
}

/** Libelle lisible d'une cle de colonne, pour les messages. */
export function libelleColonne(cle) {
  return COLONNES_MODELE.find((c) => c.cle === cle)?.libelle || cle;
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. ANALYSE DE LA FEUILLE
   ═══════════════════════════════════════════════════════════════════════════ */

/** Une cellule est-elle vide ? */
function estVide(v) {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

/**
 * Analyse la matrice d'une feuille (tableau de lignes, lui-meme tableau de
 * cellules — la sortie de `XLSX.utils.sheet_to_json(ws, { header: 1 })`).
 *
 * N'ecrit rien, ne leve jamais. Une ligne fautive est REFUSEE SEULE, avec sa
 * raison et son numero de ligne tel qu'il apparait dans Excel : 18 lignes
 * bonnes sur 20 s'importent, les 2 mauvaises sont nommees.
 *
 * @param {Array<Array<unknown>>} matrice
 * @returns {{
 *   fatal: null | string,
 *   colonnes: {index: Record<string, number>, manquantes: string[], inconnues: Array},
 *   entrees: Array<{ligne: number, date: string, valeurs: Record<string, number>, sortie: number, description: string}>,
 *   rejets: Array<{ligne: number, message: string}>,
 *   avertissements: string[],
 *   lignesVides: number,
 * }}
 */
export function analyserFeuille(matrice) {
  const vide = {
    fatal: null,
    colonnes: { index: {}, manquantes: [], inconnues: [] },
    entrees: [],
    rejets: [],
    avertissements: [],
    lignesVides: 0,
  };

  if (!Array.isArray(matrice) || matrice.length === 0) {
    return { ...vide, fatal: 'Le fichier est vide : aucune feuille exploitable.' };
  }

  // L'en-tete est la premiere ligne NON VIDE : un fichier peut commencer par une
  // ligne de titre laissee par l'imprimante ou par une ligne blanche.
  let ligneEntete = -1;
  for (let i = 0; i < matrice.length; i++) {
    if (Array.isArray(matrice[i]) && matrice[i].some((c) => !estVide(c))) { ligneEntete = i; break; }
  }
  if (ligneEntete === -1) {
    return { ...vide, fatal: 'Le fichier ne contient aucune ligne : il est vide.' };
  }

  const colonnes = reconnaitreColonnes(matrice[ligneEntete]);
  const avertissements = [];

  if (colonnes.index.date === undefined) {
    return {
      ...vide,
      colonnes,
      fatal: 'Colonne « Date » introuvable. Sans date, aucune ligne ne peut etre '
        + 'rattachee a une journee. Telechargez le modele et recopiez-y vos chiffres.',
    };
  }

  const categoriesTrouvees = CATEGORIES_RAPPORT.filter((c) => colonnes.index[c] !== undefined);
  if (categoriesTrouvees.length === 0) {
    return {
      ...vide,
      colonnes,
      fatal: 'Aucune colonne de recette reconnue (Copies, Marchandises, Scan…). '
        + 'Verifiez la ligne de titres, ou repartez du modele.',
    };
  }

  const manquantesUtiles = colonnes.manquantes.filter((c) => c !== 'description' && c !== 'sorties');
  if (manquantesUtiles.length > 0) {
    avertissements.push(
      `Colonne${manquantesUtiles.length > 1 ? 's' : ''} absente${manquantesUtiles.length > 1 ? 's' : ''} : `
      + `${manquantesUtiles.map(libelleColonne).join(', ')}. `
      + `Ce${manquantesUtiles.length > 1 ? 's postes compteront' : ' poste comptera'} 0 F.`,
    );
  }
  if (colonnes.manquantes.includes('sorties')) {
    avertissements.push('Colonne « Sorties (depenses) » absente : aucune depense ne sera importee.');
  }
  if (colonnes.inconnues.length > 0) {
    avertissements.push(
      `Colonne${colonnes.inconnues.length > 1 ? 's' : ''} en trop, ignoree${colonnes.inconnues.length > 1 ? 's' : ''} : `
      + colonnes.inconnues.map((c) => `« ${c.libelle} »`).join(', ') + '.',
    );
  }

  const entrees = [];
  const rejets = [];
  let lignesVides = 0;

  for (let i = ligneEntete + 1; i < matrice.length; i++) {
    const brute = Array.isArray(matrice[i]) ? matrice[i] : [];
    const numeroLigne = i + 1; // numerotation Excel, 1-based, en-tete comprise
    const cell = (cle) => {
      const idx = colonnes.index[cle];
      return idx === undefined ? '' : brute[idx];
    };

    const toutesVides = COLONNES_MODELE.every((c) => estVide(cell(c.cle)));
    if (toutesVides) { lignesVides++; continue; }

    // Les montants d'abord : une ligne sans date mais sans chiffre non plus est
    // un reliquat de mise en page, pas une erreur a signaler au gerant.
    const valeurs = {};
    let erreurMontant = null;
    let totalLigne = 0;
    for (const cle of CATEGORIES_RAPPORT) {
      const lu = lireMontant(cell(cle));
      if (!lu.ok) {
        erreurMontant = `colonne « ${libelleColonne(cle)} » : ${lu.message}`;
        break;
      }
      valeurs[cle] = lu.montant;
      totalLigne += lu.montant;
    }

    let sortie = 0;
    if (!erreurMontant) {
      const luSortie = lireMontant(cell('sorties'));
      if (!luSortie.ok) erreurMontant = `colonne « ${libelleColonne('sorties')} » : ${luSortie.message}`;
      else sortie = luSortie.montant;
    }

    const description = texte(cell('description')).trim();

    if (erreurMontant) { rejets.push({ ligne: numeroLigne, message: erreurMontant }); continue; }

    if (totalLigne === 0 && sortie === 0 && !description) { lignesVides++; continue; }

    const luDate = lireDate(cell('date'));
    if (!luDate.ok) {
      rejets.push({ ligne: numeroLigne, message: `colonne « Date » : ${luDate.message}` });
      continue;
    }

    if (sortie > 0 && !description) {
      rejets.push({
        ligne: numeroLigne,
        message: `une sortie de ${sortie} F est notee sans description — precisez a quoi correspond cette depense`,
      });
      continue;
    }

    entrees.push({ ligne: numeroLigne, date: luDate.date, valeurs, sortie, description });
  }

  if (entrees.length === 0 && rejets.length === 0) {
    return {
      ...vide,
      colonnes,
      avertissements,
      lignesVides,
      fatal: 'Le fichier ne contient aucune ligne remplie : il n\'y a rien a importer.',
    };
  }

  return { fatal: null, colonnes, entrees, rejets, avertissements, lignesVides };
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. EMPREINTE DU FICHIER — pour reconnaitre un fichier deja importe
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Empreinte stable du CONTENU analyse (dates + montants + descriptions).
 *
 * Elle ne depend ni du nom du fichier, ni de l'ordre des colonnes, ni de la mise
 * en forme : deux enregistrements successifs du meme tableur donnent la meme
 * empreinte. C'est ce qui permet de dire « ce fichier a deja ete importe le … »
 * plutot que de creer un second rapport en doublon.
 *
 * Fonction de hachage volontairement simple (FNV-1a 32 bits) : on cherche a
 * reconnaitre un re-import, pas a resister a un adversaire.
 *
 * @param {Array<{date: string, valeurs: Record<string, number>, sortie: number, description: string}>} entrees
 * @returns {string} 8 caracteres hexadecimaux
 */
export function empreinteEntrees(entrees = []) {
  const texte = (entrees || [])
    .map((e) => [
      e.date,
      CATEGORIES_RAPPORT.map((c) => e.valeurs?.[c] || 0).join(','),
      e.sortie || 0,
      (e.description || '').trim().toLowerCase(),
    ].join('|'))
    .sort()
    .join('\n');

  let h = 0x811c9dc5;
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/* ═══════════════════════════════════════════════════════════════════════════
   7. REGROUPEMENT PAR JOURNEE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Regroupe les entrees par date metier.
 *
 * Plusieurs lignes du tableur peuvent porter la meme date : elles forment UN
 * rapport, comme les 30 lignes de la grille de saisie a l'ecran. Les agregats
 * (`categories`, `depenses`) sont DERIVES des lignes — jamais recopies d'ailleurs.
 *
 * @param {Array} entrees sortie de `analyserFeuille().entrees`
 * @returns {Array<{date: string, lignes: Array, categories: Record<string, number>, depenses: Array, numerosLignes: number[]}>}
 */
export function grouperParJournee(entrees = []) {
  const parDate = new Map();

  for (const e of entrees) {
    if (!parDate.has(e.date)) {
      const categories = {};
      for (const c of CATEGORIES_RAPPORT) categories[c] = 0;
      parDate.set(e.date, { date: e.date, lignes: [], categories, depenses: [], numerosLignes: [] });
    }
    const g = parDate.get(e.date);

    const ligne = { description: e.description || '' };
    for (const c of CATEGORIES_RAPPORT) {
      ligne[c] = e.valeurs?.[c] || 0;
      g.categories[c] += ligne[c];
    }
    ligne.sorties = e.sortie || 0;

    g.lignes.push(ligne);
    g.numerosLignes.push(e.ligne);
    if (ligne.sorties > 0) {
      g.depenses.push({ description: ligne.description || 'Sortie', montant: ligne.sorties });
    }
  }

  return [...parDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/* ═══════════════════════════════════════════════════════════════════════════
   8. PLAN D'IMPORT — ce qui sera cree, ce qui entre en conflit
   ═══════════════════════════════════════════════════════════════════════════ */

/** Statuts dont l'ecran Rapports interdit la modification directe. */
export const STATUTS_VERROUILLES = ['valide', 'cloture'];

/** Les trois decisions possibles face a un conflit. Aucune n'est prise d'office. */
export const DECISIONS = ['remplacer', 'fusionner', 'ignorer'];

/** Un rapport existant est-il verrouille (valide ou cloture) ? */
export function estVerrouille(rapport) {
  return STATUTS_VERROUILLES.includes(rapport?.statut);
}

/**
 * Totaux d'un rapport (existant ou a creer), via la source unique de verite.
 * On ne lit JAMAIS `rapport.total_recettes` : c'est le champ dont la valeur a
 * diverge de son propre detail sur 16 rapports de production.
 * @param {object} rapport
 * @returns {{recettes: number, depenses: number, solde: number}}
 */
export function totaux(rapport) {
  const recettes = caRapport(rapport);
  const depenses = depensesRapport(rapport);
  return { recettes, depenses, solde: recettes - depenses };
}

/**
 * Construit le contenu metier d'un rapport a partir d'une journee groupee.
 *
 * Ne contient AUCUN champ `total_*` ni `caisse_journee` : les totaux sont
 * recalcules a la lecture. Voir l'entete de ce fichier.
 *
 * @param {object} journee sortie de `grouperParJournee`
 * @returns {{date: string, categories: object, depenses: Array, lignes: Array}}
 */
export function contenuRapport(journee) {
  return {
    date: journee.date,
    categories: { ...journee.categories },
    depenses: journee.depenses.map((d) => ({ ...d })),
    lignes: journee.lignes.map((l) => ({ ...l })),
  };
}

/**
 * Trace d'origine attachee a chaque rapport importe.
 *
 * Sans trace d'origine on ne peut ni dedupliquer, ni corriger, ni meme savoir
 * d'ou vient un chiffre : c'est la lecon du rapport de mars, ou 16 journees
 * portaient un total que rien ne justifiait et qu'aucun detail ne permettait
 * de reconstituer.
 *
 * @returns {object}
 */
export function traceOrigine({ fichier, empreinte, importeLe, utilisateur, mode, numerosLignes }) {
  return {
    fichier: texte(fichier || 'fichier.xlsx'),
    empreinte: texte(empreinte || ''),
    importe_le: texte(importeLe || ''),
    importe_par: texte(utilisateur?.nom || 'inconnu'),
    importe_par_id: utilisateur?.id || null,
    mode,
    lignes_fichier: [...(numerosLignes || [])],
  };
}

/**
 * Compare le fichier a ce qui est deja en base et rend un PLAN.
 *
 * Un plan n'ecrit rien. Il dit, journee par journee, ce qui serait cree, ce qui
 * entre en conflit (avec le detail des deux cotes, montants compris), et ce qui
 * est refuse. C'est ce plan que l'ecran affiche avant toute confirmation.
 *
 * @param {object} p
 * @param {object} p.analyse sortie de `analyserFeuille`
 * @param {Array} [p.rapportsExistants]
 * @param {string} [p.fichier] nom du fichier
 * @param {object} [p.utilisateur] `{id, nom}`
 * @param {string} [p.importeLe] horodatage ISO de l'import
 * @returns {object}
 */
export function preparerPlan({
  analyse,
  rapportsExistants = [],
  fichier = '',
  utilisateur = null,
  importeLe = '',
} = {}) {
  if (!analyse || analyse.fatal) {
    return {
      fatal: analyse?.fatal || 'Fichier illisible.',
      creations: [], conflits: [], rejets: analyse?.rejets || [],
      avertissements: analyse?.avertissements || [], empreinte: '',
      lignesVides: analyse?.lignesVides || 0, journees: 0,
    };
  }

  const empreinte = empreinteEntrees(analyse.entrees);
  const journees = grouperParJournee(analyse.entrees);

  // Une date peut apparaitre plusieurs fois en base (doublon historique) : on
  // prend le plus recemment modifie, et on le signale.
  const parDate = new Map();
  const datesEnDouble = new Set();
  for (const r of rapportsExistants || []) {
    if (!r?.date) continue;
    if (parDate.has(r.date)) {
      datesEnDouble.add(r.date);
      const ancien = parDate.get(r.date);
      const plusRecent = (r.updated_at || r.created_at || '') > (ancien.updated_at || ancien.created_at || '');
      if (plusRecent) parDate.set(r.date, r);
    } else {
      parDate.set(r.date, r);
    }
  }

  const creations = [];
  const conflits = [];

  for (const j of journees) {
    const contenu = contenuRapport(j);
    const entrant = { ...contenu, totaux: totaux(contenu), numerosLignes: j.numerosLignes };
    const existant = parDate.get(j.date);

    if (!existant) {
      creations.push({ date: j.date, contenu, ...entrant });
      continue;
    }

    const verrou = estVerrouille(existant);
    const dejaImporte = existant?.import_excel?.empreinte === empreinte && !!empreinte;

    const interdits = {};
    if (verrou) {
      const motif = `Ce rapport est ${existant.statut === 'cloture' ? 'cloture' : 'valide'} : `
        + 'il est verrouille a l\'ecran. Deverrouillez-le d\'abord, ou choisissez « Ignorer ».';
      interdits.remplacer = motif;
      interdits.fusionner = motif;
    }

    const fusionne = fusionnerContenu(existant, contenu);

    conflits.push({
      date: j.date,
      dejaImporte,
      enDouble: datesEnDouble.has(j.date),
      existant: {
        id: existant.id,
        statut: existant.statut || 'brouillon',
        verrouille: verrou,
        operateur_nom: existant.operateur_nom || '',
        origine: existant.import_excel || null,
        totaux: totaux(existant),
        // Le contenu est conserve tel quel : c'est lui, et non des totaux
        // recopies, qui sert de base a une eventuelle fusion.
        contenu: {
          categories: { ...(existant.categories || {}) },
          depenses: [...(existant.depenses || [])],
          lignes: [...(existant.lignes || [])],
        },
      },
      entrant,
      apresFusion: totaux(fusionne),
      interdits,
    });
  }

  return {
    fatal: null,
    empreinte,
    creations,
    conflits,
    rejets: analyse.rejets,
    avertissements: analyse.avertissements,
    lignesVides: analyse.lignesVides,
    journees: journees.length,
    fichier,
    utilisateur,
    importeLe,
  };
}

/**
 * Contenu d'un rapport apres FUSION : l'existant garde tout, l'entrant s'ajoute.
 *
 * Les agregats restent derives : `categories` est la somme poste par poste,
 * `lignes` et `depenses` sont concatenees. Rien n'est ecrase, rien n'est perdu.
 *
 * @param {object} existant
 * @param {object} entrant contenu issu de `contenuRapport`
 * @returns {{categories: object, depenses: Array, lignes: Array}}
 */
export function fusionnerContenu(existant, entrant) {
  const categories = {};
  const cles = new Set([
    ...Object.keys(existant?.categories || {}),
    ...Object.keys(entrant?.categories || {}),
  ]);
  for (const c of cles) {
    categories[c] = (Number(existant?.categories?.[c]) || 0) + (Number(entrant?.categories?.[c]) || 0);
  }
  return {
    categories,
    depenses: [...(existant?.depenses || []), ...(entrant?.depenses || [])],
    lignes: [...(existant?.lignes || []), ...(entrant?.lignes || [])],
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   9. DU PLAN AUX ECRITURES
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Traduit un plan + les decisions du gerant en une liste d'ecritures.
 *
 * C'est la derniere etape PURE : l'ecran se contente d'executer cette liste.
 * Tout ce qui pourrait ecraser une donnee est decide ici, et testable ici.
 *
 * @param {object} plan sortie de `preparerPlan`
 * @param {Record<string, 'remplacer'|'fusionner'|'ignorer'>} decisions par date
 * @param {object} [options] `{statut, operateur}` du rapport cree
 * @returns {{ecritures: Array, ignorees: string[], indecises: string[]}}
 */
export function ecrituresDuPlan(plan, decisions = {}, options = {}) {
  const ecritures = [];
  const ignorees = [];
  const indecises = [];

  if (!plan || plan.fatal) return { ecritures, ignorees, indecises };

  const {
    // Un rapport importe arrive en BROUILLON : c'est la demande explicite de
    // Gassim — « avec possibilite de modifier ». Un rapport cloture d'office
    // serait verrouille a l'ecran, donc non modifiable.
    statut = 'brouillon',
    operateur = null,
  } = options;

  const base = {
    fichier: plan.fichier,
    empreinte: plan.empreinte,
    importeLe: plan.importeLe,
    utilisateur: plan.utilisateur,
  };

  for (const c of plan.creations) {
    ecritures.push({
      type: 'creation',
      date: c.date,
      data: {
        ...c.contenu,
        statut,
        operateur_id: operateur?.id || null,
        operateur_nom: operateur?.nom || (plan.utilisateur?.nom ?? ''),
        source: 'import_excel',
        historique: [],
        import_excel: traceOrigine({ ...base, mode: 'creation', numerosLignes: c.numerosLignes }),
      },
    });
  }

  for (const conflit of plan.conflits) {
    const d = decisions[conflit.date];
    if (!d || d === 'ignorer') {
      if (!d) indecises.push(conflit.date); else ignorees.push(conflit.date);
      continue;
    }
    if (!DECISIONS.includes(d)) { indecises.push(conflit.date); continue; }
    if (conflit.interdits[d]) { ignorees.push(conflit.date); continue; }

    const trace = traceOrigine({
      ...base,
      mode: d === 'remplacer' ? 'remplacement' : 'fusion',
      numerosLignes: conflit.entrant.numerosLignes,
    });

    const contenu = d === 'remplacer'
      ? {
        categories: conflit.entrant.categories,
        depenses: conflit.entrant.depenses,
        lignes: conflit.entrant.lignes,
      }
      : fusionnerContenu(conflit.existant.contenu, conflit.entrant);

    ecritures.push({
      type: 'modification',
      date: conflit.date,
      id: conflit.existant.id,
      mode: d,
      // `patch` est volontairement partiel : il ne touche ni la date, ni
      // l'operateur, ni la date de creation du rapport existant.
      patch: { ...contenu, source: 'import_excel', import_excel: trace },
    });
  }

  return { ecritures, ignorees, indecises };
}

/**
 * Detail lisible d'une modification, au format attendu par le panneau
 * « Historique des modifications » de `components/rapport-form.jsx`.
 *
 * Un import qui modifie un rapport existant doit laisser la MEME trace qu'une
 * correction a la main : sinon le gerant voit un chiffre changer sans savoir
 * ni quand ni pourquoi.
 *
 * @param {object} avant contenu existant
 * @param {object} apres contenu apres ecriture
 * @returns {Array<{ligne: string, colonne: string, ancien: number, nouveau: number}>}
 */
export function detailsHistorique(avant, apres) {
  const details = [];
  for (const cle of CATEGORIES_RAPPORT) {
    const ancien = Number(avant?.categories?.[cle]) || 0;
    const nouveau = Number(apres?.categories?.[cle]) || 0;
    if (ancien !== nouveau) {
      details.push({ ligne: '—', colonne: libelleColonne(cle), ancien, nouveau });
    }
  }
  const depAvant = depensesRapport(avant);
  const depApres = depensesRapport(apres);
  if (depAvant !== depApres) {
    details.push({ ligne: '—', colonne: 'Sorties (depenses)', ancien: depAvant, nouveau: depApres });
  }
  return details;
}

/**
 * Verifie qu'un objet destine a la base ne fige aucun total.
 *
 * Garde-fou explicite contre la repetition du defaut de mars : si un jour
 * quelqu'un rajoute `total_recettes` dans un payload d'import, un test echoue
 * ici plutot qu'un ecart de 47,6 M F se decouvre six mois plus tard.
 *
 * @param {object} data
 * @returns {string[]} les champs interdits presents (vide = conforme)
 */
export function payloadSansTotauxFiges(data) {
  const interdits = ['total_recettes', 'total_depenses', 'caisse_journee', 'solde', 'total'];
  return interdits.filter((k) => data && Object.prototype.hasOwnProperty.call(data, k));
}

/**
 * Resume chiffre d'un plan, pour l'en-tete de l'apercu.
 * @param {object} plan
 * @returns {{aCreer: number, enConflit: number, refusees: number, recettes: number, depenses: number}}
 */
export function resumePlan(plan) {
  if (!plan || plan.fatal) {
    return { aCreer: 0, enConflit: 0, refusees: plan?.rejets?.length || 0, recettes: 0, depenses: 0 };
  }
  const recettes = plan.creations.reduce((s, c) => s + c.totaux.recettes, 0)
    + plan.conflits.reduce((s, c) => s + c.entrant.totaux.recettes, 0);
  const depenses = plan.creations.reduce((s, c) => s + c.totaux.depenses, 0)
    + plan.conflits.reduce((s, c) => s + c.entrant.totaux.depenses, 0);
  return {
    aCreer: plan.creations.length,
    enConflit: plan.conflits.length,
    refusees: plan.rejets.length,
    recettes,
    depenses,
  };
}

/**
 * Motif de refus quand l'appareil n'a pas de reseau.
 *
 * ⚠️ POURQUOI C'EST NECESSAIRE
 * `db.rapports.list()` (src/services/db.js) journalise l'erreur Supabase et
 * renvoie `[]`. Hors ligne, « la base est vide » et « la base est injoignable »
 * sont donc indiscernables : l'import annoncerait « 0 rapport deja en base »,
 * ne verrait AUCUN conflit, et proposerait de tout creer. Les ecritures
 * echoueraient ensuite une par une — sans degat, mais apres avoir montre un
 * apercu faux. Un apercu faux est pire qu'un refus.
 */
export const MOTIF_HORS_LIGNE =
  'Cet appareil n\'a pas de reseau. L\'import a besoin de la liste des rapports '
  + 'deja enregistres pour savoir quelles journees existent : sans reseau, il ne '
  + 'peut pas la lire et croirait la base vide. Gardez le fichier Excel et '
  + 'reessayez quand la connexion est revenue — rien n\'est perdu.';

/**
 * Le bouton « Confirmer » peut-il etre actif ? Et sinon, POURQUOI ?
 *
 * Regle du projet : un bouton desactive dit toujours pourquoi, a cote. Cette
 * fonction rend le motif exact, en francais, pret a etre affiche.
 *
 * @param {object} plan
 * @param {Record<string, string>} decisions
 * @param {boolean} [enCours] un import est-il deja en train de tourner ?
 * @param {boolean} [horsLigne] l'appareil est-il sans reseau ?
 * @returns {{actif: boolean, motif: string, nbEcritures: number}}
 */
export function etatConfirmation(plan, decisions = {}, enCours = false, horsLigne = false) {
  if (horsLigne) {
    return { actif: false, motif: MOTIF_HORS_LIGNE, nbEcritures: 0 };
  }
  if (enCours) {
    return { actif: false, motif: 'Import en cours — patientez, ne cliquez pas deux fois.', nbEcritures: 0 };
  }
  if (!plan) return { actif: false, motif: 'Choisissez d\'abord un fichier Excel.', nbEcritures: 0 };
  if (plan.fatal) return { actif: false, motif: plan.fatal, nbEcritures: 0 };

  const { ecritures, indecises } = ecrituresDuPlan(plan, decisions);

  if (indecises.length > 0) {
    const liste = indecises.slice(0, 3).join(', ');
    const reste = indecises.length > 3 ? ` (+${indecises.length - 3} autre${indecises.length - 3 > 1 ? 's' : ''})` : '';
    return {
      actif: false,
      nbEcritures: ecritures.length,
      motif: `${indecises.length} journee${indecises.length > 1 ? 's' : ''} existe${indecises.length > 1 ? 'nt' : ''} deja `
        + `et attend${indecises.length > 1 ? 'ent' : ''} votre choix : ${liste}${reste}. `
        + 'Choisissez Remplacer, Fusionner ou Ignorer pour chacune.',
    };
  }

  if (ecritures.length === 0) {
    return {
      actif: false,
      nbEcritures: 0,
      motif: 'Rien a enregistrer : toutes les journees du fichier sont ignorees ou refusees.',
    };
  }

  return { actif: true, motif: '', nbEcritures: ecritures.length };
}
