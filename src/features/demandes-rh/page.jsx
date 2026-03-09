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
  Home, Zap, Wrench, ShoppingCart, MoreHorizontal, TrendingUp,
  Wallet, Building2,
} from 'lucide-react';
import { toast } from 'sonner';

function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)); }

/* ── Types de demandes RH ── */
const TYPES_RH = {
  conge: { label: 'Congé', icon: Calendar, color: 'bg-blue-100 text-blue-700', category: 'rh' },
  avance: { label: 'Avance salaire', icon: DollarSign, color: 'bg-emerald-100 text-emerald-700', category: 'rh' },
  formation: { label: 'Formation', icon: GraduationCap, color: 'bg-violet-100 text-violet-700', category: 'rh' },
  document: { label: 'Document', icon: FileText, color: 'bg-amber-100 text-amber-700', category: 'rh' },
  autre_rh: { label: 'Autre (RH)', icon: Briefcase, color: 'bg-slate-100 text-slate-700', category: 'rh' },
};

/* ── Types de charges de l'entreprise ── */
const TYPES_CHARGES = {
  loyer: { label: 'Loyer', icon: Home, color: 'bg-orange-100 text-orange-700', category: 'charge' },
  electricite_eau: { label: 'Électricité / Eau', icon: Zap, color: 'bg-yellow-100 text-yellow-700', category: 'charge' },
  charge_fonctionnement: { label: 'Charge de fonctionnement', icon: Wrench, color: 'bg-cyan-100 text-cyan-700', category: 'charge' },
  achat_materiel: { label: 'Achat matériel', icon: ShoppingCart, color: 'bg-pink-100 text-pink-700', category: 'charge' },
  charge_autre: { label: 'Autre charge', icon: MoreHorizontal, color: 'bg-gray-100 text-gray-700', category: 'charge' },
};

const ALL_TYPES = { ...TYPES_RH, ...TYPES_CHARGES };

const STATUTS = {
  en_attente: { label: 'En attente', color: 'bg-amber-100 text-amber-700' },
  approuvee: { label: 'Approuvée', color: 'bg-emerald-100 text-emerald-700' },
  rejetee: { label: 'Rejetée', color: 'bg-red-100 text-red-700' },
  payee: { label: 'Payée', color: 'bg-blue-100 text-blue-700' },
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
  const [filterCategory, setFilterCategory] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    type: 'conge', motif: '', date_debut: '', date_fin: '',
    montant: '', employe_id: '', employe_nom: '',
  });

  const load = async () => {
    const [d, e] = await Promise.all([db.demandes_rh.list(), db.employes.list()]);
    setDemandes(d.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')));
    setEmployes(e.filter((emp) => emp.role !== 'client'));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    return demandes.filter((d) => {
      if (!isAdmin && d.user_id !== user?.id) return false;
      if (filterCategory !== 'all') {
        const typeConfig = ALL_TYPES[d.type];
        if (typeConfig && typeConfig.category !== filterCategory) return false;
        // Legacy: old "autre" type → rh
        if (!typeConfig && d.type === 'autre' && filterCategory !== 'rh') return false;
      }
      if (filterType !== 'all' && d.type !== filterType) return false;
      if (filterStatut !== 'all' && d.statut !== filterStatut) return false;
      if (search) {
        const q = search.toLowerCase();
        return `${d.user_nom || ''} ${d.motif || ''} ${d.type} ${d.employe_nom || ''}`.toLowerCase().includes(q);
      }
      return true;
    });
  }, [demandes, search, filterType, filterStatut, filterCategory, isAdmin, user]);

  /* ── KPIs enrichis ── */
  const stats = useMemo(() => {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const thisMonth = demandes.filter((d) => (d.created_at || '').startsWith(currentMonth));

    const chargeTypes = Object.keys(TYPES_CHARGES);
    const chargesMois = thisMonth.filter((d) => chargeTypes.includes(d.type));

    const avancesApprouvees = demandes.filter((d) => d.type === 'avance' && (d.statut === 'approuvee' || d.statut === 'payee'));
    const totalAvances = avancesApprouvees.reduce((s, d) => s + (d.montant || 0), 0);

    const totalChargesMois = chargesMois
      .filter((d) => d.statut === 'approuvee' || d.statut === 'payee')
      .reduce((s, d) => s + (d.montant || 0), 0);

    return {
      total: demandes.length,
      en_attente: demandes.filter((d) => d.statut === 'en_attente').length,
      totalAvances,
      totalChargesMois,
    };
  }, [demandes]);

  const isChargeType = (type) => Object.keys(TYPES_CHARGES).includes(type);
  const needsMontant = (type) => ['avance', 'formation', ...Object.keys(TYPES_CHARGES)].includes(type);

  const handleSubmit = async () => {
    if (!form.motif.trim()) { toast.error('Motif requis'); return; }
    if (needsMontant(form.type) && (!form.montant || Number(form.montant) <= 0)) {
      toast.error('Montant requis'); return;
    }

    const isCharge = isChargeType(form.type);
    const payload = {
      type: form.type,
      motif: form.motif,
      date_debut: form.date_debut || undefined,
      date_fin: form.date_fin || undefined,
      montant: Number(form.montant) || 0,
      statut: 'en_attente',
      category: isCharge ? 'charge' : 'rh',
      user_id: user?.id,
      user_nom: `${user?.prenom} ${user?.nom}`,
    };

    if (isCharge && form.employe_id) {
      const emp = employes.find((e) => e.id === form.employe_id);
      payload.employe_id = form.employe_id;
      payload.employe_nom = emp ? `${emp.prenom} ${emp.nom}` : '';
    }

    await db.demandes_rh.create(payload);
    await logAction('create', 'demandes_rh', { entityLabel: `${ALL_TYPES[form.type]?.label} - ${user?.prenom}` });
    toast.success(isCharge ? 'Charge enregistrée' : 'Demande envoyée');
    setShowForm(false);
    setForm({ type: 'conge', motif: '', date_debut: '', date_fin: '', montant: '', employe_id: '', employe_nom: '' });
    load();
  };

  const handleDecision = async (d, decision) => {
    const label = decision === 'approuvee' ? 'approbation' : decision === 'payee' ? 'paiement' : 'rejet';
    const commentaire = prompt(`Commentaire pour ${label} :`);
    if (commentaire === null) return;
    await db.demandes_rh.update(d.id, {
      statut: decision,
      commentaire_admin: commentaire,
      date_decision: new Date().toISOString(),
    });
    await logAction('update', 'demandes_rh', { entityId: d.id, entityLabel: d.user_nom, details: `Demande ${decision}` });
    toast.success(`Demande ${decision === 'approuvee' ? 'approuvée' : decision === 'payee' ? 'marquée payée' : 'rejetée'}`);
    load();
  };

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Demandes RH & Charges</h2>
          <p className="text-muted-foreground">Congés, avances, formations, charges de fonctionnement</p>
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <Button variant="outline" className="gap-2" onClick={() => { setForm({ type: 'loyer', motif: '', date_debut: '', date_fin: '', montant: '', employe_id: '', employe_nom: '' }); setShowForm(true); }}>
              <Building2 className="h-4 w-4" /> Nouvelle charge
            </Button>
          )}
          <Button className="gap-2" onClick={() => { setForm({ type: 'conge', motif: '', date_debut: '', date_fin: '', montant: '', employe_id: '', employe_nom: '' }); setShowForm(true); }}>
            <Plus className="h-4 w-4" /> Demande RH
          </Button>
        </div>
      </div>

      {/* KPIs enrichis */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Total demandes', value: stats.total, icon: ClipboardList, color: 'bg-primary/10 text-primary' },
          { label: 'En attente', value: stats.en_attente, icon: Clock, color: 'bg-amber-500/10 text-amber-600' },
          { label: 'Avances accordées', value: `${fmt(stats.totalAvances)} F`, icon: Wallet, color: 'bg-emerald-500/10 text-emerald-600', isText: true },
          { label: 'Charges du mois', value: `${fmt(stats.totalChargesMois)} F`, icon: TrendingUp, color: 'bg-blue-500/10 text-blue-600', isText: true },
        ].map(({ label, value, icon: Icon, color, isText }) => (
          <Card key={label}><CardContent className="p-3"><div className="flex items-center gap-2">
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}><Icon className="h-4 w-4" /></div>
            <div><p className="text-[10px] text-muted-foreground">{label}</p><p className={`${isText ? 'text-sm' : 'text-base'} font-bold`}>{value}</p></div>
          </div></CardContent></Card>
        ))}
      </div>

      {/* Filtres */}
      <div className="flex flex-col gap-3 sm:flex-row flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Rechercher..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes catégories</SelectItem>
            <SelectItem value="rh">Demandes RH</SelectItem>
            <SelectItem value="charge">Charges</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous types</SelectItem>
            {Object.entries(ALL_TYPES).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatut} onValueChange={setFilterStatut}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous statuts</SelectItem>
            {Object.entries(STATUTS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Liste */}
      <div className="space-y-3">
        {filtered.map((d) => {
          const t = ALL_TYPES[d.type] || ALL_TYPES.autre_rh;
          const st = STATUTS[d.statut] || STATUTS.en_attente;
          const TypeIcon = t.icon;
          const isCharge = t.category === 'charge';
          return (
            <Card key={d.id}>
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg shrink-0 ${t.color}`}><TypeIcon className="h-5 w-5" /></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm">{t.label}</p>
                      <Badge className={`text-[10px] ${st.color}`}>{st.label}</Badge>
                      {isCharge && <Badge variant="outline" className="text-[10px]">Charge</Badge>}
                      {isAdmin && <span className="text-xs text-muted-foreground"><User className="inline h-3 w-3" /> {d.user_nom}</span>}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{d.motif}</p>
                    <div className="flex items-center gap-4 mt-2 text-[10px] text-muted-foreground flex-wrap">
                      {d.date_debut && <span><Calendar className="inline h-3 w-3" /> {new Date(d.date_debut).toLocaleDateString('fr-FR')}{d.date_fin ? ` → ${new Date(d.date_fin).toLocaleDateString('fr-FR')}` : ''}</span>}
                      {d.montant > 0 && <span className="font-semibold text-emerald-600">{fmt(d.montant)} F</span>}
                      {d.employe_nom && <span><User className="inline h-3 w-3" /> {d.employe_nom}</span>}
                      {d.created_at && <span>{new Date(d.created_at).toLocaleDateString('fr-FR')}</span>}
                    </div>
                    {d.commentaire_admin && (
                      <p className="mt-2 rounded-lg bg-muted/50 p-2 text-xs italic text-muted-foreground">Admin: {d.commentaire_admin}</p>
                    )}
                  </div>
                  {isAdmin && d.statut === 'en_attente' && (
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => handleDecision(d, 'approuvee')} className="rounded-lg p-2 text-emerald-600 hover:bg-emerald-50" title="Approuver"><CheckCircle2 className="h-5 w-5" /></button>
                      <button onClick={() => handleDecision(d, 'rejetee')} className="rounded-lg p-2 text-red-600 hover:bg-red-50" title="Rejeter"><XCircle className="h-5 w-5" /></button>
                    </div>
                  )}
                  {isAdmin && d.statut === 'approuvee' && d.montant > 0 && (
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => handleDecision(d, 'payee')} className="rounded-lg p-2 text-blue-600 hover:bg-blue-50" title="Marquer payée"><DollarSign className="h-5 w-5" /></button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filtered.length === 0 && <div className="flex flex-col items-center justify-center py-16"><ClipboardList className="mb-4 h-12 w-12 text-muted-foreground/30" /><p className="text-muted-foreground">Aucune demande</p></div>}

      {/* ── Résumé charges du mois (admin/manager) ── */}
      {isAdmin && (
        <Card>
          <CardContent className="p-4">
            <h3 className="font-semibold text-sm flex items-center gap-2 mb-3">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              Charges du mois en cours
            </h3>
            <div className="space-y-2">
              {Object.entries(TYPES_CHARGES).map(([key, config]) => {
                const currentMonth = new Date().toISOString().slice(0, 7);
                const items = demandes.filter((d) => d.type === key && (d.created_at || '').startsWith(currentMonth));
                const total = items.filter((d) => d.statut === 'approuvee' || d.statut === 'payee').reduce((s, d) => s + (d.montant || 0), 0);
                const pending = items.filter((d) => d.statut === 'en_attente').reduce((s, d) => s + (d.montant || 0), 0);
                const Icon = config.icon;
                return (
                  <div key={key} className="flex items-center gap-3 rounded-lg border p-2.5">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg shrink-0 ${config.color}`}><Icon className="h-4 w-4" /></div>
                    <div className="flex-1">
                      <p className="text-xs font-medium">{config.label}</p>
                      <p className="text-[10px] text-muted-foreground">{items.length} entrée(s) ce mois</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold">{fmt(total)} F</p>
                      {pending > 0 && <p className="text-[10px] text-amber-600">{fmt(pending)} F en attente</p>}
                    </div>
                  </div>
                );
              })}
              <div className="flex items-center justify-between rounded-lg bg-primary/5 p-3 mt-2">
                <p className="font-semibold text-sm">Total charges du mois</p>
                <p className="font-bold text-lg">{fmt(stats.totalChargesMois)} F</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Dialog formulaire ── */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{isChargeType(form.type) ? 'Nouvelle charge' : 'Nouvelle demande RH'}</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Type</label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPES_RH).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                  {isAdmin && Object.entries(TYPES_CHARGES).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">Motif / Description *</label>
              <textarea
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.motif}
                onChange={(e) => setForm({ ...form, motif: e.target.value })}
                placeholder={isChargeType(form.type) ? 'Description de la charge...' : 'Décrivez votre demande...'}
              />
            </div>

            {form.type === 'conge' && (
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1.5 block text-sm font-medium">Date début</label><Input type="date" value={form.date_debut} onChange={(e) => setForm({ ...form, date_debut: e.target.value })} /></div>
                <div><label className="mb-1.5 block text-sm font-medium">Date fin</label><Input type="date" value={form.date_fin} onChange={(e) => setForm({ ...form, date_fin: e.target.value })} /></div>
              </div>
            )}

            {needsMontant(form.type) && (
              <div><label className="mb-1.5 block text-sm font-medium">Montant (F CFA) *</label><Input type="number" value={form.montant} onChange={(e) => setForm({ ...form, montant: e.target.value })} placeholder="0" /></div>
            )}

            {isChargeType(form.type) && isAdmin && (
              <div>
                <label className="mb-1.5 block text-sm font-medium">Employé concerné (optionnel)</label>
                <Select value={form.employe_id || '__none__'} onValueChange={(v) => {
                  const empId = v === '__none__' ? '' : v;
                  const emp = employes.find((e) => e.id === empId);
                  setForm({ ...form, employe_id: empId, employe_nom: emp ? `${emp.prenom} ${emp.nom}` : '' });
                }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Société —</SelectItem>
                    {employes.map((emp) => (
                      <SelectItem key={emp.id} value={emp.id}>{emp.prenom} {emp.nom}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <Button className="w-full" onClick={handleSubmit}>
              {isChargeType(form.type) ? 'Enregistrer la charge' : 'Envoyer la demande'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
