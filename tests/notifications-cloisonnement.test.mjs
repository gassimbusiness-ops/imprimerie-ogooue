/**
 * Regression : une notification nominative ne doit etre lue que par son destinataire.
 *
 * Constate le 16/09/2026 en production. `getNotifications` rendait TRUE des qu une
 * notification visait le ROLE de l utilisateur. Or les confirmations de paiement
 * SingPay sont ecrites avec `destinataire: 'client'` ET un `destinataire_id`
 * nominatif : tout compte de role `client` voyait donc les paiements de tous les
 * autres clients de l imprimerie, avec l identifiant de leur commande.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

/** Copie fidele du predicat de src/services/notifications.js. */
function estLisiblePar(n, user) {
  if (n.destinataire === user?.id) return true;
  if (n.destinataire === user?.role) {
    if (n.destinataire_id) return n.destinataire_id === user?.id;
    return true;
  }
  if (n.destinataire === 'all_staff' && ['admin', 'manager', 'employe'].includes(user?.role)) return true;
  if (user?.role === 'admin' && n.destinataire === 'admin') return true;
  return false;
}

const clientA = { id: 'cli-A', role: 'client' };
const clientB = { id: 'cli-B', role: 'client' };
const admin = { id: 'adm-1', role: 'admin' };

const paiementDeA = { destinataire: 'client', destinataire_id: 'cli-A', message: 'Votre paiement a ete confirme.' };
const promotion = { destinataire: 'client', message: 'Promotion de la semaine.' };

test('le client A lit sa propre confirmation de paiement', () => {
  assert.equal(estLisiblePar(paiementDeA, clientA), true);
});

test('LE CLIENT B NE LIT PAS le paiement du client A', () => {
  assert.equal(estLisiblePar(paiementDeA, clientB), false,
    'fuite : un client voit la confirmation de paiement d un autre client');
});

test('une diffusion sans destinataire_id reste lue par tous les clients', () => {
  assert.equal(estLisiblePar(promotion, clientA), true);
  assert.equal(estLisiblePar(promotion, clientB), true);
});

test('l admin ne recupere pas les notifications nominatives des clients', () => {
  assert.equal(estLisiblePar(paiementDeA, admin), false);
});

test('une notification adressee directement a un identifiant reste lue', () => {
  assert.equal(estLisiblePar({ destinataire: 'cli-A' }, clientA), true);
  assert.equal(estLisiblePar({ destinataire: 'cli-A' }, clientB), false);
});

test('all_staff reste reserve au personnel', () => {
  assert.equal(estLisiblePar({ destinataire: 'all_staff' }, admin), true);
  assert.equal(estLisiblePar({ destinataire: 'all_staff' }, clientA), false);
});

test('le predicat teste est bien celui du source', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/services/notifications.js', import.meta.url), 'utf8');
  assert.ok(src.includes('if (n.destinataire_id) return n.destinataire_id === user?.id;'),
    'le cloisonnement a disparu de notifications.js');
});
