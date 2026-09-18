/**
 * DEUX ACTIVITES DANS UNE SEULE BASE — la regle, ecrite une fois.
 *
 * ── Pourquoi ce fichier existe ────────────────────────────────────────────
 *
 * L'IMPRIMERIE OGOOUE ouvre une deuxieme activite, la PAPETERIE. Consigne du
 * dirigeant le 18/09/2026 : « la caisse papeterie est separee — plus tot on le
 * code, moins il y aura a demeler ».
 *
 * [MESURE le 18/09/2026 sur la base de production, en LECTURE SEULE]
 *   Aucune des 4 083 lignes de `app_data` ne porte de champ `activite`.
 *   rapports 237, produits 45, mouvements_stock 44, mouvements_financiers 32,
 *   commandes 5, charges_fixes 5 — toutes sans `activite`.
 *
 * Tout l'existant est donc de l'imprimerie, et doit le rester SANS qu'une
 * seule ligne soit reecrite en base. C'est la regle n°1 testee ici : l'absence
 * du champ VAUT « imprimerie ». Une migration de donnees serait une occasion
 * de se tromper sur 237 rapports ; la lecture par defaut n'en est pas une.
 *
 * ── Le piege de nom, teste explicitement ──────────────────────────────────
 *
 * `rapport.categories.imprimerie` existe DEJA : c'est une categorie de
 * prestation (a cote de `copies`, `scan`, `badges_plastification`…), pas une
 * activite. Un rapport de la PAPETERIE peut parfaitement contenir une recette
 * dans la categorie `imprimerie`. Confondre les deux ferait basculer du chiffre
 * d'affaires d'une caisse a l'autre sans lever la moindre erreur.
 *
 * Lancer :  node --test tests/activites.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVITES,
  ACTIVITE_DEFAUT,
  ACTIVITE_IMPRIMERIE,
  ACTIVITE_PAPETERIE,
  ACTIVITE_TOPSHOP,
  TOUTES_ACTIVITES,
  activiteDe,
  avecActivite,
  estActiviteConnue,
  filtrerParActivite,
  libelleActivite,
  repartirParActivite,
} from '../src/services/activites.js';

/* ═══════════════════════════════════════════════════════════════════════════
   1. Le vocabulaire
   ═══════════════════════════════════════════════════════════════════════════ */

test('TROIS activites depuis le 19/09 — et l’imprimerie reste celle par defaut', () => {
  // Ce test disait « deux activites, pas trois » jusqu'au 19/09/2026. Le
  // dirigeant a demande d'ajouter TOPSHOP GABON (« TopShop : cree l'activite
  // dans l'app »), pour la meme raison que la papeterie avait ete posee avant
  // son premier franc : un champ d'appartenance pose APRES coup ne se rattrape
  // pas. La mise a jour est donc deliberee, pas un test plie pour passer.
  assert.deepEqual(ACTIVITES, [ACTIVITE_IMPRIMERIE, ACTIVITE_PAPETERIE, ACTIVITE_TOPSHOP]);
  assert.equal(ACTIVITE_TOPSHOP, 'topshop');
  assert.equal(ACTIVITE_DEFAUT, ACTIVITE_IMPRIMERIE);
  assert.equal(ACTIVITE_IMPRIMERIE, 'imprimerie');
  assert.equal(ACTIVITE_PAPETERIE, 'papeterie');
  // « les deux » n'est pas une activite : c'est une vue. Le confondre avec une
  // valeur stockable ferait naitre en base des lignes appartenant a personne.
  assert.ok(!ACTIVITES.includes(TOUTES_ACTIVITES));
});

test('les libelles sont ecrits pour le gerant, pas pour la base', () => {
  // Consigne du dirigeant (18/09/2026) : « pour la papeterie l'activite mets
  // PAPETERIE OGOOUE pour faire la difference » — a l'ecran, « Papeterie »
  // tout court se confond avec la CATEGORIE de prestation du meme nom. Les
  // deux activites portent le nom du commerce, sinon leurs deux chiffres ne
  // se lisent plus comme etant de meme nature.
  assert.equal(libelleActivite(ACTIVITE_IMPRIMERIE), 'IMPRIMERIE OGOOUÉ');
  assert.equal(libelleActivite(ACTIVITE_PAPETERIE), 'PAPETERIE OGOOUÉ');
  assert.equal(libelleActivite(ACTIVITE_TOPSHOP), 'TOPSHOP GABON');
  // « Les deux » est devenu FAUX le jour ou une troisieme activite est apparue.
  // Un libelle qui compte mal ce qu'il montre fait douter du chiffre a cote.
  assert.equal(libelleActivite(TOUTES_ACTIVITES), 'Toutes');
  // Une valeur inconnue ne doit pas afficher « undefined » dans un ecran d'argent.
  assert.equal(libelleActivite('zzz'), 'IMPRIMERIE OGOOUÉ');
  // Le libelle est un habillage : la valeur STOCKEE reste en minuscules.
  // Si ces deux assertions tombaient ensemble, une renommage d'affichage
  // aurait silencieusement change ce qui part en base.
  assert.equal(ACTIVITE_IMPRIMERIE, 'imprimerie');
  assert.equal(ACTIVITE_PAPETERIE, 'papeterie');
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. L'existant ne change pas de sens
   ═══════════════════════════════════════════════════════════════════════════ */

test('une ligne SANS champ activite est de l’imprimerie', () => {
  // La forme exacte des 237 rapports de production au 18/09/2026.
  const ancien = { id: 'r-1', date: '2026-09-15', categories: { copies: 12000 }, depenses: [] };
  assert.equal(activiteDe(ancien), ACTIVITE_IMPRIMERIE);
});

test('une activite inconnue, vide ou absurde retombe sur l’imprimerie, sans lever', () => {
  for (const valeur of ['', '   ', null, undefined, 0, 42, 'PAPETRIE', 'boulangerie', {}, []]) {
    assert.equal(
      activiteDe({ activite: valeur }),
      ACTIVITE_IMPRIMERIE,
      `activite=${JSON.stringify(valeur)} devrait retomber sur l’imprimerie`,
    );
  }
  // Et l'enregistrement lui-meme peut etre absent.
  assert.equal(activiteDe(null), ACTIVITE_IMPRIMERIE);
  assert.equal(activiteDe(undefined), ACTIVITE_IMPRIMERIE);
});

test('la casse et les espaces de saisie ne fabriquent pas une troisieme activite', () => {
  assert.equal(activiteDe({ activite: 'Papeterie' }), ACTIVITE_PAPETERIE);
  assert.equal(activiteDe({ activite: '  PAPETERIE  ' }), ACTIVITE_PAPETERIE);
  assert.equal(activiteDe({ activite: 'IMPRIMERIE' }), ACTIVITE_IMPRIMERIE);
});

test('estActiviteConnue distingue une valeur stockable d’une vue', () => {
  assert.equal(estActiviteConnue('imprimerie'), true);
  assert.equal(estActiviteConnue('papeterie'), true);
  assert.equal(estActiviteConnue(TOUTES_ACTIVITES), false);
  assert.equal(estActiviteConnue(''), false);
  assert.equal(estActiviteConnue(null), false);
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. Le piege de nom : categorie `imprimerie` ≠ activite `imprimerie`
   ═══════════════════════════════════════════════════════════════════════════ */

test('la categorie de prestation « imprimerie » n’est PAS l’activite', () => {
  // Un rapport de la papeterie qui a vendu une prestation d'imprimerie.
  const rapportPapeterie = {
    id: 'r-2',
    activite: ACTIVITE_PAPETERIE,
    categories: { imprimerie: 30000, marchandises: 5000 },
  };
  assert.equal(activiteDe(rapportPapeterie), ACTIVITE_PAPETERIE);
  assert.deepEqual(
    filtrerParActivite([rapportPapeterie], ACTIVITE_IMPRIMERIE),
    [],
    'un rapport papeterie ne doit pas basculer cote imprimerie a cause d’une categorie homonyme',
  );
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. Le filtrage
   ═══════════════════════════════════════════════════════════════════════════ */

const LIGNES = [
  { id: 'a', montant: 1000 },                                 // ancien : imprimerie
  { id: 'b', montant: 2000, activite: ACTIVITE_IMPRIMERIE },
  { id: 'c', montant: 4000, activite: ACTIVITE_PAPETERIE },
  { id: 'd', montant: 8000, activite: 'Papeterie' },           // saisie capitalisee
];

test('« les deux » rend TOUT, y compris les lignes sans champ', () => {
  assert.deepEqual(
    filtrerParActivite(LIGNES, TOUTES_ACTIVITES).map((l) => l.id),
    ['a', 'b', 'c', 'd'],
  );
});

test('« imprimerie » rend l’existant ET les lignes explicites, jamais la papeterie', () => {
  assert.deepEqual(
    filtrerParActivite(LIGNES, ACTIVITE_IMPRIMERIE).map((l) => l.id),
    ['a', 'b'],
  );
});

test('« papeterie » ne rend JAMAIS une ligne sans champ', () => {
  assert.deepEqual(
    filtrerParActivite(LIGNES, ACTIVITE_PAPETERIE).map((l) => l.id),
    ['c', 'd'],
    'une ligne d’avant l’ouverture de la papeterie ne peut pas etre de la papeterie',
  );
});

test('une liste absente n’est pas une erreur, c’est une liste vide', () => {
  assert.deepEqual(filtrerParActivite(null, ACTIVITE_PAPETERIE), []);
  assert.deepEqual(filtrerParActivite(undefined, TOUTES_ACTIVITES), []);
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. La repartition : aucun franc perdu, aucun franc compte deux fois
   ═══════════════════════════════════════════════════════════════════════════ */

test('la somme des deux activites fait exactement le total', () => {
  const r = repartirParActivite(LIGNES, (l) => l.montant);
  assert.equal(r.imprimerie, 3000);
  assert.equal(r.papeterie, 12000);
  assert.equal(r.total, 15000);
  assert.equal(
    r.imprimerie + r.papeterie,
    r.total,
    'un franc qui n’est ni d’un cote ni de l’autre est un franc disparu',
  );
});

test('une repartition sur rien vaut zero partout — pas NaN', () => {
  const r = repartirParActivite([], (l) => l.montant);
  assert.deepEqual(r, { imprimerie: 0, papeterie: 0, topshop: 0, total: 0 });
  // Le point qui compte : CHAQUE activite connue a sa case a zero. Une case
  // manquante rendrait `undefined`, et `undefined + 5000` vaut `NaN` — un
  // chiffre faux qui s'affiche sans planter.
  for (const a of ACTIVITES) assert.equal(r[a], 0, `${a} n'a pas de case a zero`);
});

test('une mesure non numerique compte pour zero, elle ne contamine pas le total', () => {
  const r = repartirParActivite(
    [{ montant: 'abc' }, { montant: 5000, activite: ACTIVITE_PAPETERIE }],
    (l) => l.montant,
  );
  assert.equal(r.imprimerie, 0);
  assert.equal(r.papeterie, 5000);
  assert.equal(r.total, 5000);
  assert.ok(Number.isFinite(r.total), 'un NaN affiche dans un ecran d’argent est un chiffre faux');
});

/* ═══════════════════════════════════════════════════════════════════════════
   6. L'ecriture
   ═══════════════════════════════════════════════════════════════════════════ */

test('avecActivite pose le champ sur ce qui part en base', () => {
  const data = avecActivite({ date: '2026-09-18', montant: 1000 }, ACTIVITE_PAPETERIE);
  assert.equal(data.activite, ACTIVITE_PAPETERIE);
  assert.equal(data.montant, 1000, 'le reste du payload est intact');
});

test('avecActivite NORMALISE au lieu d’ecrire une valeur inconnue en base', () => {
  assert.equal(avecActivite({}, 'Papeterie').activite, ACTIVITE_PAPETERIE);
  assert.equal(avecActivite({}, 'boulangerie').activite, ACTIVITE_IMPRIMERIE);
  assert.equal(avecActivite({}, '').activite, ACTIVITE_IMPRIMERIE);
  assert.equal(avecActivite({}, undefined).activite, ACTIVITE_IMPRIMERIE);
});

test('avecActivite refuse d’ecrire « les deux » : ce n’est pas une caisse', () => {
  // Une vue consolidee ne doit jamais devenir la propriete d'une ligne : la
  // ligne appartiendrait alors aux deux caisses, donc a aucune.
  assert.equal(avecActivite({}, TOUTES_ACTIVITES).activite, ACTIVITE_DEFAUT);
});

test('avecActivite ne mute pas l’objet d’origine', () => {
  const origine = { montant: 1000 };
  const sortie = avecActivite(origine, ACTIVITE_PAPETERIE);
  assert.equal(origine.activite, undefined);
  assert.notEqual(sortie, origine);
});

/* ═══════════════════════════════════════════════════════════════════════════
   7. LE PRELEVEMENT AUTOMATIQUE DES CHARGES FIXES
   ═══════════════════════════════════════════════════════════════════════════

   Une charge fixe appartient desormais a une activite (le loyer du local de la
   papeterie n'est pas celui de l'imprimerie). Son prelevement automatique cree
   un mouvement de SORTIE : si ce mouvement ne reprend pas l'activite de la
   charge, il retombe sur « imprimerie » par defaut, et chaque loyer de la
   papeterie est debite de la mauvaise caisse — sans qu'aucune erreur ne soit
   levee, puisque le total, lui, reste juste.

   ⚠️ LIMITE ASSUMEE DE CE TEST : il lit la SOURCE du service, il ne l'execute
   pas. `executerChargesDues()` ecrit dans `db`, et le doubler ici demanderait
   le harnais esbuild des tests d'ecran pour un service qui n'a pas d'interface.
   Un contrat de source ne prouve pas un comportement ; il empeche seulement
   que la ligne disparaisse sans que personne ne s'en apercoive. C'est le meme
   compromis que `tests/amorcage.test.mjs` pour le contrat de `main.jsx`.
   ═══════════════════════════════════════════════════════════════════════════ */

import { readFileSync } from 'node:fs';

test('le prélèvement automatique d’une charge fixe reprend l’activité de la charge', () => {
  const src = readFileSync(
    new URL('../src/services/charges-fixes-prelevement.js', import.meta.url), 'utf8',
  );
  assert.ok(
    /activiteDe\s*\(\s*charge\s*\)/.test(src),
    'le mouvement créé ne lit pas l’activité de la charge : le loyer de la '
    + 'papeterie sortirait de la caisse imprimerie',
  );
  assert.ok(
    /avecActivite\s*\(/.test(src),
    'l’activité doit être posée par `avecActivite` (qui normalise), pas à la main',
  );
});
