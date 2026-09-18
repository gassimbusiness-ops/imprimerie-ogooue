/**
 * LE BOT MESSENGER / INSTAGRAM — CE QUI PART, ET CE QUI NE PART PAS.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LES QUATRE RÈGLES DURES, CHACUNE AVEC SON TEST
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   1. IDEMPOTENCE — Meta rejoue un événement quand il n'obtient pas un 200
 *      assez vite. Répondre deux fois est une faute VISIBLE PAR LE CLIENT.
 *      L'arbitre est le TÉMOIN DE L'EFFET : l'identifiant du message sortant
 *      rendu par Meta, enregistré au journal — jamais un statut qu'on aurait
 *      posé soi-même (leçon SingPay du 16/09, `tasks/lessons.md`).
 *
 *   2. UN INTERRUPTEUR — le bot démarre ÉTEINT et se coupe en dix secondes sans
 *      redéploiement. Même patron que l'auto-poster : une ligne EN BASE (le
 *      verrou d'exploitation) ET une variable d'environnement (le cran de
 *      sûreté). Aucun des deux n'ouvre seul.
 *
 *   3. UN JOURNAL — tout message reçu et toute réponse envoyée laissent une
 *      ligne. Sans journal, personne ne saura jamais ce que le bot a raconté
 *      aux clients.
 *
 *   4. JAMAIS D'ÉCRITURE MÉTIER — le bot répond. Il ne crée ni commande, ni
 *      client, ni devis.
 *
 * ⛔ ZÉRO APPEL RÉSEAU : le client Meta est une doublure. Les charges utiles —
 *    y compris les erreurs — reproduisent les formes réelles de l'API.
 *
 * Lancer :  node --test tests/bot-executeur.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  repondreAuxEvenements,
  modeBotEffectif,
  modeBotDemande,
  MODE_SIMULATION,
  MODE_REEL,
  COLLECTION_BOT_CONTROLE,
  COLLECTION_BOT_JOURNAL,
} from '../api/_lib/bot-executeur.js';

import { creerClientBot } from '../api/_lib/bot-envoi.js';
import { catalogueReponses } from '../api/_lib/bot-reponse.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Outils — dépôt en mémoire, client Meta doublé, environnement
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Dépôt en mémoire, même contrat que `bot-depot.js`.
 * `envois` note ce que le client a réellement tenté d'envoyer.
 */
function depotMemoire({ actif = true, mode = MODE_REEL } = {}) {
  const journal = [];
  // Les réservations tiennent lieu de l'index unique que pose la migration 013 :
  // deux exécutions simultanées ne peuvent pas prendre le même message.
  const reservations = new Set();
  let n = 0;
  return {
    journal,
    reservations,
    interrupteur: { actif, mode },
    async lireInterrupteur() { return this.interrupteur; },
    async temoinReponse(messageIdEntrant) {
      return journal.find(
        (l) => l.message_id_entrant === messageIdEntrant && l.id_message_sortant,
      ) || null;
    },
    async humainAPrisLaMain() { return false; },
    async reserver(entree) {
      if (reservations.has(entree.message_id_entrant)) return { reserve: false, id: null };
      reservations.add(entree.message_id_entrant);
      n += 1;
      const id = `bj-${n}`;
      journal.push({ id, ...entree });
      return { reserve: true, id };
    },
    async confirmer(id, complement) {
      const i = journal.findIndex((l) => l.id === id);
      if (i === -1) throw new Error(`réservation introuvable : ${id}`);
      journal[i] = { ...journal[i], ...complement };
    },
    async journaliser(entree) { journal.push(entree); },
  };
}

/** Client Meta doublé : aucun réseau, et on garde la trace des envois. */
function clientDouble({ echec = null } = {}) {
  const envois = [];
  let n = 0;
  return {
    envois,
    disponible: true,
    async envoyerMessage({ canal, destinataireId, texte }) {
      envois.push({ canal, destinataireId, texte });
      if (echec) throw echec;
      n += 1;
      return { idMessage: `mid.sortant.${n}`, simule: false, brut: { message_id: `mid.sortant.${n}` } };
    },
  };
}

function evenementMessenger(mid, texte, { expediteur = 'PSID-1', page = '113984578429672' } = {}) {
  return {
    message_id: mid,
    canal: 'messenger',
    page_id: page,
    expediteur_id: expediteur,
    destinataire_id: page,
    type: 'message',
    recu_le: '2026-09-19T21:40:00.000Z',
    evenement: {
      sender: { id: expediteur },
      recipient: { id: page },
      timestamp: 1789000000000,
      message: { mid, text: texte },
    },
  };
}

function evenementInstagram(mid, texte, { expediteur = 'IGSID-9', compte = '17841400000000000' } = {}) {
  return {
    message_id: mid,
    canal: 'instagram',
    page_id: compte,
    expediteur_id: expediteur,
    destinataire_id: compte,
    type: 'message',
    recu_le: '2026-09-19T21:41:00.000Z',
    evenement: {
      sender: { id: expediteur },
      recipient: { id: compte },
      timestamp: 1789000000001,
      message: { mid, text: texte },
    },
  };
}

function avecEnv(vars, fn) {
  const anciens = {};
  for (const [k, v] of Object.entries(vars)) {
    anciens[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const restaurer = () => {
    for (const [k, v] of Object.entries(anciens)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  const resultat = fn();
  if (resultat && typeof resultat.then === 'function') return resultat.finally(restaurer);
  restaurer();
  return resultat;
}

const MUET = () => {};

/* ═══════════════════════════════════════════════════════════════════════════
   1. L'INTERRUPTEUR — LE BOT DÉMARRE ÉTEINT
   ═══════════════════════════════════════════════════════════════════════════ */

test('interrupteur absent en base = bot ÉTEINT : rien n est envoyé', async () => {
  await avecEnv({ BOT_META_MODE: MODE_REEL }, async () => {
    const depot = depotMemoire();
    depot.lireInterrupteur = async () => null; // la ligne n'existe pas encore
    const client = clientDouble();
    const bilan = await repondreAuxEvenements({
      depot, client, evenements: [evenementMessenger('m_1', 'Vous ouvrez à quelle heure ?')], tracer: MUET,
    });
    assert.equal(client.envois.length, 0, 'un bot dont on ne trouve pas l interrupteur se tait');
    assert.equal(bilan.envoyes, 0);
    assert.equal(depot.journal[0].action, 'ignore');
    assert.equal(depot.journal[0].motif, 'bot_eteint');
  });
});

test('interrupteur à l arrêt : le bot ne répond pas, et le journal dit pourquoi', async () => {
  await avecEnv({ BOT_META_MODE: MODE_REEL }, async () => {
    const depot = depotMemoire({ actif: false });
    const client = clientDouble();
    await repondreAuxEvenements({
      depot, client, evenements: [evenementMessenger('m_2', 'Vous êtes où ?')], tracer: MUET,
    });
    assert.equal(client.envois.length, 0);
    assert.equal(depot.journal.length, 1, 'un message reçu laisse une trace même sans réponse');
    assert.equal(depot.journal[0].motif, 'bot_eteint');
  });
});

test('les deux verrous sont nécessaires : la base seule n ouvre pas', () => {
  return avecEnv({ BOT_META_MODE: undefined }, () => {
    assert.equal(modeBotDemande(), MODE_SIMULATION);
    assert.equal(modeBotEffectif({ actif: true, mode: MODE_REEL }), MODE_SIMULATION,
      'une ligne de base modifiée par erreur ne met pas le bot en ligne');
  });
});

test('les deux verrous sont nécessaires : la variable seule n ouvre pas', () => {
  return avecEnv({ BOT_META_MODE: MODE_REEL }, () => {
    assert.equal(modeBotEffectif({ actif: true, mode: MODE_SIMULATION }), MODE_SIMULATION);
    assert.equal(modeBotEffectif({ actif: true, mode: MODE_REEL }), MODE_REEL);
  });
});

test('en simulation, la réponse est composée et journalisée mais AUCUN envoi ne part', async () => {
  await avecEnv({ BOT_META_MODE: undefined }, async () => {
    const depot = depotMemoire({ actif: true, mode: MODE_REEL });
    const client = clientDouble();
    await repondreAuxEvenements({
      depot, client, evenements: [evenementMessenger('m_3', 'vos horaires ?')], tracer: MUET,
    });
    assert.equal(client.envois.length, 0, 'la simulation ne touche pas le réseau');
    const ligne = depot.journal[0];
    assert.equal(ligne.mode, MODE_SIMULATION);
    assert.equal(ligne.action, 'simule');
    assert.ok(ligne.texte, 'on doit pouvoir lire ce que le bot AURAIT dit');
    assert.equal(ligne.id_message_sortant, null,
      'une simulation ne pose pas de témoin : sinon la vraie réponse ne partirait jamais');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. IDEMPOTENCE — UN REJEU NE PRODUIT PAS UNE SECONDE RÉPONSE
   ═══════════════════════════════════════════════════════════════════════════ */

test('le MÊME événement rejoué ne produit QU UNE seule réponse', async () => {
  await avecEnv({ BOT_META_MODE: MODE_REEL }, async () => {
    const depot = depotMemoire();
    const client = clientDouble();
    const evenement = evenementMessenger('m_rejeu', 'Vous êtes où ?');

    await repondreAuxEvenements({ depot, client, evenements: [evenement], tracer: MUET });
    await repondreAuxEvenements({ depot, client, evenements: [evenement], tracer: MUET });
    await repondreAuxEvenements({ depot, client, evenements: [evenement], tracer: MUET });

    assert.equal(client.envois.length, 1, 'trois livraisons, une seule réponse au client');
    const rejeux = depot.journal.filter((l) => l.motif === 'deja_repondu');
    assert.equal(rejeux.length, 2);
  });
});

test('le même identifiant DEUX FOIS dans le même lot ne part qu une fois', async () => {
  await avecEnv({ BOT_META_MODE: MODE_REEL }, async () => {
    const depot = depotMemoire();
    const client = clientDouble();
    const evenement = evenementMessenger('m_double', 'vos horaires ?');
    await repondreAuxEvenements({ depot, client, evenements: [evenement, evenement], tracer: MUET });
    assert.equal(client.envois.length, 1);
  });
});

test('DEUX exécutions simultanées : une seule prend le message, une seule réponse part', async () => {
  // Le rejeu à quelques secondes est fermé par le témoin. La course VRAIE —
  // deux instances serverless réveillées par la même relivraison — est fermée
  // par la réservation, c'est-à-dire par l'index unique de la migration 013.
  await avecEnv({ BOT_META_MODE: MODE_REEL }, async () => {
    const depot = depotMemoire();
    const client = clientDouble();
    const evenement = evenementMessenger('m_course', 'vos horaires ?');
    await Promise.all([
      repondreAuxEvenements({ depot, client, evenements: [evenement], tracer: MUET }),
      repondreAuxEvenements({ depot, client, evenements: [evenement], tracer: MUET }),
    ]);
    assert.equal(client.envois.length, 1, 'un doublon de réponse se lit chez le client');
    assert.ok(depot.journal.some((l) => l.motif === 'pris_par_une_autre_execution'));
  });
});

test('la réservation est écrite AVANT l appel réseau — un processus mort laisse une trace', async () => {
  await avecEnv({ BOT_META_MODE: MODE_REEL }, async () => {
    const depot = depotMemoire();
    let journalAuMomentDeLEnvoi = null;
    const client = {
      disponible: true,
      envois: [],
      async envoyerMessage(arg) {
        journalAuMomentDeLEnvoi = JSON.parse(JSON.stringify(depot.journal));
        this.envois.push(arg);
        return { idMessage: 'mid.1', simule: false, brut: {} };
      },
    };
    await repondreAuxEvenements({
      depot, client, evenements: [evenementMessenger('m_ancre', 'vos horaires ?')], tracer: MUET,
    });
    assert.equal(journalAuMomentDeLEnvoi.length, 1, 'la ligne existe déjà quand l appel part');
    assert.equal(journalAuMomentDeLEnvoi[0].action, 'en_cours');
    assert.equal(journalAuMomentDeLEnvoi[0].id_message_sortant, null);
  });
});

test('le témoin est l identifiant rendu par META, pas un drapeau posé par nous', async () => {
  await avecEnv({ BOT_META_MODE: MODE_REEL }, async () => {
    const depot = depotMemoire();
    const client = clientDouble();
    await repondreAuxEvenements({
      depot, client, evenements: [evenementMessenger('m_temoin', 'vous êtes où ?')], tracer: MUET,
    });
    const ligne = depot.journal[0];
    assert.equal(ligne.id_message_sortant, 'mid.sortant.1');
    assert.equal(ligne.action, 'repondu');
  });
});

test('un envoi ÉCHOUÉ ne pose pas de témoin : le message pourra être repris', async () => {
  await avecEnv({ BOT_META_MODE: MODE_REEL }, async () => {
    const echec = Object.assign(new Error('code=190 type=OAuthException : Error validating access token'), {
      name: 'ErreurMeta', codeMeta: '190',
    });
    const depot = depotMemoire();
    const client = clientDouble({ echec });
    await repondreAuxEvenements({
      depot, client, evenements: [evenementMessenger('m_echec', 'vos horaires ?')], tracer: MUET,
    });
    const ligne = depot.journal[0];
    assert.equal(ligne.action, 'echec');
    assert.equal(ligne.id_message_sortant, null);
    assert.ok(ligne.erreur.includes('190'), 'le code Meta brut est conservé, pas résumé');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. MESSENGER ET INSTAGRAM — DEUX ENREGISTREMENTS, DEUX CHARGES UTILES
   ═══════════════════════════════════════════════════════════════════════════ */

test('Messenger : la réponse part sur le bon canal, au bon destinataire', async () => {
  await avecEnv({ BOT_META_MODE: MODE_REEL }, async () => {
    const depot = depotMemoire();
    const client = clientDouble();
    await repondreAuxEvenements({
      depot, client, evenements: [evenementMessenger('m_fb', 'Vous êtes où ?')], tracer: MUET,
    });
    assert.equal(client.envois[0].canal, 'messenger');
    assert.equal(client.envois[0].destinataireId, 'PSID-1');
  });
});

test('Instagram : même traitement, canal distinct, destinataire distinct', async () => {
  await avecEnv({ BOT_META_MODE: MODE_REEL }, async () => {
    const depot = depotMemoire();
    const client = clientDouble();
    await repondreAuxEvenements({
      depot, client, evenements: [evenementInstagram('ig_1', 'Vous ouvrez samedi ?')], tracer: MUET,
    });
    assert.equal(client.envois.length, 1);
    assert.equal(client.envois[0].canal, 'instagram');
    assert.equal(client.envois[0].destinataireId, 'IGSID-9');
    assert.equal(depot.journal[0].canal, 'instagram');
  });
});

test('les deux canaux passent dans le même lot, sans se mélanger', async () => {
  await avecEnv({ BOT_META_MODE: MODE_REEL }, async () => {
    const depot = depotMemoire();
    const client = clientDouble();
    await repondreAuxEvenements({
      depot,
      client,
      evenements: [
        evenementMessenger('m_mix', 'vos horaires ?'),
        evenementInstagram('ig_mix', 'vous êtes où ?'),
      ],
      tracer: MUET,
    });
    assert.deepEqual(client.envois.map((e) => e.canal), ['messenger', 'instagram']);
  });
});

test('le client Meta construit bien les deux appels — et n en fait AUCUN sans jeton', async () => {
  const appels = [];
  const fauxFetch = async (url, options) => {
    appels.push({ url, corps: options.body });
    return { ok: true, status: 200, json: async () => ({ message_id: 'mid.abc', recipient_id: 'X' }) };
  };

  const client = creerClientBot({ jeton: 'JETON-DE-TEST', fetchImpl: fauxFetch });
  await client.envoyerMessage({
    canal: 'messenger', destinataireId: 'PSID-1', texte: 'coucou', compteId: '113984578429672',
  });
  await client.envoyerMessage({
    canal: 'instagram', destinataireId: 'IGSID-9', texte: 'coucou', compteId: '17841400000000000',
  });

  assert.equal(appels.length, 2);
  assert.ok(appels[0].url.includes('/113984578429672/messages'));
  assert.ok(appels[0].corps.includes('messaging_type=RESPONSE'), 'Messenger : réponse dans la fenêtre de 24 h');
  assert.ok(appels[1].url.includes('/17841400000000000/messages'));
  for (const appel of appels) {
    assert.ok(!appel.url.includes('access_token'),
      'un jeton dans une URL finit dans les journaux d accès : il part en en-tête');
  }

  const sansJeton = creerClientBot({ jeton: '', fetchImpl: fauxFetch });
  assert.equal(sansJeton.disponible, false);
  await assert.rejects(
    () => sansJeton.envoyerMessage({ canal: 'messenger', destinataireId: 'X', texte: 'y', compteId: 'Z' }),
    /jeton/i,
  );
  assert.equal(appels.length, 2, 'aucun appel réseau supplémentaire');
});

test('une erreur réelle de l API Meta est rendue lisible sans être maquillée', async () => {
  const fauxFetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({
      error: {
        message: '(#10) This message is sent outside of allowed window.',
        type: 'OAuthException',
        code: 10,
        error_subcode: 2018278,
        fbtrace_id: 'AbCdEf',
      },
    }),
  });
  const client = creerClientBot({ jeton: 'JETON', fetchImpl: fauxFetch });
  await assert.rejects(
    () => client.envoyerMessage({ canal: 'messenger', destinataireId: 'X', texte: 'y', compteId: 'Z' }),
    (err) => {
      assert.equal(err.name, 'ErreurMeta');
      assert.ok(err.message.includes('code=10'));
      assert.ok(err.message.includes('AbCdEf'), 'le fbtrace_id est ce qui permet à Meta de retrouver l appel');
      return true;
    },
  );
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. LE BOT NE FAIT RIEN D'AUTRE QUE RÉPONDRE
   ═══════════════════════════════════════════════════════════════════════════ */

test('aucune écriture métier : le dépôt n expose que le journal et l interrupteur', async () => {
  await avecEnv({ BOT_META_MODE: MODE_REEL }, async () => {
    const depot = depotMemoire();
    const client = clientDouble();
    const interdits = [];
    for (const nom of ['creerCommande', 'creerClient', 'creerDevis', 'inserer', 'ecrire']) {
      Object.defineProperty(depot, nom, {
        value: () => { interdits.push(nom); },
        enumerable: true,
      });
    }
    await repondreAuxEvenements({
      depot, client, evenements: [evenementMessenger('m_metier', 'je veux commander 30 polos')], tracer: MUET,
    });
    assert.deepEqual(interdits, [], 'le bot répond, il ne crée rien');
  });
});

test('le bot ne sert QUE des textes du catalogue — rien d autre ne peut partir', async () => {
  await avecEnv({ BOT_META_MODE: MODE_REEL }, async () => {
    const depot = depotMemoire();
    const client = clientDouble();
    const questions = [
      'vos horaires ?', 'adresse svp', 'vous faites des banderoles ?',
      'prix pour 500 flyers', 'délai ?', 'urgent !!', 'comment payer',
      'vous êtes un robot ?', 'question totalement hors sujet',
    ];
    await repondreAuxEvenements({
      depot,
      client,
      evenements: questions.map((q, i) => evenementMessenger(`m_cat_${i}`, q)),
      tracer: MUET,
    });
    const catalogue = new Set(catalogueReponses());
    for (const envoi of client.envois) {
      assert.ok(catalogue.has(envoi.texte), `texte hors catalogue envoyé :\n${envoi.texte}`);
    }
  });
});

test('le bot ne répond QUE sur les comptes déclarés — TopShop partage le portefeuille', async () => {
  // Le jeton de Page verra DEUX Pages : celle de l'imprimerie (113984578429672)
  // et celle de TopShop, dont les actifs sont dans le même portefeuille
  // (`tasks/todo.md`, fait mesuré le 17/09). Répondre les horaires de
  // l'imprimerie à un client de TopShop serait une réponse fausse.
  await avecEnv({ BOT_META_MODE: MODE_REEL, META_PAGE_ID: '113984578429672' }, async () => {
    const depot = depotMemoire();
    const client = clientDouble();
    await repondreAuxEvenements({
      depot,
      client,
      evenements: [
        evenementMessenger('m_voisin', 'vos horaires ?', { page: '999999999999999' }),
        evenementMessenger('m_nous', 'vos horaires ?', { page: '113984578429672' }),
      ],
      tracer: MUET,
    });
    assert.equal(client.envois.length, 1, 'seule la Page de l imprimerie reçoit une réponse');
    const ecarte = depot.journal.find((l) => l.message_id_entrant === 'm_voisin');
    assert.equal(ecarte.motif, 'compte_non_reconnu');
  });
});

test('sans META_PAGE_ID déclaré, le bot répond là où on lui a écrit', async () => {
  await avecEnv({ BOT_META_MODE: MODE_REEL, META_PAGE_ID: undefined, META_INSTAGRAM_ID: undefined },
    async () => {
      const depot = depotMemoire();
      const client = clientDouble();
      await repondreAuxEvenements({
        depot, client, evenements: [evenementMessenger('m_libre', 'vos horaires ?')], tracer: MUET,
      });
      assert.equal(client.envois.length, 1);
    });
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. QUAND L'HUMAIN A PRIS LA MAIN, LE BOT SE TAIT
   ═══════════════════════════════════════════════════════════════════════════ */

test('si le gérant a déjà répondu dans la conversation, le bot ne parle plus', async () => {
  // 07_SCHEDULER_ET_BOTS_SPEC.md : « Équipe prend la conversation → Bot cesse
  // la conduite commerciale automatique. »
  await avecEnv({ BOT_META_MODE: MODE_REEL }, async () => {
    const depot = depotMemoire();
    depot.humainAPrisLaMain = async () => true;
    const client = clientDouble();
    await repondreAuxEvenements({
      depot, client, evenements: [evenementMessenger('m_humain', 'vos horaires ?')], tracer: MUET,
    });
    assert.equal(client.envois.length, 0);
    assert.equal(depot.journal[0].motif, 'humain_en_charge');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   6. LE JOURNAL
   ═══════════════════════════════════════════════════════════════════════════ */

test('le journal porte le canal, la fiche, l intention, le mode et une date de MOANDA', async () => {
  await avecEnv({ BOT_META_MODE: MODE_REEL }, async () => {
    const depot = depotMemoire();
    const client = clientDouble();
    // 21 h 40 UTC le 19 = 22 h 40 à Moanda le 19. Et 23 h 30 UTC = le LENDEMAIN.
    const tard = evenementMessenger('m_date', 'vos horaires ?');
    tard.recu_le = '2026-09-19T23:30:00.000Z';
    await repondreAuxEvenements({
      depot, client, evenements: [tard], instant: new Date('2026-09-19T23:30:00.000Z'), tracer: MUET,
    });
    const ligne = depot.journal[0];
    assert.equal(ligne.canal, 'messenger');
    assert.equal(ligne.intention, 'horaires');
    assert.equal(ligne.fiche_id, 'KB-15');
    assert.equal(ligne.mode, MODE_REEL);
    assert.equal(ligne.date_locale, '2026-09-20',
      'à Moanda (UTC+1) il est déjà le 20 : la date du serveur Vercel mentirait');
  });
});

test('le journal ne recopie pas le message du client — il le référence', async () => {
  await avecEnv({ BOT_META_MODE: MODE_REEL }, async () => {
    const depot = depotMemoire();
    const client = clientDouble();
    const secret = 'mon numéro de carte est 4242 4242 4242 4242';
    await repondreAuxEvenements({
      depot, client, evenements: [evenementMessenger('m_prive', secret)], tracer: MUET,
    });
    const serialise = JSON.stringify(depot.journal);
    assert.ok(!serialise.includes('4242'),
      'le contenu client vit dans messages_meta, pas recopié dans le journal du bot');
    assert.equal(depot.journal[0].message_id_entrant, 'm_prive',
      'la référence suffit à retrouver le message d origine');
  });
});

test('les collections de rangement sont nommées une seule fois', () => {
  assert.equal(COLLECTION_BOT_CONTROLE, 'bot_controle');
  assert.equal(COLLECTION_BOT_JOURNAL, 'bot_journal');
});
