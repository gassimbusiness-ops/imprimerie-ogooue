import { useState, useEffect, useMemo } from 'react';
import { db } from '@/services/db';
import { useAuth } from '@/services/auth';
import { logAction } from '@/services/audit';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  BarChart, Bar, LineChart, Line, ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell,
} from 'recharts';
import {
  Users, UserCheck, Clock, AlertTriangle, Star, ClipboardList, TrendingUp,
  Plus, Edit3, Check, X, Award, Calendar, BarChart3, ChevronDown, ChevronUp,
  Ban, CheckCircle, MessageSquare,
} from 'lucide-react';
import { toast } from 'sonner';

function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)); }

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4'];

const TABS = [
  { id: 'dashboard', label: 'Dashboard RH', icon: BarChart3 },
  { id: 'performance', label: 'Performance', icon: Star },
  { id: 'demandes', label: 'Demandes RH', icon: ClipboardList },
];

function StarRating({ value, onChange, readonly = false }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <button
          key={s}
          type="button"
          disabled={readonly}
          className={`${readonly ? 'cursor-default' : 'cursor-pointer hover:scale-110'} transition-transform`}
          onClick={() => !readonly && onChange?.(s)}
        >
          <Star className={`h-5 w-5 ${s <= value ? 'fill-amber-400 text-amber-400' : 'text-gray-300'}`} />
        </button>
      ))}
    </div>
  );
}

export default function PerformanceRH() {
  const { user, isAdmin, isManager, hasPermission } = useAuth();
  const canManage = isAdmin || isManager;
  const [tab, setTab] = useState('dashboard');
  const [loading, setLoading] = useState(true);

  const [employes, setEmployes] = useState([]);
  const [performances, setPerformances] = useState([]);
  const [pointages, setPointages] = useState([]);
  const [demandesRH, setDemandesRH] = useState([]);
  const [taches, setTaches] = useState([]);

  // Dialogs
  const [showEvalForm, setShowEvalForm] = useState(false);
  const [showEvalDetail, setShowEvalDetail] = useState(null);
  const [evalForm, setEvalForm] = useState({
    employeId: '', periode: new Date().toISOString().slice(0, 7),
    joursPresents: '', joursAbsents: '', retards: '', totalHeuresTravaillees: '',
    tachesAssignees: '', tachesTerminees: '', tachesEnRetard: '',
    notePerformance: 3, commentaireManager: '',
    pointsForts: '', pointsAmeliorer: '',
    primeObtenue: '', motifPrime: '', observations: '',
  });

  const load = async () => {
    const [emp, perf, pt, drh, tch] = await Promise.all([
      db.employes.list(),
      db.performances_employes.list(),
      db.pointages.list(),
      db.demandes_rh.list(),
      db.taches.list(),
    ]);
    setEmployes(emp.filter((e) => e.role !== 'client'));
    setPerformances(perf);
    setPointages(pt);
    setDemandesRH(drh);
    setTaches(tch);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const currentMonth = new Date().toISOString().slice(0, 7);

  // ═══ Dashboard data ═══
  const dashData = useMemo(() => {
    const effectif = employes.length;
    const today = new Date().toISOString().slice(0, 10);
    const todayPointages = pointages.filter((p) => p.date === today);
    const presentsAujourdhui = todayPointages.filter((p) => p.statut === 'present' || p.arrivee).length;
    const absentsAujourdhui = effectif - presentsAujourdhui;

    // Retards ce mois
    const monthPointages = pointages.filter((p) => (p.date || '').slice(0, 7) === currentMonth);
    const retardsMois = monthPointages.filter((p) => p.retard || p.statut === 'retard').length;

    // Congés en cours
    const congesEnCours = demandesRH.filter((d) =>
      d.type === 'conge' && d.statut === 'approuve' && d.date_fin >= today && d.date_debut <= today
    ).length;

    // Demandes en attente
    const demandesAttente = demandesRH.filter((d) => d.statut === 'en_attente' || d.statut === 'pending').length;

    // Absences par motif (pie chart)
    const absMotifs = {};
    demandesRH.filter((d) => d.type === 'conge' || d.type === 'absence').forEach((d) => {
      const motif = d.motif || d.type_conge || 'Non justifié';
      absMotifs[motif] = (absMotifs[motif] || 0) + 1;
    });
    const absencePie = Object.entries(absMotifs).map(([name, value]) => ({ name, value }));

    // Performance moyenne par mois (6 derniers mois)
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      months.push(d.toISOString().slice(0, 7));
    }
    const perfParMois = months.map((m) => {
      const perfs = performances.filter((p) => p.periode === m);
      const avg = perfs.length > 0 ? perfs.reduce((s, p) => s + (p.notePerformance || 0), 0) / perfs.length : 0;
      return { mois: m.slice(2), moyenne: Number(avg.toFixed(1)) };
    });

    // Alertes RH
    const alertes = [];
    // Employés avec > 3 retards
    const retardsParEmploye = {};
    monthPointages.filter((p) => p.retard || p.statut === 'retard').forEach((p) => {
      retardsParEmploye[p.employe_id] = (retardsParEmploye[p.employe_id] || 0) + 1;
    });
    Object.entries(retardsParEmploye).forEach(([id, count]) => {
      if (count > 3) {
        const emp = employes.find((e) => e.id === id);
        alertes.push({ type: 'retard', message: `${emp?.prenom || '?'} ${emp?.nom || '?'} : ${count} retards ce mois`, severity: 'orange' });
      }
    });
    // Employés avec taux completion < 50%
    const monthPerfs = performances.filter((p) => p.periode === currentMonth);
    monthPerfs.forEach((p) => {
      const taux = p.tachesAssignees > 0 ? (p.tachesTerminees / p.tachesAssignees * 100) : 100;
      if (taux < 50) {
        alertes.push({ type: 'completion', message: `${p.employeNom || '?'} : taux de complétion ${taux.toFixed(0)}%`, severity: 'red' });
      }
    });

    // Tableau résumé mensuel
    const resumeMensuel = employes.map((e) => {
      const perf = monthPerfs.find((p) => p.employeId === e.id);
      const empPointages = monthPointages.filter((p) => p.employe_id === e.id);
      const presents = empPointages.filter((p) => p.statut === 'present' || p.arrivee).length;
      const retards = empPointages.filter((p) => p.retard || p.statut === 'retard').length;
      return {
        id: e.id,
        nom: `${e.prenom || ''} ${e.nom || ''}`,
        poste: e.poste || '—',
        presence: presents,
        retards,
        taches: perf ? `${perf.tachesTerminees || 0}/${perf.tachesAssignees || 0}` : '—',
        note: perf?.notePerformance || 0,
        statut: retards > 3 ? 'Alerte' : (perf?.notePerformance || 0) < 2 ? 'Faible' : 'OK',
      };
    });

    return {
      effectif, presentsAujourdhui, absentsAujourdhui, retardsMois,
      congesEnCours, demandesAttente, absencePie, perfParMois,
      alertes, resumeMensuel,
    };
  }, [employes, pointages, performances, demandesRH, currentMonth]);

  // ═══ Handlers ═══
  const handleSubmitEval = async () => {
    if (!evalForm.employeId) { toast.error('Sélectionnez un employé'); return; }
    if (!evalForm.periode) { toast.error('Sélectionnez une période'); return; }

    const emp = employes.find((e) => e.id === evalForm.employeId);
    const tAssignees = Number(evalForm.tachesAssignees) || 0;
    const tTerminees = Number(evalForm.tachesTerminees) || 0;
    const tauxCompletion = tAssignees > 0 ? (tTerminees / tAssignees * 100) : 0;

    const data = {
      employeId: evalForm.employeId,
      employeNom: `${emp?.prenom || ''} ${emp?.nom || ''}`.trim(),
      periode: evalForm.periode,
      joursPresents: Number(evalForm.joursPresents) || 0,
      joursAbsents: Number(evalForm.joursAbsents) || 0,
      retards: Number(evalForm.retards) || 0,
      totalHeuresTravaillees: Number(evalForm.totalHeuresTravaillees) || 0,
      tachesAssignees: tAssignees,
      tachesTerminees: tTerminees,
      tachesEnRetard: Number(evalForm.tachesEnRetard) || 0,
      tauxCompletion,
      notePerformance: evalForm.notePerformance,
      commentaireManager: evalForm.commentaireManager,
      pointsForts: evalForm.pointsForts ? evalForm.pointsForts.split(',').map((s) => s.trim()).filter(Boolean) : [],
      pointsAmeliorer: evalForm.pointsAmeliorer ? evalForm.pointsAmeliorer.split(',').map((s) => s.trim()).filter(Boolean) : [],
      primeObtenue: evalForm.primeObtenue ? Number(evalForm.primeObtenue) : null,
      motifPrime: evalForm.motifPrime || '',
      observations: evalForm.observations || '',
      auteurEvaluation: user?.id,
      auteurNom: `${user?.prenom || ''} ${user?.nom || ''}`.trim(),
    };

    // Check if eval already exists for this employee/period
    const existing = performances.find((p) => p.employeId === evalForm.employeId && p.periode === evalForm.periode);
    if (existing) {
      await db.performances_employes.update(existing.id, data);
      toast.success('Évaluation mise à jour');
    } else {
      await db.performances_employes.create(data);
      toast.success('Évaluation enregistrée');
    }

    await logAction('create', 'rh', { details: `Évaluation ${evalForm.periode} — ${data.employeNom} — Note: ${data.notePerformance}/5` });
    setShowEvalForm(false);
    load();
  };

  const handleDemandeAction = async (demande, action) => {
    const statut = action === 'approve' ? 'approuve' : 'rejete';
    await db.demandes_rh.update(demande.id, { statut, traite_par: user?.id, traite_date: new Date().toISOString() });
    await logAction('update', 'rh', { details: `Demande RH ${statut}: ${demande.type} — ${demande.employe_nom || ''}` });
    toast.success(`Demande ${statut === 'approuve' ? 'approuvée' : 'rejetée'}`);
    load();
  };

  const openNewEval = (employeId = '') => {
    const existingPerf = employeId ? performances.find((p) => p.employeId === employeId && p.periode === currentMonth) : null;
    if (existingPerf) {
      setEvalForm({
        employeId,
        periode: existingPerf.periode,
        joursPresents: existingPerf.joursPresents || '',
        joursAbsents: existingPerf.joursAbsents || '',
        retards: existingPerf.retards || '',
        totalHeuresTravaillees: existingPerf.totalHeuresTravaillees || '',
        tachesAssignees: existingPerf.tachesAssignees || '',
        tachesTerminees: existingPerf.tachesTerminees || '',
        tachesEnRetard: existingPerf.tachesEnRetard || '',
        notePerformance: existingPerf.notePerformance || 3,
        commentaireManager: existingPerf.commentaireManager || '',
        pointsForts: (existingPerf.pointsForts || []).join(', '),
        pointsAmeliorer: (existingPerf.pointsAmeliorer || []).join(', '),
        primeObtenue: existingPerf.primeObtenue || '',
        motifPrime: existingPerf.motifPrime || '',
        observations: existingPerf.observations || '',
      });
    } else {
      setEvalForm({
        employeId, periode: currentMonth,
        joursPresents: '', joursAbsents: '', retards: '', totalHeuresTravaillees: '',
        tachesAssignees: '', tachesTerminees: '', tachesEnRetard: '',
        notePerformance: 3, commentaireManager: '',
        pointsForts: '', pointsAmeliorer: '',
        primeObtenue: '', motifPrime: '', observations: '',
      });
    }
    setShowEvalForm(true);
  };

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-teal-900 via-emerald-900 to-cyan-900 p-6 text-white">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/5" />
        <div className="relative">
          <div className="flex items-center gap-3 mb-1">
            <Users className="h-6 w-6 text-emerald-300" />
            <h2 className="text-2xl font-bold">Performance & Dashboard RH</h2>
          </div>
          <p className="text-emerald-200/70 text-sm">Suivi des performances individuelles et tableau de bord de l'équipe</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-muted p-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-all whitespace-nowrap ${
              tab === id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="h-4 w-4" />
            <span className="hidden sm:inline">{label}</span>
            {id === 'demandes' && dashData.demandesAttente > 0 && (
              <Badge className="bg-red-500 text-white text-[10px] px-1.5 py-0">{dashData.demandesAttente}</Badge>
            )}
          </button>
        ))}
      </div>

      {/* ═══════════════ TAB DASHBOARD RH ═══════════════ */}
      {tab === 'dashboard' && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            {[
              { label: 'Effectif total', value: dashData.effectif, icon: Users, color: 'border-l-blue-500' },
              { label: 'Présents aujourd\'hui', value: dashData.presentsAujourdhui, icon: UserCheck, color: 'border-l-emerald-500' },
              { label: 'Absents aujourd\'hui', value: dashData.absentsAujourdhui, icon: X, color: 'border-l-red-500' },
              { label: 'Retards ce mois', value: dashData.retardsMois, icon: Clock, color: 'border-l-amber-500' },
              { label: 'Congés en cours', value: dashData.congesEnCours, icon: Calendar, color: 'border-l-violet-500' },
              { label: 'Demandes en attente', value: dashData.demandesAttente, icon: ClipboardList, color: 'border-l-orange-500' },
            ].map(({ label, value, icon: Icon, color }) => (
              <Card key={label} className={`border-l-4 ${color}`}>
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    <div className="shrink-0 rounded-lg bg-muted p-1.5"><Icon className="h-3.5 w-3.5 text-muted-foreground" /></div>
                    <div>
                      <p className="text-[9px] text-muted-foreground uppercase">{label}</p>
                      <p className="text-lg font-bold">{value}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            {/* Performance globale (courbe) */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Performance globale (note moyenne / mois)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={dashData.perfParMois}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="mois" tick={{ fontSize: 10 }} />
                      <YAxis domain={[0, 5]} tick={{ fontSize: 10 }} />
                      <Tooltip formatter={(v) => `${v}/5`} />
                      <Line type="monotone" dataKey="moyenne" stroke="#10b981" strokeWidth={2} dot={{ fill: '#10b981' }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Répartition absences */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Répartition des absences</CardTitle>
              </CardHeader>
              <CardContent>
                {dashData.absencePie.length === 0 ? (
                  <p className="text-center text-muted-foreground text-sm py-8">Aucune donnée d'absence</p>
                ) : (
                  <div className="h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={dashData.absencePie} cx="50%" cy="50%" outerRadius={70} dataKey="value"
                          label={({ name, value }) => `${name}: ${value}`}>
                          {dashData.absencePie.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Alertes RH */}
          {dashData.alertes.length > 0 && (
            <Card className="border-l-4 border-l-red-500">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-500" /> Alertes RH
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  {dashData.alertes.map((a, i) => (
                    <div key={i} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${a.severity === 'red' ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-amber-50 border border-amber-200 text-amber-700'}`}>
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      {a.message}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Tableau résumé mensuel */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Résumé mensuel de l'équipe — {currentMonth}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground">Employé</th>
                      <th className="text-center py-2 px-3 text-xs font-medium text-muted-foreground">Présence</th>
                      <th className="text-center py-2 px-3 text-xs font-medium text-muted-foreground">Retards</th>
                      <th className="text-center py-2 px-3 text-xs font-medium text-muted-foreground">Tâches</th>
                      <th className="text-center py-2 px-3 text-xs font-medium text-muted-foreground">Note</th>
                      <th className="text-center py-2 px-3 text-xs font-medium text-muted-foreground">Statut</th>
                      {canManage && <th className="text-center py-2 px-3 text-xs font-medium text-muted-foreground">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {dashData.resumeMensuel.map((e) => (
                      <tr key={e.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="py-2 px-3">
                          <p className="font-medium">{e.nom}</p>
                          <p className="text-[10px] text-muted-foreground">{e.poste}</p>
                        </td>
                        <td className="py-2 px-3 text-center">{e.presence} j</td>
                        <td className="py-2 px-3 text-center">
                          <span className={e.retards > 3 ? 'text-red-600 font-bold' : ''}>{e.retards}</span>
                        </td>
                        <td className="py-2 px-3 text-center">{e.taches}</td>
                        <td className="py-2 px-3 text-center">
                          {e.note > 0 ? (
                            <div className="flex justify-center"><StarRating value={e.note} readonly /></div>
                          ) : '—'}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <Badge className={`text-[10px] ${
                            e.statut === 'Alerte' ? 'bg-orange-100 text-orange-700' :
                            e.statut === 'Faible' ? 'bg-red-100 text-red-700' :
                            'bg-emerald-100 text-emerald-700'
                          }`}>{e.statut}</Badge>
                        </td>
                        {canManage && (
                          <td className="py-2 px-3 text-center">
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => openNewEval(e.id)}>
                              <Edit3 className="h-3 w-3 mr-1" /> Évaluer
                            </Button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* ═══════════════ TAB PERFORMANCE ═══════════════ */}
      {tab === 'performance' && (
        <>
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold">Évaluations de performance</h3>
            {canManage && (
              <Button className="gap-2" onClick={() => openNewEval()}>
                <Plus className="h-4 w-4" /> Nouvelle évaluation
              </Button>
            )}
          </div>

          {/* Liste des évaluations */}
          {performances.length === 0 ? (
            <Card>
              <CardContent className="text-center py-12 text-muted-foreground">
                <Star className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">Aucune évaluation enregistrée</p>
                <p className="text-sm mt-1">Créez une évaluation mensuelle pour suivre les performances</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Desktop table */}
              <Card>
                <CardContent className="p-0 sm:p-4">
                  <div className="hidden sm:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground">Employé</th>
                          <th className="text-center py-2 px-3 text-xs font-medium text-muted-foreground">Mois</th>
                          <th className="text-center py-2 px-3 text-xs font-medium text-muted-foreground">Présence</th>
                          <th className="text-center py-2 px-3 text-xs font-medium text-muted-foreground">Taux complétion</th>
                          <th className="text-center py-2 px-3 text-xs font-medium text-muted-foreground">Note</th>
                          <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">Prime</th>
                          <th className="text-center py-2 px-3 text-xs font-medium text-muted-foreground">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...performances].sort((a, b) => (b.periode || '').localeCompare(a.periode || '')).map((p) => {
                          const taux = p.tachesAssignees > 0 ? (p.tachesTerminees / p.tachesAssignees * 100) : 0;
                          return (
                            <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30">
                              <td className="py-2 px-3 font-medium">{p.employeNom || '—'}</td>
                              <td className="py-2 px-3 text-center">{p.periode}</td>
                              <td className="py-2 px-3 text-center">{p.joursPresents || 0} / {(p.joursPresents || 0) + (p.joursAbsents || 0)}</td>
                              <td className="py-2 px-3 text-center">
                                <div className="flex items-center justify-center gap-2">
                                  <div className="h-1.5 w-12 rounded-full bg-muted overflow-hidden">
                                    <div className={`h-full rounded-full ${taux >= 70 ? 'bg-emerald-500' : taux >= 50 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${Math.min(100, taux)}%` }} />
                                  </div>
                                  <span className="text-xs">{taux.toFixed(0)}%</span>
                                </div>
                              </td>
                              <td className="py-2 px-3"><div className="flex justify-center"><StarRating value={p.notePerformance || 0} readonly /></div></td>
                              <td className="py-2 px-3 text-right">{p.primeObtenue ? `${fmt(p.primeObtenue)} F` : '—'}</td>
                              <td className="py-2 px-3 text-center">
                                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setShowEvalDetail(p)}>
                                  Détail
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile cards */}
                  <div className="sm:hidden space-y-3 p-3">
                    {[...performances].sort((a, b) => (b.periode || '').localeCompare(a.periode || '')).map((p) => {
                      const taux = p.tachesAssignees > 0 ? (p.tachesTerminees / p.tachesAssignees * 100) : 0;
                      return (
                        <div key={p.id} className="rounded-xl border p-3 space-y-2" onClick={() => setShowEvalDetail(p)}>
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-sm">{p.employeNom}</span>
                            <Badge variant="outline" className="text-[10px]">{p.periode}</Badge>
                          </div>
                          <div className="flex items-center justify-between">
                            <StarRating value={p.notePerformance || 0} readonly />
                            <span className="text-xs text-muted-foreground">Complétion: {taux.toFixed(0)}%</span>
                          </div>
                          {p.primeObtenue && (
                            <Badge className="bg-emerald-100 text-emerald-700 text-[10px]">Prime: {fmt(p.primeObtenue)} F</Badge>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}

      {/* ═══════════════ TAB DEMANDES RH ═══════════════ */}
      {tab === 'demandes' && (
        <>
          <h3 className="text-lg font-bold">Demandes RH</h3>

          {/* En attente */}
          {demandesRH.filter((d) => d.statut === 'en_attente' || d.statut === 'pending').length > 0 && (
            <Card className="border-l-4 border-l-orange-500">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Clock className="h-4 w-4 text-orange-500" /> En attente d'approbation
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {demandesRH.filter((d) => d.statut === 'en_attente' || d.statut === 'pending').map((d) => (
                    <div key={d.id} className="rounded-lg border p-3 flex flex-col sm:flex-row sm:items-center gap-3">
                      <div className="flex-1">
                        <p className="text-sm font-medium">{d.employe_nom || '—'}</p>
                        <p className="text-xs text-muted-foreground">
                          {d.type === 'conge' ? 'Congé' : d.type === 'modification_rapport' ? 'Modification rapport' : d.type || '—'}
                          {d.date_debut && d.date_fin && ` — du ${d.date_debut} au ${d.date_fin}`}
                        </p>
                        {d.motif && <p className="text-xs mt-1">{d.motif}</p>}
                      </div>
                      {canManage && (
                        <div className="flex gap-2 shrink-0">
                          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 gap-1" onClick={() => handleDemandeAction(d, 'approve')}>
                            <Check className="h-3.5 w-3.5" /> Approuver
                          </Button>
                          <Button size="sm" variant="destructive" className="gap-1" onClick={() => handleDemandeAction(d, 'reject')}>
                            <Ban className="h-3.5 w-3.5" /> Rejeter
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Historique */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Toutes les demandes</CardTitle>
            </CardHeader>
            <CardContent>
              {demandesRH.length === 0 ? (
                <p className="text-center text-muted-foreground text-sm py-8">Aucune demande RH</p>
              ) : (
                <div className="space-y-2">
                  {[...demandesRH].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).map((d) => (
                    <div key={d.id} className="flex items-center justify-between rounded-lg border px-3 py-2.5">
                      <div>
                        <p className="text-sm font-medium">{d.employe_nom || '—'}</p>
                        <p className="text-xs text-muted-foreground">
                          {d.type === 'conge' ? 'Congé' : d.type || '—'} — {d.created_at?.slice(0, 10) || ''}
                        </p>
                      </div>
                      <Badge className={`text-[10px] ${
                        d.statut === 'approuve' ? 'bg-emerald-100 text-emerald-700' :
                        d.statut === 'rejete' ? 'bg-red-100 text-red-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>
                        {d.statut === 'approuve' ? 'Approuvé' : d.statut === 'rejete' ? 'Rejeté' : 'En attente'}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* ═══════════════ MODAL ÉVALUATION ═══════════════ */}
      <Dialog open={showEvalForm} onOpenChange={setShowEvalForm}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Star className="h-5 w-5 text-amber-500" /> Évaluation mensuelle
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Employé *</label>
                <select className="w-full rounded-md border px-3 py-2 text-sm" value={evalForm.employeId} onChange={(e) => setEvalForm({ ...evalForm, employeId: e.target.value })}>
                  <option value="">Sélectionner...</option>
                  {employes.map((e) => <option key={e.id} value={e.id}>{e.prenom} {e.nom}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Période *</label>
                <Input type="month" value={evalForm.periode} onChange={(e) => setEvalForm({ ...evalForm, periode: e.target.value })} />
              </div>
            </div>

            <div className="rounded-lg bg-blue-50 p-3">
              <p className="text-xs font-semibold text-blue-700 mb-2">Ponctualité</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div><label className="text-[10px] text-muted-foreground">Jours présents</label><Input type="number" value={evalForm.joursPresents} onChange={(e) => setEvalForm({ ...evalForm, joursPresents: e.target.value })} className="h-8 text-sm" /></div>
                <div><label className="text-[10px] text-muted-foreground">Jours absents</label><Input type="number" value={evalForm.joursAbsents} onChange={(e) => setEvalForm({ ...evalForm, joursAbsents: e.target.value })} className="h-8 text-sm" /></div>
                <div><label className="text-[10px] text-muted-foreground">Retards</label><Input type="number" value={evalForm.retards} onChange={(e) => setEvalForm({ ...evalForm, retards: e.target.value })} className="h-8 text-sm" /></div>
                <div><label className="text-[10px] text-muted-foreground">Heures travaillées</label><Input type="number" value={evalForm.totalHeuresTravaillees} onChange={(e) => setEvalForm({ ...evalForm, totalHeuresTravaillees: e.target.value })} className="h-8 text-sm" /></div>
              </div>
            </div>

            <div className="rounded-lg bg-emerald-50 p-3">
              <p className="text-xs font-semibold text-emerald-700 mb-2">Tâches & Production</p>
              <div className="grid grid-cols-3 gap-2">
                <div><label className="text-[10px] text-muted-foreground">Assignées</label><Input type="number" value={evalForm.tachesAssignees} onChange={(e) => setEvalForm({ ...evalForm, tachesAssignees: e.target.value })} className="h-8 text-sm" /></div>
                <div><label className="text-[10px] text-muted-foreground">Terminées</label><Input type="number" value={evalForm.tachesTerminees} onChange={(e) => setEvalForm({ ...evalForm, tachesTerminees: e.target.value })} className="h-8 text-sm" /></div>
                <div><label className="text-[10px] text-muted-foreground">En retard</label><Input type="number" value={evalForm.tachesEnRetard} onChange={(e) => setEvalForm({ ...evalForm, tachesEnRetard: e.target.value })} className="h-8 text-sm" /></div>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">Note de performance (1-5)</label>
              <StarRating value={evalForm.notePerformance} onChange={(v) => setEvalForm({ ...evalForm, notePerformance: v })} />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Commentaire du manager</label>
              <textarea className="w-full rounded-md border px-3 py-2 text-sm min-h-[60px] resize-none" value={evalForm.commentaireManager} onChange={(e) => setEvalForm({ ...evalForm, commentaireManager: e.target.value })} placeholder="Appréciation générale..." />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Points forts</label>
                <Input value={evalForm.pointsForts} onChange={(e) => setEvalForm({ ...evalForm, pointsForts: e.target.value })} placeholder="Ex: Ponctuel, Efficace..." className="text-sm" />
                <p className="text-[9px] text-muted-foreground mt-0.5">Séparer par des virgules</p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Points à améliorer</label>
                <Input value={evalForm.pointsAmeliorer} onChange={(e) => setEvalForm({ ...evalForm, pointsAmeliorer: e.target.value })} placeholder="Ex: Communication..." className="text-sm" />
                <p className="text-[9px] text-muted-foreground mt-0.5">Séparer par des virgules</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Prime (FCFA)</label>
                <Input type="number" value={evalForm.primeObtenue} onChange={(e) => setEvalForm({ ...evalForm, primeObtenue: e.target.value })} placeholder="0" className="text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Motif prime</label>
                <Input value={evalForm.motifPrime} onChange={(e) => setEvalForm({ ...evalForm, motifPrime: e.target.value })} placeholder="Raison de la prime..." className="text-sm" />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Observations</label>
              <Input value={evalForm.observations} onChange={(e) => setEvalForm({ ...evalForm, observations: e.target.value })} placeholder="Notes additionnelles..." className="text-sm" />
            </div>

            <Button className="w-full" onClick={handleSubmitEval}>Valider l'évaluation</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ═══════════════ MODAL DETAIL ÉVALUATION ═══════════════ */}
      <Dialog open={!!showEvalDetail} onOpenChange={() => setShowEvalDetail(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          {showEvalDetail && (() => {
            const p = showEvalDetail;
            const taux = p.tachesAssignees > 0 ? (p.tachesTerminees / p.tachesAssignees * 100) : 0;
            return (
              <>
                <DialogHeader>
                  <DialogTitle>Fiche Performance — {p.employeNom}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <div className="rounded-lg bg-muted/50 p-3 text-center">
                    <p className="text-xs text-muted-foreground">Période évaluée</p>
                    <p className="font-bold">{p.periode}</p>
                  </div>

                  {/* Ponctualité */}
                  <Card>
                    <CardHeader className="pb-1"><CardTitle className="text-xs flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 text-blue-500" /> Ponctualité</CardTitle></CardHeader>
                    <CardContent className="pt-2">
                      <div className="grid grid-cols-4 gap-2 text-center">
                        <div><p className="text-[9px] text-muted-foreground">Présents</p><p className="font-bold text-emerald-600">{p.joursPresents || 0}</p></div>
                        <div><p className="text-[9px] text-muted-foreground">Absents</p><p className="font-bold text-red-500">{p.joursAbsents || 0}</p></div>
                        <div><p className="text-[9px] text-muted-foreground">Retards</p><p className="font-bold text-amber-500">{p.retards || 0}</p></div>
                        <div><p className="text-[9px] text-muted-foreground">Heures</p><p className="font-bold">{p.totalHeuresTravaillees || 0}h</p></div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Tâches */}
                  <Card>
                    <CardHeader className="pb-1"><CardTitle className="text-xs flex items-center gap-1.5"><ClipboardList className="h-3.5 w-3.5 text-emerald-500" /> Tâches</CardTitle></CardHeader>
                    <CardContent className="pt-2">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-3 rounded-full bg-muted overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${taux >= 70 ? 'bg-emerald-500' : taux >= 50 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${Math.min(100, taux)}%` }} />
                        </div>
                        <span className="text-sm font-bold">{taux.toFixed(0)}%</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center mt-2">
                        <div><p className="text-[9px] text-muted-foreground">Assignées</p><p className="font-bold">{p.tachesAssignees || 0}</p></div>
                        <div><p className="text-[9px] text-muted-foreground">Terminées</p><p className="font-bold text-emerald-600">{p.tachesTerminees || 0}</p></div>
                        <div><p className="text-[9px] text-muted-foreground">En retard</p><p className="font-bold text-red-500">{p.tachesEnRetard || 0}</p></div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Note globale */}
                  <Card>
                    <CardHeader className="pb-1"><CardTitle className="text-xs flex items-center gap-1.5"><Star className="h-3.5 w-3.5 text-amber-500" /> Note globale</CardTitle></CardHeader>
                    <CardContent className="pt-2 text-center">
                      <StarRating value={p.notePerformance || 0} readonly />
                      {p.commentaireManager && <p className="text-sm text-muted-foreground mt-2 italic">"{p.commentaireManager}"</p>}
                    </CardContent>
                  </Card>

                  {/* Tags */}
                  <div className="grid grid-cols-2 gap-3">
                    {p.pointsForts?.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-emerald-700 mb-1">Points forts</p>
                        <div className="flex flex-wrap gap-1">
                          {p.pointsForts.map((pf, i) => <Badge key={i} className="bg-emerald-100 text-emerald-700 text-[10px]">{pf}</Badge>)}
                        </div>
                      </div>
                    )}
                    {p.pointsAmeliorer?.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-amber-700 mb-1">À améliorer</p>
                        <div className="flex flex-wrap gap-1">
                          {p.pointsAmeliorer.map((pa, i) => <Badge key={i} className="bg-amber-100 text-amber-700 text-[10px]">{pa}</Badge>)}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Prime */}
                  {p.primeObtenue && (
                    <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3">
                      <p className="text-xs font-semibold text-emerald-700 flex items-center gap-1"><Award className="h-3.5 w-3.5" /> Prime obtenue</p>
                      <p className="text-lg font-bold text-emerald-700 mt-1">{fmt(p.primeObtenue)} FCFA</p>
                      {p.motifPrime && <p className="text-xs text-emerald-600 mt-0.5">{p.motifPrime}</p>}
                    </div>
                  )}

                  {p.observations && (
                    <div className="rounded-lg bg-muted/50 p-3">
                      <p className="text-xs font-semibold text-muted-foreground mb-1">Observations</p>
                      <p className="text-sm">{p.observations}</p>
                    </div>
                  )}

                  <p className="text-[10px] text-muted-foreground text-center">
                    Évaluation par {p.auteurNom || '—'} — {p.updated_at?.slice(0, 10) || p.created_at?.slice(0, 10) || ''}
                  </p>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
