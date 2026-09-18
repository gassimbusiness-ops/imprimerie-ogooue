/**
 * GARDE-FOU — plus aucune date métier fabriquée à l'heure de Londres.
 *
 * ── Le défaut ─────────────────────────────────────────────────────────────
 *
 * `new Date().toISOString().slice(0, 10)` rend la date **UTC**. Moanda est à
 * UTC+1 toute l'année, sans heure d'été : entre 00 h et 01 h heure locale,
 * cette expression rend **la veille**. Tout ce qu'elle date — un pointage, une
 * sortie de caisse, un mois de référence, une échéance de prélèvement — tombe
 * alors un jour trop tôt.
 *
 * Le dépôt a une règle : toute date métier passe par `src/lib/dates.js`
 * (`toISODate`, `todayISO`, `startOfMonthISO`, `addDaysISO`). Côté serveur —
 * `api/`, qui tourne en UTC sur Vercel — `toISODate(new Date())` ne suffit
 * PAS : il rend la date du processus, pas celle de Moanda. Il faut y passer
 * par `dateLocaleDepuisInstantUtc()` / `contexteMoanda()`.
 *
 * ── Pourquoi un test, et pas seulement une relecture ──────────────────────
 *
 * Le défaut est déjà revenu deux fois. Il revient parce que l'expression est
 * la première qui vient sous les doigts, qu'elle est juste à Londres, et
 * qu'aucun lint ne la regarde. Ce test la refuse par construction et nomme
 * chaque fichier fautif, ligne par ligne.
 *
 * ── Comment il lit le code, et pourquoi pas avec une expression régulière ──
 *
 * Un fichier a le DROIT de parler du défaut : `src/lib/dates.js` l'écrit en
 * toutes lettres, et six autres fichiers portent un commentaire « surtout pas
 * .toISOString() ». Un simple `grep` les compterait comme des fautes, et on
 * corrigerait le test en déplaçant une phrase.
 *
 * Une première version de ce garde-fou séparait code et commentaires à la
 * main. Elle a RATÉ deux fautes réelles (prospection/page.jsx l. 636 et 692) :
 * une apostrophe française dans du texte JSX ouvre une chaîne qui ne se ferme
 * jamais, et tout ce qui suit disparaît. Un détecteur qui rate ce qu'il
 * cherche est pire qu'aucun détecteur, parce qu'il rassure.
 *
 * Le verdict vient donc d'esbuild — LE MÊME transformeur que celui qui bâtit
 * l'application et que celui du harnais de rendu d'écran. Il rend du JS sans
 * commentaires et sans JSX ; il ne reste alors qu'à masquer les chaînes, ce
 * qui est trivial sur du JS ordinaire. Ce que le build compile, le test le
 * lit : les deux ne peuvent pas diverger.
 *
 * Lancer :  node --test tests/dates-heure-de-londres.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

const RACINE = fileURLToPath(new URL('..', import.meta.url));

/** Répertoires balayés. Ce sont les deux qui partent en production. */
const RACINES_SURVEILLEES = ['src', 'api'];

/** Extensions de code, et le chargeur esbuild de chacune. */
const CHARGEURS = {
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
const IGNORES = new Set(['node_modules', 'dist', '.git', 'coverage', '.vercel']);

/**
 * Les formes interdites. Toutes fabriquent une DATE (ou un MOIS) à partir d'un
 * instant, en passant par la représentation UTC.
 *
 * `new Date().toISOString()` SEUL n'est pas ici : un horodatage UTC complet
 * (`created_at`, `updated_at`, `valide_at`) est parfaitement légitime — c'est
 * un instant, pas une date métier. Ce qui est interdit, c'est de le TRONQUER.
 */
const FORMES_INTERDITES = [
  { motif: /\.toISOString\(\)\s*\.\s*slice\s*\(/g, nom: '.toISOString().slice(…)' },
  { motif: /\.toISOString\(\)\s*\.\s*split\s*\(/g, nom: '.toISOString().split(…)' },
  { motif: /\.toISOString\(\)\s*\.\s*substring\s*\(/g, nom: '.toISOString().substring(…)' },
  { motif: /\.toISOString\(\)\s*\.\s*substr\s*\(/g, nom: '.toISOString().substr(…)' },
  { motif: /\.toISOString\(\)\s*\[/g, nom: '.toISOString()[…]' },
];

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
function codeNu(code) {
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
 * Relevé des dates métier fabriquées en UTC, sur tout `src/` et `api/`.
 * @returns {{fichier: string, lignes: number[], occurrences: number, textes: string[]}[]}
 */
export function relevePlacesFautives() {
  const fautes = [];

  for (const racine of RACINES_SURVEILLEES) {
    for (const chemin of fichiersDeCode(racine)) {
      const relatif = relative(RACINE, chemin).split(sep).join('/');
      if (DISPENSES.has(relatif)) continue;

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
      for (const { motif } of FORMES_INTERDITES) {
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
        if (FORMES_INTERDITES.some(({ motif }) => { motif.lastIndex = 0; return motif.test(texte); })) {
          lignes.push(index + 1);
          textes.push(texte.trim());
        }
      });

      fautes.push({ fichier: relatif, lignes, occurrences, textes });
    }
  }
  return fautes;
}

test('aucune date métier n’est fabriquée à l’heure de Londres dans src/ et api/', () => {
  const fautes = relevePlacesFautives();
  const total = fautes.reduce((n, f) => n + f.occurrences, 0);

  const rapport = fautes
    .map((f) => {
      const adresses = f.lignes.length
        ? f.lignes.map((l, i) => `  ${f.fichier}:${l}\n      ${f.textes[i]}`).join('\n')
        : `  ${f.fichier}  (${f.occurrences} occurrence(s), ligne non localisée)`;
      return adresses;
    })
    .join('\n');

  assert.equal(
    total,
    0,
    `${total} date(s) métier fabriquée(s) à partir de l'heure UTC, dans ${fautes.length} fichier(s).\n\n`
    + `À Moanda (UTC+1, sans heure d'été), ces expressions rendent LA VEILLE\n`
    + `entre 00 h et 01 h heure locale.\n\n`
    + `Dans src/ : utiliser src/lib/dates.js — todayISO(), toISODate(d),\n`
    + `startOfMonthISO(), addDaysISO(n).\n`
    + `Dans api/ (qui tourne en UTC sur Vercel) : toISODate() NE SUFFIT PAS,\n`
    + `il rend la date du processus. Utiliser dateLocaleDepuisInstantUtc()\n`
    + `ou contexteMoanda().\n\n${rapport}\n`,
  );
});

/* ═══════════════════════════════════════════════════════════════════════════
   LE DÉTECTEUR SE FAIT CONTRÔLER
   ═══════════════════════════════════════════════════════════════════════════
   Les cas ci-dessous sont ceux qui ont réellement mis en défaut la première
   version : l'apostrophe française dans du texte JSX, et l'interpolation.   */

/** Reproduit le chemin de lecture du garde-fou sur un extrait. */
function occurrencesDans(extrait, loader = 'jsx') {
  const compile = transformSync(extrait, { loader, format: 'esm' }).code;
  const nu = codeNu(compile);
  let n = 0;
  for (const { motif } of FORMES_INTERDITES) {
    motif.lastIndex = 0;
    while (motif.exec(nu) !== null) n++;
  }
  return n;
}

test('le détecteur ignore ce qui n’est qu’un commentaire ou une chaîne', () => {
  const extrait = [
    "// interdit : new Date().toISOString().slice(0, 10)",
    "/* interdit aussi : d.toISOString().split('T')[0] */",
    "export const message = 'ne pas écrire .toISOString().slice(0, 10)';",
    "export const gabarit = `texte .toISOString().split('T')[0] littéral`;",
    "export const horodatage = new Date().toISOString();",
  ].join('\n');

  assert.equal(occurrencesDans(extrait), 0);
});

test('le détecteur voit la forme fautive, y compris dans une interpolation', () => {
  assert.equal(occurrencesDans('export const a = new Date().toISOString().slice(0, 10);'), 1);
  assert.equal(occurrencesDans("export const b = d.toISOString().split('T')[0];"), 1);
  assert.equal(occurrencesDans('export const c = `sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;'), 1);
});

/**
 * LE CAS QUI A FAIT ÉCHOUER LA PREMIÈRE VERSION.
 *
 * `Jusqu'à` dans du texte JSX : l'apostrophe ouvrait une chaîne qui ne se
 * refermait jamais, et la faute placée plus bas devenait invisible.
 */
test('le détecteur voit une faute placée après une apostrophe en texte JSX', () => {
  const extrait = [
    'export function Ecran({ lignes }) {',
    '  return (',
    '    <table>',
    "      <thead><tr><th>Jusqu'à la relance d'aujourd'hui</th></tr></thead>",
    '      <tbody>',
    '        {lignes.map((p) => {',
    '          const enRetard = p.echeance <= new Date().toISOString().slice(0, 10);',
    '          return <tr key={p.id}>{enRetard ? 1 : 0}</tr>;',
    '        })}',
    '      </tbody>',
    '    </table>',
    '  );',
    '}',
  ].join('\n');

  assert.equal(occurrencesDans(extrait), 1, 'l’apostrophe JSX ne doit rien masquer');
});

/** Un chemin de classe Tailwind (`top-1/2`, `bg-muted/50`) n’est pas une regexp. */
test('le détecteur ne se perd pas dans les classes Tailwind à barre oblique', () => {
  const extrait = [
    'export function Bandeau() {',
    '  return <div className="absolute top-1/2 bg-muted/50 lg:w-1/3">',
    "    <span>Relance d'aujourd'hui</span>",
    '  </div>;',
    '}',
    'export const d = new Date().toISOString().slice(0, 10);',
  ].join('\n');

  assert.equal(occurrencesDans(extrait), 1);
});
