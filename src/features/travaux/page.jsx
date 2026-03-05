import { useState, useEffect, useMemo } from 'react';
import { db } from '@/services/db';
import { useAuth } from '@/services/auth';
import { logAction } from '@/services/audit';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Hammer, Plus, Edit2, Trash2, Search, FolderOpen, Calendar,
  DollarSign, CheckCircle2, Clock, BarChart3, ChevronRight, ChevronDown,
} from 'lucide-react';
import { toast } from 'sonner';

function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)); }

const STATUTS_PROJET = {
  planifie: { label: 'Planifié', color: 'bg-slate-100 text-slate-700' },
  en_cours: { label: 'En cours', color: 'bg-blue-100 text-blue-700' },
  termine: { label: 'Terminé', color: 'bg-emerald-100 text-emerald-700' },
  suspendu: { label: 'Suspendu', color: 'bg-orange-100 text-orange-700' },
};

const emptyProjet = { nom: '', description: '', statut: 'planifie', budget_prevu: '', date_debut: '', date_fin: '' };
const emptyEtape = { nom: '', description: '', statut: 'en_attente', budget: '', depense: '' };

export default function Travaux() {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('commandes', 'write');
  const [projets, setProjets] = useState([]);
  const [etapes, setEtapes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showProjetForm, setShowProjetForm] = useState(false);
  const [showEtapeForm, setShowEtapeForm] = useState(false);
  const [editProjet, setEditProjet] = useState(null);
  const [editEtape, setEditEtape] = useState(null);
  const [selectedProjet, setSelectedProjet] = useState(null);
  const [projetForm, setProjetForm] = useState(emptyProjet);
  const [etapeForm, setEtapeForm] = useState(emptyEtape);
  const [expandedProjet, setExpandedProjet] = useState(null);

  const load = async () => {
    const [p, e] = await Promise.all([db.projets_travaux.list(), db.etapes_travaux.list()]);
    setProjets(p.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')));
    setEtapes(e);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const enrichedProjets = useMemo(() => {
    return projets.map((p) => {
      const projetEtapes = etapes.filter((e) => e.projet_id === p.id);
      const totalBudget = projetEtapes.reduce((s, e) => s + (e.budget || 0), 0) || p.budget_prevu || 0;
      const totalDepense = projetEtapes.reduce((s, e) => s + (e.depense || 0), 0);
      const terminees = projetEtapes.filter((e) => e.statut === 'termine').length;
      const progress = projetEtapes.length > 0 ? (terminees / projetEtapes.length) * 100 : 0;
      return { ...p, etapes: projetEtapes, totalBudget, totalDepense, progress, nbEtapes: projetEtapes.length };
    });
  }, [projets, etapes]);

  const filtered = useMemo(() => {
    return enrichedProjets.filter((p) => {
      if (search) return `${p.nom} ${p.description}`.toLowerCase().includes(search.toLowerCase());
      return true;
    });
  }, [enrichedProjets, search]);

  const stats = useMemo(() => ({
    total: projets.length,
    en_cours: projets.filter((p) => p.statut === 'en_cours').length,
    budget: enrichedProjets.reduce((s, p) => s + p.totalBudget, 0),
    depense: enrichedProjets.reduce((s, p) => s + p.totalDepense, 0),
  }), [projets, enrichedProjets]);

  const openAddProjet = () => { setEditProjet(null); setProjetForm(emptyProjet); setShowProjetForm(true); };
  const openEditProjet = (p) => { setEditProjet(p); setProjetForm({ nom: p.nom || '', description: p.description || '', statut: p.statut || 'planifie', budget_prevu: p.budget_prevu || '', date_debut: p.date_debut || '', date_fin: p.date_fin || '' }); setShowProjetForm(true); };

  const handleSaveProjet = async () => {
    if (!projetForm.nom.trim()) { toast.error('Nom requis'); return; }
    const data = { ...projetForm, budget_prevu: Number(projetForm.budget_prevu) || 0 };
    if (editProjet) { await db.projets_travaux.update(editProjet.id, data); toast.success('Projet modifié'); }
    else { await db.projets_travaux.create(data); toast.success('Projet créé'); }
    setShowProjetForm(false); load();
  };

  const openAddEtape = (projetId) => { setSelectedProjet(projetId); setEditEtape(null); setEtapeForm(emptyEtape); setShowEtapeForm(true); };
  const openEditEtape = (e) => { setSelectedProjet(e.projet_id); setEditEtape(e); setEtapeForm({ nom: e.nom || '', description: e.description || '', statut: e.statut || 'en_attente', budget: e.budget || '', depense: e.depense || '' }); setShowEtapeForm(true); };

  const handleSaveEtape = async () => {
    if (!etapeForm.nom.trim()) { toast.error('Nom requis'); return; }
    const data = { ...etapeForm, projet_id: selectedProjet, budget: Number(etapeForm.budget) || 0, depense: Number(etapeForm.depense) || 0 };
    if (editEtape) { await db.etapes_travaux.update(editEtape.id, data); toast.success('Étape modifiée'); }
    else { await db.etapes_travaux.create(data); toast.success('Étape ajoutée'); }
    setShowEtapeForm(false); load();
  };

  const handleDeleteProjet = async (p) => { if (!confirm(`Supprimer "${p.nom}" ?`)) return; await db.projets_travaux.delete(p.id); toast.success('Supprimé'); load(); };
  const handleDeleteEtape = async (e) => { if (!confirm(`Supprimer "${e.nom}" ?`)) return; await db.etapes_travaux.delete(e.id); toast.success('Supprimé'); load(); };

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-2xl font-bold tracking-tight">Travaux & Projets</h2><p className="text-muted-foreground">{stats.total} projets — Budget total: {fmt(stats.budget)} F</p></div>
        {canWrite && <Button className="gap-2" onClick={openAddProjet}><Plus className="h-4 w-4" /> Nouveau projet</Button>}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Projets', value: stats.total, icon: FolderOpen, color: 'bg-primary/10 text-primary' },
          { label: 'En cours', value: stats.en_cours, icon: Clock, color: 'bg-blue-500/10 text-blue-600' },
          { label: 'Budget total', value: `${fmt(stats.budget)} F`, icon: DollarSign, color: 'bg-emerald-500/10 text-emerald-600' },
          { label: 'Dépensé', value: `${fmt(stats.depense)} F`, icon: BarChart3, color: 'bg-red-500/10 text-red-600' },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}><CardContent className="p-3"><div className="flex items-center gap-2">
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}><Icon className="h-4 w-4" /></div>
            <div><p className="text-[10px] text-muted-foreground">{label}</p><p className="text-base font-bold">{value}</p></div>
          </div></CardContent></Card>
        ))}
      </div>

      <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input placeholder="Rechercher un projet..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" /></div>

      <div className="space-y-3">
        {filtered.map((p) => {
          const st = STATUTS_PROJET[p.statut] || STATUTS_PROJET.planifie;
          const isExpanded = expandedProjet === p.id;
          return (
            <Card key={p.id}>
              <CardContent className="p-0">
                <div className="flex items-center gap-4 p-4 cursor-pointer" onClick={() => setExpandedProjet(isExpanded ? null : p.id)}>
                  {isExpanded ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 shrink-0"><Hammer className="h-5 w-5 text-primary" /></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold">{p.nom}</p>
                      <Badge className={`text-[10px] ${st.color}`}>{st.label}</Badge>
                      <Badge variant="outline" className="text-[10px]">{p.nbEtapes} étapes</Badge>
                    </div>
                    <div className="mt-1.5">
                      <div className="h-1.5 w-full max-w-xs rounded-full bg-muted">
                        <div className="h-1.5 rounded-full bg-primary transition-all" style={{ width: `${p.progress}%` }} />
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{p.progress.toFixed(0)}% — {fmt(p.totalDepense)}/{fmt(p.totalBudget)} F</p>
                    </div>
                  </div>
                  {canWrite && (
                    <div className="flex gap-1 shrink-0">
                      <button onClick={(e) => { e.stopPropagation(); openEditProjet(p); }} className="rounded p-1.5 hover:bg-muted"><Edit2 className="h-3.5 w-3.5 text-muted-foreground" /></button>
                      <button onClick={(e) => { e.stopPropagation(); handleDeleteProjet(p); }} className="rounded p-1.5 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5 text-red-500" /></button>
                    </div>
                  )}
                </div>
                {isExpanded && (
                  <div className="border-t bg-muted/20 p-4">
                    {p.description && <p className="text-sm text-muted-foreground mb-3">{p.description}</p>}
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-semibold">Étapes</h4>
                      {canWrite && <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => openAddEtape(p.id)}><Plus className="h-3 w-3" /> Étape</Button>}
                    </div>
                    <div className="space-y-2">
                      {p.etapes.map((e) => (
                        <div key={e.id} className="flex items-center gap-3 rounded-lg bg-background p-3">
                          <div className={`h-2 w-2 rounded-full shrink-0 ${e.statut === 'termine' ? 'bg-emerald-500' : e.statut === 'en_cours' ? 'bg-blue-500' : 'bg-slate-300'}`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{e.nom}</p>
                            {e.budget > 0 && <p className="text-[10px] text-muted-foreground">{fmt(e.depense)}/{fmt(e.budget)} F</p>}
                          </div>
                          <Badge variant="outline" className="text-[10px]">{e.statut === 'termine' ? 'Terminé' : e.statut === 'en_cours' ? 'En cours' : 'En attente'}</Badge>
                          {canWrite && (
                            <div className="flex gap-1">
                              <button onClick={() => openEditEtape(e)} className="rounded p-1 hover:bg-muted"><Edit2 className="h-3 w-3 text-muted-foreground" /></button>
                              <button onClick={() => handleDeleteEtape(e)} className="rounded p-1 hover:bg-red-50"><Trash2 className="h-3 w-3 text-red-500" /></button>
                            </div>
                          )}
                        </div>
                      ))}
                      {p.etapes.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">Aucune étape</p>}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filtered.length === 0 && <div className="flex flex-col items-center justify-center py-16"><Hammer className="mb-4 h-12 w-12 text-muted-foreground/30" /><p className="text-muted-foreground">Aucun projet</p></div>}

      {/* Projet form */}
      <Dialog open={showProjetForm} onOpenChange={setShowProjetForm}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle>{editProjet ? 'Modifier le projet' : 'Nouveau projet'}</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div><label className="mb-1.5 block text-sm font-medium">Nom *</label><Input value={projetForm.nom} onChange={(e) => setProjetForm({ ...projetForm, nom: e.target.value })} /></div>
            <div><label className="mb-1.5 block text-sm font-medium">Description</label><textarea className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={projetForm.description} onChange={(e) => setProjetForm({ ...projetForm, description: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="mb-1.5 block text-sm font-medium">Statut</label><Select value={projetForm.statut} onValueChange={(v) => setProjetForm({ ...projetForm, statut: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(STATUTS_PROJET).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent></Select></div>
              <div><label className="mb-1.5 block text-sm font-medium">Budget (F)</label><Input type="number" value={projetForm.budget_prevu} onChange={(e) => setProjetForm({ ...projetForm, budget_prevu: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="mb-1.5 block text-sm font-medium">Début</label><Input type="date" value={projetForm.date_debut} onChange={(e) => setProjetForm({ ...projetForm, date_debut: e.target.value })} /></div>
              <div><label className="mb-1.5 block text-sm font-medium">Fin</label><Input type="date" value={projetForm.date_fin} onChange={(e) => setProjetForm({ ...projetForm, date_fin: e.target.value })} /></div>
            </div>
            <Button className="w-full" onClick={handleSaveProjet}>{editProjet ? 'Enregistrer' : 'Créer'}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Etape form */}
      <Dialog open={showEtapeForm} onOpenChange={setShowEtapeForm}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle>{editEtape ? 'Modifier l\'étape' : 'Nouvelle étape'}</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div><label className="mb-1.5 block text-sm font-medium">Nom *</label><Input value={etapeForm.nom} onChange={(e) => setEtapeForm({ ...etapeForm, nom: e.target.value })} /></div>
            <div><label className="mb-1.5 block text-sm font-medium">Description</label><textarea className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={etapeForm.description} onChange={(e) => setEtapeForm({ ...etapeForm, description: e.target.value })} /></div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="mb-1.5 block text-sm font-medium">Statut</label><Select value={etapeForm.statut} onValueChange={(v) => setEtapeForm({ ...etapeForm, statut: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="en_attente">En attente</SelectItem><SelectItem value="en_cours">En cours</SelectItem><SelectItem value="termine">Terminé</SelectItem></SelectContent></Select></div>
              <div><label className="mb-1.5 block text-sm font-medium">Budget (F)</label><Input type="number" value={etapeForm.budget} onChange={(e) => setEtapeForm({ ...etapeForm, budget: e.target.value })} /></div>
              <div><label className="mb-1.5 block text-sm font-medium">Dépensé (F)</label><Input type="number" value={etapeForm.depense} onChange={(e) => setEtapeForm({ ...etapeForm, depense: e.target.value })} /></div>
            </div>
            <Button className="w-full" onClick={handleSaveEtape}>{editEtape ? 'Enregistrer' : 'Ajouter'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
