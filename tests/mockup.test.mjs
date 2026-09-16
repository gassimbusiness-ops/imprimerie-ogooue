/**
 * Tests — moteur de mockup (pipeline hybride).
 *
 * L'architecture testee ici tient en une phrase :
 *   l'IA fait le t-shirt et la lumiere, le logo vient du fichier du client,
 *   il n'est jamais redessine.
 *
 * Ce que ces tests protegent, dans l'ordre des degats deja constates :
 *
 *  1. LE BOUTON GRISE MUET. Le gerant a vecu « impossible de cliquer » sans
 *     aucune explication. `validerDemandeMockup` renvoie donc TOUJOURS un
 *     `message` non vide quand `ok === false`. Un test balaie tous les refus.
 *  2. LA PALETTE QUI MENT. L'ecran proposait Rouge, Jaune et Gris — absents du
 *     stock — et omettait Rose, Violet et Orange — presents. Verifie ici contre
 *     `public/data/inventaire_data.json`.
 *  3. LE DOUBLE-CLIC FACTURE. Chaque generation part sur la facture OpenAI de
 *     l'imprimerie.
 *  4. LA SUR-PROMESSE COMMERCIALE. Un mockup plus beau que ce que la presse sort
 *     ramene le client mecontent a la livraison. Le moteur doit REFUSER le flex
 *     sur un degrade et la sublimation sur support sombre.
 *  5. L'IMAGE DANS LA BASE. `db.list()` retelecharge TOUTE la colonne `data` a
 *     chaque ouverture d'ecran : une image base64 dans un devis rendrait l'ecran
 *     Devis inutilisable depuis Moanda. On stocke la recette, jamais l'image.
 *
 * AUCUN appel reseau ici, AUCUNE image generee : les reponses sont simulees.
 *
 * Lancer :  node --test tests/mockup.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SUPPORTS,
  trouverSupport,
  trouverColoris,
  construirePromptScene,
  validerDemandeMockup,
  validerFichierLogo,
  verifierFaisabilite,
  verifierDefinition,
  verifierPlafond,
  analyserPixelsLogo,
  extraireScene,
  extraireMessageErreur,
  construireRecette,
  recetteSansImage,
  deciderEnregistrement,
  svgContientDuTexte,
  coutGeneration,
  formatFCFA,
  MENTION_RESERVE,
  PLAFOND_GENERATIONS_PAR_JOUR,
  TAILLE_RECETTE_MAX_OCTETS,
  VERSION_MOTEUR,
} from '../src/features/mockup-ia/moteur-mockup.js';

/* ── Fabriques ─────────────────────────────────────────────────────────────── */

const logoPng = { name: 'bacoref.png', type: 'image/png', size: 120_000 };

/** Logo en aplats : 3 teintes, ce que le flex sait faire. */
function pixelsAplats(nbCouleurs = 3, nbPixels = 400) {
  const d = [];
  for (let i = 0; i < nbPixels; i += 1) {
    const k = i % nbCouleurs;
    d.push(k * 80, 20, 200 - k * 60, 255);
  }
  return d;
}

/** Logo en degrade : une rampe continue, ce que le flex ne sait PAS faire. */
function pixelsDegrade(nbPixels = 600) {
  const d = [];
  for (let i = 0; i < nbPixels; i += 1) {
    const v = Math.floor((i / nbPixels) * 255);
    d.push(v, v, 255 - v, 255);
  }
  return d;
}

/** Demande valide de reference — chaque test n'en modifie qu'un champ. */
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

/* ═══════════════════════════════════════════════════════════════════════════
   1. LA PALETTE DOIT CORRESPONDRE AU STOCK REEL
   ═══════════════════════════════════════════════════════════════════════════ */

test('palette : Rouge, Jaune et Gris ne sont proposes sur AUCUN support', () => {
  const interdits = ['rouge', 'jaune', 'gris'];
  for (const s of SUPPORTS) {
    for (const c of s.coloris) {
      assert.ok(
        !interdits.includes(c.id),
        `« ${c.label} » propose sur ${s.label} alors qu'il n'est en stock nulle part`,
      );
    }
  }
});

test('palette : Rose, Violet et Orange sont bien proposes la ou ils existent', () => {
  const tshirt = trouverSupport('tshirt_adulte');
  const polo = trouverSupport('polo');
  assert.ok(tshirt.coloris.some((c) => c.id === 'rose'), 'rose absent du t-shirt (83 en stock)');
  assert.ok(tshirt.coloris.some((c) => c.id === 'violet'), 'violet absent du t-shirt (100 en stock)');
  assert.ok(polo.coloris.some((c) => c.id === 'orange'), 'orange absent du polo (68 en stock)');
});

test('palette : le violet existe en t-shirt et PAS en polo — la couleur appartient au support', () => {
  assert.ok(trouverColoris('tshirt_adulte', 'violet'));
  assert.equal(trouverColoris('polo', 'violet'), null);
});

test('catalogue : chaque coloris porte sa ligne d\'inventaire d\'origine', () => {
  for (const s of SUPPORTS) {
    for (const c of s.coloris) {
      assert.ok(c.source && c.source.length > 3, `${s.label}/${c.label} sans source d'inventaire`);
    }
  }
});

test('catalogue : les produits jamais vendus ont disparu de la liste', () => {
  const ids = SUPPORTS.map((s) => s.id).join(' ');
  for (const disparu of ['stylo', 'calendrier', 'enveloppe', 'cachet', 'porte_cle', 'kakemono', 'enseigne']) {
    assert.ok(!ids.includes(disparu), `« ${disparu} » est « A CHIFFRER » au catalogue : jamais vendu`);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. COULEUR HORS STOCK — CAS EXIGE
   ═══════════════════════════════════════════════════════════════════════════ */

test('couleur hors stock : refus, et le message dit ce qu\'on a REELLEMENT en rayon', () => {
  const r = validerDemandeMockup(demandeValide({ colorisId: 'rouge' }));
  assert.equal(r.ok, false);
  assert.equal(r.raison, 'coloris-hors-stock');
  assert.match(r.message, /rouge/i);
  // Le message doit lister les coloris disponibles, pas dire « couleur invalide ».
  assert.match(r.message, /Blanc/);
  assert.match(r.message, /Violet/);
});

test('couleur absente : refus, avec la liste du stock', () => {
  const r = validerDemandeMockup(demandeValide({ colorisId: '' }));
  assert.equal(r.ok, false);
  assert.equal(r.raison, 'coloris-hors-stock');
  assert.match(r.message, /Choisissez un coloris/);
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. LOGO ABSENT — CAS EXIGE
   ═══════════════════════════════════════════════════════════════════════════ */

test('logo absent : refus explicite, jamais un bouton gris muet', () => {
  const r = validerDemandeMockup(demandeValide({ fichierLogo: null }));
  assert.equal(r.ok, false);
  assert.equal(r.raison, 'absent');
  assert.ok(r.message.length > 20);
  assert.match(r.message, /logo/i);
});

test('logo vide (0 octet) : refus, avec la cause probable', () => {
  const r = validerFichierLogo({ name: 'logo.png', type: 'image/png', size: 0 });
  assert.equal(r.ok, false);
  assert.equal(r.raison, 'vide');
  assert.match(r.message, /transfert/i);
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. FORMAT DE LOGO INATTENDU — CAS EXIGE
   ═══════════════════════════════════════════════════════════════════════════ */

test('format inattendu (.cdr) : refus, le format recu est nomme et la consigne donnee', () => {
  const r = validerDemandeMockup(demandeValide({
    fichierLogo: { name: 'logo.cdr', type: 'application/octet-stream', size: 50_000 },
  }));
  assert.equal(r.ok, false);
  assert.equal(r.raison, 'format-inattendu');
  assert.match(r.message, /\.cdr/);
  assert.match(r.message, /PNG/);
});

test('format inattendu (.psd, .ai, .pdf, HEIC) : tous refuses avec consigne de conversion', () => {
  for (const nom of ['maquette.psd', 'logo.ai', 'charte.pdf', 'photo.heic']) {
    const r = validerFichierLogo({ name: nom, type: '', size: 10_000 });
    assert.equal(r.ok, false, `${nom} aurait du etre refuse`);
    assert.match(r.message, /PNG, JPG, WEBP, SVG/);
  }
});

test('formats acceptes : PNG, JPG, WEBP et SVG passent', () => {
  for (const f of [
    { name: 'a.png', type: 'image/png', size: 1000 },
    { name: 'b.jpg', type: 'image/jpeg', size: 1000 },
    { name: 'c.webp', type: 'image/webp', size: 1000 },
    { name: 'd.svg', type: 'image/svg+xml', size: 1000 },
  ]) {
    assert.equal(validerFichierLogo(f).ok, true, `${f.name} aurait du passer`);
  }
});

test('SVG : reconnu comme tel meme quand le type MIME manque', () => {
  const r = validerFichierLogo({ name: 'logo.svg', type: '', size: 4000 });
  assert.equal(r.ok, true);
  assert.equal(r.estSvg, true);
});

test('SVG avec <text> non vectorise : detecte (la police du poste remplacerait celle du logo)', () => {
  assert.equal(svgContientDuTexte('<svg><text x="0">BACOREF</text></svg>'), true);
  assert.equal(svgContientDuTexte('<svg><path d="M0 0"/></svg>'), false);
  assert.equal(svgContientDuTexte(null), false);
});

test('logo trop lourd : refus chiffre (10 Mo en base64 = 13,3 Mo, limite Vercel 4,5 Mo)', () => {
  const r = validerFichierLogo({ name: 'enorme.png', type: 'image/png', size: 12 * 1024 * 1024 });
  assert.equal(r.ok, false);
  assert.equal(r.raison, 'trop-lourd');
  assert.match(r.message, /Mo/);
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. PROMPT MODIFIE QUI PRIME — CAS EXIGE
   ═══════════════════════════════════════════════════════════════════════════ */

test('prompt modifie : c\'est lui, et lui seul, qui part au service IA', () => {
  const auto = validerDemandeMockup(demandeValide());
  const edite = validerDemandeMockup(demandeValide({ promptEdite: '  Un polo bleu sur fond blanc  ' }));
  assert.equal(edite.ok, true);
  assert.equal(edite.prompt, 'Un polo bleu sur fond blanc');
  assert.notEqual(edite.prompt, auto.prompt);
});

test('prompt efface : on bloque plutot que de renvoyer en douce le prompt automatique', () => {
  // Un champ vide n'est pas « pas de modification » : l'utilisateur paierait une
  // generation qu'il n'a pas relue.
  const r = validerDemandeMockup(demandeValide({ promptEdite: '   ' }));
  assert.equal(r.ok, false);
  assert.equal(r.raison, 'prompt-vide');
  assert.ok(r.message.length > 10);
});

test('prompt de scene : ne parle JAMAIS du logo, et exige un support vierge', () => {
  const p = construirePromptScene({ supportId: 'tshirt_adulte', colorisId: 'violet', angleId: 'face' });
  assert.doesNotMatch(p, /client|customer/i);
  assert.match(p, /no logo/i);
  assert.match(p, /no text/i);
  assert.match(p, /blank/i);
});

test('prompt de scene : les libelles francais ne partent plus bruts en anglais', () => {
  const p = construirePromptScene({ supportId: 'casquette', colorisId: 'a_confirmer' });
  // L'ancien prompt envoyait litteralement « A Casquette in Rouge color ».
  assert.doesNotMatch(p, /Casquette/);
  assert.match(p, /baseball cap/);
});

test('prompt de scene : support inconnu → chaine vide, jamais une phrase bancale', () => {
  assert.equal(construirePromptScene({ supportId: 'licorne', colorisId: 'blanc' }), '');
});

/* ═══════════════════════════════════════════════════════════════════════════
   6. REPONSE API SANS IMAGE — CAS EXIGE
   ═══════════════════════════════════════════════════════════════════════════ */

test('reponse API sans image : echec explicite, jamais un cadre blanc', () => {
  const r = extraireScene({ modele: 'gpt-image-2.5-sunburst', qualite: 'medium' });
  assert.equal(r.ok, false);
  assert.equal(r.image, null);
  assert.match(r.message, /sans image/i);
});

test('reponse API avec image : la data URL est extraite telle quelle', () => {
  const r = extraireScene({ imageBase64: 'data:image/png;base64,AAAA' });
  assert.equal(r.ok, true);
  assert.equal(r.image, 'data:image/png;base64,AAAA');
});

test('reponse API illisible : echec avec message, jamais une exception', () => {
  for (const corps of [null, undefined, 'texte brut', 42]) {
    const r = extraireScene(corps);
    assert.equal(r.ok, false);
    assert.ok(r.message.length > 0);
  }
});

test('erreur API : le message REEL est remonte, jamais un message opaque', () => {
  const m = extraireMessageErreur(
    { status: 404 },
    { error: { message: 'The model `gpt-image-1` has been deprecated' } },
  );
  assert.match(m, /deprecated/);
});

test('erreur API sans corps lisible : on dit au moins le code HTTP', () => {
  assert.match(extraireMessageErreur({ status: 502 }, null), /502/);
});

test('erreur API sans code ni corps : message explicite, jamais vide', () => {
  assert.ok(extraireMessageErreur({}, null).length > 10);
});

/* ═══════════════════════════════════════════════════════════════════════════
   7. DOUBLE-CLIC — CAS EXIGE
   ═══════════════════════════════════════════════════════════════════════════ */

test('double-clic : refus immediat, et le message rappelle que c\'est FACTURE', () => {
  const r = validerDemandeMockup(demandeValide({ enCours: true }));
  assert.equal(r.ok, false);
  assert.equal(r.raison, 'en-cours');
  assert.match(r.message, /factur/i);
});

test('double-clic : le verrou passe AVANT tous les autres controles', () => {
  // Meme une demande par ailleurs invalide doit d'abord dire « en cours » :
  // sinon un second clic pendant un appel en vol declencherait un second appel
  // des que le formulaire redevient valide.
  const r = validerDemandeMockup({ enCours: true });
  assert.equal(r.raison, 'en-cours');
});

test('cout : affiche par generation, et nul quand la scene vient d\'une photo reelle', () => {
  const ia = validerDemandeMockup(demandeValide());
  assert.equal(ia.scene, 'ia');
  assert.equal(ia.cout, coutGeneration('medium'));
  assert.ok(ia.cout > 0);

  const photo = validerDemandeMockup(demandeValide({ sceneExistante: 'blob:tshirt-blanc-face' }));
  assert.equal(photo.scene, 'photo');
  assert.equal(photo.cout, 0);
});

test('plafond : atteint → refus chiffre ; la photo reelle reste utilisable', () => {
  const p = verifierPlafond({ compteur: PLAFOND_GENERATIONS_PAR_JOUR });
  assert.equal(p.ok, false);
  assert.match(p.message, new RegExp(String(PLAFOND_GENERATIONS_PAR_JOUR)));

  const refuse = validerDemandeMockup(demandeValide({ compteurDuJour: PLAFOND_GENERATIONS_PAR_JOUR }));
  assert.equal(refuse.ok, false);
  assert.equal(refuse.raison, 'plafond');

  // Sans IA, pas de plafond : une photo du support ne coute rien.
  const gratuit = validerDemandeMockup(demandeValide({
    compteurDuJour: PLAFOND_GENERATIONS_PAR_JOUR,
    sceneExistante: 'blob:photo',
  }));
  assert.equal(gratuit.ok, true);
});

test('plafond : le restant est correct et jamais negatif', () => {
  assert.equal(verifierPlafond({ compteur: 3, plafond: 20 }).restant, 17);
  assert.equal(verifierPlafond({ compteur: 99, plafond: 20 }).restant, 0);
  assert.equal(verifierPlafond({ compteur: -5, plafond: 20 }).restant, 20);
});

/* ═══════════════════════════════════════════════════════════════════════════
   8. TECHNIQUE HORS DE PORTEE DE L'ATELIER — NOTE, PAS REFUS
   ═══════════════════════════════════════════════════════════════════════════

   ⚠️ CE BLOC A CHANGE DE CONTRAT LE 17/09/2026, sur demande du gerant.

   Le constat technique reste mesure et affiche mot pour mot — c'est lui qui
   evite la promesse intenable. Ce qui change, c'est sa consequence : il ne
   REFUSE plus l'apercu. Un mockup est un document commercial montre au client
   avant que la technique soit arretee ; c'est meme lui qui sert a dire « en
   flex ca ne passe pas, on part sur du transfert ».

   La frontiere complete (ce qui bloque encore vs ce qui informe) est tenue par
   `tests/mockup-apercu-commercial.test.mjs`.
   ═══════════════════════════════════════════════════════════════════════════ */

test('flex + degrade : NOTE technique conservee, avec la raison physique et l\'alternative', () => {
  const r = validerDemandeMockup(demandeValide({
    techniqueId: 'flex',
    analyseLogo: analyserPixelsLogo(pixelsDegrade()),
  }));
  assert.equal(r.ok, true, 'un verdict d\'atelier ne refuse plus un apercu commercial');
  const note = r.faisabilite.reserves.find((x) => x.code === 'flex-degrade');
  assert.ok(note, 'la note sur le degrade a disparu — elle doit rester visible');
  assert.match(note.message, /flex/i);
  assert.match(note.alternative, /transfert/i);
});

test('flex + photo : NOTE technique, l\'apercu reste possible', () => {
  // 200 teintes distinctes : une photo.
  const r = verifierFaisabilite({
    supportId: 'tshirt_adulte', colorisId: 'blanc', techniqueId: 'flex',
    analyseLogo: { nbCouleurs: 200, aDegrade: true, estPhoto: true },
  });
  assert.equal(r.ok, false, 'l\'atelier ne sait pas le produire tel quel : ca, ca ne change pas');
  assert.equal(r.apercuPossible, true, 'mais l\'apercu, lui, doit rester possible');
  assert.equal(r.reserves[0].code, 'flex-photo');
});

test('sublimation + support sombre : NOTE technique avec la raison physique', () => {
  const r = validerDemandeMockup(demandeValide({
    colorisId: 'noir',
    techniqueId: 'sublimation',
  }));
  assert.equal(r.ok, true, 'le client doit pouvoir voir son t-shirt noir avant d\'arbitrer');
  const note = r.faisabilite.reserves.find((x) => x.code === 'sublimation-support-sombre');
  assert.ok(note);
  assert.match(note.message, /sombre/i);
  assert.match(note.alternative, /dark/i);
});

test('sublimation + support clair : autorisee', () => {
  const r = verifierFaisabilite({
    supportId: 'tshirt_adulte', colorisId: 'blanc', techniqueId: 'sublimation',
    analyseLogo: analyserPixelsLogo(pixelsDegrade()),
  });
  assert.equal(r.ok, true);
});

test('tasse magique : derogation documentee, la sublimation reste possible sur le noir thermo', () => {
  const r = verifierFaisabilite({
    supportId: 'tasse_magique', colorisId: 'noir_thermo', techniqueId: 'sublimation',
  });
  assert.equal(r.ok, true, 'le revetement thermosensible est concu pour la sublimation');
});

test('technique hors du perimetre du support : note nommee, avec ce qui est possible', () => {
  const r = verifierFaisabilite({
    supportId: 'tasse_simple', colorisId: 'blanc', techniqueId: 'flex',
  });
  assert.equal(r.ok, false, 'l\'atelier ne fait pas de flex sur une tasse : le constat reste');
  assert.equal(r.apercuPossible, true, 'l\'apercu, lui, reste possible');
  assert.equal(r.reserves[0].code, 'technique-hors-support');
  assert.match(r.reserves[0].alternative, /Sublimation/i);
});

test('detail sous le seuil physique : avertissement chiffre, pas un blocage', () => {
  // Logo de 1000 px rendu en 9 cm ; un detail de 1 px mesure 0,09 mm.
  const r = verifierFaisabilite({
    supportId: 'tshirt_adulte', colorisId: 'blanc', techniqueId: 'flex',
    analyseLogo: analyserPixelsLogo(pixelsAplats(2)),
    largeurImpressionCm: 9, largeurLogoPx: 1000, detailMinPx: 1,
  });
  assert.equal(r.ok, true, 'un detail fin ne doit pas bloquer la vente');
  const a = r.avertissements.find((x) => x.code === 'detail-trop-fin');
  assert.ok(a, 'avertissement 2 mm manquant');
  assert.match(a.message, /mm/);
  assert.match(a.message, /chenillage/i);
});

test('coloris non documente (casquette) : avertissement, jamais presente comme un fait', () => {
  const r = verifierFaisabilite({
    supportId: 'casquette', colorisId: 'a_confirmer', techniqueId: 'flex',
  });
  assert.equal(r.ok, true);
  assert.ok(r.avertissements.some((a) => a.code === 'coloris-a-confirmer'));
});

/* ═══════════════════════════════════════════════════════════════════════════
   9. DEFINITION DU FICHIER CLIENT
   ═══════════════════════════════════════════════════════════════════════════ */

test('definition : sous 150 px/pouce, avertissement chiffre avec la phrase a dire au client', () => {
  const r = verifierDefinition({ largeurLogoPx: 240, largeurImpressionCm: 9 });
  assert.equal(r.ok, false);
  assert.match(r.message, /240 px/);
  assert.match(r.message, /flou/i);
  assert.match(r.message, /fichier d'origine/i);
});

test('definition : au-dessus du seuil, aucun bruit', () => {
  const r = verifierDefinition({ largeurLogoPx: 1200, largeurImpressionCm: 9 });
  assert.equal(r.ok, true);
  assert.equal(r.message, '');
  assert.ok(r.dpi > 150);
});

test('definition : entrees manquantes → on se tait plutot que d\'inventer', () => {
  assert.equal(verifierDefinition({}).ok, true);
  assert.equal(verifierDefinition({ largeurLogoPx: 0, largeurImpressionCm: 9 }).message, '');
});

/* ═══════════════════════════════════════════════════════════════════════════
   10. ANALYSE DES PIXELS
   ═══════════════════════════════════════════════════════════════════════════ */

test('analyse : des aplats restent des aplats', () => {
  const a = analyserPixelsLogo(pixelsAplats(3));
  assert.equal(a.nbCouleurs, 3);
  assert.equal(a.aDegrade, false);
  assert.equal(a.estPhoto, false);
});

test('analyse : un degrade est detecte', () => {
  const a = analyserPixelsLogo(pixelsDegrade());
  assert.equal(a.aDegrade, true);
});

test('analyse : les pixels transparents ne comptent pas comme des couleurs', () => {
  const d = [255, 0, 0, 255, 10, 10, 10, 0, 20, 20, 20, 5];
  const a = analyserPixelsLogo(d);
  assert.equal(a.nbCouleurs, 1);
  assert.ok(a.ratioOpaque < 0.5);
});

test('analyse : entree absente ou trop courte → resultat neutre, jamais une exception', () => {
  for (const e of [null, undefined, [], [1, 2], 'x']) {
    const a = analyserPixelsLogo(e);
    assert.equal(a.nbCouleurs, 0);
    assert.equal(a.aDegrade, false);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   11. LA RECETTE — aucune image ne va jamais dans app_data
   ═══════════════════════════════════════════════════════════════════════════ */

test('recette : construite, legere, et versionnee', () => {
  const r = construireRecette({
    supportId: 'tshirt_adulte', colorisId: 'violet', angleId: 'face',
    techniqueId: 'flex', zoneId: 'poitrine_gauche',
    position: { x: 0.635, y: 0.325, largeur: 0.16, rotation: 0 },
    tailleReelleCm: { l: 9, h: 6.2 },
    logoRef: 'logos-clients/2026/bacoref-v2.png',
    clientNom: 'BACOREF', documentType: 'devis', documentNumero: 'DEV-2026-093',
    coutFcfa: 71, creeLe: '2026-09-15',
  });
  assert.equal(r.ok, true);
  assert.equal(r.recette.moteur_version, VERSION_MOTEUR);
  assert.equal(r.recette.coloris, 'violet');
  assert.equal(r.recette.taille_reelle_cm.l, 9);
  // ~450 octets attendus ; le plafond est a 2 000.
  assert.ok(r.octets < TAILLE_RECETTE_MAX_OCTETS, `recette de ${r.octets} octets`);
  assert.ok(r.octets < 800, `recette de ${r.octets} octets — anormalement lourde`);
});

test('recette : incomplete → rien n\'est enregistre, et on dit pourquoi', () => {
  const r = construireRecette({ supportId: 'tshirt_adulte' });
  assert.equal(r.ok, false);
  assert.equal(r.recette, null);
  assert.match(r.message, /obligatoires/);
});

test('recette : une image base64 glissee dedans est REFUSEE a l\'ecriture', () => {
  // C'est la barriere du §6.1 : db.list() retelecharge toute la colonne `data`
  // a chaque ouverture d'ecran. Une image dans un devis rend l'ecran Devis
  // inutilisable depuis Moanda.
  const r = recetteSansImage({
    support: 'tshirt_adulte',
    apercu: `data:image/jpeg;base64,${'A'.repeat(50)}`,
  });
  assert.equal(r.ok, false);
  assert.match(r.message, /apercu/);
  assert.match(r.message, /base64/i);
});

test('recette : un champ texte anormalement long est refuse lui aussi', () => {
  const r = recetteSansImage({ support: 'tshirt_adulte', note: 'x'.repeat(700) });
  assert.equal(r.ok, false);
  assert.match(r.message, /trop long/);
});

test('recette : une recette propre passe la barriere', () => {
  const { recette } = construireRecette({
    supportId: 'polo', colorisId: 'orange', zoneId: 'dos', techniqueId: 'transfert',
  });
  assert.equal(recetteSansImage(recette).ok, true);
});

/* ═══════════════════════════════════════════════════════════════════════════
   12. VALIDATION / REJET — un mockup rejete n'est JAMAIS enregistre
   ═══════════════════════════════════════════════════════════════════════════ */

test('rejet explicite : rien n\'est enregistre, rien n\'est rattache', () => {
  const r = deciderEnregistrement('rejete');
  assert.equal(r.enregistrer, false);
  assert.match(r.message, /rien n'a ete enregistre/i);
});

test('aucune decision : rien n\'est enregistre non plus', () => {
  for (const d of [null, undefined, '', 'peut-etre']) {
    const r = deciderEnregistrement(d);
    assert.equal(r.enregistrer, false);
    assert.ok(r.message.length > 10);
  }
});

test('validation explicite : l\'enregistrement est autorise', () => {
  assert.equal(deciderEnregistrement('valide').enregistrer, true);
});

/* ═══════════════════════════════════════════════════════════════════════════
   13. INVARIANTS GENERAUX
   ═══════════════════════════════════════════════════════════════════════════ */

test('INVARIANT : tout refus porte un message non vide — aucun bouton gris muet', () => {
  const refus = [
    validerDemandeMockup({}),
    validerDemandeMockup({ supportId: 'tshirt_adulte' }),
    validerDemandeMockup({ supportId: 'tshirt_adulte', colorisId: 'blanc' }),
    validerDemandeMockup(demandeValide({ colorisId: 'rouge' })),
    validerDemandeMockup(demandeValide({ zoneId: '' })),
    validerDemandeMockup(demandeValide({ fichierLogo: null })),
    validerDemandeMockup(demandeValide({ fichierLogo: { name: 'x.cdr', type: '', size: 10 } })),
    // ⚠️ `sublimation + noir` a quitte cette liste le 17/09/2026 : ce n'est
    // plus un refus, c'est une note technique. Le cas est couvert par
    // `tests/mockup-apercu-commercial.test.mjs`.
    validerDemandeMockup(demandeValide({ enCours: true })),
    validerDemandeMockup(demandeValide({ compteurDuJour: 999 })),
    validerDemandeMockup(demandeValide({ promptEdite: '' })),
  ];
  for (const r of refus) {
    assert.equal(r.ok, false);
    assert.ok(typeof r.message === 'string' && r.message.trim().length >= 20,
      `refus « ${r.raison} » sans message exploitable : « ${r.message} »`);
    assert.ok(r.raison, 'refus sans code de raison');
  }
});

test('INVARIANT : une demande complete et faisable passe', () => {
  const r = validerDemandeMockup(demandeValide());
  assert.equal(r.ok, true);
  assert.equal(r.message, '');
  assert.ok(r.prompt.length > 50);
});

test('INVARIANT : aucune entree, meme absurde, ne leve d\'exception', () => {
  const absurdes = [
    undefined, null, {}, { supportId: 42 }, { supportId: 'tshirt_adulte', colorisId: {} },
    { fichierLogo: 'pas un fichier' }, { analyseLogo: 'x', largeurLogoPx: NaN },
  ];
  for (const e of absurdes) {
    assert.doesNotThrow(() => validerDemandeMockup(e), `entree ${JSON.stringify(e)}`);
    assert.doesNotThrow(() => verifierFaisabilite(e || {}));
    assert.doesNotThrow(() => construireRecette(e || {}));
  }
});

test('mention de reserve : presente, explicite, et parle de simulation', () => {
  assert.match(MENTION_RESERVE, /indicatif/i);
  assert.match(MENTION_RESERVE, /simulation/i);
  assert.match(MENTION_RESERVE, /nuancier/i);
});

test('formatFCFA : lisible, en francs, sans decimale', () => {
  assert.equal(formatFCFA(0), '0 F');
  assert.match(formatFCFA(71), /71 F/);
  assert.doesNotMatch(formatFCFA(1420), /\./);
});
