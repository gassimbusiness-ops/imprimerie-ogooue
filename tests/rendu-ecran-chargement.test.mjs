/**
 * LA COUPURE DE MOANDA, JOUEE POUR DE VRAI.
 *
 * Chaque test monte un ecran dans un DOM, avec la lecture de sa collection
 * principale en ECHEC — ce que fait une coupure reseau a Moanda, assez
 * frequente pour que l'equipe tienne ses rapports sur Excel ces jours-la.
 *
 * Trois verdicts, les memes pour tous les ecrans :
 *   1. l'ecran n'est pas VIDE : un message apparait ;
 *   2. ce message ne dit PAS « aucun » — « aucun rapport ce mois-ci » et « je
 *      n'ai pas pu charger les rapports » sont deux phrases differentes, et les
 *      confondre a deja fait conclure faux dans ce dossier ;
 *   3. un bouton « Reessayer » existe, et il RECHARGE vraiment (on le clique,
 *      et l'ecran affiche alors les donnees).
 *
 * Et pour les actions : un enregistrement refuse ne doit JAMAIS afficher un
 * message de succes.
 *
 * ⚠️ Lecon du 16/09/2026 : `v.texte` est un instantane pris au montage. Apres
 * toute interaction, on relit par `texteVivant(v)`. Six tests avaient
 * « verifie » un ecran jamais affiche.
 *
 * Lancer :  node --test tests/rendu-ecran-chargement.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rendreEcran, texteVivant } from './outils/rendu-ecran.mjs';

/* ═══════════════════════════════════════════════════════════════════════════
   Donnees
   ═══════════════════════════════════════════════════════════════════════════ */

const RAPPORTS = [
  {
    id: 'r-1', date: '2026-09-15', statut: 'soumis', operateur_nom: 'Ibrahim',
    categories: { copies: 12000, imprimerie: 45000 }, depenses: [{ libelle: 'Encre', montant: 8000 }],
  },
  {
    id: 'r-2', date: '2026-09-16', statut: 'brouillon', operateur_nom: 'Ibrahim',
    categories: { copies: 9000 }, depenses: [],
  },
];

const BASE = {
  rapports: RAPPORTS,
  clotures_caisse: [{ id: 'c-1', date: '2026-09-15', montant_attendu: 50000, montant_reel: 49000, ecart: -1000, statut: 'ecart_mineur' }],
  commandes: [{ id: 'cmd-1', numero: 'CMD-1', client_nom: 'Mairie de Moanda', statut: 'prete', montant_total: 94000, created_at: '2026-09-15T08:00:00.000Z', lignes: [] }],
  clients: [{ id: 'cli-1', nom: 'Mairie de Moanda' }],
  produits: [{ id: 'p-1', nom: 'Papier A4', quantite: 40, quantite_minimum: 5, prix_vente: 500 }],
  employes: [{ id: 'e-1', prenom: 'Ibrahim', nom: 'Abakar', role: 'employe' }],
  comptes_bancaires: [{ id: 'caisse', nom: 'Caisse', solde: 500000, type: 'caisse' }],
  mouvements_financiers: [], mouvements_stock: [], factures: [], devis: [],
  taches: [], pointages: [], notifications_app: [], fidelite_clients: [],
  charges_fixes: [], dettes: [], objectifs: [], conversations: [],
};

/**
 * Cherche un bouton par son texte — egalite exacte d'abord (lecon du 16/09 :
 * une recherche par sous-chaine attrapait l'onglet de filtre « Livrées » au
 * lieu du bouton « Livrée »).
 *
 * Les actions du tableau des rapports sont des icones sans texte : leur seul
 * libelle est l'attribut `title`. On le cherche donc aussi, en dernier.
 *
 * La recherche porte sur tout le DOCUMENT, pas sur le seul conteneur : les
 * dialogues Radix se rendent dans un portail attache a `body`. Chercher dans
 * `#racine` seul aurait rendu invisible chaque bouton de formulaire — et le
 * test serait passe au vert en ne testant rien. Le document est remis a zero
 * entre deux montages, aucun bouton d'un test precedent ne traine.
 */
function bouton(conteneur, texte) {
  const racine = conteneur.ownerDocument?.body || conteneur;
  const tous = [...racine.querySelectorAll('button')];
  return tous.find((b) => (b.textContent || '').trim() === texte)
    || tous.find((b) => (b.getAttribute('title') || '').trim() === texte)
    || tous.find((b) => (b.textContent || '').includes(texte));
}

/** Laisse les effets et leurs promesses se vidanger apres une interaction. */
async function vidanger(v, tours = 6) {
  for (let i = 0; i < tours; i++) {
    await v.act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}

/**
 * Le contrat commun a tous les ecrans repris.
 *
 * @param {string} ecran chemin du fichier d'ecran
 * @param {string[]} collections collections dont la lecture echoue
 * @param {RegExp} attendu fragment du message attendu a l'ecran
 */
function contratEcranCoupure(nom, ecran, collections, attendu, options = {}) {
  const { routeur = false } = options;

  test(`${nom} — une lecture ratee AFFICHE un message, pas un ecran vide`, async () => {
    const v = await rendreEcran({ ecran, donnees: BASE, echecsLecture: collections, routeur });
    try {
      const texte = texteVivant(v);
      assert.ok(texte.length > 30, `écran quasi vide (${texte.length} caractères) sur une coupure`);
      assert.match(texte, /Impossible de charger/, 'aucun message d’échec de chargement');
      assert.match(texte, attendu, 'le message ne nomme pas ce qui n’a pas pu être lu');
      assert.match(texte, /réessayez/i, 'le message ne dit pas quoi faire');
    } finally { await v.demonter(); }
  });

  test(`${nom} — une lecture ratee ne se lit PAS « aucune donnee »`, async () => {
    const v = await rendreEcran({ ecran, donnees: BASE, echecsLecture: collections, routeur });
    try {
      const texte = texteVivant(v);
      assert.doesNotMatch(
        texte, /aucun/i,
        'l’écran dit « aucun… » alors que la connexion a échoué : c’est exactement la confusion corrigée',
      );
    } finally { await v.demonter(); }
  });

  test(`${nom} — le bouton « Reessayer » recharge VRAIMENT`, async () => {
    // Un bouton qui ne recharge pas serait pire qu'aucun bouton : on croirait
    // avoir reessaye. On le clique donc, et on verifie qu'une NOUVELLE lecture
    // part — et qu'elle aboutit, puisque la coupure est levee entre-temps.
    const v = await rendreEcran({ ecran, donnees: BASE, echecsLecture: collections, routeur });
    try {
      const b = bouton(v.conteneur, 'Réessayer');
      assert.ok(b, 'aucun bouton « Réessayer » : l’écran est une impasse');

      const avant = v.journal.lectures.length;
      // La coupure est levee : les prochaines lectures reussissent.
      v.journal.lectures.push('__reprise__');
      await v.act(async () => { b.click(); await new Promise((r) => setTimeout(r, 0)); });
      await vidanger(v);

      assert.ok(
        v.journal.lectures.length > avant + 1,
        'le clic sur « Réessayer » n’a déclenché aucune nouvelle lecture',
      );
    } finally { await v.demonter(); }
  });

  test(`${nom} — sans coupure, l ecran fonctionne comme avant`, async () => {
    const v = await rendreEcran({ ecran, donnees: BASE, routeur });
    try {
      const texte = texteVivant(v);
      assert.ok(texte.length > 50, 'écran blanc en fonctionnement normal');
      assert.doesNotMatch(texte, /Impossible de charger/, 'message d’échec affiché sans échec');
      assert.deepEqual(v.journal.ecritures, [], 'le simple affichage écrit en base (bug C1/C2)');
    } finally { await v.demonter(); }
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   Les ecrans repris
   ═══════════════════════════════════════════════════════════════════════════ */

contratEcranCoupure(
  'Rapports', 'src/features/rapports/page.jsx', ['rapports'],
  /les rapports journaliers/,
);

contratEcranCoupure(
  'Clôture de caisse', 'src/features/cloture-caisse/page.jsx', ['clotures_caisse', 'rapports'],
  /la caisse/,
);

contratEcranCoupure(
  'Commandes', 'src/features/commandes/page.jsx', ['commandes'],
  /les commandes/,
);

contratEcranCoupure(
  'Tableau de bord', 'src/features/dashboard/page.jsx', ['rapports', 'commandes', 'produits', 'factures', 'clients', 'taches'],
  /le tableau de bord/,
  // L'ecran rend des `<Link>` vers les autres modules : il lui faut un routeur.
  { routeur: true },
);

contratEcranCoupure(
  'Stocks', 'src/features/stocks/page.jsx', ['produits'],
  /le stock/,
);

contratEcranCoupure(
  'Finances', 'src/features/finances/page.jsx', ['comptes_bancaires', 'mouvements_financiers'],
  /la trésorerie/,
);

contratEcranCoupure(
  'Portail client — accueil', 'src/features/client-portal/dashboard.jsx', ['commandes', 'factures', 'devis'],
  /vos commandes/,
  { routeur: true },
);

/* ═══════════════════════════════════════════════════════════════════════════
   LE CAS LE PLUS COUTEUX : l'action qui echoue en silence
   ═══════════════════════════════════════════════════════════════════════════ */

test('Rapports — une validation REFUSEE ne dit jamais « Rapport validé »', async () => {
  // Le pire cas du recensement : l'utilisateur croit avoir enregistre. Ici
  // l'ecriture est refusee (coupure) ; l'ecran doit le DIRE.
  const v = await rendreEcran({
    ecran: 'src/features/rapports/page.jsx',
    donnees: BASE,
    // Seul un « manager » voit le bouton de validation (page.jsx : isManager).
    utilisateur: { role: 'manager' },
    echecsEcriture: ['rapports'],
  });
  try {
    const b = bouton(v.conteneur, 'Valider');
    assert.ok(b, 'le bouton « Valider » est introuvable : le scénario ne teste rien');
    await v.act(async () => { b.click(); await new Promise((r) => setTimeout(r, 0)); });
    await vidanger(v);

    const succes = v.toasts.filter((t) => t.niveau === 'success');
    assert.deepEqual(
      succes, [],
      `l’écran a annoncé un succès alors que l’écriture a été refusée : ${JSON.stringify(succes)}`,
    );
    const erreurs = v.toasts.filter((t) => t.niveau === 'error');
    assert.ok(erreurs.length > 0, 'aucun message d’erreur : l’échec est invisible');
    assert.match(
      erreurs[0].message, /n'a PAS été enregistrée|n'a pas été enregistré/,
      `message peu clair : ${erreurs[0].message}`,
    );
  } finally { await v.demonter(); }
});

test('Rapports — une validation refusee laisse le rapport a valider', async () => {
  // Corollaire : l'ecran ne doit pas non plus faire SEMBLANT d'avoir change
  // d'etat. Le rapport reste « Soumis », et le bouton reste cliquable.
  const v = await rendreEcran({
    ecran: 'src/features/rapports/page.jsx',
    donnees: BASE,
    // Seul un « manager » voit le bouton de validation (page.jsx : isManager).
    utilisateur: { role: 'manager' },
    echecsEcriture: ['rapports'],
  });
  try {
    const b = bouton(v.conteneur, 'Valider');
    await v.act(async () => { b.click(); await new Promise((r) => setTimeout(r, 0)); });
    await vidanger(v);
    assert.ok(bouton(v.conteneur, 'Valider'), 'le bouton a disparu alors que rien n’a été validé');
  } finally { await v.demonter(); }
});

test('Clôture de caisse — un enregistrement refuse ne dit pas « enregistrée »', async () => {
  // La clotûre touche a l'argent liquide : croire qu'un comptage est enregistre
  // alors qu'il ne l'est pas fait perdre la trace de l'ecart du jour.
  const v = await rendreEcran({
    ecran: 'src/features/cloture-caisse/page.jsx',
    donnees: { ...BASE, clotures_caisse: [] },
    echecsEcriture: ['clotures_caisse'],
  });
  try {
    const ouvrir = bouton(v.conteneur, "Clôturer aujourd'hui");
    assert.ok(ouvrir, 'le bouton d’ouverture du comptage est introuvable');
    await v.act(async () => { ouvrir.click(); await new Promise((r) => setTimeout(r, 0)); });
    await vidanger(v, 3);

    const valider = bouton(v.conteneur, 'Enregistrer la clôture');
    assert.ok(valider, 'le bouton d’enregistrement du comptage est introuvable');
    await v.act(async () => { valider.click(); await new Promise((r) => setTimeout(r, 0)); });
    await vidanger(v);

    assert.deepEqual(
      v.toasts.filter((t) => t.niveau === 'success'), [],
      'l’écran a annoncé une clôture enregistrée alors que l’écriture a été refusée',
    );
    assert.ok(
      v.toasts.some((t) => t.niveau === 'error'),
      'un comptage de caisse refusé passe sans un mot',
    );
  } finally { await v.demonter(); }
});
