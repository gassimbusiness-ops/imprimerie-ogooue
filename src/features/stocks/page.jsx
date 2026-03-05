import { useState, useEffect, useMemo } from 'react';
import { db } from '@/services/db';
import { useAuth } from '@/services/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Boxes,
  Search,
  Plus,
  Edit2,
  Trash2,
  PackagePlus,
  PackageMinus,
  AlertTriangle,
  Filter,
} from 'lucide-react';
import { toast } from 'sonner';

const CATEGORIES = ['Papeterie', 'Consommables', 'Badges', 'Photo', 'Accessoires', 'Autre'];

function fmt(n) {
  return new Intl.NumberFormat('fr-FR').format(n || 0);
}

export default function Stocks() {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('stocks', 'write');
  const [produits, setProduits] = useState([]);
  const [mouvements, setMouvements] = useState([]);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('all');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showMouvement, setShowMouvement] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [mouvementItem, setMouvementItem] = useState(null);
  const [form, setForm] = useState({ nom: '', categorie: 'Papeterie', prix_vente: '', stock: '', stock_min: '' });
  const [mvtForm, setMvtForm] = useState({ type: 'entree', quantite: '', motif: '' });

  const load = async () => {
    const [p, m] = await Promise.all([db.produits.list(), db.mouvements_stock ? db.mouvements_stock.list() : Promise.resolve([])]);
    setProduits(p);
    setMouvements(m);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    return produits
      .filter((p) => p.nom.toLowerCase().includes(search.toLowerCase()))
      .filter((p) => filterCat === 'all' || p.categorie === filterCat);
  }, [produits, search, filterCat]);

  const stats = useMemo(() => {
    const total = produits.length;
    const lowStock = produits.filter((p) => p.stock <= p.stock_min).length;
    const totalValue = produits.reduce((s, p) => s + (p.prix_vente || 0) * (p.stock || 0), 0);
    return { total, lowStock, totalValue };
  }, [produits]);

  const openAdd = () => {
    setEditItem(null);
    setForm({ nom: '', categorie: 'Papeterie', prix_vente: '', stock: '', stock_min: '' });
    setShowForm(true);
  };

  const openEdit = (p) => {
    setEditItem(p);
    setForm({
      nom: p.nom,
      categorie: p.categorie,
      prix_vente: String(p.prix_vente || ''),
      stock: String(p.stock || ''),
      stock_min: String(p.stock_min || ''),
    });
    setShowForm(true);
  };

  const openMouvement = (p, type) => {
    setMouvementItem(p);
    setMvtForm({ type, quantite: '', motif: '' });
    setShowMouvement(true);
  };

  const handleSave = async () => {
    if (!form.nom.trim()) { toast.error('Nom requis'); return; }
    const data = {
      nom: form.nom.trim(),
      categorie: form.categorie,
      prix_vente: Number(form.prix_vente) || 0,
      stock: Number(form.stock) || 0,
      stock_min: Number(form.stock_min) || 0,
    };
    if (editItem) {
      await db.produits.update(editItem.id, data);
      toast.success('Produit modifié');
    } else {
      await db.produits.create(data);
      toast.success('Produit ajouté');
    }
    setShowForm(false);
    load();
  };

  const handleDelete = async (p) => {
    if (!confirm(`Supprimer "${p.nom}" ?`)) return;
    await db.produits.delete(p.id);
    toast.success('Produit supprimé');
    load();
  };

  const handleMouvement = async () => {
    const qty = Number(mvtForm.quantite);
    if (!qty || qty <= 0) { toast.error('Quantité invalide'); return; }

    const newStock = mvtForm.type === 'entree'
      ? (mouvementItem.stock || 0) + qty
      : (mouvementItem.stock || 0) - qty;

    if (newStock < 0) { toast.error('Stock insuffisant'); return; }

    await db.produits.update(mouvementItem.id, { stock: newStock });

    // Log the movement if collection exists
    if (db.mouvements_stock) {
      await db.mouvements_stock.create({
        produit_id: mouvementItem.id,
        produit_nom: mouvementItem.nom,
        type: mvtForm.type,
        quantite: qty,
        stock_avant: mouvementItem.stock,
        stock_apres: newStock,
        motif: mvtForm.motif || (mvtForm.type === 'entree' ? 'Réapprovisionnement' : 'Vente/Utilisation'),
        date: new Date().toISOString(),
      });
    }

    toast.success(`${mvtForm.type === 'entree' ? 'Entrée' : 'Sortie'} de ${qty} ${mouvementItem.nom}`);
    setShowMouvement(false);
    load();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Stocks</h2>
          <p className="text-muted-foreground">Inventaire et suivi des produits</p>
        </div>
        {canWrite && (
          <Button className="gap-2" onClick={openAdd}>
            <Plus className="h-4 w-4" /> Nouveau produit
          </Button>
        )}
      </div>

      {/* Stats */}
      <div className={`grid gap-3 ${canWrite ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">Produits</p>
            <p className="text-2xl font-bold">{stats.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">Alertes stock</p>
            <p className={`text-2xl font-bold ${stats.lowStock > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{stats.lowStock}</p>
          </CardContent>
        </Card>
        {canWrite && (
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground">Valeur stock</p>
              <p className="text-lg font-bold sm:text-2xl">{fmt(stats.totalValue)} F</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Search + Filter */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Rechercher un produit..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={filterCat} onValueChange={setFilterCat}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <Filter className="mr-2 h-4 w-4" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes catégories</SelectItem>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Product grid */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Boxes className="mb-3 h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">Aucun produit trouvé</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => {
            const isLow = p.stock <= p.stock_min;
            return (
              <Card key={p.id} className={`transition-shadow hover:shadow-md ${isLow ? 'border-amber-300' : ''}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{p.nom}</p>
                      <Badge variant="outline" className="mt-1 text-xs">{p.categorie}</Badge>
                    </div>
                    <div className="text-right">
                      <p className={`text-xl font-bold ${isLow ? 'text-amber-600' : 'text-foreground'}`}>
                        {p.stock}
                      </p>
                      <p className="text-[10px] text-muted-foreground">min: {p.stock_min}</p>
                    </div>
                  </div>

                  {canWrite && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      Prix : {fmt(p.prix_vente)} F
                    </p>
                  )}

                  {isLow && (
                    <div className="mt-2 flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1">
                      <AlertTriangle className="h-3 w-3 text-amber-600" />
                      <p className="text-xs font-medium text-amber-600">Stock bas</p>
                    </div>
                  )}

                  {canWrite && (
                    <div className="mt-3 flex gap-1.5">
                      <Button variant="outline" size="sm" className="flex-1 gap-1 text-xs" onClick={() => openMouvement(p, 'entree')}>
                        <PackagePlus className="h-3 w-3 text-emerald-600" /> Entrée
                      </Button>
                      <Button variant="outline" size="sm" className="flex-1 gap-1 text-xs" onClick={() => openMouvement(p, 'sortie')}>
                        <PackageMinus className="h-3 w-3 text-red-500" /> Sortie
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => openEdit(p)}>
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-destructive hover:text-destructive" onClick={() => handleDelete(p)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editItem ? 'Modifier le produit' : 'Nouveau produit'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Nom du produit</label>
              <Input value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} placeholder="Ex: Rame papier A4" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Catégorie</label>
              <Select value={form.categorie} onValueChange={(v) => setForm({ ...form, categorie: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Prix (F)</label>
                <Input type="number" value={form.prix_vente} onChange={(e) => setForm({ ...form, prix_vente: e.target.value })} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Stock</label>
                <Input type="number" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Stock min</label>
                <Input type="number" value={form.stock_min} onChange={(e) => setForm({ ...form, stock_min: e.target.value })} />
              </div>
            </div>
            <Button className="w-full" onClick={handleSave}>
              {editItem ? 'Enregistrer' : 'Ajouter le produit'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Stock Movement Dialog */}
      <Dialog open={showMouvement} onOpenChange={setShowMouvement}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {mvtForm.type === 'entree' ? 'Entrée de stock' : 'Sortie de stock'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="font-semibold">{mouvementItem?.nom}</p>
              <p className="text-sm text-muted-foreground">Stock actuel : <span className="font-bold text-foreground">{mouvementItem?.stock}</span></p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Quantité</label>
              <Input
                type="number"
                value={mvtForm.quantite}
                onChange={(e) => setMvtForm({ ...mvtForm, quantite: e.target.value })}
                placeholder="Quantité à ajouter/retirer"
                min="1"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Motif</label>
              <Input
                value={mvtForm.motif}
                onChange={(e) => setMvtForm({ ...mvtForm, motif: e.target.value })}
                placeholder={mvtForm.type === 'entree' ? 'Ex: Réapprovisionnement fournisseur' : 'Ex: Commande client'}
              />
            </div>
            {mvtForm.quantite && Number(mvtForm.quantite) > 0 && (
              <div className="rounded-lg bg-muted/50 p-3 text-center">
                <p className="text-xs text-muted-foreground">Nouveau stock après {mvtForm.type === 'entree' ? 'entrée' : 'sortie'}</p>
                <p className="text-2xl font-bold">
                  {mvtForm.type === 'entree'
                    ? (mouvementItem?.stock || 0) + Number(mvtForm.quantite)
                    : (mouvementItem?.stock || 0) - Number(mvtForm.quantite)
                  }
                </p>
              </div>
            )}
            <Button
              className="w-full"
              variant={mvtForm.type === 'entree' ? 'default' : 'destructive'}
              onClick={handleMouvement}
            >
              {mvtForm.type === 'entree' ? 'Confirmer l\'entrée' : 'Confirmer la sortie'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
