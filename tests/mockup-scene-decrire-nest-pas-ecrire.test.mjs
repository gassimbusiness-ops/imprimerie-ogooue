/**
 * DECRIRE UN LIEU N'EST PAS DEMANDER D'ECRIRE.
 *
 * ── Ce qui a ete vu a l'ecran, le 18/09/2026 ──────────────────────────────
 *
 * Ecran « Mockups IA ». Le gerant tape, dans le champ de description de scene :
 *
 *     « À l'intérieur de l'imprimerie Ogooué, sur un mannequin noir »
 *
 * L'application REFUSE, au motif que la description contient
 * « IMPRIMERIE OGOOUÉ » — qui est aussi un de ses blocs de texte a marquer.
 *
 * C'est un faux positif, et il est couteux : le 17/09, les blocages de cet
 * ecran ont ete retires un par un (`verifierFaisabilite`, `reserves`,
 * `apercuPossible`) precisement parce que le gerant se plaignait qu'ils
 * l'empechaient de travailler. Celui-ci bloquait encore, sur une phrase
 * parfaitement normale : le nom de sa propre boutique, ou la scene se passe.
 *
 * ── Ce qui reste vrai, et ne doit pas partir avec le blocage ──────────────
 *
 * La regle du 16/09 est BONNE : le modele ne doit pas dessiner les textes,
 * c'est l'application qui les compose (`fillText` ne peut rien omettre ; le
 * modele, si — un bloc entier a disparu en silence sur la banderole).
 *
 * Ce qui change n'est donc pas la regle, c'est son declencheur :
 *   - elle ne se declenche QUE si la description demande vraiment d'ecrire
 *     (« ecris… », « avec le texte… », « inscription… ») ;
 *   - et elle AVERTIT, elle ne refuse plus.
 *
 * Lancer :  node --test tests/mockup-scene-decrire-nest-pas-ecrire.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validerPromptLibre,
  validerDemandeMockup,
  demandeEcritureDeTexte,
  analyserPixelsLogo,
  CONSIGNE_AUCUN_TEXTE,
} from '../src/features/mockup-ia/moteur-mockup.js';

const NOM = 'IMPRIMERIE OGOOUÉ';
const NUMERO = '060 44 46 34';

/** La phrase exacte tapee par le gerant, accents et apostrophe compris. */
const SCENE_DU_GERANT = 'À l\'intérieur de l\'imprimerie Ogooué, sur un mannequin noir';

const logoPng = { name: 'ogooue.png', type: 'image/png', size: 120_000 };

function pixelsAplats(nbCouleurs = 3, nbPixels = 400) {
  const d = [];
  for (let i = 0; i < nbPixels; i += 1) {
    const k = i % nbCouleurs;
    d.push(k * 80, 20, 200 - k * 60, 255);
  }
  return d;
}

function blocs(...contenus) {
  return contenus.map((contenu, i) => ({
    id: `t${i + 1}`, role: 'libre', contenu, zoneId: null, couleurId: 'noir', hauteurCm: 3,
  }));
}

function demandeValide(extra = {}) {
  return {
    supportId: 'tshirt_adulte',
    colorisId: 'blanc',
    angleId: 'face',
    techniqueId: 'flex',
    zoneId: 'poitrine_centre',
    fichierLogo: logoPng,
    analyseLogo: analyserPixelsLogo(pixelsAplats(3)),
    largeurImpressionCm: 20,
    largeurLogoPx: 900,
    ...extra,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. LE DEFAUT, TEL QUE LE GERANT L'A VECU
   ═══════════════════════════════════════════════════════════════════════════ */

test('scene : la phrase du gerant PASSE, et sans avertissement', () => {
  const r = validerPromptLibre(SCENE_DU_GERANT, blocs(NOM, NUMERO));
  assert.equal(r.ok, true, `refusee a tort : ${r.message}`);
  assert.deepEqual(
    r.avertissements, [],
    'décrire le lieu où la scène se passe n’est pas demander d’écrire',
  );
});

test('scene : la phrase du gerant autorise le clic de bout en bout', () => {
  // Le controle du champ n'est pas le seul sur ce chemin : le prompt complet
  // repasse ensuite par la barriere « aucun texte client dans le prompt ». Le
  // nom de la boutique s'y retrouve forcement, puisqu'il est dans la scene.
  const r = validerDemandeMockup(demandeValide({
    mode: 'ia',
    textes: blocs(NOM, NUMERO),
    promptLibre: SCENE_DU_GERANT,
  }));
  assert.equal(r.ok, true, `l’aperçu reste refusé : ${r.raison} — ${r.message}`);
  assert.ok(r.prompt.includes('mannequin noir'), 'la scène doit bien partir au modèle');
  assert.ok(r.prompt.endsWith(CONSIGNE_AUCUN_TEXTE), 'la consigne doit fermer le prompt');
});

test('scene : d\'autres descriptions de lieu tout aussi normales passent', () => {
  for (const valeur of [
    'devant la vitrine de l\'Imprimerie Ogooué a Moanda',
    'dans l\'atelier, la presse en arriere-plan flou',
    'sur un mannequin noir, lumiere de fin de journee',
    'au marche de Moanda, ambiance de fin de journee',
  ]) {
    const r = validerPromptLibre(valeur, blocs(NOM, NUMERO));
    assert.equal(r.ok, true, `refusee a tort : « ${valeur} »`);
    assert.deepEqual(r.avertissements, [], `avertissement injustifie sur « ${valeur} »`);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. LA REGLE RESTE — MAIS ELLE AVERTIT, ELLE NE REFUSE PLUS
   ═══════════════════════════════════════════════════════════════════════════ */

test('scene : une vraie demande d\'ecriture AVERTIT, sans bloquer', () => {
  const r = validerPromptLibre(`avec le texte ${NOM} en gros sous le logo`, blocs(NOM));
  assert.equal(r.ok, true, 'un avertissement n’est pas un refus');
  assert.equal(r.avertissements.length >= 1, true, 'la demande d’écriture doit être signalée');
  const m = r.avertissements.map((a) => a.message).join(' ');
  assert.ok(m.includes(NOM), 'l’avertissement doit citer le texte en cause');
  assert.match(m, /application/i, 'il doit rappeler qui dessine les textes');
  assert.ok(m.length > 60, 'un avertissement au comptoir doit être exploitable');
});

test('scene : les trois tournures citees par le gerant declenchent l\'avertissement', () => {
  for (const valeur of [
    `ecris ${NOM} sur la poitrine`,
    `avec le texte ${NOM} sous le logo`,
    `inscription ${NOM} au dos`,
  ]) {
    const r = validerPromptLibre(valeur, blocs(NOM));
    assert.equal(r.ok, true, `« ${valeur} » ne doit plus bloquer`);
    assert.ok(r.avertissements.length >= 1, `« ${valeur} » aurait du avertir`);
  }
});

test('scene : un numero tape directement avertit, sans bloquer', () => {
  const r = validerDemandeMockup(demandeValide({
    mode: 'ia',
    textes: [],
    promptLibre: 'ecris 077 12 34 56 en gros sur le t-shirt',
  }));
  assert.equal(r.ok, true, 'le clic ne doit plus être refusé');
  const m = (r.avertissementsScene || []).map((a) => a.message).join(' ');
  assert.match(m, /chiffres/i, 'le numéro doit être signalé');
  assert.match(m, /bloc de texte/i, 'l’avertissement doit dire où le saisir à la place');
});

test('scene : ce qui BLOQUE encore, c\'est la longueur — une contrainte mecanique', () => {
  // Au-dela de la borne, la description repousse la description du support
  // hors du prompt : ce n'est pas un jugement, c'est de la place qui manque.
  const r = validerPromptLibre('x'.repeat(5000), blocs(NOM));
  assert.equal(r.ok, false);
  assert.equal(r.raison, 'prompt-libre-trop-long');
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. LE DECLENCHEUR, ISOLE
   ═══════════════════════════════════════════════════════════════════════════ */

test('demandeEcritureDeTexte : ce qui demande d\'ecrire', () => {
  for (const v of [
    'ecris le nom en gros',
    'écris IMPRIMERIE OGOOUÉ sur la poitrine',
    'avec le texte « bienvenue »',
    'avec la mention Ouvert 7j/7',
    'inscription au dos',
    'écrire le slogan sous le logo',
    'marquer le texte en blanc',
  ]) {
    assert.equal(demandeEcritureDeTexte(v).trouve, true, `non detecte : « ${v} »`);
  }
});

test('demandeEcritureDeTexte : ce qui ne fait que decrire', () => {
  for (const v of [
    SCENE_DU_GERANT,
    'sur un mannequin noir dans l\'atelier',
    'une affiche au mur en arriere-plan flou',
    'devant l\'imprimerie Ogooué, en fin de journee',
    'vue de 3/4, profondeur de champ courte',
    'largeur 180 cm, tendue entre deux poteaux',
  ]) {
    assert.equal(demandeEcritureDeTexte(v).trouve, false, `faux positif : « ${v} »`);
  }
});

test('demandeEcritureDeTexte : aucune entree ne leve d\'exception', () => {
  for (const e of [null, undefined, 42, [], {}, true, Symbol.iterator]) {
    assert.doesNotThrow(() => demandeEcritureDeTexte(e), `entree ${String(e)}`);
    assert.equal(demandeEcritureDeTexte(e).trouve, false);
  }
});
