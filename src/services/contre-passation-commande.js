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
 * @returns {Promise<{effets: string[], notes: string[]}>} ce qui a ete contre-passe
 */
export async function contrePasserCommande(commande, deps) {
  if (!deps) throw new Error('contrePasserCommande : couche de donnees manquante');
  const effets = [];
  const notes = [];
  if (!commande?.id) return { effets, notes: ['commande sans identifiant'] };

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

  return { effets: [...new Set(effets)], notes };
}
