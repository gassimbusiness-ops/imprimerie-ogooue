/**
 * L'amorcage ne doit creer qu'UN SEUL jeu de donnees, quel que soit le nombre
 * de fois qu'il est joue et le nombre de postes depuis lesquels il est joue.
 *
 * Constat a l'origine de ces tests (production, 2026-09-17) :
 *   `employes` ............ 13 lignes pour 7 identites, 3 vagues de creation
 *   `produits_catalogue` .. 195 lignes pour ~45 articles, rejeu le 17/09 a 06:52
 *
 * La cause n'etait pas un drapeau dans le navigateur : le critere etait deja en
 * base. C'est la LECTURE qui mentait — `list()` rend `[]` sur un echec, ce qui
 * est mot pour mot la reponse d'une base neuve.
 *
 * Les tests ci-dessous rejouent la vraie boucle d'amorcage contre une base
 * factice : lecture et ecriture sont injectees, aucun navigateur n'est requis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normaliserCle,
  clesPresentes,
  manquants,
  amorcerParCle,
} from '../src/services/amorcage-idempotent.js';

/* ─── Base factice : le strict necessaire, avec une lecture qui peut lever ─── */

function baseFactice(lignesInitiales = []) {
  const lignes = [...lignesInitiales];
  let panne = null;
  let lectures = 0;
  return {
    lignes,
    tomberEnPanne(message) { panne = message; },
    revenir() { panne = null; },
    nombreLectures: () => lectures,
    async listOuLeve() {
      lectures += 1;
      if (panne) throw new Error(panne);
      return lignes.map((l) => ({ ...l }));
    },
    /** Le repli fautif d'origine : ne leve jamais, rend `[]` sur une panne. */
    async list() {
      try { return await this.listOuLeve(); } catch { return []; }
    },
    async create(item) { lignes.push({ ...item }); return item; },
  };
}

const COMPTES = [
  { email: 'imprimerieogooue@gmail.com', role: 'admin' },
  { email: 'imprimerieogooue.user@gmail.com', role: 'employe' },
  { email: 'Minguisilou@gmail.com', role: 'client' },
];

const amorcerComptes = (base) => amorcerParCle({
  lire: () => base.listOuLeve(),
  creer: (c) => base.create(c),
  souhaites: COMPTES,
  champ: 'email',
});

/* ─── normaliserCle ─── */

test('normaliserCle : meme adresse a la casse et aux espaces pres', () => {
  assert.equal(normaliserCle('Minguisilou@gmail.com'), 'minguisilou@gmail.com');
  assert.equal(normaliserCle('  IMPRIMERIEOGOOUE@gmail.com '), 'imprimerieogooue@gmail.com');
});

test('normaliserCle : une valeur absente ne produit pas de cle', () => {
  assert.equal(normaliserCle(null), '');
  assert.equal(normaliserCle(undefined), '');
  assert.equal(normaliserCle(''), '');
  assert.equal(normaliserCle('   '), '');
});

test('clesPresentes ignore les lignes sans cle et dedoublonne', () => {
  const cles = clesPresentes(
    [{ email: 'A@b.c' }, { email: 'a@b.c' }, { email: '' }, {}, null],
    'email',
  );
  assert.deepEqual([...cles], ['a@b.c']);
});

/* ─── manquants ─── */

test('manquants : base vide, tout est a creer', () => {
  assert.equal(manquants({ existants: [], souhaites: COMPTES, champ: 'email' }).length, 3);
});

test('manquants : base complete, rien n est a creer', () => {
  const existants = COMPTES.map((c) => ({ email: c.email.toUpperCase() }));
  assert.deepEqual(manquants({ existants, souhaites: COMPTES, champ: 'email' }), []);
});

test('manquants : un seul compte absent, un seul compte rendu', () => {
  const existants = [
    { email: 'imprimerieogooue@gmail.com' },
    { email: 'minguisilou@gmail.com' },
  ];
  const aCreer = manquants({ existants, souhaites: COMPTES, champ: 'email' });
  assert.equal(aCreer.length, 1);
  assert.equal(aCreer[0].email, 'imprimerieogooue.user@gmail.com');
});

test('manquants : les doublons DEJA en base ne provoquent aucune creation', () => {
  // L etat reel du 17/09 : chaque adresse presente trois fois.
  const existants = COMPTES.flatMap((c) => [{ email: c.email }, { email: c.email }, { email: c.email }]);
  assert.deepEqual(manquants({ existants, souhaites: COMPTES, champ: 'email' }), []);
});

test('manquants : une liste de reference qui se repete ne seme pas de doublon', () => {
  const souhaites = [...COMPTES, { email: 'IMPRIMERIEOGOOUE@gmail.com', role: 'admin' }];
  assert.equal(manquants({ existants: [], souhaites, champ: 'email' }).length, 3);
});

test('manquants : un souhait sans cle naturelle n est jamais ecrit', () => {
  const souhaites = [{ email: '', role: 'admin' }, { role: 'employe' }];
  assert.deepEqual(manquants({ existants: [], souhaites, champ: 'email' }), []);
});

test('manquants : le champ de cle est obligatoire', () => {
  assert.throws(() => manquants({ existants: [], souhaites: COMPTES }), TypeError);
});

/* ─── amorcerParCle : le comportement complet ─── */

test('le seed joue DEUX FOIS ne cree qu un seul jeu de comptes', async () => {
  const base = baseFactice();

  const premier = await amorcerComptes(base);
  assert.equal(premier.crees.length, 3);
  assert.equal(base.lignes.length, 3);

  const second = await amorcerComptes(base);
  assert.deepEqual(second.crees, []);
  assert.equal(base.lignes.length, 3, 'le second passage ne doit RIEN ecrire');
});

test('le seed joue depuis DEUX POSTES differents ne cree qu un seul jeu', async () => {
  // Deux navigateurs, deux localStorage vides, une seule base partagee.
  const base = baseFactice();
  await amorcerComptes(base); // poste 1
  await amorcerComptes(base); // poste 2, cache vierge
  await amorcerComptes(base); // poste 1, apres vidage du cache
  assert.equal(base.lignes.length, 3);
});

test('sur une base ou UN SEUL compte manque, seul celui-la est ajoute', async () => {
  const base = baseFactice([
    { email: 'imprimerieogooue@gmail.com', role: 'admin' },
    { email: 'minguisilou@gmail.com', role: 'client' },
  ]);

  const { crees } = await amorcerComptes(base);

  assert.deepEqual(crees, ['imprimerieogooue.user@gmail.com']);
  assert.equal(base.lignes.length, 3);
  assert.equal(
    base.lignes.filter((l) => normaliserCle(l.email) === 'imprimerieogooue@gmail.com').length,
    1,
    'le compte deja present ne doit pas avoir ete recree',
  );
});

test('une lecture en echec LEVE et n ecrit rien', async () => {
  const base = baseFactice([{ email: 'imprimerieogooue@gmail.com', role: 'admin' }]);
  base.tomberEnPanne('Failed to fetch');

  await assert.rejects(() => amorcerComptes(base), /Failed to fetch/);
  assert.equal(base.lignes.length, 1, 'une panne de lecture ne doit provoquer aucune ecriture');
});

test('apres le retour du reseau, l amorcage reprend sans avoir rien duplique', async () => {
  const base = baseFactice(COMPTES.map((c) => ({ email: c.email })));
  base.tomberEnPanne('NetworkError');
  await assert.rejects(() => amorcerComptes(base));
  base.revenir();
  const { crees } = await amorcerComptes(base);
  assert.deepEqual(crees, []);
  assert.equal(base.lignes.length, 3);
});

test('REGRESSION — c est bien la lecture silencieuse qui creait les doublons', async () => {
  // Reproduction de l ancien code : `list()` (qui avale l erreur) + garde globale.
  const base = baseFactice(COMPTES.map((c) => ({ email: c.email })));
  base.tomberEnPanne('timeout');

  const ancienSeed = async () => {
    const existants = await base.list();      // rend [] sur la panne
    if (existants.length > 0) return;         // garde qui ne se declenche pas
    for (const c of COMPTES) await base.create(c);
  };

  await ancienSeed();
  assert.equal(base.lignes.length, 6, 'l ancien code doublait les comptes — c est le defaut constate');

  // Le nouveau, dans la meme panne, n ecrit rien.
  await assert.rejects(() => amorcerComptes(base));
  assert.equal(base.lignes.length, 6);
});

test('une lecture qui ne rend pas un tableau est refusee', async () => {
  await assert.rejects(
    () => amorcerParCle({ lire: async () => null, creer: async () => {}, souhaites: COMPTES, champ: 'email' }),
    TypeError,
  );
});

test('amorcerParCle exige une lecture et une ecriture', async () => {
  await assert.rejects(() => amorcerParCle({ creer: async () => {}, souhaites: [], champ: 'email' }), TypeError);
  await assert.rejects(() => amorcerParCle({ lire: async () => [], souhaites: [], champ: 'email' }), TypeError);
});

test('baseVide distingue une installation neuve d une base deja peuplee', async () => {
  const neuve = await amorcerComptes(baseFactice());
  assert.equal(neuve.baseVide, true);
  const peuplee = await amorcerComptes(baseFactice([{ email: 'x@y.z' }]));
  assert.equal(peuplee.baseVide, false);
});

/* ─── Contrats de source : ce que les amorcages ont le droit d appeler ─── */

const lire = (chemin) => readFileSync(new URL(chemin, import.meta.url), 'utf8');
const seed = lire('../src/services/seed.js');
const seedData = lire('../src/utils/seed-data.js');
const importLoader = lire('../src/services/import-loader.js');
const dbSource = lire('../src/services/db.js');

test('seedDatabase decide sur une lecture qui leve, jamais sur list()', () => {
  const bloc = seed.slice(seed.indexOf('export async function seedDatabase()'));
  assert.ok(bloc.includes('db.employes.listOuLeve()'), 'la decision doit se prendre sur listOuLeve()');
  assert.ok(
    !bloc.includes('db.employes.list()'),
    'db.employes.list() rend [] sur une panne : c est ce qui a cree les 13 comptes',
  );
});

test('seedDatabase passe par l amorcage par cle naturelle', () => {
  assert.ok(seed.includes("from './amorcage-idempotent'"), 'seed.js doit importer le module d amorcage');
  const bloc = seed.slice(seed.indexOf('export async function seedDatabase()'));
  assert.ok(bloc.includes('amorcerParCle('), 'la creation des comptes doit passer par amorcerParCle');
  assert.ok(bloc.includes("champ: 'email'"), 'la cle naturelle d un compte est son e-mail');
});

/** Le source prive de ses lignes de commentaire — les contre-exemples cites en
 *  commentaire ne sont pas du code. */
const sansCommentaires = (source) => source
  .split('\n')
  .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
  .join('\n');

test('aucun amorcage ne lit plus une collection avec list()', () => {
  const fautes = [];
  for (const [nom, source] of [['seed.js', seed], ['seed-data.js', seedData], ['import-loader.js', importLoader]]) {
    for (const m of sansCommentaires(source).matchAll(/db\.[a-z_]+\.list\(\)/g)) fautes.push(`${nom} : ${m[0]}`);
  }
  assert.deepEqual(
    fautes, [],
    `Ces lectures rendent [] sur une panne et font rejouer l amorcage : ${fautes.join(', ')}`,
  );
});

test('les fixtures comptent sans telecharger les 20 Mo du catalogue', () => {
  assert.ok(seedData.includes('db.produits_catalogue.compterOuLeve()'), 'seedInventaire doit compter, pas lister');
  assert.ok(seed.includes('db.produits_catalogue.compterOuLeve()'), 'seedCatalogue doit compter, pas lister');
  assert.ok(seed.includes('db.produits.compterOuLeve()'), 'seedStock doit compter, pas lister');
});

test('compterOuLeve existe, leve sur erreur, et ne telecharge pas les lignes', () => {
  const bloc = dbSource.slice(dbSource.indexOf('async compterOuLeve()'));
  assert.ok(dbSource.includes('async compterOuLeve()'), 'db.js doit exposer compterOuLeve()');
  assert.ok(bloc.includes('head: true'), 'le comptage ne doit pas ramener les lignes');
  assert.ok(bloc.includes('throw new ErreurLecture'), 'un echec de comptage doit lever');
});

test('seedDatabase n ecrase les parametres que sur une base sans aucun compte', () => {
  const bloc = sansCommentaires(seed.slice(seed.indexOf('export async function seedDatabase()')));
  const iGarde = bloc.indexOf('if (!baseVide) return;');
  const iSettings = bloc.indexOf('await saveSettings(');
  assert.ok(iGarde !== -1, 'la garde « base vide » doit exister');
  assert.ok(
    iGarde !== -1 && iSettings > iGarde,
    'getSettings() ne leve pas : sans cette garde, un echec ecraserait les 88 Ko de parametres reels',
  );
});

test('loadImportedData journalise son abandon au lieu de l avaler', () => {
  assert.ok(importLoader.includes('listOuLeve()'), 'les deux lectures doivent lever');
  assert.ok(importLoader.includes('console.error'), 'un import abandonne doit se voir');
});
