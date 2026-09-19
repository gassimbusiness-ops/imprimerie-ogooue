/**
 * ════════════════════════════════════════════════════════════════════════════
 * LE JETON DE PAGE — LE REJEU DE L'ÉCHEC DU 19/09/2026, 16 H 33
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Ce qui a été MESURÉ en production ce jour-là, à la même seconde et avec le
 * même jeton `META_PAGE_ACCESS_TOKEN` :
 *
 *   instagram — publié — id_distant=17973805920134016
 *   facebook  — code=200 type=OAuthException : (#200) The permission(s)
 *               publish_actions are not available. It has been deprecated.
 *
 * Le premier diagnostic — « il manque `pages_manage_posts` » — était FAUX : le
 * dirigeant a vérifié, l'autorisation est bien là. Ce qui restait, c'est le
 * TYPE du jeton : un jeton d'utilisateur (un jeton d'utilisateur système en est
 * un) suffit à Instagram et ne suffit pas à publier sur une PAGE.
 *
 * ⛔ CE FICHIER NE CROIT PAS CETTE HYPOTHÈSE : IL LA MET À L'ÉPREUVE.
 *
 * `metaDuJour()` ci-dessous est une doublure de Meta qui se comporte comme la
 * production de ce jour-là : elle REGARDE l'en-tête `Authorization` et refuse
 * `POST /{page-id}/photos` avec l'erreur exacte, mot pour mot, dès qu'on lui
 * présente le jeton d'utilisateur. Instagram, lui, l'accepte.
 *
 * Conséquence, et c'est le point : **le test « le rejeu du 19/09 » ÉCHOUE sur
 * l'ancien code** (qui présentait le jeton configuré à la Page) et passe sur le
 * nouveau (qui échange d'abord). Sans ce renversement, rien n'aurait été prouvé.
 *
 * ⛔ ZÉRO APPEL RÉSEAU. `fetch` est injecté, il compte ses appels et retient les
 *    en-têtes présentés. Rien de ce fichier ne peut toucher Meta.
 *
 * Lancer :  node --test tests/autopost-jeton-de-page.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { executerPassage } from '../api/_lib/autopost-executeur.js';
import { creerClientMeta, TYPE_JETON } from '../api/_lib/autopost-meta.js';
import { cleIdempotence, empreinteCanonique } from '../api/_lib/autopost-contrat.js';
import { instantUtcDepuisCreneau } from '../src/lib/dates.js';

/* Les étiquettes du manifeste, et les numéros que l'ENVIRONNEMENT connaît. */
const PAGE_ID = 'PAGE_IMPRIMERIE';
const IG_ID = 'IG_IMPRIMERIE';
const NUMERO_PAGE = '100000000000001';
const NUMERO_IG = '178000000000001';
process.env.META_PAGE_ID = NUMERO_PAGE;
process.env.META_INSTAGRAM_ID = NUMERO_IG;
process.env.AUTOPOST_MODE = 'live';

const INSTANT = '2026-09-21T16:45:00Z';

/** Le jeton posé dans Vercel : celui du 19/09, un jeton d'UTILISATEUR système. */
const JETON_CONFIGURE = 'EAAG7x9K2mR4tV6yB8nD0pF3sH5jL1wZcXvUiOpAqSdFgHjK';
/** Celui que Meta rend en échange, et que la Page accepte. */
const JETON_DE_PAGE = 'EAAG0zY8xW6vU4tS2rQ1pN3mL5kJ7hG9fD8sA6bC4eR2tY';

function muet() { /* les tests n'ont pas à parler */ }

/* ═══════════════════════════════════════════════════════════════════════════
   Le manifeste, la file, le dépôt — mêmes formes que partout ailleurs
   ═══════════════════════════════════════════════════════════════════════════ */

function manifeste({ canal = 'facebook', compte = PAGE_ID, id = 'PUB-2026-S39-1-02' } = {}) {
  const date = '2026-09-21';
  return {
    schema_version: '2.0',
    publication_id: id,
    campagne_id: 'CAMP-RENTREE-2026-09',
    version_contenu: 1,
    semaine_iso: '2026-S39',
    annee_iso: 2026,
    numero_semaine_iso: 39,
    jour_iso: 1,
    date_locale: date,
    creneau: {
      date_locale: date,
      heure_locale: '17:30',
      fuseau: 'Africa/Libreville',
      offset_utc: '+01:00',
      instant_utc: instantUtcDepuisCreneau({ date_locale: date, heure_locale: '17:30', offset_utc: '+01:00' }),
      tolerance_minutes: 90,
    },
    format: 'photo',
    mode_execution: 'live',
    medias: [{
      role: 'principal', canal_cible: [canal], chemin_relatif: 'a.jpg', sha256: 'a'.repeat(64),
      mime_type: 'image/jpeg', largeur_px: 1080, hauteur_px: 1350, duree_s: null,
      ordre_carrousel: 1, deja_publie: false, origine: 'photo_reelle', droits: null,
    }],
    captions: { [canal]: { chemin_relatif: 'c.txt', sha256: 'b'.repeat(64), caracteres: 300, hashtags: 2, mentions: 0 } },
    cta: 'Envoyez la date, les quantités et votre logo',
    code_provenance: 'OG-01-S39',
    offres: [{ offre_id: null, libelle: 'sans offre', prix_affiche: false, valide_jusqu_au_local: null }],
    canaux: [{
      canal,
      compte_cible_id: compte,
      type_cible: canal === 'facebook' ? 'page' : 'ig_business_account',
      surface: 'feed',
      etat: 'scheduled',
    }],
    genere_par: 'chatgpt',
    avertissements: [],
  };
}

function ligneDe(pub, { canal = 'facebook', compte = PAGE_ID } = {}) {
  return {
    cle_idempotence: cleIdempotence(pub, { canal, compte_cible_id: compte }),
    publication_id: pub.publication_id,
    version_contenu: pub.version_contenu,
    canal,
    compte_cible_id: compte,
    surface: 'feed',
    instant_utc: pub.creneau.instant_utc,
    date_locale: pub.date_locale,
    tolerance_minutes: pub.creneau.tolerance_minutes,
    etat: 'scheduled',
    tentatives: 0,
    tentatives_max: 3,
    id_distant: null,
    id_conteneur: null,
    legende: 'Flocage textile à Moanda. 📞 060 44 46 34 — OG-01-S39',
    url_media: 'https://exemple.invalid/affiche.jpg',
    publication: pub,
    approbation: {
      publication_id: pub.publication_id,
      version_contenu: pub.version_contenu,
      approuve: true,
      approuve_par: 'compte-applicatif-gassim',
      canaux_approuves: [canal],
      creneau_approuve: {
        date_locale: pub.creneau.date_locale,
        heure_locale: pub.creneau.heure_locale,
        fuseau: 'Africa/Libreville',
        instant_utc: pub.creneau.instant_utc,
      },
      payload_sha256: empreinteCanonique(pub),
    },
  };
}

function depotMemoire(lignes, { actif = true, mode = 'live', plafond = 4 } = {}) {
  const file = new Map(lignes.map((l) => [l.cle_idempotence, { ...l }]));
  const journal = [];
  return {
    file,
    journal,
    async lireArretGlobal() { return { actif, mode, plafond }; },
    async lireFile() { return [...file.values()].filter((l) => l.etat === 'scheduled').map((l) => ({ ...l })); },
    async lireAReconcilier() {
      return [...file.values()].filter((l) => l.etat === 'reconciling' && !l.id_distant).map((l) => ({ ...l }));
    },
    async compterPubliesLe(d) {
      return [...file.values()].filter((l) => l.etat === 'published' && l.date_locale === d).length;
    },
    prendre(cle) {
      const l = file.get(cle);
      if (!l || l.etat !== 'scheduled') return Promise.resolve(false);
      l.etat = 'executing';
      return Promise.resolve(true);
    },
    async relacher(cle, { etat, tentatives, erreur }) {
      Object.assign(file.get(cle), { etat, tentatives, derniere_erreur: erreur ?? null });
    },
    async noterConteneur(cle, id) { file.get(cle).id_conteneur = id; },
    async enregistrerPublication(cle, resultat) {
      Object.assign(file.get(cle), {
        etat: 'published', id_distant: resultat.id_distant, id_conteneur: resultat.id_conteneur ?? null, resultat,
      });
    },
    async journaliser(e) { journal.push(e); },
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   ⛔ LA DOUBLURE DE META — celle du 19/09/2026, en-tête comprise
   ═══════════════════════════════════════════════════════════════════════════ */

const ok = (corps) => ({ ok: true, status: 200, json: async () => corps });
const ko = (status, error) => ({ ok: false, status, json: async () => ({ error }) });

/** L'erreur exacte rendue par la production, mot pour mot. */
const ERREUR_PUBLISH_ACTIONS = {
  message: '(#200) The permission(s) publish_actions are not available. It has been deprecated. '
    + 'If you want to provide a way for your app users to share content to Facebook, we encourage '
    + 'you to use our Sharing products instead.',
  type: 'OAuthException',
  code: 200,
  fbtrace_id: 'A19092026x',
};

/**
 * Meta, tel qu'il s'est comporté le 19/09/2026.
 *
 * @param {object} [arg]
 * @param {boolean} [arg.rendJetonDePage]  la Page rend-elle un jeton de Page ?
 * @param {string|null} [arg.identiteDuJeton]  ce que `GET /me` répond
 * @returns {Function} une doublure de `fetch` qui retient URL, méthode, jeton présenté
 */
function metaDuJour({ rendJetonDePage = true, identiteDuJeton = 'SYSTEME-42' } = {}) {
  const appels = [];
  const impl = async (url, options = {}) => {
    const methode = options.method || 'GET';
    const entete = String(options.headers?.Authorization || '');
    const jetonPresente = entete.startsWith('Bearer ') ? entete.slice(7) : null;
    appels.push({ url: String(url), methode, jetonPresente });

    // 1. L'ÉCHANGE : GET /{page-id}?fields=access_token
    if (methode === 'GET' && url.includes('fields=access_token')) {
      if (!rendJetonDePage) return ok({ id: NUMERO_PAGE });
      return ok({ id: NUMERO_PAGE, access_token: JETON_DE_PAGE });
    }

    // 2. LA SONDE D'IDENTITÉ : GET /me?fields=id
    if (methode === 'GET' && url.includes('/me?')) {
      if (identiteDuJeton === null) return ko(400, { message: 'Error validating access token', code: 190 });
      return ok({ id: identiteDuJeton });
    }

    // 3. 🔴 LA PAGE : elle REGARDE le jeton présenté. C'est tout le sujet.
    if (url.includes(`/${NUMERO_PAGE}/photos`) || url.includes(`/${NUMERO_PAGE}/feed`)) {
      if (jetonPresente !== JETON_DE_PAGE) return ko(200, ERREUR_PUBLISH_ACTIONS);
      if (url.includes('/feed')) return ok({ data: [] });
      return ok({ post_id: `${NUMERO_PAGE}_900001` });
    }

    // 4. Instagram : le jeton configuré lui suffit — et le 19/09 l'a prouvé.
    if (url.includes(`/${NUMERO_IG}/media_publish`)) {
      if (jetonPresente !== JETON_CONFIGURE) return ko(400, { message: 'mauvais jeton pour Instagram', code: 190 });
      return ok({ id: '17973805920134016' });
    }
    if (url.includes(`/${NUMERO_IG}/media`)) {
      if (jetonPresente !== JETON_CONFIGURE) return ko(400, { message: 'mauvais jeton pour Instagram', code: 190 });
      return ok({ id: 'CONTENEUR-1' });
    }
    if (url.includes('CONTENEUR-1')) return ok({ status_code: 'FINISHED' });

    // 5. Relecture d'un post de Page : même exigence que l'écriture.
    if (url.includes(`${NUMERO_PAGE}_900001`)) {
      if (jetonPresente !== JETON_DE_PAGE) return ko(200, ERREUR_PUBLISH_ACTIONS);
      return ok({ id: `${NUMERO_PAGE}_900001`, permalink_url: 'https://exemple.invalid/post' });
    }
    return ok({ id: '17973805920134016' });
  };
  impl.appels = appels;
  impl.echanges = () => appels.filter((a) => a.url.includes('fields=access_token'));
  impl.publications = () => appels.filter((a) => a.methode === 'POST');
  return impl;
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. 🔴 LE REJEU DU 19/09 — CE TEST ÉCHOUE SUR L'ANCIEN CODE
   ═══════════════════════════════════════════════════════════════════════════ */

test('🔴 rejeu du 19/09/2026 : le jeton d\'utilisateur qui produisait « (#200) publish_actions » '
  + 'passe désormais par l\'échange, et la Page accepte', async () => {
  const p = manifeste();
  const depot = depotMemoire([ligneDe(p)]);
  const meta = metaDuJour();
  const client = creerClientMeta({ jeton: JETON_CONFIGURE, fetchImpl: meta });

  const bilan = await executerPassage({ depot, client, instant: INSTANT, tracer: muet });

  /* ⛔ SUR L'ANCIEN CODE, CETTE LIGNE TOMBE : le jeton configuré partait tel
     quel vers `/{page-id}/photos`, la doublure rendait l'erreur exacte de la
     production, et `bilan.publies` valait 0 pour `bilan.echecs` à 1. */
  assert.equal(bilan.publies, 1, `la Page a refusé : ${JSON.stringify(bilan.details)}`);
  assert.equal(bilan.echecs, 0);

  const photos = meta.appels.find((a) => a.url.includes('/photos'));
  assert.ok(photos, 'la photo doit bien avoir été envoyée');
  assert.equal(photos.jetonPresente, JETON_DE_PAGE,
    'c\'est le jeton de PAGE qui doit être présenté à {page-id}/photos, pas le jeton configuré');

  const l = [...depot.file.values()][0];
  assert.equal(l.etat, 'published');
  assert.equal(l.id_distant, `${NUMERO_PAGE}_900001`);
});

test('🔴 et la preuve par la doublure : présenter le jeton CONFIGURÉ à la Page rend bien '
  + 'l\'erreur du 19/09', async () => {
  // Sans ce contrôle, la doublure pourrait accepter n'importe quoi et le test
  // précédent ne prouverait rien du tout.
  const meta = metaDuJour();
  const reponse = await meta(`https://graph.facebook.com/v21.0/${NUMERO_PAGE}/photos`, {
    method: 'POST', headers: { Authorization: `Bearer ${JETON_CONFIGURE}` },
  });
  const charge = await reponse.json();
  assert.equal(reponse.ok, false);
  assert.equal(charge.error.code, 200);
  assert.match(charge.error.message, /publish_actions/);
  assert.match(charge.error.message, /deprecated/);
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. UN SEUL ÉCHANGE PAR PASSAGE
   ═══════════════════════════════════════════════════════════════════════════ */

test('⛔ deux publications Facebook dans le même passage → UN SEUL échange', async () => {
  const a = manifeste({ id: 'PUB-2026-S39-1-02' });
  const b = manifeste({ id: 'PUB-2026-S39-1-03' });
  const depot = depotMemoire([ligneDe(a), ligneDe(b)]);
  const meta = metaDuJour();
  const client = creerClientMeta({ jeton: JETON_CONFIGURE, fetchImpl: meta });

  const bilan = await executerPassage({ depot, client, instant: INSTANT, tracer: muet });

  assert.equal(bilan.publies, 2, `écarté : ${JSON.stringify(bilan.ecartes)}`);
  assert.equal(meta.echanges().length, 1,
    `un appel d'échange par publication serait absurde — maxDuration vaut 60 s : ${meta.echanges().length}`);
});

test('⛔ un échange qui ÉCHOUE n\'est pas retenté non plus : un seul appel, un seul motif', async () => {
  const a = manifeste({ id: 'PUB-2026-S39-1-02' });
  const b = manifeste({ id: 'PUB-2026-S39-1-03' });
  const depot = depotMemoire([ligneDe(a), ligneDe(b)]);
  // La Page ne rend pas de jeton, et le jeton n'est pas celui de la Page.
  const meta = metaDuJour({ rendJetonDePage: false, identiteDuJeton: 'SYSTEME-42' });
  const client = creerClientMeta({ jeton: JETON_CONFIGURE, fetchImpl: meta });

  const bilan = await executerPassage({ depot, client, instant: INSTANT, tracer: muet });

  assert.equal(bilan.echecs, 2, 'les deux lignes échouent');
  assert.equal(meta.echanges().length, 1, 'l\'échec est mis en cache et rejoué, pas refait');
  const motifs = new Set(depot.journal.filter((e) => e.evenement === 'echec').map((e) => e.resume.split(' —')[0]));
  assert.deepEqual([...motifs], ['jeton_page_non_attribuee'], 'une seule cause, un seul motif');
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. LE BON JETON AU BON ENDROIT
   ═══════════════════════════════════════════════════════════════════════════ */

test('le jeton de Page sert à {page-id}/photos ET à {page-id}/feed', async () => {
  const p = manifeste();
  const ligne = ligneDe(p);
  ligne.etat = 'reconciling'; // la réconciliation lit le flux de la Page
  const depot = depotMemoire([ligne]);
  const meta = metaDuJour();
  const client = creerClientMeta({ jeton: JETON_CONFIGURE, fetchImpl: meta });

  await executerPassage({ depot, client, instant: INSTANT, tracer: muet });

  const flux = meta.appels.find((x) => x.url.includes('/feed'));
  assert.ok(flux, 'la réconciliation doit bien avoir lu le flux de la Page');
  assert.equal(flux.jetonPresente, JETON_DE_PAGE,
    'lire le flux d\'une Page est un geste de Page : même jeton que pour écrire');
});

test('⛔ Instagram continue d\'utiliser le jeton CONFIGURÉ — on ne change pas ce qui marche', async () => {
  const p = manifeste({ canal: 'instagram', compte: IG_ID });
  const depot = depotMemoire([ligneDe(p, { canal: 'instagram', compte: IG_ID })]);
  const meta = metaDuJour();
  const client = creerClientMeta({ jeton: JETON_CONFIGURE, fetchImpl: meta, attendre: async () => {} });

  const bilan = await executerPassage({ depot, client, instant: INSTANT, tracer: muet });

  assert.equal(bilan.publies, 1, `écarté : ${JSON.stringify(bilan.ecartes)}`);
  assert.equal(meta.echanges().length, 0, 'le chemin Instagram n\'a aucune raison d\'échanger quoi que ce soit');
  for (const appel of meta.appels) {
    assert.equal(appel.jetonPresente, JETON_CONFIGURE,
      `Instagram doit garder le jeton configuré : ${appel.url}`);
  }
  assert.equal([...depot.file.values()][0].id_distant, '17973805920134016');
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. LE JETON CONFIGURÉ EST DÉJÀ UN JETON DE PAGE — NE RIEN CASSER
   ═══════════════════════════════════════════════════════════════════════════ */

test('⛔ si le jeton configuré EST déjà le jeton de la Page, l\'échange est transparent', async () => {
  const p = manifeste();
  const depot = depotMemoire([ligneDe(p)]);
  // Meta rend exactement le jeton présenté : c'est ce qu'il fait quand celui-ci
  // est déjà le jeton de la Page.
  const appels = [];
  const impl = async (url, options = {}) => {
    const entete = String(options.headers?.Authorization || '');
    const jetonPresente = entete.startsWith('Bearer ') ? entete.slice(7) : null;
    appels.push({ url: String(url), methode: options.method || 'GET', jetonPresente });
    if (url.includes('fields=access_token')) return ok({ id: NUMERO_PAGE, access_token: JETON_DE_PAGE });
    if (url.includes('/photos')) {
      if (jetonPresente !== JETON_DE_PAGE) return ko(200, ERREUR_PUBLISH_ACTIONS);
      return ok({ post_id: `${NUMERO_PAGE}_900001` });
    }
    return ok({ id: `${NUMERO_PAGE}_900001`, permalink_url: 'https://exemple.invalid/post' });
  };
  // ⚠️ Le jeton CONFIGURÉ est ici déjà celui de la Page.
  const client = creerClientMeta({ jeton: JETON_DE_PAGE, fetchImpl: impl });

  const bilan = await executerPassage({ depot, client, instant: INSTANT, tracer: muet });

  assert.equal(bilan.publies, 1, 'le cas qui marche déjà ne doit surtout pas être cassé');
  assert.equal(appels.find((a) => a.url.includes('/photos')).jetonPresente, JETON_DE_PAGE);
});

test('⛔ un jeton de Page dont la Page ne rend PAS le champ access_token publie quand même', async () => {
  /* La documentation Meta ne garantit le champ que pour « the User making the
     request » : un jeton de Page qui s'interroge lui-même n'est pas un
     utilisateur, et peut donc ne rien recevoir. Refuser ici casserait le
     chemin qui marche peut-être déjà. La sonde `GET /me` tranche : avec un
     jeton de Page, « me » EST la Page. */
  const p = manifeste();
  const depot = depotMemoire([ligneDe(p)]);
  const meta = metaDuJour({ rendJetonDePage: false, identiteDuJeton: NUMERO_PAGE });
  // Ce jeton-là est accepté par la Page : la doublure l'exige sous ce nom.
  const client = creerClientMeta({ jeton: JETON_DE_PAGE, fetchImpl: meta });

  const bilan = await executerPassage({ depot, client, instant: INSTANT, tracer: muet });

  assert.equal(bilan.publies, 1, `la Page a refusé : ${JSON.stringify(bilan.details)}`);
  assert.equal(meta.appels.find((a) => a.url.includes('/photos')).jetonPresente, JETON_DE_PAGE);
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. UN ÉCHEC D'ÉCHANGE : UN MOTIF PAR GESTE, ET AUCUNE PUBLICATION TENTÉE
   ═══════════════════════════════════════════════════════════════════════════ */

test('⛔ échange refusé → AUCUN appel de publication n\'est tenté', async () => {
  const p = manifeste();
  const depot = depotMemoire([ligneDe(p)]);
  const meta = metaDuJour({ rendJetonDePage: false, identiteDuJeton: 'SYSTEME-42' });
  const client = creerClientMeta({ jeton: JETON_CONFIGURE, fetchImpl: meta });

  const bilan = await executerPassage({ depot, client, instant: INSTANT, tracer: muet });

  assert.equal(bilan.echecs, 1);
  assert.equal(bilan.publies, 0);
  assert.equal(meta.publications().length, 0,
    'l\'échange a lieu AVANT le premier appel qui produit un effet');
});

test('motif « Page non attribuée à l\'utilisateur système » — et le geste Business Manager', async () => {
  const p = manifeste();
  const depot = depotMemoire([ligneDe(p)]);
  const meta = metaDuJour({ rendJetonDePage: false, identiteDuJeton: 'SYSTEME-42' });
  const client = creerClientMeta({ jeton: JETON_CONFIGURE, fetchImpl: meta });

  await executerPassage({ depot, client, instant: INSTANT, tracer: muet });

  const echec = depot.journal.find((e) => e.evenement === 'echec');
  assert.match(echec.resume, /jeton_page_non_attribuee/);
  assert.match(echec.piste, /Business Manager/);
  assert.match(echec.piste, /Créer du contenu/);
  assert.match(echec.piste, /Instagram ne suffit pas|Instagram a publié/,
    'la piste doit nommer l\'écart mesuré, pas seulement l\'erreur');
});

test('motif « jeton expiré » — distinct, et il ne renvoie pas vers Business Manager', async () => {
  const p = manifeste();
  const depot = depotMemoire([ligneDe(p)]);
  const impl = async (url) => {
    if (url.includes('fields=access_token') || url.includes('/me?')) {
      return ko(400, { message: 'Error validating access token: Session has expired', code: 190, error_subcode: 463 });
    }
    return ok({});
  };
  const client = creerClientMeta({ jeton: JETON_CONFIGURE, fetchImpl: impl });

  await executerPassage({ depot, client, instant: INSTANT, tracer: muet });

  const l = [...depot.file.values()][0];
  assert.equal(l.derniere_erreur.code_erreur, 'jeton_page_expire');
  assert.match(l.derniere_erreur.piste, /META_PAGE_ACCESS_TOKEN/);
  assert.doesNotMatch(l.derniere_erreur.piste, /Business Manager/,
    'trois causes, trois gestes : les motifs ne doivent pas se confondre');
});

test('motif « sans rôle sur cette Page » — et il cite la documentation Meta', async () => {
  const p = manifeste();
  const depot = depotMemoire([ligneDe(p)]);
  // L'échange est refusé, ET la sonde d'identité aussi : on ne sait pas qui
  // porte le jeton, seulement qu'il n'a pas de rôle ici.
  const impl = async (url) => {
    if (url.includes('fields=access_token')) {
      return ko(400, { message: 'Unsupported get request.', code: 100, error_subcode: 33 });
    }
    if (url.includes('/me?')) return ko(400, { message: 'Unsupported get request.', code: 100 });
    return ok({});
  };
  const client = creerClientMeta({ jeton: JETON_CONFIGURE, fetchImpl: impl });

  await executerPassage({ depot, client, instant: INSTANT, tracer: muet });

  const l = [...depot.file.values()][0];
  assert.equal(l.derniere_erreur.code_erreur, 'jeton_page_sans_droit');
  assert.match(l.derniere_erreur.piste, /Only returned if the User making the request has a role/);
});

test('⛔ un échange coupé par le réseau n\'envoie pas la ligne en réconciliation : rien n\'a été publié', async () => {
  const p = manifeste();
  const depot = depotMemoire([ligneDe(p)]);
  const impl = async () => { throw new Error('socket hang up'); };
  const client = creerClientMeta({ jeton: JETON_CONFIGURE, fetchImpl: impl });

  const bilan = await executerPassage({ depot, client, instant: INSTANT, tracer: muet });

  assert.equal(bilan.incertains, 0,
    'l\'échange a lieu avant tout effet : il n\'y a rien à réconcilier');
  assert.equal(bilan.echecs, 1);
  const l = [...depot.file.values()][0];
  assert.equal(l.etat, 'scheduled', 'la ligne repart en file, elle ne part pas en reconciling');
  assert.equal(l.derniere_erreur.code_erreur, 'jeton_page_reseau');
});

/* ═══════════════════════════════════════════════════════════════════════════
   6. LE TYPE DU JETON, OBSERVABLE SANS ÊTRE RÉVÉLÉ
   ═══════════════════════════════════════════════════════════════════════════ */

test('typeDuJeton dit « utilisateur » pour un jeton d\'utilisateur système', async () => {
  const meta = metaDuJour({ identiteDuJeton: 'SYSTEME-42' });
  const client = creerClientMeta({ jeton: JETON_CONFIGURE, fetchImpl: meta });

  const vu = await client.typeDuJeton(NUMERO_PAGE);

  assert.equal(vu.type, TYPE_JETON.UTILISATEUR);
  assert.match(vu.detail, /Instagram/, 'le mot seul ne suffit pas : il faut dire ce qu\'il implique');
  assert.equal(meta.appels.length, 1, 'une question, un appel');
});

test('typeDuJeton dit « page » quand « me » EST la Page', async () => {
  const meta = metaDuJour({ identiteDuJeton: NUMERO_PAGE });
  const client = creerClientMeta({ jeton: JETON_DE_PAGE, fetchImpl: meta });

  const vu = await client.typeDuJeton(NUMERO_PAGE);
  assert.equal(vu.type, TYPE_JETON.PAGE);
});

test('typeDuJeton dit « inconnu » sans jeton — et ne touche PAS au réseau', async () => {
  const meta = metaDuJour();
  const client = creerClientMeta({ jeton: '', fetchImpl: meta });

  const vu = await client.typeDuJeton(NUMERO_PAGE);

  assert.equal(vu.type, TYPE_JETON.INCONNU);
  assert.equal(meta.appels.length, 0, 'aucun appel ne doit être tenté sans jeton');
});

test('typeDuJeton dit « inconnu » sans META_PAGE_ID, sans rien appeler', async () => {
  const meta = metaDuJour();
  const client = creerClientMeta({ jeton: JETON_CONFIGURE, fetchImpl: meta });

  const vu = await client.typeDuJeton(null);

  assert.equal(vu.type, TYPE_JETON.INCONNU);
  assert.match(vu.detail, /META_PAGE_ID/);
  assert.equal(meta.appels.length, 0);
});

test('typeDuJeton ne lève jamais : un voyant ne doit pas faire tomber l\'écran d\'état', async () => {
  const impl = async () => { throw new Error('socket hang up'); };
  const client = creerClientMeta({ jeton: JETON_CONFIGURE, fetchImpl: impl });

  const vu = await client.typeDuJeton(NUMERO_PAGE);
  assert.equal(vu.type, TYPE_JETON.INCONNU);
});

/* ═══════════════════════════════════════════════════════════════════════════
   7. ⛔ AUCUN JETON NE SORT — NI LE CONFIGURÉ, NI CELUI OBTENU
   ═══════════════════════════════════════════════════════════════════════════ */

test('⛔ ni le jeton configuré ni le jeton ÉCHANGÉ n\'apparaissent nulle part', async () => {
  const p = manifeste();
  const depot = depotMemoire([ligneDe(p)]);
  const meta = metaDuJour();
  const client = creerClientMeta({ jeton: JETON_CONFIGURE, fetchImpl: meta });

  const bilan = await executerPassage({ depot, client, instant: INSTANT, tracer: muet });
  assert.equal(bilan.publies, 1);

  const surfaces = {
    'les URL appelées': meta.appels.map((a) => a.url).join(' '),
    'le journal': JSON.stringify(depot.journal),
    'le bilan rendu au navigateur': JSON.stringify(bilan),
    'la file écrite en base': JSON.stringify([...depot.file.values()]),
  };
  for (const [ou, texte] of Object.entries(surfaces)) {
    assert.ok(!texte.includes(JETON_CONFIGURE), `le jeton configuré fuit dans ${ou}`);
    assert.ok(!texte.includes(JETON_DE_PAGE), `le jeton de Page fuit dans ${ou}`);
  }
});

test('⛔ même un ÉCHEC d\'échange ne laisse fuir aucun jeton', async () => {
  const p = manifeste();
  const depot = depotMemoire([ligneDe(p)]);
  const meta = metaDuJour({ rendJetonDePage: false, identiteDuJeton: 'SYSTEME-42' });
  const client = creerClientMeta({ jeton: JETON_CONFIGURE, fetchImpl: meta });

  const bilan = await executerPassage({ depot, client, instant: INSTANT, tracer: muet });

  const tout = JSON.stringify(bilan) + JSON.stringify(depot.journal)
    + JSON.stringify([...depot.file.values()]) + meta.appels.map((a) => a.url).join(' ');
  assert.ok(!tout.includes(JETON_CONFIGURE));
  assert.ok(!tout.includes(JETON_DE_PAGE));
  // Et pas davantage un FRAGMENT : un motif d'échec n'a aucun besoin d'en citer un.
  for (let debut = 0; debut + 8 <= JETON_CONFIGURE.length; debut += 1) {
    assert.ok(!tout.includes(JETON_CONFIGURE.slice(debut, debut + 8)),
      `fragment du jeton configuré dans une trace : ${JETON_CONFIGURE.slice(debut, debut + 8)}`);
  }
});
