/**
 * Auto-poster — l'exécuteur : le passage qui publie (ou qui refuse de publier).
 *
 * ⛔ ZÉRO APPEL RÉSEAU. Le `fetch` est injecté et compte ses appels ; le dépôt
 *    est une Map en mémoire. Aucun test de ce fichier ne peut toucher Meta,
 *    Supabase, ni quoi que ce soit hors de ce processus — et le premier test
 *    vérifie précisément ça pour le cas qui compte : jeton absent.
 *
 * CE QUE CES TESTS PROTÈGENT
 *
 *   1. Sans jeton Meta, rien ne part et RIEN N'EST APPELÉ. La simulation ne pose
 *      pas d'`id_distant` : sinon une répétition à blanc marquerait tout comme
 *      publié et la vraie publication n'aurait jamais lieu.
 *   2. Deux exécutions simultanées ne publient qu'une fois. C'est la leçon
 *      SingPay : ce n'est pas une lecture préalable qui le garantit, c'est un
 *      compare-and-swap qui ne modifie la ligne que si elle est encore libre.
 *   3. Un échec est journalisé avec son code brut ET une piste — en particulier
 *      pour le cas non tranché « l'application Meta n'est pas publiée ».
 *   4. Un résultat incertain ne recrée jamais : il cherche.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { executerPassage } from '../api/_lib/autopost-executeur.js';
import { creerClientMeta, diagnostiquerErreurMeta } from '../api/_lib/autopost-meta.js';
import { cleIdempotence, empreinteCanonique } from '../api/_lib/autopost-contrat.js';
import { instantUtcDepuisCreneau } from '../src/lib/dates.js';

const PAGE_ID = '100000000000001';
const IG_ID = '178000000000001';
const INSTANT = '2026-09-21T16:45:00Z';

/* Le mode réel exige DEUX verrous indépendants : la ligne `autopost_controle`
   en base ET la variable `AUTOPOST_MODE`. Les tests qui veulent observer une
   publication réelle doivent donc ouvrir les deux — ce qui documente la règle
   autant que ça la teste. Les deux tests dédiés ci-dessous vérifient qu'un seul
   verrou ouvert ne suffit jamais. */
process.env.AUTOPOST_MODE = 'live';

/* ═══════════════════════════════════════════════════════════════════════════
   Outils — dépôt en mémoire, fetch qui compte, console muette
   ═══════════════════════════════════════════════════════════════════════════ */

function muet() { /* les tests n'ont pas à parler */ }

function manifeste({ mode = 'live', heure = '17:30' } = {}) {
  const date = '2026-09-21';
  return {
    schema_version: '2.0',
    publication_id: 'PUB-2026-S39-1-02',
    campagne_id: 'CAMP-RENTREE-2026-09',
    version_contenu: 1,
    semaine_iso: '2026-S39',
    annee_iso: 2026,
    numero_semaine_iso: 39,
    jour_iso: 1,
    date_locale: date,
    creneau: {
      date_locale: date,
      heure_locale: heure,
      fuseau: 'Africa/Libreville',
      offset_utc: '+01:00',
      instant_utc: instantUtcDepuisCreneau({ date_locale: date, heure_locale: heure, offset_utc: '+01:00' }),
      tolerance_minutes: 90,
    },
    format: 'photo',
    mode_execution: mode,
    medias: [{
      role: 'principal', canal_cible: ['facebook'], chemin_relatif: 'a.jpg', sha256: 'a'.repeat(64),
      mime_type: 'image/jpeg', largeur_px: 1080, hauteur_px: 1350, duree_s: null,
      ordre_carrousel: 1, deja_publie: false, origine: 'photo_reelle', droits: null,
    }],
    captions: { facebook: { chemin_relatif: 'c.txt', sha256: 'b'.repeat(64), caracteres: 300, hashtags: 2, mentions: 0 } },
    cta: 'Envoyez la date, les quantités et votre logo',
    code_provenance: 'OG-01-S39',
    offres: [{ offre_id: null, libelle: 'sans offre', prix_affiche: false, valide_jusqu_au_local: null }],
    canaux: [{ canal: 'facebook', compte_cible_id: PAGE_ID, type_cible: 'page', surface: 'feed', etat: 'scheduled' }],
    genere_par: 'chatgpt',
    avertissements: [],
  };
}

function approbationDe(pub, canaux = ['facebook']) {
  return {
    publication_id: pub.publication_id,
    version_contenu: pub.version_contenu,
    approuve: true,
    approuve_par: 'compte-applicatif-gassim',
    canaux_approuves: canaux,
    creneau_approuve: {
      date_locale: pub.creneau.date_locale,
      heure_locale: pub.creneau.heure_locale,
      fuseau: 'Africa/Libreville',
      instant_utc: pub.creneau.instant_utc,
    },
    payload_sha256: empreinteCanonique(pub),
  };
}

function ligneDe(pub, { canal = 'facebook', compte = PAGE_ID, urlMedia = 'https://exemple.invalid/signee.jpg' } = {}) {
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
    url_media: urlMedia,
    publication: pub,
    approbation: approbationDe(pub, [canal]),
  };
}

/**
 * Dépôt en mémoire. `prendre()` y est atomique pour de vrai : ce processus est
 * mono-thread, et la mise à jour se fait sans `await` entre le test et
 * l'écriture — exactement ce que l'UPDATE conditionnel garantit en base.
 */
function depotMemoire(lignes, { actif = true, mode = 'live', plafond = 4 } = {}) {
  const file = new Map(lignes.map((l) => [l.cle_idempotence, { ...l }]));
  const journal = [];
  return {
    file,
    journal,
    async lireArretGlobal() { return { actif, mode, plafond }; },
    // ⚠️ Des COPIES, comme une vraie lecture en base. Rendre les objets stockés
    //    ferait qu'une exécution verrait les mutations d'une autre dans son
    //    propre instantané — ce qui masquerait justement la course qu'on teste.
    async lireFile() { return [...file.values()].filter((l) => l.etat === 'scheduled').map((l) => ({ ...l })); },
    async lireAReconcilier() {
      return [...file.values()].filter((l) => l.etat === 'reconciling' && !l.id_distant).map((l) => ({ ...l }));
    },
    async compterPubliesLe(d) { return [...file.values()].filter((l) => l.etat === 'published' && l.date_locale === d).length; },
    prendre(cle) {
      const l = file.get(cle);
      if (!l || l.etat !== 'scheduled') return Promise.resolve(false);
      l.etat = 'executing';
      return Promise.resolve(true);
    },
    async relacher(cle, { etat, tentatives, erreur }) {
      const l = file.get(cle);
      Object.assign(l, { etat, tentatives, derniere_erreur: erreur ?? null });
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

/** `fetch` de test : compte les appels et sert des réponses scriptées. */
function fauxFetch(reponses) {
  const appels = [];
  const impl = async (url, options = {}) => {
    appels.push({ url, methode: options.method || 'GET' });
    const suite = reponses.shift();
    if (typeof suite === 'function') return suite(url, options);
    if (suite instanceof Error) throw suite;
    return suite;
  };
  impl.appels = appels;
  return impl;
}

const ok = (corps) => ({ ok: true, status: 200, json: async () => corps });
const ko = (status, error) => ({ ok: false, status, json: async () => ({ error }) });

/* ═══════════════════════════════════════════════════════════════════════════
   1. SANS JETON : SIMULATION, ET AUCUN APPEL RÉSEAU
   ═══════════════════════════════════════════════════════════════════════════ */

test('⛔ jeton absent → simulation, ZÉRO appel réseau', async () => {
  const p = manifeste();
  const depot = depotMemoire([ligneDe(p)]);
  const appel = fauxFetch([]);
  const client = creerClientMeta({ jeton: '', fetchImpl: appel });

  const bilan = await executerPassage({ depot, client, instant: INSTANT, tracer: muet });

  assert.equal(appel.appels.length, 0, 'aucun appel réseau ne doit être tenté sans jeton');
  assert.equal(bilan.simules, 1);
  assert.equal(bilan.publies, 0);
  assert.equal(bilan.jeton_present, false);
});

test('⛔ la simulation ne pose PAS d\'id_distant et remet la ligne en file', async () => {
  const p = manifeste();
  const depot = depotMemoire([ligneDe(p)]);
  const client = creerClientMeta({ jeton: '', fetchImpl: fauxFetch([]) });

  await executerPassage({ depot, client, instant: INSTANT, tracer: muet });

  const l = [...depot.file.values()][0];
  assert.equal(l.id_distant, null, 'une simulation qui pose un témoin empêcherait la vraie publication');
  assert.equal(l.etat, 'scheduled');
  assert.equal(l.tentatives, 0, 'une simulation n\'est pas une tentative');
});

test('jeton présent mais interrupteur de base en dry_run → simulation quand même', async () => {
  const p = manifeste();
  const depot = depotMemoire([ligneDe(p)], { mode: 'dry_run' });
  const appel = fauxFetch([]);
  const client = creerClientMeta({ jeton: 'jeton-de-test', fetchImpl: appel });

  const bilan = await executerPassage({ depot, client, instant: INSTANT, tracer: muet });
  assert.equal(appel.appels.length, 0);
  assert.equal(bilan.simules, 1);
  assert.equal(depot.journal.find((e) => e.evenement === 'simulation').resume.includes('interrupteur_base_en_dry_run'), true);
});

test('⛔ la variable AUTOPOST_MODE seule ne peut PAS ouvrir : il faut aussi la base', async () => {
  // Une variable oubliée à `live` dans Vercel ne doit pas suffire à mettre la
  // Page de l'entreprise en ligne.
  const p = manifeste();
  const depot = depotMemoire([ligneDe(p)], { mode: 'dry_run' });
  const appel = fauxFetch([]);
  const client = creerClientMeta({ jeton: 'jeton-de-test', fetchImpl: appel });

  assert.equal(process.env.AUTOPOST_MODE, 'live', 'le verrou d\'environnement est ouvert dans ce test');
  const bilan = await executerPassage({ depot, client, instant: INSTANT, tracer: muet });
  assert.equal(appel.appels.length, 0);
  assert.equal(bilan.mode, 'dry_run');
});

test('⛔ la base seule ne peut PAS ouvrir : il faut aussi AUTOPOST_MODE', async () => {
  // Une ligne de base modifiée par erreur ne doit pas suffire non plus.
  const p = manifeste();
  const depot = depotMemoire([ligneDe(p)], { mode: 'live' });
  const appel = fauxFetch([]);
  const client = creerClientMeta({ jeton: 'jeton-de-test', fetchImpl: appel });

  const avant = process.env.AUTOPOST_MODE;
  process.env.AUTOPOST_MODE = 'dry_run';
  try {
    const bilan = await executerPassage({ depot, client, instant: INSTANT, tracer: muet });
    assert.equal(appel.appels.length, 0);
    assert.equal(bilan.mode, 'dry_run');
    assert.match(
      depot.journal.find((e) => e.evenement === 'simulation').resume,
      /variable_AUTOPOST_MODE_en_dry_run/,
    );
  } finally {
    process.env.AUTOPOST_MODE = avant;
  }
});

test('mode global live mais publication en dry_run → simulation quand même', async () => {
  const p = manifeste({ mode: 'dry_run' });
  const depot = depotMemoire([ligneDe(p)], { mode: 'live' });
  const appel = fauxFetch([]);
  const client = creerClientMeta({ jeton: 'jeton-de-test', fetchImpl: appel });

  const bilan = await executerPassage({ depot, client, instant: INSTANT, tracer: muet });
  assert.equal(appel.appels.length, 0, 'il faut les DEUX modes en live, jamais un seul');
  assert.equal(bilan.simules, 1);
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. PUBLICATION RÉELLE
   ═══════════════════════════════════════════════════════════════════════════ */

test('jeton + live + approbation → publication, et le témoin est écrit', async () => {
  const p = manifeste();
  const depot = depotMemoire([ligneDe(p)]);
  const appel = fauxFetch([
    ok({ id: '999', post_id: `${PAGE_ID}_999` }),                       // POST /photos
    ok({ id: `${PAGE_ID}_999`, permalink_url: 'https://fb/x' }),        // GET relecture
  ]);
  const client = creerClientMeta({ jeton: 'jeton-de-test', fetchImpl: appel });

  const bilan = await executerPassage({ depot, client, instant: INSTANT, tracer: muet });

  assert.equal(bilan.publies, 1);
  const l = [...depot.file.values()][0];
  assert.equal(l.etat, 'published');
  assert.equal(l.id_distant, `${PAGE_ID}_999`);
  assert.equal(l.resultat.methode_verification, 'relecture_api');
});

test('🔴 un 200 de Meta n\'est PAS une preuve de visibilité publique, et le résultat le dit', async () => {
  const p = manifeste();
  const depot = depotMemoire([ligneDe(p)]);
  const client = creerClientMeta({
    jeton: 'jeton-de-test',
    fetchImpl: fauxFetch([ok({ post_id: `${PAGE_ID}_999` }), ok({ id: `${PAGE_ID}_999` })]),
  });

  await executerPassage({ depot, client, instant: INSTANT, tracer: muet });

  const l = [...depot.file.values()][0];
  assert.equal(l.resultat.visibilite_publique, 'non_verifiee');
  assert.match(depot.journal.find((e) => e.evenement === 'publication').resume, /visibilité publique NON vérifiée/);
});

test('une publication déjà partie n\'est jamais rejouée au passage suivant', async () => {
  const p = manifeste();
  const depot = depotMemoire([ligneDe(p)]);
  const client = creerClientMeta({
    jeton: 'jeton-de-test',
    fetchImpl: fauxFetch([ok({ post_id: `${PAGE_ID}_999` }), ok({ id: `${PAGE_ID}_999` })]),
  });

  await executerPassage({ depot, client, instant: INSTANT, tracer: muet });

  // Second passage : le fetch n'a plus rien à servir. S'il est appelé, il rend
  // `undefined` et le test casse — ce qui est exactement le signal voulu.
  const appel2 = fauxFetch([]);
  const client2 = creerClientMeta({ jeton: 'jeton-de-test', fetchImpl: appel2 });
  const bilan2 = await executerPassage({ depot, client: client2, instant: '2026-09-21T17:00:00Z', tracer: muet });

  assert.equal(appel2.appels.length, 0);
  assert.equal(bilan2.publies, 0);
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. LA CONCURRENCE — la leçon SingPay
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Une porte qui ne s'ouvre que lorsque `n` appelants s'y présentent.
 *
 * Sans elle, les deux passages se sérialiseraient : le second lirait la file
 * APRÈS que le premier a fini, ne verrait plus rien, et le test passerait sans
 * avoir rien prouvé. La porte force les deux à lire la MÊME file avant que l'un
 * ait pris quoi que ce soit — c'est-à-dire la vraie course entre deux instances
 * serverless, celle qui a fait écrire deux fois l'encaissement SingPay.
 */
function barriere(n) {
  let arrives = 0;
  let ouvrir;
  const porte = new Promise((r) => { ouvrir = r; });
  return async () => {
    arrives += 1;
    if (arrives >= n) ouvrir();
    await porte;
  };
}

test('⛔ deux exécutions concurrentes ne publient QU\'UNE fois', async () => {
  const p = manifeste();
  const depot = depotMemoire([ligneDe(p)]);

  // Les deux passages lisent la file avant que l'un ait pu prendre la ligne.
  const porte = barriere(2);
  const lireFile = depot.lireFile.bind(depot);
  depot.lireFile = async (...a) => { const r = await lireFile(...a); await porte(); return r; };

  // Un seul jeu de réponses, partagé : si les deux passages publiaient, le
  // second consommerait une réponse qui n'existe pas.
  let postsEnvoyes = 0;
  const impl = async (url, options = {}) => {
    if ((options.method || 'GET') === 'POST') {
      postsEnvoyes += 1;
      return ok({ post_id: `${PAGE_ID}_999` });
    }
    return ok({ id: `${PAGE_ID}_999`, permalink_url: 'https://fb/x' });
  };
  const clientA = creerClientMeta({ jeton: 'jeton-de-test', fetchImpl: impl });
  const clientB = creerClientMeta({ jeton: 'jeton-de-test', fetchImpl: impl });

  const [a, b] = await Promise.all([
    executerPassage({ depot, client: clientA, instant: INSTANT, tracer: muet }),
    executerPassage({ depot, client: clientB, instant: INSTANT, tracer: muet }),
  ]);

  assert.equal(postsEnvoyes, 1, 'un seul appel de publication doit partir');
  assert.equal(a.publies + b.publies, 1);
  assert.equal(a.pris_ailleurs + b.pris_ailleurs, 1, 'l\'autre passage doit voir la ligne déjà prise');
  assert.equal([...depot.file.values()][0].id_distant, `${PAGE_ID}_999`);
});

test('la ligne prise ailleurs est journalisée, pas avalée en silence', async () => {
  const p = manifeste();
  const depot = depotMemoire([ligneDe(p)]);
  // On simule une prise déjà faite par une autre exécution.
  const vraiePrise = depot.prendre.bind(depot);
  depot.prendre = () => Promise.resolve(false);
  void vraiePrise;

  const appel = fauxFetch([]);
  const client = creerClientMeta({ jeton: 'jeton-de-test', fetchImpl: appel });
  const bilan = await executerPassage({ depot, client, instant: INSTANT, tracer: muet });

  assert.equal(appel.appels.length, 0);
  assert.equal(bilan.pris_ailleurs, 1);
  assert.equal(bilan.ecartes.at(-1).raison, 'pris_par_une_autre_execution');
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. LES ÉCHECS — journalisés précisément
   ═══════════════════════════════════════════════════════════════════════════ */

test('🔴 un refus d\'autorisation journalise le code brut ET la piste « application non publiée »', async () => {
  const p = manifeste();
  const depot = depotMemoire([ligneDe(p)]);
  const client = creerClientMeta({
    jeton: 'jeton-de-test',
    fetchImpl: fauxFetch([ko(403, {
      message: '(#200) If posting to a group, requires app being installed in the group',
      type: 'OAuthException', code: 200, fbtrace_id: 'ABC123',
    })]),
  });

  const bilan = await executerPassage({ depot, client, instant: INSTANT, tracer: muet });

  assert.equal(bilan.echecs, 1);
  const entree = depot.journal.find((e) => e.evenement === 'echec');
  assert.match(entree.resume, /code=200/, 'le code brut doit être conservé');
  assert.match(entree.resume, /fbtrace_id=ABC123/, 'la trace Meta doit être conservée');
  assert.match(entree.piste, /application n'est pas publiée/);
  assert.match(entree.piste, /§2\.2/, 'la piste doit renvoyer au test qui tranche');

  const l = [...depot.file.values()][0];
  assert.equal(l.etat, 'scheduled', 'un échec net avec des tentatives restantes revient en file');
  assert.equal(l.tentatives, 1);
  assert.equal(l.derniere_erreur.code_erreur, '200');
});

test('un jeton expiré est reconnu et la piste dit quoi refaire', () => {
  const d = diagnostiquerErreurMeta({ message: 'Error validating access token', code: 190, error_subcode: 463 });
  assert.equal(d.code, '190');
  assert.match(d.message, /subcode=463/);
  assert.match(d.piste, /LONGUE DURÉE/);
});

test('un quota atteint est un report, pas une erreur de code', () => {
  assert.match(diagnostiquerErreurMeta({ code: 4, message: 'Application request limit reached' }).piste, /reporter/);
});

test('après la dernière tentative, la ligne passe en failed et ne repart plus', async () => {
  const p = manifeste();
  const l = ligneDe(p);
  l.tentatives = 2;
  l.tentatives_max = 3;
  const depot = depotMemoire([l]);
  const client = creerClientMeta({
    jeton: 'jeton-de-test',
    fetchImpl: fauxFetch([ko(400, { message: 'Invalid parameter', code: 100 })]),
  });

  await executerPassage({ depot, client, instant: INSTANT, tracer: muet });
  assert.equal([...depot.file.values()][0].etat, 'failed');
});

test('⛔ une url_media absente refuse de publier au lieu d\'improviser', async () => {
  const p = manifeste();
  const depot = depotMemoire([ligneDe(p, { urlMedia: null })]);
  const appel = fauxFetch([]);
  const client = creerClientMeta({ jeton: 'jeton-de-test', fetchImpl: appel });

  const bilan = await executerPassage({ depot, client, instant: INSTANT, tracer: muet });

  assert.equal(appel.appels.length, 0);
  assert.equal(bilan.echecs, 1);
  assert.match(depot.journal.find((e) => e.evenement === 'echec').resume, /url_media_absente/);
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. L'INCERTAIN — chercher, jamais recréer
   ═══════════════════════════════════════════════════════════════════════════ */

test('un réseau coupé ne compte pas comme un échec : la ligne passe en reconciling', async () => {
  const p = manifeste();
  const depot = depotMemoire([ligneDe(p)]);
  const client = creerClientMeta({
    jeton: 'jeton-de-test',
    fetchImpl: fauxFetch([new Error('socket hang up')]),
  });

  const bilan = await executerPassage({ depot, client, instant: INSTANT, tracer: muet });

  assert.equal(bilan.incertains, 1);
  assert.equal(bilan.echecs, 0);
  assert.equal([...depot.file.values()][0].etat, 'reconciling');
});

test('une ligne en reconciling est RETROUVÉE par son code de provenance, pas republiée', async () => {
  const p = manifeste();
  const l = ligneDe(p);
  l.etat = 'reconciling';
  const depot = depotMemoire([l]);

  let postsEnvoyes = 0;
  const impl = async (url, options = {}) => {
    if ((options.method || 'GET') === 'POST') { postsEnvoyes += 1; return ok({ post_id: 'NE-DEVRAIT-PAS-ARRIVER' }); }
    return ok({ data: [{ id: `${PAGE_ID}_555`, message: 'Flocage textile… OG-01-S39', created_time: '2026-09-21T16:46:00+0000' }] });
  };
  const client = creerClientMeta({ jeton: 'jeton-de-test', fetchImpl: impl });

  const bilan = await executerPassage({ depot, client, instant: INSTANT, tracer: muet });

  assert.equal(postsEnvoyes, 0, 'chercher avant de créer, jamais l\'inverse');
  assert.equal(bilan.reconcilies, 1);
  const apres = [...depot.file.values()][0];
  assert.equal(apres.etat, 'published');
  assert.equal(apres.id_distant, `${PAGE_ID}_555`);
  assert.equal(apres.resultat.reconcilie, true);
  assert.equal(apres.resultat.methode_verification, 'recherche_code_provenance');
});

test('une ligne en reconciling introuvable RESTE en reconciling — décision humaine', async () => {
  const p = manifeste();
  const l = ligneDe(p);
  l.etat = 'reconciling';
  const depot = depotMemoire([l]);
  const client = creerClientMeta({ jeton: 'jeton-de-test', fetchImpl: async () => ok({ data: [] }) });

  const bilan = await executerPassage({ depot, client, instant: INSTANT, tracer: muet });

  assert.equal(bilan.reconcilies, 0);
  assert.equal([...depot.file.values()][0].etat, 'reconciling');
});

/* ═══════════════════════════════════════════════════════════════════════════
   6. INSTAGRAM — l'ancre écrite avant l'effet
   ═══════════════════════════════════════════════════════════════════════════ */

test('Instagram : le conteneur est noté en base AVANT media_publish', async () => {
  const p = manifeste();
  p.canaux = [{ canal: 'instagram', compte_cible_id: IG_ID, type_cible: 'ig_business_account', surface: 'feed', etat: 'scheduled' }];
  const depot = depotMemoire([ligneDe(p, { canal: 'instagram', compte: IG_ID })]);

  const ordre = [];
  const impl = async (url, options = {}) => {
    const methode = options.method || 'GET';
    if (methode === 'POST' && url.includes('/media_publish')) {
      ordre.push('media_publish');
      return ok({ id: 'IG_POST_1' });
    }
    if (methode === 'POST' && url.includes('/media')) {
      ordre.push('creer_conteneur');
      return ok({ id: 'CONTENEUR_1' });
    }
    if (url.includes('CONTENEUR_1')) { ordre.push('sondage'); return ok({ status_code: 'FINISHED' }); }
    return ok({ id: 'IG_POST_1', permalink_url: 'https://ig/x' });
  };
  // La notation du conteneur est observée à l'instant où elle a lieu.
  const vraieNote = depot.noterConteneur.bind(depot);
  depot.noterConteneur = async (cle, id) => { ordre.push('note_conteneur'); await vraieNote(cle, id); };

  const client = creerClientMeta({ jeton: 'jeton-de-test', fetchImpl: impl, attendre: async () => {} });
  const bilan = await executerPassage({ depot, client, instant: INSTANT, tracer: muet });

  assert.equal(bilan.publies, 1);
  assert.ok(
    ordre.indexOf('note_conteneur') < ordre.indexOf('media_publish'),
    `l'ancre doit être écrite avant l'effet — ordre observé : ${ordre.join(' → ')}`,
  );
  assert.equal([...depot.file.values()][0].id_distant, 'IG_POST_1');
});

test('Instagram : un conteneur déjà PUBLISHED ne republie pas', async () => {
  const p = manifeste();
  p.canaux = [{ canal: 'instagram', compte_cible_id: IG_ID, type_cible: 'ig_business_account', surface: 'feed', etat: 'scheduled' }];
  const depot = depotMemoire([ligneDe(p, { canal: 'instagram', compte: IG_ID })]);

  let publications = 0;
  const impl = async (url, options = {}) => {
    const methode = options.method || 'GET';
    if (methode === 'POST' && url.includes('/media_publish')) { publications += 1; return ok({ id: 'X' }); }
    if (methode === 'POST') return ok({ id: 'CONTENEUR_1' });
    if (url.includes('CONTENEUR_1')) return ok({ status_code: 'PUBLISHED' });
    return ok({ id: 'CONTENEUR_1' });
  };
  const client = creerClientMeta({ jeton: 'jeton-de-test', fetchImpl: impl, attendre: async () => {} });
  await executerPassage({ depot, client, instant: INSTANT, tracer: muet });

  assert.equal(publications, 0);
  assert.equal([...depot.file.values()][0].etat, 'published');
});

/* ═══════════════════════════════════════════════════════════════════════════
   7. L'ARRÊT GLOBAL
   ═══════════════════════════════════════════════════════════════════════════ */

test('⛔ l\'arrêt global sort avant tout, sans toucher au réseau ni à la file', async () => {
  const p = manifeste();
  const depot = depotMemoire([ligneDe(p)], { actif: false });
  const appel = fauxFetch([]);
  const client = creerClientMeta({ jeton: 'jeton-de-test', fetchImpl: appel });

  const bilan = await executerPassage({ depot, client, instant: INSTANT, tracer: muet });

  assert.equal(appel.appels.length, 0);
  assert.equal(bilan.arret_global, true);
  assert.equal(bilan.publies, 0);
  assert.equal([...depot.file.values()][0].etat, 'scheduled', 'la file est conservée, rien n\'est perdu');
});

test('un dépôt sans ligne de contrôle est considéré ARRÊTÉ, pas actif par défaut', async () => {
  const p = manifeste();
  const depot = depotMemoire([ligneDe(p)]);
  depot.lireArretGlobal = async () => ({ actif: false, mode: 'dry_run', plafond: 0 });
  const appel = fauxFetch([]);
  const client = creerClientMeta({ jeton: 'jeton-de-test', fetchImpl: appel });

  const bilan = await executerPassage({ depot, client, instant: INSTANT, tracer: muet });
  assert.equal(bilan.arret_global, true);
  assert.equal(appel.appels.length, 0);
});

/* ═══════════════════════════════════════════════════════════════════════════
   8. LE JOURNAL — « un auto-poster qu'on ne peut pas regarder… »
   ═══════════════════════════════════════════════════════════════════════════ */

test('chaque passage laisse une trace, même quand rien ne part', async () => {
  const p = manifeste();
  const l = ligneDe(p);
  l.approbation = null;
  const depot = depotMemoire([l]);
  const client = creerClientMeta({ jeton: '', fetchImpl: fauxFetch([]) });

  const bilan = await executerPassage({ depot, client, instant: INSTANT, tracer: muet });

  const passage = depot.journal.find((e) => e.evenement === 'passage');
  assert.ok(passage, 'un passage sans publication doit quand même être journalisé');
  assert.match(passage.resume, /non_approuve=1/);
  assert.equal(bilan.ecartes[0].raison, 'non_approuve');
});

test('le jeton n\'apparaît jamais dans le journal ni dans l\'URL appelée', async () => {
  const p = manifeste();
  const depot = depotMemoire([ligneDe(p)]);
  const secret = 'JETON-TRES-SECRET-A-NE-PAS-FUITER';
  const appel = fauxFetch([ok({ post_id: 'X' }), ok({ id: 'X' })]);
  const client = creerClientMeta({ jeton: secret, fetchImpl: appel });

  await executerPassage({ depot, client, instant: INSTANT, tracer: muet });

  for (const a of appel.appels) assert.ok(!a.url.includes(secret), 'le jeton ne doit pas voyager dans l\'URL');
  assert.ok(!JSON.stringify(depot.journal).includes(secret), 'le jeton ne doit pas atterrir dans le journal');
});
