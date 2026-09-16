/**
 * Synchronisation Commande → Rapport Journalier.
 *
 * ⚠️ DESACTIVEE PAR DEFAUT — voir src/services/reprise-rapport.js pour le
 * raisonnement complet (double comptage avec la saisie manuelle d'Ibrahim,
 * mesure du rapport du 2026-03-16, absence de trace d'origine, piege de fuseau).
 *
 * Ce fichier ne contient plus que le branchement a la base ; toute la decision
 * est prise par `decisionReprise()`, qui est pure et testee.
 */
import { db } from './db';
import { todayISO } from '@/lib/dates';
import { decisionReprise, REPRISE_AUTO_RAPPORT } from './reprise-rapport';

/**
 * @param {object} commande
 * @returns {Promise<{action: string, motif: string}>}
 * @throws en cas d'echec d'ecriture — l'appelant (handleStatutChange) le
 *         compte comme un effet manque et ne pose pas `livraison_traitee`.
 */
export async function syncCommandeToRapport(commande) {
  // Sortie immediate quand l'interrupteur est ferme : aucune lecture, aucune
  // ecriture, donc aucun cout ni aucun risque.
  if (!REPRISE_AUTO_RAPPORT) {
    const d = decisionReprise({ commande, rapportDuJour: null, date: todayISO() });
    console.info(`[SYNC] rapport journalier non modifié — ${d.motif}`);
    return d;
  }

  // `todayISO()` et non `toISOString()` : entre 00 h et 01 h heure de Libreville,
  // la seconde forme visait la veille — journee souvent deja cloturee.
  const date = todayISO();
  const rapports = await db.rapports.list();
  const rapportDuJour = rapports.find((r) => r.date === date) || null;

  const decision = decisionReprise({ commande, rapportDuJour, date });

  if (decision.action === 'creer') {
    await db.rapports.create({
      ...decision.patch,
      historique_statuts: [
        { statut: 'brouillon', date: new Date().toISOString(), auteur: 'Système' },
      ],
    });
  } else if (decision.action === 'ajouter') {
    await db.rapports.update(rapportDuJour.id, decision.patch);
  }

  console.info(`[SYNC] commande ${commande?.numero || commande?.id} → rapport ${date} : ${decision.motif}`);
  return decision;
}
