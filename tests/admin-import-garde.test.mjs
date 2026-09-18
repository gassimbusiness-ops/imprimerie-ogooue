/**
 * `/admin-import` — LA ROUTE QUI EFFACAIT TROIS MOIS DE SAISIE EN UN CLIC.
 *
 * Le defaut : la route est active, absente du menu — donc invisible et non
 * surveillee — et le bouton « Lancer l'import complet » appelait directement
 * `runFullImport()`, dont la premiere etape supprime TOUS les rapports
 * journaliers, TOUS les articles de stock et TOUT l'historique de mouvements.
 * 237 + 45 + 44 lignes en production au 18/09/2026. Aucune confirmation.
 *
 * Ces tests montent l'ecran POUR DE VRAI, avec des donnees de la forme de la
 * production, et verifient trois choses :
 *
 *   1. l'affichage seul n'ecrit ni ne supprime rien ;
 *   2. aucun bouton ne declenche la destruction sans un comptage prealable
 *      ET le mot SUPPRIMER retape — et le comptage NOMME ce qui va partir,
 *      avec le nombre de lignes ;
 *   3. les gardes sont DANS `runFullImport`, pas seulement dans l'affichage :
 *      un bouton grise n'arrete pas un appel deja parti, et un second onglet
 *      n'a pas le meme etat d'affichage.
 *
 * Lancer :  node --test tests/admin-import-garde.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rendreEcran, texteVivant } from './outils/rendu-ecran.mjs';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const SRC = readFileSync(`${RACINE}src/features/admin-import/page.jsx`, 'utf8');

/** Volumetrie relevee en base de production le 18/09/2026. */
const BASE_PRODUCTION = {
  rapports: Array.from({ length: 12 }, (_, i) => ({
    id: `r${i}`, date: `2026-09-${String(i + 1).padStart(2, '0')}`, total_recettes: 40000,
  })),
  produits: Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, nom: `Article ${i}`, quantite: 10 })),
  mouvements_stock: Array.from({ length: 7 }, (_, i) => ({ id: `m${i}`, produit_id: 'p0', type: 'sortie' })),
  produits_catalogue: [], projets_travaux: [], etapes_travaux: [],
  clients: [], commandes: [], users: [],
};

const ADMIN = { id: 'u-admin', prenom: 'Gassim', nom: 'Admin', role: 'admin' };

function bouton(conteneur, texte) {
  const tous = [...conteneur.querySelectorAll('button')];
  return tous.find((b) => (b.textContent || '').trim() === texte)
    || tous.find((b) => (b.textContent || '').includes(texte));
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. L'écran, monté pour de vrai
   ═══════════════════════════════════════════════════════════════════════════ */

test('l’affichage seul ne supprime rien', async () => {
  const v = await rendreEcran({
    ecran: 'src/features/admin-import/page.jsx', utilisateur: ADMIN, donnees: BASE_PRODUCTION,
  });
  try {
    assert.ok(v.texte.length > 50, 'écran blanc');
    assert.deepEqual(v.journal.ecritures, [], 'ouvrir la page écrit ou supprime en base');
  } finally { await v.demonter(); }
});

test('aucun bouton ne lance la destruction sans confirmation', async () => {
  const v = await rendreEcran({
    ecran: 'src/features/admin-import/page.jsx', utilisateur: ADMIN, donnees: BASE_PRODUCTION,
  });
  try {
    // On clique sur TOUT ce qui est cliquable et non grisé, comme le ferait une
    // main pressée sur une page inconnue.
    const cliquables = [...v.conteneur.querySelectorAll('button')].filter((b) => !b.disabled);
    await v.act(async () => {
      for (const b of cliquables) b.click();
      await new Promise((r) => setTimeout(r, 0));
    });
    for (let i = 0; i < 3; i++) {
      await v.act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    }
    const suppressions = v.journal.ecritures.filter((e) => e.operation === 'delete');
    assert.deepEqual(
      suppressions, [],
      `${suppressions.length} suppressions déclenchées sans que le mot SUPPRIMER ait été tapé`,
    );
  } finally { await v.demonter(); }
});

test('le comptage NOMME ce qui va être détruit, et combien de lignes', async () => {
  const v = await rendreEcran({
    ecran: 'src/features/admin-import/page.jsx', utilisateur: ADMIN, donnees: BASE_PRODUCTION,
  });
  try {
    const compter = bouton(v.conteneur, 'Compter ce qui sera supprimé');
    assert.ok(compter, 'aucun bouton de comptage préalable');
    await v.act(async () => { compter.click(); await new Promise((r) => setTimeout(r, 0)); });
    for (let i = 0; i < 3; i++) {
      await v.act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    }
    const texte = texteVivant(v);
    assert.ok(texte.includes('12 rapports journaliers'), 'le nombre de rapports détruits n’est pas annoncé');
    assert.ok(texte.includes('5 articles de stock'), 'le nombre d’articles détruits n’est pas annoncé');
    assert.ok(texte.includes('7 mouvements de stock'), 'l’historique de stock détruit n’est pas annoncé');
    assert.ok(texte.includes('24 lignes'), 'le total détruit n’est pas annoncé');
    assert.ok(texte.includes('2026-09-01'), 'la période des rapports détruits n’est pas annoncée');
    assert.ok(texte.includes('SUPPRIMER'), 'le mot à retaper n’est pas indiqué');
    // Le comptage est une LECTURE : il ne doit toucher a rien.
    assert.deepEqual(v.journal.ecritures, [], 'le comptage a écrit en base');

    // Le bouton de destruction existe, et il est grisé tant que le mot n'est
    // pas retapé.
    const detruire = bouton(v.conteneur, 'Supprimer et lancer');
    assert.ok(detruire, 'aucun bouton de destruction après comptage');
    assert.equal(detruire.disabled, true, 'le bouton de destruction n’est pas grisé avant confirmation');

    // Et un clic dessus, malgré le grisé, ne détruit rien.
    await v.act(async () => { detruire.click(); await new Promise((r) => setTimeout(r, 0)); });
    assert.deepEqual(v.journal.ecritures.filter((e) => e.operation === 'delete'), []);
  } finally { await v.demonter(); }
});

test('un non-admin ne voit même pas la page', async () => {
  for (const role of ['employe', 'manager', 'client', 'associe']) {
    const v = await rendreEcran({
      ecran: 'src/features/admin-import/page.jsx',
      utilisateur: { id: 'u', prenom: 'P', nom: 'N', role },
      donnees: BASE_PRODUCTION,
    });
    try {
      assert.ok(
        v.texte.includes('Accès réservé aux administrateurs'),
        `le rôle « ${role} » atteint l’écran d’import`,
      );
      assert.ok(!v.texte.includes('Compter ce qui sera supprimé'), `le rôle « ${role} » voit le bouton de comptage`);
    } finally { await v.demonter(); }
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. Les gardes sont DANS la fonction, pas seulement dans l'affichage
   ═══════════════════════════════════════════════════════════════════════════ */

test('runFullImport refuse lui-même : rôle, comptage, mot retapé', () => {
  const debut = SRC.indexOf('const runFullImport =');
  assert.ok(debut > -1, 'runFullImport introuvable');
  // Le corps jusqu'au premier appel destructeur.
  const jusquaDestruction = SRC.slice(debut, SRC.indexOf('doDeleteTestData(auditData)', debut));
  assert.ok(jusquaDestruction.length > 0, 'la suppression n’est plus appelée — vérifier ce test');

  assert.ok(jusquaDestruction.includes("user?.role !== 'admin'"),
    'aucun contrôle de rôle avant la destruction');
  assert.ok(jusquaDestruction.includes('if (!aDetruire)'),
    'la destruction peut partir sans comptage préalable');
  assert.ok(jusquaDestruction.includes('MOT_DE_CONFIRMATION'),
    'la destruction peut partir sans que le mot ait été retapé');
  assert.ok(jusquaDestruction.includes('logAction('),
    'la destruction n’est pas tracée dans le journal d’audit avant d’avoir lieu');
  assert.ok(jusquaDestruction.includes('verrouImport.executerUneSeuleFois'),
    'deux appels concurrents peuvent lancer deux imports');
});

test('le mot de confirmation est exigé à l’identique, sans tolérance', () => {
  assert.ok(SRC.includes("const MOT_DE_CONFIRMATION = 'SUPPRIMER';"));
  assert.ok(
    SRC.includes('motSaisi.trim() !== MOT_DE_CONFIRMATION'),
    'la comparaison du mot n’est pas exacte — une tolérance (minuscules, sous-chaîne) rouvrirait la porte',
  );
});

test('le comptage ne lit que, et ne supprime pas', () => {
  const debut = SRC.indexOf('const compterCeQuiSeraDetruit =');
  assert.ok(debut > -1, 'le comptage préalable n’existe pas');
  const corps = SRC.slice(debut, SRC.indexOf('/* ─── Run all steps', debut));
  assert.ok(!corps.includes('.delete('), 'le comptage supprime quelque chose');
  assert.ok(!corps.includes('.create('), 'le comptage écrit quelque chose');
  assert.ok(!corps.includes('.update('), 'le comptage modifie quelque chose');
});
