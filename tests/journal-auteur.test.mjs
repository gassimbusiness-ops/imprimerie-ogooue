/**
 * LE JOURNAL D'AUDIT DIT QUI — et ne laisse personne le dire à sa place.
 *
 * ── Ce qui s'est passé ────────────────────────────────────────────────────
 *
 * 18/09/2026, 16 h 52 à Moanda : le mot de passe du poste d'accueil change, le
 * poste ne se connecte plus pendant six jours, aucun rapport de caisse du 18
 * au 23. Le journal a donné le QUOI et le QUAND à la seconde. Le QUI était mal
 * écrit, mesuré en base le 24/09 sur 3 383 lignes :
 *
 *   - 3 lignes serveur « Serveur » : l'administrateur s'y lisait comme une machine ;
 *   - 2 lignes « Système » / `unknown` : une personne SANS session s'y lisait
 *     comme une tâche automatique ;
 *   - 0 ligne sur 3 383 ne portait le rôle de son auteur.
 *
 * Ce fichier garde les règles qui ferment ces trous :
 *   1. humain, ChatGPT, système et anonyme s'écrivent DIFFÉREMMENT ;
 *   2. l'auteur vient de la session — un appelant ne peut pas le fournir ;
 *   3. aucun chemin n'écrit `audit_logs` sans `ligneJournal()` ;
 *   4. aucune valeur secrète n'entre au journal ;
 *   5. une ancienne ligne sans auteur s'affiche « non enregistré », sans deviner.
 *
 * Les chemins serveur (mot de passe, employés, inscription) sont testés dans
 * `identifiants-employes.test.mjs`, le pont dans `chatgpt-ecriture.test.mjs`,
 * l'écran dans `rendu-ecran-audit.test.mjs`.
 *
 * Lancer :  node --test tests/journal-auteur.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const RACINE = resolve(fileURLToPath(new URL('..', import.meta.url)));

const {
  TYPES_AUTEUR,
  SOURCES_AUTEUR,
  auteurHumain,
  auteurChatGPT,
  auteurSysteme,
  auteurAnonyme,
  auteurDepuisSessionNavigateur,
  auteurDepuisSessionServeur,
  estAuteurValide,
  ligneJournal,
  afficherAuteur,
  cleAuteur,
  NON_ENREGISTRE,
} = await import('../src/services/journal-audit.js');

const SESSION_ACCUEIL = {
  id: '75e89fe9-8e50-44dd-b523-0c93272d16be',
  prenom: 'Opérateur',
  nom: 'Acceuil',
  email: 'accueil@exemple.ga',
  role: 'employe',
  _loginAt: 1,
};

/* ═══════════════════════════════════════════════════════════════════════════
   1. QUATRE AUTEURS, QUATRE ÉCRITURES DISTINCTES
   ═══════════════════════════════════════════════════════════════════════════ */

test('humain, ChatGPT, système et anonyme ne s\'écrivent jamais pareil', () => {
  const lignes = [
    auteurDepuisSessionNavigateur(SESSION_ACCUEIL),
    auteurChatGPT(),
    auteurSysteme('autopost'),
    auteurAnonyme('aucune session dans le navigateur'),
  ].map((auteur) => ligneJournal({ auteur, action: 'update', module: 'rapports' }));

  const types = lignes.map((l) => l.auteur.type);
  assert.deepEqual(types, ['humain', 'chatgpt', 'systeme', 'anonyme']);
  // Les champs historiques aussi : l'export PDF et la recherche les lisent.
  assert.equal(new Set(lignes.map((l) => l.user_id)).size, 4, 'deux auteurs partagent le même user_id');
  assert.equal(new Set(lignes.map((l) => l.user_nom)).size, 4, 'deux auteurs partagent le même user_nom');

  const [humain, chatgpt, systeme, anonyme] = lignes;
  assert.equal(humain.user_id, SESSION_ACCUEIL.id);
  assert.equal(humain.user_nom, 'Opérateur Acceuil');
  assert.equal(humain.user_role, 'employe');
  assert.equal(humain.auteur.role, 'employe', 'le rôle de l\'auteur doit être porté par la ligne');
  assert.equal(chatgpt.user_id, 'chatgpt');
  assert.equal(systeme.auteur.tache, 'autopost');
  assert.match(systeme.user_nom, /autopost/, 'une tâche planifiée est NOMMÉE');
  assert.equal(anonyme.auteur.id, null);
  assert.doesNotMatch(anonyme.user_nom, /Système|Serveur/, 'personne n\'est pas la machine');
});

test('navigateur sans session : un auteur ANONYME, plus jamais « Système »', () => {
  for (const session of [null, undefined, {}, { prenom: 'X' }, 'texte']) {
    const auteur = auteurDepuisSessionNavigateur(session);
    assert.equal(auteur.type, TYPES_AUTEUR.ANONYME, `session ${JSON.stringify(session)}`);
    const ligne = ligneJournal({ auteur, action: 'update', module: 'rapports' });
    assert.notEqual(ligne.user_nom, 'Système');
    assert.notEqual(ligne.user_id, 'unknown');
  }
});

test('une personne ne peut pas prendre l\'identifiant de la machine', () => {
  assert.throws(() => auteurHumain({ id: 'chatgpt', source: SOURCES_AUTEUR.SESSION_SIGNEE }));
  assert.throws(() => auteurHumain({ id: 'systeme:autopost', source: SOURCES_AUTEUR.SESSION_SIGNEE }));
  assert.throws(() => auteurHumain({ id: 'unknown', source: SOURCES_AUTEUR.SESSION_NAVIGATEUR }));
  assert.throws(() => auteurHumain({ id: '', source: SOURCES_AUTEUR.SESSION_NAVIGATEUR }));
  assert.throws(() => auteurHumain({ id: 'u-1', source: 'corps_de_requete' }), 'une personne vient d\'une session');
  // Une session de navigateur trafiquée au nom du pont ne devient PAS le pont.
  const a = auteurDepuisSessionNavigateur({ id: 'chatgpt', prenom: 'Chat', nom: 'GPT', role: 'admin' });
  assert.equal(a.type, TYPES_AUTEUR.ANONYME);
  // Un jeton serveur au nom réservé non plus.
  assert.equal(auteurDepuisSessionServeur({ sub: 'systeme:x', role: 'admin' }).type, TYPES_AUTEUR.ANONYME);
});

test('une tâche planifiée sans nom est refusée', () => {
  assert.throws(() => auteurSysteme(''));
  assert.throws(() => auteurSysteme(undefined));
  assert.equal(auteurSysteme('  autopost ').tache, 'autopost');
});

test('le serveur prend l\'identifiant et le rôle du JETON, le nom de la fiche', () => {
  const a = auteurDepuisSessionServeur(
    { sub: 'f61af333', role: 'admin' },
    { employe: { id: 'f61af333', prenom: 'Imprimerie', nom: 'Admin', role: 'employe' } },
  );
  assert.equal(a.type, 'humain');
  assert.equal(a.id, 'f61af333');
  assert.equal(a.nom, 'Imprimerie Admin');
  assert.equal(a.role, 'admin', 'le rôle vient du jeton signé, pas de la fiche');
  assert.equal(a.source, SOURCES_AUTEUR.SESSION_SIGNEE);

  const sansSession = auteurDepuisSessionServeur(null, { contexte: 'inscription publique' });
  assert.equal(sansSession.type, 'anonyme');
  assert.equal(sansSession.contexte, 'inscription publique');
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. L'APPELANT NE FOURNIT PAS L'AUTEUR
   ═══════════════════════════════════════════════════════════════════════════ */

test('ligneJournal ignore tout auteur glissé dans les options', () => {
  const ligne = ligneJournal({
    auteur: auteurDepuisSessionNavigateur(SESSION_ACCUEIL),
    action: 'delete',
    module: 'finances',
    user_id: 'admin-usurpe',
    user_nom: 'Le Directeur',
    user_role: 'admin',
    metadata: { montant: 5000 },
  });
  assert.equal(ligne.user_id, SESSION_ACCUEIL.id);
  assert.equal(ligne.user_nom, 'Opérateur Acceuil');
  assert.equal(ligne.user_role, 'employe');
  assert.equal(ligne.auteur.id, SESSION_ACCUEIL.id);
});

test('ligneJournal refuse une ligne sans auteur ou avec un auteur fait main', () => {
  assert.throws(() => ligneJournal({ action: 'update', module: 'rapports' }));
  assert.throws(() => ligneJournal({ auteur: { type: 'humain', id: 'x' }, action: 'update' }));
  assert.throws(() => ligneJournal({ auteur: { type: 'machine', id: 'x' }, action: 'update' }));
  assert.throws(() => ligneJournal({ auteur: 'Imprimerie Admin', action: 'update' }));
  assert.equal(estAuteurValide(auteurChatGPT()), true);
});

test('la ligne porte une COPIE de l\'auteur, pas l\'objet de l\'appelant', () => {
  const auteur = auteurDepuisSessionNavigateur(SESSION_ACCUEIL);
  const ligne = ligneJournal({ auteur, action: 'update', module: 'rapports' });
  auteur.nom = 'Modifié après coup';
  assert.equal(ligne.auteur.nom, 'Opérateur Acceuil');
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. LE CHEMIN DU NAVIGATEUR — `logAction`, exécuté pour de vrai
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Compile `src/services/audit.js` avec une doublure de `db` qui enregistre les
 * écritures. Rien n'est réécrit du code testé : seule la base est remplacée.
 */
async function chargerAudit() {
  // Préfixe déjà ignoré par .gitignore et eslint, si un test s'interrompt avant le ménage.
  const dossier = mkdtempSync(join(RACINE, '.tmp-rendu-ecran-journal-auteur-'));
  const sortie = join(dossier, 'audit.mjs');
  const DOUBLURE_DB = `
    export const db = { audit_logs: { async create(d) {
      if (globalThis.__echecAudit) throw new Error('réseau coupé');
      // Lu à l'appel : chaque test pose son propre tableau.
      (globalThis.__ecrituresAudit ||= []).push(d); return d;
    } } };`;
  await build({
    entryPoints: [join(RACINE, 'src/services/audit.js')],
    outfile: sortie,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    logLevel: 'silent',
    plugins: [{
      name: 'doublure-db',
      setup(b) {
        b.onResolve({ filter: /^\.\/db$/ }, () => ({ path: 'db', namespace: 'doublure' }));
        b.onLoad({ filter: /.*/, namespace: 'doublure' }, () => ({ contents: DOUBLURE_DB, loader: 'js' }));
      },
    }],
  });
  const module = await import(`${pathToFileURL(sortie).href}?t=${Date.now()}`);
  return { module, nettoyer: () => rmSync(dossier, { recursive: true, force: true }) };
}

function avecSession(session) {
  const stockage = new Map();
  if (session !== null) stockage.set('io_current_user', typeof session === 'string' ? session : JSON.stringify(session));
  globalThis.localStorage = {
    getItem: (k) => (stockage.has(k) ? stockage.get(k) : null),
    setItem: (k, v) => stockage.set(k, String(v)),
    removeItem: (k) => stockage.delete(k),
  };
  globalThis.__ecrituresAudit = [];
  return globalThis.__ecrituresAudit;
}

test('NAVIGATEUR : logAction pose l\'auteur de la session — et ignore celui de l\'appelant', async () => {
  const { module, nettoyer } = await chargerAudit();
  try {
    const ecritures = avecSession(SESSION_ACCUEIL);
    await module.logAction('delete', 'finances', {
      entityId: 'mvt-1',
      details: 'Suppression d\'une dépense',
      // Un écran (ou quelqu'un dans la console) qui voudrait signer à la place d'un autre :
      user_id: 'f61af333', user_nom: 'Imprimerie Admin', auteur: { type: 'systeme' },
    });
    assert.equal(ecritures.length, 1);
    const [l] = ecritures;
    assert.equal(l.auteur.type, 'humain');
    assert.equal(l.auteur.id, SESSION_ACCUEIL.id);
    assert.equal(l.auteur.role, 'employe');
    assert.equal(l.auteur.source, 'session_navigateur');
    assert.equal(l.user_id, SESSION_ACCUEIL.id);
    assert.equal(l.user_nom, 'Opérateur Acceuil');
    assert.equal(l.entity_id, 'mvt-1');
  } finally { await nettoyer(); }
});

test('NAVIGATEUR : sans session, la ligne part quand même — ANONYME, pas « Système »', async () => {
  const { module, nettoyer } = await chargerAudit();
  try {
    for (const session of [null, '{json cassé']) {
      const ecritures = avecSession(session);
      await module.logAction('update', 'rapports', { details: 'Modification rapport du 2026-09-11' });
      assert.equal(ecritures.length, 1, 'une action sans session doit quand même laisser une trace');
      assert.equal(ecritures[0].auteur.type, 'anonyme');
      assert.notEqual(ecritures[0].user_nom, 'Système');
    }
  } finally { await nettoyer(); }
});

test('NAVIGATEUR : un journal indisponible ne fait toujours pas échouer l\'action', async (t) => {
  const { module, nettoyer } = await chargerAudit();
  t.mock.method(console, 'error', () => {});
  try {
    avecSession(SESSION_ACCUEIL);
    globalThis.__echecAudit = true;
    assert.equal(await module.logAction('update', 'rapports', {}), null);
  } finally {
    globalThis.__echecAudit = false;
    await nettoyer();
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. AUCUN CHEMIN D'ÉCRITURE NE CONTOURNE `ligneJournal`
   ═══════════════════════════════════════════════════════════════════════════ */

function fichiersSource(dossier) {
  const sortie = [];
  for (const nom of readdirSync(dossier)) {
    if (nom === 'node_modules' || nom.startsWith('.')) continue;
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) sortie.push(...fichiersSource(chemin));
    else if (/\.(m?js|jsx)$/.test(nom)) sortie.push(chemin);
  }
  return sortie;
}

/** Une écriture dans `audit_logs`, sous toutes les formes que le dépôt connaît. */
const ECRITURE_JOURNAL = /audit_logs\.(create|update|insert)\s*\(|collection:\s*['"]audit_logs['"]/;

test('chaque fichier qui écrit `audit_logs` passe par ligneJournal', () => {
  const ecrivains = [];
  for (const fichier of [...fichiersSource(join(RACINE, 'src')), ...fichiersSource(join(RACINE, 'api'))]) {
    const src = readFileSync(fichier, 'utf8');
    if (!ECRITURE_JOURNAL.test(src)) continue;
    const rel = relative(RACINE, fichier);
    ecrivains.push(rel);
    assert.match(src, /ligneJournal\(/, `${rel} écrit dans audit_logs sans ligneJournal() — son auteur n'est pas garanti`);
  }
  // Les trois écrivains connus au 24/09/2026. Un quatrième doit être vu, pas découvert en production.
  assert.deepEqual(ecrivains.sort(), [
    'api/_lib/chatgpt-ecriture.js',
    'api/_lib/comptes.js',
    'src/services/audit.js',
  ]);
});

test('plus aucun auteur écrit en dur : ni « Serveur », ni « Système », ni « unknown »', () => {
  for (const rel of ['src/services/audit.js', 'api/_lib/comptes.js', 'api/_lib/chatgpt-ecriture.js']) {
    const code = readFileSync(join(RACINE, rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, /user_nom\s*:/, `${rel} pose user_nom à la main`);
    assert.doesNotMatch(code, /user_id\s*:/, `${rel} pose user_id à la main`);
    assert.doesNotMatch(code, /'unknown'|'Système'/, `${rel} garde un repli d'auteur en dur`);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. RIEN DE SECRET
   ═══════════════════════════════════════════════════════════════════════════ */

test('aucune valeur secrète n\'entre au journal, même glissée dans les métadonnées', () => {
  const ligne = ligneJournal({
    auteur: auteurDepuisSessionNavigateur(SESSION_ACCUEIL),
    action: 'update',
    module: 'auth',
    details: 'Changement de mot de passe',
    metadata: {
      motDePasse: 'Accueil2026!', nouveauMotDePasse: 'Accueil2026!', ancienMotDePasse: 'Vieux2025',
      password_hash: 'a'.repeat(64), password_salt: 'b'.repeat(32),
      imbrique: { token: 'jeton-xyz', jeton: 'abc', secret: 's' },
      cible: 'accueil',
    },
  });
  const texte = JSON.stringify(ligne);
  for (const fuite of ['Accueil2026!', 'Vieux2025', 'a'.repeat(64), 'b'.repeat(32), 'jeton-xyz']) {
    assert.ok(!texte.includes(fuite), `« ${fuite} » est entré au journal`);
  }
  assert.equal(ligne.metadata.cible, 'accueil', 'le fait reste lisible');
});

/* ═══════════════════════════════════════════════════════════════════════════
   6. L'AFFICHAGE DES LIGNES D'AVANT — on montre ce qu'elles portent, rien de plus
   ═══════════════════════════════════════════════════════════════════════════ */

test('ancienne ligne « Système » / unknown : « non enregistré », pas « Système »', () => {
  const a = afficherAuteur({ user_id: 'unknown', user_nom: 'Système', action: 'update' });
  assert.equal(a.nom, NON_ENREGISTRE);
  assert.equal(a.enregistre, false);
  assert.notEqual(a.type, 'systeme', 'le repli du navigateur sans session n\'était pas une machine');
  assert.equal(cleAuteur({ user_id: 'unknown' }), null);
});

test('ancienne ligne « Serveur » : le compte enregistré est montré, nom et rôle « non enregistré »', () => {
  const a = afficherAuteur({ user_id: 'f61af333-82fc', user_nom: 'Serveur' });
  assert.equal(a.nom, NON_ENREGISTRE);
  assert.equal(a.role, NON_ENREGISTRE);
  assert.match(a.precision, /compte f61af333-82fc/);
  // Inscription publique d'avant : 'serveur' n'est pas un compte.
  assert.doesNotMatch(afficherAuteur({ user_id: 'serveur', user_nom: 'Serveur' }).precision, /compte/);
});

test('ancienne ligne humaine : le nom qu\'elle porte, rôle « non enregistré »', () => {
  const a = afficherAuteur({ user_id: 'u-1', user_nom: 'Opérateur Acceuil' });
  assert.equal(a.nom, 'Opérateur Acceuil');
  assert.equal(a.role, NON_ENREGISTRE);
});

test('ancienne ligne ChatGPT : « dicté par : non enregistré »', () => {
  const a = afficherAuteur({ user_id: 'chatgpt', user_nom: 'ChatGPT (pont)' });
  assert.equal(a.type, 'chatgpt');
  assert.match(a.precision, /dicté par : non enregistré/);
});
