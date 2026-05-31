/**
 * Service de prelevement automatique des charges fixes recurrentes.
 *
 * Logique metier (cf. spec D.2 Option A):
 * - Une charge fixe avec prelevement_auto=true est active tant que actif!=false.
 * - Chaque periode (mensuelle / trimestrielle / annuelle), a la date prochaine_echeance, on:
 *    1. cree un mouvement_financier de type 'sortie' sur le compte_id de la charge
 *    2. decremente le solde du compte source (LIQUIDE ARGENT Hebdo, BGFI, FINAM, etc.)
 *    3. avance prochaine_echeance de +N mois selon periodicite
 *
 * Idempotence: on stocke dans mouvement.reference = `charge:<charge.id>:<echeance>`
 * pour ne jamais doubler un prelevement deja effectue.
 *
 * Le service rattrape toutes les echeances dues (peut traiter plusieurs mois en retard
 * en une seule passe). Il est idempotent : safe de l'appeler plusieurs fois.
 *
 * S'inspire de credit-mensualites.js (meme pattern, eprouve sur le credit FINAM).
 */
import { db } from '@/services/db';

const PERIODICITE_MOIS = {
  mensuelle: 1,
  trimestrielle: 3,
  annuelle: 12,
};

function avanceEcheance(currentDateStr, periodicite = 'mensuelle', jourPrelevement = 5) {
  const d = new Date(currentDateStr);
  if (isNaN(d.getTime())) return '';
  const incMois = PERIODICITE_MOIS[periodicite] || 1;
  d.setMonth(d.getMonth() + incMois);
  d.setDate(Math.min(Number(jourPrelevement) || 5, 28));
  return d.toISOString().slice(0, 10);
}

/**
 * Execute les prelevements de charges fixes dues.
 * @param {Object} opts
 * @param {Date} [opts.today] - date de reference (defaut: maintenant)
 * @returns {Promise<{processed: Array, skipped: number, errors: Array}>}
 */
export async function executerChargesDues({ today = new Date() } = {}) {
  const todayStr = today.toISOString().slice(0, 10);
  const [charges, comptes, mouvements] = await Promise.all([
    db.charges_fixes.list(),
    db.comptes_bancaires.list(),
    db.mouvements_financiers.list(),
  ]);

  const processed = [];
  const errors = [];
  let skipped = 0;

  for (const charge of charges) {
    try {
      // Filtres : actif + auto + compte source + echeance + montant > 0
      if (charge.actif === false) { skipped++; continue; }
      if (!charge.prelevement_auto) { skipped++; continue; }
      if (!charge.compte_id) { skipped++; continue; }
      if (!charge.prochaine_echeance) { skipped++; continue; }
      const montant = Number(charge.montant) || 0;
      if (montant <= 0) { skipped++; continue; }

      const compte = comptes.find((c) => c.id === charge.compte_id);
      if (!compte) {
        errors.push({ charge: charge.libelle, error: 'Compte source introuvable' });
        continue;
      }

      let currentEcheance = charge.prochaine_echeance;
      let currentSoldeCompte = compte.solde || 0;
      const mouvementsCrees = [];
      const periodicite = charge.periodicite || 'mensuelle';

      // Boucle : rattrape toutes les echeances passees
      // (max 60 iterations = 5 ans de retard, garde-fou)
      let iter = 0;
      while (currentEcheance <= todayStr && iter < 60) {
        iter++;
        const reference = `charge:${charge.id}:${currentEcheance}`;

        // Idempotence : skip si deja preleve pour cette echeance
        const dejaPreleve = mouvements.some((m) => m.reference === reference);
        if (dejaPreleve) {
          currentEcheance = avanceEcheance(currentEcheance, periodicite, charge.jour_prelevement);
          continue;
        }

        // 1. Creer mouvement financier (sortie)
        const mvt = await db.mouvements_financiers.create({
          type: 'sortie',
          montant,
          description: `Charge fixe — ${charge.libelle}${charge.beneficiaire ? ` (${charge.beneficiaire})` : ''}`,
          compte_id: charge.compte_id,
          date: currentEcheance,
          reference,
          categorie: 'charge_fixe',
          source: 'auto_charge_fixe',
        });
        mouvementsCrees.push(mvt);

        // 2. Debit du compte
        currentSoldeCompte -= montant;

        // 3. Avance prochaine_echeance
        currentEcheance = avanceEcheance(currentEcheance, periodicite, charge.jour_prelevement);
      }

      if (mouvementsCrees.length > 0) {
        await db.comptes_bancaires.update(compte.id, { solde: currentSoldeCompte });
        await db.charges_fixes.update(charge.id, {
          prochaine_echeance: currentEcheance,
        });

        processed.push({
          charge: charge.libelle,
          echeances: mouvementsCrees.length,
          montant_total: mouvementsCrees.reduce((s, m) => s + (m.montant || 0), 0),
          compte: compte.nom,
        });
      } else {
        skipped++;
      }
    } catch (e) {
      errors.push({ charge: charge.libelle, error: e.message || String(e) });
    }
  }

  return { processed, skipped, errors };
}
