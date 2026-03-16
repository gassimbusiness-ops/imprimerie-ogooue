/**
 * Synchronise le stock lors de la livraison d'une commande.
 * Deduit les quantites commandees du stock si les produits correspondent.
 */
import { db } from '@/services/db';
import { notifyStockAlerte } from '@/services/notifications';

export async function syncStockFromCommande(commande) {
  const items = commande.lignes || commande.produits || [];
  if (items.length === 0) return;

  const allStock = await db.produits.list();

  for (const item of items) {
    const nomProduit = (item.nom || item.description || item.designation || '').toLowerCase().trim();
    const qteCommandee = Number(item.quantite || item.qte || 1);

    if (!nomProduit || qteCommandee <= 0) continue;

    // Chercher le produit dans le stock par nom (correspondance partielle)
    const stockItem = allStock.find((s) => {
      const sNom = (s.nom || '').toLowerCase();
      return sNom === nomProduit || sNom.includes(nomProduit) || nomProduit.includes(sNom);
    });

    if (!stockItem) continue;

    const currentQty = stockItem.quantite ?? stockItem.stock ?? 0;
    const newQty = Math.max(0, currentQty - qteCommandee);

    // Mettre a jour le stock
    await db.produits.update(stockItem.id, {
      quantite: newQty,
      stock: newQty,
      derniere_sortie: new Date().toISOString(),
      motif_derniere_sortie: `Commande ${commande.numero || commande.id}`,
    });

    // Enregistrer le mouvement de stock
    await db.mouvements_stock.create({
      produit_id: stockItem.id,
      produit_nom: stockItem.nom,
      type: 'sortie',
      quantite: qteCommandee,
      stock_avant: currentQty,
      stock_apres: newQty,
      motif: `Livraison commande ${commande.numero || ''} — ${commande.client_nom || 'Client'}`,
      operateur: 'Systeme automatique',
      date: new Date().toISOString(),
    });

    // Notification si seuil atteint (consommables uniquement)
    const seuil = stockItem.quantite_minimum ?? stockItem.stock_min ?? 10;
    const typeArt = stockItem.type_article || 'consommable';
    if (newQty <= seuil && typeArt === 'consommable') {
      notifyStockAlerte(stockItem.nom, newQty, seuil);
    }
  }
}
