/**
 * DU WEBHOOK SIGNÉ JUSQU'À LA RÉPONSE — LE PASSAGE COMPLET.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE, EN PLUS DES DEUX AUTRES
 * ════════════════════════════════════════════════════════════════════════════
 *
 * `tests/bot-reponse.test.mjs` prouve ce que le bot a le droit de dire.
 * `tests/bot-executeur.test.mjs` prouve ce qui part et ce qui ne part pas.
 * Aucun des deux ne prouve que les deux morceaux sont RELIÉS.
 *
 * C'est exactement la panne du 18/09 écrite dans `tasks/lessons.md` : une
 * chaîne complète à 90 %, chaque pièce verte, et AUCUN code au milieu pour
 * faire passer la donnée d'un bout à l'autre. « Pour une chaîne, ne jamais
 * vérifier les maillons un par un — vérifier le PASSAGE d'un bout à l'autre. »
 *
 * Ce fichier part donc d'un vrai POST signé, avec un vrai corps brut, et va
 * jusqu'au texte envoyé au client.
 *
 * ⛔ Zéro réseau, zéro base : le dépôt et le client Meta sont injectés.
 *
 * Lancer :  node --test tests/bot-meta-bout-en-bout.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';

import { creerGestionnaireMetaWebhook } from '../api/meta-webhook.js';
import { MODE_REEL } from '../api/_lib/bot-executeur.js';
import { catalogueReponses } from '../api/_lib/bot-reponse.js';

const SECRET = 'secret-application-meta-de-test-abcdef';

function fausseReponse() {
  return {
    code: null,
    corps: null,
    entetes: {},
    setHeader(k, v) { this.entetes[k.toLowerCase()] = v; return this; },
    status(c) { this.code = c; return this; },
    send(b) { this.corps = b; return this; },
    json(o) { this.corps = o; return this; },
  };
}

function signer(corps, secret = SECRET) {
  return `sha256=${crypto.createHmac('sha256', secret).update(Buffer.from(corps, 'utf8')).digest('hex')}`;
}

/** Un POST réaliste : flux Node non consommé, comme sur Vercel. */
function requetePost(corps, { signature = signer(corps) } = {}) {
  const req = Readable.from([Buffer.from(corps, 'utf8')]);
  req.method = 'POST';
  req.url = '/api/meta-webhook';
  req.headers = { 'content-type': 'application/json' };
  if (signature !== null) req.headers['x-hub-signature-256'] = signature;
  return req;
}

function depotRangement() {
  const lignes = [];
  return {
    lignes,
    async existe(id) { return lignes.some((l) => l.message_id === id); },
    async inserer(doc) { lignes.push(doc); },
  };
}

function depotBot({ actif = true } = {}) {
  const journal = [];
  const reservations = new Set();
  let n = 0;
  return {
    journal,
    async lireInterrupteur() { return { actif, mode: MODE_REEL }; },
    async temoinReponse(id) {
      return journal.find((l) => l.message_id_entrant === id && l.id_message_sortant) || null;
    },
    async humainAPrisLaMain() { return false; },
    async reserver(entree) {
      if (reservations.has(entree.message_id_entrant)) return { reserve: false, id: null };
      reservations.add(entree.message_id_entrant);
      n += 1;
      const id = `bj-${n}`;
      journal.push({ id, ...entree });
      return { reserve: true, id };
    },
    async confirmer(id, complement) {
      const i = journal.findIndex((l) => l.id === id);
      if (i === -1) throw new Error(`réservation introuvable : ${id}`);
      journal[i] = { ...journal[i], ...complement };
    },
    async journaliser(entree) { journal.push(entree); },
  };
}

function clientDouble() {
  const envois = [];
  let n = 0;
  return {
    envois,
    disponible: true,
    async envoyerMessage(arg) {
      envois.push(arg);
      n += 1;
      return { idMessage: `mid.sortant.${n}`, simule: false, brut: {} };
    },
  };
}

async function avecConsoleMuette(fn) {
  const origines = { log: console.log, warn: console.warn, error: console.error };
  const traces = [];
  const capter = (niveau) => (...args) => traces.push(`${niveau} ${args.map(String).join(' ')}`);
  console.log = capter('log');
  console.warn = capter('warn');
  console.error = capter('error');
  try {
    const valeur = await fn();
    return { valeur, traces };
  } finally {
    Object.assign(console, origines);
  }
}

function avecEnv(vars, fn) {
  const anciens = {};
  for (const [k, v] of Object.entries(vars)) {
    anciens[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const restaurer = () => {
    for (const [k, v] of Object.entries(anciens)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  const resultat = fn();
  if (resultat && typeof resultat.then === 'function') return resultat.finally(restaurer);
  restaurer();
  return resultat;
}

const CORPS_MESSENGER = JSON.stringify({
  object: 'page',
  entry: [{
    id: '113984578429672',
    time: 1789000000000,
    messaging: [{
      sender: { id: 'PSID-CLIENT-1' },
      recipient: { id: '113984578429672' },
      timestamp: 1789000000000,
      message: { mid: 'm_bout_en_bout', text: 'Bonjour, vous êtes ouverts jusqu\'à quelle heure ?' },
    }],
  }],
});

const CORPS_INSTAGRAM = JSON.stringify({
  object: 'instagram',
  entry: [{
    id: '17841400000000000',
    time: 1789000000001,
    messaging: [{
      sender: { id: 'IGSID-CLIENT-9' },
      recipient: { id: '17841400000000000' },
      timestamp: 1789000000001,
      message: { mid: 'ig_bout_en_bout', text: 'Vous êtes situés où ?' },
    }],
  }],
});

/* ═══════════════════════════════════════════════════════════════════════════
   LE PASSAGE COMPLET
   ═══════════════════════════════════════════════════════════════════════════ */

test('Messenger : un POST signé range l événement ET fait partir UNE réponse du catalogue', async () => {
  await avecEnv({ META_APP_SECRET: SECRET, BOT_META_MODE: MODE_REEL }, async () => {
    const depot = depotRangement();
    const bot = depotBot();
    const client = clientDouble();
    const res = fausseReponse();

    await avecConsoleMuette(() => creerGestionnaireMetaWebhook({ depot, depotBot: bot, clientBot: client })(
      requetePost(CORPS_MESSENGER), res,
    ));

    assert.equal(res.code, 200);
    assert.equal(depot.lignes.length, 1, 'le rangement existant ne doit pas avoir été cassé');
    assert.equal(client.envois.length, 1, 'le webhook reçoit ET répond, maintenant');
    assert.equal(client.envois[0].canal, 'messenger');
    assert.equal(client.envois[0].destinataireId, 'PSID-CLIENT-1');
    assert.ok(catalogueReponses().includes(client.envois[0].texte));
    assert.ok(client.envois[0].texte.includes('17 h 30'));
  });
});

test('Instagram : même passage, canal et destinataire propres à Instagram', async () => {
  await avecEnv({ META_APP_SECRET: SECRET, BOT_META_MODE: MODE_REEL }, async () => {
    const depot = depotRangement();
    const bot = depotBot();
    const client = clientDouble();
    const res = fausseReponse();

    await avecConsoleMuette(() => creerGestionnaireMetaWebhook({ depot, depotBot: bot, clientBot: client })(
      requetePost(CORPS_INSTAGRAM), res,
    ));

    assert.equal(client.envois.length, 1);
    assert.equal(client.envois[0].canal, 'instagram');
    assert.equal(client.envois[0].destinataireId, 'IGSID-CLIENT-9');
    assert.ok(client.envois[0].texte.includes('Carrefour Fina'));
  });
});

test('REJEU : Meta livre trois fois le même événement, le client reçoit UNE réponse', async () => {
  await avecEnv({ META_APP_SECRET: SECRET, BOT_META_MODE: MODE_REEL }, async () => {
    const depot = depotRangement();
    const bot = depotBot();
    const client = clientDouble();
    const gestionnaire = creerGestionnaireMetaWebhook({ depot, depotBot: bot, clientBot: client });

    for (let i = 0; i < 3; i += 1) {
      const res = fausseReponse();
      // Chaque livraison est une NOUVELLE requête : le flux ne se relit pas.
      await avecConsoleMuette(() => gestionnaire(requetePost(CORPS_MESSENGER), res));
      assert.equal(res.code, 200);
    }

    assert.equal(depot.lignes.length, 1, 'un seul rangement');
    assert.equal(client.envois.length, 1, 'une seule réponse — un doublon se voit chez le client');
  });
});

test('BOT ÉTEINT : le webhook range toujours, mais rien ne part chez le client', async () => {
  await avecEnv({ META_APP_SECRET: SECRET, BOT_META_MODE: MODE_REEL }, async () => {
    const depot = depotRangement();
    const bot = depotBot({ actif: false });
    const client = clientDouble();
    const res = fausseReponse();

    await avecConsoleMuette(() => creerGestionnaireMetaWebhook({ depot, depotBot: bot, clientBot: client })(
      requetePost(CORPS_MESSENGER), res,
    ));

    assert.equal(res.code, 200);
    assert.equal(depot.lignes.length, 1, 'couper le bot n arrête pas la journalisation');
    assert.equal(client.envois.length, 0);
    assert.equal(bot.journal[0].motif, 'bot_eteint');
  });
});

test('SIGNATURE INVALIDE : rien n est rangé, et surtout rien n est répondu', async () => {
  await avecEnv({ META_APP_SECRET: SECRET, BOT_META_MODE: MODE_REEL }, async () => {
    const depot = depotRangement();
    const bot = depotBot();
    const client = clientDouble();
    const res = fausseReponse();

    await avecConsoleMuette(() => creerGestionnaireMetaWebhook({ depot, depotBot: bot, clientBot: client })(
      requetePost(CORPS_MESSENGER, { signature: signer(CORPS_MESSENGER, 'un-autre-secret') }), res,
    ));

    assert.equal(res.code, 403);
    assert.equal(depot.lignes.length, 0);
    assert.equal(client.envois.length, 0,
      'un bot qui répond à un corps non signé répond à n importe qui');
  });
});

test('la signature reste vérifiée sur le CORPS BRUT, réponse du bot ou pas', async () => {
  // Le même contenu, clés réordonnées — ce que produirait `JSON.stringify(req.body)`.
  const corpsOriginal = CORPS_MESSENGER;
  const corpsReserialise = JSON.stringify(JSON.parse(corpsOriginal));
  const signatureDuVrai = signer(corpsOriginal);

  await avecEnv({ META_APP_SECRET: SECRET, BOT_META_MODE: MODE_REEL }, async () => {
    const depot = depotRangement();
    const bot = depotBot();
    const client = clientDouble();
    const res = fausseReponse();

    // On envoie le corps ré-sérialisé avec la signature du vrai : ça doit être refusé
    // dès que les octets diffèrent.
    if (corpsReserialise !== corpsOriginal) {
      await avecConsoleMuette(() => creerGestionnaireMetaWebhook({ depot, depotBot: bot, clientBot: client })(
        requetePost(corpsReserialise, { signature: signatureDuVrai }), res,
      ));
      assert.equal(res.code, 403);
      assert.equal(client.envois.length, 0);
    }

    // Et le vrai corps, lui, passe.
    const res2 = fausseReponse();
    await avecConsoleMuette(() => creerGestionnaireMetaWebhook({ depot, depotBot: bot, clientBot: client })(
      requetePost(corpsOriginal, { signature: signatureDuVrai }), res2,
    ));
    assert.equal(res2.code, 200);
    assert.equal(client.envois.length, 1);
  });
});

test('le 200 part AVANT l envoi de la réponse — Meta n attend pas le bot', async () => {
  await avecEnv({ META_APP_SECRET: SECRET, BOT_META_MODE: MODE_REEL }, async () => {
    const ordre = [];
    const depot = depotRangement();
    const bot = depotBot();
    const client = {
      disponible: true,
      envois: [],
      async envoyerMessage(arg) {
        ordre.push('envoi');
        this.envois.push(arg);
        return { idMessage: 'mid.1', simule: false, brut: {} };
      },
    };
    const res = fausseReponse();
    const statusOrigine = res.status.bind(res);
    res.status = (c) => { if (c === 200) ordre.push('200'); return statusOrigine(c); };

    await avecConsoleMuette(() => creerGestionnaireMetaWebhook({ depot, depotBot: bot, clientBot: client })(
      requetePost(CORPS_MESSENGER), res,
    ));

    assert.deepEqual(ordre, ['200', 'envoi'],
      'répondre au client avant d acquitter, c est se faire rejouer par Meta');
  });
});

test('une panne du bot ne casse pas le webhook : le 200 est déjà parti', async () => {
  await avecEnv({ META_APP_SECRET: SECRET, BOT_META_MODE: MODE_REEL }, async () => {
    const depot = depotRangement();
    const bot = depotBot();
    bot.lireInterrupteur = async () => { throw new Error('base injoignable'); };
    const client = clientDouble();
    const res = fausseReponse();

    const { traces } = await avecConsoleMuette(
      () => creerGestionnaireMetaWebhook({ depot, depotBot: bot, clientBot: client })(
        requetePost(CORPS_MESSENGER), res,
      ),
    );

    assert.equal(res.code, 200);
    assert.ok(traces.some((t) => t.toLowerCase().includes('bot')),
      'la panne doit être journalisée, pas avalée en silence');
  });
});

test('le contenu du message client ne part JAMAIS dans les traces', async () => {
  await avecEnv({ META_APP_SECRET: SECRET, BOT_META_MODE: MODE_REEL }, async () => {
    const corps = JSON.stringify({
      object: 'page',
      entry: [{
        id: '113984578429672',
        time: 1789000000000,
        messaging: [{
          sender: { id: 'PSID-2' },
          recipient: { id: '113984578429672' },
          message: { mid: 'm_prive_trace', text: 'mon code secret est ANANAS-9182' },
        }],
      }],
    });
    const depot = depotRangement();
    const bot = depotBot();
    const client = clientDouble();
    const res = fausseReponse();

    const { traces } = await avecConsoleMuette(
      () => creerGestionnaireMetaWebhook({ depot, depotBot: bot, clientBot: client })(
        requetePost(corps, { signature: signer(corps) }), res,
      ),
    );

    assert.ok(!traces.join(' ').includes('ANANAS-9182'),
      'les journaux Vercel sont lisibles par tout le projet : le contenu client n y va pas');
  });
});
