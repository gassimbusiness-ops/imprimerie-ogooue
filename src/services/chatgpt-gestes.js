/**
 * LES GESTES QUE CHATGPT A LE DROIT D'ÉCRIRE — la liste, et rien qu'elle.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CE QUE LE DIRIGEANT A DEMANDÉ
 * ════════════════════════════════════════════════════════════════════════════
 *
 * « On aimerait, depuis ChatGPT, demander de changer quelque chose dans
 * l'application. Par exemple : "Aujourd'hui j'ai payé 100 000 francs de
 * travaux, donc tu mets dans la partie Travaux." Ou : "Cette semaine on n'a pas
 * pu faire le dépôt sur la banque, on a gardé en cash." »
 *
 * Et, sur la question de la confirmation : « sans confirmation, il écrit
 * direct — mais qu'on puisse quand même modifier si c'est mal fait. »
 *
 * ⚠️ OBJECTION POSÉE UNE FOIS, PUIS LE TRAVAIL FAIT QUAND MÊME : un assistant
 * conversationnel se trompe de montant, de compte et de date sans jamais
 * hésiter, et ici personne ne relit avant que ça tombe dans une caisse réelle.
 * Le dirigeant a tranché en connaissance de cause. Ce qui remplace la
 * confirmation, ce sont les quatre garde-fous ci-dessous — et ils ne valent que
 * s'ils tiennent tous les quatre.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * POURQUOI UNE LISTE FERMÉE, ET PAS « ÉCRIRE OÙ IL VEUT »
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Un pont générique (« écris `{collection, data}` ») aurait été plus court à
 * écrire et impossible à tenir : il n'aurait su refuser ni un salaire, ni un
 * apport d'associé, ni un solde bancaire réécrit à la main. La liste ci-dessous
 * est donc FERMÉE : cinq gestes nommés, chacun avec ses champs, ses valeurs
 * autorisées et la forme exacte de la ligne qu'il produit. Tout le reste est un
 * 400, pas une improvisation.
 *
 * INTERDITS, sur consigne explicite : paie, salaires, associés (apports,
 * dettes, remboursements), comptes bancaires eux-mêmes, utilisateurs. Ces
 * écritures-là restent à la main. `COLLECTIONS_INTERDITES` les nomme — une
 * liste blanche seule se contourne par oubli, une liste noire dit le refus.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⛔ LE PIÈGE DE LA FUITE D'ARGENT — la raison d'être de `resoudreCompte()`
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Un `mouvements_financiers` écrit avec `compte_id: ''` ne débite JAMAIS le
 * compte : `effetSurSoldes()` commence par `if (!compteId) return;`. Le journal
 * montre une sortie de 100 000 F, le solde ne bouge pas — et supprimer la ligne
 * ensuite ne corrige rien non plus, puisque l'effet inverse est vide lui aussi.
 * La ligne est définitivement inerte, et l'écart ne se voit qu'au comptage du
 * tiroir, des semaines plus tard.
 *
 * `src/features/travaux/page.jsx` tombe dans ce piège : si aucun compte ne
 * correspond au mot-clé, il écrit quand même. Ici, c'est un REFUS. Un geste qui
 * ne trouve pas son compte échoue bruyamment ; il ne produit pas une écriture
 * qui a l'air d'avoir eu lieu.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * MODULE PUR — aucune base, aucun réseau, aucun React
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Il ne fait que DÉCIDER : « voici les opérations à appliquer ». Ce sont
 * `api/_lib/chatgpt-ecriture.js` (côté serveur, pour ChatGPT) et
 * `src/features/chatgpt-ecritures/page.jsx` (côté écran, pour le bouton
 * « Annuler » du gérant) qui les exécutent. Une seule règle, deux exécutants :
 * c'est la seule façon que l'annulation faite à l'écran et celle faite par
 * ChatGPT ne divergent jamais.
 *
 * Testé par `tests/chatgpt-ecriture.test.mjs`.
 */
import { estDateMetier } from '../lib/dates.js';
import { ACTIVITES, normaliserActivite, avecActivite } from './activites.js';
import { effetSurSoldes, estTransfertInterne } from './mouvements-financiers.js';
import { quantiteArticle } from './stocks-seuils.js';
import { CATEGORIES_RAPPORT, caRapport, depensesRapport } from './finance-calc.js';
import { payloadSansTotauxFiges } from '../features/rapports/import-excel.js';
import { normaliserNom, nettoyerNom } from '../features/devis-factures/client-resolution.js';

/* ═══════════════════════════════════════════════════════════════════════════
   LES NOMS — marqueur, clé, préfixe d'identifiant
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Marqueur de provenance, posé À PLAT sur la ligne.
 *
 * ⚠️ À plat, et pas seulement dans l'objet `chatgpt` imbriqué : c'est ce champ
 * que la voie de lecture `collection` sait filtrer (`data->>via_chatgpt`), et
 * donc le seul moyen de retrouver ces écritures sans télécharger la table.
 */
export const CHAMP_MARQUEUR = 'via_chatgpt';

/** Clé d'idempotence, à plat pour la même raison. */
export const CHAMP_CLE = 'chatgpt_cle';

/** Préfixe de tout identifiant rendu par le pont. */
export const PREFIXE_IDENTIFIANT = 'chatgpt:';

/** Suffixe de contre-passation — le même que `contre-passation-commande.js`. */
export const SUFFIXE_ANNULATION = ':annulation';

/** Ce qu'on préfixe au libellé d'une ligne annulée, pour que l'écran le montre. */
export const PREFIXE_ANNULE = '[ANNULÉ] ';

/**
 * Les valeurs telles qu'elles étaient AVANT une correction.
 *
 * Posé par les gestes qui MODIFIENT une ligne existante (prix du catalogue,
 * seuil d'alerte, statut d'une commande ou d'une facture). Sans lui, annuler
 * une correction ne pourrait que marquer la ligne — et le prix corrigé
 * resterait corrigé.
 */
export const CHAMP_AVANT = 'chatgpt_avant';

/**
 * Où poser « [ANNULÉ] » pour que l'écran d'origine le montre SANS être modifié.
 *
 * ⚠️ Volontairement limité aux écrans internes. Renommer une fiche client, un
 * produit du catalogue ou une facture abîmerait une donnée que d'autres écrans
 * — et le portail client — affichent telle quelle.
 */
export const CHAMP_LIBELLE_ANNULABLE = Object.freeze({
  taches: 'titre',
  etapes_travaux: 'nom',
  projets_travaux: 'nom',
  evenements: 'nom',
  objectifs: 'titre',
});

/* ═══════════════════════════════════════════════════════════════════════════
   LA LISTE FERMÉE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Les gestes servis, et rien d'autre.
 *
 * ⚠️ La liste est FERMÉE et elle le reste : on y ajoute des entrées, on ne
 * l'ouvre jamais. Chaque nom correspond à une fabrique dans `FABRIQUES`, en bas
 * de ce fichier, et un `GESTES` qui contiendrait un nom sans fabrique (ou
 * l'inverse) fait échouer un test — c'est la seule façon d'être sûr que la
 * liste affichée à ChatGPT est bien celle que le serveur sait exécuter.
 *
 * Les cinq premiers sont ceux du périmètre d'origine ; les suivants ont été
 * ajoutés quand le dirigeant a demandé « les événements et tous les trucs
 * possibles de tous les modules qu'on a sur admin ».
 */
export const GESTES = Object.freeze([
  // ── Périmètre d'origine ────────────────────────────────────────────────
  'depense',
  'recette',
  'caisse-mouvement',
  'travaux',
  'tache',
  // ── « Tous les trucs possibles de tous les modules » ────────────────────
  'projet-travaux',
  'catalogue',
  'stock-mouvement',
  'rapport',
  'commande',
  'client',
  'evenement',
  'prospect',
  'objectif',
  'cloture-caisse',
  'devis',
  'facture',
]);

/**
 * CE QUI N'EST PAS LIVRÉ, ET POURQUOI.
 *
 * Le dirigeant a demandé « tous les trucs possibles de tous les modules ».
 * Ces gestes-là ont été examinés et ÉCARTÉS : leur règle d'écran ne peut pas
 * être reprise fidèlement ici, et un geste approximatif qui touche à l'argent
 * ou à la paie coûte plus cher qu'un geste absent.
 *
 * Cette liste n'est pas une note de bas de page : elle est servie à ChatGPT
 * dans le refus, pour qu'il dise au gérant quoi faire à l'écran plutôt que de
 * réessayer en boucle.
 */
export const GESTES_NON_LIVRES = Object.freeze({
  'commande-livree':
    "Passer une commande à « livrée » enchaîne six effets (facture, encaissement, sortie de "
    + "stock, points de fidélité, rapport, tâche) qui vivent dans l'écran Commandes et pas dans "
    + "un module partagé — l'un d'eux affiche même un message à l'écran au milieu du calcul. Les "
    + "réécrire ici ferait DEUX livraisons différentes, et c'est de l'argent. À faire à l'écran.",
  'commande-annulee':
    "Annuler une commande contre-passe l'encaissement, le stock, les points et la facture, "
    + "selon ce qui a réellement eu lieu. À faire à l'écran Commandes.",
  'devis-converti':
    "Convertir un devis en facture calcule le numéro sur le NOMBRE de factures déjà chargées "
    + "(`FAC-000N`) : depuis un serveur qui tourne pendant que le gérant est à l'écran, deux "
    + "factures reçoivent le même numéro. Et rien en base ne rattrape le doublon. À faire à l'écran.",
  pointage:
    "Un pointage est une écriture de PAIE : chaque jour pointé ajoute `salaire_base / 26` au net "
    + "à payer du mois. Un doublon surpaie, et une date décalée d'un fuseau range le jour dans le "
    + 'mois précédent. Les salaires restent à la main, comme convenu.',
  'demande-rh':
    "Les avances et les charges du module RH se déduisent du net à payer : c'est de la paie. "
    + "Et leur passage en « payée » sort de l'argent d'un compte choisi à la main. À faire à l'écran.",
  'charge-fixe':
    "Créer une charge fixe en prélèvement automatique arme un débit récurrent que plus personne "
    + "ne relit. L'écran Finances exige un aperçu chiffré et une confirmation avant chaque "
    + 'prélèvement : ce garde-fou humain ne se délègue pas.',
  messagerie:
    "Le portail client retrouve sa conversation par repli sur le nom en minuscules, et l'annuaire "
    + 'contient des doublons : une conversation créée ici pourrait être lue par un homonyme. '
    + "Tant que ce repli existe, le pont n'écrit pas de messages.",
});

/**
 * Les seules collections que ces gestes écrivent.
 *
 * ⚠️ Toute entrée ajoutée ici est une porte de plus. Elle doit correspondre à
 * un geste nommé, et le test qui apparie les deux listes échoue sinon.
 */
export const COLLECTIONS_ECRITURES = Object.freeze([
  'mouvements_financiers',
  'etapes_travaux',
  'taches',
  'depots_hebdo',
  'projets_travaux',
  'produits_catalogue',
  'produits',
  'mouvements_stock',
  'rapports',
  'commandes',
  'clients',
  'evenements',
  'prospects',
  'objectifs',
  'clotures_caisse',
  'devis',
  'factures',
]);

/**
 * Ce à quoi ChatGPT ne touche pas, et qui est nommé pour qu'on le voie.
 *
 * Une liste blanche seule suffirait à la machine ; elle ne suffit pas à un
 * relecteur, ni au test qui doit pouvoir affirmer « la paie est refusée » en
 * citant le nom de la collection. Consigne du dirigeant : paie, salaires,
 * associés, comptes bancaires eux-mêmes, utilisateurs — à la main.
 */
export const COLLECTIONS_INTERDITES = Object.freeze([
  'employes',
  'users',
  'pointages',
  'performances_employes',
  'demandes_rh',
  'apports_associes',
  'dettes_associes',
  'remboursements_associes',
  'actionnaires',
  'investisseurs',
  'modifications_investisseurs',
  'comptes_bancaires',
  'gouvernance_parametres',
  'parametres',
  'charges_fixes',
  'dettes',
  'audit_logs',
]);

/**
 * Une collection est-elle écrivable par un geste ChatGPT ?
 *
 * ⚠️ `comptes_bancaires` est INTERDITE ici, et pourtant le solde d'un compte
 * bouge quand une dépense est enregistrée. Ce n'est pas une contradiction :
 * l'ajustement de solde est une OPÉRATION à part (`{ op: 'solde' }`), qui ne
 * peut modifier qu'un nombre, jamais créer un compte, le renommer, ni toucher
 * un autre de ses champs. « Ne pas toucher aux comptes bancaires eux-mêmes »
 * veut dire ça.
 */
export function collectionAutorisee(nom) {
  return COLLECTIONS_ECRITURES.includes(nom) && !COLLECTIONS_INTERDITES.includes(nom);
}

/* ═══════════════════════════════════════════════════════════════════════════
   LES COMPTES — résolution par mot-clé, refus si introuvable
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Mot-clé de compte → morceaux de nom à chercher.
 *
 * Repris tel quel de `src/features/travaux/page.jsx` (`SOURCE_KEYWORDS`) et de
 * la liste blanche de `finance-calc.js` : ce sont les comptes de la trésorerie
 * de l'imprimerie. Les comptes internationaux (Wise, Stripe, PayPal, Mercury,
 * Airwallex) n'y figurent VOLONTAIREMENT pas : rien de ce que le gérant dicte
 * depuis Moanda ne s'y passe, et un mouvement dicté par erreur sur un compte
 * britannique serait invisible dans tous les écrans de caisse.
 */
export const MOTS_CLES_COMPTE = Object.freeze({
  caisse: ['caisse', 'liquide'],
  finam: ['finam'],
  bgfi: ['bgfi'],
  airtel: ['airtel'],
  moov: ['moov'],
});

/** Écritures tolérées pour un même compte. Un import ou une dictée varient. */
const ALIAS_COMPTE = Object.freeze({
  liquide: 'caisse',
  especes: 'caisse',
  cash: 'caisse',
  tiroir: 'caisse',
  airtel_money: 'airtel',
  'airtel money': 'airtel',
  moov_money: 'moov',
  'moov money': 'moov',
  'bgfi gabon': 'bgfi',
  banque: 'bgfi',
});

/** Mot-clé canonique d'un compte, ou `null` si la valeur n'en désigne aucun. */
export function motCleCompte(valeur) {
  if (typeof valeur !== 'string') return null;
  const v = valeur.trim().toLowerCase();
  if (!v) return null;
  const canonique = ALIAS_COMPTE[v] || v;
  return Object.prototype.hasOwnProperty.call(MOTS_CLES_COMPTE, canonique) ? canonique : null;
}

/**
 * Trouve le compte réel derrière un mot-clé.
 *
 * Rend `null` plutôt qu'un compte par défaut : se rabattre sur « le premier
 * compte venu » ferait tomber une sortie de caisse sur la BGFI sans que
 * personne le voie. L'appelant doit refuser le geste. Voir l'en-tête.
 *
 * @param {Array<{id: string, nom: string}>} comptes
 * @param {string} valeur mot-clé dicté (`caisse`, `bgfi`, `airtel money`…)
 * @returns {{id: string, nom: string}|null}
 */
export function resoudreCompte(comptes, valeur) {
  const cle = motCleCompte(valeur);
  if (!cle) return null;
  const morceaux = MOTS_CLES_COMPTE[cle];
  return (comptes || []).find((c) => {
    const nom = String(c?.nom || '').toLowerCase();
    return morceaux.some((m) => nom.includes(m));
  }) || null;
}

/** Les mots-clés acceptés, pour les messages d'erreur et le schéma OpenAPI. */
export const COMPTES_ACCEPTES = Object.freeze(Object.keys(MOTS_CLES_COMPTE));

/* ═══════════════════════════════════════════════════════════════════════════
   LES VALEURS AUTORISÉES — celles des écrans, jamais des valeurs inventées
   ═══════════════════════════════════════════════════════════════════════════ */

/** Priorités d'une tâche — `PRIORITES` de `src/features/taches/page.jsx`. */
export const PRIORITES_TACHE = Object.freeze(['urgente', 'haute', 'normale', 'basse']);

/** Catégories d'une tâche — `CATEGORIES` de `src/features/taches/page.jsx`. */
export const CATEGORIES_TACHE = Object.freeze([
  'Commande', 'Impression', 'Reliure', 'Design', 'Livraison',
  'Administratif', 'Maintenance', 'Autre',
]);

/** Les deux mouvements de caisse que le dirigeant a décrits. */
export const GESTES_CAISSE = Object.freeze(['depot_banque', 'garde_en_cash']);

/* ═══════════════════════════════════════════════════════════════════════════
   VALIDATION — des refus qui disent quoi corriger
   ═══════════════════════════════════════════════════════════════════════════ */

function refus(erreur, detail, statut = 400) {
  return { ok: false, statut, erreur, detail };
}

/** Une chaîne non vide, nettoyée. `null` si elle ne l'est pas. */
function texte(valeur, maxi = 500) {
  if (typeof valeur !== 'string') return null;
  const v = valeur.trim();
  if (!v) return null;
  return v.slice(0, maxi);
}

/**
 * Un montant en francs CFA.
 *
 * Refuse les décimales plutôt que de les arrondir : le franc CFA n'a pas de
 * centime, et un arrondi silencieux sur de l'argent est exactement le genre
 * d'écart qu'on ne retrouve plus au comptage du tiroir.
 *
 * @returns {number|null}
 */
export function montantValide(valeur) {
  if (valeur === null || valeur === undefined || valeur === '') return null;
  if (typeof valeur === 'boolean') return null;
  const n = Number(valeur);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
  return n;
}

/** La date métier du geste : celle dictée si elle existe VRAIMENT, sinon celle de Moanda. */
function dateDuGeste(valeur, ctx) {
  if (valeur === undefined || valeur === null || valeur === '') return { date: ctx.date_locale };
  if (!estDateMetier(valeur)) return { erreur: true };
  return { date: valeur };
}

/**
 * Le marqueur de provenance, posé sur CHAQUE ligne écrite.
 *
 * C'est lui qui remplace la confirmation : puisque personne ne relit avant, il
 * faut qu'on puisse toujours retrouver ce qui a été écrit, à partir de quelle
 * phrase, et à quelle heure de Moanda.
 */
export function marqueurChatGPT({ geste, cle, phrase, ctx }) {
  return {
    [CHAMP_MARQUEUR]: true,
    [CHAMP_CLE]: cle,
    chatgpt: {
      geste,
      cle,
      phrase,
      ecrit_le: { ...ctx },
    },
  };
}

/** L'identifiant public d'une écriture — c'est lui qu'on redonne pour annuler. */
export function identifiantDe(cle) {
  return `${PREFIXE_IDENTIFIANT}${cle}`;
}

/** La clé derrière un identifiant, ou `null` si la forme n'est pas la bonne. */
export function cleDepuisIdentifiant(identifiant) {
  if (typeof identifiant !== 'string') return null;
  if (!identifiant.startsWith(PREFIXE_IDENTIFIANT)) return null;
  const cle = identifiant.slice(PREFIXE_IDENTIFIANT.length).trim();
  return cle || null;
}

/** Format d'une clé d'idempotence acceptable. Ni vide, ni un roman. */
const RE_CLE = /^[A-Za-z0-9_:.-]{4,80}$/;

/* ═══════════════════════════════════════════════════════════════════════════
   LES OPÉRATIONS — ce que le geste demande d'appliquer
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Une écriture de ligne.
 * `id_op` sert aux opérations de solde : un solde ne bouge QUE si la création
 * dont il dépend a réellement eu lieu (modèle `api/_lib/singpay-encaissement.js`).
 */
function opCreer(collection, data, id_op = null) {
  return { op: 'creer', collection, data, id_op };
}

/**
 * Modification d'une ligne existante.
 *
 * `conditionne_par` sert au même usage que sur `opSolde` : ne toucher la ligne
 * QUE si la création dont elle dépend a réellement eu lieu. Décrémenter un
 * stock dont le mouvement a été rejeté en doublon ferait disparaître des
 * articles sans qu'aucune ligne ne l'explique.
 */
function opModifier(collection, id, champs, conditionne_par = null) {
  return { op: 'modifier', collection, id, champs, conditionne_par };
}

function opSolde(compte_id, delta, conditionne_par) {
  return { op: 'solde', compte_id, delta, conditionne_par };
}

/**
 * Les opérations de solde d'un mouvement, calculées par `effetSurSoldes`.
 *
 * ⚠️ Jamais à la main. `travaux/page.jsx` refait le calcul lui-même
 * (`const delta = type === 'sortie' ? -montant : montant`) et ignore donc
 * complètement le cas du transfert : un dépôt y créditerait la banque sans
 * débiter la caisse.
 */
function soldesDuMouvement(mouvement, id_op, { inverser = false } = {}) {
  return Object.entries(effetSurSoldes(mouvement, { inverser }))
    .filter(([, delta]) => delta !== 0)
    .map(([compteId, delta]) => opSolde(compteId, delta, id_op));
}

/* ═══════════════════════════════════════════════════════════════════════════
   LA FABRIQUE DE MOUVEMENTS — une seule forme, pour tous les gestes
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Construit une ligne `mouvements_financiers` à la forme exacte de celles des
 * écrans : mêmes champs, même convention de compte, même `reference` porteuse
 * de l'idempotence (index unique partiel, migration 005).
 */
function mouvement({
  type, montant, description, compteId, compteDestId = '', date,
  reference, categorie, activite, marqueur,
}) {
  return {
    type,
    montant,
    description,
    compte_id: compteId,
    ...(compteDestId ? { compte_dest_id: compteDestId } : {}),
    date,
    reference,
    categorie,
    source: 'chatgpt',
    activite: normaliserActivite(activite),
    pointe: false,
    ...marqueur,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   LES CINQ GESTES
   ═══════════════════════════════════════════════════════════════════════════ */

/** Sépare les milliers sans dépendre d'`Intl`, dont l'espace change avec ICU. */
function fmt(n) {
  return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function gesteArgent({ sens, corps, ctx, contexte, marqueur, cle, geste }) {
  const { comptes } = contexte;
  const montant = montantValide(corps.montant);
  if (montant === null) {
    return refus(
      'Montant invalide',
      'Le montant doit être un nombre entier de francs CFA, strictement supérieur à zéro.',
    );
  }
  const motif = texte(corps.motif, 300);
  if (!motif) {
    return refus(
      'Motif requis',
      sens === 'sortie'
        ? "Une sortie de caisse sans raison écrite ne se retrouve plus : dis à quoi l'argent a servi."
        : "Dis d'où vient cette recette.",
    );
  }
  const compte = resoudreCompte(comptes, corps.compte ?? 'caisse');
  if (!compte) {
    return refus(
      'Compte introuvable',
      `Compte « ${corps.compte ?? 'caisse'} » inconnu. Comptes acceptés : ${COMPTES_ACCEPTES.join(', ')}.`,
    );
  }
  const d = dateDuGeste(corps.date, ctx);
  if (d.erreur) return refus('Date invalide', 'Format attendu : AAAA-MM-JJ, et le jour doit exister.');

  const activite = corps.activite === undefined ? undefined : corps.activite;
  if (activite !== undefined && !ACTIVITES.includes(String(activite).trim().toLowerCase())) {
    return refus('Activité inconnue', `Valeurs acceptées : ${ACTIVITES.join(', ')}.`);
  }

  const reference = identifiantDe(cle);
  const ligne = mouvement({
    type: sens,
    montant,
    description: motif,
    compteId: compte.id,
    date: d.date,
    reference,
    categorie: sens === 'sortie' ? 'depense_chatgpt' : 'recette_chatgpt',
    activite,
    marqueur,
  });

  return {
    ok: true,
    temoin: { collection: 'mouvements_financiers', reference },
    operations: [
      opCreer('mouvements_financiers', ligne, 'mvt'),
      ...soldesDuMouvement(ligne, 'mvt'),
    ],
    resume: `${sens === 'sortie' ? 'Dépense' : 'Recette'} de ${fmt(montant)} F sur ${compte.nom.trim()} `
      + `le ${d.date} — ${motif}.`,
    journal: {
      module: 'finances',
      entity_label: motif,
      details: `${sens === 'sortie' ? 'Dépense' : 'Recette'} de ${fmt(montant)} F CFA sur `
        + `« ${compte.nom.trim()} », date ${d.date}, motif « ${motif} »`,
      metadata: { geste, montant, compte: compte.nom.trim(), compte_id: compte.id, date: d.date, motif },
    },
  };
}

/**
 * Mouvement de caisse — les deux cas que le dirigeant a décrits.
 *
 * ── « On n'a pas pu faire le dépôt, on a gardé en cash » ──────────────────
 *
 * Garder l'argent où il est ne le DÉPLACE pas. Écrire un mouvement financier
 * ici doublerait la somme : elle est déjà dans le solde de la caisse, créditée
 * au fil des encaissements. Le geste écrit donc un CONSTAT dans `depots_hebdo`
 * — la collection déclarée dans `src/services/db.js` et restée vide jusqu'ici —
 * et ne touche aucun solde. C'est exactement ce que le dirigeant a demandé de
 * tracer : le fait que le dépôt n'a pas eu lieu.
 *
 * ── « On a déposé à la banque » ──────────────────────────────────────────
 *
 * C'est un TRANSFERT INTERNE (arbitrage métier n°13, Q3 du 14/09/2026) :
 * `compte_id` = d'où l'argent sort, `compte_dest_id` = où il arrive. Sans
 * destination, `effetSurSoldes()` ne fait RIEN — la caisse serait débitée dans
 * le journal sans que la banque monte, et l'argent disparaîtrait des totaux.
 * On refuse donc, plutôt que d'écrire un transfert boiteux.
 */
function gesteCaisse({ corps, ctx, contexte, marqueur, cle }) {
  const { comptes } = contexte;
  const quoi = texte(corps.geste, 40);
  if (!GESTES_CAISSE.includes(quoi)) {
    return refus(
      'Mouvement de caisse inconnu',
      `Champ « geste » attendu : ${GESTES_CAISSE.join(' ou ')}.`,
    );
  }
  const montant = montantValide(corps.montant);
  if (montant === null) {
    return refus('Montant invalide', 'Nombre entier de francs CFA, strictement supérieur à zéro.');
  }
  const d = dateDuGeste(corps.date, ctx);
  if (d.erreur) return refus('Date invalide', 'Format attendu : AAAA-MM-JJ, et le jour doit exister.');
  const motif = texte(corps.motif, 300) || '';

  if (quoi === 'garde_en_cash') {
    const constat = {
      date: d.date,
      semaine: texte(corps.semaine, 20) || '',
      depose: false,
      montant_garde: montant,
      motif,
      activite: normaliserActivite(corps.activite),
      ...marqueur,
    };
    return {
      ok: true,
      temoin: { collection: 'depots_hebdo', cle },
      operations: [opCreer('depots_hebdo', constat)],
      resume: `Constat : ${fmt(montant)} F gardés en caisse le ${d.date}, pas déposés en banque. `
        + "Aucun solde n'a bougé — l'argent était déjà dans la caisse.",
      journal: {
        module: 'finances',
        entity_label: 'Dépôt non effectué',
        details: `Dépôt bancaire NON effectué : ${fmt(montant)} F gardés en espèces le ${d.date}`
          + (motif ? ` — ${motif}` : ''),
        metadata: { geste: 'garde_en_cash', montant, date: d.date, motif },
      },
    };
  }

  const source = resoudreCompte(comptes, corps.compte_source ?? 'caisse');
  if (!source) {
    return refus(
      'Compte de départ introuvable',
      `Comptes acceptés : ${COMPTES_ACCEPTES.join(', ')}.`,
    );
  }
  const destination = resoudreCompte(comptes, corps.compte_destination);
  if (!destination) {
    return refus(
      'Compte de destination requis',
      "Un dépôt DÉPLACE de l'argent : sans compte d'arrivée, rien n'est débité et la somme "
      + `disparaîtrait des totaux. Comptes acceptés : ${COMPTES_ACCEPTES.join(', ')}.`,
    );
  }
  if (source.id === destination.id) {
    return refus('Départ et arrivée identiques', "Un dépôt sur le compte de départ ne déplace rien.");
  }

  const reference = identifiantDe(cle);
  const ligne = mouvement({
    type: 'depot_hebdo',
    montant,
    description: motif || `Dépôt en banque — ${destination.nom.trim()}`,
    compteId: source.id,
    compteDestId: destination.id,
    date: d.date,
    reference,
    categorie: 'depot_banque',
    activite: corps.activite,
    marqueur,
  });

  return {
    ok: true,
    temoin: { collection: 'mouvements_financiers', reference },
    operations: [
      opCreer('mouvements_financiers', ligne, 'mvt'),
      ...soldesDuMouvement(ligne, 'mvt'),
    ],
    resume: `Dépôt de ${fmt(montant)} F : ${source.nom.trim()} → ${destination.nom.trim()}, le ${d.date}. `
      + "La caisse baisse d'autant que la banque monte.",
    journal: {
      module: 'finances',
      entity_label: 'Dépôt en banque',
      details: `Dépôt de ${fmt(montant)} F CFA de « ${source.nom.trim()} » vers `
        + `« ${destination.nom.trim()} », date ${d.date}`,
      metadata: {
        geste: 'depot_banque', montant, date: d.date,
        compte_source: source.nom.trim(), compte_destination: destination.nom.trim(),
      },
    },
  };
}

/**
 * Étape de travaux, avec ou sans son coût payé.
 *
 * Reprend les règles de `src/features/travaux/page.jsx` : une étape dont le
 * coût n'est pas payé n'écrit AUCUN mouvement (prévoir une dépense n'est pas
 * la payer), et une étape payée débite le compte de la source de paiement.
 *
 * Un projet inconnu est refusé : une étape orpheline n'apparaît sur aucun
 * écran (l'écran Travaux les liste par projet), donc elle serait invisible tout
 * en ayant débité la caisse.
 */
function gesteTravaux({ corps, ctx, contexte, marqueur, cle }) {
  const { comptes, projets } = contexte;
  const nomEtape = texte(corps.etape, 200);
  if (!nomEtape) return refus('Nom d\'étape requis', 'Dis ce qui a été fait, par exemple « Peinture ».');

  const demande = texte(corps.projet, 200);
  if (!demande) {
    return refus(
      'Projet requis',
      `Projets existants : ${(projets || []).map((p) => p.nom).join(', ') || 'aucun'}.`,
    );
  }
  const cible = String(demande).toLowerCase();
  const projet = (projets || []).find(
    (p) => p.id === demande || String(p.nom || '').trim().toLowerCase() === cible,
  );
  if (!projet) {
    return refus(
      'Projet inconnu',
      `« ${demande} » ne correspond à aucun projet. Projets existants : `
      + `${(projets || []).map((p) => p.nom).join(', ') || 'aucun'}. Crée-le d'abord à l'écran.`,
    );
  }

  const cout = corps.cout === undefined || corps.cout === null || corps.cout === ''
    ? 0
    : montantValide(corps.cout);
  if (cout === null) {
    return refus('Coût invalide', 'Nombre entier de francs CFA, strictement supérieur à zéro, ou rien du tout.');
  }
  const paye = corps.paye === true;
  if (paye && cout <= 0) {
    return refus('Coût requis', 'Une étape déclarée payée doit porter le montant payé.');
  }
  const d = dateDuGeste(corps.date, ctx);
  if (d.erreur) return refus('Date invalide', 'Format attendu : AAAA-MM-JJ, et le jour doit exister.');

  let compte = null;
  if (paye) {
    compte = resoudreCompte(comptes, corps.compte ?? 'caisse');
    if (!compte) {
      return refus(
        'Compte introuvable',
        `Compte « ${corps.compte ?? 'caisse'} » inconnu. Comptes acceptés : ${COMPTES_ACCEPTES.join(', ')}.`,
      );
    }
  }

  const etape = {
    nom: nomEtape,
    description: texte(corps.description, 500) || '',
    statut: paye ? 'termine' : 'en_attente',
    budget: montantValide(corps.budget) || cout,
    depense: cout,
    statut_paiement: paye ? 'paye' : 'non_paye',
    source_paiement: compte ? motCleCompte(corps.compte ?? 'caisse') : 'caisse',
    projet_id: projet.id,
    date: d.date,
    ...marqueur,
  };

  const operations = [opCreer('etapes_travaux', etape, 'etape')];
  let resume = `Étape « ${nomEtape} » ajoutée au projet ${projet.nom}`;

  if (paye) {
    const reference = identifiantDe(cle);
    const ligne = mouvement({
      type: 'sortie',
      montant: cout,
      description: `Travaux: ${projet.nom} — ${nomEtape}`,
      compteId: compte.id,
      date: d.date,
      reference,
      categorie: 'travaux',
      activite: corps.activite,
      marqueur,
    });
    operations.push(opCreer('mouvements_financiers', ligne, 'mvt'));
    operations.push(...soldesDuMouvement(ligne, 'mvt'));
    resume += `, payée ${fmt(cout)} F sur ${compte.nom.trim()} le ${d.date}.`;
  } else {
    resume += cout > 0
      ? `, coût prévu ${fmt(cout)} F, NON payée — aucun compte n'a été débité.`
      : ', sans coût.';
  }

  return {
    ok: true,
    temoin: { collection: 'etapes_travaux', cle },
    operations,
    resume,
    journal: {
      module: 'travaux',
      entity_label: `${projet.nom} — ${nomEtape}`,
      details: paye
        ? `Étape « ${nomEtape} » (projet ${projet.nom}) payée ${fmt(cout)} F CFA sur `
          + `« ${compte.nom.trim()} », date ${d.date}`
        : `Étape « ${nomEtape} » (projet ${projet.nom}) créée sans paiement, coût prévu ${fmt(cout)} F CFA`,
      metadata: {
        geste: 'travaux', projet: projet.nom, projet_id: projet.id,
        etape: nomEtape, cout, paye, date: d.date,
      },
    },
  };
}

/** Une tâche, aux valeurs exactes de `src/features/taches/page.jsx`. */
function gesteTache({ corps, ctx, marqueur, cle }) {
  const titre = texte(corps.titre, 200);
  if (!titre) return refus('Titre requis', 'Dis ce qu\'il y a à faire, en quelques mots.');

  const priorite = corps.priorite === undefined ? 'normale' : texte(corps.priorite, 20);
  if (!PRIORITES_TACHE.includes(priorite)) {
    return refus('Priorité inconnue', `Valeurs acceptées : ${PRIORITES_TACHE.join(', ')}.`);
  }
  const categorie = corps.categorie === undefined ? 'Autre' : texte(corps.categorie, 40);
  if (!CATEGORIES_TACHE.includes(categorie)) {
    return refus('Catégorie inconnue', `Valeurs acceptées : ${CATEGORIES_TACHE.join(', ')}.`);
  }
  let echeance = '';
  if (corps.echeance !== undefined && corps.echeance !== null && corps.echeance !== '') {
    if (!estDateMetier(corps.echeance)) {
      return refus('Échéance invalide', 'Format attendu : AAAA-MM-JJ, et le jour doit exister.');
    }
    echeance = corps.echeance;
  }

  const tache = {
    titre,
    description: texte(corps.description, 1000) || '',
    priorite,
    categorie,
    statut: 'en_attente',
    assigne_a: '',
    assigne_nom: texte(corps.assigne_nom, 120) || '',
    date_echeance: echeance,
    progression: 0,
    ...marqueur,
  };

  return {
    ok: true,
    temoin: { collection: 'taches', cle },
    operations: [opCreer('taches', tache)],
    resume: `Tâche « ${titre} » créée (${priorite}, ${categorie})`
      + (echeance ? `, échéance ${echeance}.` : '.'),
    journal: {
      module: 'taches',
      entity_label: titre,
      details: `Tâche « ${titre} » créée — priorité ${priorite}, catégorie ${categorie}`
        + (echeance ? `, échéance ${echeance}` : '')
        + `, le ${ctx.date_locale}`,
      metadata: { geste: 'tache', titre, priorite, categorie, echeance },
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   LES GESTES DES AUTRES MODULES
   ═══════════════════════════════════════════════════════════════════════════

   Ajoutés quand le dirigeant a élargi le périmètre : « ajoute les événements et
   tous les trucs possibles de tous les modules qu'on a sur admin ».

   ⚠️ RÈGLE DE CE BLOC : un geste ne part QUE si la règle de son écran peut être
   reprise fidèlement. Ce qui ne l'est pas n'est pas livré, et le refus dit
   pourquoi — voir `GESTES_NON_LIVRES` en bas de fichier. Un geste approximatif
   qui touche à l'argent coûte plus cher qu'un geste absent.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Un numéro de document, DÉTERMINISTE et dérivé de la clé d'idempotence.
 *
 * ⚠️ Volontairement PAS le compteur des écrans. `devis-factures/page.jsx`
 * fabrique `FAC-${documents.length + 1}` à partir de la liste chargée dans le
 * navigateur : deux appels concurrents lisent le même nombre et écrivent DEUX
 * documents portant LE MÊME NUMÉRO — le commentaire de `verrouDevis` décrit
 * exactement ce scénario. Depuis un serveur qui tourne pendant que le gérant
 * est à l'écran, ce compteur collisionne à coup sûr.
 *
 * On reprend donc la forme collision-free déjà utilisée par la livraison de
 * commande (`OG-<année>-<base36>`), mais dérivée de la clé plutôt que de
 * `Date.now()` : rejouer la même clé rend le MÊME numéro, ce qui est
 * exactement ce qu'on veut d'une écriture idempotente.
 */
function numeroDocument(prefixe, ctx, cle) {
  const graine = `${prefixe}|${cle}`;
  let h = 2166136261;
  for (let i = 0; i < graine.length; i += 1) {
    h ^= graine.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const suffixe = h.toString(36).toUpperCase().padStart(7, '0').slice(-6);
  return `${prefixe}-${ctx.date_locale.slice(0, 4)}-${suffixe}`;
}

/** Un entier ≥ 0 (un stock, un budget prévu, un coût facultatif). `null` si absurde. */
function entierPositifOuZero(valeur) {
  if (valeur === null || valeur === undefined || valeur === '') return 0;
  if (typeof valeur === 'boolean') return null;
  const n = Number(valeur);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return null;
  return n;
}

/** Trouve une ligne par identifiant exact OU par nom, à la casse et aux accents près. */
function trouverParNom(liste, demande, champ = 'nom') {
  const cible = normaliserNom(demande);
  if (!cible) return null;
  return (liste || []).find(
    (x) => x?.id === demande || normaliserNom(x?.[champ]) === cible,
  ) || null;
}

/** La liste des noms existants, pour que le refus dise QUOI écrire. */
function nomsConnus(liste, champ = 'nom', maxi = 12) {
  const noms = (liste || []).map((x) => x?.[champ]).filter(Boolean).slice(0, maxi);
  return noms.length ? noms.join(', ') : 'aucun';
}

/* ── PROJET DE TRAVAUX ───────────────────────────────────────────────────── */

/** Statuts d'un projet — `STATUTS_PROJET` de `src/features/travaux/page.jsx`. */
export const STATUTS_PROJET = Object.freeze(['planifie', 'en_cours', 'termine', 'suspendu']);
/** Priorités d'un projet — `PRIORITES` du même écran. */
export const PRIORITES_PROJET = Object.freeze(['haute', 'moyenne', 'basse']);

function gesteProjetTravaux({ corps, ctx, marqueur, cle }) {
  const nom = texte(corps.nom, 200);
  if (!nom) return refus('Nom de projet requis', 'Dis comment s\'appelle le chantier.');

  const statut = corps.statut === undefined ? 'planifie' : texte(corps.statut, 30);
  if (!STATUTS_PROJET.includes(statut)) {
    return refus('Statut inconnu', `Valeurs acceptées : ${STATUTS_PROJET.join(', ')}.`);
  }
  const priorite = corps.priorite === undefined ? 'moyenne' : texte(corps.priorite, 20);
  if (!PRIORITES_PROJET.includes(priorite)) {
    return refus('Priorité inconnue', `Valeurs acceptées : ${PRIORITES_PROJET.join(', ')}.`);
  }
  const budget = entierPositifOuZero(corps.budget_prevu);
  if (budget === null) return refus('Budget invalide', 'Nombre entier de francs CFA, ou rien.');

  for (const champ of ['date_debut', 'date_fin']) {
    const v = corps[champ];
    if (v !== undefined && v !== null && v !== '' && !estDateMetier(v)) {
      return refus(`Date invalide (${champ})`, 'Format attendu : AAAA-MM-JJ, et le jour doit exister.');
    }
  }

  const projet = {
    nom,
    description: texte(corps.description, 1000) || '',
    statut,
    budget_prevu: budget,
    date_debut: texte(corps.date_debut, 10) || '',
    date_fin: texte(corps.date_fin, 10) || '',
    responsable: texte(corps.responsable, 120) || '',
    priorite,
    ...marqueur,
  };

  return {
    ok: true,
    temoin: { collection: 'projets_travaux', cle },
    operations: [opCreer('projets_travaux', projet)],
    resume: `Projet de travaux « ${nom} » créé (${statut}, priorité ${priorite}`
      + (budget > 0 ? `, budget prévu ${fmt(budget)} F).` : ').'),
    journal: {
      module: 'travaux',
      entity_label: nom,
      details: `Projet de travaux « ${nom} » créé — statut ${statut}, priorité ${priorite}`
        + (budget > 0 ? `, budget prévu ${fmt(budget)} F CFA` : '')
        + `, le ${ctx.date_locale}`,
      metadata: { geste: 'projet-travaux', nom, statut, priorite, budget_prevu: budget },
    },
  };
}

/* ── CATALOGUE ───────────────────────────────────────────────────────────── */

/** Catégories du catalogue — `CATEGORIES` de `src/features/catalogue/page.jsx`. */
export const CATEGORIES_CATALOGUE = Object.freeze([
  'Textile', 'Accessoire', 'Papeterie', 'Impression', 'Marketing', 'Signalétique', 'Autre',
]);
/** Unités du catalogue — `UNITES` du même écran. */
export const UNITES_CATALOGUE = Object.freeze(['pièce', 'lot', 'page', 'mètre', 'unité']);

/** Les deux gestes du catalogue. */
export const GESTES_CATALOGUE = Object.freeze(['creer', 'corriger_prix']);

/**
 * Nettoie et trie les paliers de prix, EXACTEMENT comme `ProductForm.handleSubmit`.
 *
 * ⚠️ Le tri par `qte_min` n'est pas cosmétique : `prixPourQte()` (même écran)
 * parcourt le tableau dans l'ordre et rend le premier palier applicable. Un
 * tableau non trié fait facturer le mauvais prix.
 */
function paliersDePrix(brut) {
  if (!Array.isArray(brut)) return null;
  const propres = [];
  for (const p of brut) {
    if (!p || typeof p !== 'object') return null;
    const qteMin = entierPositifOuZero(p.qte_min ?? 1);
    const prix = entierPositifOuZero(p.prix);
    if (qteMin === null || prix === null) return null;
    const qteMax = p.qte_max === null || p.qte_max === undefined || p.qte_max === ''
      ? null
      : entierPositifOuZero(p.qte_max);
    if (qteMax === null && p.qte_max !== null && p.qte_max !== undefined && p.qte_max !== '') return null;
    propres.push({ qte_min: qteMin || 1, qte_max: qteMax, prix });
  }
  if (!propres.length) return null;
  return propres.sort((a, b) => a.qte_min - b.qte_min);
}

function gesteCatalogue({ corps, ctx, contexte, marqueur, cle }) {
  const { catalogue = [] } = contexte;
  const quoi = texte(corps.geste, 40);
  if (!GESTES_CATALOGUE.includes(quoi)) {
    return refus('Geste catalogue inconnu', `Champ « geste » attendu : ${GESTES_CATALOGUE.join(' ou ')}.`);
  }

  const prix = paliersDePrix(corps.prix);

  if (quoi === 'corriger_prix') {
    const demande = texte(corps.produit, 200);
    if (!demande) {
      return refus('Produit requis', `Donne le nom exact du produit. Catalogue : ${nomsConnus(catalogue)}…`);
    }
    const produit = trouverParNom(catalogue, demande);
    if (!produit) {
      return refus(
        'Produit inconnu',
        `« ${demande} » n'est pas au catalogue. Produits connus : ${nomsConnus(catalogue)}…`,
      );
    }
    if (!prix) {
      return refus(
        'Paliers de prix requis',
        'Fournis `prix` : une liste de { qte_min, qte_max, prix } en francs CFA entiers. '
        + 'Exemple pour un prix unique : [{ "qte_min": 1, "qte_max": null, "prix": 2500 }].',
      );
    }

    /* ⚠️ MODIFICATION PARTIELLE, et c'est délibéré. L'écran renvoie le payload
       COMPLET à chaque enregistrement — donc il réécrit les images en base64
       (jusqu'à 3,2 Mo sur une seule ligne) pour corriger un prix. Ici on ne
       touche QUE `prix` : `update` fusionne, `images` et `image_principale`
       restent intactes, et rien ne transite pour rien sur la connexion de
       Moanda. */
    const champs = {
      prix,
      ...marqueur,
      [CHAMP_AVANT]: { prix: produit.prix || null },
    };

    return {
      ok: true,
      temoin: { collection: 'produits_catalogue', cle },
      operations: [opModifier('produits_catalogue', produit.id, champs)],
      resume: `Prix de « ${produit.nom} » corrigé : `
        + `${prix.map((p) => `${fmt(p.prix)} F dès ${p.qte_min}`).join(', ')}.`,
      journal: {
        module: 'catalogue',
        entity_label: produit.nom,
        details: `Prix du produit « ${produit.nom} » corrigé — `
          + `${prix.map((p) => `${p.qte_min}+ : ${fmt(p.prix)} F`).join(' · ')}`,
        metadata: {
          geste: 'catalogue', sous_geste: 'corriger_prix',
          produit: produit.nom, produit_id: produit.id,
          prix_avant: produit.prix || null, prix_apres: prix,
        },
      },
    };
  }

  const nom = texte(corps.nom, 200);
  if (!nom) return refus('Nom du produit requis', 'Dis comment s\'appelle le produit.');
  const categorie = texte(corps.categorie, 40);
  if (!CATEGORIES_CATALOGUE.includes(categorie)) {
    return refus('Catégorie inconnue', `Valeurs acceptées : ${CATEGORIES_CATALOGUE.join(', ')}.`);
  }
  if (!prix) {
    return refus(
      'Paliers de prix requis',
      'Fournis `prix` : une liste de { qte_min, qte_max, prix } en francs CFA entiers.',
    );
  }
  const unite = corps.unite === undefined ? 'pièce' : texte(corps.unite, 20);
  if (!UNITES_CATALOGUE.includes(unite)) {
    return refus('Unité inconnue', `Valeurs acceptées : ${UNITES_CATALOGUE.join(', ')}.`);
  }
  const delai = entierPositifOuZero(corps.delai_jours);
  if (delai === null) return refus('Délai invalide', 'Nombre entier de jours, ou rien.');

  const deja = trouverParNom(catalogue, nom);
  if (deja) {
    return refus(
      'Produit déjà au catalogue',
      `« ${deja.nom} » existe déjà. Pour changer son prix, utilise le geste « corriger_prix ».`,
      409,
    );
  }

  /* ⚠️ `images: []` et `image_principale: 0`, jamais autre chose. Les photos du
     catalogue entrent par `compressSource()` (canvas du navigateur) : il n'y a
     aucun équivalent côté serveur, et une image à moitié préparée pèserait sans
     s'afficher. Le gérant ajoute la photo à l'écran, après coup. */
  const produit = {
    nom,
    sku: texte(corps.sku, 60) || null,
    categorie,
    description: texte(corps.description, 2000) || '',
    details_techniques: texte(corps.details_techniques, 2000) || '',
    options_personnalisables: [],
    images: [],
    image_principale: 0,
    prix,
    unite,
    delai_jours: delai,
    tags: Array.isArray(corps.tags) ? corps.tags.map((t) => texte(t, 40)).filter(Boolean).slice(0, 20) : [],
    actif: corps.actif !== false,
    vedette: corps.vedette === true,
    stock_lie: null,
    ...marqueur,
  };

  return {
    ok: true,
    temoin: { collection: 'produits_catalogue', cle },
    operations: [opCreer('produits_catalogue', produit)],
    resume: `Produit « ${nom} » ajouté au catalogue (${categorie}, ${unite}), `
      + `${prix.map((p) => `${fmt(p.prix)} F dès ${p.qte_min}`).join(', ')}. `
      + 'Aucune photo : elle s\'ajoute à l\'écran Catalogue.',
    journal: {
      module: 'catalogue',
      entity_label: nom,
      details: `Produit « ${nom} » ajouté au catalogue — catégorie ${categorie}, unité ${unite}, `
        + `${prix.length} palier(s) de prix, le ${ctx.date_locale}`,
      metadata: { geste: 'catalogue', sous_geste: 'creer', nom, categorie, unite, prix },
    },
  };
}

/* ── STOCK ───────────────────────────────────────────────────────────────── */

/** Les trois gestes du stock. */
export const GESTES_STOCK = Object.freeze(['entree', 'sortie', 'seuil']);

function gesteStock({ corps, ctx, contexte, marqueur, cle }) {
  const { articles = [] } = contexte;
  const quoi = texte(corps.geste, 20);
  if (!GESTES_STOCK.includes(quoi)) {
    return refus('Geste de stock inconnu', `Champ « geste » attendu : ${GESTES_STOCK.join(', ')}.`);
  }
  const demande = texte(corps.article, 200);
  if (!demande) {
    return refus('Article requis', `Donne le nom exact de l'article. Stock : ${nomsConnus(articles)}…`);
  }
  const article = trouverParNom(articles, demande);
  if (!article) {
    return refus(
      'Article inconnu',
      `« ${demande} » n'est pas au stock. Articles connus : ${nomsConnus(articles)}…`,
    );
  }

  if (quoi === 'seuil') {
    /* ⛔ On écrit `quantite_minimum`, JAMAIS `stock_min`.
       `stocks-seuils.js` le dit : `stock_min` est le champ hérité, lu en repli
       seulement. Et un seuil absent vaut 0, jamais 10 — l'ancien écran
       remontait tous les consommables à 10, et alertait « 9/10 » sur un article
       que le gérant avait réglé à 3. */
    const seuil = entierPositifOuZero(corps.seuil);
    if (seuil === null) return refus('Seuil invalide', 'Nombre entier ≥ 0 de l\'unité de l\'article.');
    return {
      ok: true,
      temoin: { collection: 'produits', cle },
      operations: [opModifier('produits', article.id, {
        quantite_minimum: seuil,
        ...marqueur,
        [CHAMP_AVANT]: { quantite_minimum: article.quantite_minimum ?? null },
      })],
      resume: `Seuil d'alerte de « ${article.nom} » réglé à ${fmt(seuil)}`
        + (seuil === 0 ? ' — donc plus aucune alerte sur cet article.' : '.'),
      journal: {
        module: 'stocks',
        entity_label: article.nom,
        details: `Seuil d'alerte de « ${article.nom} » : ${article.quantite_minimum ?? '(aucun)'} → ${seuil}`,
        metadata: {
          geste: 'stock-mouvement', sous_geste: 'seuil', article: article.nom, article_id: article.id,
          seuil_avant: article.quantite_minimum ?? null, seuil_apres: seuil,
        },
      },
    };
  }

  const quantite = montantValide(corps.quantite);
  if (quantite === null) {
    return refus('Quantité invalide', 'Nombre entier strictement supérieur à zéro.');
  }
  const avant = quantiteArticle(article);
  const apres = quoi === 'entree' ? avant + quantite : avant - quantite;
  if (apres < 0) {
    /* L'écran refuse (« Stock insuffisant ») ; la voie automatique, elle,
       ramène à zéro. On suit L'ÉCRAN : un stock physique qu'on ne peut pas
       sortir ne se sort pas, et un clamp silencieux ferait diverger
       l'inventaire du réel sans que rien ne le dise. */
    return refus(
      'Stock insuffisant',
      `« ${article.nom} » n'a que ${fmt(avant)} en stock : impossible d'en sortir ${fmt(quantite)}.`,
      409,
    );
  }
  const d = dateDuGeste(corps.date, ctx);
  if (d.erreur) return refus('Date invalide', 'Format attendu : AAAA-MM-JJ, et le jour doit exister.');

  const motif = texte(corps.motif, 300)
    || (quoi === 'entree' ? 'Réapprovisionnement' : 'Utilisation');

  const mouvement = {
    produit_id: article.id,
    produit_nom: article.nom,
    type: quoi,
    quantite,
    stock_avant: avant,
    stock_apres: apres,
    motif,
    operateur: 'ChatGPT (pont)',
    reference: identifiantDe(cle),
    date: ctx.instant_utc,
    date_metier: d.date,
    ...marqueur,
  };

  /* ⚠️ L'ORDRE : le mouvement D'ABORD, le décrément ENSUITE et seulement s'il a
     été écrit. C'est la règle de `sync-stock-commande.js`, et pas celle de
     l'écran (qui décrémente avant) : « On prefere un mouvement sans decrement
     (visible, corrigeable) a un decrement sans mouvement (invisible,
     indetectable). »

     Et on écrit `quantite` ET `stock` : la moitié du code lit `p.quantite ?? p.stock`. */
  return {
    ok: true,
    temoin: { collection: 'mouvements_stock', cle },
    operations: [
      opCreer('mouvements_stock', mouvement, 'mvt'),
      opModifier('produits', article.id, { quantite: apres, stock: apres }, 'mvt'),
    ],
    resume: `${quoi === 'entree' ? 'Entrée' : 'Sortie'} de ${fmt(quantite)} « ${article.nom} » `
      + `— stock : ${fmt(avant)} → ${fmt(apres)}.`,
    journal: {
      module: 'stocks',
      entity_label: `${article.nom} (${quoi === 'entree' ? '+' : '-'}${quantite})`,
      details: `${quoi === 'entree' ? 'Entrée' : 'Sortie'} de ${fmt(quantite)} sur « ${article.nom} » `
        + `— ${fmt(avant)} → ${fmt(apres)}, motif « ${motif} », le ${d.date}`,
      metadata: {
        geste: 'stock-mouvement', sous_geste: quoi, article: article.nom, article_id: article.id,
        quantite, stock_avant: avant, stock_apres: apres, motif, date: d.date,
      },
    },
  };
}

/* ── RAPPORT JOURNALIER ──────────────────────────────────────────────────── */

/** Les deux gestes du rapport journalier. */
export const GESTES_RAPPORT = Object.freeze(['creer', 'ajouter_ligne']);

/** Statuts qui VERROUILLENT un rapport — `STATUTS_VERROUILLES` de l'import Excel. */
export const STATUTS_RAPPORT_VERROUILLES = Object.freeze(['valide', 'cloture']);

/**
 * Une date métier décalée de `jours`, sans jamais passer par l'horloge locale.
 * `Date.UTC` n'a aucun fuseau : c'est de l'arithmétique sur des nombres, donc
 * le résultat est le même à Libreville, en UTC et à Los Angeles.
 */
function dateDecalee(dateMetier, jours) {
  const [a, m, j] = dateMetier.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1, j + jours));
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/**
 * Construit UNE ligne de rapport à la forme exacte du tableur de saisie.
 * Les dix colonnes de `COLUMNS` (rapport-form.jsx), jamais neuf ni onze.
 */
function ligneDeRapport(brut) {
  const ligne = { description: texte(brut?.description, 300) || '' };
  for (const c of CATEGORIES_RAPPORT) {
    const n = entierPositifOuZero(brut?.[c]);
    if (n === null) return { erreur: `« ${c} » doit être un nombre entier ≥ 0.` };
    ligne[c] = n;
  }
  const sorties = entierPositifOuZero(brut?.sorties);
  if (sorties === null) return { erreur: '« sorties » doit être un nombre entier ≥ 0.' };
  ligne.sorties = sorties;

  // Règle de `validate()` : une sortie sans description est refusée. Sans elle,
  // une dépense atterrit au journal sans qu'on sache à quoi elle a servi.
  if (sorties > 0 && !ligne.description) {
    return { erreur: 'Une sortie exige une description : dis à quoi l\'argent a servi.' };
  }
  const total = CATEGORIES_RAPPORT.reduce((s, c) => s + ligne[c], 0);
  if (total === 0 && sorties === 0) {
    return { erreur: 'Ligne vide : donne au moins une recette ou une sortie.' };
  }
  return { ligne, total, sorties };
}

/** `categories` d'une liste de lignes : la somme colonne par colonne, dérivée du détail. */
function categoriesDepuisLignes(lignes) {
  const cats = {};
  for (const c of CATEGORIES_RAPPORT) {
    cats[c] = (lignes || []).reduce((s, l) => s + (Number(l?.[c]) || 0), 0);
  }
  return cats;
}

/** `depenses` d'une liste de lignes : une entrée par ligne dont `sorties > 0`. */
function depensesDepuisLignes(lignes) {
  return (lignes || [])
    .filter((l) => (Number(l?.sorties) || 0) > 0)
    .map((l) => ({ description: l.description || 'Sortie', montant: Number(l.sorties) || 0 }));
}

function gesteRapport({ corps, ctx, contexte, marqueur, cle }) {
  const { rapports = [] } = contexte;
  const quoi = texte(corps.geste, 30);
  if (!GESTES_RAPPORT.includes(quoi)) {
    return refus('Geste de rapport inconnu', `Champ « geste » attendu : ${GESTES_RAPPORT.join(' ou ')}.`);
  }
  const d = dateDuGeste(corps.date, ctx);
  if (d.erreur) return refus('Date invalide', 'Format attendu : AAAA-MM-JJ, et le jour doit exister.');
  const activite = normaliserActivite(corps.activite);
  if (corps.activite !== undefined && !ACTIVITES.includes(String(corps.activite).trim().toLowerCase())) {
    return refus('Activité inconnue', `Valeurs acceptées : ${ACTIVITES.join(', ')}.`);
  }

  const r = ligneDeRapport(corps.ligne || corps);
  if (r.erreur) return refus('Ligne de rapport invalide', r.erreur);

  /* ⛔ LE GARDE-FOU DE MARS. `payloadSansTotauxFiges` refuse tout payload qui
     FIGE un total. L'import de mars recopiait `total_recettes`,
     `total_depenses` et `caisse_journee` à côté de `categories`, sans que les
     deux se contrôlent : 16 rapports sur 50 portent encore
     `total_recettes = 3 × caisse_journee`, adossé à rien. La règle du dépôt :
     un rapport porte son DÉTAIL (`lignes`), et ses agrégats en sont DÉRIVÉS.
     On appelle la fonction ici, même si rien dans ce module n'écrit de total :
     c'est le genre de champ qu'on rajoute six mois plus tard sans y penser. */
  const verifierTotaux = (payload) => {
    const interdits = payloadSansTotauxFiges(payload);
    return interdits.length
      ? refus('Total figé interdit', `Champ(s) interdit(s) : ${interdits.join(', ')}. `
        + 'Un rapport porte son détail ; ses totaux sont recalculés à la lecture.')
      : null;
  };

  if (quoi === 'ajouter_ligne') {
    const existant = (rapports || []).find(
      (x) => x?.date === d.date && normaliserActivite(x?.activite) === activite,
    );
    if (!existant) {
      return refus(
        'Aucun rapport ce jour-là',
        `Il n'y a pas de rapport du ${d.date} pour ${activite}. Crée-le d'abord avec le geste « creer ».`,
        404,
      );
    }
    if (STATUTS_RAPPORT_VERROUILLES.includes(existant.statut)) {
      return refus(
        'Rapport verrouillé',
        `Le rapport du ${d.date} est « ${existant.statut} » : il ne se modifie plus. `
        + 'Demande un déverrouillage à l\'écran Rapports.',
        409,
      );
    }
    // Modèle de `fusionnerContenu()` (import Excel) : on ADDITIONNE le détail,
    // puis on redérive les agrégats. Jamais l'inverse.
    const lignes = [...(existant.lignes || []), r.ligne];
    const champs = {
      lignes,
      categories: categoriesDepuisLignes(lignes),
      depenses: depensesDepuisLignes(lignes),
      ...marqueur,
    };
    const mauvais = verifierTotaux(champs);
    if (mauvais) return mauvais;

    return {
      ok: true,
      temoin: { collection: 'rapports', cle },
      operations: [opModifier('rapports', existant.id, champs)],
      resume: `Ligne ajoutée au rapport du ${d.date} (${activite}) : `
        + `${fmt(r.total)} F de recettes` + (r.sorties ? `, ${fmt(r.sorties)} F de sortie.` : '.'),
      journal: {
        module: 'rapports',
        entity_label: `Rapport du ${d.date}`,
        details: `Ligne ajoutée au rapport du ${d.date} (${activite}) — ${fmt(r.total)} F de recettes`
          + (r.sorties ? `, ${fmt(r.sorties)} F de sortie` : ''),
        metadata: { geste: 'rapport', sous_geste: 'ajouter_ligne', date: d.date, activite, ligne: r.ligne },
      },
    };
  }

  const deja = (rapports || []).find(
    (x) => x?.date === d.date && normaliserActivite(x?.activite) === activite,
  );
  if (deja) {
    return refus(
      'Rapport déjà ouvert',
      `Un rapport du ${d.date} existe déjà pour ${activite}. Utilise le geste « ajouter_ligne » `
      + 'plutôt que d\'en ouvrir un second : deux rapports le même jour se comptent deux fois.',
      409,
    );
  }
  const operateur = texte(corps.operateur_nom, 120);
  if (!operateur) {
    return refus('Opérateur requis', 'Dis qui a tenu la caisse : l\'écran l\'exige aussi.');
  }

  const lignes = [r.ligne];
  /* `statut: 'brouillon'`, TOUJOURS. `soumis` déclenche la validation complète
     de l'écran (au moins une ligne de données, description sur chaque sortie)
     et met le rapport sur le chemin de la clôture. Un rapport dicté doit être
     relu par un humain avant d'y entrer. */
  const rapport = avecActivite({
    date: d.date,
    operateur_id: '',
    operateur_nom: operateur,
    statut: 'brouillon',
    categories: categoriesDepuisLignes(lignes),
    depenses: depensesDepuisLignes(lignes),
    lignes,
    historique: [{
      timestamp: ctx.instant_utc,
      utilisateur: 'ChatGPT (pont)',
      nb_modifications: 1,
      details: [{ ligne: 1, colonne: 'création', ancien: '', nouveau: 'dictée' }],
    }],
    ...marqueur,
  }, activite);

  const mauvais = verifierTotaux(rapport);
  if (mauvais) return mauvais;

  return {
    ok: true,
    temoin: { collection: 'rapports', cle },
    operations: [opCreer('rapports', rapport)],
    resume: `Rapport du ${d.date} (${activite}) ouvert en BROUILLON par ${operateur} : `
      + `${fmt(r.total)} F de recettes` + (r.sorties ? `, ${fmt(r.sorties)} F de sortie. ` : '. ')
      + 'À relire et à soumettre à l\'écran Rapports.',
    journal: {
      module: 'rapports',
      entity_label: `Rapport du ${d.date}`,
      details: `Rapport journalier du ${d.date} (${activite}) créé en brouillon par ${operateur} — `
        + `${fmt(r.total)} F de recettes` + (r.sorties ? `, ${fmt(r.sorties)} F de sortie` : ''),
      metadata: { geste: 'rapport', sous_geste: 'creer', date: d.date, activite, operateur },
    },
  };
}

/* ── COMMANDE ────────────────────────────────────────────────────────────── */

/** Les deux gestes de commande servis par le pont. */
export const GESTES_COMMANDE = Object.freeze(['creer', 'changer_statut']);

/**
 * Les statuts que le pont accepte d'écrire.
 *
 * ⛔ `livree` et `annulee` en sont ABSENTS, et c'est délibéré : ces deux
 * transitions déclenchent des effets d'argent (facture, encaissement, stock,
 * fidélité, contre-passation) qui vivent dans l'écran, pas dans un module
 * partagé. Voir `GESTES_NON_LIVRES`.
 */
export const STATUTS_COMMANDE_ECRIVABLES = Object.freeze([
  'en_attente_validation',
  'validee_attente_paiement',
  'en_production',
  'prete',
]);

/** Les deux transitions refusées, avec la raison exacte servie à ChatGPT. */
export const STATUTS_COMMANDE_REFUSES = Object.freeze({
  livree: "Passer une commande à « livrée » déclenche la facture, l'encaissement, la sortie de "
    + 'stock et les points de fidélité. Ces effets ne sont pas reproductibles ici sans les '
    + 'dupliquer. Fais-le à l\'écran Commandes, qui les exécute et sait les rattraper.',
  annulee: "Annuler une commande contre-passe l'encaissement, le stock, les points et la "
    + 'facture. Fais-le à l\'écran Commandes : lui seul sait ce qui a déjà eu lieu.',
});

function gesteCommande({ corps, ctx, contexte, marqueur, cle }) {
  const { commandes = [] } = contexte;
  const quoi = texte(corps.geste, 30);
  if (!GESTES_COMMANDE.includes(quoi)) {
    return refus('Geste de commande inconnu', `Champ « geste » attendu : ${GESTES_COMMANDE.join(' ou ')}.`);
  }

  if (quoi === 'changer_statut') {
    const demande = texte(corps.commande, 120);
    if (!demande) return refus('Commande requise', 'Donne le numéro exact de la commande.');
    const commande = (commandes || []).find(
      (c) => c?.id === demande || String(c?.numero || '').toUpperCase() === demande.toUpperCase(),
    );
    if (!commande) {
      return refus('Commande inconnue', `Aucune commande « ${demande} ».`, 404);
    }
    const vise = texte(corps.statut, 40);
    if (STATUTS_COMMANDE_REFUSES[vise]) {
      return refus('Transition non servie par le pont', STATUTS_COMMANDE_REFUSES[vise], 409);
    }
    if (!STATUTS_COMMANDE_ECRIVABLES.includes(vise)) {
      return refus('Statut inconnu', `Valeurs acceptées : ${STATUTS_COMMANDE_ECRIVABLES.join(', ')}.`);
    }
    if (commande.statut === 'livree' || commande.statut === 'annulee') {
      return refus(
        'Commande close',
        `La commande ${commande.numero || demande} est « ${commande.statut} » : la rouvrir se fait `
        + 'à l\'écran, qui sait ce qu\'il faut contre-passer.',
        409,
      );
    }

    const historique = [...(commande.historique_statuts || []), {
      statut: vise,
      date: ctx.instant_utc,
      auteur: 'ChatGPT (pont)',
    }];
    return {
      ok: true,
      temoin: { collection: 'commandes', cle },
      operations: [opModifier('commandes', commande.id, {
        statut: vise,
        historique_statuts: historique,
        ...marqueur,
        [CHAMP_AVANT]: { statut: commande.statut || '' },
      })],
      resume: `Commande ${commande.numero || demande} : « ${commande.statut || '?'} » → « ${vise} ».`,
      journal: {
        module: 'commandes',
        entity_label: commande.numero || demande,
        details: `Statut de la commande ${commande.numero || demande} : `
          + `${commande.statut || '?'} → ${vise}`,
        metadata: {
          geste: 'commande', sous_geste: 'changer_statut',
          commande: commande.numero || demande, commande_id: commande.id,
          statut_avant: commande.statut || '', statut_apres: vise,
        },
      },
    };
  }

  const clientNom = nettoyerNom(texte(corps.client_nom, 200) || '');
  if (!clientNom) return refus('Client requis', 'Dis pour qui est la commande.');
  const brutes = Array.isArray(corps.lignes) ? corps.lignes : [];
  const lignes = [];
  for (const l of brutes) {
    const description = texte(l?.description, 300);
    if (!description) continue;
    const quantite = montantValide(l?.quantite ?? 1);
    const prix = entierPositifOuZero(l?.prix_unitaire);
    if (quantite === null) return refus('Quantité invalide', 'Nombre entier strictement positif par ligne.');
    if (prix === null) return refus('Prix invalide', 'Nombre entier de francs CFA ≥ 0 par ligne.');
    lignes.push({ description, quantite, prix_unitaire: prix });
  }
  if (!lignes.length) {
    return refus('Au moins une ligne requise', 'Chaque ligne porte une description, une quantité et un prix.');
  }
  const echeance = corps.echeance === undefined || corps.echeance === null || corps.echeance === ''
    ? dateDecalee(ctx.date_locale, 3)
    : corps.echeance;
  if (!estDateMetier(echeance)) {
    return refus('Échéance invalide', 'Format attendu : AAAA-MM-JJ, et le jour doit exister.');
  }
  const total = lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire, 0);
  const numero = numeroDocument('CMD', ctx, cle);
  const statut = 'en_attente_validation';

  /* `total` ET `montant_total` : les deux sont lus par des écrans différents
     (constat E6 — l'écran Clients affichait 0 F faute du premier). */
  const commande = avecActivite({
    numero,
    client_id: '',
    client_nom: clientNom,
    client_tel: texte(corps.client_tel, 40) || '',
    description: texte(corps.description, 1000) || '',
    date_echeance: echeance,
    lignes,
    total,
    montant_total: total,
    statut,
    source: 'chatgpt',
    historique_statuts: [{ statut, date: ctx.instant_utc, auteur: 'ChatGPT (pont)' }],
    ...marqueur,
  }, corps.activite);

  return {
    ok: true,
    temoin: { collection: 'commandes', cle },
    operations: [opCreer('commandes', commande)],
    resume: `Commande ${numero} créée pour ${clientNom} — ${fmt(total)} F, échéance ${echeance}, `
      + 'en attente de validation.',
    journal: {
      module: 'commandes',
      entity_label: numero,
      details: `Commande ${numero} créée pour « ${clientNom} » — ${lignes.length} ligne(s), `
        + `${fmt(total)} F CFA, échéance ${echeance}`,
      metadata: {
        geste: 'commande', sous_geste: 'creer', numero, client_nom: clientNom,
        total, echeance, lignes,
      },
    },
  };
}

/* ── CLIENT ──────────────────────────────────────────────────────────────── */

/** Types de fiche client — `clients/page.jsx`. */
export const TYPES_CLIENT = Object.freeze(['particulier', 'entreprise']);

/**
 * Crée une fiche d'annuaire — et RIEN d'autre.
 *
 * ⛔ `user_id` n'est jamais posé. Une fiche portant `user_id` est rattachée à un
 * COMPTE du portail, et créer un compte, c'est créer un utilisateur : ça passe
 * exclusivement par `api/auth-creer-utilisateur.js`, qui hache le mot de passe
 * et force le rôle. Le pont n'y touche pas.
 *
 * L'anti-doublon reprend `client-resolution.js` : égalité sur le nom NORMALISÉ
 * (accents retirés, espaces écrasés, minuscules), jamais sur un préfixe —
 * « Moanda » ne doit pas être rattaché à « Moanda Services ». Il n'existe
 * aucune contrainte d'unicité en base : si on ne le fait pas ici, rien ne le
 * rattrape ensuite.
 */
function gesteClient({ corps, ctx, contexte, marqueur, cle }) {
  const { clients = [] } = contexte;
  const nom = nettoyerNom(texte(corps.nom, 200) || '');
  if (!nom) return refus('Nom requis', 'Dis comment s\'appelle le client.');

  const homonymes = (clients || []).filter((c) => normaliserNom(c?.nom) === normaliserNom(nom));
  if (homonymes.length) {
    return refus(
      'Client déjà dans l\'annuaire',
      `« ${homonymes[0].nom} » existe déjà`
      + (homonymes.length > 1 ? ` (et ${homonymes.length} fiches portent ce nom)` : '')
      + '. Une seconde fiche ferait un doublon que rien ne rattraperait.',
      409,
    );
  }

  const type = corps.type === undefined ? 'particulier' : texte(corps.type, 20);
  if (!TYPES_CLIENT.includes(type)) {
    return refus('Type inconnu', `Valeurs acceptées : ${TYPES_CLIENT.join(', ')}.`);
  }

  const client = {
    nom,
    email: texte(corps.email, 200) || '',
    telephone: texte(corps.telephone, 40) || '',
    type,
    adresse: nettoyerNom(texte(corps.adresse, 300) || ''),
    notes: texte(corps.notes, 1000) || '',
    source: 'chatgpt',
    date_creation: ctx.date_locale,
    ...marqueur,
  };

  return {
    ok: true,
    temoin: { collection: 'clients', cle },
    operations: [opCreer('clients', client)],
    resume: `Fiche client « ${nom} » créée (${type})`
      + (client.telephone ? `, tél. ${client.telephone}.` : '.')
      + ' Aucun compte portail n\'a été créé : ça se fait à la main.',
    journal: {
      module: 'clients',
      entity_label: nom,
      details: `Fiche client « ${nom} » créée — type ${type}`
        + (client.telephone ? `, téléphone ${client.telephone}` : '')
        + `, le ${ctx.date_locale}`,
      metadata: { geste: 'client', nom, type, telephone: client.telephone, email: client.email },
    },
  };
}

/* ── ÉVÉNEMENT ───────────────────────────────────────────────────────────── */

/** Types d'événement — `TYPES_EVT` de `src/features/evenements/page.jsx`. */
export const TYPES_EVENEMENT = Object.freeze([
  'fete_nationale', 'fete_religieuse', 'rentree_scolaire', 'commercial', 'culturel', 'autre',
]);

function gesteEvenement({ corps, ctx, marqueur, cle }) {
  const nom = texte(corps.nom, 200);
  if (!nom) return refus('Nom requis', 'Dis comment s\'appelle l\'événement.');

  /* ⛔ PAS D'ÉVÉNEMENT SANS DATE — décision du dirigeant du 18/09/2026.
     Avant, la ligne partait avec `date: ''`, le toast annonçait « Événement
     ajouté », et la carte affichait « Invalid Date ». `estDateMetier` refuse
     aussi le 31 février, qui a la bonne forme et n'existe pas. Ne pas
     contourner cette règle : elle vient d'être posée. */
  if (!estDateMetier(corps.date)) {
    return refus(
      'Date requise',
      'Un événement sans date n\'a aucun usage : il ne peut ni être classé, ni remonter dans '
      + '« Prochains événements ». Format attendu : AAAA-MM-JJ, et le jour doit exister.',
    );
  }

  const type = corps.type === undefined ? 'autre' : texte(corps.type, 40);
  if (!TYPES_EVENEMENT.includes(type)) {
    return refus('Type inconnu', `Valeurs acceptées : ${TYPES_EVENEMENT.join(', ')}.`);
  }

  const evenement = {
    nom,
    date: corps.date,
    type,
    opportunites: texte(corps.opportunites, 1000) || '',
    description: texte(corps.description, 1000) || '',
    recurrent: corps.recurrent !== false,
    ...marqueur,
  };

  return {
    ok: true,
    temoin: { collection: 'evenements', cle },
    operations: [opCreer('evenements', evenement)],
    resume: `Événement « ${nom} » ajouté le ${corps.date} (${type})`
      + (evenement.recurrent ? ', récurrent.' : '.'),
    journal: {
      module: 'evenements',
      entity_label: nom,
      details: `Événement « ${nom} » créé — ${corps.date}, type ${type}`
        + (evenement.recurrent ? ', récurrent' : ''),
      metadata: { geste: 'evenement', nom, date: corps.date, type, recurrent: evenement.recurrent },
    },
  };
}

/* ── PROSPECT ────────────────────────────────────────────────────────────── */

export const GESTES_PROSPECT = Object.freeze(['creer', 'ajouter_interaction']);
export const TYPES_PROSPECT = Object.freeze([
  'entreprise', 'particulier', 'administration', 'ecole', 'ong', 'commerce',
]);
export const STATUTS_PROSPECT = Object.freeze([
  'nouveau', 'contacte', 'interesse', 'devis_envoye', 'negoce', 'converti', 'perdu',
]);
export const SOURCES_PROSPECT = Object.freeze([
  'recommandation', 'passage', 'reseaux_sociaux', 'prospection_active', 'evenement', 'autre',
]);
export const TYPES_INTERACTION = Object.freeze(['appel', 'visite', 'whatsapp', 'email', 'autre']);

function gesteProspect({ corps, ctx, contexte, marqueur, cle }) {
  const { prospects = [] } = contexte;
  const quoi = texte(corps.geste, 30) || 'creer';
  if (!GESTES_PROSPECT.includes(quoi)) {
    return refus('Geste de prospection inconnu', `Champ « geste » attendu : ${GESTES_PROSPECT.join(' ou ')}.`);
  }

  if (quoi === 'ajouter_interaction') {
    const demande = texte(corps.prospect, 200);
    if (!demande) {
      return refus('Prospect requis', `Donne son nom. Prospects : ${nomsConnus(prospects, 'nomOuEntreprise')}…`);
    }
    const prospect = trouverParNom(prospects, demande, 'nomOuEntreprise');
    if (!prospect) {
      return refus('Prospect inconnu', `Aucun prospect « ${demande} ».`, 404);
    }
    const resume = texte(corps.resume, 1000);
    if (!resume) return refus('Résumé requis', 'Dis ce qui s\'est passé pendant cet échange.');
    const typeInteraction = corps.type === undefined ? 'appel' : texte(corps.type, 20);
    if (!TYPES_INTERACTION.includes(typeInteraction)) {
      return refus('Type d\'interaction inconnu', `Valeurs acceptées : ${TYPES_INTERACTION.join(', ')}.`);
    }
    const historique = [...(prospect.historiqueInteractions || []), {
      id: `chatgpt-${cle}`,
      date: ctx.instant_utc,
      type: typeInteraction,
      resume,
      auteur: 'ChatGPT (pont)',
    }];
    return {
      ok: true,
      temoin: { collection: 'prospects', cle },
      operations: [opModifier('prospects', prospect.id, { historiqueInteractions: historique, ...marqueur })],
      resume: `Interaction (${typeInteraction}) ajoutée au prospect « ${prospect.nomOuEntreprise} ».`,
      journal: {
        module: 'prospects',
        entity_label: prospect.nomOuEntreprise || demande,
        details: `Interaction ${typeInteraction} sur « ${prospect.nomOuEntreprise || demande} » — ${resume}`,
        metadata: {
          geste: 'prospect', sous_geste: 'ajouter_interaction',
          prospect: prospect.nomOuEntreprise, prospect_id: prospect.id,
          type: typeInteraction, resume,
        },
      },
    };
  }

  const nom = texte(corps.nom, 200);
  if (!nom) return refus('Nom ou entreprise requis', 'Dis qui est ce prospect.');
  const telephone = texte(corps.telephone, 40);
  if (!telephone) {
    return refus('Téléphone requis', 'L\'écran Prospection l\'exige : sans numéro, un prospect ne se rappelle pas.');
  }
  const type = corps.type === undefined ? 'entreprise' : texte(corps.type, 30);
  if (!TYPES_PROSPECT.includes(type)) {
    return refus('Type inconnu', `Valeurs acceptées : ${TYPES_PROSPECT.join(', ')}.`);
  }
  const statut = corps.statut === undefined ? 'nouveau' : texte(corps.statut, 30);
  if (!STATUTS_PROSPECT.includes(statut)) {
    return refus('Statut inconnu', `Valeurs acceptées : ${STATUTS_PROSPECT.join(', ')}.`);
  }
  const source = corps.source === undefined ? 'passage' : texte(corps.source, 30);
  if (!SOURCES_PROSPECT.includes(source)) {
    return refus('Source inconnue', `Valeurs acceptées : ${SOURCES_PROSPECT.join(', ')}.`);
  }
  const budget = corps.budget_estime === undefined || corps.budget_estime === null || corps.budget_estime === ''
    ? null
    : entierPositifOuZero(corps.budget_estime);
  if (budget === null && corps.budget_estime !== undefined && corps.budget_estime !== null && corps.budget_estime !== '') {
    return refus('Budget invalide', 'Nombre entier de francs CFA ≥ 0, ou rien.');
  }
  if (corps.date_prochain_contact !== undefined && corps.date_prochain_contact !== null
    && corps.date_prochain_contact !== '' && !estDateMetier(corps.date_prochain_contact)) {
    return refus('Date de relance invalide', 'Format attendu : AAAA-MM-JJ, et le jour doit exister.');
  }

  const prospect = {
    type,
    nomOuEntreprise: nom,
    secteurActivite: texte(corps.secteur, 60) || 'Commerce',
    contactNom: texte(corps.contact_nom, 120) || '',
    telephone,
    email: texte(corps.email, 200) || '',
    adresse: texte(corps.adresse, 300) || '',
    localisation: texte(corps.localisation, 200) || '',
    statut,
    source,
    responsableInterne: '',
    besoinsIdentifies: Array.isArray(corps.besoins)
      ? corps.besoins.map((b) => texte(b, 60)).filter(Boolean).slice(0, 20) : [],
    budgetEstime: budget,
    dateProchainContact: texte(corps.date_prochain_contact, 10) || '',
    notes: texte(corps.notes, 1000) || '',
    historiqueInteractions: [],
    ...marqueur,
  };

  return {
    ok: true,
    temoin: { collection: 'prospects', cle },
    operations: [opCreer('prospects', prospect)],
    resume: `Prospect « ${nom} » ajouté (${type}, ${statut}), tél. ${telephone}.`,
    journal: {
      module: 'prospects',
      entity_label: nom,
      details: `Prospect « ${nom} » créé — ${type}, statut ${statut}, source ${source}, tél. ${telephone}`,
      metadata: { geste: 'prospect', sous_geste: 'creer', nom, type, statut, source, telephone },
    },
  };
}

/* ── OBJECTIF ────────────────────────────────────────────────────────────── */

export const TYPES_OBJECTIF = Object.freeze(['mensuel', 'annuel']);
export const CATEGORIES_OBJECTIF = Object.freeze(['global', 'equipe', 'individuel']);

const RE_MOIS_METIER = /^\d{4}-(0[1-9]|1[0-2])$/;

function gesteObjectif({ corps, ctx, marqueur, cle }) {
  const titre = texte(corps.titre, 200);
  if (!titre) return refus('Titre requis', 'Dis ce qu\'on vise.');

  const type = corps.type === undefined ? 'mensuel' : texte(corps.type, 20);
  if (!TYPES_OBJECTIF.includes(type)) {
    return refus('Type inconnu', `Valeurs acceptées : ${TYPES_OBJECTIF.join(', ')}.`);
  }
  const categorie = corps.categorie === undefined ? 'global' : texte(corps.categorie, 20);
  if (!CATEGORIES_OBJECTIF.includes(categorie)) {
    return refus('Catégorie inconnue', `Valeurs acceptées : ${CATEGORIES_OBJECTIF.join(', ')}.`);
  }
  const montant = montantValide(corps.montant);
  if (montant === null) {
    /* L'écran accepte 0, et c'est un piège : la progression fait
       `realise / (objectif_montant || 1)`, donc un objectif à 0 F est « atteint »
       au premier franc encaissé. On exige donc un montant réel. */
    return refus(
      'Montant requis',
      'Nombre entier de francs CFA strictement positif. Un objectif à 0 F s\'afficherait '
      + 'comme atteint dès le premier franc.',
    );
  }
  /* ⚠️ `ctx.mois_local`, jamais le mois lu sur l'horloge du processus. L'écran
     Objectifs prend le raccourci interdit par `src/lib/dates.js` : le 1er du
     mois avant 01 h à Libreville, il crée l'objectif sur le MOIS PRÉCÉDENT. */
  const mois = corps.mois === undefined || corps.mois === null || corps.mois === ''
    ? ctx.mois_local
    : texte(corps.mois, 7);
  if (!RE_MOIS_METIER.test(mois || '')) {
    return refus('Mois invalide', 'Format attendu : AAAA-MM, par exemple 2026-09.');
  }

  const objectif = {
    titre, type, categorie, objectif_montant: montant, mois, ...marqueur,
  };

  return {
    ok: true,
    temoin: { collection: 'objectifs', cle },
    operations: [opCreer('objectifs', objectif)],
    resume: `Objectif « ${titre} » posé : ${fmt(montant)} F sur ${mois} (${type}, ${categorie}).`,
    journal: {
      module: 'objectifs',
      entity_label: titre,
      details: `Objectif « ${titre} » créé — ${fmt(montant)} F CFA, ${type}, ${categorie}, période ${mois}`,
      metadata: { geste: 'objectif', titre, type, categorie, montant, mois },
    },
  };
}

/* ── CLÔTURE DE CAISSE ───────────────────────────────────────────────────── */

/** Coupures en circulation — `DENOMINATIONS` de `src/features/cloture-caisse/page.jsx`. */
export const DENOMINATIONS = Object.freeze([10000, 5000, 2000, 1000, 500, 100, 50, 25, 10, 5]);

/** Le statut d'une clôture, aux seuils exacts de l'écran (en valeur absolue). */
export function statutCloture(ecart) {
  const e = Math.abs(Number(ecart) || 0);
  if (e < 1000) return 'ok';
  if (e < 5000) return 'ecart_mineur';
  return 'ecart_majeur';
}

function gesteClotureCaisse({ corps, ctx, contexte, marqueur, cle }) {
  const { rapports = [], clotures = [] } = contexte;
  const d = dateDuGeste(corps.date, ctx);
  if (d.erreur) return refus('Date invalide', 'Format attendu : AAAA-MM-JJ, et le jour doit exister.');
  if (corps.activite !== undefined && !ACTIVITES.includes(String(corps.activite).trim().toLowerCase())) {
    return refus('Activité inconnue', `Valeurs acceptées : ${ACTIVITES.join(', ')}.`);
  }
  const activite = normaliserActivite(corps.activite);

  /* ⚠️ LA CLÉ EST (date, activité), PAS LA DATE SEULE. Les deux commerces ont
     deux tiroirs, donc deux comptages et deux écarts. Compter le tiroir de la
     papeterie pendant que celui de l'imprimerie est déjà clos ne doit pas
     rendre la soirée « déjà faite ». Aucune contrainte n'existe en base : si on
     ne vérifie pas ici, deux clôtures du même soir cohabitent et l'écart est
     compté deux fois dans les statistiques. */
  const deja = (clotures || []).find(
    (c) => c?.date === d.date && normaliserActivite(c?.activite) === activite,
  );
  if (deja) {
    return refus(
      'Caisse déjà clôturée',
      `La caisse ${activite} du ${d.date} est déjà clôturée (écart ${fmt(deja.ecart)} F). `
      + 'Une seconde clôture compterait l\'écart deux fois.',
      409,
    );
  }

  const brut = corps.denominations;
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) {
    return refus(
      'Comptage requis',
      'Fournis `denominations` : le nombre de coupures comptées, par valeur faciale. '
      + `Coupures acceptées : ${DENOMINATIONS.join(', ')}.`,
    );
  }
  const denominations = {};
  let totalPhysique = 0;
  for (const [valeur, nombre] of Object.entries(brut)) {
    const faciale = Number(valeur);
    if (!DENOMINATIONS.includes(faciale)) {
      return refus('Coupure inconnue', `« ${valeur} » n'est pas une coupure en circulation. `
        + `Acceptées : ${DENOMINATIONS.join(', ')}.`);
    }
    const n = entierPositifOuZero(nombre);
    if (n === null) return refus('Comptage invalide', `Le nombre de coupures de ${valeur} doit être un entier ≥ 0.`);
    denominations[String(faciale)] = String(n);
    totalPhysique += faciale * n;
  }
  if (!Object.keys(denominations).length) {
    return refus('Comptage vide', 'Donne au moins une coupure comptée.');
  }

  /* Le montant ATTENDU se recalcule ici, sur les rapports de CE jour et de
     CETTE activité — jamais sur un chiffre dicté. Un attendu dicté ferait un
     écart de zéro à tous les coups, et la clôture ne servirait plus à rien.

     ⚠️ La séparation se fait sur `r.activite`, jamais sur les noms de
     catégories : `categories.imprimerie` est une PRESTATION, pas une caisse. */
  const duJour = (rapports || []).filter(
    (r) => r?.date === d.date && normaliserActivite(r?.activite) === activite,
  );
  const recettes = duJour.reduce((s, r) => s + caRapport(r), 0);
  const depenses = duJour.reduce((s, r) => s + depensesRapport(r), 0);
  const attendu = recettes - depenses;
  const ecart = totalPhysique - attendu;
  const statut = statutCloture(ecart);

  const cloture = avecActivite({
    date: d.date,
    employe_id: '',
    employe_nom: texte(corps.employe_nom, 120) || 'ChatGPT (pont)',
    montant_attendu: attendu,
    montant_reel: totalPhysique,
    ecart,
    commentaire: texte(corps.commentaire, 1000) || '',
    statut,
    denominations,
    valide_par: '',
    ...marqueur,
  }, activite);

  return {
    ok: true,
    temoin: { collection: 'clotures_caisse', cle },
    operations: [opCreer('clotures_caisse', cloture)],
    resume: `Caisse ${activite} du ${d.date} clôturée — attendu ${fmt(attendu)} F `
      + `(${duJour.length} rapport(s)), compté ${fmt(totalPhysique)} F, écart ${fmt(ecart)} F (${statut}).`,
    journal: {
      module: 'cloture_caisse',
      entity_label: `Clôture ${activite} ${d.date}`,
      details: `Clôture de caisse ${activite} du ${d.date} — attendu ${fmt(attendu)} F, `
        + `réel ${fmt(totalPhysique)} F, écart ${fmt(ecart)} F (${statut})`,
      metadata: {
        geste: 'cloture-caisse', date: d.date, activite,
        attendu, reel: totalPhysique, ecart, statut, denominations,
      },
    },
  };
}

/* ── DEVIS ET FACTURES ───────────────────────────────────────────────────── */

export const STATUTS_DEVIS = Object.freeze(['brouillon', 'envoye', 'accepte', 'refuse']);
export const STATUTS_FACTURE = Object.freeze(['brouillon', 'envoyee', 'payee', 'impayee']);
export const GESTES_FACTURE = Object.freeze(['creer', 'marquer_payee']);

/** Les lignes d'un devis ou d'une facture, à la forme `quantite`/`prix_unitaire`. */
function lignesDeDocument(brutes) {
  const lignes = [];
  for (const l of Array.isArray(brutes) ? brutes : []) {
    const description = texte(l?.description, 300);
    if (!description) continue;
    const quantite = montantValide(l?.quantite ?? 1);
    const prix = entierPositifOuZero(l?.prix_unitaire);
    if (quantite === null) return { erreur: 'Quantité invalide : entier strictement positif par ligne.' };
    if (prix === null) return { erreur: 'Prix invalide : entier de francs CFA ≥ 0 par ligne.' };
    lignes.push({ description, quantite, prix_unitaire: prix });
  }
  if (!lignes.length) return { erreur: 'Au moins une ligne avec une description est requise.' };
  return { lignes };
}

/**
 * Le corps commun d'un devis ou d'une facture.
 *
 * ⚠️ `total` ET `total_ttc` sont écrits tous les deux. L'écran Devis n'écrit
 * que `total_ttc`, mais `clients/page.jsx` calcule le chiffre d'affaires par
 * client sur `f.total` — une facture sans ce champ est invisible dans le CA
 * (constat E6). Il n'y a PAS de TVA dans cette application : `total_ttc` vaut
 * `sous_total - remise`, c'est tout.
 */
function documentCommercial({ corps, ctx, cle, prefixe, statut, marqueur }) {
  const clientNom = nettoyerNom(texte(corps.client_nom, 200) || '');
  if (!clientNom) return { erreur: refus('Client requis', 'Dis pour qui est le document.') };
  const r = lignesDeDocument(corps.lignes);
  if (r.erreur) return { erreur: refus('Lignes invalides', r.erreur) };
  const remise = entierPositifOuZero(corps.remise);
  if (remise === null) return { erreur: refus('Remise invalide', 'Nombre entier de francs CFA ≥ 0, ou rien.') };

  const sousTotal = r.lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire, 0);
  if (remise > sousTotal) {
    return {
      erreur: refus(
        'Remise supérieure au total',
        `La remise (${fmt(remise)} F) dépasse le sous-total (${fmt(sousTotal)} F) : le document serait négatif.`,
      ),
    };
  }
  const total = sousTotal - remise;
  const numero = numeroDocument(prefixe, ctx, cle);

  return {
    numero,
    clientNom,
    sousTotal,
    remise,
    total,
    lignes: r.lignes,
    data: {
      numero,
      client_id: '',
      client_nom: clientNom,
      client_adresse: nettoyerNom(texte(corps.client_adresse, 300) || ''),
      objet: texte(corps.objet, 300) || '',
      lignes: r.lignes,
      sous_total: sousTotal,
      remise,
      total_ttc: total,
      total,
      statut,
      date: ctx.date_locale,
      ...marqueur,
    },
  };
}

function gesteDevis({ corps, ctx, marqueur, cle }) {
  const doc = documentCommercial({ corps, ctx, cle, prefixe: 'DEV', statut: 'brouillon', marqueur });
  if (doc.erreur) return doc.erreur;

  return {
    ok: true,
    temoin: { collection: 'devis', cle },
    operations: [opCreer('devis', doc.data)],
    resume: `Devis ${doc.numero} créé pour ${doc.clientNom} — ${fmt(doc.total)} F`
      + (doc.remise ? ` (remise ${fmt(doc.remise)} F)` : '') + ', en brouillon.',
    journal: {
      module: 'devis',
      entity_label: doc.numero,
      details: `Devis ${doc.numero} créé pour « ${doc.clientNom} » — ${doc.lignes.length} ligne(s), `
        + `${fmt(doc.total)} F CFA`,
      metadata: {
        geste: 'devis', numero: doc.numero, client_nom: doc.clientNom,
        total: doc.total, remise: doc.remise, lignes: doc.lignes,
      },
    },
  };
}

function gesteFacture({ corps, ctx, contexte, marqueur, cle }) {
  const { factures = [] } = contexte;
  const quoi = texte(corps.geste, 30) || 'creer';
  if (!GESTES_FACTURE.includes(quoi)) {
    return refus('Geste de facturation inconnu', `Champ « geste » attendu : ${GESTES_FACTURE.join(' ou ')}.`);
  }

  if (quoi === 'marquer_payee') {
    const demande = texte(corps.facture, 120);
    if (!demande) return refus('Facture requise', 'Donne le numéro exact de la facture.');
    const facture = (factures || []).find(
      (f) => f?.id === demande || String(f?.numero || '').toUpperCase() === demande.toUpperCase(),
    );
    if (!facture) return refus('Facture inconnue', `Aucune facture « ${demande} ».`, 404);
    if (facture.statut === 'payee') {
      return refus('Facture déjà payée', `La facture ${facture.numero || demande} est déjà marquée payée.`, 409);
    }

    /* ⚠️ CE GESTE NE FAIT ENTRER AUCUN ARGENT, et c'est FIDÈLE à l'écran :
       `handleStatut` fait un simple `update({ statut })`, sans mouvement
       financier ni crédit de compte. Le seul chemin du dépôt qui encaisse
       réellement est la livraison d'une commande. Ajouter ici un encaissement
       inventerait une règle que personne n'a écrite — et risquerait de compter
       deux fois une commande déjà encaissée. Le résumé le dit à l'utilisateur,
       pour que personne ne croie la trésorerie mise à jour. */
    return {
      ok: true,
      temoin: { collection: 'factures', cle },
      operations: [opModifier('factures', facture.id, {
        statut: 'payee',
        ...marqueur,
        [CHAMP_AVANT]: { statut: facture.statut || '' },
      })],
      resume: `Facture ${facture.numero || demande} marquée payée. `
        + "⚠️ Comme à l'écran, cela ne crédite AUCUN compte : la trésorerie n'a pas bougé.",
      journal: {
        module: 'factures',
        entity_label: facture.numero || demande,
        details: `Facture ${facture.numero || demande} marquée payée `
          + `(statut seul, aucun mouvement de trésorerie) — était « ${facture.statut || '?'} »`,
        metadata: {
          geste: 'facture', sous_geste: 'marquer_payee',
          facture: facture.numero || demande, facture_id: facture.id,
          statut_avant: facture.statut || '', effet_tresorerie: false,
        },
      },
    };
  }

  const doc = documentCommercial({ corps, ctx, cle, prefixe: 'FAC', statut: 'brouillon', marqueur });
  if (doc.erreur) return doc.erreur;

  return {
    ok: true,
    temoin: { collection: 'factures', cle },
    operations: [opCreer('factures', doc.data)],
    resume: `Facture ${doc.numero} créée pour ${doc.clientNom} — ${fmt(doc.total)} F, en brouillon. `
      + "Aucune fiche client n'a été créée et aucun compte n'a été crédité.",
    journal: {
      module: 'factures',
      entity_label: doc.numero,
      details: `Facture ${doc.numero} créée pour « ${doc.clientNom} » — ${doc.lignes.length} ligne(s), `
        + `${fmt(doc.total)} F CFA, statut brouillon`,
      metadata: {
        geste: 'facture', sous_geste: 'creer', numero: doc.numero,
        client_nom: doc.clientNom, total: doc.total, lignes: doc.lignes,
      },
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   LE REGISTRE — un geste, une fabrique, pas d'exception
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Chaque geste de `GESTES` a ici sa fabrique, et une fabrique ici a son nom
 * dans `GESTES`. Un test apparie les deux listes : un geste annoncé à ChatGPT
 * mais que le serveur ne sait pas exécuter le ferait appeler dans le vide, et
 * une fabrique sans nom serait du code mort qu'aucune relecture ne trouverait.
 *
 * Signature commune : `({ corps, ctx, contexte, marqueur, cle, geste })`.
 * `contexte` porte ce que le dépôt a lu pour ce geste (comptes, projets,
 * clients, articles…). Une fabrique ne lit rien elle-même : elle DÉCIDE.
 */
const FABRIQUES = Object.freeze({
  depense: (a) => gesteArgent({ sens: 'sortie', ...a }),
  recette: (a) => gesteArgent({ sens: 'entree', ...a }),
  'caisse-mouvement': gesteCaisse,
  travaux: gesteTravaux,
  tache: gesteTache,
  'projet-travaux': gesteProjetTravaux,
  catalogue: gesteCatalogue,
  'stock-mouvement': gesteStock,
  rapport: gesteRapport,
  commande: gesteCommande,
  client: gesteClient,
  evenement: gesteEvenement,
  prospect: gesteProspect,
  objectif: gesteObjectif,
  'cloture-caisse': gesteClotureCaisse,
  devis: gesteDevis,
  facture: gesteFacture,
});

/**
 * Ce que le dépôt doit lire AVANT d'appeler la fabrique d'un geste.
 *
 * ⚠️ Écrit ici, et pas deviné par l'exécutant. Sans cette liste, la seule
 * façon de ne rien oublier serait de tout lire à chaque appel : sur la
 * connexion de Moanda, une tâche à deux lignes coûterait la lecture du
 * catalogue entier (195 lignes dont une de 3,2 Mo d'images en base64). Une
 * fabrique qui a besoin d'une clé absente d'ici trouvera un tableau vide et
 * refusera le geste — bruyamment, jamais en silence.
 */
export const BESOINS_CONTEXTE = Object.freeze({
  depense: ['comptes'],
  recette: ['comptes'],
  'caisse-mouvement': ['comptes'],
  travaux: ['comptes', 'projets'],
  tache: [],
  'projet-travaux': [],
  catalogue: ['catalogue'],
  'stock-mouvement': ['articles'],
  rapport: ['rapports'],
  commande: ['commandes'],
  client: ['clients'],
  evenement: [],
  prospect: ['prospects'],
  objectif: [],
  'cloture-caisse': ['rapports', 'clotures'],
  devis: [],
  facture: ['factures'],
});

/* ═══════════════════════════════════════════════════════════════════════════
   LE POINT D'ENTRÉE DU MODULE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Transforme une demande de ChatGPT en liste d'opérations à appliquer.
 *
 * Ne touche à rien : c'est une DÉCISION, pas une écriture. L'exécutant lui
 * applique l'idempotence, la trace d'audit et les écritures elles-mêmes.
 *
 * @param {string} geste un nom de `GESTES`
 * @param {object} corps le corps de la requête, tel que ChatGPT l'envoie
 * @param {object} contexte
 * @param {object} contexte.ctx  `contexteTemporel()` — l'heure de MOANDA
 * @param {Array}  contexte.comptes  comptes réels `{id, nom, solde}`
 * @param {Array}  contexte.projets  projets de travaux réels `{id, nom}`
 * @returns {{ok: true, identifiant, cle, geste, temoin, operations, resume, journal}
 *          | {ok: false, statut: number, erreur: string, detail: string}}
 */
export function preparerGeste(geste, corps, contexte = {}) {
  const { ctx } = contexte;
  if (!ctx) return refus('Contexte temporel manquant', 'Le pont doit dater chaque écriture.', 500);
  if (!GESTES.includes(geste)) {
    return refus('Geste inconnu', `Gestes servis : ${GESTES.join(', ')}.`, 404);
  }
  if (!corps || typeof corps !== 'object' || Array.isArray(corps)) {
    return refus('Corps de requête manquant', 'Envoie un objet JSON.');
  }

  const cle = texte(corps.cle, 80);
  if (!cle || !RE_CLE.test(cle)) {
    return refus(
      'Clé d\'idempotence requise',
      'Fournis `cle` : 4 à 80 caractères (lettres, chiffres, - _ : .). La MÊME clé renvoyée deux '
      + 'fois ne produit qu\'une seule écriture — c\'est ce qui protège d\'un doublon en cas de relance.',
    );
  }

  const phrase = texte(corps.phrase, 1000);
  if (!phrase) {
    return refus(
      'Phrase d\'origine requise',
      'Fournis `phrase` : la demande de l\'utilisateur, mot pour mot. Comme cette écriture a lieu '
      + 'sans confirmation, c\'est la seule chose qui permettra de comprendre plus tard d\'où elle vient.',
    );
  }

  const marqueur = marqueurChatGPT({ geste, cle, phrase, ctx });
  const fabrique = FABRIQUES[geste];
  /* c8 ignore next — `geste` vient de GESTES, qu'un test apparie à FABRIQUES */
  if (!fabrique) return refus('Geste non servi', `Gestes servis : ${GESTES.join(', ')}.`, 404);

  const r = fabrique({ corps, ctx, contexte, marqueur, cle, geste });

  if (!r.ok) return r;

  // Dernier rempart, indépendant de chaque geste : rien ne sort d'ici qui
  // écrive dans une collection non autorisée, ni un mouvement sans compte.
  for (const op of r.operations) {
    if (op.op === 'creer' || op.op === 'modifier') {
      if (!collectionAutorisee(op.collection)) {
        return refus('Collection interdite', `ChatGPT n'écrit jamais dans ${op.collection}.`, 403);
      }
    }
    if (op.op === 'creer' && op.collection === 'mouvements_financiers' && !op.data.compte_id) {
      return refus(
        'Compte introuvable',
        "Un mouvement sans compte ne débite jamais rien : la ligne serait inerte et l'écart "
        + 'invisible jusqu\'au comptage du tiroir.',
      );
    }
  }

  return {
    ok: true,
    identifiant: identifiantDe(cle),
    cle,
    geste,
    temoin: r.temoin,
    operations: r.operations,
    resume: r.resume,
    journal: { action: 'chatgpt_ecriture', ...r.journal },
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   ANNULER — compenser, jamais effacer
   ═══════════════════════════════════════════════════════════════════════════ */

/** Le mouvement de sens inverse d'un mouvement donné. */
function mouvementInverse(origine, { ctx, phrase, libelle }) {
  const type = estTransfertInterne(origine.type)
    ? origine.type
    : (origine.type === 'sortie' ? 'entree' : 'sortie');

  // Pour un transfert, inverser c'est échanger départ et arrivée : l'argent
  // revient d'où il est parti. Pour une entrée ou une sortie, le compte ne
  // change pas, c'est le SENS qui change.
  const compteId = estTransfertInterne(origine.type) ? (origine.compte_dest_id || '') : origine.compte_id;
  const compteDestId = estTransfertInterne(origine.type) ? origine.compte_id : '';

  return {
    type,
    montant: Number(origine.montant) || 0,
    description: `ANNULATION — ${origine.description || libelle}`,
    compte_id: compteId,
    ...(compteDestId ? { compte_dest_id: compteDestId } : {}),
    date: origine.date,
    reference: `${origine.reference}${SUFFIXE_ANNULATION}`,
    categorie: 'annulation_chatgpt',
    source: 'chatgpt',
    activite: normaliserActivite(origine.activite),
    pointe: false,
    [CHAMP_MARQUEUR]: true,
    [CHAMP_CLE]: `${origine[CHAMP_CLE] || ''}${SUFFIXE_ANNULATION}`,
    chatgpt: {
      geste: 'annulation',
      cle: `${origine[CHAMP_CLE] || ''}${SUFFIXE_ANNULATION}`,
      phrase,
      ecrit_le: { ...ctx },
      annule: origine.reference,
    },
  };
}

/**
 * Le mouvement de stock de sens inverse, et la quantité à rétablir.
 *
 * `stock_avant` est le témoin : c'est la quantité qu'il y avait avant le
 * mouvement, relevée au moment de l'écrire. On y revient, plutôt que de
 * recalculer — un recalcul se tromperait si un autre mouvement est passé
 * entre-temps, et il vaut mieux revenir à une valeur connue qu'à une valeur
 * devinée.
 */
function mouvementStockInverse(origine, { ctx, phrase }) {
  const quantite = Number(origine?.quantite) || 0;
  if (quantite <= 0 || !origine?.produit_id) return null;
  const sens = origine.type === 'entree' ? 'sortie' : 'entree';
  const avant = Number(origine.stock_avant);
  const apres = Number(origine.stock_apres);
  if (!Number.isFinite(avant) || !Number.isFinite(apres)) return null;

  return {
    quantiteRetablie: avant,
    mouvement: {
      produit_id: origine.produit_id,
      produit_nom: origine.produit_nom || '',
      type: sens,
      quantite,
      stock_avant: apres,
      stock_apres: avant,
      motif: `ANNULATION — ${origine.motif || 'mouvement de stock'}`,
      operateur: 'ChatGPT (pont)',
      reference: `${origine.reference || ''}${SUFFIXE_ANNULATION}`,
      date: ctx.instant_utc,
      date_metier: origine.date_metier || ctx.date_locale,
      [CHAMP_MARQUEUR]: true,
      [CHAMP_CLE]: `${origine[CHAMP_CLE] || ''}${SUFFIXE_ANNULATION}`,
      chatgpt: {
        geste: 'annulation',
        cle: `${origine[CHAMP_CLE] || ''}${SUFFIXE_ANNULATION}`,
        phrase,
        ecrit_le: { ...ctx },
        annule: origine.reference || '',
      },
    },
  };
}

/** Les champs qui marquent une ligne comme annulée, sans la faire disparaître. */
function marqueAnnulation(ctx, phrase) {
  return {
    annule_le: ctx.instant_utc,
    annule_le_lisible: ctx.lisible,
    annule_phrase: phrase,
    annule_par: 'ChatGPT',
  };
}

/**
 * Le plan d'annulation d'une écriture — PUR, comme le reste du module.
 *
 * ── Pourquoi compenser et pas supprimer ──────────────────────────────────
 *
 * C'est la règle comptable, et c'est déjà celle du dépôt : on n'efface aucune
 * écriture, on en ajoute une de sens opposé (voir
 * `src/services/contre-passation-commande.js`). Supprimer ferait disparaître la
 * preuve qu'une erreur a eu lieu — et comme ces écritures partent SANS
 * confirmation, c'est précisément cette preuve qui rend le choix du dirigeant
 * tenable.
 *
 * ── Idempotence de l'annulation ──────────────────────────────────────────
 *
 * La contre-passation porte la référence `<référence d'origine>:annulation`.
 * L'index unique partiel de la migration 005 la rend unique en base : annuler
 * deux fois ne rembourse pas deux fois, même depuis deux appareils.
 *
 * @param {{collection: string, data: object, lies?: Array}} ligne
 *        l'écriture d'origine et, pour une étape de travaux, les mouvements
 *        financiers qui lui sont rattachés.
 * @param {{ctx: object, phrase: string}} contexte
 */
export function planAnnulation(ligne, { ctx, phrase } = {}) {
  if (!ligne || !ligne.collection || !ligne.data) {
    return refus('Écriture introuvable', 'Rien à annuler.', 404);
  }
  if (!collectionAutorisee(ligne.collection)) {
    return refus('Collection interdite', `ChatGPT ne touche jamais à ${ligne.collection}.`, 403);
  }
  const motif = texte(phrase, 1000) || 'Annulation demandée';
  const operations = [];
  const contrePassees = [];
  const restaures = [];
  let resteVisible = false;

  const contrePasser = (mvt, libelle, id_op) => {
    if (!mvt || !mvt.reference) return;
    if (!mvt.compte_id && !mvt.compte_dest_id) return;
    const montant = Number(mvt.montant) || 0;
    if (montant <= 0) return;
    const inverse = mouvementInverse(mvt, { ctx, phrase: motif, libelle });
    operations.push(opCreer('mouvements_financiers', inverse, id_op));
    // Les deltas sont ceux du mouvement D'ORIGINE, inversés — jamais recalculés
    // à la main : c'est `effetSurSoldes` qui sait ce que vaut un transfert.
    operations.push(...soldesDuMouvement(mvt, id_op, { inverser: true }));
    operations.push(opModifier('mouvements_financiers', mvt.id, marqueAnnulation(ctx, motif)));
    contrePassees.push(mvt.reference);
  };

  if (ligne.collection === 'mouvements_financiers') {
    contrePasser(ligne.data, 'mouvement', 'inverse');
    if (!contrePassees.length) {
      return refus('Rien à contre-passer', 'Ce mouvement n\'a jamais touché de compte.', 409);
    }
  } else if (ligne.data[CHAMP_AVANT]) {
    /* ── UNE MODIFICATION : on REMET la valeur d'avant ────────────────────
       Corriger un prix, régler un seuil, faire avancer une commande, marquer
       une facture payée : ces gestes changent un champ d'une ligne qui
       existait déjà. Les « annuler » en marquant la ligne ne servirait à rien
       — le prix corrigé resterait corrigé. On restaure donc exactement ce qui
       avait été relevé AVANT, et rien d'autre : la ligne d'origine n'a jamais
       été recopiée, seuls les champs touchés l'ont été. */
    const avant = ligne.data[CHAMP_AVANT];
    operations.push(opModifier(ligne.collection, ligne.data.id, {
      ...avant,
      ...marqueAnnulation(ctx, motif),
    }));
    restaures.push(...Object.keys(avant));
  } else {
    // Une CRÉATION qui n'est pas de l'argent : on la marque, on ne la retire pas.
    const champs = marqueAnnulation(ctx, motif);

    /* Le préfixe « [ANNULÉ] » n'est posé que là où l'écran d'origine affiche ce
       libellé sans rien savoir de ce pont : la tâche, l'étape, le projet,
       l'événement, l'objectif. C'est le seul moyen que le gérant voie
       l'annulation SANS qu'on modifie ces écrans.

       Volontairement PAS ailleurs : renommer une fiche client, un produit du
       catalogue ou une facture abîmerait une donnée que d'autres écrans — et le
       portail client — affichent. Ces lignes-là restent visibles telles quelles
       dans leur module, et c'est dit dans le résumé. */
    const champLibelle = CHAMP_LIBELLE_ANNULABLE[ligne.collection];
    if (champLibelle) {
      const valeur = String(ligne.data[champLibelle] || '');
      if (valeur && !valeur.startsWith(PREFIXE_ANNULE)) {
        champs[champLibelle] = `${PREFIXE_ANNULE}${valeur}`;
      }
    } else {
      resteVisible = true;
    }

    if (ligne.collection === 'etapes_travaux') {
      // ⚠️ Repasser l'étape en « non payée » n'est pas cosmétique : si elle
      // restait « payée » après contre-passation, le gérant qui la modifierait
      // ensuite à l'écran déclencherait le cas « payé → non payé » de
      // `travaux/page.jsx`, donc une SECONDE contre-passation. L'argent
      // reviendrait deux fois.
      champs.statut_paiement = 'non_paye';
    }
    operations.push(opModifier(ligne.collection, ligne.data.id, champs));

    /* Un mouvement de STOCK est une quantité physique : l'annuler exige un
       mouvement inverse ET le rétablissement de la quantité, sinon l'inventaire
       diverge du réel et l'écart ne se découvre qu'au comptage suivant. */
    if (ligne.collection === 'mouvements_stock') {
      const inverse = mouvementStockInverse(ligne.data, { ctx, phrase: motif });
      if (inverse) {
        operations.push(opCreer('mouvements_stock', inverse.mouvement, 'stock'));
        operations.push(opModifier(
          'produits', ligne.data.produit_id,
          { quantite: inverse.quantiteRetablie, stock: inverse.quantiteRetablie },
          'stock',
        ));
        restaures.push('stock');
      }
    }

    let i = 0;
    for (const mvt of ligne.lies || []) {
      i += 1;
      contrePasser(mvt, ligne.data.nom || ligne.data.titre || 'écriture', `inverse-${i}`);
    }
  }

  let resume;
  if (contrePassees.length) {
    resume = `Annulé : ${contrePassees.length} mouvement(s) contre-passé(s), les soldes sont revenus `
      + "à leur valeur d'avant. La ligne d'origine reste en base, marquée annulée.";
  } else if (restaures.length) {
    resume = `Annulé : ${restaures.join(', ')} remis à la valeur d'avant. `
      + 'La ligne garde la trace de la correction et de son annulation.';
  } else {
    resume = "Annulé : la ligne reste en base, marquée annulée. Aucun mouvement d'argent n'était en jeu.";
  }
  if (resteVisible) {
    resume += " ⚠️ Elle reste visible dans son écran d'origine : si elle ne doit pas y figurer du "
      + 'tout, retire-la à la main.';
  }

  return {
    ok: true,
    operations,
    contre_passees: contrePassees,
    restaures,
    resume,
    journal: {
      action: 'chatgpt_annulation',
      module: ligne.collection === 'taches' ? 'taches'
        : ligne.collection === 'etapes_travaux' ? 'travaux' : 'finances',
      entity_label: String(ligne.data.nom || ligne.data.titre || ligne.data.description || 'écriture'),
      details: `Annulation d'une écriture ChatGPT (${ligne.collection}) — ${motif}`,
      metadata: {
        collection: ligne.collection,
        cle: ligne.data[CHAMP_CLE] || '',
        phrase: motif,
        contre_passees: contrePassees,
      },
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   LIRE CE QUI A ÉTÉ ÉCRIT
   ═══════════════════════════════════════════════════════════════════════════ */

/** Libellés lisibles des gestes, pour l'écran et pour la réponse de ChatGPT. */
export const LIBELLES_GESTE = Object.freeze({
  depense: 'Dépense',
  recette: 'Recette',
  'caisse-mouvement': 'Mouvement de caisse',
  depot_banque: 'Dépôt en banque',
  garde_en_cash: 'Argent gardé en caisse',
  travaux: 'Étape de travaux',
  tache: 'Tâche',
  'projet-travaux': 'Projet de travaux',
  catalogue: 'Catalogue',
  'stock-mouvement': 'Stock',
  rapport: 'Rapport journalier',
  commande: 'Commande',
  client: 'Fiche client',
  evenement: 'Événement',
  prospect: 'Prospect',
  objectif: 'Objectif',
  'cloture-caisse': 'Clôture de caisse',
  devis: 'Devis',
  facture: 'Facture',
  annulation: 'Annulation',
});

/**
 * Les seuls champs dont `resumerEcriture()` a besoin.
 *
 * ⚠️ Cette liste EST le contrat de la lecture projetée, côté serveur comme côté
 * écran. Un champ lu par `resumerEcriture()` mais absent d'ici s'afficherait
 * vide sans que rien ne le signale ; un champ ici mais jamais lu ferait payer
 * la connexion de Moanda pour rien.
 */
export const CHAMPS_RESUME = Object.freeze([
  CHAMP_CLE, 'chatgpt', 'nom', 'titre', 'numero', 'description', 'motif',
  'montant', 'depense', 'montant_garde', 'date', 'annule_le', 'annule_le_lisible',
]);

/**
 * Résume une ligne écrite par ChatGPT, pour l'écran « Ce que ChatGPT a écrit »
 * et pour la voie `journal`.
 *
 * Ne rend QUE ce qui est nécessaire pour comprendre et annuler : jamais la
 * ligne brute, qui pourrait transporter n'importe quel champ.
 */
export function resumerEcriture({ collection, data }) {
  const meta = data?.chatgpt || {};
  // `caisse-mouvement` couvre DEUX gestes très différents : un dépôt qui
  // déplace de l'argent, et un constat qui n'en déplace pas. À l'écran, les
  // confondre sous un seul libellé ferait chercher un mouvement qui n'existe
  // pas. La collection tranche : un constat vit dans `depots_hebdo`.
  let geste = meta.geste || '';
  if (geste === 'caisse-mouvement') {
    geste = collection === 'depots_hebdo' ? 'garde_en_cash' : 'depot_banque';
  }
  return {
    identifiant: identifiantDe(data?.[CHAMP_CLE] || ''),
    cle: data?.[CHAMP_CLE] || '',
    collection,
    ligne_id: data?.id || '',
    geste,
    libelle_geste: LIBELLES_GESTE[geste] || geste,
    intitule: String(
      data?.description || data?.nom || data?.titre || data?.numero || data?.motif || '',
    ),
    montant: Number(data?.montant ?? data?.depense ?? data?.montant_garde ?? 0) || 0,
    date: String(data?.date || ''),
    phrase: String(meta.phrase || ''),
    ecrit_le: meta.ecrit_le || null,
    annule: Boolean(data?.annule_le),
    annule_le: data?.annule_le || null,
  };
}

/**
 * Trie les écritures de la plus récente à la plus ancienne.
 * Le tri se fait sur l'INSTANT UTC, jamais sur la date métier : deux écritures
 * du même jour doivent rester dans l'ordre où elles ont eu lieu.
 */
export function parPlusRecent(a, b) {
  return String(b?.ecrit_le?.instant_utc || '').localeCompare(String(a?.ecrit_le?.instant_utc || ''));
}
