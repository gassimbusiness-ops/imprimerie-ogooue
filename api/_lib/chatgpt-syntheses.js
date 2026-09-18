/**
 * Synthèses du pont ChatGPT — des chiffres déjà calculés, et datés.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * POURQUOI DES SYNTHÈSES, ET PAS SEULEMENT DES LIGNES BRUTES
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Le dirigeant veut écrire « ce mois on a fait combien ? » et obtenir LE
 * chiffre. Si le pont ne servait que des lignes, ChatGPT devrait rapatrier
 * 237 rapports et 3 350 lignes d'audit pour faire une addition — lentement,
 * en tronquant à sa fenêtre de contexte, et en se trompant sans le dire.
 * Une addition faite ici est faite une fois, toujours de la même façon, et
 * **avec les mêmes fonctions que les écrans** : `caRapports`, `depensesRapports`,
 * `activiteDe`, `seuilArticle`. Le pont ne peut donc pas annoncer un chiffre
 * que le Tableau de bord contredirait.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ « CE MOIS », VU DE MOANDA — PAS VU DE VERCEL
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Les fonctions serverless tournent en UTC. `toISODate(new Date())` y rend donc
 * la date du SERVEUR : le 31 août à 23 h 30 UTC, il est déjà le 1er septembre
 * à Moanda, et un « CA de ce mois » calculé sur l'horloge du serveur compterait
 * encore août. C'est exactement le mécanisme de l'écart de 55 300 F documenté
 * en tête de `src/lib/dates.js`, transposé au serveur.
 *
 * Toute date de ce module vient donc de `contexteTemporel()`, qui passe par
 * `dateLocaleDepuisInstantUtc`. Les deux raccourcis interdits ici — la date du
 * jour lue sur l'horloge du processus, et la troncature d'un horodatage ISO en
 * UTC — sont refusés par un test qui relit la SOURCE de ce fichier, parce qu'une
 * date fausse ne plante pas : elle s'affiche.
 *
 * Module PUR : aucun accès base, aucun réseau. Les données lui sont passées.
 * Testé par `tests/chatgpt-pont.test.mjs`.
 */
import {
  OFFSET_MOANDA as OFFSET_DES_DATES,
  contexteMoanda,
  dateLocaleDepuisInstantUtc,
} from '../../src/lib/dates.js';
import { ACTIVITES, activiteDe, libelleActivite } from '../../src/services/activites.js';
import {
  caRapports,
  depensesRapports,
  tresorerieImprimerie,
} from '../../src/services/finance-calc.js';
import {
  preparerArticlesPourAffichage,
  seuilArticle,
  quantiteArticle,
} from '../../src/services/stocks-seuils.js';

/** Africa/Libreville est à UTC+1 toute l'année, sans heure d'été. */
export const OFFSET_MOANDA = OFFSET_DES_DATES;

/**
 * Où en est l'horloge, vue de Moanda.
 *
 * C'est la seule source de « maintenant » du pont. Chaque réponse la porte,
 * pour que ChatGPT puisse dire « au 18/09 à 18 h » plutôt que de laisser croire
 * que le chiffre est de l'instant où on le lit.
 *
 * ⚠️ Le calcul lui-même vit dans `src/lib/dates.js` (`contexteMoanda`), et pas
 * ici : l'écran « Ce que ChatGPT a écrit » date ses annulations avec la MÊME
 * fonction. Deux copies de cette règle, c'est une écriture et son annulation
 * qui finissent par tomber des jours différents.
 *
 * @param {Date} [maintenant]
 * @returns {{instant_utc: string, date_locale: string, heure_locale: string,
 *            mois_local: string, fuseau: string, offset_utc: string, lisible: string}}
 */
export function contexteTemporel(maintenant = new Date()) {
  return contexteMoanda(maintenant);
}

/** Vrai si une date métier `YYYY-MM-DD` appartient au mois `YYYY-MM`. */
function dansLeMois(date, mois) {
  return typeof date === 'string' && typeof mois === 'string' && date.slice(0, 7) === mois;
}

function nombre(valeur) {
  const n = Number(valeur);
  return Number.isFinite(n) ? n : 0;
}

/* ═══════════════════════════════════════════════════════════════════════════
   LES STATUTS DE COMMANDE — les mêmes qu'à l'écran, alias compris
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Ordre et libellés repris de `src/features/commandes/page.jsx`.
 * Un statut que le gérant lit « En production » à l'écran ne doit pas s'appeler
 * autrement quand ChatGPT le répète.
 */
export const STATUTS_COMMANDE = Object.freeze([
  Object.freeze({ statut: 'en_attente_validation', libelle: 'En attente de validation' }),
  Object.freeze({ statut: 'validee_attente_paiement', libelle: 'Validée — attente paiement' }),
  Object.freeze({ statut: 'paiement_initie', libelle: 'Paiement Mobile Money initié' }),
  Object.freeze({ statut: 'en_production', libelle: 'En production' }),
  Object.freeze({ statut: 'prete', libelle: 'Prête' }),
  Object.freeze({ statut: 'livree', libelle: 'Livrée' }),
  Object.freeze({ statut: 'annulee', libelle: 'Annulée' }),
]);

/** Anciens libellés encore présents en base. Mêmes alias que l'écran. */
const ALIAS_STATUT = Object.freeze({
  nouveau: 'en_attente_validation',
  en_attente: 'en_attente_validation',
  en_cours: 'en_production',
  pret: 'prete',
  livre: 'livree',
  annule: 'annulee',
});

/** Statut canonique d'une commande. */
export function statutCommande(commande) {
  const brut = String(commande?.statut || '').trim().toLowerCase();
  return ALIAS_STATUT[brut] || brut || 'en_attente_validation';
}

const LIBELLE_STATUT = Object.fromEntries(STATUTS_COMMANDE.map((s) => [s.statut, s.libelle]));

/* ═══════════════════════════════════════════════════════════════════════════
   1. CHIFFRE D'AFFAIRES DU MOIS — TROIS CHIFFRES, JAMAIS UN SEUL
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Date métier à laquelle une commande a été LIVRÉE.
 *
 * L'horodatage de `historique_statuts` est un instant UTC (`…Z`) : il faut le
 * ramener à la date de Moanda, sans quoi une livraison de 22 h 30 compte pour
 * la veille. On remonte l'historique à l'envers pour prendre le dernier
 * passage au statut « livrée » — une commande rouverte puis relivrée est
 * datée de sa livraison effective.
 *
 * @param {object} commande
 * @returns {string|null} date métier `YYYY-MM-DD`, ou null si indatable
 */
export function dateDeLivraison(commande) {
  const historique = Array.isArray(commande?.historique_statuts) ? commande.historique_statuts : [];
  for (let i = historique.length - 1; i >= 0; i -= 1) {
    const entree = historique[i];
    if (statutCommande(entree) !== 'livree') continue;
    const locale = dateLocaleDepuisInstantUtc(String(entree?.date || ''), OFFSET_MOANDA);
    if (locale) return locale;
  }
  if (typeof commande?.date_livraison === 'string' && commande.date_livraison.length >= 10) {
    return commande.date_livraison.slice(0, 10);
  }
  const parMaj = dateLocaleDepuisInstantUtc(String(commande?.updated_at || ''), OFFSET_MOANDA);
  if (parMaj) return parMaj;
  if (typeof commande?.date_creation === 'string') return commande.date_creation.slice(0, 10);
  return null;
}

/**
 * Le chiffre d'affaires du mois, en TROIS chiffres séparés.
 *
 * ⚠️ Ces trois nombres ne s'additionnent pas et ne doivent jamais être
 * présentés comme trois façons de dire la même chose. C'est la définition
 * retenue par le dirigeant, et elle est recopiée dans la réponse pour que
 * ChatGPT puisse l'énoncer plutôt que de l'inventer :
 *
 *   • FACTURÉ  — ce qu'on a émis comme factures. Un brouillon n'est pas une
 *     facture émise : il est exclu du total, mais son montant est rendu à part,
 *     car « il manque 999 000 F » doit être explicable sans ouvrir la base.
 *   • LIVRÉ    — ce qui est sorti de l'atelier. Une commande peut être livrée
 *     sans être encore facturée, et facturée sans être livrée.
 *   • ENCAISSÉ — l'argent réellement passé par la caisse, c'est-à-dire les
 *     recettes des rapports journaliers. C'est le chiffre que le Tableau de
 *     bord appelle « CA du mois », calculé par la MÊME fonction (`caRapports`).
 *
 * @param {{mois: string, factures?: Array, commandes?: Array, rapports?: Array}} entree
 */
export function chiffreAffairesDuMois({ mois, factures = [], commandes = [], rapports = [] } = {}) {
  /* ── Facturé ───────────────────────────────────────────────────────────── */
  const facturesDuMois = (factures || []).filter((f) => dansLeMois(f?.date, mois));
  const etatFacture = (f) => String(f?.statut || '').trim().toLowerCase();
  const emises = facturesDuMois.filter((f) => !['brouillon', 'annulee', 'annule'].includes(etatFacture(f)));
  const brouillons = facturesDuMois.filter((f) => etatFacture(f) === 'brouillon');
  const annulees = facturesDuMois.filter((f) => ['annulee', 'annule'].includes(etatFacture(f)));
  const sommeTtc = (liste) => liste.reduce((s, f) => s + nombre(f?.total_ttc), 0);

  /* ── Livré ─────────────────────────────────────────────────────────────── */
  const livrees = (commandes || []).filter(
    (c) => statutCommande(c) === 'livree' && dansLeMois(dateDeLivraison(c), mois),
  );

  /* ── Encaissé ──────────────────────────────────────────────────────────── */
  const rapportsDuMois = (rapports || []).filter((r) => dansLeMois(r?.date, mois));
  const encaisse = caRapports(rapportsDuMois);
  const parActivite = ACTIVITES.map((activite) => {
    const lot = rapportsDuMois.filter((r) => activiteDe(r) === activite);
    return {
      activite,
      libelle: libelleActivite(activite),
      encaisse: caRapports(lot),
      depenses: depensesRapports(lot),
      rapports: lot.length,
    };
  });

  return {
    mois,
    devise: 'XAF',
    facture: {
      montant: sommeTtc(emises),
      nombre: emises.length,
      definition:
        'Somme TTC des factures émises dans le mois (brouillons et factures annulées exclus). '
        + "Une facture peut exister sans que l'argent soit encaissé.",
      brouillons_exclus: { nombre: brouillons.length, montant: sommeTtc(brouillons) },
      annulees_exclues: { nombre: annulees.length, montant: sommeTtc(annulees) },
    },
    livre: {
      montant: livrees.reduce((s, c) => s + nombre(c?.montant_total), 0),
      nombre: livrees.length,
      definition:
        "Somme des montants des commandes passées au statut « Livrée » dans le mois, datées par "
        + "leur passage effectif à ce statut, en heure de Moanda. Une commande annulée n'y figure jamais.",
    },
    encaisse: {
      montant: encaisse,
      depenses: depensesRapports(rapportsDuMois),
      nombre_rapports: rapportsDuMois.length,
      definition:
        "Recettes des rapports journaliers du mois — l'argent réellement passé par la caisse. "
        + "C'est le chiffre que le Tableau de bord affiche comme « CA du mois ».",
      par_activite: parActivite,
    },
    avertissement:
      'Ces trois chiffres ne s\'additionnent pas et ne se remplacent pas : une même vente peut '
      + 'être livrée un mois, facturée le suivant et encaissée en plusieurs fois.',
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. LA CAISSE, PAR ACTIVITÉ
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * État de caisse du jour et dernière clôture, POUR CHAQUE ACTIVITÉ.
 *
 * ⚠️ LE PIÈGE DE NOM. `rapport.categories.imprimerie` est une CATÉGORIE DE
 * PRESTATION, pas une activité : un rapport de la PAPETERIE peut contenir une
 * recette dans la catégorie `imprimerie` (un client achète un cahier et fait
 * trois photocopies au même comptoir). La répartition entre les deux caisses se
 * fait sur `activiteDe(rapport)`, JAMAIS sur les noms de catégories. Les
 * confondre déplacerait du chiffre d'affaires d'une caisse à l'autre sans lever
 * la moindre erreur. Voir l'en-tête de `src/services/activites.js`.
 *
 * L'absence de champ `activite` vaut « imprimerie » : tout l'existant d'avant
 * septembre 2026 est de l'imprimerie, et une ligne ancienne ne peut pas
 * appartenir à un commerce qui n'existait pas.
 *
 * @param {{rapports?: Array, clotures?: Array, comptes?: Array, aujourdhui: string}} entree
 */
export function etatCaisseParActivite({ rapports = [], clotures = [], comptes = [], aujourdhui } = {}) {
  const activites = ACTIVITES.map((activite) => {
    const duJour = (rapports || []).filter(
      (r) => r?.date === aujourdhui && activiteDe(r) === activite,
    );
    const recettes = caRapports(duJour);
    const depenses = depensesRapports(duJour);

    const sienne = (clotures || [])
      .filter((c) => activiteDe(c) === activite)
      .sort((a, b) => String(b?.date || '').localeCompare(String(a?.date || '')));
    const derniere = sienne[0] || null;

    return {
      activite,
      libelle: libelleActivite(activite),
      recettes_du_jour: recettes,
      depenses_du_jour: depenses,
      caisse_attendue: recettes - depenses,
      rapports_du_jour: duJour.length,
      derniere_cloture: derniere
        ? {
          date: derniere.date,
          montant_attendu: nombre(derniere.montant_attendu),
          montant_reel: nombre(derniere.montant_reel),
          ecart: nombre(derniere.ecart),
          statut: derniere.statut || null,
        }
        : null,
      note_si_aucune_cloture: derniere
        ? null
        : "Aucune clôture enregistrée pour cette caisse : l'écran Clôture de caisse n'a pas encore servi ici.",
    };
  });

  const tr = tresorerieImprimerie(comptes || []);

  return {
    date_du_jour: aujourdhui,
    devise: 'XAF',
    activites,
    tresorerie: {
      total: tr.total,
      en_banque: tr.compte,
      en_caisse: tr.caisse,
      note:
        "Les soldes des comptes ne sont PAS ventilés par activité : un compte bancaire n'appartient "
        + "ni à l'imprimerie ni à la papeterie. Seules les recettes du jour et les clôtures le sont.",
    },
    definition:
      'Caisse attendue = recettes du jour − dépenses du jour, pour la caisse concernée uniquement. '
      + "C'est le montant que le comptage physique du soir doit retrouver dans le tiroir.",
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. LES COMMANDES
   ═══════════════════════════════════════════════════════════════════════════ */

/** Nombre de jours entiers entre deux dates métier. Sans fuseau : de l'arithmétique. */
function joursEntre(debut, fin) {
  const [a1, m1, j1] = String(debut).split('-').map(Number);
  const [a2, m2, j2] = String(fin).split('-').map(Number);
  if (![a1, m1, j1, a2, m2, j2].every(Number.isFinite)) return 0;
  return Math.round((Date.UTC(a2, m2 - 1, j2) - Date.UTC(a1, m1 - 1, j1)) / 86_400_000);
}

/**
 * Répartition des commandes par statut, et celles en retard.
 *
 * « En retard » reprend exactement la règle de l'écran Commandes : une échéance
 * PASSÉE, et un statut qui n'est ni « Livrée » ni « Annulée ». Une commande
 * SANS échéance n'est jamais déclarée en retard — affirmer un retard qu'on ne
 * peut pas mesurer serait un chiffre inventé, et c'est un gérant qui court
 * après un client pour rien.
 *
 * @param {{commandes?: Array, aujourdhui: string}} entree
 */
export function commandesParStatut({ commandes = [], aujourdhui } = {}) {
  const lot = Array.isArray(commandes) ? commandes : [];

  const groupes = new Map();
  for (const c of lot) {
    const statut = statutCommande(c);
    const g = groupes.get(statut) || { statut, libelle: LIBELLE_STATUT[statut] || statut, nombre: 0, montant: 0 };
    g.nombre += 1;
    g.montant += nombre(c?.montant_total);
    groupes.set(statut, g);
  }

  const ordre = STATUTS_COMMANDE.map((s) => s.statut);
  const parStatut = [...groupes.values()].sort((a, b) => {
    const ia = ordre.indexOf(a.statut);
    const ib = ordre.indexOf(b.statut);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  const enRetard = lot
    .filter((c) => {
      const statut = statutCommande(c);
      if (statut === 'livree' || statut === 'annulee') return false;
      const echeance = c?.date_echeance;
      return typeof echeance === 'string' && echeance.length >= 10 && echeance.slice(0, 10) < aujourdhui;
    })
    .map((c) => ({
      id: c?.id,
      numero: c?.numero || null,
      client_nom: c?.client_nom || null,
      statut: statutCommande(c),
      libelle_statut: LIBELLE_STATUT[statutCommande(c)] || statutCommande(c),
      date_echeance: c.date_echeance.slice(0, 10),
      jours_de_retard: joursEntre(c.date_echeance.slice(0, 10), aujourdhui),
      montant_total: nombre(c?.montant_total),
    }))
    .sort((a, b) => b.jours_de_retard - a.jours_de_retard);

  return {
    date_du_jour: aujourdhui,
    devise: 'XAF',
    total: lot.length,
    par_statut: parStatut,
    en_retard: enRetard,
    definition_retard:
      "Échéance passée et statut ni « Livrée » ni « Annulée ». Une commande sans date d'échéance "
      + "n'est jamais comptée en retard.",
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. LE STOCK
   ═══════════════════════════════════════════════════════════════════════════ */

function ficheArticle(article) {
  return {
    id: article?.id,
    nom: article?.nom || null,
    reference: article?.reference || null,
    quantite: quantiteArticle(article),
    seuil_alerte: seuilArticle(article),
    unite: article?.unite || null,
    fournisseur: article?.fournisseur || null,
  };
}

/**
 * Articles en rupture et en seuil bas.
 *
 * ⚠️ Le seuil est celui que le GÉRANT a réglé, lu par `seuilArticle` — pas un
 * 10 imposé. Un écran a longtemps réécrit tous les seuils à 10 à chaque
 * ouverture : 26 articles sur 45 en portent encore la trace. Le pont lit, il ne
 * corrige rien et il n'invente aucun seuil.
 *
 * @param {{produits?: Array}} entree
 */
export function alertesStock({ produits = [] } = {}) {
  const prepares = preparerArticlesPourAffichage(produits);
  const ruptures = prepares.filter((a) => a._niveau === 'rupture').map(ficheArticle);
  const bas = prepares.filter((a) => a._niveau === 'bas').map(ficheArticle);
  return {
    nombre_articles: prepares.length,
    nombre_en_alerte: ruptures.length + bas.length,
    ruptures,
    seuil_bas: bas,
    definition:
      'Rupture = quantité à 0 ou moins. Seuil bas = quantité inférieure ou égale au seuil réglé '
      + "par le gérant sur l'article. Un article sans seuil ne déclenche aucune alerte.",
  };
}
