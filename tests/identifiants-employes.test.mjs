/**
 * IDENTIFIANTS DES EMPLOYÉS — le mot de passe ne doit jamais disparaître en silence.
 *
 * ═══ CE QUI ÉTAIT CASSÉ, MESURÉ EN PRODUCTION LE 17/09/2026 ═══
 *
 * Le projet Supabase `bcwkrrqmjpaohmafcncw` porte 13 comptes dans `employes`,
 * dont 3 administrateurs, et **la table `auth_credentials` n'existe pas** : la
 * migration 001 n'a jamais été appliquée. Or les deux endpoints qui gèrent les
 * mots de passe écrivent dans cette table. Trois conséquences, toutes muettes :
 *
 *  1. `api/employes.js` recevait `password_hash` / `password_salt` de l'écran
 *     Paramètres et les SUPPRIMAIT avant d'écrire (liste CHAMPS_INTERDITS).
 *     Un utilisateur créé depuis Paramètres n'avait donc aucun mot de passe, et
 *     un changement de mot de passe depuis le formulaire d'édition affichait
 *     « Utilisateur modifié » sans rien changer.
 *
 *  2. `api/auth-creer-utilisateur.js` insérait l'employé PUIS ses identifiants.
 *     La seconde écriture échouant toujours, chaque inscription laissait un
 *     compte orphelin : connexion impossible, et l'adresse e-mail désormais
 *     « déjà prise ». Le visiteur était enfermé dehors définitivement.
 *
 *  3. `api/auth-changer-mot-de-passe.js` répondait 500 « Erreur serveur » là où
 *     la vraie cause était « la migration n'est pas appliquée ».
 *
 * ═══ CE QUE CE FICHIER PROTÈGE ═══
 *
 * Une seule règle, déclinée : **un mot de passe est écrit dans
 * `auth_credentials`, ou l'appel échoue franchement — jamais entre les deux.**
 * Et il n'entre jamais dans `app_data`, ne ressort jamais vers un navigateur,
 * n'apparaît jamais dans le journal d'audit.
 *
 * Lancer :  node --test tests/identifiants-employes.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';

process.env.SESSION_SECRET ||= 'secret-de-test-suffisamment-long-pour-passer-0123456789';

const { signerSession, hacherMotDePasse } = await import('../api/_lib/session.js');
const {
  separerIdentifiants,
  preparerEmpreinte,
  tableIdentifiantsAbsente,
  assainir,
  IdentifiantsIndisponibles,
  LONGUEUR_MINI,
} = await import('../api/_lib/comptes.js');
const { creerGestionnaireEmployes } = await import('../api/employes.js');
const { creerGestionnaireCreationUtilisateur } = await import('../api/auth-creer-utilisateur.js');
const { creerGestionnaireChangementMotDePasse } = await import('../api/auth-changer-mot-de-passe.js');

/* ═══════════════════════════════════════════════════════════════════════════
   Outils : faux req/res, dépôt en mémoire
   ═══════════════════════════════════════════════════════════════════════════ */

function fausseReponse() {
  return {
    code: null,
    corps: null,
    entetes: {},
    setHeader(k, v) { this.entetes[String(k).toLowerCase()] = v; return this; },
    status(c) { this.code = c; return this; },
    json(o) { this.corps = o; return this; },
    send(o) { this.corps = o; return this; },
    end() { return this; },
  };
}

function requete({ method = 'POST', body = {}, query = {}, session = null } = {}) {
  const headers = { 'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 250) + 1}` };
  if (session) headers.authorization = `Bearer ${signerSession(session)}`;
  return { method, body, query, headers, socket: { remoteAddress: '10.0.0.1' } };
}

const ADMIN = { id: 'admin-1', role: 'admin' };
const EMPLOYE = { id: 'emp-1', role: 'employe' };

/**
 * Dépôt en mémoire. `identifiantsDisponibles: false` reproduit exactement la
 * production d'aujourd'hui : la table `auth_credentials` n'existe pas.
 */
function depotMemoire({ employes = [], identifiantsDisponibles = true } = {}) {
  const d = {
    employes: new Map(employes.map((e) => [e.id, { ...e }])),
    identifiants: new Map(),
    journal: [],
    identifiantsDisponibles,

    async lireEmployes() { return [...d.employes.values()].map((e) => ({ ...e })); },
    async lireEmploye(id) { const e = d.employes.get(id); return e ? { ...e } : null; },
    async insererEmploye(id, donnees) {
      if (d.employes.has(id)) throw new Error('duplicate key');
      if (d.echecInsertionEmploye) throw new Error(d.echecInsertionEmploye);
      d.employes.set(id, { ...donnees });
    },
    async majEmploye(id, donnees) { d.employes.set(id, { ...donnees }); },
    async supprimerEmploye(id) { d.employes.delete(id); },
    async ecrireIdentifiants(employeId, { hash, sel }) {
      if (!d.identifiantsDisponibles) throw new IdentifiantsIndisponibles();
      d.identifiants.set(employeId, { hash, sel });
    },
    async supprimerIdentifiants(employeId) {
      if (!d.identifiantsDisponibles) return;
      d.identifiants.delete(employeId);
    },
    // Rend la QUESTION (« qui a un mot de passe ? »), jamais l'empreinte.
    // `null` quand la table est indisponible : l'ecran n'affiche alors aucun badge.
    async identifiantsExistants() {
      if (!d.identifiantsDisponibles) return null;
      return new Set(d.identifiants.keys());
    },
    async ecrireJournal(entree) { d.journal.push(entree); },
  };
  return d;
}

/** Le hachage tel que le navigateur le fait aujourd'hui (src/services/crypto.js). */
function hacherCommeLeNavigateur(motDePasse, sel) {
  return crypto.createHash('sha256').update(sel + motDePasse, 'utf8').digest('hex');
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. LE CONTRAT CENTRAL — le mot de passe de l'écran Paramètres arrive à bon port
   ═══════════════════════════════════════════════════════════════════════════ */

test('creation depuis Parametres : l empreinte est STOCKEE, pas jetee', async () => {
  const depot = depotMemoire();
  const handler = creerGestionnaireEmployes({ depot });
  const res = fausseReponse();

  const sel = 'a'.repeat(32);
  const hash = hacherCommeLeNavigateur('MotDePasse2026', sel);

  // Exactement ce qu'envoie src/features/parametres/page.jsx aujourd'hui.
  await handler(requete({
    method: 'POST',
    session: ADMIN,
    body: { data: { nom: 'Nzue', prenom: 'Paul', email: 'paul@ogooue.ga', role: 'employe', password_hash: hash, password_salt: sel } },
  }), res);

  assert.equal(res.code, 201, `creation refusee : ${JSON.stringify(res.corps)}`);
  const id = res.corps.id;

  assert.equal(
    depot.identifiants.size, 1,
    "l'empreinte a été jetée : le compte créé depuis Paramètres n'a AUCUN mot de passe "
    + 'et personne ne pourra jamais se connecter avec',
  );
  assert.deepEqual(depot.identifiants.get(id), { hash, sel });
});

test('le mot de passe stocke ouvre bien la session (meme algorithme des deux cotes)', async () => {
  const depot = depotMemoire();
  const handler = creerGestionnaireEmployes({ depot });
  const res = fausseReponse();

  const sel = 'b'.repeat(32);
  const hash = hacherCommeLeNavigateur('MotDePasse2026', sel);
  await handler(requete({
    method: 'POST', session: ADMIN,
    body: { data: { nom: 'Ovono', email: 'o@ogooue.ga', password_hash: hash, password_salt: sel } },
  }), res);

  const stocke = depot.identifiants.get(res.corps.id);
  // C'est la vérification que fait api/auth-login.js.
  assert.equal(
    hacherMotDePasse('MotDePasse2026', stocke.sel), stocke.hash,
    'le hachage du navigateur et celui du serveur ont divergé : tous les comptes créés '
    + "depuis Paramètres seraient inutilisables à la prochaine connexion",
  );
});

test('l empreinte n entre JAMAIS dans l enregistrement app_data', async () => {
  const depot = depotMemoire();
  const handler = creerGestionnaireEmployes({ depot });
  const res = fausseReponse();
  const sel = 'c'.repeat(32);

  await handler(requete({
    method: 'POST', session: ADMIN,
    body: { data: { nom: 'X', email: 'x@ogooue.ga', password_hash: hacherCommeLeNavigateur('Secret12345', sel), password_salt: sel } },
  }), res);

  const enregistrement = depot.employes.get(res.corps.id);
  for (const champ of ['password_hash', 'password_salt', 'password_changed_at']) {
    assert.ok(
      !(champ in enregistrement),
      `« ${champ} » est dans app_data : la clé publiable du bundle le lit, `
      + "c'est le trou que la migration 001 est censée fermer",
    );
  }
});

test('changement de mot de passe depuis le formulaire d edition : l empreinte est REMPLACEE', async () => {
  const depot = depotMemoire({ employes: [{ id: 'e1', nom: 'Mba', email: 'mba@ogooue.ga', role: 'employe' }] });
  depot.identifiants.set('e1', { hash: 'ancien'.padEnd(64, '0'), sel: 'ancien-sel' });
  const handler = creerGestionnaireEmployes({ depot });
  const res = fausseReponse();

  const sel = 'd'.repeat(32);
  const hash = hacherCommeLeNavigateur('NouveauMdp2026', sel);
  await handler(requete({
    method: 'PATCH', session: ADMIN,
    body: { id: 'e1', data: { nom: 'Mba', password_hash: hash, password_salt: sel, password_changed_at: '2026-09-17' } },
  }), res);

  assert.equal(res.code, 200);
  assert.equal(
    depot.identifiants.get('e1').hash, hash,
    "« Utilisateur modifié » s'affichait à l'écran et l'ancien mot de passe restait "
    + "le seul valide : l'admin croyait avoir changé le mot de passe d'un employé",
  );
  assert.equal(res.corps.motDePasseChange, true);
});

test('une modification SANS mot de passe ne touche pas l empreinte existante', async () => {
  const depot = depotMemoire({ employes: [{ id: 'e1', nom: 'Mba', email: 'mba@ogooue.ga', salaire_base: 250000 }] });
  depot.identifiants.set('e1', { hash: 'h'.repeat(64), sel: 'sel' });
  const handler = creerGestionnaireEmployes({ depot });
  const res = fausseReponse();

  await handler(requete({ method: 'PATCH', session: ADMIN, body: { id: 'e1', data: { telephone: '074000000' } } }), res);

  assert.equal(res.code, 200);
  assert.equal(depot.identifiants.get('e1').hash, 'h'.repeat(64));
  assert.equal(res.corps.motDePasseChange, false);
  assert.equal(depot.employes.get('e1').salaire_base, 250000, 'les champs existants ont été perdus');
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. TOUT OU RIEN — jamais de compte à moitié créé
   ═══════════════════════════════════════════════════════════════════════════ */

test('stockage d identifiants indisponible : AUCUN employe n est cree (POST /api/employes)', async () => {
  const depot = depotMemoire({ identifiantsDisponibles: false });
  const handler = creerGestionnaireEmployes({ depot });
  const res = fausseReponse();
  const sel = 'e'.repeat(32);

  await handler(requete({
    method: 'POST', session: ADMIN,
    body: { data: { nom: 'Fantome', email: 'fantome@ogooue.ga', password_hash: hacherCommeLeNavigateur('Secret12345', sel), password_salt: sel } },
  }), res);

  assert.equal(res.code, 503, `attendu 503, recu ${res.code}`);
  assert.equal(
    depot.employes.size, 0,
    "un compte sans mot de passe a été laissé derrière : son adresse e-mail est "
    + "désormais « déjà prise » et personne ne pourra jamais s'en servir",
  );
});

test('inscription publique : stockage indisponible => aucun compte orphelin', async () => {
  const depot = depotMemoire({ identifiantsDisponibles: false });
  const handler = creerGestionnaireCreationUtilisateur({ depot });
  const res = fausseReponse();

  await handler(requete({
    method: 'POST',
    body: { email: 'client@exemple.ga', motDePasse: 'MotDePasse2026', nom: 'Client' },
  }), res);

  assert.equal(res.code, 503, `attendu 503, recu ${res.code} — ${JSON.stringify(res.corps)}`);
  assert.equal(
    depot.employes.size, 0,
    "c'est LE bug vécu par les visiteurs : « Erreur serveur », puis « Un compte avec cet "
    + "email existe deja » à l'essai suivant, et plus aucun moyen d'entrer",
  );
  assert.ok(!/erreur serveur/i.test(res.corps.error), 'le message doit dire que rien n a ete cree');
});

test('inscription publique : si l employe echoue, l identifiant est retire', async () => {
  const depot = depotMemoire();
  depot.echecInsertionEmploye = 'ecriture refusee par la base';
  const handler = creerGestionnaireCreationUtilisateur({ depot });
  const res = fausseReponse();

  await handler(requete({ method: 'POST', body: { email: 'a@b.ga', motDePasse: 'MotDePasse2026', nom: 'A' } }), res);

  assert.equal(res.code, 500);
  assert.equal(depot.employes.size, 0);
  assert.equal(
    depot.identifiants.size, 0,
    'un identifiant reste attaché à un employé qui n existe pas',
  );
});

test('inscription publique reussie : le mot de passe est verifiable par auth-login', async () => {
  const depot = depotMemoire();
  const handler = creerGestionnaireCreationUtilisateur({ depot });
  const res = fausseReponse();

  await handler(requete({ method: 'POST', body: { email: 'C@Exemple.GA', motDePasse: 'MotDePasse2026', nom: 'Client' } }), res);

  assert.equal(res.code, 201, JSON.stringify(res.corps));
  const id = res.corps.user.id;
  const stocke = depot.identifiants.get(id);
  assert.ok(stocke, 'aucun identifiant enregistre');
  assert.equal(hacherMotDePasse('MotDePasse2026', stocke.sel), stocke.hash);
  assert.equal(depot.employes.get(id).email, 'c@exemple.ga', 'l email doit etre normalise');
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. AUTORISATION — le rôle vient du jeton signé, jamais du corps de requête
   ═══════════════════════════════════════════════════════════════════════════ */

test('inscription publique : le role demande est ignore, « client » est impose', async () => {
  const depot = depotMemoire();
  const handler = creerGestionnaireCreationUtilisateur({ depot });
  const res = fausseReponse();

  await handler(requete({
    method: 'POST',
    body: { email: 'pirate@exemple.ga', motDePasse: 'MotDePasse2026', nom: 'P', role: 'admin', extras: { role: 'admin', password_hash: 'x'.repeat(64) } },
  }), res);

  assert.equal(res.corps.user.role, 'client', "c'est le chemin de prise de contrôle du projet");
  const cree = depot.employes.get(res.corps.user.id);
  assert.equal(cree.role, 'client');
  assert.ok(!('password_hash' in cree), '`extras` a servi de cheval de Troie');
});

test('un non-admin ne peut ni creer ni modifier ni supprimer un employe', async () => {
  for (const [method, body, query] of [
    ['POST', { data: { nom: 'X' } }, {}],
    ['PATCH', { id: 'e1', data: {} }, {}],
    ['DELETE', {}, { id: 'e1' }],
  ]) {
    const depot = depotMemoire({ employes: [{ id: 'e1', nom: 'X' }] });
    const res = fausseReponse();
    await creerGestionnaireEmployes({ depot })(requete({ method, body, query, session: EMPLOYE }), res);
    assert.equal(res.code, 403, `${method} accepte pour un employe`);
  }
});

test('un utilisateur ne change que SON mot de passe ; un admin peut changer celui d un autre', async () => {
  const employes = [{ id: 'emp-1', nom: 'A' }, { id: 'emp-2', nom: 'B' }];

  const refus = fausseReponse();
  const d1 = depotMemoire({ employes });
  await creerGestionnaireChangementMotDePasse({ depot: d1 })(
    requete({ session: EMPLOYE, body: { userId: 'emp-2', nouveauMotDePasse: 'MotDePasse2026' } }), refus,
  );
  assert.equal(refus.code, 403);
  assert.equal(d1.identifiants.size, 0);

  const accord = fausseReponse();
  const d2 = depotMemoire({ employes });
  await creerGestionnaireChangementMotDePasse({ depot: d2 })(
    requete({ session: ADMIN, body: { userId: 'emp-2', nouveauMotDePasse: 'MotDePasse2026' } }), accord,
  );
  assert.equal(accord.code, 200, JSON.stringify(accord.corps));
  assert.ok(d2.identifiants.get('emp-2'));
});

test('sans session, aucun changement de mot de passe', async () => {
  const depot = depotMemoire({ employes: [{ id: 'emp-1' }] });
  const res = fausseReponse();
  await creerGestionnaireChangementMotDePasse({ depot })(
    requete({ body: { userId: 'emp-1', nouveauMotDePasse: 'MotDePasse2026' } }), res,
  );
  assert.equal(res.code, 401);
  assert.equal(depot.identifiants.size, 0);
});

test('changer le mot de passe d un compte inexistant : 404, pas de ligne orpheline', async () => {
  const depot = depotMemoire();
  const res = fausseReponse();
  await creerGestionnaireChangementMotDePasse({ depot })(
    requete({ session: ADMIN, body: { userId: 'inconnu', nouveauMotDePasse: 'MotDePasse2026' } }), res,
  );
  assert.equal(res.code, 404);
  assert.equal(depot.identifiants.size, 0);
});

test('stockage indisponible : le changement repond 503 et dit que l ancien mot de passe reste valide', async () => {
  const depot = depotMemoire({ employes: [{ id: 'emp-1', nom: 'A' }], identifiantsDisponibles: false });
  const res = fausseReponse();
  await creerGestionnaireChangementMotDePasse({ depot })(
    requete({ session: EMPLOYE, body: { nouveauMotDePasse: 'MotDePasse2026' } }), res,
  );
  assert.equal(res.code, 503, `attendu 503, recu ${res.code}`);
  assert.match(res.corps.error, /ancien mot de passe/i);
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. RIEN NE FUIT — ni vers le client, ni vers le journal
   ═══════════════════════════════════════════════════════════════════════════ */

test('aucune reponse ne contient d empreinte ni de sel', async () => {
  const depot = depotMemoire({ employes: [{ id: 'e1', nom: 'A', email: 'a@b.ga', salaire_base: 500000, password_hash: 'h'.repeat(64), password_salt: 'sel-en-base' }] });
  const reponses = [];

  for (const session of [ADMIN, EMPLOYE]) {
    const res = fausseReponse();
    await creerGestionnaireEmployes({ depot })(requete({ method: 'GET', session }), res);
    reponses.push(res.corps);
  }

  const texte = JSON.stringify(reponses);
  for (const fuite of ['password_hash', 'password_salt', 'sel-en-base', 'h'.repeat(64)]) {
    assert.ok(!texte.includes(fuite), `« ${fuite} » repart vers le navigateur`);
  }
  // Et le salaire reste réservé à l'admin.
  assert.equal(reponses[0].employes[0].salaire_base, 500000);
  assert.equal(reponses[1].employes[0].salaire_base, undefined);
});

test('le journal enregistre l acte, jamais le mot de passe', async () => {
  const depot = depotMemoire({ employes: [{ id: 'emp-1', nom: 'A', email: 'a@b.ga' }] });
  await creerGestionnaireChangementMotDePasse({ depot })(
    requete({ session: EMPLOYE, body: { nouveauMotDePasse: 'MotDePasseTresReconnaissable2026' } }), fausseReponse(),
  );

  assert.equal(depot.journal.length, 1, "l'acte n'est pas tracé");
  const ligne = depot.journal[0];
  assert.equal(ligne.module, 'auth');
  assert.equal(ligne.user_id, 'emp-1');
  assert.ok(ligne.details.length > 0);

  const texte = JSON.stringify(ligne);
  assert.ok(
    !texte.includes('MotDePasseTresReconnaissable2026'),
    'le mot de passe en clair est dans audit_logs — une table de 3 338 lignes que '
    + "l'écran Audit affiche et que l'export JSON embarque",
  );
  assert.ok(!/password_hash|password_salt/.test(texte));
});

test('assainir masque toute valeur secrete, meme imbriquee', () => {
  const sortie = assainir({
    action: 'update',
    password: 'p4ssw0rd',
    niveau2: { password_hash: 'abc', motDePasse: 'x', ok: 'visible' },
    liste: [{ token: 'jeton' }],
  });
  assert.equal(sortie.action, 'update');
  assert.equal(sortie.password, '[omis]');
  assert.equal(sortie.niveau2.password_hash, '[omis]');
  assert.equal(sortie.niveau2.motDePasse, '[omis]');
  assert.equal(sortie.niveau2.ok, 'visible');
  assert.equal(sortie.liste[0].token, '[omis]');
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. Les briques, prises une par une
   ═══════════════════════════════════════════════════════════════════════════ */

test('separerIdentifiants ne modifie pas l objet d entree', () => {
  const entree = { nom: 'A', password_hash: 'h', password_salt: 's' };
  const { propre, identifiants } = separerIdentifiants(entree);
  assert.deepEqual(identifiants, { hash: 'h', sel: 's' });
  assert.deepEqual(propre, { nom: 'A' });
  assert.equal(entree.password_hash, 'h', "l'objet de l'appelant a été muté");
});

test('separerIdentifiants : un hash sans sel ne vaut pas un identifiant', () => {
  assert.equal(separerIdentifiants({ password_hash: 'h' }).identifiants, null);
  assert.equal(separerIdentifiants({ password_salt: 's' }).identifiants, null);
  assert.equal(separerIdentifiants(null).identifiants, null);
});

test('preparerEmpreinte : mot de passe clair hache cote serveur, sel aleatoire', () => {
  const a = preparerEmpreinte({ motDePasse: 'MotDePasse2026' });
  const b = preparerEmpreinte({ motDePasse: 'MotDePasse2026' });
  assert.notEqual(a.sel, b.sel, 'deux comptes avec le même mot de passe partagent le même sel');
  assert.equal(hacherMotDePasse('MotDePasse2026', a.sel), a.hash);
});

test('preparerEmpreinte : le clair prime sur une empreinte fournie', () => {
  const r = preparerEmpreinte({ motDePasse: 'MotDePasse2026', hash: 'z'.repeat(64), sel: 'sel-client' });
  assert.notEqual(r.hash, 'z'.repeat(64));
});

test('preparerEmpreinte : trop court refuse, rien fourni => null', () => {
  assert.equal(preparerEmpreinte({}), null);
  assert.equal(preparerEmpreinte({ motDePasse: '' }), null);
  assert.throws(() => preparerEmpreinte({ motDePasse: 'a'.repeat(LONGUEUR_MINI - 1) }), /au moins/);
});

test('preparerEmpreinte : une empreinte qui n est pas du SHA-256 hexa est refusee', () => {
  assert.throws(() => preparerEmpreinte({ hash: 'pas-une-empreinte', sel: 's' }), /invalide/);
  assert.throws(() => preparerEmpreinte({ hash: 'a'.repeat(63), sel: 's' }), /invalide/);
  assert.doesNotThrow(() => preparerEmpreinte({ hash: 'A'.repeat(64), sel: 's' }));
});

test('tableIdentifiantsAbsente reconnait les formes reelles renvoyees par la base', () => {
  assert.ok(tableIdentifiantsAbsente({ code: '42P01' }));
  assert.ok(tableIdentifiantsAbsente({ code: 'PGRST205' }));
  assert.ok(tableIdentifiantsAbsente({ message: "relation \"public.auth_credentials\" does not exist" }));
  assert.ok(tableIdentifiantsAbsente({ message: "Could not find the table 'public.auth_credentials' in the schema cache" }));
  assert.ok(!tableIdentifiantsAbsente({ code: '23505', message: 'duplicate key' }));
  assert.ok(!tableIdentifiantsAbsente(null));
});

/* ═══════════════════════════════════════════════════════════════════════════
   6. Le plafond Vercel Hobby
   ═══════════════════════════════════════════════════════════════════════════ */

test('api/ reste sous les 12 fonctions serverless du plan Hobby', () => {
  const racine = new URL('../api/', import.meta.url);
  const fonctions = readdirSync(racine).filter((f) => f.endsWith('.js'));
  assert.ok(
    fonctions.length <= 12,
    `${fonctions.length} fonctions : le déploiement échouera à « Deploying outputs » `
    + `— regrouper via les rewrites de vercel.json (voir api/singpay.js). ${fonctions.join(', ')}`,
  );
});

test('la logique des comptes vit dans api/_lib et ne consomme aucune fonction', () => {
  const fichiers = readdirSync(new URL('../api/', import.meta.url));
  assert.ok(!fichiers.includes('comptes.js'), 'api/comptes.js consommerait une des 12 places');
  const source = readFileSync(new URL('../api/_lib/comptes.js', import.meta.url), 'utf8');
  assert.ok(source.includes('auth_credentials'), 'le module ne vise plus la bonne table');
});

/* ═══════════════════════════════════════════════════════════════════════════
   7. QUI — chaque ligne serveur porte l'auteur du JETON, pas « Serveur »

   Le 18/09/2026 à 16 h 52 (Moanda), `PATCH /api/employes` a changé le mot de
   passe de l'accueil. La ligne portait `user_id` = le compte admin, mais
   `user_nom: 'Serveur'` et aucun rôle : l'administrateur s'y lisait comme
   une machine. Voir `src/services/journal-audit.js`.
   ═══════════════════════════════════════════════════════════════════════════ */

const FICHE_ADMIN = { id: 'admin-1', prenom: 'Imprimerie', nom: 'Admin', email: 'admin@ogooue.ga', role: 'admin' };
const FICHE_ACCUEIL = { id: 'e-accueil', prenom: 'Opérateur', nom: 'Acceuil', email: 'accueil@ogooue.ga', role: 'employe' };

function verifierAuteurAdmin(ligne) {
  assert.equal(ligne.auteur?.type, 'humain', 'la ligne doit porter un auteur humain');
  assert.equal(ligne.auteur.id, 'admin-1', "l'identifiant vient du jeton signé");
  assert.equal(ligne.auteur.nom, 'Imprimerie Admin', 'le nom vient de la fiche relue par le serveur');
  assert.equal(ligne.auteur.role, 'admin', 'le rôle vient du jeton signé');
  assert.equal(ligne.auteur.source, 'session_signee');
  assert.equal(ligne.user_id, 'admin-1');
  assert.equal(ligne.user_nom, 'Imprimerie Admin');
  assert.notEqual(ligne.user_nom, 'Serveur');
}

function verifierAucunSecret(ligne, motDePasse) {
  const texte = JSON.stringify(ligne);
  assert.ok(!texte.includes(motDePasse), 'le mot de passe est entré au journal');
  assert.ok(!/password_hash|password_salt/.test(texte), 'un nom de champ d’empreinte est entré au journal');
  assert.ok(!/[0-9a-f]{64}/.test(texte), 'une empreinte SHA-256 est entrée au journal');
  assert.ok(!/[0-9a-f]{32}/.test(texte), 'un sel est entré au journal');
}

test('QUI : PATCH /api/employes qui change un mot de passe — l’admin, nommé, avec son rôle ; le FAIT, pas la valeur', async () => {
  const depot = depotMemoire({ employes: [FICHE_ADMIN, FICHE_ACCUEIL] });
  const res = fausseReponse();
  await creerGestionnaireEmployes({ depot })(requete({
    method: 'PATCH',
    session: ADMIN,
    body: {
      id: 'e-accueil',
      data: { telephone: '074000000' },
      motDePasse: 'AccueilSecret2026',
      // Ce que l'appelant voudrait écrire comme auteur : ignoré.
      user_id: 'quelqu-un-d-autre', user_nom: 'Personne', auteur: { type: 'systeme' },
    },
  }), res);

  assert.equal(res.code, 200);
  assert.equal(depot.journal.length, 1);
  const [ligne] = depot.journal;
  verifierAuteurAdmin(ligne);
  assert.match(ligne.details, /mot de passe change/, 'le FAIT est enregistré');
  verifierAucunSecret(ligne, 'AccueilSecret2026');
});

test('QUI : /api/auth-changer-mot-de-passe par un admin pour un autre compte — l’admin, et rien du secret', async () => {
  const depot = depotMemoire({ employes: [FICHE_ADMIN, FICHE_ACCUEIL] });
  const res = fausseReponse();
  await creerGestionnaireChangementMotDePasse({ depot })(requete({
    session: ADMIN,
    body: { userId: 'e-accueil', nouveauMotDePasse: 'NouveauSecret2026', user_nom: 'Faux auteur' },
  }), res);

  assert.equal(res.code, 200);
  const [ligne] = depot.journal;
  verifierAuteurAdmin(ligne);
  assert.equal(ligne.entity_id, 'e-accueil', 'la CIBLE est distincte de l’auteur');
  assert.match(ligne.details, /par un administrateur/);
  verifierAucunSecret(ligne, 'NouveauSecret2026');
});

test('QUI : un employé qui change SON mot de passe — lui-même, rôle employe', async () => {
  const depot = depotMemoire({ employes: [{ ...FICHE_ACCUEIL, id: 'emp-1' }] });
  await creerGestionnaireChangementMotDePasse({ depot })(
    requete({ session: EMPLOYE, body: { nouveauMotDePasse: 'MonSecret2026!' } }), fausseReponse(),
  );
  const [ligne] = depot.journal;
  assert.equal(ligne.auteur.type, 'humain');
  assert.equal(ligne.auteur.id, 'emp-1');
  assert.equal(ligne.auteur.role, 'employe');
  assert.equal(ligne.auteur.nom, 'Opérateur Acceuil');
  verifierAucunSecret(ligne, 'MonSecret2026!');
});

test('QUI : création et suppression d’un employé par l’admin — l’admin', async () => {
  const depot = depotMemoire({ employes: [FICHE_ADMIN, FICHE_ACCUEIL] });
  const handler = creerGestionnaireEmployes({ depot });
  await handler(requete({
    method: 'POST', session: ADMIN,
    body: { data: { nom: 'Nzue', prenom: 'Paul', email: 'paul@ogooue.ga', role: 'employe' }, motDePasse: 'PaulSecret2026' },
  }), fausseReponse());
  await handler(requete({ method: 'DELETE', session: ADMIN, query: { id: 'e-accueil' } }), fausseReponse());

  assert.equal(depot.journal.length, 2);
  for (const ligne of depot.journal) verifierAuteurAdmin(ligne);
  verifierAucunSecret(depot.journal[0], 'PaulSecret2026');
});

test('QUI : inscription publique — ANONYME « inscription publique », pas « Serveur »', async () => {
  const depot = depotMemoire();
  const res = fausseReponse();
  await creerGestionnaireCreationUtilisateur({ depot })(requete({
    method: 'POST',
    body: { email: 'client@exemple.ga', motDePasse: 'ClientSecret2026', nom: 'Client', user_id: 'admin-1' },
  }), res);

  assert.equal(res.code, 201);
  const [ligne] = depot.journal;
  assert.equal(ligne.auteur.type, 'anonyme');
  assert.equal(ligne.auteur.contexte, 'inscription publique');
  assert.equal(ligne.auteur.id, null, 'un user_id du corps ne devient pas l’auteur');
  assert.notEqual(ligne.user_nom, 'Serveur');
  verifierAucunSecret(ligne, 'ClientSecret2026');
});

test('QUI : fiche de l’auteur introuvable — l’identifiant et le rôle signés restent, le journal part', async () => {
  const depot = depotMemoire({ employes: [FICHE_ACCUEIL] });
  depot.lireEmploye = async (id) => (id === 'e-accueil' ? { ...FICHE_ACCUEIL } : null);
  await creerGestionnaireChangementMotDePasse({ depot })(
    requete({ session: ADMIN, body: { userId: 'e-accueil', nouveauMotDePasse: 'Secret2026!!' } }), fausseReponse(),
  );
  const [ligne] = depot.journal;
  assert.equal(ligne.auteur.id, 'admin-1');
  assert.equal(ligne.auteur.role, 'admin');
  assert.equal(ligne.auteur.nom, null, 'on ne devine pas un nom');
});
