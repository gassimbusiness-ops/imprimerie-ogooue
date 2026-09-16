/**
 * Regression : l'argent d'une commande annulee ne doit plus rester dans la
 * tresorerie ni dans le chiffre d'affaires du mois.
 *
 * Constat C5 / 8b.1 de l'audit VAGUE 2 : `handleAnnuler` ne faisait que changer
 * le statut. Le mouvement de tresorerie, le solde credite, la sortie de stock,
 * les points et la facture restaient tels quels.
 *
 * Ces tests font tourner la VRAIE fonction contre une base factice, pas un
 * extrait de source : c'est la partie du code qui deplace de l'argent.
 *
 * Lancer :  node --test tests/contre-passation-commande.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  contrePasserCommande, SUFFIXE_ANNULATION,
} from '../src/services/contre-passation-commande.js';

/* ══ Base factice ══ */

function creerBase(contenu = {}) {
  const tables = {
    mouvements_financiers: [], comptes_bancaires: [], mouvements_stock: [],
    produits: [], fidelite_clients: [], factures: [], rapports: [],
    ...contenu,
  };
  const ecritures = [];
  const collection = (nom) => ({
    async list() { return tables[nom].map((x) => ({ ...x })); },
    async create(data) {
      const item = { id: `${nom}-${tables[nom].length + 1}`, ...data };
      tables[nom].push(item);
      ecritures.push({ table: nom, op: 'create', data });
      return item;
    },
    async update(id, patch) {
      const i = tables[nom].findIndex((x) => x.id === id);
      if (i === -1) throw new Error(`${nom}/${id} introuvable`);
      tables[nom][i] = { ...tables[nom][i], ...patch };
      ecritures.push({ table: nom, op: 'update', id, data: patch });
      return tables[nom][i];
    },
  });
  const deps = {};
  for (const nom of Object.keys(tables)) deps[nom] = collection(nom);
  return { deps, tables, ecritures };
}

/** Le scenario reel : commande de 45 000 F livree, encaissee, stock sorti, points credites. */
function scenarioLivree() {
  return creerBase({
    comptes_bancaires: [{ id: 'caisse', nom: 'Caisse', solde: 145000 }],
    mouvements_financiers: [{
      id: 'm1', type: 'entree', montant: 45000, compte_id: 'caisse',
      reference: 'commande:CMD1', date: '2026-09-16', categorie: 'encaissement_commande',
    }],
    produits: [{ id: 'p1', nom: 'Bâche 3m', quantite: 12 }],
    mouvements_stock: [{
      id: 's1', type: 'sortie', quantite: 4, produit_id: 'p1', produit_nom: 'Bâche 3m',
      reference: 'commande:CMD1:stock:p1',
    }],
    fidelite_clients: [{
      id: 'f1', client_id: 'CLI1', points_actuels: 220, total_points_gagnes: 220,
      historique: [
        { type: 'commande', points: 45, commande_id: 'CMD1' },
        { type: 'premiere_commande', points: 100, commande_id: 'CMD1' },
        { type: 'inscription_complete', points: 50 },
      ],
    }],
    factures: [{ id: 'fa1', commande_id: 'CMD1', numero: 'OG-2026-ABC', statut: 'envoyee' }],
  });
}

const CMD = { id: 'CMD1', numero: 'CMD-1', client_id: 'CLI1', client_nom: 'Mairie', montant_total: 45000 };

/* ══ LE CONTRAT CENTRAL ══ */

test('la tresorerie est reprise : mouvement inverse ET solde corrige', async () => {
  const { deps, tables } = scenarioLivree();
  await contrePasserCommande(CMD, deps);

  const inverse = tables.mouvements_financiers.find((m) => m.reference === `commande:CMD1${SUFFIXE_ANNULATION}`);
  assert.ok(inverse, "aucune écriture inverse : l'argent reste dans les livres");
  assert.equal(inverse.type, 'sortie');
  assert.equal(inverse.montant, 45000);
  assert.equal(tables.comptes_bancaires[0].solde, 100000, '145 000 − 45 000 attendu');
});

test('rien n est supprime — on ajoute une ecriture de sens oppose', async () => {
  const { deps, tables } = scenarioLivree();
  await contrePasserCommande(CMD, deps);
  assert.ok(
    tables.mouvements_financiers.some((m) => m.reference === 'commande:CMD1'),
    "l'écriture d'origine doit rester : on contre-passe, on n'efface pas",
  );
  assert.equal(tables.mouvements_financiers.length, 2);
});

test('le stock revient, et le mouvement de retour est trace', async () => {
  const { deps, tables } = scenarioLivree();
  await contrePasserCommande(CMD, deps);
  assert.equal(tables.produits[0].quantite, 16, '12 + 4 attendu');
  assert.equal(tables.produits[0].stock, 16);
  const retour = tables.mouvements_stock.find((m) => m.type === 'entree');
  assert.ok(retour, 'le retour en stock doit laisser un mouvement');
  assert.equal(retour.quantite, 4);
});

test('seuls les points de CETTE commande sont repris', async () => {
  const { deps, tables } = scenarioLivree();
  await contrePasserCommande(CMD, deps);
  const f = tables.fidelite_clients[0];
  // 45 + 100 repris ; les 50 points d'inscription ne bougent pas.
  assert.equal(f.points_actuels, 75, '220 − 145 attendu (les 50 d’inscription restent)');
  assert.equal(f.total_points_gagnes, 75);
  assert.ok(f.historique.some((h) => h.type === 'annulation_commande' && h.points === -145));
});

test('la facture est annulee, jamais supprimee — un numero emis ne disparait pas', async () => {
  const { deps, tables } = scenarioLivree();
  await contrePasserCommande(CMD, deps);
  assert.equal(tables.factures.length, 1);
  assert.equal(tables.factures[0].statut, 'annulee');
  assert.equal(tables.factures[0].numero, 'OG-2026-ABC', 'le numéro doit être conservé');
});

/* ══ Idempotence ══ */

test('annuler DEUX fois ne rembourse pas deux fois', async () => {
  const { deps, tables } = scenarioLivree();
  await contrePasserCommande(CMD, deps);
  const soldeApres1 = tables.comptes_bancaires[0].solde;
  const stockApres1 = tables.produits[0].quantite;
  const pointsApres1 = tables.fidelite_clients[0].points_actuels;

  await contrePasserCommande(CMD, deps);

  assert.equal(tables.comptes_bancaires[0].solde, soldeApres1, 'solde débité deux fois');
  assert.equal(tables.produits[0].quantite, stockApres1, 'stock rendu deux fois');
  assert.equal(tables.fidelite_clients[0].points_actuels, pointsApres1, 'points repris deux fois');
  assert.equal(tables.mouvements_financiers.length, 2, 'une seule écriture inverse attendue');
});

/* ══ SingPay : l'argent encaisse AVANT la livraison ══ */

test('un paiement SingPay encaisse avant la livraison est repris aussi', async () => {
  // 8b.1 : le callback SingPay credite la tresorerie des la confirmation, bien
  // avant la livraison. Une annulation a ce stade laissait l'argent en caisse.
  const { deps, tables } = creerBase({
    comptes_bancaires: [{ id: 'airtel', nom: 'Airtel Money', solde: 30000 }],
    mouvements_financiers: [{
      id: 'm1', type: 'entree', montant: 7000, compte_id: 'airtel',
      reference: 'singpay:REF-77', date: '2026-09-16',
    }],
  });
  const cmd = { ...CMD, id: 'CMD2', singpay_reference: 'REF-77', montant_total: 7000 };
  const { effets } = await contrePasserCommande(cmd, deps);
  assert.ok(effets.includes('trésorerie'));
  assert.equal(tables.comptes_bancaires[0].solde, 23000, '30 000 − 7 000 attendu');
});

/* ══ Cas benins : la contre-passation ne doit jamais casser une annulation ══ */

test('une commande jamais livree ne trouve rien a contre-passer', async () => {
  const { deps, ecritures } = creerBase();
  const r = await contrePasserCommande({ id: 'CMD-neuve', montant_total: 5000 }, deps);
  assert.deepEqual(r.effets, []);
  assert.equal(ecritures.length, 0, 'aucune écriture ne doit partir');
});

test('une commande sans identifiant sort proprement', async () => {
  const { deps } = creerBase();
  const r = await contrePasserCommande({ numero: 'X' }, deps);
  assert.deepEqual(r.effets, []);
});

test('un compte disparu est signale, il ne fait pas echouer la reprise', async () => {
  const { deps, tables } = creerBase({
    comptes_bancaires: [],
    mouvements_financiers: [{
      id: 'm1', type: 'entree', montant: 45000, compte_id: 'compte-efface',
      reference: 'commande:CMD1',
    }],
  });
  const r = await contrePasserCommande(CMD, deps);
  assert.ok(r.notes.some((n) => /introuvable/.test(n)), 'le problème doit être nommé');
  assert.ok(
    tables.mouvements_financiers.some((m) => m.reference === `commande:CMD1${SUFFIXE_ANNULATION}`),
    "l'écriture inverse doit quand même exister",
  );
});

test('la couche de donnees est obligatoire — pas d import cache de db', async () => {
  await assert.rejects(() => contrePasserCommande(CMD), /couche de donnees manquante/);
});

test('une sortie de stock d une AUTRE commande n est pas touchee', async () => {
  const { deps, tables } = creerBase({
    produits: [{ id: 'p1', nom: 'Bâche', quantite: 10 }],
    mouvements_stock: [
      { id: 's1', type: 'sortie', quantite: 4, produit_id: 'p1', reference: 'commande:AUTRE:stock:p1' },
    ],
  });
  await contrePasserCommande(CMD, deps);
  assert.equal(tables.produits[0].quantite, 10, 'le stock d’une autre commande a été modifié');
  assert.equal(tables.mouvements_stock.length, 1);
});
