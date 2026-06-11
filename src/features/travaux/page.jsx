import { useState, useEffect, useMemo, useRef } from 'react';
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
  LayoutGrid, List, GripVertical, User, AlertTriangle, Flag,
} from 'lucide-react';
import { toast } from 'sonner';

function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)); }

const STATUTS_PROJET = {
  planifie: { label: 'Planifie', color: 'bg-slate-100 text-slate-700', kanbanLabel: 'A faire' },
  en_cours: { label: 'En cours', color: 'bg-blue-100 text-blue-700', kanbanLabel: 'En cours' },
  termine: { label: 'Termine', color: 'bg-emerald-100 text-emerald-700', kanbanLabel: 'Termine' },
  suspendu: { label: 'Suspendu', color: 'bg-orange-100 text-orange-700', kanbanLabel: 'Suspendu' },
};

const PRIORITES = {
  haute: { label: 'Haute', color: 'bg-red-100 text-red-700 border-red-200', icon: '🔴' },
  moyenne: { label: 'Moyenne', color: 'bg-amber-100 text-amber-700 border-amber-200', icon: '🟡' },
  basse: { label: 'Basse', color: 'bg-green-100 text-green-700 border-green-200', icon: '🟢' },
};

const KANBAN_COLUMNS = ['planifie', 'en_cours', 'termine'];

const emptyProjet = { nom: '', description: '', statut: 'planifie', budget_prevu: '', date_debut: '', date_fin: '', responsable: '', priorite: 'moyenne' };
const emptyEtape = { nom: '', description: '', statut: 'en_attente', budget: '', depense: '', statut_paiement: 'non_paye', source_paiement: 'caisse' };

const SOURCES_PAIEMENT = [
  { value: 'caisse', label: 'Caisse / Liquide' },
  { value: 'finam', label: 'FINAM' },
  { value: 'bgfi', label: 'BGFI' },
  { value: 'airtel_money', label: 'Airtel Money' },
  { value: 'moov_money', label: 'Moov Money' },
];

export default function Travaux() {
  const { hasPermission, user } = useAuth();
  const isAssocie = user?.role === 'associe';
  const canWrite = hasPermission('commandes', 'write') && !isAssocie;
  const [projets, setProjets] = useState([]);
  const [etapes, setEtapes] = useState([]);
  const [employes, setEmployes] = useState([]);
  const [comptesBancaires, setComptesBancaires] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [view, setView] = useState('kanban');
  const [showProjetForm, setShowProjetForm] = useState(false);
  const [showEtapeForm, setShowEtapeForm] = useState(false);
  const [editProjet, setEditProjet] = useState(null);
  const [editEtape, setEditEtape] = useState(null);
  const [selectedProjet, setSelectedProjet] = useState(null);
  const [projetForm, setProjetForm] = useState(emptyProjet);
  const [etapeForm, setEtapeForm] = useState(emptyEtape);
  const [expandedProjet, setExpandedProjet] = useState(null);
  const [draggedProjet, setDraggedProjet] = useState(null);

  const load = async () => {
    const [p, e, emp, cp] = await Promise.all([
      db.projets_travaux.list(),
      db.etapes_travaux.list(),
      db.employes.list(),
      db.comptes_bancaires.list(),
    ]);
    setProjets(p.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')));
    setEtapes(e);
    setEmployes(emp.filter((em) => em.role !== 'client'));
    setComptesBancaires(cp);
    setLoading(false);
  };

  // Mapping source_paiement (string) → compte bancaire (UUID) par matching de nom.
  // Permet de rattacher un mouvement Travaux a un compte reel et de mettre a jour son solde.
  const SOURCE_KEYWORDS = {
    caisse: ['caisse', 'liquide'],
    finam: ['finam'],
    bgfi: ['bgfi'],
    airtel_money: ['airtel'],
    moov_money: ['moov'],
  };
  const findCompteBySource = (source) => {
    const keywords = SOURCE_KEYWORDS[source] || [source];
    return comptesBancaires.find((c) => {
      const n = (c.nom || '').toLowerCase();
      return keywords.some((k) => n.includes(k));
    });
  };

  /**
   * Cree un mouvement financier et met a jour le solde du compte bancaire associe.
   * Centralise la logique pour eviter la duplication entre les 4 cas de handleSaveEtape.
   */
  const createMouvementAvecImpactSolde = async ({ type, montant, description, source, reference, categorie, date }) => {
    const compte = findCompteBySource(source);
    const mouvement = {
      type,
      montant,
      description,
      source,
      compte_id: compte?.id || '',
      date: date || new Date().toISOString().slice(0, 10),
      reference,
      categorie,
    };
    await db.mouvements_financiers.create(mouvement);
    // Mise a jour du solde si compte trouve
    if (compte) {
      const delta = (type === 'sortie') ? -montant : montant; // entree = +, sortie = -
      await db.comptes_bancaires.update(compte.id, { solde: (compte.solde || 0) + delta });
    }
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
      if (search) return `${p.nom} ${p.description} ${p.responsable || ''}`.toLowerCase().includes(search.toLowerCase());
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
  const openEditProjet = (p) => {
    setEditProjet(p);
    setProjetForm({
      nom: p.nom || '', description: p.description || '', statut: p.statut || 'planifie',
      budget_prevu: p.budget_prevu || '', date_debut: p.date_debut || '', date_fin: p.date_fin || '',
      responsable: p.responsable || '', priorite: p.priorite || 'moyenne',
    });
    setShowProjetForm(true);
  };

  const handleSaveProjet = async () => {
    if (!projetForm.nom.trim()) { toast.error('Nom requis'); return; }
    const data = { ...projetForm, budget_prevu: Number(projetForm.budget_prevu) || 0 };
    if (editProjet) {
      await db.projets_travaux.update(editProjet.id, data);
      await logAction('update', 'travaux', { details: `Projet modifie: ${data.nom}` });
      toast.success('Projet modifie');
    } else {
      await db.projets_travaux.create(data);
      await logAction('create', 'travaux', { details: `Nouveau projet: ${data.nom}` });
      toast.success('Projet cree');
    }
    setShowProjetForm(false); load();
  };

  const openAddEtape = (projetId) => { setSelectedProjet(projetId); setEditEtape(null); setEtapeForm(emptyEtape); setShowEtapeForm(true); };
  const openEditEtape = (e) => { setSelectedProjet(e.projet_id); setEditEtape(e); setEtapeForm({ nom: e.nom || '', description: e.description || '', statut: e.statut || 'en_attente', budget: e.budget || '', depense: e.depense || '', statut_paiement: e.statut_paiement || 'non_paye', source_paiement: e.source_paiement || 'caisse' }); setShowEtapeForm(true); };

  const handleSaveEtape = async () => {
    if (!etapeForm.nom.trim()) { toast.error('Nom requis'); return; }
    const depense = Number(etapeForm.depense) || 0;
    const data = { ...etapeForm, projet_id: selectedProjet, budget: Number(etapeForm.budget) || 0, depense };

    // Trouver le nom du projet pour la description du mouvement
    const projet = projets.find((p) => p.id === selectedProjet);
    const projetNom = projet?.nom || 'Projet';
    const sourceLabel = SOURCES_PAIEMENT.find((s) => s.value === etapeForm.source_paiement)?.label || etapeForm.source_paiement;

    if (editEtape) {
      const ancienPaye = editEtape.statut_paiement === 'paye';
      const nouveauPaye = etapeForm.statut_paiement === 'paye';
      const ancienneDepense = editEtape.depense || 0;

      await db.etapes_travaux.update(editEtape.id, data);

      // Cas 1 : non_paye → paye — creer le mouvement sortie (debite le compte source)
      if (!ancienPaye && nouveauPaye && depense > 0) {
        await createMouvementAvecImpactSolde({
          type: 'sortie',
          montant: depense,
          description: `Travaux: ${projetNom} — ${etapeForm.nom}`,
          source: etapeForm.source_paiement,
          reference: `PROJET-${editEtape.id}`,
          categorie: 'travaux',
        });
        toast.success(`Etape modifiee — sortie ${sourceLabel} de ${fmt(depense)} F enregistree`);
      }
      // Cas 2 : paye → non_paye — contrepassation (credite le compte source)
      else if (ancienPaye && !nouveauPaye && ancienneDepense > 0) {
        await createMouvementAvecImpactSolde({
          type: 'entree',
          montant: ancienneDepense,
          description: `ANNULATION — Travaux: ${projetNom} — ${etapeForm.nom} (contrepassation)`,
          source: editEtape.source_paiement || 'caisse',
          reference: `ANNUL-PROJET-${editEtape.id}`,
          categorie: 'travaux_annulation',
        });
        toast.success(`Etape modifiee — annulation sortie ${fmt(ancienneDepense)} F enregistree`);
      }
      // Cas 3 : paye reste paye, mais montant change — mouvement correctif
      else if (ancienPaye && nouveauPaye && depense !== ancienneDepense) {
        const diff = depense - ancienneDepense;
        if (diff !== 0) {
          await createMouvementAvecImpactSolde({
            type: diff > 0 ? 'sortie' : 'entree',
            montant: Math.abs(diff),
            description: `${diff > 0 ? 'Complement' : 'Correction'} — Travaux: ${projetNom} — ${etapeForm.nom}`,
            source: etapeForm.source_paiement,
            reference: `CORRECT-PROJET-${editEtape.id}`,
            categorie: 'travaux_correction',
          });
          toast.success(`Etape modifiee — ${diff > 0 ? 'complement' : 'correction'} ${fmt(Math.abs(diff))} F`);
        } else {
          toast.success('Etape modifiee');
        }
      } else {
        toast.success('Etape modifiee');
      }
    } else {
      const created = await db.etapes_travaux.create(data);
      // Si nouvelle etape directement marquee payee
      if (etapeForm.statut_paiement === 'paye' && depense > 0) {
        await createMouvementAvecImpactSolde({
          type: 'sortie',
          montant: depense,
          description: `Travaux: ${projetNom} — ${etapeForm.nom}`,
          source: etapeForm.source_paiement,
          reference: `PROJET-${created?.id || 'new'}`,
          categorie: 'travaux',
        });
        toast.success(`Etape ajoutee — sortie ${sourceLabel} de ${fmt(depense)} F enregistree`);
      } else {
        toast.success('Etape ajoutee');
      }
    }
    setShowEtapeForm(false); load();
  };

  // Contre-passe le paiement d'une étape (si payée) : recrédite le compte source.
  const contrepasserEtapePayee = async (e, projetNom = '') => {
    if (e.statut_paiement !== 'paye') return;
    const depense = Number(e.depense) || 0;
    if (depense <= 0) return;
    await createMouvementAvecImpactSolde({
      type: 'entree',
      montant: depense,
      description: `ANNULATION (suppression) — Travaux: ${projetNom} — ${e.nom}`,
      source: e.source_paiement || 'caisse',
      reference: `ANNUL-DELETE-${e.id}`,
      categorie: 'travaux_annulation',
    });
  };

  const handleDeleteEtape = async (e) => {
    if (!confirm(`Supprimer "${e.nom}" ?`)) return;
    const projet = projets.find((p) => p.id === e.projet_id);
    await contrepasserEtapePayee(e, projet?.nom || '');
    await db.etapes_travaux.delete(e.id);
    toast.success('Supprime');
    load();
  };

  const handleDeleteProjet = async (p) => {
    if (!confirm(`Supprimer "${p.nom}" ?`)) return;
    // Contre-passer toutes les étapes payées du projet avant suppression
    const etapesProjet = etapes.filter((e) => e.projet_id === p.id);
    for (const e of etapesProjet) {
      await contrepasserEtapePayee(e, p.nom);
      await db.etapes_travaux.delete(e.id);
    }
    await db.projets_travaux.delete(p.id);
    toast.success('Supprime');
    load();
  };

  // Drag & drop handlers for Kanban
  const handleDragStart = (e, projet) => {
    if (!canWrite) return;
    setDraggedProjet(projet);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e, newStatut) => {
    e.preventDefault();
    if (!draggedProjet || !canWrite) return;
    if (draggedProjet.statut === newStatut) { setDraggedProjet(null); return; }
    await db.projets_travaux.update(draggedProjet.id, { statut: newStatut });
    await logAction('update', 'travaux', { details: `Projet "${draggedProjet.nom}" deplace vers ${STATUTS_PROJET[newStatut]?.label}` });
    toast.success(`Projet deplace vers "${STATUTS_PROJET[newStatut]?.kanbanLabel}"`);
    setDraggedProjet(null);
    load();
  };

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Travaux & Projets</h2>
          <p className="text-muted-foreground">{stats.total} projets — Budget total: {fmt(stats.budget)} F</p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex rounded-lg border bg-muted p-0.5">
            <button
              onClick={() => setView('kanban')}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${view === 'kanban' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}
            >
              <LayoutGrid className="h-3.5 w-3.5 inline mr-1" />Kanban
            </button>
            <button
              onClick={() => setView('list')}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${view === 'list' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}
            >
              <List className="h-3.5 w-3.5 inline mr-1" />Liste
            </button>
          </div>
          {canWrite && <Button className="gap-2" onClick={openAddProjet}><Plus className="h-4 w-4" /> Nouveau projet</Button>}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Projets', value: stats.total, icon: FolderOpen, color: 'bg-primary/10 text-primary' },
          { label: 'En cours', value: stats.en_cours, icon: Clock, color: 'bg-blue-500/10 text-blue-600' },
          { label: 'Budget total', value: `${fmt(stats.budget)} F`, icon: DollarSign, color: 'bg-emerald-500/10 text-emerald-600' },
          { label: 'Depense', value: `${fmt(stats.depense)} F`, icon: BarChart3, color: 'bg-red-500/10 text-red-600' },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}><CardContent className="p-3"><div className="flex items-center gap-2">
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}><Icon className="h-4 w-4" /></div>
            <div><p className="text-[10px] text-muted-foreground">{label}</p><p className="text-base font-bold">{value}</p></div>
          </div></CardContent></Card>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Rechercher un projet..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
      </div>

      {/* ═══ KANBAN VIEW ═══ */}
      {view === 'kanban' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {KANBAN_COLUMNS.map((col) => {
            const st = STATUTS_PROJET[col];
            const colProjets = filtered.filter((p) => p.statut === col);
            return (
              <div
                key={col}
                className="rounded-xl border bg-muted/30 p-3 min-h-[200px]"
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, col)}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className={`h-2.5 w-2.5 rounded-full ${col === 'planifie' ? 'bg-slate-400' : col === 'en_cours' ? 'bg-blue-500' : 'bg-emerald-500'}`} />
                    <h3 className="text-sm font-semibold">{st.kanbanLabel}</h3>
                  </div>
                  <Badge variant="secondary" className="text-[10px]">{colProjets.length}</Badge>
                </div>
                <div className="space-y-2">
                  {colProjets.map((p) => {
                    const prio = PRIORITES[p.priorite || 'moyenne'];
                    return (
                      <div
                        key={p.id}
                        draggable={canWrite}
                        onDragStart={(e) => handleDragStart(e, p)}
                        className={`rounded-lg border bg-card p-3 shadow-sm transition-all ${canWrite ? 'cursor-grab active:cursor-grabbing hover:shadow-md' : ''} ${draggedProjet?.id === p.id ? 'opacity-50' : ''}`}
                      >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <p className="text-sm font-semibold leading-tight">{p.nom}</p>
                          {canWrite && (
                            <div className="flex gap-0.5 shrink-0">
                              <button onClick={() => openEditProjet(p)} className="rounded p-1 hover:bg-muted"><Edit2 className="h-3 w-3 text-muted-foreground" /></button>
                              <button onClick={() => handleDeleteProjet(p)} className="rounded p-1 hover:bg-red-50"><Trash2 className="h-3 w-3 text-red-400" /></button>
                            </div>
                          )}
                        </div>

                        {/* Priority badge */}
                        <div className="flex items-center gap-1.5 flex-wrap mb-2">
                          <Badge className={`text-[9px] border ${prio.color}`}>{prio.icon} {prio.label}</Badge>
                          {p.nbEtapes > 0 && <Badge variant="outline" className="text-[9px]">{p.nbEtapes} etapes</Badge>}
                        </div>

                        {/* Progress bar */}
                        {p.nbEtapes > 0 && (
                          <div className="mb-2">
                            <div className="h-1.5 w-full rounded-full bg-muted">
                              <div className="h-1.5 rounded-full bg-primary transition-all" style={{ width: `${p.progress}%` }} />
                            </div>
                            <p className="text-[9px] text-muted-foreground mt-0.5">{p.progress.toFixed(0)}%</p>
                          </div>
                        )}

                        {/* Budget */}
                        {p.totalBudget > 0 && (
                          <p className="text-[10px] text-muted-foreground">{fmt(p.totalDepense)}/{fmt(p.totalBudget)} F</p>
                        )}

                        {/* Responsable */}
                        {p.responsable && (
                          <div className="flex items-center gap-1 mt-2">
                            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[8px] font-bold text-primary">
                              {p.responsable.charAt(0)}
                            </div>
                            <span className="text-[10px] text-muted-foreground">{p.responsable}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {colProjets.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-8 text-muted-foreground/50">
                      <FolderOpen className="h-6 w-6 mb-1" />
                      <p className="text-[10px]">Aucun projet</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Suspended projects (shown below kanban) */}
      {view === 'kanban' && filtered.some((p) => p.statut === 'suspendu') && (
        <Card className="border-orange-200">
          <CardContent className="p-3">
            <h3 className="text-sm font-semibold text-orange-700 mb-2 flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5" /> Projets suspendus
            </h3>
            <div className="flex flex-wrap gap-2">
              {filtered.filter((p) => p.statut === 'suspendu').map((p) => (
                <Badge key={p.id} variant="outline" className="text-xs border-orange-200 text-orange-700 gap-1">
                  {p.nom}
                  {canWrite && <button onClick={() => openEditProjet(p)} className="ml-1 hover:text-orange-900"><Edit2 className="h-2.5 w-2.5" /></button>}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ═══ LIST VIEW ═══ */}
      {view === 'list' && (
        <div className="space-y-3">
          {filtered.map((p) => {
            const st = STATUTS_PROJET[p.statut] || STATUTS_PROJET.planifie;
            const prio = PRIORITES[p.priorite || 'moyenne'];
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
                        <Badge className={`text-[9px] border ${prio.color}`}>{prio.icon} {prio.label}</Badge>
                        <Badge variant="outline" className="text-[10px]">{p.nbEtapes} etapes</Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-1.5">
                        <div className="flex-1 max-w-xs">
                          <div className="h-1.5 w-full rounded-full bg-muted">
                            <div className="h-1.5 rounded-full bg-primary transition-all" style={{ width: `${p.progress}%` }} />
                          </div>
                        </div>
                        <p className="text-[10px] text-muted-foreground">{p.progress.toFixed(0)}% — {fmt(p.totalDepense)}/{fmt(p.totalBudget)} F</p>
                        {p.responsable && (
                          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <User className="h-3 w-3" /> {p.responsable}
                          </span>
                        )}
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
                        <h4 className="text-sm font-semibold">Etapes</h4>
                        {canWrite && <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => openAddEtape(p.id)}><Plus className="h-3 w-3" /> Etape</Button>}
                      </div>
                      <div className="space-y-2">
                        {p.etapes.map((e) => (
                          <div key={e.id} className="flex items-center gap-3 rounded-lg bg-background p-3">
                            <div className={`h-2 w-2 rounded-full shrink-0 ${e.statut === 'termine' ? 'bg-emerald-500' : e.statut === 'en_cours' ? 'bg-blue-500' : 'bg-slate-300'}`} />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium">{e.nom}</p>
                              {e.budget > 0 && <p className="text-[10px] text-muted-foreground">{fmt(e.depense)}/{fmt(e.budget)} F</p>}
                            </div>
                            <Badge variant="outline" className="text-[10px]">{e.statut === 'termine' ? 'Termine' : e.statut === 'en_cours' ? 'En cours' : 'En attente'}</Badge>
                            {canWrite && (
                              <div className="flex gap-1">
                                <button onClick={() => openEditEtape(e)} className="rounded p-1 hover:bg-muted"><Edit2 className="h-3 w-3 text-muted-foreground" /></button>
                                <button onClick={() => handleDeleteEtape(e)} className="rounded p-1 hover:bg-red-50"><Trash2 className="h-3 w-3 text-red-500" /></button>
                              </div>
                            )}
                          </div>
                        ))}
                        {p.etapes.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">Aucune etape</p>}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {filtered.length === 0 && <div className="flex flex-col items-center justify-center py-16"><Hammer className="mb-4 h-12 w-12 text-muted-foreground/30" /><p className="text-muted-foreground">Aucun projet</p></div>}

      {/* Projet form */}
      <Dialog open={showProjetForm} onOpenChange={setShowProjetForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editProjet ? 'Modifier le projet' : 'Nouveau projet'}</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div><label className="mb-1.5 block text-sm font-medium">Nom *</label><Input value={projetForm.nom} onChange={(e) => setProjetForm({ ...projetForm, nom: e.target.value })} /></div>
            <div><label className="mb-1.5 block text-sm font-medium">Description</label><textarea className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={projetForm.description} onChange={(e) => setProjetForm({ ...projetForm, description: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Statut</label>
                <Select value={projetForm.statut} onValueChange={(v) => setProjetForm({ ...projetForm, statut: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(STATUTS_PROJET).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Priorite</label>
                <Select value={projetForm.priorite} onValueChange={(v) => setProjetForm({ ...projetForm, priorite: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PRIORITES).map(([k, v]) => <SelectItem key={k} value={k}>{v.icon} {v.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Responsable</label>
              <Select value={projetForm.responsable || '__none__'} onValueChange={(v) => setProjetForm({ ...projetForm, responsable: v === '__none__' ? '' : v })}>
                <SelectTrigger><SelectValue placeholder="Choisir..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Aucun —</SelectItem>
                  {employes.map((emp) => <SelectItem key={emp.id} value={`${emp.prenom} ${emp.nom}`}>{emp.prenom} {emp.nom}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><label className="mb-1.5 block text-sm font-medium">Budget (F)</label><Input type="number" value={projetForm.budget_prevu} onChange={(e) => setProjetForm({ ...projetForm, budget_prevu: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="mb-1.5 block text-sm font-medium">Debut</label><Input type="date" value={projetForm.date_debut} onChange={(e) => setProjetForm({ ...projetForm, date_debut: e.target.value })} /></div>
              <div><label className="mb-1.5 block text-sm font-medium">Fin</label><Input type="date" value={projetForm.date_fin} onChange={(e) => setProjetForm({ ...projetForm, date_fin: e.target.value })} /></div>
            </div>
            <Button className="w-full" onClick={handleSaveProjet}>{editProjet ? 'Enregistrer' : 'Creer'}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Etape form */}
      <Dialog open={showEtapeForm} onOpenChange={setShowEtapeForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editEtape ? 'Modifier l\'etape' : 'Nouvelle etape'}</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div><label className="mb-1.5 block text-sm font-medium">Nom *</label><Input value={etapeForm.nom} onChange={(e) => setEtapeForm({ ...etapeForm, nom: e.target.value })} /></div>
            <div><label className="mb-1.5 block text-sm font-medium">Description</label><textarea className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={etapeForm.description} onChange={(e) => setEtapeForm({ ...etapeForm, description: e.target.value })} /></div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Statut</label>
                <Select value={etapeForm.statut} onValueChange={(v) => setEtapeForm({ ...etapeForm, statut: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en_attente">En attente</SelectItem>
                    <SelectItem value="en_cours">En cours</SelectItem>
                    <SelectItem value="termine">Termine</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><label className="mb-1.5 block text-sm font-medium">Budget (F)</label><Input type="number" value={etapeForm.budget} onChange={(e) => setEtapeForm({ ...etapeForm, budget: e.target.value })} /></div>
              <div><label className="mb-1.5 block text-sm font-medium">Depense (F)</label><Input type="number" value={etapeForm.depense} onChange={(e) => setEtapeForm({ ...etapeForm, depense: e.target.value })} /></div>
            </div>
            {/* Paiement */}
            {Number(etapeForm.depense) > 0 && (
              <div className="space-y-3 rounded-lg bg-muted/50 p-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">Statut paiement</label>
                    <Select value={etapeForm.statut_paiement} onValueChange={(v) => setEtapeForm({ ...etapeForm, statut_paiement: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="non_paye">Non payé</SelectItem>
                        <SelectItem value="paye">Payé</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">Source du paiement</label>
                    <Select value={etapeForm.source_paiement} onValueChange={(v) => setEtapeForm({ ...etapeForm, source_paiement: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {SOURCES_PAIEMENT.map((s) => (
                          <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {/* Indicateur compte bancaire mappe */}
                {(() => {
                  const compte = findCompteBySource(etapeForm.source_paiement);
                  return (
                    <div className={`text-[11px] rounded px-2 py-1.5 ${compte ? 'bg-emerald-500/10 text-emerald-700' : 'bg-amber-500/10 text-amber-700'}`}>
                      {compte ? (
                        <>✓ Compte débité : <strong>{compte.nom}</strong> (solde actuel : {fmt(compte.solde || 0)} F)
                          {etapeForm.statut_paiement === 'paye' && Number(etapeForm.depense) > 0 && (
                            <> → après paiement : <strong>{fmt((compte.solde || 0) - Number(etapeForm.depense))} F</strong></>
                          )}
                        </>
                      ) : (
                        <>⚠️ Aucun compte bancaire trouvé pour "{etapeForm.source_paiement}". Créez-le dans Finances → Comptes bancaires.</>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
            <Button className="w-full" onClick={handleSaveEtape}>{editEtape ? 'Enregistrer' : 'Ajouter'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
