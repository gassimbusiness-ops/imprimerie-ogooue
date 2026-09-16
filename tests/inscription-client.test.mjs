/**
 * Regression : l'inscription d'un client ne doit plus planter sur le code de
 * parrainage.
 *
 * Constat C8 / 9.1 de l'audit VAGUE 2. `src/features/login/page.jsx:136` :
 *
 *     const parrain = existing.find((e) => e.code_parrainage === ...);
 *
 * `existing` n'etait DECLARE NULLE PART — le `db.employes.list()` qui
 * l'alimentait avait ete retire pour raison de securite (il telechargeait les
 * salaires de toute l'equipe dans le navigateur d'un visiteur non
 * authentifie). Le `ReferenceError` partait APRES `createUser`, mais AVANT
 * `db.clients.create` et l'auto-connexion.
 *
 * Ce que vivait le client : il saisit le code que son ami lui a donne, on lui
 * dit « erreur, reessayez », il reessaie, on lui dit « un compte avec cet email
 * existe deja » — et il ne peut jamais se connecter.
 *
 * [MESURE le 16/09/2026] `users` ne contient AUCUNE ligne avec un
 * `parraine_par` renseigne : le programme de parrainage n'a jamais rien produit.
 *
 * Lancer :  node --test tests/inscription-client.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { resoudreCompteClient } from '../src/services/compte-client.js';

const page = readFileSync(new URL('../src/features/login/page.jsx', import.meta.url), 'utf8');
const commandes = readFileSync(new URL('../src/features/commandes/page.jsx', import.meta.url), 'utf8');

/** Le corps de `handleRegister`, hors commentaires — c'est le code qui s'exécute. */
function corpsInscription() {
  const debut = page.indexOf('const handleRegister');
  assert.ok(debut > -1, 'handleRegister introuvable');
  const bloc = page.slice(debut);
  return bloc
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
}

/* ══ LE CONTRAT CENTRAL ══ */

test('« existing » n apparait plus dans le CODE de l inscription', () => {
  const code = corpsInscription();
  assert.ok(
    !/\bexisting\b/.test(code),
    'la variable non déclarée est revenue : tout client saisissant un code de parrainage '
    + 'est bloqué dehors avec un compte à moitié créé (constat C8)',
  );
});

test('aucune variable libre suspecte dans le corps de l inscription', () => {
  // Filet plus large : on cherche les `.find(` appeles sur une identifiant qui
  // n'est ni declare dans le bloc, ni un champ d'objet connu.
  const code = corpsInscription();
  const declarees = new Set(
    [...code.matchAll(/\b(?:const|let|var)\s+([A-Za-z0-9_$]+)/g)].map((m) => m[1]),
  );
  for (const m of code.matchAll(/(?:^|[\s(=[,])([a-z][A-Za-z0-9_$]*)\.find\(/g)) {
    const nom = m[1];
    assert.ok(
      declarees.has(nom) || ['reg', 'db', 'clients', 'Object', 'Array'].includes(nom),
      `« ${nom}.find(...) » : « ${nom} » n'est déclaré nulle part dans handleRegister`,
    );
  }
});

/* ══ La fiche client est essentielle, le reste est du confort ══ */

test('la fiche client est creee AVANT les etapes de confort', () => {
  const code = corpsInscription();
  const iClient = code.indexOf('db.clients.create(');
  const iFidelite = code.indexOf('db.fidelite_clients.create(');
  const iNotif = code.indexOf('db.notifications_app.create(');
  assert.ok(iClient > -1, 'la fiche client n’est plus créée : le gérant verra un compte fantôme');
  assert.ok(
    iFidelite === -1 || iClient < iFidelite,
    'la fiche fidélité est créée avant la fiche client : un échec laisse un compte sans fiche',
  );
  assert.ok(iNotif === -1 || iClient < iNotif, 'la notification passe avant la fiche client');
});

test('chaque etape de confort est isolee dans son propre try/catch', () => {
  const code = corpsInscription();
  for (const appel of ['db.fidelite_clients.create(', 'db.notifications_app.create(']) {
    const i = code.indexOf(appel);
    if (i === -1) continue;
    const avant = code.slice(Math.max(0, i - 400), i);
    assert.ok(
      avant.includes('try {'),
      `« ${appel} » n'est pas protégé : son échec casse toute l'inscription (règle du 14/09)`,
    );
  }
});

/* ══ Le parrainage est conserve, et exploitable ══ */

test('le code de parrainage saisi est ENREGISTRE sur le compte et sur la fiche client', () => {
  const code = corpsInscription();
  assert.ok(
    code.includes('parraine_par: reg.codeParrainage.trim() || null'),
    'le code saisi n’est plus conservé : le parrainage devient définitivement muet',
  );
  const iClient = code.indexOf('db.clients.create(');
  const bloc = code.slice(iClient, iClient + 900);
  assert.ok(bloc.includes('code_parrainage'), 'la fiche client doit porter son propre code');
  assert.ok(bloc.includes('parraine_par'), 'la fiche client doit porter le code de son parrain');
});

test('aucune liste complete de comptes n est retelechargee cote visiteur', () => {
  const code = corpsInscription();
  for (const fuite of ['db.employes.list()', 'db.users.list()', 'db.fidelite_clients.list()']) {
    assert.ok(
      !code.includes(fuite),
      `« ${fuite} » dans l'inscription : un visiteur non authentifié retéléchargerait toute la table`,
    );
  }
  assert.ok(
    page.includes('/api/auth-email-disponible'),
    'l’unicité de l’email doit rester vérifiée côté serveur',
  );
});

test('le bonus de parrainage est attribue a la premiere livraison, pas a l inscription', () => {
  // C'est la seule place ou la recherche du parrain peut se faire : dans une
  // session authentifiee, cote gerant.
  assert.ok(
    commandes.includes('client.parraine_par'),
    'plus personne ne lit le code de parrainage : le programme reste mort',
  );
});

test('la jointure client accepte l identifiant de COMPTE comme celui de FICHE', () => {
  // Les 5 commandes du portail portent un `client_id` qui est un identifiant
  // d'UTILISATEUR, pas de fiche client. Ne comparer que `e.id` laissait 100 %
  // des commandes du portail sans parrain (constat de la famille 7).
  //
  // ── 17/09/2026 : CE QUI EST EPINGLE A CHANGE DE FORME, PAS DE FORCE ──────
  //
  // Ce test exigeait la presence LITTERALE de
  // `e.id === cmd.client_id || e.user_id === cmd.client_id` dans l'ecran.
  // C'etait la regle « fiche → compte » recopiee a la main — la SECONDE source
  // de verite qui a produit la panne des notifications (7 endroits du code
  // faisaient la confusion). Elle vit desormais dans un seul module.
  //
  // La garantie n'est pas affaiblie : elle est verifiee DEUX fois, et mieux.
  //   (a) sur le COMPORTEMENT reel du module partage — un id de compte comme un
  //       id de fiche doivent tous deux retrouver la fiche du parrainage ;
  //   (b) sur la SOURCE de l'ecran — il doit deleguer a ce module, et n'avoir
  //       recopie aucune variante locale de la regle.
  // Une jointure qui cesserait de regarder `user_id` ferait tomber (a) ; une
  // recopie a la main ferait tomber (b).

  // (a) le comportement
  const annuaire = [
    { id: 'cli-comptoir', nom: 'Mairie de Moanda', user_id: 'u-mairie', parraine_par: 'OGABCD' },
    { id: 'cli-portail', nom: 'Ibrahim Abakar', user_id: 'u-ibrahim', code_parrainage: 'OGABCD' },
  ];
  assert.equal(
    resoudreCompteClient(annuaire, 'u-mairie').fiche?.parraine_par, 'OGABCD',
    'commande du PORTAIL : `client_id` est un id de compte — sans jointure sur `user_id`, aucun parrain',
  );
  assert.equal(
    resoudreCompteClient(annuaire, 'cli-comptoir').fiche?.parraine_par, 'OGABCD',
    'commande du COMPTOIR : `client_id` est un id de fiche',
  );

  // (b) la source de l'ecran
  assert.ok(
    commandes.includes("from '@/services/compte-client'"),
    'l’écran doit prendre la règle au module partagé',
  );
  assert.ok(
    commandes.includes('resoudreCompteClient(allClients, cmd.client_id)'),
    'la jointure du parrainage ne passe plus par la règle partagée',
  );
  assert.ok(
    !/e\.user_id === cmd\.client_id|\.user_id \|\| parrain\.id/.test(
      commandes.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1'),
    ),
    'la règle « fiche → compte » a été recopiée à la main dans l’écran : c’est le défaut d’origine',
  );
});

test('le bonus de parrainage est credite meme sans compte portail — mais rien de mort n est ecrit', () => {
  // Le parrain est trouve par son CODE : c'est donc une FICHE. Ecrire
  // `destinataire_id: parrain.id` adressait la notification a un identifiant
  // que personne ne porte — elle existait en base et personne ne la lisait.
  const i = commandes.indexOf("type: 'parrainage_bonus'");
  assert.ok(i > -1, 'la notification de parrainage a disparu');
  const bloc = commandes.slice(Math.max(0, i - 600), i + 600);
  assert.ok(
    bloc.includes('destinataire_id: cibleParrain.compteId'),
    'le destinataire doit être un id de COMPTE, jamais un id de fiche',
  );
  assert.ok(
    bloc.includes('if (cibleParrain.compteId) {'),
    'sans compte portail, aucune ligne ne doit être écrite : personne ne la lirait',
  );
  // Les POINTS, eux, ne dependent pas d'un compte portail : ils sont credites
  // avant, sur le dossier fidelite, et la notification n'est qu'un confort.
  const iPoints = commandes.indexOf('type: \'parrainage_valide\'');
  assert.ok(iPoints > -1 && iPoints < i, 'les points doivent être crédités avant toute tentative de prévenir');
  assert.ok(
    /cibleParrain\.raison/.test(bloc),
    'le gérant doit lire POURQUOI le parrain n’a pas pu être prévenu, pas juste « rien ne s’est passé »',
  );
});
