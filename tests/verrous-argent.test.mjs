/**
 * LES HUIT BOUTONS QUI ECRIVENT DE L'ARGENT.
 *
 * Le defaut : huit boutons declenchaient une ecriture d'argent sans aucun
 * verrou. Un double clic — ou deux onglets, ou le double montage de
 * React.StrictMode — suffisait a produire un double remboursement de dette,
 * une double sortie de caisse, une double facture portant le MEME numero, une
 * double sortie de stock, ou une recompense de fidelite offerte deux fois.
 *
 * Le patron etait deja en place dans l'ecran Commandes
 * (`src/features/commandes/page.jsx:92`, `verrouCommande`). Ces huit boutons
 * appliquent LE MEME, avec l'utilitaire partage `src/services/execution-unique.js`.
 *
 * ⚠️ CE QUE CES TESTS EXIGENT, ET POURQUOI
 *
 * Un bouton grise ne suffit pas. `disabled` est une propriete du RENDU : entre
 * le premier clic et le re-rendu qui grise le bouton, un second clic est deja
 * parti. La garde doit etre DANS LA FONCTION. C'est ce que verifie la section 1,
 * handler par handler : le tout premier geste du handler doit etre la prise du
 * verrou, avant tout `await`.
 *
 * La section 2 le prouve pour de vrai, sur le seul des huit boutons qui soit
 * directement cliquable sans passer par un formulaire : « Réclamer » du
 * programme de fidelite. Deux clics, sans attendre entre les deux : une seule
 * ecriture en base.
 *
 * Lancer :  node --test tests/verrous-argent.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { creerVerrouExecution } from '../src/services/execution-unique.js';
import { rendreEcran, texteVivant } from './outils/rendu-ecran.mjs';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const lire = (chemin) => readFileSync(`${RACINE}${chemin}`, 'utf8');

/**
 * Les huit boutons d'argent, tels que releves dans le document 33 (§2.3 n°3).
 * `verrou` : le nom du verrou attendu ; `handler` : la fonction appelee par le
 * bouton ; `etat` : l'etat qui grise le bouton pendant l'execution.
 */
const BOUTONS_ARGENT = [
  { quoi: 'remboursement de dette / mouvement financier', fichier: 'src/features/finances/page.jsx', verrou: 'verrouFinances', handler: 'handleSave', etat: 'enregistrementEnCours' },
  { quoi: 'remboursement de la dette associé', fichier: 'src/features/gouvernance/page.jsx', verrou: 'verrouGouvernance', handler: 'handleAddRemboursement', etat: 'remboursementEnCours' },
  { quoi: 'clôture de caisse', fichier: 'src/features/cloture-caisse/page.jsx', verrou: 'verrouCloture', handler: 'handleSubmit', etat: 'clotureEnCours' },
  { quoi: 'conversion devis → facture', fichier: 'src/features/devis-factures/page.jsx', verrou: 'verrouDevis', handler: 'handleConvertToFacture', etat: 'conversionEnCours' },
  { quoi: 'mouvement de stock', fichier: 'src/features/stocks/page.jsx', verrou: 'verrouStock', handler: 'handleMouvement', etat: 'mouvementEnCours' },
  { quoi: 'enregistrement d’un projet de travaux', fichier: 'src/features/travaux/page.jsx', verrou: 'verrouProjet', handler: 'handleSaveProjet', etat: 'projetEnCours' },
  { quoi: 'étape de travaux payée (sortie de caisse)', fichier: 'src/features/travaux/page.jsx', verrou: 'verrouEtape', handler: 'handleSaveEtape', etat: 'etapeEnCours' },
  { quoi: 'récompense de fidélité réclamée', fichier: 'src/features/client-portal/fidelite.jsx', verrou: 'verrouFidelite', handler: 'handleReclamer', etat: 'reclamationEnCours' },
];

/* ═══════════════════════════════════════════════════════════════════════════
   1. La garde est DANS la fonction — un par bouton
   ═══════════════════════════════════════════════════════════════════════════ */

for (const b of BOUTONS_ARGENT) {
  test(`${b.quoi} — le verrou est pris AVANT le premier await`, () => {
    const src = lire(b.fichier);

    // (a) le verrou existe, et vit hors du composant : un remontage ne doit
    //     pas le reinitialiser, sinon il ne protege rien.
    assert.ok(
      src.includes(`\nconst ${b.verrou} = creerVerrouExecution();`),
      `${b.fichier} : ${b.verrou} n’est pas créé au niveau du module`,
    );
    assert.ok(
      src.includes("from '@/services/execution-unique'"),
      `${b.fichier} : l’utilitaire partagé execution-unique n’est pas importé`,
    );

    // (b) la premiere chose que fait le handler est de prendre le verrou.
    //     Les commentaires sont retires : ils n'executent rien, et les compter
    //     comme du code ferait echouer le test sur une explication un peu longue.
    const debut = src.indexOf(`const ${b.handler} = `);
    assert.ok(debut > -1, `${b.fichier} : ${b.handler} introuvable`);
    const entete = src.slice(debut, debut + 900).replace(/\/\/[^\n]*/g, '');
    const posVerrou = entete.indexOf(`${b.verrou}.executerUneSeuleFois(`);
    assert.ok(
      posVerrou > -1 && posVerrou < 240,
      `${b.fichier} : ${b.handler} n’est pas enveloppé par ${b.verrou} dès son ouverture — `
      + 'un double appel écrira deux fois, quel que soit l’état du bouton',
    );
    // Aucun `await` ne doit preceder la prise du verrou : ce serait une fenetre
    // de course, exactement celle que le verrou est cense fermer.
    const posAwait = entete.indexOf('await ');
    assert.ok(
      posAwait === -1 || posAwait > posVerrou,
      `${b.fichier} : ${b.handler} attend quelque chose AVANT de prendre le verrou`,
    );
  });

  test(`${b.quoi} — le bouton est grisé pendant l’exécution`, () => {
    const src = lire(b.fichier);
    assert.ok(
      src.includes(`disabled={${b.etat}`) || src.includes(`|| ${b.etat}}`)
      || src.includes(`${b.etat} === `),
      `${b.fichier} : aucun bouton n’est grisé par ${b.etat}`,
    );
    assert.ok(
      src.includes(`set${b.etat[0].toUpperCase()}${b.etat.slice(1)}(`),
      `${b.fichier} : ${b.etat} n’est jamais mis à jour`,
    );
  });
}

test('les huit boutons d’argent sont bien huit, et tous couverts', () => {
  assert.equal(BOUTONS_ARGENT.length, 8);
  const fichiers = new Set(BOUTONS_ARGENT.map((b) => b.fichier));
  assert.equal(fichiers.size, 7, 'travaux porte deux boutons, les six autres écrans un chacun');
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. POUR DE VRAI — deux clics sans attendre, une seule écriture
   ═══════════════════════════════════════════════════════════════════════════ */

const FIDELITE_CLIENT = {
  id: 'fid-1',
  client_id: 'u-client',
  points_actuels: 600,
  total_points_gagnes: 600,
  niveau: 'argent',
  code_parrainage: 'OGO-XYZ',
  historique: [],
};

test('fidélité — DEUX clics sur « Réclamer » ne débitent les points qu’UNE fois', async () => {
  const v = await rendreEcran({
    ecran: 'src/features/client-portal/fidelite.jsx',
    utilisateur: { id: 'u-client', prenom: 'Awa', nom: 'Client', role: 'client' },
    donnees: { fidelite_clients: [FIDELITE_CLIENT] },
  });
  try {
    const boutons = [...v.conteneur.querySelectorAll('button')]
      .filter((b) => (b.textContent || '').trim() === 'Réclamer');
    assert.ok(boutons.length > 0, 'aucun bouton « Réclamer » affiché — le test ne prouverait rien');
    assert.deepEqual(v.journal.ecritures, [], 'le simple affichage ne doit rien écrire');

    // LES DEUX CLICS PARTENT AVANT TOUT RE-RENDU : c'est le double-clic reel.
    // Les griser entre les deux est justement ce que le DOM n'a pas le temps
    // de faire.
    await v.act(async () => {
      boutons[0].click();
      boutons[0].click();
      await new Promise((r) => setTimeout(r, 0));
    });
    for (let i = 0; i < 3; i++) {
      await v.act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    }

    const debits = v.journal.ecritures.filter(
      (e) => e.collection === 'fidelite_clients' && e.operation === 'update',
    );
    assert.equal(
      debits.length, 1,
      `${debits.length} débits de points pour un double clic — la récompense est offerte deux fois`,
    );
    // Et le solde debite l'est d'UNE seule recompense (600 − 200 = 400).
    assert.equal(debits[0].data.points_actuels, 400, 'le solde de points après un seul débit');
    assert.equal(debits[0].data.historique.length, 1, 'une seule ligne d’historique');
    assert.ok(texteVivant(v).includes('400'), 'l’écran doit montrer le solde réellement débité');
  } finally { await v.demonter(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. Le mécanisme lui-même — deux appels concurrents, une exécution
   ═══════════════════════════════════════════════════════════════════════════ */

test('execution-unique — deux appels concurrents n’exécutent l’opération qu’une fois', async () => {
  const verrou = creerVerrouExecution();
  let executions = 0;
  const operation = async () => {
    executions += 1;
    await new Promise((r) => setTimeout(r, 20)); // la fenêtre de course
    return executions;
  };
  // Aucun `await` entre les deux : c'est le double clic.
  const a = verrou.executerUneSeuleFois('cle', operation);
  const b = verrou.executerUneSeuleFois('cle', operation);
  assert.equal(verrou.enCours('cle'), true);
  assert.deepEqual(await Promise.all([a, b]), [1, 1], 'les deux appelants voient LE MÊME résultat');
  assert.equal(executions, 1, 'l’opération a tourné deux fois');
  assert.equal(verrou.enCours('cle'), false, 'le verrou doit être rendu après l’exécution');
});

test('execution-unique — deux clés différentes ne se bloquent pas', async () => {
  const verrou = creerVerrouExecution();
  let executions = 0;
  const op = async () => { executions += 1; await new Promise((r) => setTimeout(r, 5)); };
  await Promise.all([
    verrou.executerUneSeuleFois('a', op),
    verrou.executerUneSeuleFois('b', op),
  ]);
  assert.equal(executions, 2, 'deux opérations distinctes doivent toutes deux avoir lieu');
});

test('execution-unique — un échec rend le verrou, la reprise reste possible', async () => {
  const verrou = creerVerrouExecution();
  await assert.rejects(
    () => verrou.executerUneSeuleFois('k', async () => { throw new Error('réseau coupé'); }),
    /réseau coupé/,
  );
  assert.equal(verrou.enCours('k'), false, 'un échec ne doit pas laisser le bouton verrouillé pour toujours');
});
