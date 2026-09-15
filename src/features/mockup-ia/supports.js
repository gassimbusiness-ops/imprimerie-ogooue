/**
 * Catalogue des supports de mockup — donnees pures, aucune dependance.
 *
 * POURQUOI CE FICHIER EXISTE
 *
 * L'ecran precedent proposait une palette globale « Blanc, Noir, Rouge, Bleu, Vert,
 * Jaune, Gris » et une liste de 23 produits, toutes deux inventees. Recoupement fait
 * le 15/09/2026 avec `public/data/inventaire_data.json` et
 * `livrables_claude/catalogue/CATALOGUE_REFERENCE.md` :
 *
 *   - Rouge, Jaune et Gris ne sont en stock sur AUCUN support. On montrait au client
 *     un t-shirt rouge qu'on n'a pas.
 *   - Rose (83 t-shirts), Violet (100 t-shirts) et Orange (68 polos) sont en stock et
 *     n'etaient pas proposes.
 *   - Stylo, Calendrier, Enveloppe, Cachet, Porte-cle, Panneau publicitaire, Kakemono
 *     et Enseigne sont tous `A CHIFFRER` au catalogue : jamais vendus, aucun prix.
 *
 * REGLE : la couleur est une propriete DU SUPPORT, pas une propriete globale.
 * Le violet existe en t-shirt (100 pieces) et n'existe pas en polo. Une palette
 * globale ne peut pas dire ca ; c'est pour ca qu'elle mentait.
 *
 * Source des quantites : inventaire de l'application, releve du 15/09/2026.
 * Toute ligne dont le coloris n'est pas documente porte `aConfirmer: true` et
 * l'interface DOIT afficher la reserve a cote — jamais l'afficher comme un fait.
 */

/* ─────────────────────────────────────────────────────────────────────────────
   Techniques de marquage reellement pratiquees a l'atelier
   (CATALOGUE_REFERENCE.md, colonne « Technique »)
   ───────────────────────────────────────────────────────────────────────────── */

export const TECHNIQUES = [
  {
    id: 'flex',
    label: 'Flex (vinyle decoupe)',
    // Le flex est du vinyle de couleur unie, decoupe puis presse. Il ne peut
    // physiquement pas produire un degrade ni une photo.
    aplatSeul: true,
    detailMinMm: 2,
    supportSombreOk: true,
    aide: 'Vinyle de couleur unie decoupe au plotter. Aplats uniquement, pas de degrade ni de photo.',
  },
  {
    id: 'sublimation',
    label: 'Sublimation',
    // L'encre se diffuse dans la fibre : elle ne peut pas etre plus claire que le
    // support. Sur un support sombre, le motif n'apparait pas.
    aplatSeul: false,
    detailMinMm: 0.5,
    supportSombreOk: false,
    aide: 'Photos et degrades possibles. Ne fonctionne QUE sur support clair en polyester.',
  },
  {
    id: 'transfert_dark',
    label: 'Transfert « dark »',
    aplatSeul: false,
    detailMinMm: 1,
    supportSombreOk: true,
    aide: 'Photos possibles sur support sombre. Laisse un lisere de film visible autour du motif.',
  },
  {
    id: 'transfert',
    label: 'Transfert',
    aplatSeul: false,
    detailMinMm: 1,
    supportSombreOk: true,
    aide: 'Polyvalent. Rendu legerement moins mat que le flex.',
  },
  {
    id: 'impression_grand_format',
    label: 'Impression grand format',
    aplatSeul: false,
    detailMinMm: 3,
    supportSombreOk: true,
    aide: 'Bache et banderole. Machine installee en aout 2024.',
  },
  {
    id: 'impression_pvc',
    label: 'Impression PVC',
    aplatSeul: false,
    detailMinMm: 0.5,
    supportSombreOk: true,
    aide: 'Badge PVC.',
  },
];

export function trouverTechnique(id) {
  return TECHNIQUES.find((t) => t.id === id) || null;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Coloris — chacun adosse a une ligne d'inventaire
   `sombre: true` declenche la regle « sublimation impossible » (§8.1 du cahier).
   ───────────────────────────────────────────────────────────────────────────── */

const C = (id, label, hex, sombre, stock, source) => ({ id, label, hex, sombre, stock, source });

/* ─────────────────────────────────────────────────────────────────────────────
   Supports
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Une zone de marquage. `cx`/`cy`/`wMax`/`hMax` sont normalises (0-1) sur l'image
 * de scene : ils placent le cadre d'incrustation independamment de la definition
 * de la photo. `largeurMaxCm` / `hauteurMaxCm` sont les cotes REELLES de l'atelier :
 * ce sont elles qui servent au calcul de definition (px/pouce) et a la regle des 2 mm.
 */
const zone = (id, label, cx, cy, wMax, hMax, largeurMaxCm, hauteurMaxCm) => ({
  id, label, cx, cy, wMax, hMax, largeurMaxCm, hauteurMaxCm,
});

export const SUPPORTS = [
  {
    id: 'tshirt_adulte',
    label: 'T-shirt adulte',
    categorie: 'Textile',
    anglais: 'plain adult cotton t-shirt, laid flat, viewed from above',
    largeurReelleCm: 50,
    techniques: ['flex', 'sublimation', 'transfert_dark', 'transfert'],
    angles: ['face', 'trois_quarts'],
    coloris: [
      C('blanc', 'Blanc', '#FFFFFF', false, 430, 'Tee-shirt blanc adulte (103) + KAF adulte (327)'),
      C('noir', 'Noir', '#1B1B1B', true, 70, 'Tee-shirt Noir'),
      C('bleu', 'Bleu', '#1565C0', true, 76, 'Tee-shirt Bleu'),
      C('vert', 'Vert', '#2E7D32', true, 73, 'Tee-shirt vert'),
      C('rose', 'Rose', '#E91E8C', false, 83, 'Tee-shirt Rose'),
      C('violet', 'Violet', '#6A1B9A', true, 100, 'Tee-shirt violet'),
    ],
    zones: [
      zone('poitrine_gauche', 'Poitrine gauche', 0.635, 0.325, 0.16, 0.14, 10, 8),
      zone('poitrine_centre', 'Poitrine centre', 0.5, 0.42, 0.44, 0.34, 28, 22),
      zone('dos', 'Dos (plein)', 0.5, 0.45, 0.52, 0.40, 30, 25),
      zone('manche', 'Manche', 0.16, 0.30, 0.10, 0.10, 8, 6),
    ],
  },
  {
    id: 'tshirt_enfant',
    label: 'T-shirt enfant',
    categorie: 'Textile',
    anglais: 'plain children cotton t-shirt, laid flat, viewed from above',
    largeurReelleCm: 36,
    techniques: ['flex', 'sublimation', 'transfert_dark', 'transfert'],
    angles: ['face', 'trois_quarts'],
    coloris: [
      C('blanc', 'Blanc', '#FFFFFF', false, 656, 'Tee-shirt blanc KAF enfant (541) + blanc Enfant (115)'),
    ],
    zones: [
      zone('poitrine_gauche', 'Poitrine gauche', 0.635, 0.325, 0.16, 0.14, 8, 6),
      zone('poitrine_centre', 'Poitrine centre', 0.5, 0.42, 0.44, 0.34, 20, 16),
      zone('dos', 'Dos (plein)', 0.5, 0.45, 0.52, 0.40, 22, 18),
    ],
  },
  {
    id: 'polo',
    label: 'Polo',
    categorie: 'Textile',
    anglais: 'plain pique cotton polo shirt with collar, laid flat, viewed from above',
    largeurReelleCm: 52,
    techniques: ['flex', 'sublimation', 'transfert_dark', 'transfert'],
    angles: ['face', 'trois_quarts'],
    coloris: [
      C('blanc', 'Blanc', '#FFFFFF', false, 44, 'Polo blanc (34) + Polo blanc asiatique (10)'),
      C('noir', 'Noir', '#1B1B1B', true, 23, 'Polo noir asiatique'),
      C('bleu', 'Bleu', '#1565C0', true, 76, 'Polo bleu asiatique'),
      C('orange', 'Orange', '#EF6C00', false, 68, 'Polo orange asiatique'),
      C('rose', 'Rose', '#E91E8C', false, 19, 'Polo Rose asiatique'),
      C('vert', 'Vert', '#2E7D32', true, 7, 'Polo vert asiatique'),
    ],
    zones: [
      zone('poitrine_gauche', 'Poitrine gauche', 0.635, 0.335, 0.15, 0.13, 10, 8),
      zone('dos', 'Dos (plein)', 0.5, 0.45, 0.50, 0.38, 28, 24),
    ],
  },
  {
    id: 'casquette',
    label: 'Casquette',
    categorie: 'Textile',
    anglais: 'plain baseball cap, front view, curved visor',
    largeurReelleCm: 22,
    techniques: ['flex', 'transfert', 'transfert_dark'],
    angles: ['face', 'trois_quarts'],
    coloris: [
      // 33 casquettes en stock, coloris NON documente dans l'inventaire (question
      // Q-M5 du cahier des charges). On ne l'invente pas : on l'annonce comme
      // a confirmer, et l'interface affiche la reserve.
      {
        id: 'a_confirmer', label: 'Coloris a confirmer en magasin', hex: '#9E9E9E',
        sombre: false, stock: 33, aConfirmer: true,
        source: 'Casquettes (33) — coloris non renseigne a l\'inventaire',
      },
    ],
    zones: [
      zone('face', 'Face avant', 0.5, 0.42, 0.30, 0.20, 9, 5),
    ],
  },
  {
    id: 'tasse_simple',
    label: 'Tasse simple',
    categorie: 'Objet',
    anglais: 'plain white ceramic mug, handle on the right',
    largeurReelleCm: 20, // developpe du flanc imprimable
    techniques: ['sublimation'],
    angles: ['face', 'trois_quarts'],
    coloris: [
      C('blanc', 'Blanc', '#FFFFFF', false, 40, 'Tasse simple'),
    ],
    zones: [
      zone('flanc', 'Flanc (developpe)', 0.46, 0.50, 0.46, 0.40, 20, 8),
    ],
  },
  {
    id: 'tasse_magique',
    label: 'Tasse magique',
    categorie: 'Objet',
    anglais: 'plain black thermochromic ceramic mug, handle on the right',
    largeurReelleCm: 20,
    techniques: ['sublimation'],
    angles: ['face', 'trois_quarts'],
    coloris: [
      // Exception documentee : le revetement thermosensible EST concu pour la
      // sublimation malgre sa teinte sombre. `sombre: false` serait un mensonge
      // visuel ; on porte donc une derogation explicite plutot qu'un faux coloris.
      {
        id: 'noir_thermo', label: 'Noir thermosensible', hex: '#1B1B1B',
        sombre: true, sublimationDerogee: true, stock: 36,
        source: 'Tasse magique — revetement thermosensible prevu pour la sublimation',
      },
    ],
    zones: [
      zone('flanc', 'Flanc (developpe)', 0.46, 0.50, 0.46, 0.40, 20, 8),
    ],
  },
  {
    id: 'badge_pvc',
    label: 'Badge PVC',
    categorie: 'Objet',
    anglais: 'blank white PVC identification badge card, front view',
    largeurReelleCm: 8.5,
    techniques: ['impression_pvc'],
    angles: ['face'],
    coloris: [
      C('blanc', 'Blanc', '#FFFFFF', false, 140, 'Badges'),
    ],
    zones: [
      zone('pleine', 'Pleine surface', 0.5, 0.5, 0.86, 0.80, 8.5, 5.4),
    ],
  },
  {
    id: 'banderole',
    label: 'Banderole / bache',
    categorie: 'Grand format',
    anglais: 'blank white PVC banner stretched flat on a wall, front view',
    largeurReelleCm: 200,
    techniques: ['impression_grand_format'],
    angles: ['face'],
    coloris: [
      C('blanc', 'Blanc', '#FFFFFF', false, null, 'Bache vierge — consommable, non compte a l\'inventaire'),
    ],
    zones: [
      zone('pleine', 'Pleine surface', 0.5, 0.5, 0.88, 0.70, 200, 100),
    ],
  },
  {
    id: 'gilet_travail',
    label: 'Gilet de travail',
    categorie: 'Textile',
    anglais: 'plain high-visibility work vest with reflective stripes, front view',
    largeurReelleCm: 55,
    // Seule prestation au prix CONFIRME du catalogue : 3 500 F/piece,
    // devis n°093/GA/2024 du 03/12/2024 (client BACOREF, 30 gilets).
    techniques: ['flex', 'transfert', 'transfert_dark'],
    angles: ['face'],
    coloris: [
      {
        id: 'a_preciser', label: 'Coloris a preciser avec le client', hex: '#C6D300',
        sombre: false, stock: null, aConfirmer: true,
        source: 'Non tenu en stock a l\'inventaire du 15/09/2026 — support commande a la demande',
      },
    ],
    zones: [
      zone('poitrine_gauche', 'Poitrine gauche', 0.63, 0.32, 0.15, 0.13, 10, 8),
      zone('dos', 'Dos (plein)', 0.5, 0.45, 0.46, 0.34, 25, 20),
    ],
  },
];

export const ANGLES = [
  { id: 'face', label: 'De face', anglais: 'straight front view, camera parallel to the surface' },
  { id: 'trois_quarts', label: 'Trois-quarts', anglais: 'three-quarter view, about 25 degrees to the side' },
];

export function trouverSupport(id) {
  return SUPPORTS.find((s) => s.id === id) || null;
}

export function trouverColoris(supportId, colorisId) {
  const s = trouverSupport(supportId);
  if (!s) return null;
  return s.coloris.find((c) => c.id === colorisId) || null;
}

export function trouverZone(supportId, zoneId) {
  const s = trouverSupport(supportId);
  if (!s) return null;
  return s.zones.find((z) => z.id === zoneId) || null;
}

export function trouverAngle(id) {
  return ANGLES.find((a) => a.id === id) || null;
}
