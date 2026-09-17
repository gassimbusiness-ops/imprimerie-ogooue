/**
 * Service d'audit — enregistre toutes les actions pour la traçabilité anti-fraude.
 */
import { db } from './db';

/**
 * Log an action to the audit trail.
 * @param {'create'|'update'|'delete'|'cancel'|'cloture'|'login'|'logout'} action
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

async function ecrireTrace(action, module, opts) {
  const session = JSON.parse(localStorage.getItem('io_current_user') || '{}');
  return db.audit_logs.create({
    timestamp: new Date().toISOString(),
    user_id: session.id || 'unknown',
    user_nom: session.prenom && session.nom ? `${session.prenom} ${session.nom}` : 'Système',
    action,
    module,
    entity_id: opts.entityId || '',
    entity_label: opts.entityLabel || '',
    details: opts.details || '',
    metadata: opts.metadata || {},
  });
}

export const ACTION_LABELS = {
  create: { label: 'Création', color: 'bg-emerald-100 text-emerald-700' },
  update: { label: 'Modification', color: 'bg-blue-100 text-blue-700' },
  delete: { label: 'Suppression', color: 'bg-red-100 text-red-700' },
  cancel: { label: 'Annulation', color: 'bg-orange-100 text-orange-700' },
  cloture: { label: 'Clôture', color: 'bg-violet-100 text-violet-700' },
  login: { label: 'Connexion', color: 'bg-slate-100 text-slate-700' },
  logout: { label: 'Déconnexion', color: 'bg-slate-100 text-slate-700' },
};

export const MODULE_LABELS = {
  rapports: 'Rapports',
  commandes: 'Commandes',
  devis: 'Devis',
  factures: 'Factures',
  stocks: 'Stocks',
  employes: 'Employés',
  clients: 'Clients',
  pointage: 'Pointage',
  parametres: 'Paramètres',
  cloture_caisse: 'Clôture caisse',
  auth: 'Authentification',
  taches: 'Tâches',
  catalogue: 'Catalogue',
  prospects: 'Prospection',
  finances: 'Finances',
  objectifs: 'Objectifs',
  demandes_rh: 'Demandes RH',
  travaux: 'Travaux',
  evenements: 'Événements',
  messagerie: 'Messagerie',
  tarifs: 'Tarifs',
  gouvernance: 'Gouvernance',
};
