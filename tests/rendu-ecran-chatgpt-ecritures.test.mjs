/**
 * L'ÉCRAN « CE QUE CHATGPT A ÉCRIT », MONTÉ POUR DE VRAI.
 *
 * ── Pourquoi ce fichier existe ────────────────────────────────────────────
 *
 * Le 14/09/2026, 112 tests unitaires étaient verts et l'application est devenue
 * ENTIÈREMENT BLANCHE en production : une erreur au chargement d'un module,
 * qu'aucun test unitaire ne pouvait voir faute de monter l'interface. Un écran
 * neuf ne part pas sans passer par le harnais de rendu.
 *
 * ── Et ici, l'enjeu dépasse « l'écran vit » ───────────────────────────────
 *
 * C'est le SEUL endroit où le gérant verra ce que ChatGPT a écrit dans sa
 * caisse. Le dirigeant a demandé que l'écriture parte SANS confirmation — cet
 * écran est la contrepartie exacte de ce choix : « qu'on puisse quand même
 * modifier si c'est mal fait ». Quatre choses doivent donc s'y trouver, et ce
 * fichier les exige :
 *
 *   1. CE QUI A ÉTÉ ÉCRIT, avec son montant et sa date ;
 *   2. LA PHRASE D'ORIGINE, mot pour mot — sans elle, une ligne fausse est
 *      indéchiffrable des semaines plus tard ;
 *   3. L'HEURE DE MOANDA, écrite avec son fuseau ;
 *   4. UN BOUTON POUR DÉFAIRE, et le mot « contre-passée » à côté de ce qui
 *      l'a déjà été — annuler n'efface pas.
 *
 * ⛔ ET RIEN NE DOIT ÊTRE ÉCRIT AU SIMPLE AFFICHAGE. C'était le bug de
 *    référence C1/C2 du dépôt : ouvrir un écran modifiait la base.
 *
 * Lancer :  node --test tests/rendu-ecran-chatgpt-ecritures.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rendreEcran } from './outils/rendu-ecran.mjs';

const ECRAN = 'src/features/chatgpt-ecritures/page.jsx';

/** Le marqueur posé par `src/services/chatgpt-gestes.js`. */
const MARQUEUR = { via_chatgpt: true };

const ECRIT_LE = {
  instant_utc: '2026-09-18T17:12:05Z',
  date_locale: '2026-09-18',
  heure_locale: '18:12:05',
  mois_local: '2026-09',
  fuseau: 'Africa/Libreville',
  offset_utc: '+01:00',
  lisible: '2026-09-18 18:12:05 (+01:00 Africa/Libreville)',
};

/**
 * Jeu d'essai : une dépense ChatGPT encore active, une tâche déjà annulée, et
 * — le piège — une ligne d'argent SAISIE À LA MAIN, qui ne porte pas le
 * marqueur. Elle ne doit JAMAIS apparaître ici : proposer d'annuler une saisie
 * du gérant depuis l'écran des écritures ChatGPT serait pire que ne rien
 * montrer.
 */
const BASE = {
  mouvements_financiers: [
    {
      id: 'm-chatgpt',
      type: 'sortie',
      montant: 100000,
      description: 'Travaux atelier',
      compte_id: 'cpt-caisse',
      date: '2026-09-18',
      reference: 'chatgpt:depense-001',
      categorie: 'depense_chatgpt',
      source: 'chatgpt',
      chatgpt_cle: 'depense-001',
      chatgpt: {
        geste: 'depense',
        cle: 'depense-001',
        phrase: "Aujourd'hui j'ai payé 100 000 francs de travaux",
        ecrit_le: ECRIT_LE,
      },
      ...MARQUEUR,
    },
    {
      id: 'm-a-la-main',
      type: 'sortie',
      montant: 42000,
      description: 'Achat encre saisi au comptoir',
      compte_id: 'cpt-caisse',
      date: '2026-09-17',
      reference: '',
      // Pas de marqueur : cette ligne n'est PAS de ChatGPT.
    },
  ],
  taches: [
    {
      id: 't-chatgpt',
      titre: '[ANNULÉ] Commander du papier A4',
      statut: 'en_attente',
      priorite: 'haute',
      categorie: 'Administratif',
      progression: 0,
      chatgpt_cle: 'tache-001',
      annule_le: '2026-09-18T18:00:00Z',
      annule_le_lisible: '2026-09-18 19:00:00 (+01:00 Africa/Libreville)',
      chatgpt: {
        geste: 'tache',
        cle: 'tache-001',
        phrase: 'rappelle-moi de commander du papier',
        ecrit_le: ECRIT_LE,
      },
      ...MARQUEUR,
    },
  ],
  etapes_travaux: [],
  depots_hebdo: [],
  comptes_bancaires: [
    { id: 'cpt-caisse', nom: 'LIQUIDE ARGENT Hebdo', solde: 608000 },
  ],
};

test('l’écran monte, affiche du contenu, et n’écrit RIEN en base', async () => {
  const r = await rendreEcran({ ecran: ECRAN, donnees: BASE });
  try {
    assert.ok(r.texte.length > 200, 'écran blanc');
    assert.equal(
      r.erreurs.length, 0,
      `exceptions au montage : ${r.erreurs.map((e) => e?.message).join(' · ')}`,
    );
    assert.equal(
      r.journal.ecritures.length, 0,
      'aucune écriture ne doit partir au simple affichage (bug de référence C1/C2)',
    );
  } finally {
    await r.demonter();
  }
});

test('l’écran dit que ChatGPT écrit SANS confirmation — le choix du dirigeant, écrit', async () => {
  const r = await rendreEcran({ ecran: ECRAN, donnees: BASE });
  try {
    assert.match(r.texte, /sans demander confirmation/i);
  } finally {
    await r.demonter();
  }
});

test('chaque écriture montre son montant, sa date, sa PHRASE et l’heure de Moanda', async () => {
  const r = await rendreEcran({ ecran: ECRAN, donnees: BASE });
  try {
    assert.match(r.texte, /Travaux atelier/);
    assert.match(r.texte, /100 000 F/, 'le montant doit être lisible');
    assert.match(r.texte, /2026-09-18/);
    assert.match(
      r.texte, /Aujourd'hui j'ai payé 100 000 francs de travaux|Aujourd’hui j’ai payé/,
      'sans la phrase d’origine, une ligne fausse est indéchiffrable plus tard',
    );
    assert.match(
      r.texte, /\(\+01:00 Africa\/Libreville\)/,
      'l’heure doit porter son fuseau : le serveur, lui, est en UTC',
    );
    assert.match(r.texte, /chatgpt:depense-001/, 'l’identifiant permet de retrouver et d’annuler');
  } finally {
    await r.demonter();
  }
});

test('⛔ une écriture SAISIE À LA MAIN n’apparaît jamais ici', async () => {
  const r = await rendreEcran({ ecran: ECRAN, donnees: BASE });
  try {
    assert.ok(
      !r.texte.includes('Achat encre saisi au comptoir'),
      'proposer d’annuler une saisie du gérant depuis cet écran serait pire que ne rien montrer',
    );
    assert.ok(!r.texte.includes('42 000'), 'le montant d’une saisie manuelle n’a rien à faire ici');
  } finally {
    await r.demonter();
  }
});

test('ce qui est déjà annulé le DIT, et dit que la trace reste', async () => {
  const r = await rendreEcran({ ecran: ECRAN, donnees: BASE });
  try {
    assert.match(r.texte, /Annulée/);
    assert.match(r.texte, /Contre-passée/);
    assert.match(r.texte, /la trace reste/i);
  } finally {
    await r.demonter();
  }
});

test('un bouton permet de défaire ce qui n’est pas encore annulé', async () => {
  const r = await rendreEcran({ ecran: ECRAN, donnees: BASE });
  try {
    const boutons = [...r.conteneur.querySelectorAll('button')].map((b) => b.textContent.trim());
    assert.ok(
      boutons.some((t) => /Annuler/i.test(t)),
      `aucun bouton d’annulation : ${boutons.join(' | ')}`,
    );
    // Exactement UN : la tâche déjà annulée ne doit pas en proposer un second.
    assert.equal(
      boutons.filter((t) => /^Annuler$/i.test(t)).length, 1,
      'une seule écriture est encore annulable dans ce jeu d’essai',
    );
  } finally {
    await r.demonter();
  }
});

test('l’annulation demande confirmation à l’écran, puis contre-passe pour de vrai', async () => {
  const r = await rendreEcran({ ecran: ECRAN, donnees: BASE });
  try {
    const trouver = (motif) => [...r.conteneur.querySelectorAll('button')]
      .find((b) => motif.test(b.textContent.trim()));

    // 1er clic : rien n'est écrit, l'écran demande confirmation.
    await r.act(async () => { trouver(/^Annuler$/i).click(); });
    assert.equal(
      r.journal.ecritures.length, 0,
      'le premier clic ne doit RIEN écrire : il ouvre la confirmation',
    );
    assert.match(r.conteneur.textContent, /Contre-passer cette écriture/);

    // 2e clic : la contre-passation part.
    await r.act(async () => { trouver(/^Confirmer$/i).click(); });
    for (let i = 0; i < 4; i += 1) {
      await r.act(async () => { await new Promise((res) => setTimeout(res, 0)); });
    }

    const ecritures = r.journal.ecritures;
    const creations = ecritures.filter((e) => e.operation === 'create');
    const majs = ecritures.filter((e) => e.operation === 'update');

    assert.ok(
      creations.some((e) => e.collection === 'mouvements_financiers'),
      `aucun mouvement inverse créé : ${JSON.stringify(ecritures)}`,
    );
    // `src/services/audit` est remplacé par une doublure INERTE dans ce
    // harnais : la trace ne passe donc pas par `db.audit_logs`. Ce qu'on
    // vérifie, c'est que l'écran l'a bien APPELÉE — l'antériorité de l'appel
    // est vérifiée sur la source, plus bas.
    const inertes = globalThis.__appelsInertes || [];
    assert.ok(
      inertes.some(([fichier, nom]) => fichier.includes('audit') && nom === 'logAction'),
      `la trace d’audit doit partir, elle aussi : ${JSON.stringify(inertes.map((x) => x.slice(0, 2)))}`,
    );
    assert.ok(
      majs.some((e) => e.collection === 'comptes_bancaires'),
      'le solde du compte doit revenir à sa valeur d’avant',
    );
    assert.ok(
      !ecritures.some((e) => e.operation === 'delete'),
      'annuler COMPENSE : aucune suppression, jamais',
    );
  } finally {
    await r.demonter();
  }
});

test('la trace d’audit est écrite AVANT l’effet, pas après', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL(`../${ECRAN}`, import.meta.url), 'utf8');
  const rangTrace = source.indexOf('await logAction(');
  const rangEffet = source.indexOf('await appliquer(');
  assert.ok(rangTrace > -1, 'aucune trace d’audit dans l’écran');
  assert.ok(rangEffet > -1, 'aucune application du plan dans l’écran');
  assert.ok(
    rangTrace < rangEffet,
    'si l’application du plan casse au milieu, on doit savoir ce qui a été tenté — '
    + 'la trace passe donc d’abord, comme dans l’import administrateur',
  );
});

test('⛔ une lecture en échec DIT la panne au lieu d’afficher « rien écrit »', async () => {
  const r = await rendreEcran({
    ecran: ECRAN,
    donnees: BASE,
    echecsLecture: ['mouvements_financiers'],
  });
  try {
    assert.match(r.texte, /n'a PAS pu être lue|n’a PAS pu être lue/);
    assert.ok(
      !/n'a encore rien écrit|n’a encore rien écrit/.test(r.texte),
      'une liste vide après une lecture ratée ferait conclure qu’il n’y a rien à vérifier',
    );
  } finally {
    await r.demonter();
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   L'ÉCRAN NE DOIT PAS TÉLÉCHARGER 20 Mo POUR AFFICHER UNE LISTE
   ═══════════════════════════════════════════════════════════════════════════ */

test('⛔ l’écran lit en PROJECTION, jamais la collection entière', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL(`../${ECRAN}`, import.meta.url), 'utf8');

  assert.match(
    source, /lireLignesMarquees\(/,
    'la liste doit passer par la lecture projetée',
  );
  assert.ok(
    !/COLLECTIONS_ECRITURES\.map\([^)]*list(OuLeve)?\(\)/.test(source),
    'lire les dix-sept collections entières ferait télécharger les 20 Mo de produits_catalogue '
    + '(dont 3,2 Mo d’images base64 sur UNE ligne) pour afficher un libellé et un montant',
  );
});

test('une correction de prix du catalogue apparaît dans la liste, sans ses images', async () => {
  const r = await rendreEcran({
    ecran: ECRAN,
    donnees: {
      ...BASE,
      produits_catalogue: [{
        id: 'cat-1',
        nom: 'T-shirt personnalisé',
        prix: [{ qte_min: 1, qte_max: null, prix: 5000 }],
        // 3,2 Mo en vrai. Si l'écran les lisait, ce test le dirait.
        images: ['data:image/png;base64,TROP-LOURD-POUR-MOANDA'],
        chatgpt_cle: 'cat-prix-1',
        chatgpt: {
          geste: 'catalogue',
          cle: 'cat-prix-1',
          phrase: 'le t-shirt est à 5000, pas à 0',
          ecrit_le: ECRIT_LE,
        },
        ...MARQUEUR,
      }],
    },
  });
  try {
    assert.match(r.texte, /T-shirt personnalisé/);
    assert.match(r.texte, /le t-shirt est à 5000/);
    assert.ok(
      !r.html.includes('TROP-LOURD-POUR-MOANDA'),
      'les images ne doivent même pas arriver jusqu’à l’écran',
    );
  } finally {
    await r.demonter();
  }
});
