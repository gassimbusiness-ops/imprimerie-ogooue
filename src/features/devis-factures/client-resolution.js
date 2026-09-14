/**
 * Résolution du client sur un devis ou une facture — IMPRIMERIE OGOOUÉ
 *
 * ⚠️ POURQUOI CE FICHIER EXISTE
 *
 * Le gérant doit pouvoir écrire le nom d'un client qui n'est pas encore dans l'annuaire.
 * La règle métier est asymétrique :
 *
 *   • DEVIS   → nom libre accepté, AUCUNE fiche client créée.
 *               Un devis n'engage rien ; créer une fiche à chaque devis remplirait
 *               l'annuaire de prospects qui n'achèteront jamais.
 *   • FACTURE → si le nom ne correspond à aucun client existant, la fiche est créée.
 *               C'est le passage à la facture qui prouve que le client est réel.
 *
 * ⚠️ IL N'Y A AUCUNE CONTRAINTE D'UNICITÉ EN BASE (table `app_data`, une seule table,
 * données en JSON). L'anti-doublon ne peut donc pas être délégué à Supabase : il est fait
 * ici, sur le nom normalisé. « SOCIETE MOANDA », « Société Moanda » et « societe  moanda »
 * doivent désigner la même fiche.
 *
 * Ce module est volontairement PUR : aucun React, aucun accès base, aucun `new Date()`.
 * La date est fournie par l'appelant (via `src/lib/dates.js`, jamais `.toISOString()`).
 * Il est testé par `tests/client-resolution.test.mjs`.
 */

/** Statuts possibles d'une résolution de client. */
export const RESOLUTION = {
  /** Nom vide ou réduit à des espaces → on refuse, on ne crée pas de fiche vide. */
  INVALIDE: 'invalide',
  /** Le document est rattaché à une fiche existante (sélectionnée ou reconnue par le nom). */
  EXISTANT: 'existant',
  /** Devis à nom libre : on garde le nom en clair, l'annuaire n'est pas touché. */
  LIBRE: 'libre',
  /** Facture à nom inconnu : la fiche doit être créée dans l'annuaire. */
  A_CREER: 'a_creer',
};

/**
 * Nom normalisé, utilisé UNIQUEMENT pour comparer — jamais pour stocker ni afficher.
 * Retire les diacritiques (é → e), écrase les espaces multiples, coupe les bords,
 * passe en minuscules.
 * @param {unknown} nom
 * @returns {string}
 */
export function normaliserNom(nom) {
  if (typeof nom !== 'string') return '';
  return nom
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // marques diacritiques combinantes
    .replace(/\s+/g, ' ') // \s couvre aussi l'espace insécable saisi au clavier
    .trim()
    .toLowerCase();
}

/**
 * Nom propre à stocker : espaces normalisés, mais casse et accents conservés.
 * C'est ce qui sera imprimé sur le document et affiché dans l'annuaire.
 * @param {unknown} nom
 * @returns {string}
 */
export function nettoyerNom(nom) {
  if (typeof nom !== 'string') return '';
  return nom.replace(/\s+/g, ' ').trim();
}

/**
 * Un nom est valide s'il reste quelque chose une fois les espaces retirés.
 * @param {unknown} nom
 * @returns {boolean}
 */
export function estNomValide(nom) {
  return normaliserNom(nom).length > 0;
}

/**
 * Toutes les fiches dont le nom normalisé est **exactement** celui recherché.
 *
 * ⚠️ ÉGALITÉ STRICTE, PAS DE PRÉFIXE. « Moanda » ne doit pas être rattaché à
 * « Moanda Services » : ce sont deux clients différents, et un rattachement abusif
 * enverrait la facture sur la mauvaise fiche.
 *
 * @param {Array<{id?: string, nom?: string}>} clients
 * @param {string} nom
 * @returns {Array<object>}
 */
export function trouverClientsParNom(clients, nom) {
  const cible = normaliserNom(nom);
  if (!cible) return [];
  const liste = Array.isArray(clients) ? clients : [];
  return liste.filter((c) => c && normaliserNom(c.nom) === cible);
}

/**
 * La première fiche correspondant exactement au nom, ou `null`.
 * @param {Array<object>} clients
 * @param {string} nom
 * @returns {object|null}
 */
export function trouverClientParNom(clients, nom) {
  return trouverClientsParNom(clients, nom)[0] || null;
}

/**
 * Suggestions d'auto-complétion pour le champ combiné.
 * Insensible à la casse ET aux accents. Les noms qui *commencent* par la saisie
 * passent devant ceux qui la contiennent.
 *
 * @param {Array<object>} clients
 * @param {string} saisie
 * @param {number} [limite=8]
 * @returns {Array<object>}
 */
export function suggererClients(clients, saisie, limite = 8) {
  const liste = (Array.isArray(clients) ? clients : []).filter((c) => c && normaliserNom(c.nom));
  const q = normaliserNom(saisie);
  if (!q) return liste.slice(0, limite);

  const commencent = [];
  const contiennent = [];
  for (const c of liste) {
    const n = normaliserNom(c.nom);
    if (n.startsWith(q)) commencent.push(c);
    else if (n.includes(q)) contiennent.push(c);
  }
  return [...commencent, ...contiennent].slice(0, limite);
}

/**
 * Décide ce qu'il faut faire du nom saisi : rattacher, créer, laisser libre, ou refuser.
 *
 * Ne fait AUCUN effet de bord. L'appelant exécute la décision.
 *
 * @param {object} params
 * @param {'devis'|'facture'} params.type          Type du document en cours.
 * @param {Array<object>} params.clients           Annuaire tel que connu à cet instant.
 * @param {string} params.nomSaisi                 Ce que l'utilisateur a tapé.
 * @param {string} [params.clientId]               Id de la fiche explicitement choisie, si choix il y a eu.
 * @returns {{statut: string, nom: string, clientId: string, client: object|null,
 *            rattachement: 'explicite'|'par_nom'|null, ambigu: boolean, message: string}}
 */
export function resoudreClient({ type, clients, nomSaisi, clientId = '' }) {
  const nom = nettoyerNom(nomSaisi);
  const base = { nom, clientId: '', client: null, rattachement: null, ambigu: false };

  if (!estNomValide(nom)) {
    return {
      ...base,
      nom: '',
      statut: RESOLUTION.INVALIDE,
      message: 'Le nom du client est obligatoire.',
    };
  }

  const liste = Array.isArray(clients) ? clients : [];

  // 1. Fiche explicitement choisie dans la liste déroulante.
  //    On ne la retient que si le nom affiché correspond toujours : si l'utilisateur a
  //    modifié le texte après avoir choisi, c'est le texte qui fait foi.
  const choisi = clientId ? liste.find((c) => c && c.id === clientId) : null;
  if (choisi && normaliserNom(choisi.nom) === normaliserNom(nom)) {
    return {
      ...base,
      statut: RESOLUTION.EXISTANT,
      clientId: choisi.id,
      client: choisi,
      nom: nettoyerNom(choisi.nom) || nom,
      rattachement: 'explicite',
      message: `Client existant : ${nettoyerNom(choisi.nom) || nom}.`,
    };
  }

  // 2. Pas de choix explicite, mais le nom normalisé correspond à une fiche existante.
  //    → on rattache plutôt que de créer un doublon, ET on le dit à l'utilisateur.
  const homonymes = trouverClientsParNom(liste, nom);
  if (homonymes.length > 0) {
    const c = homonymes[0];
    const nomFiche = nettoyerNom(c.nom) || nom;
    const memeEcriture = nomFiche === nom;
    let message = memeEcriture
      ? `Client existant : ${nomFiche}.`
      : `« ${nom} » correspond au client existant « ${nomFiche} » : le document y sera rattaché.`;
    if (homonymes.length > 1) {
      message += ` ⚠️ ${homonymes.length} fiches portent ce nom dans l'annuaire.`;
    }
    return {
      ...base,
      statut: RESOLUTION.EXISTANT,
      clientId: c.id,
      client: c,
      nom: nomFiche,
      rattachement: 'par_nom',
      ambigu: homonymes.length > 1,
      message,
    };
  }

  // 3. Nom inconnu de l'annuaire : la suite dépend du type de document.
  if (type === 'facture') {
    return {
      ...base,
      statut: RESOLUTION.A_CREER,
      message: `Nouveau client « ${nom} » : il sera ajouté à l'annuaire à l'enregistrement de la facture.`,
    };
  }
  return {
    ...base,
    statut: RESOLUTION.LIBRE,
    message: `Nom libre « ${nom} ». Un devis n'ajoute pas de fiche à l'annuaire.`,
  };
}

/**
 * Construit la fiche client à créer depuis une facture.
 * Porte une trace de son origine pour que le gérant sache d'où elle vient.
 *
 * @param {object} params
 * @param {string} params.nom
 * @param {string} [params.adresse]
 * @param {string} [params.numeroDocument]  Numéro de la facture déclenchante (ex. FAC-0042).
 * @param {string} [params.date]            Date métier `YYYY-MM-DD` (voir src/lib/dates.js).
 * @returns {object} payload prêt pour `db.clients.create`
 */
export function construireNouveauClient({ nom, adresse = '', numeroDocument = '', date = '' }) {
  const propre = nettoyerNom(nom);
  const ref = nettoyerNom(numeroDocument);
  const quand = nettoyerNom(date);

  const origine = ref
    ? `Créé automatiquement depuis la facture ${ref}${quand ? ` du ${quand}` : ''}`
    : `Créé automatiquement depuis une facture${quand ? ` le ${quand}` : ''}`;

  return {
    nom: propre,
    type: 'particulier',
    email: '',
    telephone: '',
    adresse: nettoyerNom(adresse),
    notes: origine,
    source: 'facture',
    cree_automatiquement: true,
    facture_origine: ref,
    date_creation: quand,
  };
}
