/**
 * UNE VALEUR MANQUANTE NE DOIT JAMAIS ATTERRIR DANS UN LIBELLE AFFICHE.
 *
 * ── Ce qui a ete vu a l'ecran, le 18/09/2026 ──────────────────────────────
 *
 * Ecran « Taches » : deux cartes affichent « Commande undefined — … ».
 *
 * Cause : `src/features/commandes/page.jsx`, l'assignation d'une commande a un
 * operateur cree la tache avec `titre: `Commande ${cmd.numero} — ${cmd.client_nom}``
 * — sans repli, alors que les 10 autres interpolations de `cmd.numero` du meme
 * fichier en ont une. Le titre est ECRIT EN BASE avec le mot `undefined`
 * dedans : reparer la source ne repare pas les taches deja creees.
 *
 * Il faut donc les deux :
 *   1. la source ne peut plus produire `undefined` ;
 *   2. l'affichage ne peut plus montrer `undefined`, meme si la base en
 *      contient — ce qui est le cas aujourd'hui, deux fois.
 *
 * Lancer :  node --test tests/libelles-valeurs-manquantes.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  estRenseigne, texteAffichable, contientValeurManquante, nettoyerLibelle,
  libelleCommande, libelleTache, nomPersonne, VALEURS_MANQUANTES_AFFICHEES,
} from '../src/services/libelles.js';
import { rendreEcran } from './outils/rendu-ecran.mjs';

const RACINE = resolve(fileURLToPath(new URL('..', import.meta.url)));
const lire = (p) => readFileSync(resolve(RACINE, p), 'utf8');

/* ═══════════════════════════════════════════════════════════════════════════
   1. LA BRIQUE : ce qui compte comme « manquant »
   ═══════════════════════════════════════════════════════════════════════════ */

test('libelles : les quatre formes de valeur manquante sont reconnues', () => {
  // Ce sont les quatre chaines qu'une interpolation JavaScript peut produire
  // sans erreur, et qu'un gerant lit comme une panne.
  for (const jeton of ['undefined', 'null', 'NaN', '[object Object]']) {
    assert.ok(
      contientValeurManquante(`Commande ${jeton} — Mairie de Moanda`),
      `« ${jeton} » non detecte dans un libelle`,
    );
  }
  assert.ok(VALEURS_MANQUANTES_AFFICHEES.length >= 4);
});

test('libelles : un vrai libelle n\'est pas pris pour une panne', () => {
  for (const bon of [
    'Commande CMD-2026-014 — Mairie de Moanda',
    'Impression de 200 flyers A5',
    'Nullement urgent', // contient « null » mais pas comme mot
    'Banderole 3 m — NaNa Couture', // contient « NaN » mais pas comme mot
  ]) {
    assert.equal(contientValeurManquante(bon), false, `faux positif : « ${bon} »`);
  }
});

test('libelles : estRenseigne et texteAffichable', () => {
  assert.equal(estRenseigne(undefined), false);
  assert.equal(estRenseigne(null), false);
  assert.equal(estRenseigne(''), false);
  assert.equal(estRenseigne('   '), false);
  assert.equal(estRenseigne(NaN), false);
  assert.equal(estRenseigne('undefined'), false, 'la CHAINE « undefined » vient d\'une base abimee');
  assert.equal(estRenseigne(0), true, 'zero est une valeur, pas une absence');
  assert.equal(estRenseigne('CMD-1'), true);

  assert.equal(texteAffichable(undefined, 'sans numéro'), 'sans numéro');
  assert.equal(texteAffichable('  CMD-1 ', 'sans numéro'), 'CMD-1');
  assert.equal(texteAffichable(0, 'sans numéro'), '0');
});

test('libelles : aucune entree, meme absurde, ne leve d\'exception', () => {
  for (const e of [null, undefined, 42, [], {}, true, NaN, Symbol.iterator]) {
    assert.doesNotThrow(() => contientValeurManquante(e), `entree ${String(e)}`);
    assert.doesNotThrow(() => nettoyerLibelle(e), `entree ${String(e)}`);
    assert.doesNotThrow(() => libelleCommande(e), `entree ${String(e)}`);
    assert.doesNotThrow(() => libelleTache(e), `entree ${String(e)}`);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. LA SOURCE : le libelle construit ne peut plus contenir « undefined »
   ═══════════════════════════════════════════════════════════════════════════ */

test('libelleCommande : le cas normal reste inchange', () => {
  assert.equal(
    libelleCommande({ numero: 'CMD-2026-014', client: 'Mairie de Moanda' }),
    'Commande CMD-2026-014 — Mairie de Moanda',
  );
});

test('libelleCommande : un numero manquant donne un repli qui a du sens', () => {
  const l = libelleCommande({ numero: undefined, client: 'Mairie de Moanda' });
  assert.doesNotMatch(l, /undefined/);
  assert.match(l, /Mairie de Moanda/, 'ce qu\'on SAIT doit rester affiche');
  assert.match(l, /num/i, 'le gerant doit comprendre que c\'est le numero qui manque');
});

test('libelleCommande : client manquant, les deux manquants, rien ne fuit', () => {
  for (const cmd of [
    { numero: 'CMD-1', client: undefined },
    { numero: undefined, client: undefined },
    { numero: null, client: null },
    { numero: '', client: '   ' },
    {},
  ]) {
    const l = libelleCommande(cmd);
    assert.equal(contientValeurManquante(l), false, `« ${l} » laisse fuir une valeur manquante`);
    assert.ok(l.startsWith('Commande'), `« ${l} » ne dit plus de quoi il s\'agit`);
    assert.ok(l.length > 8);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. L'AFFICHAGE : meme une base deja abimee ne montre plus « undefined »
   ═══════════════════════════════════════════════════════════════════════════ */

test('nettoyerLibelle : un titre deja ecrit en base est rattrape', () => {
  const abime = 'Commande undefined — Fina Boutique';
  const propre = nettoyerLibelle(abime);
  assert.equal(contientValeurManquante(propre), false);
  assert.match(propre, /Fina Boutique/, 'on garde ce qui est connu');
});

test('libelleTache : le numero de commande de la tache repare le titre', () => {
  // La tache porte `commande_numero` a cote du titre : quand le titre est
  // abime, c'est LUI qui fait foi — on ne devine rien, on relit le champ.
  const t = {
    titre: 'Commande undefined — Fina Boutique',
    commande_numero: 'CMD-2026-031',
  };
  const l = libelleTache(t);
  assert.equal(contientValeurManquante(l), false);
  assert.match(l, /CMD-2026-031/, 'le numero connu de la tache doit etre utilise');
  assert.match(l, /Fina Boutique/);
});

test('libelleTache : un titre sain n\'est pas touche', () => {
  assert.equal(libelleTache({ titre: 'Reliure des 40 carnets' }), 'Reliure des 40 carnets');
});

test('libelleTache : une tache sans titre du tout reste lisible', () => {
  const l = libelleTache({ id: 't1', categorie: 'Impression' });
  assert.equal(contientValeurManquante(l), false);
  assert.ok(l.trim().length > 0, 'une carte sans libelle n\'est pas cliquable');
});

test('nomPersonne : la garde sur l\'OBJET ne suffit pas, il faut celle sur les CHAMPS', () => {
  // `emp ? `${emp.prenom} ${emp.nom}` : ''` : l'objet existe, le prenom non.
  assert.equal(nomPersonne({ prenom: 'Ibrahim', nom: 'Abakar' }), 'Ibrahim Abakar');
  assert.equal(nomPersonne({ nom: 'Abakar' }), 'Abakar', 'plus de « undefined Abakar »');
  assert.equal(nomPersonne({ prenom: 'Ibrahim' }), 'Ibrahim');
  assert.equal(nomPersonne({}), '');
  assert.equal(nomPersonne(undefined), '');
  assert.equal(nomPersonne(undefined, 'Non assignée'), 'Non assignée');
  for (const p of [{ prenom: 'undefined', nom: 'Abakar' }, { prenom: null, nom: 'NaN' }]) {
    assert.equal(contientValeurManquante(nomPersonne(p)), false, 'une base abimee ne doit pas fuir');
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. A L'ECRAN — le defaut tel que le gerant le voit
   ═══════════════════════════════════════════════════════════════════════════ */

const TACHES_ABIMEES = {
  taches: [
    {
      id: 't1', titre: 'Commande undefined — Fina Boutique',
      description: 'Impression de 200 flyers A5',
      statut: 'en_attente', priorite: 'haute', categorie: 'Commande',
      commande_id: 'cmd-9', commande_numero: 'CMD-2026-031',
      created_at: '2026-09-17T08:00:00.000Z', progression: 0,
    },
    {
      id: 't2', titre: 'Commande undefined — undefined',
      description: '', statut: 'en_cours', priorite: 'normale', categorie: 'Commande',
      commande_id: 'cmd-10', assigne_nom: 'undefined Abakar',
      created_at: '2026-09-17T09:00:00.000Z', progression: 20,
    },
  ],
  employes: [{ id: 'e1', prenom: 'Ibrahim', nom: 'Abakar', role: 'employe' }],
};

test('Taches — aucune carte n\'affiche « undefined »', async () => {
  const v = await rendreEcran({ ecran: 'src/features/taches/page.jsx', donnees: TACHES_ABIMEES });
  try {
    assert.ok(v.texte.length > 50, 'écran quasi vide : écran blanc');
    for (const jeton of ['undefined', 'NaN', '[object Object]']) {
      assert.ok(
        !v.texte.includes(jeton),
        `l’écran Tâches affiche « ${jeton} » — c’est ce que le gérant voit`,
      );
    }
    assert.match(v.texte, /Fina Boutique/, 'ce qui est connu doit rester affiché');
    assert.deepEqual(v.journal.ecritures, [], 'afficher les tâches ne doit rien écrire en base');
    assert.deepEqual(v.erreurs.map(String), [], 'une exception est partie pendant le montage');
  } finally { await v.demonter(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. CONTRAT DE SOURCE — la source du defaut est fermee
   ═══════════════════════════════════════════════════════════════════════════ */

test('contrat de source : la creation de tache depuis une commande ne fabrique plus le libelle a la main', () => {
  const src = lire('src/features/commandes/page.jsx');
  assert.doesNotMatch(
    src, /titre:\s*`Commande \$\{cmd\.numero\}/,
    'le titre de tache interpole encore `cmd.numero` sans repli',
  );
  assert.match(src, /libelleCommande/, 'il doit passer par le libelle partage');
});
