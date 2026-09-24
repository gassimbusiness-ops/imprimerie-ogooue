/**
 * L'ÉCRAN « JOURNAL D'AUDIT » (Système), MONTÉ POUR DE VRAI, AVEC DES LIGNES.
 *
 * Le jeu d'essai reprend les FORMES réelles relevées en base le 24/09/2026 :
 *   - la ligne serveur du 18/09 16:52 (Moanda) : `user_nom: 'Serveur'`, le
 *     compte admin en `user_id`, aucun rôle ;
 *   - une ligne du 11/09 écrite sans session : `unknown` / « Système » ;
 *   - une ligne humaine ordinaire d'avant, sans rôle ;
 *   - une ligne ChatGPT d'avant, sans « dicté par » ;
 * et une ligne de chaque sorte d'auteur telle qu'elle s'écrit désormais.
 *
 * Ce que l'écran doit faire :
 *   1. une colonne AUTEUR sur chaque ligne, avec sa sorte et son rôle ;
 *   2. « non enregistré » pour ce qu'une ancienne ligne ne porte pas — sans
 *      deviner à partir de l'heure, ni d'une ligne voisine ;
 *   3. ne JAMAIS afficher « Système » pour la ligne écrite sans session : ce
 *      n'était pas une machine ;
 *   4. rien écrire en base au simple affichage.
 *
 * Lancer :  node --test tests/rendu-ecran-audit.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rendreEcran } from './outils/rendu-ecran.mjs';
import {
  ligneJournal,
  auteurDepuisSessionServeur,
  auteurChatGPT,
  auteurSysteme,
  auteurAnonyme,
} from '../src/services/journal-audit.js';

const ECRAN = 'src/features/audit/page.jsx';

const ADMIN = 'f61af333-82fc-4ad7-9482-c211edaa0cd9';

const ANCIENNES = [
  {
    id: 'a-serveur', timestamp: '2026-09-18T15:52:06.201Z', action: 'update', module: 'employes',
    user_id: ADMIN, user_nom: 'Serveur', entity_id: 'e-accueil', entity_label: 'Opérateur Acceuil',
    details: 'Modification utilisateur accueil — mot de passe change', metadata: {},
  },
  {
    id: 'a-sans-session', timestamp: '2026-09-11T08:16:47.678Z', action: 'update', module: 'rapports',
    user_id: 'unknown', user_nom: 'Système', entity_id: 'r-11', entity_label: '',
    details: 'Modification rapport du 2026-09-11', metadata: {},
  },
  {
    id: 'a-humain', timestamp: '2026-09-18T15:55:10.701Z', action: 'login', module: 'auth',
    user_id: '75e89fe9', user_nom: 'Opérateur Acceuil', entity_id: '75e89fe9', entity_label: '',
    details: 'Connexion: accueil (employe)', metadata: {},
  },
  {
    id: 'a-chatgpt', timestamp: '2026-09-18T20:01:07Z', action: 'chatgpt_ecriture', module: 'finances',
    user_id: 'chatgpt', user_nom: 'ChatGPT (pont)', entity_id: 'chatgpt:dep-1', entity_label: '',
    details: 'Dépense de 5 000 F CFA — écrit par ChatGPT sans confirmation', metadata: { phrase: 'note 5000' },
  },
];

const NOUVELLES = [
  { id: 'n-humain', ...ligneJournal({
    auteur: auteurDepuisSessionServeur(
      { sub: ADMIN, role: 'admin' },
      { employe: { prenom: 'Imprimerie', nom: 'Admin' } },
    ),
    timestamp: '2026-09-24T10:00:00.000Z', action: 'update', module: 'employes',
    details: 'Mot de passe de l’accueil réinitialisé (nouvelle forme)',
  }) },
  { id: 'n-chatgpt', ...ligneJournal({
    auteur: auteurChatGPT({ entetes: { 'openai-conversation-id': 'conv_1' } }),
    timestamp: '2026-09-24T10:01:00.000Z', action: 'chatgpt_ecriture', module: 'finances',
    details: 'Dépense de 2 000 F CFA (nouvelle forme)',
  }) },
  { id: 'n-systeme', ...ligneJournal({
    auteur: auteurSysteme('autopost'),
    timestamp: '2026-09-24T10:02:00.000Z', action: 'update', module: 'marketing',
    details: 'Passage planifié (nouvelle forme)',
  }) },
  { id: 'n-anonyme', ...ligneJournal({
    auteur: auteurAnonyme('inscription publique'),
    timestamp: '2026-09-24T10:03:00.000Z', action: 'create', module: 'auth',
    details: 'Creation de compte client (nouvelle forme)',
  }) },
];

/** Le texte de la ligne d'écran qui affiche ce détail. */
function ligneAffichee(v, fragmentDetails) {
  const lignes = [...v.conteneur.querySelectorAll('div.divide-y > div')];
  const trouvee = lignes.find((l) => (l.textContent || '').includes(fragmentDetails));
  assert.ok(trouvee, `la ligne « ${fragmentDetails} » n'est pas affichée`);
  return trouvee;
}

test('JOURNAL D\'AUDIT : chaque ligne montre son auteur ; l\'ancien s\'affiche « non enregistré »', async () => {
  const v = await rendreEcran({
    ecran: ECRAN,
    donnees: { audit_logs: [...ANCIENNES, ...NOUVELLES] },
    utilisateur: { id: ADMIN, role: 'admin' },
  });
  try {
    assert.ok(v.texte.includes("Journal d'Audit"), 'écran blanc');
    assert.deepEqual(v.journal.ecritures, [], 'l\'affichage a écrit en base');

    // ── Anciennes lignes ──
    const serveur = ligneAffichee(v, 'mot de passe change').textContent;
    assert.match(serveur, /non enregistré/);
    assert.match(serveur, new RegExp(`compte ${ADMIN}`), 'le compte que la ligne PORTE doit rester visible');
    assert.doesNotMatch(serveur, /Imprimerie Admin/, 'le nom n\'était pas enregistré : on ne le devine pas');
    assert.doesNotMatch(serveur, /\bServeur\b/, 'un humain ne s\'affiche pas en machine');

    const sansSession = ligneAffichee(v, 'Modification rapport du 2026-09-11').textContent;
    assert.match(sansSession, /non enregistré/);
    assert.doesNotMatch(sansSession, /Système/, 'la ligne sans session n\'était pas une machine');

    const humain = ligneAffichee(v, 'Connexion: accueil').textContent;
    assert.match(humain, /Opérateur Acceuil/);
    assert.match(humain, /Rôle : non enregistré/);

    const ancienChatgpt = ligneAffichee(v, 'Dépense de 5 000').textContent;
    assert.match(ancienChatgpt, /ChatGPT/);
    assert.match(ancienChatgpt, /dicté par : non enregistré/);

    // ── Nouvelles lignes : quatre sortes, quatre affichages ──
    const nHumain = ligneAffichee(v, 'réinitialisé (nouvelle forme)');
    assert.equal(nHumain.querySelector('[data-auteur]').getAttribute('data-auteur'), 'humain');
    assert.match(nHumain.textContent, /Imprimerie Admin/);
    assert.match(nHumain.textContent, /Rôle : admin/);
    assert.match(nHumain.textContent, /session vérifiée par le serveur/);

    const nChatgpt = ligneAffichee(v, 'Dépense de 2 000');
    assert.equal(nChatgpt.querySelector('[data-auteur]').getAttribute('data-auteur'), 'chatgpt');
    assert.match(nChatgpt.textContent, /dicté par : non enregistré/);

    const nSysteme = ligneAffichee(v, 'Passage planifié');
    assert.equal(nSysteme.querySelector('[data-auteur]').getAttribute('data-auteur'), 'systeme');
    assert.match(nSysteme.textContent, /tâche : autopost/);

    const nAnonyme = ligneAffichee(v, 'Creation de compte client');
    assert.equal(nAnonyme.querySelector('[data-auteur]').getAttribute('data-auteur'), 'anonyme');
    assert.match(nAnonyme.textContent, /Personne connectée : aucune/);
    assert.match(nAnonyme.textContent, /inscription publique/);
  } finally {
    await v.demonter();
  }
});

test('JOURNAL D\'AUDIT : un auteur inconnu n\'est pas compté comme un utilisateur', async () => {
  const v = await rendreEcran({ ecran: ECRAN, donnees: { audit_logs: ANCIENNES } });
  try {
    // Identifiants réels : l'admin (ligne « Serveur »), l'accueil, ChatGPT. `unknown` ne compte pas.
    const carte = [...v.conteneur.querySelectorAll('p')].find((p) => p.textContent === 'Utilisateurs');
    assert.ok(carte, 'carte Utilisateurs absente');
    assert.equal(carte.nextElementSibling.textContent, '3');
  } finally {
    await v.demonter();
  }
});
