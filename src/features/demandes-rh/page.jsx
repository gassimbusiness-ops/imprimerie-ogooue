import { useState, useEffect, useMemo } from 'react';
import { db } from '@/services/db';
import { useAuth } from '@/services/auth';
import { logAction } from '@/services/audit';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ClipboardList, Plus, Search, Calendar, CheckCircle2, XCircle,
  Clock, User, FileText, DollarSign, GraduationCap, Briefcase,
} from 'lucide-react';
import { toast } from 'sonner';

function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)); }

const TYPES = {
  conge: { label: 'Congé', icon: Calendar, color: 'bg-blue-100 text-blue-700' },
  avance: { label: 'Avance salaire', icon: DollarSign, color: 'bg-emerald-100 text-emerald-700' },
  formation: { label: 'Formation', icon: GraduationCap, color: 'bg-violet-100 text-violet-700' },
  document: { label: 'Document', icon: FileText, color: 'bg-amber-100 text-amber-700' },
  autre: { label: 'Autre', icon: Briefcase, color: 'bg-slate-100 text-slate-700' },
};

const STATUTS = {
  en_attente: { label: 'En attente', color: 'bg-amber-100 text-amber-700' },
  approuvee: { label: 'Approuvée', color: 'bg-emerald-100 text-emerald-700' },
  rejetee: { label: 'Rejetée', color: 'bg-red-100 text-red-700' },
};

export default function DemandesRH() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';
  const [demandes, setDemandes] = useState([]);
  const [employes, setEmployes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterStatut, setFilterStatut] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ type: 'conge', motif: '', date_debut: '', date_fin: '', montant: '' });

  const load = async () => {
    const [d, e] = await Promise.all([db.demandes_rh.list(), db.employes.list()]);
    setDemandes(d.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')));
    setEmployes(e);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    return demandes.filter((d) => {
      if (!isAdmin && d.user_id !== user?.id) return false;
      if (filterType !== 'all' && d.type !== filterType) return false;
      if (filterStatut !== 'all' && d.statut !== filterStatut) return false;
      if (search) {
        const q = search.toLowerCase();
        return `${d.user_nom || ''} ${d.motif || ''} ${d.type}`.toLowerCase().includes(q);
      }
      return true;
    });
  }, [demandes, search, filterType, filterStatut, isAdmin, user]);

  const stats = useMemo(() => ({
    total: demandes.length,
    en_attente: demandes.filter((d) => d.statut === 'en_attente').length,
    approuvees: demandes.filter((d) => d.statut === 'approuvee').length,
    rejetees: demandes.filter((d) => d.statut === 'rejetee').length,
  }), [demandes]);

  const handleSubmit = async () => {
    if (!form.motif.trim()) { toast.error('Motif requis'); return; }
    await db.demandes_rh.create({
      ...form,
      montant: Number(form.montant) || 0,
      statut: 'en_attente',
      user_id: user?.id, user_nom: `${user?.prenom} ${user?.nom}`,
    });
    await logAction('create', 'demandes_rh', { entityLabel: `${TYPES[form.type]?.label} - ${user?.prenom}` });
    toast.success('Demande envoyée');
    setShowForm(false);
    load();
  };

  const handleDecision = async (d, decision) => {
    const commentaire = prompt(`Commentaire pour ${decision === 'approuvee' ? 'approbation' : 'rejet'} :`);
    if (commentaire === null) return;
    await db.demandes_rh.update(d.id, { statut: decision, commentaire_admin: commentaire, date_decision: new Date().toISOString() });
    await logAction('update', 'demandes_rh', { entityId: d.id, entityLabel: d.user_nom, details: `Demande ${decision}` });
    toast.success(`Demande ${decision === 'approuvee' ? 'approuvée' : 'rejetée'}`);
    load();
  };

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-2xl font-bold tracking-tight">Demandes RH</h2><p className="text-muted-foreground">Congés, avances, formations, documents</p></div>
        <Button className="gap-2" onClick={() => { setForm({ type: 'conge', motif: '', date_debut: '', date_fin: '', montant: '' }); setShowForm(true); }}>
          <Plus className="h-4 w-4" /> Nouvelle demande
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Total', value: stats.total, icon: ClipboardList, color: 'bg-primary/10 text-primary' },
          { label: 'En attente', value: stats.en_attente, icon: Clock, color: 'bg-amber-500/10 text-amber-600' },
          { label: 'Approuvées', value: stats.approuvees, icon: CheckCircle2, color: 'bg-emerald-500/10 text-emerald-600' },
          { label: 'Rejetées', value: stats.rejetees, icon: XCircle, color: 'bg-red-500/10 text-red-600' },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}><CardContent className="p-3"><div className="flex items-center gap-2">
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}><Icon className="h-4 w-4" /></div>
            <div><p className="text-[10px] text-muted-foreground">{label}</p><p className="text-base font-bold">{value}</p></div>
          </div></CardContent></Card>
        ))}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input placeholder="Rechercher..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" /></div>
        <Select value={filterType} onValueChange={setFilterType}><SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Tous types</SelectItem>{Object.entries(TYPES).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent></Select>
        <Select value={filterStatut} onValueChange={setFilterStatut}><SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Tous statuts</SelectItem>{Object.entries(STATUTS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent></Select>
      </div>

      <div className="space-y-3">
        {filtered.map((d) => {
          const t = TYPES[d.type] || TYPES.autre;
          const st = STATUTS[d.statut] || STATUTS.en_attente;
          const TypeIcon = t.icon;
          return (
            <Card key={d.id}>
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg shrink-0 ${t.color}`}><TypeIcon className="h-5 w-5" /></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm">{t.label}</p>
                      <Badge className={`text-[10px] ${st.color}`}>{st.label}</Badge>
                      {isAdmin && <span className="text-xs text-muted-foreground"><User className="inline h-3 w-3" /> {d.user_nom}</span>}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{d.motif}</p>
                    <div className="flex items-center gap-4 mt-2 text-[10px] text-muted-foreground">
                      {d.date_debut && <span><Calendar className="inline h-3 w-3" /> {new Date(d.date_debut).toLocaleDateString('fr-FR')}{d.date_fin ? ` → ${new Date(d.date_fin).toLocaleDateString('fr-FR')}` : ''}</span>}
                      {d.montant > 0 && <span className="font-semibold text-emerald-600">{fmt(d.montant)} F</span>}
                    </div>
                    {d.commentaire_admin && (
                      <p className="mt-2 rounded-lg bg-muted/50 p-2 text-xs italic text-muted-foreground">Admin: {d.commentaire_admin}</p>
                    )}
                  </div>
                  {isAdmin && d.statut === 'en_attente' && (
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => handleDecision(d, 'approuvee')} className="rounded-lg p-2 text-emerald-600 hover:bg-emerald-50"><CheckCircle2 className="h-5 w-5" /></button>
                      <button onClick={() => handleDecision(d, 'rejetee')} className="rounded-lg p-2 text-red-600 hover:bg-red-50"><XCircle className="h-5 w-5" /></button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filtered.length === 0 && <div className="flex flex-col items-center justify-center py-16"><ClipboardList className="mb-4 h-12 w-12 text-muted-foreground/30" /><p className="text-muted-foreground">Aucune demande</p></div>}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle>Nouvelle demande</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div><label className="mb-1.5 block text-sm font-medium">Type</label><Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(TYPES).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="mb-1.5 block text-sm font-medium">Motif *</label><textarea className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.motif} onChange={(e) => setForm({ ...form, motif: e.target.value })} placeholder="Décrivez votre demande..." /></div>
            {(form.type === 'conge') && (
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1.5 block text-sm font-medium">Date début</label><Input type="date" value={form.date_debut} onChange={(e) => setForm({ ...form, date_debut: e.target.value })} /></div>
                <div><label className="mb-1.5 block text-sm font-medium">Date fin</label><Input type="date" value={form.date_fin} onChange={(e) => setForm({ ...form, date_fin: e.target.value })} /></div>
              </div>
            )}
            {(form.type === 'avance' || form.type === 'formation') && (
              <div><label className="mb-1.5 block text-sm font-medium">Montant (F CFA)</label><Input type="number" value={form.montant} onChange={(e) => setForm({ ...form, montant: e.target.value })} /></div>
            )}
            <Button className="w-full" onClick={handleSubmit}>Envoyer la demande</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
