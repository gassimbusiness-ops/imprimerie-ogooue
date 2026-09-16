/**
 * Regression : une ecriture ratee ne doit plus jamais afficher un toast VERT.
 *
 * Constat C6 / 5.1 de l'audit VAGUE 2. `src/services/db.js` faisait :
 *
 *     if (error) { console.error(...); return null; }   // update
 *     if (error) { console.error(...); return false; }  // delete
 *
 * Aucun des 99 appelants ne testait ce retour. Sur une coupure reseau a Moanda,
 * un refus RLS ou une ligne absente, l'ecriture echouait et l'ecran annoncait
 * un succes. Le cas le plus couteux : gouvernance/page.jsx:327, ou le solde de
 * la dette envers Oumar n'etait pas recalcule — durablement faux, sans trace.
 *
 * Deux garanties testees ici :
 *   1. `db.update()` et `db.delete()` LEVENT (contrat de source) ;
 *   2. le filet global de main.jsx transforme un rejet non rattrape en message
 *      visible — c'est ce qui rend sur de ne pas avoir repris les 76 appels
 *      qui ne sont dans aucun `try`.
 *
 * Lancer :  node --test tests/echec-ecriture.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import {
  ErreurEcriture, estErreurEcriture, messageEchecEcriture,
} from '../src/services/erreur-ecriture.js';
import {
  verdictRejet, creerAntiRepetition, installerFiletEcriture,
} from '../src/services/filet-ecriture.js';

/* ══ Le message ══ */

test('le message nomme l operation, la collection, et dit quoi faire', () => {
  const m = messageEchecEcriture('dettes_associes', 'update', 'network error');
  assert.match(m, /modification/i, "l'opération doit être nommée");
  assert.match(m, /dette envers un associé/, 'la collection doit être nommée en français');
  assert.match(m, /network error/, 'la cause technique doit être conservée');
  assert.match(m, /PAS/, "le message doit dire clairement que rien n'a été enregistré");
});

test('une collection inconnue ne casse pas le message', () => {
  const m = messageEchecEcriture('collection_inventee', 'delete');
  assert.match(m, /collection_inventee/);
  assert.equal(typeof m, 'string');
});

test('l erreur porte de quoi decider sans relire son texte', () => {
  const e = new ErreurEcriture({
    collection: 'mouvements_financiers', operation: 'update', id: 'abc',
    cause: new Error('permission denied'),
  });
  assert.equal(e.collection, 'mouvements_financiers');
  assert.equal(e.operation, 'update');
  assert.equal(e.id, 'abc');
  assert.equal(e.causeTexte, 'permission denied');
  assert.ok(e instanceof Error, 'doit rester une Error : les catch existants la voient');
});

test('l erreur se reconnait sans instanceof (Vite peut servir deux instances du module)', () => {
  const e = new ErreurEcriture({ collection: 'commandes', operation: 'delete' });
  assert.equal(estErreurEcriture(e), true);
  assert.equal(estErreurEcriture(JSON.parse(JSON.stringify({ ...e, estErreurEcriture: true }))), true);
  assert.equal(estErreurEcriture(new Error('autre chose')), false);
  assert.equal(estErreurEcriture('texte'), false);
  assert.equal(estErreurEcriture(null), false);
  assert.equal(estErreurEcriture(undefined), false);
});

/* ══ Le verdict du filet ══ */

test('le filet ne signale QUE les echecs d ecriture', () => {
  assert.equal(verdictRejet(new ErreurEcriture({ collection: 'rapports', operation: 'update' })).signaler, true);
  assert.equal(verdictRejet(new TypeError('bug de code')).signaler, false,
    'un bug de code doit garder son comportement d origine, pas devenir un toast');
  assert.equal(verdictRejet(undefined).signaler, false);
});

test('la meme panne n empile pas cinq toasts identiques', () => {
  const afficher = creerAntiRepetition(4000);
  assert.equal(afficher('réseau coupé', 1000), true);
  assert.equal(afficher('réseau coupé', 1500), false, 'répétition immédiate : à taire');
  assert.equal(afficher('autre panne', 1500), true, 'un message DIFFERENT doit passer');
  assert.equal(afficher('réseau coupé', 6000), true, 'après la fenêtre, on réaffiche');
});

/* ══ Le filet, dans un vrai DOM ══ */

test('un rejet non rattrape devient un message visible — sans toucher au reste', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' });
  const precedent = globalThis.window;
  globalThis.window = dom.window;
  try {
    const vus = [];
    const retirer = installerFiletEcriture((m) => vus.push(m));

    // Un echec d'ecriture : doit etre montre.
    const evt = new dom.window.Event('unhandledrejection');
    evt.reason = new ErreurEcriture({ collection: 'commandes', operation: 'update', id: 'c1' });
    dom.window.dispatchEvent(evt);
    assert.equal(vus.length, 1, "l'échec d'écriture n'a pas été montré au gérant");
    assert.match(vus[0], /commande/);

    // Un rejet ordinaire : le filet ne s'en mele pas.
    const autre = new dom.window.Event('unhandledrejection');
    autre.reason = new Error('promesse tierce');
    dom.window.dispatchEvent(autre);
    assert.equal(vus.length, 1, 'le filet a intercepté un rejet qui ne le regarde pas');

    retirer();
  } finally {
    globalThis.window = precedent;
  }
});

test('le filet est idempotent — StrictMode monte deux fois', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const precedent = globalThis.window;
  globalThis.window = dom.window;
  try {
    const vus = [];
    installerFiletEcriture((m) => vus.push(m));
    installerFiletEcriture((m) => vus.push(m));
    const evt = new dom.window.Event('unhandledrejection');
    evt.reason = new ErreurEcriture({ collection: 'rapports', operation: 'delete' });
    dom.window.dispatchEvent(evt);
    assert.equal(vus.length, 1, 'deux écouteurs posés : le gérant voit le message en double');
  } finally {
    globalThis.window = precedent;
  }
});

test('un afficheur qui plante ne fait pas planter la page (regle du 14/09)', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const precedent = globalThis.window;
  globalThis.window = dom.window;
  const erreurConsole = console.error;
  console.error = () => {};
  try {
    installerFiletEcriture(() => { throw new Error('toast cassé'); });
    const evt = new dom.window.Event('unhandledrejection');
    evt.reason = new ErreurEcriture({ collection: 'clients', operation: 'update' });
    assert.doesNotThrow(() => dom.window.dispatchEvent(evt));
  } finally {
    console.error = erreurConsole;
    globalThis.window = precedent;
  }
});

test('sans window, poser le filet ne leve pas', () => {
  const precedent = globalThis.window;
  globalThis.window = undefined;
  try {
    assert.doesNotThrow(() => installerFiletEcriture(() => {}));
  } finally {
    globalThis.window = precedent;
  }
});

/* ══ Contrat de source : db.js et main.jsx ══ */

const dbSrc = readFileSync(new URL('../src/services/db.js', import.meta.url), 'utf8');

test('update() ne renvoie plus null sur une erreur', () => {
  assert.ok(
    !dbSrc.includes("console.error(`[db] update ${this.name}:`, error.message); return null;"),
    'update() avale de nouveau les erreurs (constat C6)',
  );
  assert.ok(dbSrc.includes("operation: 'update'"), 'update() doit lever une ErreurEcriture');
});

test('delete() ne renvoie plus false sur une erreur', () => {
  assert.ok(
    !dbSrc.includes("console.error(`[db] delete ${this.name}:`, error.message); return false;"),
    'delete() avale de nouveau les erreurs (constat C6)',
  );
  assert.ok(dbSrc.includes("operation: 'delete'"), 'delete() doit lever une ErreurEcriture');
});

test('une ligne introuvable est un echec, pas un non-evenement', () => {
  assert.ok(
    dbSrc.includes("cause: 'ligne introuvable'"),
    'un update sur une ligne absente doit être signalé, pas renvoyer null en silence',
  );
});

test('list() NE leve PAS — une lecture ratee ne doit jamais blanchir un ecran', () => {
  // Choix delibere et documente : `list()` est appelee dans tous les `load()`
  // au montage. La faire lever rejouerait exactement l'incident du 14/09/2026.
  // Le prix est connu : un ecran peut se vider sans un mot. C'est un constat
  // laisse ouvert, pas un oubli.
  const bloc = dbSrc.slice(dbSrc.indexOf('async list()'), dbSrc.indexOf('async getById'));
  assert.ok(bloc.includes('return [];'), 'list() doit continuer à renvoyer [] en cas d’erreur');
  assert.ok(!bloc.includes('throw'), 'list() ne doit pas lever : voir l’incident du 14/09');
});

test('le filet est pose dans main.jsx AVANT le rendu, et sous try/catch', () => {
  const main = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  const iFilet = main.indexOf('installerFiletEcriture(');
  const iRendu = main.indexOf('ReactDOM.createRoot');
  assert.ok(iFilet > -1, 'le filet global n’est plus posé : les 76 appels nus redeviennent muets');
  assert.ok(iFilet < iRendu, 'le filet doit être posé avant le rendu');
  const avant = main.slice(main.indexOf('async function init()'), iFilet);
  assert.ok(avant.includes('try {'), 'la pose du filet doit être elle-même protégée (règle du 14/09)');
});
