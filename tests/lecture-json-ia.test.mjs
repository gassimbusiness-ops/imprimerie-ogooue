/**
 * LIRE LA REPONSE D'UN MODELE QUAND ELLE EST CENSEE ETRE DU JSON.
 *
 * ── Ce qui a ete vu a l'ecran, le 18/09/2026 ──────────────────────────────
 *
 * Ecran « Rapports & Analyses → Analyse IA » : la reponse du modele s'affiche
 * telle quelle — accolades, guillemets, cles, et jusqu'aux ``` d'ouverture —
 * et le score affiche vaut 0 alors que le texte contient
 * `"score_performance": 45`.
 *
 * Le modele repondait. C'est l'application qui ne savait pas le lire, et qui,
 * ne sachant pas lire, INVENTAIT un zero. Un zero se lit comme une mesure :
 * le gerant croit que son mois vaut 0/100. « Je n'ai pas pu lire la reponse »
 * se lit comme une panne, et c'est la verite.
 *
 * ── Ce que ce fichier verifie ─────────────────────────────────────────────
 *
 *   1. les formes REELLES que rend un modele passent : bloc de code ```json,
 *      bloc nu, JSON entoure de phrases, JSON seul ;
 *   2. ce qui n'est pas exploitable — vide, tronque, prose sans objet — est
 *      rendu comme un ECHEC NOMME, jamais comme un objet a zero ;
 *   3. aucune entree, meme absurde, ne leve d'exception ;
 *   4. la lecture ne vit qu'a UN endroit : les trois ecrans qui lisent du JSON
 *      de modele appellent la meme fonction.
 *
 * Lancer :  node --test tests/lecture-json-ia.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { lireJsonIA } from '../src/services/lecture-json-ia.js';

const RACINE = resolve(fileURLToPath(new URL('..', import.meta.url)));
const lire = (p) => readFileSync(resolve(RACINE, p), 'utf8');

/** La reponse attendue de l'ecran Rapports & Analyses, en abrege. */
const ANALYSE = {
  score_performance: 45,
  resume_performance: 'Le chiffre d\'affaires recule de 12 % sur la periode.',
  top_services: ['textile : marge la plus forte'],
  opportunites: ['relancer les clients administratifs'],
  alertes: ['baisse du panier moyen'],
  recommandations: [{ action: 'Relancer', detail: 'Appeler les 10 premiers clients.', impact: 'eleve' }],
};

/* ═══════════════════════════════════════════════════════════════════════════
   1. LES FORMES REELLES QUE REND UN MODELE
   ═══════════════════════════════════════════════════════════════════════════ */

test('JSON IA : un bloc de code ```json est lu', () => {
  const brut = `\`\`\`json\n${JSON.stringify(ANALYSE, null, 2)}\n\`\`\``;
  const r = lireJsonIA(brut);
  assert.equal(r.ok, true, r.message);
  assert.equal(r.donnees.score_performance, 45);
  assert.equal(r.donnees.recommandations.length, 1);
});

test('JSON IA : un bloc de code NU (``` sans langage) est lu', () => {
  const brut = `\`\`\`\n${JSON.stringify(ANALYSE)}\n\`\`\``;
  const r = lireJsonIA(brut);
  assert.equal(r.ok, true, r.message);
  assert.equal(r.donnees.score_performance, 45);
});

test('JSON IA : un objet entoure de phrases est lu', () => {
  const brut = 'Voici mon analyse de la periode demandee :\n\n'
    + `${JSON.stringify(ANALYSE)}\n\n`
    + 'N\'hesitez pas si vous voulez un detail par service.';
  const r = lireJsonIA(brut);
  assert.equal(r.ok, true, r.message);
  assert.equal(r.donnees.score_performance, 45);
});

test('JSON IA : un objet nu, sans rien autour, est lu', () => {
  const r = lireJsonIA(JSON.stringify(ANALYSE));
  assert.equal(r.ok, true, r.message);
  assert.deepEqual(r.donnees, ANALYSE);
});

test('JSON IA : une accolade DANS une chaine ne coupe pas la lecture', () => {
  // Le cas qui met en defaut un comptage d'accolades naif.
  const brut = '{"resume_performance": "un texte avec } une accolade", "score_performance": 45}';
  const r = lireJsonIA(brut);
  assert.equal(r.ok, true, r.message);
  assert.equal(r.donnees.score_performance, 45);
  assert.match(r.donnees.resume_performance, /accolade/);
});

test('JSON IA : de la prose APRES l\'objet ne casse rien, meme avec des accolades', () => {
  // Le defaut de l'ancienne lecture : /\{[\s\S]*\}/ va de la PREMIERE accolade
  // a la DERNIERE, et avale la prose qui suit.
  const brut = `${JSON.stringify(ANALYSE)}\n\nRemarque : le score {45} est calcule sur 3 mois.`;
  const r = lireJsonIA(brut);
  assert.equal(r.ok, true, r.message);
  assert.equal(r.donnees.score_performance, 45);
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. CE QUI N'EST PAS EXPLOITABLE EST UN ECHEC NOMME, JAMAIS UN ZERO
   ═══════════════════════════════════════════════════════════════════════════ */

test('JSON IA : une reponse TRONQUEE est un echec, pas un score a zero', () => {
  // C'est le cas observe : 800 jetons ne suffisaient pas, l'objet est coupe
  // en plein milieu. Le `score_performance: 45` est LA, et pourtant rien de
  // tout ca n'est fiable — on ne sait pas ce qui manque.
  const complet = JSON.stringify(ANALYSE, null, 2);
  const brut = `\`\`\`json\n${complet.slice(0, Math.floor(complet.length * 0.6))}`;
  const r = lireJsonIA(brut);
  assert.equal(r.ok, false, 'une reponse coupee ne doit pas etre declaree lue');
  assert.equal(r.donnees, null, 'aucune donnee inventee');
  assert.ok(r.message.length > 30, 'le gerant doit lire une phrase, pas un code');
  assert.doesNotMatch(r.message, /^0$/);
});

test('JSON IA : une reponse VIDE est un echec nomme', () => {
  for (const brut of ['', '   ', '\n\n', '```json\n```']) {
    const r = lireJsonIA(brut);
    assert.equal(r.ok, false, `vide non detecte : ${JSON.stringify(brut)}`);
    assert.equal(r.donnees, null);
    assert.ok(r.message, 'un echec doit toujours porter un message');
  }
});

test('JSON IA : de la prose SANS objet est un echec nomme', () => {
  const r = lireJsonIA('Je ne peux pas analyser ces donnees, elles sont insuffisantes.');
  assert.equal(r.ok, false);
  assert.equal(r.donnees, null);
  assert.ok(r.message);
});

test('JSON IA : le texte brut reste disponible pour etre montre au gerant', () => {
  const brut = 'Je ne peux pas analyser ces donnees.';
  const r = lireJsonIA(brut);
  assert.equal(r.ok, false);
  assert.equal(r.brut, brut, 'la reponse du modele doit rester consultable');
});

test('JSON IA : un tableau seul n\'est pas un resultat d\'analyse', () => {
  // Les ecrans lisent un OBJET (score, listes). Un tableau nu ne sait pas
  // remplir l'ecran : mieux vaut le dire que d'afficher une carte vide.
  const r = lireJsonIA('[1, 2, 3]');
  assert.equal(r.ok, false);
  assert.equal(r.donnees, null);
});

test('JSON IA : aucune entree, meme absurde, ne leve d\'exception', () => {
  for (const e of [null, undefined, 42, [], {}, true, Symbol.iterator, NaN]) {
    assert.doesNotThrow(() => lireJsonIA(e), `entree ${String(e)}`);
    assert.equal(lireJsonIA(e).ok, false, `entree ${String(e)} declaree lue a tort`);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. LA LECTURE NE VIT QU'A UN SEUL ENDROIT
   ═══════════════════════════════════════════════════════════════════════════ */

test('contrat de source : l\'ecran Analyse IA n\'invente plus de score a zero', () => {
  const src = lire('src/features/rapports-analyses/page.jsx');
  assert.doesNotMatch(
    src, /score_performance:\s*0\b/,
    'l\'ecran fabriquait un score 0 quand il ne savait pas lire la reponse',
  );
  assert.doesNotMatch(
    src, /JSON\.parse\(/,
    'l\'ecran ne doit plus lire le JSON lui-meme',
  );
  assert.match(src, /lireJsonIA/, 'il doit appeler la lecture partagee');
});

test('contrat de source : les trois ecrans IA lisent par la MEME fonction', () => {
  for (const f of [
    'src/features/rapports-analyses/page.jsx',
    'src/features/statistiques/page.jsx',
    'src/features/performance-rh/page.jsx',
  ]) {
    const src = lire(f);
    assert.match(src, /lireJsonIA/, `${f} n'utilise pas la lecture partagee`);
    assert.doesNotMatch(src, /JSON\.parse\(/, `${f} garde sa propre lecture du JSON`);
  }
});
