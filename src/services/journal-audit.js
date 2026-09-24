/**
 * LA FORME D'UNE LIGNE DU JOURNAL D'AUDIT — et d'abord : QUI.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * POURQUOI CE MODULE EXISTE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Le 18/09/2026 à 16 h 52 (Moanda), le mot de passe du poste d'accueil a
 * changé ; le poste n'a plus pu se connecter pendant six jours. Le journal a
 * donné le QUOI et le QUAND à la seconde près. Le QUI, lui, était mal écrit :
 *
 *   - la ligne serveur portait `user_nom: 'Serveur'` — un humain connecté,
 *     l'administrateur, s'y écrivait comme une machine ;
 *   - le navigateur sans session écrivait `user_nom: 'Système'` — une personne
 *     inconnue s'y écrivait comme une tâche automatique ;
 *   - aucune ligne, jamais, n'a porté le RÔLE de son auteur (0 sur 3 383).
 *
 * Un journal où « personne » et « la machine » s'écrivent pareil est un faux
 * témoin. Sur un geste d'argent, une ligne sans auteur ne prouve rien.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LA RÈGLE
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   1. Toute ligne de `audit_logs` naît de `ligneJournal()`. Un test parcourt
 *      le dépôt et refuse tout fichier qui écrirait la collection sans elle.
 *   2. L'auteur est fabriqué par UN des constructeurs ci-dessous, à partir de
 *      la SESSION — jamais d'un champ de l'appelant. `ligneJournal()` ne lit
 *      aucun `user_id`, `user_nom` ni `auteur` dans ce qu'on lui passe : elle
 *      construit l'objet champ par champ.
 *   3. Quatre sortes d'auteurs, et elles ne se confondent pas :
 *        humain   — une session (signée côté serveur, ou celle du navigateur)
 *        chatgpt  — le pont ; la personne qui a dicté n'est PAS vérifiable
 *        systeme  — une tâche planifiée, toujours NOMMÉE
 *        anonyme  — aucune session (inscription publique, session perdue)
 *      Un humain ne peut pas prendre l'identifiant de la machine, ni l'inverse.
 *   4. Rien de secret : `assainir()` remplace toute valeur de clé sensible, et
 *      aucun appelant ne transmet de mot de passe — l'acte, jamais la valeur.
 *
 * Les champs historiques `user_id` / `user_nom` restent écrits : l'export PDF,
 * la recherche et la gouvernance les lisent. Ils sont désormais DÉRIVÉS de
 * `auteur`, jamais posés à la main.
 *
 * ⚠️ Module PUR, partagé navigateur + serveur (`api/_lib/` l'importe par
 * chemin relatif, comme `chatgpt-gestes.js`). Aucun import de base, de session
 * ou d'alias `@/` ici.
 */

/* ═══════════════════════════════════════════════════════════════════════════
   Les sortes d'auteurs et leurs sources
   ═══════════════════════════════════════════════════════════════════════════ */

export const TYPES_AUTEUR = Object.freeze({
  HUMAIN: 'humain',
  CHATGPT: 'chatgpt',
  SYSTEME: 'systeme',
  ANONYME: 'anonyme',
});

export const SOURCES_AUTEUR = Object.freeze({
  /** Jeton HMAC vérifié par le serveur (`api/_lib/session.js`). */
  SESSION_SIGNEE: 'session_signee',
  /** Session tenue par le navigateur — celle que l'écran utilise pour tout le reste. */
  SESSION_NAVIGATEUR: 'session_navigateur',
  /** Jeton unique et partagé du pont ChatGPT. */
  JETON_PONT: 'jeton_pont',
  /** Tâche planifiée, appelée sans humain. */
  TACHE_PLANIFIEE: 'tache_planifiee',
  /** Personne n'était connecté. */
  AUCUNE_SESSION: 'aucune_session',
});

/** Identifiant fixe du pont : c'est sous lui que toutes ses lignes sont rangées. */
export const ID_CHATGPT = 'chatgpt';
const PREFIXE_SYSTEME = 'systeme:';

/**
 * Identifiants qu'une PERSONNE ne peut pas porter. Sans ce refus, un compte
 * dont l'id vaudrait « chatgpt » s'écrirait au journal comme le pont.
 * `unknown` et `serveur` sont les valeurs de repli des anciennes versions.
 */
function idReserve(id) {
  const bas = String(id).toLowerCase();
  return bas === ID_CHATGPT || bas === 'unknown' || bas === 'serveur' || bas === 'anonyme'
    || bas.startsWith(PREFIXE_SYSTEME);
}

/** Texte propre et borné, ou chaîne vide. Un nombre est accepté (identifiant numérique). */
function texte(valeur, max = 120) {
  if (typeof valeur === 'number' && Number.isFinite(valeur)) return String(valeur);
  if (typeof valeur !== 'string') return '';
  return valeur.trim().slice(0, max);
}

function nomDePersonne(fiche) {
  if (!fiche || typeof fiche !== 'object') return '';
  return [texte(fiche.prenom), texte(fiche.nom)].filter(Boolean).join(' ');
}

/* ═══════════════════════════════════════════════════════════════════════════
   Les constructeurs — la SEULE façon de fabriquer un auteur
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Une personne connectée.
 * @param {{id: string, nom?: string, role?: string, source: string}} p
 */
export function auteurHumain({ id, nom, role, source }) {
  const idPropre = texte(id, 80);
  if (!idPropre) {
    throw new Error('auteurHumain : identifiant requis — sans lui, ce n\'est pas une personne connue, c\'est un auteur anonyme');
  }
  if (idReserve(idPropre)) {
    throw new Error(`auteurHumain : « ${idPropre} » est réservé à la machine — une personne ne peut pas le porter`);
  }
  if (source !== SOURCES_AUTEUR.SESSION_SIGNEE && source !== SOURCES_AUTEUR.SESSION_NAVIGATEUR) {
    throw new Error(`auteurHumain : source « ${source} » inconnue — une personne vient d'une session`);
  }
  return {
    type: TYPES_AUTEUR.HUMAIN,
    id: idPropre,
    nom: texte(nom) || null,
    role: texte(role, 30) || null,
    source,
  };
}

/**
 * Personne n'était connecté. Le `contexte` dit POURQUOI, en clair — une
 * inscription publique n'est pas une session perdue.
 */
export function auteurAnonyme(contexte) {
  return {
    type: TYPES_AUTEUR.ANONYME,
    id: null,
    nom: null,
    role: null,
    source: SOURCES_AUTEUR.AUCUNE_SESSION,
    contexte: texte(contexte, 120) || 'aucune session',
  };
}

/**
 * Le pont ChatGPT.
 *
 * QUI A DICTÉ ? Le pont s'authentifie par UN jeton, partagé par tous ceux qui
 * utilisent le GPT : aucune identité de personne n'arrive jusqu'ici. On écrit
 * donc `dicte_par: null` et on dit pourquoi — plutôt qu'un nom deviné.
 *
 * OpenAI joint à ses appels quelques en-têtes (`openai-conversation-id`,
 * `openai-ephemeral-user-id`, `openai-gpt-id`). Ils sont GARDÉS À PART, sous
 * `indices_openai`, parce qu'ils permettent de retrouver la conversation d'où
 * est parti un geste. Mais ils viennent de l'appelant : ils ne sont PAS
 * l'auteur, et l'écran ne les présente pas comme une identité.
 *
 * @param {{entetes?: object}} [p] les en-têtes HTTP de la requête du pont
 */
export function auteurChatGPT({ entetes } = {}) {
  return {
    type: TYPES_AUTEUR.CHATGPT,
    id: ID_CHATGPT,
    nom: 'ChatGPT',
    role: null,
    source: SOURCES_AUTEUR.JETON_PONT,
    dicte_par: null,
    dicte_par_motif: 'non vérifiable — le pont n\'a qu\'un jeton, partagé par tous les utilisateurs du GPT',
    indices_openai: indicesOpenAI(entetes),
  };
}

const ENTETES_OPENAI = {
  conversation: 'openai-conversation-id',
  utilisateur_ephemere: 'openai-ephemeral-user-id',
  gpt: 'openai-gpt-id',
};
const FORME_INDICE = /^[A-Za-z0-9._:-]{1,128}$/;

function indicesOpenAI(entetes) {
  if (!entetes || typeof entetes !== 'object') return null;
  const sortie = {};
  for (const [cle, entete] of Object.entries(ENTETES_OPENAI)) {
    const brut = entetes[entete];
    const valeur = Array.isArray(brut) ? brut[0] : brut;
    // Une forme stricte : un en-tête forgé ne doit pas pouvoir déposer du texte
    // arbitraire (ni une phrase, ni du HTML) dans le journal.
    if (typeof valeur === 'string' && FORME_INDICE.test(valeur)) sortie[cle] = valeur;
  }
  return Object.keys(sortie).length ? { ...sortie, verifie: false } : null;
}

/**
 * Une tâche planifiée. Elle est TOUJOURS nommée : « le système » sans nom ne
 * dit pas quelle tâche relancer ni laquelle couper.
 */
export function auteurSysteme(tache) {
  const nom = texte(tache, 60);
  if (!nom) throw new Error('auteurSysteme : le nom de la tâche est obligatoire');
  return {
    type: TYPES_AUTEUR.SYSTEME,
    id: `${PREFIXE_SYSTEME}${nom}`,
    nom: `Système — ${nom}`,
    role: null,
    source: SOURCES_AUTEUR.TACHE_PLANIFIEE,
    tache: nom,
  };
}

/**
 * L'auteur d'une ligne écrite DEPUIS LE NAVIGATEUR.
 *
 * `session` est l'utilisateur tel que la connexion l'a rangé (`io_current_user`,
 * rempli par `auth.jsx` avec la réponse de `/api/auth-login`). Sans session :
 * un auteur ANONYME — surtout pas « Système », qui était le repli d'avant et
 * faisait passer une personne inconnue pour une tâche automatique.
 */
export function auteurDepuisSessionNavigateur(session) {
  if (!session || typeof session !== 'object' || !texte(session.id, 80)) {
    return auteurAnonyme('aucune session dans le navigateur');
  }
  if (idReserve(texte(session.id, 80))) {
    return auteurAnonyme('session du navigateur au nom réservé à la machine — refusée');
  }
  return auteurHumain({
    id: session.id,
    nom: nomDePersonne(session) || texte(session.email),
    role: session.role,
    source: SOURCES_AUTEUR.SESSION_NAVIGATEUR,
  });
}

/**
 * L'auteur d'une ligne écrite CÔTÉ SERVEUR, à partir du jeton VÉRIFIÉ.
 *
 * L'identifiant et le rôle viennent du jeton signé — pas du corps de la
 * requête. Le nom vient de la fiche employé relue en base par le serveur.
 *
 * @param {object|null} sessionVerifiee payload de `verifierSession()` ({sub, role})
 * @param {{employe?: object, contexte?: string}} [p]
 */
export function auteurDepuisSessionServeur(sessionVerifiee, { employe = null, contexte } = {}) {
  const sub = texte(sessionVerifiee?.sub, 80);
  if (!sub || idReserve(sub)) return auteurAnonyme(contexte || 'aucune session');
  return auteurHumain({
    id: sub,
    nom: nomDePersonne(employe) || texte(employe?.email),
    role: sessionVerifiee.role,
    source: SOURCES_AUTEUR.SESSION_SIGNEE,
  });
}

/** L'objet est-il un auteur tel que les constructeurs le fabriquent ? */
export function estAuteurValide(auteur) {
  if (!auteur || typeof auteur !== 'object') return false;
  switch (auteur.type) {
    case TYPES_AUTEUR.HUMAIN:
      return Boolean(texte(auteur.id)) && !idReserve(auteur.id)
        && (auteur.source === SOURCES_AUTEUR.SESSION_SIGNEE
          || auteur.source === SOURCES_AUTEUR.SESSION_NAVIGATEUR);
    case TYPES_AUTEUR.CHATGPT:
      return auteur.id === ID_CHATGPT && auteur.source === SOURCES_AUTEUR.JETON_PONT;
    case TYPES_AUTEUR.SYSTEME:
      return Boolean(texte(auteur.tache)) && auteur.id === `${PREFIXE_SYSTEME}${auteur.tache}`
        && auteur.source === SOURCES_AUTEUR.TACHE_PLANIFIEE;
    case TYPES_AUTEUR.ANONYME:
      return auteur.id === null && auteur.source === SOURCES_AUTEUR.AUCUNE_SESSION;
    default:
      return false;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   Le secret n'entre pas au journal
   ═══════════════════════════════════════════════════════════════════════════ */

/** Clés dont la valeur ne doit jamais atteindre le journal. */
export const CLES_SECRETES = [
  'password', 'motdepasse', 'mot_de_passe', 'nouveaumotdepasse', 'ancienmotdepasse',
  'password_hash', 'password_salt', 'hash', 'sel', 'salt', 'token', 'jeton', 'authorization',
  'secret',
];

/**
 * Recopie un objet en remplaçant toute valeur secrète par « [omis] ».
 *
 * C'est une ceinture, pas une bretelle : les appelants ne passent déjà que des
 * métadonnées inoffensives. Mais un journal est l'endroit exact où un mot de
 * passe finit par se retrouver le jour où quelqu'un ajoute un champ « pour
 * déboguer » — et un journal s'exporte, se lit à l'écran Audit, et se garde
 * pour toujours.
 */
export function assainir(valeur, profondeur = 0) {
  if (profondeur > 4 || valeur === null || typeof valeur !== 'object') return valeur;
  if (Array.isArray(valeur)) return valeur.map((v) => assainir(v, profondeur + 1));
  const sortie = {};
  for (const [cle, v] of Object.entries(valeur)) {
    sortie[cle] = CLES_SECRETES.includes(cle.toLowerCase()) ? '[omis]' : assainir(v, profondeur + 1);
  }
  return sortie;
}

/* ═══════════════════════════════════════════════════════════════════════════
   La ligne
   ═══════════════════════════════════════════════════════════════════════════ */

function idHistorique(auteur) {
  if (auteur.type === TYPES_AUTEUR.ANONYME) return 'anonyme';
  return auteur.id;
}

function nomHistorique(auteur) {
  switch (auteur.type) {
    case TYPES_AUTEUR.HUMAIN: return auteur.nom || 'Nom non enregistré';
    case TYPES_AUTEUR.CHATGPT: return 'ChatGPT (pont)';
    case TYPES_AUTEUR.SYSTEME: return auteur.nom;
    default: return 'Personne connectée : aucune';
  }
}

/**
 * Fabrique LA ligne de `audit_logs`. Toute écriture du journal passe ici.
 *
 * L'objet rendu est construit champ par champ : un `user_id`, un `user_nom` ou
 * un `auteur` glissé dans les options par l'appelant n'y entre pas.
 *
 * @param {object} p
 * @param {object} p.auteur  fabriqué par un constructeur de ce module
 * @param {string} p.action
 * @param {string} p.module
 * @param {string} [p.entityId]
 * @param {string} [p.entityLabel]
 * @param {string} [p.details]
 * @param {object} [p.metadata]
 * @param {string} [p.timestamp] instant ISO ; maintenant par défaut
 */
export function ligneJournal({
  auteur, action, module, entityId, entityLabel, details, metadata, timestamp,
}) {
  if (!estAuteurValide(auteur)) {
    throw new Error('ligneJournal : auteur absent ou non fabriqué par un constructeur de journal-audit.js');
  }
  const copieAuteur = JSON.parse(JSON.stringify(auteur));
  return {
    timestamp: typeof timestamp === 'string' && timestamp ? timestamp : new Date().toISOString(),
    // Champs historiques, DÉRIVÉS — lus par l'export PDF, la recherche, la gouvernance.
    user_id: idHistorique(copieAuteur),
    user_nom: nomHistorique(copieAuteur),
    user_role: copieAuteur.role,
    auteur: copieAuteur,
    action: String(action || ''),
    module: String(module || ''),
    entity_id: entityId ? String(entityId) : '',
    entity_label: entityLabel ? String(entityLabel) : '',
    details: String(details || '').slice(0, 2000),
    metadata: assainir(metadata && typeof metadata === 'object' ? metadata : {}),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   L'affichage — y compris des 3 383 lignes d'avant, telles qu'elles sont
   ═══════════════════════════════════════════════════════════════════════════ */

export const NON_ENREGISTRE = 'non enregistré';

const LIBELLES_SOURCE = {
  [SOURCES_AUTEUR.SESSION_SIGNEE]: 'session vérifiée par le serveur',
  [SOURCES_AUTEUR.SESSION_NAVIGATEUR]: 'session du navigateur',
};

/**
 * Ce que l'écran affiche comme auteur d'une ligne.
 *
 * Pour une ligne ancienne, on montre ce qu'elle PORTE, et « non enregistré »
 * pour ce qu'elle ne porte pas. On ne déduit rien de l'heure, ni d'une ligne
 * voisine : un journal qui devine n'est plus un journal.
 *
 * @returns {{type: string, libelleType: string, nom: string, role: string, precision: string, enregistre: boolean}}
 */
export function afficherAuteur(ligne) {
  const a = ligne?.auteur;
  if (estAuteurValide(a)) {
    switch (a.type) {
      case TYPES_AUTEUR.HUMAIN:
        return {
          type: a.type, libelleType: 'Personne', enregistre: true,
          nom: a.nom || `${NON_ENREGISTRE} (compte ${a.id})`,
          role: a.role || NON_ENREGISTRE,
          precision: LIBELLES_SOURCE[a.source] || a.source,
        };
      case TYPES_AUTEUR.CHATGPT:
        return {
          type: a.type, libelleType: 'ChatGPT', enregistre: true,
          nom: 'ChatGPT', role: '—',
          precision: a.dicte_par ? `dicté par ${a.dicte_par}` : `dicté par : ${NON_ENREGISTRE}`,
        };
      case TYPES_AUTEUR.SYSTEME:
        return {
          type: a.type, libelleType: 'Système', enregistre: true,
          nom: 'Système', role: '—', precision: `tâche : ${a.tache}`,
        };
      default:
        return {
          type: a.type, libelleType: 'Anonyme', enregistre: true,
          nom: 'Personne connectée : aucune', role: '—', precision: a.contexte,
        };
    }
  }

  // ── Lignes d'avant le 24/09/2026 : aucun champ `auteur`. ──
  const id = typeof ligne?.user_id === 'string' ? ligne.user_id.trim() : '';
  const nom = typeof ligne?.user_nom === 'string' ? ligne.user_nom.trim() : '';

  if (id === ID_CHATGPT) {
    return {
      type: TYPES_AUTEUR.CHATGPT, libelleType: 'ChatGPT', enregistre: true,
      nom: 'ChatGPT', role: '—', precision: `dicté par : ${NON_ENREGISTRE}`,
    };
  }
  if (nom === 'Serveur') {
    // Écrite par le serveur avec l'identifiant du jeton, mais sans nom ni rôle.
    const compte = id && id !== 'serveur' ? `compte ${id}` : 'aucune session';
    return {
      type: 'ancien', libelleType: 'Ancienne ligne', enregistre: false,
      nom: NON_ENREGISTRE, role: NON_ENREGISTRE, precision: `${compte} — nom et rôle non enregistrés`,
    };
  }
  if (!id || id === 'unknown' || !nom || nom === 'Système') {
    // « Système » était le repli du navigateur SANS session : ce n'était pas
    // une machine. On ne le réécrit pas en « Système ».
    return {
      type: 'ancien', libelleType: 'Ancienne ligne', enregistre: false,
      nom: NON_ENREGISTRE, role: NON_ENREGISTRE, precision: 'aucune session enregistrée',
    };
  }
  return {
    type: 'ancien', libelleType: 'Ancienne ligne', enregistre: true,
    nom, role: NON_ENREGISTRE, precision: 'session du navigateur, rôle non enregistré',
  };
}

/** Clé pour compter les auteurs distincts ; `null` quand l'auteur est inconnu. */
export function cleAuteur(ligne) {
  if (estAuteurValide(ligne?.auteur)) return ligne.auteur.id || null;
  const id = typeof ligne?.user_id === 'string' ? ligne.user_id.trim() : '';
  if (!id || id === 'unknown' || id === 'serveur') return null;
  return id;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Libellés d'écran (déplacés depuis audit.js, qui les ré-exporte)
   ═══════════════════════════════════════════════════════════════════════════ */

export const ACTION_LABELS = {
  create: { label: 'Création', color: 'bg-emerald-100 text-emerald-700' },
  update: { label: 'Modification', color: 'bg-blue-100 text-blue-700' },
  delete: { label: 'Suppression', color: 'bg-red-100 text-red-700' },
  cancel: { label: 'Annulation', color: 'bg-orange-100 text-orange-700' },
  cloture: { label: 'Clôture', color: 'bg-violet-100 text-violet-700' },
  login: { label: 'Connexion', color: 'bg-slate-100 text-slate-700' },
  logout: { label: 'Déconnexion', color: 'bg-slate-100 text-slate-700' },
  chatgpt_ecriture: { label: 'Écriture ChatGPT', color: 'bg-amber-100 text-amber-800' },
  chatgpt_annulation: { label: 'Annulation ChatGPT', color: 'bg-orange-100 text-orange-700' },
  stock_entree: { label: 'Entrée de stock', color: 'bg-emerald-100 text-emerald-700' },
  stock_sortie: { label: 'Sortie de stock', color: 'bg-blue-100 text-blue-700' },
};

export const MODULE_LABELS = {
  rapports: 'Rapports',
  commandes: 'Commandes',
  devis: 'Devis',
  factures: 'Factures',
  stocks: 'Stocks',
  stock: 'Stock',
  employes: 'Employés',
  rh: 'RH',
  mockup: 'Mockup',
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
