/**
 * LES PHOTOS DU CATALOGUE — lire les deux formes, ne plus recopier la lourde.
 *
 * ── Ce qui a été mesuré le 18/09/2026 (bcwkrrqmjpaohmafcncw, lecture seule) ──
 *
 *   produits_catalogue ......................... 195 lignes, 20 634 952 o
 *     lignes portant un champ `images` .........  17
 *     photos au total ..........................  20
 *       · vraies data-URL base64 ...............  19
 *       · une URL https déjà externe ...........   1  (DALL·E, signée, expirée)
 *     poids des 17 lignes ...................... 20 574 780 o = 99,71 %
 *   Réponse RÉELLEMENT servie aux 9 écrans ..... 20 629 118 o
 *   La même, photos remplacées par des URL .....     69 737 o   → 295,8 fois moins
 *
 * ── Le dégât qui se propage ──────────────────────────────────────────────
 *
 *   `src/features/client-portal/catalogue.jsx` recopie `p.images[0]` — la
 *   data-URL ENTIÈRE — dans chaque ligne de commande. Relevé en base :
 *   les 5 commandes du portail portent 163 117 octets de base64 recopié.
 *   Chaque commande passée depuis le portail duplique donc une photo, pour
 *   toujours, dans une collection que sept écrans relisent.
 *
 *   Ce test-là ÉCHOUE sur le code d'avant. C'est le seul qui prouve quelque
 *   chose : les autres décrivent le contrat du nouveau module.
 *
 * Lancer :  node --test tests/photos-catalogue.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rendreEcran, texteVivant } from './outils/rendu-ecran.mjs';
import {
  estPhotoBase64, estPhotoDistante, photosDuProduit, photoPrincipale,
  referencePhotoLegere, avancementMigrationPhotos, PLAFOND_PHOTO_RECOPIEE,
} from '../src/services/photos-catalogue.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Données aux formes RÉELLES de la production
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Une data-URL LOURDE, au sens de `PLAFOND_PHOTO_RECOPIEE` (200 000 c.).
 *
 * La vraie « Enveloppe invitation » pèse 1 596 858 caractères. On n'en met pas
 * autant ici : ce jeu de données est sérialisé dans le module compilé par le
 * harnais, et trois cent mille caractères suffisent à dépasser le plafond
 * — donc à faire échouer le test sur le code d'avant, ce qui a été vérifié.
 * Y coller 1,6 Mo ne prouverait rien de plus et alourdirait chaque compilation.
 */
const BASE64_LOURDE = 'data:image/png;base64,' + 'A'.repeat(300_000);
/** Une data-URL légère, à l'échelle de « Polo blanc » (12 727 c.). */
const BASE64_LEGERE = 'data:image/jpeg;base64,' + 'B'.repeat(12_700);
/** La forme d'APRÈS la migration. */
const URL_STORAGE = 'https://bcwkrrqmjpaohmafcncw.supabase.co/storage/v1/object/public/catalogue/801cafdc-0.png';
/**
 * La 20ᵉ photo, déjà en base : une URL DALL·E signée. Ces URL expirent en
 * quelques heures — celle-ci est morte depuis longtemps, et l'image est donc
 * cassée à l'écran aujourd'hui. On la reconnaît comme distante, ce qui est
 * exact ; la migration ne peut pas la rapatrier, et le dit.
 */
const URL_DALLE_EXPIREE = 'https://oaidalleapiprodscus.blob.core.windows.net/private/org-x/img.png?se=2026-06-01';

/* ═══════════════════════════════════════════════════════════════════════════
   1. LE DÉGÂT QUI SE PROPAGE — la photo recopiée dans la commande
   ═══════════════════════════════════════════════════════════════════════════ */

function boutons(v) {
  return [...v.conteneur.ownerDocument.body.querySelectorAll('button')];
}
function bouton(v, motif) {
  return boutons(v).find((b) => motif.test(b.textContent || '')) || null;
}
async function vidanger(v, tours = 6) {
  for (let i = 0; i < tours; i++) {
    await v.act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}

test('commander depuis le portail ne recopie pas la photo dans la commande', async () => {
  const v = await rendreEcran({
    ecran: 'src/features/client-portal/catalogue.jsx',
    utilisateur: { id: 'user-1', role: 'client', prenom: undefined, nom: 'Mairie de Moanda' },
    donnees: {
      produits_catalogue: [{
        id: 'p-enveloppe', nom: 'Enveloppe invitation', categorie: 'Papeterie',
        actif: true, prix: [{ qte_min: 1, qte_max: null, prix: 4500 }],
        images: [BASE64_LOURDE], image_principale: 0,
      }],
      commandes: [], clients: [], notifications_app: [],
    },
  });
  try {
    const ajouter = boutons(v).find((b) => b.querySelector('svg') && b.className.includes('h-8 w-8'));
    assert.ok(ajouter, 'le bouton « + » de la carte produit est introuvable');
    await v.act(async () => { ajouter.click(); await new Promise((r) => setTimeout(r, 0)); });
    await vidanger(v);

    const ouvrirPanier = bouton(v, /Mon Panier/);
    assert.ok(ouvrirPanier, 'le bouton du panier est introuvable');
    await v.act(async () => { ouvrirPanier.click(); await new Promise((r) => setTimeout(r, 0)); });
    await vidanger(v);

    const envoyer = bouton(v, /Envoyer la demande/);
    assert.ok(envoyer, 'le bouton d’envoi est introuvable : le scénario ne teste rien');
    await v.act(async () => { envoyer.click(); await new Promise((r) => setTimeout(r, 0)); });
    await vidanger(v);

    const commandes = v.journal.ecritures.filter(
      (e) => e.collection === 'commandes' && e.operation === 'create',
    );
    assert.equal(commandes.length, 1, 'la commande n’est pas partie');

    const ecrit = JSON.stringify(commandes[0].data);
    assert.ok(
      !ecrit.includes('data:image/'),
      `la photo base64 a été recopiée dans la commande (${ecrit.length} octets écrits)`,
    );
    // La ligne garde de quoi retrouver le produit : on n'a pas perdu l'info,
    // on a cessé de la dupliquer.
    assert.equal(commandes[0].data.lignes[0].produit_id, 'p-enveloppe');
    assert.equal(commandes[0].data.lignes[0].nom, 'Enveloppe invitation');
  } finally { await v.demonter(); }
});

test('une photo déjà migrée en URL est bien recopiée, elle (120 octets)', async () => {
  const v = await rendreEcran({
    ecran: 'src/features/client-portal/catalogue.jsx',
    utilisateur: { id: 'user-1', role: 'client', nom: 'Mairie de Moanda' },
    donnees: {
      produits_catalogue: [{
        id: 'p-polo', nom: 'Polo blanc', categorie: 'Textile', actif: true,
        prix: [{ qte_min: 1, qte_max: null, prix: 7000 }],
        images: [URL_STORAGE], image_principale: 0,
      }],
      commandes: [], clients: [], notifications_app: [],
    },
  });
  try {
    const ajouter = boutons(v).find((b) => b.querySelector('svg') && b.className.includes('h-8 w-8'));
    await v.act(async () => { ajouter.click(); await new Promise((r) => setTimeout(r, 0)); });
    await vidanger(v);
    await v.act(async () => { bouton(v, /Mon Panier/).click(); await new Promise((r) => setTimeout(r, 0)); });
    await vidanger(v);
    await v.act(async () => { bouton(v, /Envoyer la demande/).click(); await new Promise((r) => setTimeout(r, 0)); });
    await vidanger(v);

    const cmd = v.journal.ecritures.find((e) => e.collection === 'commandes');
    assert.ok(cmd, 'la commande n’est pas partie');
    assert.equal(cmd.data.lignes[0].image, URL_STORAGE,
      'une URL est légère : elle doit rester dans la ligne de commande');
  } finally { await v.demonter(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. LES DEUX FORMES COHABITENT — pendant la bascule, rien ne casse
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * La migration se fait ligne par ligne, et peut s'arrêter au milieu. Entre les
 * deux, la collection porte les DEUX formes en même temps — et même une LIGNE
 * qui porte les deux (sa première photo migrée, la seconde pas encore).
 */
const CATALOGUE_A_MI_CHEMIN = [
  { id: 'p-1', nom: 'Migré', categorie: 'Papeterie', actif: true, images: [URL_STORAGE], image_principale: 0 },
  { id: 'p-2', nom: 'Pas encore', categorie: 'Textile', actif: true, images: [BASE64_LEGERE], image_principale: 0 },
  { id: 'p-3', nom: 'À moitié', categorie: 'Textile', actif: true, images: [URL_STORAGE, BASE64_LEGERE], image_principale: 1 },
  { id: 'p-4', nom: 'Photo morte', categorie: 'Autre', actif: true, images: [URL_DALLE_EXPIREE], image_principale: 0 },
  { id: 'p-5', nom: 'Sans photo', categorie: 'Autre', actif: true },
  { id: 'p-6', nom: 'Champ vide', categorie: 'Autre', actif: true, images: [], image_principale: 0 },
  { id: 'p-7', nom: 'Entrée nulle', categorie: 'Autre', actif: true, images: [null, ''], image_principale: 0 },
];

for (const [nom, ecran, routeur, listeProduitsVisible] of [
  ['catalogue du gérant', 'src/features/catalogue/page.jsx', false, true],
  ['catalogue du portail client', 'src/features/client-portal/catalogue.jsx', false, true],
  // La messagerie du personnel lit le catalogue pour le panneau « partager un
  // produit ». Elle ne l'affiche pas au montage, mais elle le CHARGE — et c'est
  // un des neuf écrans qui téléchargent les 20 Mo.
  ['messagerie du personnel', 'src/features/messagerie/page.jsx', false, false],
]) {
  test(`${nom} — les deux formes s’affichent, aucun écran blanc`, async () => {
    const v = await rendreEcran({
      ecran, routeur,
      donnees: {
        produits_catalogue: CATALOGUE_A_MI_CHEMIN,
        produits: [], tarifs_clients: [], clients: [],
        conversations: [], messages_conv: [], prospects: [],
      },
    });
    try {
      const texte = texteVivant(v);
      assert.ok(texte.length > 0, 'écran blanc');
      if (listeProduitsVisible) {
        for (const p of CATALOGUE_A_MI_CHEMIN) {
          assert.ok(texte.includes(p.nom), `le produit « ${p.nom} » a disparu de l’écran`);
        }
      }
      assert.deepEqual(v.journal.ecritures, [], 'consulter l’écran ne doit rien modifier');
      assert.deepEqual(v.erreurs, [], 'exception ou rejet non rattrapé pendant le montage');
      assert.ok(!/undefined|NaN|\[object Object\]/.test(texte), 'sortie dégradée : ' + texte.slice(0, 300));
    } finally { await v.demonter(); }
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. LE CONTRAT DU MODULE
   ═══════════════════════════════════════════════════════════════════════════ */

test('reconnaître la forme d’une photo', () => {
  assert.equal(estPhotoBase64(BASE64_LEGERE), true);
  assert.equal(estPhotoBase64(URL_STORAGE), false);
  assert.equal(estPhotoBase64(null), false);
  assert.equal(estPhotoBase64(''), false);
  assert.equal(estPhotoBase64(42), false);
  // Une data-URL qui n'est pas une image n'en est pas une.
  assert.equal(estPhotoBase64('data:text/html;base64,PHNjcmlwdD4='), false);

  assert.equal(estPhotoDistante(URL_STORAGE), true);
  assert.equal(estPhotoDistante(URL_DALLE_EXPIREE), true);
  assert.equal(estPhotoDistante(BASE64_LEGERE), false);
  // `javascript:` dans un `src` s'exécute : on ne le laisse pas passer pour
  // une photo sous prétexte qu'il ressemble à une URL.
  assert.equal(estPhotoDistante('javascript:alert(1)'), false);
  assert.equal(estPhotoDistante('//evil.example/x.png'), false);
});

test('photosDuProduit rend les deux formes, sans les trous', () => {
  assert.deepEqual(photosDuProduit({ images: [URL_STORAGE, BASE64_LEGERE] }), [URL_STORAGE, BASE64_LEGERE]);
  assert.deepEqual(photosDuProduit({ images: [null, '', URL_STORAGE] }), [URL_STORAGE]);
  assert.deepEqual(photosDuProduit({}), []);
  assert.deepEqual(photosDuProduit(null), []);
  // Un champ `images` qui n'est pas un tableau ne doit pas faire lever l'écran.
  assert.deepEqual(photosDuProduit({ images: 'data:image/png;base64,AAA' }), []);
});

test('photoPrincipale suit `image_principale`, et se replie proprement', () => {
  assert.equal(photoPrincipale({ images: [URL_STORAGE, BASE64_LEGERE], image_principale: 1 }), BASE64_LEGERE);
  assert.equal(photoPrincipale({ images: [URL_STORAGE, BASE64_LEGERE], image_principale: 0 }), URL_STORAGE);
  // Un index hors bornes ne doit pas rendre `undefined` dans un `src`.
  assert.equal(photoPrincipale({ images: [URL_STORAGE], image_principale: 7 }), URL_STORAGE);
  assert.equal(photoPrincipale({ images: [URL_STORAGE] }), URL_STORAGE);
  assert.equal(photoPrincipale({ images: [] }), null);
  assert.equal(photoPrincipale(null), null);
});

test('referencePhotoLegere refuse de recopier une photo lourde', () => {
  // Une URL : toujours, quelle que soit sa longueur — c'est une référence.
  assert.equal(referencePhotoLegere(URL_STORAGE), URL_STORAGE);
  // Une base64 courte : on la garde, le comportement visible ne change pas.
  assert.equal(referencePhotoLegere(BASE64_LEGERE), BASE64_LEGERE);
  // Une base64 lourde : jamais. C'est elle qui a mis 163 117 octets dans les
  // 5 commandes du portail.
  assert.equal(referencePhotoLegere(BASE64_LOURDE), null);
  assert.equal(referencePhotoLegere(null), null);
  assert.ok(PLAFOND_PHOTO_RECOPIEE > 12_700, 'le plafond doit laisser passer « Polo blanc »');
  assert.ok(PLAFOND_PHOTO_RECOPIEE < 1_596_858, 'le plafond doit arrêter « Enveloppe invitation »');
});

test('avancementMigrationPhotos compte ce qui reste à sortir', () => {
  const etat = avancementMigrationPhotos(CATALOGUE_A_MI_CHEMIN);
  // p-1 : 1 URL · p-2 : 1 base64 · p-3 : 1 URL + 1 base64 · p-4 : 1 URL
  // p-5, p-6, p-7 : aucune photo exploitable.
  assert.equal(etat.photos, 5, '5 photos exploitables dans le jeu à mi-chemin');
  assert.equal(etat.enBase64, 2);
  assert.equal(etat.distantes, 3);
  assert.equal(etat.lignesAvecBase64, 2);
  assert.equal(etat.octetsBase64, BASE64_LEGERE.length * 2);
  assert.equal(avancementMigrationPhotos([]).photos, 0);
  assert.equal(avancementMigrationPhotos(null).photos, 0);
});
