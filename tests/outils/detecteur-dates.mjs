/**
 * LE DÉTECTEUR — une seule implémentation, plusieurs garde-fous.
 *
 * ── Pourquoi il vit ici, à part des tests ─────────────────────────────────
 *
 * `tests/dates-heure-de-londres.test.mjs` interdit une première famille de
 * fautes : les dates métier fabriquées à partir de `toISOString()`.
 * `tests/dates-horodatage-supabase.test.mjs` en interdit une seconde : les
 * horodatages de la base tronqués à coups de `.slice(0, 10)`.
 *
 * Les deux cherchent des formes différentes dans LE MÊME code, avec la MÊME
 * façon de lire. Ce fichier est cette façon de lire, écrite une fois. Deux
 * copies auraient divergé, et un détecteur qui rate ce qu'il cherche est pire
 * qu'aucun détecteur, parce qu'il rassure.
 *
 * ── Comment il lit le code, et pourquoi pas avec une expression régulière ──
 *
 * Un fichier a le DROIT de parler du défaut : `src/lib/dates.js` l'écrit en
 * toutes lettres, et plusieurs autres portent un commentaire d'avertissement.
 * Un simple `grep` les compterait comme des fautes, et on corrigerait le test
 * en déplaçant une phrase.
 *
 * Une première version séparait code et commentaires à la main. Elle a RATÉ
 * deux fautes réelles (prospection/page.jsx l. 636 et 692) : une apostrophe
 * française dans du texte JSX ouvre une chaîne qui ne se ferme jamais, et tout
 * ce qui suit disparaît.
 *
 * Le verdict vient donc d'esbuild — LE MÊME transformeur que celui qui bâtit
 * l'application et que celui du harnais de rendu d'écran. Il rend du JS sans
 * commentaires et sans JSX ; il ne reste alors qu'à masquer les chaînes, ce
 * qui est trivial sur du JS ordinaire. Ce que le build compile, le test le
 * lit : les deux ne peuvent pas diverger.
 *
 * ⚠️ Ce fichier n'est pas un `*.test.mjs` : `npm test` ne le lance pas seul,
 * il est importé par les garde-fous qui s'en servent.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

export const RACINE = fileURLToPath(new URL('../..', import.meta.url));

/** Répertoires balayés. Ce sont les deux qui partent en production. */
export const RACINES_SURVEILLEES = ['src', 'api'];

/** Extensions de code, et le chargeur esbuild de chacune. */
export const CHARGEURS = {
  '.js': 'jsx', '.jsx': 'jsx', '.mjs': 'jsx', '.cjs': 'jsx',
  '.ts': 'ts', '.tsx': 'tsx',
};

/**
 * Le seul fichier dispensé : celui qui DÉFINIT la forme juste. Il n'emploie
 * que `getUTCFullYear()` & co. à la main, et documente le piège en toutes
 * lettres.
 */
const DISPENSES = new Set(['src/lib/dates.js']);

/** Dossiers jamais balayés. */
export const IGNORES = new Set(['node_modules', 'dist', '.git', 'coverage', '.vercel']);

/** Une ligne de source qui ne fait que PARLER du défaut. */
const LIGNE_DE_COMMENTAIRE = /^\s*(\/\/|\*|\/\*)/;

/**
 * Masque chaînes et commentaires d'un code JS ORDINAIRE — plus de JSX :
 * esbuild est passé avant, et c'est ce qui rend ce nettoyage sûr. Les
 * interpolations `${…}` d'un gabarit sont conservées : c'est du vrai code, et
 * `` `export-${d.toISOString().slice(0,10)}.txt` `` date bel et bien un export.
 *
 * ⚠️ Les commentaires sont traités ICI et pas avant : esbuild en RÉINTRODUIT
 * (`/* @__PURE__ *\/` devant chaque `new Date()`). Sans ce passage, la barre
 * oblique ouvrante passait pour une expression régulière et avalait la ligne.
 *
 * @param {string} code
 * @returns {string}
 */
export function codeNu(code) {
  let sortie = '';
  let i = 0;
  let precedent = '';

  /** Recopie une zone en ne gardant que les sauts de ligne. */
  const masquer = (debut, fin) => {
    for (let k = debut; k < fin; k++) sortie += code[k] === '\n' ? '\n' : ' ';
  };

  while (i < code.length) {
    const c = code[i];

    if (c === '/' && code[i + 1] === '*') {
      const fin = code.indexOf('*/', i + 2);
      const stop = fin === -1 ? code.length : fin + 2;
      masquer(i, stop);
      i = stop;
      continue;
    }

    if (c === '/' && code[i + 1] === '/') {
      let fin = code.indexOf('\n', i);
      if (fin === -1) fin = code.length;
      masquer(i, fin);
      i = fin;
      continue;
    }

    if (c === '"' || c === "'" || c === '`') {
      const fermeture = c;
      sortie += ' ';
      let k = i + 1;
      while (k < code.length) {
        if (code[k] === '\\') { sortie += '  '; k += 2; continue; }
        if (code[k] === fermeture) break;
        if (fermeture === '`' && code[k] === '$' && code[k + 1] === '{') {
          let profondeur = 1;
          sortie += '  ';
          let m = k + 2;
          while (m < code.length) {
            if (code[m] === '{') profondeur++;
            else if (code[m] === '}') { profondeur--; if (profondeur === 0) break; }
            sortie += code[m];
            m++;
          }
          sortie += ' ';
          k = m + 1;
          continue;
        }
        sortie += code[k] === '\n' ? '\n' : ' ';
        k++;
      }
      sortie += ' ';
      i = k + 1;
      precedent = fermeture;
      continue;
    }

    // Littéral d'expression régulière — jamais une division à cet endroit.
    if (c === '/' && !/[\w)\]$.]/.test(precedent)) {
      let k = i + 1;
      let classe = false;
      let ferme = false;
      while (k < code.length) {
        if (code[k] === '\\') { k += 2; continue; }
        if (code[k] === '\n') break;
        if (code[k] === '[') classe = true;
        else if (code[k] === ']') classe = false;
        else if (code[k] === '/' && !classe) { ferme = true; break; }
        k++;
      }
      if (ferme) {
        for (let n = i; n <= k; n++) sortie += ' ';
        i = k + 1;
        precedent = '/';
        continue;
      }
    }

    sortie += c;
    if (!/\s/.test(c)) precedent = c;
    i++;
  }
  return sortie;
}

/** Tous les fichiers de code sous `racine`. */
function fichiersDeCode(racine) {
  const trouves = [];
  const parcourir = (dossier) => {
    for (const entree of readdirSync(dossier).sort()) {
      if (IGNORES.has(entree)) continue;
      const chemin = join(dossier, entree);
      if (statSync(chemin).isDirectory()) { parcourir(chemin); continue; }
      const point = entree.lastIndexOf('.');
      if (point !== -1 && CHARGEURS[entree.slice(point)]) trouves.push(chemin);
    }
  };
  parcourir(join(RACINE, racine));
  return trouves;
}

/**
 * Relevé des fautes sur tout `src/` et `api/`.
 *
 * @param {object} p
 * @param {{motif: RegExp, nom: string}[]} p.formes les formes interdites
 * @param {Set<string>} [p.dispenses] fichiers exemptés (chemins relatifs)
 * @returns {{fichier: string, lignes: number[], occurrences: number, textes: string[]}[]}
 */
export function relever({ formes, dispenses = new Set() }) {
  const fautes = [];

  for (const racine of RACINES_SURVEILLEES) {
    for (const chemin of fichiersDeCode(racine)) {
      const relatif = relative(RACINE, chemin).split(sep).join('/');
      if (dispenses.has(relatif)) continue;

      const source = readFileSync(chemin, 'utf8');
      const extension = relatif.slice(relatif.lastIndexOf('.'));

      // esbuild retire les commentaires et déplie le JSX. Un fichier qui ne
      // compile pas est une faute en soi : on laisse l'exception remonter.
      const compile = transformSync(source, {
        loader: CHARGEURS[extension],
        format: 'esm',
        sourcefile: relatif,
      }).code;

      const nu = codeNu(compile);

      let occurrences = 0;
      for (const { motif } of formes) {
        motif.lastIndex = 0;
        while (motif.exec(nu) !== null) occurrences++;
      }
      if (occurrences === 0) continue;

      // Le verdict vient du code compilé ; les numéros de ligne, de la source
      // d'origine — seule adresse utile à qui doit corriger.
      const lignes = [];
      const textes = [];
      source.split('\n').forEach((texte, index) => {
        if (LIGNE_DE_COMMENTAIRE.test(texte)) return;
        if (formes.some(({ motif }) => { motif.lastIndex = 0; return motif.test(texte); })) {
          lignes.push(index + 1);
          textes.push(texte.trim());
        }
      });

      fautes.push({ fichier: relatif, lignes, occurrences, textes });
    }
  }
  return fautes;
}

/**
 * Met le détecteur lui-même à l'épreuve d'un extrait : compte les occurrences
 * d'une liste de formes dans un bout de code, par le même chemin de lecture.
 * @param {string} extrait
 * @param {{motif: RegExp}[]} formes
 * @param {string} [loader]
 * @returns {number}
 */
export function occurrencesDans(extrait, formes, loader = 'jsx') {
  const compile = transformSync(extrait, { loader, format: 'esm' }).code;
  const nu = codeNu(compile);
  let n = 0;
  for (const { motif } of formes) {
    motif.lastIndex = 0;
    while (motif.exec(nu) !== null) n++;
  }
  return n;
}

/** Rend un relevé lisible : `fichier:ligne` puis la ligne fautive. */
export function formaterReleve(fautes) {
  return fautes
    .map((f) => (f.lignes.length
      ? f.lignes.map((l, i) => `  ${f.fichier}:${l}\n      ${f.textes[i]}`).join('\n')
      : `  ${f.fichier}  (${f.occurrences} occurrence(s), ligne non localisée)`))
    .join('\n');
}
