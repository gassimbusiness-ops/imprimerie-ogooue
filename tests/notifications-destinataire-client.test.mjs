/**
 * Regression : une notification adressee a un CLIENT doit atteindre son compte,
 * et le lien doit le mener quelque part ou il a le droit d'aller.
 *
 * ── LE CONSTAT (17/09/2026) ───────────────────────────────────────────────
 *
 * Trois defauts empiles dans la couche notifications :
 *
 * 1. `commande.client_id` porte l'id de la FICHE client pour une commande du
 *    COMPTOIR, et l'id du COMPTE pour une commande du PORTAIL.
 *    `getNotifications()` filtre sur `user.id`, un id de COMPTE.
 *    → les notifications des commandes du comptoir — la majorite — n'etaient
 *      lues par PERSONNE. Le client ne savait jamais que sa commande etait
 *      validee, en production, prete, livree ou annulee.
 *
 * 2. Quatre de ces notifications pointaient sur `/commandes`, une route du
 *    PERSONNEL : le client qui cliquait etait renvoye sur son tableau de bord
 *    (src/app.jsx:69) sans comprendre pourquoi.
 *
 * 3. `client-portal/catalogue.jsx` ecrivait sa notification A LA MAIN avec
 *    `destinataire: 'admin'` au lieu d'appeler `notifyNouvelleCommande()` qui
 *    vise `all_staff` : un employe non-admin ne voyait jamais passer une
 *    commande du portail.
 *
 * ── CE QUE CES TESTS TIENNENT ─────────────────────────────────────────────
 *
 * Les tests de resolution sont PURS (aucune base). Les tests de bout en bout
 * compilent REELLEMENT `src/services/notifications.js` avec une doublure de la
 * couche de donnees, ecrivent une notification et la relisent avec
 * `getNotifications()` : c'est le seul moyen de prouver qu'un id de fiche
 * atteint le bon compte, plutot que de le supposer.
 *
 * Lancer :  node --test tests/notifications-destinataire-client.test.mjs
 * Sur plusieurs fuseaux :
 *   for tz in Africa/Libreville UTC America/Los_Angeles Europe/Paris; do
 *     TZ=$tz node --test tests/notifications-destinataire-client.test.mjs
 *   done
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

import { resoudreCompteClient, CIBLE_CLIENT } from '../src/services/compte-client.js';

const RACINE = resolve(fileURLToPath(new URL('..', import.meta.url)));
const service = readFileSync(new URL('../src/services/notifications.js', import.meta.url), 'utf8');
const catalogue = readFileSync(new URL('../src/features/client-portal/catalogue.jsx', import.meta.url), 'utf8');

/**
 * Code SANS ses commentaires.
 *
 * Les contrats de source ci-dessous affirment l'ABSENCE de certaines formes.
 * Un commentaire qui explique justement pourquoi cette forme a disparu les
 * ferait échouer — un test qui punit la documentation de sa propre correction
 * finit par faire supprimer la documentation.
 */
function sansCommentaires(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const serviceCode = sansCommentaires(service);
const catalogueCode = sansCommentaires(catalogue);

/* ══════════════════════════════════════════════════════════════════════════
   1. LA RESOLUTION « FICHE → COMPTE » — pure, sans base
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Annuaire aux formes reelles :
 *  - `cli-comptoir` : fiche saisie au comptoir, rattachee au compte `u-mairie` ;
 *  - `cli-sans-compte` : fiche de passage, aucun compte sur le portail ;
 *  - `cli-portail` : fiche nee d'une inscription, `user_id` = `u-ibrahim`.
 */
const ANNUAIRE = [
  { id: 'cli-comptoir', nom: 'Mairie de Moanda', user_id: 'u-mairie' },
  { id: 'cli-sans-compte', nom: 'Passage Nzeng-Ayong' },
  { id: 'cli-portail', nom: 'Ibrahim Abakar', user_id: 'u-ibrahim' },
];

test('un id de FICHE est traduit en id de COMPTE', () => {
  const r = resoudreCompteClient(ANNUAIRE, 'cli-comptoir');
  assert.equal(r.compteId, 'u-mairie', 'la commande du comptoir doit atteindre le compte du client');
  assert.equal(r.statut, CIBLE_CLIENT.FICHE, 'la RAISON compte autant que le verdict : c’est une fiche qui a été reconnue');
});

test('un id de COMPTE est rendu tel quel — les commandes du portail ne changent pas', () => {
  const r = resoudreCompteClient(ANNUAIRE, 'u-ibrahim');
  assert.equal(r.compteId, 'u-ibrahim');
  assert.equal(r.statut, CIBLE_CLIENT.COMPTE);
});

test('une fiche SANS compte ne designe personne, et dit pourquoi', () => {
  const r = resoudreCompteClient(ANNUAIRE, 'cli-sans-compte');
  assert.equal(r.compteId, '', 'écrire une notification que personne ne peut lire n’est pas prévenir');
  assert.equal(r.statut, CIBLE_CLIENT.SANS_COMPTE);
  assert.match(r.raison, /pas de compte/i, 'le gérant doit lire POURQUOI, pas juste « échec »');
  assert.match(r.raison, /Passage Nzeng-Ayong/, 'la raison doit nommer le client concerné');
});

test('un identifiant inconnu de l annuaire est conserve — aucune regression', () => {
  const r = resoudreCompteClient(ANNUAIRE, 'u-jamais-vu');
  assert.equal(r.compteId, 'u-jamais-vu', 'un compte dont la fiche n’existe pas doit rester joignable');
  assert.equal(r.statut, CIBLE_CLIENT.INCONNU);
});

test('aucun client rattache : verdict nomme, pas un plantage', () => {
  for (const vide of ['', '   ', null, undefined, 42, {}]) {
    const r = resoudreCompteClient(ANNUAIRE, vide);
    assert.equal(r.statut, CIBLE_CLIENT.INVALIDE, `valeur refusée : ${JSON.stringify(vide)}`);
    assert.equal(r.compteId, '');
  }
});

test('un id de fiche designe SA fiche, jamais le compte d un tiers', () => {
  // Cas pathologique : une fiche B porte en `user_id` l'id de la fiche A.
  // Sans priorite explicite, l'ordre du tableau deciderait qui est prevenu.
  const piege = [
    { id: 'X', nom: 'Fiche X' },
    { id: 'Y', nom: 'Fiche Y', user_id: 'X' },
  ];
  const r = resoudreCompteClient(piege, 'X');
  assert.equal(r.statut, CIBLE_CLIENT.SANS_COMPTE, 'X est une fiche sans compte, pas le compte de Y');
  assert.equal(r.compteId, '');
  assert.deepEqual(resoudreCompteClient([...piege].reverse(), 'X').statut, CIBLE_CLIENT.SANS_COMPTE,
    'le verdict ne doit pas dépendre de l’ordre des fiches');
});

test('un annuaire absent ou malforme ne fait pas tomber la resolution', () => {
  assert.equal(resoudreCompteClient(null, 'u-1').compteId, 'u-1');
  assert.equal(resoudreCompteClient([null, undefined, {}], 'u-1').compteId, 'u-1');
});

/* ══════════════════════════════════════════════════════════════════════════
   2. DE BOUT EN BOUT — le vrai service, avec une doublure de base
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Doublure de `src/services/db`. Elle n'imite que ce que le service utilise :
 * `db.clients.list()` et `db.notifications_app.create()`.
 * `created_at` est un compteur, et non une horloge : ces tests doivent rendre
 * le meme verdict sous n'importe quel TZ.
 */
const DOUBLURE_DB = `
let tables = {};
let compteur = 0;
let annuaireIllisible = false;

export function __reset(donnees) {
  tables = JSON.parse(JSON.stringify(donnees || {}));
  compteur = 0;
  annuaireIllisible = false;
}
export function __table(nom) { return (tables[nom] || []).map((x) => ({ ...x })); }
export function __casserAnnuaire() { annuaireIllisible = true; }

function collection(nom) {
  return {
    async list() {
      if (nom === 'clients' && annuaireIllisible) throw new Error('annuaire illisible');
      return (tables[nom] || []).map((x) => ({ ...x }));
    },
    async create(d) {
      compteur += 1;
      const item = { id: nom + '-' + compteur, created_at: '2026-09-17T00:00:0' + compteur + 'Z', ...d };
      if (!tables[nom]) tables[nom] = [];
      tables[nom].push(item);
      return item;
    },
    async update(id, d) {
      const i = (tables[nom] || []).findIndex((x) => x.id === id);
      if (i === -1) throw new Error(nom + '/' + id + ' introuvable');
      tables[nom][i] = { ...tables[nom][i], ...d };
      return tables[nom][i];
    },
  };
}

const cache = {};
export const db = new Proxy({}, {
  get(_cible, nom) {
    if (typeof nom !== 'string') return undefined;
    if (!cache[nom]) cache[nom] = collection(nom);
    return cache[nom];
  },
});
`;

let notif; // module compile
let dossier;

before(async () => {
  dossier = await mkdtemp(join(tmpdir(), 'ogooue-notifs-'));
  const entree = join(dossier, 'entree.js');
  await writeFile(entree, `
export * from ${JSON.stringify(join(RACINE, 'src/services/notifications.js'))};
export { __reset, __table, __casserAnnuaire } from './db';
`);
  const sortie = join(dossier, 'bundle.mjs');
  await build({
    entryPoints: [entree],
    outfile: sortie,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    logLevel: 'silent',
    plugins: [{
      name: 'doublure-db',
      setup(b) {
        // `./db` depuis le service comme depuis l'entree : meme module.
        b.onResolve({ filter: /(^|\/)db$/ }, () => ({ path: 'db', namespace: 'doublure' }));
        b.onLoad({ filter: /.*/, namespace: 'doublure' }, () => ({ contents: DOUBLURE_DB, loader: 'js' }));
      },
    }],
  });
  notif = await import(pathToFileURL(sortie).href);
});

after(async () => {
  if (dossier) await rm(dossier, { recursive: true, force: true });
});

/** Etat de depart commun : l'annuaire reel, aucune notification. */
function base(extra = {}) {
  notif.__reset({ clients: ANNUAIRE, notifications_app: [], ...extra });
}

const COMPTE_MAIRIE = { id: 'u-mairie', role: 'client' };
const COMPTE_IBRAHIM = { id: 'u-ibrahim', role: 'client' };
const EMPLOYE = { id: 'u-emp', role: 'employe' };
const ADMIN = { id: 'u-adm', role: 'admin' };

test('LE DEFAUT 1 — une commande du COMPTOIR atteint le compte de son client', async () => {
  base();
  // `cmd.client_id` d'une commande saisie au comptoir : un id de FICHE.
  const verdict = await notif.notifyCommandeValidee('cli-comptoir');
  assert.equal(verdict.envoyee, true, verdict.erreur || '');

  const ecrite = notif.__table('notifications_app');
  assert.equal(ecrite.length, 1);
  assert.equal(ecrite[0].destinataire, 'u-mairie',
    'la notification doit être écrite sur le COMPTE, pas sur la fiche');

  const lues = await notif.getNotifications(COMPTE_MAIRIE);
  assert.equal(lues.length, 1, 'le client de la Mairie doit voir sa commande validée');
  assert.match(lues[0].message, /validée/);

  const autre = await notif.getNotifications(COMPTE_IBRAHIM);
  assert.equal(autre.length, 0, 'aucun autre client ne doit lire cette notification');
});

test('les cinq notifications client passent toutes par la resolution', async () => {
  const appels = [
    ['notifyCommandeValidee', (f) => notif.notifyCommandeValidee(f)],
    ['notifyCommandeProduction', (f) => notif.notifyCommandeProduction(f)],
    ['notifyCommandePrete', (f) => notif.notifyCommandePrete(f)],
    ['notifyCommandeLivree', (f) => notif.notifyCommandeLivree(f)],
    ['notifyCommandeAnnulee', (f) => notif.notifyCommandeAnnulee(f, '❌ Commande annulée.')],
    ['notifyFactureDisponible', (f) => notif.notifyFactureDisponible(f, 'FAC-0042')],
    ['notifyDevisDisponible', (f) => notif.notifyDevisDisponible(f, 'DEV-0007')],
  ];
  for (const [nom, appel] of appels) {
    base();
    const verdict = await appel('cli-comptoir');
    assert.equal(verdict.envoyee, true, `${nom} : ${verdict.erreur || ''}`);
    assert.equal(notif.__table('notifications_app')[0].destinataire, 'u-mairie',
      `${nom} n'a pas résolu la fiche vers le compte`);
    assert.equal((await notif.getNotifications(COMPTE_MAIRIE)).length, 1, `${nom} : le client ne la lit pas`);
  }
});

test('une commande du PORTAIL continue d atteindre son compte — aucune regression', async () => {
  base();
  const verdict = await notif.notifyCommandeLivree('u-ibrahim');
  assert.equal(verdict.envoyee, true);
  assert.equal(notif.__table('notifications_app')[0].destinataire, 'u-ibrahim');
  assert.equal((await notif.getNotifications(COMPTE_IBRAHIM)).length, 1);
});

test('client sans compte : rien n est ecrit, et le gerant lit POURQUOI', async () => {
  base();
  const verdict = await notif.notifyCommandeAnnulee('cli-sans-compte', '❌ Commande annulée.');
  assert.equal(verdict.envoyee, false, 'personne ne peut lire cette notification : le dire');
  assert.match(verdict.erreur, /pas de compte/i, 'la raison doit être nommée, pas « échec »');
  assert.match(verdict.erreur, /téléphone/i, 'et dire au gérant quoi faire à la place');
  assert.equal(notif.__table('notifications_app').length, 0,
    'une ligne que personne ne lira jamais est un faux « prévenu »');
});

test('commande sans client : verdict nomme, aucune ecriture', async () => {
  base();
  const verdict = await notif.notifyCommandePrete('');
  assert.equal(verdict.envoyee, false);
  assert.match(verdict.erreur, /Aucun client/i);
  assert.equal(notif.__table('notifications_app').length, 0);
});

test('annuaire illisible : on tente quand meme, on ne perd pas la notification', async () => {
  base();
  notif.__casserAnnuaire();
  const verdict = await notif.notifyCommandeLivree('u-ibrahim');
  assert.equal(verdict.envoyee, true, 'une panne de lecture de l’annuaire ne doit pas faire taire le service');
  assert.equal(notif.__table('notifications_app')[0].destinataire, 'u-ibrahim',
    'faute de pouvoir résoudre, on garde l’identifiant tel quel — le comportement d’avant');
});

test('LE DEFAUT 2 — les liens client ne renvoient plus sur une route du personnel', async () => {
  base();
  for (const [nom, appel] of [
    ['commande_validee', () => notif.notifyCommandeValidee('cli-comptoir')],
    ['commande_production', () => notif.notifyCommandeProduction('cli-comptoir')],
    ['commande_prete', () => notif.notifyCommandePrete('cli-comptoir')],
    ['commande_livree', () => notif.notifyCommandeLivree('cli-comptoir')],
    ['commande_annulee', () => notif.notifyCommandeAnnulee('cli-comptoir', '❌ Annulée.')],
  ]) {
    base();
    await appel();
    const ecrite = notif.__table('notifications_app')[0];
    assert.equal(ecrite.lien, '/client/commandes',
      `${nom} renvoie le client sur une route du personnel : il atterrit sur son tableau de bord`);
  }
});

test('le garde-fou de cloisonnement du 16/09 tient toujours', async () => {
  base();
  // Une promotion vise le ROLE `client`, sans destinataire_id : diffusion.
  const verdict = await notif.notifyPromotion('Remise de 10 % sur les bâches');
  assert.equal(verdict.envoyee, true);
  assert.equal(notif.__table('notifications_app')[0].destinataire, 'client',
    'un rôle ne doit surtout pas être traité comme un id de fiche');
  assert.equal((await notif.getNotifications(COMPTE_MAIRIE)).length, 1);
  assert.equal((await notif.getNotifications(COMPTE_IBRAHIM)).length, 1,
    'une diffusion sans destinataire_id doit rester lue par tous les clients');

  // Et une notification nominative reste cloisonnee.
  base({ notifications_app: [{ id: 'n-1', destinataire: 'client', destinataire_id: 'u-mairie', message: 'Paiement confirmé' }] });
  assert.equal((await notif.getNotifications(COMPTE_MAIRIE)).length, 1);
  assert.equal((await notif.getNotifications(COMPTE_IBRAHIM)).length, 0,
    'fuite : un client lit la confirmation de paiement d’un autre');
});

test('notifyNouvelleCommande vise all_staff — un employe voit passer la commande', async () => {
  base();
  const verdict = await notif.notifyNouvelleCommande('Ibrahim Abakar', {
    detail: '2x Bâche — 45 000 F',
    commande_id: 'cmd-1',
  });
  assert.equal(verdict.envoyee, true);

  const ecrite = notif.__table('notifications_app')[0];
  assert.equal(ecrite.destinataire, 'all_staff', '`admin` exclut les employés de l’atelier');
  assert.equal(ecrite.meta.commande_id, 'cmd-1', 'le lien vers la commande ne doit pas être perdu');
  assert.match(ecrite.message, /45 000 F/, 'le détail affiché au comptoir ne doit pas être perdu');
  assert.ok(!ecrite.message.includes('\n'), 'un \\n serait invisible dans le panneau de notifications');

  assert.equal((await notif.getNotifications(EMPLOYE)).length, 1, 'un employé doit voir passer la commande');
  assert.equal((await notif.getNotifications(ADMIN)).length, 1);
  assert.equal((await notif.getNotifications(COMPTE_IBRAHIM)).length, 0, 'ce n’est pas une notification client');
});

test('notifyNouvelleCommande sans detail garde exactement son ancien message', async () => {
  base();
  await notif.notifyNouvelleCommande('Mairie de Moanda');
  assert.equal(notif.__table('notifications_app')[0].message, '📦 Nouvelle commande de Mairie de Moanda');
});

/* ══════════════════════════════════════════════════════════════════════════
   3. CONTRATS DE SOURCE — ce qu'un futur refactor ne doit pas defaire
   ══════════════════════════════════════════════════════════════════════════ */

test('la resolution client n est PAS recopiee dans notifications.js', () => {
  assert.ok(
    service.includes("from './compte-client'"),
    'la résolution doit venir du module partagé, jamais d’une seconde copie',
  );
  assert.ok(
    !/user_id/.test(serviceCode),
    'une seconde source de vérité pour « fiche → compte » est exactement ce qui a produit la panne',
  );
});

test('LE DEFAUT 3 — catalogue.jsx n ecrit plus sa notification a la main', () => {
  assert.ok(
    !catalogueCode.includes('db.notifications_app.create('),
    'une écriture directe contourne `all_staff` et rend les employés aveugles',
  );
  assert.ok(catalogueCode.includes('notifyNouvelleCommande('), 'la fonction partagée doit être appelée');
  assert.ok(
    !/destinataire: 'admin'/.test(catalogueCode),
    '`admin` exclut les employés : c’est le défaut corrigé',
  );
});

test('catalogue.jsx date la commande en heure de Libreville', () => {
  assert.ok(
    !catalogueCode.includes('.toISOString().slice(0, 10)'),
    'entre 00 h et 01 h, cette forme datait la commande de la veille (src/lib/dates.js)',
  );
  assert.ok(catalogueCode.includes('todayISO()'));
});

/* ══════════════════════════════════════════════════════════════════════════
   4. LES DEUX SENS D'UN MESSAGE (17/09/2026)

   `messagerie/page.jsx` — l'ecran du PERSONNEL — prevenait un CLIENT avec le
   type `nouveau_message`. Deux defauts en un :
     • le destinataire etait `activeConv.client_id`, un id de FICHE quand la
       conversation a ete ouverte au comptoir : la notification n'atteignait
       personne ;
     • son lien etait `/messagerie`, une route du PERSONNEL : le client qui
       cliquait etait renvoye sur son tableau de bord.

   Marquer ce type unique `pourClient` aurait casse l'autre sens en meme temps,
   car un message va aussi du CLIENT vers le PERSONNEL — autre destinataire,
   autre lien. D'ou DEUX types, chacun portant son sens.
   ══════════════════════════════════════════════════════════════════════════ */

test('PERSONNEL → CLIENT : le message atteint le compte, et le lien mene chez le client', async () => {
  base();
  const verdict = await notif.notifyNouveauMessageClient('cli-comptoir', 'Awa (Imprimerie)');
  assert.equal(verdict.envoyee, true, verdict.erreur || '');

  const ecrite = notif.__table('notifications_app')[0];
  assert.equal(ecrite.destinataire, 'u-mairie',
    'la conversation ouverte au comptoir porte un id de FICHE : il doit être traduit');
  assert.equal(ecrite.lien, '/client/messagerie',
    '/messagerie est une route du personnel : le client y atterrit sur son tableau de bord');

  assert.equal((await notif.getNotifications(COMPTE_MAIRIE)).length, 1, 'le client doit lire son message');
  assert.equal((await notif.getNotifications(EMPLOYE)).length, 0, 'ce n’est pas une notification du personnel');
});

test('CLIENT → PERSONNEL : le message va a all_staff, avec le lien du personnel', async () => {
  base();
  const verdict = await notif.notifyNouveauMessagePersonnel('Ibrahim Abakar');
  assert.equal(verdict.envoyee, true, verdict.erreur || '');

  const ecrite = notif.__table('notifications_app')[0];
  assert.equal(ecrite.destinataire, 'all_staff',
    '`admin` laisserait aveugle l’employé qui est devant l’écran');
  assert.equal(ecrite.lien, '/messagerie', 'le personnel répond depuis SA messagerie');

  assert.equal((await notif.getNotifications(EMPLOYE)).length, 1);
  assert.equal((await notif.getNotifications(ADMIN)).length, 1);
  assert.equal((await notif.getNotifications(COMPTE_IBRAHIM)).length, 0,
    'un client ne doit pas lire la notification interne déclenchée par son propre message');
});

test('PERSONNEL → CLIENT : client de passage sans compte, le verdict dit pourquoi', async () => {
  base();
  const verdict = await notif.notifyNouveauMessageClient('cli-sans-compte', 'Awa (Imprimerie)');
  assert.equal(verdict.envoyee, false, 'écrire sur un id que personne ne porte n’est pas prévenir');
  assert.match(verdict.erreur, /pas de compte/i, 'la RAISON doit être nommée');
  assert.match(verdict.erreur, /téléphone/i);
  assert.equal(notif.__table('notifications_app').length, 0);
});

/* ══════════════════════════════════════════════════════════════════════════
   5. LES PROMOTIONS (17/09/2026)

   `notifyPromotion` empruntait le type `nouvelle_commande` : la promotion
   partait donc aux clients avec le lien `/commandes` — une route du PERSONNEL.
   Un client qui cliquait sur « Remise de 10 % » atterrissait sur son tableau
   de bord.

   La diffusion, elle, ne change pas : destinataire = le ROLE `client`, sans
   `destinataire_id`. C'est ce dont depend le garde-fou de cloisonnement du
   16/09 — une promotion doit etre lue par TOUS les clients.
   ══════════════════════════════════════════════════════════════════════════ */

test('UNE PROMOTION MENE AU CATALOGUE CLIENT, PAS A L ECRAN DU PERSONNEL', async () => {
  base();
  const verdict = await notif.notifyPromotion('Remise de 10 % sur les bâches');
  assert.equal(verdict.envoyee, true, verdict.erreur || '');

  const ecrite = notif.__table('notifications_app')[0];
  assert.equal(ecrite.type, 'promotion', 'emprunter `nouvelle_commande` emportait son lien avec lui');
  assert.equal(ecrite.lien, '/client/catalogue',
    '/commandes est une route du personnel : le client est renvoyé sur son tableau de bord');
  assert.match(ecrite.message, /Remise de 10 %/);
});

test('UNE PROMOTION RESTE UNE DIFFUSION — le garde-fou du 16/09 tient', async () => {
  base();
  await notif.notifyPromotion('Remise de 10 % sur les bâches');
  const ecrite = notif.__table('notifications_app')[0];
  assert.equal(ecrite.destinataire, 'client', 'un rôle ne doit surtout pas être traité comme un id de fiche');
  assert.equal(ecrite.destinataire_id, undefined,
    'poser un destinataire ici rendrait la promotion invisible à tous sauf un');

  assert.equal((await notif.getNotifications(COMPTE_MAIRIE)).length, 1);
  assert.equal((await notif.getNotifications(COMPTE_IBRAHIM)).length, 1,
    'une diffusion doit rester lue par TOUS les clients');
  assert.equal((await notif.getNotifications(EMPLOYE)).length, 0, 'ce n’est pas une notification du personnel');
});

/* ══════════════════════════════════════════════════════════════════════════
   6. L'INVARIANT, PLUTOT QUE LA LISTE DES CAS DEJA CORRIGES
   ══════════════════════════════════════════════════════════════════════════ */

test('TOUT type pourClient mene a une route /client — y compris ceux a venir', () => {
  const routesPersonnel = ['/commandes', '/messagerie', '/rapports', '/stocks', '/taches', '/'];
  for (const [nom, def] of Object.entries(notif.NOTIF_TYPES)) {
    if (!def.pourClient) continue;
    assert.ok(
      def.link.startsWith('/client/'),
      `${nom} vise « ${def.link} » : un client qui clique est renvoyé sur son tableau de bord (src/app.jsx)`,
    );
    assert.ok(!routesPersonnel.includes(def.link), `${nom} vise une route du personnel`);
  }
});

test('CONTRAT DE SOURCE : chaque ecran de messagerie nomme le SENS de son message', () => {
  const personnel = readFileSync(new URL('../src/features/messagerie/page.jsx', import.meta.url), 'utf8');
  const portail = readFileSync(new URL('../src/features/client-portal/messagerie.jsx', import.meta.url), 'utf8');

  assert.ok(
    personnel.includes('notifyNouveauMessageClient('),
    'l’écran du personnel prévient un CLIENT : le type doit le dire',
  );
  assert.ok(
    !/notifyNouveauMessage\(/.test(sansCommentaires(personnel)),
    'la fonction ambiguë est revenue : un seul type ne peut pas servir les deux sens',
  );
  assert.ok(
    portail.includes('notifyNouveauMessagePersonnel('),
    'un message envoyé depuis le portail doit apparaître dans le panneau du personnel',
  );
});
