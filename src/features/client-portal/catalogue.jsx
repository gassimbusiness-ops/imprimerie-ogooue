import { useState, useEffect } from 'react';
import { db } from '@/services/db';
import { useAuth } from '@/services/auth';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Search, ShoppingCart, Plus, Minus, Trash2, ShoppingBag, Send,
  Shirt, BookOpen, Printer, Camera, FileText, Scissors, Package, Tag,
  Clock, DollarSign, LayoutGrid, Coffee, ChevronLeft, ChevronRight, X, ZoomIn,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';

function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)); }

/* Prix helpers — compatible with new prix[] structure */
function prixRange(p) {
  // New format: prix array
  if (p.prix && Array.isArray(p.prix)) {
    const vals = p.prix.map((r) => r.prix).filter((v) => v > 0);
    if (vals.length === 0) return 'Sur devis';
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    return min === max ? `${fmt(min)} F` : `${fmt(min)} — ${fmt(max)} F`;
  }
  // Legacy format
  return p.prix_unitaire ? `${fmt(p.prix_unitaire)} F` : 'Sur devis';
}

function prixPourQte(p, qte) {
  if (p.prix && Array.isArray(p.prix)) {
    const sorted = [...p.prix].sort((a, b) => a.qte_min - b.qte_min);
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (qte >= sorted[i].qte_min) return sorted[i].prix;
    }
    return sorted[0]?.prix || 0;
  }
  return p.prix_unitaire || 0;
}

const CAT_GRADIENT = {
  Textile: 'from-blue-500 to-blue-600',
  Accessoire: 'from-pink-500 to-rose-600',
  Papeterie: 'from-amber-500 to-orange-500',
  Impression: 'from-violet-500 to-purple-600',
  Marketing: 'from-fuchsia-500 to-fuchsia-600',
  Signalétique: 'from-red-500 to-red-600',
  Autre: 'from-slate-400 to-slate-600',
};
const CAT_ICON = {
  Textile: Shirt, Accessoire: Coffee, Papeterie: BookOpen,
  Impression: DollarSign, Marketing: Tag, Signalétique: LayoutGrid,
  Autre: Package,
};

export default function ClientCatalogue() {
  const { user } = useAuth();
  const [produits, setProduits] = useState([]);
  const [search, setSearch] = useState('');
  const [categorie, setCategorie] = useState('all');
  const [panier, setPanier] = useState([]);
  const [showPanier, setShowPanier] = useState(false);
  const [detailProduct, setDetailProduct] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    db.produits_catalogue.list().then((p) => {
      setProduits(p.filter((x) => x.actif !== false));
      setLoading(false);
    });
  }, []);

  const categories = [...new Set(produits.map((p) => p.categorie).filter(Boolean))].sort();

  const filtered = produits.filter((p) => {
    const q = search.toLowerCase();
    const matchSearch = !search || `${p.nom} ${p.description || ''} ${(p.tags || []).join(' ')}`.toLowerCase().includes(q);
    const matchCat = categorie === 'all' || p.categorie === categorie;
    return matchSearch && matchCat;
  });

  const addToPanier = (produit) => {
    setPanier((prev) => {
      const existing = prev.find((p) => p.id === produit.id);
      if (existing) {
        const newQte = existing.qte + 1;
        return prev.map((p) => p.id === produit.id ? { ...p, qte: newQte, prix_calc: prixPourQte(produit, newQte) } : p);
      }
      return [...prev, { ...produit, qte: 1, prix_calc: prixPourQte(produit, 1) }];
    });
    toast.success(`${produit.nom} ajouté au panier`);
  };

  const updateQte = (id, delta) => {
    setPanier((prev) => prev.map((p) => {
      if (p.id !== id) return p;
      const newQte = Math.max(1, p.qte + delta);
      return { ...p, qte: newQte, prix_calc: prixPourQte(p, newQte) };
    }));
  };

  const removeFromPanier = (id) => setPanier((prev) => prev.filter((p) => p.id !== id));

  const totalPanier = panier.reduce((s, p) => s + (p.prix_calc || 0) * p.qte, 0);

  const envoyerDemande = async () => {
    if (panier.length === 0) { toast.error('Panier vide'); return; }
    const clientNom = `${user?.prenom || ''} ${user?.nom || ''}`.trim() || 'Client Portail';
    const desc = panier.map((p) => `${p.qte}x ${p.nom}`).join(', ');
    const nbArticles = panier.reduce((s, p) => s + p.qte, 0);
    const cmd = await db.commandes.create({
      client_nom: clientNom,
      client_id: user?.id,
      client_tel: user?.telephone || '',
      client_email: user?.email || '',
      description: desc,
      service: 'Commande en ligne',
      statut: 'en_attente_validation',
      montant_total: totalPanier,
      date_creation: new Date().toISOString().slice(0, 10),
      source: 'portail_client',
      lignes: panier.map((p) => ({
        produit_id: p.id, nom: p.nom, qte: p.qte,
        prix: p.prix_calc || prixPourQte(p, p.qte),
        image: p.images?.[0] || null,
      })),
      historique_statuts: [{ statut: 'en_attente_validation', date: new Date().toISOString(), auteur: clientNom }],
    });
    // Create notification for admin/employees
    await db.notifications_app.create({
      type: 'nouvelle_commande',
      titre: '🛒 Nouvelle commande',
      message: `Client : ${clientNom}\nProduits : ${desc}\nMontant estimé : ${fmt(totalPanier)} F`,
      lien: '/commandes',
      commande_id: cmd.id,
      destinataire: 'admin',
      lu: false,
    });
    toast.success('✅ Commande envoyée ! Nous la traitons dans les plus brefs délais.');
    setPanier([]);
    setShowPanier(false);
  };

  if (loading) return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Catalogue</h1>
          <p className="text-muted-foreground">{filtered.length} produits disponibles</p>
        </div>
        <Button className="gap-2 relative" onClick={() => setShowPanier(true)}>
          <ShoppingCart className="h-4 w-4" />
          Mon Panier
          {panier.length > 0 && (
            <span className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white">
              {panier.reduce((s, p) => s + p.qte, 0)}
            </span>
          )}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-10" placeholder="Rechercher un produit..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={categorie} onValueChange={setCategorie}>
          <SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes catégories</SelectItem>
            {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Category chips */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        <button onClick={() => setCategorie('all')} className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${categorie === 'all' ? 'bg-primary text-white' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}>
          Tout ({produits.length})
        </button>
        {categories.map((c) => {
          const count = produits.filter((p) => p.categorie === c).length;
          return (
            <button key={c} onClick={() => setCategorie(c)} className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${categorie === c ? 'bg-primary text-white' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}>
              {c} ({count})
            </button>
          );
        })}
      </div>

      {/* Product grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {filtered.map((p) => {
          const CatIcon = CAT_ICON[p.categorie] || Package;
          const gradient = CAT_GRADIENT[p.categorie] || 'from-gray-400 to-gray-500';
          const inPanier = panier.find((x) => x.id === p.id);
          const hasImages = p.images && p.images.length > 0;

          return (
            <Card key={p.id} className="overflow-hidden group hover:shadow-lg transition-all duration-200">
              {/* Product visual */}
              <div
                className={`relative h-32 ${hasImages ? 'bg-slate-100' : `bg-gradient-to-br ${gradient}`} flex items-center justify-center cursor-pointer`}
                onClick={() => setDetailProduct(p)}
              >
                {hasImages ? (
                  <img src={p.images[p.image_principale || 0] || p.images[0]} alt={p.nom} className="w-full h-full object-cover" />
                ) : (
                  <CatIcon className="h-12 w-12 text-white/40" />
                )}
                {inPanier && (
                  <div className="absolute top-2 left-2 flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs font-bold text-primary shadow">
                    {inPanier.qte}
                  </div>
                )}
                {hasImages && p.images.length > 1 && (
                  <Badge className="absolute top-2 right-2 bg-black/40 text-white text-[9px]">{p.images.length} photos</Badge>
                )}
              </div>
              <CardContent className="p-3">
                <p className="font-semibold text-sm leading-tight line-clamp-2 min-h-[2.5rem]">{p.nom}</p>
                <div className="flex items-center gap-1 mt-1.5">
                  <Badge variant="outline" className="text-[10px]">{p.categorie}</Badge>
                  {p.delai_jours > 0 && (
                    <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                      <Clock className="h-2.5 w-2.5" />{p.delai_jours}j
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between mt-2.5">
                  <p className="text-base font-black text-primary">{prixRange(p)}</p>
                  <Button size="sm" className="h-8 w-8 p-0" onClick={() => addToPanier(p)}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12">
          <ShoppingBag className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-muted-foreground">Aucun produit trouvé</p>
        </div>
      )}

      {/* Product Detail Dialog (read-only, no stock info) */}
      <Dialog open={!!detailProduct} onOpenChange={() => setDetailProduct(null)}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          {detailProduct && (
            <>
              <DialogHeader>
                <DialogTitle>{detailProduct.nom}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                {/* Image */}
                {detailProduct.images && detailProduct.images.length > 0 ? (
                  <div className="h-48 bg-slate-100 rounded-lg overflow-hidden">
                    <img src={detailProduct.images[detailProduct.image_principale || 0] || detailProduct.images[0]} alt="" className="w-full h-full object-contain" />
                  </div>
                ) : (
                  <div className={`h-32 bg-gradient-to-br ${CAT_GRADIENT[detailProduct.categorie] || 'from-slate-400 to-slate-600'} rounded-lg flex items-center justify-center`}>
                    {(() => { const I = CAT_ICON[detailProduct.categorie] || Package; return <I className="h-10 w-10 text-white/30" />; })()}
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <Badge variant="outline">{detailProduct.categorie}</Badge>
                  {detailProduct.delai_jours > 0 && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {detailProduct.delai_jours} jour{detailProduct.delai_jours > 1 ? 's' : ''}
                    </span>
                  )}
                </div>

                {detailProduct.description && (
                  <p className="text-sm text-muted-foreground">{detailProduct.description}</p>
                )}

                {/* Prix table */}
                {detailProduct.prix && detailProduct.prix.length > 0 && !detailProduct.prix.every((r) => r.prix === 0) && (
                  <div className="rounded-lg border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/50">
                          <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Quantité</th>
                          <th className="px-3 py-1.5 text-right font-medium text-muted-foreground">Prix / {detailProduct.unite || 'pièce'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailProduct.prix.map((r, i) => (
                          <tr key={i} className="border-t">
                            <td className="px-3 py-1.5">{r.qte_max ? `${r.qte_min} — ${r.qte_max}` : `${r.qte_min}+`}</td>
                            <td className="px-3 py-1.5 text-right font-semibold text-primary">{r.prix > 0 ? `${fmt(r.prix)} F` : 'Sur devis'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Tags */}
                {detailProduct.tags && detailProduct.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {detailProduct.tags.map((t) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}
                  </div>
                )}

                <Button className="w-full gap-2" onClick={() => { addToPanier(detailProduct); setDetailProduct(null); }}>
                  <Plus className="h-4 w-4" /> Ajouter au panier
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Panier dialog */}
      <Dialog open={showPanier} onOpenChange={setShowPanier}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><ShoppingCart className="h-5 w-5" /> Mon Panier</DialogTitle></DialogHeader>
          {panier.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">Votre panier est vide</p>
          ) : (
            <div className="space-y-3">
              {panier.map((p) => (
                <div key={p.id} className="flex items-center gap-3 rounded-lg border p-2.5">
                  <div className="flex-1">
                    <p className="text-sm font-medium">{p.nom}</p>
                    <p className="text-xs text-muted-foreground">{fmt(p.prix_calc || prixPourQte(p, p.qte))} F / {p.unite || 'unité'}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateQte(p.id, -1)}>
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="w-8 text-center text-sm font-bold">{p.qte}</span>
                    <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateQte(p.id, 1)}>
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                  <p className="text-sm font-semibold w-20 text-right">{fmt((p.prix_calc || prixPourQte(p, p.qte)) * p.qte)} F</p>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeFromPanier(p.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}

              <div className="border-t pt-3 flex items-center justify-between">
                <span className="font-semibold">Total</span>
                <span className="text-xl font-black text-primary">{fmt(totalPanier)} F</span>
              </div>

              <Button className="w-full gap-2" onClick={envoyerDemande}>
                <Send className="h-4 w-4" /> Envoyer la demande de commande
              </Button>
              <p className="text-[10px] text-center text-muted-foreground">
                Un employé validera votre commande et vous contactera pour confirmer le délai et le paiement.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
