/**
 * LA LEÇON DU 14/09/2026, APPLIQUEE.
 *
 * Ce jour-la, 112 tests unitaires etaient verts et l'application est devenue
 * ENTIEREMENT BLANCHE en production. Les tests unitaires ne suffisent pas :
 * aucun d'eux ne montait un ecran.
 *
 * Ici, les ecrans touches par cette intervention sont montes POUR DE VRAI dans
 * un DOM (jsdom), avec leurs effets executes et des donnees AUX FORMES REELLES
 * DE LA PRODUCTION — les 5 commandes du portail relevees en base le 16/09/2026,
 * avec leurs deux schemas de ligne incompatibles et leurs champs absents.
 *
 * Trois verdicts par ecran :
 *   1. l'ecran produit du CONTENU (pas un ecran blanc) ;
 *   2. AUCUNE ECRITURE en base pendant le simple affichage (bug de reference
 *      C1/C2 : consulter un ecran modifiait la base) ;
 *   3. aucune exception ni rejet non rattrape pendant le montage.
 *
 * Et, pour la commande, le test qui compte vraiment : DEUX clics sur « Livrée »
 * ne doivent produire qu'UN encaissement.
 *
 * Lancer :  node --test tests/rendu-ecrans.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rendreEcran } from './outils/rendu-ecran.mjs';

/* ═══════════════════════════════════════════════════════════════════════════
   Donnees aux formes REELLES de la production (relevees le 16/09/2026)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Les 5 commandes reellement en base : aucune n'a de `date`, une seule a un `numero`. */
const COMMANDES_PRODUCTION = [
  {
    id: 'a0dba831-7fe0-4a7f-9217-6d068cf1bb2e', client_nom: 'Client test',
    statut: 'en_production', source: 'portail_client', montant_total: 4500,
    client_id: 'user-1', created_at: '2026-05-31T19:08:32.760Z',
    // Schema du portail : `nom`/`qte`/`prix` — et non `description`/`quantite`/`prix_unitaire`
    lignes: [{ nom: 'Mug Simple', qte: 1, prix: 4500, produit_id: 'p-mug' }],
  },
  {
    id: '958236b1-d390-4695-8d80-e50c875e8c2f', client_nom: 'Ibrahim Abakar',
    statut: 'validee_attente_paiement', source: 'portail_client', montant_total: 4500,
    client_id: 'user-2', created_at: '2026-05-31T20:29:51.020Z',
    lignes: [{ nom: 'Tee-shirt blanc KAF enfant', qte: 1, prix: 4500 }],
  },
  {
    id: 'fe560e2f-2e9c-4b79-88cb-21f808e20f43', client_nom: 'Opérateur Acceuil',
    statut: 'validee_attente_paiement', source: 'portail_client', montant_total: 4500,
    client_id: 'user-3', created_at: '2026-05-31T21:39:45.389Z', lignes: [],
  },
  {
    id: '93d2470f-c29d-466c-bf5c-4848f1041dd6', client_nom: 'Client test',
    statut: 'validee_attente_paiement', source: 'portail_client', montant_total: 7000,
    client_id: 'user-1', created_at: '2026-05-31T22:00:20.276Z',
    lignes: [{ nom: 'Polo blanc', qte: 1, prix: 7000 }],
  },
  {
    id: 'a4f8532c-1db0-419c-8564-4939701faac2', numero: 'CMD-9IH68Q',
    client_nom: 'Client test', statut: 'annulee', source: 'portail_client',
    montant_total: 2000, client_id: 'user-1', created_at: '2026-06-11T13:06:20.762Z',
    lignes: [{ nom: 'Papier autocollant', qte: 1, prix: 2000 }],
  },
];

/** Une commande PRETE : le seul etat depuis lequel le bouton « Livrée » existe. */
const COMMANDE_PRETE = {
  id: 'cmd-prete', numero: 'CMD-REEL1', client_nom: 'Mairie de Moanda',
  client_id: 'user-9', statut: 'prete', montant_total: 94000,
  created_at: '2026-09-15T08:00:00.000Z',
  lignes: [{ description: 'Bâche 3m × 2m', quantite: 2, prix_unitaire: 47000 }],
};

const BASE_COMPLETE = {
  commandes: [...COMMANDES_PRODUCTION, COMMANDE_PRETE],
  clients: [{ id: 'cli-1', nom: 'Mairie de Moanda', user_id: 'user-9' }],
  employes: [{ id: 'e1', prenom: 'Ibrahim', nom: 'Abakar', role: 'employe' }],
  comptes_bancaires: [{ id: 'caisse', nom: 'Caisse', solde: 500000 }],
  produits: [{ id: 'p-bache', nom: 'Bâche 3m × 2m', quantite: 40, quantite_minimum: 5 }],
  mouvements_financiers: [], mouvements_stock: [], factures: [],
  fidelite_clients: [], taches: [], rapports: [], conversations: [],
};

/**
 * Cherche un bouton par son texte.
 *
 * L'egalite EXACTE d'abord : l'onglet de filtre « Livrées » contient « Livrée »,
 * et c'est lui qu'une recherche par sous-chaine attrapait — le test cliquait
 * alors sur un filtre en croyant livrer une commande, et passait au vert sans
 * rien verifier.
 */
function bouton(conteneur, texte) {
  const tous = [...conteneur.querySelectorAll('button')];
  return tous.find((b) => (b.textContent || '').trim() === texte)
    || tous.find((b) => (b.textContent || '').includes(texte));
}

/* ═══════════════════════════════════════════════════════════════════════════
   Ecran Commandes
   ═══════════════════════════════════════════════════════════════════════════ */

test('Commandes — l ecran s affiche avec les donnees reelles de production', async () => {
  const v = await rendreEcran({ ecran: 'src/features/commandes/page.jsx', donnees: BASE_COMPLETE });
  try {
    assert.ok(v.texte.length > 50, `écran quasi vide (${v.texte.length} caractères) : écran blanc`);
    assert.match(v.texte, /Commandes/);
    assert.match(v.texte, /Mairie de Moanda/, 'les commandes en base ne sont pas rendues');
    assert.deepEqual(v.erreurs.map(String), [], 'une exception est partie pendant le montage');
  } finally { await v.demonter(); }
});

test('Commandes — AUCUNE ecriture en base pendant le simple affichage', async () => {
  const v = await rendreEcran({ ecran: 'src/features/commandes/page.jsx', donnees: BASE_COMPLETE });
  try {
    assert.deepEqual(
      v.journal.ecritures, [],
      'consulter l’écran Commandes écrit en base — c’est le bug de référence C1/C2',
    );
    assert.ok(v.journal.lectures.includes('commandes'), 'l’écran doit tout de même lire ses données');
  } finally { await v.demonter(); }
});

test('Commandes — une base VIDE ne blanchit pas l ecran', async () => {
  const v = await rendreEcran({ ecran: 'src/features/commandes/page.jsx', donnees: {} });
  try {
    assert.ok(v.texte.length > 50, 'écran blanc sur une base vide');
    assert.match(v.texte, /Aucune commande/);
    assert.deepEqual(v.journal.ecritures, []);
  } finally { await v.demonter(); }
});

test('Commandes — des donnees ABIMEES ne blanchissent pas l ecran', async () => {
  // Ce que la base peut reellement contenir apres cinq versions du schema.
  const v = await rendreEcran({
    ecran: 'src/features/commandes/page.jsx',
    donnees: {
      commandes: [
        { id: '1' },
        { id: '2', statut: 'statut_inconnu', lignes: null, montant_total: 'texte' },
        { id: '3', client_nom: null, created_at: null, lignes: [{}] },
        { id: '4', statut: 'livre', livraison_traitee: 'oui' },
      ],
      clients: [{ id: null }], employes: [{}],
    },
  });
  try {
    assert.ok(v.texte.length > 50, 'écran blanc sur des données abîmées');
    assert.deepEqual(v.erreurs.map(String), []);
    assert.deepEqual(v.journal.ecritures, []);
  } finally { await v.demonter(); }
});

/* ══ LE TEST QUI COMPTE : le double-clic sur « Livrée » ══ */

test('Commandes — DEUX clics sur « Livrée » ne produisent QU UN encaissement', async () => {
  const v = await rendreEcran({
    ecran: 'src/features/commandes/page.jsx',
    donnees: { ...BASE_COMPLETE, commandes: [COMMANDE_PRETE] },
  });
  try {
    const b = bouton(v.conteneur, 'Livrée');
    assert.ok(b, 'le bouton « Livrée » est introuvable : le scénario ne teste rien');

    // Deux clics dans le meme tour, comme un double-clic reel sur une
    // connexion lente. Avant le correctif : CA compte deux fois, stock sorti
    // deux fois, points doubles, double entree de tresorerie (constat 8a.1).
    await v.act(async () => {
      b.click();
      b.click();
      await new Promise((r) => setTimeout(r, 0));
    });
    for (let i = 0; i < 6; i++) {
      await v.act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    }

    const encaissements = v.journal.ecritures.filter(
      (e) => e.collection === 'mouvements_financiers' && e.operation === 'create',
    );
    assert.equal(encaissements.length, 1, `${encaissements.length} encaissements écrits au lieu d’un`);

    const factures = v.journal.ecritures.filter(
      (e) => e.collection === 'factures' && e.operation === 'create',
    );
    assert.equal(factures.length, 1, `${factures.length} factures émises au lieu d’une`);

    const sortiesStock = v.journal.ecritures.filter(
      (e) => e.collection === 'mouvements_stock' && e.operation === 'create',
    );
    assert.ok(sortiesStock.length <= 1, `${sortiesStock.length} sorties de stock au lieu d’une au plus`);
  } finally { await v.demonter(); }
});

test('Commandes — la livraison n ecrit PAS dans le rapport journalier', async () => {
  // Le rapport journalier est saisi a la main par Ibrahim. La reprise
  // automatique doublait donc le montant (voir src/services/reprise-rapport.js
  // et le rapport du 2026-03-16 mesure en base).
  const v = await rendreEcran({
    ecran: 'src/features/commandes/page.jsx',
    donnees: {
      ...BASE_COMPLETE,
      commandes: [COMMANDE_PRETE],
      rapports: [{ id: 'r1', date: '2026-09-16', categories: { imprimerie: 5000 } }],
    },
  });
  try {
    const b = bouton(v.conteneur, 'Livrée');
    assert.ok(b);
    await v.act(async () => { b.click(); await new Promise((r) => setTimeout(r, 0)); });
    for (let i = 0; i < 6; i++) {
      await v.act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    }
    const ecrituresRapport = v.journal.ecritures.filter((e) => e.collection === 'rapports');
    assert.deepEqual(
      ecrituresRapport, [],
      'la livraison a modifié un rapport journalier : le montant sera compté deux fois',
    );
  } finally { await v.demonter(); }
});

test('Commandes — la facture generee garde la QUANTITE reelle', async () => {
  // Constat E7/6.5 : une commande de 500 flyers était facturée « 1 × ».
  const v = await rendreEcran({
    ecran: 'src/features/commandes/page.jsx',
    donnees: {
      ...BASE_COMPLETE,
      commandes: [{
        ...COMMANDE_PRETE, id: 'cmd-portail',
        // Schema du portail : `nom`/`qte`/`prix`
        lignes: [{ nom: 'Flyers A5', qte: 500, prix: 200 }],
        montant_total: 100000,
      }],
    },
  });
  try {
    const b = bouton(v.conteneur, 'Livrée');
    assert.ok(b);
    await v.act(async () => { b.click(); await new Promise((r) => setTimeout(r, 0)); });
    for (let i = 0; i < 6; i++) {
      await v.act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    }
    const facture = v.journal.ecritures.find(
      (e) => e.collection === 'factures' && e.operation === 'create',
    );
    assert.ok(facture, 'aucune facture générée');
    assert.equal(facture.data.lignes[0].quantite, 500, 'quantité perdue sur la facture');
    assert.equal(facture.data.lignes[0].prix_unitaire, 200, 'prix unitaire perdu sur la facture');
    assert.equal(facture.data.total, 100000, '`total` absent : le CA par client resterait à 0 F');
  } finally { await v.demonter(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   Ecran Connexion / Inscription
   ═══════════════════════════════════════════════════════════════════════════ */

test('Connexion — l ecran s affiche et n ecrit rien', async () => {
  const v = await rendreEcran({ ecran: 'src/features/login/page.jsx', donnees: {} });
  try {
    assert.ok(v.texte.length > 50, 'écran de connexion blanc');
    assert.match(v.texte, /Imprimerie Ogooué/);
    assert.deepEqual(v.journal.ecritures, [], "l'écran de connexion écrit en base au montage");
    assert.deepEqual(v.erreurs.map(String), []);
  } finally { await v.demonter(); }
});

test('Connexion — le formulaire d inscription s ouvre, champ parrainage compris', async () => {
  const v = await rendreEcran({ ecran: 'src/features/login/page.jsx', donnees: {} });
  try {
    const b = bouton(v.conteneur, 'Créer mon compte client');
    assert.ok(b, 'le bouton d’ouverture de l’inscription est introuvable');
    await v.act(async () => { b.click(); await new Promise((r) => setTimeout(r, 0)); });
    // `v.texte` est l'instantané du montage : après une interaction, on relit
    // le conteneur, sinon on affirme sur un écran qui n'existe plus.
    const apres = v.conteneur.textContent || '';
    assert.match(apres, /[Pp]arrainage/, 'le champ code de parrainage a disparu de l’écran');
    assert.match(apres, /Créer mon compte/, 'le formulaire d’inscription ne s’est pas ouvert');
    assert.deepEqual(v.erreurs.map(String), []);
    assert.deepEqual(v.journal.ecritures, [], 'ouvrir le formulaire ne doit rien écrire');
  } finally { await v.demonter(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   Ecrans touches par la correction des messages d erreur IA
   ═══════════════════════════════════════════════════════════════════════════ */

for (const [nom, chemin, donnees] of [
  ['Rapports', 'src/features/rapports/page.jsx', { rapports: [], employes: [] }],
  ['Rapports & Analyses', 'src/features/rapports-analyses/page.jsx', {
    rapports: [{ id: 'r1', date: '2026-09-15', categories: { imprimerie: 50000 }, depenses: [] }],
    commandes: COMMANDES_PRODUCTION, clients: [],
  }],
  ['Messagerie', 'src/features/messagerie/page.jsx', { conversations: [], messages_conv: [], clients: [] }],
  ['Gouvernance', 'src/features/gouvernance/page.jsx', {}],
  ['Demandes RH', 'src/features/demandes-rh/page.jsx', {
    demandes_rh: [
      { id: 'd1', category: 'charge', type: 'loyer', montant: 95000, statut: 'approuve', motif: 'Loyer' },
      { id: 'd2', category: 'charge', type: 'charge_autre', montant: 50000, statut: 'approuve', motif: 'Divers' },
    ],
    comptes_bancaires: [{ id: 'caisse', nom: 'Caisse', solde: 500000 }], employes: [],
  }],
]) {
  test(`${nom} — s affiche sans exception et sans ecrire en base`, async () => {
    const v = await rendreEcran({ ecran: chemin, donnees });
    try {
      assert.ok(v.texte.length > 30, `${nom} : écran blanc (${v.texte.length} caractères)`);
      assert.deepEqual(v.erreurs.map(String), [], `${nom} : exception pendant le montage`);
      assert.deepEqual(v.journal.ecritures, [], `${nom} : écriture en base pendant l’affichage`);
    } finally { await v.demonter(); }
  });
}
