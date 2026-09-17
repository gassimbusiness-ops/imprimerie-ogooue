/**
 * La logique du chargement : ce qu'on dit, et quand on le dit.
 *
 * Ces tests portent sur les fonctions PURES de src/services/erreur-lecture.js
 * et sur le contrat de source de src/services/db.js. Le comportement a l'ecran
 * est verifie separement, dans un vrai DOM, par
 * tests/rendu-ecran-chargement.test.mjs.
 *
 * L'invariant central tient en une phrase : « aucun rapport ce mois-ci » et
 * « je n'ai pas pu charger les rapports » sont deux phrases differentes, et un
 * echec ne doit JAMAIS produire la premiere.
 *
 * Lancer :  node --test tests/chargement.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ErreurLecture, estErreurLecture, messageEchecChargement, verdictChargement,
} from '../src/services/erreur-lecture.js';
import { LIBELLES_COLLECTION, messageEchecEcriture } from '../src/services/erreur-ecriture.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Le message
   ═══════════════════════════════════════════════════════════════════════════ */

test('le message d echec de chargement ne dit JAMAIS « aucun »', () => {
  // C'est tout l'objet de l'intervention. « Aucun rapport ce mois-ci » decrit
  // un mois sans activite ; une coupure reseau n'est pas un mois sans activite.
  for (const quoi of ['les rapports journaliers', 'la caisse', null, undefined, '']) {
    const m = messageEchecChargement(quoi);
    assert.doesNotMatch(m, /aucun/i, `« aucun » apparaît dans : ${m}`);
    assert.doesNotMatch(m, /\bvide\b/i, `« vide » apparaît dans : ${m}`);
    assert.doesNotMatch(m, /\b0\b/, `un « 0 » apparaît dans : ${m}`);
  }
});

test('le message dit QUOI, rassure sur la donnee, et dit QUE FAIRE', () => {
  const m = messageEchecChargement('les rapports journaliers');
  assert.match(m, /les rapports journaliers/, 'le message doit nommer ce qui manque');
  assert.match(m, /rien n'a été effacé/, 'le message doit dire que la donnée est intacte');
  assert.match(m, /réessayez/i, 'le message doit dire quoi faire');
});

test('le message ne contient ni jargon ni code d erreur', () => {
  const m = messageEchecChargement('les commandes');
  for (const jargon of [/HTTP/i, /\b\d{3}\b/, /RLS/i, /supabase/i, /fetch/i, /undefined/i, /null/i]) {
    assert.doesNotMatch(m, jargon, `jargon technique dans : ${m}`);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   Le type d'erreur
   ═══════════════════════════════════════════════════════════════════════════ */

test('ErreurLecture se reconnait sans instanceof', () => {
  // Vite peut servir deux instances du meme module en developpement :
  // `instanceof` echouerait alors, et l'erreur passerait pour un bug quelconque.
  const e = new ErreurLecture({ collection: 'rapports', libelle: 'les rapports journaliers' });
  assert.equal(estErreurLecture(e), true);
  assert.equal(estErreurLecture({ estErreurLecture: true }), true, 'la marque doit suffire');
  assert.equal(estErreurLecture(new Error('réseau')), false);
  assert.equal(estErreurLecture(null), false);
  assert.equal(estErreurLecture('texte'), false);
});

test('ErreurLecture garde la cause technique HORS du message montre', () => {
  const e = new ErreurLecture({
    collection: 'rapports', libelle: 'les rapports journaliers',
    cause: new Error('JWT expired (401)'),
  });
  assert.doesNotMatch(e.message, /JWT|401/, 'la cause technique ne doit pas partir à l’écran');
  assert.equal(e.causeTexte, 'JWT expired (401)', 'mais elle doit rester disponible pour la console');
  assert.equal(e.collection, 'rapports');
});

/* ═══════════════════════════════════════════════════════════════════════════
   Le verdict : erreur AVANT vide
   ═══════════════════════════════════════════════════════════════════════════ */

test('l erreur passe AVANT le vide — c est tout le correctif', () => {
  // Un chargement rate laisse forcement une liste vide. Si le vide gagnait,
  // on afficherait « aucune donnee » sur une panne reseau.
  const v = verdictChargement({
    enCours: false, erreur: new ErreurLecture({ collection: 'rapports' }),
    nombre: 0, quoi: 'les rapports journaliers',
  });
  assert.equal(v.mode, 'erreur');
  assert.match(v.message, /Impossible de charger les rapports journaliers/);
});

test('l erreur passe aussi avant le chargement en cours', () => {
  // Un reessai remet `enCours` a vrai ; tant qu'il n'a pas abouti, l'echec
  // precedent reste la verite affichable.
  const v = verdictChargement({ enCours: true, erreur: new Error('x'), nombre: 0 });
  assert.equal(v.mode, 'erreur');
});

test('sans erreur, le vide reste le vide et les donnees restent les donnees', () => {
  assert.equal(verdictChargement({ enCours: true }).mode, 'chargement');
  assert.equal(verdictChargement({ enCours: false, nombre: 0 }).mode, 'vide');
  assert.equal(verdictChargement({ enCours: false, nombre: 3 }).mode, 'donnees');
  assert.equal(verdictChargement().mode, 'vide', 'un état inconnu n’invente pas de données');
});

test('le mode « vide » ne porte aucun message d erreur', () => {
  assert.equal(verdictChargement({ nombre: 0 }).message, null);
  assert.equal(verdictChargement({ nombre: 2 }).message, null);
});

/* ═══════════════════════════════════════════════════════════════════════════
   Une seule table de libelles
   ═══════════════════════════════════════════════════════════════════════════ */

test('lecture et ecriture partagent LA MEME table de libelles', () => {
  // La panne des notifications venait d'une regle recopiee a deux endroits
  // (tasks/lessons.md). Deux tables de libelles auraient diverge de la meme
  // facon : celle de erreur-ecriture.js est la seule.
  assert.equal(LIBELLES_COLLECTION.rapports, 'le rapport journalier');
  const src = readFileSync(new URL('../src/services/chargement.js', import.meta.url), 'utf8');
  assert.match(src, /import \{[^}]*LIBELLES_COLLECTION/s, 'chargement.js doit importer la table, pas la recopier');
  const srcLecture = readFileSync(new URL('../src/services/erreur-lecture.js', import.meta.url), 'utf8');
  assert.doesNotMatch(srcLecture, /LIBELLES_COLLECTION\s*=/, 'erreur-lecture.js ne doit pas redéfinir la table');
});

test('le message d ECRITURE reste celui de erreur-ecriture.js', () => {
  // Verification que l'intervention n'a pas dedouble ce message-la non plus.
  const m = messageEchecEcriture('rapports', 'update');
  assert.match(m, /le rapport journalier/);
  assert.match(m, /n'a PAS été enregistrée/);
});

/* ═══════════════════════════════════════════════════════════════════════════
   Contrat de source de la couche de donnees
   ═══════════════════════════════════════════════════════════════════════════ */

test('db.js : une seule implementation de la requete de lecture', () => {
  const db = readFileSync(new URL('../src/services/db.js', import.meta.url), 'utf8');
  // `list()` delegue a `listOuLeve()` : si la requete etait ecrite deux fois,
  // un filtre ajoute d'un cote manquerait de l'autre.
  assert.match(db, /return await this\.listOuLeve\(\)/);
  assert.match(db, /return filtrerSur\(await this\.list\(\)/);
  assert.match(db, /return filtrerSur\(await this\.listOuLeve\(\)/);
});

test('db.js : la sous-classe employes leve elle aussi', () => {
  // 13 ecrans lisent les employes par /api/employes. Si la sous-classe
  // redefinissait seulement `list()`, une panne y resterait muette.
  const db = readFileSync(new URL('../src/services/db.js', import.meta.url), 'utf8');
  const bloc = db.slice(db.indexOf('class CollectionEmployes'), db.indexOf('export const db'));
  assert.match(bloc, /async listOuLeve\(\)/, 'CollectionEmployes doit redéfinir listOuLeve');
  assert.match(bloc, /throw new ErreurLecture/, 'un /api/employes en erreur doit lever');
  assert.doesNotMatch(bloc, /async list\(\)/, 'list() doit rester héritée : un seul repli');
});

test('le journal d audit ne peut plus faire echouer une action reussie', () => {
  // Depuis que db.create() leve, un echec d'audit remontait dans le handler
  // JUSTE APRES une ecriture metier reussie : le gerant lisait « pas
  // enregistré » alors que ça l'était.
  const audit = readFileSync(new URL('../src/services/audit.js', import.meta.url), 'utf8');
  const bloc = audit.slice(audit.indexOf('export async function logAction'), audit.indexOf('ACTION_LABELS'));
  assert.match(bloc, /try \{/, 'logAction doit attraper ses propres échecs');
  assert.match(bloc, /console\.error/, 'une trace ratée doit rester visible en console');
});
