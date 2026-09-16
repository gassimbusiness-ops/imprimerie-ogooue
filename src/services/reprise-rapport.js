/**
 * Reprise d'une commande livree dans le rapport journalier — regles pures.
 *
 * ── Le probleme, confirme par le gerant et mesure en base ─────────────────
 *
 * `syncCommandeToRapport()` ajoutait le montant d'une commande livree dans
 * `categories.imprimerie` du rapport journalier du jour, et creait le rapport
 * s'il n'existait pas.
 *
 * Or Gassim a confirme que **la commande livree est deja recopiee A LA MAIN**
 * dans le rapport par Ibrahim. La reprise automatique compte donc le meme
 * argent deux fois.
 *
 * Ce n'est pas une hypothese. [MESURE le 16/09/2026 sur la base de production]
 * le rapport du 2026-03-16 (id f4599794-…) porte :
 *
 *     categories.imprimerie = 5000
 *     notes = "\n+ Commande  livrée (4500 F)"
 *
 * La reprise automatique a donc DEJA tourne une fois, sur un vrai rapport
 * d'exploitation. Et la commande qui l'a declenchee n'existe plus en base : la
 * suppression d'une commande emporte toute trace de son origine (constat 8b.2),
 * si bien qu'on ne peut meme plus prouver, aujourd'hui, laquelle des deux
 * lignes est la bonne.
 *
 * Trois defauts cumules :
 *   1. double comptage avec la saisie manuelle ;
 *   2. aucune trace d'origine, donc aucune deduplication possible a posteriori ;
 *   3. `new Date().toISOString().split('T')[0]` — entre 00 h et 01 h heure de
 *      Libreville, la reprise visait la VEILLE, journee souvent deja cloturee.
 *
 * ── Ce qui est decide ici ─────────────────────────────────────────────────
 *
 * A. La reprise automatique est **desactivee par defaut** (`REPRISE_AUTO_RAPPORT`).
 *    La regle du projet interdit de supprimer : le chemin de code reste entier
 *    et se rallume en changeant une seule constante.
 *
 * B. Quand elle est rallumee, elle ecrit une **trace d'origine** :
 *    `origines_commandes: [<id de commande>, …]`. Une commande deja reprise
 *    n'est jamais reprise une seconde fois — ce qui neutralise le double-clic,
 *    la reprise apres echec partiel, et le rejeu. Et la trace rend la
 *    deduplication possible : on sait quelle part du montant vient de
 *    l'automatique et laquelle vient de la saisie d'Ibrahim.
 *
 * Module pur : aucun import. Teste par tests/reprise-rapport.test.mjs.
 */

/**
 * Interrupteur de la reprise automatique dans le rapport journalier.
 *
 * `false` = le rapport journalier appartient a l'operateur ; l'application n'y
 * ecrit pas. La livraison reste tracee ailleurs : statut de la commande,
 * `historique_statuts`, facture, et surtout l'encaissement en tresorerie
 * (`mouvements_financiers`, reference `commande:<id>`), qui est la source de
 * verite de l'argent encaisse.
 *
 * Passer a `true` UNIQUEMENT si la saisie manuelle du rapport cesse.
 */
export const REPRISE_AUTO_RAPPORT = false;

/** Champ portant la liste des commandes deja reprises dans un rapport. */
export const CHAMP_ORIGINES = 'origines_commandes';

/** Montant encaisse par une commande, quel que soit le champ utilise. */
export function montantCommande(commande) {
  const brut = commande?.montant_total ?? commande?.total ?? 0;
  const n = Number(brut);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Liste (toujours un tableau) des commandes deja reprises dans un rapport. */
export function originesRapport(rapport) {
  const v = rapport?.[CHAMP_ORIGINES];
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : [];
}

/** Vrai si cette commande a deja ete reprise dans ce rapport. */
export function dejaReprise(rapport, commande) {
  const id = commande?.id;
  if (!id) return false;
  return originesRapport(rapport).includes(id);
}

/**
 * Decide ce qu'il faut faire d'une commande livree vis-a-vis du rapport du jour.
 *
 * @param {object} params
 * @param {object} params.commande
 * @param {object|null} params.rapportDuJour rapport existant pour la date, ou null
 * @param {string} params.date date metier `YYYY-MM-DD` (calculee par l'appelant
 *        avec `todayISO()` — surtout pas avec `toISOString()`)
 * @param {boolean} [params.actif] etat de l'interrupteur
 * @returns {{action: 'ignorer'|'creer'|'ajouter', motif: string, patch?: object, date?: string}}
 */
export function decisionReprise({ commande, rapportDuJour, date, actif = REPRISE_AUTO_RAPPORT }) {
  if (!actif) {
    return {
      action: 'ignorer',
      motif: 'reprise automatique désactivée (le rapport journalier est saisi à la main)',
    };
  }

  const montant = montantCommande(commande);
  if (montant <= 0) {
    return { action: 'ignorer', motif: 'montant nul ou absent' };
  }
  if (!commande?.id) {
    return {
      action: 'ignorer',
      motif: 'commande sans identifiant : aucune trace d\'origine possible, donc aucune reprise',
    };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
    return { action: 'ignorer', motif: 'date métier invalide' };
  }

  if (!rapportDuJour) {
    return {
      action: 'creer',
      motif: 'aucun rapport pour cette date',
      date,
      patch: {
        date,
        operateur_id: 'system',
        operateur_nom: 'Système (auto)',
        categories: {
          copies: 0, marchandises: 0, scan: 0, tirage_saisies: 0,
          badges_plastification: 0, demi_photos: 0, maintenance: 0,
          imprimerie: montant,
        },
        depenses: [],
        statut: 'brouillon',
        [CHAMP_ORIGINES]: [commande.id],
        notes: `Auto-généré — commande ${commande.numero || commande.id} livrée (${montant} F)`,
      },
    };
  }

  if (dejaReprise(rapportDuJour, commande)) {
    return {
      action: 'ignorer',
      motif: 'commande déjà reprise dans ce rapport (trace d\'origine présente)',
    };
  }

  const cats = rapportDuJour.categories || {};
  return {
    action: 'ajouter',
    motif: 'ajout au rapport existant',
    date,
    patch: {
      categories: { ...cats, imprimerie: (Number(cats.imprimerie) || 0) + montant },
      [CHAMP_ORIGINES]: [...originesRapport(rapportDuJour), commande.id],
      notes: `${rapportDuJour.notes || ''}\n+ Commande ${commande.numero || commande.id} livrée (${montant} F)`,
    },
  };
}
