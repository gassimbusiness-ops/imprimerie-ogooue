import { useState, useEffect, useMemo } from 'react';
import { db } from '@/services/db';
import { useAuth } from '@/services/auth';
import { logAction } from '@/services/audit';
import { exportInventairePDF, exportCSV } from '@/services/export-pdf';
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
  Boxes, Search, Plus, Edit2, Trash2, PackagePlus, PackageMinus,
  AlertTriangle, Filter, Eye, EyeOff, ArrowDown, ArrowUp,
  Package, Truck, MapPin, Clock, DollarSign, History, X, Download, FileText,
} from 'lucide-react';
import { toast } from 'sonner';
import { AIButton } from '@/components/ui/ai-button';
import { askAI, AI_PROMPTS } from '@/services/ai';

/* ─── Helpers ─── */
function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)); }

function statusBadge(quantite, quantite_minimum) {
  if (quantite <= 0) return { label: 'Rupture', color: 'bg-red-100 text-red-700 border-red-200' };
  if (quantite <= quantite_minimum) return { label: 'Bas', color: 'bg-amber-100 text-amber-700 border-amber-200' };
  if (quantite <= quantite_minimum * 2) return { label: 'Moyen', color: 'bg-blue-100 text-blue-700 border-blue-200' };
  return { label: 'OK', color: 'bg-emerald-100 text-emerald-700 border-emerald-200' };
}

/* ─── Constants ─── */
const CATEGORIES = [
  'Textile', 'Papeterie', 'Enveloppes', 'Accessoire',
  'Machines & Outils', 'Encres', 'Papiers', 'Vinyles',
  'Transfert thermique', 'DTF', 'Consommables machine', 'Autre',
];

const emptyForm = {
  nom: '', reference: '', categorie: 'Papiers', description: '',
  fournisseur: '', fournisseur_contact: '',
  prix_unitaire: '', unite: 'unité',
  quantite: '', quantite_minimum: '',
  emplacement: '', masque: false, actif: true,
};

const UNITES = ['unité', 'rame', 'paquet', 'rouleau', 'flacon', 'set', 'cartouche', 'pot', 'kg', 'mètre'];

/* ══════════════════════════════════════════════
   Stock Detail Dialog (with movement history)
   ══════════════════════════════════════════════ */
function StockDetail({ article, mouvements, open, onClose, canWrite, onEdit, onDelete, onMouvement }) {
  if (!article) return null;

  const articleMvts = mouvements
    .filter((m) => m.produit_id === article.id)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 20);

  const st = statusBadge(article.quantite, article.quantite_minimum);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Boxes className="h-5 w-5" />
            {article.nom}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Status + Quantity */}
          <div className="flex items-center gap-3">
            <div className="text-center">
              <p className="text-3xl font-black">{article.quantite}</p>
              <p className="text-xs text-muted-foreground">{article.unite}</p>
            </div>
            <Badge className={`${st.color} border text-xs`}>{st.label}</Badge>
            {article.reference && <span className="text-xs text-muted-foreground">Réf: {article.reference}</span>}
            {article.masque && <Badge variant="outline" className="text-[10px]"><EyeOff className="h-3 w-3 mr-1" />Masqué</Badge>}
          </div>

          {/* Info grid */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-muted-foreground" />
              <span>{article.categorie}</span>
            </div>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
              <span>Seuil: {article.quantite_minimum} {article.unite}</span>
            </div>
            {article.fournisseur && (
              <div className="flex items-center gap-2">
                <Truck className="h-4 w-4 text-muted-foreground" />
                <span>{article.fournisseur}</span>
              </div>
            )}
            {article.emplacement && (
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <span>{article.emplacement}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <span>{fmt(article.prix_unitaire)} F / {article.unite}</span>
            </div>
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <span>Valeur: {fmt(article.prix_unitaire * article.quantite)} F</span>
            </div>
          </div>

          {article.description && (
            <p className="text-sm text-muted-foreground">{article.description}</p>
          )}

          {/* Quick actions */}
          {canWrite && (
            <div className="flex gap-2">
              <Button size="sm" className="flex-1 gap-1" variant="outline" onClick={() => { onClose(); onMouvement(article, 'entree'); }}>
                <PackagePlus className="h-3.5 w-3.5 text-emerald-600" /> Entrée
              </Button>
              <Button size="sm" className="flex-1 gap-1" variant="outline" onClick={() => { onClose(); onMouvement(article, 'sortie'); }}>
                <PackageMinus className="h-3.5 w-3.5 text-red-500" /> Sortie
              </Button>
              <Button size="sm" variant="outline" onClick={() => { onClose(); onEdit(article); }}>
                <Edit2 className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="destructive" onClick={() => { onClose(); onDelete(article); }}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          {/* AI suggestions */}
          {canWrite && (
            <AIButton actions={[
              {
                label: 'Suggérer seuil minimum',
                onClick: async () => {
                  const { system, prompt } = AI_PROMPTS.stocks.seuil(article.nom, article.categorie, article.unite);
                  return askAI(system, prompt);
                }
              },
              {
                label: 'Message fournisseur',
                onClick: async () => {
                  const { system, prompt } = AI_PROMPTS.stocks.messageFournisseur(
                    article.nom, article.fournisseur || '', article.quantite_minimum || 10, article.unite || 'unité'
                  );
                  return askAI(system, prompt);
                }
              }
            ]} />
          )}

          {/* Movement history */}
          <div>
            <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
              <History className="h-4 w-4" /> Historique des mouvements
            </h4>
            {articleMvts.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">Aucun mouvement enregistré</p>
            ) : (
              <div className="space-y-1.5 max-h-60 overflow-y-auto">
                {articleMvts.map((m, i) => (
                  <div key={m.id || i} className="flex items-center gap-2 text-xs rounded-lg border p-2">
                    {m.type === 'entree' ? (
                      <ArrowDown className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                    ) : (
                      <ArrowUp className="h-3.5 w-3.5 text-red-500 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <span className={`font-semibold ${m.type === 'entree' ? 'text-emerald-600' : 'text-red-500'}`}>
                        {m.type === 'entree' ? '+' : '-'}{m.quantite}
                      </span>
                      <span className="text-muted-foreground ml-1.5">{m.motif || '—'}</span>
                    </div>
                    <div className="text-right shrink-0 text-muted-foreground">
                      <p>{m.stock_avant} → {m.stock_apres}</p>
                      <p>{new Date(m.date).toLocaleDateString('fr-FR')}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ══════════════════════════════════════════════
   MAIN STOCKS PAGE
   ══════════════════════════════════════════════ */
export default function Stocks() {
  const { hasPermission, user } = useAuth();
  const canWrite = hasPermission('stocks', 'write');
  const [produits, setProduits] = useState([]);
  const [mouvements, setMouvements] = useState([]);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [showHidden, setShowHidden] = useState(false);
  const [loading, setLoading] = useState(true);

  // Dialogs
  const [showForm, setShowForm] = useState(false);
  const [showMouvement, setShowMouvement] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [mouvementItem, setMouvementItem] = useState(null);
  const [detailArticle, setDetailArticle] = useState(null);
  const [showDetail, setShowDetail] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [mvtForm, setMvtForm] = useState({ type: 'entree', quantite: '', motif: '' });

  const load = async () => {
    const [p, m] = await Promise.all([
      db.produits.list(),
      db.mouvements_stock.list(),
    ]);
    setProduits(p);
    setMouvements(m);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    return produits
      .filter((p) => {
        // Hide masked items unless toggled
        if (!showHidden && p.masque) return false;
        if (filterCat !== 'all' && p.categorie !== filterCat) return false;
        if (filterStatus !== 'all') {
          const st = statusBadge(p.quantite ?? p.stock ?? 0, p.quantite_minimum ?? p.stock_min ?? 0);
          if (filterStatus === 'alerte' && st.label !== 'Bas' && st.label !== 'Rupture') return false;
          if (filterStatus === 'ok' && (st.label === 'Bas' || st.label === 'Rupture')) return false;
        }
        if (search) {
          const q = search.toLowerCase();
          return `${p.nom} ${p.categorie || ''} ${p.reference || ''} ${p.fournisseur || ''}`.toLowerCase().includes(q);
        }
        return true;
      });
  }, [produits, search, filterCat, filterStatus, showHidden]);

  const stats = useMemo(() => {
    const total = produits.filter((p) => !p.masque).length;
    const alertes = produits.filter((p) => {
      const qty = p.quantite ?? p.stock ?? 0;
      const min = p.quantite_minimum ?? p.stock_min ?? 0;
      return qty <= min && !p.masque;
    }).length;
    const rupture = produits.filter((p) => {
      const qty = p.quantite ?? p.stock ?? 0;
      return qty <= 0 && !p.masque;
    }).length;
    const totalValue = produits.reduce((s, p) => {
      // Use pre-calculated valeur_stock_achat if available (imported data), else compute
      if (p.valeur_stock_achat) return s + p.valeur_stock_achat;
      const qty = p.quantite ?? p.stock ?? 0;
      const prix = p.prix_unitaire ?? p.prix_vente ?? 0;
      return s + prix * qty;
    }, 0);
    return { total, alertes, rupture, totalValue };
  }, [produits]);

  // CRUD
  const openAdd = () => { setEditItem(null); setForm(emptyForm); setShowForm(true); };
  const openEdit = (p) => {
    setEditItem(p);
    setForm({
      nom: p.nom || '',
      reference: p.reference || '',
      categorie: p.categorie || 'Papiers',
      description: p.description || '',
      fournisseur: p.fournisseur || '',
      fournisseur_contact: p.fournisseur_contact || '',
      prix_unitaire: p.prix_unitaire ?? p.prix_vente ?? '',
      unite: p.unite || 'unité',
      quantite: p.quantite ?? p.stock ?? '',
      quantite_minimum: p.quantite_minimum ?? p.stock_min ?? '',
      emplacement: p.emplacement || '',
      masque: p.masque || false,
      actif: p.actif !== false,
    });
    setShowForm(true);
  };
  const openDetail = (p) => { setDetailArticle(p); setShowDetail(true); };
  const openMouvement = (p, type) => {
    setMouvementItem(p);
    setMvtForm({ type, quantite: '', motif: '' });
    setShowMouvement(true);
  };

  const handleSave = async () => {
    if (!form.nom.trim()) { toast.error('Le nom est requis'); return; }
    const data = {
      nom: form.nom.trim(),
      reference: form.reference.trim() || null,
      categorie: form.categorie,
      description: form.description.trim(),
      fournisseur: form.fournisseur.trim(),
      fournisseur_contact: form.fournisseur_contact.trim(),
      prix_unitaire: Number(form.prix_unitaire) || 0,
      unite: form.unite || 'unité',
      quantite: Number(form.quantite) || 0,
      quantite_minimum: Number(form.quantite_minimum) || 0,
      emplacement: form.emplacement.trim(),
      masque: form.masque,
      actif: form.actif,
    };
    try {
      if (editItem) {
        await db.produits.update(editItem.id, data);
        await logAction('update', 'stock', { entityId: editItem.id, entityLabel: data.nom });
        toast.success('Article modifié');
      } else {
        const created = await db.produits.create(data);
        await logAction('create', 'stock', { entityId: created.id, entityLabel: data.nom });
        toast.success('Article ajouté au stock');
      }
      setShowForm(false);
      load();
    } catch {
      toast.error('Erreur lors de la sauvegarde');
    }
  };

  const handleDelete = async (p) => {
    if (!confirm(`Supprimer "${p.nom}" du stock ?`)) return;
    try {
      await db.produits.delete(p.id);
      await logAction('delete', 'stock', { entityId: p.id, entityLabel: p.nom });
      toast.success('Article supprimé');
      load();
    } catch {
      toast.error('Erreur lors de la suppression');
    }
  };

  const toggleMasque = async (p) => {
    const newMasque = !p.masque;
    await db.produits.update(p.id, { masque: newMasque });
    toast.success(newMasque ? 'Article masqué' : 'Article visible');
    load();
  };

  const handleMouvement = async () => {
    const qty = Number(mvtForm.quantite);
    if (!qty || qty <= 0) { toast.error('Quantité invalide'); return; }

    const currentStock = mouvementItem.quantite ?? mouvementItem.stock ?? 0;
    const newStock = mvtForm.type === 'entree' ? currentStock + qty : currentStock - qty;

    if (newStock < 0) { toast.error('Stock insuffisant'); return; }

    await db.produits.update(mouvementItem.id, { quantite: newStock, stock: newStock });

    await db.mouvements_stock.create({
      produit_id: mouvementItem.id,
      produit_nom: mouvementItem.nom,
      type: mvtForm.type,
      quantite: qty,
      stock_avant: currentStock,
      stock_apres: newStock,
      motif: mvtForm.motif || (mvtForm.type === 'entree' ? 'Réapprovisionnement' : 'Utilisation'),
      operateur: user ? `${user.prenom} ${user.nom}` : '',
      date: new Date().toISOString(),
    });

    await logAction(mvtForm.type === 'entree' ? 'stock_entree' : 'stock_sortie', 'stock', {
      entityId: mouvementItem.id,
      entityLabel: `${mouvementItem.nom} (${mvtForm.type === 'entree' ? '+' : '-'}${qty})`,
    });

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
          <h2 className="text-2xl font-bold tracking-tight">Stocks Consommables</h2>
          <p className="text-muted-foreground">Gestion des matières premières et consommables</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => exportInventairePDF(filtered, { titre: filterStatus === 'alerte' ? 'Stock — Articles en alerte' : 'Inventaire Stock Complet', filtre: filterCat !== 'all' ? filterCat : '' })}>
            <Download className="h-3.5 w-3.5" /> PDF
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => exportCSV(filtered, [
            { label: 'Nom', accessor: 'nom' },
            { label: 'Référence', accessor: 'reference' },
            { label: 'Catégorie', accessor: 'categorie' },
            { label: 'Quantité', accessor: (r) => r.quantite ?? r.stock ?? 0 },
            { label: 'Minimum', accessor: (r) => r.quantite_minimum ?? r.stock_min ?? 0 },
            { label: 'Unité', accessor: 'unite' },
            { label: 'Prix unitaire', accessor: 'prix_unitaire' },
            { label: 'Fournisseur', accessor: 'fournisseur' },
            { label: 'Emplacement', accessor: 'emplacement' },
          ], 'stock_inventaire.csv')}>
            <FileText className="h-3.5 w-3.5" /> CSV
          </Button>
          {canWrite && (
            <Button className="gap-2" onClick={openAdd}>
              <Plus className="h-4 w-4" /> Nouvel article
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Articles', value: stats.total, icon: Boxes, color: 'bg-primary/10 text-primary' },
          { label: 'Alertes stock', value: stats.alertes, icon: AlertTriangle, color: stats.alertes > 0 ? 'bg-amber-500/10 text-amber-600' : 'bg-emerald-500/10 text-emerald-600' },
          { label: 'En rupture', value: stats.rupture, icon: PackageMinus, color: stats.rupture > 0 ? 'bg-red-500/10 text-red-600' : 'bg-emerald-500/10 text-emerald-600' },
          // Masquer la valeur totale pour les employés (donnée financière sensible)
          ...(user?.role !== 'employe' ? [{ label: 'Valeur totale', value: `${fmt(stats.totalValue)} F`, icon: DollarSign, color: 'bg-blue-500/10 text-blue-600', isText: true }] : []),
        ].map(({ label, value, icon: Icon, color, isText }) => (
          <Card key={label}>
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}><Icon className="h-4 w-4" /></div>
                <div>
                  <p className="text-[10px] text-muted-foreground">{label}</p>
                  <p className={`${isText ? 'text-sm' : 'text-base'} font-bold`}>{value}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search + Filters */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Rechercher un article, référence, fournisseur..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={filterCat} onValueChange={setFilterCat}>
          <SelectTrigger className="w-full sm:w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes catégories</SelectItem>
            {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-full sm:w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous statuts</SelectItem>
            <SelectItem value="alerte">Alertes / Rupture</SelectItem>
            <SelectItem value="ok">Stock OK</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Toggle hidden */}
      {canWrite && produits.some((p) => p.masque) && (
        <button
          onClick={() => setShowHidden(!showHidden)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {showHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          {showHidden ? 'Masquer les articles cachés' : `Afficher ${produits.filter((p) => p.masque).length} article(s) masqué(s)`}
        </button>
      )}

      {/* Stock Table */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Boxes className="mb-3 h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">Aucun article trouvé</p>
            {canWrite && (
              <Button variant="outline" className="mt-4 gap-2" onClick={openAdd}>
                <Plus className="h-4 w-4" /> Ajouter un article
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Mobile: card layout */}
          <div className="grid gap-3 sm:grid-cols-2 lg:hidden">
            {filtered.map((p) => {
              const qty = p.quantite ?? p.stock ?? 0;
              const min = p.quantite_minimum ?? p.stock_min ?? 0;
              const st = statusBadge(qty, min);
              return (
                <Card
                  key={p.id}
                  className={`cursor-pointer transition-all hover:shadow-md ${p.masque ? 'opacity-60' : ''} ${qty <= min ? 'border-amber-300' : ''}`}
                  onClick={() => openDetail(p)}
                >
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm truncate">{p.nom}</p>
                        <div className="flex items-center gap-1.5 mt-1">
                          <Badge variant="outline" className="text-[10px]">{p.categorie}</Badge>
                          {p.reference && <span className="text-[10px] text-muted-foreground">{p.reference}</span>}
                          {p.masque && <EyeOff className="h-3 w-3 text-muted-foreground" />}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-bold">{qty}</p>
                        <Badge className={`${st.color} border text-[9px]`}>{st.label}</Badge>
                      </div>
                    </div>
                    {p.fournisseur && (
                      <p className="mt-1.5 text-[10px] text-muted-foreground flex items-center gap-1">
                        <Truck className="h-3 w-3" /> {p.fournisseur}
                      </p>
                    )}
                    {canWrite && (
                      <div className="mt-2 flex gap-1.5">
                        <Button variant="outline" size="sm" className="flex-1 gap-1 text-xs h-7" onClick={(e) => { e.stopPropagation(); openMouvement(p, 'entree'); }}>
                          <PackagePlus className="h-3 w-3 text-emerald-600" /> Entrée
                        </Button>
                        <Button variant="outline" size="sm" className="flex-1 gap-1 text-xs h-7" onClick={(e) => { e.stopPropagation(); openMouvement(p, 'sortie'); }}>
                          <PackageMinus className="h-3 w-3 text-red-500" /> Sortie
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Desktop: table layout */}
          <Card className="hidden lg:block overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Article</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Catégorie</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Fournisseur</th>
                    <th className="px-4 py-2.5 text-center font-medium text-muted-foreground">Stock</th>
                    <th className="px-4 py-2.5 text-center font-medium text-muted-foreground">Min</th>
                    <th className="px-4 py-2.5 text-center font-medium text-muted-foreground">Statut</th>
                    <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Valeur</th>
                    {canWrite && <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => {
                    const qty = p.quantite ?? p.stock ?? 0;
                    const min = p.quantite_minimum ?? p.stock_min ?? 0;
                    const prix = p.prix_unitaire ?? p.prix_vente ?? 0;
                    const st = statusBadge(qty, min);
                    return (
                      <tr
                        key={p.id}
                        className={`border-b hover:bg-muted/30 cursor-pointer transition-colors ${p.masque ? 'opacity-50' : ''}`}
                        onClick={() => openDetail(p)}
                      >
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <div>
                              <p className="font-medium">{p.nom}</p>
                              {p.reference && <p className="text-[10px] text-muted-foreground">{p.reference}</p>}
                            </div>
                            {p.masque && <EyeOff className="h-3 w-3 text-muted-foreground shrink-0" />}
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge variant="outline" className="text-[10px]">{p.categorie}</Badge>
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground text-xs">{p.fournisseur || '—'}</td>
                        <td className="px-4 py-2.5 text-center font-bold">{qty} <span className="text-xs font-normal text-muted-foreground">{p.unite}</span></td>
                        <td className="px-4 py-2.5 text-center text-muted-foreground">{min}</td>
                        <td className="px-4 py-2.5 text-center">
                          <Badge className={`${st.color} border text-[10px]`}>{st.label}</Badge>
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs">{fmt(prix * qty)} F</td>
                        {canWrite && (
                          <td className="px-4 py-2.5 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={(e) => { e.stopPropagation(); openMouvement(p, 'entree'); }}
                                className="rounded p-1 hover:bg-emerald-50"
                                title="Entrée"
                              >
                                <PackagePlus className="h-3.5 w-3.5 text-emerald-600" />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); openMouvement(p, 'sortie'); }}
                                className="rounded p-1 hover:bg-red-50"
                                title="Sortie"
                              >
                                <PackageMinus className="h-3.5 w-3.5 text-red-500" />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); toggleMasque(p); }}
                                className="rounded p-1 hover:bg-muted"
                                title={p.masque ? 'Rendre visible' : 'Masquer'}
                              >
                                {p.masque ? <Eye className="h-3.5 w-3.5 text-muted-foreground" /> : <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />}
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); openEdit(p); }}
                                className="rounded p-1 hover:bg-muted"
                                title="Modifier"
                              >
                                <Edit2 className="h-3.5 w-3.5 text-muted-foreground" />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDelete(p); }}
                                className="rounded p-1 hover:bg-red-50"
                                title="Supprimer"
                              >
                                <Trash2 className="h-3.5 w-3.5 text-red-500" />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {/* Article Detail Dialog */}
      <StockDetail
        article={detailArticle}
        mouvements={mouvements}
        open={showDetail}
        onClose={() => setShowDetail(false)}
        canWrite={canWrite}
        onEdit={openEdit}
        onDelete={handleDelete}
        onMouvement={openMouvement}
      />

      {/* Add/Edit Form Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editItem ? 'Modifier l\'article' : 'Nouvel article de stock'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Nom de l'article *</label>
              <Input value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} placeholder="Ex: Rame papier A4 80g" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Catégorie *</label>
                <Select value={form.categorie} onValueChange={(v) => setForm({ ...form, categorie: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Référence</label>
                <Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="PAP-001" />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Description</label>
              <textarea
                className="flex min-h-[50px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Description de l'article..."
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Fournisseur</label>
                <Input value={form.fournisseur} onChange={(e) => setForm({ ...form, fournisseur: e.target.value })} placeholder="Nom du fournisseur" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Contact fournisseur</label>
                <Input value={form.fournisseur_contact} onChange={(e) => setForm({ ...form, fournisseur_contact: e.target.value })} placeholder="Téléphone / email" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Prix unitaire (F)</label>
                <Input type="number" value={form.prix_unitaire} onChange={(e) => setForm({ ...form, prix_unitaire: e.target.value })} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Quantité</label>
                <Input type="number" value={form.quantite} onChange={(e) => setForm({ ...form, quantite: e.target.value })} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Seuil min</label>
                <Input type="number" value={form.quantite_minimum} onChange={(e) => setForm({ ...form, quantite_minimum: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Unité</label>
                <Select value={form.unite} onValueChange={(v) => setForm({ ...form, unite: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{UNITES.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Emplacement</label>
                <Input value={form.emplacement} onChange={(e) => setForm({ ...form, emplacement: e.target.value })} placeholder="Ex: Étagère A1" />
              </div>
            </div>
            <div className="flex items-center gap-4">
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" checked={form.masque} onChange={(e) => setForm({ ...form, masque: e.target.checked })} className="sr-only peer" />
                <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-amber-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all" />
                <span className="ml-2 text-sm">Masquer (rupture)</span>
              </label>
            </div>
            <Button className="w-full" onClick={handleSave}>
              {editItem ? 'Enregistrer' : 'Ajouter l\'article'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Stock Movement Dialog */}
      <Dialog open={showMouvement} onOpenChange={setShowMouvement}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {mvtForm.type === 'entree' ? (
                <><PackagePlus className="h-5 w-5 text-emerald-600" /> Entrée de stock</>
              ) : (
                <><PackageMinus className="h-5 w-5 text-red-500" /> Sortie de stock</>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="font-semibold">{mouvementItem?.nom}</p>
              <p className="text-sm text-muted-foreground">
                Stock actuel : <span className="font-bold text-foreground">{mouvementItem?.quantite ?? mouvementItem?.stock ?? 0}</span> {mouvementItem?.unite}
              </p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Quantité *</label>
              <Input
                type="number" min="1"
                value={mvtForm.quantite}
                onChange={(e) => setMvtForm({ ...mvtForm, quantite: e.target.value })}
                placeholder="Quantité à ajouter/retirer"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Motif</label>
              <Input
                value={mvtForm.motif}
                onChange={(e) => setMvtForm({ ...mvtForm, motif: e.target.value })}
                placeholder={mvtForm.type === 'entree' ? 'Ex: Réapprovisionnement' : 'Ex: Commande client'}
              />
            </div>
            {mvtForm.quantite && Number(mvtForm.quantite) > 0 && (
              <div className="rounded-lg bg-muted/50 p-3 text-center">
                <p className="text-xs text-muted-foreground">Nouveau stock après {mvtForm.type === 'entree' ? 'entrée' : 'sortie'}</p>
                <p className={`text-2xl font-bold ${mvtForm.type === 'entree' ? 'text-emerald-600' : 'text-red-500'}`}>
                  {mvtForm.type === 'entree'
                    ? (mouvementItem?.quantite ?? mouvementItem?.stock ?? 0) + Number(mvtForm.quantite)
                    : (mouvementItem?.quantite ?? mouvementItem?.stock ?? 0) - Number(mvtForm.quantite)
                  } {mouvementItem?.unite}
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
