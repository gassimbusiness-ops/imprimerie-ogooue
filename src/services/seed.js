import { db, getSettings, saveSettings } from './db';
import { hashPassword, generateSalt } from './crypto';

/**
 * Comptes par défaut — UNIQUEMENT ces 3 comptes.
 */
const COMPTES = [
  {
    nom: 'Admin',
    prenom: 'Imprimerie',
    display_name: 'IBRAHIM Abakar',
    email: 'imprimerieogooue@gmail.com',
    role: 'admin',
    poste: 'Directeur Général',
    password: 'Pv11072023*',
  },
  {
    nom: 'Opérateur',
    prenom: 'Opérateur',
    email: 'imprimerieogooue.user@gmail.com',
    role: 'employe',
    poste: 'Opérateur',
    password: 'Pv11072026*',
  },
  {
    nom: 'Client test',
    prenom: 'Client',
    email: 'Minguisilou@gmail.com',
    role: 'client',
    poste: '',
    password: 'Ou31081998*',
  },
];

const DEFAULT_SETTINGS = {
  nom_entreprise: 'Imprimerie OGOOUÉ',
  slogan: 'Votre partenaire impression à Moanda',
  adresse: 'Carrefour Fina en face de Finam',
  ville: 'Moanda',
  pays: 'Gabon',
  telephone: '060 44 46 34 / 074 42 41 42',
  email: 'imprimerieogooue@gmail.com',
  site_web: '',
  nif: '256598U',
  rccm: 'RG/FCV 2023A0407',
  logo: '',
  devise: 'F CFA',
  tva: '0',
};

/**
 * Seed the database if empty.
 * Checks Supabase (or localStorage) for existing employees.
 * Only runs once — subsequent calls return immediately.
 */
export async function seedDatabase() {
  // Check if already seeded (data exists)
  const existing = await db.employes.list();
  if (existing.length > 0) return;

  console.log('[seed] Initialisation des comptes par défaut...');

  // Create the 3 accounts
  for (const c of COMPTES) {
    const salt = generateSalt();
    const hash = await hashPassword(c.password, salt);
    await db.employes.create({
      nom: c.nom,
      prenom: c.prenom,
      display_name: c.display_name || '',
      email: c.email,
      role: c.role,
      poste: c.poste,
      password_hash: hash,
      password_salt: salt,
      password_changed_at: new Date().toISOString(),
    });
  }

  // Seed default settings if not already set
  const settings = await getSettings();
  if (!settings.nom_entreprise) {
    await saveSettings(DEFAULT_SETTINGS);
  }

  console.log('[seed] 3 comptes créés + paramètres par défaut');

  // Seed catalogue products
  await seedCatalogue();
}

/* ─────────────── CATALOGUE PRODUCTS ─────────────── */

const CATALOGUE_PRODUCTS = [
  {
    nom: 'Tee-shirt personnalisé',
    sku: 'TEX-001',
    categorie: 'Textile',
    description: 'Tee-shirt 100% coton personnalisable avec impression transfert thermique ou DTF. Disponible en plusieurs tailles (S à XXL) et couleurs.',
    images: [],
    image_principale: 0,
    prix: [
      { qte_min: 1, qte_max: 5, prix: 3500 },
      { qte_min: 6, qte_max: 20, prix: 3000 },
      { qte_min: 21, qte_max: 50, prix: 2500 },
      { qte_min: 51, qte_max: null, prix: 2000 },
    ],
    unite: 'pièce',
    delai_jours: 3,
    tags: ['textile', 'personnalisation', 'transfert'],
    actif: true,
    stock_lie: null,
  },
  {
    nom: 'Polo brodé / imprimé',
    sku: 'TEX-002',
    categorie: 'Textile',
    description: 'Polo en coton piqué avec broderie ou impression DTF du logo. Idéal pour uniformes entreprise. Tailles S à XXL.',
    images: [],
    image_principale: 0,
    prix: [
      { qte_min: 1, qte_max: 5, prix: 5500 },
      { qte_min: 6, qte_max: 20, prix: 5000 },
      { qte_min: 21, qte_max: 50, prix: 4500 },
      { qte_min: 51, qte_max: null, prix: 4000 },
    ],
    unite: 'pièce',
    delai_jours: 5,
    tags: ['textile', 'broderie', 'uniforme'],
    actif: true,
    stock_lie: null,
  },
  {
    nom: 'Mug personnalisé',
    sku: 'ACC-001',
    categorie: 'Accessoire',
    description: 'Mug en céramique blanche 330ml avec impression sublimation couleur. Résistant au lave-vaisselle.',
    images: [],
    image_principale: 0,
    prix: [
      { qte_min: 1, qte_max: 10, prix: 2500 },
      { qte_min: 11, qte_max: 30, prix: 2000 },
      { qte_min: 31, qte_max: null, prix: 1500 },
    ],
    unite: 'pièce',
    delai_jours: 2,
    tags: ['sublimation', 'cadeau', 'accessoire'],
    actif: true,
    stock_lie: null,
  },
  {
    nom: 'Casquette personnalisée',
    sku: 'TEX-003',
    categorie: 'Textile',
    description: 'Casquette baseball ajustable avec broderie ou transfert thermique. Plusieurs coloris disponibles.',
    images: [],
    image_principale: 0,
    prix: [
      { qte_min: 1, qte_max: 10, prix: 3000 },
      { qte_min: 11, qte_max: 30, prix: 2500 },
      { qte_min: 31, qte_max: null, prix: 2000 },
    ],
    unite: 'pièce',
    delai_jours: 4,
    tags: ['textile', 'broderie', 'casquette'],
    actif: true,
    stock_lie: null,
  },
  {
    nom: 'Chemise brodée',
    sku: 'TEX-004',
    categorie: 'Textile',
    description: 'Chemise manches longues ou courtes avec broderie logo. Tissu professionnel, idéal pour uniformes. Tailles S à XXL.',
    images: [],
    image_principale: 0,
    prix: [
      { qte_min: 1, qte_max: 5, prix: 7000 },
      { qte_min: 6, qte_max: 20, prix: 6000 },
      { qte_min: 21, qte_max: 50, prix: 5500 },
      { qte_min: 51, qte_max: null, prix: 5000 },
    ],
    unite: 'pièce',
    delai_jours: 7,
    tags: ['textile', 'broderie', 'uniforme', 'premium'],
    actif: true,
    stock_lie: null,
  },
  {
    nom: 'Carnet / Cahier personnalisé',
    sku: 'PAP-001',
    categorie: 'Papeterie',
    description: 'Carnet A5 ou A4 avec couverture personnalisée. Reliure spirale ou collée. 100 pages lignées ou blanches.',
    images: [],
    image_principale: 0,
    prix: [
      { qte_min: 1, qte_max: 10, prix: 1500 },
      { qte_min: 11, qte_max: 50, prix: 1200 },
      { qte_min: 51, qte_max: null, prix: 1000 },
    ],
    unite: 'pièce',
    delai_jours: 5,
    tags: ['papeterie', 'impression', 'reliure'],
    actif: true,
    stock_lie: null,
  },
  {
    nom: 'Flyers / Prospectus',
    sku: 'MKT-001',
    categorie: 'Marketing',
    description: 'Flyers A5 ou A4 imprimés recto ou recto-verso en couleur sur papier couché 135g ou 170g.',
    images: [],
    image_principale: 0,
    prix: [
      { qte_min: 50, qte_max: 100, prix: 150 },
      { qte_min: 101, qte_max: 500, prix: 100 },
      { qte_min: 501, qte_max: null, prix: 75 },
    ],
    unite: 'pièce',
    delai_jours: 2,
    tags: ['impression', 'marketing', 'flyer'],
    actif: true,
    stock_lie: null,
  },
  {
    nom: 'Stylo personnalisé',
    sku: 'ACC-002',
    categorie: 'Accessoire',
    description: 'Stylo bille avec gravure laser ou impression tampon du logo. Plusieurs modèles et coloris.',
    images: [],
    image_principale: 0,
    prix: [
      { qte_min: 10, qte_max: 50, prix: 500 },
      { qte_min: 51, qte_max: 100, prix: 400 },
      { qte_min: 101, qte_max: null, prix: 300 },
    ],
    unite: 'pièce',
    delai_jours: 5,
    tags: ['accessoire', 'gravure', 'cadeau'],
    actif: true,
    stock_lie: null,
  },
  {
    nom: 'Badge / Carte PVC',
    sku: 'ACC-003',
    categorie: 'Accessoire',
    description: 'Badge nominatif ou carte PVC format carte de crédit avec impression couleur recto-verso et plastification.',
    images: [],
    image_principale: 0,
    prix: [
      { qte_min: 1, qte_max: 10, prix: 1000 },
      { qte_min: 11, qte_max: 50, prix: 800 },
      { qte_min: 51, qte_max: null, prix: 600 },
    ],
    unite: 'pièce',
    delai_jours: 2,
    tags: ['badge', 'plastification', 'carte'],
    actif: true,
    stock_lie: null,
  },
  {
    nom: 'Roll-up / Banderole',
    sku: 'SIG-001',
    categorie: 'Signalétique',
    description: 'Roll-up 85x200cm ou banderole PVC grand format. Impression haute résolution, support inclus pour roll-up.',
    images: [],
    image_principale: 0,
    prix: [
      { qte_min: 1, qte_max: 3, prix: 25000 },
      { qte_min: 4, qte_max: 10, prix: 22000 },
      { qte_min: 11, qte_max: null, prix: 20000 },
    ],
    unite: 'pièce',
    delai_jours: 3,
    tags: ['signalétique', 'grand format', 'événement'],
    actif: true,
    stock_lie: null,
  },
  {
    nom: 'Autocollant / Sticker',
    sku: 'MKT-002',
    categorie: 'Marketing',
    description: 'Autocollants vinyle découpés ou en planche. Résistants aux intempéries. Formes personnalisées possibles.',
    images: [],
    image_principale: 0,
    prix: [
      { qte_min: 10, qte_max: 50, prix: 200 },
      { qte_min: 51, qte_max: 100, prix: 150 },
      { qte_min: 101, qte_max: null, prix: 100 },
    ],
    unite: 'pièce',
    delai_jours: 2,
    tags: ['vinyle', 'autocollant', 'marketing'],
    actif: true,
    stock_lie: null,
  },
  {
    nom: 'Carte de visite',
    sku: 'IMP-001',
    categorie: 'Impression',
    description: 'Cartes de visite format standard 85x55mm. Impression recto-verso couleur sur papier couché 350g mat ou brillant.',
    images: [],
    image_principale: 0,
    prix: [
      { qte_min: 100, qte_max: 100, prix: 15000 },
      { qte_min: 250, qte_max: 250, prix: 25000 },
      { qte_min: 500, qte_max: 500, prix: 40000 },
    ],
    unite: 'lot',
    delai_jours: 2,
    tags: ['impression', 'carte', 'professionnel'],
    actif: true,
    stock_lie: null,
  },
  {
    nom: 'Autres produits',
    sku: 'DIV-001',
    categorie: 'Autre',
    description: 'Produits sur demande : calendriers, affiches, pochettes, enveloppes personnalisées, etc. Prix sur devis.',
    images: [],
    image_principale: 0,
    prix: [
      { qte_min: 1, qte_max: null, prix: 0 },
    ],
    unite: 'pièce',
    delai_jours: 0,
    tags: ['divers', 'sur devis'],
    actif: true,
    stock_lie: null,
  },
];

/**
 * Seed catalogue products if empty.
 */
export async function seedCatalogue() {
  const existing = await db.produits_catalogue.list();
  if (existing.length > 0) return;

  console.log('[seed] Initialisation du catalogue produits...');
  for (const p of CATALOGUE_PRODUCTS) {
    await db.produits_catalogue.create(p);
  }
  console.log(`[seed] ${CATALOGUE_PRODUCTS.length} produits catalogue créés`);

  // Also seed stock articles
  await seedStock();
}

/* ─────────────── STOCK ARTICLES (CONSOMMABLES) ─────────────── */

const STOCK_ARTICLES = [
  {
    nom: 'Encre noire imprimante jet',
    reference: 'ENC-001',
    categorie: 'Encres',
    description: 'Encre noire compatible imprimante jet grand format. Flacon 100ml.',
    fournisseur: 'Fournisseur Libreville',
    fournisseur_contact: '',
    prix_unitaire: 8000,
    unite: 'flacon',
    quantite: 12,
    quantite_minimum: 5,
    emplacement: 'Étagère A1',
    masque: false,
    actif: true,
  },
  {
    nom: 'Encre couleur CMJN (set)',
    reference: 'ENC-002',
    categorie: 'Encres',
    description: 'Set 4 couleurs CMJN pour imprimante jet. Flacons 100ml chacun.',
    fournisseur: 'Fournisseur Libreville',
    fournisseur_contact: '',
    prix_unitaire: 25000,
    unite: 'set',
    quantite: 4,
    quantite_minimum: 2,
    emplacement: 'Étagère A1',
    masque: false,
    actif: true,
  },
  {
    nom: 'Rame papier A4 80g',
    reference: 'PAP-001',
    categorie: 'Papiers',
    description: 'Rame de 500 feuilles papier blanc A4, 80g/m2. Usage courant photocopie et impression.',
    fournisseur: 'Papeterie Centrale',
    fournisseur_contact: '',
    prix_unitaire: 3500,
    unite: 'rame',
    quantite: 45,
    quantite_minimum: 20,
    emplacement: 'Stock principal',
    masque: false,
    actif: true,
  },
  {
    nom: 'Rame papier A3 80g',
    reference: 'PAP-002',
    categorie: 'Papiers',
    description: 'Rame de 500 feuilles papier blanc A3, 80g/m2.',
    fournisseur: 'Papeterie Centrale',
    fournisseur_contact: '',
    prix_unitaire: 6500,
    unite: 'rame',
    quantite: 15,
    quantite_minimum: 5,
    emplacement: 'Stock principal',
    masque: false,
    actif: true,
  },
  {
    nom: 'Papier couché 135g A4',
    reference: 'PAP-003',
    categorie: 'Papiers',
    description: 'Papier couché brillant 135g/m2 A4 pour flyers et impressions qualité. Paquet 250 feuilles.',
    fournisseur: 'Fournisseur Libreville',
    fournisseur_contact: '',
    prix_unitaire: 12000,
    unite: 'paquet',
    quantite: 8,
    quantite_minimum: 3,
    emplacement: 'Étagère B2',
    masque: false,
    actif: true,
  },
  {
    nom: 'Papier couché 350g (cartes de visite)',
    reference: 'PAP-004',
    categorie: 'Papiers',
    description: 'Papier couché mat/brillant 350g/m2 pour cartes de visite. Format A4, paquet 100 feuilles.',
    fournisseur: 'Fournisseur Libreville',
    fournisseur_contact: '',
    prix_unitaire: 15000,
    unite: 'paquet',
    quantite: 6,
    quantite_minimum: 2,
    emplacement: 'Étagère B2',
    masque: false,
    actif: true,
  },
  {
    nom: 'Vinyle adhésif blanc',
    reference: 'VIN-001',
    categorie: 'Vinyles',
    description: 'Rouleau vinyle adhésif blanc mat pour découpe et impression. Largeur 61cm, longueur 50m.',
    fournisseur: 'Fournisseur Libreville',
    fournisseur_contact: '',
    prix_unitaire: 35000,
    unite: 'rouleau',
    quantite: 3,
    quantite_minimum: 1,
    emplacement: 'Étagère C1',
    masque: false,
    actif: true,
  },
  {
    nom: 'Vinyle adhésif transparent',
    reference: 'VIN-002',
    categorie: 'Vinyles',
    description: 'Rouleau vinyle adhésif transparent pour autocollants. Largeur 61cm, longueur 50m.',
    fournisseur: 'Fournisseur Libreville',
    fournisseur_contact: '',
    prix_unitaire: 40000,
    unite: 'rouleau',
    quantite: 2,
    quantite_minimum: 1,
    emplacement: 'Étagère C1',
    masque: false,
    actif: true,
  },
  {
    nom: 'Film transfert thermique',
    reference: 'TRF-001',
    categorie: 'Transfert thermique',
    description: 'Film de transfert thermique pour textile. Feuilles A3, paquet de 100.',
    fournisseur: 'Fournisseur Douala',
    fournisseur_contact: '',
    prix_unitaire: 20000,
    unite: 'paquet',
    quantite: 5,
    quantite_minimum: 2,
    emplacement: 'Étagère D1',
    masque: false,
    actif: true,
  },
  {
    nom: 'Film DTF A3',
    reference: 'DTF-001',
    categorie: 'DTF',
    description: 'Film PET pour impression DTF format A3. Paquet de 100 feuilles.',
    fournisseur: 'Fournisseur Douala',
    fournisseur_contact: '',
    prix_unitaire: 18000,
    unite: 'paquet',
    quantite: 7,
    quantite_minimum: 3,
    emplacement: 'Étagère D2',
    masque: false,
    actif: true,
  },
  {
    nom: 'Poudre DTF adhésive',
    reference: 'DTF-002',
    categorie: 'DTF',
    description: 'Poudre adhésive blanche pour DTF. Pot de 500g.',
    fournisseur: 'Fournisseur Douala',
    fournisseur_contact: '',
    prix_unitaire: 12000,
    unite: 'pot',
    quantite: 4,
    quantite_minimum: 2,
    emplacement: 'Étagère D2',
    masque: false,
    actif: true,
  },
  {
    nom: 'Toner laser noir',
    reference: 'TON-001',
    categorie: 'Consommables machine',
    description: 'Cartouche toner noir compatible pour imprimante laser multifonction.',
    fournisseur: 'Papeterie Centrale',
    fournisseur_contact: '',
    prix_unitaire: 35000,
    unite: 'cartouche',
    quantite: 3,
    quantite_minimum: 2,
    emplacement: 'Armoire machines',
    masque: false,
    actif: true,
  },
  {
    nom: 'Encre sublimation (set CMJN)',
    reference: 'SUB-001',
    categorie: 'Encres',
    description: 'Set 4 encres sublimation CMJN pour mugs et textiles polyester. Flacons 100ml.',
    fournisseur: 'Fournisseur Douala',
    fournisseur_contact: '',
    prix_unitaire: 30000,
    unite: 'set',
    quantite: 2,
    quantite_minimum: 1,
    emplacement: 'Étagère A2',
    masque: false,
    actif: true,
  },
];

/**
 * Seed stock articles if empty.
 */
async function seedStock() {
  const existing = await db.produits.list();
  if (existing.length > 0) return;

  console.log('[seed] Initialisation des articles de stock...');
  for (const a of STOCK_ARTICLES) {
    await db.produits.create(a);
  }
  console.log(`[seed] ${STOCK_ARTICLES.length} articles de stock créés`);
}
