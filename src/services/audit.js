/**
 * Service d'audit — enregistre toutes les actions pour la traçabilité anti-fraude.
 *
 * La FORME de la ligne, et surtout son AUTEUR, ne se décident pas ici : voir
 * `src/services/journal-audit.js`. Ce fichier ne fait que lire la session du
 * navigateur et écrire. L'appelant fournit QUOI (action, module, entité,
 * détails) ; il ne fournit jamais QUI — un `user_id`, `user_nom` ou `auteur`
 * glissé dans `opts` est ignoré.
 */
import { db } from './db';
import { auteurDepuisSessionNavigateur, ligneJournal } from './journal-audit';

/**
 * Log an action to the audit trail.
 * @param {string} action - e.g. 'create', 'update', 'delete', 'cancel', 'cloture', 'login', 'logout'
 * @param {string} module - e.g. 'rapports', 'commandes', 'factures'
 * @param {object} opts
 * @param {string} opts.entityId - ID of the affected entity
 * @param {string} opts.entityLabel - Human-readable label
 * @param {string} opts.details - Description of the action
 * @param {object} opts.metadata - Old/new values, motif, etc.
 */
export async function logAction(action, module, opts = {}) {
  try {
    return await ecrireTrace(action, module, opts);
  } catch (e) {
    // ── Pourquoi le journal n'a PAS le droit de faire echouer l'action ──
    //
    // Depuis que `db.create()` leve (constat C6), un echec d'ecriture du
    // journal remontait dans le handler de l'ecran, JUSTE APRES une ecriture
    // metier reussie. L'utilisateur lisait alors « le rapport n'a PAS été
    // enregistré » alors qu'il l'etait. Annoncer un echec faux est aussi
    // couteux qu'annoncer un succes faux : dans les deux cas on ressaisit,
    // et on cree un doublon.
    //
    // La trace reste donc en console — un journal muet est un probleme de
    // gouvernance, pas une raison de mentir au gerant sur son enregistrement.
    console.error('[audit] trace non enregistrée :', action, module, e?.message || e);
    return null;
  }
}

/** La session rangée à la connexion par `auth.jsx`, ou `null`. */
function lireSessionNavigateur() {
  try {
    const brut = localStorage.getItem('io_current_user');
    return brut ? JSON.parse(brut) : null;
  } catch {
    return null;
  }
}

async function ecrireTrace(action, module, options) {
  const opts = options || {};
  return db.audit_logs.create(ligneJournal({
    auteur: auteurDepuisSessionNavigateur(lireSessionNavigateur()),
    action,
    module,
    entityId: opts.entityId,
    entityLabel: opts.entityLabel,
    details: opts.details,
    metadata: opts.metadata,
  }));
}

// Les libellés vivent dans le module PUR `journal-audit.js` (l'écran Audit les
// y lit) ; ré-exportés ici pour les imports historiques.
export { ACTION_LABELS, MODULE_LABELS } from './journal-audit';
