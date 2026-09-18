/**
 * Bot Messenger / Instagram — DÉCIDER QUOI RÉPONDRE, ET SURTOUT QUOI NE PAS.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LE PRINCIPE, EN UNE PHRASE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Ce module est PUR : pas de réseau, pas de base, pas d'horloge. Il prend un
 * texte de client et rend une décision. C'est ce qui permet de le mettre à
 * l'épreuve des centaines de fois, hors ligne, sans jeton Meta.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * POURQUOI UN CATALOGUE FERMÉ PLUTÔT QU'UNE LISTE DE MOTS INTERDITS
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Interdire « ne dis jamais un prix » par une liste de motifs ne tient pas :
 * il y a toujours une tournure de plus, et la liste court après la langue.
 *
 * On prend donc le problème dans l'autre sens. Le bot ne peut émettre QUE des
 * chaînes inscrites au catalogue (`catalogueReponses()`), construites à partir
 * des fiches validées. Huit textes, connus à la compilation. `estReponseServable()`
 * est le verrou : l'exécuteur refuse d'envoyer tout ce qui n'y figure pas — y
 * compris une réponse du catalogue à laquelle un mot aurait été ajouté.
 *
 * La liste noire existe quand même (`contientPromesseInterdite`), mais elle ne
 * sert qu'à contrôler LE CATALOGUE LUI-MÊME. Vérifier huit chaînes connues est
 * un travail fini ; vérifier toutes les phrases possibles ne l'est pas.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * L'ORDRE DE CLASSEMENT N'EST PAS ARBITRAIRE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Les intentions qui passent la main sont évaluées AVANT celles qui répondent.
 * « Vous ouvrez samedi ? Et c'est quel prix pour 20 t-shirts ? » part donc au
 * gérant, au lieu d'obtenir une demi-réponse suivie d'un silence sur le prix.
 * Le doute profite toujours à l'humain.
 */
import {
  FICHES,
  fiche,
  MENTION_AUTOMATIQUE,
  TEXTE_GENERIQUE,
  TEXTE_IDENTITE,
} from './bot-connaissances.js';

/* ═══════════════════════════════════════════════════════════════════════════
   1. CE QUI EST UNE QUESTION, ET CE QUI N'EN EST PAS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Le texte d'un événement Meta — ou `null` quand il n'y a rien à lire.
 *
 * Rendent `null`, volontairement :
 *   - les échos (`is_echo`) : un message envoyé PAR la Page. Y répondre, c'est
 *     le bot qui se répond à lui-même, en boucle ;
 *   - les accusés de lecture, de livraison et les réactions : aucun contenu ;
 *   - les pièces jointes seules : le dossier dit qu'un fichier reçu est une
 *     DONNÉE, jamais une instruction. Sans texte, on transfère.
 *
 * @param {object} evenement  un événement `messaging` brut de Meta
 * @returns {string|null}
 */
export function texteDuMessage(evenement) {
  const message = evenement?.message;
  if (!message || typeof message !== 'object') return null;
  if (message.is_echo === true) return null;
  const texte = typeof message.text === 'string' ? message.text.trim() : '';
  return texte === '' ? null : texte;
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. LE CLASSEMENT
   ═══════════════════════════════════════════════════════════════════════════ */

/** Intentions qui passent la main. Aucune ne produit une affirmation métier. */
export const INTENTIONS_ESCALADE = Object.freeze([
  'urgence', 'prix', 'delai', 'disponibilite', 'commande', 'paiement', 'humain', 'inconnu',
]);

/**
 * Les règles, DANS L'ORDRE. La première qui accroche gagne.
 * Un commentaire par piège réel rencontré en écrivant ces motifs.
 */
const REGLES = [
  // « vous êtes un robot ? » — la question doit primer sur tout le reste :
  // y répondre par les horaires serait la pire des réponses.
  ['identite', [
    /\brobots?\b/i,
    /\bbot\b/i,
    /\bchatbot\b/i,
    /\bia\b/i,
    /intelligence artificielle/i,
    /\bmachine\b/i,
    /\bvraie?\s+personne\b/i,
    /\bautomatique\b/i,
  ]],

  // L'urgence passe avant le prix : un client pressé qui demande aussi un prix
  // doit recevoir le texte qui porte le numéro de téléphone.
  // ⚠️ Pas de `\b` final derrière une lettre accentuée : « é » n'est pas un
  //    caractère de mot pour JavaScript, donc `press[ée]\b` ne reconnaît PAS
  //    « pressé ». Le piège vaut pour tous les motifs qui finissent sur un
  //    accent — ils sont écrits sans ancre de fin ci-dessous.
  ['urgence', [/\burgen\w*\b/i, /\bpress[ée]/i, /\btrès vite\b/i, /\bau plus vite\b/i]],

  // ⚠️ « combien » est ambigu : « combien de temps » est un DÉLAI, pas un prix.
  //    Sans cette exclusion, toutes les questions de délai finiraient ici.
  ['prix', [
    /\bcombien\b(?!\s+de\s+temps)/i,
    /\bprix\b/i, /\btarifs?\b/i, /\bco[ûu]te?\w*\b/i, /\bdevis\b/i,
    /\bch[èe]re?\b/i, /\bbudget\b/i, /\bpromo\w*\b/i, /\bremise\b/i,
  ]],

  // ⚠️ Pas de « quand » tout seul : « quand ouvrez-vous ? » est un horaire.
  ['delai', [
    /\bd[ée]lais?\b/i,
    /\bcombien de temps\b/i,
    /\bpr[êe]te?\b/i,
    /\bquand\b[^.?!]{0,30}\b(?:pr[êe]t|livr|fini|termin)/i,
  ]],

  ['disponibilite', [
    /\ben stock\b/i, /\bdisponib\w*\b/i, /\bavez[- ]vous\b/i, /\bvous avez\b/i,
    /\breste[- ]t[- ]il\b/i, /\bil vous reste\b/i,
  ]],

  ['commande', [/\bcommand\w*\b/i, /\bsuivi\b/i, /\bma livraison\b/i]],

  ['paiement', [
    /\bpayer\b/i, /\bpaiement\b/i, /\br[ée]gler\b/i, /\bmobile money\b/i,
    /\bairtel\b/i, /\bmoov\b/i, /\besp[èe]ces\b/i, /\bcarte bancaire\b/i, /\bvirement\b/i,
  ]],

  ['humain', [
    /\bparler [àa]/i, /\bun humain\b/i, /\bquelqu['’]un\b/i,
    /\ble g[ée]rant\b/i, /\bresponsable\b/i, /\bpatron\b/i,
  ]],

  ['horaires', [
    /\bouvre?\w*\b/i, /\bouvert\w*\b/i, /\bhoraires?\b/i, /\bferm\w+\b/i,
    /\bsamedi\b/i, /\bdimanche\b/i, /\bquelle heure\b/i, /\bjours? f[ée]ri[ée]/i,
  ]],

  ['adresse', [
    // « où » finit sur une lettre accentuée : les bornes sont écrites à la main.
    /(?:^|[^a-zà-ÿ])o[ùu](?![a-zà-ÿ])/i,
    /\badresse\b/i, /\bsitu[ée]/i, /\blocalis\w*\b/i,
    /\bse trouve\b/i, /\bcarrefour\b/i, /\bitin[ée]raire\b/i, /\bplan\b/i,
  ]],

  ['prestations', [
    /\bimprim\w*\b/i, /\bque faites\b/i, /\bvous faites\b/i, /\bfaites[- ]vous\b/i,
    /\bpropos\w*\b/i, /\bservices?\b/i, /\bprestations?\b/i,
    /\bt[- ]?shirts?\b/i, /\bpolos?\b/i, /\bcasquettes?\b/i, /\btampons?\b/i,
    /\bbanderoles?\b/i, /\bcartes? de visite\b/i, /\bphotocopi\w*\b/i,
    /\bbadges?\b/i, /\bplastifi\w*\b/i, /\bgravure\b/i, /\breliure\b/i,
    /\bflyers?\b/i, /\bfaire[- ]part\b/i, /\bphotos? d['’]identit[ée]/i,
  ]],
];

/**
 * Classe un message de client.
 *
 * ⚠️ Aucun apprentissage, aucun appel à un modèle : des motifs lisibles, qu'on
 * peut relire et corriger. Un bot de comptoir qui se trompe doit se tromper de
 * façon EXPLICABLE — et dans le sens du transfert.
 *
 * @param {string} texte
 * @returns {{intention: string, texte: string}}
 */
export function analyserMessage(texte) {
  const propre = typeof texte === 'string' ? texte.trim() : '';
  if (propre === '') return { intention: 'inconnu', texte: '' };
  for (const [intention, motifs] of REGLES) {
    if (motifs.some((m) => m.test(propre))) return { intention, texte: propre };
  }
  return { intention: 'inconnu', texte: propre };
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. LA COMPOSITION
   ═══════════════════════════════════════════════════════════════════════════ */

/** Assemble corps + phrase d'escalade + mention. Un seul endroit, une règle. */
function assembler(...morceaux) {
  return [...morceaux.filter((m) => typeof m === 'string' && m !== ''), MENTION_AUTOMATIQUE]
    .join('\n\n');
}

/** La réponse complète d'une fiche (corps + sa propre phrase de passage). */
function reponseDeFiche(id) {
  const f = fiche(id);
  return assembler(f.texte, f.escalade);
}

/**
 * La phrase de passage de KB-17 servie SEULE.
 * Elle couvre littéralement « le prix, le délai, la quantité minimale ou un
 * devis » : c'est le texte validé qui correspond le mieux à une demande
 * chiffrée, et le réutiliser évite d'en écrire un neuvième.
 */
function escaladeChiffrable() {
  return assembler(fiche('KB-17').escalade);
}

/**
 * Décide la réponse.
 *
 * @param {{intention: string}} analyse
 * @returns {{action: 'repondre'|'passer_la_main', intention: string, fiche_id: string|null, texte: string}}
 */
export function composerReponse(analyse) {
  const intention = analyse?.intention || 'inconnu';
  const rendre = (action, ficheId, texte) => ({ action, intention, fiche_id: ficheId, texte });

  switch (intention) {
    case 'horaires': return rendre('repondre', 'KB-15', reponseDeFiche('KB-15'));
    case 'adresse': return rendre('repondre', 'KB-16', reponseDeFiche('KB-16'));
    case 'prestations': return rendre('repondre', 'KB-17', reponseDeFiche('KB-17'));

    case 'delai': return rendre('passer_la_main', 'KB-18', reponseDeFiche('KB-18'));
    case 'urgence': return rendre('passer_la_main', 'KB-19', reponseDeFiche('KB-19'));

    // Prix, stock, commande : trois façons de demander un chiffre ou un
    // engagement. Aucun n'existe côté dossier → texte validé de KB-17.
    case 'prix':
    case 'disponibilite':
    case 'commande':
      return rendre('passer_la_main', 'KB-17', escaladeChiffrable());

    case 'identite': return rendre('repondre', null, assembler(TEXTE_IDENTITE));

    // ⛔ Paiement : fiche KB-13 exportable, texte client absent du dépôt.
    //    Voir MOTIF_KB13 dans bot-connaissances.js.
    case 'paiement':
    case 'humain':
    default:
      return rendre('passer_la_main', null, assembler(TEXTE_GENERIQUE));
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. LE VERROU — LE CATALOGUE FERMÉ
   ═══════════════════════════════════════════════════════════════════════════ */

const CATALOGUE = Object.freeze([
  ...FICHES.map((f) => assembler(f.texte, f.escalade)),
  escaladeChiffrable(),
  assembler(TEXTE_IDENTITE),
  assembler(TEXTE_GENERIQUE),
]);

const CATALOGUE_SET = new Set(CATALOGUE);

/** Tout ce que le bot peut dire. Rien de plus, jamais. */
export function catalogueReponses() {
  return [...CATALOGUE];
}

/**
 * Le verrou appelé par l'exécuteur avant tout envoi.
 * Comparaison STRICTE : une réponse du catalogue à laquelle on a ajouté un mot
 * n'en est plus une.
 * @param {unknown} texte
 * @returns {boolean}
 */
export function estReponseServable(texte) {
  return typeof texte === 'string' && CATALOGUE_SET.has(texte);
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. LA LISTE NOIRE — POUR CONTRÔLER LE CATALOGUE, PAS POUR FILTRER LA LANGUE
   ═══════════════════════════════════════════════════════════════════════════ */

const INTERDITS = [
  // Un montant. ⚠️ Le « F » seul n'est reconnu que s'il n'est pas le début
  //   d'un mot : sans ça, « 15 h 00. Fermé » passerait pour un prix.
  ['prix', /\d[\d\s.,]*\s*(?:f\s?cfa|fcfa|xaf|francs?)\b/i],
  ['prix', /\d\s+F(?![A-Za-zÀ-ÖØ-öø-ÿ])/],

  // Un délai promis. ⚠️ Le motif exige un DÉCLENCHEUR (« sous », « en »…)
  //   devant le nombre : « de 7 h 30 à 17 h 30 » est un horaire, pas une
  //   promesse, et doit continuer de passer.
  ['delai', /\b(?:sous|dans|d['’]ici|en moins de|avant|au bout de|en)\s+\d+\s*(?:minutes?|min|heures?|h|jours?|semaines?|mois)\b/i],
  ['delai', /\bdans l['’]heure\b/i],

  // Se faire passer pour quelqu'un.
  ['humanite', /\bje suis (?:une personne|un humain|humaine?|quelqu['’]un|le g[ée]rant)\b/i],
  ['humanite', /\bibrahim\b/i],

  // Un rappel promis, qui n'est organisé nulle part.
  ['rappel', /\b(?:je|on|nous) vous rappel\w*\b/i],

  // Une disponibilité affirmée : aucun stock n'est connu du bot.
  ['disponibilite', /\ben stock\b/i],
  ['disponibilite', /\bdisponible tout de suite\b/i],
  ['disponibilite', /\bnous (?:l['’])?avons\b/i],
];

/**
 * Rend la liste des interdits trouvés dans un texte — vide si tout va bien.
 * Utilisée par les tests sur le catalogue, et journalisée si jamais elle
 * accrochait en production (ce qui voudrait dire qu'une fiche a été modifiée).
 *
 * @param {string} texte
 * @returns {string[]}
 */
export function contientPromesseInterdite(texte) {
  const sujet = typeof texte === 'string' ? texte : '';
  const trouves = [];
  for (const [nom, motif] of INTERDITS) {
    if (motif.test(sujet) && !trouves.includes(nom)) trouves.push(nom);
  }
  return trouves;
}
