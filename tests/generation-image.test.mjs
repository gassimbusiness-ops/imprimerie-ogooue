/**
 * Tests — generation d'image IA depuis la fiche produit du catalogue.
 *
 * Demande d'origine (gerant de l'imprimerie) :
 *   « Catalogue : possibilite de generer une image IA du produit et directement
 *     dans la fiche produit. »
 *
 * Trois pieges couverts ici :
 *  1. CHAQUE generation est FACTUREE. On ne lance jamais sur un prompt que
 *     l'utilisateur n'a pas vu, et le prompt qu'il a modifie prime toujours.
 *  2. Un bouton grise doit TOUJOURS dire pourquoi (cf. l'ecran Mockups IA, ou
 *     le bouton reste gris sans explication). validerDemandeGeneration renvoie
 *     donc systematiquement un `message` non vide quand ok === false.
 *  3. Les images sont stockees en base64 dans app_data.data (JSONB, Supabase
 *     plan gratuit 500 Mo). Au-dela du plafond, l'image n'est PAS enregistree.
 *
 * AUCUN appel reseau ici : la reponse de l'API est simulee.
 *
 * Lancer :  node --test tests/generation-image.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  construirePromptProduit,
  validerDemandeGeneration,
  deciderEnregistrement,
  tailleBase64Octets,
  formaterOctets,
  extraireMessageErreur,
  extraireImage,
  LIMITE_IMAGE_OCTETS,
  LONGUEUR_PROMPT_MAX,
} from '../src/features/catalogue/generation-image.js';

/* ── Fabrique une data URL base64 d'une taille donnee (approximative) ── */
function imageFactice(octets, mime = 'image/jpeg') {
  const caracteres = Math.ceil((octets * 4) / 3);
  return `data:${mime};base64,${'A'.repeat(caracteres)}`;
}

/* ══════════════════════════════════════════════════════════════════════
   1. Fiche complete — tous les champs utiles nourrissent le prompt
   ══════════════════════════════════════════════════════════════════════ */
test('fiche complete : nom, categorie, matiere et description entrent dans le prompt', () => {
  const prompt = construirePromptProduit({
    nom: 'T-shirt col rond',
    categorie: 'Textile',
    matiere: 'coton bio 180 g/m2',
    description: 'impression serigraphie 2 couleurs',
    details_techniques: 'tailles S a XXL',
  });

  assert.match(prompt, /T-shirt col rond/);
  assert.match(prompt, /categorie Textile/);
  assert.match(prompt, /coton bio 180 g\/m2/);
  assert.match(prompt, /serigraphie/);
  assert.match(prompt, /tailles S a XXL/);
  // Le nom reste en tete : c'est le sujet de la photo.
  assert.ok(prompt.startsWith('T-shirt col rond'));
});

test('fiche complete : la demande est autorisee et porte le prompt construit', () => {
  const fiche = { nom: 'Mug ceramique', categorie: 'Accessoire', matiere: 'ceramique blanche' };
  const v = validerDemandeGeneration({ fiche, images: [] });

  assert.equal(v.ok, true);
  assert.equal(v.raison, null);
  assert.equal(v.message, '');
  assert.equal(v.prompt, construirePromptProduit(fiche));
});

/* ══════════════════════════════════════════════════════════════════════
   2. Fiche minimale — le nom seul suffit
   ══════════════════════════════════════════════════════════════════════ */
test('fiche minimale : le nom seul suffit a construire un prompt', () => {
  const prompt = construirePromptProduit({ nom: 'Banderole' });
  assert.equal(prompt, 'Banderole');
});

test('fiche minimale : la generation est autorisee', () => {
  const v = validerDemandeGeneration({ fiche: { nom: 'Banderole' } });
  assert.equal(v.ok, true);
  assert.equal(v.prompt, 'Banderole');
});

test('fiche minimale : les champs vides ou absents ne laissent pas de virgules orphelines', () => {
  const prompt = construirePromptProduit({
    nom: 'Flyer A5',
    categorie: '',
    description: '   ',
    matiere: null,
    details_techniques: undefined,
  });
  assert.equal(prompt, 'Flyer A5');
  assert.ok(!prompt.includes(',,'));
  assert.ok(!prompt.trim().endsWith(','));
});

/* ══════════════════════════════════════════════════════════════════════
   3. Nom vide — refus, avec une raison lisible
   ══════════════════════════════════════════════════════════════════════ */
test('nom vide : aucun prompt n\'est construit', () => {
  assert.equal(construirePromptProduit({ nom: '' }), '');
  assert.equal(construirePromptProduit({ nom: '   ' }), '');
  assert.equal(construirePromptProduit({}), '');
  assert.equal(construirePromptProduit({ nom: null, categorie: 'Textile' }), '');
});

test('nom vide : la generation est refusee AVEC une explication affichable', () => {
  const v = validerDemandeGeneration({ fiche: { nom: '  ', categorie: 'Textile' } });

  assert.equal(v.ok, false);
  assert.equal(v.raison, 'nom-vide');
  // Le piege « bouton gris sans explication » : le message ne doit jamais etre vide.
  assert.ok(v.message.length > 0, 'un refus doit toujours porter un message');
  assert.match(v.message, /nom du produit/i);
});

test('tout refus porte un message non vide (aucun bouton gris muet)', () => {
  const cas = [
    { fiche: { nom: '' } },
    { fiche: { nom: 'Mug' }, enCours: true },
    { fiche: { nom: 'Mug' }, images: ['a', 'b', 'c', 'd', 'e'], maxImages: 5 },
    { fiche: { nom: 'Mug' }, promptEdite: '   ' , images: [] },
  ];
  for (const params of cas) {
    const v = validerDemandeGeneration(params);
    if (!v.ok) {
      assert.ok(v.raison, `raison manquante pour ${JSON.stringify(params)}`);
      assert.ok(v.message.length > 0, `message manquant pour ${JSON.stringify(params)}`);
    }
  }
});

test('generation deja en vol : refus explicite (protection anti double-clic)', () => {
  const v = validerDemandeGeneration({ fiche: { nom: 'Mug' }, enCours: true });
  assert.equal(v.ok, false);
  assert.equal(v.raison, 'en-cours');
  assert.match(v.message, /facturee/i);
});

test('quota d\'images atteint : refus explicite avec le plafond', () => {
  const v = validerDemandeGeneration({
    fiche: { nom: 'Mug' },
    images: ['a', 'b', 'c', 'd', 'e'],
    maxImages: 5,
  });
  assert.equal(v.ok, false);
  assert.equal(v.raison, 'max-images');
  assert.match(v.message, /5 images/);
});

/* ══════════════════════════════════════════════════════════════════════
   4. Caracteres speciaux et accents
   ══════════════════════════════════════════════════════════════════════ */
test('accents et caracteres speciaux : conserves tels quels dans le prompt', () => {
  const prompt = construirePromptProduit({
    nom: 'Tête de gondole « Élégance »',
    categorie: 'Signalétique',
    matiere: 'PVC 3 mm — finition mate',
  });

  assert.match(prompt, /Tête de gondole « Élégance »/);
  assert.match(prompt, /Signalétique/);
  assert.match(prompt, /PVC 3 mm — finition mate/);
});

test('accents : le nom accentue n\'est pas confondu avec un nom vide', () => {
  const v = validerDemandeGeneration({ fiche: { nom: 'Éventail publicitaire' } });
  assert.equal(v.ok, true);
  assert.equal(v.prompt, 'Éventail publicitaire');
});

test('espaces, retours a la ligne et tabulations sont normalises', () => {
  const prompt = construirePromptProduit({
    nom: '  Carte   de\tvisite\n\npelliculee  ',
    categorie: 'Papeterie',
  });
  assert.equal(prompt, 'Carte de visite pelliculee, categorie Papeterie');
});

test('emoji et guillemets ne cassent pas la construction', () => {
  const prompt = construirePromptProduit({ nom: 'Sac "tote bag" 🇬🇦', categorie: 'Textile' });
  assert.match(prompt, /Sac "tote bag" 🇬🇦/);
  assert.match(prompt, /categorie Textile/);
});

test('un champ demesurement long est tronque sous la limite de prompt', () => {
  const prompt = construirePromptProduit({
    nom: 'Bache',
    description: 'détail '.repeat(400),
  });
  assert.ok(
    prompt.length <= LONGUEUR_PROMPT_MAX,
    `prompt de ${prompt.length} caracteres, limite ${LONGUEUR_PROMPT_MAX}`,
  );
  assert.ok(prompt.startsWith('Bache'));
});

/* ══════════════════════════════════════════════════════════════════════
   5. Le prompt modifie par l'utilisateur prime sur le prompt genere
   ══════════════════════════════════════════════════════════════════════ */
test('prompt modifie : c\'est celui de l\'utilisateur qui part au service IA', () => {
  const fiche = { nom: 'Mug ceramique', categorie: 'Accessoire', matiere: 'ceramique' };
  const v = validerDemandeGeneration({
    fiche,
    promptEdite: 'Mug noir mat, anse epaisse, vu de trois quarts',
  });

  assert.equal(v.ok, true);
  assert.equal(v.prompt, 'Mug noir mat, anse epaisse, vu de trois quarts');
  assert.notEqual(v.prompt, construirePromptProduit(fiche));
});

test('prompt modifie : retomber sur le prompt auto si l\'utilisateur n\'a rien touche', () => {
  const fiche = { nom: 'Mug ceramique', categorie: 'Accessoire' };
  assert.equal(
    validerDemandeGeneration({ fiche, promptEdite: undefined }).prompt,
    construirePromptProduit(fiche),
  );
  assert.equal(
    validerDemandeGeneration({ fiche, promptEdite: null }).prompt,
    construirePromptProduit(fiche),
  );
});

test('prompt modifie : un prompt vide bloque la generation plutot que de partir sur le prompt auto', () => {
  const v = validerDemandeGeneration({ fiche: { nom: 'Mug' }, promptEdite: '   ' });
  assert.equal(v.ok, false);
  assert.equal(v.raison, 'prompt-vide');
  assert.ok(v.message.length > 0);
});

test('prompt modifie : les accents saisis par l\'utilisateur sont preserves', () => {
  const v = validerDemandeGeneration({
    fiche: { nom: 'Bâche' },
    promptEdite: 'Bâche PVC 440 g, œillets métalliques, éclairage studio',
  });
  assert.equal(v.ok, true);
  assert.equal(v.prompt, 'Bâche PVC 440 g, œillets métalliques, éclairage studio');
});

/* ══════════════════════════════════════════════════════════════════════
   6. Taille de l'image — refus d'enregistrement au-dela du seuil
   ══════════════════════════════════════════════════════════════════════ */
test('taille base64 : calcul exact, padding compris', () => {
  // 'QUJD' = base64 de 'ABC' -> 3 octets
  assert.equal(tailleBase64Octets('data:image/png;base64,QUJD'), 3);
  // 'QUI=' = base64 de 'AB' -> 2 octets
  assert.equal(tailleBase64Octets('data:image/png;base64,QUI='), 2);
  // 'QQ==' = base64 de 'A' -> 1 octet
  assert.equal(tailleBase64Octets('data:image/png;base64,QQ=='), 1);
  assert.equal(tailleBase64Octets(''), 0);
  assert.equal(tailleBase64Octets(null), 0);
  assert.equal(tailleBase64Octets(undefined), 0);
});

test('image compressee sous le seuil : enregistrement autorise', () => {
  const image = imageFactice(80_000); // ordre de grandeur d'une photo compressee 600 px
  const d = deciderEnregistrement(image);

  assert.equal(d.ok, true);
  assert.equal(d.message, '');
  assert.ok(Math.abs(d.octets - 80_000) < 4, `octets=${d.octets}`);
});

test('image au-dela du seuil : enregistrement REFUSE avec un message chiffre', () => {
  // Ordre de grandeur d'une image gpt-image-1 1024x1024 non compressee.
  const image = imageFactice(2_400_000, 'image/png');
  const d = deciderEnregistrement(image);

  assert.equal(d.ok, false, 'une image de 2.4 Mo ne doit jamais partir en base');
  assert.ok(d.octets > LIMITE_IMAGE_OCTETS);
  assert.ok(d.message.length > 0);
  assert.match(d.message, /trop lourde/i);
  assert.match(d.message, /2\.3 Mo|2\.4 Mo/); // la taille reelle est dans le message
  assert.match(d.message, /391 Ko|400 Ko/);   // le plafond aussi
});

test('seuil : la frontiere exacte passe, un octet de plus est refuse', () => {
  const juste = imageFactice(LIMITE_IMAGE_OCTETS);
  assert.equal(deciderEnregistrement(juste).ok, true);

  const trop = imageFactice(LIMITE_IMAGE_OCTETS + 4_000);
  assert.equal(deciderEnregistrement(trop).ok, false);
});

test('seuil personnalise : respecte', () => {
  const image = imageFactice(50_000);
  assert.equal(deciderEnregistrement(image, 100_000).ok, true);
  assert.equal(deciderEnregistrement(image, 10_000).ok, false);
});

test('entree invalide : refus explicite plutot qu\'un enregistrement silencieux', () => {
  for (const mauvais of [null, undefined, '', 'pas-une-image', 'https://exemple.com/a.png', 42]) {
    const d = deciderEnregistrement(mauvais);
    assert.equal(d.ok, false, `${String(mauvais)} ne doit pas etre enregistrable`);
    assert.ok(d.message.length > 0);
  }
});

test('image vide : refus', () => {
  const d = deciderEnregistrement('data:image/png;base64,');
  assert.equal(d.ok, false);
  assert.match(d.message, /vide/i);
});

test('formaterOctets : lisible en Ko puis en Mo', () => {
  assert.equal(formaterOctets(0), '0 Ko');
  assert.equal(formaterOctets(-10), '0 Ko');
  assert.equal(formaterOctets(80_000), '78 Ko');
  assert.equal(formaterOctets(2_400_000), '2.3 Mo');
});

/* ══════════════════════════════════════════════════════════════════════
   7. Lecture de la reponse API (simulee — aucun appel reseau)
   ══════════════════════════════════════════════════════════════════════ */
test('reponse OK : la data URL base64 est extraite', () => {
  const corps = { imageBase64: 'data:image/png;base64,QUJD', url: null };
  assert.equal(extraireImage(corps), 'data:image/png;base64,QUJD');
});

test('reponse sans image : rien n\'est extrait (pas de faux positif)', () => {
  assert.equal(extraireImage({ imageBase64: null, url: null }), null);
  assert.equal(extraireImage({}), null);
  assert.equal(extraireImage(null), null);
  // Le bug d'origine : gpt-image-1 ne renvoie jamais d'URL, l'ancien code
  // affichait « Image generee ! » avec url = null et n'affichait rien.
  assert.equal(extraireImage({ url: null }), null);
});

test('erreur API : le message REEL est remonte, jamais un message opaque', () => {
  assert.equal(
    extraireMessageErreur({ ok: false, status: 500 }, { error: 'Your organization must be verified to use gpt-image-1' }),
    'Your organization must be verified to use gpt-image-1',
  );
  assert.equal(
    extraireMessageErreur({ ok: false, status: 400 }, { error: { message: 'Invalid prompt' } }),
    'Invalid prompt',
  );
});

test('erreur API sans corps lisible : on dit au moins le code HTTP', () => {
  const message = extraireMessageErreur({ ok: false, status: 502 }, null);
  assert.match(message, /502/);
  assert.ok(!/une erreur est survenue/i.test(message));
});

test('erreur API sans code ni corps : message explicite, jamais vide', () => {
  const message = extraireMessageErreur({}, null);
  assert.ok(message.length > 0);
  assert.match(message, /service IA/i);
});
