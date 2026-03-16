/**
 * Synchronisation Commande → Rapport Journalier
 *
 * Quand une commande passe au statut "Livrée", son montant est automatiquement
 * ajouté au rapport journalier du jour (catégorie "imprimerie").
 * Si aucun rapport n'existe pour aujourd'hui, il est créé automatiquement.
 */
import { db } from './db';

export async function syncCommandeToRapport(commande) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const montant = commande.montant_total || commande.total || 0;
    if (montant <= 0) return;

    // Chercher le rapport du jour
    const allRapports = await db.rapports.list();
    const rapportDuJour = allRapports.find((r) => r.date === today);

    if (!rapportDuJour) {
      // Créer un nouveau rapport pour aujourd'hui
      await db.rapports.create({
        date: today,
        operateur_id: 'system',
        operateur_nom: 'Système (auto)',
        categories: {
          copies: 0,
          marchandises: 0,
          scan: 0,
          tirage_saisies: 0,
          badges_plastification: 0,
          demi_photos: 0,
          maintenance: 0,
          imprimerie: montant,
        },
        depenses: [],
        statut: 'brouillon',
        historique_statuts: [
          { statut: 'brouillon', date: new Date().toISOString(), auteur: 'Système' },
        ],
        notes: `Auto-généré — Commande ${commande.numero || ''} livrée (${montant} F)`,
      });
    } else {
      // Mettre à jour le rapport existant — ajouter au montant imprimerie
      const cats = rapportDuJour.categories || {};
      const newImp = (cats.imprimerie || 0) + montant;
      await db.rapports.update(rapportDuJour.id, {
        categories: {
          ...cats,
          imprimerie: newImp,
        },
        notes: (rapportDuJour.notes || '') + `\n+ Commande ${commande.numero || ''} livrée (${montant} F)`,
      });
    }

    console.log(`[SYNC] Commande ${commande.numero} → Rapport du ${today} (+${montant} F)`);
  } catch (err) {
    console.error('[SYNC] Erreur syncCommandeToRapport:', err);
  }
}
