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
  CheckSquare, Search, Plus, GripVertical, List, LayoutGrid,
  Clock, AlertTriangle, User, Calendar, Flag, ChevronRight,
  Edit2, Trash2, CheckCircle2, Circle, Timer, ArrowUpRight,
} from 'lucide-react';
import { toast } from 'sonner';

const STATUTS = {
  en_attente: { label: 'En attente', color: 'bg-slate-100 text-slate-700', icon: Circle },
  en_cours: { label: 'En cours', color: 'bg-blue-100 text-blue-700', icon: Timer },
  terminee: { label: 'Terminée', color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 },
  validee: { label: 'Validée', color: 'bg-violet-100 text-violet-700', icon: CheckSquare },
};

const PRIORITES = {
  urgente: { label: 'Urgente', color: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
  haute: { label: 'Haute', color: 'bg-orange-100 text-orange-700', dot: 'bg-orange-500' },
  normale: { label: 'Normale', color: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' },
  basse: { label: 'Basse', color: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400' },
};

const CATEGORIES = ['Impression', 'Reliure', 'Design', 'Livraison', 'Administratif', 'Maintenance', 'Autre'];

const emptyForm = {
  titre: '', description: '', priorite: 'normale', categorie: 'Impression',
  statut: 'en_attente', assigne_a: '', date_echeance: '', progression: 0,
};

export default function Taches() {
  const { user, hasPermission } = useAuth();
  const canWrite = hasPermission('commandes', 'write');
  const [taches, setTaches] = useState([]);
  const [employes, setEmployes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatut, setFilterStatut] = useState('all');
  const [filterPriorite, setFilterPriorite] = useState('all');
  const [viewMode, setViewMode] = useState('kanban');
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [showDetail, setShowDetail] = useState(null);
  const [form, setForm] = useState(emptyForm);

  const load = async () => {
    const [t, e] = await Promise.all([db.taches.list(), db.employes.list()]);
    setTaches(t.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')));
    setEmployes(e);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    return taches.filter((t) => {
      if (filterStatut !== 'all' && t.statut !== filterStatut) return false;
      if (filterPriorite !== 'all' && t.priorite !== filterPriorite) return false;
      if (search) {
        const q = search.toLowerCase();
        return `${t.titre} ${t.description} ${t.categorie} ${t.assigne_nom || ''}`.toLowerCase().includes(q);
      }
      return true;
    });
  }, [taches, search, filterStatut, filterPriorite]);

  const stats = useMemo(() => ({
    total: taches.length,
    en_attente: taches.filter((t) => t.statut === 'en_attente').length,
    en_cours: taches.filter((t) => t.statut === 'en_cours').length,
    terminees: taches.filter((t) => t.statut === 'terminee' || t.statut === 'validee').length,
    urgentes: taches.filter((t) => t.priorite === 'urgente' && t.statut !== 'terminee' && t.statut !== 'validee').length,
  }), [taches]);

  const openAdd = () => {
    setEditItem(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEdit = (t) => {
    setEditItem(t);
    setForm({
      titre: t.titre || '', description: t.description || '',
      priorite: t.priorite || 'normale', categorie: t.categorie || 'Impression',
      statut: t.statut || 'en_attente', assigne_a: t.assigne_a || '',
      date_echeance: t.date_echeance || '', progression: t.progression || 0,
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.titre.trim()) { toast.error('Le titre est requis'); return; }
    const emp = employes.find((e) => e.id === form.assigne_a);
    const data = {
      ...form, titre: form.titre.trim(), description: form.description.trim(),
      assigne_nom: emp ? `${emp.prenom} ${emp.nom}` : '',
      progression: Number(form.progression) || 0,
    };
    if (editItem) {
      await db.taches.update(editItem.id, data);
      await logAction('update', 'taches', { entityId: editItem.id, entityLabel: data.titre, details: `Modification tâche: ${data.titre}` });
      toast.success('Tâche modifiée');
    } else {
      const created = await db.taches.create(data);
      await logAction('create', 'taches', { entityId: created.id, entityLabel: data.titre, details: `Nouvelle tâche: ${data.titre}` });
      toast.success('Tâche créée');
    }
    setShowForm(false);
    load();
  };

  const handleDelete = async (t) => {
    if (!confirm(`Supprimer la tâche "${t.titre}" ?`)) return;
    await db.taches.delete(t.id);
    await logAction('delete', 'taches', { entityId: t.id, entityLabel: t.titre });
    toast.success('Tâche supprimée');
    load();
  };

  const changeStatut = async (t, newStatut) => {
    await db.taches.update(t.id, { statut: newStatut, progression: newStatut === 'terminee' || newStatut === 'validee' ? 100 : t.progression });
    await logAction('update', 'taches', { entityId: t.id, entityLabel: t.titre, details: `Statut: ${newStatut}` });
    toast.success(`Tâche "${t.titre}" → ${STATUTS[newStatut]?.label}`);
    load();
  };

  const isOverdue = (t) => {
    if (!t.date_echeance || t.statut === 'terminee' || t.statut === 'validee') return false;
    return new Date(t.date_echeance) < new Date();
  };

  const getEmployeName = (id) => {
    const e = employes.find((emp) => emp.id === id);
    return e ? `${e.prenom} ${e.nom}` : '';
  };

  // Kanban columns
  const kanbanCols = ['en_attente', 'en_cours', 'terminee', 'validee'];

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  }

  const TacheCard = ({ t, compact }) => {
    const prio = PRIORITES[t.priorite] || PRIORITES.normale;
    const statut = STATUTS[t.statut] || STATUTS.en_attente;
    const overdue = isOverdue(t);

    return (
      <Card className={`transition-shadow hover:shadow-md ${overdue ? 'ring-1 ring-red-300' : ''}`}>
        <CardContent className={compact ? 'p-3' : 'p-4'}>
          <div className="flex items-start gap-2">
            <div className={`mt-0.5 h-2 w-2 rounded-full shrink-0 ${prio.dot}`} />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm truncate">{t.titre}</p>
              {t.description && !compact && (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{t.description}</p>
              )}
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <Badge variant="outline" className={`text-[10px] ${prio.color}`}>{prio.label}</Badge>
                <Badge variant="outline" className="text-[10px]">{t.categorie}</Badge>
                {overdue && <Badge className="text-[10px] bg-red-500 text-white">En retard</Badge>}
              </div>
              <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
                {t.assigne_nom && (
                  <span className="flex items-center gap-1"><User className="h-3 w-3" />{t.assigne_nom}</span>
                )}
                {t.date_echeance && (
                  <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{new Date(t.date_echeance).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}</span>
                )}
              </div>
              {/* Progress bar */}
              {t.progression > 0 && (
                <div className="mt-2">
                  <div className="h-1.5 w-full rounded-full bg-muted">
                    <div className="h-1.5 rounded-full bg-primary transition-all" style={{ width: `${t.progression}%` }} />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{t.progression}%</p>
                </div>
              )}
            </div>
            {canWrite && (
              <button onClick={(e) => { e.stopPropagation(); openEdit(t); }} className="shrink-0 rounded p-1 hover:bg-muted">
                <Edit2 className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Tâches</h2>
          <p className="text-muted-foreground">{stats.total} tâches — {stats.en_cours} en cours{stats.urgentes > 0 ? ` — ${stats.urgentes} urgentes` : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border p-0.5">
            <button onClick={() => setViewMode('kanban')} className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === 'kanban' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button onClick={() => setViewMode('list')} className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
              <List className="h-4 w-4" />
            </button>
          </div>
          {canWrite && (
            <Button className="gap-2" onClick={openAdd}><Plus className="h-4 w-4" /> Nouvelle tâche</Button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'En attente', value: stats.en_attente, icon: Circle, color: 'bg-slate-500/10 text-slate-600' },
          { label: 'En cours', value: stats.en_cours, icon: Timer, color: 'bg-blue-500/10 text-blue-600' },
          { label: 'Terminées', value: stats.terminees, icon: CheckCircle2, color: 'bg-emerald-500/10 text-emerald-600' },
          { label: 'Urgentes', value: stats.urgentes, icon: AlertTriangle, color: 'bg-red-500/10 text-red-600' },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}><Icon className="h-4 w-4" /></div>
                <div>
                  <p className="text-[10px] text-muted-foreground">{label}</p>
                  <p className="text-base font-bold">{value}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Rechercher une tâche..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={filterStatut} onValueChange={setFilterStatut}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous statuts</SelectItem>
            {Object.entries(STATUTS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterPriorite} onValueChange={setFilterPriorite}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes priorités</SelectItem>
            {Object.entries(PRIORITES).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Kanban view */}
      {viewMode === 'kanban' && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {kanbanCols.map((col) => {
            const colTasks = filtered.filter((t) => t.statut === col);
            const st = STATUTS[col];
            return (
              <div key={col} className="rounded-xl border bg-muted/30 p-3">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <st.icon className="h-4 w-4" />
                    <h3 className="text-sm font-semibold">{st.label}</h3>
                  </div>
                  <Badge variant="outline" className="text-xs">{colTasks.length}</Badge>
                </div>
                <div className="space-y-2">
                  {colTasks.map((t) => (
                    <div key={t.id} onClick={() => canWrite ? openEdit(t) : setShowDetail(t)} className="cursor-pointer">
                      <TacheCard t={t} compact />
                    </div>
                  ))}
                  {colTasks.length === 0 && (
                    <p className="py-8 text-center text-xs text-muted-foreground">Aucune tâche</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* List view */}
      {viewMode === 'list' && (
        <div className="space-y-2">
          {filtered.map((t) => {
            const prio = PRIORITES[t.priorite] || PRIORITES.normale;
            const statut = STATUTS[t.statut] || STATUTS.en_attente;
            const overdue = isOverdue(t);
            return (
              <Card key={t.id} className={`cursor-pointer transition-shadow hover:shadow-md ${overdue ? 'ring-1 ring-red-300' : ''}`}
                onClick={() => canWrite ? openEdit(t) : setShowDetail(t)}>
                <CardContent className="flex items-center gap-4 p-3 sm:p-4">
                  <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${prio.dot}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm">{t.titre}</p>
                      <Badge variant="outline" className={`text-[10px] ${statut.color}`}>{statut.label}</Badge>
                      {overdue && <Badge className="text-[10px] bg-red-500 text-white">Retard</Badge>}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                      <span>{t.categorie}</span>
                      {t.assigne_nom && <span className="flex items-center gap-1"><User className="h-3 w-3" />{t.assigne_nom}</span>}
                      {t.date_echeance && <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{new Date(t.date_echeance).toLocaleDateString('fr-FR')}</span>}
                    </div>
                  </div>
                  {t.progression > 0 && (
                    <div className="hidden sm:flex items-center gap-2 shrink-0">
                      <div className="h-1.5 w-16 rounded-full bg-muted">
                        <div className="h-1.5 rounded-full bg-primary" style={{ width: `${t.progression}%` }} />
                      </div>
                      <span className="text-[10px] text-muted-foreground">{t.progression}%</span>
                    </div>
                  )}
                  {canWrite && (
                    <div className="flex items-center gap-1 shrink-0">
                      {t.statut === 'en_attente' && (
                        <button onClick={(e) => { e.stopPropagation(); changeStatut(t, 'en_cours'); }}
                          className="rounded p-1.5 text-blue-600 hover:bg-blue-50" title="Démarrer">
                          <ArrowUpRight className="h-4 w-4" />
                        </button>
                      )}
                      {t.statut === 'en_cours' && (
                        <button onClick={(e) => { e.stopPropagation(); changeStatut(t, 'terminee'); }}
                          className="rounded p-1.5 text-emerald-600 hover:bg-emerald-50" title="Terminer">
                          <CheckCircle2 className="h-4 w-4" />
                        </button>
                      )}
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
          {filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16">
              <CheckSquare className="mb-4 h-12 w-12 text-muted-foreground/30" />
              <p className="text-muted-foreground">Aucune tâche trouvée</p>
            </div>
          )}
        </div>
      )}

      {/* Form Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editItem ? 'Modifier la tâche' : 'Nouvelle tâche'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Titre *</label>
              <Input value={form.titre} onChange={(e) => setForm({ ...form, titre: e.target.value })} placeholder="Titre de la tâche" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Description</label>
              <textarea className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Description détaillée..." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Priorité</label>
                <Select value={form.priorite} onValueChange={(v) => setForm({ ...form, priorite: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PRIORITES).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Catégorie</label>
                <Select value={form.categorie} onValueChange={(v) => setForm({ ...form, categorie: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Statut</label>
                <Select value={form.statut} onValueChange={(v) => setForm({ ...form, statut: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(STATUTS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Échéance</label>
                <Input type="date" value={form.date_echeance} onChange={(e) => setForm({ ...form, date_echeance: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Assigné à</label>
              <Select value={form.assigne_a} onValueChange={(v) => setForm({ ...form, assigne_a: v })}>
                <SelectTrigger><SelectValue placeholder="Choisir un employé" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Non assigné</SelectItem>
                  {employes.map((e) => <SelectItem key={e.id} value={e.id}>{e.prenom} {e.nom}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Progression ({form.progression}%)</label>
              <input type="range" min="0" max="100" step="5" value={form.progression}
                onChange={(e) => setForm({ ...form, progression: Number(e.target.value) })}
                className="w-full accent-primary" />
            </div>
            <div className="flex gap-3">
              <Button className="flex-1" onClick={handleSave}>{editItem ? 'Enregistrer' : 'Créer'}</Button>
              {editItem && (
                <Button variant="destructive" onClick={() => { handleDelete(editItem); setShowForm(false); }}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
