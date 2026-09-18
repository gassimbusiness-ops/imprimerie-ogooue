/**
 * Adresse de rappel Meta — Messenger et messages privés Instagram.
 *
 * CE QUE CES TESTS PROTÈGENT, ET POURQUOI
 *
 * Les trois défauts de cet endpoint sont silencieux : ils ne lèvent aucune
 * erreur, ils font juste que « rien n'arrive ».
 *
 *   1. le `hub.challenge` renvoyé en JSON (donc entre guillemets) → Meta refuse
 *      d'enregistrer l'URL, sans dire pourquoi ;
 *   2. la signature vérifiée sur un corps re-sérialisé → aucun message n'est
 *      jamais accepté, et on accuse Meta ;
 *   3. le 200 tardif → Meta rejoue, et l'événement est rangé deux fois.
 *
 * Chacun a son test ici, y compris le n°2 sous sa forme piégeuse : un corps
 * dont les clés ont été réordonnées par une analyse/re-sérialisation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';

import {
  creerGestionnaireMetaWebhook,
  lireCorpsBrut,
  lireParametres,
  signatureValide,
  canalDepuisObjet,
  identifiantEvenement,
  normaliserCharge,
  rangerEvenements,
  COLLECTION_MESSAGES,
} from '../api/meta-webhook.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Outils de test — faux req/res, faux dépôt, console muette
   ═══════════════════════════════════════════════════════════════════════════ */

const JETON = 'jeton-de-verification-de-test-0123456789';
const SECRET = 'secret-application-meta-de-test-abcdef';

function fausseReponse() {
  return {
    code: null,
    corps: null,
    enJson: false,
    entetes: {},
    setHeader(k, v) { this.entetes[k.toLowerCase()] = v; return this; },
    status(c) { this.code = c; return this; },
    send(b) { this.corps = b; return this; },
    json(o) { this.corps = o; this.enJson = true; return this; },
    end(b) { if (b !== undefined) this.corps = b; return this; },
  };
}

function requeteGet(parametres) {
  const qs = new URLSearchParams(parametres).toString();
  return { method: 'GET', url: `/api/meta-webhook?${qs}`, headers: {} };
}

function signer(corps, secret = SECRET) {
  return `sha256=${crypto.createHmac('sha256', secret).update(Buffer.from(corps, 'utf8')).digest('hex')}`;
}

/** Requête POST réaliste : un flux Node non encore consommé, comme sur Vercel. */
function requetePost(corps, { signature = signer(corps), entetes = {} } = {}) {
  const req = Readable.from([Buffer.from(corps, 'utf8')]);
  req.method = 'POST';
  req.url = '/api/meta-webhook';
  req.headers = { 'content-type': 'application/json', ...entetes };
  if (signature !== null) req.headers['x-hub-signature-256'] = signature;
  return req;
}

/** Dépôt en mémoire : même contrat que `depotSupabaseMeta`. */
function depotMemoire() {
  const lignes = [];
  return {
    lignes,
    async existe(id) { return lignes.some((l) => l.message_id === id); },
    async inserer(doc) { lignes.push(doc); },
  };
}

/** Capture les traces sans les imprimer, et les rend pour vérification. */
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

const CHARGE_MESSENGER = {
  object: 'page',
  entry: [{
    id: '1010101010',
    time: 1789000000000,
    messaging: [{
      sender: { id: 'PSID-CLIENT-1' },
      recipient: { id: '1010101010' },
      timestamp: 1789000000000,
      message: { mid: 'm_AAA111', text: 'Bonjour, prix pour 500 flyers A5 ?' },
    }],
  }],
};

const CHARGE_INSTAGRAM = {
  object: 'instagram',
  entry: [{
    id: '2020202020',
    time: 1789000000001,
    messaging: [{
      sender: { id: 'IGSID-CLIENT-9' },
      recipient: { id: '2020202020' },
      timestamp: 1789000000001,
      message: { mid: 'ig_BBB222', text: 'Vous ouvrez samedi ?' },
    }],
  }],
};

/* ═══════════════════════════════════════════════════════════════════════════
   1. GET — la vérification d'abonnement
   ═══════════════════════════════════════════════════════════════════════════ */

test('GET : le hub.challenge repart BRUT, sans guillemets et en text/plain', async () => {
  await avecEnv({ META_VERIFY_TOKEN: JETON }, async () => {
    const res = fausseReponse();
    await avecConsoleMuette(() => creerGestionnaireMetaWebhook()(
      requeteGet({ 'hub.mode': 'subscribe', 'hub.verify_token': JETON, 'hub.challenge': '1158201444' }),
      res,
    ));
    assert.equal(res.code, 200);
    assert.equal(res.corps, '1158201444');
    assert.equal(res.enJson, false, 'le challenge ne doit JAMAIS partir en JSON');
    assert.ok(!String(res.corps).includes('"'), 'des guillemets font refuser l URL par Meta');
    assert.match(res.entetes['content-type'], /^text\/plain/);
  });
});

test('GET : un mauvais jeton est refusé par 403, sans rien révéler', async () => {
  await avecEnv({ META_VERIFY_TOKEN: JETON }, async () => {
    const res = fausseReponse();
    const { traces } = await avecConsoleMuette(() => creerGestionnaireMetaWebhook()(
      requeteGet({ 'hub.mode': 'subscribe', 'hub.verify_token': 'mauvais-jeton', 'hub.challenge': '999' }),
      res,
    ));
    assert.equal(res.code, 403);
    assert.equal(res.corps, 'Forbidden');
    assert.ok(!String(res.corps).includes('999'), 'le challenge ne doit pas fuiter sur un refus');
    assert.ok(!traces.join(' ').includes('mauvais-jeton'), 'le jeton fourni ne doit pas être journalisé');
  });
});

test('GET : un jeton de la BONNE longueur mais faux reste refusé', async () => {
  // La comparaison à temps constant commence par comparer les longueurs :
  // ce cas vérifie qu'un jeton de même taille ne passe pas non plus.
  await avecEnv({ META_VERIFY_TOKEN: JETON }, async () => {
    const memeTaille = `${'x'.repeat(JETON.length - 1)}y`;
    assert.equal(memeTaille.length, JETON.length);
    const res = fausseReponse();
    await avecConsoleMuette(() => creerGestionnaireMetaWebhook()(
      requeteGet({ 'hub.mode': 'subscribe', 'hub.verify_token': memeTaille, 'hub.challenge': '1' }), res,
    ));
    assert.equal(res.code, 403);
  });
});

test('GET : META_VERIFY_TOKEN absent → 403, même avec un jeton fourni', async () => {
  await avecEnv({ META_VERIFY_TOKEN: undefined }, async () => {
    const res = fausseReponse();
    const { traces } = await avecConsoleMuette(() => creerGestionnaireMetaWebhook()(
      requeteGet({ 'hub.mode': 'subscribe', 'hub.verify_token': 'nimporte-quoi', 'hub.challenge': '42' }),
      res,
    ));
    assert.equal(res.code, 403, 'un endpoint qui accepte tout faute de variable est pire que pas d endpoint');
    assert.notEqual(res.corps, '42');
    assert.ok(traces.some((t) => t.includes('META_VERIFY_TOKEN')), 'la cause doit être journalisée clairement');
  });
});

test('GET : META_VERIFY_TOKEN vide ou fait d espaces vaut absent', async () => {
  await avecEnv({ META_VERIFY_TOKEN: '   ' }, async () => {
    const res = fausseReponse();
    await avecConsoleMuette(() => creerGestionnaireMetaWebhook()(
      requeteGet({ 'hub.mode': 'subscribe', 'hub.verify_token': '   ', 'hub.challenge': '42' }), res,
    ));
    assert.equal(res.code, 403);
  });
});

test('GET : un mode autre que subscribe est refusé', async () => {
  await avecEnv({ META_VERIFY_TOKEN: JETON }, async () => {
    const res = fausseReponse();
    await avecConsoleMuette(() => creerGestionnaireMetaWebhook()(
      requeteGet({ 'hub.mode': 'unsubscribe', 'hub.verify_token': JETON, 'hub.challenge': '7' }), res,
    ));
    assert.equal(res.code, 403);
  });
});

test('GET : jeton correct mais challenge absent → 400 (et rien de vide en 200)', async () => {
  await avecEnv({ META_VERIFY_TOKEN: JETON }, async () => {
    const res = fausseReponse();
    await avecConsoleMuette(() => creerGestionnaireMetaWebhook()(
      requeteGet({ 'hub.mode': 'subscribe', 'hub.verify_token': JETON }), res,
    ));
    assert.equal(res.code, 400);
  });
});

test('GET : les paramètres sont lus même sans helper req.query de l hôte', () => {
  const p = lireParametres({ url: '/api/meta-webhook?hub.mode=subscribe&hub.challenge=abc' });
  assert.equal(p['hub.mode'], 'subscribe');
  assert.equal(p['hub.challenge'], 'abc');
  const q = lireParametres({ query: { 'hub.mode': 'subscribe' }, url: '/x' });
  assert.equal(q['hub.mode'], 'subscribe');
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. POST — la signature
   ═══════════════════════════════════════════════════════════════════════════ */

test('POST : une signature valide répond 200 et range l événement', async () => {
  await avecEnv({ META_APP_SECRET: SECRET }, async () => {
    const depot = depotMemoire();
    const corps = JSON.stringify(CHARGE_MESSENGER);
    const res = fausseReponse();
    await avecConsoleMuette(() => creerGestionnaireMetaWebhook({ depot })(requetePost(corps), res));
    assert.equal(res.code, 200);
    assert.equal(depot.lignes.length, 1);
    assert.equal(depot.lignes[0].message_id, 'm_AAA111');
    assert.equal(depot.lignes[0].canal, 'messenger');
    assert.equal(depot.lignes[0].type, 'message');
    assert.equal(depot.lignes[0].traite, false);
  });
});

test('POST : une signature invalide répond 403 et ne range rien', async () => {
  await avecEnv({ META_APP_SECRET: SECRET }, async () => {
    const depot = depotMemoire();
    const corps = JSON.stringify(CHARGE_MESSENGER);
    const res = fausseReponse();
    await avecConsoleMuette(() => creerGestionnaireMetaWebhook({ depot })(
      requetePost(corps, { signature: signer(corps, 'un-autre-secret') }), res,
    ));
    assert.equal(res.code, 403);
    assert.equal(depot.lignes.length, 0);
  });
});

test('POST : aucune signature du tout → 403', async () => {
  await avecEnv({ META_APP_SECRET: SECRET }, async () => {
    const depot = depotMemoire();
    const res = fausseReponse();
    await avecConsoleMuette(() => creerGestionnaireMetaWebhook({ depot })(
      requetePost(JSON.stringify(CHARGE_MESSENGER), { signature: null }), res,
    ));
    assert.equal(res.code, 403);
    assert.equal(depot.lignes.length, 0);
  });
});

test('POST : META_APP_SECRET absent → 403, et rien n est rangé', async () => {
  await avecEnv({ META_APP_SECRET: undefined }, async () => {
    const depot = depotMemoire();
    const corps = JSON.stringify(CHARGE_MESSENGER);
    const res = fausseReponse();
    const { traces } = await avecConsoleMuette(() => creerGestionnaireMetaWebhook({ depot })(
      requetePost(corps), res,
    ));
    assert.equal(res.code, 403);
    assert.equal(depot.lignes.length, 0);
    assert.ok(traces.some((t) => t.includes('META_APP_SECRET')));
  });
});

test('PIÈGE 2 : un corps RE-SÉRIALISÉ ne produit pas la même signature', async () => {
  // Meta signe les octets exacts. Ici les mêmes données, clés réordonnées :
  // c'est ce que rend `JSON.stringify(req.body)` après analyse par l'hôte.
  const corpsOriginal = '{"object":"page","entry":[{"id":"1","time":2,"messaging":[]}]}';
  const corpsReserialise = JSON.stringify(JSON.parse(
    '{"entry":[{"messaging":[],"time":2,"id":"1"}],"object":"page"}',
  ));
  assert.notEqual(corpsOriginal, corpsReserialise, 'les deux corps doivent différer en octets');
  assert.deepEqual(JSON.parse(corpsOriginal), JSON.parse(corpsReserialise), 'mais porter les mêmes données');

  const signatureDuVrai = signer(corpsOriginal);
  assert.equal(signatureValide(Buffer.from(corpsOriginal, 'utf8'), signatureDuVrai, SECRET), true);
  assert.equal(signatureValide(Buffer.from(corpsReserialise, 'utf8'), signatureDuVrai, SECRET), false,
    'vérifier sur un corps re-sérialisé fait échouer TOUS les messages légitimes');
});

test('signatureValide : refuse un en-tête mal formé, vide ou d une autre longueur', () => {
  const corps = Buffer.from('{"a":1}', 'utf8');
  assert.equal(signatureValide(corps, null, SECRET), false);
  assert.equal(signatureValide(corps, '', SECRET), false);
  assert.equal(signatureValide(corps, 'sha1=abcdef', SECRET), false);
  assert.equal(signatureValide(corps, 'sha256=trop-court', SECRET), false);
  assert.equal(signatureValide(corps, signer('{"a":1}'), ''), false, 'sans secret, rien n est valide');
  assert.equal(signatureValide(null, signer('{"a":1}'), SECRET), false, 'sans corps brut, rien n est valide');
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. Le corps brut
   ═══════════════════════════════════════════════════════════════════════════ */

test('lireCorpsBrut : lit le flux sans jamais toucher req.body', async () => {
  const req = Readable.from([Buffer.from('{"x":1}', 'utf8')]);
  // Si le code lit `req.body`, ce piège le fait échouer bruyamment.
  Object.defineProperty(req, 'body', {
    get() { throw new Error('req.body lu avant le flux : le corps brut est perdu'); },
  });
  const brut = await lireCorpsBrut(req);
  assert.equal(brut.toString('utf8'), '{"x":1}');
});

test('le gestionnaire POST complet ne touche pas req.body non plus', async () => {
  await avecEnv({ META_APP_SECRET: SECRET }, async () => {
    const corps = JSON.stringify(CHARGE_MESSENGER);
    const req = requetePost(corps);
    Object.defineProperty(req, 'body', {
      get() { throw new Error('req.body lu : la signature deviendrait invérifiable'); },
    });
    const depot = depotMemoire();
    const res = fausseReponse();
    await avecConsoleMuette(() => creerGestionnaireMetaWebhook({ depot })(req, res));
    assert.equal(res.code, 200);
    assert.equal(depot.lignes.length, 1);
  });
});

test('lireCorpsBrut : accepte req.rawBody quand l hôte le fournit', async () => {
  assert.equal((await lireCorpsBrut({ rawBody: Buffer.from('abc') })).toString(), 'abc');
  assert.equal((await lireCorpsBrut({ rawBody: 'def' })).toString(), 'def');
});

test('lireCorpsBrut : rend null si le corps a été analysé en objet — jamais de repli JSON.stringify', async () => {
  const brut = await lireCorpsBrut({ body: { object: 'page' }, readableEnded: true });
  assert.equal(brut, null, 'un corps reconstruit ferait un contrôle de signature décoratif');
});

test('POST : corps brut indisponible → 403 explicite', async () => {
  await avecEnv({ META_APP_SECRET: SECRET }, async () => {
    const depot = depotMemoire();
    const res = fausseReponse();
    const req = { method: 'POST', headers: { 'x-hub-signature-256': signer('{}') }, body: { deja: 'analyse' }, readableEnded: true };
    const { traces } = await avecConsoleMuette(() => creerGestionnaireMetaWebhook({ depot })(req, res));
    assert.equal(res.code, 403);
    assert.equal(depot.lignes.length, 0);
    assert.ok(traces.some((t) => t.includes('Corps brut indisponible')));
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. Idempotence — la leçon SingPay du 16/09
   ═══════════════════════════════════════════════════════════════════════════ */

test('IDEMPOTENCE : le même corps rejoué deux fois ne range qu une seule ligne', async () => {
  await avecEnv({ META_APP_SECRET: SECRET }, async () => {
    const depot = depotMemoire();
    const corps = JSON.stringify(CHARGE_MESSENGER);
    const gestionnaire = creerGestionnaireMetaWebhook({ depot });

    const res1 = fausseReponse();
    await avecConsoleMuette(() => gestionnaire(requetePost(corps), res1));
    const res2 = fausseReponse();
    await avecConsoleMuette(() => gestionnaire(requetePost(corps), res2));

    assert.equal(res1.code, 200);
    assert.equal(res2.code, 200, 'un rejeu doit toujours recevoir 200, sinon Meta rejoue encore');
    assert.equal(depot.lignes.length, 1, 'le témoin de l effet est la ligne rangée, pas un statut');
  });
});

test('IDEMPOTENCE : deux fois le même identifiant DANS le même corps → une ligne', async () => {
  const doublon = {
    object: 'page',
    entry: [{
      id: '1',
      time: 1,
      messaging: [
        { sender: { id: 'A' }, message: { mid: 'm_DOUBLE', text: 'x' } },
        { sender: { id: 'A' }, message: { mid: 'm_DOUBLE', text: 'x' } },
      ],
    }],
  };
  const depot = depotMemoire();
  const evenements = normaliserCharge(doublon, { recuLe: new Date() });
  assert.equal(evenements.length, 2);
  const bilan = await rangerEvenements({ depot, evenements });
  assert.equal(bilan.ranges, 1);
  assert.equal(bilan.ignores, 1);
  assert.equal(depot.lignes.length, 1);
});

test('IDEMPOTENCE : un postback sans mid reçoit un identifiant stable et déterministe', async () => {
  const postback = { sender: { id: 'A' }, recipient: { id: 'B' }, timestamp: 5, postback: { payload: 'TARIFS' } };
  const a = identifiantEvenement('messenger', '1', postback);
  const b = identifiantEvenement('messenger', '1', JSON.parse(JSON.stringify(postback)));
  const autre = identifiantEvenement('messenger', '1', { ...postback, postback: { payload: 'HORAIRES' } });
  assert.equal(a, b, 'deux livraisons du même événement doivent donner le même identifiant');
  assert.notEqual(a, autre);
  assert.match(a, /^evt_[0-9a-f]{32}$/);
});

test('rangerEvenements : une erreur de dépôt est comptée, pas propagée', async () => {
  const depot = {
    async existe() { return false; },
    async inserer() { throw new Error('base indisponible'); },
  };
  const evenements = normaliserCharge(CHARGE_MESSENGER, { recuLe: new Date() });
  const { traces } = await avecConsoleMuette(() => rangerEvenements({ depot, evenements }));
  assert.ok(traces.some((t) => t.includes('Rangement impossible')));
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. Messenger vs Instagram, et contenu des logs
   ═══════════════════════════════════════════════════════════════════════════ */

test('les entrées page et instagram sont distinguées', async () => {
  await avecEnv({ META_APP_SECRET: SECRET }, async () => {
    const depot = depotMemoire();
    const gestionnaire = creerGestionnaireMetaWebhook({ depot });
    await avecConsoleMuette(() => gestionnaire(requetePost(JSON.stringify(CHARGE_MESSENGER)), fausseReponse()));
    await avecConsoleMuette(() => gestionnaire(requetePost(JSON.stringify(CHARGE_INSTAGRAM)), fausseReponse()));
    assert.deepEqual(depot.lignes.map((l) => l.canal), ['messenger', 'instagram']);
    assert.deepEqual(depot.lignes.map((l) => l.objet_abonnement), ['page', 'instagram']);
  });
  assert.equal(canalDepuisObjet('page'), 'messenger');
  assert.equal(canalDepuisObjet('instagram'), 'instagram');
  assert.equal(canalDepuisObjet('permissions'), 'inconnu');
});

test('les logs ne recopient JAMAIS le contenu des messages clients', async () => {
  await avecEnv({ META_APP_SECRET: SECRET }, async () => {
    const depot = depotMemoire();
    const res = fausseReponse();
    const { traces } = await avecConsoleMuette(() => creerGestionnaireMetaWebhook({ depot })(
      requetePost(JSON.stringify(CHARGE_MESSENGER)), res,
    ));
    const tout = traces.join('\n');
    assert.ok(!tout.includes('500 flyers'), 'le texte du client ne doit pas apparaître dans les logs');
    assert.ok(!tout.includes('PSID-CLIENT-1'), 'l identifiant du client non plus');
    assert.ok(tout.includes('messenger'), 'le canal, lui, doit être journalisé');
    // Mais il est bien conservé en base : c est l objet de cet endpoint.
    assert.equal(depot.lignes[0].evenement.message.text, 'Bonjour, prix pour 500 flyers A5 ?');
  });
});

test('la date de réception est la date LOCALE de l entreprise, pas la date UTC', () => {
  // 23 h 30 UTC = le lendemain à Libreville. `.toISOString().slice(0,10)` rendrait
  // la veille (écart de 55 300 F constaté en mars sur le même motif).
  const instant = new Date('2026-09-17T23:30:00Z');
  const attendu = new Intl.DateTimeFormat('fr-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
  const docs = normaliserCharge(CHARGE_MESSENGER, { recuLe: instant });
  assert.equal(docs[0].date_reception, attendu);
});

test('une charge malformée ne fait pas tomber l endpoint', async () => {
  await avecEnv({ META_APP_SECRET: SECRET }, async () => {
    const depot = depotMemoire();
    for (const corps of ['pas du json', '{}', '{"object":"page"}', '{"object":"page","entry":"x"}', '[]']) {
      const res = fausseReponse();
      await avecConsoleMuette(() => creerGestionnaireMetaWebhook({ depot })(requetePost(corps), res));
      assert.equal(res.code, 200, `Meta doit recevoir 200 même pour : ${corps}`);
    }
    assert.equal(depot.lignes.length, 0);
  });
});

test('une méthode autre que GET/POST répond 405', async () => {
  const res = fausseReponse();
  await avecConsoleMuette(() => creerGestionnaireMetaWebhook()({ method: 'PUT', headers: {}, url: '/x' }, res));
  assert.equal(res.code, 405);
  assert.equal(res.entetes.allow, 'GET, POST');
});

/* ═══════════════════════════════════════════════════════════════════════════
   6. L'endpoint encaisse ; il ne parle pas lui-même
   ═══════════════════════════════════════════════════════════════════════════

   ✏️ RÉÉCRIT LE 19/09/2026. Ce test exigeait auparavant que le bot ne réponde à
   personne, et que l'avertissement « CE BOT NE RÉPOND À PERSONNE » reste en
   tête du fichier. Le dirigeant a demandé le bot ; il existe depuis aujourd'hui.

   Ce que la garantie devient — et elle reste utile : l'ENDPOINT ne contient
   aucun appel sortant. Recevoir et répondre sont deux gestes, et le second vit
   dans `api/_lib/bot-envoi.js`, où il est testable hors ligne. Un `fetch` qui
   apparaîtrait ici serait un appel réseau AVANT ou APRÈS le 200 sans passer par
   le verrou de catalogue : c'est exactement ce qu'on ne veut pas. */

test('⛔ l endpoint lui-même ne contient AUCUN appel sortant', () => {
  const src = readFileSync(new URL('../api/meta-webhook.js', import.meta.url), 'utf8');
  assert.ok(!src.includes('graph.facebook.com'), 'aucun appel à l API Graph ne doit exister ici');
  assert.ok(!/\bfetch\s*\(/.test(src), 'aucun appel réseau sortant ne doit exister ici');
  assert.ok(src.includes('bot-envoi.js'), 'l envoi passe par le module dédié, jamais en ligne droite');
});

test('⛔ l endpoint ne fait AUCUNE écriture métier', () => {
  const src = readFileSync(new URL('../api/meta-webhook.js', import.meta.url), 'utf8');
  for (const collection of ['commandes', 'clients', 'devis', 'factures', 'produits']) {
    assert.ok(!src.includes(`'${collection}'`),
      `le bot ne touche pas à ${collection} : il répond, il ne crée rien`);
  }
});

test('aucun secret n est écrit en dur', () => {
  const src = readFileSync(new URL('../api/meta-webhook.js', import.meta.url), 'utf8');
  assert.ok(src.includes('process.env.META_VERIFY_TOKEN'));
  assert.ok(src.includes('process.env.META_APP_SECRET'));
  // Une valeur en dur ressemblerait à une affectation de chaîne longue.
  assert.ok(!/META_(VERIFY_TOKEN|APP_SECRET)\s*=\s*['"][^'"]{8,}/.test(src));
});

test('la collection de rangement est bien messages_meta', () => {
  assert.equal(COLLECTION_MESSAGES, 'messages_meta');
});
