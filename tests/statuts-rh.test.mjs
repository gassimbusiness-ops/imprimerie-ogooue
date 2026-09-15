/**
 * Regression : les deux orthographes de statut RH.
 *
 * Bug d'origine (audit VAGUE 2, constat C7) :
 *   performance-rh/page.jsx:279 ECRIVAIT  'approuve'
 *   demandes-rh/page.jsx:106,329 LISAIENT 'approuvee'
 * Mesure du 15/09/2026 sur la production : les 4 demandes en base (200 000 F)
 * portent 'approuve'. Elles n'entraient dans aucun total, et le bouton
 * « Marquer payee » (qui exige `statut === 'approuvee'`) ne s'affichait jamais.
 *
 * Lancer :  node --test tests/statuts-rh.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATUT_RH, LIBELLES_STATUT_RH,
  normaliserStatutRH, statutDemande, estStatutRHConnu,
  estEnAttente, estApprouvee, estRejetee, estPayee, estEngageante,
  libelleStatutDemande,
} from '../src/services/statuts-rh.js';

/* ── Le cas du bug : les deux orthographes, dans les deux sens ── */

test('les deux orthographes d approbation convergent vers la meme valeur', () => {
  assert.equal(normaliserStatutRH('approuve'), STATUT_RH.APPROUVEE);
  assert.equal(normaliserStatutRH('approuvee'), STATUT_RH.APPROUVEE);
  assert.equal(normaliserStatutRH('approuve'), normaliserStatutRH('approuvee'));
});

test('les deux orthographes de rejet convergent vers la meme valeur', () => {
  assert.equal(normaliserStatutRH('rejete'), STATUT_RH.REJETEE);
  assert.equal(normaliserStatutRH('rejetee'), STATUT_RH.REJETEE);
  assert.equal(normaliserStatutRH('rejete'), normaliserStatutRH('rejetee'));
});

test('la valeur canonique est stable : normaliser deux fois ne change rien', () => {
  for (const canonique of Object.values(STATUT_RH)) {
    assert.equal(normaliserStatutRH(canonique), canonique, `${canonique} doit etre son propre canonique`);
    assert.equal(normaliserStatutRH(normaliserStatutRH(canonique)), canonique);
  }
});

test('une demande ecrite par performance-rh est vue approuvee par demandes-rh', () => {
  // Exactement les 4 lignes de production, telles qu'elles sont en base.
  const enBase = [
    { id: 'cdd75b15', type: 'loyer', montant: 95000, statut: 'approuve' },
    { id: '438ef3c9', type: 'electricite_eau', montant: 30000, statut: 'approuve' },
    { id: '4b0fc698', type: 'charge_autre', montant: 50000, statut: 'approuve' },
    { id: 'c0b4332c', type: 'charge_autre', montant: 25000, statut: 'approuve' },
  ];
  const engageantes = enBase.filter(estEngageante);
  assert.equal(engageantes.length, 4, 'les 4 demandes doivent redevenir visibles');
  assert.equal(
    engageantes.reduce((s, d) => s + d.montant, 0),
    200000,
    'les 200 000 F doivent reapparaitre dans les totaux',
  );
  // Le bouton « Marquer payee » s'affiche desormais sur ces 4 lignes.
  assert.ok(enBase.every(estApprouvee));
});

test('une avance approuvee est deductible du salaire, quelle que soit l orthographe', () => {
  const avances = [
    { type: 'avance', montant: 50000, statut: 'approuve' },   // ecrit par performance-rh
    { type: 'avance', montant: 30000, statut: 'approuvee' },  // ecrit par demandes-rh
    { type: 'avance', montant: 20000, statut: 'payee' },
    { type: 'avance', montant: 99999, statut: 'en_attente' }, // ne doit PAS etre deduite
    { type: 'avance', montant: 88888, statut: 'rejete' },     // ne doit PAS etre deduite
  ];
  const deduit = avances.filter(estEngageante).reduce((s, d) => s + d.montant, 0);
  assert.equal(deduit, 100000);
});

/* ── Tolerance de lecture ── */

test('accents, casse et espaces sont acceptes en lecture', () => {
  assert.equal(normaliserStatutRH('Approuvé'), STATUT_RH.APPROUVEE);
  assert.equal(normaliserStatutRH('  APPROUVÉE  '), STATUT_RH.APPROUVEE);
  assert.equal(normaliserStatutRH('Rejeté'), STATUT_RH.REJETEE);
  assert.equal(normaliserStatutRH('En attente'), STATUT_RH.EN_ATTENTE);
  assert.equal(normaliserStatutRH('en-attente'), STATUT_RH.EN_ATTENTE);
  assert.equal(normaliserStatutRH('pending'), STATUT_RH.EN_ATTENTE);
});

/* ── Securite : un doute ne doit jamais valoir approbation ── */

test('une valeur absente ou inconnue tombe en attente, jamais en approuvee', () => {
  for (const valeur of [undefined, null, '', 'n_importe_quoi', 0, 42, {}, []]) {
    const s = normaliserStatutRH(valeur);
    assert.equal(s, STATUT_RH.EN_ATTENTE, `${JSON.stringify(valeur)} ne doit pas approuver`);
    assert.notEqual(s, STATUT_RH.APPROUVEE);
    assert.notEqual(s, STATUT_RH.PAYEE);
  }
  assert.equal(estEngageante({ statut: 'chelou' }), false);
  assert.equal(estEngageante({}), false);
  assert.equal(estEngageante(undefined), false);
});

test('estStatutRHConnu distingue une valeur reconnue d un repli', () => {
  assert.equal(estStatutRHConnu('approuve'), true);
  assert.equal(estStatutRHConnu('approuvee'), true);
  assert.equal(estStatutRHConnu('brouillon'), false);
  assert.equal(estStatutRHConnu(undefined), false);
});

/* ── Predicats exclusifs ── */

test('les predicats sont mutuellement exclusifs', () => {
  const cas = ['en_attente', 'approuve', 'approuvee', 'rejete', 'rejetee', 'payee', 'inconnu'];
  for (const statut of cas) {
    const d = { statut };
    const vrais = [estEnAttente(d), estApprouvee(d), estRejetee(d), estPayee(d)].filter(Boolean);
    assert.equal(vrais.length, 1, `${statut} doit correspondre a exactement un predicat`);
  }
});

test('estEngageante = approuvee OU payee, et rien d autre', () => {
  assert.equal(estEngageante({ statut: 'approuve' }), true);
  assert.equal(estEngageante({ statut: 'approuvee' }), true);
  assert.equal(estEngageante({ statut: 'payee' }), true);
  assert.equal(estEngageante({ statut: 'en_attente' }), false);
  assert.equal(estEngageante({ statut: 'rejete' }), false);
  assert.equal(estEngageante({ statut: 'rejetee' }), false);
});

/* ── Libelles ── */

test('chaque statut canonique a un libelle francais', () => {
  for (const canonique of Object.values(STATUT_RH)) {
    assert.ok(LIBELLES_STATUT_RH[canonique], `libelle manquant pour ${canonique}`);
  }
  assert.equal(libelleStatutDemande({ statut: 'approuve' }), 'Approuvée');
  assert.equal(libelleStatutDemande({ statut: 'payee' }), 'Payée');
  assert.equal(libelleStatutDemande({}), 'En attente');
});

test('statutDemande lit le champ statut de l objet', () => {
  assert.equal(statutDemande({ statut: 'approuve' }), STATUT_RH.APPROUVEE);
  assert.equal(statutDemande(null), STATUT_RH.EN_ATTENTE);
});

/* ── Garde-fou : on n ECRIT que du canonique ── */

test('les valeurs ecrites par les deux ecrans sont canoniques', () => {
  // Ce que handleDemandeAction (performance-rh) et handleDecision (demandes-rh)
  // passent desormais a db.demandes_rh.update().
  const ecrites = [STATUT_RH.APPROUVEE, STATUT_RH.REJETEE, STATUT_RH.PAYEE, STATUT_RH.EN_ATTENTE];
  for (const v of ecrites) {
    assert.equal(normaliserStatutRH(v), v, `${v} doit etre une valeur canonique`);
  }
  // Et surtout : les anciennes valeurs ne doivent plus etre ecrites.
  assert.notEqual(STATUT_RH.APPROUVEE, 'approuve');
  assert.notEqual(STATUT_RH.REJETEE, 'rejete');
});
