import { useState, useEffect } from 'react';
import { db } from '@/services/db';
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
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';

function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)); }

const CATEGORY_ICONS = {
  Textile: Shirt, Papeterie: FileText, Impression: Printer, Reliure: BookOpen,
  Accessoire: Tag, Machine: Printer, Photo: Camera, Default: Package,
};
const CATEGORY_COLORS = {
  Textile: 'from-blue-500 to-blue-600',
  Papeterie: 'from-amber-500 to-orange-500',
  Impression: 'from-violet-500 to-purple-600',
  Reliure: 'from-emerald-500 to-green-600',
  Accessoire: 'from-pink-500 to-rose-600',
  Machine: 'from-gray-500 to-gray-700',
  Photo: 'from-cyan-500 to-teal-600',
};

export default function ClientCatalogue() {
  const [produits, setProduits] = useState([]);
  const [search, setSearch] = useState('');
  const [categorie, setCategorie] = useState('all');
  const [panier, setPanier] = useState([]);
  const [showPanier, setShowPanier] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    db.produits_catalogue.list().then((p) => {
      setProduits(p.filter((x) => x.actif !== false));
      setLoading(false);
    });
  }, []);

  const categories = [...new Set(produits.map((p) => p.categorie).filter(Boolean))];

  const filtered = produits.filter((p) => {
    const matchSearch = !search || p.nom?.toLowerCase().includes(search.toLowerCase());
    const matchCat = categorie === 'all' || p.categorie === categorie;
    return matchSearch && matchCat;
  });

  const addToPanier = (produit) => {
    setPanier((prev) => {
      const existing = prev.find((p) => p.id === produit.id);
      if (existing) return prev.map((p) => p.id === produit.id ? { ...p, qte: p.qte + 1 } : p);
      return [...prev, { ...produit, qte: 1 }];
    });
    toast.success(`${produit.nom} ajouté au panier`);
  };

  const updateQte = (id, delta) => {
    setPanier((prev) => prev.map((p) => p.id === id ? { ...p, qte: Math.max(1, p.qte + delta) } : p));
  };

  const removeFromPanier = (id) => {
    setPanier((prev) => prev.filter((p) => p.id !== id));
  };

  const totalPanier = panier.reduce((s, p) => s + (p.prix_unitaire || 0) * p.qte, 0);

  const envoyerDemande = async () => {
    if (panier.length === 0) { toast.error('Panier vide'); return; }
    const desc = panier.map((p) => `${p.qte}x ${p.nom}`).join(', ');
    await db.commandes.create({
      client_nom: 'Client Portail',
      description: desc,
      service: 'Commande en ligne',
      statut: 'en_attente',
      montant_total: totalPanier,
      date_creation: new Date().toISOString().slice(0, 10),
      source: 'portail_client',
      lignes: panier.map((p) => ({ produit_id: p.id, nom: p.nom, qte: p.qte, prix: p.prix_unitaire })),
    });
    toast.success('Demande envoyée ! L\'imprimerie vous contactera bientôt.');
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
          const CatIcon = CATEGORY_ICONS[p.categorie] || CATEGORY_ICONS.Default;
          const gradient = CATEGORY_COLORS[p.categorie] || 'from-gray-400 to-gray-500';
          const inPanier = panier.find((x) => x.id === p.id);
          const lowStock = (p.stock_actuel || 0) <= (p.stock_minimum || 5);

          return (
            <Card key={p.id} className="overflow-hidden group hover:shadow-lg transition-all duration-200">
              {/* Product visual */}
              <div className={`relative h-32 bg-gradient-to-br ${gradient} flex items-center justify-center`}>
                <CatIcon className="h-12 w-12 text-white/40" />
                {lowStock && (
                  <Badge className="absolute top-2 right-2 bg-red-500 text-white text-[9px]">Stock faible</Badge>
                )}
                {inPanier && (
                  <div className="absolute top-2 left-2 flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs font-bold text-primary">
                    {inPanier.qte}
                  </div>
                )}
              </div>
              <CardContent className="p-3">
                <p className="font-semibold text-sm leading-tight line-clamp-2 min-h-[2.5rem]">{p.nom}</p>
                <div className="flex items-center gap-1 mt-1.5">
                  <Badge variant="outline" className="text-[10px]">{p.categorie}</Badge>
                  <span className="text-[10px] text-muted-foreground">Stock: {p.stock_actuel || 0}</span>
                </div>
                <div className="flex items-center justify-between mt-2.5">
                  <p className="text-lg font-black text-primary">{fmt(p.prix_unitaire)} <span className="text-xs font-normal">F</span></p>
                  <Button size="sm" className="h-8 w-8 p-0" onClick={() => addToPanier(p)} disabled={(p.stock_actuel || 0) === 0}>
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
                    <p className="text-xs text-muted-foreground">{fmt(p.prix_unitaire)} F / unité</p>
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
                  <p className="text-sm font-semibold w-20 text-right">{fmt(p.prix_unitaire * p.qte)} F</p>
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
              <p className="text-[10px] text-center text-muted-foreground">Un employé validera votre commande et vous contactera pour confirmer le délai et le paiement.</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
