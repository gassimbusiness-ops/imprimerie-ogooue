/**
 * Arbitrage metier n°5 — la sortie de stock automatique a la livraison.
 *
 * ── Ce que la reponse de terrain dit ──────────────────────────────────────
 *
 * Q4, le 14/09/2026, a Gassim : « Les supports et consommables d'une commande
 * personnalisee sont-ils deduits du stock ? » — Reponse : **NON**.
 *
 * ── Ce que le code faisait ────────────────────────────────────────────────
 *
 * `syncStockFromCommande()` DEDUISAIT le stock a chaque passage en « Livree »,
 * et ecrivait un mouvement de sortie. Le code faisait donc exactement l'inverse
 * de la pratique declaree : c'est l'arbitrage applique A L'ENVERS.
 *
 * Un comportement inverse coute plus cher qu'un comportement absent : il
 * produit un inventaire theorique faux que personne ne questionne — et c'est
 * precisement le chiffre qu'on regarde en cas de suspicion de vol.
 *
 * Pire, l'appariement se fait par sous-chaine de nom : une ligne « Papier »
 * decremente « Papier opaque », « Papier laminage » ou « Papier autocollant »
 * selon l'ordre de la liste. Le mauvais article baissait, silencieusement.
 *
 * ── Ce qui est decide ici ─────────────────────────────────────────────────
 *
 * La sortie automatique est DESACTIVEE par defaut, alignee sur Q4. La regle du
 * projet interdit de supprimer : le chemin de code reste entier et se rallume
 * en changeant une seule constante — le jour ou le modele a trois temps
 * (reservation / consommation / livraison) aura ete tranche par Gassim.
 *
 * [MESURE le 18/09/2026 sur la base de production, en lecture seule]
 *   collection `mouvements_stock` : 44 lignes, dont 0 portant `commande_id`
 *   et 0 portant une reference `commande:…`.
 * Aucune sortie automatique n'a donc encore ete ecrite : fermer l'interrupteur
 * ne change aucun chiffre deja affiche, et ne demande aucune reparation.
 *
 * Lancer :  node --test tests/sortie-stock-commande.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SORTIE_STOCK_AUTO_COMMANDE,
  decisionSortieStock,
} from '../src/services/sortie-stock-commande.js';

const COMMANDE = {
  id: 'CMD1',
  numero: 'CMD-REEL1',
  lignes: [{ nom: 'Papier opaque', quantite: 3 }],
};

/* ══ L'interrupteur ══ */

test('la sortie de stock automatique est DESACTIVEE par defaut (Q4)', () => {
  assert.equal(
    SORTIE_STOCK_AUTO_COMMANDE, false,
    'la sortie automatique est rallumée : le stock baisse alors que la pratique de terrain (Q4) dit qu’il ne baisse pas',
  );
});

test('interrupteur ferme : aucune sortie, et le motif NOMME la reponse de terrain', () => {
  const d = decisionSortieStock({ commande: COMMANDE });
  assert.equal(d.action, 'ignorer');
  assert.match(
    d.motif, /Q4/,
    'le motif doit citer la réponse de terrain qui ferme l’interrupteur, sinon personne ne saura pourquoi le stock ne bouge pas',
  );
});

test('interrupteur ferme : meme une commande bien formee ne sort rien', () => {
  const d = decisionSortieStock({
    commande: { id: 'X', lignes: [{ nom: 'Papier', qte: 500 }] },
  });
  assert.equal(d.action, 'ignorer', '500 unités ne doivent pas sortir tant que Q4 vaut NON');
});

/* ══ Le comportement quand on rallume ══ */

test('rallume : une commande avec des lignes redevient une sortie', () => {
  const d = decisionSortieStock({ commande: COMMANDE, actif: true });
  assert.equal(d.action, 'sortir');
});

test('rallume : une commande sans ligne ne sort rien', () => {
  const d = decisionSortieStock({ commande: { id: 'X', lignes: [] }, actif: true });
  assert.equal(d.action, 'ignorer');
  assert.match(d.motif, /ligne/, 'le motif doit dire qu’il n’y a rien à sortir');
});

test('rallume : une commande sans identifiant ne sort rien', () => {
  const d = decisionSortieStock({
    commande: { lignes: [{ nom: 'Papier', quantite: 1 }] }, actif: true,
  });
  assert.equal(d.action, 'ignorer');
  assert.match(
    d.motif, /identifiant/,
    'sans identifiant, aucune référence d’idempotence n’est calculable : la sortie serait rejouable à l’infini',
  );
});

test('une entree absurde ne casse pas la decision', () => {
  assert.equal(decisionSortieStock({ commande: null, actif: true }).action, 'ignorer');
  assert.equal(decisionSortieStock({}).action, 'ignorer');
});

/* ══ Contrat du service — ce que la source doit contenir ══ */

const service = readFileSync(
  new URL('../src/services/sync-stock-commande.js', import.meta.url), 'utf8',
);

test('le service consulte la decision AVANT toute lecture de la base', () => {
  assert.ok(
    service.includes('decisionSortieStock('),
    'le service décide encore tout seul : l’interrupteur ne le pilote pas',
  );
  const iDecision = service.indexOf('decisionSortieStock(');
  const iLecture = service.indexOf('db.produits.list()');
  assert.ok(iLecture > -1, 'la lecture du stock a disparu du service');
  assert.ok(
    iDecision < iLecture,
    'la décision est prise APRÈS la lecture de la base : interrupteur fermé, on paie encore la requête',
  );
});

test('le service n ecrit plus de sortie quand l interrupteur est ferme', () => {
  const iDecision = service.indexOf('decisionSortieStock(');
  const iEcriture = service.indexOf('db.mouvements_stock.create(');
  assert.ok(iEcriture > -1, 'l’écriture du mouvement a disparu : le chemin de code doit rester entier');
  assert.ok(
    iDecision < iEcriture,
    'l’écriture du mouvement de stock précède la décision : le stock bouge avant qu’on ait demandé s’il le devait',
  );
});
