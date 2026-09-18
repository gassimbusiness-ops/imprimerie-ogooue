/**
 * Photos du catalogue — LIRE LES DEUX FORMES, ne plus recopier la lourde.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Mesure du 18/09/2026 sur bcwkrrqmjpaohmafcncw, en lecture seule :
 *
 *   produits_catalogue ......................... 195 lignes, 20 634 952 o
 *     lignes portant un champ `images` .........  17
 *     photos au total ..........................  20   (17 empreintes de ligne)
 *       · data-URL base64 ......................  19
 *       · URL https déjà externe ...............   1   (DALL·E signée, expirée)
 *     poids de ces 17 lignes ................... 20 574 780 o = 99,71 %
 *
 *   Réponse RÉELLEMENT servie par PostgREST pour la requête des écrans
 *   (`select data from app_data where collection='produits_catalogue'`) :
 *     avant .................................... 20 629 118 o
 *     photos remplacées par des URL de Storage ..     69 737 o
 *     → 295,8 fois moins, sur les octets qui passent vraiment par la
 *       connexion de Moanda.
 *
 * `migrations/010_photos_catalogue_vers_storage.sql` (NON APPLIQUÉE) déplace
 * ces photos vers un bucket Storage et remplace la data-URL par son URL
 * publique. La bascule se fait PHOTO PAR PHOTO et peut s'arrêter en cours de
 * route : pendant ce temps, la collection porte les deux formes en même temps,
 * et même une ligne peut porter les deux. Ce module est le seul endroit du
 * logiciel qui sait lire l'une et l'autre.
 *
 * ── Ce qu'il ne fait PAS, et pourquoi ────────────────────────────────────
 *
 * Il ne remplace pas `<img src=…>` : une balise image accepte nativement une
 * data-URL comme une URL http. Aucun écran n'a besoin de ce module pour
 * AFFICHER. Ce qu'il apporte est ailleurs :
 *
 *   1. le tri des entrées inutilisables (`null`, chaîne vide, champ `images`
 *      qui n'est pas un tableau) — sans quoi `<img src={undefined}>` ;
 *   2. le respect de `image_principale`, un INDEX numérique (0 sur les
 *      17 lignes), écrit trois fois dans le dépôt avec trois replis différents ;
 *   3. `referencePhotoLegere()` — la vraie correction : ce qu'on a le droit de
 *      RECOPIER dans une autre collection.
 */

/**
 * Plafond, en caractères, d'une photo qu'on accepte de recopier dans une autre
 * ligne que sa fiche produit.
 *
 * ⚠️ Ce nombre n'est pas rond par hasard. Relevé en base le 18/09/2026 :
 *
 *   `src/features/client-portal/catalogue.jsx` écrivait `image: p.images[0]`
 *   — la data-URL ENTIÈRE — dans chaque ligne de commande. Les 5 commandes du
 *   portail portent aujourd'hui 163 117 octets de photo recopiée. Une commande
 *   d'« Enveloppe invitation » en aurait porté 1 596 858 à elle seule.
 *
 *   Les 19 data-URL de la collection se séparent nettement en deux groupes :
 *     · 10 photos entre 1 754 094 et 2 395 946 caractères (PNG d'avant la
 *       compression, 9 lignes pèsent 1,7 à 3,2 Mio) ;
 *     ·  9 photos entre 12 727 et 70 887 caractères (JPEG recompressés par
 *       `compressSource()`, 600 px / qualité 0,7).
 *
 *   Le plafond passe entre les deux groupes. Une vignette légère continue donc
 *   d'accompagner la commande — le comportement visible ne change pas pour
 *   elle — et une photo lourde n'est plus dupliquée.
 *
 * Une fois la migration 010 passée, ce plafond ne sert plus qu'aux photos
 * ajoutées entre-temps : une URL n'est jamais refusée, quelle que soit sa
 * longueur.
 */
export const PLAFOND_PHOTO_RECOPIEE = 200_000;

const RE_DATA_URL_IMAGE = /^data:image\/[a-z0-9.+-]+;base64,/i;
const RE_URL_HTTP = /^https?:\/\//i;

/**
 * Vrai si `valeur` est une image collée en base64 dans le JSON.
 * @param {unknown} valeur
 * @returns {boolean}
 */
export function estPhotoBase64(valeur) {
  return typeof valeur === 'string' && RE_DATA_URL_IMAGE.test(valeur);
}

/**
 * Vrai si `valeur` est une photo hébergée ailleurs (Supabase Storage après la
 * migration, ou l'URL DALL·E déjà présente sur « Tee-shirt blanc KAF enfant »).
 *
 * ⚠️ `http(s)` UNIQUEMENT, et de façon absolue. Un `javascript:…` posé dans un
 * `src` s'exécute, et un `//hôte/x.png` emprunte le schéma de la page : ni l'un
 * ni l'autre n'est une photo. Le champ `images` est alimenté par l'écran
 * d'administration, donc par un humain, mais il ne coûte rien de refuser ici.
 *
 * @param {unknown} valeur
 * @returns {boolean}
 */
export function estPhotoDistante(valeur) {
  return typeof valeur === 'string' && RE_URL_HTTP.test(valeur);
}

/** Vrai si `valeur` est une photo affichable, sous l'une ou l'autre forme. */
export function estPhotoAffichable(valeur) {
  return estPhotoBase64(valeur) || estPhotoDistante(valeur);
}

/**
 * Les photos affichables d'une fiche produit, dans l'ordre du champ `images`.
 *
 * Les entrées inutilisables sont retirées : `null`, chaîne vide, valeur d'un
 * autre type. Un champ `images` qui n'est pas un tableau rend `[]` plutôt que
 * de faire lever l'écran — une fiche mal formée ne doit pas blanchir une page.
 *
 * @param {object|null|undefined} produit
 * @returns {string[]}
 */
export function photosDuProduit(produit) {
  const brut = produit?.images;
  if (!Array.isArray(brut)) return [];
  return brut.filter(estPhotoAffichable);
}

/**
 * La photo à montrer sur une carte ou une vignette, ou `null`.
 *
 * `image_principale` est un INDEX (un nombre), pas une image : les 17 lignes
 * porteuses valent toutes 0. Un index hors bornes se replie sur la première
 * photo — c'est ce que faisaient déjà, chacun à leur façon, les trois écrans
 * qui écrivaient `p.images[p.image_principale || 0] || p.images[0]`.
 *
 * ⚠️ L'index porte sur le champ `images` BRUT, celui qu'a choisi le gérant.
 * Si une entrée a été écartée (photo illisible), l'index ne désigne plus la
 * même chose : on repart alors sur la première photo affichable plutôt que de
 * rendre `undefined` dans un `src`.
 *
 * @param {object|null|undefined} produit
 * @returns {string|null}
 */
export function photoPrincipale(produit) {
  const utilisables = photosDuProduit(produit);
  if (utilisables.length === 0) return null;
  const index = Number(produit?.image_principale);
  const brut = Array.isArray(produit?.images) ? produit.images : [];
  const choisie = Number.isInteger(index) && index >= 0 && index < brut.length
    ? brut[index]
    : null;
  return estPhotoAffichable(choisie) ? choisie : utilisables[0];
}

/**
 * Ce qu'on a le droit de RECOPIER dans une autre ligne (commande, message,
 * devis) — ou `null` s'il vaut mieux ne rien recopier.
 *
 * Une URL est une référence : légère, partagée, jamais dupliquée. Elle passe
 * toujours. Une data-URL est la photo elle-même : elle ne passe que sous le
 * plafond (voir `PLAFOND_PHOTO_RECOPIEE`).
 *
 * Rendre `null` ne perd rien : la ligne de commande garde `produit_id` et
 * `nom`, qui suffisent à retrouver la fiche et sa photo.
 *
 * @param {unknown} photo
 * @returns {string|null}
 */
export function referencePhotoLegere(photo) {
  if (estPhotoDistante(photo)) return photo;
  if (estPhotoBase64(photo) && photo.length <= PLAFOND_PHOTO_RECOPIEE) return photo;
  return null;
}

/**
 * Où en est la migration, à partir des lignes déjà chargées par un écran.
 *
 * Sert au compte rendu du script `scripts/migrer-photos-catalogue.mjs` et à
 * répondre sans deviner à « est-ce que c'est fini ? ». Aucune lecture réseau :
 * on compte ce qu'on a sous la main.
 *
 * @param {Array<object>|null|undefined} produits
 * @returns {{photos: number, enBase64: number, distantes: number,
 *            lignesAvecBase64: number, octetsBase64: number}}
 */
export function avancementMigrationPhotos(produits) {
  const etat = { photos: 0, enBase64: 0, distantes: 0, lignesAvecBase64: 0, octetsBase64: 0 };
  if (!Array.isArray(produits)) return etat;
  for (const p of produits) {
    let ligneChargee = false;
    for (const photo of photosDuProduit(p)) {
      etat.photos += 1;
      if (estPhotoBase64(photo)) {
        etat.enBase64 += 1;
        etat.octetsBase64 += photo.length;
        ligneChargee = true;
      } else {
        etat.distantes += 1;
      }
    }
    if (ligneChargee) etat.lignesAvecBase64 += 1;
  }
  return etat;
}
