/**
 * Sortie de stock a la livraison d'une commande.
 *
 * ── Ce qui a change le 16/09/2026 ─────────────────────────────────────────
 *
 * Cette fonction n'avait AUCUNE idempotence (constat 8a.1). Deux clics sur
 * « Livrée », ou une reprise apres un echec partiel, sortaient deux fois la
 * meme quantite : l'inventaire theorique descendait de 20 ramettes la ou 10
 * etaient parties. C'est exactement le chiffre qu'on regarde en cas de
 * suspicion de vol.
 *
 * Chaque sortie porte desormais une REFERENCE stable
 * `commande:<id>:stock:<produit>` ecrite dans `mouvements_stock`. Avant
 * d'ecrire, on la cherche : si elle est la, la sortie a deja eu lieu et on ne
 * touche a rien. Le double-clic devient sans effet, et la reprise apres echec
 * ne rejoue que ce qui manque.
 *
 * Non corrige ici (constat 8b.4, laisse volontairement hors de ce lot) : la
 * correspondance produit se fait encore par sous-chaine de nom dans les deux
 * sens, si bien qu'une ligne « Carte » peut decrementer « Cartes de visite »,
 * « Cartouche noire » ou « Carton » selon l'ordre de la liste. Le `produit_id`
 * est pourtant present dans les lignes du portail.
 *
 * ── Ce qui a change le 18/09/2026 (arbitrage n°5) ─────────────────────────
 *
 * Toute cette mecanique ne s'execute plus par defaut. Q4 dit que les supports
 * d'une commande personnalisee NE SONT PAS deduits du stock : le code faisait
 * l'inverse de la pratique. La decision est prise par `decisionSortieStock()`,
 * qui est pure et testee — voir src/services/sortie-stock-commande.js pour le
 * raisonnement complet et pour ce qui reste a trancher.
 */
import { db } from '@/services/db';
import { notifyStockAlerte } from '@/services/notifications';
import { referenceEffet } from '@/services/livraison-commande';
import { decisionSortieStock, lignesCommande } from '@/services/sortie-stock-commande';

export async function syncStockFromCommande(commande) {
  // Decision AVANT toute lecture : interrupteur ferme, on ne paie meme pas la
  // requete. Aucune lecture, aucune ecriture, donc aucun risque.
  const decision = decisionSortieStock({ commande });
  if (decision.action !== 'sortir') {
    console.info(`[STOCK] stock non modifié — ${decision.motif}`);
    return { sorties: 0, ignorees: 0, motif: decision.motif };
  }

  const items = lignesCommande(commande);

  const [allStock, mouvements] = await Promise.all([
    db.produits.list(),
    db.mouvements_stock.list(),
  ]);
  const referencesDeja = new Set(mouvements.map((m) => m.reference).filter(Boolean));

  let sorties = 0;
  let ignorees = 0;

  for (const item of items) {
    const nomProduit = (item.nom || item.description || item.designation || '').toLowerCase().trim();
    // `quantite` (comptoir) ou `qte` (portail client) — deux schemas de ligne
    // coexistent en base ; ignorer le second perdait la quantite reelle.
    const qteCommandee = Number(item.quantite ?? item.qte ?? 1);

    if (!nomProduit || !(qteCommandee > 0)) continue;

    const stockItem = allStock.find((s) => {
      const sNom = (s.nom || '').toLowerCase();
      return sNom === nomProduit || sNom.includes(nomProduit) || nomProduit.includes(sNom);
    });

    if (!stockItem) continue;

    // ── Garde d'idempotence ──
    const reference = referenceEffet(commande, 'stock', stockItem.id);
    if (reference && referencesDeja.has(reference)) { ignorees++; continue; }

    const currentQty = stockItem.quantite ?? stockItem.stock ?? 0;
    const newQty = Math.max(0, currentQty - qteCommandee);

    // Le mouvement est ecrit AVANT la mise a jour du stock : si l'application
    // s'interrompt entre les deux, la reprise voit la reference et ne redecremente
    // pas. On prefere un mouvement sans decrement (visible, corrigeable) a un
    // decrement sans mouvement (invisible, indetectable).
    await db.mouvements_stock.create({
      produit_id: stockItem.id,
      produit_nom: stockItem.nom,
      type: 'sortie',
      quantite: qteCommandee,
      stock_avant: currentQty,
      stock_apres: newQty,
      motif: `Livraison commande ${commande.numero || commande.id || ''} — ${commande.client_nom || 'Client'}`,
      operateur: 'Systeme automatique',
      reference,
      commande_id: commande.id || null,
      date: new Date().toISOString(),
    });
    if (reference) referencesDeja.add(reference);

    await db.produits.update(stockItem.id, {
      quantite: newQty,
      stock: newQty,
      derniere_sortie: new Date().toISOString(),
      motif_derniere_sortie: `Commande ${commande.numero || commande.id}`,
    });
    sorties++;

    // Notification si seuil atteint (consommables uniquement).
    // Repli `0` et non `10` : un seuil absent n'est pas un seuil de 10 — c'est
    // precisement la confusion qui avait remonte 26 articles a 10 (constat C1).
    const seuil = stockItem.quantite_minimum ?? stockItem.stock_min ?? 0;
    const typeArt = stockItem.type_article || 'consommable';
    if (newQty <= seuil && typeArt === 'consommable') {
      notifyStockAlerte(stockItem.nom, newQty, seuil);
    }
  }

  return { sorties, ignorees };
}
