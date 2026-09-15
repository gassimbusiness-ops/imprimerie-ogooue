/**
 * Moteur de mockup — logique pure. Aucun appel reseau, aucun acces au DOM.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * L'ARCHITECTURE EN UNE PHRASE
 *
 *   L'IA fabrique le t-shirt et la lumiere. Le logo vient du fichier du client,
 *   il n'est JAMAIS redessine.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * POURQUOI ON NE FAIT PLUS L'INVERSE
 *
 * L'ancien `api/generate-mockup.js:63` faisait :
 *
 *     formData.append('image', logoBlob, 'logo.png');   // → /v1/images/edits
 *
 * Le parametre `image` de `/v1/images/edits` est LA TOILE A TRANSFORMER, pas une
 * reference a recopier. Le code demandait donc, litteralement : « prends ce logo
 * et transforme-le en photo de t-shirt ». Le modele obeissait, et redessinait le
 * logo de memoire. Mesure independante (Photoroom, 06/07/2026, 850 produits,
 * 10 annotateurs humains) : 27,2 % de fidelite produit, et la distorsion de logo
 * est le PREMIER mode d'echec (20,1 % des generations). Sur une forme rare — ce
 * qu'est par construction le logo d'un client de Moanda — la precision mesuree
 * tombe a 3,55 % (Qwen-Image Technical Report, arXiv 2508.02324).
 *
 * Aucun prompt ne corrige ca : un modele de diffusion echantillonne dans un espace
 * latent continu, il n'a aucun mecanisme de copie pixel a pixel.
 *
 * LE PIPELINE HYBRIDE (Prodigi, novembre 2025)
 *
 *   1. la scene (le support nu, sa couleur, sa lumiere) vient d'une PHOTO REELLE
 *      du magasin si elle existe, sinon d'une generation IA ;
 *   2. le logo du client est INCRUSTE par calcul par-dessus, pixel pour pixel,
 *      deforme par les plis du tissu et refondu dans les ombres de la scene ;
 *   3. le logo ne transite JAMAIS par le modele. `api/generate-mockup.js` refuse
 *      desormais toute requete qui en porte un — c'est la garantie structurelle.
 *
 * Ce module porte les DECISIONS (autoriser, refuser, chiffrer, expliquer). Le
 * dessin proprement dit est dans `composition.js`, l'interface dans `page.jsx`.
 */

import {
  SUPPORTS, ANGLES, TECHNIQUES,
  trouverSupport, trouverColoris, trouverZone, trouverAngle, trouverTechnique,
} from './supports.js';

export {
  SUPPORTS, ANGLES, TECHNIQUES,
  trouverSupport, trouverColoris, trouverZone, trouverAngle, trouverTechnique,
};

/* ═════════════════════════════════════════════════════════════════════════════
   1. COUT — chaque generation est facturee a l'imprimerie
   ═════════════════════════════════════════════════════════════════════════════ */

/**
 * Cout estime d'UNE generation de scene, en FCFA.
 *
 * Verifie le 15/09/2026 sur `developers.openai.com/api/docs/pricing` :
 * les modeles gpt-image-2.5 sont factures 30 $ / million de jetons d'image en
 * sortie. OpenAI ne publie pas la table de jetons par taille/qualite pour la
 * generation 2.5 ; la generation precedente consommait ~1 056 jetons en `low`,
 * ~4 160 en `medium` et ~6 208 en `high` pour un carre 1024. A 30 $/M, cela
 * donne ~0,032 $ / ~0,125 $ / ~0,186 $ l'image.
 *
 * Taux 1 USD = 568,91 FCFA (Xe.com, 14/09/2026). Le XAF est fixe contre l'euro,
 * pas contre le dollar : prevoir ±5 %.
 *
 * C'est une ESTIMATION affichee comme telle. La verite reste la facture OpenAI.
 */
export const COUT_ESTIME_FCFA = { low: 18, medium: 71, high: 106 };

/** Qualite par defaut : `medium`. Un mockup de comptoir n'a pas besoin de `high`. */
export const QUALITE_PAR_DEFAUT = 'medium';

/**
 * Plafond quotidien de generations IA, par poste.
 *
 * A 71 F la generation, 20 generations coutent 1 420 F, soit 2,7 % du CA d'une
 * journee moyenne (51 872 F, mesure sur 339 jours). Au-dela, on arrete : c'est
 * un garde-fou, pas une limite d'usage — la photo reelle du support ne coute
 * rien et n'est jamais comptee ici.
 */
export const PLAFOND_GENERATIONS_PAR_JOUR = 20;

export function formatFCFA(n) {
  const v = Math.round(Number(n) || 0);
  return `${v.toLocaleString('fr-FR')} F`;
}

export function coutGeneration(qualite = QUALITE_PAR_DEFAUT) {
  return COUT_ESTIME_FCFA[qualite] ?? COUT_ESTIME_FCFA.medium;
}

/**
 * Verifie le plafond du jour. Renvoie TOUJOURS un message lisible quand c'est
 * refuse : un bouton grise doit dire pourquoi.
 *
 * @param {object} p
 * @param {number} p.compteur  generations deja lancees aujourd'hui
 * @param {number} [p.plafond]
 * @returns {{ok: boolean, restant: number, message: string}}
 */
export function verifierPlafond(params) {
  const { compteur = 0, plafond = PLAFOND_GENERATIONS_PAR_JOUR } = params || {};
  const n = Number.isFinite(compteur) ? Math.max(0, compteur) : 0;
  const restant = Math.max(0, plafond - n);
  if (restant <= 0) {
    return {
      ok: false,
      restant: 0,
      message: `Plafond du jour atteint (${plafond} generations IA). `
        + 'Utilisez une photo de support enregistree — elle ne coute rien — '
        + 'ou reprenez demain.',
    };
  }
  return { ok: true, restant, message: '' };
}

/* ═════════════════════════════════════════════════════════════════════════════
   2. LE FICHIER LOGO
   ═════════════════════════════════════════════════════════════════════════════ */

/**
 * Formats reellement ouvrables par un navigateur.
 *
 * On dit lesquels AVANT l'upload, et on refuse les autres avec la consigne de
 * conversion. Le cas .ai/.cdr/.psd/.pdf est frequent a Moanda : un echec
 * silencieux fait perdre le client, un message explicite fait gagner 30 secondes.
 *
 * Le SVG est accepte mais traite a part (voir `validerFichierLogo`) :
 *  - l'ancien code l'autorisait a l'ecran (`accept=".svg"`) puis forcait
 *    `type: 'image/png'` cote serveur. Un SVG rebaptise PNG n'est pas un PNG :
 *    le format le plus propre qu'un client puisse fournir etait celui qui echouait ;
 *  - un SVG est un fichier executable : il ne doit JAMAIS etre injecte dans le DOM,
 *    seulement charge via <img src={blobURL}> ou le navigateur desactive scripts
 *    et ressources externes ;
 *  - un SVG contenant du <text> avec une police non embarquee se rend avec la
 *    police du poste, SILENCIEUSEMENT : rien ne casse, le logo est juste faux.
 */
export const FORMATS_LOGO_ACCEPTES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
export const EXTENSIONS_LOGO_ACCEPTEES = ['.png', '.jpg', '.jpeg', '.webp', '.svg'];

/**
 * Taille maximale d'un fichier logo.
 *
 * L'ancien ecran autorisait 10 Mo et repliait en base64 dans le corps de la
 * requete. 10 Mo en base64 = 13,3 Mo, contre une limite Vercel de 4,5 Mo :
 * `FUNCTION_PAYLOAD_TOO_LARGE` garanti. Ici le logo ne part plus jamais au
 * serveur — mais il est decode dans le navigateur du comptoir, et 10 Mo de PNG
 * sur une machine de magasin, c'est un gel de plusieurs secondes.
 */
export const TAILLE_LOGO_MAX_OCTETS = 8 * 1024 * 1024;

function extension(nom) {
  const s = String(nom || '');
  const i = s.lastIndexOf('.');
  return i < 0 ? '' : s.slice(i).toLowerCase();
}

/**
 * @param {{name?: string, type?: string, size?: number}|null} fichier
 * @returns {{ok: boolean, raison: string|null, message: string, estSvg: boolean}}
 */
export function validerFichierLogo(fichier) {
  if (!fichier) {
    return {
      ok: false,
      raison: 'absent',
      message: 'Aucun logo importe. Deposez le fichier du client — c\'est lui, et lui seul, '
        + 'qui sera imprime sur l\'apercu.',
      estSvg: false,
    };
  }

  const ext = extension(fichier.name);
  const type = String(fichier.type || '').toLowerCase();
  const estSvg = type === 'image/svg+xml' || ext === '.svg';

  const typeConnu = FORMATS_LOGO_ACCEPTES.includes(type);
  const extConnue = EXTENSIONS_LOGO_ACCEPTEES.includes(ext);

  // Ni le type MIME ni l'extension ne sont reconnus → refus explicite, avec la
  // consigne. On nomme le format recu : « convertissez en PNG » sans dire ce
  // qu'on a recu ne sert a personne.
  if (!typeConnu && !extConnue) {
    const recu = ext || type || 'inconnu';
    return {
      ok: false,
      raison: 'format-inattendu',
      message: `Format ${recu} non lisible par le navigateur. `
        + 'Formats acceptes : PNG, JPG, WEBP, SVG. '
        + 'Pour un .ai, .cdr, .psd ou .pdf : demandez au client un export PNG a fond transparent.',
      estSvg,
    };
  }

  const taille = Number(fichier.size) || 0;
  if (taille > TAILLE_LOGO_MAX_OCTETS) {
    return {
      ok: false,
      raison: 'trop-lourd',
      message: `Fichier trop lourd (${formaterOctets(taille)}, maximum ${formaterOctets(TAILLE_LOGO_MAX_OCTETS)}). `
        + 'Demandez une version allegee, ou reduisez-la avant import.',
      estSvg,
    };
  }

  if (taille === 0) {
    return {
      ok: false,
      raison: 'vide',
      message: 'Fichier vide (0 octet). Le transfert a probablement echoue : reessayez.',
      estSvg,
    };
  }

  return { ok: true, raison: null, message: '', estSvg };
}

/** Formate des octets en Ko/Mo lisibles. */
export function formaterOctets(octets) {
  if (!Number.isFinite(octets) || octets <= 0) return '0 Ko';
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} Ko`;
  return `${(octets / (1024 * 1024)).toFixed(1)} Mo`;
}

/**
 * Detecte un <text> non vectorise dans une source SVG.
 *
 * C'est le piege le plus couteux du lot, parce qu'il est INVISIBLE : la police
 * n'etant pas embarquee, le navigateur substitue celle du poste. Le logo s'affiche,
 * rien ne casse, et il est faux. On previent ; on ne bloque pas, parce qu'un SVG
 * dont la police EST embarquee (@font-face) se rend correctement.
 */
export function svgContientDuTexte(source) {
  if (typeof source !== 'string') return false;
  return /<text[\s>]/i.test(source);
}

/* ═════════════════════════════════════════════════════════════════════════════
   3. ANALYSE DU LOGO — ce qui decide de la faisabilite technique
   ═════════════════════════════════════════════════════════════════════════════ */

/**
 * Analyse les pixels d'un logo pour savoir si la technique demandee sait le faire.
 *
 * Fonction PURE : elle prend un tableau RGBA (ce que rend `getImageData().data`)
 * et ne touche a aucun canvas. C'est ce qui la rend testable sous `node --test`.
 *
 * Methode : quantification sur 4 bits par canal (16 niveaux, soit 4 096 teintes
 * possibles) puis comptage des teintes distinctes reellement presentes, pixels
 * transparents exclus. Un logo au flex est par construction un petit nombre
 * d'aplats ; une photo ou un degrade en produit des centaines.
 *
 * @param {Uint8ClampedArray|Array<number>} donnees  RGBA, 4 octets par pixel
 * @returns {{nbCouleurs: number, aDegrade: boolean, estPhoto: boolean,
 *            ratioOpaque: number, pixelsAnalyses: number}}
 */
export function analyserPixelsLogo(donnees) {
  const vide = { nbCouleurs: 0, aDegrade: false, estPhoto: false, ratioOpaque: 0, pixelsAnalyses: 0 };
  if (!donnees || typeof donnees.length !== 'number' || donnees.length < 4) return vide;

  const seaux = new Set();
  let opaques = 0;
  let total = 0;

  for (let i = 0; i + 3 < donnees.length; i += 4) {
    total += 1;
    const a = donnees[i + 3];
    if (a < 24) continue; // quasi transparent : ne compte pas comme couleur
    opaques += 1;
    const r = donnees[i] >> 4;
    const g = donnees[i + 1] >> 4;
    const b = donnees[i + 2] >> 4;
    seaux.add((r << 8) | (g << 4) | b);
    if (seaux.size > 4096) break; // garde-fou : on a deja la reponse
  }

  const nbCouleurs = seaux.size;
  return {
    nbCouleurs,
    // Seuils calibres sur la realite du flex : l'atelier decoupe un rouleau par
    // couleur. Au-dela d'une douzaine de teintes distinctes, ce n'est plus un
    // aplat, c'est un degrade ou de l'anticrenelage tres fin — dans les deux cas
    // le plotter ne sait pas le rendre.
    aDegrade: nbCouleurs > 12,
    estPhoto: nbCouleurs > 96,
    ratioOpaque: total ? opaques / total : 0,
    pixelsAnalyses: total,
  };
}

/* ═════════════════════════════════════════════════════════════════════════════
   4. LE GARDE-FOU COMMERCIAL — le moteur doit REFUSER, pas embellir
   ═════════════════════════════════════════════════════════════════════════════ */

/**
 * Mention de reserve. Obligatoire a l'ecran ET sur tous les exports.
 *
 * Raison (§8.1 du cahier des charges) : un apercu trop flatteur ne fait pas
 * perdre la vente, il fait revenir le client a la livraison, mecontent, sur une
 * commande deja produite. A Moanda, une reclamation de ce type se raconte.
 */
export const MENTION_RESERVE =
  'Apercu indicatif — simulation. Les couleurs sont reproduites dans le nuancier '
  + 'disponible en atelier et peuvent differer de l\'ecran. Le rendu definitif depend '
  + 'du support et de la technique.';

/** Definition minimale acceptable, en points par pouce, a la taille d'impression. */
export const DPI_MINIMUM = 150;

const POUCE_EN_CM = 2.54;

/**
 * Definition reelle du logo a la taille d'impression demandee.
 *
 * @param {object} p
 * @param {number} p.largeurLogoPx        largeur du fichier source, en pixels
 * @param {number} p.largeurImpressionCm  largeur voulue sur le vetement, en cm
 * @returns {{dpi: number, ok: boolean, message: string}}
 */
export function verifierDefinition(params) {
  const { largeurLogoPx, largeurImpressionCm } = params || {};
  const px = Number(largeurLogoPx) || 0;
  const cm = Number(largeurImpressionCm) || 0;
  if (px <= 0 || cm <= 0) {
    return { dpi: 0, ok: true, message: '' }; // rien a dire tant qu'on ne sait pas
  }
  const dpi = Math.round(px / (cm / POUCE_EN_CM));
  if (dpi < DPI_MINIMUM) {
    return {
      dpi,
      ok: false,
      message: `Ce fichier fait ${px} px de large ; imprime en ${cm} cm il donne ${dpi} px/pouce `
        + `(minimum conseille ${DPI_MINIMUM}). Le rendu sera flou. Demandez le fichier d'origine au client.`,
    };
  }
  return { dpi, ok: true, message: '' };
}

/**
 * Le coeur du garde-fou : ce que la technique ne sait PAS faire est refuse,
 * pas embelli. Trois regles bloquantes, deux avertissements.
 *
 * @param {object} p
 * @param {string} p.supportId
 * @param {string} p.colorisId
 * @param {string} p.techniqueId
 * @param {object} [p.analyseLogo]        sortie de `analyserPixelsLogo`
 * @param {number} [p.largeurImpressionCm]
 * @param {number} [p.largeurLogoPx]
 * @param {number} [p.detailMinPx]        plus petit detail mesure dans le logo, en px
 * @returns {{ok: boolean, bloquants: Array<{code,message}>, avertissements: Array<{code,message}>, message: string}}
 */
export function verifierFaisabilite(params) {
  const {
    supportId,
    colorisId,
    techniqueId,
    analyseLogo = null,
    largeurImpressionCm = 0,
    largeurLogoPx = 0,
    detailMinPx = 0,
  } = params || {};
  const bloquants = [];
  const avertissements = [];

  const support = trouverSupport(supportId);
  const technique = trouverTechnique(techniqueId);
  const coloris = trouverColoris(supportId, colorisId);

  if (!support) {
    bloquants.push({ code: 'support-inconnu', message: 'Support inconnu : choisissez un support du catalogue.' });
  }
  if (!technique) {
    bloquants.push({ code: 'technique-inconnue', message: 'Technique de marquage non choisie.' });
  }

  if (support && technique && !support.techniques.includes(technique.id)) {
    bloquants.push({
      code: 'technique-hors-support',
      message: `L'atelier ne fait pas de ${technique.label.toLowerCase()} sur ${support.label.toLowerCase()}. `
        + `Techniques possibles : ${support.techniques.map((t) => trouverTechnique(t)?.label || t).join(', ')}.`,
    });
  }

  // ── Regle 1 : flex + degrade ou photo → BLOQUANT ─────────────────────────
  // Le flex est du vinyle de couleur unie decoupe au plotter. Il n'existe
  // aucun reglage qui lui fasse produire un degrade.
  if (technique?.aplatSeul && analyseLogo) {
    if (analyseLogo.estPhoto) {
      bloquants.push({
        code: 'flex-photo',
        message: `Ce visuel est une photo (${analyseLogo.nbCouleurs} teintes distinctes) : `
          + 'le flex est du vinyle de couleur unie decoupe, il ne peut pas la reproduire. '
          + 'Il faut du transfert (ou de la sublimation sur support clair).',
      });
    } else if (analyseLogo.aDegrade) {
      bloquants.push({
        code: 'flex-degrade',
        message: `Ce visuel contient un degrade (${analyseLogo.nbCouleurs} teintes distinctes) : `
          + 'le flex ne fait que des aplats de couleur unie. '
          + 'Il faut du transfert, ou un logo simplifie en aplats.',
      });
    } else if (analyseLogo.nbCouleurs > 4) {
      avertissements.push({
        code: 'flex-multicouleur',
        message: `${analyseLogo.nbCouleurs} couleurs detectees : en flex, chaque couleur est un `
          + 'rouleau et une passe de presse supplementaires. A chiffrer avant de s\'engager.',
      });
    }
  }

  // ── Regle 2 : sublimation + support sombre → BLOQUANT ────────────────────
  // L'encre de sublimation se diffuse DANS la fibre : elle ne peut pas etre
  // plus claire que le support. La tasse magique est la seule derogation
  // documentee (revetement thermosensible prevu pour ca).
  if (technique?.id === 'sublimation' && coloris?.sombre && !coloris?.sublimationDerogee) {
    bloquants.push({
      code: 'sublimation-support-sombre',
      message: `Sublimation impossible sur ${support?.label || 'ce support'} ${coloris.label.toLowerCase()} : `
        + 'l\'encre se diffuse dans la fibre et n\'apparait pas sur un support sombre. '
        + 'Il faut du flex ou du transfert « dark » — qui laisse un lisere de film visible.',
    });
  }

  // ── Regle 3 : detail sous le seuil physique de la technique → AVERTISSEMENT
  if (technique && detailMinPx > 0 && largeurLogoPx > 0 && largeurImpressionCm > 0) {
    const mmParPixel = (largeurImpressionCm * 10) / largeurLogoPx;
    const detailMm = detailMinPx * mmParPixel;
    if (detailMm < technique.detailMinMm) {
      avertissements.push({
        code: 'detail-trop-fin',
        message: `Le plus fin detail de ce logo mesurerait ${detailMm.toFixed(1)} mm a l'impression, `
          + `sous le seuil de ${technique.detailMinMm} mm de la technique ${technique.label.toLowerCase()}. `
          + 'Il ne survivra pas au chenillage : agrandissez le marquage, ou simplifiez le logo.',
      });
    }
  }

  // ── Definition du fichier ────────────────────────────────────────────────
  const def = verifierDefinition({ largeurLogoPx, largeurImpressionCm });
  if (!def.ok) avertissements.push({ code: 'definition-faible', message: def.message });

  // ── Coloris non documente ────────────────────────────────────────────────
  if (coloris?.aConfirmer) {
    avertissements.push({
      code: 'coloris-a-confirmer',
      message: `Le coloris de « ${support?.label || 'ce support'} » n'est pas renseigne a l'inventaire. `
        + 'Verifiez en magasin avant de montrer une couleur au client.',
    });
  }

  return {
    ok: bloquants.length === 0,
    bloquants,
    avertissements,
    message: bloquants.length ? bloquants[0].message : '',
  };
}

/* ═════════════════════════════════════════════════════════════════════════════
   5. LE PROMPT DE SCENE — il ne decrit QUE le support nu
   ═════════════════════════════════════════════════════════════════════════════ */

export const LONGUEUR_PROMPT_MAX = 900;

function nettoyer(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\s+/g, ' ').trim();
}

/**
 * Construit le prompt de la SCENE. Il ne parle jamais du logo.
 *
 * Deux corrections par rapport a l'ancien prompt :
 *  - les libelles francais ne partent plus bruts dans un prompt anglais. L'ancien
 *    envoyait `A Casquette in Rouge color` et `A Bouteille de table in Jaune color` :
 *    le modele devinait, et le support lui-meme devenait aleatoire. Chaque support
 *    porte desormais sa traduction (`supports.js`, champ `anglais`).
 *  - la scene doit etre VIERGE. On le demande explicitement, sinon le modele
 *    ajoute spontanement un motif decoratif, et ce motif apparaitrait SOUS le
 *    logo du client.
 */
export function construirePromptScene(params) {
  // `params` peut arriver a null : la destructuration directe leverait, et une
  // exception ici blanchirait l'ecran. Aucun chemin faillible ne casse le rendu.
  const { supportId, colorisId, angleId = 'face' } = params || {};
  const support = trouverSupport(supportId);
  if (!support) return '';
  const coloris = trouverColoris(supportId, colorisId) || support.coloris[0];
  const angle = trouverAngle(angleId) || ANGLES[0];

  const couleurAnglais = {
    blanc: 'pure white', noir: 'deep black', bleu: 'royal blue', vert: 'forest green',
    rose: 'bright pink', violet: 'deep purple', orange: 'bright orange',
    noir_thermo: 'matte black', a_confirmer: 'neutral grey', a_preciser: 'high-visibility yellow',
  }[coloris?.id] || 'white';

  const prompt = [
    'Professional product photography for a print shop catalogue.',
    `A ${couleurAnglais} ${support.anglais}, ${angle.anglais}.`,
    // Le point qui compte : la scene doit etre nue.
    'The garment is completely blank: no logo, no text, no print, no embroidery,',
    'no brand label, no decoration of any kind on the fabric.',
    // Lumiere plate : le relief doit venir de la matiere, pas de l'eclairage.
    // Une ombre portee dure est impossible a corriger ensuite lors de l\'incrustation.
    'Flat frontal diffuse studio lighting, no hard shadows, no colour cast,',
    'neutral light grey seamless background, natural fabric texture and soft folds visible,',
    'the printable area is fully visible and not cropped.',
  ].join(' ');

  return prompt.length > LONGUEUR_PROMPT_MAX
    ? `${prompt.slice(0, LONGUEUR_PROMPT_MAX - 1).trimEnd()}…`
    : prompt;
}

/* ═════════════════════════════════════════════════════════════════════════════
   6. AUTORISATION DU CLIC
   ═════════════════════════════════════════════════════════════════════════════ */

/**
 * Decide si l'apercu peut etre lance, et renvoie TOUJOURS une raison lisible
 * quand ce n'est pas possible.
 *
 * L'interface DOIT afficher `message` juste a cote du bouton grise. Le gerant a
 * vecu « impossible de cliquer » sans aucune explication sur l'ancien ecran
 * (`page.jsx:392`, aide affichee seulement si `!logoFile && productType`) :
 * un bouton gris muet coute une vente.
 *
 * Ordre des controles : du plus bloquant au plus specifique. `enCours` passe en
 * premier — c'est le double-clic, et il est FACTURE.
 *
 * @returns {{ok, raison, message, prompt, cout, scene, faisabilite}}
 */
export function validerDemandeMockup(params) {
  const {
    supportId,
    colorisId,
    angleId = 'face',
    techniqueId,
    zoneId,
    fichierLogo = null,
    analyseLogo = null,
    largeurImpressionCm = 0,
    largeurLogoPx = 0,
    detailMinPx = 0,
    promptEdite,
    sceneExistante = null,   // photo reelle du support : aucun appel IA, aucun cout
    enCours = false,
    compteurDuJour = 0,
    plafond = PLAFOND_GENERATIONS_PAR_JOUR,
    qualite = QUALITE_PAR_DEFAUT,
  } = params || {};
  const promptAuto = construirePromptScene({ supportId, colorisId, angleId });

  // Le prompt relu/modifie par l'utilisateur prime TOUJOURS sur le prompt genere :
  // c'est lui, et lui seul, qui part au service IA. Nuance : un champ vide n'est
  // pas « pas de modification ». Si l'utilisateur a efface le prompt, on bloque
  // plutot que de renvoyer en douce le prompt automatique — il paierait une
  // generation qu'il n'a pas relue.
  const aEteEdite = promptEdite !== undefined && promptEdite !== null;
  const prompt = aEteEdite ? nettoyer(promptEdite) : promptAuto;

  // La scene vient-elle d'une photo reelle ? Alors rien n'est facture.
  const scene = sceneExistante ? 'photo' : 'ia';
  const cout = scene === 'photo' ? 0 : coutGeneration(qualite);

  const base = { prompt, cout, scene, faisabilite: null };

  if (enCours) {
    return {
      ...base,
      ok: false,
      raison: 'en-cours',
      message: 'Apercu en cours — patientez, ne relancez pas. '
        + `Chaque generation IA est facturee (~${formatFCFA(coutGeneration(qualite))}).`,
    };
  }

  const support = trouverSupport(supportId);
  if (!support) {
    return {
      ...base,
      ok: false,
      raison: 'support-absent',
      message: 'Choisissez d\'abord le support : c\'est lui qui determine les coloris en stock, '
        + 'les zones de marquage et les techniques possibles.',
    };
  }

  const coloris = trouverColoris(supportId, colorisId);
  if (!coloris) {
    const dispo = support.coloris.map((c) => c.label).join(', ');
    return {
      ...base,
      ok: false,
      raison: 'coloris-hors-stock',
      // Message volontairement chiffre : on ne dit pas « couleur invalide »,
      // on dit ce qu'on a en rayon. C'est la reponse a donner au client.
      message: colorisId
        ? `« ${colorisId} » n'est pas en stock en ${support.label.toLowerCase()}. `
          + `Coloris disponibles : ${dispo}.`
        : `Choisissez un coloris. En stock pour ${support.label.toLowerCase()} : ${dispo}.`,
    };
  }

  const zone = trouverZone(supportId, zoneId);
  if (!zone) {
    const zones = support.zones.map((z) => z.label).join(', ');
    return {
      ...base,
      ok: false,
      raison: 'zone-absente',
      message: `Choisissez la zone de marquage — c'est la question que l'atelier pose a chaque commande. `
        + `Zones possibles : ${zones}.`,
    };
  }

  const fichier = validerFichierLogo(fichierLogo);
  if (!fichier.ok) {
    return { ...base, ok: false, raison: fichier.raison, message: fichier.message };
  }

  const faisabilite = verifierFaisabilite({
    supportId, colorisId, techniqueId, analyseLogo,
    largeurImpressionCm: largeurImpressionCm || zone.largeurMaxCm,
    largeurLogoPx, detailMinPx,
  });
  if (!faisabilite.ok) {
    return {
      ...base,
      ok: false,
      raison: 'technique-impossible',
      message: faisabilite.message,
      faisabilite,
    };
  }

  if (!prompt) {
    return {
      ...base,
      ok: false,
      raison: 'prompt-vide',
      message: 'Le prompt de scene est vide. Ecrivez ce que l\'IA doit photographier, '
        + 'ou reinitialisez-le.',
      faisabilite,
    };
  }

  // Le plafond ne s'applique qu'a ce qui est facture.
  if (scene === 'ia') {
    const p = verifierPlafond({ compteur: compteurDuJour, plafond });
    if (!p.ok) {
      return { ...base, ok: false, raison: 'plafond', message: p.message, faisabilite };
    }
  }

  return { ...base, ok: true, raison: null, message: '', faisabilite };
}

/* ═════════════════════════════════════════════════════════════════════════════
   7. LECTURE DE LA REPONSE DU SERVEUR
   ═════════════════════════════════════════════════════════════════════════════ */

/**
 * Extrait le message d'erreur REEL. Le projet a perdu des semaines sur un
 * « une erreur est survenue » opaque : on ne masque jamais le message d'origine.
 */
export function extraireMessageErreur(reponse = {}, corps = null) {
  const brut = corps && typeof corps === 'object' ? corps.error : null;
  if (typeof brut === 'string' && brut.trim()) return brut.trim();
  if (brut && typeof brut === 'object' && typeof brut.message === 'string' && brut.message.trim()) {
    return brut.message.trim();
  }
  if (reponse && reponse.status) {
    return `Le service de scene a repondu HTTP ${reponse.status} sans message d'erreur.`;
  }
  return 'Le service de scene n\'a renvoye ni image ni message d\'erreur.';
}

/**
 * Extrait la data URL de la scene. Une reponse 200 sans image est un echec :
 * on ne rend pas un canvas vide au client, on dit pourquoi.
 *
 * @returns {{ok: boolean, image: string|null, message: string}}
 */
export function extraireScene(corps = null) {
  if (!corps || typeof corps !== 'object') {
    return { ok: false, image: null, message: 'Reponse illisible du service de scene.' };
  }
  const img = corps.imageBase64;
  if (typeof img === 'string' && img.startsWith('data:image/')) {
    return { ok: true, image: img, message: '' };
  }
  if (typeof corps.error === 'string' && corps.error.trim()) {
    return { ok: false, image: null, message: corps.error.trim() };
  }
  return {
    ok: false,
    image: null,
    message: 'Le service a repondu sans image. Rien n\'est affiche : un apercu vide '
      + 'vaut moins que pas d\'apercu. Reessayez, ou utilisez une photo de support.',
  };
}

/* ═════════════════════════════════════════════════════════════════════════════
   8. LA RECETTE — ce qu'on enregistre, et ce qu'on n'enregistre JAMAIS
   ═════════════════════════════════════════════════════════════════════════════ */

/**
 * 🔴 REGLE DURE : aucune image ne va jamais dans `app_data.data`.
 *
 * `src/services/db.js:16-27` — `list()` fait `.select('data')` sur TOUTE la
 * collection, sans pagination, sans projection, sans filtre serveur (`filter()`
 * filtre en JavaScript APRES avoir tout telecharge). Une image base64 rangee dans
 * un devis ferait retelecharger tous les mockups de tous les devis a chaque
 * ouverture de l'ecran Devis, depuis Moanda. La fonction deviendrait plus lente
 * chaque semaine jusqu'a etre inutilisable.
 *
 * Donc on stocke la RECETTE — la liste des parametres — et l'image s'en deduit
 * en quelques millisecondes. Mesure : ~450 octets la recette, contre ~240 000
 * octets l'apercu en base64. 10 000 mockups = 4,5 Mo au lieu de 2,4 Go.
 *
 * L'apercu rendu ne part que dans Supabase Storage, et seulement s'il est valide.
 */
export const TAILLE_RECETTE_MAX_OCTETS = 2_000;

export const VERSION_MOTEUR = 'hybride-1.0';

/**
 * @returns {{ok: boolean, recette: object|null, octets: number, message: string}}
 */
export function construireRecette(params) {
  const {
    supportId, colorisId, angleId, techniqueId, zoneId,
    position = { x: 0.5, y: 0.5, largeur: 0.25, rotation: 0 },
    tailleReelleCm = null,
    logoRef = null,
    sceneRef = null,
    sceneOrigine = 'ia',
    promptScene = '',
    clientId = null,
    clientNom = '',
    documentType = null,   // 'devis' | 'commande' | null
    documentId = null,
    documentNumero = '',
    coutFcfa = 0,
    creeLe = null,
  } = params || {};
  const support = trouverSupport(supportId);
  const coloris = trouverColoris(supportId, colorisId);
  const zone = trouverZone(supportId, zoneId);

  if (!support || !coloris || !zone) {
    return {
      ok: false, recette: null, octets: 0,
      message: 'Recette incomplete : support, coloris et zone sont obligatoires. Rien n\'est enregistre.',
    };
  }

  const recette = {
    moteur_version: VERSION_MOTEUR,
    support: support.id,
    coloris: coloris.id,
    angle: angleId || 'face',
    technique: techniqueId || null,
    zone: zone.id,
    position: {
      x: arrondi(position.x, 4),
      y: arrondi(position.y, 4),
      largeur: arrondi(position.largeur, 4),
      rotation: arrondi(position.rotation, 2),
    },
    taille_reelle_cm: tailleReelleCm
      ? { l: arrondi(tailleReelleCm.l, 2), h: arrondi(tailleReelleCm.h, 2) }
      : null,
    // Des REFERENCES, jamais des images.
    logo_ref: logoRef || null,
    scene_ref: sceneRef || null,
    scene_origine: sceneOrigine,
    // Le prompt est tronque : il sert a retracer, pas a rejouer a l'identique
    // (une generation IA n'est de toute facon pas reproductible).
    prompt_scene: String(promptScene || '').slice(0, 400),
    client_id: clientId || null,
    client_nom: String(clientNom || '').slice(0, 120),
    document_type: documentType || null,
    document_id: documentId || null,
    document_numero: String(documentNumero || '').slice(0, 40),
    cout_fcfa: Math.round(Number(coutFcfa) || 0),
    statut: 'valide',
    cree_le: creeLe || new Date().toISOString().slice(0, 10),
  };

  const octets = tailleJsonOctets(recette);
  if (octets > TAILLE_RECETTE_MAX_OCTETS) {
    return {
      ok: false, recette: null, octets,
      message: `Recette anormalement lourde (${octets} octets, plafond ${TAILLE_RECETTE_MAX_OCTETS}). `
        + 'Elle n\'est pas enregistree : c\'est le signe qu\'une image s\'y est glissee.',
    };
  }

  return { ok: true, recette, octets, message: '' };
}

/**
 * Derniere barriere avant ecriture dans `app_data` : on refuse toute valeur qui
 * ressemble a une image. C'est la regle du §6.1, appliquee mecaniquement plutot
 * que par discipline.
 */
export function recetteSansImage(recette) {
  if (!recette || typeof recette !== 'object') {
    return { ok: false, message: 'Recette absente.' };
  }
  for (const [cle, valeur] of Object.entries(recette)) {
    if (typeof valeur === 'string' && valeur.startsWith('data:image/')) {
      return {
        ok: false,
        message: `Le champ « ${cle} » contient une image en base64. `
          + 'Aucune image ne va dans la base : elle serait retelechargee a chaque '
          + 'ouverture de l\'ecran Devis. Enregistrement refuse.',
      };
    }
    if (typeof valeur === 'string' && valeur.length > 600) {
      return {
        ok: false,
        message: `Le champ « ${cle} » fait ${valeur.length} caracteres — trop long pour une recette. `
          + 'Enregistrement refuse.',
      };
    }
  }
  return { ok: true, message: '' };
}

function arrondi(v, n) {
  const x = Number(v);
  if (!Number.isFinite(x)) return 0;
  const f = 10 ** n;
  return Math.round(x * f) / f;
}

export function tailleJsonOctets(objet) {
  try {
    const s = JSON.stringify(objet);
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
    return s.length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

/* ═════════════════════════════════════════════════════════════════════════════
   9. VALIDATION / REJET
   ═════════════════════════════════════════════════════════════════════════════ */

/**
 * Un mockup rejete n'est JAMAIS enregistre.
 *
 * L'ancien ecran n'avait pas d'etape de validation du tout : ce qui sortait du
 * modele etait ce qu'on montrait. Ici, l'apercu n'existe en base que si quelqu'un
 * a explicitement dit « on valide ».
 *
 * @param {'valide'|'rejete'|null} decision
 * @returns {{enregistrer: boolean, message: string}}
 */
export function deciderEnregistrement(decision) {
  if (decision === 'valide') {
    return { enregistrer: true, message: '' };
  }
  if (decision === 'rejete') {
    return {
      enregistrer: false,
      message: 'Mockup rejete : rien n\'a ete enregistre, rien n\'est rattache au devis. '
        + 'Reglez la position ou changez de support, puis relancez l\'apercu.',
    };
  }
  return {
    enregistrer: false,
    message: 'Validez ou rejetez l\'apercu avant de l\'enregistrer. '
      + 'Tant que la decision n\'est pas prise, rien n\'est ecrit.',
  };
}
