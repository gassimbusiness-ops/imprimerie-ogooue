/**
 * Service de fidélité — Système professionnel Imprimerie Ogooué
 *
 * Tranches de points, bonus événements, parrainage, niveaux, récompenses
 */

// ─── Calcul des points par tranche ───
export function calculerPoints(montant) {
  if (montant <= 0) return 0;
  if (montant < 10000) return Math.floor(montant / 1000);        // 1pt / 1000 FCFA
  if (montant <= 50000) return Math.floor(montant / 800);        // 1pt / 800 FCFA
  return Math.floor(montant / 600);                               // 1pt / 600 FCFA
}

// ─── Bonus événements ───
export function getBonusEvenement(date = new Date()) {
  const m = date.getMonth() + 1; // 1-12
  const d = date.getDate();

  // Noël : 15 déc – 2 jan
  if ((m === 12 && d >= 15) || (m === 1 && d <= 2)) {
    return { points: 50, label: 'Bonus Noël' };
  }
  // Rentrée scolaire : 15 août – 30 sept
  if ((m === 8 && d >= 15) || m === 9) {
    return { points: 50, label: 'Bonus Rentrée scolaire' };
  }
  // Fête nationale gabonaise : 17 août
  if (m === 8 && d === 17) {
    return { points: 50, label: 'Bonus Fête nationale' };
  }
  return null;
}

// ─── Niveaux ───
export const NIVEAUX = {
  bronze:  { label: 'Bronze',  icon: '🥉', color: 'from-amber-600 to-amber-800',    min: 0,    max: 499,  nextLabel: 'Argent',  nextMin: 500 },
  argent:  { label: 'Argent',  icon: '🥈', color: 'from-gray-400 to-gray-600',      min: 500,  max: 1499, nextLabel: 'Or',      nextMin: 1500 },
  or:      { label: 'Or',      icon: '🥇', color: 'from-yellow-400 to-yellow-600',  min: 1500, max: 3999, nextLabel: 'Platine', nextMin: 4000 },
  platine: { label: 'Platine', icon: '💎', color: 'from-blue-400 to-indigo-600',    min: 4000, max: null,  nextLabel: null,      nextMin: null },
};

export function determinerNiveau(totalPoints) {
  if (totalPoints >= 4000) return 'platine';
  if (totalPoints >= 1500) return 'or';
  if (totalPoints >= 500) return 'argent';
  return 'bronze';
}

// ─── Récompenses ───
export const RECOMPENSES = [
  { id: 'reduc5',    points: 200,  label: 'Réduction 5%',              description: 'Sur votre prochaine commande',      icon: '🏷️' },
  { id: 'reduc10',   points: 500,  label: 'Réduction 10%',             description: 'Sur votre prochaine commande',      icon: '🎫' },
  { id: 'impression', points: 1000, label: 'Impression offerte',        description: 'Valeur jusqu\'à 5 000 FCFA',       icon: '🖨️' },
  { id: 'commande',  points: 2000, label: 'Commande offerte',          description: 'Valeur jusqu\'à 15 000 FCFA',      icon: '🎁' },
];

// ─── Bonus parrainage ───
export const BONUS_PARRAINAGE = 100;

// ─── Expiration ───
export const MOIS_EXPIRATION = 12;
