/**
 * Regression : un client dont la commande est annulee doit etre prevenu, et le
 * message doit etre VRAI.
 *
 * ── Le constat ────────────────────────────────────────────────────────────
 *
 * `src/features/commandes/page.jsx` portait une constante
 * `NOTIF_CLIENT_MESSAGES` contenant un texte pour `annulee` — DECLAREE ET
 * JAMAIS LUE. Seuls quatre statuts declenchaient une notification
 * (validee_attente_paiement, en_production, prete, livree) et
 * `notifyCommandeAnnulee` n'existait pas dans `src/services/notifications.js`.
 *
 * Effet concret : une commande annulee a l'atelier disparaissait de l'ecran du
 * client sans un mot. Il avait peut-etre paye, il avait peut-etre attendu.
 *
 * ── Ce que ces tests tiennent ─────────────────────────────────────────────
 *
 * 1. une annulation notifie ;
 * 2. le message est COHERENT avec ce qui a ete reellement contre-passe — pas
 *    de promesse de remboursement quand rien n'a ete repris ;
 * 3. une notification en echec n'empeche pas l'annulation, et se voit ;
 * 4. pas de double notification sur un double-clic.
 *
 * Les points 1, 3 et 4 tiennent a l'enchainement dans l'ecran : ils sont
 * verifies comme CONTRAT DE SOURCE, la meme methode que
 * tests/livraison-commande.test.mjs, plus une simulation du verrou reel.
 *
 * Lancer :  node --test tests/notification-annulation.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  contrePasserCommande,
  messageAnnulationClient,
  CONTACT_IMPRIMERIE,
} from '../src/services/contre-passation-commande.js';
import { creerVerrouExecution } from '../src/services/execution-unique.js';

const page = readFileSync(new URL('../src/features/commandes/page.jsx', import.meta.url), 'utf8');
const service = readFileSync(new URL('../src/services/notifications.js', import.meta.url), 'utf8');

/* ══════════════════════════════════════════════════════════════════════════
   1. LE TEXTE — il ne promet que ce qui a eu lieu
   ══════════════════════════════════════════════════════════════════════════ */

const CMD = { id: 'CMD1', numero: 'CMD-1', client_id: 'CLI1', client_nom: 'Mairie', montant_total: 45000 };

test('commande payee : le message annonce la somme due et ou la recuperer', () => {
  const msg = messageAnnulationClient({
    commande: CMD,
    effets: ['trésorerie', 'stock', 'points de fidélité', 'facture'],
    montantRepris: 45000,
  });
  assert.match(msg, /CMD-1/, 'le numéro de commande doit figurer dans le message');
  assert.match(msg, /45 000 F/, 'le client doit lire le montant qui lui est dû');
  assert.ok(msg.includes(CONTACT_IMPRIMERIE.telephone), 'le message doit dire QUI appeler');
  assert.ok(msg.includes(CONTACT_IMPRIMERIE.adresse), 'le message doit dire OÙ aller');
  assert.match(msg, /facture/i, 'la facture annulée doit être mentionnée');
  assert.match(msg, /points de fidélité/i, 'la reprise des points doit être mentionnée');
});

test('commande jamais payee : AUCUNE promesse de remboursement', () => {
  const msg = messageAnnulationClient({ commande: CMD, effets: [], montantRepris: 0 });
  assert.ok(
    !/vous est dû|rembours(é|ement) (de|a été)/.test(msg),
    'promettre un remboursement non contre-passé ferait attendre un client pour rien',
  );
  assert.match(msg, /[Aa]ucun paiement n'est enregistré/, 'le message doit dire pourquoi');
  assert.ok(msg.includes(CONTACT_IMPRIMERIE.telephone), 'il doit rester un recours si le client a payé en espèces');
  assert.ok(!/facture/i.test(msg), 'aucune facture annulée : ne rien inventer');
});

test('contre-passation en echec : on ne promet rien du tout, on fait appeler', () => {
  const msg = messageAnnulationClient({ commande: CMD, contrePassationEchouee: true });
  assert.ok(!/45 000|vous est dû/.test(msg), 'aucun montant ne doit être annoncé sur un état inconnu');
  assert.ok(!/[Aa]ucun paiement n'est enregistré/.test(msg), 'on ne peut pas affirmer cela non plus');
  assert.ok(msg.includes(CONTACT_IMPRIMERIE.telephone));
});

test('le message tient sur une seule ligne — le panneau client n affiche pas les retours', () => {
  for (const arg of [
    { commande: CMD, effets: ['trésorerie', 'facture'], montantRepris: 45000 },
    { commande: CMD, effets: [] },
    { commande: CMD, contrePassationEchouee: true },
    {},
  ]) {
    const msg = messageAnnulationClient(arg);
    assert.ok(!msg.includes('\n'), 'un \\n serait invisible dans client-layout.jsx');
    assert.ok(msg.length > 0);
  }
});

test('une commande sans numero ne produit pas de message bancal', () => {
  const msg = messageAnnulationClient({ commande: { id: 'x' }, effets: [] });
  assert.ok(!msg.includes('Commande  '), 'double espace : le numéro manquant a laissé un trou');
  assert.match(msg, /^❌ Commande annulée\./);
});

/* ══════════════════════════════════════════════════════════════════════════
   2. LE MESSAGE COLLE A LA CONTRE-PASSATION REELLE
   ══════════════════════════════════════════════════════════════════════════ */

function creerBase(contenu = {}) {
  const tables = {
    mouvements_financiers: [], comptes_bancaires: [], mouvements_stock: [],
    produits: [], fidelite_clients: [], factures: [], rapports: [],
    ...contenu,
  };
  const collection = (nom) => ({
    async list() { return tables[nom].map((x) => ({ ...x })); },
    async create(data) {
      const item = { id: `${nom}-${tables[nom].length + 1}`, ...data };
      tables[nom].push(item);
      return item;
    },
    async update(id, patch) {
      const i = tables[nom].findIndex((x) => x.id === id);
      if (i === -1) throw new Error(`${nom}/${id} introuvable`);
      tables[nom][i] = { ...tables[nom][i], ...patch };
      return tables[nom][i];
    },
  });
  const deps = {};
  for (const nom of Object.keys(tables)) deps[nom] = collection(nom);
  return { deps, tables };
}

test('le montant annonce est celui REELLEMENT sorti des comptes, pas celui de la commande', async () => {
  // La commande porte 45 000 F, mais seuls 30 000 F avaient ete encaisses.
  // Annoncer 45 000 F serait une promesse fausse de 15 000 F.
  const { deps } = creerBase({
    comptes_bancaires: [{ id: 'caisse', nom: 'Caisse', solde: 100000 }],
    mouvements_financiers: [{
      id: 'm1', type: 'entree', montant: 30000, compte_id: 'caisse', reference: 'commande:CMD1',
    }],
  });
  const { effets, montantRepris } = await contrePasserCommande(CMD, deps);
  assert.equal(montantRepris, 30000);
  const msg = messageAnnulationClient({ commande: CMD, effets, montantRepris });
  assert.match(msg, /30 000 F/);
  assert.ok(!msg.includes('45 000'), 'le montant de la commande ne doit jamais être annoncé tel quel');
});

test('commande jamais livree : la contre-passation ne trouve rien, le message ne promet rien', async () => {
  const { deps } = creerBase();
  const { effets, montantRepris } = await contrePasserCommande(CMD, deps);
  assert.deepEqual(effets, []);
  assert.equal(montantRepris, 0);
  const msg = messageAnnulationClient({ commande: CMD, effets, montantRepris });
  assert.match(msg, /[Aa]ucun paiement n'est enregistré/);
});

test('seconde annulation : rien n est repris une seconde fois, donc rien n est promis', async () => {
  const { deps } = creerBase({
    comptes_bancaires: [{ id: 'caisse', nom: 'Caisse', solde: 100000 }],
    mouvements_financiers: [{
      id: 'm1', type: 'entree', montant: 30000, compte_id: 'caisse', reference: 'commande:CMD1',
    }],
  });
  await contrePasserCommande(CMD, deps);
  const seconde = await contrePasserCommande(CMD, deps);
  assert.equal(seconde.montantRepris, 0, 'un second remboursement serait annoncé au client');
  const msg = messageAnnulationClient({ commande: CMD, ...seconde });
  assert.ok(!/vous est dû/.test(msg));
});

/* ══════════════════════════════════════════════════════════════════════════
   3. LE SERVICE DE NOTIFICATION
   ══════════════════════════════════════════════════════════════════════════ */

test('notifyCommandeAnnulee existe et passe par createNotification', () => {
  assert.ok(
    service.includes('export function notifyCommandeAnnulee('),
    'la fonction manquante du constat : sans elle, aucune annulation ne prévient personne',
  );
  const i = service.indexOf('export function notifyCommandeAnnulee(');
  const corps = service.slice(i, i + 400);
  assert.ok(
    corps.includes("createNotification(\n    'commande_annulee'"),
    'elle doit emprunter le mécanisme existant, pas un chemin parallèle',
  );
  assert.ok(
    !/'❌ Votre commande a été annulée'|message = '/.test(corps),
    'le texte ne doit PAS être figé ici : il dépend de ce qui a été contre-passé',
  );
});

test('le type commande_annulee est declare, avec un lien vers l espace CLIENT', () => {
  assert.ok(service.includes('commande_annulee: {'), 'sans type déclaré, le lien retombe sur « / »');
  const i = service.indexOf('commande_annulee: {');
  const bloc = service.slice(i, service.indexOf('}', i));
  assert.ok(
    bloc.includes("'/client/commandes'"),
    '/commandes est une route du personnel : un client cliquant dessus est renvoyé ailleurs',
  );
});

test('createNotification rend un verdict au lieu d avaler l echec en silence', () => {
  assert.ok(service.includes('return { envoyee: true, erreur: null };'));
  assert.ok(service.includes('return { envoyee: false, erreur:'));
  assert.ok(
    !/catch \(err\) \{\s*console\.error\('Erreur création notification:', err\);\s*\}/.test(service),
    'un échec muet est exactement ce qui a permis à ce bug de vivre',
  );
});

test('createNotification ne leve jamais — prevenir ne doit pas casser l operation metier', () => {
  const i = service.indexOf('export async function createNotification(');
  const corps = service.slice(i, service.indexOf('\n}', i));
  assert.ok(corps.includes('try {') && corps.includes('} catch (err) {'));
  assert.ok(!corps.includes('throw'), 'une exception ici empêcherait une annulation de commande');
});

/* ══════════════════════════════════════════════════════════════════════════
   4. L ENCHAINEMENT DANS L ECRAN — contrat de source
   ══════════════════════════════════════════════════════════════════════════ */

test('une annulation notifie le client', () => {
  assert.ok(
    page.includes('notifyCommandeAnnulee('),
    "l'annulation ne prévient toujours personne",
  );
  assert.ok(page.includes('messageAnnulationClient('), 'le texte doit être construit, pas figé');
});

test('la notification part APRES la contre-passation, jamais avant', () => {
  const iContre = page.indexOf('await contrePasserCommande(enBase, db)');
  const iNotif = page.indexOf('await notifyCommandeAnnulee(');
  assert.ok(iContre > -1 && iNotif > -1);
  assert.ok(
    iNotif > iContre,
    'notifier avant la contre-passation, c\'est promettre un remboursement qui n\'a pas encore eu lieu',
  );
});

test('un echec de contre-passation ne fait promettre aucun remboursement', () => {
  assert.ok(page.includes('contrePassationEchouee = true;'), 'le cas d’échec doit être mémorisé');
  assert.ok(
    page.includes('contrePassationEchouee,'),
    'et transmis au constructeur du message',
  );
});

test('un echec de notification n empeche pas l annulation, et se voit', () => {
  const iNotif = page.indexOf('if (annulationNouvelle && cmd.client_id)');
  assert.ok(iNotif > -1, 'le bloc de notification d’annulation est introuvable');
  const bloc = page.slice(iNotif, iNotif + 1600);
  assert.ok(bloc.includes('try {') && bloc.includes('} catch (err) {'),
    'une exception ici casserait une opération métier déjà faite');
  assert.ok(bloc.includes('if (!resultat?.envoyee)'), 'l’échec silencieux doit être rattrapé');
  assert.ok((bloc.match(/toast\.error\(/g) || []).length >= 2,
    'les deux chemins d’échec doivent être visibles à l’écran');
  assert.ok(/Appelez-le/.test(bloc), 'le gérant doit savoir quoi faire : appeler le client');
  // La notification est le DERNIER acte : rien de metier ne se joue apres elle.
  const iUpdateStatut = page.indexOf("await db.commandes.update(cmd.id, { statut: newStatut");
  assert.ok(iUpdateStatut < iNotif, "le statut doit être écrit avant qu'on tente de prévenir");
});

test('pas de double notification : le verrou ET la garde de statut', async () => {
  // (a) Le verrou reel : deux clics simultanes ne lancent qu'une execution.
  const verrou = creerVerrouExecution();
  let executions = 0;
  const operation = async () => { executions += 1; await new Promise((r) => setTimeout(r, 5)); };
  await Promise.all([
    verrou.executerUneSeuleFois('statut:CMD1', operation),
    verrou.executerUneSeuleFois('statut:CMD1', operation),
    verrou.executerUneSeuleFois('statut:CMD1', operation),
  ]);
  assert.equal(executions, 1, 'trois clics ont produit trois notifications');

  // (b) La garde de source : une commande DEJA annulee en base ne re-notifie pas.
  assert.ok(
    page.includes('const annulationNouvelle = estStatutAnnulee(newStatut) && !estStatutAnnulee(enBase?.statut)'),
    'sans cette garde, ré-annuler une commande annulée renvoie une seconde notification',
  );
  assert.ok(
    page.includes('verrouCommande.executerUneSeuleFois('),
    'le verrou par commande doit rester en place',
  );
});

test('la constante morte NOTIF_CLIENT_MESSAGES a disparu', () => {
  assert.ok(
    !page.includes('const NOTIF_CLIENT_MESSAGES'),
    'une seconde source de textes, jamais lue, est exactement ce qui a produit ce bug',
  );
});

test('les quatre notifications qui marchaient marchent toujours', () => {
  for (const appel of [
    'notifyCommandeValidee(cmd.client_id)',
    'notifyCommandeProduction(cmd.client_id)',
    'notifyCommandePrete(cmd.client_id)',
    'notifyCommandeLivree(cmd.client_id)',
  ]) {
    assert.ok(page.includes(appel), `${appel} a disparu — régression`);
  }
});
