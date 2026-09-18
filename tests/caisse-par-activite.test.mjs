/**
 * LA CAISSE PAPETERIE EST SEPAREE — verifie sur les ECRANS, pas sur les modules.
 *
 * ── Ce que le dirigeant a demande ─────────────────────────────────────────
 *
 * « La caisse papeterie est separee. » Cela veut dire trois choses precises,
 * et chacune est un test ci-dessous :
 *
 *   1. Le MONTANT ATTENDU d'une cloture ne compte que les recettes de SON
 *      activite. Comptabiliser les 120 000 F de l'imprimerie face aux billets
 *      du tiroir de la papeterie afficherait un ecart majeur imaginaire — et
 *      ferait chercher un vol qui n'existe pas.
 *
 *   2. Cloturer l'imprimerie ne cloture PAS la papeterie. Tant que les deux
 *      partagent la cle « date », le second tiroir passe pour deja compte et
 *      son ecart du soir n'est jamais mesure.
 *
 *   3. Ce qui part en base porte l'activite. Une piece comptable sans caisse
 *      d'appartenance est exactement ce qu'il faudrait « demeler a la main
 *      dans trois mois ».
 *
 * ── Pourquoi monter l'ecran ───────────────────────────────────────────────
 *
 * Le 14/09/2026, 112 tests unitaires etaient verts et l'application est devenue
 * blanche en production. Un selecteur d'activite ajoute a un ecran d'argent se
 * verifie en le montant et en cliquant dessus, pas en relisant la source.
 *
 * ⚠️ `v.texte` est un instantane du montage : apres un clic, on relit par
 * `texteVivant(v)` (lecon du 16/09/2026).
 *
 * Lancer :  node --test tests/caisse-par-activite.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rendreEcran, texteVivant } from './outils/rendu-ecran.mjs';
import { todayISO } from '../src/lib/dates.js';
import { ACTIVITE_PAPETERIE, libelleActivite } from '../src/services/activites.js';

/**
 * Le texte du bouton, lu a la source.
 *
 * Ces tests verifient la SEPARATION DES CAISSES, pas l'orthographe du libelle.
 * Ecrit en dur, « Papeterie » a casse quatre tests le 18/09/2026 quand le
 * dirigeant a demande « PAPETERIE OGOOUE » — un renommage d'affichage ne doit
 * pas faire rougir une garantie d'argent. Le libelle exact, lui, est verifie
 * une fois pour toutes dans tests/activites.test.mjs.
 */
const LIB_PAPETERIE = libelleActivite(ACTIVITE_PAPETERIE);

/**
 * L'ecran de cloture ne travaille que sur AUJOURD'HUI, et il lit cette date par
 * `todayISO()`. Le jeu d'essai doit donc etre date par la MEME fonction : une
 * date en dur rendrait le test faux demain, et `new Date().toISOString()`
 * rendrait « hier » entre 00 h et 01 h a Moanda — le bug meme que src/lib/dates.js
 * existe pour empecher.
 */
const AUJOURDHUI = todayISO();

/** 120 000 F de recettes cote imprimerie, 20 000 F de depenses → 100 000 F attendus. */
const RAPPORT_IMPRIMERIE = {
  id: 'r-impr',
  date: AUJOURDHUI,
  statut: 'valide',
  operateur_nom: 'Ibrahim',
  activite: 'imprimerie',
  categories: { copies: 70000, imprimerie: 50000 },
  depenses: [{ description: 'Encre', montant: 20000 }],
};

/**
 * 45 000 F de recettes cote papeterie, 5 000 F de depenses → 40 000 F attendus.
 * ⚠️ Ce rapport contient volontairement une recette dans la CATEGORIE
 * `imprimerie` : categorie de prestation ≠ activite. Si l'ecran confond les
 * deux, ces 15 000 F filent dans la mauvaise caisse.
 */
const RAPPORT_PAPETERIE = {
  id: 'r-pap',
  date: AUJOURDHUI,
  statut: 'valide',
  operateur_nom: 'Ibrahim',
  activite: 'papeterie',
  categories: { marchandises: 30000, imprimerie: 15000 },
  depenses: [{ description: 'Sachets', montant: 5000 }],
};

/** Un rapport d'avant l'ouverture de la papeterie : aucun champ `activite`. */
const RAPPORT_ANCIEN = {
  id: 'r-ancien',
  date: AUJOURDHUI,
  statut: 'valide',
  operateur_nom: 'Ibrahim',
  categories: { copies: 10000 },
  depenses: [],
};

const BASE = {
  rapports: [RAPPORT_IMPRIMERIE, RAPPORT_PAPETERIE, RAPPORT_ANCIEN],
  clotures_caisse: [],
  comptes_bancaires: [{ id: 'caisse', nom: 'Caisse', solde: 100000 }],
  employes: [{ id: 'e-1', prenom: 'Ibrahim', nom: 'Abakar', role: 'employe' }],
};

const ADMIN = { id: 'u-admin', prenom: 'Gassim', nom: 'Admin', role: 'admin' };

/**
 * Bouton par texte exact d'abord — une sous-chaine attrape l'onglet voisin
 * (lecon du 16/09/2026 : « Livrées » attrape au lieu de « Livrée »).
 *
 * La recherche porte sur tout le DOCUMENT, pas sur `#racine` : les dialogues
 * Radix se rendent dans un portail attache a `body`. Chercher dans le seul
 * conteneur rendrait invisible le bouton d'enregistrement du comptage, et le
 * test « passerait » en ne testant rien.
 */
function bouton(conteneur, libelle) {
  const racine = conteneur.ownerDocument?.body || conteneur;
  const tous = [...racine.querySelectorAll('button')];
  return tous.find((b) => (b.textContent || '').trim() === libelle)
    || tous.find((b) => (b.textContent || '').trim().includes(libelle))
    || null;
}

async function cliquer(v, element) {
  await v.act(async () => { element.click(); await new Promise((r) => setTimeout(r, 0)); });
  await v.act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

/** « 100 000 F » tel que l'ecran l'ecrit : espace insecable etroit compris. */
function contientMontant(texte, montant) {
  const attendu = new Intl.NumberFormat('fr-FR').format(montant);
  const nettoyer = (s) => String(s).replace(/[\s  ]/g, '');
  return nettoyer(texte).includes(nettoyer(attendu));
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. Le montant attendu suit l'activite choisie
   ═══════════════════════════════════════════════════════════════════════════ */

test('cloture — la caisse imprimerie n’affiche que les recettes de l’imprimerie', async () => {
  const v = await rendreEcran({
    ecran: 'src/features/cloture-caisse/page.jsx',
    donnees: BASE,
    utilisateur: ADMIN,
  });
  try {
    const t = texteVivant(v);
    // 120 000 (rapport imprimerie) + 10 000 (rapport ancien, donc imprimerie)
    assert.ok(contientMontant(t, 130000), `recettes imprimerie absentes :\n${t.slice(0, 900)}`);
    // Attendu = 130 000 − 20 000 de depenses.
    assert.ok(contientMontant(t, 110000), `caisse attendue imprimerie absente :\n${t.slice(0, 900)}`);
    // Les 45 000 F de la papeterie ne doivent PAS etre dans cette caisse.
    assert.ok(
      !contientMontant(t, 175000),
      'les deux caisses sont additionnees : la separation n’existe pas',
    );
  } finally { await v.demonter(); }
});

test('cloture — basculer sur la papeterie change le montant attendu', async () => {
  const v = await rendreEcran({
    ecran: 'src/features/cloture-caisse/page.jsx',
    donnees: BASE,
    utilisateur: ADMIN,
  });
  try {
    const bPapeterie = bouton(v.conteneur, LIB_PAPETERIE);
    assert.ok(bPapeterie, 'aucun selecteur d’activite sur l’ecran d’encaissement');

    await cliquer(v, bPapeterie);
    const t = texteVivant(v);

    // 30 000 + 15 000 = 45 000 de recettes, 5 000 de depenses → 40 000 attendus.
    assert.ok(contientMontant(t, 45000), `recettes papeterie absentes :\n${t.slice(0, 900)}`);
    assert.ok(contientMontant(t, 40000), `caisse attendue papeterie absente :\n${t.slice(0, 900)}`);
    // Le rapport sans champ `activite` appartient a l'imprimerie : il ne doit
    // pas gonfler la papeterie (45 000 + 10 000 = 55 000).
    assert.ok(
      !contientMontant(t, 55000),
      'un rapport d’avant l’ouverture de la papeterie a ete compte cote papeterie',
    );
  } finally { await v.demonter(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. Cloturer une caisse ne cloture pas l'autre
   ═══════════════════════════════════════════════════════════════════════════ */

test('cloture — l’imprimerie deja cloturee laisse la papeterie a cloturer', async () => {
  const v = await rendreEcran({
    ecran: 'src/features/cloture-caisse/page.jsx',
    donnees: {
      ...BASE,
      clotures_caisse: [{
        id: 'cl-1', date: AUJOURDHUI, activite: 'imprimerie',
        employe_nom: 'Ibrahim', montant_attendu: 110000, montant_reel: 110000,
        ecart: 0, statut: 'ok',
      }],
    },
    utilisateur: ADMIN,
  });
  try {
    // Cote imprimerie : la journee est close, le bouton de cloture disparait.
    assert.equal(
      bouton(v.conteneur, 'Clôturer aujourd\'hui'),
      null,
      'l’imprimerie est deja cloturee : le bouton ne devrait plus s’afficher',
    );

    const bPapeterie = bouton(v.conteneur, LIB_PAPETERIE);
    assert.ok(bPapeterie, 'aucun selecteur d’activite sur l’ecran d’encaissement');
    await cliquer(v, bPapeterie);

    assert.ok(
      bouton(v.conteneur, 'Clôturer aujourd\'hui'),
      'la caisse papeterie passe pour cloturee alors qu’elle n’a jamais ete comptee',
    );
  } finally { await v.demonter(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. Ce qui part en base porte l'activite
   ═══════════════════════════════════════════════════════════════════════════ */

test('cloture — la piece comptable ecrite porte l’activite comptee', async () => {
  const v = await rendreEcran({
    ecran: 'src/features/cloture-caisse/page.jsx',
    donnees: BASE,
    utilisateur: ADMIN,
  });
  try {
    await cliquer(v, bouton(v.conteneur, LIB_PAPETERIE));

    const ouvrir = bouton(v.conteneur, 'Clôturer aujourd\'hui');
    assert.ok(ouvrir, 'bouton de cloture introuvable');
    await cliquer(v, ouvrir);

    const enregistrer = bouton(v.conteneur, 'Enregistrer la clôture');
    assert.ok(enregistrer, 'bouton d’enregistrement introuvable');
    await cliquer(v, enregistrer);

    const ecrites = v.journal.ecritures.filter(
      (e) => e.collection === 'clotures_caisse' && e.operation === 'create',
    );
    assert.equal(ecrites.length, 1, 'une cloture et une seule doit etre ecrite');
    assert.equal(
      ecrites[0].data.activite,
      'papeterie',
      'la cloture ecrite ne dit pas de quelle caisse elle parle',
    );
    assert.equal(
      ecrites[0].data.montant_attendu,
      40000,
      'le montant attendu ecrit n’est pas celui de la papeterie',
    );
  } finally { await v.demonter(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. La vue consolidee reste possible
   ═══════════════════════════════════════════════════════════════════════════ */

test('cloture — « Les deux » additionne les deux caisses, et interdit de compter', async () => {
  const v = await rendreEcran({
    ecran: 'src/features/cloture-caisse/page.jsx',
    donnees: BASE,
    utilisateur: ADMIN,
  });
  try {
    const bLesDeux = bouton(v.conteneur, 'Les deux');
    assert.ok(bLesDeux, 'aucun etat consolide sur le selecteur');
    await cliquer(v, bLesDeux);

    const t = texteVivant(v);
    // 130 000 + 45 000 = 175 000 de recettes ; 25 000 de depenses → 150 000.
    assert.ok(contientMontant(t, 175000), `total consolide absent :\n${t.slice(0, 900)}`);

    // Un comptage physique n'a de sens que dans UN tiroir : on ne doit pas
    // pouvoir cloturer « les deux » a la fois.
    assert.equal(
      bouton(v.conteneur, 'Clôturer aujourd\'hui'),
      null,
      'la vue consolidee ne doit pas permettre de cloturer une caisse fictive',
    );
  } finally { await v.demonter(); }
});
