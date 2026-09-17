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
import { rendreEcran } from './outils/rendu-ecran.mjs';

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
