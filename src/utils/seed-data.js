/**
 * Seed data from Excel files — run once to populate the database.
 * Call seedPapeterieProject() from browser console or a button.
 */
import { db } from '@/services/db';

// ── Travaux Papeterie: Dépenses Chantier ──
const DEPENSES_CHANTIER = [
  { materiel: 'Sable', qte: 1, prix_unitaire: 70000, total: 70000, main_oeuvre: 100000 },
  { materiel: 'Sable gravier', qte: 1, prix_unitaire: 80000, total: 80000, main_oeuvre: 50000 },
  { materiel: 'Sac de ciment', qte: 21, prix_unitaire: 6500, total: 136500, main_oeuvre: 5000 },
  { materiel: 'Poteaux 3m', qte: 7, prix_unitaire: 7000, total: 49000, main_oeuvre: 15000 },
  { materiel: 'Briques', qte: 600, prix_unitaire: 450, total: 270000, main_oeuvre: 2000 },
  { materiel: 'Tôle', qte: 0, prix_unitaire: 0, total: 0, main_oeuvre: 5000 },
  { materiel: 'Poteaux 6m', qte: 2, prix_unitaire: 15000, total: 30000, main_oeuvre: 10000 },
  { materiel: 'Planche', qte: 2, prix_unitaire: 4500, total: 9000, main_oeuvre: 0 },
  { materiel: 'Lattes', qte: 11, prix_unitaire: 2500, total: 27500, main_oeuvre: 0 },
  { materiel: 'Fond de 15', qte: 17, prix_unitaire: 3500, total: 59500, main_oeuvre: 0 },
  { materiel: 'Kilo pointe 70', qte: 2, prix_unitaire: 2000, total: 4000, main_oeuvre: 0 },
  { materiel: 'Pointe toque', qte: 0.5, prix_unitaire: 5000, total: 2500, main_oeuvre: 0 },
  { materiel: 'Chevron', qte: 22, prix_unitaire: 5000, total: 110000, main_oeuvre: 0 },
];

// ── Inventaire Imprimerie 2026 ──
export const INVENTAIRE_STOCK = [
  { nom: 'Tee-shirt blanc KAF enfant', qte: 541, prix_achat: 1000, prix_vente: 3000, categorie: 'Textile' },
  { nom: 'Polo blanc', qte: 34, prix_achat: 2500, prix_vente: 5000, categorie: 'Textile' },
  { nom: 'Tee-shirt blanc KAF adulte', qte: 327, prix_achat: 1100, prix_vente: 3500, categorie: 'Textile' },
  { nom: 'Polo Couleur KAF', qte: 22, prix_achat: 2800, prix_vente: 6000, categorie: 'Textile' },
  { nom: 'Sous chemises', qte: 20, prix_achat: 8000, prix_vente: 10000, categorie: 'Papeterie' },
  { nom: 'Chemises cartonnés', qte: 20, prix_achat: 8000, prix_vente: 10000, categorie: 'Papeterie' },
  { nom: 'Papier Blanc dos de reliure', qte: 19, prix_achat: 5000, prix_vente: 30000, categorie: 'Papeterie' },
  { nom: 'Enveloppe', qte: 34, prix_achat: 3000, prix_vente: 10000, categorie: 'Papeterie' },
  { nom: 'Chemises cartonnés élastique', qte: 38, prix_achat: 3000, prix_vente: 10000, categorie: 'Papeterie' },
  { nom: 'Papier ministre', qte: 51, prix_achat: 1500, prix_vente: 3000, categorie: 'Papeterie' },
  { nom: 'Papier opaque', qte: 9, prix_achat: 7000, prix_vente: 7000, categorie: 'Papeterie' },
  { nom: 'Papier photo', qte: 4, prix_achat: 7000, prix_vente: 100000, categorie: 'Impression' },
  { nom: 'Papier laminage', qte: 7, prix_achat: 6000, prix_vente: 18000, categorie: 'Impression' },
  { nom: 'Papier couverture reliure Transparent', qte: 23, prix_achat: 5000, prix_vente: 15000, categorie: 'Impression' },
  { nom: 'Papier sublimation', qte: 54, prix_achat: 4500, prix_vente: 4500, categorie: 'Impression' },
  { nom: 'Papier autocollant', qte: 7, prix_achat: 4000, prix_vente: 12000, categorie: 'Impression' },
  { nom: 'Papier PVC', qte: 2, prix_achat: 7000, prix_vente: 7000, categorie: 'Impression' },
  { nom: 'Badges', qte: 140, prix_achat: 3000, prix_vente: 9000, categorie: 'Accessoire' },
  { nom: 'Enveloppe invitation', qte: 91, prix_achat: 10000, prix_vente: 20000, categorie: 'Papeterie' },
  { nom: 'Enveloppe mariage', qte: 24, prix_achat: 10000, prix_vente: 20000, categorie: 'Papeterie' },
  { nom: 'Spirale', qte: 50, prix_achat: 2000, prix_vente: 4000, categorie: 'Reliure' },
  { nom: 'Rouleaux de flex', qte: 14, prix_achat: 25000, prix_vente: 140000, categorie: 'Impression' },
  { nom: 'Cover avec colle', qte: 6, prix_achat: 5000, prix_vente: 6000, categorie: 'Reliure' },
  { nom: 'Tasse simple', qte: 40, prix_achat: 800, prix_vente: 4000, categorie: 'Accessoire' },
  { nom: 'Tasse magique', qte: 36, prix_achat: 1000, prix_vente: 6000, categorie: 'Accessoire' },
  { nom: 'Papier RAM', qte: 11, prix_achat: 5000, prix_vente: 5000, categorie: 'Papeterie' },
  { nom: 'Casquettes', qte: 33, prix_achat: 1000, prix_vente: 2000, categorie: 'Accessoire' },
  { nom: 'Polo orange asiatique', qte: 68, prix_achat: 2000, prix_vente: 6000, categorie: 'Textile' },
  { nom: 'Polo bleu asiatique', qte: 76, prix_achat: 2000, prix_vente: 6000, categorie: 'Textile' },
  { nom: 'Polo Rose asiatique', qte: 19, prix_achat: 2000, prix_vente: 6000, categorie: 'Textile' },
  { nom: 'Polo noir asiatique', qte: 23, prix_achat: 2000, prix_vente: 6000, categorie: 'Textile' },
  { nom: 'Polo vert asiatique', qte: 7, prix_achat: 2000, prix_vente: 6000, categorie: 'Textile' },
  { nom: 'Polo blanc asiatique', qte: 10, prix_achat: 2000, prix_vente: 6000, categorie: 'Textile' },
  { nom: 'Tee-shirt vert', qte: 73, prix_achat: 1200, prix_vente: 4000, categorie: 'Textile' },
  { nom: 'Tee-shirt Rose', qte: 83, prix_achat: 1200, prix_vente: 4000, categorie: 'Textile' },
  { nom: 'Tee-shirt Noir', qte: 70, prix_achat: 1200, prix_vente: 4000, categorie: 'Textile' },
  { nom: 'Tee-shirt Bleu', qte: 76, prix_achat: 1200, prix_vente: 4000, categorie: 'Textile' },
  { nom: 'Tee-shirt violet', qte: 100, prix_achat: 1200, prix_vente: 4000, categorie: 'Textile' },
  { nom: 'Tee-shirt blanc adulte', qte: 103, prix_achat: 1200, prix_vente: 3000, categorie: 'Textile' },
  { nom: 'Tee-shirt blanc Enfant', qte: 115, prix_achat: 1200, prix_vente: 3000, categorie: 'Textile' },
];

export const MACHINES = [
  { nom: 'Imprimante Canon G3430 Series', qte: 1, valeur: 120000, categorie: 'Machine' },
  { nom: 'Imprimante Canon MF3414', qte: 1, valeur: 300000, categorie: 'Machine' },
  { nom: 'Imprimante EPSON L8050', qte: 1, valeur: 210000, categorie: 'Machine' },
  { nom: 'Ordinateur LENOVO 1000GB', qte: 1, valeur: 170000, categorie: 'Machine' },
  { nom: 'Ordinateur de bureau HP', qte: 2, valeur: 200000, categorie: 'Machine' },
];

// Financial summary from Excel
export const FINANCIAL_SUMMARY = {
  valeur_stock_achat: 6643800,
  valeur_stock_vente: 16880500,
  cash_en_compte: 2800000,
  cash_en_caisse: 300000,
  dette_totale: 3560000,
  valeur_imprimerie_achat: 6183800,
  valeur_imprimerie_vente: 16420500,
};

// Investisseurs
export const INVESTISSEURS = {
  oumar: {
    nom: 'Abakar Senoussi (Oumar)',
    investissement_initial: 3000000,
    frais_voyage_chine: 1965000,
    reinvestissement_marchandises: 2000000,
    apport_supplementaire: 1000000,
    total_investi: 7965000,
    pourcentage_final: 76.11,
  },
  senouss: {
    nom: 'Senoussi Saleh',
    investissement_initial: 2500000,
    total_investi: 2500000,
    pourcentage_final: 23.89,
  },
  total_investissement: 10465000,
};

/**
 * Chantier « Construction Papeterie » — amorce une seule fois.
 *
 * L'idempotence par nom de projet etait deja bonne ; c'est la lecture qui ne
 * l'etait pas. `list()` rend `[]` sur un echec, donc `some(...)` valait faux et
 * un second chantier — plus ses 5 etapes — aurait ete cree. Mesure du
 * 2026-09-17 : `projets_travaux` compte 1 ligne et `etapes_travaux` n'a rien
 * recu depuis le 09/03, donc CE rejeu-la n'a jamais eu lieu (la collection est
 * minuscule : sa lecture n'a pas echoue). La garde reste corrigee malgre tout —
 * « ca n'est pas encore arrive » n'est pas « ca ne peut pas arriver ».
 */
export async function seedPapeterieProject() {
  // Lecture qui LEVE : un echec de reseau ne doit pas passer pour « aucun projet ».
  const existing = await db.projets_travaux.listOuLeve();
  if (existing.some((p) => p.nom === 'Construction Papeterie')) {
    return { status: 'already_seeded' };
  }

  const totalMateriaux = DEPENSES_CHANTIER.reduce((s, d) => s + d.total, 0);
  const totalMainOeuvre = DEPENSES_CHANTIER.reduce((s, d) => s + d.main_oeuvre, 0);
  const totalDepense = totalMateriaux + totalMainOeuvre;

  const projet = await db.projets_travaux.create({
    nom: 'Construction Papeterie',
    description: 'Travaux de construction du local papeterie — maçonnerie, toiture, aménagement',
    categorie: 'construction',
    statut: 'en_cours',
    budget_prevu: 1035000,
    budget_depense: totalDepense,
    date_debut: '2026-01-06',
    date_fin_prevue: '2026-04-30',
    responsable: 'Oumar',
  });

  // Create étapes from depenses
  const etapesData = [
    { nom: 'Fondation & Sable', statut: 'terminee', budget: 150000 },
    { nom: 'Briques & Maçonnerie', statut: 'terminee', budget: 272000 },
    { nom: 'Poteaux & Structure', statut: 'terminee', budget: 94000 },
    { nom: 'Toiture (Tôles, Chevrons, Lattes)', statut: 'en_cours', budget: 250000 },
    { nom: 'Finitions (Planches, Pointes)', statut: 'en_attente', budget: 15500 },
  ];

  for (const etape of etapesData) {
    await db.etapes_travaux.create({
      projet_id: projet.id,
      ...etape,
      date_debut: etape.statut !== 'en_attente' ? '2026-01-10' : '',
    });
  }

  return { status: 'seeded', projet_id: projet.id, total_depense: totalDepense };
}

/**
 * Inventaire Excel de janvier 2026 → `produits_catalogue`.
 *
 * ⚠️ C'EST CETTE FONCTION QUI A LE PLUS REJOUE, ET ELLE A REJOUE AUJOURD'HUI.
 *
 * Mesure du 2026-09-17 sur bcwkrrqmjpaohmafcncw : `produits_catalogue` porte
 * 195 lignes pour ~45 articles reels — « Tee-shirt blanc KAF enfant » y figure
 * 10 fois, « Polo blanc » 8 fois. Les 45 lignes de cet inventaire ont ete
 * reecrites en bloc le 18/08 a 09:09, le 12/09 a 15:59 et le 17/09 a 06:52.
 *
 * L'ancienne garde lisait la collection ENTIERE pour repondre a « y a-t-il plus
 * de 5 lignes ? ». Cette collection pese 20 Mo (une ligne atteint 3,2 Mo
 * d'images en base64). Sur la connexion de Moanda, cette lecture expire ;
 * `list()` rend alors `[]`, `0 > 5` est faux, et 45 lignes de plus sont
 * ecrites — ce qui alourdit la lecture du demarrage suivant. Une boucle qui
 * s'auto-entretient : 13 lignes le 07/03, 195 aujourd'hui.
 *
 * `compterOuLeve()` repond a la meme question en quelques octets, et LEVE au
 * lieu d'inventer un zero.
 *
 * A noter, mesure faite : sur une installation neuve, `seedCatalogue()` ecrit
 * 13 produits AVANT que cette fonction ne s'execute — la garde est donc
 * toujours vraie et cet inventaire n'a JAMAIS ete amorce legitimement. Ses
 * seuls effets en production ont ete des doublons. Le supprimer serait le geste
 * propre ; c'est une decision produit, pas un nettoyage technique.
 */
export async function seedInventaire() {
  if (await db.produits_catalogue.compterOuLeve() > 5) return { status: 'already_seeded' };

  for (const item of INVENTAIRE_STOCK) {
    await db.produits_catalogue.create({
      nom: item.nom,
      categorie: item.categorie,
      prix_unitaire: item.prix_vente,
      prix_achat: item.prix_achat,
      stock_actuel: item.qte,
      stock_minimum: Math.max(5, Math.round(item.qte * 0.1)),
      unite: 'pièce',
      actif: true,
    });
  }

  for (const machine of MACHINES) {
    await db.produits_catalogue.create({
      nom: machine.nom,
      categorie: machine.categorie,
      prix_unitaire: machine.valeur,
      prix_achat: machine.valeur,
      stock_actuel: machine.qte,
      stock_minimum: 1,
      unite: 'unité',
      actif: true,
    });
  }

  return { status: 'seeded', count: INVENTAIRE_STOCK.length + MACHINES.length };
}
