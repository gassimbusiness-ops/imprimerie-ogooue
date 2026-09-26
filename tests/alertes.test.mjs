/**
 * Alertes automatiques — caisse et stock, dans l'application ET sur Telegram.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * L'INCIDENT REJOUÉ
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Le 18/09/2026, le mot de passe du compte de l'ordinateur d'accueil est changé
 * sans prévenir. Du 18 au 23 septembre, AUCUN rapport de caisse n'est saisi —
 * six jours — et personne ne le sait. (Mesuré en base : le dernier rapport
 * d'avant le trou est daté du jeudi 17 ; ceux des 18, 21 et 22 ont été
 * rattrapés le 25 au soir.)
 *
 * Attendu : UNE alerte, levée au passage du dimanche 20 à 9 h, envoyée UNE
 * seule fois sur Telegram et UNE seule fois dans la cloche, même sur douze
 * passages.
 *
 * ⛔ ZÉRO RÉSEAU, ZÉRO BASE. Le dépôt est une doublure en mémoire qui tient le
 *    même contrat que Supabase (clé primaire unique, écriture conditionnée à la
 *    version). Le `fetch` de Telegram est une doublure : aucun test de ce
 *    fichier ne peut envoyer un message.
 *
 * Lancer :  node --test tests/alertes.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import {
  evaluerAlertes, alertesCaisse, alertesStock, etatDesCaisses, identifierAlertes,
  joursOuvresEntre, jourSemaine, estJourOuvre, compterSeuilsConfirmes, texteTelegram, decalerDateMetier,
} from '../api/_lib/alertes.js';
import {
  verifierAlertes, verifierAlertesDuPassage, uuidDerive, idLigneTrace, idLigneNotification,
  ID_LIGNE_ETAT, COLLECTION_ALERTES, TENTATIVES_TELEGRAM_MAX, BUDGET_ALERTES_MS,
} from '../api/_lib/alertes-envoi.js';
import { creerClientTelegram, masquerJeton, lireConfigurationTelegram } from '../api/_lib/telegram.js';
import { ligneEtatVerification, phraseTelegram } from '../src/services/alertes-etat.js';
import { DUREE_MAX_FONCTION_MS } from '../api/_lib/autopost-alimentation.js';

const RACINE = fileURLToPath(new URL('..', import.meta.url));

/** Un faux jeton, à la FORME d'un vrai : c'est lui qu'on traque partout. */
const FAUX_JETON = '7654321098:AAFauxJetonDeTestUniquement_abcdefghijkl';
const ENV_TELEGRAM = { TELEGRAM_BOT_TOKEN: FAUX_JETON, TELEGRAM_CHAT_ID: '-1001234567890' };

/* ═══════════════════════════════════════════════════════════════════════════
   Le matériel
   ═══════════════════════════════════════════════════════════════════════════ */

/** Rapports quotidiens (sauf dimanche) du `debut` au `fin` inclus, sans champ `activite` comme en production. */
function rapportsDu(debut, fin, extra = {}) {
  const sortie = [];
  for (let d = debut; d <= fin;) {
    if (estJourOuvre(d)) sortie.push({ date: d, statut: 'soumis', ...extra });
    d = decalerDateMetier(d, 1);
  }
  return sortie;
}

/** Les rapports de production tels qu'ils étaient AVANT le trou (dernier : jeudi 17). */
const AVANT_LE_TROU = rapportsDu('2026-08-20', '2026-09-17');

/** Doublure du dépôt : mêmes garanties que Supabase, en mémoire. */
function depotMemoire({ rapports = [], produits = [] } = {}) {
  const lignes = new Map(); // id → { collection, data, version }
  let horloge = 0;
  const appels = [];
  const d = {
    rapports, produits, lignes, appels,
    async lireRapports() { appels.push('lireRapports'); return d.rapports.map((r) => ({ date: r.date, activite: r.activite ?? null })); },
    async lireProduits() { appels.push('lireProduits'); return d.produits.map((p) => ({ ...p })); },
    async lireTraces() {
      appels.push('lireTraces');
      return [...lignes.entries()]
        .filter(([, l]) => l.collection === COLLECTION_ALERTES)
        .map(([id, l]) => ({ row_id: id, version: l.version, data: structuredClone(l.data) }));
    },
    async inserer(collection, id, data) {
      appels.push(`inserer:${collection}`);
      if (lignes.has(id)) return { cree: false, version: null }; // clé primaire
      horloge += 1;
      lignes.set(id, { collection, data: structuredClone(data), version: `v${horloge}` });
      return { cree: true, version: `v${horloge}` };
    },
    async remplacerSiVersion(id, data, version) {
      appels.push('remplacerSiVersion');
      const l = lignes.get(id);
      if (!l || l.version !== version) return { ok: false, version: null };
      horloge += 1;
      l.data = structuredClone(data); l.version = `v${horloge}`;
      return { ok: true, version: l.version };
    },
    async remplacer(id, data) {
      appels.push('remplacer');
      const l = lignes.get(id);
      if (!l) throw new Error('ligne introuvable');
      horloge += 1;
      l.data = structuredClone(data); l.version = `v${horloge}`;
    },
    async ecrireEtat(id, data) {
      appels.push('ecrireEtat');
      horloge += 1;
      lignes.set(id, { collection: COLLECTION_ALERTES, data: structuredClone(data), version: `v${horloge}` });
    },
    notifications() { return [...lignes.values()].filter((l) => l.collection === 'notifications_app').map((l) => l.data); },
    traces() { return [...lignes.values()].filter((l) => l.collection === COLLECTION_ALERTES && l.data.type_ligne === 'alerte').map((l) => l.data); },
    etat() { return lignes.get(ID_LIGNE_ETAT)?.data || null; },
  };
  return d;
}

/** Doublure de `fetch` pour Telegram : compte, capture, répond ce qu'on lui dit. */
function fetchTelegram(reponse = () => ({ status: 200, corps: { ok: true, result: {} } })) {
  const appels = [];
  const f = async (url, init) => {
    appels.push({ url, corps: JSON.parse(init.body) });
    const r = await reponse(appels.length, url, init);
    if (r instanceof Error) throw r;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.corps };
  };
  f.appels = appels;
  return f;
}

/** Un fetch qui ÉCHOUE LE TEST s'il est appelé. */
function fetchInterdit() {
  const appels = [];
  const f = async (...a) => { appels.push(a); throw new Error('⛔ appel réseau interdit : Telegram n est pas configuré'); };
  f.appels = appels;
  return f;
}

/** Un passage, comme le fait le gestionnaire : début de fonction = maintenant. */
function passage({ depot, instant, telegram }) {
  return verifierAlertesDuPassage({ instant: new Date(instant), debutMs: Date.now(), depot, telegram, env: {} });
}

/** Les douze passages planifiés du 18 au 23/09 : 08:00Z et 17:00Z (9 h et 18 h à Moanda). */
const PASSAGES_DU_TROU = [];
for (const j of ['18', '19', '20', '21', '22', '23']) {
  PASSAGES_DU_TROU.push(`2026-09-${j}T08:00:00Z`, `2026-09-${j}T17:00:00Z`);
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. LES JOURS
   ═══════════════════════════════════════════════════════════════════════════ */

test('calendrier : le 20/09/2026 est un dimanche, fermé ; le samedi 19 est ouvert', () => {
  assert.equal(jourSemaine('2026-09-20'), 0);
  assert.equal(estJourOuvre('2026-09-20'), false);
  assert.equal(estJourOuvre('2026-09-19'), true);
});

test('jours ouvrés strictement entre deux dates : le dimanche est sauté, les bornes exclues', () => {
  assert.deepEqual(joursOuvresEntre('2026-09-17', '2026-09-20'), ['2026-09-18', '2026-09-19']);
  assert.deepEqual(joursOuvresEntre('2026-09-17', '2026-09-24'),
    ['2026-09-18', '2026-09-19', '2026-09-21', '2026-09-22', '2026-09-23']);
  assert.deepEqual(joursOuvresEntre('2026-09-19', '2026-09-21'), [], 'samedi → lundi : aucun jour ouvré manquant');
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. LA RÈGLE CAISSE
   ═══════════════════════════════════════════════════════════════════════════ */

test('rejeu 18→23/09 : pas d alerte le samedi 19 (1 jour manquant), alerte le dimanche 20 à 9 h', () => {
  const samedi = evaluerAlertes({ rapports: AVANT_LE_TROU, produits: [], instant: new Date('2026-09-19T17:00:00Z') });
  assert.equal(samedi.alertes.length, 0);
  assert.deepEqual(samedi.caisses[0].jours_manquants, ['2026-09-18']);

  const dimanche = evaluerAlertes({ rapports: AVANT_LE_TROU, produits: [], instant: new Date('2026-09-20T08:00:00Z') });
  assert.equal(dimanche.alertes.length, 1);
  const a = dimanche.alertes[0];
  assert.equal(a.id, 'caisse:imprimerie:2026-09-18');
  assert.equal(a.famille, 'caisse');
  assert.match(a.message, /IMPRIMERIE OGOOUÉ/, 'quelle caisse');
  assert.match(a.message, /depuis le jeudi 17 septembre/, 'depuis quand');
  assert.match(a.message, /À faire : saisir les rapports manquants/, 'quoi faire');
  assert.match(a.message, /ven\. 18, sam\. 19/);
});

test('l identifiant ne bouge pas tant que le trou dure : le 23/09, c est la même alerte', () => {
  const ids = PASSAGES_DU_TROU.map((i) => evaluerAlertes({ rapports: AVANT_LE_TROU, produits: [], instant: new Date(i) }).alertes.map((a) => a.id));
  const nonVides = ids.filter((x) => x.length);
  assert.equal(nonVides.length, 8, 'du dimanche 20 à 9 h au mercredi 23 à 18 h : 8 passages en alerte');
  assert.ok(nonVides.every((x) => x.length === 1 && x[0] === 'caisse:imprimerie:2026-09-18'));
});

test('le jour même ne compte pas : rapport d hier ⇒ aucune alerte, même à 18 h', () => {
  const r = rapportsDu('2026-09-01', '2026-09-24');
  assert.equal(evaluerAlertes({ rapports: r, produits: [], instant: new Date('2026-09-25T17:00:00Z') }).alertes.length, 0);
});

test('fuseau : 23 h 30 UTC le 19 est déjà le dimanche 20 à Moanda — l alerte part', () => {
  const e = evaluerAlertes({ rapports: AVANT_LE_TROU, produits: [], instant: new Date('2026-09-19T23:30:00Z') });
  assert.equal(e.date_du_jour, '2026-09-20');
  assert.equal(e.alertes.length, 1);
});

test('papeterie : une caisse qui n a JAMAIS eu de rapport n est pas surveillée (rien ne dit qu elle est ouverte)', () => {
  const e = etatDesCaisses({ rapports: AVANT_LE_TROU, dateDuJour: '2026-09-23' });
  const pap = e.find((c) => c.activite === 'papeterie');
  assert.equal(pap.suivie, false);
  assert.equal(pap.en_alerte, false);
});

test('papeterie : sa caisse silencieuse est une alerte À PART, l imprimerie restant à jour', () => {
  const rapports = [
    ...rapportsDu('2026-09-01', '2026-09-25'),
    { date: '2026-09-22', activite: 'papeterie', statut: 'soumis' },
  ];
  const alertes = alertesCaisse({ rapports, dateDuJour: '2026-09-26' });
  assert.equal(alertes.length, 1);
  assert.equal(alertes[0].id, 'caisse:papeterie:2026-09-23');
  assert.match(alertes[0].message, /PAPETERIE OGOOUÉ/);
});

test('une date future ou illisible ne ferme pas le trou ; un brouillon, si', () => {
  const futur = [...AVANT_LE_TROU, { date: '2026-12-31' }, { date: '' }, { date: '2026-02-31' }];
  assert.equal(alertesCaisse({ rapports: futur, dateDuJour: '2026-09-22' }).length, 1);
  const brouillon = [...AVANT_LE_TROU, { date: '2026-09-21', statut: 'brouillon' }];
  assert.equal(alertesCaisse({ rapports: brouillon, dateDuJour: '2026-09-22' }).length, 0);
});

test('mesure du 26/09/2026 en base : rapports imprimerie du 26, papeterie du 25 ⇒ aucune alerte de caisse', () => {
  const rapports = [
    ...rapportsDu('2026-08-20', '2026-09-17'),
    { date: '2026-09-18', activite: 'imprimerie' }, { date: '2026-09-21', activite: 'imprimerie' },
    { date: '2026-09-22', activite: 'imprimerie' }, { date: '2026-09-24', activite: 'imprimerie' },
    { date: '2026-09-25', activite: 'imprimerie' }, { date: '2026-09-26', activite: 'imprimerie' },
    { date: '2026-09-24', activite: 'papeterie' }, { date: '2026-09-25', activite: 'papeterie' },
  ];
  const e = evaluerAlertes({ rapports, produits: [], instant: new Date('2026-09-26T17:00:00Z') });
  assert.equal(e.alertes.length, 0);
  assert.deepEqual(e.caisses.map((c) => [c.activite, c.dernier_rapport]), [['imprimerie', '2026-09-26'], ['papeterie', '2026-09-25']]);
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. LA RÈGLE STOCK — jamais de seuil inventé
   ═══════════════════════════════════════════════════════════════════════════ */

/** Les 13 articles « sous leur seuil » de la production du 26/09 — aucun seuil confirmé. */
const PRODUITS_PRODUCTION = [
  ['Cover avec colle', 6, 10], ['Papier autocolant', 6, 10], ['Papier laminage', 7, 10],
  ['Papier opaque', 9, 10], ['Papier photo', 2, 10], ['Papier PVC', 2, 10],
  ['Polo blanc asiatique', 10, 10], ['Polo vert asiatique', 7, 10],
  ['Imprimante Canon G3430 Series', 1, 5], ['Imprimante Canon MF3414', 1, 5],
  ['Imprimante EPSON L8050', 1, 5], ['Ordinateur de bureau HP', 2, 5], ['Ordinateur LENOVO 1000GB', 1, 5],
  ['Casquettes', 33, 10],
].map(([nom, quantite, min], i) => ({ id: `p${i}`, nom, quantite, quantite_minimum: min, masque: false, actif: true }));

test('⛔ un stock SANS seuil confirmé ne déclenche JAMAIS rien — même à 2 pour un seuil hérité de 10', () => {
  assert.equal(alertesStock({ produits: PRODUITS_PRODUCTION }).length, 0);
  assert.equal(alertesStock({ produits: [{ id: 'x', nom: 'Vide', quantite: 0 }] }).length, 0, 'aucun seuil : jamais');
  assert.deepEqual(compterSeuilsConfirmes(PRODUITS_PRODUCTION), { confirmes: 0, total: 14 });
});

test('un seuil confirmé par le gérant déclenche au seuil pile et dessous, pas au-dessus', () => {
  const confirme = '2026-09-26T10:00:00.000Z';
  const produits = [
    { id: 'a', nom: 'Papier photo', quantite: 2, quantite_minimum: 10, seuil_confirme_le: confirme, unite: 'paquet' },
    { id: 'b', nom: 'Polo blanc', quantite: 10, quantite_minimum: 10, seuil_confirme_le: confirme },
    { id: 'c', nom: 'Casquettes', quantite: 33, quantite_minimum: 10, seuil_confirme_le: confirme },
    { id: 'd', nom: 'Masqué', quantite: 0, quantite_minimum: 5, seuil_confirme_le: confirme, masque: true },
    { id: 'e', nom: 'Sans quantité', quantite: '', quantite_minimum: 5, seuil_confirme_le: confirme },
    { id: 'f', nom: 'Seuil zéro', quantite: 0, quantite_minimum: 0, seuil_confirme_le: confirme },
  ];
  const a = alertesStock({ produits });
  assert.deepEqual(a.map((x) => x.produit_id), ['a', 'b']);
  assert.match(a[0].message, /Papier photo .*: 2 paquet en stock pour un seuil de 10 paquet/);
  assert.equal(a[0].cle_episode, 'stock:a');
});

test('épisode de stock : repris tant qu il est ouvert, nouveau après résolution', () => {
  const brute = [{ id: null, cle_episode: 'stock:a' }];
  assert.equal(identifierAlertes(brute, [], '2026-09-26')[0].id, 'stock:a:2026-09-26');
  const ouverte = [{ alerte_id: 'stock:a:2026-09-20', cle_episode: 'stock:a', resolue_le: null }];
  assert.equal(identifierAlertes(brute, ouverte, '2026-09-26')[0].id, 'stock:a:2026-09-20');
  const fermee = [{ alerte_id: 'stock:a:2026-09-20', cle_episode: 'stock:a', resolue_le: '2026-09-22T08:00:00Z' }];
  assert.equal(identifierAlertes(brute, fermee, '2026-09-26')[0].id, 'stock:a:2026-09-26');
});

test('l écran Stocks : plus de seuil 10 par défaut, et l enregistrement pose le témoin `seuil_confirme_le`', () => {
  const page = readFileSync(join(RACINE, 'src/features/stocks/page.jsx'), 'utf8');
  assert.ok(!/quantite_minimum:\s*10\b/.test(page), 'un seuil par défaut de 10 est un seuil deviné');
  assert.match(page, /seuil_confirme_le:/);
  assert.match(page, /Enregistrer confirme ce seuil/);
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. LE MODULE DE RÈGLES RESTE PUR (il est chargé par le navigateur)
   ═══════════════════════════════════════════════════════════════════════════ */

test('api/_lib/alertes.js : aucun import Node, réseau, base ni variable d environnement', () => {
  const src = readFileSync(join(RACINE, 'api/_lib/alertes.js'), 'utf8');
  const imports = [...src.matchAll(/^import .* from '([^']+)';/gm)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), [
    '../../src/lib/dates.js', '../../src/services/activites.js', '../../src/services/stocks-seuils.js',
  ]);
  for (const interdit of ['process.env', 'fetch(', 'supabase', 'node:']) {
    assert.ok(!src.replace(/\/\*[\s\S]*?\*\//g, '').includes(interdit), `« ${interdit} » dans un module pur`);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. LE REJEU COMPLET — une alerte, envoyée UNE fois, sur douze passages
   ═══════════════════════════════════════════════════════════════════════════ */

test('🔴 rejeu 18→23/09 : six jours sans rapport ⇒ UNE alerte, UNE notification, UN message Telegram sur 12 passages', async () => {
  const depot = depotMemoire({ rapports: AVANT_LE_TROU });
  const f = fetchTelegram();
  const telegram = creerClientTelegram({ env: ENV_TELEGRAM, fetch: f });

  const bilans = [];
  for (const instant of PASSAGES_DU_TROU) bilans.push(await passage({ depot, instant, telegram }));

  assert.ok(bilans.every((b) => b.statut === 'ok'), JSON.stringify(bilans.map((b) => b.statut)));
  assert.equal(f.appels.length, 1, 'jamais deux fois la même alerte sur Telegram');
  assert.equal(depot.notifications().length, 1, 'jamais deux fois dans la cloche');
  assert.equal(depot.traces().length, 1);

  const premiere = bilans.findIndex((b) => b.actives.length > 0);
  assert.equal(PASSAGES_DU_TROU[premiere], '2026-09-20T08:00:00Z', 'levée au passage du dimanche 20 à 9 h');
  assert.equal(bilans[premiere].telegram.envoyees, 1);

  const trace = depot.traces()[0];
  assert.equal(trace.alerte_id, 'caisse:imprimerie:2026-09-18');
  assert.equal(trace.telegram.statut, 'envoye', 'le témoin de l effet est écrit');
  assert.equal(trace.telegram.envoye_le, '2026-09-20T08:00:00.000Z');

  const notif = depot.notifications()[0];
  assert.equal(notif.destinataire, 'all_staff');
  assert.equal(notif.lien, '/rapports');
  assert.equal(notif.lu, false);
  assert.equal(notif.id, idLigneNotification('caisse:imprimerie:2026-09-18'),
    'data.id = identifiant de ligne : sinon « marquer comme lu » ne retrouve pas la ligne');
  assert.match(notif.message, /IMPRIMERIE OGOOUÉ/);

  assert.equal(f.appels[0].corps.chat_id, '-1001234567890');
  assert.match(f.appels[0].corps.text, /OGOOUÉ — Caisse IMPRIMERIE OGOOUÉ sans rapport/);
});

test('rattrapage : les rapports reviennent ⇒ l alerte est résolue, rien n est renvoyé', async () => {
  const depot = depotMemoire({ rapports: AVANT_LE_TROU });
  const f = fetchTelegram();
  const telegram = creerClientTelegram({ env: ENV_TELEGRAM, fetch: f });
  await passage({ depot, instant: '2026-09-20T08:00:00Z', telegram });
  depot.rapports = [...AVANT_LE_TROU, { date: '2026-09-21' }, { date: '2026-09-22' }];
  const b = await passage({ depot, instant: '2026-09-23T08:00:00Z', telegram });
  assert.equal(b.actives.length, 0);
  assert.equal(b.resolues, 1);
  assert.ok(depot.traces()[0].resolue_le);
  assert.equal(f.appels.length, 1);
});

test('deux passages SIMULTANÉS (bouton + tâche planifiée) : un seul message part', async () => {
  const depot = depotMemoire({ rapports: AVANT_LE_TROU });
  const f = fetchTelegram(async () => { await new Promise((r) => setTimeout(r, 20)); return { status: 200, corps: { ok: true } }; });
  const telegram = creerClientTelegram({ env: ENV_TELEGRAM, fetch: f });
  // Le premier crée la trace ; les deux suivants la lisent à la même version.
  await passage({ depot, instant: '2026-09-20T08:00:00Z', telegram: { configure: false, envoyer: async () => ({ statut: 'non_configure' }) } });
  await Promise.all([
    passage({ depot, instant: '2026-09-20T09:00:00Z', telegram }),
    passage({ depot, instant: '2026-09-20T09:00:00Z', telegram }),
  ]);
  assert.equal(f.appels.length, 1, 'la réservation conditionnée à la version a laissé passer deux envois');
});

/* ═══════════════════════════════════════════════════════════════════════════
   6. TELEGRAM ABSENT, EN PANNE, INCERTAIN
   ═══════════════════════════════════════════════════════════════════════════ */

test('⛔ Telegram absent : rien ne part, l alerte est dans l app, et l état le DIT', async () => {
  const depot = depotMemoire({ rapports: AVANT_LE_TROU });
  const f = fetchInterdit();
  const telegram = creerClientTelegram({ env: {}, fetch: f });
  assert.equal(telegram.configure, false);

  const b = await passage({ depot, instant: '2026-09-20T08:00:00Z', telegram });
  assert.equal(b.statut, 'ok');
  assert.equal(b.telegram.configure, false);
  assert.equal(f.appels.length, 0, 'aucun appel réseau sans configuration');
  assert.equal(depot.notifications().length, 1, 'l alerte est quand même dans la cloche');
  assert.equal(depot.traces()[0].telegram.statut, 'non_configure');
  assert.equal(depot.etat().telegram_configure, false);

  // Ce que l'écran en dit.
  const ligne = ligneEtatVerification({ disponible: true, etat: depot.etat() }, Date.parse('2026-09-20T09:00:00Z'));
  assert.match(ligne.texte, /Telegram non configuré/);
  assert.equal(ligne.alarme, true);
  assert.match(phraseTelegram(depot.traces()[0]), /Telegram non configuré/);
});

test('Telegram configuré APRÈS coup : une alerte encore active part une fois, pas plus', async () => {
  const depot = depotMemoire({ rapports: AVANT_LE_TROU });
  await passage({ depot, instant: '2026-09-20T08:00:00Z', telegram: creerClientTelegram({ env: {}, fetch: fetchInterdit() }) });
  const f = fetchTelegram();
  const telegram = creerClientTelegram({ env: ENV_TELEGRAM, fetch: f });
  await passage({ depot, instant: '2026-09-20T17:00:00Z', telegram });
  await passage({ depot, instant: '2026-09-21T08:00:00Z', telegram });
  assert.equal(f.appels.length, 1);
  assert.equal(depot.notifications().length, 1);
});

test('⛔ une panne Telegram ne fait PAS échouer le passage ; nouvel essai, puis abandon après 3', async () => {
  const depot = depotMemoire({ rapports: AVANT_LE_TROU });
  const f = fetchTelegram(() => ({ status: 403, corps: { ok: false, description: 'Forbidden: bot was kicked from the group chat' } }));
  const telegram = creerClientTelegram({ env: ENV_TELEGRAM, fetch: f });
  const bilans = [];
  for (const instant of PASSAGES_DU_TROU.slice(4)) bilans.push(await passage({ depot, instant, telegram }));
  assert.ok(bilans.every((b) => b.statut === 'ok'));
  assert.equal(bilans[0].telegram.echecs, 1);
  assert.equal(f.appels.length, TENTATIVES_TELEGRAM_MAX, 'trois essais, pas un de plus');
  assert.equal(depot.traces()[0].telegram.statut, 'abandonne');
  assert.match(depot.traces()[0].telegram.motif, /bot was kicked/);
  assert.equal(depot.notifications().length, 1, 'l app, elle, a bien l alerte');
});

test('une connexion qui échoue (réseau coupé) est un échec retentable, pas une exception', async () => {
  const depot = depotMemoire({ rapports: AVANT_LE_TROU });
  const f = fetchTelegram(() => new Error('getaddrinfo ENOTFOUND api.telegram.org'));
  const b = await passage({ depot, instant: '2026-09-20T08:00:00Z', telegram: creerClientTelegram({ env: ENV_TELEGRAM, fetch: f }) });
  assert.equal(b.statut, 'ok');
  assert.equal(depot.traces()[0].telegram.statut, 'echec');
});

test('délai dépassé en attendant Telegram : « incertain », et JAMAIS renvoyé', async () => {
  const depot = depotMemoire({ rapports: AVANT_LE_TROU });
  const f = async (_url, init) => new Promise((_r, rejeter) => {
    init.signal.addEventListener('abort', () => rejeter(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  let n = 0;
  const compte = async (...a) => { n += 1; return f(...a); };
  const telegram = creerClientTelegram({ env: ENV_TELEGRAM, fetch: compte });
  const envoyer = telegram.envoyer;
  telegram.envoyer = (texte) => envoyer(texte, { delaiMs: 50 });
  await passage({ depot, instant: '2026-09-20T08:00:00Z', telegram });
  await passage({ depot, instant: '2026-09-20T17:00:00Z', telegram });
  assert.equal(n, 1);
  assert.equal(depot.traces()[0].telegram.statut, 'incertain');
  assert.match(phraseTelegram(depot.traces()[0]), /incertain/);
});

/* ═══════════════════════════════════════════════════════════════════════════
   7. LE JETON N'APPARAÎT NULLE PART
   ═══════════════════════════════════════════════════════════════════════════ */

test('⛔ le jeton n apparaît ni dans la base, ni dans le bilan, ni dans les journaux — même quand l erreur recopie l URL', async () => {
  const journaux = [];
  const origine = { log: console.log, error: console.error, warn: console.warn };
  for (const k of Object.keys(origine)) console[k] = (...a) => journaux.push(a.map(String).join(' '));
  try {
    const depot = depotMemoire({ rapports: AVANT_LE_TROU });
    const f = fetchTelegram((_n, url) => new Error(`request to ${url} failed, reason: ECONNRESET`));
    const b = await passage({ depot, instant: '2026-09-20T08:00:00Z', telegram: creerClientTelegram({ env: ENV_TELEGRAM, fetch: f }) });
    const b2 = await verifierAlertesDuPassage({
      instant: new Date('2026-09-20T17:00:00Z'), debutMs: Date.now(), env: ENV_TELEGRAM,
      depot: { ...depot, lireRapports: async () => { throw new Error(`boom ${FAUX_JETON}`); } },
      telegram: creerClientTelegram({ env: ENV_TELEGRAM, fetch: f }),
    });
    const tout = JSON.stringify([...depot.lignes.values()]) + JSON.stringify(b) + JSON.stringify(b2) + journaux.join('\n');
    const secret = FAUX_JETON.split(':')[1];
    assert.ok(!tout.includes(FAUX_JETON), 'le jeton complet a fuité');
    assert.ok(!tout.includes(secret), 'la partie secrète du jeton a fuité');
    assert.match(depot.traces()[0].telegram.motif, /\[jeton masqué\]/);
    assert.equal(b2.statut, 'panne');
  } finally {
    Object.assign(console, origine);
  }
});

test('masquerJeton : le jeton entier, sa partie secrète, et toute forme de jeton', () => {
  assert.equal(masquerJeton(`x ${FAUX_JETON} y`, FAUX_JETON), 'x [jeton masqué] y');
  assert.ok(!masquerJeton(`/bot${FAUX_JETON.split(':')[1]}`, FAUX_JETON).includes('AAFaux'));
  assert.ok(!masquerJeton('bot1111111111:AAAnotherTokenLookingString_123456', '').includes('AAAnother'));
});

test('⛔ aucune variable Telegram n est lue par le navigateur : ni sous src/, ni préfixée VITE_', () => {
  const fautifs = [];
  const parcourir = (dossier) => {
    for (const nom of readdirSync(dossier)) {
      const p = join(dossier, nom);
      if (statSync(p).isDirectory()) parcourir(p);
      else if (/\.(jsx?|mjs)$/.test(nom)) {
        const s = readFileSync(p, 'utf8');
        if (/TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID|VITE_TELEGRAM|api\.telegram\.org/.test(s)) fautifs.push(p);
      }
    }
  };
  parcourir(join(RACINE, 'src'));
  assert.deepEqual(fautifs, []);
});

test('le bundle servi (dist/, s il est construit) ne contient ni le nom des variables ni l API Telegram', () => {
  const dist = join(RACINE, 'dist');
  if (!existsSync(dist)) return;
  const fautifs = [];
  const parcourir = (dossier) => {
    for (const nom of readdirSync(dossier)) {
      const p = join(dossier, nom);
      if (statSync(p).isDirectory()) parcourir(p);
      else if (/\.(js|html|map)$/.test(nom) && /TELEGRAM_BOT_TOKEN|api\.telegram\.org/.test(readFileSync(p, 'utf8'))) fautifs.push(p);
    }
  };
  parcourir(dist);
  assert.deepEqual(fautifs, []);
});

test('lireConfigurationTelegram : il faut LES DEUX variables', () => {
  assert.equal(lireConfigurationTelegram({ TELEGRAM_BOT_TOKEN: FAUX_JETON }).configure, false);
  assert.equal(lireConfigurationTelegram({ TELEGRAM_CHAT_ID: '-100' }).configure, false);
  assert.equal(lireConfigurationTelegram({ TELEGRAM_BOT_TOKEN: '  ', TELEGRAM_CHAT_ID: ' ' }).configure, false);
  assert.equal(lireConfigurationTelegram(ENV_TELEGRAM).configure, true);
});

/* ═══════════════════════════════════════════════════════════════════════════
   8. LE BUDGET DE TEMPS — les alertes ne mangent pas la minute de la publication
   ═══════════════════════════════════════════════════════════════════════════ */

test('publication longue : s il reste moins de 1,5 s, les alertes ne commencent pas (et ne touchent pas la base)', async () => {
  const depot = depotMemoire({ rapports: AVANT_LE_TROU });
  const debutMs = Date.now() - (DUREE_MAX_FONCTION_MS - 3_000); // 57 s déjà consommées
  const b = await verifierAlertesDuPassage({ instant: new Date('2026-09-20T08:00:00Z'), debutMs, depot, telegram: creerClientTelegram({ env: {} }), env: {} });
  assert.equal(b.statut, 'reportee');
  assert.deepEqual(depot.appels, []);
});

test('une base qui pend : les alertes rendent la main dans leur budget, sans lever', async () => {
  const depot = depotMemoire({ rapports: AVANT_LE_TROU });
  depot.lireTraces = () => new Promise(() => {}); // ne répond jamais
  const debutMs = Date.now() - (DUREE_MAX_FONCTION_MS - 2_000 - 1_600); // il reste 1,6 s
  const t0 = Date.now();
  const b = await verifierAlertesDuPassage({ instant: new Date('2026-09-20T08:00:00Z'), debutMs, depot, telegram: creerClientTelegram({ env: {} }), env: {} });
  const duree = Date.now() - t0;
  assert.equal(b.statut, 'delai_depasse');
  assert.ok(duree < 2_500, `les alertes ont tenu ${duree} ms au lieu de ~1,6 s`);
});

test('le budget ordinaire est de quelques secondes : ≤ 5 s', () => {
  assert.ok(BUDGET_ALERTES_MS <= 5_000);
});

test('mesure : un passage réaliste (245 rapports, 45 articles) avec 150 ms par appel base et 400 ms pour Telegram', async () => {
  const lent = (fn, ms) => async (...a) => { await new Promise((r) => setTimeout(r, ms)); return fn(...a); };
  const depot = depotMemoire({ rapports: [...rapportsDu('2025-12-01', '2026-09-17')], produits: PRODUITS_PRODUCTION });
  for (const k of ['lireRapports', 'lireProduits', 'lireTraces', 'inserer', 'remplacerSiVersion', 'remplacer', 'ecrireEtat']) depot[k] = lent(depot[k], 150);
  const f = fetchTelegram(async () => { await new Promise((r) => setTimeout(r, 400)); return { status: 200, corps: { ok: true } }; });
  const b = await passage({ depot, instant: '2026-09-20T08:00:00Z', telegram: creerClientTelegram({ env: ENV_TELEGRAM, fetch: f }) });
  assert.equal(b.statut, 'ok');
  assert.ok(b.duree_ms < 2_000, `premier passage avec alerte : ${b.duree_ms} ms`);
  const b2 = await passage({ depot, instant: '2026-09-20T17:00:00Z', telegram: creerClientTelegram({ env: ENV_TELEGRAM, fetch: f }) });
  assert.ok(b2.duree_ms < 1_000, `passage sans nouveauté : ${b2.duree_ms} ms`);
});

/* ═══════════════════════════════════════════════════════════════════════════
   9. LA GREFFE DANS LE PASSAGE DE L'AUTO-POST
   ═══════════════════════════════════════════════════════════════════════════ */

function depotAutopostArrete() {
  return {
    lireArretGlobal: async () => ({ actif: false, mode: 'dry_run', motif: 'test' }),
    lireReglages: async () => ({ approbation_automatique: true }),
    lireFile: async () => [],
    ecrireJournal: async () => {},
    journaliser: async () => {},
  };
}

function repFactice() {
  const r = { statut: null, corps: null, entetes: {} };
  r.status = (s) => { r.statut = s; return r; };
  r.json = (c) => { r.corps = c; return r; };
  r.setHeader = (k, v) => { r.entetes[k] = v; };
  return r;
}

async function tick({ alertes, apresPublication }) {
  const { creerGestionnaireAutopost } = await import('../api/autopost.js');
  const avant = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'secret-de-test';
  const depot = depotAutopostArrete();
  const lire = depot.lireArretGlobal;
  depot.lireArretGlobal = async () => { apresPublication?.(); return lire(); };
  const g = creerGestionnaireAutopost({
    depot, client: { disponible: false }, alimente: async () => ({ creees: 0, ecartees: [] }), alertes,
  });
  const rep = repFactice();
  try {
    await g({ url: '/api/autopost-tick', method: 'GET', headers: { authorization: 'Bearer secret-de-test' }, query: {} }, rep);
  } finally {
    if (avant === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = avant;
  }
  return rep;
}

test('⛔ une panne d alerte ne fait pas échouer le passage de publication', async () => {
  const rep = await tick({ alertes: async () => { throw new Error('base des alertes injoignable'); } });
  assert.equal(rep.statut, 200);
  assert.equal(rep.corps.ok, true);
  assert.equal(rep.corps.bilan.alertes.statut, 'panne');
});

test('les alertes tournent APRÈS la sélection des publications, et leur bilan est dans celui du passage', async () => {
  const ordre = [];
  const rep = await tick({
    apresPublication: () => ordre.push('publication'),
    alertes: async ({ instant, debutMs }) => {
      ordre.push('alertes');
      assert.ok(instant instanceof Date);
      assert.equal(typeof debutMs, 'number');
      return { statut: 'ok', actives: [] };
    },
  });
  assert.equal(rep.statut, 200);
  assert.deepEqual(ordre, ['publication', 'alertes']);
  assert.equal(rep.corps.bilan.alertes.statut, 'ok');
});

test('⛔ toujours 12 fonctions dans api/ : les alertes n en ont ajouté aucune', () => {
  const fonctions = readdirSync(join(RACINE, 'api')).filter((n) => n.endsWith('.js'));
  assert.equal(fonctions.length, 12);
});

test('⛔ les 2 tâches planifiées sont celles de l auto-post, inchangées', () => {
  const conf = JSON.parse(readFileSync(join(RACINE, 'vercel.json'), 'utf8'));
  assert.deepEqual(conf.crons.map((c) => c.path), ['/api/autopost?voie=tick&h=08', '/api/autopost?voie=tick&h=17']);
});

/* ═══════════════════════════════════════════════════════════════════════════
   10. IDENTIFIANTS DE LIGNE
   ═══════════════════════════════════════════════════════════════════════════ */

test('identifiants de ligne dérivés : stables, distincts, au format UUID (colonne `id uuid`)', () => {
  const a = idLigneTrace('caisse:imprimerie:2026-09-18');
  assert.equal(a, idLigneTrace('caisse:imprimerie:2026-09-18'));
  assert.notEqual(a, idLigneTrace('caisse:papeterie:2026-09-18'));
  assert.notEqual(a, idLigneNotification('caisse:imprimerie:2026-09-18'));
  for (const x of [a, ID_LIGNE_ETAT, uuidDerive('')]) assert.match(x, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('le texte Telegram : titre, message, référence — et rien d autre', () => {
  const [a] = alertesCaisse({ rapports: AVANT_LE_TROU, dateDuJour: '2026-09-20' });
  const t = texteTelegram(a);
  assert.match(t, /^🔴 OGOOUÉ — Caisse IMPRIMERIE OGOOUÉ sans rapport/);
  assert.match(t, /\(réf\. caisse:imprimerie:2026-09-18\)$/);
});

test('verifierAlertes rend un bilan sans aucun secret, même configuré', async () => {
  const depot = depotMemoire({ rapports: AVANT_LE_TROU });
  const b = await verifierAlertes({ depot, instant: new Date('2026-09-20T08:00:00Z'), telegram: creerClientTelegram({ env: ENV_TELEGRAM, fetch: fetchTelegram() }), jeton: FAUX_JETON });
  assert.ok(!JSON.stringify(b).includes(FAUX_JETON.split(':')[1]));
  assert.equal(b.telegram.envoyees, 1);
});

/* ═══════════════════════════════════════════════════════════════════════════
   11. L'ÉCRAN — le tableau de bord montre l'alerte, en clair, et n'écrit rien
   ═══════════════════════════════════════════════════════════════════════════ */

test('tableau de bord : une caisse silencieuse s affiche — quelle caisse, depuis quand, quoi faire', async () => {
  const { rendreEcran } = await import('./outils/rendu-ecran.mjs');
  const { todayISO, addDaysISO } = await import('../src/lib/dates.js');
  // Dernier rapport il y a 10 jours : quel que soit le jour d'exécution, au moins 2 jours ouvrés manquent.
  const dernier = addDaysISO(-10);
  const v = await rendreEcran({
    ecran: 'src/features/dashboard/page.jsx',
    routeur: true,
    utilisateur: { id: 'u-admin', prenom: 'Gassim', nom: 'Admin', role: 'admin' },
    donnees: {
      rapports: [{ id: 'r1', date: dernier, statut: 'soumis', lignes: [], categories: {}, depenses: [] }],
      produits: [{ id: 'p1', nom: 'Papier PVC', quantite: 2, quantite_minimum: 10 }],
      clients: [], comptes_bancaires: [], dettes: [], charges_fixes: [], commandes: [],
    },
  });
  try {
    assert.ok(todayISO() > dernier);
    assert.match(v.texte, /Alertes automatiques/);
    assert.match(v.texte, /Caisse IMPRIMERIE OGOOUÉ sans rapport/);
    assert.match(v.texte, /aucun rapport journalier depuis le/);
    assert.match(v.texte, /À faire : saisir les rapports manquants/);
    assert.match(v.texte, /0 article\(s\) sur 1 avec un seuil confirmé/, 'dire POURQUOI aucune alerte de stock');
    assert.doesNotMatch(v.texte, /Stock bas : Papier PVC/, 'un seuil non confirmé ne déclenche rien');
    assert.deepEqual(v.journal.ecritures, [], 'afficher le tableau de bord ne doit rien écrire');
  } finally { await v.demonter(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   12. LE DÉPÔT SUPABASE RÉEL — contre un faux client (aucune base touchée)
   ═══════════════════════════════════════════════════════════════════════════ */

function fauxClientSupabase({ erreurInsert = null, lignesUpdate = [{ updated_at: 'v2' }] } = {}) {
  const journal = [];
  const requete = () => {
    const etat = { filtres: [] };
    const q = {
      select(c) { etat.select = c; return q; },
      insert(x) { etat.op = 'insert'; etat.charge = x; return q; },
      upsert(x) { etat.op = 'upsert'; etat.charge = x; return q; },
      update(x) { etat.op = 'update'; etat.charge = x; return q; },
      eq(k, v) { etat.filtres.push([k, v]); return q; },
      order() { return q; },
      limit() { return q; },
      then(res, rej) {
        journal.push(etat);
        const r = etat.op === 'insert'
          ? (erreurInsert ? { data: null, error: erreurInsert } : { data: [{ updated_at: 'v1' }], error: null })
          : etat.op === 'update' ? { data: lignesUpdate, error: null } : { data: [], error: null };
        return Promise.resolve(r).then(res, rej);
      },
    };
    return q;
  };
  return { client: { from: (t) => { assert.equal(t, 'app_data'); return requete(); } }, journal };
}

test('dépôt réel : la notification est insérée avec colonne id = data.id (ligneAppData)', async () => {
  const { depotSupabaseAlertes } = await import('../api/_lib/alertes-envoi.js');
  const faux = fauxClientSupabase();
  const d = depotSupabaseAlertes(faux.client);
  const id = idLigneNotification('caisse:imprimerie:2026-09-18');
  const r = await d.inserer('notifications_app', id, { id, message: 'm' }, '2026-09-20T08:00:00.000Z');
  assert.deepEqual(r, { cree: true, version: 'v1' });
  const { charge } = faux.journal[0];
  assert.equal(charge.id, id);
  assert.equal(charge.data.id, id);
  assert.equal(charge.collection, 'notifications_app');
});

test('dépôt réel : une clé primaire déjà prise (23505) dit « déjà là », pas une panne', async () => {
  const { depotSupabaseAlertes } = await import('../api/_lib/alertes-envoi.js');
  const d = depotSupabaseAlertes(fauxClientSupabase({ erreurInsert: { code: '23505', message: 'duplicate key' } }).client);
  assert.deepEqual(await d.inserer('alertes', 'x', {}, 'i'), { cree: false, version: null });
  const d2 = depotSupabaseAlertes(fauxClientSupabase({ erreurInsert: { code: '42501', message: 'refus' } }).client);
  await assert.rejects(d2.inserer('alertes', 'x', {}, 'i'), /refus/);
});

test('dépôt réel : la réservation Telegram est conditionnée à la version lue (updated_at)', async () => {
  const { depotSupabaseAlertes } = await import('../api/_lib/alertes-envoi.js');
  const faux = fauxClientSupabase({ lignesUpdate: [] });
  const d = depotSupabaseAlertes(faux.client);
  assert.deepEqual(await d.remplacerSiVersion('id1', { a: 1 }, 'v-lue'), { ok: false, version: null });
  assert.deepEqual(faux.journal[0].filtres, [['id', 'id1'], ['collection', 'alertes'], ['updated_at', 'v-lue']]);
  assert.deepEqual(await d.remplacerSiVersion('id1', { a: 1 }, null), { ok: false, version: null }, 'sans version, pas de réservation');
});
