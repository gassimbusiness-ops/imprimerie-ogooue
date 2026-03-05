import { useState, useEffect, useMemo } from 'react';
import { db } from '@/services/db';
import { logAction } from '@/services/audit';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tag, Plus, Edit2, Trash2, Search, User, Percent, DollarSign } from 'lucide-react';
import { toast } from 'sonner';

function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)); }

export default function TarifsClients() {
  const [tarifs, setTarifs] = useState([]);
  const [clients, setClients] = useState([]);
  const [produits, setProduits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterClient, setFilterClient] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({ client_id: '', produit_id: '', prix_special: '', remise_pct: '', prix_minimum: '' });

  const load = async () => {
    const [t, c, p] = await Promise.all([db.tarifs_clients.list(), db.clients.list(), db.produits_catalogue.list()]);
    setTarifs(t); setClients(c); setProduits(p);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const getClientName = (id) => clients.find((c) => c.id === id)?.nom || '—';
  const getProduitName = (id) => produits.find((p) => p.id === id)?.nom || '—';
  const getProduitPrix = (id) => produits.find((p) => p.id === id)?.prix_unitaire || 0;

  const filtered = useMemo(() => {
    return tarifs.filter((t) => {
      if (filterClient !== 'all' && t.client_id !== filterClient) return false;
      if (search) {
        const q = search.toLowerCase();
        return `${getClientName(t.client_id)} ${getProduitName(t.produit_id)}`.toLowerCase().includes(q);
      }
      return true;
    });
  }, [tarifs, search, filterClient, clients, produits]);

  const stats = useMemo(() => ({
    total: tarifs.length,
    clients: new Set(tarifs.map((t) => t.client_id)).size,
    produits: new Set(tarifs.map((t) => t.produit_id)).size,
  }), [tarifs]);

  const openAdd = () => { setEditItem(null); setForm({ client_id: '', produit_id: '', prix_special: '', remise_pct: '', prix_minimum: '' }); setShowForm(true); };
  const openEdit = (t) => { setEditItem(t); setForm({ ...t, prix_special: t.prix_special || '', remise_pct: t.remise_pct || '', prix_minimum: t.prix_minimum || '' }); setShowForm(true); };

  const handleSave = async () => {
    if (!form.client_id || !form.produit_id) { toast.error('Client et produit requis'); return; }
    const data = {
      ...form,
      client_nom: getClientName(form.client_id),
      produit_nom: getProduitName(form.produit_id),
      prix_special: Number(form.prix_special) || 0,
      remise_pct: Number(form.remise_pct) || 0,
      prix_minimum: Number(form.prix_minimum) || 0,
    };
    if (editItem) { await db.tarifs_clients.update(editItem.id, data); toast.success('Tarif modifié'); }
    else { await db.tarifs_clients.create(data); toast.success('Tarif ajouté'); }
    setShowForm(false); load();
  };

  const handleDelete = async (t) => {
    if (!confirm('Supprimer ce tarif ?')) return;
    await db.tarifs_clients.delete(t.id); toast.success('Supprimé'); load();
  };

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-2xl font-bold tracking-tight">Tarifs Clients</h2><p className="text-muted-foreground">Prix personnalisés et remises par client</p></div>
        <Button className="gap-2" onClick={openAdd}><Plus className="h-4 w-4" /> Nouveau tarif</Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Tarifs', value: stats.total, icon: Tag, color: 'bg-primary/10 text-primary' },
          { label: 'Clients', value: stats.clients, icon: User, color: 'bg-blue-500/10 text-blue-600' },
          { label: 'Produits', value: stats.produits, icon: DollarSign, color: 'bg-emerald-500/10 text-emerald-600' },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}><CardContent className="p-3"><div className="flex items-center gap-2">
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}><Icon className="h-4 w-4" /></div>
            <div><p className="text-[10px] text-muted-foreground">{label}</p><p className="text-base font-bold">{value}</p></div>
          </div></CardContent></Card>
        ))}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input placeholder="Rechercher..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" /></div>
        <Select value={filterClient} onValueChange={setFilterClient}><SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Tous clients</SelectItem>{clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.nom}</SelectItem>)}</SelectContent></Select>
      </div>

      <Card><CardContent className="p-0">
        <div className="divide-y">
          {filtered.length === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">Aucun tarif personnalisé</p> :
            filtered.map((t) => {
              const prixBase = getProduitPrix(t.produit_id);
              const prixFinal = t.prix_special > 0 ? t.prix_special : (prixBase * (1 - (t.remise_pct || 0) / 100));
              const economie = prixBase > 0 ? ((1 - prixFinal / prixBase) * 100).toFixed(0) : 0;
              return (
                <div key={t.id} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/50">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 shrink-0"><Tag className="h-4 w-4 text-primary" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">{t.client_nom || getClientName(t.client_id)}</p>
                    <p className="text-xs text-muted-foreground">{t.produit_nom || getProduitName(t.produit_id)}</p>
                  </div>
                  <div className="text-right shrink-0">
                    {t.prix_special > 0 && <p className="text-sm font-bold text-primary">{fmt(t.prix_special)} F</p>}
                    {t.remise_pct > 0 && <Badge className="text-[10px] bg-emerald-100 text-emerald-700">-{t.remise_pct}%</Badge>}
                    {prixBase > 0 && <p className="text-[10px] text-muted-foreground line-through">{fmt(prixBase)} F</p>}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => openEdit(t)} className="rounded p-1.5 hover:bg-muted"><Edit2 className="h-3.5 w-3.5 text-muted-foreground" /></button>
                    <button onClick={() => handleDelete(t)} className="rounded p-1.5 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5 text-red-500" /></button>
                  </div>
                </div>
              );
            })}
        </div>
      </CardContent></Card>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle>{editItem ? 'Modifier' : 'Nouveau tarif'}</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div><label className="mb-1.5 block text-sm font-medium">Client *</label><Select value={form.client_id} onValueChange={(v) => setForm({ ...form, client_id: v })}><SelectTrigger><SelectValue placeholder="Choisir..." /></SelectTrigger><SelectContent>{clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.nom}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="mb-1.5 block text-sm font-medium">Produit *</label><Select value={form.produit_id} onValueChange={(v) => setForm({ ...form, produit_id: v })}><SelectTrigger><SelectValue placeholder="Choisir..." /></SelectTrigger><SelectContent>{produits.map((p) => <SelectItem key={p.id} value={p.id}>{p.nom} ({fmt(p.prix_unitaire)} F)</SelectItem>)}</SelectContent></Select></div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="mb-1.5 block text-sm font-medium">Prix fixe (F)</label><Input type="number" value={form.prix_special} onChange={(e) => setForm({ ...form, prix_special: e.target.value })} placeholder="0" /></div>
              <div><label className="mb-1.5 block text-sm font-medium">Remise (%)</label><Input type="number" value={form.remise_pct} onChange={(e) => setForm({ ...form, remise_pct: e.target.value })} placeholder="0" /></div>
              <div><label className="mb-1.5 block text-sm font-medium">Min (F)</label><Input type="number" value={form.prix_minimum} onChange={(e) => setForm({ ...form, prix_minimum: e.target.value })} placeholder="0" /></div>
            </div>
            <Button className="w-full" onClick={handleSave}>{editItem ? 'Enregistrer' : 'Ajouter'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
