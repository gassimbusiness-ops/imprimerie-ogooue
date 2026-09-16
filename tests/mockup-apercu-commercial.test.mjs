/**
 * UN APERÇU N'EST PAS UNE PRODUCTION.
 *
 * ── Ce que ce fichier protege ─────────────────────────────────────────────
 *
 * Le 17/09/2026, le gerant a envoye une capture de l'ecran « Mockups IA » :
 *
 *     ❌ Impossible en atelier. Ce visuel est une photo (295 teintes
 *        distinctes) : le flex est du vinyle de couleur unie decoupee, il ne
 *        peut pas la reproduire.
 *
 * ... et le bouton refusait de generer. Sa phrase, mot pour mot :
 *
 *     « Le mockup, c'est pas forcement une impression, c'est juste un apercu
 *       au client ou entreprise de comment sera leur impression. Donc faut pas
 *       qu'il nous mette des blocages comme la actuellement. »
 *
 * Le contresens du code d'origine : il traitait le mockup comme un BON A TIRER.
 * Un apercu commercial se montre AVANT que la technique soit arretee — c'est
 * meme souvent lui qui sert a dire au client « en flex ca ne passe pas, on part
 * sur du transfert ». Bloquer l'apercu sur un verdict d'atelier fait perdre la
 * conversation ET la vente.
 *
 * Les deux notions sont donc separees, et ce fichier tient la frontiere :
 *
 *   1. CE QUI EMPECHE DE PRODUIRE UN APERÇU  → reste bloquant.
 *      Pas de logo, pas de support, pas de coloris, pas de zone, prompt vide,
 *      generation deja en cours, plafond du jour atteint. Ce sont des
 *      INFORMATIONS MANQUANTES ou de l'argent, pas des jugements techniques.
 *
 *   2. CE QUI DIT SI L'ATELIER SAIT LE FAIRE  → informe, ne bloque JAMAIS.
 *      Teintes vs flex, sublimation sur support sombre, technique hors du
 *      perimetre du support, definition du fichier, detail trop fin. Ces notes
 *      restent visibles — elles protegent l'imprimerie d'une promesse
 *      intenable — mais formulees du point de vue du commercial : pas
 *      « impossible », mais « ce visuel ne se fait pas en flex, prevoir du
 *      transfert ».
 *
 * Lancer :  node --test tests/mockup-apercu-commercial.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validerDemandeMockup,
  verifierFaisabilite,
  analyserPixelsLogo,
  PLAFOND_GENERATIONS_PAR_JOUR,
  TITRE_NOTE_ATELIER,
} from '../src/features/mockup-ia/moteur-mockup.js';

/* ── Fabriques ─────────────────────────────────────────────────────────────── */

const logoPng = { name: 'bacoref.png', type: 'image/png', size: 120_000 };

/** Logo en aplats : ce que le flex sait faire. */
function pixelsAplats(nbCouleurs = 3, nbPixels = 400) {
  const d = [];
  for (let i = 0; i < nbPixels; i += 1) {
    const k = i % nbCouleurs;
    d.push(k * 80, 20, 200 - k * 60, 255);
  }
  return d;
}

/**
 * Logo photo : `nbTeintes` teintes distinctes APRES quantification 4 bits.
 * Les valeurs sont espacees de 16 pour tomber chacune dans son propre seau.
 * 295 est le chiffre exact affiche sur la capture du gerant.
 */
function pixelsPhoto(nbTeintes = 295) {
  const d = [];
  for (let k = 0; k < nbTeintes; k += 1) {
    d.push((k % 16) * 16, (Math.floor(k / 16) % 16) * 16, (Math.floor(k / 256) % 16) * 16, 255);
  }
  return d;
}

/** Logo en degrade : une rampe continue. */
function pixelsDegrade(nbPixels = 600) {
  const d = [];
  for (let i = 0; i < nbPixels; i += 1) {
    const v = Math.floor((i / nbPixels) * 255);
    d.push(v, v, 255 - v, 255);
  }
  return d;
}

/** Demande complete de reference — chaque test n'en change qu'un champ. */
function demandeValide(extra = {}) {
  return {
    supportId: 'tshirt_adulte',
    colorisId: 'blanc',
    angleId: 'face',
    techniqueId: 'flex',
    zoneId: 'poitrine_gauche',
    fichierLogo: logoPng,
    analyseLogo: analyserPixelsLogo(pixelsAplats(3)),
    largeurImpressionCm: 9,
    largeurLogoPx: 900,
    ...extra,
  };
}

/** Le texte complet d'une note : le constat ET ce qu'il faut faire a la place. */
function texteNote(n) {
  return `${n.message} ${n.alternative || ''}`.trim();
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. LE CAS DE LA CAPTURE — photo 295 teintes sur du flex
   ═══════════════════════════════════════════════════════════════════════════ */

test('LE CAS DU GERANT : logo photo 295 teintes sur du flex → l apercu est AUTORISE', () => {
  const analyseLogo = analyserPixelsLogo(pixelsPhoto(295));
  assert.equal(analyseLogo.nbCouleurs, 295, 'la fabrique doit produire 295 teintes, comme la capture');
  assert.equal(analyseLogo.estPhoto, true);

  const r = validerDemandeMockup(demandeValide({ techniqueId: 'flex', analyseLogo }));

  assert.equal(r.ok, true, 'un apercu commercial ne se refuse pas sur un verdict d\'atelier');
  assert.equal(r.raison, null);
  assert.equal(r.message, '');
});

test('LE CAS DU GERANT : l apercu autorise porte quand meme la note technique', () => {
  const r = validerDemandeMockup(demandeValide({
    techniqueId: 'flex',
    analyseLogo: analyserPixelsLogo(pixelsPhoto(295)),
  }));

  assert.ok(r.faisabilite, 'la faisabilite doit accompagner la demande, pour l\'ecran et le PDF');
  const note = r.faisabilite.reserves.find((x) => x.code === 'flex-photo');
  assert.ok(note, 'la note « ce visuel ne se fait pas en flex » a disparu — elle doit rester');
  assert.match(texteNote(note), /295 teintes/, 'le chiffre mesure doit rester dans la note');
  assert.match(texteNote(note), /flex/i);
  assert.match(texteNote(note), /transfert/i, 'la note doit donner l\'alternative vendable');
});

test('LE CAS DU GERANT : la note ne dit plus « impossible » — elle dit quoi faire', () => {
  const f = verifierFaisabilite({
    supportId: 'tshirt_adulte',
    colorisId: 'blanc',
    techniqueId: 'flex',
    analyseLogo: analyserPixelsLogo(pixelsPhoto(295)),
  });
  for (const note of f.reserves) {
    assert.doesNotMatch(
      texteNote(note), /impossible/i,
      `« ${note.code} » parle encore d'impossibilite : c'est un apercu, pas un bon a tirer`,
    );
    assert.ok(
      (note.alternative || '').length > 10,
      `« ${note.code} » ne propose aucune alternative — une note sans issue est un refus deguise`,
    );
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. TOUTES LES AUTRES RESERVES D'ATELIER — informent, ne bloquent pas
   ═══════════════════════════════════════════════════════════════════════════ */

test('flex + degrade : apercu autorise, note technique conservee', () => {
  const r = validerDemandeMockup(demandeValide({
    techniqueId: 'flex',
    analyseLogo: analyserPixelsLogo(pixelsDegrade()),
  }));
  assert.equal(r.ok, true);
  const note = r.faisabilite.reserves.find((x) => x.code === 'flex-degrade');
  assert.ok(note, 'la note sur le degrade doit rester visible');
  assert.match(texteNote(note), /transfert/i);
});

test('sublimation sur t-shirt noir : apercu autorise, note technique conservee', () => {
  const r = validerDemandeMockup(demandeValide({
    colorisId: 'noir',
    techniqueId: 'sublimation',
  }));
  assert.equal(r.ok, true, 'le client doit pouvoir voir son t-shirt noir avant d\'arbitrer');
  const note = r.faisabilite.reserves.find((x) => x.code === 'sublimation-support-sombre');
  assert.ok(note);
  assert.match(texteNote(note), /sombre/i);
  assert.match(texteNote(note), /dark|flex/i);
});

test('technique hors du perimetre du support : apercu autorise, note technique conservee', () => {
  const r = validerDemandeMockup(demandeValide({
    supportId: 'tasse_simple',
    colorisId: 'blanc',
    zoneId: 'flanc',
    techniqueId: 'flex',
  }));
  assert.equal(r.ok, true);
  const note = r.faisabilite.reserves.find((x) => x.code === 'technique-hors-support');
  assert.ok(note);
  assert.match(texteNote(note), /Sublimation/i, 'la note doit nommer ce que l\'atelier SAIT faire');
});

test('definition faible : apercu autorise, avertissement chiffre conserve', () => {
  // 251 px de large imprimes en 8 cm : le second message de la capture.
  const r = validerDemandeMockup(demandeValide({
    largeurLogoPx: 251,
    largeurImpressionCm: 8,
  }));
  assert.equal(r.ok, true, 'un fichier trop petit n\'empeche pas de MONTRER le rendu voulu');
  const a = r.faisabilite.avertissements.find((x) => x.code === 'definition-faible');
  assert.ok(a, 'l\'avertissement de definition doit rester');
  assert.match(a.message, /251 px/);
  assert.match(a.message, /150/);
});

test('technique non choisie : apercu autorise, simple avertissement de chiffrage', () => {
  const r = validerDemandeMockup(demandeValide({ techniqueId: '' }));
  assert.equal(r.ok, true, 'on montre un apercu AVANT d\'arreter la technique — c\'est le cas normal');
  assert.ok(r.faisabilite.avertissements.some((x) => x.code === 'technique-absente'));
});

test('INVARIANT : aucune reserve d\'atelier ne fait jamais tomber ok', () => {
  const cas = [
    { techniqueId: 'flex', analyseLogo: analyserPixelsLogo(pixelsPhoto(295)) },
    { techniqueId: 'flex', analyseLogo: analyserPixelsLogo(pixelsDegrade()) },
    { techniqueId: 'sublimation', colorisId: 'noir' },
    { supportId: 'tasse_simple', colorisId: 'blanc', zoneId: 'flanc', techniqueId: 'flex' },
    { largeurLogoPx: 120, largeurImpressionCm: 20 },
    { techniqueId: '' },
  ];
  for (const c of cas) {
    const r = validerDemandeMockup(demandeValide(c));
    assert.equal(r.ok, true, `${JSON.stringify(c)} ne doit plus bloquer l'apercu (raison : ${r.raison})`);
  }
});

test('verifierFaisabilite annonce toujours que l apercu, lui, reste possible', () => {
  const entrees = [
    {},
    { supportId: 'tshirt_adulte', colorisId: 'noir', techniqueId: 'sublimation' },
    { supportId: 'tshirt_adulte', colorisId: 'blanc', techniqueId: 'flex', analyseLogo: analyserPixelsLogo(pixelsPhoto(295)) },
  ];
  for (const e of entrees) {
    assert.equal(verifierFaisabilite(e).apercuPossible, true);
  }
});

test('le titre des notes est nomme une seule fois, et ne parle pas de refus', () => {
  assert.ok(typeof TITRE_NOTE_ATELIER === 'string' && TITRE_NOTE_ATELIER.length > 5);
  assert.doesNotMatch(TITRE_NOTE_ATELIER, /impossible|refus/i);
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. CE QUI DOIT RESTER BLOQUANT — et qui l'est toujours
   ═══════════════════════════════════════════════════════════════════════════ */

test('RESTE BLOQUANT : sans logo, il n y a rien a apercevoir', () => {
  const r = validerDemandeMockup(demandeValide({ fichierLogo: null }));
  assert.equal(r.ok, false);
  assert.equal(r.raison, 'absent');
  assert.match(r.message, /logo/i);
});

test('RESTE BLOQUANT : les informations manquantes, le double-clic et le plafond', () => {
  const refus = [
    ['support-absent', validerDemandeMockup({})],
    ['coloris-hors-stock', validerDemandeMockup(demandeValide({ colorisId: 'rouge' }))],
    ['zone-absente', validerDemandeMockup(demandeValide({ zoneId: '' }))],
    ['format-inattendu', validerDemandeMockup(demandeValide({
      fichierLogo: { name: 'logo.cdr', type: '', size: 50_000 },
    }))],
    ['prompt-vide', validerDemandeMockup(demandeValide({ promptEdite: '   ' }))],
    ['en-cours', validerDemandeMockup(demandeValide({ enCours: true }))],
    ['plafond', validerDemandeMockup(demandeValide({
      compteurDuJour: PLAFOND_GENERATIONS_PAR_JOUR,
    }))],
  ];
  for (const [raison, r] of refus) {
    assert.equal(r.ok, false, `« ${raison} » ne bloque plus : on est alle trop loin`);
    assert.equal(r.raison, raison);
    assert.ok(r.message.trim().length >= 20, `« ${raison} » sans message exploitable`);
  }
});

test('RESTE BLOQUANT : un texte client recopie dans le prompt (regle du 16/09)', () => {
  const r = validerDemandeMockup(demandeValide({
    textes: [{ contenu: '060 44 46 34', role: 'telephone' }],
    promptEdite: 'A white t-shirt with 060 44 46 34 written on it',
  }));
  assert.equal(r.ok, false);
  assert.equal(r.raison, 'texte-dans-le-prompt');
});

test('plus aucun refus ne porte la raison « technique-impossible »', () => {
  const cas = [
    demandeValide({ techniqueId: 'flex', analyseLogo: analyserPixelsLogo(pixelsPhoto(295)) }),
    demandeValide({ colorisId: 'noir', techniqueId: 'sublimation' }),
    demandeValide({ supportId: 'tasse_simple', colorisId: 'blanc', zoneId: 'flanc', techniqueId: 'flex' }),
    demandeValide({ techniqueId: '' }),
  ];
  for (const c of cas) {
    assert.notEqual(validerDemandeMockup(c).raison, 'technique-impossible');
  }
});
