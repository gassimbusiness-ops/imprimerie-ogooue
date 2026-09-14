/**
 * Tests — rattachement / creation de la fiche client au moment de la facture.
 *
 * Le point le plus important de ce fichier :
 *   « La creation ne doit pas faire perdre la facture. »
 * Si l'annuaire est injoignable ou si la creation echoue, assurerClientFacture doit
 * rendre la main proprement (clientId vide) et surtout ne jamais jeter, pour que
 * l'appelant enregistre la facture avec le nom en clair.
 *
 * Lancer :  node --test tests/client-annuaire.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { assurerClientFacture } from '../src/features/devis-factures/client-annuaire.js';
import { RESOLUTION } from '../src/features/devis-factures/client-resolution.js';

const ANNUAIRE = [
  { id: 'c1', nom: 'Société Moanda' },
  { id: 'c2', nom: 'Moanda' },
  { id: 'c3', nom: 'Moanda Services' },
];

/** Fabrique un jeu d'entrees-sorties factice + le journal des appels. */
function fausseIO({ annuaire = ANNUAIRE, creerClient, listerClients } = {}) {
  const journal = { crees: [], notifications: [] };
  return {
    journal,
    io: {
      clientsConnus: annuaire,
      listerClients: listerClients || (async () => annuaire),
      creerClient: creerClient || (async (data) => {
        journal.crees.push(data);
        return { ...data, id: `nouveau-${journal.crees.length}` };
      }),
      notifier: (niveau, message) => journal.notifications.push({ niveau, message }),
    },
  };
}

test('Nom inconnu -> fiche creee, avec trace d origine', async () => {
  const { io, journal } = fausseIO();
  const r = await assurerClientFacture(io, {
    nom: 'Ets Ndjole', adresse: 'Franceville', numero: 'FAC-0042', dateISO: '2026-09-14',
  });

  assert.equal(r.statut, RESOLUTION.A_CREER);
  assert.equal(r.cree, true);
  assert.equal(r.echec, false);
  assert.equal(r.clientId, 'nouveau-1');
  assert.equal(journal.crees.length, 1);
  assert.equal(journal.crees[0].nom, 'Ets Ndjole');
  assert.equal(journal.crees[0].facture_origine, 'FAC-0042');
  assert.equal(journal.crees[0].date_creation, '2026-09-14');
  assert.ok(journal.crees[0].notes.includes('FAC-0042'));
  assert.equal(journal.notifications[0].niveau, 'succes');
});

test('Nom deja connu ecrit autrement -> rattachement, AUCUNE creation, et on le dit', async () => {
  const { io, journal } = fausseIO();
  const r = await assurerClientFacture(io, { nom: 'SOCIETE  moanda', numero: 'FAC-0043' });

  assert.equal(r.statut, RESOLUTION.EXISTANT);
  assert.equal(r.clientId, 'c1');
  assert.equal(r.cree, false);
  assert.equal(journal.crees.length, 0, 'aucun doublon ne doit etre cree');
  assert.equal(journal.notifications.length, 1, 'le rattachement ne doit pas etre silencieux');
  assert.equal(journal.notifications[0].niveau, 'info');
  assert.ok(journal.notifications[0].message.includes('Société Moanda'));
});

test('Fiche choisie explicitement -> rattachement silencieux (l utilisateur sait deja)', async () => {
  const { io, journal } = fausseIO();
  const r = await assurerClientFacture(io, { nom: 'Société Moanda', clientId: 'c1' });
  assert.equal(r.clientId, 'c1');
  assert.equal(journal.crees.length, 0);
  assert.equal(journal.notifications.length, 0);
});

test('LA FACTURE N EST PAS PERDUE : creation en echec -> pas d exception, clientId vide', async () => {
  const { io, journal } = fausseIO({
    creerClient: async () => { throw new Error('Supabase indisponible'); },
  });

  const r = await assurerClientFacture(io, { nom: 'Ets Ndjole', numero: 'FAC-0044' });

  assert.equal(r.echec, true);
  assert.equal(r.cree, false);
  assert.equal(r.clientId, '', 'la facture partira sans client_id');
  assert.equal(r.nom, 'Ets Ndjole', 'mais le nom en clair est conserve');
  assert.equal(journal.notifications[0].niveau, 'erreur');
  assert.ok(journal.notifications[0].message.includes('Supabase indisponible'));
  assert.ok(journal.notifications[0].message.includes('nom en clair'));
});

test('Creation qui renvoie une fiche sans id -> traitee comme un echec, pas de faux rattachement', async () => {
  const { io } = fausseIO({ creerClient: async () => ({}) });
  const r = await assurerClientFacture(io, { nom: 'Ets Ndjole' });
  assert.equal(r.echec, true);
  assert.equal(r.clientId, '');
});

test('Annuaire injoignable -> on retombe sur l etat local, sans exception', async () => {
  const { io, journal } = fausseIO({
    listerClients: async () => { throw new Error('reseau coupe'); },
  });

  // le nom existe dans clientsConnus : on doit quand meme rattacher, pas creer un doublon
  const r = await assurerClientFacture(io, { nom: 'moanda services' });
  assert.equal(r.clientId, 'c3');
  assert.equal(journal.crees.length, 0);
});

test('Annuaire injoignable ET nom inconnu -> creation quand meme tentee', async () => {
  const { io, journal } = fausseIO({
    listerClients: async () => { throw new Error('reseau coupe'); },
  });
  const r = await assurerClientFacture(io, { nom: 'Ets Ndjole' });
  assert.equal(r.cree, true);
  assert.equal(journal.crees.length, 1);
});

test('Fiche creee entre-temps par un autre poste -> rattachement, pas de doublon', async () => {
  // l'ecran connait 3 clients, la base en a 4 : c'est la base qui gagne
  const aJour = [...ANNUAIRE, { id: 'c9', nom: 'ETS NDJOLE' }];
  const { io, journal } = fausseIO({ annuaire: ANNUAIRE, listerClients: async () => aJour });

  const r = await assurerClientFacture(io, { nom: 'Ets Ndjole' });
  assert.equal(r.clientId, 'c9');
  assert.equal(journal.crees.length, 0, 'la relecture doit empecher le doublon');
});

test('Nom vide -> aucune fiche creee, aucun appel a la base', async () => {
  for (const nom of ['', '   ', null, undefined]) {
    const { io, journal } = fausseIO();
    const r = await assurerClientFacture(io, { nom });
    assert.equal(r.statut, RESOLUTION.INVALIDE);
    assert.equal(r.clientId, '');
    assert.equal(journal.crees.length, 0, `nom=${JSON.stringify(nom)}`);
  }
});

test('PREFIXE : facturer "Moanda" ne cree rien et ne vise pas "Moanda Services"', async () => {
  const { io, journal } = fausseIO();
  const r = await assurerClientFacture(io, { nom: 'Moanda' });
  assert.equal(r.clientId, 'c2');
  assert.equal(journal.crees.length, 0);
});

test('Conversion devis -> facture : le devis a client libre cree la fiche a ce moment-la', async () => {
  const { io, journal } = fausseIO();
  // un devis enregistre sans client_id (nom libre), converti en facture
  const r = await assurerClientFacture(io, {
    nom: 'Boulangerie du Rond-Point', clientId: '', numero: 'FAC-0050', dateISO: '2026-09-14',
  });
  assert.equal(r.cree, true);
  assert.equal(journal.crees[0].facture_origine, 'FAC-0050');
});
