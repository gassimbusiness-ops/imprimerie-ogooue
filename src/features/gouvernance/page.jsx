import { useState, useEffect, useMemo } from 'react';
import { db } from '@/services/db';
import { logAction } from '@/services/audit';
import { useAuth } from '@/services/auth';
import { FINANCIAL_SUMMARY, MACHINES, INVENTAIRE_STOCK } from '@/utils/seed-data';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import {
  Crown, TrendingUp, Landmark, DollarSign, Users, Plus, ArrowDownCircle,
  Building2, Wallet, CreditCard, PiggyBank, Shield, History,
} from 'lucide-react';
import { toast } from 'sonner';

function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)); }
function pct(n) { return (n || 0).toFixed(1) + '%'; }

// ─── Algorithme de dilution ───
// Capital initial: Oumar 3M + 1.965M Chine = 4.965M, Senouss 2.5M → Total 7.465M
// Bonus gestion Oumar: +5% → Oumar 70% / Senouss 30% (arrondi convenu)
// Nouveaux apports: convertis en parts au prorata de la valorisation
function computeCapTable(apports, capitalBase = 7465000) {
  // Base shares
  let oumarShares = 70; // % convenu
  let senoussShares = 30;

  // Extra apports post-creation
  const extraApports = apports.filter((a) => a.type === 'apport_capital');
  const totalExtra = extraApports.reduce((s, a) => s + (a.montant || 0), 0);

  if (totalExtra > 0) {
    // Dilution: new_total = capitalBase + totalExtra
    // New investor % = apport / new_total * 100
    const newTotal = capitalBase + totalExtra;
    const oumarExtra = extraApports.filter((a) => a.associe === 'oumar').reduce((s, a) => s + a.montant, 0);
    const senoussExtra = extraApports.filter((a) => a.associe === 'senouss').reduce((s, a) => s + a.montant, 0);

    const oumarTotal = (capitalBase * 0.70) + oumarExtra;
    const senoussTotal = (capitalBase * 0.30) + senoussExtra;
    const grandTotal = oumarTotal + senoussTotal;

    oumarShares = (oumarTotal / grandTotal) * 100;
    senoussShares = (senoussTotal / grandTotal) * 100;
  }

  return { oumar: oumarShares, senouss: senoussShares, totalCapital: capitalBase + totalExtra };
}

const COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#8b5cf6'];

export default function Gouvernance() {
  const { user } = useAuth();
  const [apports, setApports] = useState([]);
  const [dettes, setDettes] = useState([]);
  const [remboursements, setRemboursements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showApportForm, setShowApportForm] = useState(false);
  const [showRemboursementForm, setShowRemboursementForm] = useState(false);
  const [apportForm, setApportForm] = useState({ associe: 'oumar', type: 'apport_capital', montant: '', description: '', date: new Date().toISOString().slice(0, 10) });
  const [rembForm, setRembForm] = useState({ montant: '', date: new Date().toISOString().slice(0, 10), description: '' });

  const load = async () => {
    const [a, d, r] = await Promise.all([
      db.apports_associes.list(),
      db.dettes_associes.list(),
      db.remboursements_associes.list(),
    ]);
    setApports(a);
    setDettes(d);
    setRemboursements(r);
    setLoading(false);
  };

  useEffect(() => {
    // Seed initial apport for Oumar's 2M marchandise if not present
    (async () => {
      const existing = await db.apports_associes.list();
      if (existing.length === 0) {
        await db.apports_associes.create({
          associe: 'oumar', type: 'apport_capital', montant: 2000000,
          description: 'Réinvestissement en marchandises', date: '2025-06-15',
        });
        // Seed dette Oumar
        const existingDettes = await db.dettes_associes.list();
        if (existingDettes.length === 0) {
          await db.dettes_associes.create({
            associe: 'oumar', montant_initial: 2300000, montant_restant: 2300000,
            description: 'Compte courant d\'associé — avances et dépenses', date: '2025-03-01',
          });
        }
      }
      load();
    })();
  }, []);

  // Cap table calculation
  const capTable = useMemo(() => computeCapTable(apports), [apports]);

  // Dette restante
  const detteInfo = useMemo(() => {
    const dette = dettes.find((d) => d.associe === 'oumar');
    const totalRemb = remboursements.reduce((s, r) => s + (r.montant || 0), 0);
    const initial = dette?.montant_initial || 2300000;
    return { initial, rembourse: totalRemb, restant: initial - totalRemb };
  }, [dettes, remboursements]);

  // Valuation
  const valuation = useMemo(() => {
    const inventaire = INVENTAIRE_STOCK.reduce((s, i) => s + (i.qte * i.prix_achat), 0);
    const machines = MACHINES.reduce((s, m) => s + m.valeur, 0);
    const tresorerie = FINANCIAL_SUMMARY.cash_en_compte + FINANCIAL_SUMMARY.cash_en_caisse;
    const actifs = inventaire + machines + tresorerie;
    const passifs = detteInfo.restant;
    return { inventaire, machines, tresorerie, actifs, passifs, valeur_nette: actifs - passifs };
  }, [detteInfo]);

  const pieData = [
    { name: 'Oumar Ibrahim', value: capTable.oumar, color: '#3b82f6' },
    { name: 'Senouss Saleh', value: capTable.senouss, color: '#f59e0b' },
  ];

  const valuationPie = [
    { name: 'Stock', value: valuation.inventaire, color: '#3b82f6' },
    { name: 'Machines', value: valuation.machines, color: '#8b5cf6' },
    { name: 'Trésorerie', value: valuation.tresorerie, color: '#10b981' },
  ];

  const handleAddApport = async () => {
    if (!apportForm.montant || Number(apportForm.montant) <= 0) { toast.error('Montant requis'); return; }
    await db.apports_associes.create({ ...apportForm, montant: Number(apportForm.montant) });
    await logAction('create', 'gouvernance', { details: `Apport ${fmt(apportForm.montant)} F par ${apportForm.associe}` });
    toast.success('Apport enregistré');
    setShowApportForm(false);
    load();
  };

  const handleAddRemboursement = async () => {
    if (!rembForm.montant || Number(rembForm.montant) <= 0) { toast.error('Montant requis'); return; }
    if (Number(rembForm.montant) > detteInfo.restant) { toast.error('Montant supérieur au solde dû'); return; }
    await db.remboursements_associes.create({ ...rembForm, montant: Number(rembForm.montant), associe: 'oumar' });
    // Update dette restant
    const dette = dettes.find((d) => d.associe === 'oumar');
    if (dette) await db.dettes_associes.update(dette.id, { montant_restant: detteInfo.restant - Number(rembForm.montant) });
    await logAction('create', 'gouvernance', { details: `Remboursement ${fmt(rembForm.montant)} F dette Oumar` });
    toast.success('Remboursement enregistré');
    setShowRemboursementForm(false);
    load();
  };

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;

  const oumarValue = (valuation.valeur_nette * capTable.oumar) / 100;
  const senoussValue = (valuation.valeur_nette * capTable.senouss) / 100;

  return (
    <div className="space-y-6">
      {/* Header premium */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-900 p-6 text-white">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/5" />
        <div className="absolute -bottom-6 -left-6 h-28 w-28 rounded-full bg-white/5" />
        <div className="relative">
          <div className="flex items-center gap-3 mb-1">
            <Crown className="h-6 w-6 text-amber-400" />
            <h2 className="text-2xl font-bold">Gouvernance & Capital</h2>
          </div>
          <p className="text-blue-200/70 text-sm">Cap Table, valorisation et comptes courants d'associés</p>
        </div>
      </div>

      {/* KPIs row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Valeur Entreprise', value: `${fmt(valuation.valeur_nette)} F`, icon: Building2, color: 'border-l-blue-500', sub: 'Actifs - Passifs' },
          { label: 'Capital Total', value: `${fmt(capTable.totalCapital)} F`, icon: PiggyBank, color: 'border-l-emerald-500', sub: `${apports.length + 2} apports` },
          { label: 'Dette Restante', value: `${fmt(detteInfo.restant)} F`, icon: CreditCard, color: 'border-l-red-500', sub: `sur ${fmt(detteInfo.initial)} F` },
          { label: 'Trésorerie', value: `${fmt(valuation.tresorerie)} F`, icon: Wallet, color: 'border-l-violet-500', sub: 'Compte + Caisse' },
        ].map(({ label, value, icon: Icon, color, sub }) => (
          <Card key={label} className={`border-l-4 ${color}`}>
            <CardContent className="p-3 sm:p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] sm:text-[11px] text-muted-foreground uppercase tracking-wide truncate">{label}</p>
                  <p className="text-sm sm:text-lg font-bold mt-1 truncate">{value}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{sub}</p>
                </div>
                <div className="shrink-0 rounded-lg bg-muted p-1.5 sm:p-2"><Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" /></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Cap Table + Pie */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4 text-primary" />
              Répartition du Capital
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value"
                    label={({ name, value }) => `${name.split(' ')[0]} ${value.toFixed(1)}%`}>
                    {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip formatter={(v) => `${v.toFixed(2)}%`} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Associés detail */}
            <div className="space-y-3 mt-4">
              {[
                { nom: 'Oumar Ibrahim (Abakar Senoussi)', pct: capTable.oumar, valeur: oumarValue, color: 'bg-blue-500', initial: '4 965 000 F + apports', role: 'Gérant' },
                { nom: 'Senouss Saleh', pct: capTable.senouss, valeur: senoussValue, color: 'bg-amber-500', initial: '2 500 000 F', role: 'Associé' },
              ].map((a) => (
                <div key={a.nom} className="rounded-xl border p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className={`h-3 w-3 rounded-full ${a.color}`} />
                      <span className="font-semibold text-sm">{a.nom}</span>
                    </div>
                    <Badge variant="outline" className="text-[10px]">{a.role}</Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div><p className="text-[10px] text-muted-foreground">Parts</p><p className="text-sm font-bold">{a.pct.toFixed(1)}%</p></div>
                    <div><p className="text-[10px] text-muted-foreground">Valeur</p><p className="text-sm font-bold">{fmt(a.valeur)} F</p></div>
                    <div><p className="text-[10px] text-muted-foreground">Investissement</p><p className="text-[11px] text-muted-foreground">{a.initial}</p></div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Valorisation */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4 text-primary" />
              Valorisation de l'Imprimerie
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50 p-4 mb-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">Valeur nette actuelle</p>
              <p className="text-3xl font-black text-primary">{fmt(valuation.valeur_nette)} F</p>
              <p className="text-[10px] text-muted-foreground mt-1">Actifs ({fmt(valuation.actifs)} F) - Passifs ({fmt(valuation.passifs)} F)</p>
            </div>

            <div className="h-[180px] mb-4">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={valuationPie} cx="50%" cy="50%" outerRadius={70} dataKey="value"
                    label={({ name, value }) => `${name}: ${fmt(value)}`}>
                    {valuationPie.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip formatter={(v) => `${fmt(v)} F`} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="space-y-2">
              {[
                { label: 'Stock (prix d\'achat)', val: valuation.inventaire, icon: '📦' },
                { label: 'Machines & Outils', val: valuation.machines, icon: '🖨️' },
                { label: 'Trésorerie (Compte + Caisse)', val: valuation.tresorerie, icon: '💰' },
                { label: 'Dettes associés', val: -detteInfo.restant, icon: '📉', neg: true },
              ].map(({ label, val, icon, neg }) => (
                <div key={label} className="flex items-center justify-between py-1.5 border-b last:border-0">
                  <span className="text-sm flex items-center gap-2">{icon} {label}</span>
                  <span className={`text-sm font-semibold ${neg ? 'text-red-600' : ''}`}>{neg ? '-' : ''}{fmt(Math.abs(val))} F</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Dettes & Remboursements + Historique Apports */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Dette Oumar */}
        <Card className="border-l-4 border-l-red-500">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <CreditCard className="h-4 w-4 text-red-500" />
                Compte Courant d'Associé — Oumar
              </CardTitle>
              <Button size="sm" className="gap-1" onClick={() => { setRembForm({ montant: '', date: new Date().toISOString().slice(0, 10), description: '' }); setShowRemboursementForm(true); }}>
                <ArrowDownCircle className="h-3.5 w-3.5" /> Remboursement
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Montant initial</span>
                <span className="font-semibold">{fmt(detteInfo.initial)} F</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Remboursé</span>
                <span className="font-semibold text-emerald-600">{fmt(detteInfo.rembourse)} F</span>
              </div>
              <div className="flex items-center justify-between text-lg">
                <span className="font-semibold">Reste à payer</span>
                <span className="font-black text-red-600">{fmt(detteInfo.restant)} F</span>
              </div>

              {/* Progress bar */}
              <div className="relative h-4 rounded-full bg-red-100 overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all"
                  style={{ width: `${Math.min(100, (detteInfo.rembourse / detteInfo.initial) * 100)}%` }}
                />
                <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold">
                  {((detteInfo.rembourse / detteInfo.initial) * 100).toFixed(0)}% remboursé
                </span>
              </div>

              {/* Remboursement history */}
              {remboursements.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1"><History className="h-3 w-3" /> Historique</p>
                  {remboursements.sort((a, b) => b.date?.localeCompare(a.date)).map((r) => (
                    <div key={r.id} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
                      <span className="text-muted-foreground">{r.date} — {r.description || 'Remboursement'}</span>
                      <span className="font-semibold text-emerald-600">+{fmt(r.montant)} F</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Historique des apports */}
        <Card className="border-l-4 border-l-emerald-500">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="h-4 w-4 text-emerald-500" />
                Historique des Apports
              </CardTitle>
              <Button size="sm" variant="outline" className="gap-1" onClick={() => { setApportForm({ associe: 'oumar', type: 'apport_capital', montant: '', description: '', date: new Date().toISOString().slice(0, 10) }); setShowApportForm(true); }}>
                <Plus className="h-3.5 w-3.5" /> Nouvel apport
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {/* Initial investments */}
              {[
                { date: '2024-01-01', associe: 'Oumar', montant: 3000000, desc: 'Investissement initial' },
                { date: '2024-01-01', associe: 'Senouss', montant: 2500000, desc: 'Investissement initial' },
                { date: '2024-06-01', associe: 'Oumar', montant: 1965000, desc: 'Frais de voyage Chine' },
              ].map((a, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2.5 border">
                  <div>
                    <p className="text-sm font-medium">{a.desc}</p>
                    <p className="text-[10px] text-muted-foreground">{a.date} — {a.associe}</p>
                  </div>
                  <span className="font-bold text-sm">{fmt(a.montant)} F</span>
                </div>
              ))}

              {/* Dynamic apports */}
              {apports.map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2.5 border border-emerald-200">
                  <div>
                    <p className="text-sm font-medium">{a.description || 'Apport en capital'}</p>
                    <p className="text-[10px] text-muted-foreground">{a.date} — {a.associe === 'oumar' ? 'Oumar' : 'Senouss'}</p>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-sm text-emerald-700">{fmt(a.montant)} F</span>
                    <Badge className="ml-2 text-[9px] bg-emerald-100 text-emerald-700">{a.type === 'apport_capital' ? 'Capital' : 'Prêt'}</Badge>
                  </div>
                </div>
              ))}
            </div>

            {/* Formule de dilution */}
            <div className="mt-4 rounded-xl bg-slate-50 p-3 border">
              <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1"><Shield className="h-3 w-3" /> Formule de dilution</p>
              <div className="text-[11px] text-muted-foreground space-y-1">
                <p>Capital de base : 7 465 000 F (Oumar 70% / Senouss 30%)</p>
                <p>+ Apports post-création : {fmt(apports.reduce((s, a) => s + (a.type === 'apport_capital' ? a.montant : 0), 0))} F</p>
                <p className="font-semibold text-foreground">= Oumar {capTable.oumar.toFixed(2)}% / Senouss {capTable.senouss.toFixed(2)}%</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Apport Dialog */}
      <Dialog open={showApportForm} onOpenChange={setShowApportForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Nouvel Apport en Capital</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Associé</label>
              <select className="w-full rounded-md border px-3 py-2 text-sm" value={apportForm.associe} onChange={(e) => setApportForm({ ...apportForm, associe: e.target.value })}>
                <option value="oumar">Oumar Ibrahim</option>
                <option value="senouss">Senouss Saleh</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Type</label>
              <select className="w-full rounded-md border px-3 py-2 text-sm" value={apportForm.type} onChange={(e) => setApportForm({ ...apportForm, type: e.target.value })}>
                <option value="apport_capital">Apport en capital (modifie les parts)</option>
                <option value="pret">Prêt (dette à rembourser)</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Montant (FCFA)</label>
              <Input type="number" value={apportForm.montant} onChange={(e) => setApportForm({ ...apportForm, montant: e.target.value })} placeholder="0" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Description</label>
              <Input value={apportForm.description} onChange={(e) => setApportForm({ ...apportForm, description: e.target.value })} placeholder="Ex: Marchandises, Équipement..." />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Date</label>
              <Input type="date" value={apportForm.date} onChange={(e) => setApportForm({ ...apportForm, date: e.target.value })} />
            </div>
            <Button className="w-full" onClick={handleAddApport}>Enregistrer l'apport</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Remboursement Dialog */}
      <Dialog open={showRemboursementForm} onOpenChange={setShowRemboursementForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Enregistrer un Remboursement</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="rounded-lg bg-red-50 p-3 text-sm">
              <p>Solde restant : <span className="font-bold text-red-600">{fmt(detteInfo.restant)} F</span></p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Montant remboursé (FCFA)</label>
              <Input type="number" value={rembForm.montant} onChange={(e) => setRembForm({ ...rembForm, montant: e.target.value })} placeholder="0" max={detteInfo.restant} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Date</label>
              <Input type="date" value={rembForm.date} onChange={(e) => setRembForm({ ...rembForm, date: e.target.value })} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Description</label>
              <Input value={rembForm.description} onChange={(e) => setRembForm({ ...rembForm, description: e.target.value })} placeholder="Ex: Versement espèces..." />
            </div>
            <Button className="w-full" onClick={handleAddRemboursement}>Valider le remboursement</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
