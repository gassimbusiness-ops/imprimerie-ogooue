/**
 * La garde presentee comme prioritaire sur tout le reste :
 * **une commande marquee `est_test` ne peut pas passer « Livree ».**
 *
 * ── Pourquoi elle passe avant tout ────────────────────────────────────────
 *
 * Q4, le 14/09/2026 : « les commandes actuellement affichees dans
 * l'application sont des TESTS, pas de vraies commandes ».
 *
 * Or un clic sur « Livree » declenche SIX ecritures d'argent reelles :
 * une facture, un encaissement en tresorerie, une sortie de stock, des points
 * de fidelite, une reprise dans le rapport journalier, la cloture de la tache.
 * Une manipulation d'essai contamine donc cinq domaines de donnees reelles —
 * et la regle du projet « on ne supprime rien » interdit de revenir en arriere
 * proprement.
 *
 * `estCommandeTest()` existait depuis le 16/09. Personne ne l'appelait sur le
 * chemin du changement de statut : la garde etait ecrite, pas branchee.
 *
 * ── Ce qui ne change pas ──────────────────────────────────────────────────
 *
 * La garde ne repose QUE sur le drapeau explicite `est_test`. Jamais sur
 * l'heuristique du nom : « test couleur » et « test daltonien » sont deux
 * prestations REELLES d'imprimerie. Une commande non marquee se livre comme
 * avant — la garde n'introduit aucune regression sur l'exploitation courante.
 *
 * [MESURE le 18/09/2026 sur la base de production, en lecture seule]
 *   collection `commandes` : 5 lignes, toutes `source = 'portail_client'`.
 *   **Aucune ne porte `est_test`** (migration 003 non appliquee), aucune n'est
 *   livree, aucune ne porte `livraison_traitee`.
 * La garde ne bloque donc aucune des 5 commandes tant que le marquage n'est
 * pas ecrit en base : c'est du code arme, en attente de son declencheur.
 *
 * Lancer :  node --test tests/garde-commande-test.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  livraisonAutorisee,
  doitDeclencherLivraison,
} from '../src/services/livraison-commande.js';

/* ══ La garde elle-meme ══ */

test('une commande marquee est_test ne peut PAS etre livree', () => {
  const verdict = livraisonAutorisee({ id: 'C1', est_test: true, montant_total: 4500 });
  assert.equal(
    verdict.autorise, false,
    'une commande d’essai peut encore être livrée : six écritures d’argent réelles partent sur des données de test',
  );
});

test('le refus EXPLIQUE ce qu il protege, il ne dit pas juste non', () => {
  const verdict = livraisonAutorisee({ id: 'C1', est_test: true });
  assert.match(
    verdict.motif, /essai|test/i,
    'le motif doit dire que la commande est marquée comme un essai',
  );
  assert.match(
    verdict.motif, /factur|encaiss|stock/i,
    'le motif doit nommer ce qui serait écrit pour de bon — sinon le gérant croit à un bug et recommence',
  );
});

test('une commande ORDINAIRE se livre exactement comme avant', () => {
  const verdict = livraisonAutorisee({ id: 'C2', montant_total: 4500 });
  assert.equal(
    verdict.autorise, true,
    'l’exploitation courante ne doit subir aucune régression',
  );
  assert.equal(verdict.motif, null);
});

test('la garde ne se declenche PAS sur le nom : « test couleur » est une vraie prestation', () => {
  const verdict = livraisonAutorisee({
    id: 'C3', description: 'test couleur', client_nom: 'Mairie', montant_total: 12000,
  });
  assert.equal(
    verdict.autorise, true,
    'l’heuristique du nom est revenue : « test couleur » et « test daltonien » sont de vraies commandes d’imprimerie',
  );
});

test('est_test a une valeur autre que true ne bloque rien', () => {
  assert.equal(livraisonAutorisee({ id: 'C4', est_test: 'false' }).autorise, true);
  assert.equal(livraisonAutorisee({ id: 'C5', est_test: false }).autorise, true);
});

test('une entree absurde ne bloque pas l exploitation', () => {
  assert.equal(livraisonAutorisee(null).autorise, true);
  assert.equal(livraisonAutorisee(undefined).autorise, true);
});

/* ══ Le branchement sur le declenchement ══ */

test('doitDeclencherLivraison refuse une commande d essai', () => {
  assert.equal(
    doitDeclencherLivraison({ id: 'C1', est_test: true }, 'livree'), false,
    'le déclenchement ignore la garde : les six effets partent quand même',
  );
});

test('doitDeclencherLivraison reste vrai pour une commande ordinaire', () => {
  assert.equal(doitDeclencherLivraison({ id: 'C2' }, 'livree'), true);
  assert.equal(
    doitDeclencherLivraison({ id: 'C3', livraison_traitee: true }, 'livree'), false,
    'une livraison déjà confirmée ne se rejoue pas — comportement d’avant, inchangé',
  );
});

/* ══ Contrat de l'ecran — la garde doit etre VUE par l'operateur ══ */

const page = readFileSync(
  new URL('../src/features/commandes/page.jsx', import.meta.url), 'utf8',
);

test('l ecran Commandes consulte la garde avant de changer le statut', () => {
  assert.ok(
    page.includes('livraisonAutorisee('),
    'aucun appel à livraisonAutorisee dans l’écran : la garde est écrite mais pas branchée',
  );
});

test('la garde est consultee AVANT que le statut soit ecrit en base', () => {
  const iGarde = page.indexOf('livraisonAutorisee(');
  const iEcriture = page.indexOf("db.commandes.update(cmd.id, { statut: newStatut");
  assert.ok(iEcriture > -1, 'l’écriture du statut a disparu de l’écran');
  assert.ok(
    iGarde > -1 && iGarde < iEcriture,
    'la garde est consultée APRÈS l’écriture du statut : la commande d’essai serait déjà marquée « Livrée » en base',
  );
});
