import { db } from './db';
import { hashPassword, generateSalt } from './crypto';

const SEED_KEY = 'io_seeded_v6';

const EMPLOYES = [
  { nom: 'Admin', prenom: 'Imprimerie', email: 'imprimerieogooue@gmail.com', role: 'admin', poste: 'Directeur Général', password: 'Pv11072023*' },
  { nom: 'Moussavou', prenom: 'Jean-Pierre', email: 'jp.moussavou@imprimerie-ogooue.ga', role: 'manager', poste: 'Responsable production', password: 'Manager2024!' },
  { nom: 'Nzé', prenom: 'Marie', email: 'marie.nze@imprimerie-ogooue.ga', role: 'manager', poste: 'Responsable commerciale', password: 'Manager2024!' },
  { nom: 'Obiang', prenom: 'Patrick', email: 'patrick.obiang@imprimerie-ogooue.ga', role: 'employe', poste: 'Opérateur', password: 'Employe2024!' },
  { nom: 'Mba', prenom: 'Estelle', email: 'estelle.mba@imprimerie-ogooue.ga', role: 'employe', poste: 'Opératrice', password: 'Employe2024!' },
  { nom: 'Ndong', prenom: 'Samuel', email: 'samuel.ndong@imprimerie-ogooue.ga', role: 'employe', poste: 'Technicien', password: 'Employe2024!' },
];

const CLIENTS = [
  { nom: 'Ministère de l\'Éducation', email: 'contact@education.gouv.ga', telephone: '+241 01 72 00 00', type: 'entreprise' },
  { nom: 'Total Energies Gabon', email: 'bureau.lbv@totalenergies.ga', telephone: '+241 01 76 50 00', type: 'entreprise' },
  { nom: 'Cabinet Avocat Biveghe', email: 'biveghe.avocat@gmail.com', telephone: '+241 077 50 12 34', type: 'entreprise' },
  { nom: 'Ngoubou Albert', email: 'albert.ngoubou@gmail.com', telephone: '+241 066 78 90 12', type: 'particulier' },
  { nom: 'ONG Croissance Saine', email: 'info@croissancesaine.org', telephone: '+241 011 44 55 66', type: 'entreprise' },
];

const PRODUITS = [
  { nom: 'Rame papier A4 (80g)', categorie: 'Papeterie', prix_vente: 3500, stock: 120, stock_min: 20 },
  { nom: 'Rame papier A3 (80g)', categorie: 'Papeterie', prix_vente: 6000, stock: 45, stock_min: 10 },
  { nom: 'Cartouche encre noire', categorie: 'Consommables', prix_vente: 25000, stock: 8, stock_min: 3 },
  { nom: 'Cartouche encre couleur', categorie: 'Consommables', prix_vente: 35000, stock: 5, stock_min: 3 },
  { nom: 'Pochette plastification A4', categorie: 'Consommables', prix_vente: 500, stock: 200, stock_min: 50 },
  { nom: 'Badge vierge PVC', categorie: 'Badges', prix_vente: 1500, stock: 150, stock_min: 30 },
  { nom: 'Papier photo 10x15', categorie: 'Photo', prix_vente: 200, stock: 500, stock_min: 100 },
  { nom: 'Clé USB 16Go', categorie: 'Accessoires', prix_vente: 5000, stock: 15, stock_min: 5 },
];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateRapports(employeIds) {
  const rapports = [];
  for (let i = 1; i < 90; i += randomInt(1, 3)) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    if (d.getDay() === 0) continue;
    const date = d.toISOString().split('T')[0];
    const operateur = employeIds[randomInt(0, employeIds.length - 1)];
    rapports.push({
      date,
      operateur_id: operateur.id,
      operateur_nom: `${operateur.prenom} ${operateur.nom}`,
      statut: 'valide',
      categories: {
        copies: randomInt(8000, 55000),
        marchandises: randomInt(0, 20000),
        scan: randomInt(1000, 10000),
        tirage_saisies: randomInt(3000, 25000),
        badges_plastification: randomInt(0, 15000),
        demi_photos: randomInt(0, 6000),
        maintenance: randomInt(0, 4000),
        imprimerie: randomInt(8000, 60000),
      },
      depenses: [
        { description: 'Achat rames papier', montant: randomInt(5000, 25000) },
        ...(Math.random() > 0.4
          ? [{ description: 'Transport livraison', montant: randomInt(2000, 10000) }]
          : []),
        ...(Math.random() > 0.7
          ? [{ description: 'Maintenance machine', montant: randomInt(5000, 30000) }]
          : []),
      ],
    });
  }
  return rapports;
}

export async function seedDatabase() {
  if (localStorage.getItem(SEED_KEY)) return;

  // Clear old seed data if upgrading
  const oldKeys = ['io_seeded_v1', 'io_seeded_v2', 'io_seeded_v3', 'io_seeded_v4', 'io_seeded_v5'];
  const hadOldSeed = oldKeys.some((k) => localStorage.getItem(k));
  if (hadOldSeed) {
    ['io_employes', 'io_clients', 'io_produits', 'io_rapports', 'io_pointages',
     'io_clotures_caisse', 'io_audit_logs'].forEach((k) =>
      localStorage.removeItem(k),
    );
    oldKeys.forEach((k) => localStorage.removeItem(k));
  }

  // Create employees with hashed passwords
  const createdEmployes = [];
  for (const e of EMPLOYES) {
    const salt = generateSalt();
    const hash = await hashPassword(e.password, salt);
    const created = await db.employes.create({
      nom: e.nom,
      prenom: e.prenom,
      email: e.email,
      role: e.role,
      poste: e.poste,
      password_hash: hash,
      password_salt: salt,
      password_changed_at: new Date().toISOString(),
    });
    createdEmployes.push(created);
  }

  for (const c of CLIENTS) {
    await db.clients.create(c);
  }

  for (const p of PRODUITS) {
    await db.produits.create(p);
  }

  const rapports = generateRapports(createdEmployes);
  for (const r of rapports) {
    await db.rapports.create(r);
  }

  // Seed pointage data for the last 30 days
  for (let i = 1; i < 31; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    if (d.getDay() === 0) continue;
    const dateStr = d.toISOString().split('T')[0];
    for (const emp of createdEmployes) {
      if (emp.role === 'admin') continue;
      if (Math.random() > 0.85) continue;
      const hArrivee = 7 + randomInt(0, 1);
      const mArrivee = randomInt(0, 45);
      const hDepart = 16 + randomInt(0, 2);
      const mDepart = randomInt(0, 59);
      await db.pointages.create({
        employe_id: emp.id,
        employe_nom: `${emp.prenom} ${emp.nom}`,
        date: dateStr,
        heure_arrivee: `${String(hArrivee).padStart(2, '0')}:${String(mArrivee).padStart(2, '0')}`,
        heure_depart: `${String(hDepart).padStart(2, '0')}:${String(mDepart).padStart(2, '0')}`,
        statut: 'present',
      });
    }
  }

  // Seed clôtures de caisse for the last 14 working days
  const allRapports = await db.rapports.list();
  const rapportsByDate = {};
  for (const r of allRapports) {
    if (!rapportsByDate[r.date]) rapportsByDate[r.date] = [];
    rapportsByDate[r.date].push(r);
  }

  const operators = createdEmployes.filter((e) => e.role !== 'admin');
  const sortedDates = Object.keys(rapportsByDate).sort().reverse().slice(0, 14);
  for (const date of sortedDates) {
    const dayRapports = rapportsByDate[date];
    const recettes = dayRapports.reduce(
      (s, r) => s + Object.values(r.categories || {}).reduce((a, v) => a + (v || 0), 0), 0
    );
    const depenses = dayRapports.reduce(
      (s, r) => s + (r.depenses || []).reduce((a, d) => a + (d.montant || 0), 0), 0
    );
    const attendu = recettes - depenses;
    const variance = Math.round(attendu * (Math.random() * 0.03 - 0.02));
    const reel = attendu + variance;
    const ecart = reel - attendu;
    const op = operators[randomInt(0, operators.length - 1)];
    const statut = Math.abs(ecart) < 1000 ? 'ok' : Math.abs(ecart) < 5000 ? 'ecart_mineur' : 'ecart_majeur';
    await db.clotures_caisse.create({
      date,
      employe_id: op.id,
      employe_nom: `${op.prenom} ${op.nom}`,
      montant_attendu: attendu,
      montant_reel: reel,
      ecart,
      commentaire: statut === 'ok' ? '' : 'Écart constaté, vérification en cours',
      statut,
      valide_par: statut !== 'ok' ? 'Imprimerie Admin' : '',
    });
  }

  // Seed some audit logs
  const actions = [
    { action: 'create', module: 'commandes', details: 'Création commande CMD-0012', entity_label: 'CMD-0012' },
    { action: 'update', module: 'rapports', details: 'Modification rapport du 02/03/2026', entity_label: 'Rapport 02/03' },
    { action: 'cancel', module: 'factures', details: 'Annulation facture FAC-0003 — Motif: erreur de saisie', entity_label: 'FAC-0003' },
    { action: 'create', module: 'devis', details: 'Création devis DEV-0008', entity_label: 'DEV-0008' },
    { action: 'cloture', module: 'cloture_caisse', details: 'Clôture de caisse — écart: -1 200 F', entity_label: 'Clôture 01/03' },
    { action: 'update', module: 'stocks', details: 'Entrée stock: +50 Rame papier A4', entity_label: 'Rame papier A4' },
    { action: 'create', module: 'clients', details: 'Nouveau client: Pharmacie du Centre', entity_label: 'Pharmacie du Centre' },
    { action: 'cancel', module: 'commandes', details: 'Annulation commande CMD-0009 — Motif: client a annulé', entity_label: 'CMD-0009' },
  ];
  for (let i = 0; i < actions.length; i++) {
    const d = new Date();
    d.setDate(d.getDate() - randomInt(0, 10));
    d.setHours(randomInt(8, 17), randomInt(0, 59));
    const emp = createdEmployes[randomInt(0, createdEmployes.length - 1)];
    await db.audit_logs.create({
      timestamp: d.toISOString(),
      user_id: emp.id,
      user_nom: `${emp.prenom} ${emp.nom}`,
      ...actions[i],
      entity_id: crypto.randomUUID(),
      metadata: {},
    });
  }

  // Seed default settings with correct company info
  const existingSettings = localStorage.getItem('io_settings');
  if (!existingSettings || existingSettings === '{}') {
    localStorage.setItem('io_settings', JSON.stringify({
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
    }));
  }

  localStorage.setItem(SEED_KEY, 'true');
}
