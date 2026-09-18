/**
 * Le badge « Sans mdp » doit dire la verite.
 *
 * Ce qu'il faisait avant : l'ecran testait `employe.password_hash`. Or le serveur
 * RETIRE ce champ avant l'envoi (CHAMPS_IDENTIFIANTS dans api/_lib/comptes.js),
 * exactement pour ne pas faire fuiter les empreintes. Le badge affichait donc
 * « Sans mdp » sur les SEPT comptes de production, qui avaient tous un mot de
 * passe. Un voyant de securite qui crie au loup en permanence finit ignore.
 *
 * Ce test verrouille les deux moities :
 *   1. le serveur repond a la QUESTION (a_mot_de_passe) sans livrer l'empreinte ;
 *   2. l'ecran lit cette reponse, et jamais password_hash.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ECRAN = readFileSync(new URL('../src/features/parametres/page.jsx', import.meta.url), 'utf8');
const API   = readFileSync(new URL('../api/employes.js', import.meta.url), 'utf8');
const DEPOT = readFileSync(new URL('../api/_lib/comptes.js', import.meta.url), 'utf8');

test('l ecran ne decide plus du badge avec password_hash', () => {
  assert.ok(
    !/emp\.password_hash\s*\?/.test(ECRAN),
    'le badge teste encore emp.password_hash — ce champ n arrive JAMAIS du serveur, '
    + 'le badge serait faux pour tous les comptes',
  );
  assert.ok(
    ECRAN.includes('emp.a_mot_de_passe === true') && ECRAN.includes('emp.a_mot_de_passe === false'),
    'le badge doit lire a_mot_de_passe, et distinguer true / false / null',
  );
});

test('le serveur repond a la question sans livrer l empreinte', () => {
  assert.ok(API.includes('a_mot_de_passe'), 'api/employes.js doit renvoyer a_mot_de_passe');
  assert.ok(
    API.includes('identifiantsExistants'),
    'la reponse doit venir de auth_credentials, pas du champ retire',
  );
  assert.ok(
    !/a_mot_de_passe\s*:\s*[^,\n]*password_hash/.test(API),
    'a_mot_de_passe ne doit jamais etre derive d une empreinte renvoyee au navigateur',
  );
});

test('identifiantsExistants ne selectionne que l identifiant, jamais l empreinte', () => {
  const bloc = DEPOT.slice(DEPOT.indexOf('async identifiantsExistants'));
  const corps = bloc.slice(0, bloc.indexOf('\n    },'));
  assert.ok(corps.includes("select('employe_id')"), 'doit selectionner employe_id seul');
  assert.ok(
    !corps.includes('password_hash') && !corps.includes('password_salt'),
    'identifiantsExistants ne doit jamais lire une empreinte',
  );
});

test('le champ retire reste retire', () => {
  assert.ok(
    DEPOT.includes("CHAMPS_IDENTIFIANTS = ['password_hash', 'password_salt', 'password_changed_at']"),
    'les trois champs doivent continuer d etre retires avant envoi au navigateur',
  );
});
