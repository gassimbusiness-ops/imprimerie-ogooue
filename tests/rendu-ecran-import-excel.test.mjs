/**
 * RENDU de l'ecran d'import Excel, dans un vrai DOM.
 *
 * ── POURQUOI CE FICHIER ──────────────────────────────────────────────────────
 *
 * `tests/import-excel.test.mjs` verifie la DECISION (analyse, conflits, plan).
 * Elle peut etre parfaite pendant que l'ecran, lui, blanchit au montage — c'est
 * exactement ce qui s'est passe le 14/09/2026 avec 112 tests verts.
 *
 * Ici l'ecran est monte POUR DE VRAI (esbuild + jsdom + React), un vrai fichier
 * .xlsx lui est donne, et trois choses sont verifiees :
 *   1. il produit du CONTENU, sans exception ;
 *   2. AUCUNE ECRITURE en base pendant l'affichage et pendant l'apercu ;
 *   3. DEUX clics sur « Enregistrer » ne produisent qu'UN jeu d'ecritures.
 *
 * Lancer :  node --test tests/rendu-ecran-import-excel.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { rendreEcran } from './outils/rendu-ecran.mjs';
import { COLONNES_MODELE, FEUILLE_DONNEES } from '../src/features/rapports/import-excel.js';

const ECRAN = 'src/features/rapports/components/import-excel-ecran.jsx';
const ENTETE = COLONNES_MODELE.map((c) => c.libelle);

/** Matrice de feuille a partir de lignes d'objets. */
function matrice(lignes) {
  return [ENTETE, ...lignes.map((l) => COLONNES_MODELE.map((c) => (l[c.cle] === undefined ? '' : l[c.cle])))];
}

/** Classeur .xlsx reel, sous forme d'octets. */
function classeur(lignes, nomFeuille = FEUILLE_DONNEES) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matrice(lignes)), nomFeuille);
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}

/**
 * Texte VIVANT de l'ecran.
 *
 * ⚠️ `v.texte` rendu par le harnais est un INSTANTANE pris au montage. Apres un
 * clic ou le depot d'un fichier, il ne bouge plus : l'assertion porterait sur
 * l'ecran d'avant, et passerait au vert sans rien verifier. On relit donc le
 * conteneur a chaque fois.
 */
function texteVivant(v) {
  return v.conteneur.textContent || '';
}

/**
 * Un montant tel que l'ecran l'affiche reellement.
 *
 * ⚠️ `Intl.NumberFormat('fr-FR')` separe les milliers par une ESPACE FINE
 * INSECABLE (U+202F), pas par une espace ordinaire. Ecrire « 18 850 F » a la
 * main dans une assertion produit un test qui echoue pour une raison qui n'a
 * rien a voir avec le montant.
 */
function montant(n) {
  return `${new Intl.NumberFormat('fr-FR').format(n)} F`;
}

/** Cherche un bouton par son texte (egalite d'abord, cf. tests/rendu-ecrans). */
function bouton(conteneur, texte) {
  const tous = [...conteneur.querySelectorAll('button')];
  return tous.find((b) => (b.textContent || '').trim() === texte)
    || tous.find((b) => (b.textContent || '').includes(texte));
}

/** Vidange plusieurs tours de promesses (FileReader -> setState -> re-rendu). */
async function vidanger(v, tours = 8) {
  for (let i = 0; i < tours; i++) {
    await v.act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}

/**
 * Depose un vrai fichier dans l'input de l'ecran et laisse le FileReader finir.
 * `input.files` est en lecture seule dans jsdom : on la redefinit, comme le
 * navigateur le ferait apres un choix de l'utilisateur.
 */
async function deposerFichier(v, octets, nom = 'rapport-coupure.xlsx') {
  const input = v.conteneur.querySelector('[data-testid="import-excel-fichier"]');
  assert.ok(input, 'le champ de fichier est introuvable : le scenario ne teste rien');

  const fichier = new globalThis.File([octets], nom, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  Object.defineProperty(input, 'files', { value: [fichier], configurable: true, writable: true });

  await v.act(async () => {
    input.dispatchEvent(new globalThis.Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
  await vidanger(v);
  return input;
}

/** Les rapports ecrits en base pendant le scenario. */
function creations(v) {
  return v.journal.ecritures.filter((e) => e.collection === 'rapports' && e.operation === 'create');
}
function modifications(v) {
  return v.journal.ecritures.filter((e) => e.collection === 'rapports' && e.operation === 'update');
}

/* ═══════════════════════════════════════════════════════════════════════════
   Donnees de base, aux formes reelles de la production
   ═══════════════════════════════════════════════════════════════════════════ */

/** Forme exacte d'un rapport saisi a la main (releve en base le 16/09/2026). */
const RAPPORT_SAISI = {
  id: '9a37c12c-0c76-4c49-9388-37ed85afb720',
  date: '2026-03-26',
  statut: 'soumis',
  operateur_nom: 'Opérateur Acceuil',
  categories: {
    scan: 0, copies: 2350, imprimerie: 16000, demi_photos: 4000,
    maintenance: 0, marchandises: 400, tirage_saisies: 11700, badges_plastification: 3500,
  },
  depenses: [{ montant: 51000, description: 'wifi(février)' }],
  lignes: [{
    scan: 0, copies: 2350, sorties: 51000, imprimerie: 16000, demi_photos: 4000,
    description: 'wifi(février)', maintenance: 0, marchandises: 400,
    tirage_saisies: 11700, badges_plastification: 3500,
  }],
};

/**
 * Forme exacte d'un rapport issu de l'import de mars : un total fige de 91 800 F
 * pose a cote de categories TOUTES A ZERO (id reel, releve en production).
 * Le nouvel ecran doit le lire sans broncher — et ne jamais reproduire ca.
 */
const RAPPORT_IMPORT_MARS = {
  id: '1385703c-c9d6-4f57-b3a9-cc5a4018adfb',
  date: '2026-01-05',
  statut: 'brouillon',
  source: 'import_historique',
  operateur_nom: 'Imprimerie Admin',
  lignes: [],
  depenses: [],
  categories: {
    scan: 0, copies: 0, imprimerie: 0, demi_photos: 0,
    maintenance: 0, marchandises: 0, tirage_saisies: 0, badges_plastification: 0,
  },
  caisse_journee: 30600,
  total_depenses: 0,
  total_recettes: 91800,
  observations: 'CASH CAISSE:',
};

const BASE = { rapports: [RAPPORT_SAISI, RAPPORT_IMPORT_MARS] };

/* ═══════════════════════════════════════════════════════════════════════════
   1. L ecran s affiche
   ═══════════════════════════════════════════════════════════════════════════ */

test('Import Excel — l ecran s affiche, sans exception', async () => {
  const v = await rendreEcran({ ecran: ECRAN, donnees: BASE });
  try {
    assert.ok(texteVivant(v).length > 100, `écran quasi vide (${texteVivant(v).length} caractères) : écran blanc`);
    assert.match(texteVivant(v), /Importer un rapport saisi sur Excel/);
    assert.match(texteVivant(v), /coupure/i, 'l’écran doit dire à quoi il sert');
    assert.match(texteVivant(v), /Modele Excel/, 'le modèle doit être téléchargeable depuis l’écran');
    assert.match(texteVivant(v), /2 rapport\(s\) deja en base/, 'l’écran doit annoncer ce qu’il a lu');
    assert.deepEqual(v.erreurs.map(String), [], 'une exception est partie pendant le montage');
  } finally { await v.demonter(); }
});

test('Import Excel — AUCUNE ECRITURE en base pendant le simple affichage', async () => {
  const v = await rendreEcran({ ecran: ECRAN, donnees: BASE });
  try {
    assert.deepEqual(
      v.journal.ecritures, [],
      'ouvrir l’écran d’import modifie la base — c’est le bug de référence C1/C2',
    );
    assert.ok(v.journal.lectures.includes('rapports'), 'l’écran doit tout de même lire les rapports');
  } finally { await v.demonter(); }
});

test('Import Excel — une base VIDE ne blanchit pas l ecran', async () => {
  const v = await rendreEcran({ ecran: ECRAN, donnees: {} });
  try {
    assert.ok(texteVivant(v).length > 100, 'écran blanc sur une base vide');
    assert.match(texteVivant(v), /0 rapport\(s\) deja en base/);
    assert.deepEqual(v.journal.ecritures, []);
    assert.deepEqual(v.erreurs.map(String), []);
  } finally { await v.demonter(); }
});

test('Import Excel — des rapports ABIMES ne blanchissent pas l ecran', async () => {
  const v = await rendreEcran({
    ecran: ECRAN,
    donnees: {
      rapports: [
        {},
        { id: '2', date: null, categories: null, depenses: 'texte' },
        { id: '3', date: '2026-02-30', categories: { inconnu: 'abc' } },
        { id: '4', date: '2026-01-05', statut: 'statut_inconnu', lignes: null },
      ],
    },
  });
  try {
    assert.ok(texteVivant(v).length > 100, 'écran blanc sur des données abîmées');
    assert.deepEqual(v.erreurs.map(String), []);
    assert.deepEqual(v.journal.ecritures, []);
  } finally { await v.demonter(); }
});

test('Import Excel — sans fichier, « Enregistrer » est eteint ET dit pourquoi', async () => {
  const v = await rendreEcran({ ecran: ECRAN, donnees: BASE });
  try {
    const b = bouton(v.conteneur, 'Enregistrer');
    assert.ok(b, 'le bouton « Enregistrer » est introuvable');
    assert.equal(b.disabled, true, 'sans fichier, le bouton doit être éteint');
    assert.match(
      texteVivant(v), /Choisissez d'abord un fichier Excel/,
      'un bouton désactivé doit toujours dire pourquoi, à côté',
    );
  } finally { await v.demonter(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. L apercu : rien n est ecrit avant confirmation
   ═══════════════════════════════════════════════════════════════════════════ */

test('Import Excel — un fichier valide produit un APERCU chiffre, sans rien ecrire', async () => {
  const v = await rendreEcran({ ecran: ECRAN, donnees: BASE });
  try {
    await deposerFichier(v, classeur([
      { date: '21/09/2026', copies: '2 350', imprimerie: 16000 },
      { date: '21/09/2026', scan: 500, sorties: 300, description: 'taxi' },
      { date: '22/09/2026', copies: 4000 },
    ]));

    assert.deepEqual(v.erreurs.map(String), [], 'exception pendant la lecture du fichier');
    assert.match(texteVivant(v), /Journees qui seront creees/, 'l’aperçu doit lister ce qui sera créé');
    assert.match(texteVivant(v), /21 septembre 2026/, 'la journée doit être nommée en clair');
    assert.ok(texteVivant(v).includes(montant(18850)), 'le total du 21/09 (2350+16000+500) doit être affiché');
    assert.ok(texteVivant(v).includes(montant(4000)), 'le total du 22/09 doit être affiché');

    assert.deepEqual(
      v.journal.ecritures, [],
      'RIEN ne doit être écrit tant que le gérant n’a pas confirmé',
    );
  } finally { await v.demonter(); }
});

test('Import Excel — les lignes fautives sont NOMMEES, les bonnes restent importables', async () => {
  const v = await rendreEcran({ ecran: ECRAN, donnees: BASE });
  try {
    await deposerFichier(v, classeur([
      { date: '21/09/2026', copies: 1000 },
      { date: '32/09/2026', copies: 5000 },
      { date: '23/09/2026', copies: 'beaucoup' },
    ]));

    assert.match(texteVivant(v), /Lignes refusees \(2\)/);
    assert.match(texteVivant(v), /ligne 3/, 'le numéro de ligne d’Excel doit être cité');
    assert.match(texteVivant(v), /septembre 2026 n'a que 30 jours/);
    assert.match(texteVivant(v), /ligne 4/);
    assert.match(texteVivant(v), /« beaucoup » n'est pas un montant/);
    assert.match(texteVivant(v), /Journees qui seront creees \(1\)/, 'import partiel : la bonne ligne reste');
    assert.deepEqual(v.journal.ecritures, []);
  } finally { await v.demonter(); }
});

test('Import Excel — un fichier sans colonne Date est refuse en le disant', async () => {
  const v = await rendreEcran({ ecran: ECRAN, donnees: BASE });
  try {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Copies', 'Scan'], [2000, 500]]), 'Feuil1');
    await deposerFichier(v, XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), 'sans-date.xlsx');

    assert.match(texteVivant(v), /Ce fichier ne peut pas etre importe/);
    assert.match(texteVivant(v), /Date.*introuvable/);
    assert.equal(bouton(v.conteneur, 'Enregistrer').disabled, true);
    assert.deepEqual(v.journal.ecritures, []);
  } finally { await v.demonter(); }
});

test('Import Excel — un fichier qui n est pas un tableur ne blanchit pas l ecran', async () => {
  const v = await rendreEcran({ ecran: ECRAN, donnees: BASE });
  try {
    await deposerFichier(v, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), 'photo.jpg');
    assert.ok(texteVivant(v).length > 100, 'écran blanc sur un fichier illisible');
    assert.match(texteVivant(v), /ne peut pas etre importe|pas un tableur/i);
    assert.deepEqual(v.erreurs.map(String), []);
    assert.deepEqual(v.journal.ecritures, []);
  } finally { await v.demonter(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. Les conflits : jamais d ecrasement silencieux
   ═══════════════════════════════════════════════════════════════════════════ */

test('Import Excel — une journee DEJA en base est presentee comme un choix, non appliquee', async () => {
  const v = await rendreEcran({ ecran: ECRAN, donnees: BASE });
  try {
    // 2026-03-26 existe deja : 38 950 F de recettes saisies a la main.
    await deposerFichier(v, classeur([{ date: '26/03/2026', copies: 1000 }]));

    assert.match(texteVivant(v), /Journees deja enregistrees \(1\)/);
    assert.match(texteVivant(v), /choix requis/);
    assert.match(texteVivant(v), /Remplacer/);
    assert.match(texteVivant(v), /Fusionner/);
    assert.match(texteVivant(v), /Ignorer/);
    assert.ok(texteVivant(v).includes(`${montant(37950)} de recettes`), 'le montant déjà en base doit être montré');
    assert.ok(texteVivant(v).includes(`${montant(1000)} de recettes`), 'le montant du fichier doit être montré');
    assert.ok(texteVivant(v).includes(`${montant(38950)} de recettes`), 'le résultat d’une fusion doit être montré d’avance');

    const b = bouton(v.conteneur, 'Enregistrer');
    assert.equal(b.disabled, true, 'un conflit non tranché doit éteindre le bouton');
    assert.match(texteVivant(v), /attend votre choix/);
    assert.deepEqual(v.journal.ecritures, []);
  } finally { await v.demonter(); }
});

test('Import Excel — « Ignorer » n ecrit rien du tout', async () => {
  const v = await rendreEcran({ ecran: ECRAN, donnees: BASE });
  try {
    await deposerFichier(v, classeur([{ date: '26/03/2026', copies: 1000 }]));
    await v.act(async () => { bouton(v.conteneur, 'Ignorer').click(); await new Promise((r) => setTimeout(r, 0)); });
    await vidanger(v, 3);

    assert.match(texteVivant(v), /Rien a enregistrer/);
    assert.equal(bouton(v.conteneur, 'Enregistrer').disabled, true);
    assert.deepEqual(v.journal.ecritures, []);
  } finally { await v.demonter(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. L ecriture, apres confirmation
   ═══════════════════════════════════════════════════════════════════════════ */

test('Import Excel — apres confirmation, les journees sont creees SANS total fige', async () => {
  const v = await rendreEcran({ ecran: ECRAN, donnees: BASE });
  try {
    await deposerFichier(v, classeur([
      { date: '21/09/2026', copies: 2350, imprimerie: 16000 },
      { date: '21/09/2026', scan: 500, sorties: 300, description: 'taxi' },
      { date: '22/09/2026', copies: 4000 },
    ]));

    await v.act(async () => { bouton(v.conteneur, 'Enregistrer').click(); await new Promise((r) => setTimeout(r, 0)); });
    await vidanger(v);

    const ecrites = creations(v);
    assert.equal(ecrites.length, 2, `${ecrites.length} rapports créés au lieu de 2`);

    const j21 = ecrites.find((e) => e.data.date === '2026-09-21');
    assert.ok(j21, 'la journée du 21/09 doit être créée avec sa date métier, pas la veille');

    // LE POINT CENTRAL : aucun total recopie, et un detail qui justifie le total.
    assert.equal(j21.data.total_recettes, undefined, 'total_recettes ne doit JAMAIS être écrit');
    assert.equal(j21.data.total_depenses, undefined);
    assert.equal(j21.data.caisse_journee, undefined);

    const sommeCategories = Object.values(j21.data.categories).reduce((s, x) => s + x, 0);
    assert.equal(sommeCategories, 18850, '2350 + 16000 + 500');
    const sommeLignes = j21.data.lignes.reduce(
      (s, l) => s + ['copies', 'imprimerie', 'scan'].reduce((x, c) => x + (l[c] || 0), 0), 0,
    );
    assert.equal(sommeCategories, sommeLignes, 'le total et son détail doivent être le MÊME chiffre');

    // Modifiable apres import : c est la demande explicite de Gassim.
    assert.equal(j21.data.statut, 'brouillon');

    // Tracabilite.
    assert.equal(j21.data.source, 'import_excel');
    assert.equal(j21.data.import_excel.fichier, 'rapport-coupure.xlsx');
    assert.equal(j21.data.import_excel.importe_par, 'Gassim Admin');
    assert.deepEqual(j21.data.import_excel.lignes_fichier, [2, 3]);
    assert.ok(j21.data.import_excel.importe_le, 'la date d’import doit être enregistrée');

    assert.deepEqual(v.erreurs.map(String), []);
  } finally { await v.demonter(); }
});

test('Import Excel — « Fusionner » ajoute sans ecraser, et laisse une trace dans l historique', async () => {
  const v = await rendreEcran({ ecran: ECRAN, donnees: BASE });
  try {
    await deposerFichier(v, classeur([{ date: '26/03/2026', copies: 1000 }]));
    await v.act(async () => { bouton(v.conteneur, 'Fusionner').click(); await new Promise((r) => setTimeout(r, 0)); });
    await vidanger(v, 3);
    await v.act(async () => { bouton(v.conteneur, 'Enregistrer').click(); await new Promise((r) => setTimeout(r, 0)); });
    await vidanger(v);

    assert.deepEqual(creations(v), [], 'une fusion ne doit PAS créer un second rapport pour la même date');
    const maj = modifications(v);
    assert.equal(maj.length, 1);
    assert.equal(maj[0].id, RAPPORT_SAISI.id, 'c’est le rapport existant qui est modifié');

    assert.equal(maj[0].data.categories.copies, 3350, '2 350 existants + 1 000 importés');
    assert.equal(maj[0].data.categories.imprimerie, 16000, 'un poste absent du fichier ne doit pas être effacé');
    assert.equal(maj[0].data.depenses.length, 1, 'la dépense existante est conservée');
    assert.equal(maj[0].data.date, undefined, 'la date du rapport existant n’est pas réécrite');
    assert.equal(maj[0].data.total_recettes, undefined);

    const h = maj[0].data.historique;
    assert.ok(Array.isArray(h) && h.length === 1, 'la modification doit apparaître dans l’historique');
    assert.match(h[0].motif, /Import Excel/);
    assert.ok(h[0].details.some((d) => d.ancien === 2350 && d.nouveau === 3350));
  } finally { await v.demonter(); }
});

test('Import Excel — un rapport de l import de mars (total fige, detail vide) reste lisible', async () => {
  const v = await rendreEcran({ ecran: ECRAN, donnees: BASE });
  try {
    await deposerFichier(v, classeur([{ date: '05/01/2026', copies: 30600 }]));

    assert.deepEqual(v.erreurs.map(String), []);
    assert.match(texteVivant(v), /Journees deja enregistrees/);
    // Le total de 91 800 F n est adosse a rien : l ecran affiche ce que les
    // categories disent reellement, soit 0 F, et non le champ recopie.
    assert.ok(texteVivant(v).includes(`${montant(0)} de recettes`), 'le total figé ne doit pas être affiché comme une recette');
    assert.ok(texteVivant(v).includes(`${montant(30600)} de recettes`), 'le montant du fichier doit être montré');
    assert.deepEqual(v.journal.ecritures, []);
  } finally { await v.demonter(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. LE TEST QUI COMPTE : le double-clic
   ═══════════════════════════════════════════════════════════════════════════ */

test('Import Excel — DEUX clics sur « Enregistrer » ne creent QU UN jeu de rapports', async () => {
  const v = await rendreEcran({ ecran: ECRAN, donnees: BASE });
  try {
    await deposerFichier(v, classeur([
      { date: '21/09/2026', copies: 2350 },
      { date: '22/09/2026', copies: 4000 },
    ]));

    const b = bouton(v.conteneur, 'Enregistrer');
    assert.equal(b.disabled, false, 'le bouton doit être actif : sinon le scénario ne teste rien');

    // Deux clics dans le MEME tour, comme un double-clic reel sur la connexion
    // lente de Moanda. Un simple booleen d'etat React ne suffirait pas :
    // `setState` est asynchrone, les deux clics liraient `false`.
    await v.act(async () => {
      b.click();
      b.click();
      await new Promise((r) => setTimeout(r, 0));
    });
    await vidanger(v, 10);

    const ecrites = creations(v);
    assert.equal(ecrites.length, 2, `${ecrites.length} rapports créés au lieu de 2 — le double-clic a doublé l’import`);
    const dates = ecrites.map((e) => e.data.date).sort();
    assert.deepEqual(dates, ['2026-09-21', '2026-09-22']);
  } finally { await v.demonter(); }
});

test('Import Excel — LE MEME FICHIER importe DEUX FOIS ne cree pas de doublon', async () => {
  const v = await rendreEcran({ ecran: ECRAN, donnees: BASE });
  try {
    const octets = classeur([{ date: '21/09/2026', copies: 2350 }]);

    // 1er import.
    await deposerFichier(v, octets);
    await v.act(async () => { bouton(v.conteneur, 'Enregistrer').click(); await new Promise((r) => setTimeout(r, 0)); });
    await vidanger(v);
    assert.equal(creations(v).length, 1);

    // 2e import du MEME fichier. L ecran a recharge la base : la journee existe.
    await deposerFichier(v, octets);

    assert.match(texteVivant(v), /Journees deja enregistrees \(1\)/);
    assert.match(texteVivant(v), /fichier deja importe/, 'l’empreinte doit reconnaître un ré-import');
    assert.equal(
      bouton(v.conteneur, 'Enregistrer').disabled, true,
      'sans nouveau choix, le second import ne doit rien pouvoir écrire',
    );
    assert.equal(creations(v).length, 1, 'aucun second rapport ne doit être créé pour la même journée');
  } finally { await v.demonter(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   6. Les rapports verrouilles
   ═══════════════════════════════════════════════════════════════════════════ */

test('Import Excel — un rapport CLOTURE ne peut etre ni remplace ni fusionne, et on dit pourquoi', async () => {
  const v = await rendreEcran({
    ecran: ECRAN,
    donnees: { rapports: [{ ...RAPPORT_SAISI, statut: 'cloture' }] },
  });
  try {
    await deposerFichier(v, classeur([{ date: '26/03/2026', copies: 1000 }]));

    const remplacer = bouton(v.conteneur, 'Remplacer');
    const fusionner = bouton(v.conteneur, 'Fusionner');
    assert.equal(remplacer.disabled, true, 'un rapport clôturé ne doit pas pouvoir être écrasé par un import');
    assert.equal(fusionner.disabled, true);
    assert.equal(bouton(v.conteneur, 'Ignorer').disabled, false, '« Ignorer » doit rester possible');
    assert.match(texteVivant(v), /verrouille/, 'le motif du refus doit être visible à côté du bouton');
    assert.match(texteVivant(v), /Deverrouillez-le d'abord/);
    assert.deepEqual(v.journal.ecritures, []);
  } finally { await v.demonter(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   7. L ecran Rapports lui-meme reste sain
   ═══════════════════════════════════════════════════════════════════════════ */

test('Rapports — l ecran s affiche toujours et propose l import, sans rien ecrire', async () => {
  const v = await rendreEcran({ ecran: 'src/features/rapports/page.jsx', donnees: BASE });
  try {
    assert.ok(texteVivant(v).length > 100, 'écran blanc sur Rapports journaliers');
    assert.match(texteVivant(v), /Rapports journaliers/);
    assert.match(texteVivant(v), /Importer Excel/, 'le chemin vers l’import doit être visible depuis l’écran Rapports');
    assert.match(texteVivant(v), /Modele Excel/, 'le modèle doit se télécharger sans ouvrir l’import');
    assert.deepEqual(v.journal.ecritures, [], 'consulter Rapports ne doit rien écrire');
    assert.deepEqual(v.erreurs.map(String), []);
  } finally { await v.demonter(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   8. Hors ligne — le vrai contexte d usage a Moanda
   ═══════════════════════════════════════════════════════════════════════════ */

test('Import Excel — coupure du reseau : l ecran le dit et eteint « Enregistrer »', async () => {
  const v = await rendreEcran({ ecran: ECRAN, donnees: BASE });
  try {
    await deposerFichier(v, classeur([{ date: '21/09/2026', copies: 2350 }]));
    assert.equal(bouton(v.conteneur, 'Enregistrer').disabled, false, 'en ligne, le bouton doit être actif');

    // Le reseau tombe pendant que le gerant regarde l apercu.
    await v.act(async () => {
      globalThis.window.dispatchEvent(new globalThis.Event('offline'));
      await new Promise((r) => setTimeout(r, 0));
    });
    await vidanger(v, 3);

    assert.match(texteVivant(v), /Pas de reseau sur cet appareil/);
    assert.match(texteVivant(v), /croirait la base vide/);
    assert.equal(
      bouton(v.conteneur, 'Enregistrer').disabled, true,
      'hors ligne, l’import ne doit pas pouvoir écrire : l’aperçu serait faux',
    );
    assert.deepEqual(v.journal.ecritures, []);

    // Le reseau revient : le meme fichier redevient enregistrable, sans le rechoisir.
    await v.act(async () => {
      globalThis.window.dispatchEvent(new globalThis.Event('online'));
      await new Promise((r) => setTimeout(r, 0));
    });
    await vidanger(v, 3);
    assert.equal(bouton(v.conteneur, 'Enregistrer').disabled, false, 'le retour du réseau doit rouvrir l’import');
    assert.ok(!texteVivant(v).includes('Pas de reseau sur cet appareil'));
  } finally { await v.demonter(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   9. Le modele se relit lui-meme, en vrai .xlsx
   ═══════════════════════════════════════════════════════════════════════════ */

test('Import Excel — le MODELE telecharge est importable tel quel', async () => {
  // Un modele que son propre import ne sait pas relire serait un piege : le
  // gerant remplirait le fichier pendant la coupure et decouvrirait le
  // probleme le lendemain, une journee de recettes a la main.
  const { matriceModele, CONSIGNES_MODELE, FEUILLE_CONSIGNES } =
    await import('../src/features/rapports/import-excel.js');

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matriceModele()), FEUILLE_DONNEES);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(CONSIGNES_MODELE), FEUILLE_CONSIGNES);
  const octets = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

  const v = await rendreEcran({ ecran: ECRAN, donnees: { rapports: [] } });
  try {
    await deposerFichier(v, octets, 'modele-rapport-journalier.xlsx');

    assert.deepEqual(v.erreurs.map(String), []);
    assert.ok(
      !texteVivant(v).includes('Ce fichier ne peut pas etre importe'),
      'le modèle produit par l’application doit être lisible par l’application',
    );
    // « Lignes refusees » est aussi le libelle d'une carte du resume, toujours
    // presente : c'est la SECTION « Lignes refusees (N) » qui ne doit pas exister.
    assert.ok(
      !/Lignes refusees \(\d+\)/.test(texteVivant(v)),
      'aucune ligne du modèle ne doit être refusée',
    );
    // La feuille de consignes ne doit PAS etre prise pour des donnees : le
    // lecteur choisit la feuille « Rapports », pas la premiere venue.
    assert.match(texteVivant(v), /Journees qui seront creees \(1\)/, 'seule la ligne d’exemple est vue');
    assert.match(texteVivant(v), /01 janvier 2020/, 'la date d’exemple doit être lue correctement');
    assert.ok(texteVivant(v).includes(montant(18500)), 'l’exemple vaut 2 500 + 16 000');
    assert.deepEqual(v.journal.ecritures, [], 'ouvrir le modèle n’écrit rien');
  } finally { await v.demonter(); }
});
