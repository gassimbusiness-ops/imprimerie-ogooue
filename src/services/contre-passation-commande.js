/**
 * Contre-passation d'une commande livree puis annulee.
 *
 * ── Le probleme (constat C5 / 8b.1 de l'audit VAGUE 2) ────────────────────
 *
 * `handleAnnuler` ne faisait que changer le statut. Si la commande avait deja
 * declenche sa livraison — ou si elle avait ete payee par SingPay, dont le
 * callback credite la tresorerie des la confirmation, bien avant la livraison —
 * il restait en base : le mouvement de tresorerie, le solde credite, la sortie
 * de stock, les points de fidelite, la facture.
 *
 * Autrement dit : **l'argent d'une commande annulee restait dans la tresorerie
 * et dans le chiffre d'affaires du mois.**
 *
 * ── Le principe : contre-passer, jamais supprimer ─────────────────────────
 *
 * On n'efface aucune ecriture. On en ajoute une de sens oppose, qui porte la
 * mention « ANNULATION » et une reference propre. C'est la regle comptable, et
 * c'est aussi la regle du projet. Le modele est celui de
 * `travaux/page.jsx:258-271` (`contrepasserEtapePayee`), seule contre-passation
 * propre du depot avant cette intervention.
 *
 * ── Idempotence ──────────────────────────────────────────────────────────
 *
 * Chaque contre-passation porte la reference `<reference d'origine>:annulation`.
 * Annuler deux fois ne rembourse pas deux fois.
 *
 * ── Injection de dependances ─────────────────────────────────────────────
 *
 * La couche de donnees est passee en ARGUMENT, jamais importee. Deux raisons :
 *   - ce module devient testable avec une base factice, sans navigateur ni
 *     reseau — et c'est la partie du code qu'il faut le plus verifier ;
 *   - importer `./db` ferait remonter `./supabase`, donc `import.meta.env`,
 *     qui n'existe pas sous `node --test`. Le module resterait intestable.
 *
 * L'appelant (src/features/commandes/page.jsx) passe `db`.
 */
import { referenceEffet } from './livraison-commande.js';
import { originesRapport, CHAMP_ORIGINES, montantCommande } from './reprise-rapport.js';

/** Suffixe des references de contre-passation. */
export const SUFFIXE_ANNULATION = ':annulation';

/**
 * Contre-passe tous les effets d'argent d'une commande.
 *
 * Ne leve jamais pour un effet absent : contre-passer une commande qui n'a
 * jamais ete livree ne trouve simplement rien a faire. Leve en revanche si une
 * ECRITURE de contre-passation echoue — l'appelant doit le savoir.
 *
 * @param {object} commande
 * @param {object} deps couche de donnees — `db` en production, une base
 *        factice dans les tests. OBLIGATOIRE : voir l'en-tete du fichier.
 * @returns {Promise<{effets: string[], notes: string[], montantRepris: number}>}
 *          ce qui a ete contre-passe. `montantRepris` est la somme REELLEMENT
 *          sortie des comptes — c'est elle, et pas le montant de la commande,
 *          qui a le droit d'etre annoncee au client comme lui etant due.
 */
export async function contrePasserCommande(commande, deps) {
  if (!deps) throw new Error('contrePasserCommande : couche de donnees manquante');
  const effets = [];
  const notes = [];
  let montantRepris = 0;
  if (!commande?.id) return { effets, notes: ['commande sans identifiant'], montantRepris };

  const libelle = `ANNULATION — commande ${commande.numero || commande.id} (${commande.client_nom || 'client'})`;

  // ── 1. Tresorerie ────────────────────────────────────────────────────────
  // Toutes les entrees rattachees a cette commande sont reprises : celle de la
  // livraison (`commande:<id>`) ET celle du callback SingPay
  // (`singpay:<ref>`), qui peut avoir credite bien avant la livraison.
  const mouvements = await deps.mouvements_financiers.list();
  const refsCommande = [referenceEffet(commande, 'encaissement')];
  if (commande.singpay_reference) refsCommande.push(`singpay:${commande.singpay_reference}`);

  const aContrePasser = mouvements.filter(
    (m) => m.type === 'entree' && refsCommande.includes(m.reference),
  );
  const dejaFaites = new Set(mouvements.map((m) => m.reference).filter(Boolean));

  for (const m of aContrePasser) {
    const refAnnul = `${m.reference}${SUFFIXE_ANNULATION}`;
    if (dejaFaites.has(refAnnul)) { notes.push('trésorerie déjà contre-passée'); continue; }
    const montant = Number(m.montant) || 0;
    if (montant <= 0) continue;

    await deps.mouvements_financiers.create({
      type: 'sortie',
      montant,
      description: `${libelle} — reprise de l'encaissement`,
      compte_id: m.compte_id || '',
      date: m.date,
      reference: refAnnul,
      categorie: 'annulation_commande',
      source: 'contre_passation',
      pointe: true,
    });
    dejaFaites.add(refAnnul);

    if (m.compte_id) {
      const comptes = await deps.comptes_bancaires.list();
      const compte = comptes.find((c) => c.id === m.compte_id);
      if (compte) {
        await deps.comptes_bancaires.update(compte.id, {
          solde: (Number(compte.solde) || 0) - montant,
        });
      } else {
        notes.push(`compte ${m.compte_id} introuvable : solde non corrigé`);
      }
    }
    montantRepris += montant;
    effets.push('trésorerie');
  }

  // ── 2. Stock ─────────────────────────────────────────────────────────────
  const prefixeStock = `commande:${commande.id}:stock:`;
  const mvtsStock = await deps.mouvements_stock.list();
  const refsStockFaites = new Set(mvtsStock.map((m) => m.reference).filter(Boolean));
  const sorties = mvtsStock.filter(
    (m) => typeof m.reference === 'string' && m.reference.startsWith(prefixeStock) && m.type === 'sortie',
  );

  if (sorties.length) {
    const produits = await deps.produits.list();
    for (const s of sorties) {
      const refAnnul = `${s.reference}${SUFFIXE_ANNULATION}`;
      if (refsStockFaites.has(refAnnul)) { notes.push('stock déjà contre-passé'); continue; }
      const qte = Number(s.quantite) || 0;
      if (qte <= 0) continue;
      const produit = produits.find((p) => p.id === s.produit_id);
      const avant = produit ? (produit.quantite ?? produit.stock ?? 0) : null;

      await deps.mouvements_stock.create({
        produit_id: s.produit_id,
        produit_nom: s.produit_nom,
        type: 'entree',
        quantite: qte,
        stock_avant: avant,
        stock_apres: avant === null ? null : avant + qte,
        motif: `${libelle} — retour en stock`,
        operateur: 'Systeme automatique',
        reference: refAnnul,
        commande_id: commande.id,
        date: new Date().toISOString(),
      });
      refsStockFaites.add(refAnnul);

      if (produit) {
        await deps.produits.update(produit.id, { quantite: avant + qte, stock: avant + qte });
      } else {
        notes.push(`article ${s.produit_nom || s.produit_id} introuvable : quantité non restaurée`);
      }
      effets.push('stock');
    }
  }

  // ── 3. Points de fidelite ────────────────────────────────────────────────
  const fidelites = await deps.fidelite_clients.list();
  const fidelite = fidelites.find((f) => f.client_id === commande.client_id);
  if (fidelite) {
    const historique = Array.isArray(fidelite.historique) ? fidelite.historique : [];
    const dejaReprise = historique.some(
      (h) => h.commande_id === commande.id && h.type === 'annulation_commande',
    );
    const credites = historique
      .filter((h) => h.commande_id === commande.id && h.type !== 'annulation_commande')
      .reduce((s, h) => s + (Number(h.points) || 0), 0);

    if (!dejaReprise && credites > 0) {
      await deps.fidelite_clients.update(fidelite.id, {
        points_actuels: Math.max(0, (Number(fidelite.points_actuels) || 0) - credites),
        total_points_gagnes: Math.max(0, (Number(fidelite.total_points_gagnes) || 0) - credites),
        historique: [...historique, {
          type: 'annulation_commande',
          points: -credites,
          commande_id: commande.id,
          description: `${libelle} — reprise des points`,
          date: new Date().toISOString(),
        }],
      });
      effets.push('points de fidélité');
    } else if (dejaReprise) {
      notes.push('points déjà repris');
    }
  }

  // ── 4. Facture ───────────────────────────────────────────────────────────
  // On ne supprime pas une facture : un numero emis ne doit jamais disparaitre
  // (constat E17 — la numerotation se reattribuerait). On l'annule.
  const factures = await deps.factures.list();
  const facture = factures.find((f) => f.commande_id === commande.id);
  if (facture && facture.statut !== 'annulee') {
    await deps.factures.update(facture.id, {
      statut: 'annulee',
      motif_annulation: libelle,
      date_annulation: new Date().toISOString(),
    });
    effets.push('facture');
  }

  // ── 5. Rapport journalier ────────────────────────────────────────────────
  // Sans effet aujourd'hui : la reprise automatique est desactivee. Le code est
  // la pour rester symetrique si elle est rallumee — la trace d'origine dit
  // exactement quel montant retirer, et de quel rapport.
  const montant = montantCommande(commande);
  if (montant > 0) {
    const rapports = await deps.rapports.list();
    const rapport = rapports.find((r) => originesRapport(r).includes(commande.id));
    if (rapport) {
      const cats = rapport.categories || {};
      await deps.rapports.update(rapport.id, {
        categories: { ...cats, imprimerie: Math.max(0, (Number(cats.imprimerie) || 0) - montant) },
        [CHAMP_ORIGINES]: originesRapport(rapport).filter((id) => id !== commande.id),
        notes: `${rapport.notes || ''}\n− ${libelle} (${montant} F retirés)`,
      });
      effets.push('rapport journalier');
    }
  }

  return { effets: [...new Set(effets)], notes, montantRepris };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Ce qu'on dit au client
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Coordonnees de l'imprimerie telles qu'elles figurent deja sur les factures
 * (src/services/export-pdf.js) et dans le chatbot. Un message qui dit « annulée »
 * sans dire ou aller ne sert a rien.
 */
export const CONTACT_IMPRIMERIE = Object.freeze({
  telephone: '060 44 46 34',
  adresse: 'Carrefour Fina, Moanda',
});

/** Separateur de milliers stable — `Intl` change d'espace selon la version d'ICU. */
function fmtMontant(n) {
  return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * Le message d'annulation envoye au client.
 *
 * ── La regle qui gouverne ce texte ────────────────────────────────────────
 *
 * Il ne promet QUE ce qui a ete reellement contre-passe. Annoncer un
 * remboursement quand aucun mouvement n'a ete repris ferait attendre un client
 * de Moanda devant un guichet pour rien — c'est pire que le silence d'avant.
 *
 * Trois situations, trois textes :
 *   1. de l'argent a ete repris        → on dit combien, et ou le recuperer ;
 *   2. rien n'a ete repris             → on dit qu'aucun paiement n'est
 *                                        enregistre, ET quoi faire s'il a
 *                                        quand meme paye (cash au comptoir non
 *                                        saisi : ca arrive) ;
 *   3. la contre-passation a echoue    → on ne promet RIEN, on fait appeler.
 *
 * Le message part en UNE SEULE ligne : le panneau de notifications
 * (src/components/layout/client-layout.jsx:157) rend `n.message` sans
 * `whitespace-pre-line`, un `\n` y serait invisible.
 *
 * @param {object} arg
 * @param {object} [arg.commande]
 * @param {string[]} [arg.effets] retour de `contrePasserCommande`
 * @param {number} [arg.montantRepris] retour de `contrePasserCommande`
 * @param {boolean} [arg.contrePassationEchouee] la reprise a leve
 * @returns {string}
 */
export function messageAnnulationClient({
  commande,
  effets = [],
  montantRepris = 0,
  contrePassationEchouee = false,
} = {}) {
  const numero = commande?.numero ? ` ${commande.numero}` : '';
  const tete = `❌ Commande${numero} annulée.`;
  const { telephone, adresse } = CONTACT_IMPRIMERIE;
  const listeEffets = Array.isArray(effets) ? effets : [];

  if (contrePassationEchouee) {
    return `${tete} Appelez l'imprimerie au ${telephone} pour faire le point sur votre `
      + 'commande et sur tout paiement déjà effectué : nous vérifions votre dossier avec vous.';
  }

  const morceaux = [tete];

  if (listeEffets.includes('trésorerie') && montantRepris > 0) {
    morceaux.push(
      `Votre paiement de ${fmtMontant(montantRepris)} F vous est dû : il a été sorti de nos `
      + `comptes et vous sera remis. Passez à l'imprimerie (${adresse}) ou appelez le `
      + `${telephone} pour convenir du remboursement.`,
    );
  } else {
    morceaux.push(
      `Aucun paiement n'est enregistré pour cette commande, il n'y a donc rien à vous `
      + `rembourser. Si vous avez déjà versé une somme, appelez le ${telephone} : nous `
      + `régularisons. Pour relancer cette commande, contactez l'imprimerie (${adresse}).`,
    );
  }

  if (listeEffets.includes('facture')) {
    morceaux.push('La facture correspondante a été annulée.');
  }
  if (listeEffets.includes('points de fidélité')) {
    morceaux.push('Les points de fidélité gagnés sur cette commande ont été retirés.');
  }

  return morceaux.join(' ');
}
