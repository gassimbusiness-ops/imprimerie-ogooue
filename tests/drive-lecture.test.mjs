/**
 * LE LECTEUR GOOGLE DRIVE — la moitié manquante de la chaîne d'auto-publication.
 *
 * ── Pourquoi ce fichier existe ────────────────────────────────────────────
 *
 * Avant le 18/09/2026, `api/autopost.js` VÉRIFIAIT que trois variables Google
 * étaient présentes et affichait « Accès Drive configuré » quand elles y
 * étaient. Aucune ligne de code n'allait chercher un fichier dans le Drive.
 * Le voyant pouvait donc passer au vert sans que rien ne fonctionne — le même
 * faux témoin que le badge « Sans mdp » et que le score fabriqué à 0.
 *
 * Ces tests exigent l'inverse : que le voyant DISE ce qui se passe vraiment, et
 * qu'il distingue les quatre pannes, parce que chacune appelle un geste
 * différent :
 *
 *   1. « non configuré »              → Gassim doit poser les variables ;
 *   2. « clé privée refusée »         → la clé est mal collée ou révoquée ;
 *   3. « dossier non partagé »        → Gassim a oublié le partage, ou s'est
 *                                        trompé d'identifiant de dossier.
 *                                        C'EST L'ERREUR LA PLUS PROBABLE ;
 *   4. « aucune publication déposée » → tout marche, ChatGPT n'a rien mis.
 *
 * Un message unique pour quatre causes fait perdre une heure.
 *
 * ⛔ ZÉRO APPEL RÉSEAU : `fetch` est injecté. On simule Google, y compris ses
 *    réponses d'erreur réelles (`invalid_grant`, 404 sur le dossier, 403).
 *
 * Lancer :  node --test tests/drive-lecture.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  DIAGNOSTICS,
  PORTEE_DRIVE_LECTURE,
  URL_JETON,
  normaliserClePrivee,
  lireConfigurationDrive,
  construireJwt,
  creerClientDrive,
  sonderDrive,
  viderCacheJeton,
} from '../api/_lib/drive.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Matériel de test — une VRAIE paire de clés RSA, générée une fois.
   Les signatures sont donc réellement vérifiées, pas comparées à une chaîne.
   ═══════════════════════════════════════════════════════════════════════════ */

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

/** La clé au format du JSON de compte de service : vrais retours à la ligne. */
const CLE_VRAIS_SAUTS = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

/** La même clé telle que Vercel la rend parfois : `\n` en DEUX caractères. */
const CLE_ANTISLASH_N = CLE_VRAIS_SAUTS.replace(/\n/g, '\\n');

const EMAIL = 'ogooue-autopost-drive@gen-lang-client-0985654381.iam.gserviceaccount.com';
const DOSSIER = '1AbCdEfGhIjKlMnOpQrStUvWxYz';

function env(cle = CLE_VRAIS_SAUTS, { email = EMAIL, dossier = DOSSIER } = {}) {
  return {
    GOOGLE_SERVICE_ACCOUNT_EMAIL: email,
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: cle,
    DRIVE_DOSSIER_PUBLICATIONS_ID: dossier,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Le faux Google. Il route par URL et enregistre TOUT ce qui sort.
   ═══════════════════════════════════════════════════════════════════════════ */

function fauxGoogle({ jeton = null, listes = {}, fichiers = {}, recherche = null, expireIn = 3600 } = {}) {
  const appels = [];
  const impl = async (url, options = {}) => {
    const u = String(url);
    const methode = options.method || 'GET';
    appels.push({ url: u, methode, entetes: options.headers || {}, corps: options.body ?? null });

    /* ── L'échange du JWT contre un jeton d'accès ────────────────────────── */
    if (u.startsWith(URL_JETON)) {
      if (jeton && jeton.echec) {
        return {
          ok: false,
          status: jeton.statut ?? 400,
          async text() { return JSON.stringify(jeton.echec); },
          async json() { return jeton.echec; },
        };
      }
      return {
        ok: true,
        status: 200,
        async text() { return JSON.stringify({ access_token: jeton?.valeur ?? 'ya29.JETON', expires_in: expireIn, token_type: 'Bearer' }); },
        async json() { return { access_token: jeton?.valeur ?? 'ya29.JETON', expires_in: expireIn, token_type: 'Bearer' }; },
      };
    }

    /* ── Le téléchargement d'un fichier (alt=media) ──────────────────────── */
    const dl = u.match(/\/drive\/v3\/files\/([^/?]+)\?.*alt=media/);
    if (dl) {
      const contenu = fichiers[dl[1]];
      if (contenu === undefined) {
        return { ok: false, status: 404, async text() { return JSON.stringify({ error: { code: 404, message: 'File not found' } }); } };
      }
      return { ok: true, status: 200, async text() { return contenu; } };
    }

    /* ── La RECHERCHE PAR NOM ────────────────────────────────────────────
       `name = 'publication.json'`, sans `in parents`. Le vrai Google la sert
       sur tout ce que le robot peut voir ; le faux la sert depuis `recherche`. */
    const qBrut = decodeURIComponent(((u.match(/[?&]q=([^&]*)/) || [])[1] || '').replace(/\+/g, ' '));
    const parNom = qBrut.match(/^name = '([^']+)' and trashed = false$/);
    if (parNom) {
      if (recherche && recherche.statut) {
        return { ok: false, status: recherche.statut, async text() { return JSON.stringify(recherche.corps ?? {}); } };
      }
      const trouves = (recherche && recherche[parNom[1]]) || [];
      return { ok: true, status: 200, async text() { return JSON.stringify({ files: trouves }); } };
    }

    /* ── Le listing d'un dossier ─────────────────────────────────────────── */
    // `+` vaut espace dans une chaîne de requête : c'est ce que fait un vrai
    // serveur, et ce que `URLSearchParams` produit. Décoder sans le faire
    // donnerait un faux Google plus tolérant que le vrai.
    const q = decodeURIComponent(((u.match(/[?&]q=([^&]*)/) || [])[1] || '').replace(/\+/g, ' '));
    const parent = (q.match(/'([^']+)' in parents/) || [])[1];
    const reponse = listes[parent];
    if (reponse === undefined) {
      return { ok: false, status: 404, async text() { return JSON.stringify({ error: { code: 404, message: 'File not found: ' + parent } }); } };
    }
    if (reponse && reponse.statut) {
      return { ok: false, status: reponse.statut, async text() { return JSON.stringify(reponse.corps ?? {}); } };
    }
    const page = (u.match(/[?&]pageToken=([^&]*)/) || [])[1] || null;
    const pages = Array.isArray(reponse) ? [{ files: reponse }] : reponse.pages;
    const index = page ? Number(page) : 0;
    const courante = pages[index] || { files: [] };
    const charge = { files: courante.files };
    if (index + 1 < pages.length) charge.nextPageToken = String(index + 1);
    return { ok: true, status: 200, async text() { return JSON.stringify(charge); } };
  };
  return { impl, appels };
}

const DOSSIER_MIME = 'application/vnd.google-apps.folder';
const f = (id, name, mimeType = 'image/jpeg') => ({ id, name, mimeType });
const d = (id, name) => ({ id, name, mimeType: DOSSIER_MIME });

/* ═══════════════════════════════════════════════════════════════════════════
   Une publication CONFORME au contrat v2.0, qu'on abîme ensuite champ par champ
   ═══════════════════════════════════════════════════════════════════════════ */

const MEDIA = '2026-09-21_OGOOUE_Textile_1080x1350_v01_BROUILLON.jpg';

function manifeste(modifs = {}) {
  return {
    schema_version: '2.0',
    publication_id: 'PUB-2026-S39-1-01',
    campagne_id: 'CAMP-RENTREE-2026-09',
    version_contenu: 1,
    semaine_iso: '2026-S39',
    annee_iso: 2026,
    numero_semaine_iso: 39,
    jour_iso: 1,
    date_locale: '2026-09-21',
    creneau: {
      date_locale: '2026-09-21',
      heure_locale: '09:00',
      fuseau: 'Africa/Libreville',
      offset_utc: '+01:00',
      instant_utc: '2026-09-21T08:00:00Z',
      tolerance_minutes: 90,
    },
    format: 'photo',
    mode_execution: 'dry_run',
    medias: [{
      role: 'principal',
      canal_cible: ['facebook', 'instagram'],
      chemin_relatif: MEDIA,
      mime_type: 'image/jpeg',
      largeur_px: 1080,
      hauteur_px: 1350,
      ordre_carrousel: 1,
      origine: 'chatgpt',
    }],
    captions: {
      facebook: { chemin_relatif: 'caption_facebook.txt', caracteres: 612, hashtags: 3 },
    },
    cta: 'Envoyez la date, les quantités et votre logo',
    code_provenance: 'OG-01-S39',
    offres: [{ offre_id: null, libelle: 'aucune offre chiffrée', prix_affiche: false, valide_jusqu_au_local: null }],
    canaux: [{ canal: 'facebook', compte_cible_id: '100000000000001', surface: 'feed' }],
    ...modifs,
  };
}

/**
 * Un Drive à la forme réelle : dossier des publications → semaine → jour →
 * dossier de la publication, qui porte `publication.json` et son média.
 */
function driveAvecUnePublication({ contenuJson = JSON.stringify(manifeste()), mediaNom = MEDIA, avecMedia = true } = {}) {
  const fichiersDuDossier = [f('f-json', 'publication.json', 'application/json')];
  if (avecMedia) fichiersDuDossier.push(f('f-media', mediaNom));
  return fauxGoogle({
    listes: {
      [DOSSIER]: [d('w1', 'WEEK_21-27Sept')],
      w1: [d('j1', 'Lundi_21_Sept')],
      j1: [d('p1', '1_POST_09H00')],
      p1: fichiersDuDossier,
    },
    fichiers: { 'f-json': contenuJson },
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   A. LA CLÉ PRIVÉE — le piège n°1
   ═══════════════════════════════════════════════════════════════════════════ */

test('la clé privée est acceptée avec de VRAIS retours à la ligne', () => {
  const normalisee = normaliserClePrivee(CLE_VRAIS_SAUTS);
  assert.ok(normalisee, 'la forme du JSON de compte de service doit passer');
  assert.match(normalisee, /^-----BEGIN PRIVATE KEY-----\n/);
  assert.match(normalisee, /-----END PRIVATE KEY-----\n?$/);
});

test('la clé privée est acceptée avec la suite de deux caractères \\n', () => {
  assert.ok(!CLE_ANTISLASH_N.includes('\n'), 'la fixture doit bien être sur une seule ligne');
  assert.equal(normaliserClePrivee(CLE_ANTISLASH_N), normaliserClePrivee(CLE_VRAIS_SAUTS));
});

test('les DEUX formats de clé produisent une signature que Google pourrait vérifier', () => {
  const a = construireJwt({ email: EMAIL, clePrivee: CLE_VRAIS_SAUTS, maintenantMs: 1_758_000_000_000 });
  const b = construireJwt({ email: EMAIL, clePrivee: CLE_ANTISLASH_N, maintenantMs: 1_758_000_000_000 });
  assert.equal(a, b, 'une clé mal lue produirait une signature différente — ou une erreur incompréhensible');

  const [entete, charge, signature] = a.split('.');
  const verifiee = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${entete}.${charge}`),
    publicKey,
    Buffer.from(signature, 'base64url'),
  );
  assert.equal(verifiee, true, 'la signature RS256 doit être vérifiable avec la clé publique');
});

test('une clé entourée de guillemets (collage Vercel) est acceptée', () => {
  assert.equal(normaliserClePrivee(`"${CLE_ANTISLASH_N}"`), normaliserClePrivee(CLE_VRAIS_SAUTS));
});

test('une valeur qui n est pas une clé PEM est refusée, pas devinée', () => {
  assert.equal(normaliserClePrivee('collez la clé ici'), null);
  assert.equal(normaliserClePrivee(''), null);
  assert.equal(normaliserClePrivee(null), null);
  assert.equal(normaliserClePrivee(undefined), null);
});

/* ═══════════════════════════════════════════════════════════════════════════
   B. LE JWT — la forme exacte que le point d'accès de Google attend
   ═══════════════════════════════════════════════════════════════════════════ */

test('le JWT porte alg RS256, la portée LECTURE SEULE, et une heure d expiration', () => {
  const maintenantMs = 1_758_000_000_000;
  const jwt = construireJwt({ email: EMAIL, clePrivee: CLE_VRAIS_SAUTS, maintenantMs });
  const [e, c] = jwt.split('.').slice(0, 2)
    .map((p) => JSON.parse(Buffer.from(p, 'base64url').toString('utf8')));

  assert.deepEqual(e, { alg: 'RS256', typ: 'JWT' });
  assert.equal(c.iss, EMAIL);
  assert.equal(c.scope, PORTEE_DRIVE_LECTURE);
  assert.equal(c.aud, URL_JETON);
  assert.equal(c.iat, Math.floor(maintenantMs / 1000));
  assert.equal(c.exp, Math.floor(maintenantMs / 1000) + 3600);
});

test('⛔ la portée demandée est la LECTURE SEULE — on ne demande jamais le droit d écrire', () => {
  assert.equal(PORTEE_DRIVE_LECTURE, 'https://www.googleapis.com/auth/drive.readonly');
});

/* ═══════════════════════════════════════════════════════════════════════════
   C. LES QUATRE ÉTATS — le cœur de la mission
   ═══════════════════════════════════════════════════════════════════════════ */

test('ÉTAT 1 — variables absentes : « non configuré », et AUCUN appel réseau', async () => {
  viderCacheJeton();
  const g = fauxGoogle();
  const etat = await sonderDrive({ env: {}, fetchImpl: g.impl });
  assert.equal(etat.diagnostic, DIAGNOSTICS.NON_CONFIGURE);
  assert.match(etat.message, /non configuré/i);
  assert.equal(g.appels.length, 0, 'sans variables, rien ne doit sortir sur le réseau');
});

test('ÉTAT 1 — le message NOMME les variables qui manquent', async () => {
  viderCacheJeton();
  const g = fauxGoogle();
  const partiel = { GOOGLE_SERVICE_ACCOUNT_EMAIL: EMAIL };
  const etat = await sonderDrive({ env: partiel, fetchImpl: g.impl });
  assert.equal(etat.diagnostic, DIAGNOSTICS.NON_CONFIGURE);
  assert.match(etat.message, /GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY/);
  assert.match(etat.message, /DRIVE_DOSSIER_PUBLICATIONS_ID/);
  assert.doesNotMatch(etat.message, /GOOGLE_SERVICE_ACCOUNT_EMAIL\b/, 'celle qui est là ne doit pas être réclamée');
});

test('ÉTAT 1 — une variable présente mais vide compte comme absente', async () => {
  viderCacheJeton();
  const config = lireConfigurationDrive({ ...env(), DRIVE_DOSSIER_PUBLICATIONS_ID: '   ' });
  assert.equal(config.configure, false);
  assert.deepEqual(config.manquantes, ['DRIVE_DOSSIER_PUBLICATIONS_ID']);
});

test('ÉTAT 2 — Google répond invalid_grant : « la clé privée est refusée par Google »', async () => {
  viderCacheJeton();
  const g = fauxGoogle({
    jeton: { echec: { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }, statut: 400 },
  });
  const etat = await sonderDrive({ env: env(), fetchImpl: g.impl });
  assert.equal(etat.diagnostic, DIAGNOSTICS.CLE_REFUSEE);
  assert.match(etat.message, /clé privée/i);
  assert.match(etat.message, /refusée/i);
  assert.match(String(etat.detail), /invalid_grant/, 'le brut de Google doit rester lisible');
  assert.ok(etat.piste, 'chaque panne doit porter le geste qui la répare');
});

test('ÉTAT 2 — une clé illisible est refusée SANS appel réseau, et le dit', async () => {
  viderCacheJeton();
  const g = fauxGoogle();
  const etat = await sonderDrive({ env: env('pas une clé du tout'), fetchImpl: g.impl });
  assert.equal(etat.diagnostic, DIAGNOSTICS.CLE_REFUSEE);
  assert.match(etat.message, /clé privée/i);
  assert.equal(g.appels.length, 0, 'inutile d appeler Google avec une clé qu on sait illisible');
});

test('ÉTAT 3 — 404 sur le dossier : « le dossier n est pas partagé avec le robot »', async () => {
  viderCacheJeton();
  const g = fauxGoogle({ listes: {} }); // aucun dossier connu → 404
  const etat = await sonderDrive({ env: env(), fetchImpl: g.impl });
  assert.equal(etat.diagnostic, DIAGNOSTICS.DOSSIER_INACCESSIBLE);
  assert.match(etat.message, /n'est pas partagé|n’est pas partagé/);
  assert.match(String(etat.piste), new RegExp(EMAIL.replace(/[.@]/g, '.')), 'la piste doit donner l adresse à qui partager');
  assert.match(String(etat.piste) + String(etat.detail), new RegExp(DOSSIER), 'et l identifiant de dossier interrogé');
});

test('ÉTAT 3 — 403 sur le dossier : même famille, détail différent', async () => {
  viderCacheJeton();
  const g = fauxGoogle({
    listes: { [DOSSIER]: { statut: 403, corps: { error: { code: 403, message: 'Insufficient permissions' } } } },
  });
  const etat = await sonderDrive({ env: env(), fetchImpl: g.impl });
  assert.equal(etat.diagnostic, DIAGNOSTICS.DOSSIER_INACCESSIBLE);
  assert.match(String(etat.detail), /403/);
  assert.match(String(etat.detail), /Insufficient permissions/);
});

test('ÉTAT 4 — le dossier est lisible mais vide : « aucune publication déposée »', async () => {
  viderCacheJeton();
  const g = fauxGoogle({ listes: { [DOSSIER]: [] } });
  const etat = await sonderDrive({ env: env(), fetchImpl: g.impl });
  assert.equal(etat.diagnostic, DIAGNOSTICS.DOSSIER_VIDE);
  assert.match(etat.message, /aucune publication déposée/i);
});

test('ÉTAT 0 — tout marche : le sondage compte ce qu il a VU, pas ce qu il espère', async () => {
  viderCacheJeton();
  const g = fauxGoogle({
    listes: {
      [DOSSIER]: [d('w1', 'WEEK_21-27Sept'), d('w2', 'WEEK_28Sept-04Oct'), f('x', 'LISEZ-MOI.txt', 'text/plain')],
      w1: [d('p1', '1_POST_09H00')],
      p1: [f('f-json', 'publication.json', 'application/json'), f('f-media', MEDIA)],
      w2: [], // la semaine suivante n'est pas encore remplie
    },
  });
  const etat = await sonderDrive({ env: env(), fetchImpl: g.impl });
  assert.equal(etat.diagnostic, DIAGNOSTICS.OK);
  assert.equal(etat.sous_dossiers, 3, 'deux semaines, plus le dossier de la publication');
  assert.equal(etat.fichiers, 3, 'le LISEZ-MOI, le manifeste et le média');
  assert.equal(etat.publications_trouvees, 1);
});

test('⛔ LES QUATRE PANNES NE SE RESSEMBLENT PAS — un message unique ferait perdre une heure', async () => {
  viderCacheJeton();
  const cas = [
    ['non configuré', await sonderDrive({ env: {}, fetchImpl: fauxGoogle().impl })],
    ['clé refusée', await sonderDrive({
      env: env(),
      fetchImpl: fauxGoogle({ jeton: { echec: { error: 'invalid_grant' } } }).impl,
    })],
    ['dossier', await sonderDrive({ env: env(), fetchImpl: fauxGoogle({ listes: {} }).impl })],
    ['vide', await sonderDrive({ env: env(), fetchImpl: fauxGoogle({ listes: { [DOSSIER]: [] } }).impl })],
  ];
  const diagnostics = new Set(cas.map(([, e]) => e.diagnostic));
  const messages = new Set(cas.map(([, e]) => e.message));
  assert.equal(diagnostics.size, 4, 'quatre causes, quatre diagnostics');
  assert.equal(messages.size, 4, 'quatre causes, quatre phrases');
  for (const [nom, e] of cas) {
    assert.ok(e.piste && e.piste.length > 20, `« ${nom} » doit dire quoi faire, pas seulement ce qui ne va pas`);
  }
});

test('une panne de réseau ne se déguise pas en « dossier vide »', async () => {
  viderCacheJeton();
  const etat = await sonderDrive({
    env: env(),
    fetchImpl: async () => { throw new Error('ECONNRESET'); },
  });
  assert.equal(etat.diagnostic, DIAGNOSTICS.PANNE);
  assert.match(String(etat.detail), /ECONNRESET/);
});

test('sonderDrive ne lève JAMAIS : un écran ne doit pas blanchir parce que Google tousse', async () => {
  viderCacheJeton();
  const etat = await sonderDrive({ env: env(), fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  assert.ok(etat && typeof etat.message === 'string');
});

/* ═══════════════════════════════════════════════════════════════════════════
   D. LE JETON GARDÉ EN MÉMOIRE
   ═══════════════════════════════════════════════════════════════════════════ */

test('le jeton est redemandé UNE fois, pas à chaque appel', async () => {
  viderCacheJeton();
  const g = fauxGoogle({ listes: { [DOSSIER]: [d('w1', 'WEEK_21-27Sept')], w1: [] } });
  const client = creerClientDrive({ env: env(), fetchImpl: g.impl });
  await client.listerDossier(DOSSIER);
  await client.listerDossier('w1');
  await client.listerDossier(DOSSIER);
  const jetons = g.appels.filter((a) => a.url.startsWith(URL_JETON));
  assert.equal(jetons.length, 1, 'un jeton valide se réutilise');
});

test('un jeton expiré est redemandé — la marge de sécurité ne le laisse pas mourir en vol', async () => {
  viderCacheJeton();
  const g = fauxGoogle({ listes: { [DOSSIER]: [] }, expireIn: 3600 });
  let horloge = 1_758_000_000_000;
  const client = creerClientDrive({ env: env(), fetchImpl: g.impl, maintenant: () => new Date(horloge) });
  await client.listerDossier(DOSSIER);
  horloge += 3_560_000; // 59 min 20 s plus tard : il ne reste que 40 s, moins que la marge
  await client.listerDossier(DOSSIER);
  const jetons = g.appels.filter((a) => a.url.startsWith(URL_JETON));
  assert.equal(jetons.length, 2, 'un jeton qui expire dans moins d une minute doit être renouvelé');
});

test('viderCacheJeton() remet le cache à zéro — sinon les tests se contaminent', async () => {
  viderCacheJeton();
  const g = fauxGoogle({ listes: { [DOSSIER]: [] } });
  const client = creerClientDrive({ env: env(), fetchImpl: g.impl });
  await client.listerDossier(DOSSIER);
  viderCacheJeton();
  await client.listerDossier(DOSSIER);
  assert.equal(g.appels.filter((a) => a.url.startsWith(URL_JETON)).length, 2);
});

/* ═══════════════════════════════════════════════════════════════════════════
   E. LISTER ET TÉLÉCHARGER
   ═══════════════════════════════════════════════════════════════════════════ */

test('le listing demande le bon dossier, exclut la corbeille, et suit la pagination', async () => {
  viderCacheJeton();
  const g = fauxGoogle({
    listes: {
      [DOSSIER]: { pages: [{ files: [d('a', 'A')] }, { files: [d('b', 'B')] }] },
    },
  });
  const client = creerClientDrive({ env: env(), fetchImpl: g.impl });
  const entrees = await client.listerDossier(DOSSIER);
  assert.deepEqual(entrees.map((x) => x.id), ['a', 'b'], 'les deux pages doivent être ramenées');

  const listings = g.appels.filter((a) => a.url.includes('/drive/v3/files?'));
  assert.equal(listings.length, 2);
  const q = decodeURIComponent((listings[0].url.match(/[?&]q=([^&]*)/) || [])[1].replace(/\+/g, ' '));
  assert.match(q, new RegExp(`'${DOSSIER}' in parents`));
  assert.match(q, /trashed\s*=\s*false/, 'la corbeille n est pas du contenu');
});

test('le téléchargement passe par alt=media et rend le contenu tel quel', async () => {
  viderCacheJeton();
  const g = fauxGoogle({ listes: { [DOSSIER]: [] }, fichiers: { 'f-json': '{"bonjour":"Moanda"}' } });
  const client = creerClientDrive({ env: env(), fetchImpl: g.impl });
  const contenu = await client.telechargerFichier('f-json');
  assert.equal(contenu, '{"bonjour":"Moanda"}');
  assert.match(g.appels.at(-1).url, /\/drive\/v3\/files\/f-json\?.*alt=media/);
});

test('chaque appel Drive porte le jeton en en-tête — jamais dans l URL', async () => {
  viderCacheJeton();
  const g = fauxGoogle({ jeton: { valeur: 'ya29.SECRET' }, listes: { [DOSSIER]: [] } });
  const client = creerClientDrive({ env: env(), fetchImpl: g.impl });
  await client.listerDossier(DOSSIER);
  const drive = g.appels.filter((a) => a.url.includes('/drive/v3/'));
  assert.ok(drive.length >= 1);
  for (const a of drive) {
    assert.equal(a.entetes.Authorization, 'Bearer ya29.SECRET');
    assert.doesNotMatch(a.url, /ya29\.SECRET/, 'un jeton dans une URL finit dans les journaux');
  }
});

test('⛔ la clé privée ne sort JAMAIS : ni en URL, ni en en-tête, ni dans un message', async () => {
  viderCacheJeton();
  const g = fauxGoogle({ listes: { [DOSSIER]: [] } });
  const client = creerClientDrive({ env: env(), fetchImpl: g.impl });
  await client.listerDossier(DOSSIER);
  const corpsCle = CLE_VRAIS_SAUTS.split('\n')[1].slice(0, 30);
  for (const a of g.appels) {
    assert.doesNotMatch(a.url, new RegExp(corpsCle.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')));
    assert.equal(JSON.stringify(a.entetes).includes(corpsCle), false);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   F. LE CONTRAT — ce qui ne le respecte pas est ÉCARTÉ, jamais réparé
   ═══════════════════════════════════════════════════════════════════════════ */

test('une publication conforme est lue, avec son média localisé dans le dossier', async () => {
  viderCacheJeton();
  const g = driveAvecUnePublication();
  const client = creerClientDrive({ env: env(), fetchImpl: g.impl });
  const lot = await client.lirePublications();

  assert.equal(lot.diagnostic, DIAGNOSTICS.OK);
  assert.equal(lot.publications.length, 1);
  assert.equal(lot.ecartees.length, 0);
  const p = lot.publications[0];
  assert.equal(p.publication.publication_id, 'PUB-2026-S39-1-01');
  assert.equal(p.dossier_nom, '1_POST_09H00');
  assert.match(p.chemin, /WEEK_21-27Sept\/Lundi_21_Sept\/1_POST_09H00/);
  assert.equal(p.medias.length, 1);
  assert.equal(p.medias[0].fichier_id, 'f-media');
});

test('⛔ le manifeste rendu est EXACTEMENT celui du Drive — aucune réparation en silence', async () => {
  viderCacheJeton();
  const original = manifeste();
  const g = driveAvecUnePublication({ contenuJson: JSON.stringify(original) });
  const client = creerClientDrive({ env: env(), fetchImpl: g.impl });
  const lot = await client.lirePublications();
  assert.deepEqual(lot.publications[0].publication, original);
});

test('un dossier sans publication.json est écarté avec un motif lisible', async () => {
  viderCacheJeton();
  const g = fauxGoogle({
    listes: { [DOSSIER]: [d('w1', 'WEEK_21-27Sept')], w1: [d('j1', 'Lundi_21_Sept')], j1: [d('p1', '1_POST_09H00')], p1: [f('m', MEDIA)] },
  });
  const client = creerClientDrive({ env: env(), fetchImpl: g.impl });
  const lot = await client.lirePublications();
  assert.equal(lot.publications.length, 0);
  assert.equal(lot.ecartees.length, 1);
  assert.match(lot.ecartees[0].motif, /publication\.json/);
});

test('un publication.json illisible est écarté, pas deviné', async () => {
  viderCacheJeton();
  const g = driveAvecUnePublication({ contenuJson: '{ ceci n est pas du JSON' });
  const client = creerClientDrive({ env: env(), fetchImpl: g.impl });
  const lot = await client.lirePublications();
  assert.equal(lot.publications.length, 0);
  assert.match(lot.ecartees[0].motif, /illisible|JSON/i);
});

test('schema_version autre que 2.0 : écarté, et le motif le NOMME', async () => {
  viderCacheJeton();
  const g = driveAvecUnePublication({ contenuJson: JSON.stringify(manifeste({ schema_version: '1.0' })) });
  const client = creerClientDrive({ env: env(), fetchImpl: g.impl });
  const lot = await client.lirePublications();
  assert.equal(lot.publications.length, 0);
  assert.match(lot.ecartees[0].motif, /schema_version/);
});

test('publication_id hors motif PUB-AAAA-Snn-J-nn : écarté', async () => {
  viderCacheJeton();
  const g = driveAvecUnePublication({ contenuJson: JSON.stringify(manifeste({ publication_id: 'POST-1' })) });
  const client = creerClientDrive({ env: env(), fetchImpl: g.impl });
  const lot = await client.lirePublications();
  assert.equal(lot.publications.length, 0);
  assert.match(lot.ecartees[0].motif, /publication_id/);
});

test('medias vide : écarté — il n y a rien à publier', async () => {
  viderCacheJeton();
  const g = driveAvecUnePublication({ contenuJson: JSON.stringify(manifeste({ medias: [] })) });
  const client = creerClientDrive({ env: env(), fetchImpl: g.impl });
  const lot = await client.lirePublications();
  assert.equal(lot.publications.length, 0);
  assert.match(lot.ecartees[0].motif, /medias/);
});

test('bloc canaux absent : écarté — aucune destination', async () => {
  viderCacheJeton();
  const sans = manifeste();
  delete sans.canaux;
  const g = driveAvecUnePublication({ contenuJson: JSON.stringify(sans) });
  const client = creerClientDrive({ env: env(), fetchImpl: g.impl });
  const lot = await client.lirePublications();
  assert.equal(lot.publications.length, 0);
  assert.match(lot.ecartees[0].motif, /canaux/);
});

test('un média annoncé mais ABSENT du dossier : écarté — on ne publie pas un fichier introuvable', async () => {
  viderCacheJeton();
  const g = driveAvecUnePublication({ avecMedia: false });
  const client = creerClientDrive({ env: env(), fetchImpl: g.impl });
  const lot = await client.lirePublications();
  assert.equal(lot.publications.length, 0);
  assert.match(lot.ecartees[0].motif, new RegExp(MEDIA.slice(0, 20)));
});

test('⛔ un média nommé _APPROUVE est écarté : ChatGPT ne s approuve pas lui-même', async () => {
  viderCacheJeton();
  const nom = '2026-09-21_OGOOUE_Textile_1080x1350_v01_APPROUVE.jpg';
  const g = driveAvecUnePublication({
    contenuJson: JSON.stringify(manifeste({
      medias: [{ ...manifeste().medias[0], chemin_relatif: nom }],
    })),
    mediaNom: nom,
  });
  const client = creerClientDrive({ env: env(), fetchImpl: g.impl });
  const lot = await client.lirePublications();
  assert.equal(lot.publications.length, 0);
  assert.match(lot.ecartees[0].motif, /BROUILLON|APPROUVE/);
});

test('un dossier vide donne « aucune publication déposée », pas une liste vide muette', async () => {
  viderCacheJeton();
  const g = fauxGoogle({ listes: { [DOSSIER]: [] } });
  const client = creerClientDrive({ env: env(), fetchImpl: g.impl });
  const lot = await client.lirePublications();
  assert.equal(lot.diagnostic, DIAGNOSTICS.DOSSIER_VIDE);
  assert.match(lot.message, /aucune publication déposée/i);
});

test('une publication conforme et une cassée cohabitent : la bonne passe, la mauvaise est dite', async () => {
  viderCacheJeton();
  const g = fauxGoogle({
    listes: {
      [DOSSIER]: [d('j1', 'Lundi_21_Sept')],
      j1: [d('p1', '1_POST_09H00'), d('p2', '2_REEL_17H30')],
      p1: [f('j-ok', 'publication.json', 'application/json'), f('m-ok', MEDIA)],
      p2: [f('j-ko', 'publication.json', 'application/json')],
    },
    fichiers: {
      'j-ok': JSON.stringify(manifeste()),
      'j-ko': JSON.stringify(manifeste({ schema_version: '1.0', publication_id: 'PUB-2026-S39-1-02' })),
    },
  });
  const client = creerClientDrive({ env: env(), fetchImpl: g.impl });
  const lot = await client.lirePublications();
  assert.equal(lot.publications.length, 1);
  assert.equal(lot.publications[0].publication.publication_id, 'PUB-2026-S39-1-01');
  assert.equal(lot.ecartees.length, 1);
  assert.equal(lot.ecartees[0].dossier_nom, '2_REEL_17H30');
});

test('APPROBATION.json est lu quand il est là, et son absence n est pas une approbation', async () => {
  viderCacheJeton();
  const g = fauxGoogle({
    listes: {
      [DOSSIER]: [d('p1', '1_POST_09H00')],
      p1: [f('j', 'publication.json', 'application/json'), f('a', 'APPROBATION.json', 'application/json'), f('m', MEDIA)],
    },
    fichiers: {
      j: JSON.stringify(manifeste()),
      a: JSON.stringify({ approuve: true, publication_id: 'PUB-2026-S39-1-01', version_contenu: 1, canaux_approuves: ['facebook'] }),
    },
  });
  const client = creerClientDrive({ env: env(), fetchImpl: g.impl });
  const lot = await client.lirePublications();
  assert.equal(lot.publications[0].approbation.approuve, true);

  viderCacheJeton();
  const sans = driveAvecUnePublication();
  const client2 = creerClientDrive({ env: env(), fetchImpl: sans.impl });
  const lot2 = await client2.lirePublications();
  assert.equal(lot2.publications[0].approbation, null, 'absente veut dire null, jamais « approuvé par défaut »');
});

/* ═══════════════════════════════════════════════════════════════════════════
   G. LECTURE SEULE, ET RIEN D'AUTRE — prouvé sur les appels ET sur la source
   ═══════════════════════════════════════════════════════════════════════════ */

test('⛔ une lecture complète du Drive n émet QUE des GET (plus l échange de jeton)', async () => {
  viderCacheJeton();
  const g = driveAvecUnePublication();
  const client = creerClientDrive({ env: env(), fetchImpl: g.impl });
  await client.lirePublications();
  for (const a of g.appels) {
    if (a.url.startsWith(URL_JETON)) {
      assert.equal(a.methode, 'POST', 'l échange du JWT est le seul POST légitime');
      continue;
    }
    assert.equal(a.methode, 'GET', `écriture interdite : ${a.methode} ${a.url}`);
  }
});

test('⛔ la source du module ne contient AUCUNE portée en écriture', () => {
  const source = readFileSync(fileURLToPath(new URL('../api/_lib/drive.js', import.meta.url)), 'utf8');
  for (const interdit of ['auth/drive.file', 'auth/drive.appdata', "auth/drive'", 'auth/drive"', 'drive.metadata.readonly.']) {
    assert.equal(source.includes(interdit), false, `portée interdite dans la source : ${interdit}`);
  }
  assert.equal(/uploadType=/.test(source), false, 'aucun téléversement');
});

test('⛔ sur le serveur, todayISO() ment : le module passe par dateLocaleDepuisInstantUtc', () => {
  const source = readFileSync(fileURLToPath(new URL('../api/_lib/drive.js', import.meta.url)), 'utf8');
  assert.equal(/\btodayISO\s*\(/.test(source), false, 'todayISO rend la date du serveur Vercel, pas celle de Moanda');
  assert.equal(/\btoISODate\s*\(/.test(source), false);
  assert.match(source, /dateLocaleDepuisInstantUtc/);
});

test('la date locale d une lecture est celle de MOANDA, pas celle du serveur', async () => {
  viderCacheJeton();
  const g = fauxGoogle({ listes: { [DOSSIER]: [d('w1', 'W')] } });
  // 23 h 30 UTC le 21 → il est déjà 00 h 30 le 22 à Moanda (UTC+1).
  const etat = await sonderDrive({
    env: env(),
    fetchImpl: g.impl,
    maintenant: () => new Date(Date.UTC(2026, 8, 21, 23, 30, 0)),
  });
  assert.equal(etat.verifie_le_utc, '2026-09-21T23:30:00Z');
  assert.equal(etat.date_locale, '2026-09-22');
});

/* ═══════════════════════════════════════════════════════════════════════════
   H. LE BRANCHEMENT SUR LA CHAÎNE EXISTANTE

   Le module ne sert à rien tant que l'écran ne voit que le booléen
   `acces_drive_configure`. La voie `/api/autopost-etat` doit porter le
   DIAGNOSTIC, pas la présence des variables.

   ⚠️ Et une panne du Drive ne doit pas faire tomber la lecture d'état : la file
   et le journal restent lisibles même quand Google est injoignable.
   ═══════════════════════════════════════════════════════════════════════════ */

process.env.SESSION_SECRET = process.env.SESSION_SECRET
  || 'secret-de-test-assez-long-pour-passer-la-garde-32';

const { signerSession } = await import('../api/_lib/session.js');
const { creerGestionnaireAutopost } = await import('../api/autopost.js');

function fausseReponse() {
  const r = {
    code: null,
    charge: null,
    entetes: {},
    status(c) { r.code = c; return r; },
    json(x) { r.charge = x; return r; },
    setHeader(k, v) { r.entetes[k] = v; },
  };
  return r;
}

/** Un dépôt inerte : la file et le journal répondent, rien n'est écrit. */
const DEPOT_INERTE = {
  async lireEtatComplet() { return []; },
  async lireJournal() { return []; },
  async lireArretGlobal() { return { actif: false, mode: 'dry_run', plafond: 4 }; },
};

async function lireEtat({ sonde }) {
  const req = {
    url: '/api/autopost-etat',
    method: 'GET',
    query: {},
    headers: {
      authorization: `Bearer ${signerSession({ id: 'u-admin', role: 'admin' })}`,
      'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 250) + 1}`,
    },
  };
  const res = fausseReponse();
  await creerGestionnaireAutopost({ depot: DEPOT_INERTE, sonde })(req, res);
  return res;
}

test('⛔ /api/autopost-etat porte le DIAGNOSTIC du Drive, pas seulement un booléen', async () => {
  viderCacheJeton();
  const res = await lireEtat({
    sonde: () => sonderDrive({ env: env(), fetchImpl: fauxGoogle({ listes: {} }).impl }),
  });
  assert.equal(res.code, 200);
  assert.ok(res.charge.drive, 'la réponse doit porter un bloc drive');
  assert.equal(res.charge.drive.diagnostic, DIAGNOSTICS.DOSSIER_INACCESSIBLE);
  assert.match(res.charge.drive.message, /n'est pas partagé|n’est pas partagé/);
  assert.ok(res.charge.drive.piste, 'et le geste qui répare');
});

test('les quatre états traversent l API sans se confondre', async () => {
  viderCacheJeton();
  const attendus = [
    [{}, fauxGoogle().impl, DIAGNOSTICS.NON_CONFIGURE],
    [env(), fauxGoogle({ jeton: { echec: { error: 'invalid_grant' } } }).impl, DIAGNOSTICS.CLE_REFUSEE],
    [env(), fauxGoogle({ listes: {} }).impl, DIAGNOSTICS.DOSSIER_INACCESSIBLE],
    [env(), fauxGoogle({ listes: { [DOSSIER]: [] } }).impl, DIAGNOSTICS.DOSSIER_VIDE],
  ];
  const vus = [];
  for (const [e, impl, attendu] of attendus) {
    viderCacheJeton();
    const res = await lireEtat({ sonde: () => sonderDrive({ env: e, fetchImpl: impl }) });
    assert.equal(res.charge.drive.diagnostic, attendu);
    vus.push(res.charge.drive.message);
  }
  assert.equal(new Set(vus).size, 4, 'quatre causes, quatre phrases, jusque dans la réponse HTTP');
});

test('⛔ un Drive injoignable ne fait PAS tomber la lecture d état', async () => {
  viderCacheJeton();
  const res = await lireEtat({
    sonde: () => sonderDrive({ env: env(), fetchImpl: async () => { throw new Error('ECONNRESET'); } }),
  });
  assert.equal(res.code, 200, 'la file et le journal restent lisibles');
  assert.equal(res.charge.drive.diagnostic, DIAGNOSTICS.PANNE);
  assert.ok(Array.isArray(res.charge.file));
});

test('une sonde qui lève quand même est rattrapée : jamais de 500 pour ça', async () => {
  const res = await lireEtat({ sonde: async () => { throw new TypeError('sonde cassée'); } });
  assert.equal(res.code, 200);
  assert.equal(res.charge.drive.diagnostic, DIAGNOSTICS.PANNE);
});

test('acces_drive_configure reste cohérent avec le diagnostic', async () => {
  viderCacheJeton();
  const res = await lireEtat({ sonde: () => sonderDrive({ env: {}, fetchImpl: fauxGoogle().impl }) });
  assert.equal(res.charge.drive.diagnostic, DIAGNOSTICS.NON_CONFIGURE);
  assert.equal(res.charge.acces_drive_configure, false);
});

/* ═══════════════════════════════════════════════════════════════════════════
   I. DEUX DISPOSITIONS DE DOSSIERS, ET UN DÉPÔT QUI NE RESSEMBLE À RIEN

   Relevé terrain du 18/09/2026 : ChatGPT a déposé 77 fichiers — mais dans
   `10_PUBLICATIONS/_INBOX_CHATGPT/WEEK_21-27Sept/<jour>/`, alors que le contrat
   décrit `10_PUBLICATIONS/WEEK_xx-xxMois/Jour_xx_Mois/`, sans le niveau
   `_INBOX_CHATGPT`.

   Deux exigences en découlent, et aucune n'est cosmétique :

     1. AUCUN CHEMIN EN DUR. Le lecteur part de DRIVE_DOSSIER_PUBLICATIONS_ID et
        descend jusqu'à trouver un `publication.json`. Les deux dispositions
        doivent marcher, et celle qu'on n'a pas encore vue aussi.

     2. « 77 fichiers présents, aucun conforme » ne doit JAMAIS s'afficher
        « aucune publication déposée ». Gassim chercherait au mauvais endroit —
        il irait revérifier un partage de dossier qui marche très bien.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Le dépôt réel : un niveau `_INBOX_CHATGPT` de plus, fichiers dans le jour. */
function driveInboxChatgpt({ avecManifeste = true, fichiersEnPlus = [] } = {}) {
  const duJour = [
    f('m-feed', '2026-09-21_OGOOUE_Textile_1080x1350_v01_BROUILLON.jpg'),
    f('m-story', '2026-09-21_OGOOUE_Textile_1080x1920_v01_BROUILLON.jpg'),
    f('c-fb', 'caption_facebook.txt', 'text/plain'),
    f('c-ig', 'caption_instagram.txt', 'text/plain'),
    f('c-wa', 'caption_whatsapp.txt', 'text/plain'),
    f('brief', 'brief.md', 'text/markdown'),
    f('depot', 'DEPOT.json', 'application/json'),
    ...fichiersEnPlus,
  ];
  if (avecManifeste) duJour.unshift(f('f-json', 'publication.json', 'application/json'));

  return fauxGoogle({
    listes: {
      [DOSSIER]: [d('inbox', '_INBOX_CHATGPT')],
      inbox: [d('w1', 'WEEK_21-27Sept')],
      w1: [d('j1', 'Lundi_21_Sept')],
      j1: duJour,
    },
    fichiers: { 'f-json': JSON.stringify(manifeste()) },
  });
}

test('DISPOSITION A — WEEK/Jour/publication à la racine : lue', async () => {
  viderCacheJeton();
  const g = driveAvecUnePublication();
  const lot = await creerClientDrive({ env: env(), fetchImpl: g.impl }).lirePublications();
  assert.equal(lot.publications.length, 1);
  assert.equal(lot.publications[0].publication.publication_id, 'PUB-2026-S39-1-01');
});

test('DISPOSITION B — _INBOX_CHATGPT/WEEK/Jour : lue AUSSI, sans chemin en dur', async () => {
  viderCacheJeton();
  const g = driveInboxChatgpt();
  const lot = await creerClientDrive({ env: env(), fetchImpl: g.impl }).lirePublications();
  assert.equal(lot.diagnostic, DIAGNOSTICS.OK);
  assert.equal(lot.publications.length, 1, 'le niveau _INBOX_CHATGPT ne doit rien casser');
  assert.match(lot.publications[0].chemin, /_INBOX_CHATGPT\/WEEK_21-27Sept\/Lundi_21_Sept/);
  assert.equal(lot.publications[0].medias.length, 1);
});

test('⛔ aucun chemin en dur : ni _INBOX_CHATGPT, ni WEEK_, ni un nom de jour', () => {
  const source = readFileSync(fileURLToPath(new URL('../api/_lib/drive.js', import.meta.url)), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const interdit of ['_INBOX_CHATGPT', 'WEEK_', 'Lundi', '10_PUBLICATIONS/']) {
    assert.equal(code.includes(interdit), false,
      `chemin en dur dans le code : ${interdit} — la disposition changera encore`);
  }
});

test('⛔ 77 fichiers déposés hors contrat : ce n est PAS « aucune publication déposée »', async () => {
  viderCacheJeton();
  const bruit = Array.from({ length: 70 }, (_, i) => f(`x${i}`, `fichier_${i}.txt`, 'text/plain'));
  const g = driveInboxChatgpt({ avecManifeste: false, fichiersEnPlus: bruit });
  const lot = await creerClientDrive({ env: env(), fetchImpl: g.impl }).lirePublications();

  assert.equal(lot.publications.length, 0);
  assert.notEqual(lot.diagnostic, DIAGNOSTICS.DOSSIER_VIDE,
    'dire « vide » enverrait Gassim vérifier un partage qui marche');
  assert.doesNotMatch(lot.message, /aucune publication déposée/i);
  assert.match(lot.message, /conforme/i);
  assert.equal(lot.ecartees.length, 1);
  assert.match(lot.ecartees[0].motif, /publication\.json/);
  assert.match(lot.ecartees[0].motif, /77/, 'le motif doit dire COMBIEN de fichiers sont là');
});

test('le motif NOMME quelques-uns des fichiers trouvés — pas juste un compte', async () => {
  viderCacheJeton();
  const g = driveInboxChatgpt({ avecManifeste: false });
  const lot = await creerClientDrive({ env: env(), fetchImpl: g.impl }).lirePublications();
  assert.match(lot.ecartees[0].motif, /DEPOT\.json|caption_facebook\.txt|brief\.md/);
});

test('⛔ le SONDAGE de l écran dit aussi « des fichiers, mais rien de conforme »', async () => {
  viderCacheJeton();
  const bruit = Array.from({ length: 70 }, (_, i) => f(`x${i}`, `fichier_${i}.txt`, 'text/plain'));
  const g = driveInboxChatgpt({ avecManifeste: false, fichiersEnPlus: bruit });
  const etat = await sonderDrive({ env: env(), fetchImpl: g.impl });

  assert.notEqual(etat.diagnostic, DIAGNOSTICS.DOSSIER_VIDE);
  assert.notEqual(etat.diagnostic, DIAGNOSTICS.OK, 'rien de publiable n est pas « opérationnel »');
  assert.match(etat.message, /77 fichier/);
  assert.match(etat.message, /conforme/i);
  assert.ok(etat.piste && etat.piste.length > 20);
});

test('le sondage VOIT une publication même enfouie sous _INBOX_CHATGPT', async () => {
  viderCacheJeton();
  const g = driveInboxChatgpt();
  const etat = await sonderDrive({ env: env(), fetchImpl: g.impl });
  assert.equal(etat.diagnostic, DIAGNOSTICS.OK);
  assert.equal(etat.publications_trouvees, 1);
});

test('le sondage ne télécharge RIEN : il ne fait que lister', async () => {
  viderCacheJeton();
  const g = driveInboxChatgpt();
  await sonderDrive({ env: env(), fetchImpl: g.impl });
  const telechargements = g.appels.filter((a) => a.url.includes('alt=media'));
  assert.equal(telechargements.length, 0, 'une lecture d écran ne doit pas tirer les fichiers');
});

test('un sous-dossier illisible ne fait pas passer TOUT le Drive pour non partagé', async () => {
  viderCacheJeton();
  const g = fauxGoogle({
    listes: {
      [DOSSIER]: [d('bon', 'WEEK_21-27Sept'), d('interdit', 'WEEK_28Sept-04Oct')],
      bon: [f('f-json', 'publication.json', 'application/json'), f('f-media', MEDIA)],
      // `interdit` n'est pas dans la table : le faux Google répond 404.
    },
    fichiers: { 'f-json': JSON.stringify(manifeste()) },
  });
  const lot = await creerClientDrive({ env: env(), fetchImpl: g.impl }).lirePublications();
  assert.equal(lot.publications.length, 1, 'la branche lisible doit être rendue');
  assert.ok(
    lot.ecartees.some((e) => /inaccessible|404/i.test(e.motif)),
    'et la branche illisible doit être DITE, pas tue',
  );
});

test('le sondage reste borné : une arborescence profonde ne fait pas cent requêtes', async () => {
  viderCacheJeton();
  const listes = { [DOSSIER]: Array.from({ length: 40 }, (_, i) => d(`n${i}`, `DOSSIER_${i}`)) };
  for (let i = 0; i < 40; i += 1) listes[`n${i}`] = [f(`f${i}`, `x${i}.txt`, 'text/plain')];
  const g = fauxGoogle({ listes });
  await sonderDrive({ env: env(), fetchImpl: g.impl });
  const listings = g.appels.filter((a) => a.url.includes('/drive/v3/files?'));
  // La borne a ete portee de 12 a 30 listings le 18/09/2026 : le Drive reel
  // demandait 15 listings AVANT d'atteindre le premier publication.json, et le
  // sondage s'arretait donc a « 1 fichier trouve » alors que 77 attendaient deux
  // niveaux plus bas. Ce que ce test garde, ce n'est pas le chiffre 15 — c'est
  // qu'une arborescence de 40 dossiers ne declenche PAS 41 requetes.
  assert.ok(listings.length <= 31, `sondage trop bavard : ${listings.length} listings`);
  assert.ok(listings.length < 41, 'le sondage a parcouru toute l arborescence : la borne ne borne plus');
});

test('un publication.json qui ne se télécharge pas n emporte pas les autres', async () => {
  viderCacheJeton();
  const g = fauxGoogle({
    listes: {
      [DOSSIER]: [d('p1', '1_POST_09H00'), d('p2', '2_REEL_17H30')],
      p1: [f('j-ok', 'publication.json', 'application/json'), f('m-ok', MEDIA)],
      // `j-absent` n'est pas dans la table `fichiers` : le téléchargement rend 404.
      p2: [f('j-absent', 'publication.json', 'application/json')],
    },
    fichiers: { 'j-ok': JSON.stringify(manifeste()) },
  });
  const lot = await creerClientDrive({ env: env(), fetchImpl: g.impl }).lirePublications();
  assert.equal(lot.publications.length, 1, 'la publication lisible doit survivre');
  assert.equal(lot.ecartees.length, 1);
  assert.match(lot.ecartees[0].motif, /illisible|inaccessible|404/i);
});


/* ═══════════════════════════════════════════════════════════════════════════
   ON DEMANDE AVANT DE FOUILLER — la recherche par nom
   ═══════════════════════════════════════════════════════════════════════════ */

test('le sondage DEMANDE ou sont les publication.json au lieu de tout fouiller', async () => {
  viderCacheJeton();
  // L'arborescence reelle du 18/09 : 4 semaines de 7 jours. Le parcours en
  // largeur epuise n'importe quel budget avant d'atteindre les manifestes,
  // qui vivent au TROISIEME niveau.
  const listes = { [DOSSIER]: [] };
  for (let s = 0; s < 4; s += 1) {
    const idSem = `sem${s}`;
    listes[DOSSIER].push(d(idSem, `WEEK_${s}`));
    listes[idSem] = [];
    for (let j = 0; j < 7; j += 1) {
      const idJour = `sem${s}j${j}`;
      listes[idSem].push(d(idJour, `Jour_${j}`));
      listes[idJour] = [d(`${idJour}p`, '1_POST_09H00')];
      listes[`${idJour}p`] = [f(`${idJour}m`, 'publication.json', 'application/json')];
    }
  }
  const g = fauxGoogle({
    listes,
    recherche: { 'publication.json': Array.from({ length: 28 }, (_, i) => ({ id: `m${i}`, name: 'publication.json' })) },
  });

  const etat = await sonderDrive({ env: env(), fetchImpl: g.impl });

  assert.equal(etat.diagnostic, 'ok', `attendu « ok », recu « ${etat.diagnostic} » : ${etat.message}`);
  assert.equal(etat.publications_trouvees, 28);

  const recherches = g.appels.filter((a) => /name = /.test(decodeURIComponent(a.url.replace(/\+/g, ' '))));
  const listings = g.appels.filter((a) => /in parents/.test(decodeURIComponent(a.url.replace(/\+/g, ' '))));
  assert.equal(recherches.length, 1, 'une seule requete doit suffire a repondre');
  assert.ok(listings.length <= 1, `le parcours ne doit plus servir : ${listings.length} listings`);
});

test('recherche muette : on retombe sur le parcours, qui sait dire POURQUOI', async () => {
  viderCacheJeton();
  // Le cas du 18/09 : des fichiers, aucun manifeste. La recherche ne rend rien,
  // et ce n'est PAS « dossier vide » — c'est un depot hors format.
  const g = fauxGoogle({
    listes: { [DOSSIER]: [f('a', 'LISEZ-MOI.md', 'text/markdown'), f('b', 'APERCU.jpg')] },
    recherche: { 'publication.json': [] },
  });
  const etat = await sonderDrive({ env: env(), fetchImpl: g.impl });
  assert.equal(etat.diagnostic, 'rien_de_conforme',
    'des fichiers sans manifeste ne doivent JAMAIS etre annonces comme un dossier vide');
  assert.match(etat.message, /2 fichier/);
});

test('recherche en panne : le parcours prend le relais sans faire echouer le sondage', async () => {
  viderCacheJeton();
  const g = fauxGoogle({
    listes: {
      [DOSSIER]: [d('p1', '1_POST_09H00')],
      p1: [f('j1', 'publication.json', 'application/json')],
    },
    recherche: { statut: 500, corps: { error: { code: 500, message: 'backend error' } } },
  });
  const etat = await sonderDrive({ env: env(), fetchImpl: g.impl });
  assert.equal(etat.diagnostic, 'ok', 'une recherche en panne ne doit pas casser le sondage');
  assert.equal(etat.publications_trouvees, 1, 'le parcours doit retrouver ce que la recherche a manque');
});
