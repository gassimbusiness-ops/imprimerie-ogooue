/**
 * Generation d'image IA pour une fiche produit du catalogue — logique pure.
 *
 * Ce module ne fait AUCUN appel reseau et ne touche PAS au DOM : il contient
 * uniquement les decisions (construire le prompt, autoriser ou refuser le clic,
 * autoriser ou refuser l'enregistrement). Tout est testable avec `node --test`.
 *
 * Pourquoi un module separe :
 *  - le bouton « Generer IA » doit TOUJOURS pouvoir dire pourquoi il est grise
 *    (cf. le piege de l'ecran Mockups IA : bouton gris, aucune explication) ;
 *  - chaque generation est FACTUREE sur le compte de l'imprimerie : la decision
 *    de lancer ou non doit etre lisible, revue et testee, pas noyee dans du JSX ;
 *  - les images sont stockees en base64 dans app_data.data (JSONB, Supabase plan
 *    gratuit 500 Mo) : le garde-fou de taille est la derniere barriere avant que
 *    la base ne gonfle. Voir LIMITE_IMAGE_OCTETS ci-dessous.
 */

/**
 * Plafond de taille pour une image enregistree dans la fiche produit.
 *
 * Mesure (2026-09-14) : une image `gpt-image-1` 1024x1024 est rendue en PNG.
 * Sur des rendus « studio » synthetiques, le PNG pese 637 Ko a 1.15 Mo, soit
 * 850 Ko a 1.54 Mo une fois encode en base64 (facteur exact 4/3). Un vrai rendu
 * photographique (texture tissu, reflets, grain) monte couramment a 2-4 Mo en
 * base64. Stockees telles quelles dans le JSONB, 200 images suffiraient a saturer
 * les 500 Mo du plan gratuit — et `db.list()` recharge TOUTE la collection a
 * chaque ouverture du catalogue, donc la page se mettrait a telecharger des
 * centaines de Mo.
 *
 * Mitigation retenue : l'image generee passe par le meme pipeline de compression
 * que les photos uploadees (canvas -> 600 px de large -> JPEG qualite 0.7), ce qui
 * ramene la meme image a 16-90 Ko en base64 (division par ~40 a 60). Le plafond
 * ci-dessous refuse tout ce qui depasse 400 Ko : si la compression echoue ou est
 * indisponible, l'image n'est PAS ecrite plutot que de gonfler la base en silence.
 */
export const LIMITE_IMAGE_OCTETS = 400_000;

/** Longueur maximale du prompt envoye au service IA (evite d'envoyer un roman). */
export const LONGUEUR_PROMPT_MAX = 600;

/** Nombre d'images maximum par fiche produit (aligne sur ImageUploader). */
export const MAX_IMAGES_PAR_DEFAUT = 5;

/* ─────────────────────────────────────────────────────────────────────────────
   Construction du prompt
   ───────────────────────────────────────────────────────────────────────────── */

function nettoyer(valeur) {
  if (valeur === null || valeur === undefined) return '';
  return String(valeur).replace(/\s+/g, ' ').trim();
}

/**
 * Construit le prompt a partir de la fiche produit.
 *
 * Le prefixe « Professional product photography of… fond neutre, sans texte »
 * est ajoute cote serveur par `api/generate-image.js` quand `style: 'product'`.
 * Ici on ne produit donc QUE la description du sujet.
 *
 * @param {object} fiche  { nom, categorie, description, matiere, details_techniques }
 * @returns {string} prompt, ou '' si la fiche n'a pas de nom exploitable.
 */
export function construirePromptProduit(fiche = {}) {
  const nom = nettoyer(fiche.nom);
  if (!nom) return '';

  const morceaux = [nom];

  const categorie = nettoyer(fiche.categorie);
  if (categorie) morceaux.push(`categorie ${categorie}`);

  // matiere est le champ le plus utile pour le rendu ; a defaut on prend la
  // description, puis les details techniques.
  const matiere = nettoyer(fiche.matiere);
  if (matiere) morceaux.push(matiere);

  const description = nettoyer(fiche.description);
  if (description) morceaux.push(description);

  const details = nettoyer(fiche.details_techniques);
  if (details) morceaux.push(details);

  const prompt = morceaux.join(', ');
  return prompt.length > LONGUEUR_PROMPT_MAX
    ? `${prompt.slice(0, LONGUEUR_PROMPT_MAX - 1).trimEnd()}…`
    : prompt;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Autorisation du clic
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Decide si la generation peut etre lancee, et renvoie TOUJOURS une raison
 * lisible quand ce n'est pas possible. L'interface doit afficher `message`
 * juste a cote du bouton grise — jamais un bouton gris muet.
 *
 * @param {object} params
 * @param {object} params.fiche        la fiche produit en cours d'edition
 * @param {string} [params.promptEdite] prompt relu/modifie par l'utilisateur
 * @param {Array}  [params.images]     images deja attachees a la fiche
 * @param {number} [params.maxImages]
 * @param {boolean}[params.enCours]    une generation est deja en vol
 * @returns {{ok: boolean, raison: string|null, message: string, prompt: string}}
 */
export function validerDemandeGeneration({
  fiche = {},
  promptEdite,
  images = [],
  maxImages = MAX_IMAGES_PAR_DEFAUT,
  enCours = false,
} = {}) {
  const promptAuto = construirePromptProduit(fiche);

  // Le prompt relu/modifie par l'utilisateur prime TOUJOURS sur le prompt genere :
  // c'est lui, et lui seul, qui part au service IA.
  // Nuance importante : un champ vide n'est pas « pas de modification ». Si
  // l'utilisateur a efface le prompt, on bloque au lieu de renvoyer en douce le
  // prompt automatique — il paierait une generation qu'il n'a pas relue.
  const aEteEdite = promptEdite !== undefined && promptEdite !== null;
  const prompt = aEteEdite ? nettoyer(promptEdite) : promptAuto;

  if (enCours) {
    return {
      ok: false,
      raison: 'en-cours',
      message: 'Generation en cours — patientez, ne relancez pas (chaque generation est facturee).',
      prompt,
    };
  }

  const nbImages = Array.isArray(images) ? images.length : 0;
  if (nbImages >= maxImages) {
    return {
      ok: false,
      raison: 'max-images',
      message: `Maximum ${maxImages} images atteint. Supprimez-en une pour pouvoir generer.`,
      prompt,
    };
  }

  if (!nettoyer(fiche.nom)) {
    return {
      ok: false,
      raison: 'nom-vide',
      message: 'Renseignez d\'abord le nom du produit : c\'est lui qui construit le prompt.',
      prompt: '',
    };
  }

  // Cas limite : nom present mais l'utilisateur a vide le champ prompt.
  if (!prompt) {
    return {
      ok: false,
      raison: 'prompt-vide',
      message: 'Le prompt est vide. Ecrivez ce que l\'IA doit dessiner, ou reinitialisez-le.',
      prompt: '',
    };
  }

  return { ok: true, raison: null, message: '', prompt };
}

/* ─────────────────────────────────────────────────────────────────────────────
   Taille et decision d'enregistrement
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Taille reelle, en octets, des donnees portees par une data URL base64.
 * (base64 encode 3 octets sur 4 caracteres ; '=' est du remplissage.)
 */
export function tailleBase64Octets(dataUrl) {
  if (typeof dataUrl !== 'string') return 0;
  const virgule = dataUrl.indexOf(',');
  const charge = virgule >= 0 ? dataUrl.slice(virgule + 1) : dataUrl;
  if (!charge) return 0;
  const padding = charge.endsWith('==') ? 2 : charge.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((charge.length * 3) / 4) - padding);
}

/** Formate des octets en Ko/Mo lisibles pour un message d'interface. */
export function formaterOctets(octets) {
  if (!Number.isFinite(octets) || octets <= 0) return '0 Ko';
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} Ko`;
  return `${(octets / (1024 * 1024)).toFixed(1)} Mo`;
}

/**
 * Derniere barriere avant ecriture : une image trop lourde n'est jamais
 * enregistree dans le JSONB. Renvoie toujours un message explicite.
 *
 * @param {string} dataUrl  image compressee, en data URL base64
 * @param {number} [limite] plafond en octets
 * @returns {{ok: boolean, octets: number, message: string}}
 */
export function deciderEnregistrement(dataUrl, limite = LIMITE_IMAGE_OCTETS) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    return {
      ok: false,
      octets: 0,
      message: 'Image invalide : le service IA n\'a pas renvoye d\'image exploitable.',
    };
  }

  const octets = tailleBase64Octets(dataUrl);
  if (octets === 0) {
    return { ok: false, octets: 0, message: 'Image vide : rien a enregistrer.' };
  }

  if (octets > limite) {
    return {
      ok: false,
      octets,
      message: `Image trop lourde (${formaterOctets(octets)}) : au-dela de ${formaterOctets(limite)} `
        + 'elle n\'est pas enregistree, pour ne pas saturer la base. '
        + 'Telechargez-la, reduisez-la, puis importez-la avec le bouton « Ajouter ».',
    };
  }

  return { ok: true, octets, message: '' };
}

/* ─────────────────────────────────────────────────────────────────────────────
   Lecture de la reponse de l'API
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Extrait le message d'erreur REEL renvoye par /api/generate-image.
 * Le projet a perdu des semaines sur un « une erreur est survenue » opaque :
 * on ne masque jamais le message d'origine.
 *
 * @param {{ok?: boolean, status?: number}} reponse
 * @param {any} corps  corps JSON deja parse (ou null si illisible)
 */
export function extraireMessageErreur(reponse = {}, corps = null) {
  const brut = corps && typeof corps === 'object' ? corps.error : null;
  if (typeof brut === 'string' && brut.trim()) return brut.trim();
  if (brut && typeof brut === 'object' && typeof brut.message === 'string' && brut.message.trim()) {
    return brut.message.trim();
  }
  if (reponse && reponse.status) {
    return `Le service IA a repondu HTTP ${reponse.status} sans message d'erreur.`;
  }
  return 'Le service IA n\'a renvoye ni image ni message d\'erreur.';
}

/**
 * Extrait la data URL base64 de la reponse.
 * `gpt-image-1` renvoie du base64 (`b64_json`) et jamais d'URL : le champ `url`
 * n'est conserve que par compatibilite si le modele venait a changer.
 */
export function extraireImage(corps = null) {
  if (!corps || typeof corps !== 'object') return null;
  if (typeof corps.imageBase64 === 'string' && corps.imageBase64.startsWith('data:image/')) {
    return corps.imageBase64;
  }
  if (typeof corps.url === 'string' && corps.url.startsWith('http')) return corps.url;
  return null;
}
