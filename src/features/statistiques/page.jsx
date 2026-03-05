import { useState, useEffect, useMemo } from 'react';
import { db } from '@/services/db';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
} from 'recharts';
import {
  TrendingUp,
  TrendingDown,
  Calendar,
  DollarSign,
  BarChart3,
  PieChart as PieIcon,
  Wallet,
  AlertTriangle,
} from 'lucide-react';

function fmt(n) {
  return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0));
}

const COLORS = ['#3b82f6', '#8b5cf6', '#14b8a6', '#f97316', '#ec4899', '#06b6d4', '#64748b', '#6366f1'];

const CAT_LABELS = {
  copies: 'Copies',
  marchandises: 'Marchandises',
  scan: 'Scan',
  tirage_saisies: 'Tirage & Saisies',
  badges_plastification: 'Badges & Plastif.',
  demi_photos: 'Demi-Photos',
  maintenance: 'Maintenance',
  imprimerie: 'Imprimerie',
};

const PERIODS = [
  { value: '7d', label: '7 jours' },
  { value: '30d', label: '30 jours' },
  { value: '90d', label: '3 mois' },
  { value: '6m', label: '6 mois' },
  { value: '1y', label: '1 an' },
  { value: 'all', label: 'Tout' },
];

function getPeriodStart(period) {
  const d = new Date();
  switch (period) {
    case '7d': d.setDate(d.getDate() - 7); break;
    case '30d': d.setDate(d.getDate() - 30); break;
    case '90d': d.setDate(d.getDate() - 90); break;
    case '6m': d.setMonth(d.getMonth() - 6); break;
    case '1y': d.setFullYear(d.getFullYear() - 1); break;
    case 'all': return '2000-01-01';
  }
  return d.toISOString().split('T')[0];
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-card p-3 shadow-lg">
      <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="text-sm font-semibold" style={{ color: p.color }}>
          {p.name}: {fmt(p.value)} F
        </p>
      ))}
    </div>
  );
}

export default function Statistiques() {
  const [rapports, setRapports] = useState([]);
  const [clotures, setClotures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('30d');

  useEffect(() => {
    Promise.all([
      db.rapports.list(),
      db.clotures_caisse.list(),
    ]).then(([rData, cData]) => {
      setRapports(rData.sort((a, b) => a.date.localeCompare(b.date)));
      setClotures(cData);
      setLoading(false);
    });
  }, []);

  const filtered = useMemo(() => {
    const start = getPeriodStart(period);
    return rapports.filter((r) => r.date >= start);
  }, [rapports, period]);

  const stats = useMemo(() => {
    if (!filtered.length) return null;

    const totalRec = filtered.reduce(
      (s, r) => s + Object.values(r.categories || {}).reduce((a, v) => a + (v || 0), 0), 0
    );
    const totalDep = filtered.reduce(
      (s, r) => s + (r.depenses || []).reduce((a, d) => a + (d.montant || 0), 0), 0
    );
    const benefice = totalRec - totalDep;
    const avgDaily = filtered.length > 0 ? totalRec / filtered.length : 0;
    const margePercent = totalRec > 0 ? (benefice / totalRec) * 100 : 0;

    // Previous period comparison
    const periodDays = { '7d': 7, '30d': 30, '90d': 90, '6m': 180, '1y': 365, all: 9999 };
    const days = periodDays[period];
    const prevStart = new Date();
    prevStart.setDate(prevStart.getDate() - days * 2);
    const prevEnd = new Date();
    prevEnd.setDate(prevEnd.getDate() - days);
    const prevFiltered = rapports.filter(
      (r) => r.date >= prevStart.toISOString().split('T')[0] && r.date < prevEnd.toISOString().split('T')[0]
    );
    const prevRec = prevFiltered.reduce(
      (s, r) => s + Object.values(r.categories || {}).reduce((a, v) => a + (v || 0), 0), 0
    );
    const trend = prevRec > 0 ? ((totalRec - prevRec) / prevRec) * 100 : 0;

    // Category breakdown
    const catTotals = {};
    for (const r of filtered) {
      for (const [k, v] of Object.entries(r.categories || {})) {
        catTotals[k] = (catTotals[k] || 0) + (v || 0);
      }
    }
    const catData = Object.entries(catTotals)
      .map(([key, value], i) => ({ name: CAT_LABELS[key] || key, value, color: COLORS[i % COLORS.length] }))
      .sort((a, b) => b.value - a.value);
    const top5 = catData.slice(0, 5);

    // Daily chart data
    const dailyMap = {};
    for (const r of filtered) {
      if (!dailyMap[r.date]) dailyMap[r.date] = { recettes: 0, depenses: 0 };
      dailyMap[r.date].recettes += Object.values(r.categories || {}).reduce((a, v) => a + (v || 0), 0);
      dailyMap[r.date].depenses += (r.depenses || []).reduce((a, d) => a + (d.montant || 0), 0);
    }
    const dailyData = Object.entries(dailyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, vals]) => ({
        date: new Date(date + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }),
        fullDate: date,
        recettes: vals.recettes,
        depenses: vals.depenses,
        benefice: vals.recettes - vals.depenses,
      }));

    // Monthly aggregation
    const monthlyMap = {};
    for (const r of filtered) {
      const month = r.date.slice(0, 7);
      if (!monthlyMap[month]) monthlyMap[month] = { recettes: 0, depenses: 0 };
      monthlyMap[month].recettes += Object.values(r.categories || {}).reduce((a, v) => a + (v || 0), 0);
      monthlyMap[month].depenses += (r.depenses || []).reduce((a, d) => a + (d.montant || 0), 0);
    }
    const monthlyData = Object.entries(monthlyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, vals]) => {
        const [y, m] = month.split('-');
        const label = new Date(parseInt(y), parseInt(m) - 1).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
        return { month: label, recettes: vals.recettes, depenses: vals.depenses, benefice: vals.recettes - vals.depenses };
      });

    // Clôture stats
    const recentClotures = clotures
      .filter((c) => c.date >= getPeriodStart(period))
      .sort((a, b) => b.date.localeCompare(a.date));
    const ecartTotal = recentClotures.reduce((s, c) => s + Math.abs(c.ecart || 0), 0);
    const ecartsMajeurs = recentClotures.filter((c) => c.statut === 'ecart_majeur').length;

    return { totalRec, totalDep, benefice, avgDaily, margePercent, trend, catData, top5, dailyData, monthlyData, ecartTotal, ecartsMajeurs, recentClotures };
  }, [filtered, rapports, clotures, period]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Dashboard Financier</h2>
          <p className="text-muted-foreground">
            Vue d'ensemble — Imprimerie Ogooué
          </p>
        </div>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODS.map((p) => (
              <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!stats || filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <BarChart3 className="mb-4 h-12 w-12 text-muted-foreground/30" />
            <p className="text-muted-foreground">Aucune donnée pour cette période</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* KPI Cards — 6 cards */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            <KPICard
              title="Chiffre d'affaires"
              value={`${fmt(stats.totalRec)} F`}
              trend={stats.trend}
              icon={DollarSign}
              iconBg="bg-emerald-500/10"
              iconColor="text-emerald-600"
            />
            <KPICard
              title="Dépenses"
              value={`${fmt(stats.totalDep)} F`}
              icon={TrendingDown}
              iconBg="bg-red-500/10"
              iconColor="text-red-500"
            />
            <KPICard
              title="Bénéfice net"
              value={`${fmt(stats.benefice)} F`}
              icon={TrendingUp}
              iconBg="bg-primary/10"
              iconColor="text-primary"
            />
            <KPICard
              title="Marge"
              value={`${stats.margePercent.toFixed(1)}%`}
              icon={Wallet}
              iconBg="bg-violet-500/10"
              iconColor="text-violet-600"
            />
            <KPICard
              title="Moyenne / jour"
              value={`${fmt(stats.avgDaily)} F`}
              icon={Calendar}
              iconBg="bg-cyan-500/10"
              iconColor="text-cyan-600"
            />
            <KPICard
              title="Écarts caisse"
              value={stats.ecartsMajeurs > 0 ? `${stats.ecartsMajeurs} alerte${stats.ecartsMajeurs > 1 ? 's' : ''}` : 'RAS'}
              icon={AlertTriangle}
              iconBg={stats.ecartsMajeurs > 0 ? 'bg-orange-500/10' : 'bg-emerald-500/10'}
              iconColor={stats.ecartsMajeurs > 0 ? 'text-orange-500' : 'text-emerald-600'}
            />
          </div>

          {/* CA vs Dépenses vs Bénéfice evolution */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">CA vs Dépenses vs Bénéfice Net</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[320px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  {stats.dailyData.length > 60 ? (
                    <AreaChart data={stats.monthlyData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="month" tick={{ fontSize: 12 }} className="text-muted-foreground" />
                      <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} className="text-muted-foreground" />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend />
                      <Area type="monotone" dataKey="recettes" name="CA" stroke="#10b981" fill="#10b981" fillOpacity={0.08} strokeWidth={2} />
                      <Area type="monotone" dataKey="depenses" name="Dépenses" stroke="#ef4444" fill="#ef4444" fillOpacity={0.05} strokeWidth={2} />
                      <Area type="monotone" dataKey="benefice" name="Bénéfice" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.1} strokeWidth={2.5} />
                    </AreaChart>
                  ) : (
                    <AreaChart data={stats.dailyData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} className="text-muted-foreground" interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} className="text-muted-foreground" />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend />
                      <Area type="monotone" dataKey="recettes" name="CA" stroke="#10b981" fill="#10b981" fillOpacity={0.08} strokeWidth={2} />
                      <Area type="monotone" dataKey="depenses" name="Dépenses" stroke="#ef4444" fill="#ef4444" fillOpacity={0.05} strokeWidth={2} />
                      <Area type="monotone" dataKey="benefice" name="Bénéfice" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.1} strokeWidth={2.5} />
                    </AreaChart>
                  )}
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Two column: Top 5 Services + Monthly Bars */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Top 5 Services — Pie */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <PieIcon className="h-4 w-4" /> Top 5 Services
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[250px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={stats.top5}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={95}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        {stats.top5.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v) => `${fmt(v)} F`} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 space-y-2">
                  {stats.top5.map((cat, i) => {
                    const pct = stats.totalRec > 0 ? (cat.value / stats.totalRec) * 100 : 0;
                    return (
                      <div key={i} className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold text-white" style={{ backgroundColor: cat.color }}>
                          {i + 1}
                        </div>
                        <span className="flex-1 truncate text-sm font-medium">{cat.name}</span>
                        <span className="text-sm font-semibold">{fmt(cat.value)} F</span>
                        <Badge variant="outline" className="text-xs">{pct.toFixed(1)}%</Badge>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Bénéfice mensuel — Barres empilées */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <BarChart3 className="h-4 w-4" /> Bénéfice mensuel
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[280px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stats.monthlyData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="month" tick={{ fontSize: 12 }} className="text-muted-foreground" />
                      <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} className="text-muted-foreground" />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend />
                      <Bar dataKey="recettes" name="CA" fill="#10b981" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="depenses" name="Dépenses" fill="#ef4444" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="benefice" name="Bénéfice" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Category breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Répartition par service</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {stats.catData.map((cat, i) => {
                  const pct = stats.totalRec > 0 ? (cat.value / stats.totalRec) * 100 : 0;
                  return (
                    <div key={i} className="flex items-center gap-3">
                      <span className="w-8 text-right text-sm font-bold text-muted-foreground">#{i + 1}</span>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">{cat.name}</span>
                          <span className="text-sm font-semibold">{fmt(cat.value)} F</span>
                        </div>
                        <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${pct}%`, backgroundColor: cat.color }}
                          />
                        </div>
                      </div>
                      <span className="w-12 text-right text-xs font-medium text-muted-foreground">
                        {pct.toFixed(1)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function KPICard({ title, value, trend, icon: Icon, iconBg, iconColor }) {
  return (
    <Card>
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-center gap-2">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${iconBg}`}>
            <Icon className={`h-4 w-4 ${iconColor}`} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[10px] font-medium text-muted-foreground sm:text-xs">{title}</p>
            <p className="truncate text-sm font-bold sm:text-base">{value}</p>
            {trend !== undefined && trend !== 0 && (
              <p className={`text-[10px] font-medium ${trend > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {trend > 0 ? '↑' : '↓'} {Math.abs(trend).toFixed(1)}%
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
