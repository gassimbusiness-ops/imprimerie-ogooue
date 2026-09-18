/**
 * LES NEUF ECRANS TOUCHES PAR CETTE INTERVENTION, MONTES POUR DE VRAI.
 *
 * ── Pourquoi ce fichier existe ────────────────────────────────────────────
 *
 * Le 14/09/2026, 112 tests unitaires etaient verts et l'application est devenue
 * ENTIEREMENT BLANCHE en production : aucun test ne montait un ecran.
 *
 * Cette intervention a modifie neuf ecrans — huit pour y poser un verrou
 * d'execution, trois pour y corriger une date de fuseau (travaux se recoupe).
 * Six d'entre eux n'avaient AUCUN test de rendu. Un import oublie au niveau du
 * module — exactement la faute commise puis rattrapee sur `cloture-caisse`
 * pendant cette intervention — se manifeste par un ecran blanc, pas par un
 * test unitaire rouge.
 *
 * Trois verdicts par ecran, les memes que `tests/rendu-ecrans.test.mjs` :
 *   1. l'ecran produit du CONTENU (pas un ecran blanc) ;
 *   2. AUCUNE ECRITURE en base pendant le simple affichage ;
 *   3. aucune exception ni rejet non rattrape pendant le montage.
 *
 * Lancer :  node --test tests/rendu-ecrans-argent.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rendreEcran } from './outils/rendu-ecran.mjs';

/** Donnees aux formes de la production, volontairement maigres. */
const BASE = {
  comptes_bancaires: [{ id: 'c1', nom: 'Caisse', solde: 100000 }],
  mouvements_financiers: [], charges_fixes: [], dettes: [], actionnaires: [],
  investissements: [], devis: [], factures: [], clients: [],
  produits: [{ id: 'p1', nom: 'Papier A4', quantite: 10, quantite_minimum: 2 }],
  mouvements_stock: [], projets_travaux: [{ id: 'pr1', nom: 'Chantier papeterie' }],
  etapes_travaux: [], apports_associes: [], dettes_associes: [],
  remboursements_associes: [], investisseurs: [], gouvernance_parametres: [],
  rapports: [], employes: [], commandes: [], pointages: [],
  performances_employes: [], demandes_rh: [], taches: [],
};

const ECRANS = [
  'finances', 'gouvernance', 'devis-factures', 'stocks', 'travaux',
  'cloture-caisse', 'pointage', 'performance-rh', 'demandes-rh',
];

for (const ecran of ECRANS) {
  test(`${ecran} — l’écran se monte, et n’écrit rien en s’affichant`, async () => {
    const v = await rendreEcran({
      ecran: `src/features/${ecran}/page.jsx`,
      donnees: BASE,
      utilisateur: { id: 'u-admin', prenom: 'Gassim', nom: 'Admin', role: 'admin' },
    });
    try {
      assert.ok(v.texte.length > 30, `${ecran} : écran blanc (${v.texte.length} caractères)`);
      assert.deepEqual(v.erreurs.map(String), [], `${ecran} : une exception est partie pendant le montage`);
      assert.deepEqual(v.journal.ecritures, [], `${ecran} : consulter l’écran écrit en base`);
    } finally { await v.demonter(); }
  });
}
