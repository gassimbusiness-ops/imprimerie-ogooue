/**
 * « RÈGLE » — un événement sans date ne doit plus pouvoir être enregistré,
 * et un événement déjà enregistré sans date ne doit plus afficher
 * « Invalid Date » au gérant.
 *
 * ── Ce qui a été constaté ─────────────────────────────────────────────────
 *
 * `src/features/evenements/page.jsx`, `handleSave()` (ligne 86) ne validait
 * que `form.nom`. Le champ « Date » du formulaire n'est même pas marqué d'une
 * étoile. Le gérant tape un nom, laisse la date vide, clique « Ajouter » :
 * la ligne part en base avec `date: ''`.
 *
 * À l'affichage, `new Date('')` rend `Invalid Date`, et
 * `.toLocaleDateString('fr-FR', …)` rend la chaîne « Invalid Date » —
 * imprimée telle quelle sur la carte, ligne 152.
 *
 * ── Les deux garanties testées ici ────────────────────────────────────────
 *
 *   1. LE GESTE : remplir le nom, LAISSER LA DATE VIDE, enregistrer.
 *      Aucune écriture ne doit partir, et le refus doit être dit.
 *   2. LA RÉPARATION DE L'EXISTANT : les lignes déjà en base sans date
 *      s'affichent avec un tiret, jamais « Invalid Date ». On ne réécrit pas
 *      la base pour corriger un affichage.
 *
 * Lancer :  node --test tests/evenement-date-obligatoire.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rendreEcran, texteVivant } from './outils/rendu-ecran.mjs';

const ECRAN = 'src/features/evenements/page.jsx';

/**
 * Cherche un bouton dans TOUT le document : les dialogues Radix se rendent
 * dans un portail attaché à `body`, pas dans `#racine`. Chercher dans le seul
 * conteneur rendrait le test vert sans avoir rien cliqué.
 */
function bouton(v, texte) {
  const racine = v.conteneur.ownerDocument.body;
  const tous = [...racine.querySelectorAll('button')];
  return tous.find((b) => (b.textContent || '').trim() === texte)
    || tous.find((b) => (b.textContent || '').includes(texte));
}

/** Le champ de saisie qui suit un libellé donné, dans le dialogue. */
function champApresLibelle(v, libelle) {
  const doc = v.conteneur.ownerDocument;
  const bloc = [...doc.body.querySelectorAll('label')]
    .find((l) => (l.textContent || '').trim().startsWith(libelle));
  return bloc?.parentElement?.querySelector('input') || null;
}

/** Saisit dans un champ React contrôlé (le setter natif déclenche onChange). */
function saisir(v, champ, valeur) {
  const proto = v.conteneur.ownerDocument.defaultView.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(champ, valeur);
  champ.dispatchEvent(new globalThis.Event('input', { bubbles: true }));
}

async function vidanger(v, tours = 6) {
  for (let i = 0; i < tours; i++) {
    await v.act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. LE GESTE DU GÉRANT — nom rempli, date vide, « Ajouter »
   ═══════════════════════════════════════════════════════════════════════════ */

test('nom rempli + date vide + Ajouter → aucun événement n’est créé', async () => {
  const v = await rendreEcran({ ecran: ECRAN, donnees: { evenements: [] } });
  try {
    const ouvrir = bouton(v, 'Nouvel événement');
    assert.ok(ouvrir, 'le bouton « Nouvel événement » est introuvable : le scénario ne teste rien');
    await v.act(async () => { ouvrir.click(); await new Promise((r) => setTimeout(r, 0)); });
    await vidanger(v);

    const champNom = champApresLibelle(v, 'Nom');
    assert.ok(champNom, 'le champ « Nom » est introuvable dans le dialogue');
    await v.act(async () => { saisir(v, champNom, 'Foire de Moanda'); });
    await vidanger(v, 2);

    // LA DATE RESTE VIDE. C'est tout le sujet : on ne la remplit pas.
    const champDate = champApresLibelle(v, 'Date');
    assert.ok(champDate, 'le champ « Date » est introuvable dans le dialogue');
    assert.equal(champDate.value, '', 'le champ date doit bien être vide au départ');

    const ajouter = bouton(v, 'Ajouter');
    assert.ok(ajouter, 'le bouton « Ajouter » est introuvable');
    await v.act(async () => { ajouter.click(); await new Promise((r) => setTimeout(r, 0)); });
    await vidanger(v);

    const creations = v.journal.ecritures.filter(
      (e) => e.collection === 'evenements' && e.operation === 'create',
    );
    assert.deepEqual(
      creations, [],
      'un événement SANS DATE a été enregistré : la carte affichera « Invalid Date »',
    );
    assert.deepEqual(
      v.toasts.filter((t) => t.niveau === 'success'), [],
      'l’écran a annoncé « Événement ajouté » alors que la date manque',
    );
    assert.ok(
      v.toasts.some((t) => t.niveau === 'error' && /date/i.test(t.message)),
      'le refus doit nommer la date : sans cela le gérant reclique sans comprendre',
    );
  } finally { await v.demonter(); }
});

test('nom + date remplis → l’événement est bien enregistré', async () => {
  // Le garde-fou ne doit pas bloquer le cas normal : sans ce test, « refuser
  // tout » passerait le test précédent.
  const v = await rendreEcran({ ecran: ECRAN, donnees: { evenements: [] } });
  try {
    const ouvrir = bouton(v, 'Nouvel événement');
    await v.act(async () => { ouvrir.click(); await new Promise((r) => setTimeout(r, 0)); });
    await vidanger(v);

    await v.act(async () => {
      saisir(v, champApresLibelle(v, 'Nom'), 'Foire de Moanda');
    });
    await vidanger(v, 2);
    await v.act(async () => {
      saisir(v, champApresLibelle(v, 'Date'), '2026-11-08');
    });
    await vidanger(v, 2);

    await v.act(async () => { bouton(v, 'Ajouter').click(); await new Promise((r) => setTimeout(r, 0)); });
    await vidanger(v);

    const creations = v.journal.ecritures.filter(
      (e) => e.collection === 'evenements' && e.operation === 'create',
    );
    assert.equal(creations.length, 1, 'un événement complet doit être enregistré');
    assert.equal(creations[0].data.date, '2026-11-08');
    assert.equal(creations[0].data.nom, 'Foire de Moanda');
  } finally { await v.demonter(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. L'EXISTANT — les lignes déjà en base sans date
   ═══════════════════════════════════════════════════════════════════════════ */

test('un événement déjà enregistré sans date n’affiche pas « Invalid Date »', async () => {
  const v = await rendreEcran({
    ecran: ECRAN,
    donnees: {
      evenements: [
        { id: 'ev-1', nom: 'Événement sans date', date: '', type: 'autre', opportunites: '' },
        { id: 'ev-2', nom: 'Date absente du tout', type: 'commercial' },
        { id: 'ev-3', nom: 'Date illisible', date: 'bientôt', type: 'autre' },
      ],
    },
  });
  try {
    const texte = texteVivant(v);
    assert.ok(texte.length > 0, 'écran blanc');
    assert.ok(
      !/Invalid Date/.test(texte),
      'la carte affiche « Invalid Date » au gérant : ' + texte.slice(0, 400),
    );
    assert.ok(
      texte.includes('Événement sans date'),
      'la ligne doit rester visible : on répare l’affichage, on ne cache pas la donnée',
    );
  } finally { await v.demonter(); }
});

test('le jour affiché ne dépend pas du fuseau de la machine', async () => {
  // Le même piège que le bug de 55 300 F, côté lecture. Mesuré le 18/09/2026 :
  //   TZ=Africa/Libreville  new Date('2026-11-08')… → « 8 novembre »
  //   TZ=UTC                                        → « 8 novembre »
  //   TZ=America/Los_Angeles                        → « 7 novembre »   ⛔
  // Le gérant en déplacement voyait la veille. Ce test tourne sous les trois
  // fuseaux (voir la commande de vérification du dépôt).
  const v = await rendreEcran({
    ecran: ECRAN,
    donnees: { evenements: [{ id: 'ev-8nov', nom: 'Foire de Moanda', date: '2026-11-08', type: 'commercial' }] },
  });
  try {
    const texte = texteVivant(v);
    assert.ok(
      texte.includes('8 novembre'),
      'le 8 novembre ne s’affiche pas comme tel : ' + texte.slice(0, 400),
    );
    assert.ok(!texte.includes('7 novembre'), 'la date a glissé d’un jour');
  } finally { await v.demonter(); }
});

test('l’écran des événements n’écrit rien pendant le simple affichage', async () => {
  const v = await rendreEcran({
    ecran: ECRAN,
    donnees: { evenements: [{ id: 'ev-1', nom: 'Sans date', date: '', type: 'autre' }] },
  });
  try {
    assert.deepEqual(v.journal.ecritures, [], 'consulter un écran ne doit rien modifier');
    assert.deepEqual(v.erreurs, [], 'exception ou rejet non rattrapé pendant le montage');
  } finally { await v.demonter(); }
});
