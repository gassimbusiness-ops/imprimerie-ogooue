/**
 * L'ACTIVITE, SUR LES ECRANS QUI TOUCHENT A L'ARGENT ET AU STOCK.
 *
 * ── Ce qui est verifie ────────────────────────────────────────────────────
 *
 * Deux choses, et deux seulement, mais sur de VRAIS montages :
 *
 *   A. CE QUI PART EN BASE porte `activite`. Un franc, un article ou une
 *      commande saisis sans caisse d'appartenance sont exactement ce qu'il
 *      faudrait « demeler a la main dans trois mois » — la chose que cette
 *      intervention existe pour empecher.
 *
 *   B. CE QUI S'AFFICHE se laisse separer. Un ecran de chiffres qui ne sait
 *      dire que le total oblige a ressortir la calculette : il n'a pas fait
 *      son travail.
 *
 * ── Pourquoi monter, et pas relire la source ──────────────────────────────
 *
 * Le 14/09/2026, 112 tests unitaires etaient verts et l'application est
 * devenue ENTIEREMENT BLANCHE en production. Poser une constante au niveau
 * d'un module sans son import ne se voit ni au lint ni aux tests unitaires,
 * mais src/app.jsx importe tous les ecrans : un seul oubli blanchit tout.
 * Chaque ecran touche est donc monte ici pour de vrai.
 *
 * ⚠️ `v.texte` est un instantane du montage. Apres un clic : `texteVivant(v)`.
 *
 * Lancer :  node --test tests/activite-ecrans.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rendreEcran, texteVivant } from './outils/rendu-ecran.mjs';
import { todayISO } from '../src/lib/dates.js';

const ADMIN = { id: 'u-admin', prenom: 'Gassim', nom: 'Admin', role: 'admin' };

/* ═══════════════════════════════════════════════════════════════════════════
   Outils
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Bouton par texte exact d'abord. La recherche porte sur tout le DOCUMENT :
 * les dialogues Radix se rendent dans un portail attache a `body`, et chercher
 * dans le seul `#racine` ferait « passer » un test qui ne teste rien.
 */
function bouton(v, libelle) {
  const racine = v.conteneur.ownerDocument?.body || v.conteneur;
  const tous = [...racine.querySelectorAll('button')];
  return tous.find((b) => (b.textContent || '').trim() === libelle)
    || tous.find((b) => (b.getAttribute('title') || '').trim() === libelle)
    || tous.find((b) => (b.textContent || '').trim().includes(libelle))
    || null;
}

/**
 * Bouton cherche DANS le dialogue ouvert.
 *
 * Indispensable : plusieurs ecrans nomment « Ajouter » a la fois le bouton qui
 * OUVRE le formulaire et celui qui l'ENREGISTRE. Une recherche sur tout le
 * document retrouverait le premier, re-ouvrirait le dialogue, et le test
 * conclurait « rien n'a ete ecrit » sans avoir jamais appuye sur Enregistrer.
 */
function boutonDialogue(v, libelle) {
  const racine = v.conteneur.ownerDocument?.body || v.conteneur;
  const dialogues = [...racine.querySelectorAll('[role="dialog"]')];
  for (const d of dialogues) {
    const tous = [...d.querySelectorAll('button')];
    const trouve = tous.find((b) => (b.textContent || '').trim() === libelle)
      || tous.find((b) => (b.textContent || '').trim().includes(libelle));
    if (trouve) return trouve;
  }
  return null;
}

/** Champ de saisie par son texte d'invite (placeholder). */
function champ(v, placeholder) {
  const racine = v.conteneur.ownerDocument?.body || v.conteneur;
  return [...racine.querySelectorAll('input, textarea')]
    .find((e) => (e.getAttribute('placeholder') || '').toLowerCase().includes(placeholder.toLowerCase()))
    || null;
}

/** Saisit une valeur dans un champ controle par React. */
async function saisir(v, element, valeur) {
  assert.ok(element, 'champ de saisie introuvable');
  const proto = element.tagName === 'TEXTAREA'
    ? v.conteneur.ownerDocument.defaultView.HTMLTextAreaElement.prototype
    : v.conteneur.ownerDocument.defaultView.HTMLInputElement.prototype;
  const poser = Object.getOwnPropertyDescriptor(proto, 'value').set;
  await v.act(async () => {
    poser.call(element, String(valeur));
    element.dispatchEvent(new v.conteneur.ownerDocument.defaultView.Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function cliquer(v, element, libelle = '') {
  assert.ok(element, `bouton introuvable ${libelle}`);
  await v.act(async () => { element.click(); await new Promise((r) => setTimeout(r, 0)); });
  for (let i = 0; i < 3; i++) {
    await v.act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}

/** « 130 000 » tel que l'ecran l'ecrit — espaces insecables compris. */
function contientMontant(texte, montant) {
  const n = (s) => String(s).replace(/[\s  ]/g, '');
  return n(texte).includes(n(new Intl.NumberFormat('fr-FR').format(montant)));
}

/* ═══════════════════════════════════════════════════════════════════════════
   Donnees
   ═══════════════════════════════════════════════════════════════════════════ */

const AUJOURDHUI = todayISO();

const RAPPORTS = [
  {
    id: 'r-impr', date: AUJOURDHUI, statut: 'valide', operateur_nom: 'Ibrahim',
    activite: 'imprimerie',
    categories: { copies: 70000, imprimerie: 50000 },
    depenses: [{ description: 'Encre', montant: 20000 }],
  },
  {
    id: 'r-pap', date: AUJOURDHUI, statut: 'valide', operateur_nom: 'Ibrahim',
    activite: 'papeterie',
    // Une recette dans la CATEGORIE `imprimerie`, sur un rapport PAPETERIE :
    // categorie de prestation ≠ activite. Si les deux sont confondues, ces
    // 15 000 F changent de caisse sans qu'aucune erreur ne soit levee.
    categories: { marchandises: 30000, imprimerie: 15000 },
    depenses: [{ description: 'Sachets', montant: 5000 }],
  },
  {
    // Un rapport d'avant l'ouverture de la papeterie : aucun champ `activite`.
    id: 'r-ancien', date: AUJOURDHUI, statut: 'valide', operateur_nom: 'Ibrahim',
    categories: { copies: 10000 }, depenses: [],
  },
];

const BASE = {
  rapports: RAPPORTS,
  clotures_caisse: [],
  comptes_bancaires: [{ id: 'c1', nom: 'Caisse', solde: 500000 }],
  mouvements_financiers: [], charges_fixes: [], dettes: [], actionnaires: [],
  investissements: [], devis: [], factures: [],
  clients: [{ id: 'cli-1', nom: 'Mairie de Moanda', telephone: '+241' }],
  produits: [{ id: 'p1', nom: 'Papier A4', quantite: 10, quantite_minimum: 2, prix_unitaire: 500 }],
  mouvements_stock: [], commandes: [],
  employes: [{ id: 'e-1', prenom: 'Ibrahim', nom: 'Abakar', role: 'employe' }],
  pointages: [], taches: [], objectifs: [], notifications_app: [],
  fidelite_clients: [], tarifs_clients: [], projets_travaux: [], etapes_travaux: [],
};

/* ═══════════════════════════════════════════════════════════════════════════
   A. CE QUI PART EN BASE PORTE L'ACTIVITE
   ═══════════════════════════════════════════════════════════════════════════ */

test('saisie des ventes comptoir — le rapport transmis porte l’activite choisie', async () => {
  // Le formulaire de saisie est monte DIRECTEMENT, avec ses props : c'est par
  // lui que passe chaque franc encaisse au comptoir, et l'atteindre au travers
  // des menus Radix de l'ecran parent ne se teste pas dans jsdom.
  const recus = [];
  const v = await rendreEcran({
    ecran: 'src/features/rapports/components/rapport-form.jsx',
    donnees: BASE,
    utilisateur: ADMIN,
    proprietes: {
      rapport: { date: AUJOURDHUI, operateur_id: 'e-1', lignes: [], categories: {}, depenses: [] },
      onSave: async (d) => { recus.push(d); },
      onCancel: () => {},
    },
  });
  try {
    assert.ok(v.texte.length > 30, 'écran blanc : le formulaire de saisie ne se monte pas');

    const bPapeterie = bouton(v, 'Papeterie');
    assert.ok(bPapeterie, 'aucun sélecteur d’activité là où l’on encaisse');
    await cliquer(v, bPapeterie);

    await cliquer(v, bouton(v, 'Enregistrer brouillon'), '« Enregistrer brouillon »');

    assert.equal(recus.length, 1, 'le rapport n’a pas été transmis');
    assert.equal(
      recus[0].activite, 'papeterie',
      'le rapport de ventes part en base sans dire à quelle caisse il appartient',
    );
  } finally { await v.demonter(); }
});

test('mouvement financier — l’écriture part avec son activité', async () => {
  const v = await rendreEcran({
    ecran: 'src/features/finances/page.jsx', donnees: BASE, utilisateur: ADMIN,
  });
  try {
    await cliquer(v, bouton(v, 'Mouvements'), 'onglet Mouvements');
    await cliquer(v, bouton(v, 'Ajouter'), '« Ajouter »');

    const bPapeterie = boutonDialogue(v, 'Papeterie');
    assert.ok(bPapeterie, 'aucun sélecteur d’activité sur la saisie d’un mouvement');
    await cliquer(v, bPapeterie);

    const montant = [...(v.conteneur.ownerDocument.body).querySelectorAll('input[type="number"]')][0];
    await saisir(v, montant, '12000');
    await cliquer(v, boutonDialogue(v, 'Ajouter'), 'validation du mouvement');

    const ecrites = v.journal.ecritures.filter(
      (e) => e.collection === 'mouvements_financiers' && e.operation === 'create',
    );
    assert.equal(ecrites.length, 1, 'le mouvement n’a pas été écrit');
    assert.equal(
      ecrites[0].data.activite, 'papeterie',
      'un mouvement d’argent part en base sans caisse d’appartenance',
    );
  } finally { await v.demonter(); }
});

test('article de stock — l’article créé porte son activité', async () => {
  const v = await rendreEcran({
    ecran: 'src/features/stocks/page.jsx', donnees: BASE, utilisateur: ADMIN,
  });
  try {
    await cliquer(v, bouton(v, 'Nouvel article'), '« Nouvel article »');

    const bPapeterie = boutonDialogue(v, 'Papeterie');
    assert.ok(bPapeterie, 'aucun sélecteur d’activité sur la fiche article');
    await cliquer(v, bPapeterie);

    await saisir(v, champ(v, 'Rame papier'), 'Cahier 200 pages');
    await cliquer(v, boutonDialogue(v, 'Ajouter l’article') || boutonDialogue(v, 'Ajouter l\'article'), 'validation de l’article');

    const ecrites = v.journal.ecritures.filter(
      (e) => e.collection === 'produits' && e.operation === 'create',
    );
    assert.equal(ecrites.length, 1, 'l’article n’a pas été écrit');
    assert.equal(
      ecrites[0].data.activite, 'papeterie',
      'un article de stock sans activité rend l’inventaire des deux commerces inséparable',
    );
  } finally { await v.demonter(); }
});

test('commande — la commande créée porte son activité', async () => {
  const v = await rendreEcran({
    // `clients: []` volontairement : avec un annuaire non vide, l'ecran rend un
    // menu Radix a la place du champ « Nom du client », et un menu Radix ne se
    // pilote pas dans jsdom. Ce que ce test verifie — l'activite portee par la
    // commande ecrite — ne depend pas de la facon dont le client est choisi.
    ecran: 'src/features/commandes/page.jsx',
    donnees: { ...BASE, clients: [] },
    utilisateur: ADMIN,
    routeur: true,
  });
  try {
    await cliquer(v, bouton(v, 'Nouvelle commande'), '« Nouvelle commande »');

    const bPapeterie = boutonDialogue(v, 'Papeterie');
    assert.ok(bPapeterie, 'aucun sélecteur d’activité sur la saisie d’une commande');
    await cliquer(v, bPapeterie);

    await saisir(v, champ(v, 'Nom du client'), 'Mairie de Moanda');
    // Le champ de la LIGNE de commande : sans au moins une ligne decrite,
    // l'ecran refuse d'enregistrer.
    await saisir(v, champ(v, 'Ex: 500 affiches'), '200 cahiers');
    const ligne = [...v.conteneur.ownerDocument.body.querySelectorAll('input[placeholder="Description"]')][0];
    await saisir(v, ligne, '200 cahiers 200 pages');
    await cliquer(v, boutonDialogue(v, 'Créer la commande'), 'validation de la commande');

    const ecrites = v.journal.ecritures.filter(
      (e) => e.collection === 'commandes' && e.operation === 'create',
    );
    assert.equal(ecrites.length, 1, 'la commande n’a pas été écrite');
    assert.equal(
      ecrites[0].data.activite, 'papeterie',
      'une commande sans activité mélange les deux chiffres d’affaires',
    );
  } finally { await v.demonter(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   B. CE QUI S'AFFICHE SE LAISSE SEPARER
   ═══════════════════════════════════════════════════════════════════════════ */

test('rapports — le CA se lit par activité, et la somme fait le total', async () => {
  const v = await rendreEcran({
    ecran: 'src/features/rapports/page.jsx', donnees: BASE, utilisateur: ADMIN,
  });
  try {
    const t = texteVivant(v);
    // Imprimerie : 120 000 (explicite) + 10 000 (ancien, sans champ) = 130 000
    assert.ok(contientMontant(t, 130000), `CA imprimerie absent :\n${t.slice(0, 1200)}`);
    // Papeterie : 30 000 + 15 000 = 45 000
    assert.ok(contientMontant(t, 45000), `CA papeterie absent :\n${t.slice(0, 1200)}`);
    // Total : 175 000 — les trois chiffres doivent tenir ensemble.
    assert.ok(contientMontant(t, 175000), `CA total absent :\n${t.slice(0, 1200)}`);
  } finally { await v.demonter(); }
});

test('rapports — filtrer sur la papeterie retire les rapports de l’imprimerie', async () => {
  const v = await rendreEcran({
    ecran: 'src/features/rapports/page.jsx', donnees: BASE, utilisateur: ADMIN,
  });
  try {
    const bPapeterie = bouton(v, 'Papeterie');
    assert.ok(bPapeterie, 'aucun sélecteur d’activité sur l’écran des rapports');
    await cliquer(v, bPapeterie);

    const t = texteVivant(v);
    assert.ok(contientMontant(t, 45000), `CA papeterie absent après filtrage :\n${t.slice(0, 1200)}`);
    assert.ok(
      !contientMontant(t, 175000),
      'le total consolidé reste affiché alors que seule la papeterie est demandée',
    );
  } finally { await v.demonter(); }
});

test('tableau de bord — le CA du mois se lit par activité', async () => {
  const v = await rendreEcran({
    ecran: 'src/features/dashboard/page.jsx', donnees: BASE, utilisateur: ADMIN, routeur: true,
  });
  try {
    const t = texteVivant(v);
    assert.ok(contientMontant(t, 175000), `CA du mois absent :\n${t.slice(0, 1200)}`);
    assert.ok(
      contientMontant(t, 130000) && contientMontant(t, 45000),
      `le tableau de bord ne sait dire que le total, pas la part de chaque activité :\n${t.slice(0, 1500)}`,
    );
  } finally { await v.demonter(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   C. AUCUN DES ECRANS TOUCHES N'EST BLANC, ET AUCUN N'ECRIT EN S'AFFICHANT
   ═══════════════════════════════════════════════════════════════════════════ */

const ECRANS_TOUCHES = [
  ['src/features/cloture-caisse/page.jsx', false],
  ['src/features/rapports/page.jsx', false],
  ['src/features/finances/page.jsx', false],
  ['src/features/stocks/page.jsx', false],
  ['src/features/commandes/page.jsx', true],
  ['src/features/dashboard/page.jsx', true],
];

for (const [ecran, routeur] of ECRANS_TOUCHES) {
  test(`${ecran} — se monte, et n’écrit rien en s’affichant`, async () => {
    const v = await rendreEcran({ ecran, donnees: BASE, utilisateur: ADMIN, routeur });
    try {
      assert.ok(v.texte.length > 30, `${ecran} : écran blanc (${v.texte.length} caractères)`);
      assert.deepEqual(
        v.erreurs.map(String), [],
        `${ecran} : une exception est partie pendant le montage`,
      );
      assert.deepEqual(
        v.journal.ecritures, [],
        `${ecran} : consulter l’écran écrit en base`,
      );
    } finally { await v.demonter(); }
  });
}
