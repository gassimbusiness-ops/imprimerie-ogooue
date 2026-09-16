/**
 * Apercu (dry-run) des prelevements automatiques dus.
 *
 * ── Pourquoi ce module existe ─────────────────────────────────────────────
 * L'ecran Finances declenchait les prelevements AU MONTAGE du composant
 * (src/features/finances/page.jsx:130-147) : ouvrir l'ecran pour regarder un
 * solde pouvait debiter les comptes. L'execution devient explicite — un bouton,
 * puis une confirmation. Pour confirmer, le gerant doit voir CE QUI VA ETRE
 * PRELEVE avant que quoi que ce soit ne parte.
 *
 * Ce module calcule cette liste SANS RIEN ECRIRE, a partir des donnees deja
 * chargees par l'ecran. Il applique les memes regles que les services
 * d'execution :
 *   - src/services/credit-mensualites.js        (mensualites de dette)
 *   - src/services/charges-fixes-prelevement.js (charges fixes recurrentes)
 *
 * Il ne les remplace pas : l'execution reste faite par ces services, qui font
 * autorite. L'apercu est une ESTIMATION affichee avant la confirmation — c'est
 * dit tel quel dans la boite de dialogue. Une divergence eventuelle penche
 * toujours du cote prudent : l'apercu ne peut qu'annoncer un prelevement qui
 * n'aura pas lieu, jamais en cacher un.
 *
 * Module pur : aucun import, aucun acces base. Teste par
 * tests/prelevements-apercu.test.mjs.
 */

const PERIODICITE_MOIS = Object.freeze({
  mensuelle: 1,
  trimestrielle: 3,
  annuelle: 12,
});

/** Garde-fou identique aux services : 60 echeances = 5 ans de retard. */
const MAX_ECHEANCES = 60;

/**
 * Avance une date `YYYY-MM-DD` de N mois, calee sur le jour de prelevement.
 *
 * ⚠️ ARITHMETIQUE PUREMENT ENTIERE — AUCUN OBJET `Date` N EST CONSTRUIT ICI.
 *
 * L ancienne version faisait `new Date('2026-08-05')`, puis `setMonth` et
 * `setDate`. Or `new Date()` sur une chaine `YYYY-MM-DD` interprete la date en
 * UTC, tandis que `setMonth` / `setDate` travaillent en heure LOCALE. Sur un
 * decalage negatif, minuit UTC est la veille au soir : `setDate(5)` posait donc
 * le 5 local, qui retombait sur le 6 en UTC, et `toISOString()` renvoyait
 * « 2026-08-06 » pour une echeance du 5.
 *
 * Mesure sous `TZ=America/Los_Angeles` avant correction :
 *   attendu  ['2026-07-05', '2026-08-05', '2026-09-05']
 *   obtenu   ['2026-07-05', '2026-08-06', '2026-09-06']
 *
 * C est la meme famille que le decalage d un jour qui a produit l ecart de
 * 55 300 F entre deux ecrans. Une date metier (`YYYY-MM-DD`, sans heure) ne
 * doit jamais transiter par UTC — voir l en-tete de `src/lib/dates.js`.
 *
 * Moanda est a UTC+1, donc le defaut n y mordait pas aujourd hui. Il mordait
 * des qu un navigateur ouvrait l ecran depuis un fuseau negatif, et il annoncait
 * alors une echeance de prelevement au mauvais jour.
 */
function avancer(dateStr, nbMois, jourPrelevement) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
  if (!m) return '';

  const annee = Number(m[1]);
  const moisIndex = Number(m[2]) - 1 + (Number(nbMois) || 0);

  // Report d annee, y compris pour un nbMois negatif : Math.floor traite -1 / 12
  // comme -1 et non 0, la ou une division entiere naive donnerait l annee courante.
  const anneeFinale = annee + Math.floor(moisIndex / 12);
  const moisFinal = ((moisIndex % 12) + 12) % 12 + 1;

  // Plafond a 28 comme avant : un prelevement cale au 31 n existe pas en fevrier.
  const jour = Math.min(Math.max(Number(jourPrelevement) || 5, 1), 28);

  const pad = (n) => String(n).padStart(2, '0');
  return `${anneeFinale}-${pad(moisFinal)}-${pad(jour)}`;
}

function mensualiteTheorique(dette) {
  const m = Number(dette?.montant_initial) || 0;
  const t = Number(dette?.taux_interet) || 0;
  const d = Number(dette?.duree_mois) || 0;
  if (!m || !d) return 0;
  return Math.round((m * (1 + t / 100)) / d);
}

function referencesConnues(mouvements) {
  const set = new Set();
  for (const m of mouvements || []) {
    if (m?.reference) set.add(String(m.reference));
  }
  return set;
}

function nomCompte(comptes, compteId) {
  return (comptes || []).find((c) => c.id === compteId)?.nom || '(compte introuvable)';
}

/**
 * Charges fixes dues a la date donnee.
 *
 * @param {object} args
 * @param {Array} args.charges
 * @param {Array} args.comptes
 * @param {Array} args.mouvements  mouvements financiers deja enregistres
 * @param {string} args.aujourdhui date `YYYY-MM-DD`
 * @returns {{lignes: Array, total: number, nombre: number}}
 */
export function apercuChargesDues({ charges = [], comptes = [], mouvements = [], aujourdhui } = {}) {
  const deja = referencesConnues(mouvements);
  const lignes = [];

  for (const charge of charges) {
    if (charge?.actif === false) continue;
    if (!charge?.prelevement_auto) continue;
    if (!charge?.compte_id) continue;
    if (!charge?.prochaine_echeance) continue;
    const montant = Number(charge.montant) || 0;
    if (montant <= 0) continue;

    const incMois = PERIODICITE_MOIS[charge.periodicite || 'mensuelle'] || 1;
    let echeance = charge.prochaine_echeance;
    let iter = 0;

    while (echeance && echeance <= aujourdhui && iter < MAX_ECHEANCES) {
      iter++;
      const reference = `charge:${charge.id}:${echeance}`;
      if (!deja.has(reference)) {
        lignes.push({
          nature: 'charge',
          libelle: charge.libelle || '(charge sans libellé)',
          compte: nomCompte(comptes, charge.compte_id),
          echeance,
          montant,
          reference,
        });
      }
      echeance = avancer(echeance, incMois, charge.jour_prelevement);
    }
  }

  return resumer(lignes);
}

/**
 * Mensualites de credit dues a la date donnee.
 *
 * @param {object} args
 * @param {Array} args.dettes
 * @param {Array} args.comptes
 * @param {Array} args.mouvements
 * @param {string} args.aujourdhui date `YYYY-MM-DD`
 * @returns {{lignes: Array, total: number, nombre: number}}
 */
export function apercuMensualitesDues({ dettes = [], comptes = [], mouvements = [], aujourdhui } = {}) {
  const deja = referencesConnues(mouvements);
  const lignes = [];

  for (const dette of dettes) {
    if (dette?.statut === 'solde' || dette?.statut === 'suspendu') continue;
    if (!dette?.prelevement_auto) continue;
    if (!dette?.compte_id) continue;
    if (!dette?.prochaine_echeance) continue;

    let restant = Number(dette.montant_restant) || 0;
    if (restant <= 0) continue;

    const mensualite = Number(dette.mensualite_montant) || mensualiteTheorique(dette);
    if (!mensualite) continue;

    let echeance = dette.prochaine_echeance;
    let iter = 0;

    while (echeance && echeance <= aujourdhui && restant > 0 && iter < MAX_ECHEANCES) {
      iter++;
      const reference = `credit:${dette.id}:${echeance}`;
      if (!deja.has(reference)) {
        const montant = Math.min(mensualite, restant);
        lignes.push({
          nature: 'credit',
          libelle: dette.libelle || '(dette sans libellé)',
          compte: nomCompte(comptes, dette.compte_id),
          echeance,
          montant,
          reference,
        });
        restant -= montant;
      }
      echeance = avancer(echeance, 1, dette.jour_prelevement);
    }
  }

  return resumer(lignes);
}

/**
 * Apercu complet : credits + charges, tries par echeance.
 * @returns {{lignes: Array, total: number, nombre: number}}
 */
export function apercuPrelevementsDus({ dettes = [], charges = [], comptes = [], mouvements = [], aujourdhui } = {}) {
  const credits = apercuMensualitesDues({ dettes, comptes, mouvements, aujourdhui });
  const chargesDues = apercuChargesDues({ charges, comptes, mouvements, aujourdhui });
  const lignes = [...credits.lignes, ...chargesDues.lignes]
    .sort((a, b) => a.echeance.localeCompare(b.echeance) || a.libelle.localeCompare(b.libelle));
  return resumer(lignes);
}

function resumer(lignes) {
  return {
    lignes,
    nombre: lignes.length,
    total: lignes.reduce((s, l) => s + l.montant, 0),
  };
}
