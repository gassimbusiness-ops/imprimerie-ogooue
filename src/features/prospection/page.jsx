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
  Target, Search, Plus, Edit2, Trash2, Phone, Mail, Building2,
  MapPin, ArrowRight, UserPlus, TrendingUp, ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';

const STATUTS = {
  nouveau: { label: 'Nouveau', color: 'bg-slate-100 text-slate-700' },
  contacte: { label: 'Contacté', color: 'bg-blue-100 text-blue-700' },
  interesse: { label: 'Intéressé', color: 'bg-amber-100 text-amber-700' },
  negocie: { label: 'En négo', color: 'bg-violet-100 text-violet-700' },
  converti: { label: 'Converti', color: 'bg-emerald-100 text-emerald-700' },
  non_interesse: { label: 'Perdu', color: 'bg-red-100 text-red-700' },
};

const SECTEURS = ['Administration', 'Éducation', 'Santé', 'Commerce', 'Construction', 'Industrie', 'ONG', 'Autre'];

const emptyForm = {
  nom_entreprise: '', contact_nom: '', email: '', telephone: '',
  adresse: '', secteur: 'Commerce', statut: 'nouveau', notes: '',
};

export default function Prospection() {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('clients', 'write');
  const [prospects, setProspects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatut, setFilterStatut] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState(emptyForm);

  const load = async () => {
    const data = await db.prospects.list();
    setProspects(data.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    return prospects.filter((p) => {
      if (filterStatut !== 'all' && p.statut !== filterStatut) return false;
      if (search) {
        const q = search.toLowerCase();
        return `${p.nom_entreprise} ${p.contact_nom} ${p.email} ${p.secteur}`.toLowerCase().includes(q);
      }
      return true;
    });
  }, [prospects, search, filterStatut]);

  const stats = useMemo(() => ({
    total: prospects.length,
    nouveaux: prospects.filter((p) => p.statut === 'nouveau').length,
    en_cours: prospects.filter((p) => ['contacte', 'interesse', 'negocie'].includes(p.statut)).length,
    convertis: prospects.filter((p) => p.statut === 'converti').length,
  }), [prospects]);

  const openAdd = () => { setEditItem(null); setForm(emptyForm); setShowForm(true); };

  const openEdit = (p) => {
    setEditItem(p);
    setForm({
      nom_entreprise: p.nom_entreprise || '', contact_nom: p.contact_nom || '',
      email: p.email || '', telephone: p.telephone || '',
      adresse: p.adresse || '', secteur: p.secteur || 'Commerce',
      statut: p.statut || 'nouveau', notes: p.notes || '',
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.nom_entreprise.trim()) { toast.error('Le nom de l\'entreprise est requis'); return; }
    const data = {
      ...form,
      nom_entreprise: form.nom_entreprise.trim(),
      contact_nom: form.contact_nom.trim(),
      email: form.email.trim(),
      telephone: form.telephone.trim(),
    };
    if (editItem) {
      await db.prospects.update(editItem.id, data);
      await logAction('update', 'prospects', { entityId: editItem.id, entityLabel: data.nom_entreprise });
      toast.success('Prospect modifié');
    } else {
      const created = await db.prospects.create(data);
      await logAction('create', 'prospects', { entityId: created.id, entityLabel: data.nom_entreprise });
      toast.success('Prospect ajouté');
    }
    setShowForm(false);
    load();
  };

  const handleDelete = async (p) => {
    if (!confirm(`Supprimer le prospect "${p.nom_entreprise}" ?`)) return;
    await db.prospects.delete(p.id);
    toast.success('Prospect supprimé');
    load();
  };

  const convertirEnClient = async (p) => {
    if (!confirm(`Convertir "${p.nom_entreprise}" en client ?`)) return;
    await db.clients.create({
      nom: p.nom_entreprise, email: p.email, telephone: p.telephone,
      type: 'entreprise', adresse: p.adresse, notes: `Converti depuis prospection. Contact: ${p.contact_nom}`,
    });
    await db.prospects.update(p.id, { statut: 'converti' });
    await logAction('create', 'clients', { entityLabel: p.nom_entreprise, details: `Conversion prospect → client` });
    toast.success(`"${p.nom_entreprise}" converti en client !`);
    load();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Prospection</h2>
          <p className="text-muted-foreground">{stats.total} prospects — {stats.convertis} convertis</p>
        </div>
        {canWrite && <Button className="gap-2" onClick={openAdd}><Plus className="h-4 w-4" /> Nouveau prospect</Button>}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Total', value: stats.total, icon: Target, color: 'bg-primary/10 text-primary' },
          { label: 'Nouveaux', value: stats.nouveaux, icon: Plus, color: 'bg-slate-500/10 text-slate-600' },
          { label: 'En cours', value: stats.en_cours, icon: TrendingUp, color: 'bg-blue-500/10 text-blue-600' },
          { label: 'Convertis', value: stats.convertis, icon: UserPlus, color: 'bg-emerald-500/10 text-emerald-600' },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}><CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}><Icon className="h-4 w-4" /></div>
              <div><p className="text-[10px] text-muted-foreground">{label}</p><p className="text-base font-bold">{value}</p></div>
            </div>
          </CardContent></Card>
        ))}
      </div>

      {/* Pipeline visualization */}
      <div className="flex gap-1 overflow-x-auto pb-2">
        {Object.entries(STATUTS).map(([key, { label, color }]) => {
          const count = prospects.filter((p) => p.statut === key).length;
          return (
            <div key={key} className="flex-1 min-w-[80px]">
              <div className={`rounded-lg px-3 py-2 text-center ${color}`}>
                <p className="text-lg font-bold">{count}</p>
                <p className="text-[10px] font-medium">{label}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Rechercher un prospect..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={filterStatut} onValueChange={setFilterStatut}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous statuts</SelectItem>
            {Object.entries(STATUTS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((p) => {
          const st = STATUTS[p.statut] || STATUTS.nouveau;
          return (
            <Card key={p.id} className="cursor-pointer transition-shadow hover:shadow-md" onClick={() => canWrite ? openEdit(p) : null}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                      <Building2 className="h-5 w-5 text-blue-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate">{p.nom_entreprise}</p>
                      {p.contact_nom && <p className="text-xs text-muted-foreground">{p.contact_nom}</p>}
                    </div>
                  </div>
                  <Badge variant="outline" className={`text-[10px] shrink-0 ${st.color}`}>{st.label}</Badge>
                </div>
                <div className="mt-3 space-y-1 border-t pt-3">
                  {p.telephone && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Phone className="h-3 w-3" />{p.telephone}</p>}
                  {p.email && <p className="flex items-center gap-1.5 text-xs text-muted-foreground truncate"><Mail className="h-3 w-3" />{p.email}</p>}
                  {p.secteur && <Badge variant="outline" className="text-[10px] mt-1">{p.secteur}</Badge>}
                </div>
                {canWrite && p.statut !== 'converti' && p.statut !== 'non_interesse' && (
                  <div className="mt-3 flex gap-2 border-t pt-3">
                    <Button size="sm" variant="outline" className="flex-1 text-xs gap-1"
                      onClick={(e) => { e.stopPropagation(); convertirEnClient(p); }}>
                      <UserPlus className="h-3 w-3" /> Convertir
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16">
          <Target className="mb-4 h-12 w-12 text-muted-foreground/30" />
          <p className="text-muted-foreground">Aucun prospect trouvé</p>
        </div>
      )}

      {/* Form Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editItem ? 'Modifier le prospect' : 'Nouveau prospect'}</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Nom de l'entreprise *</label>
              <Input value={form.nom_entreprise} onChange={(e) => setForm({ ...form, nom_entreprise: e.target.value })} placeholder="Nom de l'entreprise" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Personne de contact</label>
              <Input value={form.contact_nom} onChange={(e) => setForm({ ...form, contact_nom: e.target.value })} placeholder="Nom et prénom" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Téléphone</label>
                <Input value={form.telephone} onChange={(e) => setForm({ ...form, telephone: e.target.value })} placeholder="+241 0XX XX XX" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Email</label>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="email@exemple.com" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Secteur</label>
                <Select value={form.secteur} onValueChange={(v) => setForm({ ...form, secteur: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SECTEURS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Statut</label>
                <Select value={form.statut} onValueChange={(v) => setForm({ ...form, statut: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(STATUTS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Adresse</label>
              <Input value={form.adresse} onChange={(e) => setForm({ ...form, adresse: e.target.value })} placeholder="Libreville, Gabon" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Notes</label>
              <textarea className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notes sur ce prospect..." />
            </div>
            <div className="flex gap-3">
              <Button className="flex-1" onClick={handleSave}>{editItem ? 'Enregistrer' : 'Ajouter'}</Button>
              {editItem && <Button variant="destructive" onClick={() => { handleDelete(editItem); setShowForm(false); }}><Trash2 className="h-4 w-4" /></Button>}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
