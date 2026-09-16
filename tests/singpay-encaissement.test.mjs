/**
 * Encaissement Mobile Money SingPay — rappel (webhook), sondage, et leur
 * convergence.
 *
 * CE QUE CES TESTS PROTÈGENT
 *
 *  1. Un rappel répété n'encaisse qu'une fois.
 *  2. Un rappel non authentifié est rejeté quand le secret est configuré.
 *  3. Le corps du rappel n'est jamais cru : c'est SingPay qui dit le statut.
 *  4. Sondage et rappel convergent sans jamais créditer deux fois — et sans
 *     que l'un empêche l'autre de terminer le travail (c'était le vrai bug).
 *  5. Un paiement encaissé n'est jamais annulé par un message forgé.
 *
 * Aucun réseau, aucune base : le dépôt et `fetch` sont injectés.
 *
 * Lancer :  node --test tests/singpay-encaissement.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  mapResultatVersStatut,
  transitionAutorisee,
  verifierSecretCallback,
  lireMessageRappel,
  verifierAupresDeSingPay,
  appliquerStatutPaiement,
  referenceMouvement,
  soldeNumerique,
  controlerPlafond,
  PLAFONDS_PAR_DEFAUT,
  STATUTS_FINAUX,
} from '../api/_lib/singpay-encaissement.js';

/* ═══════════════════════════════════════════════════════════════════════════
   OUTILS — un dépôt en mémoire qui se comporte comme la vraie base
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @param {object} options
 * @param {boolean} [options.indexUnique] true = migration 005 appliquée
 *        (PostgreSQL rejette le doublon), false = état actuel de la base.
 * @param {number} [options.latenceMs] délai simulé entre la lecture et
 *        l'écriture du mouvement — c'est dans cette fenêtre que la course a lieu.
 * @param {Array|null} [options.clients] l'annuaire client. Par défaut, la fiche
 *        `cli-9` que porte la commande, rattachée au compte portail `u-ecole` :
 *        c'est la forme d'une commande saisie AU COMPTOIR. `null` simule un
 *        annuaire illisible.
 */
function creerDepot({ indexUnique = true, latenceMs = 0, clients } = {}) {
  const etat = {
    paiement: {
      id: 'pay-1',
      data: {
        id: 'pay-1',
        commande_id: 'cmd-1',
        payment_reference: 'OGO-abcdef12-1780266682192',
        singpay_transaction_id: '6a1cb6bb9e8fd3521543d461',
        operateur: 'moov',
        amount: 7000,
        status: 'pending',
        nom_client: 'Ecole Saint-Exupery',
      },
    },
    commande: {
      id: 'cmd-1',
      data: { id: 'cmd-1', numero: 'CMD-0042', statut: 'paiement_initie', client_id: 'cli-9', historique_statuts: [] },
    },
    comptes: [
      { id: 'compte-finam', data: { id: 'compte-finam', nom: 'FINAM', solde: 100000 } },
      // ⚠️ `solde: ''` et non 0 : c'est la valeur REELLE en production au
      // 2026-09-16 pour « Airtel Money » et « Moov Money ».
      { id: 'compte-moov', data: { id: 'compte-moov', nom: 'Moov Money', solde: '' } },
    ],
    mouvements: [],
    notifications: [],
    lectures: 0,
    // `clients: undefined` = l'annuaire par defaut ; `null` = annuaire illisible.
    clients: clients === undefined
      ? [{ id: 'cli-9', nom: 'Ecole Saint-Exupery', user_id: 'u-ecole' }]
      : clients,
  };

  const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

  const depot = {
    etat,
    async lirePaiement() { return etat.paiement; },
    async majPaiement(id, data) { if (etat.paiement.id === id) etat.paiement.data = data; },
    async lireCommande(id) { return etat.commande.id === id ? etat.commande : null; },
    async majCommande(id, data) { if (etat.commande.id === id) etat.commande.data = data; },
    async listerComptes() { return etat.comptes; },

    /** Meme forme que le depot reel : les objets `data`, pas les lignes. */
    async listerClients() {
      if (etat.clients === null) throw new Error('annuaire illisible');
      return etat.clients.map((c) => ({ ...c }));
    },

    async insererMouvement(mouvement) {
      // (1) LIRE — comme le vrai dépôt
      etat.lectures += 1;
      const vus = etat.mouvements.map((m) => m.reference);
      await attendre(latenceMs);          // fenêtre de course
      if (vus.includes(mouvement.reference)) return { insere: false, raison: 'déjà présent' };
      // (2) ÉCRIRE — avec ou sans garde-fou de la base
      if (indexUnique && etat.mouvements.some((m) => m.reference === mouvement.reference)) {
        return { insere: false, raison: 'doublon rejeté par la base' };
      }
      etat.mouvements.push(mouvement);
      return { insere: true };
    },

    async crediterCompte(compteId, montant) {
      const c = etat.comptes.find((x) => x.id === compteId);
      // Meme conversion que le depot reel : sans elle, '' + 7000 vaut '7000'.
      if (c) c.data.solde = soldeNumerique(c.data.solde) + montant;
    },

    async insererNotification(n) { etat.notifications.push(n); },
  };
  return depot;
}

/** Réponse SingPay « transaction réussie », telle qu'observée en production. */
function singpayConfirme({ result = 'Success', status = 'Terminate', amount = 7000 } = {}) {
  return async () => ({
    ok: true,
    json: async () => ({
      status: { code: 200, success: true },
      transaction: {
        _id: '6a1cb6bb9e8fd3521543d461',
        reference: 'OGO-abcdef12-1780266682192',
        amount,
        result,
        status,
        type: 'Moov',
        airtel_money_id: '10792906012681316204',
      },
    }),
  });
}

const HEADERS_FACTICES = { 'x-client-id': 'x', 'x-client-secret': 'y' };

/** Ce que fait `singpay-callback.js` : vérifier auprès de SingPay, puis écrire. */
async function rejouerRappel(depot, { fetchImpl, payload = {} } = {}) {
  const verif = await verifierAupresDeSingPay('OGO-abcdef12-1780266682192', {
    fetchImpl, headers: HEADERS_FACTICES,
  });
  assert.equal(verif.joignable, true, 'la vérification SingPay doit aboutir dans ce test');
  return appliquerStatutPaiement({
    depot,
    paiementRow: depot.etat.paiement,
    statutVerifie: verif.statut,
    montantVerifie: verif.montant,
    result: verif.result,
    statutTransaction: verif.statutTransaction,
    rawCallback: payload,
    origine: 'rappel',
  });
}

/** Ce que fait `singpay-status.js` : même chose, autre origine. */
async function rejouerSondage(depot, { fetchImpl } = {}) {
  const verif = await verifierAupresDeSingPay('OGO-abcdef12-1780266682192', {
    fetchImpl, headers: HEADERS_FACTICES,
  });
  return appliquerStatutPaiement({
    depot,
    paiementRow: depot.etat.paiement,
    statutVerifie: verif.statut,
    montantVerifie: verif.montant,
    result: verif.result,
    statutTransaction: verif.statutTransaction,
    origine: 'sondage',
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. TRADUCTION DES STATUTS SINGPAY
   ═══════════════════════════════════════════════════════════════════════════ */

test('Success est le seul resultat qui vaut encaissement', () => {
  assert.equal(mapResultatVersStatut('Success', 'Terminate'), 'paid');
  for (const r of ['PasswordError', 'BalanceError', 'Error']) {
    assert.equal(mapResultatVersStatut(r, 'Terminate'), 'failed', `${r} ne doit pas encaisser`);
  }
  assert.equal(mapResultatVersStatut('TimeOutError', 'Terminate'), 'expired');
});

test('sans result, une transaction non terminee reste pending', () => {
  // Cas réel : SingPay répond `status: 'Start'` pendant que le client tape son PIN.
  assert.equal(mapResultatVersStatut(undefined, 'Start'), 'pending');
  assert.equal(mapResultatVersStatut(undefined, 'Partenaire'), 'pending');
  // Terminée sans verdict = anormal, donc pas un encaissement.
  assert.equal(mapResultatVersStatut(undefined, 'Terminate'), 'failed');
});

test('un result inconnu ne vaut jamais paid', () => {
  assert.equal(mapResultatVersStatut('SomethingNew', 'Terminate'), 'pending');
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. AUTHENTIFICATION DU RAPPEL
   ═══════════════════════════════════════════════════════════════════════════ */

test('UN RAPPEL NON SIGNE EST REJETE quand le secret est configure', () => {
  const r = verifierSecretCallback({ headers: {}, query: {} }, { secret: 'secret-de-32-caracteres-minimum!!' });
  assert.equal(r.ok, false);
  assert.equal(r.mode, 'strict');
  assert.match(r.raison, /absent/);
});

test('un jeton errone est rejete, y compris s il a la bonne longueur', () => {
  const bon = 'secret-de-32-caracteres-minimum!!';
  const faux = 'secret-de-32-caracteres-minimum??';
  assert.equal(bon.length, faux.length, 'le test doit comparer deux jetons de meme longueur');
  assert.equal(verifierSecretCallback({ query: { token: faux } }, { secret: bon }).ok, false);
});

test('le bon jeton passe, par en-tete comme par parametre d URL', () => {
  const secret = 'secret-de-32-caracteres-minimum!!';
  assert.equal(verifierSecretCallback({ query: { token: secret } }, { secret }).ok, true);
  assert.equal(verifierSecretCallback({ headers: { 'x-callback-token': secret } }, { secret }).ok, true);
});

test('sans secret configure, l endpoint reste ouvert mais le signale', () => {
  // Drapeau de fonctionnalité : poser SINGPAY_CALLBACK_SECRET active le contrôle.
  // Tant qu'il est absent, aucune régression de production — mais le mode est
  // explicitement 'ouvert', jamais confondu avec une authentification réussie.
  const r = verifierSecretCallback({ headers: {}, query: {} }, { secret: '' });
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'ouvert');
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. LE CORPS DU RAPPEL N'EST JAMAIS CRU
   ═══════════════════════════════════════════════════════════════════════════ */

test('les deux formes de message SingPay sont lues (enveloppe et objet nu)', () => {
  const enveloppe = lireMessageRappel({
    status: { code: 200, success: false },
    transaction: { _id: 'tx1', reference: 'OGO-1', result: 'Error', status: 'Terminate' },
  });
  assert.deepEqual(enveloppe, {
    reference: 'OGO-1', transactionId: 'tx1', resultAnnonce: 'Error', statutAnnonce: 'Terminate',
  });

  const nu = lireMessageRappel({ reference: 'OGO-2', id: 'tx2', result: 'Success', status: 'Terminate' });
  assert.equal(nu.reference, 'OGO-2');
  assert.equal(nu.resultAnnonce, 'Success');
});

test('UN FAUX RAPPEL « Success » N ENCAISSE RIEN si SingPay dit le contraire', async () => {
  // Scénario d'attaque : POST {reference, result:'Success'} par un tiers.
  // La référence se lit dans le reçu PDF remis au client — elle n'est pas secrète.
  const depot = creerDepot();
  const soldeAvant = depot.etat.comptes[1].data.solde;

  const resultat = await rejouerRappel(depot, {
    fetchImpl: singpayConfirme({ result: 'Error' }),   // la vérité de SingPay
    payload: { reference: 'OGO-abcdef12-1780266682192', result: 'Success' }, // le mensonge
  });

  assert.equal(resultat.statut, 'failed', 'le statut appliqué est celui de SingPay');
  assert.equal(resultat.mouvementCree, false);
  assert.equal(depot.etat.mouvements.length, 0, 'aucune ecriture d argent');
  assert.equal(depot.etat.comptes[1].data.solde, soldeAvant, 'aucun solde touche');
  assert.notEqual(depot.etat.commande.data.statut, 'en_production');
});

test('SingPay injoignable : on n ecrit rien, on ne conclut rien', async () => {
  const verif = await verifierAupresDeSingPay('OGO-abcdef12-1780266682192', {
    fetchImpl: async () => ({ ok: false, status: 503 }),
    headers: HEADERS_FACTICES,
  });
  assert.equal(verif.joignable, false);
  assert.equal(verif.statut, null, 'aucun statut deduit d une absence de reponse');
  assert.match(verif.erreur, /503/);
});

test('reseau coupe pendant la verification : pas d exception qui remonte', async () => {
  const verif = await verifierAupresDeSingPay('OGO-1', {
    fetchImpl: async () => { throw new Error('ECONNRESET'); },
    headers: HEADERS_FACTICES,
  });
  assert.equal(verif.joignable, false);
  assert.match(verif.erreur, /ECONNRESET/);
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. IDEMPOTENCE — UN RAPPEL REPETE N'ENCAISSE QU'UNE FOIS
   ═══════════════════════════════════════════════════════════════════════════ */

test('IDEMPOTENCE : trois rappels identiques ne creditent qu une fois', async () => {
  // SingPay rejoue un webhook tant qu'elle n'a pas reçu de 200 assez vite.
  const depot = creerDepot();
  const fetchImpl = singpayConfirme();

  const r1 = await rejouerRappel(depot, { fetchImpl });
  const r2 = await rejouerRappel(depot, { fetchImpl });
  const r3 = await rejouerRappel(depot, { fetchImpl });

  assert.equal(r1.mouvementCree, true, 'le premier rappel encaisse');
  assert.equal(r2.mouvementCree, false, 'le deuxieme constate');
  assert.equal(r3.mouvementCree, false, 'le troisieme aussi');

  assert.equal(depot.etat.mouvements.length, 1, 'un seul mouvement de tresorerie');
  assert.equal(depot.etat.comptes[1].data.solde, 7000, 'le compte Moov est credite une seule fois');
  assert.equal(depot.etat.commande.data.statut, 'en_production');

  // Et le client n'est pas prévenu trois fois du même paiement.
  const notifsClient = depot.etat.notifications.filter((n) => n.destinataire === 'client');
  assert.equal(notifsClient.length, 1, 'une seule notification client');
});

test('la repetition n ecrase pas la date d encaissement initiale', async () => {
  const depot = creerDepot();
  const fetchImpl = singpayConfirme();
  await rejouerRappel(depot, { fetchImpl });
  const premierPaiement = depot.etat.paiement.data.paid_at;
  assert.ok(premierPaiement, 'la premiere confirmation date le paiement');
  await new Promise((r) => setTimeout(r, 5));
  await rejouerRappel(depot, { fetchImpl });
  assert.equal(depot.etat.paiement.data.paid_at, premierPaiement, 'paid_at ne bouge plus');
});

test('DEUX RAPPELS SIMULTANES : avec l index unique, un seul encaissement', async () => {
  // Deux instances serverless, deux processus : aucun verrou en memoire ne les
  // couvre. Seule la base peut arbitrer — c'est l'objet de la migration 005.
  const depot = creerDepot({ indexUnique: true, latenceMs: 10 });
  const fetchImpl = singpayConfirme();

  await Promise.all([rejouerRappel(depot, { fetchImpl }), rejouerRappel(depot, { fetchImpl })]);

  assert.equal(depot.etat.mouvements.length, 1, 'un seul mouvement malgre la concurrence');
  assert.equal(depot.etat.comptes[1].data.solde, 7000, 'le solde n est credite qu une fois');
});

test('LA COURSE EXISTE VRAIMENT : sans l index unique, le doublon passe', async () => {
  // Ce test documente le defaut que la migration 005 corrige. S il echoue un
  // jour, c est que le depot a acquis une autre protection : relire ce fichier.
  const depot = creerDepot({ indexUnique: false, latenceMs: 10 });
  const fetchImpl = singpayConfirme();

  await Promise.all([rejouerRappel(depot, { fetchImpl }), rejouerRappel(depot, { fetchImpl })]);

  assert.equal(depot.etat.mouvements.length, 2,
    'la demonstration du bug doit produire 2 mouvements — sinon la migration 005 n est plus necessaire');
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. CONVERGENCE SONDAGE / RAPPEL — le bug qui bloquait les commandes
   ═══════════════════════════════════════════════════════════════════════════ */

test('CONVERGENCE : le sondage arrive en premier, la commande part quand meme en production', async () => {
  // C'ETAIT LE VRAI DEFAUT. Le sondage (5 s) gagne presque toujours la course
  // contre le rappel reseau. Avant, il se contentait de noter 'paid' ; le
  // rappel voyait ensuite 'paid', repondait « deja traite » et repartait sans
  // rien faire. La commande restait bloquee et la tresorerie n etait pas
  // creditee, alors que l argent avait quitte le compte du client.
  const depot = creerDepot();
  const fetchImpl = singpayConfirme();

  const sondage = await rejouerSondage(depot, { fetchImpl });
  assert.equal(sondage.mouvementCree, true, 'le sondage fait le travail complet');
  assert.equal(depot.etat.commande.data.statut, 'en_production');
  assert.equal(depot.etat.comptes[1].data.solde, 7000);
  assert.equal(depot.etat.paiement.data.confirme_par, 'sondage');

  const rappel = await rejouerRappel(depot, { fetchImpl });
  assert.equal(rappel.mouvementCree, false, 'le rappel constate, il ne double pas');
  assert.equal(depot.etat.mouvements.length, 1);
  assert.equal(depot.etat.comptes[1].data.solde, 7000, 'toujours 7000, pas 14000');
});

test('CONVERGENCE : le client ferme son onglet, le rappel termine le travail', async () => {
  // Cas metier exact : une ecole paie puis quitte la page. Sans rappel
  // fonctionnel, la commande restait en 'paiement_initie' jusqu a verification
  // manuelle. Ici aucun sondage n a lieu : le rappel suffit.
  const depot = creerDepot();
  const rappel = await rejouerRappel(depot, { fetchImpl: singpayConfirme() });

  assert.equal(rappel.mouvementCree, true);
  assert.equal(depot.etat.commande.data.statut, 'en_production');
  assert.equal(depot.etat.paiement.data.confirme_par, 'rappel');
  assert.ok(depot.etat.notifications.some((n) => n.type === 'paiement_confirme'));
});

test('CONVERGENCE : sondage et rappel simultanes, un seul encaissement', async () => {
  const depot = creerDepot({ indexUnique: true, latenceMs: 10 });
  const fetchImpl = singpayConfirme();

  const [a, b] = await Promise.all([
    rejouerSondage(depot, { fetchImpl }),
    rejouerRappel(depot, { fetchImpl }),
  ]);

  const encaissements = [a, b].filter((r) => r.mouvementCree).length;
  assert.equal(encaissements, 1, 'exactement un des deux chemins encaisse');
  assert.equal(depot.etat.mouvements.length, 1);
  assert.equal(depot.etat.comptes[1].data.solde, 7000);
  assert.equal(
    depot.etat.notifications.filter((n) => n.type === 'paiement_confirme').length, 1,
    'une seule notification admin',
  );
});

/* ═══════════════════════════════════════════════════════════════════════════
   6. UN ENCAISSEMENT NE S'ANNULE PAS PAR WEBHOOK
   ═══════════════════════════════════════════════════════════════════════════ */

test('un paiement encaisse n est jamais retrograde', () => {
  assert.equal(transitionAutorisee('paid', 'paid'), true);
  for (const s of ['failed', 'expired', 'cancelled', 'pending']) {
    assert.equal(transitionAutorisee('paid', s), false, `paid -> ${s} doit etre refuse`);
  }
  // Depuis pending, tout reste possible.
  for (const s of STATUTS_FINAUX) {
    assert.equal(transitionAutorisee('pending', s), true);
  }
});

test('DENI DE PAIEMENT : un rappel d echec tardif ne defait pas un encaissement', async () => {
  const depot = creerDepot();
  await rejouerRappel(depot, { fetchImpl: singpayConfirme() });
  assert.equal(depot.etat.commande.data.statut, 'en_production');

  // SingPay elle-meme renverrait 'Error' : meme dans ce cas, on ne defait rien
  // automatiquement. Un remboursement est une decision humaine, avec sa
  // contre-passation (src/services/contre-passation-commande.js).
  const apres = await rejouerRappel(depot, { fetchImpl: singpayConfirme({ result: 'Error' }) });

  assert.equal(apres.applique, false);
  assert.match(apres.raison, /refus/);
  assert.equal(depot.etat.paiement.data.status, 'paid');
  assert.equal(depot.etat.commande.data.statut, 'en_production', 'la commande reste en production');
  assert.equal(depot.etat.comptes[1].data.solde, 7000, 'l argent encaisse reste encaisse');
});

test('un echec avant tout encaissement remet la commande en attente de paiement', async () => {
  const depot = creerDepot();
  const r = await rejouerRappel(depot, { fetchImpl: singpayConfirme({ result: 'BalanceError' }) });

  assert.equal(r.statut, 'failed');
  assert.equal(depot.etat.commande.data.statut, 'validee_attente_paiement');
  assert.equal(depot.etat.mouvements.length, 0);
  const notif = depot.etat.notifications.find((n) => n.type === 'paiement_echoue');
  assert.ok(notif, 'le client est prevenu');
  assert.match(notif.message, /[Ss]olde insuffisant/);
});

test('une transaction encore en cours ne declenche aucune ecriture', async () => {
  const depot = creerDepot();
  // `result: null` et non `undefined` : SingPay n'envoie pas de verdict tant que
  // le client n'a pas tape son code PIN (cas reel observe, `status: 'Start'`).
  const r = await rejouerRappel(depot, { fetchImpl: singpayConfirme({ result: null, status: 'Start' }) });

  assert.equal(r.applique, false);
  assert.equal(depot.etat.paiement.data.status, 'pending');
  assert.equal(depot.etat.mouvements.length, 0);
  assert.equal(depot.etat.notifications.length, 0);
});

/* ═══════════════════════════════════════════════════════════════════════════
   7. MONTANT
   ═══════════════════════════════════════════════════════════════════════════ */

test('MONTANT : on credite le montant initie, jamais celui annonce', async () => {
  // L ancien code ecrivait `Number(amount || paiement.amount)` en prenant
  // d abord le montant du message entrant. Un message forge pouvait donc
  // gonfler la tresorerie.
  const depot = creerDepot();
  // SingPay confirme un montant different de celui qu on a initie (7000).
  const r = await rejouerRappel(depot, { fetchImpl: singpayConfirme({ amount: 700000 }) });

  assert.equal(r.mouvementCree, false, 'aucune ecriture d argent sur un ecart de montant');
  assert.equal(soldeNumerique(depot.etat.comptes[1].data.solde), 0, 'le solde n a pas bouge');
  assert.ok(
    depot.etat.notifications.some((n) => n.type === 'paiement_montant_incoherent'),
    'un humain est alerte',
  );
});

test('l alerte de montant incoherent n est envoyee qu une fois', async () => {
  // Le sondage repasse toutes les 5 s : sans temoin, le gerant recevrait une
  // douzaine d alertes par minute pour un seul paiement douteux.
  const depot = creerDepot();
  const fetchImpl = singpayConfirme({ amount: 700000 });
  await rejouerRappel(depot, { fetchImpl });
  await rejouerSondage(depot, { fetchImpl });
  await rejouerSondage(depot, { fetchImpl });

  assert.equal(
    depot.etat.notifications.filter((n) => n.type === 'paiement_montant_incoherent').length, 1,
    'une seule alerte',
  );
  assert.equal(depot.etat.mouvements.length, 0, 'et toujours aucune ecriture d argent');
});

test('SOLDE VIDE : un compte a "" est credite en nombre, pas en texte', () => {
  // Mesure de production (2026-09-16) : « Airtel Money » et « Moov Money »
  // portent solde: "" — la chaine vide, pas 0. Or en JavaScript
  // `"" ?? 0` vaut "" et `"" + 7000` vaut la CHAINE "7000". Le credit suivant
  // aurait produit "70007000". Ce sont precisement les deux comptes que le
  // Mobile Money credite.
  assert.equal(soldeNumerique('') + 7000, 7000);
  assert.equal(typeof (soldeNumerique('') + 7000), 'number');
  assert.equal(soldeNumerique(null), 0);
  assert.equal(soldeNumerique(undefined), 0);
  assert.equal(soldeNumerique('abc'), 0);
  assert.equal(soldeNumerique('785000'), 785000, 'un solde stocke en texte reste lisible');
  assert.equal(soldeNumerique(890000), 890000);
});

test('le compte credite suit l operateur du paiement', async () => {
  const depot = creerDepot();
  await rejouerRappel(depot, { fetchImpl: singpayConfirme() });
  assert.equal(depot.etat.comptes[1].data.solde, 7000, 'Moov credite');
  assert.equal(depot.etat.comptes[0].data.solde, 100000, 'FINAM intouche');
});

/* ═══════════════════════════════════════════════════════════════════════════
   8. COMPATIBILITE AVEC L'ENCAISSEMENT A LA LIVRAISON
   ═══════════════════════════════════════════════════════════════════════════ */

test('la reference de mouvement garde la forme singpay:<reference>', () => {
  // ⚠️ src/features/commandes/page.jsx teste `singpay:${cmd.singpay_reference}`
  // pour ne pas ré-encaisser à la livraison une commande déjà payée en Mobile
  // Money. Changer cette forme recree un double comptage du chiffre d affaires.
  assert.equal(
    referenceMouvement({ payment_reference: 'OGO-abcdef12-1780266682192' }),
    'singpay:OGO-abcdef12-1780266682192',
  );
  // Repli sur l identifiant de transaction si la reference manque.
  assert.equal(referenceMouvement({ singpay_transaction_id: 'tx9' }), 'singpay:tx9');
  assert.equal(referenceMouvement({}), null);
});

test('l ecran Commandes reconnait toujours la reference et la categorie ecrites ici', () => {
  const ecran = readFileSync(new URL('../src/features/commandes/page.jsx', import.meta.url), 'utf8');
  assert.match(ecran, /singpay:\$\{cmd\.singpay_reference\}/,
    'le garde-fou anti-double-encaissement de la livraison doit rester en place');
  assert.match(ecran, /encaissement_singpay/,
    'la categorie ecrite par le rappel doit rester celle que la livraison reconnait');
});

/* ═══════════════════════════════════════════════════════════════════════════
   9. L'ADRESSE DE RAPPEL N'EST PAS DANS LA REQUETE DE PAIEMENT
   ═══════════════════════════════════════════════════════════════════════════ */

test('aucun nom de champ de rappel n est invente dans le corps envoye a SingPay', () => {
  // La documentation publique de SingPay ne decrit aucun champ de rappel dans
  // le corps de POST /{prefixe}/paiement ni de POST /ext. Le seul nom CONFIRME
  // est `callbackURL`, et il vit sur le PORTEFEUILLE : il apparait dans
  // `transaction.portefeuille.callbackURL` de chaque reponse de la passerelle.
  // Envoyer un champ invente a une passerelle de paiement peut faire rejeter la
  // requete entiere : ce test empeche la tentation de revenir.
  const initiate = readFileSync(new URL('../api/singpay-initiate.js', import.meta.url), 'utf8');

  // On isole les deux corps de requete, entre `let body;` et l'appel fetch.
  const zoneCorps = initiate.slice(initiate.indexOf('let body;'), initiate.indexOf('await fetch(endpoint'));
  for (const invente of ['callback_url', 'callbackUrl', 'urlCallback', 'notify_url', 'webhook_url', 'callbackURL']) {
    assert.ok(!zoneCorps.includes(`${invente}:`), `le corps ne doit pas porter de champ « ${invente} »`);
  }

  // Les seuls champs envoyes restent ceux observes en production.
  assert.match(zoneCorps, /portefeuille:/);
  assert.match(zoneCorps, /reference,/);
  assert.match(zoneCorps, /isTransfer: false/);
});

test('la variable morte callbackUrl a disparu de l initiation', () => {
  const initiate = readFileSync(new URL('../api/singpay-initiate.js', import.meta.url), 'utf8');
  assert.ok(
    !/const callbackUrl\s*=/.test(initiate),
    'la variable construite puis jamais utilisee doit rester supprimee',
  );
});

/* ═══════════════════════════════════════════════════════════════════════════
   10. PLAFONDS DES OPERATEURS
   ═══════════════════════════════════════════════════════════════════════════ */

test('PLAFOND : Airtel refuse au-dela de 500 000 F, avec le VRAI motif', () => {
  // Grille officielle Airtel Money Gabon et article 3.5 des conditions
  // d'abonnement : « Le plafond des transactions Airtel money est de 500 000 F CFA ».
  assert.equal(PLAFONDS_PAR_DEFAUT.airtel, 500_000);

  const r = controlerPlafond(700_000, 'airtel', {});
  assert.equal(r.accepte, false);
  assert.equal(r.plafond, 500_000);
  // Le motif doit dire la verite : ce n'est PAS un probleme de solde client.
  assert.match(r.motif, /plafond/i);
  assert.match(r.motif, /pas un probl[eè]me de solde/i);
  assert.match(r.motif, /virement bancaire/i);
});

test('PLAFOND : 500 000 F pile passe, 500 001 F non', () => {
  assert.equal(controlerPlafond(500_000, 'airtel', {}).accepte, true);
  assert.equal(controlerPlafond(500_001, 'airtel', {}).accepte, false);
});

test('PLAFOND : Moov accepte jusqu a 1 000 000 F par operation', () => {
  // Grille officielle Moov Money Gabon : paiement maximal par operation = 1 000 000 F.
  assert.equal(PLAFONDS_PAR_DEFAUT.moov, 1_000_000);
  assert.equal(controlerPlafond(1_000_000, 'moov', {}).accepte, true);
  assert.equal(controlerPlafond(1_000_001, 'moov', {}).accepte, false);
});

test('PLAFOND : entre 500 000 et 1 000 000, Moov passe mais previent', () => {
  // Moov Money Online plafonne aussi a 1 000 000 F/jour ET PAR CLIENT : une
  // facture d un million consomme 100 % du plafond quotidien du payeur.
  const r = controlerPlafond(800_000, 'moov', {});
  assert.equal(r.accepte, true);
  assert.ok(r.avertissement, 'un montant eleve doit etre annonce fragile');
  assert.match(r.avertissement, /1 000 000 F par jour/);
});

test('PLAFOND : un petit montant passe sans bruit', () => {
  const r = controlerPlafond(7_000, 'moov', {});
  assert.equal(r.accepte, true);
  assert.equal(r.avertissement, undefined);
  assert.equal(r.motif, undefined);
});

test('PLAFOND : les grilles operateur changent — les valeurs sont surchargeables', () => {
  // Une grille tarifaire evolue sans previvenir et personne ne doit attendre un
  // deploiement : les plafonds se corrigent par variable d environnement.
  const env = { SINGPAY_PLAFOND_AIRTEL: '1500000' };
  assert.equal(controlerPlafond(700_000, 'airtel', env).accepte, true);
  assert.equal(controlerPlafond(1_600_000, 'airtel', env).accepte, false);
  // Une surcharge absurde est ignoree au profit du defaut.
  assert.equal(controlerPlafond(700_000, 'airtel', { SINGPAY_PLAFOND_AIRTEL: 'zero' }).accepte, false);
  assert.equal(controlerPlafond(700_000, 'airtel', { SINGPAY_PLAFOND_AIRTEL: '-5' }).accepte, false);
});

test('l endpoint d initiation refuse le montant AVANT d appeler la passerelle', () => {
  const initiate = readFileSync(new URL('../api/singpay-initiate.js', import.meta.url), 'utf8');
  const posControle = initiate.indexOf('controlerPlafond(montant');
  const posAppel = initiate.indexOf('await fetch(endpoint');
  assert.ok(posControle > 0, 'le controle de plafond doit exister');
  assert.ok(posControle < posAppel, 'il doit precedeer l appel reseau a SingPay');
});

/* ═══════════════════════════════════════════════════════════════════════════
   11. « VOTRE PAIEMENT A ETE CONFIRME » — ATTEINT-ELLE QUELQU'UN ?

   C'est la seule des notifications de l'application qui touche de l'argent
   reel, et c'etait la derniere a porter le defaut de classe du 17/09/2026 :
   `destinataire_id: cmdRow.data.client_id`.

   Pour une commande saisie AU COMPTOIR — la majorite — ce champ porte l'id de
   la FICHE client. Le panneau de notifications, lui, filtre sur `user.id`, un
   id de COMPTE (`getNotifications`, src/services/notifications.js). La ligne
   etait donc bien ecrite en base, sans la moindre erreur, et personne ne la
   lisait jamais. Le client payait et n'etait jamais prevenu.
   ═══════════════════════════════════════════════════════════════════════════ */

test('PAIEMENT CONFIRME : une commande du COMPTOIR atteint le COMPTE du client', async () => {
  const depot = creerDepot();
  await rejouerRappel(depot, { fetchImpl: singpayConfirme() });

  const notif = depot.etat.notifications.find((n) => n.type === 'paiement_confirme_client');
  assert.ok(notif, 'le client doit etre prevenu que son paiement est passe');
  assert.equal(
    notif.destinataire_id, 'u-ecole',
    'la fiche `cli-9` doit etre traduite en compte `u-ecole` — sinon personne ne lit cette ligne',
  );
  assert.notEqual(notif.destinataire_id, 'cli-9', 'un id de fiche n’est porté par aucun compte');
});

test('PAIEMENT CONFIRME : une commande du PORTAIL n est pas retraduite — aucune regression', async () => {
  const depot = creerDepot();
  // Commande du portail : `client_id` est deja un id de COMPTE.
  depot.etat.commande.data.client_id = 'u-ecole';
  await rejouerRappel(depot, { fetchImpl: singpayConfirme() });

  const notif = depot.etat.notifications.find((n) => n.type === 'paiement_confirme_client');
  assert.equal(notif.destinataire_id, 'u-ecole');
});

test('PAIEMENT CONFIRME : client sans compte portail — l argent entre, et le gerant lit POURQUOI', async () => {
  const depot = creerDepot({ clients: [{ id: 'cli-9', nom: 'Passage Nzeng-Ayong' }] });
  const r = await rejouerRappel(depot, { fetchImpl: singpayConfirme() });

  // 1. L'ARGENT D'ABORD. Un client injoignable ne doit jamais bloquer un encaissement.
  assert.equal(r.mouvementCree, true, 'l’encaissement ne doit JAMAIS dépendre d’une notification');
  assert.equal(depot.etat.comptes[1].data.solde, 7000, 'l’argent est entré');
  assert.equal(depot.etat.commande.data.statut, 'en_production');

  // 2. Aucune ligne morte : ecrire sur un id que personne ne porte n'est pas prevenir.
  assert.equal(
    depot.etat.notifications.filter((n) => n.type === 'paiement_confirme_client').length, 0,
    'une notification que personne ne peut lire est un faux « prévenu »',
  );

  // 3. LA RAISON, la ou un humain la lit : la notification du gerant.
  const admin = depot.etat.notifications.find((n) => n.type === 'paiement_confirme');
  assert.ok(admin, 'le gérant doit rester prévenu de l’encaissement');
  assert.match(admin.message, /7000 FCFA/, 'le montant encaissé ne doit pas disparaître de l’alerte');
  assert.match(admin.message, /non prévenu/i, 'le verdict doit être nommé');
  assert.match(admin.message, /pas de compte/i, 'la RAISON compte autant que le verdict');
  assert.match(admin.message, /téléphone/i, 'et dire au gérant quoi faire à la place');
  assert.match(admin.message, /Passage Nzeng-Ayong/, 'la raison doit nommer le client concerné');
});

test('PAIEMENT CONFIRME : un client joignable ne pollue pas l alerte du gerant', async () => {
  const depot = creerDepot();
  await rejouerRappel(depot, { fetchImpl: singpayConfirme() });
  const admin = depot.etat.notifications.find((n) => n.type === 'paiement_confirme');
  assert.ok(!/non prévenu/i.test(admin.message), 'aucun avertissement quand le client est prévenu');
});

test('PAIEMENT CONFIRME : annuaire illisible — on encaisse, et on garde l identifiant tel quel', async () => {
  const depot = creerDepot({ clients: null });
  const r = await rejouerRappel(depot, { fetchImpl: singpayConfirme() });

  assert.equal(r.mouvementCree, true, 'une panne de lecture de l’annuaire ne doit pas retenir l’argent');
  const notif = depot.etat.notifications.find((n) => n.type === 'paiement_confirme_client');
  assert.ok(notif, 'faute de pouvoir résoudre, on tente quand même');
  assert.equal(notif.destinataire_id, 'cli-9', 'c’est exactement le comportement d’avant la correction');
});

test('PAIEMENT ECHOUE : l avis d echec passe par la meme resolution', async () => {
  const depot = creerDepot();
  await rejouerRappel(depot, { fetchImpl: singpayConfirme({ result: 'BalanceError' }) });

  const notif = depot.etat.notifications.find((n) => n.type === 'paiement_echoue');
  assert.ok(notif, 'le client doit être prévenu que son paiement n’est pas passé');
  assert.equal(notif.destinataire_id, 'u-ecole', 'même défaut, même correction : la fiche est traduite');
});

test('PAIEMENT ECHOUE : client sans compte — rien n est ecrit, la commande retombe quand meme', async () => {
  const depot = creerDepot({ clients: [{ id: 'cli-9', nom: 'Passage Nzeng-Ayong' }] });
  await rejouerRappel(depot, { fetchImpl: singpayConfirme({ result: 'BalanceError' }) });

  assert.equal(depot.etat.commande.data.statut, 'validee_attente_paiement',
    'l’état de la commande ne dépend pas de la joignabilité du client');
  assert.equal(depot.etat.notifications.filter((n) => n.type === 'paiement_echoue').length, 0);
});

test('CONTRAT DE SOURCE : la regle « fiche → compte » n est pas recopiee cote serveur', () => {
  const noyau = readFileSync(new URL('../api/_lib/singpay-encaissement.js', import.meta.url), 'utf8');
  assert.ok(
    noyau.includes("from '../../src/services/compte-client.js'"),
    'la résolution doit venir du module partagé, jamais d’une seconde copie',
  );
  const code = noyau
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.ok(
    !/user_id/.test(code),
    'une seconde source de vérité pour « fiche → compte » est exactement ce qui a produit la panne',
  );
  assert.ok(
    !/destinataire_id: cmdRow\.data\.client_id|destinataire_id: cmdRow\?\.data\?\.client_id/.test(code),
    'le `client_id` brut est reparti en destinataire : la notification n’atteint plus personne',
  );
});

test('CONTRAT DE SOURCE : le depot reel sait lire l annuaire client, de facon stable', () => {
  const noyau = readFileSync(new URL('../api/_lib/singpay-encaissement.js', import.meta.url), 'utf8');
  const i = noyau.indexOf('async listerClients()');
  assert.ok(i > -1, 'sans cette lecture, la résolution serveur ne peut rien résoudre');
  const corps = noyau.slice(i, i + 500);
  assert.ok(corps.includes("eq('collection', 'clients')"));
  assert.ok(
    corps.includes("order('created_at', { ascending: true })"),
    'sans tri, Postgres rend les lignes dans un ordre non garanti : la base contient des fiches en double',
  );
});
