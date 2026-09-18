/**
 * LE PONT CHATGPT — ce qu'il donne, et ce qu'il ne donnera jamais.
 *
 * ── Ce que le dirigeant a demandé ─────────────────────────────────────────
 *
 * « On veut directement connecter l'application avec ChatGPT. Comme ça il sait
 * tout… il donne accès à tous, pas juste un sujet mais vraiment tous. »
 *
 * Il a été averti du risque et a tranché. Ce fichier ne rediscute pas ce choix :
 * il vérifie que ce qui a été construit fait EXACTEMENT ce qui a été demandé,
 * et rien de plus.
 *
 * ── Les six garanties, et pourquoi chacune ────────────────────────────────
 *
 *  1. LECTURE SEULE. Aucune écriture, jamais. Une requête autre que GET est
 *     refusée AVANT d'atteindre la moindre lecture. Un assistant qui se trompe
 *     de verbe ne doit pas pouvoir supprimer une facture.
 *
 *  2. UNE PORTE SANS SERRURE RESTE FERMÉE. Si `CHATGPT_BRIDGE_TOKEN` n'est pas
 *     défini, le point d'accès répond 503 et ne sert RIEN — pas même le schéma.
 *     Le cas contraire (« pas de jeton configuré ⇒ pas de contrôle ») est
 *     exactement la porte grande ouverte sur la trésorerie, les salaires et le
 *     fichier clients.
 *
 *  3. LE JETON EST COMPARÉ À TEMPS CONSTANT (`empreintesEgales`), comme la
 *     signature de session. Une comparaison naïve fuite le secret octet par
 *     octet à qui mesure le temps de réponse.
 *
 *  4. LES EMPREINTES DE MOTS DE PASSE NE SORTENT JAMAIS. C'est la seule limite
 *     qui n'est pas négociable : le dirigeant a autorisé l'accès aux salaires,
 *     à la trésorerie et aux clients — il n'a pas demandé qu'on puisse se faire
 *     passer pour lui. Le test balaie TOUTES les voies, avec des empreintes
 *     posées à la racine, imbriquées, et dans un tableau.
 *
 *  5. LES CHIFFRES SONT DATÉS, EN HEURE DE MOANDA. Sur Vercel le serveur est en
 *     UTC : à 23 h 30 UTC, il est déjà le lendemain à Moanda. Un « aujourd'hui »
 *     calculé sur l'horloge du serveur ferait répondre « 0 F aujourd'hui » à
 *     18 h 30, heure du comptoir. C'est le bug de 55 300 F, transposé au pont.
 *
 *  6. LE PLAFOND HOBBY TIENT. 12 fonctions serverless, pas 13. Un `ls api/*.js`
 *     à 13 fait échouer le déploiement ENTIER, build vert compris.
 *
 * Lancer :  node --test tests/chatgpt-pont.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const racine = new URL('../', import.meta.url);
const lire = (chemin) => readFileSync(new URL(chemin, racine), 'utf8');

const {
  creerGestionnairePont,
  VOIES_CHATGPT,
  CHEMINS_CHATGPT,
  voieChatGPT,
} = await import('../api/chatgpt.js');

const {
  sansIdentifiants,
  CHAMPS_INTERDITS_PONT,
} = await import('../api/_lib/chatgpt-lecture.js');

const {
  contexteTemporel,
  chiffreAffairesDuMois,
  etatCaisseParActivite,
  commandesParStatut,
  alertesStock,
} = await import('../api/_lib/chatgpt-syntheses.js');

/* ═══════════════════════════════════════════════════════════════════════════
   Harnais — une requête, une réponse, un dépôt, aucun réseau
   ═══════════════════════════════════════════════════════════════════════════ */

/** Réponse factice : enregistre code et corps sans rien envoyer. */
function fausseReponse() {
  const r = { code: null, corps: null, entetes: {}, termine: false };
  r.status = (c) => { r.code = c; return r; };
  r.json = (o) => { r.corps = o; r.termine = true; return r; };
  r.send = (o) => { r.corps = o; r.termine = true; return r; };
  r.end = () => { r.termine = true; return r; };
  r.setHeader = (k, v) => { r.entetes[String(k).toLowerCase()] = v; return r; };
  return r;
}

/** Jeton de test. Longueur réaliste : un secret court serait refusé à la config. */
const JETON = 'jeton-de-test-du-pont-chatgpt-0123456789';

/**
 * Requête factice.
 * ⚠️ L'IP change à chaque appel : sans cela, les ~40 requêtes de ce fichier
 * partageraient le même compteur de débit et les derniers tests recevraient
 * des 429 sans rapport avec ce qu'ils vérifient.
 */
let compteurIp = 0;
function requete({ voie = 'inventaire', jeton = JETON, method = 'GET', url = null, query = null } = {}) {
  compteurIp += 1;
  return {
    method,
    url: url === null ? `/api/chatgpt?voie=${voie}` : url,
    query: query === null ? { voie } : query,
    headers: {
      ...(jeton === null ? {} : { authorization: `Bearer ${jeton}` }),
      'x-forwarded-for': `10.0.${Math.floor(compteurIp / 250)}.${compteurIp % 250}`,
    },
    socket: { remoteAddress: '10.0.0.1' },
  };
}

/** Une empreinte SHA-256 hexadécimale plausible — la valeur qui ne doit jamais sortir. */
const EMPREINTE = 'a'.repeat(64);
const SEL = 'b'.repeat(32);

/**
 * Jeu d'essai EMPOISONNÉ : chaque collection porte des identifiants, posés aux
 * trois endroits où ils se cachent en vrai — à la racine, sous un objet
 * imbriqué, et dans un tableau.
 */
function poison(base = {}) {
  return {
    ...base,
    password_hash: EMPREINTE,
    password_salt: SEL,
    password_changed_at: '2026-09-01T10:00:00Z',
    compte: { identifiants: { password_hash: EMPREINTE, password_salt: SEL } },
    historique: [{ note: 'ok' }, { password_hash: EMPREINTE }],
  };
}

const AUJOURDHUI = '2026-09-18';
const MOIS = '2026-09';

/** Données de référence, cohérentes entre elles, et toutes empoisonnées. */
function donneesDeTest() {
  return {
    employes: [poison({ id: 'e1', nom: 'Ibrahim', salaire_base: 250000 })],
    clients: [poison({ id: 'c1', nom: 'Mairie de Moanda' })],
    factures: [
      poison({ id: 'f1', numero: 'F-001', date: `${MOIS}-04`, statut: 'envoyee', total_ttc: 120000 }),
      poison({ id: 'f2', numero: 'F-002', date: `${MOIS}-07`, statut: 'brouillon', total_ttc: 999000 }),
      poison({ id: 'f3', numero: 'F-003', date: '2026-08-31', statut: 'envoyee', total_ttc: 500000 }),
    ],
    commandes: [
      poison({
        id: 'k1', statut: 'livree', montant_total: 80000, date_creation: `${MOIS}-02`,
        historique_statuts: [{ statut: 'livree', date: `${MOIS}-05T09:00:00.000Z` }],
      }),
      poison({
        id: 'k2', statut: 'en_production', montant_total: 45000,
        date_creation: `${MOIS}-10`, date_echeance: `${MOIS}-15`,
      }),
      poison({ id: 'k3', statut: 'annulee', montant_total: 10000, date_creation: `${MOIS}-11`, date_echeance: `${MOIS}-12` }),
    ],
    rapports: [
      poison({
        id: 'r1', date: `${MOIS}-18`, activite: 'imprimerie',
        categories: { copies: 70000, imprimerie: 50000 },
        depenses: [{ description: 'Encre', montant: 20000 }],
      }),
      poison({
        id: 'r2', date: `${MOIS}-18`, activite: 'papeterie',
        // ⚠️ Piège volontaire : une recette dans la CATÉGORIE `imprimerie`,
        // sur un rapport de l'ACTIVITÉ papeterie. Les confondre déplacerait
        // 15 000 F d'une caisse à l'autre sans lever la moindre erreur.
        categories: { marchandises: 30000, imprimerie: 15000 },
        depenses: [{ description: 'Sachets', montant: 5000 }],
      }),
      poison({ id: 'r3', date: '2026-08-20', categories: { copies: 1000000 }, depenses: [] }),
    ],
    clotures_caisse: [
      poison({ id: 'cl1', date: `${MOIS}-17`, activite: 'imprimerie', montant_attendu: 95000, montant_reel: 94000, ecart: -1000 }),
      poison({ id: 'cl2', date: `${MOIS}-16`, activite: 'papeterie', montant_attendu: 20000, montant_reel: 20000, ecart: 0 }),
    ],
    produits: [
      poison({ id: 'p1', nom: 'Papier A4', quantite: 2, quantite_minimum: 10, prix_unitaire: 3000 }),
      poison({ id: 'p2', nom: 'Toner', quantite: 0, quantite_minimum: 5, prix_unitaire: 50000 }),
      poison({ id: 'p3', nom: 'Agrafes', quantite: 40, quantite_minimum: 5, prix_unitaire: 500 }),
    ],
    comptes_bancaires: [
      poison({ id: 'b1', nom: 'Caisse', solde: 150000 }),
      poison({ id: 'b2', nom: 'BGFI', solde: 900000 }),
    ],
    mouvements_financiers: [
      poison({ id: 'm1', type: 'entree', date: `${MOIS}-06`, montant: 40000, compte_id: 'b1' }),
      poison({ id: 'm2', type: 'sortie', date: `${MOIS}-05`, montant: 215000, compte_id: 'b2' }),
    ],
  };
}

/** Dépôt de LECTURE double. Enregistre ce qui a été lu ; ne sait pas écrire. */
function faussDepot(donnees = donneesDeTest()) {
  const lectures = [];
  return {
    lectures,
    async listerCollections() {
      lectures.push('listerCollections');
      return Object.entries(donnees).map(([collection, l]) => ({ collection, lignes: l.length }));
    },
    async compter(collection) {
      lectures.push(`compter:${collection}`);
      return (donnees[collection] || []).length;
    },
    async lirePage(collection, { limite = 50, decalage = 0, champ = null, valeur = null } = {}) {
      lectures.push(`lirePage:${collection}`);
      let l = donnees[collection] || [];
      if (champ) l = l.filter((x) => String(x?.[champ]) === String(valeur));
      return l.slice(decalage, decalage + limite);
    },
    async lireTout(collection) {
      lectures.push(`lireTout:${collection}`);
      return donnees[collection] || [];
    },
  };
}

/** Appelle le pont et rend `{ code, corps, depot }`. */
async function appeler(options = {}, { donnees, maintenant } = {}) {
  const depot = faussDepot(donnees);
  const handler = creerGestionnairePont({
    depot,
    maintenant: () => maintenant || new Date(Date.UTC(2026, 8, 18, 17, 12, 5)),
  });
  const res = fausseReponse();
  await handler(requete(options), res);
  return { code: res.code, corps: res.corps, depot, entetes: res.entetes };
}

/** Avec le jeton configuré, le temps du test seulement. */
function avecJeton(valeur, fn) {
  const avant = process.env.CHATGPT_BRIDGE_TOKEN;
  if (valeur === null) delete process.env.CHATGPT_BRIDGE_TOKEN;
  else process.env.CHATGPT_BRIDGE_TOKEN = valeur;
  return (async () => {
    try { return await fn(); } finally {
      if (avant === undefined) delete process.env.CHATGPT_BRIDGE_TOKEN;
      else process.env.CHATGPT_BRIDGE_TOKEN = avant;
    }
  })();
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. LECTURE SEULE — refusée avant la moindre lecture
   ═══════════════════════════════════════════════════════════════════════════ */

test('LECTURE SEULE : toute méthode autre que GET est refusée, sans rien lire', async () => {
  await avecJeton(JETON, async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']) {
      const { code, depot } = await appeler({ method });
      assert.equal(code, 405, `${method} doit être refusé`);
      assert.deepEqual(depot.lectures, [], `${method} ne doit provoquer AUCUNE lecture`);
    }
  });
});

test('LECTURE SEULE : aucun code du pont ne sait écrire en base', () => {
  const sources = [
    'api/chatgpt.js',
    'api/_lib/chatgpt-lecture.js',
    'api/_lib/chatgpt-syntheses.js',
  ];
  for (const chemin of sources) {
    const source = lire(chemin);
    for (const verbe of ['.insert(', '.update(', '.upsert(', '.delete(', '.rpc(']) {
      assert.ok(
        !source.includes(verbe),
        `${chemin} contient ${verbe} — le pont est en LECTURE SEULE, sans exception`,
      );
    }
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. UNE PORTE SANS SERRURE RESTE FERMÉE
   ═══════════════════════════════════════════════════════════════════════════ */

test('SERRURE : sans CHATGPT_BRIDGE_TOKEN, toutes les voies répondent 503 et ne servent rien', async () => {
  await avecJeton(null, async () => {
    for (const voie of VOIES_CHATGPT) {
      const { code, corps, depot } = await appeler({ voie });
      assert.equal(code, 503, `voie ${voie} : 503 attendu quand le jeton n'est pas configuré`);
      assert.deepEqual(depot.lectures, [], `voie ${voie} : aucune lecture ne doit partir`);
      assert.ok(!('collections' in (corps || {})), `voie ${voie} : rien ne doit être servi`);
    }
  });
});

test('SERRURE : un jeton configuré trop court est traité comme absent', async () => {
  await avecJeton('court', async () => {
    const { code } = await appeler({ jeton: 'court' });
    assert.equal(code, 503, 'un secret devinable n\'est pas une serrure');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. LE JETON
   ═══════════════════════════════════════════════════════════════════════════ */

test('JETON : sans en-tête Authorization, la réponse est 401 et rien n\'est lu', async () => {
  await avecJeton(JETON, async () => {
    const { code, depot } = await appeler({ jeton: null });
    assert.equal(code, 401);
    assert.deepEqual(depot.lectures, []);
  });
});

test('JETON : un mauvais jeton est refusé, y compris de la bonne longueur', async () => {
  await avecJeton(JETON, async () => {
    const mauvais = `X${JETON.slice(1)}`;
    assert.equal(mauvais.length, JETON.length, 'le test doit exercer la comparaison, pas la longueur');
    const { code, depot } = await appeler({ jeton: mauvais });
    assert.equal(code, 401);
    assert.deepEqual(depot.lectures, []);

    const { code: codeCourt } = await appeler({ jeton: 'autre' });
    assert.equal(codeCourt, 401);
  });
});

test('JETON : la comparaison est à temps constant (empreintesEgales réutilisé)', () => {
  const source = lire('api/chatgpt.js');
  assert.match(source, /empreintesEgales/, 'réutiliser empreintesEgales de api/_lib/session.js');
  assert.ok(
    !/jeton\s*===\s*process\.env|process\.env\.CHATGPT_BRIDGE_TOKEN\s*===/.test(source),
    'une comparaison === fuite le secret octet par octet',
  );
});

test('JETON : le bon jeton ouvre toutes les voies', async () => {
  await avecJeton(JETON, async () => {
    for (const voie of VOIES_CHATGPT) {
      // `collection` exige de dire QUELLE collection : on la lui donne, sinon on
      // testerait son 400 de paramètre manquant au lieu de son ouverture.
      const { code } = await appeler({ voie, query: { voie, collection: 'clients' } });
      assert.equal(code, 200, `voie ${voie} doit répondre 200 avec le bon jeton`);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. LES EMPREINTES NE SORTENT JAMAIS
   ═══════════════════════════════════════════════════════════════════════════ */

test('EMPREINTES : aucune voie ne laisse sortir une empreinte ni un sel', async () => {
  await avecJeton(JETON, async () => {
    for (const voie of VOIES_CHATGPT) {
      const { corps } = await appeler({
        voie,
        query: { voie, collection: 'employes', limite: '50' },
      });
      const texte = JSON.stringify(corps);
      assert.ok(!texte.includes(EMPREINTE), `voie ${voie} : une empreinte de mot de passe est sortie`);
      assert.ok(!texte.includes(SEL), `voie ${voie} : un sel de mot de passe est sorti`);
      for (const champ of CHAMPS_INTERDITS_PONT) {
        assert.ok(!texte.includes(champ), `voie ${voie} : le champ ${champ} est sorti`);
      }
    }
  });
});

test('EMPREINTES : le filtre atteint la racine, l\'imbriqué et les tableaux', () => {
  const propre = sansIdentifiants(poison({ id: 'e1', nom: 'Ibrahim' }));
  const texte = JSON.stringify(propre);
  assert.ok(!texte.includes(EMPREINTE));
  assert.ok(!texte.includes(SEL));
  assert.equal(propre.nom, 'Ibrahim', 'le reste de la fiche doit être conservé');
  assert.equal(propre.historique[0].note, 'ok', 'un tableau assaini reste un tableau');
  assert.equal(propre.compte.identifiants.password_hash, undefined);
});

test('EMPREINTES : la liste noire est celle de api/_lib/comptes.js, pas une copie', async () => {
  const { CHAMPS_IDENTIFIANTS } = await import('../api/_lib/comptes.js');
  assert.deepEqual([...CHAMPS_INTERDITS_PONT], [...CHAMPS_IDENTIFIANTS]);
  assert.match(
    lire('api/_lib/chatgpt-lecture.js'),
    /from '\.\/comptes\.js'/,
    'la liste noire doit être IMPORTÉE — une copie diverge le jour où un champ est ajouté',
  );
});

test('EMPREINTES : la table auth_credentials n\'est jamais lue par le pont', () => {
  for (const chemin of ['api/chatgpt.js', 'api/_lib/chatgpt-lecture.js', 'api/_lib/chatgpt-syntheses.js']) {
    assert.ok(
      !lire(chemin).includes('auth_credentials'),
      `${chemin} ne doit pas connaître la table des identifiants`,
    );
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. LES CHIFFRES SONT DATÉS, EN HEURE DE MOANDA
   ═══════════════════════════════════════════════════════════════════════════ */

test('DATE : à 23 h 30 UTC, le pont est déjà au lendemain à Moanda', () => {
  const ctx = contexteTemporel(new Date(Date.UTC(2026, 8, 18, 23, 30, 0)));
  assert.equal(ctx.date_locale, '2026-09-19', 'Africa/Libreville est à UTC+1 toute l\'année');
  assert.equal(ctx.mois_local, '2026-09');
  assert.equal(ctx.fuseau, 'Africa/Libreville');
  assert.equal(ctx.instant_utc, '2026-09-18T23:30:00Z');
  assert.match(ctx.lisible, /\(\+01:00 Africa\/Libreville\)/);
});

test('DATE : le 31 à 23 h 30 UTC, le MOIS de Moanda a déjà changé', () => {
  const ctx = contexteTemporel(new Date(Date.UTC(2026, 7, 31, 23, 30, 0)));
  assert.equal(ctx.date_locale, '2026-09-01');
  assert.equal(ctx.mois_local, '2026-09', 'un CA « ce mois » calculé en UTC compterait août');
});

test('DATE : chaque réponse porte sa date de calcul', async () => {
  await avecJeton(JETON, async () => {
    for (const voie of VOIES_CHATGPT) {
      const { corps } = await appeler({ voie, query: { voie, collection: 'clients' } });
      assert.ok(corps?.calcule_le, `voie ${voie} : la réponse doit être datée`);
      assert.equal(corps.calcule_le.fuseau, 'Africa/Libreville');
      assert.equal(corps.calcule_le.date_locale, '2026-09-18');
    }
  });
});

test('DATE : le pont n\'utilise jamais toISOString().slice ni todayISO côté serveur', () => {
  for (const chemin of ['api/chatgpt.js', 'api/_lib/chatgpt-lecture.js', 'api/_lib/chatgpt-syntheses.js']) {
    const source = lire(chemin);
    assert.ok(!/toISOString\(\)\s*\.\s*(slice|split)/.test(source), `${chemin} : la date du serveur n'est pas celle de Moanda`);
    assert.ok(!/\btodayISO\b/.test(source), `${chemin} : todayISO() rend la date du serveur Vercel (UTC)`);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   6. LES SYNTHÈSES — les chiffres eux-mêmes
   ═══════════════════════════════════════════════════════════════════════════ */

test('CA : facturé, livré et encaissé sont TROIS chiffres, jamais confondus', () => {
  const d = donneesDeTest();
  const ca = chiffreAffairesDuMois({
    mois: MOIS,
    factures: d.factures,
    commandes: d.commandes,
    rapports: d.rapports,
  });

  // Facturé : F-001 seule. F-002 est un brouillon (pas émise), F-003 est d'août.
  assert.equal(ca.facture.montant, 120000);
  assert.equal(ca.facture.brouillons_exclus.montant, 999000, 'un brouillon exclu doit rester visible');

  // Livré : la commande k1, datée par son passage au statut « livrée ».
  assert.equal(ca.livre.montant, 80000);

  // Encaissé : les recettes des rapports du mois, les deux caisses confondues.
  // r1 = 120 000, r2 = 45 000. r3 est d'août.
  assert.equal(ca.encaisse.montant, 165000);

  assert.notEqual(ca.facture.montant, ca.livre.montant);
  assert.notEqual(ca.livre.montant, ca.encaisse.montant);
  for (const cle of ['facture', 'livre', 'encaisse']) {
    assert.equal(typeof ca[cle].definition, 'string', `${cle} doit porter sa définition`);
    assert.ok(ca[cle].definition.length > 20);
  }
});

test('CA : une commande annulée n\'est jamais comptée comme livrée', () => {
  const ca = chiffreAffairesDuMois({
    mois: MOIS,
    factures: [],
    commandes: [{ id: 'x', statut: 'annulee', montant_total: 999999, date_creation: `${MOIS}-03` }],
    rapports: [],
  });
  assert.equal(ca.livre.montant, 0);
});

test('CAISSE : une recette de la CATÉGORIE imprimerie sur un rapport PAPETERIE reste en papeterie', () => {
  const d = donneesDeTest();
  const etat = etatCaisseParActivite({
    rapports: d.rapports,
    clotures: d.clotures_caisse,
    comptes: d.comptes_bancaires,
    aujourdhui: AUJOURDHUI,
  });

  const impr = etat.activites.find((a) => a.activite === 'imprimerie');
  const pap = etat.activites.find((a) => a.activite === 'papeterie');

  assert.equal(impr.recettes_du_jour, 120000);
  assert.equal(impr.depenses_du_jour, 20000);
  assert.equal(impr.caisse_attendue, 100000);

  // 30 000 de marchandises + 15 000 dans la catégorie `imprimerie` = 45 000,
  // tout entiers du côté papeterie. Les 15 000 ne doivent PAS migrer.
  assert.equal(pap.recettes_du_jour, 45000);
  assert.equal(pap.caisse_attendue, 40000);

  assert.equal(impr.derniere_cloture.date, `${MOIS}-17`);
  assert.equal(pap.derniere_cloture.date, `${MOIS}-16`);
});

test('CAISSE : un rapport sans champ activite compte pour l\'imprimerie, jamais pour la papeterie', () => {
  const etat = etatCaisseParActivite({
    rapports: [{ id: 'r', date: AUJOURDHUI, categories: { copies: 10000 }, depenses: [] }],
    clotures: [],
    comptes: [],
    aujourdhui: AUJOURDHUI,
  });
  const impr = etat.activites.find((a) => a.activite === 'imprimerie');
  const pap = etat.activites.find((a) => a.activite === 'papeterie');
  assert.equal(impr.recettes_du_jour, 10000);
  assert.equal(pap.recettes_du_jour, 0);
});

test('COMMANDES : « en retard » = échéance passée, et ni livrée ni annulée', () => {
  const r = commandesParStatut({
    commandes: [
      { id: 'a', statut: 'en_production', date_echeance: '2026-09-15', montant_total: 45000 },
      { id: 'b', statut: 'livree', date_echeance: '2026-09-01', montant_total: 80000 },
      { id: 'c', statut: 'annulee', date_echeance: '2026-09-02', montant_total: 10000 },
      { id: 'd', statut: 'prete', date_echeance: '2026-09-30', montant_total: 5000 },
      { id: 'e', statut: 'en_cours', date_echeance: '2026-09-17', montant_total: 7000 },
    ],
    aujourdhui: AUJOURDHUI,
  });

  const retard = r.en_retard.map((c) => c.id).sort();
  assert.deepEqual(retard, ['a', 'e'], 'livrée et annulée ne sont jamais en retard');

  // Les anciens libellés sont ramenés aux statuts actuels, comme à l'écran.
  const production = r.par_statut.find((s) => s.statut === 'en_production');
  assert.equal(production.nombre, 2, '« en_cours » est un alias de « en_production »');
  assert.equal(production.montant, 52000);
});

test('COMMANDES : sans échéance, une commande n\'est pas déclarée en retard', () => {
  const r = commandesParStatut({
    commandes: [{ id: 'z', statut: 'en_production', montant_total: 1000 }],
    aujourdhui: AUJOURDHUI,
  });
  assert.equal(r.en_retard.length, 0, 'affirmer un retard sans échéance serait un chiffre inventé');
});

test('STOCK : rupture et seuil bas, avec le seuil du gérant — jamais un 10 imposé', () => {
  const a = alertesStock({
    produits: [
      { id: 'p1', nom: 'Papier A4', quantite: 2, quantite_minimum: 10 },
      { id: 'p2', nom: 'Toner', quantite: 0, quantite_minimum: 5 },
      { id: 'p3', nom: 'Agrafes', quantite: 40, quantite_minimum: 5 },
      { id: 'p4', nom: 'Colle', quantite: 4, quantite_minimum: 3 },
    ],
  });
  assert.equal(a.ruptures.length, 1);
  assert.equal(a.ruptures[0].nom, 'Toner');
  assert.equal(a.seuil_bas.length, 1);
  assert.equal(a.seuil_bas[0].nom, 'Papier A4');
  assert.equal(a.nombre_en_alerte, 2);
});

/* ═══════════════════════════════════════════════════════════════════════════
   7. L'INVENTAIRE ET LA LECTURE D'UNE COLLECTION
   ═══════════════════════════════════════════════════════════════════════════ */

test('INVENTAIRE : la liste des collections avec leur nombre de lignes', async () => {
  await avecJeton(JETON, async () => {
    const { code, corps } = await appeler({ voie: 'inventaire' });
    assert.equal(code, 200);
    const noms = corps.collections.map((c) => c.collection);
    assert.ok(noms.includes('factures'));
    assert.ok(noms.includes('employes'));
    const factures = corps.collections.find((c) => c.collection === 'factures');
    assert.equal(factures.lignes, 3);
  });
});

test('COLLECTION : pagination et filtre simple sur un champ', async () => {
  await avecJeton(JETON, async () => {
    const page = await appeler({ query: { voie: 'collection', collection: 'commandes', limite: '2' } });
    assert.equal(page.code, 200);
    assert.equal(page.corps.lignes.length, 2);
    assert.equal(page.corps.total, 3);

    const filtre = await appeler({
      query: { voie: 'collection', collection: 'commandes', champ: 'statut', valeur: 'livree' },
    });
    assert.equal(filtre.corps.lignes.length, 1);
    assert.equal(filtre.corps.lignes[0].id, 'k1');
  });
});

test('COLLECTION : sans nom de collection, la réponse dit quoi demander', async () => {
  await avecJeton(JETON, async () => {
    const { code, corps } = await appeler({ query: { voie: 'collection' } });
    assert.equal(code, 400);
    assert.match(String(corps.error), /collection/i);
  });
});

test('COLLECTION : une page trop lourde est refusée en disant quoi faire', async () => {
  // `produits_catalogue` porte 195 lignes dont UNE de 3,2 Mo d'images en base64.
  // Servie telle quelle, Vercel rejette la réponse avec une erreur de plateforme
  // que ChatGPT rend par « l'outil n'a pas répondu » — introuvable pour le gérant.
  const lourd = { produits_catalogue: [{ id: 'gros', image: 'x'.repeat(5 * 1024 * 1024) }] };
  await avecJeton(JETON, async () => {
    const { code, corps } = await appeler(
      { query: { voie: 'collection', collection: 'produits_catalogue' } },
      { donnees: lourd },
    );
    assert.equal(code, 413);
    assert.match(String(corps.detail), /limite/i, 'le refus doit dire comment demander moins');
    assert.ok(corps.calcule_le, 'même un refus est daté');
  });
});

test('COLLECTION : un nom de champ hostile est refusé, pas interprété', async () => {
  await avecJeton(JETON, async () => {
    const { code } = await appeler({
      query: { voie: 'collection', collection: 'clients', champ: 'data->>x,id', valeur: '1' },
    });
    assert.equal(code, 400, 'un champ hors [a-z0-9_] ne doit jamais atteindre la requête');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   8. ROUTAGE, PLAFOND ET SCHÉMA
   ═══════════════════════════════════════════════════════════════════════════ */

test('ROUTAGE : chemins historiques, paramètre voie, et refus net de l\'inconnu', () => {
  for (const [chemin, voie] of Object.entries(CHEMINS_CHATGPT)) {
    assert.equal(voieChatGPT({ url: chemin, query: {} }), voie);
  }
  assert.equal(voieChatGPT({ url: '/api/chatgpt', query: { voie: 'ca-mois' } }), 'ca-mois');
  assert.equal(voieChatGPT({ url: '/api/chatgpt', query: { voie: 'supprime-tout' } }), null);
  assert.equal(voieChatGPT({ url: '/api/chatgpt', query: {} }), null, 'pas de voie par défaut');
});

test('ROUTAGE : une voie inconnue répond 404 sans rien lire', async () => {
  await avecJeton(JETON, async () => {
    const { code, depot } = await appeler({ query: { voie: 'inventee' } });
    assert.equal(code, 404);
    assert.deepEqual(depot.lectures, []);
  });
});

test('PLAFOND HOBBY : api/ contient EXACTEMENT 12 fonctions, jamais 13', () => {
  const fichiers = readdirSync(new URL('api/', racine)).filter((f) => f.endsWith('.js'));
  assert.ok(
    fichiers.length <= 12,
    `api/ contient ${fichiers.length} fonctions (${fichiers.join(', ')}) : `
    + 'le plan Hobby en accepte 12 au maximum. Un déploiement à 13 échoue entièrement.',
  );
  assert.ok(fichiers.includes('chatgpt.js'), 'le pont doit être UN seul fichier à la racine d\'api/');
  for (const interdit of ['chatgpt-lecture.js', 'chatgpt-syntheses.js']) {
    assert.ok(!fichiers.includes(interdit), `${interdit} doit vivre dans api/_lib/, qui ne compte pas`);
  }
});

test('DÉBIT : le pont a sa propre portée, il n\'emprunte le plafond de personne', () => {
  assert.match(lire('api/chatgpt.js'), /portee:\s*'chatgpt'/);
  assert.match(lire('api/chatgpt.js'), /limiteDepassee/);
});

test('SCHÉMA : OpenAPI 3.1, en français, avec une opération par voie', async () => {
  const { corps } = await avecJeton(JETON, () => appeler({ voie: 'schema' }));
  const schema = corps.schema;
  assert.match(schema.openapi, /^3\.1/);
  assert.ok(schema.info?.description, 'le schéma doit dire à quoi il sert');

  for (const [chemin, def] of Object.entries(schema.paths)) {
    assert.ok(def.get, `${chemin} : seule la lecture est exposée`);
    for (const verbe of ['post', 'put', 'patch', 'delete']) {
      assert.ok(!def[verbe], `${chemin} : le schéma ne doit proposer aucun ${verbe.toUpperCase()}`);
    }
    assert.ok(def.get.operationId, `${chemin} : operationId manquant`);
    assert.ok(
      (def.get.description || '').length > 40,
      `${chemin} : la description doit dire à ChatGPT QUAND s'en servir`,
    );
  }

  // Chaque voie utile doit avoir son chemin — sinon ChatGPT ne peut pas l'appeler.
  const chemins = Object.keys(schema.paths);
  for (const attendu of Object.keys(CHEMINS_CHATGPT)) {
    assert.ok(chemins.includes(attendu), `le schéma doit exposer ${attendu}`);
  }
});

test('SCHÉMA : le fichier du dépôt et la voie servie sont le MÊME schéma', async () => {
  const fichier = JSON.parse(lire('api/_lib/chatgpt-openapi.json'));
  const { corps } = await avecJeton(JETON, () => appeler({ voie: 'schema' }));
  assert.deepEqual(corps.schema, fichier, 'deux schémas qui divergent = un GPT qui appelle dans le vide');
});

test('VERCEL : les réécritures du pont passent AVANT la règle générique /api/(.*)', () => {
  const vercel = JSON.parse(lire('vercel.json'));
  const sources = vercel.rewrites.map((r) => r.source);
  const generique = sources.indexOf('/api/(.*)');
  assert.ok(generique > -1);
  for (const chemin of Object.keys(CHEMINS_CHATGPT)) {
    const i = sources.indexOf(chemin);
    assert.ok(i > -1, `réécriture manquante pour ${chemin}`);
    assert.ok(i < generique, `${chemin} doit précéder /api/(.*) — la première règle qui correspond gagne`);
    const dest = vercel.rewrites[i].destination;
    assert.equal(dest, `/api/chatgpt?voie=${CHEMINS_CHATGPT[chemin]}`);
  }
  assert.equal(sources[sources.length - 1], '/((?!api/).*)', 'l\'attrape-tout de l\'application reste dernier');
});

test('RÉVOCATION : la marche à suivre est écrite, pas seulement connue', () => {
  // `racine` est déjà le dossier `app/` : le dossier des livrables est son frère.
  const doc = readFileSync(new URL('../livrables_claude/PONT_CHATGPT.md', racine), 'utf8');
  assert.match(doc, /CHATGPT_BRIDGE_TOKEN/);
  assert.match(doc, /révoquer|Révoquer|RÉVOQUER/);
});
