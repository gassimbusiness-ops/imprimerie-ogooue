/**
 * Loads Excel-imported data from /import-data.json into localStorage.
 * Called once on app boot — idempotent via a flag.
 */
import { db } from './db';

const IMPORT_KEY = 'io_excel_imported_v1';

export async function loadImportedData() {
  if (localStorage.getItem(IMPORT_KEY)) return;

  try {
    const resp = await fetch('/import-data.json');
    if (!resp.ok) return; // File doesn't exist yet — that's fine
    const data = await resp.json();

    if (data.rapports?.length) {
      // Avoid duplicates: check existing dates
      const existing = await db.rapports.list();
      const existingDates = new Set(existing.map((r) => r.date));

      for (const r of data.rapports) {
        if (!existingDates.has(r.date)) {
          await db.rapports.create(r);
        }
      }
    }

    if (data.produits?.length) {
      const existing = await db.produits.list();
      const existingNames = new Set(existing.map((p) => p.nom.toLowerCase()));

      for (const p of data.produits) {
        if (!existingNames.has(p.nom.toLowerCase())) {
          await db.produits.create(p);
        }
      }
    }

    localStorage.setItem(IMPORT_KEY, new Date().toISOString());
    console.log('✅ Données Excel importées dans l\'app');
  } catch {
    // Silently fail — import-data.json not available yet
  }
}
