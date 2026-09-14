/**
 * Tests — resolution du client sur un devis / une facture.
 *
 * Regle metier testee :
 *   DEVIS   -> nom libre accepte, AUCUNE fiche client creee.
 *   FACTURE -> nom inconnu = fiche creee ; nom deja connu (meme ecrit autrement) = rattachement.
 *
 * Il n'y a aucune contrainte d'unicite dans Supabase (table app_data, JSON) :
 * l'anti-doublon est entierement ici. Ces tests sont donc le filet de securite
 * de l'annuaire client.
 *
 * Lancer :  node --test tests/
 * Ou :      node --test tests/client-resolution.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RESOLUTION,
  normaliserNom,
  nettoyerNom,
  estNomValide,
  trouverClientParNom,
  trouverClientsParNom,
  suggererClients,
  resoudreClient,
  construireNouveauClient,
} from '../src/features/devis-factures/client-resolution.js';

/** Annuaire de reference utilise par la plupart des tests. */
const ANNUAIRE = [
  { id: 'c1', nom: 'Société Moanda', adresse: 'Moanda centre' },
  { id: 'c2', nom: 'Moanda', adresse: '' },
  { id: 'c3', nom: 'Moanda Services', adresse: '' },
  { id: 'c4', nom: 'Mairie de Franceville', adresse: '' },
];

// ─────────────────────────────────────────────────────────────
// normaliserNom
// ─────────────────────────────────────────────────────────────

test('normaliserNom : casse, accents, espaces multiples et espaces de bord', () => {
  assert.equal(normaliserNom('SOCIETE MOANDA'), 'societe moanda');
  assert.equal(normaliserNom('Société Moanda'), 'societe moanda');
  assert.equal(normaliserNom('societe  moanda'), 'societe moanda');
  assert.equal(normaliserNom('  Société   MOANDA  '), 'societe moanda');
  assert.equal(normaliserNom('SOCIÉTÉ\tMOANDA'), 'societe moanda');
  // espace insecable (Alt+Espace sur Mac) — piege classique d'un copier-coller Word
  assert.equal(normaliserNom('Société Moanda'), 'societe moanda');
});

test('normaliserNom : les trois ecritures du meme client sont identiques', () => {
  const a = normaliserNom('SOCIETE MOANDA');
  const b = normaliserNom('Société Moanda');
  const c = normaliserNom('societe  moanda');
  assert.equal(a, b);
  assert.equal(b, c);
});

test('normaliserNom : entrees non-texte ne font pas planter', () => {
  assert.equal(normaliserNom(null), '');
  assert.equal(normaliserNom(undefined), '');
  assert.equal(normaliserNom(42), '');
  assert.equal(normaliserNom({}), '');
});

test('nettoyerNom : garde la casse et les accents, normalise les espaces', () => {
  assert.equal(nettoyerNom('  Société   Moanda '), 'Société Moanda');
  assert.equal(nettoyerNom('SARL  ÉLAN'), 'SARL ÉLAN');
  assert.equal(nettoyerNom(null), '');
});

test('estNomValide : refuse le vide et les espaces seuls', () => {
  assert.equal(estNomValide(''), false);
  assert.equal(estNomValide('   '), false);
  assert.equal(estNomValide('\t\n  '), false);
  assert.equal(estNomValide(' '), false);
  assert.equal(estNomValide(null), false);
  assert.equal(estNomValide('A'), true);
});

// ─────────────────────────────────────────────────────────────
// Recherche de correspondance
// ─────────────────────────────────────────────────────────────

test('trouverClientParNom : nom identique', () => {
  assert.equal(trouverClientParNom(ANNUAIRE, 'Société Moanda').id, 'c1');
});

test('trouverClientParNom : casse differente', () => {
  assert.equal(trouverClientParNom(ANNUAIRE, 'SOCIÉTÉ MOANDA').id, 'c1');
  assert.equal(trouverClientParNom(ANNUAIRE, 'société moanda').id, 'c1');
});

test('trouverClientParNom : accents differents', () => {
  assert.equal(trouverClientParNom(ANNUAIRE, 'SOCIETE MOANDA').id, 'c1');
  assert.equal(trouverClientParNom(ANNUAIRE, 'Societe Moanda').id, 'c1');
});

test('trouverClientParNom : espaces multiples et espaces de bord', () => {
  assert.equal(trouverClientParNom(ANNUAIRE, '  societe  moanda  ').id, 'c1');
});

test('trouverClientParNom : nom nouveau -> aucune correspondance', () => {
  assert.equal(trouverClientParNom(ANNUAIRE, 'Ets Ndjole'), null);
});

test('trouverClientParNom : nom vide -> aucune correspondance (jamais de rattachement fantome)', () => {
  assert.equal(trouverClientParNom(ANNUAIRE, ''), null);
  assert.equal(trouverClientParNom(ANNUAIRE, '   '), null);
  // meme si l'annuaire contient une fiche au nom vide, on ne s'y rattache pas
  assert.equal(trouverClientParNom([{ id: 'vide', nom: '  ' }], '   '), null);
});

test('PREFIXE : "Moanda" et "Moanda Services" restent deux clients distincts', () => {
  const court = trouverClientParNom(ANNUAIRE, 'Moanda');
  const long = trouverClientParNom(ANNUAIRE, 'Moanda Services');
  assert.equal(court.id, 'c2');
  assert.equal(long.id, 'c3');
  assert.notEqual(court.id, long.id);
  // un prefixe partiel ne doit rattacher a rien
  assert.equal(trouverClientParNom(ANNUAIRE, 'Moanda Serv'), null);
  assert.equal(trouverClientParNom(ANNUAIRE, 'Moand'), null);
});

test('trouverClientsParNom : detecte les homonymes deja presents dans l annuaire', () => {
  const pollue = [
    { id: 'a', nom: 'Societe Moanda' },
    { id: 'b', nom: 'SOCIÉTÉ  MOANDA' },
  ];
  assert.equal(trouverClientsParNom(pollue, 'société moanda').length, 2);
  // on rattache a la premiere (la plus ancienne : db.list() ordonne par created_at)
  assert.equal(trouverClientParNom(pollue, 'société moanda').id, 'a');
});

test('trouverClientsParNom : annuaire absent ou entrees nulles', () => {
  assert.deepEqual(trouverClientsParNom(undefined, 'x'), []);
  assert.deepEqual(trouverClientsParNom(null, 'x'), []);
  assert.deepEqual(trouverClientsParNom([null, undefined, { id: 'z' }], 'x'), []);
});

// ─────────────────────────────────────────────────────────────
// Suggestions du champ combine
// ─────────────────────────────────────────────────────────────

test('suggererClients : insensible a la casse et aux accents, prefixes en tete', () => {
  const res = suggererClients(ANNUAIRE, 'moanda');
  const ids = res.map((c) => c.id);
  // c2 "Moanda" et c3 "Moanda Services" commencent par la saisie -> avant c1
  assert.deepEqual(ids.slice(0, 2).sort(), ['c2', 'c3']);
  assert.ok(ids.includes('c1'), 'Société Moanda doit aussi apparaitre (contient la saisie)');
  assert.equal(ids.includes('c4'), false);
});

test('suggererClients : la saisie accentuee retrouve la fiche non accentuee et l inverse', () => {
  assert.ok(suggererClients([{ id: 'x', nom: 'Societe Elan' }], 'élan').length === 1);
  assert.ok(suggererClients([{ id: 'y', nom: 'Société Élan' }], 'elan').length === 1);
});

test('suggererClients : saisie vide -> debut de l annuaire, limite respectee', () => {
  assert.equal(suggererClients(ANNUAIRE, '').length, 4);
  assert.equal(suggererClients(ANNUAIRE, '', 2).length, 2);
});

// ─────────────────────────────────────────────────────────────
// Decision : creer / rattacher / libre / refuser
// ─────────────────────────────────────────────────────────────

test('DEVIS + nom nouveau -> LIBRE, aucune fiche creee', () => {
  const r = resoudreClient({ type: 'devis', clients: ANNUAIRE, nomSaisi: 'Ets Ndjole' });
  assert.equal(r.statut, RESOLUTION.LIBRE);
  assert.equal(r.clientId, '');
  assert.equal(r.nom, 'Ets Ndjole');
  assert.notEqual(r.statut, RESOLUTION.A_CREER);
});

test('FACTURE + nom nouveau -> A_CREER', () => {
  const r = resoudreClient({ type: 'facture', clients: ANNUAIRE, nomSaisi: 'Ets Ndjole' });
  assert.equal(r.statut, RESOLUTION.A_CREER);
  assert.equal(r.clientId, '');
  assert.equal(r.nom, 'Ets Ndjole');
});

test('FACTURE + nom deja connu ecrit autrement -> rattachement, PAS de creation', () => {
  for (const saisie of ['SOCIETE MOANDA', 'Société Moanda', 'societe  moanda', '  SOCIÉTÉ   moanda ']) {
    const r = resoudreClient({ type: 'facture', clients: ANNUAIRE, nomSaisi: saisie });
    assert.equal(r.statut, RESOLUTION.EXISTANT, `saisie: ${JSON.stringify(saisie)}`);
    assert.equal(r.clientId, 'c1');
    assert.equal(r.rattachement, 'par_nom');
  }
});

test('Le rattachement implicite porte un message : jamais en silence', () => {
  const r = resoudreClient({ type: 'facture', clients: ANNUAIRE, nomSaisi: 'SOCIETE MOANDA' });
  assert.ok(r.message.includes('Société Moanda'), 'le message doit nommer la fiche visee');
  assert.ok(r.message.length > 0);
});

test('Homonymes dans l annuaire -> ambigu = true et message d alerte', () => {
  const pollue = [
    { id: 'a', nom: 'Societe Moanda' },
    { id: 'b', nom: 'Société  Moanda' },
  ];
  const r = resoudreClient({ type: 'facture', clients: pollue, nomSaisi: 'societe moanda' });
  assert.equal(r.statut, RESOLUTION.EXISTANT);
  assert.equal(r.clientId, 'a');
  assert.equal(r.ambigu, true);
  assert.ok(r.message.includes('2 fiches'));
});

test('Nom vide ou blanc -> INVALIDE, sur devis comme sur facture', () => {
  for (const type of ['devis', 'facture']) {
    for (const saisie of ['', '   ', '\t', ' ', null, undefined]) {
      const r = resoudreClient({ type, clients: ANNUAIRE, nomSaisi: saisie });
      assert.equal(r.statut, RESOLUTION.INVALIDE, `${type} / ${JSON.stringify(saisie)}`);
      assert.equal(r.clientId, '');
      assert.ok(r.message.length > 0);
    }
  }
});

test('Selection explicite d une fiche -> rattachement explicite', () => {
  const r = resoudreClient({
    type: 'facture', clients: ANNUAIRE, nomSaisi: 'Société Moanda', clientId: 'c1',
  });
  assert.equal(r.statut, RESOLUTION.EXISTANT);
  assert.equal(r.clientId, 'c1');
  assert.equal(r.rattachement, 'explicite');
});

test('Id perime (fiche supprimee entre-temps) -> on retombe sur le nom', () => {
  const r = resoudreClient({
    type: 'facture', clients: ANNUAIRE, nomSaisi: 'Ets Ndjole', clientId: 'fiche-disparue',
  });
  assert.equal(r.statut, RESOLUTION.A_CREER);
  assert.equal(r.clientId, '');
});

test('Nom modifie apres selection -> l id choisi est ignore, le texte fait foi', () => {
  // l'utilisateur choisit "Moanda" (c2) puis continue de taper " Services"
  const r = resoudreClient({
    type: 'facture', clients: ANNUAIRE, nomSaisi: 'Moanda Services', clientId: 'c2',
  });
  assert.equal(r.clientId, 'c3', 'doit suivre le texte saisi, pas l ancienne selection');
});

test('PREFIXE sur la decision : facturer "Moanda" ne doit pas viser "Moanda Services"', () => {
  const court = resoudreClient({ type: 'facture', clients: ANNUAIRE, nomSaisi: 'Moanda' });
  const long = resoudreClient({ type: 'facture', clients: ANNUAIRE, nomSaisi: 'Moanda Services' });
  assert.equal(court.clientId, 'c2');
  assert.equal(long.clientId, 'c3');

  // et un prefixe qui ne correspond a personne cree bien une nouvelle fiche
  const partiel = resoudreClient({ type: 'facture', clients: ANNUAIRE, nomSaisi: 'Moanda Serv' });
  assert.equal(partiel.statut, RESOLUTION.A_CREER);
});

test('Annuaire vide -> facture cree, devis reste libre', () => {
  assert.equal(resoudreClient({ type: 'facture', clients: [], nomSaisi: 'X' }).statut, RESOLUTION.A_CREER);
  assert.equal(resoudreClient({ type: 'devis', clients: [], nomSaisi: 'X' }).statut, RESOLUTION.LIBRE);
  assert.equal(resoudreClient({ type: 'facture', clients: undefined, nomSaisi: 'X' }).statut, RESOLUTION.A_CREER);
});

// ─────────────────────────────────────────────────────────────
// Fiche a creer
// ─────────────────────────────────────────────────────────────

test('construireNouveauClient : nom propre et trace d origine', () => {
  const c = construireNouveauClient({
    nom: '  Ets   Ndjole ', adresse: ' Franceville ', numeroDocument: 'FAC-0042', date: '2026-09-14',
  });
  assert.equal(c.nom, 'Ets Ndjole');
  assert.equal(c.adresse, 'Franceville');
  assert.equal(c.facture_origine, 'FAC-0042');
  assert.equal(c.date_creation, '2026-09-14');
  assert.equal(c.cree_automatiquement, true);
  assert.ok(c.notes.includes('FAC-0042'));
  assert.ok(c.notes.includes('2026-09-14'));
});

test('construireNouveauClient : sans numero ni date, la note reste lisible', () => {
  const c = construireNouveauClient({ nom: 'Ets Ndjole' });
  assert.equal(c.nom, 'Ets Ndjole');
  assert.ok(c.notes.includes('facture'));
  assert.equal(c.adresse, '');
});

test('construireNouveauClient : ne fabrique jamais de date lui-meme (module pur)', () => {
  // la date vient de l'appelant (src/lib/dates.js) : aucune date implicite ne doit apparaitre
  const c = construireNouveauClient({ nom: 'Ets Ndjole' });
  assert.equal(c.date_creation, '');
  assert.equal(/\d{4}-\d{2}-\d{2}/.test(c.notes), false);
});
