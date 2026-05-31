/**
 * Service de prelevement automatique des mensualites de credit.
 *
 * Logique metier (cf. spec FINAM):
 * - Une dette avec prelevement_auto=true est active tant que statut='actif' et montant_restant > 0.
 * - Chaque mois a la date prochaine_echeance, on:
 *    1. cree un mouvement_financier de type 'sortie' sur le compte_id de la dette
 *    2. decremente le solde du compte_id
 *    3. decremente le montant_restant de la dette du montant de la mensualite
 *    4. avance prochaine_echeance de +1 mois (cale sur jour_prelevement)
 *    5. si montant_restant <= 0 => statut='solde'
 *
 * Idempotence: on stocke dans mouvement.reference = `credit:<dette.id>:<echeance>`
 * pour ne jamais doubler un prelevement deja effectue.
 *
 * Le service rattrape toutes les echeances dues (peut traiter plusieurs mois en retard
 * en une seule passe). Il est idempotent : safe de l'appeler plusieurs fois.
 */
import { db } from '@/services/db';

function calcMensualite(montant_initial, taux_interet, duree_mois) {
  const m = Number(montant_initial) || 0;
  const t = Number(taux_interet) || 0;
  const d = Number(duree_mois) || 0;
  if (!m || !d) return 0;
  return Math.round((m * (1 + t / 100)) / d);
}

function nextEcheance(currentDateStr, jourPrelevement = 5) {
  const d = new Date(currentDateStr);
  if (isNaN(d.getTime())) return '';
  d.setMonth(d.getMonth() + 1);
  d.setDate(Math.min(Number(jourPrelevement) || 5, 28));
  return d.toISOString().slice(0, 10);
}

/**
 * Execute les prelevements dus.
 * @param {Object} opts
 * @param {Date} [opts.today] - date de reference (defaut: maintenant)
 * @returns {Promise<{processed: Array, skipped: number, errors: Array}>}
 */
export async function executerPrelevementsDus({ today = new Date() } = {}) {
  const todayStr = today.toISOString().slice(0, 10);
  const [dettes, comptes, mouvements] = await Promise.all([
    db.dettes.list(),
    db.comptes_bancaires.list(),
    db.mouvements_financiers.list(),
  ]);

  const processed = [];
  const errors = [];
  let skipped = 0;

  for (const dette of dettes) {
    try {
      // Filtres : actif + auto + compte source + echeance definie
      if (dette.statut === 'solde') { skipped++; continue; }
      if (dette.statut === 'suspendu') { skipped++; continue; }
      if (!dette.prelevement_auto) { skipped++; continue; }
      if (!dette.compte_id) { skipped++; continue; }
      if (!dette.prochaine_echeance) { skipped++; continue; }
      if ((dette.montant_restant || 0) <= 0) {
        await db.dettes.update(dette.id, { statut: 'solde' });
        skipped++;
        continue;
      }

      const compte = comptes.find((c) => c.id === dette.compte_id);
      if (!compte) {
        errors.push({ dette: dette.libelle, error: 'Compte source introuvable' });
        continue;
      }

      const mensualite = dette.mensualite_montant || calcMensualite(dette.montant_initial, dette.taux_interet, dette.duree_mois);
      if (!mensualite) {
        errors.push({ dette: dette.libelle, error: 'Mensualite invalide' });
        continue;
      }

      let currentEcheance = dette.prochaine_echeance;
      let currentRestant = dette.montant_restant || 0;
      let currentSoldeCompte = compte.solde || 0;
      const mouvementsCrees = [];

      // Boucle : rattrape toutes les echeances passees
      // (max 60 iterations = 5 ans de retard, garde-fou)
      let iter = 0;
      while (currentEcheance <= todayStr && currentRestant > 0 && iter < 60) {
        iter++;
        const reference = `credit:${dette.id}:${currentEcheance}`;

        // Idempotence : skip si deja preleve pour cette echeance
        const dejaPreleve = mouvements.some((m) => m.reference === reference);
        if (dejaPreleve) {
          currentEcheance = nextEcheance(currentEcheance, dette.jour_prelevement);
          continue;
        }

        const montantPreleve = Math.min(mensualite, currentRestant);

        // 1. Creer mouvement financier
        const mvt = await db.mouvements_financiers.create({
          type: 'sortie',
          montant: montantPreleve,
          description: `Mensualité crédit — ${dette.libelle}`,
          compte_id: dette.compte_id,
          date: currentEcheance,
          reference,
          categorie: 'remboursement_credit',
          source: 'auto_credit',
        });
        mouvementsCrees.push(mvt);

        // 2. Debit du compte
        currentSoldeCompte -= montantPreleve;

        // 3. Decrement dette
        currentRestant -= montantPreleve;

        // 4. Avance prochaine_echeance
        currentEcheance = nextEcheance(currentEcheance, dette.jour_prelevement);
      }

      if (mouvementsCrees.length > 0) {
        // Push mises a jour finales (1 update compte + 1 update dette par dette)
        await db.comptes_bancaires.update(compte.id, { solde: currentSoldeCompte });
        const detteUpdate = {
          montant_restant: Math.max(0, currentRestant),
          prochaine_echeance: currentEcheance,
        };
        if (currentRestant <= 0) detteUpdate.statut = 'solde';
        await db.dettes.update(dette.id, detteUpdate);

        processed.push({
          dette: dette.libelle,
          mensualites: mouvementsCrees.length,
          montant_total: mouvementsCrees.reduce((s, m) => s + (m.montant || 0), 0),
          nouveau_restant: Math.max(0, currentRestant),
          solde: currentRestant <= 0,
        });
      } else {
        skipped++;
      }
    } catch (e) {
      errors.push({ dette: dette.libelle, error: e.message || String(e) });
    }
  }

  return { processed, skipped, errors };
}
