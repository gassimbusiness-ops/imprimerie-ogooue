/**
 * Script d'importation des fichiers Excel historiques vers localStorage JSON.
 *
 * Usage: node scripts/import-excel.js
 *
 * Fichiers attendus dans ~/Downloads/:
 *  - "Rapport journalier-BON (1).xlsx" -> rapports journaliers (500+ feuilles)
 *  - "INVENTAIRE IMPRIMERIE.xlsx" -> produits & machines
 *  - "DEPENSES CHANTIER PAPETERIE.xlsx" -> dépenses chantier
 *
 * Produit: scripts/import-data.json (à charger côté client)
 */

import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';

// xlsx is a devDependency
const XLSX = await import('xlsx');

const DOWNLOADS = resolve(process.env.HOME, 'Downloads');
const OUTPUT = resolve(import.meta.dirname, '..', 'public', 'import-data.json');

// ─── Column header normalization ────────────────────────────
// The Excel headers evolved over 3 years. We normalize them all to our 8 categories.
const HEADER_MAP = {
  copies: ['copies', 'copie', 'photocopies', 'photocopie'],
  marchandises: ['marchandises', 'marchandise', 'chemise cartonné', 'chemise cartonne', 'chemises'],
  scan: ['scan', 'scans', 'scanner'],
  tirage_saisies: ['tirage/saisies', 'tirage / saisies', 'tirage', 'saisies', 'tirage saisies', 'tirage/saisie'],
  badges_plastification: ['badges/plastification', 'badges / plastification', 'badges', 'plastification', 'badges/plastif', 'badge/plastification'],
  demi_photos: ['demi-photos', 'demi photos', 'demi photo', 'demi-photo', 'photos'],
  maintenance: ['maintenance', 'entretien'],
  imprimerie: ['imprimerie', 'impression'],
};

function normalizeHeader(raw) {
  if (!raw) return null;
  const lower = String(raw).trim().toLowerCase().replace(/\s+/g, ' ');
  for (const [key, variants] of Object.entries(HEADER_MAP)) {
    if (variants.some((v) => lower === v || lower.includes(v))) return key;
  }
  if (lower === 'sorties' || lower === 'description') return lower;
  return null;
}

// ─── Parse date from sheet name ─────────────────────────────
function parseSheetDate(name) {
  // Formats: "01-07-23", "01-07-2023", "1-7-23", "01.07.23", "01/07/23"
  const cleaned = name.trim().replace(/\./g, '-').replace(/\//g, '-');
  const m = cleaned.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
  if (!m) return null;
  let [, day, month, year] = m;
  day = parseInt(day, 10);
  month = parseInt(month, 10);
  year = parseInt(year, 10);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}

// ─── Import daily reports ───────────────────────────────────
async function importRapports() {
  const filePath = resolve(DOWNLOADS, 'Rapport journalier-BON (1).xlsx');
  console.log(`📖 Reading: ${filePath}`);

  let buf;
  try {
    buf = await readFile(filePath);
  } catch {
    console.log('⚠️  Rapport journalier not found, skipping');
    return [];
  }

  const wb = XLSX.read(buf, { type: 'buffer' });
  const rapports = [];
  let skipped = 0;

  for (const sheetName of wb.SheetNames) {
    const date = parseSheetDate(sheetName);
    if (!date) {
      skipped++;
      continue;
    }

    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (rows.length < 5) {
      skipped++;
      continue;
    }

    // Find header row (usually row 3, index 3)
    let headerRowIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 8); i++) {
      const rowStr = rows[i].map((c) => String(c).toLowerCase()).join(' ');
      if (rowStr.includes('copies') || rowStr.includes('marchandise') || rowStr.includes('imprimerie')) {
        headerRowIdx = i;
        break;
      }
    }
    if (headerRowIdx === -1) {
      skipped++;
      continue;
    }

    // Map column indices to our categories
    const colMap = {};
    let sortiesCol = -1;
    let descCol = -1;
    for (let c = 0; c < rows[headerRowIdx].length; c++) {
      const norm = normalizeHeader(rows[headerRowIdx][c]);
      if (norm === 'sorties') sortiesCol = c;
      else if (norm === 'description') descCol = c;
      else if (norm) colMap[norm] = c;
    }

    // Sum each category from data rows
    const categories = {
      copies: 0, marchandises: 0, scan: 0, tirage_saisies: 0,
      badges_plastification: 0, demi_photos: 0, maintenance: 0, imprimerie: 0,
    };
    const depenses = [];

    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length === 0) continue;

      // Check if this is a total/summary row (skip it)
      const firstCell = String(row[0] || '').toLowerCase().trim();
      if (firstCell.includes('total') || firstCell.includes('caisse') || firstCell === '') {
        // If empty first cell but has values, still process
        if (firstCell.includes('total') || firstCell.includes('caisse')) continue;
      }

      // Sum category values
      for (const [cat, col] of Object.entries(colMap)) {
        const val = parseFloat(String(row[col] || '0').replace(/\s/g, '').replace(/,/g, '.'));
        if (!isNaN(val) && val > 0) {
          categories[cat] += Math.round(val);
        }
      }

      // Capture expenses (SORTIES column)
      if (sortiesCol >= 0) {
        const sortieVal = parseFloat(String(row[sortiesCol] || '0').replace(/\s/g, '').replace(/,/g, '.'));
        if (!isNaN(sortieVal) && sortieVal > 0) {
          const desc = descCol >= 0 ? String(row[descCol] || 'Dépense').trim() : 'Dépense';
          depenses.push({ description: desc || 'Dépense', montant: Math.round(sortieVal) });
        }
      }
    }

    // Only add if there's actual data
    const totalRec = Object.values(categories).reduce((s, v) => s + v, 0);
    if (totalRec > 0 || depenses.length > 0) {
      rapports.push({
        date,
        operateur_nom: 'Importé Excel',
        statut: 'valide',
        categories,
        depenses,
        source: 'excel_import',
      });
    }
  }

  console.log(`✅ Rapports: ${rapports.length} importés, ${skipped} feuilles ignorées`);
  return rapports;
}

// ─── Import inventory ───────────────────────────────────────
async function importInventaire() {
  const filePath = resolve(DOWNLOADS, 'INVENTAIRE IMPRIMERIE.xlsx');
  console.log(`📖 Reading: ${filePath}`);

  let buf;
  try {
    buf = await readFile(filePath);
  } catch {
    console.log('⚠️  Inventaire not found, skipping');
    return [];
  }

  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  const produits = [];
  // Find header row
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const rowStr = rows[i].map((c) => String(c).toLowerCase()).join(' ');
    if (rowStr.includes('designation') || rowStr.includes('désignation')) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1) {
    console.log('⚠️  No header found in inventaire');
    return [];
  }

  // Map headers
  const headers = rows[headerIdx].map((h) => String(h).toLowerCase().trim());
  const desigCol = headers.findIndex((h) => h.includes('designation') || h.includes('désignation'));
  const qteCol = headers.findIndex((h) => h === 'qte' || h === 'quantité' || h === 'quantite' || h.includes('qte'));
  const prixAchatCol = headers.findIndex((h, idx) => (h.includes('prix unitaire') || h.includes('prix u')) && idx < 4);
  const prixVenteCol = headers.findIndex((h, idx) => (h.includes('prix unitaire') || h.includes('prix u')) && idx > 3);

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    const nom = String(row[desigCol] || '').trim();
    if (!nom || nom.toLowerCase().includes('total')) continue;

    const stock = parseInt(String(row[qteCol] || '0').replace(/\s/g, ''), 10) || 0;
    const prixVente = parseInt(String(row[prixVenteCol >= 0 ? prixVenteCol : prixAchatCol] || '0').replace(/\s/g, ''), 10) || 0;

    produits.push({
      nom,
      categorie: 'Inventaire Excel',
      stock,
      stock_min: Math.max(1, Math.round(stock * 0.15)),
      prix_vente: prixVente,
      source: 'excel_import',
    });
  }

  console.log(`✅ Produits: ${produits.length} importés`);
  return produits;
}

// ─── Import construction expenses ───────────────────────────
async function importDepensesChantier() {
  const filePath = resolve(DOWNLOADS, 'DEPENSES CHANTIER PAPETERIE.xlsx');
  console.log(`📖 Reading: ${filePath}`);

  let buf;
  try {
    buf = await readFile(filePath);
  } catch {
    console.log('⚠️  Dépenses chantier not found, skipping');
    return [];
  }

  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  const depenses = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length < 3) continue;

    // Columns: Maçon, Date, Matériels, QTE, PRIX, TOTAL, PAYER/NON PAYER
    const macon = parseFloat(String(row[0] || '0').replace(/\s/g, '')) || 0;
    let dateVal = row[1];
    // Handle Excel serial dates
    if (typeof dateVal === 'number') {
      const d = new Date((dateVal - 25569) * 86400000);
      dateVal = d.toISOString().split('T')[0];
    } else {
      dateVal = String(dateVal || '').trim();
    }
    const materiel = String(row[2] || '').trim();
    const qte = parseFloat(String(row[3] || '0').replace(/\s/g, '')) || 0;
    const prix = parseFloat(String(row[4] || '0').replace(/\s/g, '')) || 0;
    const total = parseFloat(String(row[5] || '0').replace(/\s/g, '')) || prix * qte;
    const paye = String(row[6] || '').toLowerCase().includes('non') ? false : true;

    if (macon > 0 || total > 0 || materiel) {
      depenses.push({
        date: dateVal,
        macon_montant: Math.round(macon),
        materiel,
        quantite: qte,
        prix_unitaire: Math.round(prix),
        total: Math.round(total),
        paye,
        source: 'excel_import',
      });
    }
  }

  console.log(`✅ Dépenses chantier: ${depenses.length} importées`);
  return depenses;
}

// ─── Main ───────────────────────────────────────────────────
async function main() {
  console.log('🚀 Import des fichiers Excel...\n');

  const [rapports, produits, depensesChantier] = await Promise.all([
    importRapports(),
    importInventaire(),
    importDepensesChantier(),
  ]);

  const data = {
    rapports,
    produits,
    depenses_chantier: depensesChantier,
    imported_at: new Date().toISOString(),
    stats: {
      rapports_count: rapports.length,
      produits_count: produits.length,
      depenses_count: depensesChantier.length,
      date_range: rapports.length > 0
        ? { min: rapports.reduce((m, r) => r.date < m ? r.date : m, rapports[0].date),
            max: rapports.reduce((m, r) => r.date > m ? r.date : m, rapports[0].date) }
        : null,
    },
  };

  // Ensure public dir exists
  const { mkdirSync } = await import('fs');
  try { mkdirSync(resolve(import.meta.dirname, '..', 'public'), { recursive: true }); } catch {}

  await writeFile(OUTPUT, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`\n📦 Fichier produit: ${OUTPUT}`);
  console.log(`   Rapports: ${data.stats.rapports_count}`);
  console.log(`   Produits: ${data.stats.produits_count}`);
  console.log(`   Dépenses chantier: ${data.stats.depenses_count}`);
  if (data.stats.date_range) {
    console.log(`   Période: ${data.stats.date_range.min} → ${data.stats.date_range.max}`);
  }
  console.log('\n✅ Terminé ! Le fichier sera chargé automatiquement par l\'app.');
}

main().catch(console.error);
