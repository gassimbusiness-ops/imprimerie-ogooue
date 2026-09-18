/**
 * L'ÉCRAN MESSAGERIE — LE JOURNAL DU BOT, MONTÉ POUR DE VRAI.
 *
 * ── Pourquoi ce fichier existe ────────────────────────────────────────────
 *
 * « Chaque message reçu et chaque réponse envoyée doivent être consultables
 * dans l'application — sinon personne ne saura jamais ce que le bot a raconté
 * aux clients. » C'est la règle dure n°3 du chantier.
 *
 * Un bot qui répond sur la page publique de l'entreprise sans que le gérant
 * puisse relire ce qu'il a dit, c'est un employé qu'on ne voit jamais. Ces
 * tests exigent trois choses à l'écran :
 *
 *   1. l'état de l'interrupteur, en clair — un bot éteint ne doit pas passer
 *      pour un bot en panne, ni l'inverse ;
 *   2. ce que le bot a RÉELLEMENT envoyé, canal par canal ;
 *   3. les messages auxquels il n'a PAS répondu, avec le motif.
 *
 * Et une quatrième, héritée du 14/09 : l'écran ne doit rien écrire en base au
 * simple affichage.
 *
 * Lancer :  node --test tests/rendu-ecran-bot-journal.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rendreEcran } from './outils/rendu-ecran.mjs';

const ECRAN = 'src/features/messagerie/page.jsx';

const JOURNAL = [
  {
    id: 'bj-1',
    canal: 'messenger',
    message_id_entrant: 'm_AAA111',
    expediteur_id: 'PSID-CLIENT-1',
    intention: 'horaires',
    fiche_id: 'KB-15',
    action: 'repondu',
    motif: null,
    texte: 'Bonjour ! Nous sommes ouverts du lundi au vendredi de 7 h 30 à 17 h 30…',
    id_message_sortant: 'mid.sortant.1',
    mode: 'live',
    erreur: null,
    recu_le: '2026-09-19T08:00:00.000Z',
    repondu_le: '2026-09-19T08:00:01.000Z',
    date_locale: '2026-09-19',
  },
  {
    id: 'bj-2',
    canal: 'instagram',
    message_id_entrant: 'ig_BBB222',
    expediteur_id: 'IGSID-CLIENT-9',
    intention: 'prix',
    fiche_id: 'KB-17',
    action: 'passer_la_main',
    motif: null,
    texte: 'Pour le prix, le délai, la quantité minimale ou un devis, je ne réponds pas moi-même…',
    id_message_sortant: 'mid.sortant.2',
    mode: 'live',
    erreur: null,
    recu_le: '2026-09-19T09:00:00.000Z',
    repondu_le: '2026-09-19T09:00:01.000Z',
    date_locale: '2026-09-19',
  },
  {
    id: 'bj-3',
    canal: 'messenger',
    message_id_entrant: 'm_CCC333',
    expediteur_id: 'PSID-CLIENT-4',
    intention: null,
    fiche_id: null,
    action: 'ignore',
    motif: 'bot_eteint',
    texte: null,
    id_message_sortant: null,
    mode: 'dry_run',
    erreur: null,
    recu_le: '2026-09-19T10:00:00.000Z',
    repondu_le: null,
    date_locale: '2026-09-19',
  },
];

const CONTROLE = [{ id: 'global', actif: false, mode: 'dry_run' }];

test('l écran monte, montre le journal du bot, et n écrit RIEN en base', async () => {
  const r = await rendreEcran({
    ecran: ECRAN,
    donnees: { bot_journal: JOURNAL, bot_controle: CONTROLE, messages_meta: [] },
  });
  try {
    assert.equal(r.erreurs.length, 0, `exceptions au montage : ${r.erreurs.map((e) => e?.message).join(' · ')}`);
    assert.ok(r.texte.length > 200, 'écran blanc');
    assert.equal(r.journal.ecritures.length, 0, 'aucune écriture au simple affichage');
    assert.ok(r.journal.lectures.includes('bot_journal'), 'le journal du bot doit être lu');
  } finally {
    await r.demonter();
  }
});

test('l écran dit si le bot est EN MARCHE ou À L ARRÊT — jamais par déduction', async () => {
  const eteint = await rendreEcran({
    ecran: ECRAN,
    donnees: { bot_journal: JOURNAL, bot_controle: CONTROLE, messages_meta: [] },
  });
  try {
    assert.match(eteint.texte, /à l'arrêt|à l’arrêt|arrêté/i);
  } finally {
    await eteint.demonter();
  }

  const allume = await rendreEcran({
    ecran: ECRAN,
    donnees: {
      bot_journal: JOURNAL,
      bot_controle: [{ id: 'global', actif: true, mode: 'live' }],
      messages_meta: [],
    },
  });
  try {
    assert.match(allume.texte, /en marche/i);
  } finally {
    await allume.demonter();
  }
});

test('ce que le bot a envoyé est lisible, canal par canal', async () => {
  const r = await rendreEcran({
    ecran: ECRAN,
    donnees: { bot_journal: JOURNAL, bot_controle: CONTROLE, messages_meta: [] },
  });
  try {
    assert.ok(r.texte.includes('Nous sommes ouverts du lundi au vendredi'),
      'le texte réellement servi doit être relisible');
    assert.match(r.texte, /Messenger/);
    assert.match(r.texte, /Instagram/);
    assert.match(r.texte, /KB-15/);
  } finally {
    await r.demonter();
  }
});

test('un message SANS réponse affiche son motif, pas un blanc', async () => {
  const r = await rendreEcran({
    ecran: ECRAN,
    donnees: { bot_journal: JOURNAL, bot_controle: CONTROLE, messages_meta: [] },
  });
  try {
    // « rien » et « je n'ai pas répondu parce que le bot était coupé » sont deux
    // phrases différentes — le piège documenté dans src/services/db.js.
    assert.match(r.texte, /bot était (coupé|à l'arrêt)|bot coupé|Bot à l'arrêt/i);
  } finally {
    await r.demonter();
  }
});

test('un journal vide dit qu il est vide — il ne laisse pas croire à une panne', async () => {
  const r = await rendreEcran({
    ecran: ECRAN,
    donnees: { bot_journal: [], bot_controle: CONTROLE, messages_meta: [] },
  });
  try {
    assert.equal(r.erreurs.length, 0);
    assert.match(r.texte, /aucun message|rien reçu|Aucune réponse/i);
  } finally {
    await r.demonter();
  }
});
