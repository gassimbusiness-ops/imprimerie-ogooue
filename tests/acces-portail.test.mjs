/**
 * QUI ENTRE DANS QUEL PORTAIL.
 *
 * Le defaut d'origine (`src/app.jsx`, gardes `/client` et `/associe`) : les deux
 * gardes verifiaient qu'une session existait, PAS a qui elle appartenait. Un
 * employe ou un client qui tapait `/associe` dans son navigateur voyait la
 * tresorerie, le capital et les salaires.
 *
 * Ces tests posent la question UNE FOIS PAR ROLE ET PAR PORTAIL — 4 roles
 * connus + le manager + le compte sans role, sur les 2 portails. Et ils ne se
 * contentent pas de constater un refus : ils verifient la RAISON du refus.
 * Un refus rendu pour la mauvaise raison (« non connecte » au lieu de « role
 * interdit ») serait un bug different, qui redeviendrait une faille le jour ou
 * la session serait rallongee.
 *
 * Les deux derniers tests verifient le CABLAGE : un module de decision que
 * personne n'appelle ne protege rien.
 *
 * Lancer :  node --test tests/acces-portail.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { accesPortail, ROLES_AUTORISES } from '../src/services/acces-portail.js';
import { rendreEcran } from './outils/rendu-ecran.mjs';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const APP_JSX = readFileSync(`${RACINE}src/app.jsx`, 'utf8');

/* ═══════════════════════════════════════════════════════════════════════════
   1. Portail associé — un par rôle
   ═══════════════════════════════════════════════════════════════════════════ */

test('associé — un ASSOCIE entre', () => {
  const v = accesPortail({ id: 'u1', role: 'associe' }, 'associe');
  assert.equal(v.autorise, true);
  assert.equal(v.code, 'autorise');
});

test('associé — un ADMIN entre (role sur-ensemble, decision assumee)', () => {
  const v = accesPortail({ id: 'u2', role: 'admin' }, 'associe');
  assert.equal(v.autorise, true, 'fermer /associe a l’admin lui retirerait un accès qu’il a déjà par /gouvernance');
  assert.equal(v.code, 'autorise');
});

test('associé — un EMPLOYE est refusé, et le motif dit POURQUOI', () => {
  const v = accesPortail({ id: 'u3', role: 'employe' }, 'associe');
  assert.equal(v.autorise, false);
  assert.equal(v.code, 'role-interdit', 'le refus doit porter sur le RÔLE, pas sur l’absence de session');
  assert.match(v.motif, /employé/, 'le motif doit nommer le rôle refusé');
  assert.match(v.motif, /trésorerie, le capital et les salaires/, 'le motif doit nommer ce qui est protégé');
});

test('associé — un CLIENT est refusé pour cause de rôle', () => {
  const v = accesPortail({ id: 'u4', role: 'client' }, 'associe');
  assert.equal(v.autorise, false);
  assert.equal(v.code, 'role-interdit');
  assert.match(v.motif, /client/);
});

test('associé — un MANAGER est refusé : manager n’est pas admin', () => {
  const v = accesPortail({ id: 'u5', role: 'manager' }, 'associe');
  assert.equal(v.autorise, false);
  assert.equal(v.code, 'role-interdit');
  assert.match(v.motif, /manager/);
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. Portail client — un par rôle
   ═══════════════════════════════════════════════════════════════════════════ */

test('client — un CLIENT entre', () => {
  const v = accesPortail({ id: 'c1', role: 'client' }, 'client');
  assert.equal(v.autorise, true);
  assert.equal(v.code, 'autorise');
});

test('client — un ADMIN entre', () => {
  const v = accesPortail({ id: 'c2', role: 'admin' }, 'client');
  assert.equal(v.autorise, true);
});

test('client — un EMPLOYE est refusé pour cause de rôle', () => {
  const v = accesPortail({ id: 'c3', role: 'employe' }, 'client');
  assert.equal(v.autorise, false);
  assert.equal(v.code, 'role-interdit');
  assert.match(v.motif, /employé/);
});

test('client — un ASSOCIE est refusé pour cause de rôle', () => {
  const v = accesPortail({ id: 'c4', role: 'associe' }, 'client');
  assert.equal(v.autorise, false);
  assert.equal(v.code, 'role-interdit');
  assert.match(v.motif, /associé/);
});

test('client — un MANAGER est refusé pour cause de rôle', () => {
  const v = accesPortail({ id: 'c5', role: 'manager' }, 'client');
  assert.equal(v.autorise, false);
  assert.equal(v.code, 'role-interdit');
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. Les cas limites qui font passer un refus pour un accord
   ═══════════════════════════════════════════════════════════════════════════ */

test('aucune session — refus « non connecté », et pas « rôle interdit »', () => {
  for (const portail of ['client', 'associe']) {
    const v = accesPortail(null, portail);
    assert.equal(v.autorise, false);
    assert.equal(v.code, 'non-connecte', `portail ${portail}`);
  }
});

test('compte SANS rôle — refusé, et nommé comme tel', () => {
  for (const user of [{ id: 'x' }, { id: 'x', role: '' }, { id: 'x', role: '   ' }]) {
    const v = accesPortail(user, 'associe');
    assert.equal(v.autorise, false, `rôle « ${user.role} » ne doit pas ouvrir le portail`);
    assert.equal(v.code, 'sans-role');
  }
});

test('un rôle inventé n’ouvre rien', () => {
  for (const portail of ['client', 'associe']) {
    assert.equal(accesPortail({ role: 'superviseur' }, portail).autorise, false);
    assert.equal(accesPortail({ role: 'ADMIN' }, portail).autorise, false, 'la comparaison est sensible à la casse — « ADMIN » n’est pas un rôle de l’application');
  }
});

test('un portail inconnu est refusé, jamais autorisé par defaut', () => {
  const v = accesPortail({ role: 'admin' }, 'gouvernance');
  assert.equal(v.autorise, false);
  assert.equal(v.code, 'portail-inconnu');
});

test('la table des rôles autorisés ne contient que des rôles de l’application', () => {
  const connus = new Set(['admin', 'manager', 'employe', 'associe', 'client']);
  for (const [portail, roles] of Object.entries(ROLES_AUTORISES)) {
    for (const r of roles) assert.ok(connus.has(r), `rôle inconnu « ${r} » autorisé sur ${portail}`);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. CÂBLAGE — une règle que personne n'appelle ne protège rien
   ═══════════════════════════════════════════════════════════════════════════ */

// `assert.ok` et non `assert.match` : une assertion qui echoue sur une regexp
// recrache le fichier entier dans le rapport de test. Un rapport illisible est
// un rapport qu'on cesse de lire.
test('app.jsx importe et appelle la règle sur LES DEUX portails', () => {
  assert.ok(APP_JSX.includes("import { accesPortail } from '@/services/acces-portail'"),
    'src/app.jsx n’importe pas la règle d’accès');
  assert.ok(APP_JSX.includes("accesPortail(user, 'client')"),
    'la garde /client n’appelle pas accesPortail');
  assert.ok(APP_JSX.includes("accesPortail(user, 'associe')"),
    'la garde /associe n’appelle pas accesPortail');
});

test('aucune garde de portail ne se contente de « y a-t-il un utilisateur »', () => {
  // On isole le corps de chaque garde et on exige qu'il contienne la decision.
  for (const [nom, portail] of [['ProtectedClientRoutes', 'client'], ['ProtectedAssocieRoutes', 'associe']]) {
    const debut = APP_JSX.indexOf(`function ${nom}(`);
    assert.ok(debut > -1, `${nom} introuvable dans src/app.jsx`);
    const corps = APP_JSX.slice(debut, APP_JSX.indexOf('\n}', debut));
    assert.ok(
      corps.includes(`accesPortail(user, '${portail}')`),
      `${nom} laisse entrer n’importe quel compte connecté : aucune vérification de rôle dans son corps`,
    );
    assert.ok(
      corps.includes('Navigate to="/"'),
      `${nom} ne renvoie nulle part le compte refusé`,
    );
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. POUR DE VRAI — l'application entière montée sur l'adresse d'un portail
   ═══════════════════════════════════════════════════════════════════════════

   Les tests ci-dessus prouvent la règle et son câblage. Ceux-ci montent
   `src/app.jsx` dans un DOM, à l'adresse `/associe` ou `/client`, avec un
   utilisateur de rôle donné — c'est exactement le geste du défaut : taper
   l'adresse dans la barre du navigateur.

   ⚠️ Trois cas de la matrice ne sont PAS montables ici, et ce n'est pas un
   trou de couverture : un compte REFUSÉ est renvoyé vers `/`, donc vers
   `AppLayout` ou `ClientLayout`, dont l'en-tête appelle `getNotifications()`
   — que le harnais remplace par une doublure inerte rendant `undefined`.
   Le montage casse alors sur une limite DU HARNAIS, pas de l'application.
   Ces cas sont couverts par les tests de règle, un par rôle, plus haut.       */

const DONNEES_MINIMALES = {
  employes: [], rapports: [], commandes: [], produits_catalogue: [],
  fidelite_clients: [], notifications_app: [], gouvernance_parametres: [],
};

async function monterSurAdresse(role, adresse) {
  return rendreEcran({
    ecran: 'src/app.jsx',
    routeur: true,
    entreesRouteur: [adresse],
    utilisateur: { id: `u-${role}`, prenom: 'Compte', nom: 'Test', role },
    donnees: DONNEES_MINIMALES,
  });
}

test('rendu — un ASSOCIE qui ouvre /associe voit bien son portail', async () => {
  const v = await monterSurAdresse('associe', '/associe');
  try {
    assert.ok(v.texte.includes('Espace Associé'), 'le portail associé ne s’est pas affiché pour un associé');
    assert.deepEqual(v.toasts, [], 'aucun refus ne doit être affiché à un associé');
  } finally { await v.demonter(); }
});

test('rendu — un ADMIN qui ouvre /associe y entre (décision assumée)', async () => {
  const v = await monterSurAdresse('admin', '/associe');
  try {
    assert.ok(v.texte.includes('Espace Associé'), 'l’administrateur doit garder l’accès au portail associé');
  } finally { await v.demonter(); }
});

test('rendu — un ASSOCIE qui tape /client est refusé, et on lui dit pourquoi', async () => {
  let v;
  try {
    v = await monterSurAdresse('associe', '/client');
  } catch (e) {
    assert.fail(
      'l’associé a été laissé entrer dans le portail client — le montage de ClientLayout '
      + `a suivi son cours (${e.message})`,
    );
  }
  try {
    assert.ok(!v.texte.includes('Espace Client'), 'l’associé est entré dans le portail client');
    assert.ok(v.texte.includes('Espace Associé'), 'le compte refusé doit être renvoyé à sa place');
    const refus = v.toasts.filter((t) => t.niveau === 'error');
    assert.equal(refus.length, 1, 'un refus, et un seul, doit être annoncé');
    assert.match(refus[0].message, /rôle « associé »/, 'le message doit nommer le rôle refusé');
    assert.match(refus[0].message, /portail client/, 'le message doit nommer le portail refusé');
  } finally { await v.demonter(); }
});
