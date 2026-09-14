/**
 * Regression : l'interface doit s'afficher meme si l'amorcage echoue.
 *
 * Le 14/09/2026, `init()` de src/main.jsx enchainait quatre `await` d'amorcage
 * AVANT `ReactDOM.render()`. Le verrou de session a fait echouer le premier
 * (401 sur /api/employes avant connexion) et l'application est devenue
 * entierement blanche en production.
 *
 * Ces tests verifient le contrat par LECTURE DU SOURCE, sans navigateur :
 * aucun `await` d'amorcage nu ne doit reapparaitre devant le rendu.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const seed = readFileSync(new URL('../src/services/seed.js', import.meta.url), 'utf8');

test('aucune etape d amorcage n est attendue par un await nu dans init()', () => {
  const nus = [
    'await seedDatabase();',
    'await loadImportedData();',
    'await seedPapeterieProject();',
    'await seedInventaire();',
  ].filter((motif) => main.includes(motif));
  assert.deepEqual(
    nus, [],
    `Ces appels ne sont pas proteges : ${nus.join(', ')}. `
    + 'Un echec y blanchit toute l application (incident du 14/09/2026).',
  );
});

test('init() entoure l amorcage d un try/catch', () => {
  const bloc = main.slice(main.indexOf('async function init()'));
  assert.ok(bloc.includes('try {'), 'init() doit rattraper les echecs d amorcage');
  assert.ok(bloc.includes('catch'), 'init() doit rattraper les echecs d amorcage');
});

test('le rendu React est appele apres la boucle d amorcage, pas derriere un await nu', () => {
  const iInit = main.indexOf('async function init()');
  const iRender = main.indexOf('ReactDOM.createRoot', iInit);
  assert.ok(iRender > iInit, 'le rendu doit etre dans init()');
  const entre = main.slice(iInit, iRender);
  assert.ok(
    entre.includes('catch'),
    'il doit y avoir un catch entre le debut de init() et le rendu',
  );
});

test('seedDatabase sort avant tout appel reseau si aucun jeton de session', () => {
  const bloc = seed.slice(seed.indexOf('export async function seedDatabase()'));
  const iGarde = bloc.indexOf('lireJeton()');
  const iListe = bloc.indexOf('db.employes.list()');
  assert.ok(iGarde !== -1, 'seedDatabase doit verifier la presence d un jeton');
  assert.ok(
    iGarde < iListe,
    'la garde doit venir AVANT la lecture des employes, sinon on provoque un 401 certain',
  );
});

test('seed.js importe bien ce dont la garde a besoin', () => {
  assert.ok(seed.includes("from './api-client'"), 'lireJeton doit etre importe');
  assert.ok(seed.includes("from './supabase'"), 'USE_SUPABASE doit etre importe');
});
