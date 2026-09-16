/**
 * Regression : le message de diagnostic IA ne doit plus etre jete a la
 * derniere ligne.
 *
 * Constat E9 / 5.4 de l'audit VAGUE 2. La chaine de diagnostic est complete en
 * amont : `api/_lib/modeles.js:46-63` produit « Le modele « claude-… » n'existe
 * pas ou n'est pas accessible a cette cle. Corriger la variable ANTHROPIC_MODEL
 * dans Vercel », `api/ai.js` le renvoie, `src/services/ai.js` le remonte dans
 * `err.message` — et cinq `catch` l'ecrasaient par « Erreur lors de l'analyse
 * IA », juste avant l'affichage.
 *
 * C'est ce qui a fait croire pendant des semaines a une cle revoquee, alors que
 * le log Vercel disait `not_found_error, "model: claude-sonnet-4-20250514"` —
 * un 404, pas un 401.
 *
 * Lancer :  node --test tests/messages-erreur-ia.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { messageErreurAnthropic } from '../api/_lib/modeles.js';

/* ══ Le message construit en amont dit bien quelque chose d'utile ══ */

test('un 404 designe le NOM DU MODELE, et dit ou le corriger', () => {
  const m = messageErreurAnthropic(404, '{"error":{"type":"not_found_error"}}');
  assert.match(m, /modele/i, 'le message doit désigner le modèle');
  assert.match(m, /ANTHROPIC_MODEL/, 'le message doit dire quelle variable corriger');
});

test('un 401 designe la cle, un 429 le quota, un 5xx le service', () => {
  assert.match(messageErreurAnthropic(401, ''), /[Cc]le API/);
  assert.match(messageErreurAnthropic(429, ''), /[Qq]uota/);
  assert.match(messageErreurAnthropic(503, ''), /indisponible/);
});

test('le corps de la reponse n est jamais recopie tel quel', () => {
  // Il peut contenir un echo de la requete, donc des donnees de l'entreprise.
  const secret = 'CA du 15 septembre : 122 450 F, client Mairie de Moanda';
  const m = messageErreurAnthropic(400, JSON.stringify({ error: { type: 'invalid_request_error', message: secret } }));
  assert.ok(!m.includes(secret), 'le message d’erreur laisse fuiter le contenu de la requête');
  assert.match(m, /invalid_request_error/, 'le type d’erreur doit tout de même remonter');
});

/* ══ Les cinq sites qui le jetaient ══ */

const SITES = [
  ['src/features/rapports/page.jsx', "toast.error('Erreur lors de l\\'analyse IA');"],
  ['src/features/rapports-analyses/page.jsx', "toast.error('Erreur lors de l\\'analyse IA');"],
  ['src/features/catalogue/page.jsx', "toast.error('Erreur lors de la génération IA');"],
  ['src/features/catalogue/page.jsx', "toast.error('Erreur lors de l\\'analyse IA');"],
  ['src/features/messagerie/page.jsx', "toast.error('Erreur IA — reessayez');"],
];

for (const [fichier, ancien] of SITES) {
  test(`${fichier} : le message générique en dur a disparu`, () => {
    const src = readFileSync(new URL(`../${fichier}`, import.meta.url), 'utf8');
    assert.ok(
      !src.includes(ancien),
      `« ${ancien} » est revenu : si un nom de modèle expire à nouveau, `
      + 'le gérant reverra exactement le même message inutile qu’avant',
    );
  });
}

test('les cinq sites remontent desormais err.message', () => {
  const fichiers = [...new Set(SITES.map(([f]) => f))];
  let total = 0;
  for (const f of fichiers) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    total += (src.match(/toast\.error\(err\?\.message \|\|/g) || []).length;
  }
  assert.ok(total >= 5, `seulement ${total} sites remontent la cause réelle, 5 attendus`);
});

test('aucun catch IA ne se prive de la cause', () => {
  // `} catch {` sans liaison : la cause est perdue avant meme d'etre lue.
  for (const f of [...new Set(SITES.map(([s]) => s))]) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    const i = src.indexOf('askAI(');
    if (i === -1) continue;
    const zone = src.slice(i, i + 3000);
    const nus = (zone.match(/\}\s*catch\s*\{[^}]*toast\.error\('/g) || []);
    assert.deepEqual(
      nus, [],
      `${f} : un catch sans capture d'erreur affiche encore un message générique`,
    );
  }
});

test('le nom du modele reste une configuration, pas une constante en dur', () => {
  const src = readFileSync(new URL('../api/_lib/modeles.js', import.meta.url), 'utf8');
  assert.ok(src.includes('process.env.ANTHROPIC_MODEL'), 'le modèle doit rester surchargeable');
  for (const endpoint of ['api/ai.js', 'api/zakat-analyse.js']) {
    const s = readFileSync(new URL(`../${endpoint}`, import.meta.url), 'utf8');
    assert.ok(
      !/model:\s*['"]claude-/.test(s),
      `${endpoint} réécrit un nom de modèle en dur — c'est exactement le bug d'origine`,
    );
  }
});
