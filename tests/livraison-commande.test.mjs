/**
 * Regression : le bouton « Livrée » ne doit plus compter deux fois, ni perdre
 * un effet en silence, ni laisser l'argent d'une commande annulee dans les
 * livres.
 *
 * Constats C3 / C4 / C5 / 8a.1 / 8b.1 / 8b.2 de l'audit VAGUE 2.
 *
 * Lancer :  node --test tests/livraison-commande.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EFFETS_LIVRAISON,
  estStatutLivree,
  estStatutAnnulee,
  livraisonDejaConfirmee,
  doitDeclencherLivraison,
  doitContrePasser,
  referenceEffet,
  resumerEffets,
  estCommandeTest,
  ressembleACommandeTest,
  suppressionAutorisee,
  commandesPurgeables,
} from '../src/services/livraison-commande.js';

/* ══ Statuts : tolerance en lecture ══ */

test('les orthographes historiques de la base sont reconnues', () => {
  for (const v of ['livree', 'Livrée', 'LIVREE', 'livre', ' livrée ']) {
    assert.ok(estStatutLivree(v), `« ${v} » doit compter comme livrée`);
  }
  for (const v of ['annulee', 'Annulée', 'annule', 'ANNULEE']) {
    assert.ok(estStatutAnnulee(v), `« ${v} » doit compter comme annulée`);
  }
  for (const v of ['prete', 'en_production', '', null, undefined, 'livraison']) {
    assert.ok(!estStatutLivree(v), `« ${v} » ne doit PAS compter comme livrée`);
    assert.ok(!estStatutAnnulee(v), `« ${v} » ne doit PAS compter comme annulée`);
  }
});

/* ══ LE CONTRAT CENTRAL : rattrapage possible, doublon impossible ══ */

test('une livraison CONFIRMEE ne se redeclenche jamais', () => {
  const cmd = { id: 'c1', statut: 'livree', livraison_traitee: true };
  assert.equal(doitDeclencherLivraison(cmd, 'livree'), false);
});

test('une livraison INTERROMPUE reste rattrapable — c est tout l interet du correctif', () => {
  // L'ancienne garde etait :
  //   dejaLivree = cmd.livraison_traitee === true || normalizeStatut(cmd.statut) === 'livree'
  // Elle rendait ce cas INRATTRAPABLE : le statut disait « livree », donc on
  // ne rejouait plus rien, alors que l'encaissement avait echoue.
  const cmd = { id: 'c1', statut: 'livree', livraison_traitee: undefined };
  assert.equal(livraisonDejaConfirmee(cmd), false);
  assert.equal(
    doitDeclencherLivraison(cmd, 'livree'), true,
    'une commande au statut livree SANS drapeau doit pouvoir rejouer ses effets',
  );
});

test('le drapeau ne vaut que s il est strictement true', () => {
  for (const valeur of ['true', 1, {}, 'oui']) {
    assert.equal(
      livraisonDejaConfirmee({ id: 'c', livraison_traitee: valeur }), false,
      `« ${String(valeur)} » ne doit pas passer pour une livraison confirmée`,
    );
  }
});

test('aucun autre statut ne declenche la livraison', () => {
  const cmd = { id: 'c1', statut: 'prete' };
  for (const s of ['prete', 'en_production', 'validee_attente_paiement', 'annulee']) {
    assert.equal(doitDeclencherLivraison(cmd, s), false, `« ${s} » ne doit rien déclencher`);
  }
});

/* ══ Contre-passation ══ */

test('annuler une commande livree declenche la contre-passation', () => {
  assert.equal(doitContrePasser({ id: 'c', livraison_traitee: true }, 'annulee'), true);
  assert.equal(doitContrePasser({ id: 'c', statut: 'livree' }, 'annulee'), true);
  assert.equal(doitContrePasser({ id: 'c', statut: 'livre' }, 'annulee'), true);
});

test('annuler une commande jamais livree ne contre-passe rien', () => {
  assert.equal(doitContrePasser({ id: 'c', statut: 'prete' }, 'annulee'), false);
});

test('une commande livree ne contre-passe pas sur un autre statut', () => {
  assert.equal(doitContrePasser({ id: 'c', livraison_traitee: true }, 'prete'), false);
});

/* ══ References d'idempotence ══ */

test('la reference ne depend QUE de l identifiant de commande', () => {
  const a = { id: 'abc', numero: 'CMD-1', montant_total: 5000, created_at: '2026-01-01' };
  const b = { id: 'abc', numero: 'CMD-99', montant_total: 9999, created_at: '2026-09-16' };
  // Deux vues de la meme commande a deux instants : meme reference, sinon la
  // deduplication ne tient pas entre deux tentatives.
  assert.equal(referenceEffet(a, 'stock', 'p1'), referenceEffet(b, 'stock', 'p1'));
});

test('la reference d encaissement reste celle deja ecrite en base', () => {
  // 'commande:<id>' est la forme historique. La changer rendrait invisibles les
  // encaissements deja enregistres, et un rejeu re-encaisserait.
  assert.equal(referenceEffet({ id: 'x1' }, 'encaissement'), 'commande:x1');
});

test('deux effets differents ne partagent jamais une reference', () => {
  const cmd = { id: 'x1' };
  const refs = EFFETS_LIVRAISON.map((e) => referenceEffet(cmd, e.cle));
  assert.equal(new Set(refs).size, refs.length, 'collision de références entre effets');
});

test('deux articles de stock de la meme commande ont deux references', () => {
  assert.notEqual(
    referenceEffet({ id: 'x' }, 'stock', 'produitA'),
    referenceEffet({ id: 'x' }, 'stock', 'produitB'),
  );
});

test('sans identifiant, pas de reference — donc pas d ecriture non tracable', () => {
  assert.equal(referenceEffet({}, 'stock', 'p'), null);
  assert.equal(referenceEffet(undefined, 'encaissement'), null);
});

/* ══ Verdict des six effets ══ */

const ok = { status: 'fulfilled', value: {} };
const ko = (m) => ({ status: 'rejected', reason: new Error(m) });

test('six succes : verdict positif, aucun message', () => {
  const v = resumerEffets(EFFETS_LIVRAISON.map((e) => ({ cle: e.cle, resultat: ok })));
  assert.equal(v.tousReussis, true);
  assert.equal(v.message, null);
  assert.deepEqual(v.echecs, []);
});

test('un seul echec suffit a refuser le verdict — le toast vert ne doit plus mentir', () => {
  const v = resumerEffets([
    { cle: 'facture', resultat: ok },
    { cle: 'encaissement', resultat: ko('réseau coupé') },
    { cle: 'stock', resultat: ok },
  ]);
  assert.equal(v.tousReussis, false, 'un échec doit invalider tout le verdict');
});

test('le message NOMME l effet manque et sa cause', () => {
  const v = resumerEffets([{ cle: 'encaissement', resultat: ko('réseau coupé') }]);
  assert.match(v.message, /trésorerie/, "le message doit nommer l'effet manqué");
  assert.match(v.message, /réseau coupé/, 'le message doit porter la cause réelle');
  assert.match(v.message, /rattrapable/, 'le message doit dire que la reprise est possible');
});

test('plusieurs echecs sont enumeres en francais lisible', () => {
  const v = resumerEffets([
    { cle: 'stock', resultat: ko('a') },
    { cle: 'fidelite', resultat: ko('b') },
    { cle: 'rapport', resultat: ko('c') },
  ]);
  assert.equal(v.echecs.length, 3);
  assert.match(v.message, / et /, 'les effets manqués doivent être énumérés, pas concaténés');
});

test('une raison non-Error ne casse pas le resume', () => {
  const v = resumerEffets([
    { cle: 'stock', resultat: { status: 'rejected', reason: 'texte brut' } },
    { cle: 'fidelite', resultat: { status: 'rejected', reason: undefined } },
    { cle: 'rapport', resultat: { status: 'rejected', reason: { code: 42 } } },
  ]);
  assert.equal(v.tousReussis, false);
  assert.equal(typeof v.message, 'string');
});

test('une entree vide ou absurde ne fait pas croire a un echec', () => {
  assert.equal(resumerEffets([]).tousReussis, true);
  assert.equal(resumerEffets(null).tousReussis, true);
  assert.equal(resumerEffets(undefined).tousReussis, true);
});

/* ══ Commandes de test : marquer, jamais deviner ══ */

test('seul le drapeau explicite fait une commande de test', () => {
  assert.equal(estCommandeTest({ est_test: true }), true);
  assert.equal(estCommandeTest({ description: 'commande test' }), false);
  assert.equal(estCommandeTest({ montant_total: 0 }), false);
  assert.equal(estCommandeTest({}), false);
});

test('« ressemble a un test » sert a signaler, pas a supprimer', () => {
  assert.equal(ressembleACommandeTest({ client_nom: 'Client test' }), true);
  assert.equal(ressembleACommandeTest({ description: 'Impression test' }), true);
  // Les faux positifs de l'ancienne heuristique restent des faux positifs —
  // mais ils ne declenchent plus aucune suppression.
  assert.equal(ressembleACommandeTest({ description: 'Bâche protestation' }), false);
  assert.equal(ressembleACommandeTest({ description: 'Affiche contestation' }), false);
});

/* ══ Suppression ══ */

test('une commande livree ne peut PAS etre supprimee', () => {
  const v = suppressionAutorisee({ id: 'c', statut: 'livree', montant_total: 45000 });
  assert.equal(v.autorise, false);
  assert.match(v.motif, /Annulez/, 'le motif doit dire quoi faire à la place');
});

test('une commande avec de l argent, non annulee, ne peut pas etre supprimee', () => {
  assert.equal(suppressionAutorisee({ id: 'c', statut: 'prete', montant_total: 7000 }).autorise, false);
});

test('une commande annulee ou a montant nul reste supprimable', () => {
  assert.equal(suppressionAutorisee({ id: 'c', statut: 'annulee', montant_total: 2000 }).autorise, true);
  assert.equal(suppressionAutorisee({ id: 'c', statut: 'prete', montant_total: 0 }).autorise, true);
});

test('la purge ne touche QUE les commandes marquees ET supprimables', () => {
  // Les 5 commandes reellement en base au 16/09/2026, plus une vraie commande
  // livree dont la description contient « test » — exactement le cas que
  // l'ancien handlePurgeTests supprimait.
  const commandes = [
    { id: '1', client_nom: 'Client test', statut: 'en_production', montant_total: 4500, est_test: true },
    { id: '2', client_nom: 'Ibrahim Abakar', statut: 'validee_attente_paiement', montant_total: 4500, est_test: true },
    { id: '3', client_nom: 'Client test', statut: 'annulee', montant_total: 2000, est_test: true },
    { id: '4', client_nom: 'Mairie', description: 'test couleur bâche', statut: 'livree', montant_total: 94000 },
    { id: '5', client_nom: 'Vrai client', statut: 'prete', montant_total: 50000 },
  ];
  const ids = commandesPurgeables(commandes).map((c) => c.id);
  assert.ok(!ids.includes('4'), 'une VRAIE commande livrée ne doit jamais être purgée');
  assert.ok(!ids.includes('5'), 'une commande non marquée ne doit jamais être purgée');
  assert.ok(!ids.includes('1'), 'une commande marquée mais portant 4 500 F non annulés est protégée');
  assert.deepEqual(ids, ['3'], 'seule la commande marquée ET annulée est purgeable');
});

test('la purge tolere une entree absurde', () => {
  assert.deepEqual(commandesPurgeables(null), []);
  assert.deepEqual(commandesPurgeables(undefined), []);
});

/* ══ Contrat de l'ecran — ce que la source doit contenir ══ */

const page = readFileSync(new URL('../src/features/commandes/page.jsx', import.meta.url), 'utf8');

test('les quatre effets ne partent plus en .catch(console.error)', () => {
  for (const motif of [
    "syncCommandeToRapport(cmd).catch(",
    "crediterPointsFidelite(cmd).catch(",
    "syncStockFromCommande(cmd).catch(",
    "encaisserCommande(cmd).catch(",
  ]) {
    assert.ok(
      !page.includes(motif),
      `« ${motif} » est revenu : un effet de livraison lancé dans le vide (constat C4)`,
    );
  }
});

test('les effets sont attendus par Promise.allSettled', () => {
  assert.ok(page.includes('Promise.allSettled'), 'les six effets doivent être attendus');
  assert.ok(page.includes('resumerEffets('), 'le verdict doit être calculé, pas supposé');
});

test('livraison_traitee n est pose QU APRES le verdict de succes', () => {
  const iVerdict = page.indexOf('const verdict = await executerEffetsLivraison');
  const iDrapeau = page.indexOf('livraison_traitee: true');
  assert.ok(iVerdict > -1, 'executerEffetsLivraison introuvable');
  assert.ok(iDrapeau > -1, 'le drapeau livraison_traitee a disparu');
  assert.ok(
    iDrapeau > iVerdict,
    'livraison_traitee est posé AVANT les effets : un effet manqué redevient définitivement perdu',
  );
  const entre = page.slice(iVerdict, iDrapeau);
  assert.ok(
    entre.includes('verdict.tousReussis'),
    'le drapeau doit être conditionné au succès complet',
  );
});

test('les boutons de transition sont grises pendant l ecriture', () => {
  const occurrences = (page.match(/disabled=\{commandeEnCours === (cmd|showDetail)\.id\}/g) || []).length;
  assert.ok(
    occurrences >= 10,
    `seuls ${occurrences} boutons sont protégés : le double-clic compte deux fois (constat 8a.1)`,
  );
});

test('un verrou d execution protege chaque commande, pas seulement le bouton', () => {
  assert.ok(page.includes('verrouCommande.executerUneSeuleFois('),
    'sans verrou, les deux boutons « Livrée » (liste + détail) restent cliquables ensemble');
});

test('la garde de livraison relit la commande EN BASE', () => {
  assert.ok(
    page.includes('await db.commandes.getById(cmd.id)) || cmd'),
    "la garde doit partir de l'état en base, pas de l'objet du rendu",
  );
});

test('l ancienne purge par mot-cle a disparu', () => {
  assert.ok(
    !page.includes("(c.description || '').toLowerCase().includes('test')"),
    'la purge par sous-chaîne « test » supprimait de vraies commandes livrées',
  );
  assert.ok(page.includes('commandesPurgeables('), 'la purge doit passer par la règle testée');
});

test('la suppression passe par la regle de protection', () => {
  assert.ok(page.includes('suppressionAutorisee(cmd)'),
    'supprimer une commande livrée détruit sa référence d\'idempotence (constat 8b.2)');
});
