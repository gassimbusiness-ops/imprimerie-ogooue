import { useState, useEffect, useMemo } from 'react';
import { db } from '@/services/db';
import { useAuth } from '@/services/auth';
import { logAction } from '@/services/audit';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Plus, FileSpreadsheet, Calendar, Eye, Edit, Lock, Trash2,
  CheckCircle2, Send, Save, Table2, List, LockOpen, MessageSquare,
  Download, Filter, ChevronLeft, ChevronRight, Shield, Clock,
} from 'lucide-react';
import { toast } from 'sonner';
import { exportRapportsMensuels } from '@/services/export-pdf';
import RapportForm from './components/rapport-form';
import RapportDetail from './components/rapport-detail';

const STATUS_MAP = {
  brouillon: { label: 'Brouillon', class: 'bg-orange-100 text-orange-700 border-orange-200', icon: Edit },
  soumis: { label: 'Soumis', class: 'bg-blue-100 text-blue-700 border-blue-200', icon: Send },
  valide: { label: 'Validé', class: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
  cloture: { label: 'Clôturé', class: 'bg-violet-100 text-violet-700 border-violet-200', icon: Lock },
};

const CATEGORIES = [
  { key: 'copies', label: 'Copies', short: 'COP' },
  { key: 'marchandises', label: 'Marchandises', short: 'MAR' },
  { key: 'scan', label: 'Scan', short: 'SCN' },
  { key: 'tirage_saisies', label: 'Tirage/Saisies', short: 'T/S' },
  { key: 'badges_plastification', label: 'Badges/Plast.', short: 'B/P' },
  { key: 'demi_photos', label: 'Photos', short: 'PHO' },
  { key: 'maintenance', label: 'Maintenance', short: 'MNT' },
  { key: 'imprimerie', label: 'Imprimerie', short: 'IMP' },
];

function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)); }

function totalRecettes(r) {
  return Object.values(r.categories || {}).reduce((s, v) => s + (v || 0), 0);
}

function totalDepenses(r) {
  return (r.depenses || []).reduce((s, d) => s + (d.montant || 0), 0);
}

export default function Rapports() {
  const { user, isAdmin, isManager } = useAuth();
  const isEmploye = user?.role === 'employe';
  const [rapports, setRapports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [viewMode, setViewMode] = useState('tableur');
  const [showModifRequest, setShowModifRequest] = useState(null);
  const [modifMotif, setModifMotif] = useState('');
  const [filterStatut, setFilterStatut] = useState('all');

  // Month navigation
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const load = async () => {
    setLoading(true);
    let data = await db.rapports.list();
    if (isEmploye) {
      const today = new Date().toISOString().split('T')[0];
      data = data.filter((r) => r.date === today);
    }
    setRapports(data.sort((a, b) => b.date.localeCompare(a.date)));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Filter by month and status
  const filtered = useMemo(() => {
    return rapports.filter((r) => {
      if (filterStatut !== 'all' && r.statut !== filterStatut) return false;
      if (r.date?.startsWith(currentMonth)) return true;
      if (isEmploye) return true; // Show today's regardless
      return false;
    });
  }, [rapports, currentMonth, filterStatut, isEmploye]);

  // Stats
  const stats = useMemo(() => {
    const monthRapports = rapports.filter((r) => r.date?.startsWith(currentMonth));
    const totalRec = monthRapports.reduce((s, r) => s + totalRecettes(r), 0);
    const totalDep = monthRapports.reduce((s, r) => s + totalDepenses(r), 0);
    return {
      count: monthRapports.length,
      recettes: totalRec,
      depenses: totalDep,
      solde: totalRec - totalDep,
      aValider: monthRapports.filter((r) => r.statut === 'soumis').length,
      clotures: monthRapports.filter((r) => r.statut === 'cloture').length,
    };
  }, [rapports, currentMonth]);

  const handleNew = () => { setEditing(null); setShowForm(true); };
  const handleEdit = (r) => {
    if (r.statut === 'cloture' || r.statut === 'valide') {
      toast.error('Ce rapport est verrouillé. Demandez une modification.');
      return;
    }
    setEditing(r); setShowForm(true);
  };

  const handleSave = async (data) => {
    if (editing) {
      await db.rapports.update(editing.id, data);
      await logAction('update', 'rapports', {
        entityId: editing.id, entityLabel: `Rapport ${data.date}`,
        details: `Modification rapport du ${data.date}`,
      });
      toast.success('Rapport mis à jour');
    } else {
      const created = await db.rapports.create(data);
      await logAction('create', 'rapports', {
        entityId: created.id, entityLabel: `Rapport ${data.date}`,
        details: `Nouveau rapport: ${data.date} par ${data.operateur_nom}`,
      });
      toast.success('Rapport créé');
    }
    setShowForm(false); setEditing(null); load();
  };

  const handleDelete = async (r) => {
    if (!confirm(`Supprimer le rapport du ${r.date} ?`)) return;
    await db.rapports.delete(r.id);
    await logAction('delete', 'rapports', {
      entityId: r.id, entityLabel: `Rapport ${r.date}`,
      details: `Suppression rapport du ${r.date}`,
    });
    toast.success('Rapport supprimé'); load();
  };

  const handleValidate = async (r) => {
    await db.rapports.update(r.id, { statut: 'valide', valide_par: `${user.prenom} ${user.nom}`, valide_at: new Date().toISOString() });
    await logAction('update', 'rapports', {
      entityId: r.id, entityLabel: `Rapport ${r.date}`,
      details: `Validation rapport du ${r.date}`,
    });
    toast.success('Rapport validé'); load();
  };

  const handleCloturer = async (r) => {
    await db.rapports.update(r.id, { statut: 'cloture', cloture_par: `${user.prenom} ${user.nom}`, cloture_at: new Date().toISOString() });
    await logAction('cloture', 'rapports', {
      entityId: r.id, entityLabel: `Rapport ${r.date}`,
      details: `Clôture rapport du ${r.date}`,
    });
    toast.success('Rapport clôturé et verrouillé'); load();
  };

  const handleDeverrouiller = async (r) => {
    await db.rapports.update(r.id, { statut: 'soumis', deverrouille_par: `${user.prenom} ${user.nom}`, deverrouille_at: new Date().toISOString() });
    await logAction('update', 'rapports', {
      entityId: r.id, entityLabel: `Rapport ${r.date}`,
      details: `Déverrouillage rapport du ${r.date}`,
    });
    toast.success('Rapport déverrouillé'); load();
  };

  const handleDemandeModif = async () => {
    if (!modifMotif.trim()) { toast.error('Veuillez indiquer le motif'); return; }
    const r = showModifRequest;
    await logAction('update', 'rapports', {
      entityId: r.id, entityLabel: `Rapport ${r.date}`,
      details: `Demande de modification: ${modifMotif}`,
      metadata: { motif: modifMotif, demandeur: `${user.prenom} ${user.nom}` },
    });
    toast.success('Demande de modification envoyée à l\'administrateur');
    setShowModifRequest(null); setModifMotif('');
  };

  const prevMonth = () => {
    const [y, m] = currentMonth.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    setCurrentMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };
  const nextMonth = () => {
    const [y, m] = currentMonth.split('-').map(Number);
    const d = new Date(y, m, 1);
    setCurrentMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };
  const monthLabel = (() => {
    const [y, m] = currentMonth.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  })();

  const formatDate = (d) => {
    return new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', {
      weekday: 'short', day: 'numeric', month: 'short',
    });
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Rapports journaliers</h2>
          <p className="text-muted-foreground">Recettes quotidiennes — mode tableur</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border p-0.5">
            <button onClick={() => setViewMode('tableur')} className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === 'tableur' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
              <Table2 className="h-4 w-4" />
            </button>
            <button onClick={() => setViewMode('list')} className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
              <List className="h-4 w-4" />
            </button>
          </div>
          <Button onClick={handleNew} className="gap-2">
            <Plus className="h-4 w-4" /> Nouveau
          </Button>
        </div>
      </div>

      {/* Month nav + Stats (hidden for employees) */}
      {!isEmploye && (
        <>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={prevMonth}><ChevronLeft className="h-4 w-4" /></Button>
              <span className="text-sm font-semibold capitalize min-w-[150px] text-center">{monthLabel}</span>
              <Button variant="outline" size="icon" onClick={nextMonth}><ChevronRight className="h-4 w-4" /></Button>
            </div>
            <div className="flex items-center gap-2">
              <Select value={filterStatut} onValueChange={setFilterStatut}>
                <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous statuts</SelectItem>
                  {Object.entries(STATUS_MAP).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" className="gap-2" onClick={() => {
                const monthRapports = rapports.filter((r) => r.date?.startsWith(currentMonth));
                exportRapportsMensuels(monthRapports, currentMonth, stats);
              }}>
                <Download className="h-4 w-4" /> PDF
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            <Card><CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground">Rapports</p>
              <p className="text-lg font-bold">{stats.count}</p>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground">Recettes</p>
              <p className="text-lg font-bold text-emerald-600">{fmt(stats.recettes)} F</p>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground">Dépenses</p>
              <p className="text-lg font-bold text-red-600">{fmt(stats.depenses)} F</p>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground">Solde</p>
              <p className={`text-lg font-bold ${stats.solde >= 0 ? 'text-primary' : 'text-destructive'}`}>{fmt(stats.solde)} F</p>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground">À valider</p>
              <p className="text-lg font-bold text-blue-600">{stats.aValider}</p>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground">Clôturés</p>
              <p className="text-lg font-bold text-violet-600">{stats.clotures}</p>
            </CardContent></Card>
          </div>
        </>
      )}

      {/* TABLEUR VIEW */}
      {viewMode === 'tableur' && !isEmploye && (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="sticky left-0 z-10 bg-muted/50 px-3 py-2.5 text-left text-[11px] font-semibold uppercase text-muted-foreground min-w-[120px]">Date</th>
                  <th className="px-2 py-2.5 text-left text-[11px] font-semibold uppercase text-muted-foreground min-w-[100px]">Opérateur</th>
                  {CATEGORIES.map((c) => (
                    <th key={c.key} className="px-2 py-2.5 text-right text-[11px] font-semibold uppercase text-muted-foreground min-w-[80px]" title={c.label}>{c.short}</th>
                  ))}
                  <th className="px-2 py-2.5 text-right text-[11px] font-semibold uppercase text-emerald-600 min-w-[90px]">Recettes</th>
                  <th className="px-2 py-2.5 text-right text-[11px] font-semibold uppercase text-red-600 min-w-[80px]">Dépenses</th>
                  <th className="px-2 py-2.5 text-right text-[11px] font-semibold uppercase text-primary min-w-[90px]">Solde</th>
                  <th className="px-2 py-2.5 text-center text-[11px] font-semibold uppercase text-muted-foreground min-w-[80px]">Statut</th>
                  <th className="px-2 py-2.5 text-center text-[11px] font-semibold uppercase text-muted-foreground min-w-[100px]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.length === 0 ? (
                  <tr><td colSpan={CATEGORIES.length + 6} className="py-12 text-center text-muted-foreground">Aucun rapport pour cette période</td></tr>
                ) : filtered.map((r) => {
                  const rec = totalRecettes(r);
                  const dep = totalDepenses(r);
                  const solde = rec - dep;
                  const st = STATUS_MAP[r.statut] || STATUS_MAP.brouillon;
                  const isLocked = r.statut === 'cloture' || r.statut === 'valide';

                  return (
                    <tr key={r.id} className={`hover:bg-muted/30 transition-colors ${isLocked ? 'bg-muted/10' : ''}`}>
                      <td className="sticky left-0 z-10 bg-background px-3 py-2 font-medium text-xs">{formatDate(r.date)}</td>
                      <td className="px-2 py-2 text-xs text-muted-foreground truncate max-w-[120px]">{r.operateur_nom?.split(' ')[0] || '—'}</td>
                      {CATEGORIES.map((c) => (
                        <td key={c.key} className="px-2 py-2 text-right text-xs tabular-nums">
                          {(r.categories?.[c.key] || 0) > 0 ? fmt(r.categories[c.key]) : <span className="text-muted-foreground/30">—</span>}
                        </td>
                      ))}
                      <td className="px-2 py-2 text-right text-xs font-semibold text-emerald-600 tabular-nums">{fmt(rec)}</td>
                      <td className="px-2 py-2 text-right text-xs font-semibold text-red-600 tabular-nums">{fmt(dep)}</td>
                      <td className={`px-2 py-2 text-right text-xs font-bold tabular-nums ${solde >= 0 ? 'text-primary' : 'text-destructive'}`}>{fmt(solde)}</td>
                      <td className="px-2 py-2 text-center">
                        <Badge variant="outline" className={`text-[9px] ${st.class}`}>
                          {isLocked && <Lock className="mr-1 h-2.5 w-2.5" />}
                          {st.label}
                        </Badge>
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center justify-center gap-0.5">
                          <button onClick={() => setViewing(r)} className="rounded p-1 hover:bg-muted" title="Voir"><Eye className="h-3.5 w-3.5 text-muted-foreground" /></button>
                          {!isLocked && (
                            <button onClick={() => handleEdit(r)} className="rounded p-1 hover:bg-muted" title="Modifier"><Edit className="h-3.5 w-3.5 text-muted-foreground" /></button>
                          )}
                          {r.statut === 'soumis' && isManager && (
                            <button onClick={() => handleValidate(r)} className="rounded p-1 hover:bg-emerald-50" title="Valider"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /></button>
                          )}
                          {r.statut === 'valide' && isAdmin && (
                            <button onClick={() => handleCloturer(r)} className="rounded p-1 hover:bg-violet-50" title="Clôturer"><Lock className="h-3.5 w-3.5 text-violet-600" /></button>
                          )}
                          {isLocked && isAdmin && (
                            <button onClick={() => handleDeverrouiller(r)} className="rounded p-1 hover:bg-orange-50" title="Déverrouiller"><LockOpen className="h-3.5 w-3.5 text-orange-600" /></button>
                          )}
                          {isLocked && !isAdmin && (
                            <button onClick={() => { setShowModifRequest(r); setModifMotif(''); }} className="rounded p-1 hover:bg-blue-50" title="Demander modification"><MessageSquare className="h-3.5 w-3.5 text-blue-600" /></button>
                          )}
                          {r.statut === 'brouillon' && (
                            <button onClick={() => handleDelete(r)} className="rounded p-1 hover:bg-red-50" title="Supprimer"><Trash2 className="h-3.5 w-3.5 text-red-500" /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {/* Total row */}
                {filtered.length > 0 && (
                  <tr className="bg-muted/50 font-bold border-t-2">
                    <td className="sticky left-0 z-10 bg-muted/50 px-3 py-2.5 text-xs">TOTAL</td>
                    <td className="px-2 py-2.5 text-xs text-muted-foreground">{filtered.length} rapports</td>
                    {CATEGORIES.map((c) => (
                      <td key={c.key} className="px-2 py-2.5 text-right text-xs tabular-nums">
                        {fmt(filtered.reduce((s, r) => s + (r.categories?.[c.key] || 0), 0))}
                      </td>
                    ))}
                    <td className="px-2 py-2.5 text-right text-xs text-emerald-600 tabular-nums">{fmt(filtered.reduce((s, r) => s + totalRecettes(r), 0))}</td>
                    <td className="px-2 py-2.5 text-right text-xs text-red-600 tabular-nums">{fmt(filtered.reduce((s, r) => s + totalDepenses(r), 0))}</td>
                    <td className="px-2 py-2.5 text-right text-xs text-primary tabular-nums">{fmt(filtered.reduce((s, r) => s + totalRecettes(r) - totalDepenses(r), 0))}</td>
                    <td colSpan={2}></td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* LIST VIEW */}
      {(viewMode === 'list' || isEmploye) && (
        <div className="space-y-3">
          {filtered.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16">
                <FileSpreadsheet className="mb-4 h-12 w-12 text-muted-foreground/30" />
                <p className="text-muted-foreground">Aucun rapport pour l'instant</p>
                <Button onClick={handleNew} variant="outline" className="mt-4">Créer le premier rapport</Button>
              </CardContent>
            </Card>
          ) : filtered.map((r) => {
            const rec = totalRecettes(r);
            const dep = totalDepenses(r);
            const solde = rec - dep;
            const st = STATUS_MAP[r.statut] || STATUS_MAP.brouillon;
            const isLocked = r.statut === 'cloture' || r.statut === 'valide';

            return (
              <Card key={r.id} className={`group transition-shadow hover:shadow-md ${isLocked ? 'border-l-4 border-l-violet-300' : ''}`}>
                <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-4">
                    <div className="hidden h-11 w-11 items-center justify-center rounded-xl bg-primary/10 sm:flex">
                      {isLocked ? <Lock className="h-5 w-5 text-violet-600" /> : <FileSpreadsheet className="h-5 w-5 text-primary" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold">{formatDate(r.date)}</p>
                        <Badge variant="outline" className={st.class}>{st.label}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        <Calendar className="mr-1 inline h-3 w-3" />
                        {r.operateur_nom || 'Non assigné'}
                        {r.valide_par && <span className="ml-2 text-emerald-600">✓ {r.valide_par}</span>}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-6">
                    {!isEmploye && (
                      <>
                        <div className="hidden text-right sm:block">
                          <p className="text-xs text-muted-foreground">Recettes</p>
                          <p className="font-semibold text-emerald-600">{fmt(rec)} F</p>
                        </div>
                        <div className="hidden text-right sm:block">
                          <p className="text-xs text-muted-foreground">Dépenses</p>
                          <p className="font-semibold text-destructive">{fmt(dep)} F</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">Solde</p>
                          <p className={`text-lg font-bold ${solde >= 0 ? 'text-primary' : 'text-destructive'}`}>{fmt(solde)} F</p>
                        </div>
                      </>
                    )}
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" onClick={() => setViewing(r)}><Eye className="h-4 w-4" /></Button>
                      {!isLocked && <Button variant="ghost" size="icon" onClick={() => handleEdit(r)}><Edit className="h-4 w-4" /></Button>}
                      {r.statut === 'soumis' && isManager && (
                        <Button variant="ghost" size="icon" className="text-emerald-600" onClick={() => handleValidate(r)}><CheckCircle2 className="h-4 w-4" /></Button>
                      )}
                      {r.statut === 'valide' && isAdmin && (
                        <Button variant="ghost" size="icon" className="text-violet-600" onClick={() => handleCloturer(r)}><Lock className="h-4 w-4" /></Button>
                      )}
                      {isLocked && isAdmin && (
                        <Button variant="ghost" size="icon" className="text-orange-600" onClick={() => handleDeverrouiller(r)}><LockOpen className="h-4 w-4" /></Button>
                      )}
                      {isLocked && !isAdmin && (
                        <Button variant="ghost" size="icon" className="text-blue-600" onClick={() => { setShowModifRequest(r); setModifMotif(''); }}><MessageSquare className="h-4 w-4" /></Button>
                      )}
                      {r.statut === 'brouillon' && <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(r.id)}><Trash2 className="h-4 w-4" /></Button>}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Form Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto p-0">
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle>{editing ? 'Modifier le rapport' : 'Nouveau rapport journalier'}</DialogTitle>
          </DialogHeader>
          <RapportForm rapport={editing} onSave={handleSave} onCancel={() => setShowForm(false)} />
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={!!viewing} onOpenChange={() => setViewing(null)}>
        <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>Détail du rapport</DialogTitle></DialogHeader>
          {viewing && <RapportDetail rapport={viewing} />}
        </DialogContent>
      </Dialog>

      {/* Modification Request Dialog */}
      <Dialog open={!!showModifRequest} onOpenChange={() => setShowModifRequest(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-blue-600" />
              Demande de modification
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">
              Ce rapport est verrouillé. Décrivez les modifications souhaitées pour que l'administrateur puisse le déverrouiller.
            </p>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Rapport du {showModifRequest?.date}</label>
              <Badge variant="outline" className={STATUS_MAP[showModifRequest?.statut]?.class}>
                {STATUS_MAP[showModifRequest?.statut]?.label}
              </Badge>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Motif de la modification *</label>
              <textarea
                className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={modifMotif}
                onChange={(e) => setModifMotif(e.target.value)}
                placeholder="Décrivez les corrections nécessaires..."
              />
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setShowModifRequest(null)}>Annuler</Button>
              <Button className="flex-1 gap-2" onClick={handleDemandeModif}>
                <Send className="h-4 w-4" /> Envoyer la demande
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
