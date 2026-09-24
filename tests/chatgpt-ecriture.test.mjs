/**
 * LE PONT CHATGPT SAIT MAINTENANT ÉCRIRE — et voici ce qui le retient.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CE QUE LE DIRIGEANT A DEMANDÉ, MOT POUR MOT
 * ════════════════════════════════════════════════════════════════════════════
 *
 * « On aimerait, depuis ChatGPT, demander de changer quelque chose dans
 * l'application. Par exemple : "Aujourd'hui j'ai payé 100 000 francs de
 * travaux, donc tu mets dans la partie Travaux." Ou : "Cette semaine on n'a pas
 * pu faire le dépôt sur la banque, on a gardé en cash." »
 *
 * Et sur la confirmation, il a tranché : « sans confirmation, il écrit direct —
 * mais qu'on puisse quand même modifier si c'est mal fait. »
 *
 * ⚠️ OBJECTION, POSÉE UNE FOIS ET PAS REDISCUTÉE ENSUITE : un assistant
 * conversationnel se trompe de montant, de compte et de date sans jamais
 * hésiter, et ici il écrit dans une caisse réelle sans que personne ne relise.
 * Le dirigeant a tranché en connaissance de cause. Ce fichier ne rediscute pas
 * ce choix : il vérifie que ce qui protège À LA PLACE de la confirmation tient
 * vraiment — provenance, journal, annulation, idempotence.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LES HUIT GARANTIES, ET POURQUOI CHACUNE
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  1. UNE LISTE FERMÉE DE GESTES. Pas « écrire dans n'importe quelle
 *     collection » : cinq opérations nommées, chacune avec ses champs. Tout le
 *     reste — paie, salaires, associés, comptes bancaires eux-mêmes,
 *     utilisateurs — est refusé, et le refus est vérifié sur la SOURCE, pas
 *     seulement sur le comportement.
 *
 *  2. LE VERBE SÉPARE LES DEUX MOITIÉS DU PONT. GET reste refusé sur les voies
 *     d'écriture, POST reste refusé sur les voies de lecture. Un assistant qui
 *     se trompe de verbe ne doit pas tomber par hasard sur la bonne porte.
 *
 *  3. PAS DE JETON, PAS D'ÉCRITURE. Le contrôle est le même que pour la
 *     lecture, et il passe AVANT la moindre écriture.
 *
 *  4. CHAQUE ÉCRITURE PORTE SA PROVENANCE : le marqueur « via ChatGPT », la
 *     phrase exacte de l'utilisateur, et l'horodatage en heure de MOANDA — pas
 *     celle du serveur Vercel, qui tourne en UTC.
 *
 *  5. CHAQUE ÉCRITURE EST JOURNALISÉE AVANT D'AVOIR LIEU, comme le fait déjà
 *     l'import administrateur. Si l'écriture échoue au milieu, on sait quand
 *     même ce qui a été tenté.
 *
 *  6. IDEMPOTENCE PAR LE TÉMOIN DE L'EFFET. ChatGPT renvoie deux fois la même
 *     demande (réseau, relance) : la même clé ne produit qu'UNE écriture. Le
 *     témoin est la ligne écrite elle-même — jamais un statut intermédiaire,
 *     jamais un drapeau « en cours ».
 *
 *  7. ANNULER COMPENSE, N'EFFACE PAS. Un mouvement annulé reçoit son mouvement
 *     inverse et le solde revient à sa valeur ; la ligne d'origine reste en
 *     base. C'est la règle comptable, et c'est déjà celle du dépôt
 *     (src/services/contre-passation-commande.js).
 *
 *  8. AUCUN MOUVEMENT SANS COMPTE. Le piège documenté du dépôt : un
 *     `mouvements_financiers` écrit avec `compte_id` vide ne débite JAMAIS le
 *     compte — le journal montre une sortie, le solde ne bouge pas, et même
 *     supprimer la ligne ensuite ne corrige rien (`effetSurSoldes` rend un
 *     objet vide sans identifiant de compte). C'est une fuite d'argent
 *     silencieuse. Ici, c'est un refus.
 *
 * Lancer :  node --test tests/chatgpt-ecriture.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const racine = new URL('../', import.meta.url);
const lire = (chemin) => readFileSync(new URL(chemin, racine), 'utf8');

const {
  creerGestionnairePont,
  VOIES_CHATGPT,
  VOIES_ECRITURE,
  VOIES_LECTURE,
  CHEMINS_CHATGPT,
} = await import('../api/chatgpt.js');

const {
  GESTES,
  GESTES_NON_LIVRES,
  BESOINS_CONTEXTE,
  COLLECTIONS_ECRITURES,
  COLLECTIONS_INTERDITES,
  collectionAutorisee,
  preparerGeste,
  planAnnulation,
  CHAMP_MARQUEUR,
  CHAMP_CLE,
} = await import('../src/services/chatgpt-gestes.js');

/* ═══════════════════════════════════════════════════════════════════════════
   Harnais — une requête, une réponse, un dépôt en mémoire, aucun réseau
   ═══════════════════════════════════════════════════════════════════════════ */

function fausseReponse() {
  const r = { code: null, corps: null, entetes: {}, termine: false };
  r.status = (c) => { r.code = c; return r; };
  r.json = (o) => { r.corps = o; r.termine = true; return r; };
  r.send = (o) => { r.corps = o; r.termine = true; return r; };
  r.end = () => { r.termine = true; return r; };
  r.setHeader = (k, v) => { r.entetes[String(k).toLowerCase()] = v; return r; };
  return r;
}

const JETON = 'jeton-de-test-du-pont-chatgpt-0123456789';

/** L'instant de référence : 18 septembre 2026, 17 h 12 UTC = 18 h 12 à Moanda. */
const INSTANT = new Date(Date.UTC(2026, 8, 18, 17, 12, 5));
/** Le même jour, 23 h 30 UTC — à Moanda on est DÉJÀ le 19. */
const INSTANT_MINUIT = new Date(Date.UTC(2026, 8, 18, 23, 30, 0));

let compteurIp = 0;
function requete({
  voie = 'depense', jeton = JETON, method = 'POST', url = null, query = null, corps = null,
  entetes = {},
} = {}) {
  compteurIp += 1;
  return {
    method,
    url: url === null ? `/api/chatgpt?voie=${voie}` : url,
    query: query === null ? { voie } : query,
    body: corps,
    headers: {
      ...(jeton === null ? {} : { authorization: `Bearer ${jeton}` }),
      'content-type': 'application/json',
      'x-forwarded-for': `10.9.${Math.floor(compteurIp / 250)}.${compteurIp % 250}`,
      ...entetes,
    },
    socket: { remoteAddress: '10.9.0.1' },
  };
}

/** Les comptes RÉELS de la base de production (mesurés le 18/09/2026). */
function comptesDeTest() {
  return [
    { id: 'cpt-finam', nom: 'FINAM', solde: 785000 },
    { id: 'cpt-bgfi', nom: 'BGFI GABON ', solde: 890000 },
    { id: 'cpt-airtel', nom: 'Airtel Money', solde: 0 },
    { id: 'cpt-moov', nom: 'Moov Money', solde: 0 },
    { id: 'cpt-caisse', nom: 'LIQUIDE ARGENT Hebdo', solde: 608000 },
  ];
}

/**
 * Dépôt d'écriture DOUBLE, en mémoire.
 *
 * Il rejoue la seule contrainte de la vraie base qui compte ici : l'index
 * unique partiel sur `mouvements_financiers.reference`, posé par la migration
 * 005 et vérifié valide en production le 18/09/2026. Sans lui, le test de
 * l'idempotence passerait avec un code qui ne tient que par sa lecture
 * préalable — c'est-à-dire un code qui perd la course.
 */
function faussDepot({
  comptes = comptesDeTest(),
  projets = [{ id: 'prj-1', nom: 'Atelier' }],
  tablesInitiales = {},
} = {}) {
  const tables = {
    mouvements_financiers: [],
    etapes_travaux: [],
    taches: [],
    depots_hebdo: [],
    projets_travaux: [],
    produits_catalogue: [],
    produits: [],
    mouvements_stock: [],
    rapports: [],
    commandes: [],
    clients: [],
    evenements: [],
    prospects: [],
    objectifs: [],
    clotures_caisse: [],
    devis: [],
    factures: [],
    audit_logs: [],
    ...Object.fromEntries(Object.entries(tablesInitiales).map(([k, v]) => [k, v.map((x) => ({ ...x }))])),
  };
  const soldes = new Map(comptes.map((c) => [c.id, Number(c.solde) || 0]));
  const trace = [];

  return {
    tables,
    soldes,
    trace,
    async listerComptes() { trace.push('listerComptes'); return comptes.map((c) => ({ ...c, solde: soldes.get(c.id) })); },
    async listerProjets() { trace.push('listerProjets'); return projets.map((p) => ({ ...p })); },
    /**
     * La lecture PROJETÉE du vrai dépôt, rejouée : elle ne rend QUE les champs
     * demandés. Un geste qui aurait besoin d'un champ non projeté doit échouer
     * ici comme il échouerait en production, pas passer parce que le double est
     * plus généreux que la base.
     */
    async listerLeger(collection, champs) {
      trace.push(`listerLeger:${collection}`);
      return (tables[collection] || []).map((l) => {
        const sortie = { id: l.id };
        for (const c of champs) sortie[c] = l[c];
        return sortie;
      });
    },
    async listerRapportsDuJour(date) {
      trace.push(`listerRapportsDuJour:${date}`);
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
      return (tables.rapports || []).filter((r) => r.date === date).map((r) => ({ ...r }));
    },
    async chercherParCle(collection, cle) {
      trace.push(`chercherParCle:${collection}`);
      const l = (tables[collection] || []).find((x) => x[CHAMP_CLE] === cle);
      return l ? { id: l.id, data: { ...l } } : null;
    },
    async chercherMouvementParReference(reference) {
      trace.push('chercherMouvementParReference');
      const l = tables.mouvements_financiers.find((x) => x.reference === reference);
      return l ? { id: l.id, data: { ...l } } : null;
    },
    async lireLigne(collection, id) {
      trace.push(`lireLigne:${collection}`);
      const l = (tables[collection] || []).find((x) => x.id === id);
      return l ? { id: l.id, data: { ...l } } : null;
    },
    async creer(collection, data) {
      trace.push(`creer:${collection}`);
      if (!tables[collection]) throw new Error(`collection non prévue par le double : ${collection}`);
      // L'index unique partiel de la migration 005, rejoué.
      if (collection === 'mouvements_financiers' && data.reference) {
        const deja = tables.mouvements_financiers.some((m) => m.reference === data.reference);
        if (deja) return { insere: false, id: null, raison: 'doublon rejeté par la base' };
      }
      tables[collection].push({ ...data });
      return { insere: true, id: data.id };
    },
    async modifier(collection, id, champs) {
      trace.push(`modifier:${collection}`);
      const l = (tables[collection] || []).find((x) => x.id === id);
      if (!l) throw new Error(`ligne introuvable : ${collection}/${id}`);
      Object.assign(l, champs);
      return { ...l };
    },
    async ajusterSolde(compteId, delta) {
      trace.push(`ajusterSolde:${compteId}`);
      if (!soldes.has(compteId)) throw new Error(`compte inconnu : ${compteId}`);
      soldes.set(compteId, soldes.get(compteId) + delta);
    },
    async journaliser(entree) {
      trace.push('journaliser');
      tables.audit_logs.push({ ...entree });
    },
    async listerEcritures() {
      trace.push('listerEcritures');
      const tout = [];
      for (const [collection, lignes] of Object.entries(tables)) {
        if (collection === 'audit_logs') continue;
        for (const l of lignes) if (l[CHAMP_MARQUEUR]) tout.push({ collection, data: { ...l } });
      }
      return tout;
    },
  };
}

async function appeler(options = {}, { depot, maintenant } = {}) {
  const d = depot || faussDepot();
  const handler = creerGestionnairePont({
    depot: d,
    depotEcriture: d,
    maintenant: () => maintenant || INSTANT,
  });
  const res = fausseReponse();
  await handler(requete(options), res);
  return { code: res.code, corps: res.corps, depot: d };
}

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

/** Le corps type d'une dépense — la phrase du dirigeant, transposée. */
function corpsDepense(extra = {}) {
  return {
    cle: 'depense-2026-09-18-001',
    phrase: "Aujourd'hui j'ai payé 100 000 francs de travaux",
    montant: 100000,
    motif: 'Travaux atelier',
    compte: 'caisse',
    ...extra,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. UNE LISTE FERMÉE DE GESTES
   ═══════════════════════════════════════════════════════════════════════════ */

test('GESTES : la liste est fermée, et couvre exactement ce que le dirigeant a décrit', () => {
  assert.deepEqual(
    [...GESTES].sort(),
    [
      // Périmètre d'origine — « une dépense, une recette, la caisse, les travaux, une tâche »
      'caisse-mouvement', 'depense', 'recette', 'tache', 'travaux',
      // Élargissement — « les événements et tous les trucs possibles de tous les modules »
      'catalogue', 'client', 'cloture-caisse', 'commande', 'devis', 'evenement',
      'facture', 'objectif', 'projet-travaux', 'prospect', 'rapport', 'stock-mouvement',
    ].sort(),
    'la liste est FERMÉE : on y ajoute des entrées nommées, on ne l’ouvre jamais',
  );
});

test('GESTES : ce qui n’est PAS livré est nommé, avec sa raison', () => {
  // Un geste écarté sans raison écrite redevient « oublié » à la relecture
  // suivante, et quelqu'un le rajoute sans savoir pourquoi il manquait.
  for (const attendu of [
    'commande-livree', 'commande-annulee', 'devis-converti',
    'pointage', 'demande-rh', 'charge-fixe', 'messagerie',
  ]) {
    assert.ok(GESTES_NON_LIVRES[attendu], `${attendu} doit figurer parmi les gestes non livrés`);
    assert.ok(
      GESTES_NON_LIVRES[attendu].length > 80,
      `${attendu} : la raison doit être exploitable, pas un mot`,
    );
    assert.ok(!GESTES.includes(attendu), `${attendu} ne doit pas être servi`);
  }
});

test('GESTES : chaque geste annoncé a bien une fabrique qui sait l’exécuter', () => {
  const ctx = {
    instant_utc: '2026-09-18T17:12:05Z', date_locale: '2026-09-18', heure_locale: '18:12:05',
    mois_local: '2026-09', fuseau: 'Africa/Libreville', offset_utc: '+01:00', lisible: 'x',
  };
  for (const geste of GESTES) {
    // Corps volontairement vide : on ne teste pas la validation, on teste que
    // le geste est ROUTÉ. Un geste annoncé à ChatGPT sans fabrique derrière le
    // ferait appeler dans le vide, et le refus ressemblerait à une faute de
    // frappe de l'utilisateur.
    const r = preparerGeste(geste, { cle: 'cle-de-test', phrase: 'p' }, { ctx, comptes: [], projets: [] });
    assert.ok(
      r.erreur !== 'Geste non servi' && r.erreur !== 'Geste inconnu',
      `${geste} est annoncé dans GESTES mais aucune fabrique ne le sert`,
    );
  }
});

test('GESTES : chaque geste déclare ce que le dépôt doit lire pour lui', () => {
  for (const geste of GESTES) {
    assert.ok(
      Array.isArray(BESOINS_CONTEXTE[geste]),
      `${geste} n’a pas d’entrée dans BESOINS_CONTEXTE : le dépôt ne saura pas quoi lire, `
      + 'et la fabrique refusera le geste pour une raison fausse',
    );
  }
  for (const geste of Object.keys(BESOINS_CONTEXTE)) {
    assert.ok(GESTES.includes(geste), `BESOINS_CONTEXTE décrit « ${geste} », qui n’est pas un geste servi`);
  }
});

test('INTERDITS : paie, salaires, associés, comptes et utilisateurs sont refusés', () => {
  const interdits = [
    'employes', 'users', 'pointages', 'performances_employes', 'demandes_rh',
    'apports_associes', 'dettes_associes', 'remboursements_associes',
    'actionnaires', 'investisseurs', 'modifications_investisseurs',
    'comptes_bancaires', 'gouvernance_parametres', 'parametres',
  ];
  for (const c of interdits) {
    assert.equal(
      collectionAutorisee(c), false,
      `${c} doit rester à la main : ChatGPT n'y touche jamais`,
    );
    assert.ok(
      COLLECTIONS_INTERDITES.includes(c),
      `${c} doit figurer explicitement dans la liste noire, pas seulement être absent de la blanche`,
    );
  }
});

test('INTERDITS : les seules collections écrites sont celles des gestes servis', () => {
  assert.deepEqual(
    [...COLLECTIONS_ECRITURES].sort(),
    [
      'clients', 'clotures_caisse', 'commandes', 'depots_hebdo', 'devis', 'etapes_travaux',
      'evenements', 'factures', 'mouvements_financiers', 'mouvements_stock', 'objectifs',
      'produits', 'produits_catalogue', 'projets_travaux', 'prospects', 'rapports', 'taches',
    ].sort(),
    'toute collection de plus est une porte ouverte que personne n\'a demandée',
  );
  for (const c of COLLECTIONS_ECRITURES) assert.equal(collectionAutorisee(c), true);
  // Et aucune collection écrite ne doit figurer dans la liste noire : ce serait
  // une contradiction que seul un test peut voir.
  for (const c of COLLECTIONS_ECRITURES) {
    assert.ok(!COLLECTIONS_INTERDITES.includes(c), `${c} est à la fois écrite et interdite`);
  }
});

test('INTERDITS : une demande de geste inconnu est refusée sans rien écrire', async () => {
  await avecJeton(JETON, async () => {
    const { code, depot } = await appeler({ voie: 'salaire', corps: corpsDepense() });
    assert.equal(code, 404, 'une voie inconnue ne doit jamais être servie');
    assert.deepEqual(depot.tables.mouvements_financiers, []);
    assert.deepEqual(depot.tables.audit_logs, []);
  });
});

test('INTERDITS : le module d\'écriture ne nomme AUCUNE collection interdite', () => {
  const sources = ['api/_lib/chatgpt-ecriture.js', 'src/services/chatgpt-gestes.js'];
  // `COLLECTIONS_INTERDITES` est forcément citée dans la liste noire elle-même :
  // on ne cherche donc que les usages en ÉCRITURE, pas les simples mentions.
  const verbes = ['insert', 'update', 'upsert', 'delete', 'creer', 'modifier'];
  for (const chemin of sources) {
    const source = lire(chemin);
    for (const collection of ['employes', 'apports_associes', 'dettes_associes', 'actionnaires', 'users']) {
      for (const verbe of verbes) {
        const motif = new RegExp(`${verbe}[^\\n]{0,40}['"\`]${collection}['"\`]`, 'i');
        assert.ok(
          !motif.test(source),
          `${chemin} : ${verbe} sur ${collection} — cette collection reste à la main`,
        );
      }
    }
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. LE VERBE SÉPARE LES DEUX MOITIÉS DU PONT
   ═══════════════════════════════════════════════════════════════════════════ */

test('MÉTHODE : les deux moitiés du pont ne se recouvrent pas', () => {
  for (const v of VOIES_ECRITURE) {
    assert.ok(VOIES_CHATGPT.includes(v), `${v} doit être une voie servie`);
    assert.ok(!VOIES_LECTURE.includes(v), `${v} ne peut pas être à la fois lecture et écriture`);
  }
  for (const v of VOIES_LECTURE) assert.ok(VOIES_CHATGPT.includes(v));
  assert.deepEqual(
    [...VOIES_CHATGPT].sort(),
    [...new Set([...VOIES_LECTURE, ...VOIES_ECRITURE])].sort(),
    'aucune voie ne doit être ni lecture ni écriture',
  );
});

test('MÉTHODE : GET est refusé sur CHAQUE voie d\'écriture, sans rien écrire', async () => {
  await avecJeton(JETON, async () => {
    for (const voie of VOIES_ECRITURE) {
      const { code, depot } = await appeler({ voie, method: 'GET', corps: corpsDepense() });
      assert.equal(code, 405, `GET ${voie} doit être refusé`);
      assert.deepEqual(depot.tables.mouvements_financiers, [], `GET ${voie} ne doit RIEN écrire`);
      assert.deepEqual(depot.tables.audit_logs, [], `GET ${voie} ne doit rien journaliser`);
    }
  });
});

test('MÉTHODE : POST est refusé sur CHAQUE voie de lecture, sans rien écrire', async () => {
  await avecJeton(JETON, async () => {
    for (const voie of VOIES_LECTURE) {
      const { code, depot } = await appeler({ voie, method: 'POST', corps: corpsDepense() });
      assert.equal(code, 405, `POST ${voie} doit être refusé — la lecture reste en lecture`);
      assert.deepEqual(depot.tables.mouvements_financiers, [], `POST ${voie} ne doit RIEN écrire`);
    }
  });
});

test('MÉTHODE : PUT, PATCH et DELETE ne sont jamais acceptés, nulle part', async () => {
  await avecJeton(JETON, async () => {
    for (const method of ['PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']) {
      for (const voie of VOIES_CHATGPT) {
        const { code } = await appeler({ voie, method, corps: corpsDepense() });
        assert.equal(code, 405, `${method} ${voie} doit être refusé`);
      }
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. PAS DE JETON, PAS D'ÉCRITURE
   ═══════════════════════════════════════════════════════════════════════════ */

test('JETON : une écriture sans jeton est refusée, et rien n\'est écrit', async () => {
  await avecJeton(JETON, async () => {
    for (const voie of VOIES_ECRITURE) {
      const { code, depot } = await appeler({ voie, jeton: null, corps: corpsDepense() });
      assert.equal(code, 401, `${voie} sans jeton : 401 attendu`);
      assert.deepEqual(depot.tables.mouvements_financiers, []);
      assert.deepEqual(depot.tables.audit_logs, [], 'un appel non authentifié ne journalise rien');
    }
  });
});

test('JETON : un mauvais jeton n\'écrit rien, même de la bonne longueur', async () => {
  await avecJeton(JETON, async () => {
    const mauvais = `X${JETON.slice(1)}`;
    assert.equal(mauvais.length, JETON.length);
    const { code, depot } = await appeler({ jeton: mauvais, corps: corpsDepense() });
    assert.equal(code, 401);
    assert.deepEqual(depot.tables.mouvements_financiers, []);
  });
});

test('SERRURE : sans CHATGPT_BRIDGE_TOKEN, aucune voie d\'écriture ne sert', async () => {
  await avecJeton(null, async () => {
    for (const voie of VOIES_ECRITURE) {
      const { code, depot } = await appeler({ voie, corps: corpsDepense() });
      assert.equal(code, 503, `${voie} : une porte sans serrure reste fermée`);
      assert.deepEqual(depot.tables.mouvements_financiers, []);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. LA PROVENANCE — le remplacement de la confirmation
   ═══════════════════════════════════════════════════════════════════════════ */

test('PROVENANCE : chaque écriture porte le marqueur, la phrase et l\'heure de Moanda', async () => {
  await avecJeton(JETON, async () => {
    const { code, corps, depot } = await appeler({ voie: 'depense', corps: corpsDepense() });
    assert.equal(code, 201, `écriture refusée : ${JSON.stringify(corps)}`);
    const [mvt] = depot.tables.mouvements_financiers;
    assert.ok(mvt, 'le mouvement doit exister');

    assert.equal(mvt[CHAMP_MARQUEUR], true, 'le marqueur doit être À PLAT : c\'est lui qui rend la ligne filtrable');
    assert.equal(mvt[CHAMP_CLE], 'depense-2026-09-18-001');
    assert.equal(mvt.chatgpt.phrase, "Aujourd'hui j'ai payé 100 000 francs de travaux");
    assert.equal(mvt.chatgpt.geste, 'depense');
    assert.equal(mvt.chatgpt.ecrit_le.fuseau, 'Africa/Libreville');
    assert.equal(mvt.chatgpt.ecrit_le.date_locale, '2026-09-18');
    assert.equal(mvt.chatgpt.ecrit_le.instant_utc, '2026-09-18T17:12:05Z');
    assert.match(mvt.chatgpt.ecrit_le.lisible, /\(\+01:00 Africa\/Libreville\)/);
  });
});

test('PROVENANCE : une écriture sans phrase est refusée', async () => {
  await avecJeton(JETON, async () => {
    const corps = corpsDepense();
    delete corps.phrase;
    const { code, depot } = await appeler({ corps });
    assert.equal(code, 400, 'sans la phrase d\'origine, une écriture non confirmée est intraçable');
    assert.deepEqual(depot.tables.mouvements_financiers, []);
  });
});

test('DATE : à 23 h 30 UTC, la dépense est datée du LENDEMAIN, heure de Moanda', async () => {
  await avecJeton(JETON, async () => {
    const corps = corpsDepense();
    delete corps.date;
    const { depot } = await appeler({ corps }, { maintenant: INSTANT_MINUIT });
    const [mvt] = depot.tables.mouvements_financiers;
    assert.equal(
      mvt.date, '2026-09-19',
      'la date du serveur Vercel (UTC) ferait tomber la sortie dans la journée de la veille',
    );
  });
});

test('DATE : le module d\'écriture n\'utilise jamais toISOString().slice ni todayISO', () => {
  for (const chemin of ['api/_lib/chatgpt-ecriture.js', 'src/services/chatgpt-gestes.js']) {
    const source = lire(chemin);
    assert.ok(
      !/toISOString\(\)\s*\.\s*(slice|split)/.test(source),
      `${chemin} : la date du serveur n'est pas celle de Moanda (bug des 55 300 F)`,
    );
    assert.ok(
      !/\btodayISO\s*\(/.test(source),
      `${chemin} : todayISO() rend la date du serveur Vercel (UTC)`,
    );
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. LE JOURNAL, AVANT L'EFFET
   ═══════════════════════════════════════════════════════════════════════════ */

test('AUDIT : la trace est écrite AVANT l\'effet, pas après', async () => {
  await avecJeton(JETON, async () => {
    const { depot } = await appeler({ corps: corpsDepense() });
    const rangJournal = depot.trace.indexOf('journaliser');
    const rangEcriture = depot.trace.indexOf('creer:mouvements_financiers');
    assert.ok(rangJournal > -1, 'aucune trace d\'audit');
    assert.ok(rangEcriture > -1, 'aucune écriture');
    assert.ok(
      rangJournal < rangEcriture,
      'si l\'écriture échoue au milieu, on doit savoir ce qui a été tenté — donc la trace passe d\'abord',
    );
  });
});

test('AUDIT : la trace dit qui, quoi, combien et avec quelle phrase', async () => {
  await avecJeton(JETON, async () => {
    const { depot } = await appeler({ corps: corpsDepense() });
    const [trace] = depot.tables.audit_logs;
    assert.ok(trace, 'la trace doit exister');
    assert.equal(trace.module, 'finances');
    assert.match(String(trace.action), /chatgpt/i);
    assert.match(String(trace.user_nom), /ChatGPT/i);
    assert.match(String(trace.details), /100\s?000|100000/, 'le montant doit être lisible dans la trace');
    assert.equal(trace.metadata.phrase, "Aujourd'hui j'ai payé 100 000 francs de travaux");
    assert.equal(trace.metadata.cle, 'depense-2026-09-18-001');
  });
});

test('AUDIT — QUI : l\'auteur est « ChatGPT », et le corps ne peut pas le changer', async () => {
  await avecJeton(JETON, async () => {
    const { depot } = await appeler({
      corps: corpsDepense({
        // Ce qu'un GPT mal réglé — ou un porteur du jeton — pourrait envoyer :
        auteur: { type: 'humain', id: 'f61af333', nom: 'Imprimerie Admin', role: 'admin' },
        user_id: 'f61af333', user_nom: 'Imprimerie Admin', dicte_par: 'Ibrahim',
      }),
    });
    const [trace] = depot.tables.audit_logs;
    assert.equal(trace.auteur.type, 'chatgpt');
    assert.equal(trace.auteur.id, 'chatgpt');
    assert.equal(trace.auteur.source, 'jeton_pont');
    assert.equal(trace.user_id, 'chatgpt');
    assert.equal(trace.auteur.dicte_par, null, 'qui a dicté n\'est pas vérifiable : on ne l\'invente pas');
    assert.match(trace.auteur.dicte_par_motif, /jeton/);
    assert.notEqual(trace.auteur.type, 'humain');
  });
});

test('AUDIT — QUI : les en-têtes OpenAI sont gardés comme INDICES non vérifiés, jamais le jeton', async () => {
  await avecJeton(JETON, async () => {
    const { depot } = await appeler({
      corps: corpsDepense(),
      entetes: {
        'openai-conversation-id': 'conv_0123-abcd',
        'openai-ephemeral-user-id': 'eph_user_42',
        'openai-gpt-id': 'g-XYZ',
      },
    });
    const [trace] = depot.tables.audit_logs;
    assert.deepEqual(trace.auteur.indices_openai, {
      conversation: 'conv_0123-abcd', utilisateur_ephemere: 'eph_user_42', gpt: 'g-XYZ', verifie: false,
    });
    assert.equal(trace.auteur.type, 'chatgpt', 'un indice n\'est pas un auteur');
    assert.ok(!JSON.stringify(trace).includes(JETON), 'le jeton du pont est entré au journal');
  });
});

test('AUDIT — QUI : un en-tête OpenAI forgé ne dépose pas de texte libre au journal', async () => {
  await avecJeton(JETON, async () => {
    const { depot } = await appeler({
      corps: corpsDepense(),
      entetes: { 'openai-conversation-id': 'Ibrahim a dicté <script>', 'openai-gpt-id': 'x'.repeat(500) },
    });
    const [trace] = depot.tables.audit_logs;
    assert.equal(trace.auteur.indices_openai, null);
  });
});

test('AUDIT — QUI : l\'annulation par le pont est signée « ChatGPT », elle aussi', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot();
    const creation = await appeler({ corps: corpsDepense() }, { depot });
    await appeler({
      voie: 'annuler',
      corps: { identifiant: creation.corps.identifiant, phrase: 'annule, erreur de montant', user_nom: 'Admin' },
    }, { depot });
    assert.equal(depot.tables.audit_logs.length, 2);
    for (const trace of depot.tables.audit_logs) {
      assert.equal(trace.auteur.type, 'chatgpt');
      assert.equal(trace.user_nom, 'ChatGPT (pont)');
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   6. IDEMPOTENCE — par le TÉMOIN DE L'EFFET
   ═══════════════════════════════════════════════════════════════════════════ */

test('IDEMPOTENCE : la même clé deux fois ne produit QU\'UNE écriture et QU\'UN débit', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot();
    const avant = depot.soldes.get('cpt-caisse');

    const un = await appeler({ corps: corpsDepense() }, { depot });
    const deux = await appeler({ corps: corpsDepense() }, { depot });

    assert.equal(un.code, 201);
    assert.equal(deux.code, 200, 'le second appel constate, il ne crée pas');
    assert.equal(deux.corps.deja_fait, true, 'le second appel doit le DIRE, pas mentir sur un succès neuf');
    assert.equal(un.corps.identifiant, deux.corps.identifiant, 'le même geste, le même identifiant');

    assert.equal(depot.tables.mouvements_financiers.length, 1, 'DEUX mouvements = 100 000 F sortis deux fois');
    assert.equal(depot.soldes.get('cpt-caisse'), avant - 100000, 'le compte ne doit être débité qu\'une fois');
  });
});

test('IDEMPOTENCE : deux clés différentes écrivent bien deux fois', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot();
    await appeler({ corps: corpsDepense({ cle: 'depense-aaa' }) }, { depot });
    await appeler({ corps: corpsDepense({ cle: 'depense-bbb' }) }, { depot });
    assert.equal(depot.tables.mouvements_financiers.length, 2, 'deux dépenses distinctes restent deux dépenses');
  });
});

test('IDEMPOTENCE : le témoin est la LIGNE écrite, jamais un statut intermédiaire', () => {
  const source = lire('api/_lib/chatgpt-ecriture.js');
  for (const interdit of ['en_cours', 'en cours', 'pending', 'verrouille_en_base', 'statut: \'reserve\'']) {
    assert.ok(
      !source.includes(interdit),
      `api/_lib/chatgpt-ecriture.js contient « ${interdit} » : l'idempotence se fonde sur le témoin de `
      + 'l\'effet, jamais sur un drapeau posé avant lui — un drapeau posé puis abandonné bloque à jamais',
    );
  }
  assert.match(
    source, /chercherParCle|chercherMouvementParReference/,
    'le témoin doit être cherché dans les lignes réellement écrites',
  );
});

test('IDEMPOTENCE : une écriture concurrente sur la même clé n\'en produit qu\'une', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot();
    const avant = depot.soldes.get('cpt-caisse');
    // Les deux appels partent AVANT que le premier ait écrit : c'est la course
    // que la lecture préalable seule ne referme pas (voir execution-unique.js).
    const [a, b] = await Promise.all([
      appeler({ corps: corpsDepense() }, { depot }),
      appeler({ corps: corpsDepense() }, { depot }),
    ]);
    assert.ok([200, 201].includes(a.code) && [200, 201].includes(b.code));
    assert.equal(depot.tables.mouvements_financiers.length, 1, 'la course a produit un double débit');
    assert.equal(depot.soldes.get('cpt-caisse'), avant - 100000);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   7. AUCUN MOUVEMENT SANS COMPTE — le piège de la fuite d'argent
   ═══════════════════════════════════════════════════════════════════════════ */

test('COMPTE : un compte introuvable fait ÉCHOUER l\'écriture, il ne la vide pas', async () => {
  await avecJeton(JETON, async () => {
    const { code, corps, depot } = await appeler({
      corps: corpsDepense({ compte: 'banque-de-nulle-part' }),
    });
    assert.equal(code, 400, 'écrire un mouvement sans compte est une fuite d\'argent silencieuse');
    assert.deepEqual(depot.tables.mouvements_financiers, [], 'aucune ligne inerte ne doit rester en base');
    assert.match(
      `${corps.error} ${corps.detail || ''}`, /compte/i,
      'le refus doit dire QUOI corriger',
    );
  });
});

test('COMPTE : aucun geste ne peut produire un mouvement à compte_id vide', () => {
  const comptes = comptesDeTest();
  const ctx = {
    instant_utc: '2026-09-18T17:12:05Z', date_locale: '2026-09-18', heure_locale: '18:12:05',
    mois_local: '2026-09', fuseau: 'Africa/Libreville', offset_utc: '+01:00', lisible: 'x',
  };
  for (const geste of GESTES) {
    const r = preparerGeste(geste, { cle: 'k', phrase: 'p', montant: 1000, motif: 'm', titre: 't', etape: 'e', projet: 'Atelier', cout: 1000, paye: true, compte_destination: 'bgfi' }, { ctx, comptes, projets: [{ id: 'prj-1', nom: 'Atelier' }] });
    if (!r.ok) continue;
    for (const op of r.operations) {
      if (op.op !== 'creer' || op.collection !== 'mouvements_financiers') continue;
      assert.ok(
        op.data.compte_id,
        `${geste} : un mouvement à compte_id vide ne débite jamais le compte (piège documenté)`,
      );
    }
  }
});

test('COMPTE : un dépôt en banque sans compte de destination est refusé', async () => {
  await avecJeton(JETON, async () => {
    const { code, depot } = await appeler({
      voie: 'caisse-mouvement',
      corps: {
        cle: 'depot-1', phrase: 'on a déposé', geste: 'depot_banque',
        montant: 300000, compte_source: 'caisse',
      },
    });
    assert.equal(code, 400, 'un transfert incomplet ne débite RIEN : l\'argent disparaîtrait des totaux');
    assert.deepEqual(depot.tables.mouvements_financiers, []);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   8. LES CINQ GESTES — ce qu'ils écrivent vraiment
   ═══════════════════════════════════════════════════════════════════════════ */

test('DÉPENSE : sortie, compte débité, activité posée, montant refusé si ≤ 0', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot();
    const avant = depot.soldes.get('cpt-caisse');
    await appeler({ corps: corpsDepense({ activite: 'papeterie' }) }, { depot });
    const [mvt] = depot.tables.mouvements_financiers;
    assert.equal(mvt.type, 'sortie');
    assert.equal(mvt.montant, 100000);
    assert.equal(mvt.compte_id, 'cpt-caisse');
    assert.equal(mvt.activite, 'papeterie');
    assert.equal(mvt.source, 'chatgpt');
    assert.equal(depot.soldes.get('cpt-caisse'), avant - 100000);

    for (const mauvais of [0, -5000, 'beaucoup', null]) {
      const { code } = await appeler({ corps: corpsDepense({ cle: `m${mauvais}`, montant: mauvais }) });
      assert.equal(code, 400, `montant ${mauvais} doit être refusé`);
    }
  });
});

test('DÉPENSE : sans motif, refus — une sortie de caisse sans raison est irrattrapable', async () => {
  await avecJeton(JETON, async () => {
    const corps = corpsDepense();
    delete corps.motif;
    const { code, depot } = await appeler({ corps });
    assert.equal(code, 400);
    assert.deepEqual(depot.tables.mouvements_financiers, []);
  });
});

test('RECETTE : entrée, compte crédité', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot();
    const avant = depot.soldes.get('cpt-caisse');
    const { code } = await appeler({
      voie: 'recette',
      corps: { cle: 'rec-1', phrase: 'on a encaissé 50 000', montant: 50000, motif: 'Vente comptoir', compte: 'caisse' },
    }, { depot });
    assert.equal(code, 201);
    const [mvt] = depot.tables.mouvements_financiers;
    assert.equal(mvt.type, 'entree');
    assert.equal(depot.soldes.get('cpt-caisse'), avant + 50000);
  });
});

test('CAISSE : « on n\'a pas déposé, on a gardé en cash » n\'écrit AUCUN mouvement d\'argent', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot();
    const avant = new Map(depot.soldes);
    const { code, corps } = await appeler({
      voie: 'caisse-mouvement',
      corps: {
        cle: 'cash-s38',
        phrase: "Cette semaine on n'a pas pu faire le dépôt sur la banque, on a gardé en cash",
        geste: 'garde_en_cash',
        montant: 400000,
        motif: 'Banque fermée',
      },
    }, { depot });

    assert.equal(code, 201, `refusé : ${JSON.stringify(corps)}`);
    assert.deepEqual(
      depot.tables.mouvements_financiers, [],
      'garder l\'argent où il est ne le déplace pas : écrire un mouvement le compterait deux fois',
    );
    for (const [id, solde] of avant) {
      assert.equal(depot.soldes.get(id), solde, `le solde de ${id} ne doit pas bouger`);
    }
    const [constat] = depot.tables.depots_hebdo;
    assert.ok(constat, 'le constat doit exister : c\'est ce que le dirigeant a demandé de tracer');
    assert.equal(constat.depose, false);
    assert.equal(constat.montant_garde, 400000);
    assert.equal(constat[CHAMP_MARQUEUR], true);
  });
});

test('CAISSE : un dépôt en banque DÉBITE la caisse et CRÉDITE la banque', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot();
    const caisseAvant = depot.soldes.get('cpt-caisse');
    const bgfiAvant = depot.soldes.get('cpt-bgfi');
    const { code } = await appeler({
      voie: 'caisse-mouvement',
      corps: {
        cle: 'depot-s38', phrase: 'on a déposé 300 000 à la BGFI', geste: 'depot_banque',
        montant: 300000, compte_source: 'caisse', compte_destination: 'bgfi',
      },
    }, { depot });
    assert.equal(code, 201);
    const [mvt] = depot.tables.mouvements_financiers;
    assert.equal(mvt.type, 'depot_hebdo', 'un dépôt DÉPLACE de l\'argent, il n\'en crée pas (arbitrage n°13)');
    assert.equal(mvt.compte_id, 'cpt-caisse', 'compte_id = d\'où l\'argent SORT');
    assert.equal(mvt.compte_dest_id, 'cpt-bgfi', 'compte_dest_id = où l\'argent ARRIVE');
    assert.equal(depot.soldes.get('cpt-caisse'), caisseAvant - 300000);
    assert.equal(depot.soldes.get('cpt-bgfi'), bgfiAvant + 300000);
  });
});

test('TRAVAUX : « 100 000 F de travaux payés » crée l\'étape ET débite le compte', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot();
    const avant = depot.soldes.get('cpt-caisse');
    const { code, corps } = await appeler({
      voie: 'travaux',
      corps: {
        cle: 'trv-1',
        phrase: "Aujourd'hui j'ai payé 100 000 francs de travaux",
        projet: 'Atelier', etape: 'Peinture', cout: 100000, paye: true, compte: 'caisse',
      },
    }, { depot });
    assert.equal(code, 201, `refusé : ${JSON.stringify(corps)}`);

    const [etape] = depot.tables.etapes_travaux;
    assert.equal(etape.nom, 'Peinture');
    assert.equal(etape.projet_id, 'prj-1');
    assert.equal(etape.depense, 100000);
    assert.equal(etape.statut_paiement, 'paye');

    const [mvt] = depot.tables.mouvements_financiers;
    assert.equal(mvt.type, 'sortie');
    assert.equal(mvt.categorie, 'travaux');
    assert.equal(depot.soldes.get('cpt-caisse'), avant - 100000);
  });
});

test('TRAVAUX : une étape NON payée n\'écrit aucun mouvement et ne touche aucun solde', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot();
    const avant = new Map(depot.soldes);
    await appeler({
      voie: 'travaux',
      corps: {
        cle: 'trv-2', phrase: 'on prévoit la peinture', projet: 'Atelier',
        etape: 'Peinture', cout: 100000, paye: false,
      },
    }, { depot });
    assert.equal(depot.tables.etapes_travaux.length, 1);
    assert.deepEqual(depot.tables.mouvements_financiers, [], 'prévoir une dépense n\'est pas la payer');
    for (const [id, solde] of avant) assert.equal(depot.soldes.get(id), solde);
  });
});

test('TRAVAUX : un projet inconnu est refusé — jamais d\'étape orpheline', async () => {
  await avecJeton(JETON, async () => {
    const { code, depot } = await appeler({
      voie: 'travaux',
      corps: {
        cle: 'trv-3', phrase: 'travaux', projet: 'Chantier fantôme',
        etape: 'Peinture', cout: 1000, paye: true, compte: 'caisse',
      },
    });
    assert.equal(code, 400);
    assert.deepEqual(depot.tables.etapes_travaux, []);
    assert.deepEqual(depot.tables.mouvements_financiers, []);
  });
});

test('TÂCHE : créée avec les valeurs de l\'écran, jamais une valeur inventée', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot();
    const { code } = await appeler({
      voie: 'tache',
      corps: {
        cle: 'tch-1', phrase: 'rappelle-moi de commander du papier',
        titre: 'Commander du papier A4', priorite: 'haute', categorie: 'Administratif',
        echeance: '2026-09-25',
      },
    }, { depot });
    assert.equal(code, 201);
    const [t] = depot.tables.taches;
    assert.equal(t.titre, 'Commander du papier A4');
    assert.equal(t.statut, 'en_attente');
    assert.equal(t.priorite, 'haute');
    assert.equal(t.categorie, 'Administratif');
    assert.equal(t.date_echeance, '2026-09-25');
    assert.equal(t.progression, 0);
  });
});

test('TÂCHE : une priorité ou une catégorie inventée est refusée', async () => {
  await avecJeton(JETON, async () => {
    for (const corps of [
      { cle: 'x1', phrase: 'p', titre: 'T', priorite: 'critique' },
      { cle: 'x2', phrase: 'p', titre: 'T', categorie: 'Divers' },
      { cle: 'x3', phrase: 'p', titre: '   ' },
    ]) {
      const { code, depot } = await appeler({ voie: 'tache', corps });
      assert.equal(code, 400, `${JSON.stringify(corps)} doit être refusé`);
      assert.deepEqual(depot.tables.taches, []);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   9. ANNULER COMPENSE, N'EFFACE PAS
   ═══════════════════════════════════════════════════════════════════════════ */

test('ANNULATION : une dépense annulée est CONTRE-PASSÉE, la ligne d\'origine reste', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot();
    const avant = depot.soldes.get('cpt-caisse');
    const creation = await appeler({ corps: corpsDepense() }, { depot });
    assert.equal(creation.code, 201);
    assert.equal(depot.soldes.get('cpt-caisse'), avant - 100000);

    const { code, corps } = await appeler({
      voie: 'annuler',
      corps: {
        identifiant: creation.corps.identifiant,
        phrase: 'annule la dépense de 100 000, je me suis trompé',
      },
    }, { depot });

    assert.equal(code, 200, `annulation refusée : ${JSON.stringify(corps)}`);
    assert.equal(
      depot.tables.mouvements_financiers.length, 2,
      'annuler doit AJOUTER une écriture inverse, jamais retirer la première',
    );
    const origine = depot.tables.mouvements_financiers[0];
    const inverse = depot.tables.mouvements_financiers[1];
    assert.equal(origine.montant, 100000, 'la ligne d\'origine ne doit pas être touchée dans son montant');
    assert.equal(inverse.type, 'entree', 'la contre-passation d\'une sortie est une entrée');
    assert.equal(inverse.montant, 100000);
    assert.match(inverse.description, /ANNULATION/);
    assert.equal(inverse.reference, `${origine.reference}:annulation`);
    assert.equal(
      depot.soldes.get('cpt-caisse'), avant,
      'après annulation, le solde doit être revenu exactement à sa valeur d\'avant',
    );
    assert.ok(origine.annule_le, 'la ligne d\'origine doit porter la marque de son annulation');
  });
});

test('ANNULATION : annuler deux fois ne rembourse pas deux fois', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot();
    const avant = depot.soldes.get('cpt-caisse');
    const creation = await appeler({ corps: corpsDepense() }, { depot });
    const annul = { identifiant: creation.corps.identifiant, phrase: 'annule' };

    const un = await appeler({ voie: 'annuler', corps: annul }, { depot });
    const deux = await appeler({ voie: 'annuler', corps: annul }, { depot });

    assert.equal(un.code, 200);
    assert.equal(deux.code, 200);
    assert.equal(deux.corps.deja_fait, true);
    assert.equal(depot.tables.mouvements_financiers.length, 2, 'une seule contre-passation');
    assert.equal(depot.soldes.get('cpt-caisse'), avant, 'le solde ne doit pas être crédité deux fois');
  });
});

test('ANNULATION : un dépôt en banque annulé remet l\'argent dans la caisse', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot();
    const caisseAvant = depot.soldes.get('cpt-caisse');
    const bgfiAvant = depot.soldes.get('cpt-bgfi');
    const creation = await appeler({
      voie: 'caisse-mouvement',
      corps: {
        cle: 'dep-x', phrase: 'dépôt', geste: 'depot_banque',
        montant: 300000, compte_source: 'caisse', compte_destination: 'bgfi',
      },
    }, { depot });
    await appeler({
      voie: 'annuler',
      corps: { identifiant: creation.corps.identifiant, phrase: 'non, on n\'a pas déposé' },
    }, { depot });
    assert.equal(depot.soldes.get('cpt-caisse'), caisseAvant);
    assert.equal(depot.soldes.get('cpt-bgfi'), bgfiAvant);
  });
});

test('ANNULATION : une tâche annulée reste en base, marquée, pas supprimée', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot();
    const creation = await appeler({
      voie: 'tache',
      corps: { cle: 'tch-2', phrase: 'ajoute une tâche', titre: 'Commander du papier' },
    }, { depot });
    await appeler({
      voie: 'annuler',
      corps: { identifiant: creation.corps.identifiant, phrase: 'retire cette tâche' },
    }, { depot });
    assert.equal(depot.tables.taches.length, 1, 'la ligne ne doit jamais disparaître');
    const [t] = depot.tables.taches;
    assert.ok(t.annule_le, 'la tâche doit porter la date de son annulation');
    assert.match(t.titre, /ANNUL/i, 'l\'écran des tâches doit montrer qu\'elle est annulée sans être modifié');
  });
});

test('ANNULATION : une étape de travaux payée est contre-passée, le solde revient', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot();
    const avant = depot.soldes.get('cpt-caisse');
    const creation = await appeler({
      voie: 'travaux',
      corps: {
        cle: 'trv-9', phrase: 'j\'ai payé 100 000 de travaux', projet: 'Atelier',
        etape: 'Peinture', cout: 100000, paye: true, compte: 'caisse',
      },
    }, { depot });
    await appeler({
      voie: 'annuler',
      corps: { identifiant: creation.corps.identifiant, phrase: 'annule' },
    }, { depot });
    assert.equal(depot.tables.etapes_travaux.length, 1, 'l\'étape reste');
    assert.ok(depot.tables.etapes_travaux[0].annule_le);
    assert.equal(depot.soldes.get('cpt-caisse'), avant, 'les 100 000 F doivent être revenus');
  });
});

test('ANNULATION : le module ne sait pas supprimer', () => {
  const source = lire('api/_lib/chatgpt-ecriture.js');
  assert.ok(
    !source.includes('.delete('),
    'api/_lib/chatgpt-ecriture.js contient .delete( — annuler COMPENSE, la trace ne disparaît jamais',
  );
  assert.ok(
    !/\bsupprimer\b/i.test(source),
    'le vocabulaire du module ne doit pas contenir « supprimer » : le geste n\'existe pas ici',
  );
});

test('ANNULATION : un identifiant inconnu est refusé, sans rien écrire', async () => {
  await avecJeton(JETON, async () => {
    const { code, depot } = await appeler({
      voie: 'annuler',
      corps: { identifiant: 'chatgpt:jamais-ecrit', phrase: 'annule' },
    });
    assert.equal(code, 404);
    assert.deepEqual(depot.tables.mouvements_financiers, []);
  });
});

test('ANNULATION : le plan est PUR — il se calcule sans base ni réseau', () => {
  const plan = planAnnulation(
    {
      collection: 'mouvements_financiers',
      data: {
        id: 'm1', type: 'sortie', montant: 100000, compte_id: 'cpt-caisse',
        date: '2026-09-18', reference: 'chatgpt:k1', description: 'Travaux',
      },
      lies: [],
    },
    {
      ctx: {
        instant_utc: '2026-09-18T17:12:05Z', date_locale: '2026-09-18', heure_locale: '18:12:05',
        mois_local: '2026-09', fuseau: 'Africa/Libreville', offset_utc: '+01:00', lisible: 'x',
      },
      phrase: 'annule',
    },
  );
  assert.equal(plan.ok, true);
  const creations = plan.operations.filter((o) => o.op === 'creer');
  assert.equal(creations.length, 1);
  assert.equal(creations[0].data.type, 'entree');
  assert.ok(plan.operations.some((o) => o.op === 'solde' && o.delta === 100000));
  assert.ok(!plan.operations.some((o) => /suppr|delete/i.test(o.op)));
});

/* ═══════════════════════════════════════════════════════════════════════════
   10. LE JOURNAL « CE QUE CHATGPT A ÉCRIT »
   ═══════════════════════════════════════════════════════════════════════════ */

test('JOURNAL : la voie de lecture rend ce qui a été écrit, avec de quoi l\'annuler', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot();
    await appeler({ corps: corpsDepense() }, { depot });
    await appeler({
      voie: 'tache', corps: { cle: 'tch-3', phrase: 'ajoute', titre: 'Papier' },
    }, { depot });

    const { code, corps } = await appeler({ voie: 'journal', method: 'GET' }, { depot });
    assert.equal(code, 200);
    assert.equal(corps.ecritures.length, 2);
    for (const e of corps.ecritures) {
      assert.ok(e.identifiant, 'chaque ligne doit porter l\'identifiant qui permet de l\'annuler');
      assert.ok(e.phrase, 'chaque ligne doit rappeler la phrase qui l\'a produite');
      assert.ok(e.ecrit_le, 'chaque ligne doit être datée en heure de Moanda');
      assert.equal(typeof e.annule, 'boolean');
    }
  });
});

test('JOURNAL : un dépôt et un « gardé en cash » ne portent pas le même libellé', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot();
    await appeler({
      voie: 'caisse-mouvement',
      corps: {
        cle: 'j-depot', phrase: 'déposé', geste: 'depot_banque',
        montant: 100000, compte_source: 'caisse', compte_destination: 'bgfi',
      },
    }, { depot });
    await appeler({
      voie: 'caisse-mouvement',
      corps: { cle: 'j-cash', phrase: 'gardé', geste: 'garde_en_cash', montant: 50000 },
    }, { depot });

    const { corps } = await appeler({ voie: 'journal', method: 'GET' }, { depot });
    const gestes = corps.ecritures.map((e) => e.geste).sort();
    assert.deepEqual(
      gestes, ['depot_banque', 'garde_en_cash'],
      'les confondre ferait chercher un mouvement d\'argent qui n\'existe pas',
    );
    for (const e of corps.ecritures) {
      assert.ok(e.libelle_geste && e.libelle_geste !== e.geste, `libellé manquant pour ${e.geste}`);
    }
  });
});

test('JOURNAL : une ligne saisie à la main n\'y figure jamais', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot();
    // Une saisie du gérant, sans marqueur : elle existe en base mais n'est pas
    // de ChatGPT. Proposer de l'annuler ici serait pire que ne rien montrer.
    depot.tables.mouvements_financiers.push({
      id: 'm-main', type: 'sortie', montant: 42000, description: 'Achat encre au comptoir',
      compte_id: 'cpt-caisse', date: '2026-09-17', reference: '',
    });
    await appeler({ corps: corpsDepense() }, { depot });
    const { corps } = await appeler({ voie: 'journal', method: 'GET' }, { depot });
    assert.equal(corps.ecritures.length, 1);
    assert.ok(!JSON.stringify(corps).includes('Achat encre au comptoir'));
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   11. LE SCHÉMA OPENAPI — ce que ChatGPT lit pour savoir appeler
   ═══════════════════════════════════════════════════════════════════════════ */

test('SCHÉMA : chaque voie d\'écriture a son chemin en POST, et AUCUN GET', () => {
  const schema = JSON.parse(lire('api/_lib/chatgpt-openapi.json'));
  const parVoie = Object.fromEntries(Object.entries(CHEMINS_CHATGPT).map(([c, v]) => [v, c]));
  for (const voie of VOIES_ECRITURE) {
    const chemin = parVoie[voie];
    assert.ok(chemin, `aucun chemin public pour la voie ${voie}`);
    const def = schema.paths[chemin];
    assert.ok(def, `le schéma doit exposer ${chemin}`);
    assert.ok(def.post, `${chemin} : l'écriture passe par POST`);
    assert.ok(!def.get, `${chemin} : une voie d'écriture ne doit pas proposer de GET`);
    assert.ok(def.post.requestBody, `${chemin} : POST sans corps n'a aucun sens`);
    assert.ok(def.post.operationId, `${chemin} : operationId manquant`);
  }
  for (const voie of VOIES_LECTURE) {
    const chemin = parVoie[voie];
    assert.ok(chemin, `aucun chemin public pour la voie ${voie}`);
    const def = schema.paths[chemin];
    assert.ok(def.get, `${chemin} : la lecture reste en GET`);
    for (const verbe of ['post', 'put', 'patch', 'delete']) {
      assert.ok(!def[verbe], `${chemin} : le schéma ne doit proposer aucun ${verbe.toUpperCase()}`);
    }
  }
});

test('SCHÉMA : aucune description ne dépasse 300 caractères — ChatGPT rejette au-delà', () => {
  const schema = JSON.parse(lire('api/_lib/chatgpt-openapi.json'));
  // `$.info.description` est LA seule exception, et elle est assumée : c'est
  // la consigne générale du pont (devise, fuseau, « écris sans confirmation »,
  // « ne devine pas un chiffre »), que ChatGPT lit une fois pour toutes. La
  // limite des 300 caractères porte sur ce qui accompagne CHAQUE opération et
  // CHAQUE paramètre — c'est là que ChatGPT tronque et finit par appeler dans
  // le vide. Une consigne générale coupée en deux ne protégerait plus rien.
  const EXCEPTION = '$.info.description';
  const trop = [];
  (function parcourir(v, chemin) {
    if (v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach((x, i) => parcourir(x, `${chemin}[${i}]`)); return; }
    for (const [cle, val] of Object.entries(v)) {
      const ou = `${chemin}.${cle}`;
      if (cle === 'description' && typeof val === 'string' && val.length > 300 && ou !== EXCEPTION) {
        trop.push(`${ou} (${val.length})`);
      }
      parcourir(val, ou);
    }
  }(schema, '$'));
  assert.deepEqual(trop, [], `descriptions trop longues : ${trop.join(', ')}`);
});

test('SCHÉMA : la profondeur totale reste sous 12 — au-delà, le pont tronque', () => {
  const schema = JSON.parse(lire('api/_lib/chatgpt-openapi.json'));
  function profondeur(v) {
    if (v === null || typeof v !== 'object') return 0;
    const enfants = Array.isArray(v) ? v : Object.values(v);
    let max = 0;
    for (const e of enfants) max = Math.max(max, profondeur(e));
    return 1 + max;
  }
  const p = profondeur(schema);
  assert.ok(
    p < 12,
    `profondeur ${p} : le filtre du pont coupe à 12, et un schéma tronqué fait appeler dans le vide`,
  );
});

test('SCHÉMA : chaque réponse déclare ses propriétés, jamais un objet muet', () => {
  const schema = JSON.parse(lire('api/_lib/chatgpt-openapi.json'));
  for (const [chemin, def] of Object.entries(schema.paths)) {
    for (const [verbe, op] of Object.entries(def)) {
      for (const [statut, reponse] of Object.entries(op.responses || {})) {
        const s = reponse?.content?.['application/json']?.schema;
        assert.ok(s, `${verbe.toUpperCase()} ${chemin} ${statut} : réponse sans schéma`);
        const nom = s.$ref ? s.$ref.split('/').pop() : null;
        const cible = nom ? schema.components.schemas[nom] : s;
        assert.ok(cible, `${chemin} ${statut} : $ref ${s.$ref} introuvable`);
        assert.ok(
          cible.properties && Object.keys(cible.properties).length > 0,
          `${chemin} ${statut} : le schéma de réponse doit déclarer ses properties`,
        );
      }
    }
  }
});

test('SCHÉMA : le schéma dit que l\'écriture a lieu SANS confirmation, et comment l\'annuler', () => {
  const schema = JSON.parse(lire('api/_lib/chatgpt-openapi.json'));
  const texte = JSON.stringify(schema).toLowerCase();
  assert.match(texte, /sans confirmation|sans demander/, 'le choix du dirigeant doit être écrit noir sur blanc');
  assert.match(texte, /annul/, 'ChatGPT doit savoir qu\'une annulation existe');
  assert.match(texte, /cle|clé/, 'ChatGPT doit savoir qu\'il fournit une clé d\'idempotence');
});

/* ═══════════════════════════════════════════════════════════════════════════
   12. LES CONTRAINTES DE LA PLATEFORME
   ═══════════════════════════════════════════════════════════════════════════ */

test('VERCEL : chaque voie d\'écriture a sa réécriture, AVANT la règle générique', () => {
  const vercel = JSON.parse(lire('vercel.json'));
  const sources = vercel.rewrites.map((r) => r.source);
  const generique = sources.indexOf('/api/(.*)');
  assert.ok(generique > -1);
  for (const [chemin, voie] of Object.entries(CHEMINS_CHATGPT)) {
    const i = sources.indexOf(chemin);
    assert.ok(i > -1, `réécriture manquante pour ${chemin}`);
    assert.ok(i < generique, `${chemin} doit précéder /api/(.*)`);
    assert.equal(vercel.rewrites[i].destination, `/api/chatgpt?voie=${voie}`);
  }
});

test('DÉBIT : les voies d\'écriture ont un plafond plus SERRÉ que la lecture', () => {
  const source = lire('api/chatgpt.js');
  assert.match(
    source, /portee:\s*'chatgpt-ecriture'/,
    'l\'écriture doit avoir sa propre portée : elle n\'emprunte pas le plafond de la lecture',
  );
});

test('PLAFOND HOBBY : aucun fichier n\'a été ajouté sous api/', async () => {
  const { readdirSync } = await import('node:fs');
  const fichiers = readdirSync(new URL('api/', racine)).filter((f) => f.endsWith('.js'));
  assert.equal(
    fichiers.length, 12,
    `api/ contient ${fichiers.length} fonctions (${fichiers.join(', ')}) : le plan Hobby en accepte 12. `
    + 'Un déploiement à 13 échoue ENTIÈREMENT, avec un build vert.',
  );
  assert.ok(!fichiers.includes('chatgpt-ecriture.js'), 'le module d\'écriture vit dans api/_lib/');
});

test('PLAFOND HOBBY : le module d\'écriture est bien dans api/_lib/, qui ne compte pas', async () => {
  const { readdirSync } = await import('node:fs');
  const libs = readdirSync(new URL('api/_lib/', racine));
  assert.ok(libs.includes('chatgpt-ecriture.js'));
});

/* ═══════════════════════════════════════════════════════════════════════════
   13. LA LECTURE N'A PAS APPRIS À ÉCRIRE
   ═══════════════════════════════════════════════════════════════════════════ */

test('CLOISON : les modules de LECTURE ne savent toujours pas écrire', () => {
  for (const chemin of ['api/_lib/chatgpt-lecture.js', 'api/_lib/chatgpt-syntheses.js']) {
    const source = lire(chemin);
    for (const verbe of ['.insert(', '.update(', '.upsert(', '.delete(', '.rpc(']) {
      assert.ok(
        !source.includes(verbe),
        `${chemin} contient ${verbe} — la couche de lecture reste incapable d'écrire`,
      );
    }
  }
});

test('CLOISON : le point d\'entrée délègue, il n\'écrit pas lui-même', () => {
  const source = lire('api/chatgpt.js');
  for (const verbe of ['.insert(', '.update(', '.upsert(', '.delete(', '.rpc(']) {
    assert.ok(
      !source.includes(verbe),
      `api/chatgpt.js contient ${verbe} — toute l'écriture vit dans api/_lib/chatgpt-ecriture.js`,
    );
  }
});

test('CLOISON : les empreintes de mots de passe ne sortent toujours pas', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot();
    await appeler({ corps: corpsDepense() }, { depot });
    const { corps } = await appeler({ voie: 'journal', method: 'GET' }, { depot });
    const texte = JSON.stringify(corps);
    for (const champ of ['password_hash', 'password_salt']) {
      assert.ok(!texte.includes(champ), `${champ} ne doit jamais sortir du pont`);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   14. LES GESTES DES AUTRES MODULES
   ═══════════════════════════════════════════════════════════════════════════

   Le dirigeant a élargi le périmètre : « ajoute les événements et tous les
   trucs possibles de tous les modules qu'on a sur admin ». Ce qui est vérifié
   ici, ce n'est pas que ça écrit — c'est que ça écrit CE QUE L'ÉCRAN AURAIT
   ÉCRIT. Un geste qui produit une ligne d'une forme voisine est pire qu'un
   geste absent : elle s'affiche, elle compte dans les totaux, et personne ne
   voit qu'elle est fausse.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── Projet de travaux ───────────────────────────────────────────────────── */

test('PROJET : créé avec les statuts et priorités de l’écran, jamais inventés', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot();
    const { code } = await appeler({
      voie: 'projet-travaux',
      corps: {
        cle: 'prj-001', phrase: 'on lance les travaux de la vitrine',
        nom: 'Vitrine', statut: 'en_cours', priorite: 'haute', budget_prevu: 750000,
      },
    }, { depot });
    assert.equal(code, 201);
    const [p] = depot.tables.projets_travaux;
    assert.equal(p.nom, 'Vitrine');
    assert.equal(p.statut, 'en_cours');
    assert.equal(p.priorite, 'haute');
    assert.equal(p.budget_prevu, 750000);

    for (const mauvais of [{ statut: 'bloque' }, { priorite: 'critique' }, { date_debut: '2026-02-31' }]) {
      const r = await appeler({
        voie: 'projet-travaux',
        corps: { cle: `prj-${Object.keys(mauvais)[0]}`, phrase: 'p', nom: 'X', ...mauvais },
      });
      assert.equal(r.code, 400, `${JSON.stringify(mauvais)} doit être refusé`);
    }
  });
});

/* ── Catalogue ───────────────────────────────────────────────────────────── */

const PRODUIT_AVEC_PHOTO = {
  id: 'cat-1',
  nom: 'T-shirt personnalisé',
  categorie: 'Textile',
  prix: [{ qte_min: 1, qte_max: null, prix: 0 }],
  images: ['data:image/png;base64,AAAA'],
  image_principale: 0,
};

test('CATALOGUE : corriger un prix ne touche NI les images NI le reste de la fiche', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot({ tablesInitiales: { produits_catalogue: [PRODUIT_AVEC_PHOTO] } });
    const { code, corps } = await appeler({
      voie: 'catalogue',
      corps: {
        cle: 'cat-prix-1', phrase: 'le t-shirt est à 5000, pas à 0',
        geste: 'corriger_prix', produit: 'T-shirt personnalisé',
        prix: [{ qte_min: 1, qte_max: null, prix: 5000 }],
      },
    }, { depot });
    assert.equal(code, 201, `refusé : ${JSON.stringify(corps)}`);

    const [p] = depot.tables.produits_catalogue;
    assert.deepEqual(p.prix, [{ qte_min: 1, qte_max: null, prix: 5000 }]);
    assert.deepEqual(
      p.images, ['data:image/png;base64,AAAA'],
      'les images doivent être intactes : l’écran, lui, réécrit 3,2 Mo de base64 pour un prix',
    );
    assert.equal(p.image_principale, 0);
    assert.equal(p.categorie, 'Textile');
    assert.deepEqual(
      p.chatgpt_avant, { prix: [{ qte_min: 1, qte_max: null, prix: 0 }] },
      'le prix d’avant doit être conservé : sans lui, l’annulation ne sait pas quoi restaurer',
    );
  });
});

test('CATALOGUE : le nom du produit est cherché à la casse et aux accents près', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot({ tablesInitiales: { produits_catalogue: [PRODUIT_AVEC_PHOTO] } });
    const { code } = await appeler({
      voie: 'catalogue',
      corps: {
        cle: 'cat-accents', phrase: 'corrige le prix',
        geste: 'corriger_prix', produit: 'T-SHIRT PERSONNALISE',
        prix: [{ qte_min: 1, qte_max: null, prix: 4000 }],
      },
    }, { depot });
    assert.equal(code, 201, 'une dictée vocale ne rend ni les accents ni la casse');
  });
});

test('CATALOGUE : un produit inconnu est refusé, et le refus liste ce qui existe', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot({ tablesInitiales: { produits_catalogue: [PRODUIT_AVEC_PHOTO] } });
    const { code, corps } = await appeler({
      voie: 'catalogue',
      corps: {
        cle: 'cat-inconnu', phrase: 'corrige', geste: 'corriger_prix',
        produit: 'Casquette', prix: [{ qte_min: 1, qte_max: null, prix: 1000 }],
      },
    }, { depot });
    assert.equal(code, 400);
    assert.match(corps.detail, /T-shirt personnalisé/, 'le refus doit dire quoi écrire');
  });
});

test('CATALOGUE : un produit créé n’emporte AUCUNE image, et les paliers sont triés', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot();
    const { code } = await appeler({
      voie: 'catalogue',
      corps: {
        cle: 'cat-neuf', phrase: 'ajoute les cartes de visite',
        geste: 'creer', nom: 'Cartes de visite', categorie: 'Impression',
        prix: [{ qte_min: 100, prix: 12000 }, { qte_min: 1, qte_max: 99, prix: 200 }],
      },
    }, { depot });
    assert.equal(code, 201);
    const [p] = depot.tables.produits_catalogue;
    assert.deepEqual(p.images, [], 'les photos entrent par le canvas du navigateur, pas par ici');
    assert.deepEqual(
      p.prix.map((x) => x.qte_min), [1, 100],
      'un tableau non trié fait facturer le mauvais palier',
    );
  });
});

/* ── Stock ───────────────────────────────────────────────────────────────── */

const ARTICLE = {
  id: 'art-1', nom: 'Papier A4', quantite: 12, stock: 12,
  quantite_minimum: 3, type_article: 'consommable',
};

test('STOCK : une sortie écrit le mouvement ET décrémente les DEUX champs', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot({ tablesInitiales: { produits: [ARTICLE] } });
    const { code } = await appeler({
      voie: 'stock-mouvement',
      corps: {
        cle: 'stk-1', phrase: 'on a sorti 5 rames de papier',
        geste: 'sortie', article: 'Papier A4', quantite: 5, motif: 'Commande mairie',
      },
    }, { depot });
    assert.equal(code, 201);

    const [m] = depot.tables.mouvements_stock;
    assert.equal(m.type, 'sortie');
    assert.equal(m.quantite, 5);
    assert.equal(m.stock_avant, 12);
    assert.equal(m.stock_apres, 7);

    const [a] = depot.tables.produits;
    assert.equal(a.quantite, 7);
    assert.equal(a.stock, 7, 'la moitié du code lit `p.quantite ?? p.stock` : écrire les deux');
  });
});

test('STOCK : le mouvement part AVANT le décrément, jamais l’inverse', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot({ tablesInitiales: { produits: [ARTICLE] } });
    await appeler({
      voie: 'stock-mouvement',
      corps: { cle: 'stk-ordre', phrase: 'sortie', geste: 'sortie', article: 'Papier A4', quantite: 2 },
    }, { depot });
    const rangMvt = depot.trace.indexOf('creer:mouvements_stock');
    const rangProduit = depot.trace.indexOf('modifier:produits');
    assert.ok(rangMvt > -1 && rangProduit > -1);
    assert.ok(
      rangMvt < rangProduit,
      'mieux vaut un mouvement sans décrément (visible, corrigeable) qu’un décrément sans '
      + 'mouvement (invisible, indétectable)',
    );
  });
});

test('STOCK : une sortie supérieure au stock est REFUSÉE, jamais ramenée à zéro', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot({ tablesInitiales: { produits: [ARTICLE] } });
    const { code, corps } = await appeler({
      voie: 'stock-mouvement',
      corps: { cle: 'stk-trop', phrase: 'sors 50 rames', geste: 'sortie', article: 'Papier A4', quantite: 50 },
    }, { depot });
    assert.equal(code, 409, 'l’écran refuse « Stock insuffisant » : on suit l’écran');
    assert.deepEqual(depot.tables.mouvements_stock, []);
    assert.equal(depot.tables.produits[0].quantite, 12, 'le stock ne doit pas avoir bougé');
    assert.match(corps.detail, /12/, 'le refus doit dire ce qu’il y a vraiment en stock');
  });
});

test('STOCK : un seuil s’écrit dans quantite_minimum, JAMAIS dans stock_min', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot({ tablesInitiales: { produits: [ARTICLE] } });
    const { code } = await appeler({
      voie: 'stock-mouvement',
      corps: { cle: 'stk-seuil', phrase: 'alerte-moi à 20 rames', geste: 'seuil', article: 'Papier A4', seuil: 20 },
    }, { depot });
    assert.equal(code, 201);
    const [a] = depot.tables.produits;
    assert.equal(a.quantite_minimum, 20);
    assert.ok(
      !('stock_min' in a),
      'stock_min est le champ hérité, lu en repli seulement : l’écrire créerait deux seuils',
    );
    assert.equal(a.quantite, 12, 'régler un seuil ne touche pas au stock physique');
  });
});

test('STOCK : un seuil à zéro est accepté — jamais remonté à 10', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot({ tablesInitiales: { produits: [ARTICLE] } });
    await appeler({
      voie: 'stock-mouvement',
      corps: { cle: 'stk-zero', phrase: 'plus d’alerte sur le papier', geste: 'seuil', article: 'Papier A4', seuil: 0 },
    }, { depot });
    assert.equal(
      depot.tables.produits[0].quantite_minimum, 0,
      'l’ancien écran remontait tout à 10 et alertait « 9/10 » sur un article réglé à 3',
    );
  });
});

/* ── Rapport journalier ──────────────────────────────────────────────────── */

test('RAPPORT : créé en BROUILLON, avec des agrégats DÉRIVÉS du détail', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot();
    const { code, corps } = await appeler({
      voie: 'rapport',
      corps: {
        cle: 'rap-1', phrase: 'aujourd’hui 70 000 de copies et 20 000 d’encre',
        geste: 'creer', operateur_nom: 'Ibrahim',
        ligne: { copies: 70000, sorties: 20000, description: 'Encre' },
      },
    }, { depot });
    assert.equal(code, 201, `refusé : ${JSON.stringify(corps)}`);

    const [r] = depot.tables.rapports;
    assert.equal(r.statut, 'brouillon', 'un rapport dicté se relit avant d’être soumis');
    assert.equal(r.date, '2026-09-18');
    assert.equal(r.activite, 'imprimerie');
    assert.equal(r.categories.copies, 70000);
    assert.equal(r.categories.scan, 0, 'les huit catégories doivent être présentes, même à zéro');
    assert.deepEqual(r.depenses, [{ description: 'Encre', montant: 20000 }]);
    assert.equal(r.lignes.length, 1);
  });
});

test('⛔ RAPPORT : aucun total n’est jamais figé — le garde-fou de mars', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot();
    await appeler({
      voie: 'rapport',
      corps: {
        cle: 'rap-totaux', phrase: 'rapport du jour', geste: 'creer', operateur_nom: 'Ibrahim',
        ligne: { copies: 30600 },
        // Ce que ChatGPT pourrait spontanément vouloir ajouter, et qui a produit
        // 16 rapports portant `total_recettes = 3 × caisse_journee`, adossé à rien.
        total_recettes: 91800, caisse_journee: 30600, solde: 0,
      },
    }, { depot });
    const [r] = depot.tables.rapports;
    assert.ok(r, 'le rapport doit exister');
    for (const interdit of ['total_recettes', 'total_depenses', 'caisse_journee', 'solde', 'total']) {
      assert.ok(
        !(interdit in r),
        `« ${interdit} » a été écrit : un total figé finit par diverger de son propre détail`,
      );
    }
  });
});

test('RAPPORT : ajouter une ligne ADDITIONNE le détail, puis redérive les agrégats', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot({
      tablesInitiales: {
        rapports: [{
          id: 'rap-jour', date: '2026-09-18', activite: 'imprimerie', statut: 'brouillon',
          lignes: [{ copies: 10000, sorties: 0, description: '' }],
          categories: { copies: 10000 }, depenses: [],
        }],
      },
    });
    const { code } = await appeler({
      voie: 'rapport',
      corps: {
        cle: 'rap-ajout', phrase: 'ajoute 5000 de scan', geste: 'ajouter_ligne',
        ligne: { scan: 5000 },
      },
    }, { depot });
    assert.equal(code, 201);
    assert.equal(depot.tables.rapports.length, 1, 'on complète, on ne crée pas un second rapport');
    const r = depot.tables.rapports[0];
    assert.equal(r.lignes.length, 2);
    assert.equal(r.categories.copies, 10000);
    assert.equal(r.categories.scan, 5000);
  });
});

test('RAPPORT : un rapport VALIDÉ ou CLÔTURÉ n’est plus modifiable', async () => {
  await avecJeton(JETON, async () => {
    for (const statut of ['valide', 'cloture']) {
      const depot = faussDepot({
        tablesInitiales: {
          rapports: [{ id: 'r', date: '2026-09-18', activite: 'imprimerie', statut, lignes: [], categories: {}, depenses: [] }],
        },
      });
      const { code } = await appeler({
        voie: 'rapport',
        corps: { cle: `rap-verrou-${statut}`, phrase: 'ajoute', geste: 'ajouter_ligne', ligne: { copies: 1000 } },
      }, { depot });
      assert.equal(code, 409, `un rapport « ${statut} » doit être verrouillé`);
    }
  });
});

test('RAPPORT : un second rapport le même jour ET la même activité est refusé', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot({
      tablesInitiales: {
        rapports: [{ id: 'r', date: '2026-09-18', activite: 'imprimerie', statut: 'brouillon', lignes: [], categories: {}, depenses: [] }],
      },
    });
    const { code } = await appeler({
      voie: 'rapport',
      corps: { cle: 'rap-double', phrase: 'nouveau rapport', geste: 'creer', operateur_nom: 'Ibrahim', ligne: { copies: 1000 } },
    }, { depot });
    assert.equal(code, 409, 'deux rapports le même jour se comptent deux fois');

    // …mais la PAPETERIE a son propre rapport ce jour-là, et c'est légitime.
    const ok = await appeler({
      voie: 'rapport',
      corps: {
        cle: 'rap-papeterie', phrase: 'rapport papeterie', geste: 'creer',
        operateur_nom: 'Ibrahim', activite: 'papeterie', ligne: { marchandises: 30000 },
      },
    }, { depot });
    assert.equal(ok.code, 201, 'les deux commerces ont chacun leur rapport');
  });
});

test('RAPPORT : une sortie sans description est refusée', async () => {
  await avecJeton(JETON, async () => {
    const { code, depot } = await appeler({
      voie: 'rapport',
      corps: {
        cle: 'rap-sortie-muette', phrase: 'une sortie de 5000', geste: 'creer',
        operateur_nom: 'Ibrahim', ligne: { sorties: 5000 },
      },
    });
    assert.equal(code, 400, 'une dépense sans motif écrit ne se retrouve plus');
    assert.deepEqual(depot.tables.rapports, []);
  });
});

/* ── Commande ────────────────────────────────────────────────────────────── */

test('COMMANDE : créée en attente de validation, avec total ET montant_total', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot();
    const { code, corps } = await appeler({
      voie: 'commande',
      corps: {
        cle: 'cmd-1', phrase: 'la mairie commande 200 flyers à 250',
        geste: 'creer', client_nom: 'Mairie de Moanda',
        lignes: [{ description: 'Flyers A5', quantite: 200, prix_unitaire: 250 }],
      },
    }, { depot });
    assert.equal(code, 201, `refusé : ${JSON.stringify(corps)}`);
    const [c] = depot.tables.commandes;
    assert.equal(c.statut, 'en_attente_validation');
    assert.equal(c.total, 50000);
    assert.equal(
      c.montant_total, 50000,
      'l’écran Clients calcule le CA sur `total` : sans lui la commande vaut 0 F (constat E6)',
    );
    assert.equal(c.date_echeance, '2026-09-21', 'échéance par défaut : dans 3 jours');
    assert.match(c.numero, /^CMD-2026-/);
  });
});

test('COMMANDE : le numéro est DÉTERMINISTE — rejouer la clé ne fabrique pas un second numéro', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot();
    const corps = {
      cle: 'cmd-idem', phrase: 'commande', geste: 'creer', client_nom: 'Client',
      lignes: [{ description: 'X', quantite: 1, prix_unitaire: 1000 }],
    };
    const un = await appeler({ voie: 'commande', corps }, { depot });
    const deux = await appeler({ voie: 'commande', corps }, { depot });
    assert.equal(depot.tables.commandes.length, 1);
    assert.equal(un.corps.identifiant, deux.corps.identifiant);
    assert.equal(deux.corps.deja_fait, true);
  });
});

test('⛔ COMMANDE : « livrée » et « annulée » sont REFUSÉES, avec la raison', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot({
      tablesInitiales: {
        commandes: [{ id: 'c1', numero: 'CMD-2026-ABC123', statut: 'prete', client_nom: 'Mairie' }],
      },
    });
    for (const statut of ['livree', 'annulee']) {
      const { code, corps } = await appeler({
        voie: 'commande',
        corps: {
          cle: `cmd-${statut}`, phrase: `passe la commande en ${statut}`,
          geste: 'changer_statut', commande: 'CMD-2026-ABC123', statut,
        },
      }, { depot });
      assert.equal(code, 409, `« ${statut} » ne doit pas passer par le pont`);
      assert.match(
        corps.detail, /écran/,
        'le refus doit dire OÙ le faire, sinon ChatGPT réessaie en boucle',
      );
      assert.equal(depot.tables.commandes[0].statut, 'prete', 'le statut ne doit pas avoir bougé');
    }
  });
});

test('COMMANDE : les transitions sans effet d’argent passent, et laissent l’historique', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot({
      tablesInitiales: {
        commandes: [{
          id: 'c1', numero: 'CMD-2026-ABC123', statut: 'validee_attente_paiement',
          client_nom: 'Mairie', historique_statuts: [{ statut: 'en_attente_validation', date: 'x', auteur: 'y' }],
        }],
      },
    });
    const { code } = await appeler({
      voie: 'commande',
      corps: {
        cle: 'cmd-prod', phrase: 'on lance la production',
        geste: 'changer_statut', commande: 'cmd-2026-abc123', statut: 'en_production',
      },
    }, { depot });
    assert.equal(code, 201);
    const c = depot.tables.commandes[0];
    assert.equal(c.statut, 'en_production');
    assert.equal(c.historique_statuts.length, 2, 'l’historique s’ajoute, il ne se remplace pas');
    assert.equal(c.historique_statuts[1].auteur, 'ChatGPT (pont)');
    assert.equal(c.chatgpt_avant.statut, 'validee_attente_paiement');
    assert.deepEqual(depot.tables.mouvements_financiers, [], 'aucun effet d’argent sur ces transitions');
  });
});

/* ── Client ──────────────────────────────────────────────────────────────── */

test('CLIENT : créé sans user_id — un compte portail, c’est un utilisateur', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot();
    const { code } = await appeler({
      voie: 'client',
      corps: {
        cle: 'cli-1', phrase: 'note ce nouveau client', nom: 'Société Moanda',
        type: 'entreprise', telephone: '060 44 46 34',
      },
    }, { depot });
    assert.equal(code, 201);
    const [c] = depot.tables.clients;
    assert.equal(c.nom, 'Société Moanda');
    assert.equal(c.type, 'entreprise');
    assert.ok(!('user_id' in c), 'poser un user_id rattacherait la fiche à un compte du portail');
    assert.ok(!('password_hash' in c));
  });
});

test('CLIENT : un homonyme aux accents près est refusé — pas de doublon d’annuaire', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot({
      tablesInitiales: { clients: [{ id: 'cl-1', nom: 'Société  Moanda' }] },
    });
    const { code, corps } = await appeler({
      voie: 'client',
      corps: { cle: 'cli-dbl', phrase: 'ajoute societe moanda', nom: 'SOCIETE MOANDA' },
    }, { depot });
    assert.equal(code, 409, 'il n’y a aucune contrainte d’unicité en base : rien ne rattraperait le doublon');
    assert.match(corps.detail, /existe déjà/);
    assert.equal(depot.tables.clients.length, 1);
  });
});

test('CLIENT : « Moanda » n’est PAS rattaché à « Moanda Services »', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot({
      tablesInitiales: { clients: [{ id: 'cl-1', nom: 'Moanda Services' }] },
    });
    const { code } = await appeler({
      voie: 'client',
      corps: { cle: 'cli-prefixe', phrase: 'ajoute Moanda', nom: 'Moanda' },
    }, { depot });
    assert.equal(code, 201, 'ce sont deux clients différents : un rattachement abusif enverrait la facture au mauvais');
  });
});

/* ── Événement ───────────────────────────────────────────────────────────── */

test('⛔ ÉVÉNEMENT : sans date, refus — la règle vient d’être posée', async () => {
  await avecJeton(JETON, async () => {
    for (const date of [undefined, '', 'bientôt', '2026-02-31', '2026-13-01']) {
      const { code, depot } = await appeler({
        voie: 'evenement',
        corps: { cle: `evt-${String(date)}`, phrase: 'ajoute la rentrée', nom: 'Rentrée', date },
      });
      assert.equal(code, 400, `date « ${date} » doit être refusée`);
      assert.deepEqual(depot.tables.evenements, [], 'la carte afficherait « Invalid Date »');
    }
  });
});

test('ÉVÉNEMENT : avec une vraie date, il est créé avec le type de l’écran', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot();
    const { code } = await appeler({
      voie: 'evenement',
      corps: {
        cle: 'evt-ok', phrase: 'la rentrée est le 15 septembre',
        nom: 'Rentrée scolaire', date: '2026-09-15', type: 'rentree_scolaire',
        opportunites: 'Cahiers, sacs, photocopies',
      },
    }, { depot });
    assert.equal(code, 201);
    const [e] = depot.tables.evenements;
    assert.equal(e.date, '2026-09-15');
    assert.equal(e.type, 'rentree_scolaire');
    assert.equal(e.recurrent, true);

    const r = await appeler({
      voie: 'evenement',
      corps: { cle: 'evt-type', phrase: 'p', nom: 'X', date: '2026-09-15', type: 'anniversaire' },
    });
    assert.equal(r.code, 400, 'un type inventé est refusé');
  });
});

/* ── Prospect ────────────────────────────────────────────────────────────── */

test('PROSPECT : le téléphone est obligatoire, comme à l’écran', async () => {
  await avecJeton(JETON, async () => {
    const { code, depot } = await appeler({
      voie: 'prospect',
      corps: { cle: 'pro-sans-tel', phrase: 'note ce prospect', geste: 'creer', nom: 'Lycée' },
    });
    assert.equal(code, 400);
    assert.deepEqual(depot.tables.prospects, []);
  });
});

test('PROSPECT : créé, puis une interaction s’ajoute à son historique', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot();
    await appeler({
      voie: 'prospect',
      corps: {
        cle: 'pro-1', phrase: 'le lycée veut des cahiers', geste: 'creer',
        nom: 'Lycée de Moanda', telephone: '077 00 00 00', type: 'ecole', source: 'passage',
      },
    }, { depot });
    const { code } = await appeler({
      voie: 'prospect',
      corps: {
        cle: 'pro-int-1', phrase: 'je les ai appelés, ils veulent un devis',
        geste: 'ajouter_interaction', prospect: 'Lycée de Moanda',
        type: 'appel', resume: 'Demande un devis pour 500 cahiers',
      },
    }, { depot });
    assert.equal(code, 201);
    const [p] = depot.tables.prospects;
    assert.equal(p.historiqueInteractions.length, 1);
    assert.equal(p.historiqueInteractions[0].type, 'appel');
    assert.equal(p.historiqueInteractions[0].auteur, 'ChatGPT (pont)');
  });
});

/* ── Objectif ────────────────────────────────────────────────────────────── */

test('OBJECTIF : posé sur le mois de MOANDA, jamais celui du serveur', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot();
    // 31 août 23 h 30 UTC = 1er septembre à Moanda.
    await appeler({
      voie: 'objectif',
      corps: { cle: 'obj-1', phrase: 'on vise 2 millions ce mois', titre: 'CA du mois', montant: 2000000 },
    }, { depot, maintenant: new Date(Date.UTC(2026, 7, 31, 23, 30, 0)) });
    assert.equal(
      depot.tables.objectifs[0].mois, '2026-09',
      'le mois lu sur l’horloge du serveur aurait rangé l’objectif en août',
    );
  });
});

test('OBJECTIF : un montant à zéro est refusé — il serait « atteint » au premier franc', async () => {
  await avecJeton(JETON, async () => {
    const { code, depot } = await appeler({
      voie: 'objectif',
      corps: { cle: 'obj-zero', phrase: 'objectif', titre: 'X', montant: 0 },
    });
    assert.equal(code, 400);
    assert.deepEqual(depot.tables.objectifs, []);
  });
});

/* ── Clôture de caisse ───────────────────────────────────────────────────── */

const RAPPORTS_DU_JOUR = [
  {
    id: 'r-impr', date: '2026-09-18', activite: 'imprimerie', statut: 'soumis',
    categories: { copies: 70000, imprimerie: 50000 },
    depenses: [{ description: 'Encre', montant: 20000 }],
  },
  {
    id: 'r-pap', date: '2026-09-18', activite: 'papeterie', statut: 'soumis',
    // ⚠️ Piège : une recette dans la CATÉGORIE `imprimerie`, sur un rapport de
    // l'ACTIVITÉ papeterie. Les confondre déplacerait 15 000 F d'une caisse à l'autre.
    categories: { marchandises: 30000, imprimerie: 15000 },
    depenses: [{ description: 'Sachets', montant: 5000 }],
  },
];

test('CLÔTURE : l’attendu est RECALCULÉ sur les rapports de CETTE caisse, pas dicté', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot({ tablesInitiales: { rapports: RAPPORTS_DU_JOUR } });
    const { code, corps } = await appeler({
      voie: 'cloture-caisse',
      corps: {
        cle: 'clo-1', phrase: 'j’ai compté le tiroir de l’imprimerie',
        denominations: { 10000: 9, 5000: 1, 1000: 5 },
        // Ce que ChatGPT pourrait vouloir imposer, et qu'on doit ignorer :
        montant_attendu: 999999,
      },
    }, { depot });
    assert.equal(code, 201, `refusé : ${JSON.stringify(corps)}`);
    const [c] = depot.tables.clotures_caisse;
    assert.equal(c.activite, 'imprimerie');
    assert.equal(
      c.montant_attendu, 100000,
      '70 000 + 50 000 − 20 000 : la papeterie ne doit RIEN apporter ici',
    );
    assert.equal(c.montant_reel, 100000, '9×10000 + 1×5000 + 5×1000');
    assert.equal(c.ecart, 0);
    assert.equal(c.statut, 'ok');
  });
});

test('CLÔTURE : la clé est (date, activité) — la papeterie garde son propre tiroir', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot({ tablesInitiales: { rapports: RAPPORTS_DU_JOUR } });
    const un = await appeler({
      voie: 'cloture-caisse',
      corps: { cle: 'clo-impr', phrase: 'tiroir imprimerie', denominations: { 10000: 10 } },
    }, { depot });
    assert.equal(un.code, 201);

    const deux = await appeler({
      voie: 'cloture-caisse',
      corps: { cle: 'clo-impr-2', phrase: 'encore', denominations: { 10000: 10 } },
    }, { depot });
    assert.equal(deux.code, 409, 'une seconde clôture compterait l’écart deux fois');

    const pap = await appeler({
      voie: 'cloture-caisse',
      corps: {
        cle: 'clo-pap', phrase: 'tiroir papeterie', activite: 'papeterie',
        denominations: { 10000: 2, 5000: 1 },
      },
    }, { depot });
    assert.equal(pap.code, 201, 'deux commerces, deux tiroirs, deux clôtures');
    const papeterie = depot.tables.clotures_caisse.find((c) => c.activite === 'papeterie');
    assert.equal(papeterie.montant_attendu, 40000, '30 000 + 15 000 − 5 000');
  });
});

test('CLÔTURE : les seuils d’écart sont ceux de l’écran', async () => {
  await avecJeton(JETON, async () => {
    // Attendu 100 000. On compte 96 000 → écart −4 000 → mineur.
    const depot = faussDepot({ tablesInitiales: { rapports: RAPPORTS_DU_JOUR } });
    await appeler({
      voie: 'cloture-caisse',
      corps: { cle: 'clo-ecart', phrase: 'il manque', denominations: { 10000: 9, 1000: 6 } },
    }, { depot });
    const [c] = depot.tables.clotures_caisse;
    assert.equal(c.ecart, -4000);
    assert.equal(c.statut, 'ecart_mineur');
  });
});

test('CLÔTURE : une coupure qui n’existe pas au Gabon est refusée', async () => {
  await avecJeton(JETON, async () => {
    const { code, depot } = await appeler({
      voie: 'cloture-caisse',
      corps: { cle: 'clo-faux', phrase: 'compte', denominations: { 20000: 3 } },
    });
    assert.equal(code, 400);
    assert.deepEqual(depot.tables.clotures_caisse, []);
  });
});

/* ── Devis et facture ────────────────────────────────────────────────────── */

test('DEVIS : total = sous-total − remise, sans aucune TVA', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot();
    const { code } = await appeler({
      voie: 'devis',
      corps: {
        cle: 'dev-1', phrase: 'fais un devis à la mairie', client_nom: 'Mairie de Moanda',
        objet: 'Flyers', remise: 5000,
        lignes: [{ description: 'Flyers A5', quantite: 200, prix_unitaire: 250 }],
      },
    }, { depot });
    assert.equal(code, 201);
    const [d] = depot.tables.devis;
    assert.equal(d.sous_total, 50000);
    assert.equal(d.remise, 5000);
    assert.equal(d.total_ttc, 45000, 'il n’y a pas de TVA dans cette application');
    assert.equal(d.total, 45000);
    assert.equal(d.statut, 'brouillon');
  });
});

test('DEVIS : une remise supérieure au total est refusée', async () => {
  await avecJeton(JETON, async () => {
    const { code, depot } = await appeler({
      voie: 'devis',
      corps: {
        cle: 'dev-remise', phrase: 'devis', client_nom: 'X', remise: 100000,
        lignes: [{ description: 'Y', quantite: 1, prix_unitaire: 1000 }],
      },
    });
    assert.equal(code, 400, 'le document serait négatif');
    assert.deepEqual(depot.tables.devis, []);
  });
});

test('⛔ FACTURE : « marquer payée » ne crédite AUCUN compte, et le DIT', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot({
      tablesInitiales: {
        factures: [{ id: 'f1', numero: 'FAC-2026-AAA111', statut: 'envoyee', total: 45000 }],
      },
    });
    const soldesAvant = new Map(depot.soldes);
    const { code, corps } = await appeler({
      voie: 'facture',
      corps: {
        cle: 'fac-payee', phrase: 'la mairie a payé la facture',
        geste: 'marquer_payee', facture: 'FAC-2026-AAA111',
      },
    }, { depot });
    assert.equal(code, 201);
    assert.equal(depot.tables.factures[0].statut, 'payee');
    assert.deepEqual(
      depot.tables.mouvements_financiers, [],
      'l’écran ne fait qu’un changement de statut : inventer un encaissement risquerait '
      + 'de compter deux fois une commande déjà encaissée',
    );
    for (const [id, solde] of soldesAvant) assert.equal(depot.soldes.get(id), solde);
    assert.match(
      corps.resume, /ne crédite AUCUN compte|trésorerie n'a pas bougé|trésorerie n’a pas bougé/,
      'le résumé doit empêcher de croire l’argent encaissé',
    );
  });
});

/* ── La provenance tient sur TOUS les gestes ─────────────────────────────── */

test('PROVENANCE : toutes les lignes écrites, quel que soit le geste, portent le marqueur', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot({
      tablesInitiales: {
        produits: [ARTICLE],
        produits_catalogue: [PRODUIT_AVEC_PHOTO],
        rapports: RAPPORTS_DU_JOUR,
      },
    });
    const demandes = [
      ['projet-travaux', { nom: 'Vitrine' }],
      ['catalogue', { geste: 'creer', nom: 'Bâches', categorie: 'Signalétique', prix: [{ qte_min: 1, prix: 15000 }] }],
      ['stock-mouvement', { geste: 'entree', article: 'Papier A4', quantite: 3 }],
      ['commande', { geste: 'creer', client_nom: 'Client', lignes: [{ description: 'X', quantite: 1, prix_unitaire: 100 }] }],
      ['client', { nom: 'Nouveau client' }],
      ['evenement', { nom: 'Fête', date: '2026-08-17', type: 'fete_nationale' }],
      ['prospect', { geste: 'creer', nom: 'École', telephone: '011' }],
      ['objectif', { titre: 'CA', montant: 500000 }],
      ['devis', { client_nom: 'Client', lignes: [{ description: 'X', quantite: 1, prix_unitaire: 100 }] }],
      ['facture', { geste: 'creer', client_nom: 'Client', lignes: [{ description: 'X', quantite: 1, prix_unitaire: 100 }] }],
    ];
    for (const [voie, corps] of demandes) {
      const r = await appeler({
        voie,
        corps: { cle: `prov-${voie}`, phrase: `phrase de ${voie}`, ...corps },
      }, { depot });
      assert.ok([200, 201].includes(r.code), `${voie} : ${JSON.stringify(r.corps)}`);
    }

    const ecrites = Object.entries(depot.tables)
      .filter(([c]) => c !== 'audit_logs')
      .flatMap(([collection, lignes]) => lignes.map((l) => ({ collection, l })));
    const neuves = ecrites.filter(({ l }) => l[CHAMP_CLE]?.startsWith('prov-'));
    assert.ok(neuves.length >= demandes.length, `écritures manquantes : ${neuves.length}`);
    for (const { collection, l } of neuves) {
      assert.equal(l[CHAMP_MARQUEUR], true, `${collection} : marqueur absent`);
      assert.ok(l.chatgpt?.phrase, `${collection} : phrase absente`);
      assert.equal(l.chatgpt.ecrit_le.fuseau, 'Africa/Libreville', `${collection} : heure non datée à Moanda`);
    }
    assert.equal(
      depot.tables.audit_logs.length, demandes.length,
      'chaque écriture doit avoir sa trace d’audit',
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   15. ANNULER LES GESTES DES AUTRES MODULES
   ═══════════════════════════════════════════════════════════════════════════

   Une correction ne s'annule pas en marquant la ligne : le prix corrigé
   resterait corrigé. Il faut REMETTRE la valeur d'avant — et c'est pour ça que
   chaque geste de modification la relève au passage.
   ═══════════════════════════════════════════════════════════════════════════ */

test('ANNULATION : une correction de prix REMET l’ancien prix, sans toucher aux images', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot({ tablesInitiales: { produits_catalogue: [PRODUIT_AVEC_PHOTO] } });
    const creation = await appeler({
      voie: 'catalogue',
      corps: {
        cle: 'cat-annul', phrase: 'le t-shirt est à 5000', geste: 'corriger_prix',
        produit: 'T-shirt personnalisé', prix: [{ qte_min: 1, qte_max: null, prix: 5000 }],
      },
    }, { depot });
    assert.equal(creation.code, 201);
    assert.equal(depot.tables.produits_catalogue[0].prix[0].prix, 5000);

    const { code, corps } = await appeler({
      voie: 'annuler',
      corps: { identifiant: creation.corps.identifiant, phrase: 'non, il est bien à 0' },
    }, { depot });
    assert.equal(code, 200, `annulation refusée : ${JSON.stringify(corps)}`);

    const p = depot.tables.produits_catalogue[0];
    assert.equal(p.prix[0].prix, 0, 'le prix d’avant doit être revenu');
    assert.deepEqual(p.images, ['data:image/png;base64,AAAA'], 'les images restent intactes');
    assert.ok(p.annule_le, 'la trace de l’annulation reste sur la ligne');
    assert.equal(depot.tables.produits_catalogue.length, 1, 'aucune ligne ne disparaît');
  });
});

test('ANNULATION : un seuil de stock revient à sa valeur d’avant', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot({ tablesInitiales: { produits: [ARTICLE] } });
    const creation = await appeler({
      voie: 'stock-mouvement',
      corps: { cle: 'stk-annul-seuil', phrase: 'alerte à 20', geste: 'seuil', article: 'Papier A4', seuil: 20 },
    }, { depot });
    await appeler({
      voie: 'annuler',
      corps: { identifiant: creation.corps.identifiant, phrase: 'remets comme avant' },
    }, { depot });
    assert.equal(
      depot.tables.produits[0].quantite_minimum, 3,
      'le seuil réglé par le gérant doit être rétabli, pas remis à zéro ni à dix',
    );
  });
});

test('ANNULATION : un mouvement de stock est contre-passé ET la quantité rétablie', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot({ tablesInitiales: { produits: [ARTICLE] } });
    const creation = await appeler({
      voie: 'stock-mouvement',
      corps: { cle: 'stk-annul', phrase: 'sortie de 5', geste: 'sortie', article: 'Papier A4', quantite: 5, motif: 'Erreur' },
    }, { depot });
    assert.equal(depot.tables.produits[0].quantite, 7);

    const { code } = await appeler({
      voie: 'annuler',
      corps: { identifiant: creation.corps.identifiant, phrase: 'je me suis trompé' },
    }, { depot });
    assert.equal(code, 200);

    assert.equal(
      depot.tables.mouvements_stock.length, 2,
      'annuler AJOUTE un mouvement inverse : l’inventaire garde la trace des deux',
    );
    const inverse = depot.tables.mouvements_stock[1];
    assert.equal(inverse.type, 'entree');
    assert.equal(inverse.quantite, 5);
    assert.equal(
      depot.tables.produits[0].quantite, 12,
      'la quantité physique doit être revenue, sinon l’écart ne se voit qu’au comptage',
    );
    assert.equal(depot.tables.produits[0].stock, 12);
  });
});

test('ANNULATION : un statut de commande revient à celui d’avant', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot({
      tablesInitiales: {
        commandes: [{ id: 'c1', numero: 'CMD-2026-ABC123', statut: 'validee_attente_paiement', client_nom: 'Mairie' }],
      },
    });
    const creation = await appeler({
      voie: 'commande',
      corps: {
        cle: 'cmd-annul', phrase: 'passe en production', geste: 'changer_statut',
        commande: 'CMD-2026-ABC123', statut: 'en_production',
      },
    }, { depot });
    await appeler({
      voie: 'annuler',
      corps: { identifiant: creation.corps.identifiant, phrase: 'non, pas encore' },
    }, { depot });
    assert.equal(depot.tables.commandes[0].statut, 'validee_attente_paiement');
  });
});

test('ANNULATION : une facture marquée payée redevient ce qu’elle était', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot({
      tablesInitiales: { factures: [{ id: 'f1', numero: 'FAC-2026-AAA111', statut: 'envoyee' }] },
    });
    const creation = await appeler({
      voie: 'facture',
      corps: { cle: 'fac-annul', phrase: 'payée', geste: 'marquer_payee', facture: 'FAC-2026-AAA111' },
    }, { depot });
    await appeler({
      voie: 'annuler',
      corps: { identifiant: creation.corps.identifiant, phrase: 'finalement non' },
    }, { depot });
    assert.equal(depot.tables.factures[0].statut, 'envoyee');
  });
});

test('ANNULATION : une création d’un autre module est marquée, jamais retirée', async () => {
  await avecJeton(JETON, async () => {
    const cas = [
      ['evenement', { nom: 'Fête', date: '2026-08-17' }, 'evenements', 'nom'],
      ['objectif', { titre: 'CA du mois', montant: 500000 }, 'objectifs', 'titre'],
      ['projet-travaux', { nom: 'Vitrine' }, 'projets_travaux', 'nom'],
    ];
    for (const [voie, corps, collection, champ] of cas) {
      const depot = faussDepot();
      const creation = await appeler({
        voie, corps: { cle: `ann-${voie}`, phrase: `crée ${voie}`, ...corps },
      }, { depot });
      assert.equal(creation.code, 201, `${voie} : ${JSON.stringify(creation.corps)}`);
      const { code } = await appeler({
        voie: 'annuler',
        corps: { identifiant: creation.corps.identifiant, phrase: 'retire ça' },
      }, { depot });
      assert.equal(code, 200, `${voie} : annulation refusée`);
      assert.equal(depot.tables[collection].length, 1, `${voie} : la ligne ne doit pas disparaître`);
      const l = depot.tables[collection][0];
      assert.ok(l.annule_le, `${voie} : la date d’annulation doit être posée`);
      assert.match(l[champ], /ANNUL/i, `${voie} : l’écran d’origine doit montrer l’annulation`);
    }
  });
});

test('ANNULATION : une fiche client annulée le DIT — elle reste visible à son écran', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot();
    const creation = await appeler({
      voie: 'client',
      corps: { cle: 'cli-annul', phrase: 'note ce client', nom: 'Client de passage' },
    }, { depot });
    const { code, corps } = await appeler({
      voie: 'annuler',
      corps: { identifiant: creation.corps.identifiant, phrase: 'finalement non' },
    }, { depot });
    assert.equal(code, 200);
    const [c] = depot.tables.clients;
    assert.ok(c.annule_le);
    assert.equal(
      c.nom, 'Client de passage',
      'renommer une fiche client abîmerait ce que les autres écrans affichent',
    );
    assert.match(
      corps.resume, /reste visible/,
      'le résumé doit dire que la ligne est toujours dans son écran : sinon on la croit partie',
    );
  });
});

test('ANNULATION : toutes les collections écrites sont retrouvables pour être annulées', async () => {
  await avecJeton(JETON, async () => {
    // Un identifiant valide mais jamais écrit doit rendre 404 sur CHAQUE
    // collection : c'est la preuve que la recherche les balaie toutes, et pas
    // seulement les trois du périmètre d'origine.
    const source = lire('api/_lib/chatgpt-ecriture.js');
    assert.match(
      source, /COLLECTIONS_ECRITURES\.filter/,
      'la recherche d’une écriture à annuler doit balayer toutes les collections servies — '
      + 'une liste écrite à la main oublierait les gestes ajoutés ensuite',
    );
  });
});

test('⛔ STOCK : un mouvement rejeté en doublon ne décrémente PAS le stock', async () => {
  await avecJeton(JETON, async () => {
    const depot = faussDepot({ tablesInitiales: { produits: [ARTICLE] } });
    const corps = {
      cle: 'stk-doublon', phrase: 'sortie de 5', geste: 'sortie',
      article: 'Papier A4', quantite: 5,
    };
    await appeler({ voie: 'stock-mouvement', corps }, { depot });
    assert.equal(depot.tables.produits[0].quantite, 7);

    /* On force le cas que l'idempotence par témoin ne couvre pas : la ligne de
       mouvement existe déjà en base (course entre deux instances), mais le
       témoin n'a pas encore été vu. Le plan est rejoué — et le décrément ne
       doit PAS repasser, sinon 5 rames disparaissent sans qu'aucune ligne ne
       l'explique. */
    const { operations } = preparerGeste('stock-mouvement', { ...corps, cle: 'stk-doublon-bis' }, {
      ctx: {
        instant_utc: '2026-09-18T17:12:05Z', date_locale: '2026-09-18', heure_locale: '18:12:05',
        mois_local: '2026-09', fuseau: 'Africa/Libreville', offset_utc: '+01:00', lisible: 'x',
      },
      articles: [{ ...ARTICLE, quantite: 7, stock: 7 }],
    });
    const creation = operations.find((o) => o.op === 'creer');
    const modification = operations.find((o) => o.op === 'modifier');
    assert.ok(creation.id_op, 'la création doit être nommée');
    assert.equal(
      modification.conditionne_par, creation.id_op,
      'le décrément doit être conditionné à l’écriture réelle du mouvement',
    );
  });
});

test('⛔ EXÉCUTION : les deux exécutants honorent la condition, pas seulement le serveur', () => {
  // Le serveur (pour ChatGPT) et l'écran (pour le bouton du gérant) appliquent
  // le MÊME plan. Si l'un ignorait `conditionne_par`, une annulation faite à
  // l'écran débiterait un stock ou un solde que celle faite par ChatGPT aurait
  // laissé tranquille — et personne ne saurait laquelle croire.
  for (const chemin of [
    'api/_lib/chatgpt-ecriture.js',
    'src/features/chatgpt-ecritures/page.jsx',
  ]) {
    const source = lire(chemin);
    const gardes = source.match(/op\.conditionne_par && inserees\.get\(op\.conditionne_par\) !== true/g) || [];
    assert.ok(
      gardes.length >= 2,
      `${chemin} : la garde doit protéger À LA FOIS les modifications et les soldes `
      + `(trouvée ${gardes.length} fois)`,
    );
  }
});
