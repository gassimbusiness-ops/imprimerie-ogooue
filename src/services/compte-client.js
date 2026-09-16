/**
 * Résolution « fiche client → compte client » — IMPRIMERIE OGOOUÉ
 *
 * ── POURQUOI CE FICHIER EXISTE ────────────────────────────────────────────
 *
 * Le champ `client_id` d'une commande ne porte PAS toujours la même chose :
 *
 *   • commande du PORTAIL  → `client_id` = identifiant du COMPTE (`users.id`),
 *     parce que `catalogue.jsx` écrit `client_id: user?.id` ;
 *   • commande du COMPTOIR → `client_id` = identifiant de la FICHE client
 *     (`clients.id`), parce que l'employé choisit une fiche dans l'annuaire.
 *
 * Les deux ne coïncident jamais. Le lien entre les deux est le champ `user_id`
 * porté par la fiche, posé à l'inscription (`src/features/login/page.jsx`).
 *
 * Conséquence constatée : `getNotifications()` filtre sur `user.id` (un id de
 * COMPTE). Toute notification adressée à un id de FICHE n'était donc lue par
 * personne — c'est-à-dire pour la majorité des commandes, celles du comptoir.
 *
 * ── UNE SEULE RÈGLE, PAS DEUX ─────────────────────────────────────────────
 *
 * Le module fidélité connaissait déjà le piège et le contournait à la main,
 * dans `crediterPointsFidelite()` (`src/features/commandes/page.jsx`) :
 *
 *     const client = allClients.find((e) => e.id === cmd.client_id || e.user_id === cmd.client_id);
 *     const idParrain = parrain.user_id || parrain.id;
 *
 * C'est EXACTEMENT cette règle qui est reprise ici, à un détail près, rendu
 * explicite plus bas : la recherche par `id` est faite d'abord, sur toute la
 * liste, pour que le résultat ne dépende pas de l'ordre des fiches.
 *
 * Ce fichier est la source de vérité de cette résolution. Toute nouvelle
 * version recopiée ailleurs serait la seconde source de vérité qui a produit
 * la panne d'origine (voir `tasks/lessons.md`).
 *
 * Ce module est volontairement PUR : aucun React, aucun accès base, aucun
 * `new Date()`. L'appelant fournit l'annuaire déjà chargé.
 * Il est testé par `tests/notifications-destinataire-client.test.mjs`.
 */

/** Ce qu'on a pu établir sur le destinataire. */
export const CIBLE_CLIENT = {
  /** L'identifiant reçu est déjà celui d'un compte (commande du portail). */
  COMPTE: 'compte',
  /** L'identifiant reçu est celui d'une fiche, rattachée à un compte. */
  FICHE: 'fiche',
  /** Fiche trouvée, mais elle n'est rattachée à AUCUN compte : personne à prévenir en ligne. */
  SANS_COMPTE: 'sans_compte',
  /** Aucune fiche ne porte cet identifiant : on le garde tel quel (comportement d'avant). */
  INCONNU: 'inconnu',
  /** Aucun identifiant fourni. */
  INVALIDE: 'invalide',
};

/**
 * Trouve le compte à prévenir derrière un `client_id` de commande, de devis ou
 * de facture — que cet identifiant soit celui d'une fiche ou celui d'un compte.
 *
 * Ne fait AUCUN effet de bord et ne lève jamais.
 *
 * @param {Array<{id?: string, user_id?: string, nom?: string}>} clients  Annuaire (`db.clients.list()`).
 * @param {unknown} clientId  Ce que porte le document.
 * @returns {{statut: string, compteId: string, fiche: object|null, raison: string}}
 *   `compteId` vide = personne à prévenir, et `raison` dit pourquoi, en français,
 *   dans des termes affichables au gérant.
 */
export function resoudreCompteClient(clients, clientId) {
  const id = typeof clientId === 'string' ? clientId.trim() : '';

  if (!id) {
    return {
      statut: CIBLE_CLIENT.INVALIDE,
      compteId: '',
      fiche: null,
      raison: "Aucun client n'est rattaché à ce document : il n'y a personne à prévenir.",
    };
  }

  const liste = Array.isArray(clients) ? clients : [];

  // 1. `id` est-il l'identifiant d'une FICHE ? On cherche ce cas EN PREMIER,
  //    sur toute la liste. Si une fiche A porte cet id et qu'une autre fiche B
  //    le porte en `user_id`, c'est A qui est désignée : un identifiant de
  //    fiche désigne sa fiche, jamais le compte d'un tiers.
  const parFiche = liste.find((c) => c && c.id === id) || null;
  if (parFiche) {
    if (parFiche.user_id) {
      return { statut: CIBLE_CLIENT.FICHE, compteId: String(parFiche.user_id), fiche: parFiche, raison: '' };
    }
    const nom = (parFiche.nom || '').trim();
    return {
      statut: CIBLE_CLIENT.SANS_COMPTE,
      compteId: '',
      fiche: parFiche,
      raison: `${nom || 'Ce client'} n'a pas de compte sur le portail : la notification ne peut atteindre personne. Prévenez-le par téléphone.`,
    };
  }

  // 2. `id` est-il déjà l'identifiant d'un COMPTE ? Une fiche le porte alors
  //    en `user_id` (commande du portail).
  const parCompte = liste.find((c) => c && c.user_id === id) || null;
  if (parCompte) {
    return { statut: CIBLE_CLIENT.COMPTE, compteId: id, fiche: parCompte, raison: '' };
  }

  // 3. Aucune fiche ne connaît cet identifiant. On ne peut rien affirmer : ce
  //    peut être un compte dont la fiche n'a jamais été créée (c'est le cas
  //    quand `syncClientFromCommande` a rapproché par email sans poser
  //    `user_id`). On garde l'identifiant tel quel — strictement le
  //    comportement d'avant cette correction, donc aucune régression possible.
  return { statut: CIBLE_CLIENT.INCONNU, compteId: id, fiche: null, raison: '' };
}
