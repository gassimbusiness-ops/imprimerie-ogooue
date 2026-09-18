/**
 * LES QUATRE DATES ECRITES EN HEURE DE LONDRES.
 *
 * `new Date().toISOString().slice(0, 10)` rend la date **UTC**. A Libreville
 * (UTC+1, sans heure d'ete), minuit local est 23 h UTC la VEILLE : tout ce qui
 * est ecrit entre 00 h et 01 h porte la date du jour precedent.
 *
 * Quatre endroits ecrivaient une date metier ainsi :
 *
 *   1. `src/features/pointage/page.jsx`        — la date DU POINTAGE.
 *      Un pointage de nuit s'ecrivait la veille. Pire : la ligne de la veille
 *      existant deja, le code faisait un `update` dessus — le pointage de nuit
 *      ECRASAIT celui de la veille. La paie etait fausse a la source.
 *   2. `src/features/performance-rh/page.jsx`  — la periode d'evaluation et le
 *      mois de reference de la paie.
 *   3. `src/features/demandes-rh/page.jsx`     — la date d'une SORTIE DE CAISSE.
 *      Une avance versee le 1er a 00 h 30 tombait dans le mois precedent.
 *   4. `api/_lib/singpay-encaissement.js`      — la date de l'encaissement
 *      Mobile Money, ecrite par une fonction serverless qui tourne en UTC.
 *
 * CE QUE CES TESTS FONT
 *
 * Ils figent l'horloge sur le creneau dangereux — 2026-09-20 00:30 a Libreville,
 * soit 2026-09-19 23:30 UTC — et verifient que la date ECRITE est bien celle du
 * 20, pas du 19. Le test de l'encaissement SingPay fait tourner le vrai code
 * serveur avec un depot en memoire.
 *
 * Ils tournent sous n'importe quel TZ : c'est le point. La suite est lancee
 * sous `TZ=Africa/Libreville`, `TZ=UTC` et `TZ=America/Los_Angeles`.
 *
 * Lancer :  node --test tests/dates-fuseau-ecrans.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { toISODate, todayISO, dateLocaleDepuisInstantUtc } from '../src/lib/dates.js';
import {
  appliquerStatutPaiement,
  referenceMouvement,
  soldeNumerique,
} from '../api/_lib/singpay-encaissement.js';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const lire = (c) => readFileSync(`${RACINE}${c}`, 'utf8');

/** L'instant du piege : 00 h 30 a Moanda, le 20 — soit 23 h 30 UTC, le 19. */
const INSTANT_PIEGE = Date.UTC(2026, 8, 19, 23, 30, 0);
const JOUR_A_MOANDA = '2026-09-20';
const JOUR_A_LONDRES = '2026-09-19';

/**
 * Fige `new Date()` et `Date.now()` sur un instant donne, sans toucher au
 * fuseau du processus : c'est le SERVEUR (UTC) ou le NAVIGATEUR du gerant
 * (UTC+1) qui change, pas l'instant.
 */
function avecHorlogeFigee(ms, fn) {
  const Vraie = globalThis.Date;
  class DateFigee extends Vraie {
    constructor(...args) {
      if (args.length === 0) super(ms);
      else super(...args);
    }
    static now() { return ms; }
  }
  globalThis.Date = DateFigee;
  try { return fn(); } finally { globalThis.Date = Vraie; }
}

/**
 * Version asynchrone : l'horloge reste figée pendant TOUS les `await` de `fn`.
 *
 * Indispensable pour l'encaissement SingPay : la date y est lue APRÈS plusieurs
 * allers-retours. Rendre l'horloge trop tôt ferait lire l'heure réelle et le
 * test ne prouverait rien.
 */
async function avecHorlogeFigeeAsync(ms, fn) {
  const Vraie = globalThis.Date;
  class DateFigee extends Vraie {
    constructor(...args) {
      if (args.length === 0) super(ms);
      else super(...args);
    }
    static now() { return ms; }
  }
  globalThis.Date = DateFigee;
  try {
    return await fn();
  } finally {
    // `require-atomic-updates` soupçonne une course entre deux écritures de
    // `globalThis.Date`. Il n'y en a pas : ce fichier est le seul à toucher
    // l'horloge, node:test enchaîne ses tests l'un après l'autre, et `Vraie`
    // est capturée AVANT le moindre await. Rendre l'horloge ici est justement
    // ce qui empêche un test suivant de la trouver figée.
    // eslint-disable-next-line require-atomic-updates
    globalThis.Date = Vraie;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   0. Le piège existe bien — sinon les tests suivants ne prouvent rien
   ═══════════════════════════════════════════════════════════════════════════ */

test('à 00 h 30 à Moanda, la forme fautive rend bien LA VEILLE', () => {
  const rendu = new Date(INSTANT_PIEGE).toISOString().slice(0, 10);
  assert.equal(rendu, JOUR_A_LONDRES, 'sans quoi le créneau choisi ne démontre rien');
  assert.equal(dateLocaleDepuisInstantUtc(new Date(INSTANT_PIEGE).toISOString()), JOUR_A_MOANDA);
});

/* ═══════════════════════════════════════════════════════════════════════════
   1. Les trois écrans — plus aucune date métier passée par UTC
   ═══════════════════════════════════════════════════════════════════════════ */

const ECRANS = [
  { quoi: 'pointage', fichier: 'src/features/pointage/page.jsx' },
  { quoi: 'performance RH', fichier: 'src/features/performance-rh/page.jsx' },
  { quoi: 'demandes RH', fichier: 'src/features/demandes-rh/page.jsx' },
  { quoi: 'encaissement SingPay', fichier: 'api/_lib/singpay-encaissement.js' },
];

for (const e of ECRANS) {
  test(`${e.quoi} — aucune date métier ne transite plus par UTC`, () => {
    const src = lire(e.fichier)
      // Les commentaires CITENT la forme fautive pour expliquer le piège :
      // les compter comme du code interdirait d'expliquer le bug.
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const fautes = [
      ...src.matchAll(/toISOString\(\)\s*\.\s*(slice\(0,\s*(?:7|10)\)|split\('T'\)\[0\])/g),
    ];
    assert.deepEqual(
      fautes.map((m) => m[0]), [],
      `${e.fichier} écrit encore une date métier en heure de Londres`,
    );
    assert.ok(
      src.includes("from '@/lib/dates'") || src.includes("src/lib/dates.js"),
      `${e.fichier} n’utilise pas src/lib/dates.js`,
    );
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. Le comportement, horloge figée sur le créneau dangereux
   ═══════════════════════════════════════════════════════════════════════════ */

test('todayISO() rend le jour de Moanda, pas celui de Londres', () => {
  // Le navigateur du gérant est à Libreville : `new Date()` y est déjà local.
  // C'est `.toISOString()` qui le renvoyait à Londres.
  const rendu = avecHorlogeFigee(INSTANT_PIEGE, () => todayISO());
  const attendu = toISODate(new Date(INSTANT_PIEGE));
  assert.equal(rendu, attendu, 'todayISO doit rendre la date LOCALE de la machine');

  // L'ECART avec la date UTC n'existe que sur une machine a l'est de
  // Greenwich — Libreville en est. Sous TZ=UTC ou TZ=America/Los_Angeles,
  // l'assertion n'aurait aucun sens : on ne l'y pose pas, et on le dit.
  const estALEstDeGreenwich = new Date(INSTANT_PIEGE).getTimezoneOffset() < 0;
  if (estALEstDeGreenwich) {
    assert.notEqual(
      rendu, new Date(INSTANT_PIEGE).toISOString().slice(0, 10),
      'à l’est de Greenwich, la date locale DIFFÈRE de la date UTC à cette heure-là',
    );
  }
});

test('pointage — la date écrite est bien celle du jour à Libreville', () => {
  // Reproduction de la ligne de l'écran : `const today = todayISO();`
  // Sous TZ=Africa/Libreville, l'écran doit écrire le 20, jamais le 19.
  if (process.env.TZ !== 'Africa/Libreville') return; // vérifié sous le fuseau métier
  const ecrit = avecHorlogeFigee(INSTANT_PIEGE, () => todayISO());
  assert.equal(ecrit, JOUR_A_MOANDA,
    'le pointage de nuit s’écrit encore la veille — et écrase celui de la veille');
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. L'encaissement SingPay — le vrai code serveur, dépôt en mémoire
   ═══════════════════════════════════════════════════════════════════════════ */

function creerDepot() {
  const etat = {
    paiement: {
      id: 'pay-1',
      data: {
        id: 'pay-1', commande_id: 'cmd-1',
        payment_reference: 'OGO-nuit-1780266682192',
        singpay_transaction_id: '6a1cb6bb9e8fd3521543d461',
        operateur: 'moov', amount: 7000, status: 'pending',
        nom_client: 'Client de nuit',
      },
    },
    commande: { id: 'cmd-1', data: { id: 'cmd-1', numero: 'CMD-0042', statut: 'paiement_initie', client_id: 'cli-9', historique_statuts: [] } },
    comptes: [{ id: 'compte-moov', data: { id: 'compte-moov', nom: 'Moov Money', solde: 0 } }],
    mouvements: [], notifications: [],
    clients: [{ id: 'cli-9', nom: 'Client de nuit', user_id: 'u-client' }],
  };
  return {
    etat,
    async lirePaiement() { return etat.paiement; },
    async majPaiement(id, data) { etat.paiement.data = data; },
    async lireCommande(id) { return etat.commande.id === id ? etat.commande : null; },
    async majCommande(id, data) { etat.commande.data = data; },
    async listerComptes() { return etat.comptes; },
    async listerClients() { return etat.clients.map((c) => ({ ...c })); },
    async insererMouvement(m) {
      if (etat.mouvements.some((x) => x.reference === m.reference)) return { insere: false };
      etat.mouvements.push(m); return { insere: true };
    },
    async crediterCompte(id, montant) {
      const c = etat.comptes.find((x) => x.id === id);
      if (c) c.data.solde = soldeNumerique(c.data.solde) + montant;
    },
    async insererNotification(n) { etat.notifications.push(n); },
  };
}

test('SingPay — un encaissement de 00 h 30 est daté du 20, pas du 19', async () => {
  const depot = creerDepot();
  // L'horloge est figée PENDANT tout l'appel : c'est le serveur Vercel, en UTC,
  // qui écrit la date.
  await avecHorlogeFigeeAsync(INSTANT_PIEGE, () => appliquerStatutPaiement({
    depot,
    paiementRow: depot.etat.paiement,
    statutVerifie: 'paid',
    montantVerifie: 7000,
    result: 'Success',
    statutTransaction: 'Terminate',
    origine: 'rappel',
  }));

  assert.equal(depot.etat.mouvements.length, 1, 'l’encaissement doit créer un mouvement');
  const mvt = depot.etat.mouvements[0];
  assert.equal(
    mvt.date, JOUR_A_MOANDA,
    `le paiement est daté du ${mvt.date} alors qu’il a été encaissé le ${JOUR_A_MOANDA} à Moanda`,
  );
  assert.notEqual(mvt.date, JOUR_A_LONDRES, 'la date est encore celle de Londres');
  assert.equal(depot.etat.comptes[0].data.solde, 7000, 'le compte doit être crédité');
  assert.ok(referenceMouvement(depot.etat.paiement.data), 'la référence d’idempotence doit exister');
});

test('SingPay — la date ne dépend pas du fuseau de la machine qui exécute', async () => {
  // Le même instant, quel que soit TZ : c'est ce que la suite vérifie en la
  // lançant sous trois fuseaux. Ici on l'affirme en une assertion.
  const attendu = dateLocaleDepuisInstantUtc(new Date(INSTANT_PIEGE).toISOString());
  assert.equal(attendu, JOUR_A_MOANDA, `TZ=${process.env.TZ || '(système)'} ne doit rien changer`);
});
