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
 * ── Comment il lit le code ────────────────────────────────────────────────
 *
 * Par `tests/outils/detecteur-dates.mjs` — esbuild, puis masquage des chaînes.
 * Ce détecteur est partagé avec `tests/dates-horodatage-supabase.test.mjs`,
 * qui traque la seconde famille : les horodatages de la base tronqués. Une
 * seule implémentation, pour qu'elles ne puissent pas diverger.
 *
 * Lancer :  node --test tests/dates-heure-de-londres.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relever, occurrencesDans, formaterReleve } from './outils/detecteur-dates.mjs';

/**
 * Le seul fichier dispensé : celui qui DÉFINIT la forme juste. Il n'emploie
 * que `getUTCFullYear()` & co. à la main, et documente le piège en toutes
 * lettres.
 */
const DISPENSES = new Set(['src/lib/dates.js']);

/**
 * Les formes interdites. Toutes fabriquent une DATE (ou un MOIS) à partir d'un
 * instant, en passant par la représentation UTC.
 *
 * `new Date().toISOString()` SEUL n'est pas ici : un horodatage UTC complet
 * (`created_at`, `updated_at`, `valide_at`) est parfaitement légitime — c'est
 * un instant, pas une date métier. Ce qui est interdit, c'est de le TRONQUER,
 * et c'est l'objet de `tests/dates-horodatage-supabase.test.mjs`.
 */
const FORMES_INTERDITES = [
  { motif: /\.toISOString\(\)\s*\.\s*slice\s*\(/g, nom: '.toISOString().slice(…)' },
  { motif: /\.toISOString\(\)\s*\.\s*split\s*\(/g, nom: '.toISOString().split(…)' },
  { motif: /\.toISOString\(\)\s*\.\s*substring\s*\(/g, nom: '.toISOString().substring(…)' },
  { motif: /\.toISOString\(\)\s*\.\s*substr\s*\(/g, nom: '.toISOString().substr(…)' },
  { motif: /\.toISOString\(\)\s*\[/g, nom: '.toISOString()[…]' },
];

/** Relevé des dates métier fabriquées en UTC, sur tout `src/` et `api/`. */
export function relevePlacesFautives() {
  return relever({ formes: FORMES_INTERDITES, dispenses: DISPENSES });
}

test('aucune date métier n’est fabriquée à l’heure de Londres dans src/ et api/', () => {
  const fautes = relevePlacesFautives();
  const total = fautes.reduce((n, f) => n + f.occurrences, 0);

  const rapport = formaterReleve(fautes);

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
const compter = (extrait) => occurrencesDans(extrait, FORMES_INTERDITES);

test('le détecteur ignore ce qui n’est qu’un commentaire ou une chaîne', () => {
  const extrait = [
    "// interdit : new Date().toISOString().slice(0, 10)",
    "/* interdit aussi : d.toISOString().split('T')[0] */",
    "export const message = 'ne pas écrire .toISOString().slice(0, 10)';",
    "export const gabarit = `texte .toISOString().split('T')[0] littéral`;",
    "export const horodatage = new Date().toISOString();",
  ].join('\n');

  assert.equal(compter(extrait), 0);
});

test('le détecteur voit la forme fautive, y compris dans une interpolation', () => {
  assert.equal(compter('export const a = new Date().toISOString().slice(0, 10);'), 1);
  assert.equal(compter("export const b = d.toISOString().split('T')[0];"), 1);
  assert.equal(compter('export const c = `sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;'), 1);
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

  assert.equal(compter(extrait), 1, 'l’apostrophe JSX ne doit rien masquer');
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

  assert.equal(compter(extrait), 1);
});
