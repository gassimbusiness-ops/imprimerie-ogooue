/**
 * L'ECRAN « PUBLICATIONS AUTOMATIQUES », MONTE POUR DE VRAI.
 *
 * ── Pourquoi ce fichier existe ────────────────────────────────────────────
 *
 * Le 14/09/2026, 112 tests unitaires etaient verts et l'application est devenue
 * ENTIEREMENT BLANCHE en production. Un ecran neuf que personne n'a encore
 * ouvert a l'oeil ne part pas sans passer par le harnais de rendu.
 *
 * Et ici l'enjeu depasse « l'ecran vit » : c'est le SEUL endroit ou le gerant
 * verra ce qui est parti sur la page publique de son entreprise. Trois phrases
 * doivent s'y trouver, et ce fichier les exige :
 *
 *   1. « SIMULATION » quand le jeton Meta est absent — sans quoi on croirait
 *      que la chaine publie alors qu'elle ne fait que s'entrainer ;
 *   2. la visibilite publique NON PROUVEE a cote d'une publication partie —
 *      un 200 de Meta n'est pas la preuve qu'un client de Moanda voit le post ;
 *   3. « non approuve » a cote de ce qui n'est pas approuve, avec le fait que
 *      ca ne partira pas.
 *
 * ⛔ ZERO APPEL RESEAU : `fetch` est remplace par une doublure qui sert une
 *    charge figee. Si l'ecran appelait autre chose, la doublure le dirait.
 *
 * Lancer :  node --test tests/rendu-ecran-autopost.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rendreEcran, texteVivant } from './outils/rendu-ecran.mjs';

/** Une file aux formes reelles : un prevu non approuve, un parti, un echoue. */
const ETAT = {
  controle: { actif: true, mode: 'dry_run', plafond: 4 },
  mode_global: 'dry_run',
  jeton_meta_present: false,
  acces_drive_configure: false,
  file: [
    {
      cle_idempotence: 'PUB-2026-S39-1-01|v1|facebook|100|2026-09-21T08:00:00Z',
      publication_id: 'PUB-2026-S39-1-01',
      canal: 'facebook',
      surface: 'feed',
      instant_utc: '2026-09-21T08:00:00Z',
      date_locale: '2026-09-21',
      tolerance_minutes: 90,
      etat: 'scheduled',
      tentatives: 0,
      tentatives_max: 3,
      id_distant: null,
      resultat: null,
      derniere_erreur: null,
      approbation: null, // ← pas approuve
    },
    {
      cle_idempotence: 'PUB-2026-S38-5-02|v1|facebook|100|2026-09-19T16:30:00Z',
      publication_id: 'PUB-2026-S38-5-02',
      canal: 'facebook',
      surface: 'feed',
      instant_utc: '2026-09-19T16:30:00Z',
      date_locale: '2026-09-19',
      tolerance_minutes: 90,
      etat: 'published',
      tentatives: 1,
      tentatives_max: 3,
      id_distant: '100_777',
      resultat: { id_distant: '100_777', visibilite_publique: 'non_verifiee', url_publique: null },
      derniere_erreur: null,
      approbation: { approuve: true },
    },
    {
      cle_idempotence: 'PUB-2026-S38-6-01|v1|instagram|178|2026-09-20T08:00:00Z',
      publication_id: 'PUB-2026-S38-6-01',
      canal: 'instagram',
      surface: 'feed',
      instant_utc: '2026-09-20T08:00:00Z',
      date_locale: '2026-09-20',
      tolerance_minutes: 90,
      etat: 'failed',
      tentatives: 3,
      tentatives_max: 3,
      id_distant: null,
      resultat: null,
      derniere_erreur: {
        code_erreur: '200',
        message_erreur: 'code=200 subcode=null type=OAuthException : (#200) Permissions error',
        piste: 'Autorisation refusée par Meta. Deux causes possibles, dont une application non publiée.',
        a_utc: '2026-09-20T09:00:00Z',
      },
      approbation: { approuve: true },
    },
  ],
  journal: [
    {
      instant_utc: '2026-09-21T09:00:00Z',
      evenement: 'passage',
      resume: 'à publier=0 écartés=1 (non_approuve=1)',
      piste: null,
    },
  ],
};

/** Doublure de `fetch` : aucune requete ne sort, et on sait ce qui a ete demande. */
function installerFetch(charge, { ok = true, status = 200 } = {}) {
  const appels = [];
  const ancien = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    appels.push({ url: String(url), methode: options.method || 'GET' });
    return { ok, status, json: async () => charge };
  };
  return { appels, restaurer() { globalThis.fetch = ancien; } };
}

test('l ecran monte, affiche du contenu, et n ecrit RIEN en base', async () => {
  const f = installerFetch(ETAT);
  const r = await rendreEcran({ ecran: 'src/features/autopost/page.jsx' });
  try {
    assert.ok(r.texte.length > 200, 'ecran blanc');
    assert.equal(r.erreurs.length, 0, `exceptions au montage : ${r.erreurs.map((e) => e?.message).join(' · ')}`);
    assert.equal(r.journal.ecritures.length, 0, 'aucune ecriture ne doit partir au simple affichage');
    assert.equal(f.appels.length, 1, 'un seul appel, et c est celui de la lecture d etat');
    assert.match(f.appels[0].url, /\/api\/autopost-etat$/);
  } finally {
    f.restaurer();
    await r.demonter();
  }
});

test('sans jeton Meta, l ecran dit SIMULATION — jamais « ca publie »', async () => {
  const f = installerFetch(ETAT);
  const r = await rendreEcran({ ecran: 'src/features/autopost/page.jsx' });
  try {
    assert.match(r.texte, /SIMULATION/);
    assert.match(r.texte, /Jeton Meta absent/);
    assert.match(r.texte, /rien n'est envoyé|rien n’est envoyé/);
  } finally {
    f.restaurer();
    await r.demonter();
  }
});

test('🔴 a cote d une publication partie, la visibilite publique est dite NON PROUVEE', async () => {
  const f = installerFetch(ETAT);
  const r = await rendreEcran({ ecran: 'src/features/autopost/page.jsx' });
  try {
    assert.match(r.texte, /100_777/, 'l identifiant Meta est le temoin, il doit etre visible');
    assert.match(r.texte, /visibilité publique n'est pas prouvée|visibilité publique n’est pas prouvée/);
  } finally {
    f.restaurer();
    await r.demonter();
  }
});

test('ce qui n est pas approuve est signale, et l ecran dit que ca ne partira pas', async () => {
  const f = installerFetch(ETAT);
  const r = await rendreEcran({ ecran: 'src/features/autopost/page.jsx' });
  try {
    assert.match(r.texte, /non approuvé/);
    assert.match(r.texte, /ne partiront pas/);
  } finally {
    f.restaurer();
    await r.demonter();
  }
});

test('un echec affiche le code brut ET la piste, pas seulement « erreur »', async () => {
  const f = installerFetch(ETAT);
  const r = await rendreEcran({ ecran: 'src/features/autopost/page.jsx' });
  try {
    assert.match(r.texte, /OAuthException/);
    assert.match(r.texte, /application non publiée/);
    assert.match(r.texte, /Tentative 3\/3/);
  } finally {
    f.restaurer();
    await r.demonter();
  }
});

test('les heures sont affichees a l heure de Moanda, avec le fuseau ecrit', async () => {
  const f = installerFetch(ETAT);
  const r = await rendreEcran({ ecran: 'src/features/autopost/page.jsx' });
  try {
    // 08:00Z = 09 h 00 a Moanda ; 16:30Z = 17 h 30.
    assert.match(r.texte, /2026-09-21 09:00:00 \(\+01:00 Africa\/Libreville\)/);
    assert.match(r.texte, /2026-09-19 17:30:00 \(\+01:00 Africa\/Libreville\)/);
  } finally {
    f.restaurer();
    await r.demonter();
  }
});

test('⛔ une lecture en echec DIT la panne au lieu d afficher « rien de prévu »', async () => {
  // C'est le piege documente dans src/services/db.js : 130 lectures d'ecran
  // rendent [] sur une coupure, et l'ecran affiche la phrase d'une base vide.
  const f = installerFetch({ error: 'État indisponible', detail: 'relation "autopost_file" does not exist' },
    { ok: false, status: 503 });
  const r = await rendreEcran({ ecran: 'src/features/autopost/page.jsx' });
  try {
    assert.match(r.texte, /n'a pas pu être lu|n’a pas pu être lu/);
    assert.match(r.texte, /does not exist/, 'le detail technique doit rester lisible');
    assert.match(r.texte, /008_autopost_file_publication\.sql/, 'l ecran doit dire quoi faire');
    assert.doesNotMatch(r.texte, /Rien en attente/, 'une panne ne doit jamais ressembler a une file vide');
  } finally {
    f.restaurer();
    await r.demonter();
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   LE VOYANT DRIVE — quatre pannes, quatre phrases, quatre gestes

   Avant le 18/09/2026 cet ecran affichait « Acces Drive non configure » et rien
   d'autre, pour QUATRE causes differentes. Et le voyant vert ne prouvait rien :
   il se contentait de constater que trois variables etaient posees, sans
   qu'aucune ligne de code n'ait jamais ouvert le Drive.

   Desormais `/api/autopost-etat` porte un bloc `drive` issu d'une VRAIE lecture
   (`api/_lib/drive.js`). Ces tests montent l'ecran pour de bon et exigent que
   chaque cause se lise differemment — sinon on perd une heure a chercher un
   partage manquant alors que c'est la cle qui est mal collee.
   ═══════════════════════════════════════════════════════════════════════════ */

function etatAvecDrive(drive) {
  return { ...ETAT, acces_drive_configure: drive.diagnostic === 'ok', drive };
}

const CAS_DRIVE = [
  {
    nom: 'non configure',
    drive: {
      diagnostic: 'non_configure',
      message: 'Acces Drive non configure. Il manque : DRIVE_DOSSIER_PUBLICATIONS_ID.',
      piste: 'Poser DRIVE_DOSSIER_PUBLICATIONS_ID dans Vercel, puis redeployer.',
      detail: null,
    },
    attendu: /Il manque : DRIVE_DOSSIER_PUBLICATIONS_ID/,
  },
  {
    nom: 'cle refusee',
    drive: {
      diagnostic: 'cle_refusee',
      message: 'La cle privee est refusee par Google.',
      piste: 'Recoller GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY depuis le JSON du compte de service.',
      detail: 'HTTP 400 : {"error":"invalid_grant"}',
    },
    attendu: /cle privee est refusee par Google/,
  },
  {
    nom: 'dossier non partage',
    drive: {
      diagnostic: 'dossier_inaccessible',
      message: "Le dossier n'est pas partage avec le robot.",
      piste: 'Ouvrir 10_PUBLICATIONS, Partager, ajouter le compte de service en LECTEUR.',
      detail: 'HTTP 404 : File not found',
    },
    attendu: /n'est pas partage avec le robot|n’est pas partage avec le robot/,
  },
  {
    nom: 'dossier vide',
    drive: {
      diagnostic: 'dossier_vide',
      message: 'Aucune publication deposee dans le dossier.',
      piste: "Le robot LIT bien le dossier : c'est a ChatGPT de deposer.",
      detail: null,
    },
    attendu: /Aucune publication deposee/,
  },
];

for (const cas of CAS_DRIVE) {
  test(`l ecran DIT « ${cas.nom} » avec ses propres mots, et le geste qui repare`, async () => {
    const f = installerFetch(etatAvecDrive(cas.drive));
    const r = await rendreEcran({ ecran: 'src/features/autopost/page.jsx' });
    try {
      assert.equal(r.erreurs.length, 0, `exceptions au montage : ${r.erreurs.map((e) => e?.message).join(' · ')}`);
      assert.ok(r.texte.length > 200, 'ecran blanc');
      assert.match(r.texte, cas.attendu);
      assert.match(r.texte, new RegExp(cas.drive.piste.slice(0, 25).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        'une panne sans geste a faire ne sert a rien');
    } finally {
      f.restaurer();
      await r.demonter();
    }
  });
}

test('⛔ les quatre phrases du Drive sont VRAIMENT differentes a l ecran', async () => {
  const vues = [];
  for (const cas of CAS_DRIVE) {
    const f = installerFetch(etatAvecDrive(cas.drive));
    const r = await rendreEcran({ ecran: 'src/features/autopost/page.jsx' });
    try {
      vues.push(r.texte.includes(cas.drive.message));
    } finally {
      f.restaurer();
      await r.demonter();
    }
  }
  assert.deepEqual(vues, [true, true, true, true], 'chaque message doit apparaitre tel quel');
});

test('quand le Drive marche, l ecran le dit SANS pretendre qu une publication existe', async () => {
  const f = installerFetch(etatAvecDrive({
    diagnostic: 'ok',
    message: 'Acces Drive operationnel. 3 dossier(s) et 0 fichier(s) a la racine de 10_PUBLICATIONS.',
    piste: null,
    detail: null,
  }));
  const r = await rendreEcran({ ecran: 'src/features/autopost/page.jsx' });
  try {
    assert.match(r.texte, /Acces Drive operationnel/);
    assert.match(r.texte, /3 dossier\(s\)/, 'le compte VU, pas une promesse');
  } finally {
    f.restaurer();
    await r.demonter();
  }
});

test('une reponse SANS bloc drive (deploiement plus ancien) ne casse pas l ecran', async () => {
  const f = installerFetch(ETAT); // pas de champ `drive`
  const r = await rendreEcran({ ecran: 'src/features/autopost/page.jsx' });
  try {
    assert.equal(r.erreurs.length, 0);
    assert.ok(r.texte.length > 200, 'ecran blanc');
  } finally {
    f.restaurer();
    await r.demonter();
  }
});

/* ── LE CINQUIEME ETAT : 77 fichiers deposes, aucun conforme ────────────────
   Releve terrain du 18/09/2026. Si l'ecran affichait « aucune publication
   deposee » dans ce cas, Gassim irait revérifier un partage de dossier qui
   marche tres bien — au lieu de regarder le FORMAT de ce que ChatGPT depose. */

test('⛔ 77 fichiers hors contrat : l ecran dit ce qui est LA, pas « rien »', async () => {
  const f = installerFetch(etatAvecDrive({
    diagnostic: 'rien_de_conforme',
    message: '77 fichier(s) trouve(s) dans le Drive, mais aucun dossier ne contient '
      + '« publication.json » : rien n est conforme au contrat de publication.',
    piste: 'Le robot LIT le Drive : l acces et le partage sont bons. Ce sont les FICHIERS qui ne '
      + 'forment pas une publication.',
    detail: null,
  }));
  const r = await rendreEcran({ ecran: 'src/features/autopost/page.jsx' });
  try {
    assert.equal(r.erreurs.length, 0);
    assert.match(r.texte, /77 fichier/, 'le nombre reellement vu doit etre a l ecran');
    assert.match(r.texte, /publication\.json/, 'et le repere qui manque');
    assert.doesNotMatch(r.texte, /Aucune publication deposee|Aucune publication déposée/,
      'dire « rien de depose » devant 77 fichiers envoie chercher au mauvais endroit');
    assert.match(r.texte, /l acces et le partage sont bons/);
  } finally {
    f.restaurer();
    await r.demonter();
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   LE DERNIER MAILLON, VU DE L'ECRAN — remplir la file depuis le Drive

   Jusqu'au 18/09/2026, 14 publications attendaient dans le Drive et la file
   etait vide : RIEN ne faisait le pont. L'ecran doit desormais offrir ce geste,
   et surtout DIRE ce qu'il a donne — y compris ce qui a ete ecarte, avec son
   motif. Une alimentation muette serait un troisieme faux temoin.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Doublure de `fetch` qui ROUTE par URL : on sait quelle voie a ete appelee. */
function installerFetchRoutee(routes) {
  const appels = [];
  const ancien = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url);
    appels.push({ url: u, methode: options.method || 'GET' });
    const cle = Object.keys(routes).find((r) => u.includes(r));
    const reponse = cle ? routes[cle] : { charge: {}, ok: false, status: 404 };
    return { ok: reponse.ok !== false, status: reponse.status || 200, json: async () => reponse.charge };
  };
  return { appels, restaurer() { globalThis.fetch = ancien; } };
}

async function cliquerSur(r, libelle) {
  const bouton = [...r.conteneur.querySelectorAll('button')]
    .find((b) => (b.textContent || '').includes(libelle));
  assert.ok(bouton, `bouton « ${libelle} » introuvable`);
  await r.act(async () => { bouton.click(); await new Promise((res) => setTimeout(res, 0)); });
  for (let i = 0; i < 3; i += 1) {
    await r.act(async () => { await new Promise((res) => setTimeout(res, 0)); });
  }
  return bouton;
}

test('l ecran offre de RELIRE LE DRIVE, et ce bouton appelle la voie alimenter', async () => {
  const f = installerFetchRoutee({
    '/api/autopost-etat': { charge: ETAT },
    '/api/autopost-alimenter': {
      charge: {
        ok: true,
        alimentation: {
          diagnostic: 'ok', lues: 14, creees: 3, mises_a_jour: 1,
          remplacees: 0, inchangees: 10, conflits: 0, ecartees: [], ecartees_par_le_lecteur: [],
        },
      },
    },
  });
  const r = await rendreEcran({ ecran: 'src/features/autopost/page.jsx' });
  try {
    assert.equal(r.erreurs.length, 0, `exceptions au montage : ${r.erreurs.map((e) => e?.message).join(' · ')}`);
    await cliquerSur(r, 'Relire le Drive');
    const alimentations = f.appels.filter((a) => a.url.includes('/api/autopost-alimenter'));
    assert.equal(alimentations.length, 1, 'le bouton doit appeler la voie alimenter, une fois');
    assert.equal(alimentations[0].methode, 'POST', 'une ecriture se demande en POST');
    // ⚠️ `r.texte` est l'instantane du MONTAGE : apres un clic, c'est le
    //    conteneur qu'il faut relire, sinon on teste l'ecran d'avant.
    const apres = r.conteneur.textContent || '';
    assert.match(apres, /3 (?:publication|ligne)|3 créée/i, 'le resultat doit etre affiche, pas seulement obtenu');
  } finally {
    f.restaurer();
    await r.demonter();
  }
});

test('⛔ un depot ECARTE est affiche avec son motif — jamais « rien de neuf » en silence', async () => {
  const f = installerFetchRoutee({
    '/api/autopost-etat': { charge: ETAT },
    '/api/autopost-alimenter': {
      charge: {
        ok: true,
        alimentation: {
          diagnostic: 'ok', lues: 2, creees: 0, mises_a_jour: 0, remplacees: 0,
          inchangees: 0, conflits: 0,
          ecartees: [
            {
              publication_id: 'PUB-2026-S39-2-01',
              canal: 'facebook',
              motif: 'manifeste_invalide',
              detail: 'schema_version attendu "2.0", reçu "1.0"',
            },
          ],
          ecartees_par_le_lecteur: [],
        },
      },
    },
  });
  const r = await rendreEcran({ ecran: 'src/features/autopost/page.jsx' });
  try {
    await cliquerSur(r, 'Relire le Drive');
    const apres = r.conteneur.textContent || '';
    assert.match(apres, /PUB-2026-S39-2-01/, 'la publication ecartee doit etre nommee');
    assert.match(apres, /schema_version attendu/, 'et le motif doit etre lisible tel quel');
    assert.match(apres, /ne respecte pas le contrat/, 'et traduit en francais, pas seulement en code');
  } finally {
    f.restaurer();
    await r.demonter();
  }
});

test('🔴 une publication en file SANS MEDIA HEBERGE est signalee : elle ne partira pas', async () => {
  // La verite du 18/09/2026 : la file peut se remplir, mais Instagram va
  // CHERCHER l'image a une adresse publiquement joignable — un fichier de Drive
  // prive n'en est pas une. Mieux vaut une file honnete qu'une file qui echoue
  // au moment de publier.
  const f = installerFetchRoutee({ '/api/autopost-etat': { charge: {
    ...ETAT,
    file: [{ ...ETAT.file[0], url_media: null }],
  } } });
  const r = await rendreEcran({ ecran: 'src/features/autopost/page.jsx' });
  try {
    assert.equal(r.erreurs.length, 0);
    assert.match(r.texte, /média/i);
    assert.match(r.texte, /ne partir|n'ira pas|n’ira pas/i,
      'l ecran doit dire que cette publication ne partira pas en l etat');
  } finally {
    f.restaurer();
    await r.demonter();
  }
});

test('une ligne DONT le media est heberge ne porte PAS l avertissement', async () => {
  const f = installerFetchRoutee({ '/api/autopost-etat': { charge: {
    ...ETAT,
    file: [{ ...ETAT.file[0], url_media: 'https://exemple.invalid/signee.jpg' }],
  } } });
  const r = await rendreEcran({ ecran: 'src/features/autopost/page.jsx' });
  try {
    assert.doesNotMatch(r.texte, /média pas encore hébergé/i);
  } finally {
    f.restaurer();
    await r.demonter();
  }
});

test('🔴 le MOTIF du media non heberge remonte JUSQU A L ECRAN, ligne par ligne', async () => {
  // La regle de la mission d'hebergement : « ce motif doit remonter jusqu'a
  // l'ecran, pas mourir dans un console.error ». L'alimentation l'ecrit dans
  // `derniere_erreur` de la ligne — la colonne que cet ecran affiche deja.
  // Ce test monte l'ecran POUR DE VRAI et verifie que le gerant de Moanda lit
  // la phrase, et le geste qui repare.
  const f = installerFetchRoutee({ '/api/autopost-etat': { charge: {
    ...ETAT,
    file: [{
      ...ETAT.file[0],
      url_media: null,
      derniere_erreur: {
        code_erreur: 'media_trop_lourd',
        message_erreur: '« affiche.jpg » pese 18874368 octets ; le stockage refuse au-dela de 15728640',
        piste: 'Alleger l image ou la video avant de la deposer : le stockage refuse au-dela de 15 Mo.',
        a_utc: '2026-09-21T06:00:00Z',
      },
    }],
  } } });
  const r = await rendreEcran({ ecran: 'src/features/autopost/page.jsx' });
  try {
    assert.equal(r.erreurs.length, 0, 'un ecran qui plante ne montre aucun motif');
    assert.match(r.texte, /18874368/, 'le chiffre exact, pas « trop lourd » en general');
    assert.match(r.texte, /Alleger l image/, 'et le geste qui repare, en toutes lettres');
  } finally {
    f.restaurer();
    await r.demonter();
  }
});

test('🔴 une adresse de media HEBERGE fait disparaitre l avertissement « media non heberge »', async () => {
  // L'inverse du precedent : le jour ou l'hebergement marche, l'ecran doit
  // cesser de dire que rien ne peut partir. Un avertissement qui reste affiche
  // apres sa reparation est un faux temoin, dans l'autre sens.
  const urlHebergee = 'https://bcwkrrqmjpaohmafcncw.supabase.co/storage/v1/object/public/'
    + 'publications/PUB-2026-S39-1-01/v1/abc-affiche.jpg';
  const f = installerFetchRoutee({ '/api/autopost-etat': { charge: {
    ...ETAT,
    file: [{ ...ETAT.file[0], url_media: urlHebergee }],
  } } });
  const r = await rendreEcran({ ecran: 'src/features/autopost/page.jsx' });
  try {
    assert.equal(r.erreurs.length, 0);
    assert.doesNotMatch(r.texte, /média non hébergé/i);
    assert.doesNotMatch(r.texte, /n'ont pas de média hébergé|n’ont pas de média hébergé/i);
  } finally {
    f.restaurer();
    await r.demonter();
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   ⛔ L'APPROBATION — LE GESTE QUI N'AVAIT AUCUN ECRAN

   Au 19/09/2026, `signerApprobation()` n'avait AUCUN appelant dans tout le
   depot. La selection ecartait chaque ligne avec `non_approuve`, et personne,
   nulle part dans l'application, ne pouvait lever ce refus : la chaine etait
   complete sauf le seul geste qu'elle exige d'un humain.

   Ces tests montent l'ecran AVEC DES DONNEES — un bloc conditionne a
   `lignes.length > 0` ne prouve rien s'il ne s'affiche jamais — et CLIQUENT.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Comme `installerFetchRoutee`, mais elle retient aussi les CORPS envoyes. */
function installerFetchAvecCorps(routes) {
  const appels = [];
  const ancien = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url);
    let corps = null;
    try { corps = options.body ? JSON.parse(options.body) : null; } catch { corps = options.body; }
    appels.push({ url: u, methode: options.method || 'GET', corps });
    const cle = Object.keys(routes).find((r) => u.includes(r));
    const reponse = cle ? routes[cle] : { charge: {}, ok: false, status: 404 };
    return { ok: reponse.ok !== false, status: reponse.status || 200, json: async () => reponse.charge };
  };
  return { appels, restaurer() { globalThis.fetch = ancien; } };
}

test('⛔ un administrateur voit un bouton qui DIT ce qu il va faire, sur la ligne non approuvee', async () => {
  const f = installerFetchAvecCorps({ '/api/autopost-etat': { charge: ETAT } });
  const r = await rendreEcran({ ecran: 'src/features/autopost/page.jsx', utilisateur: { role: 'admin' } });
  try {
    assert.equal(r.erreurs.length, 0, `exceptions au montage : ${r.erreurs.map((e) => e?.message).join(' · ')}`);
    assert.match(r.texte, /Approuver cette publication/, 'le bouton manque : rien ne peut etre approuve');
    // Il dit ce qui se passe, pas « OK ».
    assert.match(r.texte, /Rien ne part sans approbation/);
  } finally {
    f.restaurer();
    await r.demonter();
  }
});

test('⛔ CLIQUER « Approuver » appelle la voie serveur, et n envoie QU UNE CLE', async () => {
  const f = installerFetchAvecCorps({
    '/api/autopost-etat': { charge: ETAT },
    '/api/autopost-approuver': { charge: { ok: true, approuve: true, signature: 'absente' } },
  });
  const r = await rendreEcran({ ecran: 'src/features/autopost/page.jsx', utilisateur: { role: 'admin' } });
  try {
    await cliquerSur(r, 'Approuver cette publication');

    const appel = f.appels.find((a) => a.url.includes('/api/autopost-approuver'));
    assert.ok(appel, 'aucun appel a la voie d approbation');
    assert.equal(appel.methode, 'POST');
    assert.deepEqual(appel.corps, {
      cle_idempotence: 'PUB-2026-S39-1-01|v1|facebook|100|2026-09-21T08:00:00Z',
      approuve: true,
    });
    // ⛔ Le navigateur n envoie NI empreinte, NI manifeste, NI « approuve_par » :
    //    le serveur relit le manifeste qu il a range et lit le nom dans le jeton.
    assert.equal(appel.corps.payload_sha256, undefined);
    assert.equal(appel.corps.publication, undefined);
    assert.equal(appel.corps.approuve_par, undefined);
    // Et l ecran relit l etat : on n affiche pas un succes suppose.
    assert.ok(f.appels.filter((a) => a.url.includes('/api/autopost-etat')).length >= 2,
      'l ecran doit relire l etat apres le geste');
    assert.equal(r.journal.ecritures.length, 0, 'aucune ecriture en base depuis le navigateur');
  } finally {
    f.restaurer();
    await r.demonter();
  }
});

test('⛔ L APPROBATION SE DEFAIT : la ligne approuvee porte « Retirer l approbation »', async () => {
  const approuvee = {
    ...ETAT,
    file: [{
      ...ETAT.file[0],
      approbation: {
        approuve: true,
        canaux_approuves: ['facebook'],
        approuve_par: 'u-admin',
        approuve_le_utc: '2026-09-21T07:55:00Z',
        signature: 'absente',
        signature_hmac_sha256: null,
      },
    }],
  };
  const f = installerFetchAvecCorps({
    '/api/autopost-etat': { charge: approuvee },
    '/api/autopost-approuver': { charge: { ok: true, approuve: false } },
  });
  const r = await rendreEcran({ ecran: 'src/features/autopost/page.jsx', utilisateur: { role: 'admin' } });
  try {
    assert.match(r.texte, /Approuvé pour facebook/);
    assert.match(r.texte, /u-admin/);
    await cliquerSur(r, 'Retirer l\'approbation');

    const appel = f.appels.find((a) => a.url.includes('/api/autopost-approuver'));
    assert.ok(appel, 'le retrait doit appeler la meme voie');
    assert.equal(appel.corps.approuve, false, 'retirer, ce n est pas re-approuver');
  } finally {
    f.restaurer();
    await r.demonter();
  }
});

test('🔴 une approbation SANS signature le dit — pas de voyant vert muet', async () => {
  const approuvee = {
    ...ETAT,
    file: [{
      ...ETAT.file[0],
      approbation: {
        approuve: true, canaux_approuves: ['facebook'], approuve_par: 'u-admin',
        approuve_le_utc: '2026-09-21T07:55:00Z', signature: 'absente', signature_hmac_sha256: null,
      },
    }],
  };
  const f = installerFetchAvecCorps({ '/api/autopost-etat': { charge: approuvee } });
  const r = await rendreEcran({ ecran: 'src/features/autopost/page.jsx', utilisateur: { role: 'admin' } });
  try {
    assert.match(r.texte, /sans signature/);
    assert.match(r.texte, /L'empreinte du contenu, elle, est bien|L’empreinte du contenu, elle, est bien/);
  } finally {
    f.restaurer();
    await r.demonter();
  }
});

test('⛔ un EMPLOYE ne voit aucun bouton d approbation', async () => {
  const f = installerFetchAvecCorps({ '/api/autopost-etat': { charge: ETAT } });
  const r = await rendreEcran({ ecran: 'src/features/autopost/page.jsx', utilisateur: { role: 'employe' } });
  try {
    assert.ok(r.texte.length > 200, 'ecran blanc');
    assert.doesNotMatch(r.texte, /Approuver cette publication/);
    assert.doesNotMatch(r.texte, /Retirer l'approbation|Retirer l’approbation/);
    // ⚠️ Et ce masquage n est PAS la serrure : celle-ci est dans
    //    `api/autopost.js` (voie « approuver », 403 hors role admin), verifiee
    //    par `tests/autopost-approbation.test.mjs`.
    assert.match(r.texte, /Pas approuvé/, 'l employe doit quand meme VOIR l etat');
  } finally {
    f.restaurer();
    await r.demonter();
  }
});

test('⛔ une publication DEJA PARTIE n offre aucun bouton d approbation', async () => {
  const f = installerFetchAvecCorps({
    '/api/autopost-etat': { charge: { ...ETAT, file: [ETAT.file[1]] } },
  });
  const r = await rendreEcran({ ecran: 'src/features/autopost/page.jsx', utilisateur: { role: 'admin' } });
  try {
    assert.match(r.texte, /100_777/, 'la ligne partie doit bien etre affichee');
    assert.doesNotMatch(r.texte, /Approuver cette publication/);
    assert.doesNotMatch(r.texte, /Retirer l'approbation|Retirer l’approbation/);
  } finally {
    f.restaurer();
    await r.demonter();
  }
});

test('un refus du serveur est DIT, et rien n est affiche comme approuve', async () => {
  const f = installerFetchAvecCorps({
    '/api/autopost-etat': { charge: ETAT },
    '/api/autopost-approuver': {
      ok: false,
      status: 403,
      charge: { error: 'Réservé à un administrateur' },
    },
  });
  const r = await rendreEcran({ ecran: 'src/features/autopost/page.jsx', utilisateur: { role: 'admin' } });
  try {
    await cliquerSur(r, 'Approuver cette publication');
    const erreurs = r.toasts.filter((t) => t.niveau === 'error');
    assert.ok(erreurs.length >= 1, 'un refus silencieux laisserait croire que c est passe');
    assert.match(erreurs[erreurs.length - 1].message, /administrateur/);
    assert.match(texteVivant(r), /Pas approuvé/, 'la ligne reste non approuvee');
  } finally {
    f.restaurer();
    await r.demonter();
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   L'APPROBATION AUTOMATIQUE, MONTÉE POUR DE VRAI

   Gassim a demandé l'automatique ET refusé l'interrupteur à l'écran. Le risque
   est alors précis : 42 lignes passent au vert « approuvé » sans que personne
   ne les ait lues, et l'écran ne dit pas d'où vient ce vert. Ces tests exigent
   que l'écran réponde à deux questions — le réglage est-il actif, et QUI a
   approuvé cette ligne-là.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Une file telle qu'elle sera ce matin : approuvée par la machine, et par un humain. */
function etatAvecApprobationAutomatique(sur = {}) {
  return {
    ...ETAT,
    controle: {
      actif: true, mode: 'dry_run', plafond: 4,
      approbation_automatique: true, reglage_approbation: 'en_base',
      ...(sur.controle || {}),
    },
    file: [
      {
        ...ETAT.file[0],
        cle_idempotence: 'PUB-2026-S39-1-01|v1|facebook|100|2026-09-21T08:00:00Z',
        approbation: {
          approuve: true,
          publication_id: 'PUB-2026-S39-1-01',
          version_contenu: 1,
          canaux_approuves: ['facebook'],
          payload_sha256: 'a'.repeat(64),
          signature: 'absente',
          signature_hmac_sha256: null,
          origine: 'automatique',
          approuve_par: null,
          approuve_le_utc: '2026-09-19T07:00:00Z',
        },
      },
      {
        ...ETAT.file[0],
        cle_idempotence: 'PUB-2026-S39-2-01|v1|instagram|178|2026-09-21T08:00:00Z',
        publication_id: 'PUB-2026-S39-2-01',
        canal: 'instagram',
        approbation: {
          approuve: true,
          publication_id: 'PUB-2026-S39-2-01',
          version_contenu: 1,
          canaux_approuves: ['instagram'],
          payload_sha256: 'b'.repeat(64),
          signature: 'absente',
          origine: 'ecran_administrateur',
          approuve_par: 'gassim',
          approuve_le_utc: '2026-09-19T07:30:00Z',
        },
      },
    ],
    ...sur,
  };
}

test('🔴 l ecran DIT que l approbation automatique est activee — sans bouton', async () => {
  const f = installerFetch(etatAvecApprobationAutomatique());
  const r = await rendreEcran({ ecran: 'src/features/autopost/page.jsx' });
  try {
    assert.equal(r.erreurs.length, 0, `exceptions au montage : ${r.erreurs.map((e) => e?.message).join(' · ')}`);
    assert.match(r.texte, /Approbation automatique/);
    assert.match(r.texte, /activée/);
    // ⛔ Gassim a explicitement refuse l'interrupteur a l'ecran. Un bouton qui
    //    apparaitrait ici serait un geste qu'il n'a pas demande, sur un reglage
    //    qui arrete la chaine.
    const libelles = [...r.conteneur.querySelectorAll('button')]
      .map((b) => b.textContent || '').join(' | ');
    assert.doesNotMatch(libelles, /automatique/i,
      `aucun bouton ne doit piloter ce reglage — il se change en base : ${libelles}`);
  } finally {
    f.restaurer();
    await r.demonter();
  }
});

test('🔴 l ecran distingue « approuve par la MACHINE » de « approuve par un HUMAIN »', async () => {
  const f = installerFetch(etatAvecApprobationAutomatique());
  const r = await rendreEcran({ ecran: 'src/features/autopost/page.jsx' });
  try {
    // La machine : dit automatiquement, et dit que personne n'a relu.
    assert.match(r.texte, /automatiquement/);
    assert.match(r.texte, /Personne ne l'a relue|Personne ne l’a relue/,
      'un vert sans cette phrase laisserait croire a une relecture qui n a pas eu lieu');
    // L'humain : c'est son nom qui s'affiche, pas « automatique ».
    assert.match(r.texte, /gassim/);
  } finally {
    f.restaurer();
    await r.demonter();
  }
});

test('reglage desactive : l ecran le dit, et renvoie a l approbation a la main', async () => {
  const f = installerFetch(etatAvecApprobationAutomatique({
    controle: { approbation_automatique: false, reglage_approbation: 'en_base' },
  }));
  const r = await rendreEcran({ ecran: 'src/features/autopost/page.jsx' });
  try {
    assert.match(r.texte, /Approbation automatique : désactivée|Approbation automatique :\s*désactivée/);
    assert.match(r.texte, /approuvée à la main/);
  } finally {
    f.restaurer();
    await r.demonter();
  }
});

test('⛔ migration 014 non appliquee : l ecran dit que c est le DEFAUT du code qui sert', async () => {
  // Sans cette phrase, le gerant croirait lire un reglage choisi alors qu il
  // lit une valeur de repli — et il chercherait en base une colonne absente.
  const f = installerFetch(etatAvecApprobationAutomatique({
    controle: { approbation_automatique: true, reglage_approbation: 'colonne_absente' },
  }));
  const r = await rendreEcran({ ecran: 'src/features/autopost/page.jsx' });
  try {
    assert.match(r.texte, /migration 014 non appliquée/);
    assert.match(r.texte, /défaut du\s*code/);
  } finally {
    f.restaurer();
    await r.demonter();
  }
});

test('le bouton « Retirer l approbation » reste offert sur une ligne approuvee par la machine', async () => {
  // C'est le seul contre-pouvoir du gerant sur une chaine qui s approuve toute
  // seule. S il disparaissait, l automatique deviendrait irreversible ligne par
  // ligne.
  const f = installerFetch(etatAvecApprobationAutomatique());
  const r = await rendreEcran({
    ecran: 'src/features/autopost/page.jsx',
    session: { role: 'admin', sub: 'u-admin' },
  });
  try {
    assert.equal(r.erreurs.length, 0);
    assert.match(r.texte, /aucun passage ne le réécrira|aucun passage ne le reecrira/,
      'la promesse doit etre ecrite : un retrait tient face aux passages suivants');
  } finally {
    f.restaurer();
    await r.demonter();
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   LE TYPE DU JETON — LE VOYANT QUI MANQUAIT LE 19/09/2026
   ═══════════════════════════════════════════════════════════════════════════ */

test('⛔ un jeton PRESENT mais du mauvais TYPE est dit a l ecran, en un mot', async () => {
  // Le 19/09/2026 a 16 h 33, Instagram a publie et Facebook a refuse, avec le
  // meme jeton. L ecran disait « Jeton Meta présent. » et disait vrai : il
  // etait la, il etait simplement du mauvais type. Deux heures perdues faute
  // d un mot a l ecran.
  const f = installerFetch({
    ...ETAT,
    jeton_meta_present: true,
    type_jeton_meta: {
      type: 'utilisateur',
      detail: 'Jeton d\'UTILISATEUR (un jeton d\'utilisateur système en est un). Instagram '
        + 'l\'accepte ; publier sur la Page exige un jeton de Page, que l\'application échange '
        + 'elle-même juste avant de publier.',
    },
  });
  const r = await rendreEcran({ ecran: 'src/features/autopost/page.jsx' });
  try {
    assert.equal(r.erreurs.length, 0, `exceptions au montage : ${r.erreurs.map((e) => e?.message).join(' · ')}`);
    assert.match(r.texte, /Type du jeton Meta/);
    assert.match(r.texte, /utilisateur/);
    assert.match(r.texte, /exige un jeton de Page/, 'le mot seul ne dit pas ce qu il implique');
  } finally {
    f.restaurer();
    await r.demonter();
  }
});

test('un jeton de PAGE est dit tel quel, sans alarme inutile', async () => {
  const f = installerFetch({
    ...ETAT,
    jeton_meta_present: true,
    type_jeton_meta: {
      type: 'page',
      detail: 'Jeton de PAGE — c\'est le type qu\'exige la publication sur la Page Facebook.',
    },
  });
  const r = await rendreEcran({ ecran: 'src/features/autopost/page.jsx' });
  try {
    assert.match(r.texte, /Type du jeton Meta : page/);
  } finally {
    f.restaurer();
    await r.demonter();
  }
});

test('sans jeton, le voyant de TYPE se tait : une panne ne se dit pas deux fois', async () => {
  // ETAT porte `jeton_meta_present: false` : le voyant precedent dit deja
  // « Jeton Meta absent ». Repeter serait du bruit, pas de l information.
  const f = installerFetch(ETAT);
  const r = await rendreEcran({ ecran: 'src/features/autopost/page.jsx' });
  try {
    assert.doesNotMatch(r.texte, /Type du jeton Meta/);
  } finally {
    f.restaurer();
    await r.demonter();
  }
});
