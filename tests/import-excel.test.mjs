/**
 * Import Excel des rapports journaliers — logique pure.
 *
 * ── CE QUI EST EN JEU ────────────────────────────────────────────────────────
 *
 * Moanda subit des coupures de courant : les jours sans electricite, le rapport
 * est tenu sur Excel puis importe. L'import precedent
 * (src/features/admin-import/page.jsx) a produit en production des rapports dont
 * `total_recettes` valait exactement 3 x `caisse_journee` — un total adosse a
 * des categories TOUTES A ZERO et a `lignes: []`.
 *
 * [MESURE le 16/09/2026, base de production bcwkrrqmjpaohmafcncw]
 *     SELECT count(*) FROM app_data WHERE collection='rapports'
 *       AND (data->>'total_recettes')::numeric = 3*(data->>'caisse_journee')::numeric
 *     → 16, sur les 50 rapports encore marques 'import_historique'.
 *     Exemple : 2026-01-05, caisse_journee 30 600, total_recettes 91 800,
 *     categories toutes nulles, aucune ligne de detail.
 *
 * La cause n'est pas une faute de calcul : c'est que le total etait un CHAMP
 * RECOPIE de la source, pose a cote du detail sans que rien ne les relie. Les
 * tests ci-dessous verrouillent la regle inverse : le detail fait foi, les
 * agregats en sont derives, aucun total n'est ecrit en base.
 *
 * Lancer :  node --test tests/import-excel.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  COLONNES_MODELE, matriceModele, CONSIGNES_MODELE, FEUILLE_DONNEES,
  joursDansMois, dateDepuisJoursEpoch, dateDepuisSerieExcel, lireDate, lireMontant,
  normaliserEntete, reconnaitreColonnes, analyserFeuille,
  empreinteEntrees, grouperParJournee, contenuRapport, fusionnerContenu,
  preparerPlan, ecrituresDuPlan, payloadSansTotauxFiges, resumePlan,
  etatConfirmation, estVerrouille, totaux, DECISIONS, MOTIF_HORS_LIGNE,
} from '../src/features/rapports/import-excel.js';

import { CATEGORIES_RAPPORT, caRapport, depensesRapport } from '../src/services/finance-calc.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Le modele
   ═══════════════════════════════════════════════════════════════════════════ */

const ENTETE = COLONNES_MODELE.map((c) => c.libelle);

/** Construit une matrice de feuille a partir de lignes d'objets. */
function feuille(lignes, entete = ENTETE) {
  return [entete, ...lignes.map((l) => COLONNES_MODELE.map((c) => (l[c.cle] === undefined ? '' : l[c.cle])))];
}

test('le modele porte EXACTEMENT les 8 categories de finance-calc, dans l ordre', () => {
  const categories = COLONNES_MODELE.filter((c) => c.role === 'categorie').map((c) => c.cle);
  assert.deepEqual(
    categories, CATEGORIES_RAPPORT,
    'le modele Excel et le calcul du CA doivent parler des memes postes',
  );
});

test('le modele a une colonne Date, une colonne Sorties et une Description', () => {
  assert.equal(COLONNES_MODELE.filter((c) => c.role === 'date').length, 1);
  assert.equal(COLONNES_MODELE.filter((c) => c.role === 'depense').length, 1);
  assert.equal(COLONNES_MODELE.filter((c) => c.role === 'texte').length, 1);
  assert.equal(COLONNES_MODELE.length, CATEGORIES_RAPPORT.length + 3);
});

test('le modele produit un en-tete lisible et une ligne d exemple de meme largeur', () => {
  const m = matriceModele();
  assert.equal(m.length, 2);
  assert.equal(m[0].length, COLONNES_MODELE.length);
  assert.equal(m[1].length, COLONNES_MODELE.length, 'exemple et en-tete doivent avoir la meme largeur');
  assert.equal(m[0][0], 'Date');
  assert.match(String(m[1][0]), /^\d{2}\/\d{2}\/\d{4}$/, 'la date de l exemple est en clair');
  assert.match(m[1].join(' '), /EXEMPLE/, 'la ligne d exemple doit se designer comme telle');
});

test('les consignes sont DANS le fichier, en francais, et nomment la feuille de saisie', () => {
  const texte = CONSIGNES_MODELE.flat().join('\n');
  assert.match(texte, /coupure/i, 'le fichier doit rappeler a quoi il sert');
  assert.match(texte, new RegExp(FEUILLE_DONNEES));
  assert.match(texte, /21\/09\/2026/, 'la forme de date attendue doit etre montree, pas decrite');
  assert.match(texte, /remplacer|fusionner|ignorer/i, 'le gerant doit savoir qu on lui demandera');
  assert.ok(texte.length > 400, 'des consignes utiles, pas une ligne');
});

test('le modele se relit lui-meme : l en-tete genere est reconnu a 100 %', () => {
  const { index, manquantes, inconnues } = reconnaitreColonnes(matriceModele()[0]);
  assert.deepEqual(manquantes, [], 'aucune colonne du modele ne doit etre perdue a la relecture');
  assert.deepEqual(inconnues, []);
  assert.equal(Object.keys(index).length, COLONNES_MODELE.length);
});

/* ═══════════════════════════════════════════════════════════════════════════
   Les dates — jamais par UTC
   ═══════════════════════════════════════════════════════════════════════════ */

test('joursDansMois connait les bissextiles, y compris la regle des siecles', () => {
  assert.equal(joursDansMois(2026, 2), 28);
  assert.equal(joursDansMois(2024, 2), 29);
  assert.equal(joursDansMois(2000, 2), 29, '2000 est bissextile (divisible par 400)');
  assert.equal(joursDansMois(1900, 2), 28, '1900 ne l est pas (divisible par 100, pas par 400)');
  assert.equal(joursDansMois(2026, 9), 30);
});

test('dateDepuisJoursEpoch est de l arithmetique entiere : aucun objet Date', () => {
  assert.equal(dateDepuisJoursEpoch(0), '1970-01-01');
  assert.equal(dateDepuisJoursEpoch(-1), '1969-12-31');
  assert.equal(dateDepuisJoursEpoch(20712), '2026-09-16');
  assert.equal(dateDepuisJoursEpoch(19782), '2024-02-29', 'un 29 fevrier reel');
  const source = String(dateDepuisJoursEpoch);
  assert.ok(!/new Date|toISOString/.test(source), 'cette fonction ne doit jamais passer par Date');
});

test('un numero de serie Excel devient la BONNE journee', () => {
  // 45000 = 2023-03-15 dans le systeme 1900 d Excel.
  assert.equal(dateDepuisSerieExcel(45000), '2023-03-15');
  assert.equal(lireDate(45000).date, '2023-03-15');
  assert.equal(lireDate(46286).date, '2026-09-21');
});

test('le 29 fevrier 1900 d Excel, qui n existe pas, est refuse et non decale', () => {
  // Excel compte un 1900-02-29 herite de Lotus 1-2-3. Ignorer ce detail decale
  // d un jour toutes les series inferieures a 60 — le meme genre d ecart d un
  // jour qui a coute 55 300 F.
  assert.equal(dateDepuisSerieExcel(1), '1900-01-01');
  assert.equal(dateDepuisSerieExcel(59), '1900-02-28');
  assert.equal(dateDepuisSerieExcel(60), null, 'le 29 fevrier 1900 n a jamais existe');
  assert.equal(dateDepuisSerieExcel(61), '1900-03-01');
  assert.match(lireDate(60).message, /29 fevrier 1900/);
  assert.match(lireDate(1).message, /annee improbable/, 'une serie de 1900 n est pas une journee de l imprimerie');
});

test('la date au format francais 21/09/2026 est lue telle qu elle est ecrite', () => {
  assert.deepEqual(lireDate('21/09/2026'), { ok: true, date: '2026-09-21' });
  assert.deepEqual(lireDate('21-09-2026'), { ok: true, date: '2026-09-21' });
  assert.deepEqual(lireDate('21.09.2026'), { ok: true, date: '2026-09-21' });
  assert.deepEqual(lireDate('1/1/2026'), { ok: true, date: '2026-01-01' });
  assert.deepEqual(lireDate('21/09/26'), { ok: true, date: '2026-09-21' });
  assert.deepEqual(lireDate(' 2026-09-21 '), { ok: true, date: '2026-09-21' });
});

test('une date INVALIDE est nommee, pas rejetee en bloc', () => {
  const r = lireDate('32/09/2026');
  assert.equal(r.ok, false);
  assert.match(r.message, /32\/09\/2026/, 'le message doit citer la date fautive');
  assert.match(r.message, /septembre 2026 n'a que 30 jours/);

  assert.match(lireDate('15/13/2026').message, /pas de mois 13/);
  assert.match(lireDate('bonjour').message, /n'est pas une date/);
  assert.match(lireDate('21/09').message, /pas d'annee/);
  assert.match(lireDate('').message, /vide/);
  assert.match(lireDate('29/02/2026').message, /fevrier 2026 n'a que 28 jours/);
  assert.equal(lireDate('29/02/2024').ok, true, '2024 est bissextile');
});

test('un objet Date garde son jour LOCAL (regle de src/lib/dates.js)', () => {
  // 00h30 heure locale : `.toISOString().slice(0,10)` renverrait la veille
  // partout a l est de Greenwich. C est le defaut qui a coute 55 300 F.
  const d = new Date(2026, 8, 21, 0, 30, 0);
  assert.deepEqual(lireDate(d), { ok: true, date: '2026-09-21' });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Les montants
   ═══════════════════════════════════════════════════════════════════════════ */

test('un montant avec espace, espace insecable ou fine est lu correctement', () => {
  assert.equal(lireMontant('12 500').montant, 12500);
  assert.equal(lireMontant('12 500').montant, 12500, 'espace insecable');
  assert.equal(lireMontant('12 500').montant, 12500, 'espace fine insecable');
  assert.equal(lireMontant('1 234 567').montant, 1234567);
  assert.equal(lireMontant('12 500 F').montant, 12500);
  assert.equal(lireMontant('12500 FCFA').montant, 12500);
  assert.equal(lireMontant('12 500 XAF').montant, 12500);
});

test('une virgule decimale est acceptee et arrondie au franc', () => {
  assert.equal(lireMontant('12500,50').montant, 12501);
  assert.equal(lireMontant('12 500,49').montant, 12500);
  assert.equal(lireMontant(12500.5).montant, 12501);
});

test('un point entre milliers n est PAS pris pour une decimale', () => {
  assert.equal(lireMontant('12.500').montant, 12500, '« 12.500 » vaut douze mille cinq cents');
  assert.equal(lireMontant('1.234.567').montant, 1234567);
  assert.equal(lireMontant('12.5').montant, 13, '« 12.5 » reste un decimal');
});

test('une case vide vaut zero, un texte non numerique est refuse, un negatif aussi', () => {
  assert.deepEqual(lireMontant(''), { ok: true, montant: 0 });
  assert.deepEqual(lireMontant(null), { ok: true, montant: 0 });
  assert.deepEqual(lireMontant(undefined), { ok: true, montant: 0 });
  assert.equal(lireMontant('abc').ok, false);
  assert.match(lireMontant('abc').message, /« abc » n'est pas un montant/);
  assert.equal(lireMontant('-500').ok, false);
  assert.match(lireMontant('-500').message, /negatif/);
});

/* ═══════════════════════════════════════════════════════════════════════════
   Les colonnes
   ═══════════════════════════════════════════════════════════════════════════ */

test('les accents et la casse des titres n empechent pas la reconnaissance', () => {
  assert.equal(normaliserEntete('Demi-Photos'), 'demi photos');
  assert.equal(normaliserEntete('TIRAGE / SAISIES'), 'tirage saisies');
  assert.equal(normaliserEntete('Sorties (dépenses)'), 'sorties depenses');
  assert.equal(normaliserEntete('Opérateur'), 'operateur');

  const { index } = reconnaitreColonnes([
    'DATE', 'COPIES', 'Marchandises', 'scan', 'Tirage/Saisies',
    'BADGES / PLASTIFICATION', 'Demi-Photos', 'Maintenance', 'IMPRIMERIE',
    'Sorties', 'Déscription',
  ]);
  assert.equal(index.date, 0);
  assert.equal(index.demi_photos, 6);
  assert.equal(index.sorties, 9);
});

test('des synonymes courants sont acceptes : le gerant ne recopie pas une orthographe', () => {
  const { index, manquantes } = reconnaitreColonnes([
    'Jour', 'Photocopies', 'Ventes', 'Numérisation', 'Saisies',
    'Badges', 'Photos', 'Entretien', 'Impressions', 'Dépenses', 'Motif',
  ]);
  assert.deepEqual(manquantes, []);
  assert.equal(index.copies, 1);
  assert.equal(index.marchandises, 2);
  assert.equal(index.maintenance, 7);
});

test('une colonne EN TROP est signalee, jamais fatale', () => {
  const m = feuille(
    [{ date: '21/09/2026', copies: 2000 }].map((l) => l),
    [...ENTETE, 'Numéro de caisse'],
  );
  const a = analyserFeuille(m);
  assert.equal(a.fatal, null);
  assert.equal(a.entrees.length, 1);
  assert.equal(a.colonnes.inconnues.length, 1);
  assert.match(a.avertissements.join(' '), /en trop.*Numéro de caisse/);
});

test('une colonne MANQUANTE est signalee et compte 0 F, sans rejeter le fichier', () => {
  const entete = ENTETE.filter((h) => h !== 'Scan');
  const cols = COLONNES_MODELE.filter((c) => c.cle !== 'scan');
  const m = [entete, cols.map((c) => ({ date: '21/09/2026', copies: 2000 }[c.cle] ?? ''))];
  const a = analyserFeuille(m);
  assert.equal(a.fatal, null);
  assert.equal(a.entrees.length, 1);
  assert.equal(a.entrees[0].valeurs.scan, 0, 'un poste absent vaut 0, il ne disparait pas');
  assert.match(a.avertissements.join(' '), /Scan/);
  assert.match(a.avertissements.join(' '), /0 F/);
});

test('sans colonne Date, le fichier est refuse avec une raison utilisable', () => {
  const a = analyserFeuille([['Copies', 'Scan'], [2000, 500]]);
  assert.match(a.fatal, /Date.*introuvable/);
  assert.match(a.fatal, /modele/i, 'le message doit dire quoi faire ensuite');
});

/* ═══════════════════════════════════════════════════════════════════════════
   L analyse d une feuille
   ═══════════════════════════════════════════════════════════════════════════ */

test('un fichier VIDE est refuse clairement, sans exception', () => {
  assert.match(analyserFeuille([]).fatal, /vide/i);
  assert.match(analyserFeuille(null).fatal, /vide/i);
  assert.match(analyserFeuille([[], [], []]).fatal, /vide/i);
  assert.match(analyserFeuille([ENTETE]).fatal, /aucune ligne remplie/i);
});

test('une LIGNE VIDE au milieu du fichier est ignoree en silence', () => {
  const m = feuille([
    { date: '21/09/2026', copies: 2000 },
    {},
    { date: '21/09/2026', imprimerie: 5000 },
  ]);
  const a = analyserFeuille(m);
  assert.equal(a.entrees.length, 2);
  assert.equal(a.rejets.length, 0, 'une ligne vide n est pas une faute');
  assert.equal(a.lignesVides, 1);
});

test('IMPORT PARTIEL : 18 lignes bonnes sur 20 s importent, les 2 fautives sont nommees', () => {
  const lignes = [];
  for (let i = 1; i <= 18; i++) lignes.push({ date: '21/09/2026', copies: 1000 + i });
  lignes.push({ date: '32/09/2026', copies: 5000 });   // ligne 20 dans Excel
  lignes.push({ date: '22/09/2026', copies: 'beaucoup' }); // ligne 21

  const a = analyserFeuille(feuille(lignes));
  assert.equal(a.fatal, null, 'une faute de frappe ne rejette pas le fichier en bloc');
  assert.equal(a.entrees.length, 18);
  assert.equal(a.rejets.length, 2);

  assert.equal(a.rejets[0].ligne, 20);
  assert.match(a.rejets[0].message, /32\/09\/2026/);
  assert.match(a.rejets[0].message, /n'a que 30 jours/);

  assert.equal(a.rejets[1].ligne, 21);
  assert.match(a.rejets[1].message, /« beaucoup » n'est pas un montant/);
  assert.match(a.rejets[1].message, /Copies/);
});

test('le numero de ligne annonce est celui qu Excel affiche', () => {
  // en-tete = ligne 1 ; la 6e ligne de donnees est donc la ligne 7.
  const lignes = [];
  for (let i = 0; i < 5; i++) lignes.push({ date: '21/09/2026', copies: 100 });
  lignes.push({ date: '32/09/2026', copies: 100 });
  const a = analyserFeuille(feuille(lignes));
  assert.equal(a.rejets.length, 1);
  assert.equal(a.rejets[0].ligne, 7, '« ligne 7 » doit designer la ligne 7 du tableur');
});

test('une SORTIE sans description est refusee : une depense anonyme est intracable', () => {
  const a = analyserFeuille(feuille([
    { date: '21/09/2026', copies: 2000, sorties: 51000 },
  ]));
  assert.equal(a.entrees.length, 0);
  assert.equal(a.rejets.length, 1);
  assert.match(a.rejets[0].message, /51000 F.*sans description/);
});

test('les accents des libelles sont conserves tels quels', () => {
  const a = analyserFeuille(feuille([
    { date: '21/09/2026', sorties: 51000, description: 'wifi (février) — dépôt à Moanda, café' },
  ]));
  assert.equal(a.entrees.length, 1);
  assert.equal(a.entrees[0].description, 'wifi (février) — dépôt à Moanda, café');
  const j = grouperParJournee(a.entrees);
  assert.equal(j[0].depenses[0].description, 'wifi (février) — dépôt à Moanda, café');
});

test('500 lignes s analysent, se regroupent et totalisent juste', () => {
  const lignes = [];
  for (let i = 0; i < 500; i++) {
    const jour = String((i % 28) + 1).padStart(2, '0');
    lignes.push({ date: `${jour}/09/2026`, copies: 100, imprimerie: 50 });
  }
  const debut = Date.now();
  const a = analyserFeuille(feuille(lignes));
  const journees = grouperParJournee(a.entrees);
  const duree = Date.now() - debut;

  assert.equal(a.rejets.length, 0);
  assert.equal(a.entrees.length, 500);
  assert.equal(journees.length, 28);
  const total = journees.reduce((s, j) => s + caRapport(contenuRapport(j)), 0);
  assert.equal(total, 500 * 150, 'la somme des 28 journees doit valoir la somme des 500 lignes');
  assert.ok(duree < 3000, `analyse trop lente : ${duree} ms`);
});

/* ═══════════════════════════════════════════════════════════════════════════
   Regroupement : le detail fait foi
   ═══════════════════════════════════════════════════════════════════════════ */

test('plusieurs lignes de la MEME date forment UN rapport, comme la grille a l ecran', () => {
  const a = analyserFeuille(feuille([
    { date: '21/09/2026', copies: 2350, imprimerie: 16000, description: 'matin' },
    { date: '21/09/2026', copies: 1000, scan: 500, description: 'apres-midi' },
    { date: '22/09/2026', copies: 700 },
  ]));
  const j = grouperParJournee(a.entrees);
  assert.equal(j.length, 2);
  assert.equal(j[0].date, '2026-09-21');
  assert.equal(j[0].lignes.length, 2);
  assert.equal(j[0].categories.copies, 3350);
  assert.equal(j[0].categories.imprimerie, 16000);
  assert.equal(j[0].categories.scan, 500);
  assert.deepEqual(j[0].numerosLignes, [2, 3]);
});

test('les categories sont EXACTEMENT la somme des lignes — jamais un chiffre recopie', () => {
  const a = analyserFeuille(feuille([
    { date: '21/09/2026', copies: 2350, marchandises: 400, tirage_saisies: 11700 },
    { date: '21/09/2026', copies: 1650, badges_plastification: 3500 },
  ]));
  const [j] = grouperParJournee(a.entrees);
  const contenu = contenuRapport(j);

  for (const cle of CATEGORIES_RAPPORT) {
    const sommeLignes = j.lignes.reduce((s, l) => s + (l[cle] || 0), 0);
    assert.equal(contenu.categories[cle], sommeLignes, `categorie ${cle} incoherente avec son detail`);
  }
  assert.equal(caRapport(contenu), 19600, '2350+400+11700+1650+3500');
});

test('une sortie devient une depense ; le CA n en est PAS diminue', () => {
  const a = analyserFeuille(feuille([
    { date: '21/09/2026', copies: 20000, sorties: 51000, description: 'wifi' },
  ]));
  const [j] = grouperParJournee(a.entrees);
  const contenu = contenuRapport(j);
  assert.equal(caRapport(contenu), 20000, 'le CA est brut, les depenses ne s en retranchent pas');
  assert.equal(depensesRapport(contenu), 51000);
  assert.equal(totaux(contenu).solde, -31000);
});

/* ═══════════════════════════════════════════════════════════════════════════
   LE POINT CENTRAL : aucun total fige en base
   ═══════════════════════════════════════════════════════════════════════════ */

test('REGRESSION MARS — le payload ne contient AUCUN total fige', () => {
  const a = analyserFeuille(feuille([{ date: '05/01/2026', copies: 30600 }]));
  const plan = preparerPlan({ analyse: a, rapportsExistants: [], fichier: 'x.xlsx' });
  const { ecritures } = ecrituresDuPlan(plan, {});
  assert.equal(ecritures.length, 1);

  const data = ecritures[0].data;
  assert.deepEqual(
    payloadSansTotauxFiges(data), [],
    'total_recettes / total_depenses / caisse_journee ne doivent JAMAIS etre ecrits : '
    + 'c est ce champ recopie qui a produit 16 rapports a 3 x la caisse',
  );
  assert.equal(data.total_recettes, undefined);
  assert.equal(data.caisse_journee, undefined);
});

test('REGRESSION MARS — un rapport importe ne peut pas avoir un total sans detail', () => {
  const a = analyserFeuille(feuille([
    { date: '05/01/2026', copies: 10000, imprimerie: 20600 },
  ]));
  const plan = preparerPlan({ analyse: a });
  const { ecritures } = ecrituresDuPlan(plan, {});
  const data = ecritures[0].data;

  assert.ok(Array.isArray(data.lignes) && data.lignes.length > 0, 'un rapport sans detail est intracable');
  assert.equal(caRapport(data), 30600);
  const sommeDetail = data.lignes.reduce(
    (s, l) => s + CATEGORIES_RAPPORT.reduce((x, c) => x + (l[c] || 0), 0), 0,
  );
  assert.equal(
    caRapport(data), sommeDetail,
    'le total affiche et le detail doivent etre le MEME chiffre, par construction',
  );
});

test('le garde-fou payloadSansTotauxFiges detecte bien un champ interdit', () => {
  assert.deepEqual(payloadSansTotauxFiges({ categories: {}, total_recettes: 91800 }), ['total_recettes']);
  assert.deepEqual(payloadSansTotauxFiges({ caisse_journee: 0 }), ['caisse_journee']);
  assert.deepEqual(payloadSansTotauxFiges({ categories: {}, lignes: [] }), []);
});

/* ═══════════════════════════════════════════════════════════════════════════
   Le plan : creations, conflits, traces
   ═══════════════════════════════════════════════════════════════════════════ */

const EXISTANT_21 = {
  id: 'r-21', date: '2026-09-21', statut: 'brouillon', operateur_nom: 'Ibrahim Abakar',
  categories: { copies: 5000, imprimerie: 1000 },
  depenses: [{ description: 'taxi', montant: 2000 }],
  lignes: [{ copies: 5000, imprimerie: 1000, sorties: 2000, description: 'taxi' }],
};

function planDe(lignes, existants = [], extra = {}) {
  return preparerPlan({
    analyse: analyserFeuille(feuille(lignes)),
    rapportsExistants: existants,
    fichier: 'rapport-coupure.xlsx',
    utilisateur: { id: 'u-1', nom: 'Gassim Admin' },
    importeLe: '2026-09-22T09:00:00.000Z',
    ...extra,
  });
}

test('une date libre produit une CREATION, une date occupee produit un CONFLIT', () => {
  const plan = planDe([
    { date: '21/09/2026', copies: 3000 },
    { date: '22/09/2026', copies: 4000 },
  ], [EXISTANT_21]);

  assert.equal(plan.creations.length, 1);
  assert.equal(plan.creations[0].date, '2026-09-22');
  assert.equal(plan.conflits.length, 1);
  assert.equal(plan.conflits[0].date, '2026-09-21');
});

test('le conflit montre LES DEUX COTES avec leurs montants — pas seulement « doublon »', () => {
  const [c] = planDe([{ date: '21/09/2026', copies: 3000, sorties: 500, description: 'scotch' }], [EXISTANT_21]).conflits;
  assert.equal(c.existant.totaux.recettes, 6000);
  assert.equal(c.existant.totaux.depenses, 2000);
  assert.equal(c.entrant.totaux.recettes, 3000);
  assert.equal(c.entrant.totaux.depenses, 500);
  assert.equal(c.apresFusion.recettes, 9000, 'le gerant doit voir ce que donnerait la fusion');
  assert.equal(c.apresFusion.depenses, 2500);
});

test('AUCUN ECRASEMENT SILENCIEUX : un conflit non tranche ne produit aucune ecriture', () => {
  const plan = planDe([{ date: '21/09/2026', copies: 3000 }], [EXISTANT_21]);
  const r = ecrituresDuPlan(plan, {}); // aucune decision
  assert.deepEqual(r.ecritures, [], 'sans decision explicite, rien ne part en base');
  assert.deepEqual(r.indecises, ['2026-09-21']);
});

test('« ignorer » laisse l existant absolument intact', () => {
  const plan = planDe([{ date: '21/09/2026', copies: 3000 }], [EXISTANT_21]);
  const r = ecrituresDuPlan(plan, { '2026-09-21': 'ignorer' });
  assert.deepEqual(r.ecritures, []);
  assert.deepEqual(r.ignorees, ['2026-09-21']);
  assert.deepEqual(r.indecises, []);
});

test('« remplacer » remplace le contenu et ne touche NI la date NI l operateur', () => {
  const plan = planDe([{ date: '21/09/2026', copies: 3000 }], [EXISTANT_21]);
  const [e] = ecrituresDuPlan(plan, { '2026-09-21': 'remplacer' }).ecritures;

  assert.equal(e.type, 'modification');
  assert.equal(e.id, 'r-21');
  assert.equal(e.mode, 'remplacer');
  assert.equal(caRapport(e.patch), 3000);
  assert.equal(depensesRapport(e.patch), 0);
  assert.equal(e.patch.date, undefined, 'la date du rapport existant ne doit pas etre reecrite');
  assert.equal(e.patch.operateur_nom, undefined, 'l operateur existant est conserve');
  assert.deepEqual(payloadSansTotauxFiges(e.patch), []);
});

test('« fusionner » additionne sans rien perdre des deux cotes', () => {
  const plan = planDe([
    { date: '21/09/2026', copies: 3000, sorties: 500, description: 'scotch' },
  ], [EXISTANT_21]);
  const [e] = ecrituresDuPlan(plan, { '2026-09-21': 'fusionner' }).ecritures;

  assert.equal(e.mode, 'fusionner');
  assert.equal(e.patch.categories.copies, 8000, '5 000 existants + 3 000 importes');
  assert.equal(e.patch.categories.imprimerie, 1000, 'le poste absent du fichier n est pas efface');
  assert.equal(caRapport(e.patch), 9000);
  assert.equal(e.patch.depenses.length, 2, 'les deux depenses sont conservees');
  assert.equal(e.patch.lignes.length, 2, 'le detail des deux cotes est conserve');
  assert.deepEqual(payloadSansTotauxFiges(e.patch), []);
});

test('un rapport VERROUILLE (valide/cloture) ne peut etre ni remplace ni fusionne', () => {
  for (const statut of ['valide', 'cloture']) {
    const verrouille = { ...EXISTANT_21, statut };
    assert.equal(estVerrouille(verrouille), true);

    const plan = planDe([{ date: '21/09/2026', copies: 3000 }], [verrouille]);
    const [c] = plan.conflits;
    assert.equal(c.existant.verrouille, true);
    assert.match(c.interdits.remplacer, /verrouille/, 'le motif du refus doit etre lisible');
    assert.match(c.interdits.fusionner, /Deverrouillez/);

    const r = ecrituresDuPlan(plan, { '2026-09-21': 'remplacer' });
    assert.deepEqual(r.ecritures, [], `un rapport ${statut} ne doit pas etre ecrase par un import`);
    assert.deepEqual(r.ignorees, ['2026-09-21']);
  }
});

test('un rapport cree par import est MODIFIABLE : il arrive en brouillon', () => {
  const plan = planDe([{ date: '22/09/2026', copies: 4000 }]);
  const [e] = ecrituresDuPlan(plan, {}).ecritures;
  assert.equal(e.data.statut, 'brouillon', 'un rapport cloture serait verrouille a l ecran');
  assert.ok(!estVerrouille(e.data));
});

/* ═══════════════════════════════════════════════════════════════════════════
   Tracabilite
   ═══════════════════════════════════════════════════════════════════════════ */

test('chaque rapport importe porte son origine : fichier, date, auteur, lignes', () => {
  const plan = planDe([
    { date: '22/09/2026', copies: 4000 },
    { date: '22/09/2026', scan: 500 },
  ]);
  const [e] = ecrituresDuPlan(plan, {}).ecritures;
  const o = e.data.import_excel;

  assert.equal(e.data.source, 'import_excel');
  assert.equal(o.fichier, 'rapport-coupure.xlsx');
  assert.equal(o.importe_le, '2026-09-22T09:00:00.000Z');
  assert.equal(o.importe_par, 'Gassim Admin');
  assert.equal(o.importe_par_id, 'u-1');
  assert.equal(o.mode, 'creation');
  assert.deepEqual(o.lignes_fichier, [2, 3], 'on doit pouvoir remonter aux lignes du tableur');
  assert.match(o.empreinte, /^[0-9a-f]{8}$/);
});

test('la trace dit REMPLACEMENT ou FUSION, pas seulement « import »', () => {
  const plan = planDe([{ date: '21/09/2026', copies: 3000 }], [EXISTANT_21]);
  const r = ecrituresDuPlan(plan, { '2026-09-21': 'remplacer' });
  assert.equal(r.ecritures[0].patch.import_excel.mode, 'remplacement');

  const plan2 = planDe([{ date: '21/09/2026', copies: 3000 }], [EXISTANT_21]);
  const r2 = ecrituresDuPlan(plan2, { '2026-09-21': 'fusionner' });
  assert.equal(r2.ecritures[0].patch.import_excel.mode, 'fusion');
});

/* ═══════════════════════════════════════════════════════════════════════════
   LE MEME FICHIER IMPORTE DEUX FOIS
   ═══════════════════════════════════════════════════════════════════════════ */

test('l empreinte ne depend ni de l ordre des lignes ni de la casse des libelles', () => {
  const a1 = analyserFeuille(feuille([
    { date: '21/09/2026', copies: 2000, sorties: 300, description: 'Taxi' },
    { date: '22/09/2026', scan: 500 },
  ]));
  const a2 = analyserFeuille(feuille([
    { date: '22/09/2026', scan: 500 },
    { date: '21/09/2026', copies: 2000, sorties: 300, description: 'taxi' },
  ]));
  assert.equal(empreinteEntrees(a1.entrees), empreinteEntrees(a2.entrees));

  const a3 = analyserFeuille(feuille([{ date: '21/09/2026', copies: 2001 }]));
  assert.notEqual(empreinteEntrees(a1.entrees), empreinteEntrees(a3.entrees));
});

test('LE MEME FICHIER IMPORTE DEUX FOIS ne cree pas un second rapport', () => {
  // 1er import : deux journees libres, deux creations.
  const lignes = [
    { date: '21/09/2026', copies: 2350, imprimerie: 16000 },
    { date: '22/09/2026', copies: 1000, sorties: 300, description: 'taxi' },
  ];
  const plan1 = planDe(lignes);
  const r1 = ecrituresDuPlan(plan1, {});
  assert.equal(r1.ecritures.length, 2);
  assert.ok(r1.ecritures.every((e) => e.type === 'creation'));

  // Ce que la base contient apres application.
  const enBase = r1.ecritures.map((e, i) => ({ id: `nouveau-${i}`, ...e.data }));

  // 2e import du MEME fichier : plus aucune creation, deux conflits explicites.
  const plan2 = planDe(lignes, enBase);
  assert.equal(plan2.creations.length, 0, 'aucune creation en double');
  assert.equal(plan2.conflits.length, 2);
  assert.ok(plan2.conflits.every((c) => c.dejaImporte),
    'le fichier doit etre reconnu comme deja importe, par empreinte');

  // Et sans decision, rien ne part.
  assert.deepEqual(ecrituresDuPlan(plan2, {}).ecritures, []);

  // Le bouton est refuse, en le disant.
  const etat = etatConfirmation(plan2, {});
  assert.equal(etat.actif, false);
  assert.match(etat.motif, /existent deja/);
  assert.match(etat.motif, /2026-09-21/);
});

test('deux fois le meme fichier, avec « remplacer », ne fabrique pas de doublon de montant', () => {
  const lignes = [{ date: '21/09/2026', copies: 2350 }];
  const r1 = ecrituresDuPlan(planDe(lignes), {});
  const enBase = [{ id: 'r-A', ...r1.ecritures[0].data }];

  const r2 = ecrituresDuPlan(planDe(lignes, enBase), { '2026-09-21': 'remplacer' });
  assert.equal(r2.ecritures.length, 1);
  assert.equal(r2.ecritures[0].id, 'r-A', 'la MEME ligne est modifiee, pas une nouvelle creee');
  assert.equal(caRapport(r2.ecritures[0].patch), 2350, 'remplacer n additionne pas');
});

test('une date presente EN DOUBLE en base est signalee au gerant', () => {
  const plan = planDe([{ date: '21/09/2026', copies: 1000 }], [
    { ...EXISTANT_21, id: 'a', updated_at: '2026-09-21T08:00:00Z' },
    { ...EXISTANT_21, id: 'b', updated_at: '2026-09-21T18:00:00Z' },
  ]);
  assert.equal(plan.conflits.length, 1);
  assert.equal(plan.conflits[0].enDouble, true);
  assert.equal(plan.conflits[0].existant.id, 'b', 'le plus recemment modifie fait reference');
});

/* ═══════════════════════════════════════════════════════════════════════════
   Le bouton desactive dit toujours pourquoi
   ═══════════════════════════════════════════════════════════════════════════ */

test('sans fichier, le bouton est desactive AVEC son motif', () => {
  const e = etatConfirmation(null, {});
  assert.equal(e.actif, false);
  assert.match(e.motif, /fichier Excel/);
});

test('fichier illisible : le motif est la raison exacte du refus', () => {
  const plan = preparerPlan({ analyse: analyserFeuille([['Copies'], [1]]) });
  const e = etatConfirmation(plan, {});
  assert.equal(e.actif, false);
  assert.match(e.motif, /Date.*introuvable/);
});

test('import en cours : le bouton est desactive et le dit, contre le double-clic', () => {
  const plan = planDe([{ date: '22/09/2026', copies: 1000 }]);
  const e = etatConfirmation(plan, {}, true);
  assert.equal(e.actif, false);
  assert.match(e.motif, /en cours/);
  assert.match(e.motif, /deux fois/);
});

test('tout ignore : le bouton est desactive et explique qu il n y a rien a ecrire', () => {
  const plan = planDe([{ date: '21/09/2026', copies: 1000 }], [EXISTANT_21]);
  const e = etatConfirmation(plan, { '2026-09-21': 'ignorer' });
  assert.equal(e.actif, false);
  assert.match(e.motif, /Rien a enregistrer/);
});

test('plan valide et conflits tranches : le bouton s active, sans motif', () => {
  const plan = planDe([
    { date: '21/09/2026', copies: 1000 },
    { date: '23/09/2026', copies: 2000 },
  ], [EXISTANT_21]);
  const e = etatConfirmation(plan, { '2026-09-21': 'fusionner' });
  assert.equal(e.actif, true);
  assert.equal(e.motif, '');
  assert.equal(e.nbEcritures, 2);
});

test('une decision inconnue ne passe pas pour une decision', () => {
  const plan = planDe([{ date: '21/09/2026', copies: 1000 }], [EXISTANT_21]);
  const r = ecrituresDuPlan(plan, { '2026-09-21': 'ecraser-tout' });
  assert.deepEqual(r.ecritures, []);
  assert.deepEqual(r.indecises, ['2026-09-21']);
  assert.deepEqual(DECISIONS, ['remplacer', 'fusionner', 'ignorer']);
});

/* ═══════════════════════════════════════════════════════════════════════════
   Resume et robustesse
   ═══════════════════════════════════════════════════════════════════════════ */

test('le resume compte ce qui sera cree, ce qui est en conflit, ce qui est refuse', () => {
  const plan = planDe([
    { date: '21/09/2026', copies: 1000 },
    { date: '23/09/2026', copies: 2000, sorties: 400, description: 'encre' },
    { date: '32/09/2026', copies: 9999 },
  ], [EXISTANT_21]);
  const r = resumePlan(plan);
  assert.equal(r.aCreer, 1);
  assert.equal(r.enConflit, 1);
  assert.equal(r.refusees, 1);
  assert.equal(r.recettes, 3000, 'le resume porte sur ce qui vient du fichier');
  assert.equal(r.depenses, 400);
});

test('aucune entree abimee ne fait LEVER l analyse — un ecran ne doit jamais blanchir', () => {
  const abimes = [
    ['rien', null],
    ['indefini', undefined],
    ['tableau vide', []],
    ['ligne vide', [[]]],
    ['cellules nulles', [[null, undefined]]],
    ['une chaine', 'texte'],
    ['un nombre', 42],
    ['un objet', {}],
    ['lignes nulles + Symbol en cellule', [ENTETE, null, undefined, [Symbol('x')]]],
    ['toString piege', [ENTETE, [{ toString() { throw new Error('cellule piegee'); } }]]],
    ['NaN et Infinity', [ENTETE, [NaN, Infinity, -Infinity]]],
  ];
  for (const [nom, m] of abimes) {
    assert.doesNotThrow(() => {
      const a = analyserFeuille(m);
      const p = preparerPlan({ analyse: a, rapportsExistants: [null, undefined, {}] });
      ecrituresDuPlan(p, { n_importe_quoi: 'remplacer' });
      etatConfirmation(p, {});
      resumePlan(p);
    }, `entree abimee non geree : ${nom}`);
  }
});

test('fusionnerContenu tolere des rapports incomplets sans rien inventer', () => {
  assert.deepEqual(fusionnerContenu(null, null), { categories: {}, depenses: [], lignes: [] });
  const f = fusionnerContenu({ categories: { copies: 5 } }, { categories: { scan: 3 } });
  assert.deepEqual(f.categories, { copies: 5, scan: 3 });
});

test('le module est PUR : ni React, ni couche de donnees, ni DOM', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/features/rapports/import-excel.js', import.meta.url), 'utf8');
  const imports = [...src.matchAll(/^import\s.*?from\s+'([^']+)'/gm)].map((m) => m[1]);
  assert.deepEqual(
    imports.sort(),
    ['../../lib/dates.js', '../../services/finance-calc.js'],
    'le module ne doit dependre que des sources uniques de verite (dates, calcul)',
  );
  // Les commentaires citent XLSX et `new Date` pour expliquer ce qu on EVITE :
  // on n inspecte donc que le code, commentaires retires.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/document\.|window\.|localStorage|XLSX\./.test(code), 'aucun acces DOM ni tableur ici');
  assert.ok(!/new Date\(/.test(code), 'aucune date metier ne doit transiter par un objet Date');
  assert.ok(!/toISOString/.test(code), 'jamais d UTC sur une date metier (cf. src/lib/dates.js)');
});

/* ═══════════════════════════════════════════════════════════════════════════
   Hors ligne : mieux vaut refuser que montrer un apercu faux
   ═══════════════════════════════════════════════════════════════════════════ */

test('hors ligne, l import est refuse — car la base « vide » serait un mensonge', () => {
  // `db.rapports.list()` renvoie [] quand Supabase est injoignable (il
  // journalise l erreur et rend un tableau vide). Sans ce garde-fou, l import
  // hors ligne ne verrait AUCUN conflit et proposerait de tout creer.
  const plan = planDe([{ date: '22/09/2026', copies: 1000 }]);
  const e = etatConfirmation(plan, {}, false, true);
  assert.equal(e.actif, false);
  assert.match(e.motif, /pas de reseau/i);
  assert.match(e.motif, /croirait la base vide/);
  assert.match(e.motif, /rien n'est perdu/, 'le gerant doit savoir que son fichier reste valable');
  assert.equal(e.motif, MOTIF_HORS_LIGNE, 'le motif affiche doit etre celui que le module publie');
});

test('hors ligne prime sur tout : meme un plan parfait ne s enregistre pas', () => {
  const plan = planDe([
    { date: '21/09/2026', copies: 1000 },
    { date: '23/09/2026', copies: 2000 },
  ], [EXISTANT_21]);
  const decisions = { '2026-09-21': 'fusionner' };
  assert.equal(etatConfirmation(plan, decisions, false, false).actif, true, 'en ligne : actif');
  assert.equal(etatConfirmation(plan, decisions, false, true).actif, false, 'hors ligne : eteint');
});

test('de retour en ligne, le meme plan redevient enregistrable', () => {
  const plan = planDe([{ date: '22/09/2026', copies: 1000 }]);
  assert.equal(etatConfirmation(plan, {}, false, true).actif, false);
  assert.equal(etatConfirmation(plan, {}, false, false).actif, true);
});
