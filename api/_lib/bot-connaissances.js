/**
 * Bot Messenger / Instagram — LES RÉPONSES VALIDÉES, ET RIEN D'AUTRE.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CE FICHIER NE CONTIENT AUCUNE PHRASE ÉCRITE DE MÉMOIRE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Chaque texte servi au client est RECOPIÉ, mot pour mot, des fiches Notion
 * relues et validées le 17/09/2026, telles qu'elles sont reproduites dans
 * `livrables_claude/26_FICHES_BOT_CLIENT.md`. La source de chaque fiche est
 * portée dans le champ `source` : une réponse sans provenance ne peut pas être
 * vérifiée six mois plus tard, donc elle ne vaut rien.
 *
 * ⛔ Deux corrections du dirigeant, datées, qui ne doivent JAMAIS être défaites :
 *
 *   1. « le gérant » — le prénom (Ibrahim) ne sort PLUS côté client depuis le
 *      soir du 17/09. Il reste écrit en interne : Meta exige une escalade vers
 *      un humain *identifiable*, pas anonyme ;
 *   2. « le plus rapidement possible » — AUCUN délai chiffré. « sous 30 minutes
 *      à 1 heure » a vécu une demi-journée avant d'être retiré, et la mention
 *      « la réponse part dans l'heure qui suit » avec lui. Ce qui reste vrai et
 *      utile, c'est l'HORAIRE : la formule est adossée aux heures d'ouverture,
 *      et renvoie à la réouverture en dehors.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LES TROIS FICHES QUI N'EXISTENT PAS ICI, ET POURQUOI
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   - le DÉLAI DE PRODUCTION : aucune source dans le dossier. Pas même une
 *     fourchette. KB-18 sert donc un refus honnête, pas un chiffre ;
 *   - le service EXPRESS : le mot n'apparaît dans aucun livrable. Affirmer
 *     qu'il existe serait déjà une invention. KB-19 transfère ;
 *   - le PAIEMENT (KB-13) : la fiche est exportable, mais son texte client vit
 *     dans Notion et n'est reproduit dans AUCUN fichier du dossier. Le
 *     réécrire de mémoire serait exactement l'invention interdite → une
 *     question de paiement passe la main. Voir `MOTIF_KB13` plus bas.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CE QUI A ÉTÉ AJOUTÉ AUX TEXTES VALIDÉS — UNE SEULE CHOSE, ASSUMÉE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * `MENTION_AUTOMATIQUE` est la seule phrase de ce fichier qui ne vienne pas
 * d'une fiche. Elle est là parce que la règle « ne jamais prétendre être un
 * humain » ne peut pas reposer sur la seule question posée : un client qui
 * n'interroge pas le bot sur sa nature doit quand même voir à qui il parle.
 * Une ligne, à la fin de chaque réponse, et le doute n'existe plus.
 */

/* ═══════════════════════════════════════════════════════════════════════════
   LES FAITS — chacun avec sa source
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Les faits publics de l'imprimerie.
 * Sources : fiche Google Business Profile relue le 17/09/2026 (adresse,
 * horaires, premier numéro) et page Facebook de l'entreprise (second numéro).
 */
export const FAITS = Object.freeze({
  adresse: 'Carrefour Fina, en face de FINAM, Moanda',
  telephones: Object.freeze(['+241 60 44 46 34', '074 42 41 42']),
  fermeture_semaine: '17 h 30',
  fermeture_samedi: '15 h 00',
  ouverture: '7 h 30',
  jour_de_fermeture: 'dimanche',
});

/**
 * La formule d'escalade, tranchée puis corrigée par le dirigeant le 17/09/2026.
 * ⛔ `delai` ne doit JAMAIS devenir un nombre. C'est une décision, pas un oubli.
 */
export const ESCALADE = Object.freeze({
  responsable: 'le gérant',
  delai: 'le plus rapidement possible',
});

/**
 * Le prénom du gérant. Il vit ICI, en interne, parce que Meta exige une
 * escalade vers un humain réel et identifiable — et il ne doit apparaître dans
 * AUCUN texte servi au client. Un test le vérifie sur tout le catalogue.
 */
export const PRENOM_INTERNE = 'Ibrahim';

/** La seule phrase de ce fichier qui ne vienne pas d'une fiche validée. */
export const MENTION_AUTOMATIQUE = '— Réponse automatique de la page Imprimerie OGOOUÉ.';

/** Pourquoi le paiement n'a pas de texte servi, malgré une fiche exportable. */
export const MOTIF_KB13 = 'Le texte client de KB-13 (paiement) vit dans Notion et n\'est reproduit '
  + 'dans aucun fichier du dossier. Le réécrire de mémoire serait une invention : on transfère.';

/* ═══════════════════════════════════════════════════════════════════════════
   LES FICHES — texte servi + phrase de passage à l'humain
   ═══════════════════════════════════════════════════════════════════════════ */

const SOURCE_26 = 'livrables_claude/26_FICHES_BOT_CLIENT.md §1 et §2 — fiches Notion '
  + 'relues et validées le 17/09/2026, corrigées le soir même par le dirigeant';

/**
 * ⚠️ Les chaînes ci-dessous sont des RECOPIES. Toute reformulation, même
 * meilleure, sort du périmètre validé et doit repasser par le gérant.
 */
export const FICHES = Object.freeze([
  Object.freeze({
    id: 'KB-15',
    sujet: 'Quels sont vos horaires d\'ouverture ?',
    intention: 'horaires',
    texte: 'Bonjour ! Nous sommes ouverts du lundi au vendredi de 7 h 30 à 17 h 30, '
      + 'et le samedi de 7 h 30 à 15 h 00. Fermé le dimanche. Vous pouvez passer nous voir '
      + 'au Carrefour Fina, en face de FINAM à Moanda, ou nous appeler au +241 60 44 46 34.',
    escalade: 'Si vous avez besoin d\'une ouverture exceptionnelle, d\'un rendez-vous en dehors '
      + 'de ces heures, ou si votre question porte sur un jour férié, je ne réponds pas moi-même : '
      + 'je transmets votre message au gérant. Il vous répond ici le plus rapidement possible '
      + 'pendant les heures d\'ouverture ci-dessus. Si vous écrivez le soir, le dimanche ou un '
      + 'jour férié, votre message est lu dès la réouverture.',
    source: `${SOURCE_26} · fiche KB-15 · faits : fiche Google Business Profile`,
  }),
  Object.freeze({
    id: 'KB-16',
    sujet: 'Où êtes-vous ? Quelle est votre adresse ?',
    intention: 'adresse',
    texte: 'Nous sommes au Carrefour Fina, juste en face de FINAM, à Moanda, au Gabon. '
      + 'Vous pouvez nous appeler au +241 60 44 46 34 ou au 074 42 41 42.',
    escalade: 'Si vous voulez une livraison, un déplacement sur place ou un itinéraire précis '
      + 'depuis chez vous, je transmets votre message au gérant. Il vous répond ici le plus '
      + 'rapidement possible pendant les heures d\'ouverture de l\'imprimerie. Si vous écrivez '
      + 'le soir, le dimanche ou un jour férié, votre message est lu dès la réouverture.',
    source: `${SOURCE_26} · fiche KB-16 · faits : fiche Google Business Profile + page Facebook`,
  }),
  Object.freeze({
    id: 'KB-17',
    sujet: 'Qu\'est-ce que vous imprimez ? Que faites-vous ?',
    intention: 'prestations',
    // Le textile ouvre la liste : 59,6 % du chiffre d'affaires, et c'est
    // justement la ligne invisible sur la fiche Google publique.
    texte: 'Voici ce que nous faisons à l\'Imprimerie OGOOUÉ. Personnalisation textile : '
      + 't-shirts, polos, casquettes, gilets et tenues d\'équipe, à l\'unité comme en série. '
      + 'Impression de documents et de rapports, photocopies, reliure. Cartes de visite, '
      + 'faire-part et invitations. Tampons et cachets professionnels. Photos d\'identité. '
      + 'Badges et plastification. Banderoles et impression grand format. Création graphique '
      + 'et gravure. Dites-nous ce que vous voulez faire et en quelle quantité, et nous vous '
      + 'répondons.',
    escalade: 'Pour le prix, le délai, la quantité minimale ou un devis, je ne réponds pas '
      + 'moi-même : je transmets votre demande au gérant, avec ce que vous m\'avez dit. Il vous '
      + 'répond ici le plus rapidement possible pendant les heures d\'ouverture de l\'imprimerie. '
      + 'Si vous écrivez le soir, le dimanche ou un jour férié, votre message est lu dès la '
      + 'réouverture.',
    source: `${SOURCE_26} · fiche KB-17 · faits : description Google + catalogue de référence `
      + '+ journal de ventes',
  }),
  Object.freeze({
    id: 'KB-18',
    sujet: 'En combien de temps ma commande est-elle prête ?',
    intention: 'delai',
    // ⛔ Fiche NON exportable : aucun délai de production n'existe dans le
    //    dossier. Ce texte est le refus honnête écrit dans le document 26 §2.1.
    texte: 'Pour le délai, je préfère ne pas vous donner un chiffre au hasard : ça dépend de ce '
      + 'que vous voulez faire et de la quantité. Dites-moi ce dont vous avez besoin, je transmets '
      + 'votre message au gérant. Il vous répond ici le plus rapidement possible pendant les heures '
      + 'd\'ouverture de l\'imprimerie. Si vous écrivez le soir, le dimanche ou un jour férié, '
      + 'votre message est lu dès la réouverture.',
    escalade: '',
    source: `${SOURCE_26} · fiche KB-18 · aucun délai de production documenté : rien à servir`,
  }),
  Object.freeze({
    id: 'KB-19',
    sujet: 'Pouvez-vous faire ma commande en urgence ?',
    intention: 'urgence',
    // Le téléphone compte double ici : depuis le retrait du délai chiffré,
    // c'est la seule voie réellement immédiate hors horaires.
    texte: 'C\'est urgent, j\'ai bien noté. Je ne peux pas vous le confirmer moi-même : '
      + 'je transmets tout de suite votre message au gérant. Il vous répond ici le plus '
      + 'rapidement possible pendant les heures d\'ouverture de l\'imprimerie. Si vous écrivez '
      + 'le soir, le dimanche ou un jour férié, votre message est lu dès la réouverture. '
      + 'Si c\'est vraiment pressé, appelez le +241 60 44 46 34.',
    escalade: '',
    source: `${SOURCE_26} · fiche KB-19 · le service « express » n'est documenté nulle part`,
  }),
]);

/** Accès par identifiant, sans reparcourir la liste à chaque appel. */
const PAR_ID = new Map(FICHES.map((f) => [f.id, f]));

/** @param {string} id @returns {object|null} */
export function fiche(id) {
  return PAR_ID.get(id) || null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   LES DEUX TEXTES QUI NE VIENNENT PAS D'UNE FICHE
   ═══════════════════════════════════════════════════════════════════════════

   Ils sont construits sur la MÊME formule d'escalade que les fiches — « au
   gérant », « le plus rapidement possible pendant les heures d'ouverture »,
   « dès la réouverture ». Rien de neuf n'y est promis. */

/** La formule de passage à l'humain, telle qu'elle vit dans quatre fiches. */
const FORMULE_ESCALADE = 'je transmets votre message au gérant. Il vous répond ici le plus '
  + 'rapidement possible pendant les heures d\'ouverture de l\'imprimerie. Si vous écrivez '
  + 'le soir, le dimanche ou un jour férié, votre message est lu dès la réouverture.';

/** Question hors périmètre : on transfère, on ne brode pas. */
export const TEXTE_GENERIQUE = `Bonjour ! Je ne peux pas répondre à cette question moi-même : ${FORMULE_ESCALADE}`;

/** Pris pour quelqu'un, le bot le dit — sans détour et sans s'excuser. */
export const TEXTE_IDENTITE = 'Je suis la réponse automatique de la page de l\'Imprimerie OGOOUÉ : '
  + 'pas une personne. Je peux vous donner l\'adresse, les horaires et ce que nous faisons. '
  + `Pour tout le reste, ${FORMULE_ESCALADE}`;
