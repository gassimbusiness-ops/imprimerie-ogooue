/**
 * Arbitrage metier n°13 — le depot hebdomadaire est un TRANSFERT INTERNE.
 *
 * ── Ce que la reponse de terrain dit ──────────────────────────────────────
 *
 * Q3, le 14/09/2026, a Gassim : « `depot_hebdo` = depot a la banque, remise au
 * proprietaire, ou apport ? » — Reponse : **un depot a la banque**.
 *
 * Un depot a la banque ne cree pas d'argent : il en DEPLACE. La caisse baisse
 * du meme montant dont le compte bancaire monte. C'est un transfert interne,
 * pas une recette.
 *
 * ── Ce que le code faisait ────────────────────────────────────────────────
 *
 * `finances/page.jsx` traitait `depot_hebdo` comme une ENTREE simple :
 *   - ligne 244 : compte dans le total des entrees ;
 *   - lignes 339 / 351 : credite `compte_id`, ne debite jamais la caisse ;
 *   - ligne 424 : symetrique a la suppression.
 * Chaque depot gonflait donc le total des entrees — et l'argent existait deux
 * fois : une fois dans la caisse qui n'avait pas baisse, une fois a la banque.
 *
 * ── La convention retenue, identique a celle du type `transfert` ──────────
 *
 *   `compte_id`      = d'ou l'argent SORT  (la caisse)
 *   `compte_dest_id` = ou l'argent ARRIVE  (la banque)
 *
 * [MESURE le 18/09/2026 sur la base de production, en lecture seule]
 *   collection `mouvements_financiers` : 32 lignes — 30 `sortie`, 2 `entree`.
 *   **Aucune ligne de type `depot_hebdo`.**
 *   collection `rapports` : 237 lignes, **aucune ne porte le champ `depot_hebdo`**.
 * Le type existait dans le menu sans avoir jamais servi : la correction ne
 * deplace donc aucun franc deja saisi, et aucun solde affiche ne bouge. Elle
 * est entierement preventive — elle ferme la porte avant le premier depot.
 *
 * Lancer :  node --test tests/depot-hebdomadaire.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  estEntreeDeTresorerie,
  estTransfertInterne,
  effetSurSoldes,
} from '../src/services/mouvements-financiers.js';

/* ══ Le total des entrees ══ */

test('un depot hebdomadaire n est PAS une entree de tresorerie', () => {
  assert.equal(
    estEntreeDeTresorerie('depot_hebdo'), false,
    'le dépôt compte encore dans les entrées : le total des recettes est gonflé du montant déposé',
  );
});

test('une vraie entree reste une entree, une sortie reste une sortie', () => {
  assert.equal(estEntreeDeTresorerie('entree'), true);
  assert.equal(estEntreeDeTresorerie('sortie'), false);
  assert.equal(estEntreeDeTresorerie('transfert'), false);
});

/* ══ La nature du mouvement ══ */

test('le depot hebdomadaire est un transfert interne, comme le transfert', () => {
  assert.equal(
    estTransfertInterne('depot_hebdo'), true,
    'Q3 : un dépôt à la banque déplace de l’argent, il n’en crée pas',
  );
  assert.equal(estTransfertInterne('transfert'), true);
  assert.equal(estTransfertInterne('entree'), false);
});

/* ══ L'effet sur les soldes — le coeur de l'arbitrage ══ */

test('un depot DEBITE la caisse et CREDITE la banque', () => {
  const deltas = effetSurSoldes({
    type: 'depot_hebdo', montant: 500000, compte_id: 'caisse', compte_dest_id: 'bgfi',
  });
  assert.equal(
    deltas.caisse, -500000,
    'la caisse n’est pas débitée : l’argent déposé est encore compté dans le tiroir',
  );
  assert.equal(deltas.bgfi, +500000, 'le compte bancaire doit être crédité du même montant');
});

test('un depot ne cree ni ne detruit d argent : la somme des deltas est nulle', () => {
  const deltas = effetSurSoldes({
    type: 'depot_hebdo', montant: 125000, compte_id: 'caisse', compte_dest_id: 'finam',
  });
  const somme = Object.values(deltas).reduce((s, d) => s + d, 0);
  assert.equal(
    somme, 0,
    'un transfert interne à somme non nulle fabrique ou détruit de la trésorerie',
  );
});

test('depot sans compte de destination : rien n est debite, rien n est perdu', () => {
  const deltas = effetSurSoldes({
    type: 'depot_hebdo', montant: 90000, compte_id: 'caisse', compte_dest_id: '',
  });
  assert.deepEqual(
    deltas, {},
    'un dépôt sans destination doit rester sans effet : débiter la caisse sans créditer personne ferait disparaître l’argent',
  );
});

test('les autres types gardent exactement leur effet d avant', () => {
  assert.deepEqual(
    effetSurSoldes({ type: 'entree', montant: 1000, compte_id: 'c' }), { c: +1000 },
  );
  assert.deepEqual(
    effetSurSoldes({ type: 'sortie', montant: 1000, compte_id: 'c' }), { c: -1000 },
  );
  assert.deepEqual(
    effetSurSoldes({ type: 'transfert', montant: 1000, compte_id: 'a', compte_dest_id: 'b' }),
    { a: -1000, b: +1000 },
  );
});

test('l effet inverse annule exactement l effet direct', () => {
  const m = { type: 'depot_hebdo', montant: 77000, compte_id: 'caisse', compte_dest_id: 'finam' };
  const direct = effetSurSoldes(m);
  const inverse = effetSurSoldes(m, { inverser: true });
  for (const compte of Object.keys(direct)) {
    assert.equal(
      direct[compte] + inverse[compte], 0,
      `supprimer ou modifier le mouvement laisse un résidu sur ${compte} : les soldes dérivent à chaque correction`,
    );
  }
});

test('une entree absurde ne casse pas le calcul', () => {
  assert.deepEqual(effetSurSoldes(null), {});
  assert.deepEqual(effetSurSoldes({ type: 'depot_hebdo', montant: 'abc', compte_id: 'c' }), {});
});

/* ══ Contrat de l'ecran — ce que la source doit contenir ══ */

const page = readFileSync(
  new URL('../src/features/finances/page.jsx', import.meta.url), 'utf8',
);

test('l ecran Finances ne recense plus depot_hebdo a la main', () => {
  assert.ok(
    !page.includes("m.type === 'entree' || m.type === 'depot_hebdo'"),
    'le dépôt est encore additionné aux entrées écran par écran (finances/page.jsx) : la règle vit à quatre endroits, elle en oubliera un',
  );
  assert.ok(
    !page.includes("data.type === 'entree' || data.type === 'depot_hebdo'"),
    'le dépôt crédite encore son compte comme une entrée simple : la caisse n’est jamais débitée',
  );
});

test('l ecran Finances passe par le module partage', () => {
  assert.ok(
    page.includes('effetSurSoldes('),
    'les soldes sont encore calculés dans l’écran : le calcul doit être unique et testé',
  );
  assert.ok(
    page.includes('estEntreeDeTresorerie('),
    'le total des entrées est encore calculé dans l’écran',
  );
});

test('le formulaire demande le compte de destination pour un depot', () => {
  assert.ok(
    !page.includes("{form.type === 'transfert' && ("),
    'le compte de destination n’est proposé que pour un transfert : un dépôt saisi sans destination ne peut pas débiter la caisse',
  );
  assert.ok(
    page.includes('estTransfertInterne(form.type)'),
    'le formulaire doit demander la destination pour tout transfert interne, dépôt compris',
  );
});

/* ══ Contrat de l'export PDF ══ */

const pdf = readFileSync(
  new URL('../src/services/export-pdf.js', import.meta.url), 'utf8',
);

test('le releve PDF ne compte plus le depot comme une entree du compte source', () => {
  assert.ok(
    !pdf.includes("m.type === 'entree' || m.type === 'depot_hebdo'"),
    'le relevé de compte PDF montre encore le dépôt comme une entrée : le document remis à la banque contredirait le solde',
  );
});
