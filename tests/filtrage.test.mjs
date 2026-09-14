/**
 * Tests — filtrage des rapports journaliers (plage de dates + recherche par mot).
 *
 * Demande d'origine (gérant de l'imprimerie) :
 *   « Rapports : avoir la possibilité de sélectionner une plage de dates
 *     (ex : du 05 au 15/04) et rechercher un mot dans les rapports. »
 *
 * Deux pièges couverts ici :
 *  1. Les bornes doivent être INCLUSES des deux côtés — « du 05 au 15 » contient le 15.
 *  2. Le filtrage par date ne doit JAMAIS dépendre du fuseau de la machine.
 *     Cf. src/lib/dates.js : `new Date(y,m,d).toISOString().slice(0,10)` a déjà
 *     produit un écart de 55 300 F entre deux écrans.
 *
 * Lancer :
 *   node --test tests/filtrage.test.mjs
 * Sur plusieurs fuseaux (obligatoire avant de livrer) :
 *   for tz in Africa/Libreville Europe/Paris UTC Pacific/Kiritimati; do
 *     TZ=$tz node --test tests/filtrage.test.mjs
 *   done
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normaliserTexte,
  texteRecherchable,
  estDateMetier,
  normaliserPlage,
  dansPlage,
  plageActive,
  filtrerRapports,
  indexerRapports,
  formatJour,
  libellePlage,
  totauxFiltres,
} from '../src/features/rapports/filtrage.js';

/* ─────────────────────────── Jeu de données ─────────────────────────── */

/** Rapports d'avril 2026, volontairement accentués et de casse mixte. */
const RAPPORTS = [
  {
    id: 'r03', date: '2026-04-03', statut: 'valide', operateur_nom: 'Jean NDONG',
    categories: { copies: 1000 }, depenses: [{ description: 'Carburant', montant: 200 }],
    lignes: [{ description: 'Affiches mairie' }],
  },
  {
    id: 'r05', date: '2026-04-05', statut: 'valide', operateur_nom: 'Chantal MBOUMBA',
    categories: { copies: 5000, scan: 500 }, depenses: [{ description: 'Dépôt banque', montant: 1000 }],
    lignes: [{ description: 'Copies A4 école' }],
  },
  {
    id: 'r09', date: '2026-04-09', statut: 'soumis', operateur_nom: 'Jean NDONG',
    categories: { imprimerie: 3000 }, depenses: [],
    lignes: [{ description: 'BÂCHE anniversaire' }, { description: 'depot materiel' }],
  },
  {
    id: 'r15', date: '2026-04-15', statut: 'cloture', operateur_nom: 'Chantal MBOUMBA',
    categories: { copies: 2000, maintenance: 1000 }, depenses: [{ description: 'Réparation massicot', montant: 500 }],
    lignes: [{ description: 'Badges ÉCOLE Saint-Pierre' }],
  },
  {
    id: 'r16', date: '2026-04-16', statut: 'brouillon', operateur_nom: 'Paul OBAME',
    categories: { scan: 800 }, depenses: [],
    lignes: [{ description: 'Scan dossiers' }],
  },
  {
    id: 'r30', date: '2026-03-30', statut: 'valide', operateur_nom: 'Paul OBAME',
    categories: { copies: 400 }, depenses: [],
    lignes: [{ description: 'Cartes de visite' }],
  },
];

const ids = (liste) => liste.map((r) => r.id);

/* ─────────────────────── Plage : bornes incluses ─────────────────────── */

test('borne incluse des deux côtés — « du 05 au 15/04 » contient le 05 ET le 15', () => {
  const res = filtrerRapports(RAPPORTS, { debut: '2026-04-05', fin: '2026-04-15' });
  assert.deepEqual(ids(res), ['r05', 'r09', 'r15']);
  assert.ok(ids(res).includes('r05'), 'la borne de début doit être incluse');
  assert.ok(ids(res).includes('r15'), 'la borne de fin doit être incluse');
  assert.ok(!ids(res).includes('r16'), 'le 16 est hors plage');
  assert.ok(!ids(res).includes('r03'), 'le 03 est hors plage');
});

test('dansPlage — égalité stricte sur chaque borne', () => {
  assert.equal(dansPlage('2026-04-05', '2026-04-05', '2026-04-15'), true);
  assert.equal(dansPlage('2026-04-15', '2026-04-05', '2026-04-15'), true);
  assert.equal(dansPlage('2026-04-04', '2026-04-05', '2026-04-15'), false);
  assert.equal(dansPlage('2026-04-16', '2026-04-05', '2026-04-15'), false);
});

test('plage d’un seul jour — début = fin ne renvoie que ce jour', () => {
  const res = filtrerRapports(RAPPORTS, { debut: '2026-04-09', fin: '2026-04-09' });
  assert.deepEqual(ids(res), ['r09']);
});

test('plage d’un seul jour sans rapport — liste vide, pas d’erreur', () => {
  const res = filtrerRapports(RAPPORTS, { debut: '2026-04-10', fin: '2026-04-10' });
  assert.deepEqual(ids(res), []);
});

test('borne ouverte — seulement « du », puis seulement « au »', () => {
  assert.deepEqual(ids(filtrerRapports(RAPPORTS, { debut: '2026-04-15' })), ['r15', 'r16']);
  assert.deepEqual(ids(filtrerRapports(RAPPORTS, { fin: '2026-04-03' })), ['r03', 'r30']);
});

test('changement de mois dans la plage — mars et avril ensemble', () => {
  const res = filtrerRapports(RAPPORTS, { debut: '2026-03-30', fin: '2026-04-03' });
  assert.deepEqual(ids(res).sort(), ['r03', 'r30']);
});

/* ───────────────────────── Plage : début > fin ───────────────────────── */

test('début > fin — les bornes sont remises à l’endroit et signalées', () => {
  const p = normaliserPlage('2026-04-15', '2026-04-05');
  assert.equal(p.debut, '2026-04-05');
  assert.equal(p.fin, '2026-04-15');
  assert.equal(p.inversee, true);
});

test('début > fin — le filtrage donne le même résultat que la plage à l’endroit', () => {
  const alEndroit = filtrerRapports(RAPPORTS, { debut: '2026-04-05', fin: '2026-04-15' });
  const alEnvers = filtrerRapports(RAPPORTS, { debut: '2026-04-15', fin: '2026-04-05' });
  assert.deepEqual(ids(alEnvers), ids(alEndroit));
  assert.deepEqual(ids(alEnvers), ['r05', 'r09', 'r15']);
});

test('plage à l’endroit — inversee reste faux', () => {
  assert.equal(normaliserPlage('2026-04-05', '2026-04-15').inversee, false);
  assert.equal(normaliserPlage('2026-04-05', '2026-04-05').inversee, false);
});

test('borne mal formée ou vide — traitée comme borne ouverte, pas comme « aucun résultat »', () => {
  assert.equal(estDateMetier(''), false);
  assert.equal(estDateMetier('05/04/2026'), false);
  assert.equal(estDateMetier('2026-4-5'), false);
  assert.equal(estDateMetier('2026-04-05'), true);
  assert.equal(ids(filtrerRapports(RAPPORTS, { debut: '', fin: '' })).length, RAPPORTS.length);
  assert.equal(ids(filtrerRapports(RAPPORTS, { debut: '05/04/2026' })).length, RAPPORTS.length);
  assert.equal(plageActive('', ''), false);
  assert.equal(plageActive('2026-04-05', ''), true);
});

/* ──────────────────── Recherche : accents et casse ───────────────────── */

test('normaliserTexte — accents, cédille, ligature, casse, espaces', () => {
  assert.equal(normaliserTexte('Dépôt'), 'depot');
  assert.equal(normaliserTexte('BÂCHE'), 'bache');
  assert.equal(normaliserTexte('Réparation  massicot '), 'reparation massicot');
  assert.equal(normaliserTexte('Français'), 'francais');
  assert.equal(normaliserTexte('Sœur'), 'soeur');
  assert.equal(normaliserTexte(null), '');
  assert.equal(normaliserTexte(undefined), '');
});

test('recherche accentuée trouvée sans accent — « depot » trouve « Dépôt banque »', () => {
  const res = filtrerRapports(RAPPORTS, { mot: 'depot' });
  // r05 : dépense « Dépôt banque »  ·  r09 : ligne « depot materiel »
  assert.deepEqual(ids(res).sort(), ['r05', 'r09']);
});

test('recherche sans accent trouvée avec accent — « dépôt » trouve « depot materiel »', () => {
  const res = filtrerRapports(RAPPORTS, { mot: 'dépôt' });
  assert.deepEqual(ids(res).sort(), ['r05', 'r09']);
});

test('casse mixte — « BaChE », « bache », « BÂCHE » donnent le même résultat', () => {
  const attendu = ['r09'];
  assert.deepEqual(ids(filtrerRapports(RAPPORTS, { mot: 'bache' })), attendu);
  assert.deepEqual(ids(filtrerRapports(RAPPORTS, { mot: 'BaChE' })), attendu);
  assert.deepEqual(ids(filtrerRapports(RAPPORTS, { mot: 'BÂCHE' })), attendu);
  assert.deepEqual(ids(filtrerRapports(RAPPORTS, { mot: 'bÂcHe' })), attendu);
});

test('recherche accent + casse mixte sur un libellé de ligne — « école »', () => {
  assert.deepEqual(ids(filtrerRapports(RAPPORTS, { mot: 'ecole' })).sort(), ['r05', 'r15']);
  assert.deepEqual(ids(filtrerRapports(RAPPORTS, { mot: 'ÉCOLE' })).sort(), ['r05', 'r15']);
});

test('recherche sur le nom de l’employé qui a saisi', () => {
  assert.deepEqual(ids(filtrerRapports(RAPPORTS, { mot: 'chantal' })).sort(), ['r05', 'r15']);
  assert.deepEqual(ids(filtrerRapports(RAPPORTS, { mot: 'ndong' })).sort(), ['r03', 'r09']);
});

test('recherche sur le libellé d’une dépense', () => {
  assert.deepEqual(ids(filtrerRapports(RAPPORTS, { mot: 'carburant' })), ['r03']);
  assert.deepEqual(ids(filtrerRapports(RAPPORTS, { mot: 'reparation' })), ['r15']);
});

test('recherche sur un commentaire / une note libre', () => {
  const avecNote = [
    { id: 'n1', date: '2026-04-07', commentaire: 'Panne électrique le matin', lignes: [], depenses: [] },
    { id: 'n2', date: '2026-04-08', note: 'Client Mairie réglé en espèces', lignes: [], depenses: [] },
  ];
  assert.deepEqual(ids(filtrerRapports(avecNote, { mot: 'electrique' })), ['n1']);
  assert.deepEqual(ids(filtrerRapports(avecNote, { mot: 'especes' })), ['n2']);
});

test('recherche vide ou blanche — aucun filtre appliqué', () => {
  assert.equal(filtrerRapports(RAPPORTS, { mot: '' }).length, RAPPORTS.length);
  assert.equal(filtrerRapports(RAPPORTS, { mot: '   ' }).length, RAPPORTS.length);
  assert.equal(filtrerRapports(RAPPORTS, { mot: undefined }).length, RAPPORTS.length);
  assert.equal(filtrerRapports(RAPPORTS, {}).length, RAPPORTS.length);
});

test('texteRecherchable — n’indexe pas la date (c’est le rôle de la plage)', () => {
  const t = texteRecherchable(RAPPORTS[1]);
  assert.ok(t.includes('chantal mboumba'));
  assert.ok(t.includes('depot banque'));
  assert.ok(t.includes('copies a4 ecole'));
  assert.ok(!t.includes('2026-04-05'));
});

test('texteRecherchable — rapport vide ou nul ne casse pas', () => {
  assert.equal(texteRecherchable(null), '');
  assert.equal(texteRecherchable({}), '');
  assert.equal(texteRecherchable({ lignes: null, depenses: null }), '');
});

test('index pré-calculé — même résultat qu’en calcul direct', () => {
  const index = indexerRapports(RAPPORTS);
  assert.equal(index.size, RAPPORTS.length);
  const avec = filtrerRapports(RAPPORTS, { mot: 'depot' }, index);
  const sans = filtrerRapports(RAPPORTS, { mot: 'depot' });
  assert.deepEqual(ids(avec), ids(sans));
});

/* ─────────────────── Combinaison plage + mot (ET) ────────────────────── */

test('combinaison plage + mot — les deux critères s’appliquent en ET', () => {
  // « depot » seul renvoie r05 et r09 ; restreint au 09-15 il ne reste que r09.
  const res = filtrerRapports(RAPPORTS, { debut: '2026-04-09', fin: '2026-04-15', mot: 'depot' });
  assert.deepEqual(ids(res), ['r09']);
});

test('combinaison plage + mot — un mot présent HORS plage ne remonte pas', () => {
  // « carburant » n'existe que le 03/04, hors de la plage demandée.
  const res = filtrerRapports(RAPPORTS, { debut: '2026-04-05', fin: '2026-04-15', mot: 'carburant' });
  assert.deepEqual(ids(res), []);
});

test('combinaison plage + mot + statut — ET sur trois critères', () => {
  const res = filtrerRapports(RAPPORTS, {
    debut: '2026-04-01', fin: '2026-04-30', mot: 'chantal', statut: 'cloture',
  });
  assert.deepEqual(ids(res), ['r15']);
});

test('statut « all » ou vide — ne filtre pas', () => {
  assert.equal(filtrerRapports(RAPPORTS, { statut: 'all' }).length, RAPPORTS.length);
  assert.equal(filtrerRapports(RAPPORTS, { statut: '' }).length, RAPPORTS.length);
});

test('repli sur le mois — utilisé seulement si aucune borne de plage', () => {
  assert.deepEqual(ids(filtrerRapports(RAPPORTS, { mois: '2026-04' })), ['r03', 'r05', 'r09', 'r15', 'r16']);
  // Dès qu'une borne est fournie, la plage l'emporte sur le mois affiché.
  const res = filtrerRapports(RAPPORTS, { mois: '2026-04', debut: '2026-03-30', fin: '2026-03-31' });
  assert.deepEqual(ids(res), ['r30']);
});

/* ─────────────────────────── Aucun résultat ──────────────────────────── */

test('aucun résultat — mot introuvable', () => {
  assert.deepEqual(ids(filtrerRapports(RAPPORTS, { mot: 'zanzibar' })), []);
});

test('aucun résultat — plage hors données', () => {
  assert.deepEqual(ids(filtrerRapports(RAPPORTS, { debut: '2027-01-01', fin: '2027-01-31' })), []);
});

test('aucun résultat — les montants valent null, jamais 0', () => {
  const calc = {
    ca: (r) => Object.values(r.categories || {}).reduce((s, v) => s + (v || 0), 0),
    depenses: (r) => (r.depenses || []).reduce((s, d) => s + (d.montant || 0), 0),
  };
  const vide = totauxFiltres([], calc);
  assert.equal(vide.count, 0);
  assert.equal(vide.recettes, null);
  assert.equal(vide.depenses, null);
  assert.equal(vide.solde, null);
  assert.notEqual(vide.recettes, 0, 'une mesure indisponible ne doit pas s’afficher 0 F');
});

test('totaux sur un ensemble non vide — recettes, dépenses, solde', () => {
  const calc = {
    ca: (r) => Object.values(r.categories || {}).reduce((s, v) => s + (v || 0), 0),
    depenses: (r) => (r.depenses || []).reduce((s, d) => s + (d.montant || 0), 0),
  };
  const res = filtrerRapports(RAPPORTS, { debut: '2026-04-05', fin: '2026-04-15' });
  const t = totauxFiltres(res, calc);
  assert.equal(t.count, 3);
  assert.equal(t.recettes, 5500 + 3000 + 3000); // r05 5500 · r09 3000 · r15 3000
  assert.equal(t.depenses, 1000 + 0 + 500);
  assert.equal(t.solde, t.recettes - t.depenses);
});

test('liste vide ou nulle en entrée — ne lève pas', () => {
  assert.deepEqual(filtrerRapports([], { mot: 'x' }), []);
  assert.deepEqual(filtrerRapports(null, { mot: 'x' }), []);
  assert.deepEqual(filtrerRapports(undefined, {}), []);
});

test('rapport sans date — exclu dès qu’une plage est active', () => {
  const bancals = [{ id: 'x', lignes: [], depenses: [] }, { id: 'y', date: null, lignes: [], depenses: [] }];
  assert.deepEqual(ids(filtrerRapports(bancals, { debut: '2026-04-01', fin: '2026-04-30' })), []);
  // Sans plage ni mois, ils restent visibles (on ne cache pas une donnée sans raison).
  assert.equal(filtrerRapports(bancals, {}).length, 2);
});

/* ──────────────────────────── Affichage ──────────────────────────────── */

test('formatJour — JJ/MM/AAAA sans construire de Date', () => {
  assert.equal(formatJour('2026-04-05'), '05/04/2026');
  assert.equal(formatJour('2026-01-01'), '01/01/2026');
  assert.equal(formatJour('2026-12-31'), '31/12/2026');
  assert.equal(formatJour(''), '');
  assert.equal(formatJour('n’importe quoi'), '');
});

test('libellePlage — période affichée en clair', () => {
  assert.equal(libellePlage('2026-04-05', '2026-04-15'), 'du 05/04/2026 au 15/04/2026');
  assert.equal(libellePlage('2026-04-15', '2026-04-05'), 'du 05/04/2026 au 15/04/2026');
  assert.equal(libellePlage('2026-04-05', '2026-04-05'), 'le 05/04/2026');
  assert.equal(libellePlage('2026-04-05', ''), 'à partir du 05/04/2026');
  assert.equal(libellePlage('', '2026-04-15'), "jusqu'au 15/04/2026");
  assert.equal(libellePlage('', ''), '');
});

/* ──────────────────── Indépendance au fuseau horaire ─────────────────── */

test('le filtrage ne dépend pas du fuseau — résultat attendu en dur', () => {
  // Ce test échouerait si le module convertissait les dates métier en objets Date :
  // à UTC-10 (Kiritimati est à UTC+14, Honolulu à UTC-10) comme à UTC+14, le 05/04
  // doit rester le 05/04. Les valeurs ci-dessous sont indépendantes de process.env.TZ.
  const res = filtrerRapports(RAPPORTS, { debut: '2026-04-05', fin: '2026-04-15' });
  assert.deepEqual(ids(res), ['r05', 'r09', 'r15'], `échec sous TZ=${process.env.TZ || 'système'}`);
  assert.equal(dansPlage('2026-04-05', '2026-04-05', '2026-04-05'), true);
  assert.equal(formatJour('2026-04-05'), '05/04/2026');
  assert.equal(libellePlage('2026-04-05', '2026-04-15'), 'du 05/04/2026 au 15/04/2026');
});

test('aucune date métier ne transite par toISOString', () => {
  // Garde-fou explicite : sur un fuseau en avance sur UTC, l'ancien motif
  // `new Date('2026-04-05').toISOString().slice(0,10)` peut renvoyer le 04.
  // Le module doit rendre le 05 quel que soit le fuseau.
  assert.equal(formatJour('2026-04-05').startsWith('05/'), true);
  const res = filtrerRapports([{ id: 'a', date: '2026-04-05', lignes: [], depenses: [] }], {
    debut: '2026-04-05', fin: '2026-04-05',
  });
  assert.deepEqual(ids(res), ['a']);
});
