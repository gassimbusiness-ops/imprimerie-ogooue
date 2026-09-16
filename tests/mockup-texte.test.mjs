/**
 * LE TEXTE NE PASSE PLUS JAMAIS PAR LE MODELE — decision du 16/09/2026.
 *
 * ── Ce qui a ete mesure, et pourquoi la decision a change ─────────────────
 *
 * 6 generations reelles ont ete faites avec le vrai logo du client. Le modele
 * est BON sur ce qu'on lui demande : orthographe juste 6/6, accent du « É »
 * 6/6, numero « 060 44 46 34 » exact 3/3.
 *
 * Mais sur la banderole (image 06), un bloc de texte demande en plus du numero
 * — « IMPRIMERIE OGOOUÉ » — n'a PAS ete rendu. Le modele a juge que le mot deja
 * present dans le logo suffisait. Aucune erreur, aucun avertissement, aucune
 * trace : le bloc a simplement disparu.
 *
 * Le mode d'echec n'est donc pas « un chiffre faux » — c'est « un bloc
 * absent ». Un chiffre faux se voit a la relecture ; un bloc absent, non.
 * Le jour ou c'est le numero d'un client qui disparait, personne ne le voit
 * avant la livraison.
 *
 * La regle qui en sort, et que ce fichier verifie :
 *
 *     L'IA fait la scene et le logo. Le texte est compose par l'application.
 *
 * Quatre familles de tests :
 *   1. aucun prompt ne porte de texte utilisateur, dans aucun des deux modes,
 *      et la zone de prompt editable ne permet pas d'en faire passer un ;
 *   2. un bloc de texte vide est REFUSE avec un message — jamais ignore ;
 *   3. le compositeur rend chaque bloc caractere par caractere, et n'en omet
 *      jamais aucun : c'est exactement ce que le modele a fait de travers ;
 *   4. le motif `scène`/`scene` — un identifiant accentue cote appelant, non
 *      accentue cote fonction — ne peut pas revenir.
 *
 * Lancer :  node --test tests/mockup-texte.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import {
  construirePromptScene,
  construirePromptMockupIA,
  validerDemandeMockup,
  validerTextes,
  normaliserTextes,
  preparerTextesPourRendu,
  promptContientTexteClient,
  analyserPixelsLogo,
  CONSIGNE_AUCUN_TEXTE,
  LONGUEUR_PROMPT_MAX,
  LONGUEUR_PROMPT_MAX_IA,
  TEXTES_MAX,
  SUPPORTS,
} from '../src/features/mockup-ia/moteur-mockup.js';
import { dessinerTextes } from '../src/features/mockup-ia/composition.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Fabriques — les valeurs REELLES du client, pas des valeurs de laboratoire
   ═══════════════════════════════════════════════════════════════════════════ */

/** Le numero de l'imprimerie, avec ses espaces. Il ne doit JAMAIS bouger. */
const NUMERO = '060 44 46 34';
/** Le nom omis par le modele le 16/09 sur la banderole. Avec son accent aigu. */
const NOM = 'IMPRIMERIE OGOOUÉ';
const SLOGAN = 'Conception graphique & objets publicitaires';

const logoPng = { name: 'ogooue.png', type: 'image/png', size: 120_000 };

function pixelsAplats(nbCouleurs = 3, nbPixels = 400) {
  const d = [];
  for (let i = 0; i < nbPixels; i += 1) {
    const k = i % nbCouleurs;
    d.push(k * 80, 20, 200 - k * 60, 255);
  }
  return d;
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

function blocs(...contenus) {
  return contenus.map((contenu, i) => ({
    id: `t${i + 1}`, role: 'libre', contenu, zoneId: null, couleurId: 'noir', hauteurCm: 3,
  }));
}

/**
 * Doublure de contexte 2D qui ENREGISTRE ce qui est reellement dessine.
 *
 * C'est tout l'interet : on n'affirme pas « le compositeur a ete appele », on
 * affirme « la chaine exacte qui est arrivee a `fillText` ». C'est la seule
 * assertion qui aurait attrape le bloc omis par le modele.
 */
function ctxEspion({ largeurMesuree = null } = {}) {
  const ecrits = [];
  const polices = [];
  const ctx = {
    save() {}, restore() {},
    textAlign: '', textBaseline: '', fillStyle: '', strokeStyle: '',
    lineWidth: 0, globalAlpha: 1,
    set font(v) { polices.push(v); this._font = v; },
    get font() { return this._font; },
    fillText(texte, x, y) { ecrits.push({ methode: 'fillText', texte, x, y, font: this._font }); },
    strokeText(texte, x, y) { ecrits.push({ methode: 'strokeText', texte, x, y, font: this._font }); },
  };
  if (largeurMesuree !== null) {
    ctx.measureText = () => ({ width: largeurMesuree });
  }
  return { ctx, ecrits, polices, remplis: () => ecrits.filter((e) => e.methode === 'fillText') };
}

const ZONE_POITRINE = {
  id: 'poitrine_centre', label: 'Poitrine centre', cx: 0.5, cy: 0.42, wMax: 0.44, hMax: 0.34, largeurMaxCm: 28,
};
const ZONE_DOS = {
  id: 'dos', label: 'Dos (plein)', cx: 0.5, cy: 0.45, wMax: 0.52, hMax: 0.40, largeurMaxCm: 30,
};

/* ═══════════════════════════════════════════════════════════════════════════
   1. LE PROMPT NE CONTIENT JAMAIS DE TEXTE UTILISATEUR
   ═══════════════════════════════════════════════════════════════════════════ */

test('prompt IA : le numero du client n\'y figure sous AUCUNE forme', () => {
  const p = construirePromptMockupIA({
    supportId: 'banderole', colorisId: 'blanc', angleId: 'face',
    techniqueId: 'impression_grand_format', zoneId: 'pleine', largeurImpressionCm: 180,
    textes: blocs(NUMERO, NOM),
  });
  assert.ok(p.length > 50, 'le prompt doit exister');
  assert.doesNotMatch(p, /060/, 'le numero est parti au modele');
  assert.doesNotMatch(p, /44 46 34/, 'le numero est parti au modele');
  assert.doesNotMatch(p, /IMPRIMERIE/i, 'le nom du client est parti au modele');
  assert.doesNotMatch(p, /OGOOU/i, 'le nom du client est parti au modele');
});

test('prompt IA : la personnalisation libre est ignoree, pas relayee', () => {
  // `personnalisation` etait un champ de texte libre repris tel quel dans le
  // prompt (« Additional requirement from the shop: … »). C'etait la porte
  // ouverte : « ecris le numero en gros » y passait sans controle.
  const p = construirePromptMockupIA({
    supportId: 'tshirt_adulte', colorisId: 'blanc', techniqueId: 'flex', zoneId: 'poitrine_centre',
    personnalisation: 'ecris IMPRIMERIE OGOOUE et le 060 44 46 34 en gros sous le logo',
  });
  assert.doesNotMatch(p, /060/);
  assert.doesNotMatch(p, /IMPRIMERIE/i);
  assert.doesNotMatch(p, /Additional requirement/i);
});

test('prompt IA : aucun bloc de texte, meme au maximum autorise, ne fuit', () => {
  const p = construirePromptMockupIA({
    supportId: 'polo', colorisId: 'orange', techniqueId: 'transfert', zoneId: 'poitrine_gauche',
    textes: blocs(NOM, SLOGAN, NUMERO),
  });
  for (const morceau of [NOM, SLOGAN, NUMERO, 'Conception', 'publicitaires']) {
    assert.ok(
      !p.toLowerCase().includes(morceau.toLowerCase()),
      `« ${morceau} » s'est retrouve dans le prompt`,
    );
  }
});

test('prompt IA : la consigne « n\'ecris aucun texte » est presente et en DERNIER', () => {
  const p = construirePromptMockupIA({
    supportId: 'tshirt_adulte', colorisId: 'noir', techniqueId: 'flex', zoneId: 'poitrine_centre',
  });
  assert.ok(p.endsWith(CONSIGNE_AUCUN_TEXTE), 'la consigne doit fermer le prompt');
  assert.match(p, /no digits/i);
  assert.match(p, /no phone number/i);
});

test('prompt de scene : la consigne y est aussi, et le support reste vierge', () => {
  const p = construirePromptScene({ supportId: 'banderole', colorisId: 'blanc' });
  assert.ok(p.endsWith(CONSIGNE_AUCUN_TEXTE));
  assert.match(p, /blank/i);
  assert.match(p, /no text/i);
});

test('la consigne survit a la troncature, sur TOUS les supports du catalogue', () => {
  // C'etait le piege : la consigne est en fin de prompt. Une troncature bete
  // l'aurait mangee des qu'un libelle de support s'allonge — et le garde-fou
  // aurait disparu sans que rien ne le signale.
  for (const s of SUPPORTS) {
    const scene = construirePromptScene({ supportId: s.id, colorisId: s.coloris[0].id });
    const ia = construirePromptMockupIA({
      supportId: s.id, colorisId: s.coloris[0].id,
      techniqueId: s.techniques[0], zoneId: s.zones[0].id, largeurImpressionCm: 25,
    });
    assert.ok(scene.endsWith(CONSIGNE_AUCUN_TEXTE), `consigne perdue (scene) sur ${s.id}`);
    assert.ok(ia.endsWith(CONSIGNE_AUCUN_TEXTE), `consigne perdue (ia) sur ${s.id}`);
    assert.ok(scene.length <= LONGUEUR_PROMPT_MAX, `prompt de scene trop long sur ${s.id}`);
    assert.ok(ia.length <= LONGUEUR_PROMPT_MAX_IA, `prompt IA trop long sur ${s.id}`);
  }
});

test('demande complete en mode IA : le prompt reellement envoye ne porte aucun texte', () => {
  const r = validerDemandeMockup(demandeValide({ mode: 'ia', textes: blocs(NOM, NUMERO) }));
  assert.equal(r.ok, true, r.message);
  assert.doesNotMatch(r.prompt, /060/);
  assert.doesNotMatch(r.prompt, /IMPRIMERIE/i);
});

test('prompt edite a la main : y recopier un texte du client BLOQUE la generation', () => {
  // Le dernier chemin possible : la zone de prompt est editable. Quelqu'un de
  // bien intentionne y recopie le numero « pour aider ». On refuse, et on dit
  // exactement pourquoi.
  const r = validerDemandeMockup(demandeValide({
    mode: 'ia',
    textes: blocs(NUMERO),
    promptEdite: `A white t-shirt with the logo and the phone number ${NUMERO} below it.`,
  }));
  assert.equal(r.ok, false);
  assert.equal(r.raison, 'texte-dans-le-prompt');
  assert.ok(r.message.includes(NUMERO), 'le message doit citer le texte en cause');
  assert.ok(r.message.length > 40, 'le refus doit etre exploitable au comptoir');
});

test('prompt edite : un prompt sans texte client passe toujours', () => {
  const r = validerDemandeMockup(demandeValide({
    mode: 'ia', textes: blocs(NUMERO),
    promptEdite: 'A white cotton t-shirt worn by a model, studio lighting, blank fabric.',
  }));
  assert.equal(r.ok, true, r.message);
});

test('promptContientTexteClient : insensible a la casse, et sans faux positif court', () => {
  assert.equal(promptContientTexteClient('… the OGOOUÉ banner …', blocs('Ogooué')).trouve, true);
  // Un bloc de 1 a 2 caracteres se retrouve dans n'importe quel prompt anglais :
  // le tester bloquerait toute generation pour rien.
  assert.equal(promptContientTexteClient('a blank white t-shirt', blocs('a')).trouve, false);
  assert.equal(promptContientTexteClient('a blank white t-shirt', blocs('AB')).trouve, false);
  assert.equal(promptContientTexteClient('', blocs(NUMERO)).trouve, false);
  assert.equal(promptContientTexteClient('anything', []).trouve, false);
  assert.doesNotThrow(() => promptContientTexteClient(null, null));
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. UN BLOC DE TEXTE VIDE EST REFUSE, AVEC UN MESSAGE
   ═══════════════════════════════════════════════════════════════════════════ */

test('bloc vide : REFUS, avec son numero de bloc et la marche a suivre', () => {
  const r = validerTextes([
    { id: 't1', contenu: NOM, hauteurCm: 3 },
    { id: 't2', contenu: '', hauteurCm: 2 },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.message, /bloc de texte n°2/i, 'le message doit dire QUEL bloc');
  assert.match(r.message, /vide/i);
  assert.ok(r.message.length > 40, 'un refus doit etre exploitable, pas laconique');
});

test('bloc contenant seulement des espaces : refuse lui aussi', () => {
  const r = validerTextes([{ id: 't1', contenu: '   ' }]);
  assert.equal(r.ok, false);
  assert.match(r.message, /bloc de texte n°1/i);
});

test('bloc vide : le refus remonte jusqu\'a l\'autorisation du clic', () => {
  // Le message doit venir de la fonction qui autorise le bouton, sinon
  // l'ecran laisse cliquer et facture une generation pour rien.
  const r = validerDemandeMockup(demandeValide({
    mode: 'ia',
    textes: [{ id: 't1', contenu: NOM }, { id: 't2', contenu: '' }],
  }));
  assert.equal(r.ok, false);
  assert.equal(r.raison, 'texte-invalide');
  assert.match(r.message, /vide/i);
});

test('bloc vide : il n\'est PAS silencieusement supprime', () => {
  // `normaliserTextes` le retire — c'est son role. Ce qui compte, c'est que la
  // VALIDATION, elle, ne laisse pas passer : un bloc ouvert et laisse vide est
  // le geste de quelqu'un qui a ete interrompu.
  assert.equal(normaliserTextes([{ contenu: NOM }, { contenu: '' }]).length, 1);
  assert.equal(validerTextes([{ contenu: NOM }, { contenu: '' }]).ok, false);
});

test('blocs tous renseignes : la validation passe et rend la liste', () => {
  const r = validerTextes(blocs(NOM, NUMERO), { techniqueId: 'transfert' });
  assert.equal(r.ok, true);
  assert.equal(r.message, '');
  assert.equal(r.textes.length, 2);
  assert.equal(r.textes[0].contenu, NOM);
  assert.equal(r.textes[1].contenu, NUMERO);
});

test('aucun bloc : la validation passe (le texte reste optionnel)', () => {
  assert.equal(validerTextes([]).ok, true);
  assert.equal(validerTextes(undefined).ok, true);
  assert.equal(validerDemandeMockup(demandeValide({ mode: 'ia' })).ok, true);
});

test('trop de blocs, ou bloc trop long : refus chiffres, jamais un silence', () => {
  const trop = validerTextes(blocs(NOM, SLOGAN, NUMERO, 'Un quatrieme'));
  assert.equal(trop.ok, false);
  assert.ok(trop.message.includes(String(TEXTES_MAX)));

  const long = validerTextes(blocs('x'.repeat(200)));
  assert.equal(long.ok, false);
  assert.match(long.message, /depasse/i);
});

test('l\'avertissement « chiffres » ne ment plus : il renvoie a la SAISIE', () => {
  const r = validerTextes(blocs(NUMERO), { techniqueId: 'transfert' });
  const a = r.avertissements.find((x) => x.code === 'verifier-chiffres');
  assert.ok(a, 'un texte a chiffres doit declencher la relecture');
  // Le message disait « en rendu IA le texte est redessine ». Ce n'est plus
  // vrai : le laisser aurait entretenu une peur devenue sans objet, et detourne
  // la relecture de la seule chose qui peut encore etre fausse — la saisie.
  assert.doesNotMatch(a.message, /redessine/i);
  assert.match(a.message, /application/i);
});

test('aucune entree, meme absurde, ne leve d\'exception dans la validation', () => {
  const absurdes = [null, undefined, 'texte', 42, [null], [{}], [{ contenu: 12 }], [[]]];
  for (const e of absurdes) {
    assert.doesNotThrow(() => validerTextes(e), `entree ${JSON.stringify(e)}`);
    assert.doesNotThrow(() => normaliserTextes(e));
    assert.doesNotThrow(() => preparerTextesPourRendu(e, { supportId: 'tshirt_adulte' }));
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. LE COMPOSITEUR REND LE TEXTE CARACTERE POUR CARACTERE — ET N'EN OMET AUCUN
   ═══════════════════════════════════════════════════════════════════════════ */

test('le numero est dessine caractere pour caractere, espaces compris', () => {
  const { ctx, remplis } = ctxEspion();
  const n = dessinerTextes(ctx, [{ contenu: NUMERO, hauteurCm: 3, hex: '#111111', zone: ZONE_POITRINE }], ZONE_POITRINE, 1000, 1200);
  assert.equal(n, 1);
  const dessine = remplis();
  assert.equal(dessine.length, 1);
  // ⛔ Egalite STRICTE. Pas un `match`, pas un `includes` : la chaine dessinee
  // doit etre la chaine saisie, octet pour octet.
  assert.equal(dessine[0].texte, NUMERO);
  assert.equal(dessine[0].texte, '060 44 46 34');
});

test('les accents du nom sont preserves — le « É » ne devient pas « E »', () => {
  const { ctx, remplis } = ctxEspion();
  dessinerTextes(ctx, [{ contenu: NOM, hauteurCm: 4, hex: '#111111', zone: ZONE_POITRINE }], ZONE_POITRINE, 1000, 1200);
  assert.equal(remplis()[0].texte, NOM);
  assert.ok(remplis()[0].texte.includes('É'), 'l\'accent aigu a saute');
});

test('AUCUN bloc n\'est omis — c\'est exactement ce que le modele a rate', () => {
  // Le 16/09, sur la banderole, le modele a rendu le numero et OMIS le nom.
  // `fillText` ne sait pas faire ca : on le verifie, bloc par bloc.
  const liste = [
    { contenu: NOM, hauteurCm: 5, hex: '#111111', zone: ZONE_POITRINE },
    { contenu: SLOGAN, hauteurCm: 2, hex: '#3FA9F5', zone: ZONE_POITRINE },
    { contenu: NUMERO, hauteurCm: 4, hex: '#111111', zone: ZONE_POITRINE },
  ];
  const { ctx, remplis } = ctxEspion();
  const n = dessinerTextes(ctx, liste, ZONE_POITRINE, 1000, 1200);
  assert.equal(n, 3, 'un bloc a disparu');
  assert.deepEqual(remplis().map((e) => e.texte), [NOM, SLOGAN, NUMERO]);
});

test('chaque bloc va dans SA zone, et les blocs d\'une meme zone s\'empilent', () => {
  const liste = [
    { contenu: NOM, hauteurCm: 4, hex: '#111', zone: ZONE_POITRINE },
    { contenu: NUMERO, hauteurCm: 4, hex: '#111', zone: ZONE_POITRINE },
    { contenu: SLOGAN, hauteurCm: 4, hex: '#111', zone: ZONE_DOS },
  ];
  const { ctx, remplis } = ctxEspion();
  dessinerTextes(ctx, liste, ZONE_POITRINE, 1000, 1200);
  const [a, b, c] = remplis();
  assert.ok(b.y > a.y, 'deux blocs de la meme zone doivent s\'empiler');
  // Le bloc du dos repart du haut de SA zone : il ne suit pas la pile de la
  // poitrine, sinon un nom sur la poitrine pousserait le dos hors du support.
  assert.equal(
    Math.round(c.y),
    Math.round((ZONE_DOS.cy + ZONE_DOS.hMax * 0.32) * 1200),
    'le bloc d\'une autre zone doit repartir du haut de SA zone',
  );
  assert.equal(Math.round(a.x), Math.round(ZONE_POITRINE.cx * 1000));
  assert.equal(Math.round(c.x), Math.round(ZONE_DOS.cx * 1000));
});

test('un texte plus large que sa zone est reduit — mais la chaine ne change pas', () => {
  const { ctx, remplis, polices } = ctxEspion({ largeurMesuree: 99_999 });
  dessinerTextes(ctx, [{ contenu: SLOGAN, hauteurCm: 6, hex: '#111', zone: ZONE_POITRINE }], ZONE_POITRINE, 1000, 1200);
  assert.equal(remplis()[0].texte, SLOGAN, 'le texte a ete tronque au lieu d\'etre reduit');
  assert.ok(polices.length > 1, 'la taille de police aurait du etre reduite');
});

test('un bloc vide ou blanc n\'est pas dessine', () => {
  const { ctx, remplis } = ctxEspion();
  const n = dessinerTextes(ctx, [
    { contenu: '', hauteurCm: 3, zone: ZONE_POITRINE },
    { contenu: '   ', hauteurCm: 3, zone: ZONE_POITRINE },
    { contenu: NUMERO, hauteurCm: 3, zone: ZONE_POITRINE },
  ], ZONE_POITRINE, 1000, 1200);
  assert.equal(n, 1);
  assert.equal(remplis()[0].texte, NUMERO);
});

test('un bloc qui fait echouer le contexte n\'emporte pas les autres', () => {
  // Regle de survie : aucune exception ne doit pouvoir empecher l'ecran de
  // s'afficher. Un bloc illisible degrade, il ne casse pas.
  const ecrits = [];
  let premier = true;
  const ctx = {
    save() {}, restore() {},
    textAlign: '', textBaseline: '', fillStyle: '', strokeStyle: '', lineWidth: 0, globalAlpha: 1,
    set font(v) { this._font = v; },
    get font() { return this._font; },
    fillText(t) {
      if (premier) { premier = false; throw new Error('contexte casse'); }
      ecrits.push(t);
    },
    strokeText() {},
  };
  let n;
  assert.doesNotThrow(() => {
    n = dessinerTextes(ctx, [
      { contenu: NOM, hauteurCm: 3, zone: ZONE_POITRINE },
      { contenu: NUMERO, hauteurCm: 3, zone: ZONE_POITRINE },
    ], ZONE_POITRINE, 1000, 1200);
  });
  assert.equal(n, 1, 'le second bloc devait quand meme etre dessine');
  assert.deepEqual(ecrits, [NUMERO]);
});

test('entrees absurdes : le compositeur rend 0, il ne leve jamais', () => {
  const { ctx } = ctxEspion();
  for (const e of [null, undefined, 'texte', 42, [], [null], [{}]]) {
    assert.doesNotThrow(() => dessinerTextes(ctx, e, ZONE_POITRINE, 1000, 1200));
  }
  assert.equal(dessinerTextes(null, [{ contenu: NUMERO }], ZONE_POITRINE, 1000, 1200), 0);
  // Sans zone du tout, on retombe sur une geometrie de repli plutot que de rien
  // dessiner : un texte mal place se corrige, un texte absent ne se voit pas.
  const espion = ctxEspion();
  assert.equal(dessinerTextes(espion.ctx, [{ contenu: NUMERO, hauteurCm: 3 }], null, 1000, 1200), 1);
});

test('preparerTextesPourRendu : couleur resolue et zone choisie selon le support', () => {
  const prets = preparerTextesPourRendu([
    { contenu: NOM, couleurId: 'cyan', hauteurCm: 4, zoneId: 'dos' },
    { contenu: NUMERO, couleurId: 'noir', hauteurCm: 3, zoneId: null },
  ], { supportId: 'tshirt_adulte', zoneIdDefaut: 'poitrine_centre' });

  assert.equal(prets.length, 2);
  assert.equal(prets[0].hex, '#3FA9F5');
  assert.equal(prets[0].zone.id, 'dos');
  assert.equal(prets[1].hex, '#111111');
  assert.equal(prets[1].zone.id, 'poitrine_centre', 'un bloc sans zone suit la zone de marquage courante');
  // Le contenu n'est JAMAIS retouche au passage.
  assert.equal(prets[0].contenu, NOM);
  assert.equal(prets[1].contenu, NUMERO);
});

test('preparerTextesPourRendu : support inconnu → zone nulle, jamais une exception', () => {
  const prets = preparerTextesPourRendu(blocs(NUMERO), { supportId: 'licorne' });
  assert.equal(prets.length, 1);
  assert.equal(prets[0].zone, null);
  const { ctx, remplis } = ctxEspion();
  dessinerTextes(ctx, prets, null, 1000, 1000);
  assert.equal(remplis()[0].texte, NUMERO, 'le texte doit etre dessine meme sans zone');
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. LE MOTIF `scène` / `scene` NE PEUT PAS REVENIR
   ═══════════════════════════════════════════════════════════════════════════

   Le bug : `page.jsx` passait `scène:` a `composerMockup()` qui destructure
   `scene`. Deux identifiants DIFFERENTS en JavaScript. La fonction repondait
   « Scène absente » a chaque appel, et le mode incrustation ne dessinait
   JAMAIS rien, depuis le 15/09.

   Ce qui rend cette faute redoutable : elle ne produit ni erreur de build, ni
   erreur de lint, ni exception a l'execution. Elle est INVISIBLE a toute la
   chaine d'outillage. Seule la lecture du source la voit — d'ou ce test, sur
   le modele de `tests/amorcage.test.mjs`.

   La regle retenue est plus large que le seul couple `scène`/`scene` : AUCUN
   identifiant accentue dans ce dossier. Les accents restent dans les chaines,
   les commentaires et le texte affiche — c'est du francais, il en faut.
   ═══════════════════════════════════════════════════════════════════════════ */

const DOSSIER = fileURLToPath(new URL('../src/features/mockup-ia/', import.meta.url));
const ACCENTS = 'À-ÖØ-öø-ÿ';
const IDENTIFIANT_ACCENTUE = new RegExp(
  `[A-Za-z_$][A-Za-z0-9_$]*[${ACCENTS}][A-Za-z0-9_$${ACCENTS}]*`
  + `|[${ACCENTS}][A-Za-z0-9_$${ACCENTS}]*`,
  'g',
);

/**
 * Retire tout ce qui a LE DROIT de porter des accents : commentaires, chaines,
 * gabarits, et texte JSX entre balises. Ce qui reste est du code.
 */
function deshabiller(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/>[^<>{}]*</g, '><');
}

function fichiersDuDossier() {
  return readdirSync(DOSSIER).filter((f) => /\.(js|jsx)$/.test(f));
}

test('le detecteur attrape bien le bug d\'origine (sinon il ne prouve rien)', () => {
  // Un test de source qui ne sait pas voir la faute qu'il surveille est pire
  // qu'absent : il rassure. On lui montre donc la faute reelle, telle qu'elle
  // etait ecrite dans page.jsx.
  const bugReel = 'const r = composerMockup({ canvas, scène: sceneImage, logo, zone });';
  const variable = 'const scène = extraireScene(corps); if (!scène.ok) return;';
  const chemin = 'const cheminPhotothèque = `/mockups/x.jpg`;';
  for (const cas of [bugReel, variable, chemin]) {
    const trouve = deshabiller(cas).match(IDENTIFIANT_ACCENTUE) || [];
    assert.ok(trouve.length > 0, `le detecteur ne voit pas : ${cas}`);
  }
});

test('le detecteur ne se declenche pas sur du francais legitime', () => {
  const legitimes = [
    "const m = 'Scène absente : rien a composer.';",
    'const s = `Scène generee (${x} facture).`;',
    '// La scène doit etre vierge, sinon l\'apercu ment',
    '/* Aperçu indicatif — simulation */',
    '<p>Aperçu indicatif — scène générée par l\'IA</p>',
    '<span>Rejeté — rien enregistre</span>',
  ];
  for (const cas of legitimes) {
    const trouve = deshabiller(cas).match(IDENTIFIANT_ACCENTUE) || [];
    assert.deepEqual(trouve, [], `faux positif sur : ${cas}`);
  }
});

test('AUCUN identifiant accentue dans src/features/mockup-ia/', () => {
  const fautes = [];
  for (const fichier of fichiersDuDossier()) {
    const src = readFileSync(join(DOSSIER, fichier), 'utf8');
    for (const trouve of new Set(deshabiller(src).match(IDENTIFIANT_ACCENTUE) || [])) {
      fautes.push(`${fichier} : ${trouve}`);
    }
  }
  assert.deepEqual(
    fautes, [],
    'Identifiant(s) accentue(s) : ' + fautes.join(', ')
    + '. Un identifiant accentue cote appelant et non accentue cote fonction '
    + '(`scène:` contre `scene`) ne produit NI erreur de build NI erreur de lint : '
    + 'la fonction recoit `undefined` et repond « absent » a chaque appel. '
    + 'C\'est ce qui a empeche le mode incrustation de dessiner quoi que ce soit '
    + 'du 15/09 au 16/09/2026.',
  );
});

test('le correctif tient : page.jsx passe bien `scene:` a composerMockup', () => {
  // La verification directe, en plus de la regle generale : le correctif du
  // 16/09 n'avait jamais ete vu a l'oeil.
  const page = readFileSync(join(DOSSIER, 'page.jsx'), 'utf8');
  const i = page.indexOf('composerMockup({');
  assert.ok(i > 0, 'composerMockup doit etre appele par l\'ecran');
  const appel = page.slice(i, i + 700);
  assert.match(appel, /\bscene:\s*sceneImage\b/, 'la scene n\'est pas passee sous le nom attendu');
  assert.doesNotMatch(appel, /scène/, 'le `scène:` accentue est revenu');
});

test('le texte est compose dans les DEUX modes — page.jsx ne le vide plus', () => {
  // Regression du contrat : l'ancien code passait `textes: iaComplete ? [] : …`,
  // ce qui laissait le modele seul responsable du texte en mode « ia ».
  const page = readFileSync(join(DOSSIER, 'page.jsx'), 'utf8');
  const i = page.indexOf('composerMockup({');
  const appel = page.slice(i, i + 700);
  assert.match(appel, /textes:\s*textesRendu/, 'les textes doivent etre composes dans les deux modes');
  assert.doesNotMatch(
    appel, /textes:\s*iaComplete\s*\?/,
    'le mode « ia » ne doit plus deleguer le texte au modele',
  );
});

test('aucun constructeur de prompt ne prend plus de texte utilisateur', () => {
  const moteur = readFileSync(join(DOSSIER, 'moteur-mockup.js'), 'utf8');
  const debut = moteur.indexOf('export function construirePromptMockupIA');
  assert.ok(debut > 0);
  // Les commentaires sont retires : ils PARLENT de `textes` et de
  // `personnalisation` pour expliquer pourquoi ces entrees ont ete retirees.
  // Ce qu'on surveille, c'est le code.
  const corps = deshabiller(moteur.slice(debut, moteur.indexOf('\n}', debut)));
  // Ni les blocs de texte, ni la personnalisation libre ne doivent etre lus.
  assert.doesNotMatch(corps, /\btextes\b/, 'le prompt IA lit encore les blocs de texte');
  assert.doesNotMatch(corps, /\bpersonnalisation\b/, 'le prompt IA lit encore la personnalisation');
  assert.doesNotMatch(moteur, /decrireTextes/, 'la fabrique de texte pour prompt doit avoir disparu');
});
