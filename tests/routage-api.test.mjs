/**
 * ROUTAGE DES POINTS D'ENTRÉE FUSIONNÉS
 *
 * Contexte (17/09/2026) : le plan Vercel Hobby plafonne le projet à 12
 * fonctions serverless. `api/` en comptait 13, et le déploiement du commit
 * `c97fae8` échouait à « Deploying outputs » alors que le build réussissait.
 * Trois endpoints SingPay ont été regroupés derrière `api/singpay.js`, et
 * `zakat-analyse` derrière `api/ai.js`. Les URL publiques, elles, n'ont PAS
 * changé : elles sont conservées par des `rewrites` dans `vercel.json`.
 *
 * Ce que ce fichier protège, et qui n'est pas négociable :
 *
 *  1. chaque ancien chemin atteint la MÊME logique qu'avant ;
 *  2. un chemin inconnu sous `/api/singpay…` ne tombe JAMAIS silencieusement
 *     sur une branche voisine — ces trois voies écrivent en base et touchent de
 *     l'argent réel ;
 *  3. `/api/zakat-analyse` garde son contrat exact, y compris l'ABSENCE d'en-têtes
 *     CORS et son 405 sur OPTIONS, que `/api/ai` traite différemment ;
 *  4. les `rewrites` restent AVANT la règle générique `/api/(.*)` (la première
 *     règle qui correspond gagne) et la règle attrape-tout de l'application
 *     reste la dernière ;
 *  5. le dossier `api/` ne repasse pas au-dessus de 12 fonctions.
 *
 * Lancer :  node --test tests/routage-api.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/* `api/_lib/singpay-initiate.js` construit un client Supabase au chargement du
   module : sans URL, l'import lui-même jette. Ces deux variables ne servent qu'à
   permettre l'import. Aucun test ci-dessous ne provoque d'appel réseau : toutes
   les branches visées répondent avant la première requête sortante. */
process.env.SUPABASE_URL ||= 'https://exemple-de-test.supabase.co';
process.env.SUPABASE_SERVICE_KEY ||= 'cle-de-test-sans-effet';
/* Mode « ouvert » du rappel : sans ce secret, `verifierSecretCallback` laisse
   passer (comportement de production actuel), ce qui permet d'observer la
   branche réellement atteinte plutôt qu'un 401 d'authentification. */
delete process.env.SINGPAY_CALLBACK_SECRET;

const { default: singpay, voieSingPay, VOIES_SINGPAY, CHEMINS_SINGPAY } = await import('../api/singpay.js');
const { default: ia, voieIA } = await import('../api/ai.js');
const { voieDemandee, cheminDemande } = await import('../api/_lib/routage.js');

const racine = new URL('../', import.meta.url);
const lire = (chemin) => readFileSync(new URL(chemin, racine), 'utf8');

/** Réponse factice : enregistre code, corps et en-têtes sans rien envoyer. */
function fausseReponse() {
  const r = { code: null, corps: null, entetes: {}, termine: false };
  r.status = (c) => { r.code = c; return r; };
  r.json = (o) => { r.corps = o; r.termine = true; return r; };
  r.send = (o) => { r.corps = o; r.termine = true; return r; };
  r.end = () => { r.termine = true; return r; };
  r.setHeader = (k, v) => { r.entetes[String(k).toLowerCase()] = v; return r; };
  return r;
}

const requete = ({ method = 'GET', url = '/', query = {}, headers = {}, body = {} } = {}) =>
  ({ method, url, query, headers, body });

/* ═══════════════════════════════════════════════════════════════════════════
   1. RÉSOLUTION DE LA VOIE — la brique, testée sans réseau ni base
   ═══════════════════════════════════════════════════════════════════════════ */

test('cheminDemande normalise les trois formes d URL rencontrees', () => {
  assert.equal(cheminDemande({ url: '/api/singpay-status' }), '/api/singpay-status');
  assert.equal(cheminDemande({ url: '/api/singpay-status?reference=OGO-1' }), '/api/singpay-status');
  assert.equal(cheminDemande({ url: 'https://imprimerie.example/api/singpay-status?a=1' }), '/api/singpay-status');
  assert.equal(cheminDemande({ url: '/api/singpay-status/' }), '/api/singpay-status');
  assert.equal(cheminDemande({}), '');
});

test('SINGPAY : chaque chemin public historique designe sa voie', () => {
  // Cas d'un hote qui conserverait le chemin d'origine (execution locale, proxy).
  assert.equal(voieSingPay(requete({ url: '/api/singpay-initiate' })), 'initiate');
  assert.equal(voieSingPay(requete({ url: '/api/singpay-status?reference=OGO-1' })), 'status');
  assert.equal(voieSingPay(requete({ url: '/api/singpay-callback?token=abc' })), 'callback');
});

test('SINGPAY : le parametre pose par le rewrite designe sa voie', () => {
  // Cas nominal en production : Vercel a deja reecrit le chemin.
  for (const voie of VOIES_SINGPAY) {
    assert.equal(
      voieSingPay(requete({ url: `/api/singpay?voie=${voie}`, query: { voie } })), voie,
      `le rewrite vers ?voie=${voie} doit atteindre la voie ${voie}`,
    );
  }
});

test('SINGPAY : le chemin historique l emporte sur un parametre contradictoire', () => {
  // L'adresse reellement composee fait foi. Pour `/api/singpay-callback`, c'est
  // celle qui est ENREGISTREE chez SingPay sur le portefeuille.
  const r = requete({ url: '/api/singpay-callback?voie=status', query: { voie: 'status' } });
  assert.equal(voieSingPay(r), 'callback');
});

test('SINGPAY : une voie inventee n est jamais servie', () => {
  assert.equal(voieSingPay(requete({ url: '/api/singpay', query: {} })), null);
  assert.equal(voieSingPay(requete({ url: '/api/singpay?voie=bidon', query: { voie: 'bidon' } })), null);
  assert.equal(voieSingPay(requete({ url: '/api/singpay?voie=', query: { voie: '' } })), null);
  assert.equal(voieSingPay(requete({ url: '/api/singpay-inconnu' })), null);
  // Un parametre repete : seule une valeur de la liste blanche est retenue.
  assert.equal(voieSingPay(requete({ url: '/api/singpay', query: { voie: ['bidon', 'status'] } })), 'status');
  assert.equal(voieSingPay(requete({ url: '/api/singpay', query: { voie: ['bidon', 'autre'] } })), null);
});

test('le point d entree lui-meme n est jamais dans la table des chemins', () => {
  // Sinon il porterait TOUTES les voies reecrites et gagnerait a chaque fois.
  assert.ok(!Object.keys(CHEMINS_SINGPAY).includes('/api/singpay'));
  assert.deepEqual(Object.values(CHEMINS_SINGPAY).sort(), [...VOIES_SINGPAY].sort());
});

test('voieDemandee : un defaut hors liste blanche ne peut pas etre servi', () => {
  assert.equal(voieDemandee(requete({ url: '/api/x' }), { voies: ['a'], defaut: 'z' }), null);
  assert.equal(voieDemandee(requete({ url: '/api/x' }), { voies: ['a'], defaut: 'a' }), 'a');
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. CHAQUE ANCIEN CHEMIN ATTEINT BIEN LA BONNE LOGIQUE

   Chaque voie est identifiee par une reponse qu'elle SEULE produit, atteinte
   avant tout appel reseau :
     - initiate : refus de methode (POST seul)
     - status   : « Reference manquante »
     - callback : « Reference ou transaction_id requis »
   ═══════════════════════════════════════════════════════════════════════════ */

const SIGNATURES = [
  {
    voie: 'initiate',
    chemin: '/api/singpay-initiate',
    // GET sur un endpoint qui n'accepte que POST : premiere ligne du handler.
    appel: { method: 'GET' },
    code: 405,
    motif: /Method not allowed/,
  },
  {
    voie: 'status',
    chemin: '/api/singpay-status',
    appel: { method: 'GET' },
    code: 400,
    motif: /Reference manquante/,
  },
  {
    voie: 'callback',
    chemin: '/api/singpay-callback',
    appel: { method: 'GET' },
    code: 400,
    motif: /Reference ou transaction_id requis/,
  },
];

for (const s of SIGNATURES) {
  test(`SINGPAY : ${s.chemin} (chemin conserve) atteint la logique « ${s.voie} »`, async () => {
    const res = fausseReponse();
    await singpay(requete({ ...s.appel, url: s.chemin }), res);
    assert.equal(res.code, s.code);
    assert.match(String(res.corps?.error), s.motif);
  });

  test(`SINGPAY : le rewrite ?voie=${s.voie} atteint la meme logique`, async () => {
    const res = fausseReponse();
    await singpay(requete({ ...s.appel, url: `/api/singpay?voie=${s.voie}`, query: { voie: s.voie } }), res);
    assert.equal(res.code, s.code);
    assert.match(String(res.corps?.error), s.motif);
  });
}

test('SINGPAY : un chemin inconnu est refuse en 404, jamais route au hasard', async () => {
  for (const url of ['/api/singpay', '/api/singpay?voie=bidon', '/api/singpay?voie=']) {
    const res = fausseReponse();
    const query = url.includes('=') ? { voie: url.split('=')[1] } : {};
    await singpay(requete({ method: 'POST', url, query }), res);
    assert.equal(res.code, 404, `${url} doit etre refuse`);
    assert.match(String(res.corps?.error), /Voie SingPay inconnue/);
    // La reponse dit quoi appeler : un 404 muet coute une demi-journee.
    assert.match(String(res.corps?.detail), /singpay-initiate/);
    assert.match(String(res.corps?.detail), /singpay-callback/);
  }
});

test('SINGPAY : le routage ne consomme aucun parametre metier', () => {
  /* Vercel fusionne la chaine de requete d'origine avec celle de la destination :
     `?reference=…` (sondage) et `?token=…` (secret du rappel) arrivent donc
     intacts. Ce que ce test verifie, c'est que RIEN de notre cote ne les
     efface : le routage lit `voie` et ne reecrit pas `req.query`, et les deux
     handlers continuent de lire les memes champs qu'avant.
     (La fusion elle-meme appartient a la passerelle : elle se constate sur un
     deploiement de previsualisation, pas dans un test local.) */
  const q = { voie: 'status', reference: 'OGO-abcdef-1' };
  const r = requete({ method: 'GET', url: '/api/singpay?voie=status&reference=OGO-abcdef-1', query: q });
  assert.equal(voieSingPay(r), 'status');
  assert.deepEqual(r.query, { voie: 'status', reference: 'OGO-abcdef-1' }, 'req.query doit rester intact');

  assert.match(lire('api/_lib/singpay-status.js'), /const \{ reference \} = req\.query;/,
    'la voie status doit continuer de lire la reference dans la chaine de requete');
  assert.match(lire('api/_lib/singpay-encaissement.js'), /query\.token \|\| query\.secret/,
    'le secret du rappel doit continuer d etre lu dans la chaine de requete');
  // Aucun rewrite ne doit poser un parametre qui masquerait ceux-la.
  for (const [, destination] of REWRITES_ATTENDUS) {
    const params = new URL(destination, 'https://x').searchParams;
    assert.deepEqual([...params.keys()], ['voie'], `${destination} ne doit poser que « voie »`);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. /api/ai ET /api/zakat-analyse — DEUX CONTRATS DIFFERENTS, UN FICHIER

   Le signe distinctif est l'en-tete CORS : `/api/ai` en pose depuis toujours,
   `/api/zakat-analyse` n'en a JAMAIS pose. C'est pour cela que le routage a
   lieu avant le bloc CORS.
   ═══════════════════════════════════════════════════════════════════════════ */

test('IA : /api/ai reste la voie par defaut du point d entree', () => {
  assert.equal(voieIA(requete({ url: '/api/ai' })), 'ai');
  assert.equal(voieIA(requete({ url: '/api/ai?voie=zakat', query: { voie: 'zakat' } })), 'zakat');
  assert.equal(voieIA(requete({ url: '/api/zakat-analyse' })), 'zakat');
  // Une voie inventee retombe sur le proxy IA, pas sur zakat.
  assert.equal(voieIA(requete({ url: '/api/ai?voie=bidon', query: { voie: 'bidon' } })), 'ai');
});

test('IA : OPTIONS sur /api/ai repond 200 avec CORS (contrat inchange)', async () => {
  const res = fausseReponse();
  await ia(requete({ method: 'OPTIONS', url: '/api/ai' }), res);
  assert.equal(res.code, 200);
  assert.ok(res.entetes['access-control-allow-origin'], 'le proxy IA doit continuer a poser CORS');
});

test('IA : OPTIONS sur /api/zakat-analyse repond 405 SANS CORS (contrat inchange)', async () => {
  const res = fausseReponse();
  await ia(requete({ method: 'OPTIONS', url: '/api/ai?voie=zakat', query: { voie: 'zakat' } }), res);
  assert.equal(res.code, 405, 'zakat n a jamais traite le preflight : il repondait 405');
  assert.deepEqual(res.entetes, {}, 'zakat n a jamais pose d en-tete CORS — le fusionner ne doit pas en ajouter');
});

test('IA : sans session, les deux voies repondent 401 — chacune a sa maniere', async () => {
  const resZakat = fausseReponse();
  await ia(requete({ method: 'POST', url: '/api/ai?voie=zakat', query: { voie: 'zakat' }, body: {} }), resZakat);
  assert.equal(resZakat.code, 401);
  assert.match(String(resZakat.corps?.error), /Authentification requise/);
  assert.deepEqual(resZakat.entetes, {}, 'toujours pas de CORS sur la voie zakat');

  const resAi = fausseReponse();
  await ia(requete({ method: 'POST', url: '/api/ai', body: {} }), resAi);
  assert.equal(resAi.code, 401);
  assert.ok(resAi.entetes['access-control-allow-origin'], 'le proxy IA garde ses en-tetes');
});

test('IA : les deux voies ne se partagent PAS le meme plafond de debit', () => {
  // Avant la fusion, deux fonctions = deux processus = deux compteurs. Depuis,
  // le module `limite.js` est charge une seule fois : sans `portee`, consommer
  // les 30 appels/min de `/api/ai` aurait suffi a faire refuser
  // `/api/zakat-analyse` (plafond 10) sans l avoir appele une seule fois.
  const proxy = lire('api/ai.js');
  const zakat = lire('api/_lib/zakat-analyse.js');
  assert.match(proxy, /portee:\s*'ai'/, 'le proxy IA doit nommer sa portee');
  assert.match(zakat, /portee:\s*'zakat'/, 'la voie zakat doit nommer sa portee');
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. LA CONFIGURATION QUI FAIT TENIR TOUT CELA
   ═══════════════════════════════════════════════════════════════════════════ */

const REWRITES_ATTENDUS = [
  ['/api/singpay-initiate', '/api/singpay?voie=initiate'],
  ['/api/singpay-status', '/api/singpay?voie=status'],
  ['/api/singpay-callback', '/api/singpay?voie=callback'],
  ['/api/zakat-analyse', '/api/ai?voie=zakat'],
];

test('vercel.json : les quatre rewrites existent, AVANT la regle generique', () => {
  const conf = JSON.parse(lire('vercel.json'));
  const sources = conf.rewrites.map((r) => r.source);
  const iGenerique = sources.indexOf('/api/(.*)');
  assert.ok(iGenerique > 0, 'la regle generique /api/(.*) doit rester presente');

  for (const [source, destination] of REWRITES_ATTENDUS) {
    const i = sources.indexOf(source);
    assert.ok(i !== -1, `le rewrite ${source} est absent : l URL publique ne repond plus`);
    assert.equal(conf.rewrites[i].destination, destination);
    assert.ok(
      i < iGenerique,
      `${source} est apres /api/(.*) : la premiere regle qui correspond gagne, `
      + 'donc il serait reecrit vers un fichier qui n existe plus (404)',
    );
  }
});

test('vercel.json : la navigation de l application reste intacte', () => {
  const conf = JSON.parse(lire('vercel.json'));
  const dernier = conf.rewrites[conf.rewrites.length - 1];
  assert.equal(dernier.destination, '/index.html', 'la regle attrape-tout SPA doit rester la derniere');
  assert.equal(dernier.source, '/((?!api/).*)', 'elle doit continuer d exclure /api/');
  // Toute route React (y compris une qui contient le mot « api ») doit y aller.
  const motif = new RegExp(`^${dernier.source}$`);
  for (const route of ['/', '/commandes', '/client/commandes', '/zakat', '/parametres/apiculture']) {
    assert.match(route, motif, `la route ${route} doit encore atteindre index.html`);
  }
  for (const route of ['/api/singpay-callback', '/api/ai']) {
    assert.ok(!motif.test(route), `${route} ne doit jamais atterrir sur index.html`);
  }
});

test('PLAFOND HOBBY : le dossier api/ reste sous 12 fonctions serverless', () => {
  // C'est la regression qui a bloque TOUS les deploiements le 17/09/2026 :
  // build vert, puis ERROR a « Deploying outputs ». Rien dans le code ne le
  // disait ; ce test le dit.
  const dossier = fileURLToPath(new URL('api/', racine));
  const fonctions = readdirSync(dossier).filter((f) => f.endsWith('.js'));
  assert.ok(
    fonctions.length <= 12,
    `${fonctions.length} fonctions dans api/ (${fonctions.join(', ')}) — `
    + 'le plan Hobby en accepte 12 au maximum. Regrouper, ou passer au plan Pro.',
  );
  // Les fichiers prefixes par `_` ne sont pas exposes par Vercel : c'est ce qui
  // rend le regroupement possible. Ils doivent rester la ou ils sont.
  for (const f of ['singpay-initiate.js', 'singpay-status.js', 'singpay-callback.js', 'zakat-analyse.js']) {
    assert.ok(
      existsSync(fileURLToPath(new URL(`api/_lib/${f}`, racine))),
      `api/_lib/${f} a disparu : le point d entree fusionne ne peut plus router`,
    );
    assert.ok(
      !fonctions.includes(f),
      `api/${f} est revenu a la racine : la fonction est comptee deux fois dans le plafond`,
    );
  }
});
