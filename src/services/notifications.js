/**
 * Service de notifications internes
 * 7 événements déclencheurs + gestion lu/non-lu
 *
 * ⚠️ DEUX RÈGLES QUI SE PAIENT CHER SI ON LES OUBLIE
 *
 * 1. `pourClient: true` sur un type = son destinataire est un CLIENT, désigné
 *    par le `client_id` d'un document. Cet identifiant est celui d'une FICHE
 *    pour une commande du comptoir, et celui d'un COMPTE pour une commande du
 *    portail. `createNotification` le passe donc par `resoudreCompteClient()`.
 *    Sans cela, les notifications des commandes du comptoir — la majorité —
 *    n'étaient lues par personne.
 *
 * 2. Le `link` d'un type `pourClient` doit viser une route `/client/…`.
 *    `/commandes`, `/messagerie`, `/rapports` sont des routes du PERSONNEL :
 *    un client qui clique dessus est renvoyé sur son tableau de bord
 *    (src/app.jsx:69) sans comprendre pourquoi.
 */
import { db } from './db';
import { resoudreCompteClient } from './compte-client';

const NOTIF_TYPES = {
  nouvelle_commande: {
    icon: '📦',
    label: 'Nouvelle commande',
    link: '/commandes',
  },
  commande_validee: {
    icon: '✅',
    label: 'Commande validée',
    link: '/client/commandes',
    pourClient: true,
  },
  commande_production: {
    icon: '🔧',
    label: 'Commande en production',
    link: '/client/commandes',
    pourClient: true,
  },
  commande_prete: {
    icon: '🎉',
    label: 'Commande prête',
    link: '/client/commandes',
    pourClient: true,
  },
  commande_livree: {
    icon: '📬',
    label: 'Commande livrée',
    link: '/client/commandes',
    pourClient: true,
  },
  commande_annulee: {
    icon: '❌',
    label: 'Commande annulée',
    // `/client/commandes` et non `/commandes` : cette notification ne part
    // qu'au client, et `/commandes` est une route du personnel — un client qui
    // clique dessus est renvoye sur son tableau de bord (src/app.jsx:69).
    link: '/client/commandes',
    pourClient: true,
  },
  /**
   * ⚠️ UN MESSAGE A UN SENS, ET LES DEUX SENS N'ONT RIEN EN COMMUN.
   *
   * Un seul type `nouveau_message` ne pouvait pas être juste : il servait aux
   * deux directions à la fois, alors qu'elles n'ont ni le même destinataire ni
   * le même lien. `messagerie/page.jsx` (écran du PERSONNEL) l'employait pour
   * prévenir un CLIENT : la notification partait sur un id de fiche, et son
   * lien `/messagerie` — une route du personnel — renvoyait le client sur son
   * tableau de bord (src/app.jsx). Marquer ce type unique `pourClient` aurait
   * cassé l'autre sens en même temps. D'où deux types.
   *
   * CLIENT → PERSONNEL : diffusion à `all_staff`, lien `/messagerie`.
   */
  nouveau_message: {
    icon: '💬',
    label: 'Nouveau message',
    link: '/messagerie',
  },
  /** PERSONNEL → CLIENT : destinataire nominatif (résolu), lien `/client/messagerie`. */
  nouveau_message_client: {
    icon: '💬',
    label: 'Nouveau message',
    link: '/client/messagerie',
    pourClient: true,
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
    // Le lien était déjà bon ; le destinataire, lui, souffrait du même défaut
    // que les commandes : `devis-factures/page.jsx` passe l'id de la FICHE
    // rendu par `resoudreClient()`, jamais celui du compte.
    pourClient: true,
  },
  tache_assignee: {
    icon: '📋',
    label: 'Tâche assignée',
    link: '/taches',
  },
  rappel_operateur: {
    icon: '🔔',
    label: 'Rappel commande',
    link: '/commandes',
  },
  /**
   * Campagne marketing → tous les clients.
   *
   * `notifyPromotion` empruntait le type `nouvelle_commande` : la promotion
   * partait donc avec le lien `/commandes`, une route du PERSONNEL. Un client
   * qui cliquait sur « Remise de 10 % » atterrissait sur son tableau de bord.
   *
   * `pourClient: true` dit la vérité — cette notification est destinée aux
   * clients — sans rien changer à la diffusion : le destinataire est le RÔLE
   * `client`, et `DESTINATAIRES_COLLECTIFS` court-circuite la résolution
   * « fiche → compte » pour les rôles. La diffusion reste donc sans
   * `destinataire_id`, ce dont dépend le cloisonnement du 16/09.
   */
  promotion: {
    icon: '🎉',
    label: 'Promotion',
    link: '/client/catalogue',
    pourClient: true,
  },
};

/**
 * Destinataires COLLECTIFS : ce ne sont pas des identifiants, mais des rôles
 * (ou le groupe `all_staff`). Ils ne passent jamais par la résolution client.
 */
const DESTINATAIRES_COLLECTIFS = ['admin', 'manager', 'employe', 'client', 'all_staff'];

/**
 * À quel COMPTE cette notification doit-elle réellement partir ?
 *
 * Pour tout type qui n'est pas `pourClient`, la réponse est « au destinataire
 * demandé », sans lecture ni détour : rien ne change pour le personnel.
 *
 * Pour un type `pourClient`, l'identifiant reçu peut être celui d'une FICHE
 * (commande du comptoir) ou celui d'un COMPTE (commande du portail).
 * `resoudreCompteClient()` — la seule règle du dépôt, voir `compte-client.js` —
 * tranche. Si elle rend un `compteId` vide, la notification n'a aucun lecteur
 * possible : on ne l'écrit pas, et on rend la raison à l'appelant plutôt que
 * de laisser une ligne que personne ne lira jamais.
 *
 * Ne lève jamais : si l'annuaire est illisible, on garde l'identifiant tel
 * quel, c'est-à-dire exactement le comportement d'avant cette correction.
 *
 * @param {string} type
 * @param {string} destinataire
 * @returns {Promise<{compteId: string, raison: string}>}
 */
async function cibleDeLaNotification(type, destinataire) {
  if (!NOTIF_TYPES[type]?.pourClient) return { compteId: destinataire, raison: '' };
  if (DESTINATAIRES_COLLECTIFS.includes(destinataire)) return { compteId: destinataire, raison: '' };

  let clients = [];
  try {
    clients = await db.clients.list();
  } catch (err) {
    console.error('Annuaire illisible, destinataire conservé tel quel:', err);
    return { compteId: destinataire, raison: '' };
  }
  const { compteId, raison } = resoudreCompteClient(clients, destinataire);
  return { compteId, raison };
}

/**
 * Créer une notification
 *
 * ⚠️ NE LEVE JAMAIS. Prévenir est un confort ; l'opération métier qui a
 * déclenché la notification (annuler une commande, la livrer) doit rester
 * faite même si la base refuse d'écrire la notification. C'est la raison
 * d'être du `catch` ci-dessous, et il ne doit pas être retiré.
 *
 * En revanche l'échec doit se VOIR : la fonction rend un verdict nommé, que
 * l'appelant peut afficher. Les appelants qui l'ignorent gardent exactement
 * l'ancien comportement.
 *
 * @param {string} type - Un des types dans NOTIF_TYPES
 * @param {string} message - Le texte de la notification
 * @param {string} destinataire - 'admin', 'employe', 'client', 'all_staff', ou un
 *   identifiant. Pour un type `pourClient`, cet identifiant peut être celui de la
 *   FICHE client (commande du comptoir) : il est alors traduit en identifiant de
 *   COMPTE avant écriture. Si aucun compte ne peut être atteint, rien n'est écrit
 *   et le verdict porte la raison.
 * @param {Object} meta - Données supplémentaires (lien, commande_id, etc.)
 * @returns {Promise<{envoyee: boolean, erreur: string|null}>}
 */
export async function createNotification(type, message, destinataire, meta = {}) {
  try {
    // Un `client_id` de commande n'est pas toujours un id de compte : voir
    // `cibleDeLaNotification()` juste au-dessus.
    const cible = await cibleDeLaNotification(type, destinataire);
    if (!cible.compteId) return { envoyee: false, erreur: cible.raison };

    await db.notifications_app.create({
      type,
      message,
      destinataire: cible.compteId,
      lu: false,
      lien: NOTIF_TYPES[type]?.link || '/',
      icon: NOTIF_TYPES[type]?.icon || '🔔',
      meta,
    });
    return { envoyee: true, erreur: null };
  } catch (err) {
    console.error('Erreur création notification:', err);
    return { envoyee: false, erreur: String(err?.message || err) };
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
        if (n.destinataire === user?.role) {
          // ⚠️ FUITE DE DONNEES CORRIGEE LE 16/09/2026.
          //
          // Cette ligne rendait TRUE des qu une notification visait le ROLE de
          // l utilisateur. Or api/_lib/singpay-encaissement.js ecrit les
          // confirmations de paiement avec `destinataire: 'client'` PLUS un
          // `destinataire_id` nominatif. Tout compte de role `client` voyait
          // donc « Votre paiement a ete confirme » — et l identifiant de la
          // commande — de TOUS les autres clients de l imprimerie.
          //
          // La regle : une notification qui porte un destinataire_id est
          // NOMINATIVE, elle n est lue que par son destinataire. Sans
          // destinataire_id, elle reste une diffusion au role — c est ce dont
          // notifyPromotion a besoin, et ce comportement ne change pas.
          if (n.destinataire_id) return n.destinataire_id === user?.id;
          return true;
        }
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

/**
 * 1. Client passe commande → Admin + Employés (`all_staff`).
 *
 * ⚠️ `all_staff`, PAS `admin`. `client-portal/catalogue.jsx` écrivait sa
 * notification à la main, directement en base, avec `destinataire: 'admin'` :
 * un employé non-admin ne voyait donc jamais passer une commande du portail.
 * Une seconde écriture menée en parallèle de cette fonction est exactement ce
 * qui laisse vivre ce genre d'écart — toute nouvelle commande passe par ici.
 *
 * @param {string} clientNom
 * @param {object} [meta] détails conservés sur la notification (commande_id…).
 *   `meta.detail`, s'il est fourni, est ajouté au message sur UNE SEULE ligne :
 *   le panneau de notifications n'affiche pas les retours à la ligne.
 * @returns {Promise<{envoyee: boolean, erreur: string|null}>}
 */
export function notifyNouvelleCommande(clientNom, meta = {}) {
  const detail = typeof meta.detail === 'string' ? meta.detail.replace(/\s+/g, ' ').trim() : '';
  return createNotification(
    'nouvelle_commande',
    `📦 Nouvelle commande de ${clientNom}${detail ? ` — ${detail}` : ''}`,
    'all_staff',
    { type: 'commande', ...meta }
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

/**
 * 5 bis. Admin → Annulée → Client.
 *
 * La seule transition de statut qui ne prévenait personne : une commande
 * annulée à l'atelier disparaissait de l'écran du client sans un mot, alors
 * qu'il avait peut-être payé et attendu.
 *
 * Le TEXTE n'est pas écrit ici : il dépend de ce qui a réellement été
 * contre-passé (trésorerie, facture, points). Il est construit par
 * `messageAnnulationClient()` dans `contre-passation-commande.js`, puis passé
 * ici. Ne jamais remettre un texte fixe : promettre un remboursement qui n'a
 * pas été contre-passé est pire que le silence.
 *
 * @param {string} clientId
 * @param {string} message texte construit par `messageAnnulationClient()`
 * @param {object} [meta]
 * @returns {Promise<{envoyee: boolean, erreur: string|null}>}
 */
export function notifyCommandeAnnulee(clientId, message, meta = {}) {
  return createNotification(
    'commande_annulee',
    message,
    clientId,
    { type: 'commande', ...meta }
  );
}

/**
 * 6. Nouveau message — PERSONNEL → CLIENT.
 *
 * `clientId` peut être un id de FICHE (conversation ouverte au comptoir par un
 * employé, `messagerie/page.jsx`) comme un id de COMPTE (conversation ouverte
 * depuis le portail) : `createNotification` le traduit.
 *
 * @param {string} clientId
 * @param {string} expediteurNom
 * @returns {Promise<{envoyee: boolean, erreur: string|null}>}
 */
export function notifyNouveauMessageClient(clientId, expediteurNom) {
  return createNotification(
    'nouveau_message_client',
    `💬 Nouveau message de ${expediteurNom}`,
    clientId,
    { type: 'message' }
  );
}

/**
 * 6 bis. Nouveau message — CLIENT → PERSONNEL.
 *
 * `all_staff` et non `admin` : une question posée depuis le portail doit être
 * vue par qui est devant l'écran, pas seulement par le gérant.
 *
 * @param {string} expediteurNom
 * @returns {Promise<{envoyee: boolean, erreur: string|null}>}
 */
export function notifyNouveauMessagePersonnel(expediteurNom) {
  return createNotification(
    'nouveau_message',
    `💬 Nouveau message de ${expediteurNom}`,
    'all_staff',
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

/**
 * 12. Campagne marketing → Tous les clients (diffusion au RÔLE `client`).
 *
 * ⚠️ AUCUN `destinataire_id` ICI, ET C'EST VOULU. Une promotion s'adresse à
 * tout le monde ; le filtre de `getNotifications` ne cloisonne que les
 * notifications NOMINATIVES. Poser un destinataire ici la rendrait invisible à
 * tous sauf un.
 *
 * Le type est `promotion` et non plus `nouvelle_commande` : ce dernier envoyait
 * les clients sur `/commandes`, une route du personnel.
 */
export function notifyPromotion(message) {
  return createNotification(
    'promotion',
    `🎉 ${message}`,
    'client',
    { type: 'promotion' }
  );
}

/**
 * Notifier un opérateur qu'une commande lui a été assignée (= nouvelle tâche)
 */
export function notifyTacheAssignee(operateurId, numeroCmd, clientNom) {
  return createNotification(
    'tache_assignee',
    `📋 Nouvelle tâche : commande ${numeroCmd} (${clientNom})`,
    operateurId,
    { type: 'tache', commande_numero: numeroCmd }
  );
}

/**
 * Envoyer un rappel manuel à un opérateur pour une commande à traiter
 */
export function notifyRappelOperateur(operateurId, numeroCmd, clientNom) {
  return createNotification(
    'rappel_operateur',
    `🔔 Rappel — Commande ${numeroCmd} (${clientNom}) à traiter`,
    operateurId,
    { type: 'rappel', commande_numero: numeroCmd, priorite: 'haute' }
  );
}

export { NOTIF_TYPES };
