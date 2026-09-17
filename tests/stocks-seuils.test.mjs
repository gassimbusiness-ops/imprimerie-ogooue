/**
 * Regression : une LECTURE de l'ecran Stock ne doit jamais modifier un seuil.
 *
 * Bug d'origine (audit VAGUE 2, constat C1) :
 * src/features/stocks/page.jsx:249-272 reecrivait EN BASE, dans `load()`, le
 * seuil d'alerte de chaque consommable a 10, et reclassait en « machine » tout
 * article dont le nom contenait imprimante/scanner/presse/pc...
 * Mesure du 15/09/2026 : 26 articles sur 45 a exactement 10, aucun consommable
 * sous 10. Le gerant reglait « Papier opaque » a 3 et l'ecran l'alertait 9/10.
 *
 * Lancer :  node --test tests/stocks-seuils.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  seuilArticle, quantiteArticle, typeArticle, niveauStock,
  preparerArticlesPourAffichage, articlesEnAlerte,
} from '../src/services/stocks-seuils.js';

/* ══ LE CONTRAT CENTRAL ══ */

test('le seuil d un article n est JAMAIS modifie par une lecture', () => {
  const enBase = [
    { id: 'a', nom: 'Papier opaque', quantite: 9, quantite_minimum: 3, type_article: 'consommable' },
    { id: 'b', nom: 'Encre chère', quantite: 4, quantite_minimum: 5, type_article: 'consommable' },
    { id: 'c', nom: 'Papier photo', quantite: 2, quantite_minimum: 1, type_article: 'consommable' },
    { id: 'd', nom: 'Rame rare', quantite: 12, quantite_minimum: 0, type_article: 'consommable' },
  ];
  const attendus = enBase.map((a) => a.quantite_minimum);

  const affiches = preparerArticlesPourAffichage(enBase);

  affiches.forEach((a, i) => {
    assert.equal(a.quantite_minimum, attendus[i], `seuil de ${a.nom} altere par la lecture`);
    assert.equal(a._seuil, attendus[i], `seuil derive de ${a.nom} incorrect`);
    assert.notEqual(a._seuil, 10, `${a.nom} ne doit pas etre remonte a 10`);
  });
});

test('la lecture ne mute pas les objets recus (pas d effet de bord)', () => {
  const article = { id: 'a', nom: 'Papier opaque', quantite: 9, quantite_minimum: 3, type_article: 'consommable' };
  const avant = JSON.stringify(article);

  preparerArticlesPourAffichage([article]);
  articlesEnAlerte([article]);
  seuilArticle(article);
  niveauStock(quantiteArticle(article), seuilArticle(article));

  assert.equal(JSON.stringify(article), avant, 'l objet source a ete modifie sur place');
});

test('la lecture ne reclasse aucun article en machine', () => {
  // Les noms qui declenchaient l ancienne regexp machinePatterns.
  const pieges = [
    { id: '1', nom: 'Papier pour imprimante', type_article: 'consommable', quantite_minimum: 2 },
    { id: '2', nom: 'Rouleau presse à chaud', type_article: 'consommable', quantite_minimum: 4 },
    { id: '3', nom: 'Étiquettes scanner', categorie: 'Papeterie', type_article: 'consommable', quantite_minimum: 1 },
    { id: '4', nom: 'Câble pc', type_article: 'consommable', quantite_minimum: 6 },
    { id: '5', nom: 'Chiffon écran', categorie: 'Machines & Outils', type_article: 'consommable', quantite_minimum: 3 },
  ];
  for (const a of preparerArticlesPourAffichage(pieges)) {
    assert.equal(a._type, 'consommable', `${a.nom} a ete reclasse`);
    assert.equal(a.type_article, 'consommable');
  }
});

test('le module de lecture n importe aucune couche de donnees', () => {
  const src = readFileSync(new URL('../src/services/stocks-seuils.js', import.meta.url), 'utf8');
  for (const interdit of ['services/db', 'supabase', 'db.produits', 'fetch(']) {
    assert.ok(!src.includes(interdit), `stocks-seuils.js ne doit pas contenir « ${interdit} »`);
  }
});

test('l ecran Stock ne contient plus d ecriture dans load()', () => {
  const page = readFileSync(new URL('../src/features/stocks/page.jsx', import.meta.url), 'utf8');
  // 17/09/2026 — ancres mises a jour : `load` est desormais un `useCallback`
  // branche sur `useChargeur` (src/services/chargement.js). L'invariant teste
  // est inchange : un ecran de consultation n'ecrit pas en base.
  const debut = page.indexOf('const load = useCallback(async ()');
  assert.ok(debut > -1, 'load() introuvable');
  const fin = page.indexOf('useChargeur(load)', debut);
  assert.ok(fin > debut, 'fin de load() introuvable');
  const corps = page.slice(debut, fin);

  assert.ok(!corps.includes('db.produits.update'), 'load() ecrit encore en base (bug C1)');
  assert.ok(!corps.includes('.create('), 'load() cree encore des lignes');
  assert.ok(!corps.includes('quantite_minimum = 10'), 'load() impose encore un seuil de 10');
});

test('le formulaire ne remonte plus le seuil a 10 au changement de type', () => {
  const page = readFileSync(new URL('../src/features/stocks/page.jsx', import.meta.url), 'utf8');
  assert.ok(
    !page.includes("(Number(form.quantite_minimum) || 0) < 10 ? 10"),
    'changer le type d article impose encore un seuil minimum de 10',
  );
});

/* ══ SEUIL : aucune valeur imposee ══ */

test('un seuil absent vaut 0, pas 10', () => {
  assert.equal(seuilArticle({}), 0);
  assert.equal(seuilArticle({ quantite_minimum: null }), 0);
  assert.equal(seuilArticle({ quantite_minimum: '' }), 0);
  assert.equal(seuilArticle(undefined), 0);
});

test('un seuil sous 10 est respecte tel quel', () => {
  for (const v of [1, 2, 3, 5, 9]) {
    assert.equal(seuilArticle({ quantite_minimum: v }), v);
  }
});

test('le champ historique stock_min est accepte en repli', () => {
  assert.equal(seuilArticle({ stock_min: 4 }), 4);
  // quantite_minimum est prioritaire quand les deux existent
  assert.equal(seuilArticle({ quantite_minimum: 3, stock_min: 40 }), 3);
});

test('un seuil textuel numerique est converti, un seuil absurde vaut 0', () => {
  assert.equal(seuilArticle({ quantite_minimum: '7' }), 7);
  assert.equal(seuilArticle({ quantite_minimum: 'abc' }), 0);
  assert.equal(seuilArticle({ quantite_minimum: -5 }), 0);
});

/* ══ NIVEAU D ALERTE ══ */

test('niveauStock : rupture / bas / ok', () => {
  assert.equal(niveauStock(0, 3), 'rupture');
  assert.equal(niveauStock(-1, 3), 'rupture');
  assert.equal(niveauStock(3, 3), 'bas');   // frontiere : egal au seuil = bas
  assert.equal(niveauStock(2, 3), 'bas');
  assert.equal(niveauStock(4, 3), 'ok');
  assert.equal(niveauStock(1, 0), 'ok');    // pas de seuil = pas d alerte
});

test('le cas signale par le gerant : Papier opaque 9 avec seuil 3 est OK', () => {
  const article = { nom: 'Papier opaque', quantite: 9, quantite_minimum: 3 };
  assert.equal(niveauStock(quantiteArticle(article), seuilArticle(article)), 'ok');
  // Avec le seuil ecrase a 10 par l ancien code, c etait « bas » — la fausse alerte.
  assert.equal(niveauStock(9, 10), 'bas');
});

test('articlesEnAlerte ne retient que rupture et bas', () => {
  const liste = [
    { id: '1', quantite: 0, quantite_minimum: 5 },   // rupture
    { id: '2', quantite: 3, quantite_minimum: 5 },   // bas
    { id: '3', quantite: 9, quantite_minimum: 3 },   // ok
    { id: '4', quantite: 20, quantite_minimum: 0 },  // ok
  ];
  assert.deepEqual(articlesEnAlerte(liste).map((a) => a.id), ['1', '2']);
});

/* ══ ROBUSTESSE ══ */

test('une entree invalide ne casse pas la lecture', () => {
  assert.deepEqual(preparerArticlesPourAffichage(null), []);
  assert.deepEqual(preparerArticlesPourAffichage(undefined), []);
  assert.deepEqual(preparerArticlesPourAffichage('pas un tableau'), []);
  assert.equal(quantiteArticle({}), 0);
  assert.equal(typeArticle({}), 'consommable');
});
