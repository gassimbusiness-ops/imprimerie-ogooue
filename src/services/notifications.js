/**
 * Service de notifications internes
 * 7 événements déclencheurs + gestion lu/non-lu
 */
import { db } from './db';

const NOTIF_TYPES = {
  nouvelle_commande: {
    icon: '📦',
    label: 'Nouvelle commande',
    link: '/commandes',
  },
  commande_validee: {
    icon: '✅',
    label: 'Commande validée',
    link: '/commandes',
  },
  commande_production: {
    icon: '🔧',
    label: 'Commande en production',
    link: '/commandes',
  },
  commande_prete: {
    icon: '🎉',
    label: 'Commande prête',
    link: '/commandes',
  },
  commande_livree: {
    icon: '📬',
    label: 'Commande livrée',
    link: '/commandes',
  },
  nouveau_message: {
    icon: '💬',
    label: 'Nouveau message',
    link: '/messagerie',
  },
  demande_modification: {
    icon: '✏️',
    label: 'Demande de modification',
    link: '/rapports',
  },
  stock_alerte: {
    icon: '⚠️',
    label: 'Alerte stock',
    link: '/stocks',
  },
  rapport_soumis: {
    icon: '📊',
    label: 'Rapport soumis',
    link: '/rapports',
  },
  facture_disponible: {
    icon: '🧾',
    label: 'Facture disponible',
    link: '/client/factures',
  },
};

/**
 * Créer une notification
 * @param {string} type - Un des types dans NOTIF_TYPES
 * @param {string} message - Le texte de la notification
 * @param {string} destinataire - 'admin', 'employe', 'client', 'all_staff', ou un user_id
 * @param {Object} meta - Données supplémentaires (lien, commande_id, etc.)
 */
export async function createNotification(type, message, destinataire, meta = {}) {
  try {
    await db.notifications_app.create({
      type,
      message,
      destinataire,
      lu: false,
      lien: NOTIF_TYPES[type]?.link || '/',
      icon: NOTIF_TYPES[type]?.icon || '🔔',
      meta,
    });
  } catch (err) {
    console.error('Erreur création notification:', err);
  }
}

/**
 * Charger les notifications pour un utilisateur
 */
export async function getNotifications(user) {
  try {
    const all = await db.notifications_app.list();
    // Filter: destinataire = rôle de l'user, 'all_staff' (admin+manager+employe), ou son user_id
    return all
      .filter((n) => {
        if (n.destinataire === user?.id) return true;
        if (n.destinataire === user?.role) return true;
        if (n.destinataire === 'all_staff' && ['admin', 'manager', 'employe'].includes(user?.role)) return true;
        // Admin voit tout sauf les notifs client spécifiques
        if (user?.role === 'admin' && n.destinataire === 'admin') return true;
        return false;
      })
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  } catch {
    return [];
  }
}

/**
 * Marquer une notification comme lue
 */
export async function markAsRead(notifId) {
  try {
    await db.notifications_app.update(notifId, { lu: true, lu_at: new Date().toISOString() });
  } catch (err) {
    console.error('Erreur mark as read:', err);
  }
}

/**
 * Marquer toutes les notifications comme lues
 */
export async function markAllAsRead(user) {
  try {
    const notifs = await getNotifications(user);
    const unread = notifs.filter((n) => !n.lu);
    await Promise.all(unread.map((n) => markAsRead(n.id)));
  } catch (err) {
    console.error('Erreur mark all as read:', err);
  }
}

// ─── Les 7 événements déclencheurs ───

/** 1. Client passe commande → Admin + Employés */
export function notifyNouvelleCommande(clientNom) {
  return createNotification(
    'nouvelle_commande',
    `📦 Nouvelle commande de ${clientNom}`,
    'all_staff',
    { type: 'commande' }
  );
}

/** 2. Admin valide commande → Client */
export function notifyCommandeValidee(clientId) {
  return createNotification(
    'commande_validee',
    '✅ Votre commande a été validée',
    clientId,
    { type: 'commande' }
  );
}

/** 3. Admin → En production → Client */
export function notifyCommandeProduction(clientId) {
  return createNotification(
    'commande_production',
    '🔧 Votre commande est en production',
    clientId,
    { type: 'commande' }
  );
}

/** 4. Admin → Prête → Client */
export function notifyCommandePrete(clientId) {
  return createNotification(
    'commande_prete',
    '🎉 Votre commande est prête à récupérer',
    clientId,
    { type: 'commande' }
  );
}

/** 5. Admin → Livrée → Client */
export function notifyCommandeLivree(clientId) {
  return createNotification(
    'commande_livree',
    '📬 Votre commande a été livrée',
    clientId,
    { type: 'commande' }
  );
}

/** 6. Nouveau message → Destinataire */
export function notifyNouveauMessage(destinataireId, expediteurNom) {
  return createNotification(
    'nouveau_message',
    `💬 Nouveau message de ${expediteurNom}`,
    destinataireId,
    { type: 'message' }
  );
}

/** 7. Demande modification rapport → Admin */
export function notifyDemandeModification(operateurNom) {
  return createNotification(
    'demande_modification',
    `✏️ Demande de modification de rapport par ${operateurNom}`,
    'admin',
    { type: 'rapport' }
  );
}

/** 8. Stock sous seuil minimum → Admin + Employés */
export function notifyStockAlerte(articleNom, quantite, seuil) {
  return createNotification(
    'stock_alerte',
    `⚠️ Stock bas : ${articleNom} (${quantite} restant, seuil: ${seuil})`,
    'all_staff',
    { type: 'stock' }
  );
}

/** 9. Nouveau rapport journalier soumis → Admin */
export function notifyRapportSoumis(operateurNom, date) {
  return createNotification(
    'rapport_soumis',
    `📊 Rapport du ${date} soumis par ${operateurNom}`,
    'admin',
    { type: 'rapport' }
  );
}

/** 10. Facture disponible → Client */
export function notifyFactureDisponible(clientId, numero) {
  return createNotification(
    'facture_disponible',
    `🧾 Votre facture ${numero} est disponible`,
    clientId,
    { type: 'facture' }
  );
}

/** 11. Devis disponible → Client */
export function notifyDevisDisponible(clientId, numero) {
  return createNotification(
    'facture_disponible',
    `📄 Votre devis ${numero} est disponible`,
    clientId,
    { type: 'devis' }
  );
}

/** 12. Campagne marketing → Tous les clients (via destinataire spécial) */
export function notifyPromotion(message) {
  return createNotification(
    'nouvelle_commande',
    `🎉 ${message}`,
    'client',
    { type: 'promotion' }
  );
}

export { NOTIF_TYPES };
