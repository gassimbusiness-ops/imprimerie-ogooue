import { useState, useEffect, useMemo } from 'react';
import { db } from '@/services/db';
import { useAuth } from '@/services/auth';
import { logAction } from '@/services/audit';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  BookOpen, Search, Plus, Edit2, Trash2, Tag, DollarSign,
  Package, Clock, Image, LayoutGrid, List, AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';

function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)); }

import {
  Shirt, Printer as PrinterIcon, Camera, FileText as DocIcon, Scissors as ScissorsIcon,
} from 'lucide-react';

const CATEGORIES = [
  'Photocopie', 'Impression', 'Photo identité', 'Reliure', 'Numérisation',
  'Textile', 'Papeterie', 'Accessoire', 'Machine', 'Signalétique', 'Marketing', 'Calendrier', 'EPI', 'Autre',
];

const CAT_GRADIENT = {
  Textile: 'from-blue-500 to-blue-600', Papeterie: 'from-amber-500 to-orange-500',
  Impression: 'from-violet-500 to-purple-600', Reliure: 'from-emerald-500 to-green-600',
  Accessoire: 'from-pink-500 to-rose-600', Machine: 'from-gray-500 to-gray-700',
  'Photo identité': 'from-cyan-500 to-teal-600', Photocopie: 'from-indigo-400 to-indigo-600',
  Numérisation: 'from-sky-400 to-sky-600', Signalétique: 'from-red-500 to-red-600',
  Marketing: 'from-fuchsia-500 to-fuchsia-600', Calendrier: 'from-teal-500 to-teal-600',
  EPI: 'from-yellow-500 to-yellow-600', Autre: 'from-slate-400 to-slate-600',
};
const CAT_ICON = {
  Textile: Shirt, Impression: PrinterIcon, 'Photo identité': Camera, Papeterie: DocIcon,
  Reliure: BookOpen, Accessoire: Tag, Machine: Package, Signalétique: LayoutGrid,
  Numérisation: Image, Marketing: Tag, Calendrier: Clock, EPI: Package,
};

const emptyForm = {
  nom: '', categorie: 'Impression', description: '', prix_unitaire: '',
  unite: 'pièce', delai_jours: '', stock_actuel: '', stock_minimum: '', actif: true,
};

export default function Catalogue() {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('stocks', 'write');
  const [produits, setProduits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('all');
  const [viewMode, setViewMode] = useState('grid');
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState(emptyForm);

  const load = async () => {
    const data = await db.produits_catalogue.list();
    setProduits(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    return produits.filter((p) => {
      if (filterCat !== 'all' && p.categorie !== filterCat) return false;
      if (search) {
        const q = search.toLowerCase();
        return `${p.nom} ${p.categorie} ${p.description}`.toLowerCase().includes(q);
      }
      return true;
    });
  }, [produits, search, filterCat]);

  const stats = useMemo(() => ({
    total: produits.length,
    actifs: produits.filter((p) => p.actif !== false).length,
    categories: new Set(produits.map((p) => p.categorie)).size,
    alertes: produits.filter((p) => p.stock_actuel != null && p.stock_minimum != null && p.stock_actuel <= p.stock_minimum).length,
  }), [produits]);

  const openAdd = () => { setEditItem(null); setForm(emptyForm); setShowForm(true); };

  const openEdit = (p) => {
    setEditItem(p);
    setForm({
      nom: p.nom || '', categorie: p.categorie || 'Impression', description: p.description || '',
      prix_unitaire: p.prix_unitaire || '', unite: p.unite || 'pièce',
      delai_jours: p.delai_jours || '', stock_actuel: p.stock_actuel ?? '',
      stock_minimum: p.stock_minimum ?? '', actif: p.actif !== false,
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.nom.trim()) { toast.error('Le nom est requis'); return; }
    const data = {
      ...form, nom: form.nom.trim(), description: form.description.trim(),
      prix_unitaire: Number(form.prix_unitaire) || 0,
      delai_jours: Number(form.delai_jours) || 0,
      stock_actuel: form.stock_actuel !== '' ? Number(form.stock_actuel) : null,
      stock_minimum: form.stock_minimum !== '' ? Number(form.stock_minimum) : null,
    };
    if (editItem) {
      await db.produits_catalogue.update(editItem.id, data);
      await logAction('update', 'catalogue', { entityId: editItem.id, entityLabel: data.nom });
      toast.success('Produit modifié');
    } else {
      const created = await db.produits_catalogue.create(data);
      await logAction('create', 'catalogue', { entityId: created.id, entityLabel: data.nom });
      toast.success('Produit ajouté');
    }
    setShowForm(false);
    load();
  };

  const handleDelete = async (p) => {
    if (!confirm(`Supprimer "${p.nom}" ?`)) return;
    await db.produits_catalogue.delete(p.id);
    await logAction('delete', 'catalogue', { entityId: p.id, entityLabel: p.nom });
    toast.success('Produit supprimé');
    load();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Catalogue Produits</h2>
          <p className="text-muted-foreground">{stats.total} produits — {stats.categories} catégories{stats.alertes > 0 ? ` — ${stats.alertes} alertes stock` : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border p-0.5">
            <button onClick={() => setViewMode('grid')} className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === 'grid' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button onClick={() => setViewMode('list')} className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
              <List className="h-4 w-4" />
            </button>
          </div>
          {canWrite && <Button className="gap-2" onClick={openAdd}><Plus className="h-4 w-4" /> Nouveau produit</Button>}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Produits', value: stats.total, icon: BookOpen, color: 'bg-primary/10 text-primary' },
          { label: 'Actifs', value: stats.actifs, icon: Package, color: 'bg-emerald-500/10 text-emerald-600' },
          { label: 'Catégories', value: stats.categories, icon: Tag, color: 'bg-blue-500/10 text-blue-600' },
          { label: 'Alertes stock', value: stats.alertes, icon: AlertTriangle, color: 'bg-red-500/10 text-red-600' },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}><CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}><Icon className="h-4 w-4" /></div>
              <div><p className="text-[10px] text-muted-foreground">{label}</p><p className="text-base font-bold">{value}</p></div>
            </div>
          </CardContent></Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Rechercher un produit..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={filterCat} onValueChange={setFilterCat}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes catégories</SelectItem>
            {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Category chips */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        <button onClick={() => setFilterCat('all')} className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${filterCat === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}>
          Tout ({produits.length})
        </button>
        {[...new Set(produits.map((p) => p.categorie).filter(Boolean))].map((c) => {
          const count = produits.filter((p) => p.categorie === c).length;
          return (
            <button key={c} onClick={() => setFilterCat(c)} className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${filterCat === c ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}>
              {c} ({count})
            </button>
          );
        })}
      </div>

      {/* Grid */}
      {viewMode === 'grid' ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((p) => {
            const lowStock = p.stock_actuel != null && p.stock_minimum != null && p.stock_actuel <= p.stock_minimum;
            const gradient = CAT_GRADIENT[p.categorie] || 'from-slate-400 to-slate-600';
            const CatIcon = CAT_ICON[p.categorie] || Package;
            return (
              <Card key={p.id} className={`overflow-hidden cursor-pointer group transition-all duration-200 hover:shadow-lg ${lowStock ? 'ring-1 ring-orange-300' : ''}`}
                onClick={() => canWrite ? openEdit(p) : null}>
                {/* Gradient header with icon */}
                <div className={`relative h-28 bg-gradient-to-br ${gradient} flex items-center justify-center`}>
                  <CatIcon className="h-12 w-12 text-white/30 group-hover:scale-110 transition-transform duration-200" />
                  {!p.actif && (
                    <Badge className="absolute top-2 left-2 bg-black/50 text-white text-[9px]">Inactif</Badge>
                  )}
                  {lowStock && (
                    <Badge className="absolute top-2 right-2 bg-red-500 text-white text-[9px]">
                      <AlertTriangle className="h-3 w-3 mr-0.5" />Stock bas
                    </Badge>
                  )}
                  {canWrite && (
                    <div className="absolute bottom-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={(e) => { e.stopPropagation(); openEdit(p); }} className="rounded-full bg-white/20 p-1.5 text-white hover:bg-white/40 backdrop-blur-sm">
                        <Edit2 className="h-3 w-3" />
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); handleDelete(p); }} className="rounded-full bg-white/20 p-1.5 text-white hover:bg-red-500/80 backdrop-blur-sm">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
                <CardContent className="p-3">
                  <h3 className="font-semibold text-sm leading-tight line-clamp-2 min-h-[2.5rem]">{p.nom}</h3>
                  <div className="flex items-center gap-1.5 mt-1">
                    <Badge variant="outline" className="text-[10px]">{p.categorie}</Badge>
                    {p.stock_actuel != null && (
                      <span className={`text-[10px] ${lowStock ? 'text-orange-600 font-semibold' : 'text-muted-foreground'}`}>
                        Stock: {p.stock_actuel}
                      </span>
                    )}
                  </div>
                  {p.description && <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">{p.description}</p>}
                  <div className="mt-2.5 flex items-center justify-between border-t pt-2.5">
                    <span className="text-lg font-black text-primary">{fmt(p.prix_unitaire)} <span className="text-xs font-normal">F</span></span>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      {p.delai_jours > 0 && <span className="flex items-center gap-0.5"><Clock className="h-3 w-3" />{p.delai_jours}j</span>}
                      <span>/{p.unite}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y">
              {filtered.map((p) => {
                const lowStock = p.stock_actuel != null && p.stock_minimum != null && p.stock_actuel <= p.stock_minimum;
                const gradient = CAT_GRADIENT[p.categorie] || 'from-slate-400 to-slate-600';
                const CatIcon = CAT_ICON[p.categorie] || Package;
                return (
                  <div key={p.id} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/50 cursor-pointer group" onClick={() => canWrite ? openEdit(p) : null}>
                    <div className={`flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br ${gradient} shrink-0`}>
                      <CatIcon className="h-4 w-4 text-white/80" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm truncate">{p.nom}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="outline" className="text-[10px]">{p.categorie}</Badge>
                        {lowStock && <Badge className="text-[10px] bg-orange-500 text-white">Stock bas</Badge>}
                        {p.stock_actuel != null && !lowStock && <span className="text-[10px] text-muted-foreground">Stock: {p.stock_actuel}</span>}
                      </div>
                    </div>
                    <span className="text-sm font-bold text-primary shrink-0">{fmt(p.prix_unitaire)} F</span>
                    {canWrite && (
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button onClick={(e) => { e.stopPropagation(); openEdit(p); }} className="rounded p-1 hover:bg-muted"><Edit2 className="h-3.5 w-3.5 text-muted-foreground" /></button>
                        <button onClick={(e) => { e.stopPropagation(); handleDelete(p); }} className="rounded p-1 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5 text-red-500" /></button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16">
          <BookOpen className="mb-4 h-12 w-12 text-muted-foreground/30" />
          <p className="text-muted-foreground">Aucun produit trouvé</p>
        </div>
      )}

      {/* Form Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editItem ? 'Modifier le produit' : 'Nouveau produit'}</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Nom du produit *</label>
              <Input value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} placeholder="Ex: Photocopie A4 N&B" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Catégorie</label>
                <Select value={form.categorie} onValueChange={(v) => setForm({ ...form, categorie: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Unité</label>
                <Select value={form.unite} onValueChange={(v) => setForm({ ...form, unite: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['pièce', 'page', 'lot', 'mètre', 'kg', 'unité'].map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Description</label>
              <textarea className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Description du produit..." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Prix unitaire (F CFA)</label>
                <Input type="number" value={form.prix_unitaire} onChange={(e) => setForm({ ...form, prix_unitaire: e.target.value })} placeholder="0" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Délai (jours)</label>
                <Input type="number" value={form.delai_jours} onChange={(e) => setForm({ ...form, delai_jours: e.target.value })} placeholder="0" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Stock actuel</label>
                <Input type="number" value={form.stock_actuel} onChange={(e) => setForm({ ...form, stock_actuel: e.target.value })} placeholder="—" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Stock minimum</label>
                <Input type="number" value={form.stock_minimum} onChange={(e) => setForm({ ...form, stock_minimum: e.target.value })} placeholder="—" />
              </div>
            </div>
            <div className="flex gap-3">
              <Button className="flex-1" onClick={handleSave}>{editItem ? 'Enregistrer' : 'Ajouter'}</Button>
              {editItem && (
                <Button variant="destructive" onClick={() => { handleDelete(editItem); setShowForm(false); }}><Trash2 className="h-4 w-4" /></Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
