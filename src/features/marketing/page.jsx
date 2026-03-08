import { useState, useEffect, useMemo, useCallback } from 'react';
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
  Megaphone, Plus, Edit2, Trash2, Calendar, TrendingUp, Target,
  DollarSign, ArrowRight, Link2, Search, Eye,
} from 'lucide-react';
import { toast } from 'sonner';

/* ─── CONSTANTES ─── */

const TYPES_ACTION = {
  promotion: { label: 'Promotion', color: 'bg-amber-100 text-amber-700', icon: '🏷️' },
  evenement: { label: 'Événement', color: 'bg-blue-100 text-blue-700', icon: '🎉' },
  campagne_app: { label: 'Campagne app', color: 'bg-violet-100 text-violet-700', icon: '📱' },
  post_reseaux: { label: 'Post réseaux sociaux', color: 'bg-pink-100 text-pink-700', icon: '📣' },
  distribution_flyers: { label: 'Distribution flyers', color: 'bg-emerald-100 text-emerald-700', icon: '📄' },
  partenariat: { label: 'Partenariat', color: 'bg-indigo-100 text-indigo-700', icon: '🤝' },
};

const STATUTS_ACTION = {
  idee: { label: 'Idée', color: 'bg-slate-100 text-slate-700' },
  planifie: { label: 'Planifié', color: 'bg-blue-100 text-blue-700' },
  en_cours: { label: 'En cours', color: 'bg-amber-100 text-amber-700' },
  termine: { label: 'Terminé', color: 'bg-emerald-100 text-emerald-700' },
  annule: { label: 'Annulé', color: 'bg-red-100 text-red-700' },
};

const emptyForm = {
  titre: '', type: 'promotion', statut: 'idee',
  dateDebut: '', dateFin: '', budget: '',
  cible: '', description: '', resultats: '',
  campagneProspectionLiee: '',
};

/* ─── COMPOSANT ─── */

export default function Marketing() {
  const { user, hasPermission } = useAuth();
  const canWrite = hasPermission('clients', 'write');
  const canDelete = hasPermission('clients', 'delete');

  const [actions, setActions] = useState([]);
  const [campagnes, setCampagnes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterStatut, setFilterStatut] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [showDetail, setShowDetail] = useState(null);

  const load = useCallback(async () => {
    const [a, c] = await Promise.all([
      db.actions_marketing.list(),
      db.campagnes_prospection.list(),
    ]);
    setActions(a.sort((x, y) => (y.created_at || '').localeCompare(x.created_at || '')));
    setCampagnes(c);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  /* ─── FILTRES ─── */
  const filtered = useMemo(() => {
    return actions.filter((a) => {
      if (filterType !== 'all' && a.type !== filterType) return false;
      if (filterStatut !== 'all' && a.statut !== filterStatut) return false;
      if (search) {
        const q = search.toLowerCase();
        return `${a.titre} ${a.description} ${a.cible}`.toLowerCase().includes(q);
      }
      return true;
    });
  }, [actions, search, filterType, filterStatut]);

  const stats = useMemo(() => ({
    total: actions.length,
    en_cours: actions.filter((a) => a.statut === 'en_cours').length,
    planifiees: actions.filter((a) => a.statut === 'planifie').length,
    terminees: actions.filter((a) => a.statut === 'termine').length,
    budgetTotal: actions.reduce((s, a) => s + (Number(a.budget) || 0), 0),
    campagnesLiees: actions.filter((a) => a.campagneProspectionLiee).length,
  }), [actions]);

  /* ─── CRUD ─── */
  const openAdd = () => { setEditItem(null); setForm(emptyForm); setShowForm(true); };

  const openEdit = (a) => {
    setEditItem(a);
    setForm({
      titre: a.titre || '', type: a.type || 'promotion', statut: a.statut || 'idee',
      dateDebut: a.dateDebut || '', dateFin: a.dateFin || '',
      budget: a.budget || '', cible: a.cible || '',
      description: a.description || '', resultats: a.resultats || '',
      campagneProspectionLiee: a.campagneProspectionLiee || '',
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.titre.trim()) { toast.error('Le titre est requis'); return; }
    const data = {
      ...form,
      titre: form.titre.trim(),
      budget: form.budget ? Number(form.budget) : null,
    };

    if (editItem) {
      await db.actions_marketing.update(editItem.id, data);
      await logAction('update', 'actions_marketing', { entityId: editItem.id, entityLabel: data.titre });
      toast.success('Action modifiée');
    } else {
      const created = await db.actions_marketing.create(data);
      await logAction('create', 'actions_marketing', { entityId: created.id, entityLabel: data.titre });
      toast.success('Action ajoutée');
    }
    setShowForm(false);
    load();
  };

  const handleDelete = async (a) => {
    if (!confirm(`Supprimer l'action "${a.titre}" ?`)) return;
    await db.actions_marketing.delete(a.id);
    await logAction('delete', 'actions_marketing', { entityId: a.id, entityLabel: a.titre });
    toast.success('Action supprimée');
    load();
  };

  const handleStatutChange = async (a, newStatut) => {
    await db.actions_marketing.update(a.id, { statut: newStatut });
    toast.success(`Statut → ${STATUTS_ACTION[newStatut]?.label}`);
    load();
  };

  /* ─── LOADING ─── */
  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Marketing</h2>
          <p className="text-muted-foreground">Suivi des actions marketing — {stats.total} actions</p>
        </div>
        {canWrite && <Button className="gap-2" onClick={openAdd}><Plus className="h-4 w-4" /> Nouvelle action</Button>}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Total', value: stats.total, icon: Megaphone, color: 'bg-primary/10 text-primary' },
          { label: 'En cours', value: stats.en_cours, icon: TrendingUp, color: 'bg-amber-500/10 text-amber-600' },
          { label: 'Planifiées', value: stats.planifiees, icon: Calendar, color: 'bg-blue-500/10 text-blue-600' },
          { label: 'Budget total', value: `${stats.budgetTotal.toLocaleString('fr-FR')} F`, icon: DollarSign, color: 'bg-emerald-500/10 text-emerald-600' },
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
          <Input placeholder="Rechercher..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous types</SelectItem>
            {Object.entries(TYPES_ACTION).map(([k, v]) => <SelectItem key={k} value={k}>{v.icon} {v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatut} onValueChange={setFilterStatut}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous statuts</SelectItem>
            {Object.entries(STATUTS_ACTION).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Megaphone className="mb-4 h-12 w-12 text-muted-foreground/30" />
            <p className="text-muted-foreground">Aucune action marketing</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((a) => {
              const typeA = TYPES_ACTION[a.type] || TYPES_ACTION.promotion;
              const statutA = STATUTS_ACTION[a.statut] || STATUTS_ACTION.idee;
              const linkedCampagne = campagnes.find((c) => c.id === a.campagneProspectionLiee);
              return (
                <Card key={a.id} className="transition-shadow hover:shadow-md">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{typeA.icon}</span>
                        <div className="min-w-0">
                          <p className="font-semibold text-sm truncate">{a.titre}</p>
                          <Badge className={`mt-0.5 text-[10px] ${typeA.color}`}>{typeA.label}</Badge>
                        </div>
                      </div>
                      {canWrite ? (
                        <Select value={a.statut} onValueChange={(v) => handleStatutChange(a, v)}>
                          <SelectTrigger className="h-7 w-auto border-none shadow-none">
                            <Badge className={`text-[10px] ${statutA.color}`}>{statutA.label}</Badge>
                          </SelectTrigger>
                          <SelectContent>{Object.entries(STATUTS_ACTION).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                        </Select>
                      ) : (
                        <Badge className={`text-[10px] ${statutA.color}`}>{statutA.label}</Badge>
                      )}
                    </div>

                    {a.description && <p className="text-xs text-muted-foreground mt-3 line-clamp-2">{a.description}</p>}

                    <div className="mt-3 space-y-1 border-t pt-3">
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        {a.dateDebut && (
                          <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{new Date(a.dateDebut).toLocaleDateString('fr-FR')}</span>
                        )}
                        {a.budget && (
                          <span className="flex items-center gap-1"><DollarSign className="h-3 w-3" />{Number(a.budget).toLocaleString('fr-FR')} F</span>
                        )}
                      </div>
                      {a.cible && <p className="text-[10px] text-muted-foreground"><span className="font-medium">Cible :</span> {a.cible}</p>}
                      {linkedCampagne && (
                        <p className="flex items-center gap-1 text-[10px] text-violet-600"><Link2 className="h-3 w-3" /> Campagne: {linkedCampagne.titre || linkedCampagne.objetMessage}</p>
                      )}
                    </div>

                    {a.resultats && (
                      <div className="mt-2 rounded-lg bg-emerald-50 p-2">
                        <p className="text-[10px] font-semibold text-emerald-700">Résultats</p>
                        <p className="text-xs text-emerald-600">{a.resultats}</p>
                      </div>
                    )}

                    {canWrite && (
                      <div className="mt-3 flex gap-2 border-t pt-3">
                        <Button size="sm" variant="outline" className="flex-1 text-xs gap-1" onClick={() => openEdit(a)}>
                          <Edit2 className="h-3 w-3" /> Modifier
                        </Button>
                        {canDelete && (
                          <Button size="sm" variant="outline" className="text-xs text-red-600 hover:bg-red-50" onClick={() => handleDelete(a)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Form Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editItem ? "Modifier l'action" : 'Nouvelle action marketing'}</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Titre *</label>
              <Input value={form.titre} onChange={(e) => setForm({ ...form, titre: e.target.value })} placeholder="Ex: Distribution flyers Moanda Centre" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Type</label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(TYPES_ACTION).map(([k, v]) => <SelectItem key={k} value={k}>{v.icon} {v.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Statut</label>
                <Select value={form.statut} onValueChange={(v) => setForm({ ...form, statut: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(STATUTS_ACTION).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Date début</label>
                <Input type="date" value={form.dateDebut} onChange={(e) => setForm({ ...form, dateDebut: e.target.value })} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Date fin</label>
                <Input type="date" value={form.dateFin} onChange={(e) => setForm({ ...form, dateFin: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Budget (FCFA)</label>
                <Input type="number" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} placeholder="0" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Cible</label>
                <Input value={form.cible} onChange={(e) => setForm({ ...form, cible: e.target.value })} placeholder="Ex: Écoles de Moanda" />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Description</label>
              <textarea className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Décrivez l'action marketing..." />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Résultats</label>
              <textarea className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.resultats} onChange={(e) => setForm({ ...form, resultats: e.target.value })} placeholder="Résultats obtenus (si terminé)..." />
            </div>
            {campagnes.length > 0 && (
              <div>
                <label className="mb-1.5 block text-sm font-medium">Campagne de prospection liée</label>
                <Select value={form.campagneProspectionLiee} onValueChange={(v) => setForm({ ...form, campagneProspectionLiee: v })}>
                  <SelectTrigger><SelectValue placeholder="Aucune" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Aucune</SelectItem>
                    {campagnes.map((c) => <SelectItem key={c.id} value={c.id}>{c.titre || c.objetMessage}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex gap-3">
              <Button className="flex-1" onClick={handleSave}>{editItem ? 'Enregistrer' : 'Ajouter'}</Button>
              {editItem && canDelete && <Button variant="destructive" onClick={() => { handleDelete(editItem); setShowForm(false); }}><Trash2 className="h-4 w-4" /></Button>}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
