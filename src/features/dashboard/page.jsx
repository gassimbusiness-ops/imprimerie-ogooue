import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { db } from '@/services/db';
import { useAuth } from '@/services/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  Receipt,
  Users,
  ArrowRight,
  FileSpreadsheet,
  AlertTriangle,
  BarChart3,
  Clock,
  Plus,
  Package,
  Landmark,
  Building2,
  Globe,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';

function fmt(n) {
  return new Intl.NumberFormat('fr-FR').format(n || 0);
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-card p-2.5 shadow-lg">
      <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="text-sm font-semibold" style={{ color: p.color }}>
          {p.name}: {fmt(p.value)} F
        </p>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const { user, isAdmin, isManager } = useAuth();
  const isEmploye = user?.role === 'employe';
  const [rapports, setRapports] = useState([]);
  const [clients, setClients] = useState([]);
  const [produits, setProduits] = useState([]);
  const [comptes, setComptes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      db.rapports.list(),
      db.clients.list(),
      db.produits.list(),
      db.comptes_bancaires.list(),
    ]).then(([r, c, p, cb]) => {
      setRapports(r.sort((a, b) => b.date.localeCompare(a.date)));
      setClients(c);
      setProduits(p);
      setComptes(cb);
      setLoading(false);
    });
  }, []);

  const stats = useMemo(() => {
    if (!rapports.length) return null;
    const today = new Date().toISOString().split('T')[0];
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    const todayR = rapports.filter((r) => r.date === today);
    const todayRec = todayR.reduce((s, r) => s + Object.values(r.categories || {}).reduce((a, v) => a + (v || 0), 0), 0);
    const todayDep = todayR.reduce((s, r) => s + (r.depenses || []).reduce((a, d) => a + (d.montant || 0), 0), 0);

    const monthR = rapports.filter((r) => r.date >= monthStart);
    const monthRec = monthR.reduce((s, r) => s + Object.values(r.categories || {}).reduce((a, v) => a + (v || 0), 0), 0);
    const monthDep = monthR.reduce((s, r) => s + (r.depenses || []).reduce((a, d) => a + (d.montant || 0), 0), 0);

    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    const prevR = rapports.filter((r) => r.date >= prevMonthStart.toISOString().split('T')[0] && r.date <= prevMonthEnd.toISOString().split('T')[0]);
    const prevRec = prevR.reduce((s, r) => s + Object.values(r.categories || {}).reduce((a, v) => a + (v || 0), 0), 0);
    const monthTrend = prevRec > 0 ? ((monthRec - prevRec) / prevRec) * 100 : 0;

    const chartData = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const dayR = rapports.filter((r) => r.date === dateStr);
      const rec = dayR.reduce((s, r) => s + Object.values(r.categories || {}).reduce((a, v) => a + (v || 0), 0), 0);
      const dep = dayR.reduce((s, r) => s + (r.depenses || []).reduce((a, d2) => a + (d2.montant || 0), 0), 0);
      chartData.push({
        date: d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }),
        recettes: rec,
        depenses: dep,
      });
    }

    const lowStock = produits.filter((p) => p.stock <= p.stock_min);
    const pending = rapports.filter((r) => r.statut === 'soumis');

    return { todayRec, todayDep, monthRec, monthDep, monthTrend, chartData, lowStock, pending };
  }, [rapports, produits]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const dateStr = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Bonjour, {user?.prenom || 'Bienvenue'}</h2>
          <p className="text-muted-foreground capitalize">{dateStr}</p>
        </div>
        <Link to="/rapports">
          <Button size="sm" className="gap-2">
            <Plus className="h-3.5 w-3.5" /> Nouveau rapport
          </Button>
        </Link>
      </div>

      {/* Stats — employés: pas de données financières */}
      {isEmploye ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          <StatCard title="Rapports du jour" value={stats ? rapports.filter((r) => r.date === new Date().toISOString().split('T')[0]).length : 0} icon={FileSpreadsheet} iconBg="bg-primary/10" iconColor="text-primary" />
          <StatCard title="Commandes" value={rapports.length} icon={Package} iconBg="bg-emerald-500/10" iconColor="text-emerald-600" />
          <StatCard title="Clients" value={clients.length} icon={Users} iconBg="bg-violet-500/10" iconColor="text-violet-600" />
          <StatCard title="Alertes stock" value={stats?.lowStock?.length || 0} icon={AlertTriangle} iconBg="bg-amber-500/10" iconColor="text-amber-600" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          <StatCard
            title="Recettes jour"
            value={`${fmt(stats?.todayRec)} F`}
            icon={Wallet}
            iconBg="bg-emerald-500/10"
            iconColor="text-emerald-600"
          />
          <StatCard
            title="Dépenses jour"
            value={`${fmt(stats?.todayDep)} F`}
            icon={TrendingDown}
            iconBg="bg-destructive/10"
            iconColor="text-destructive"
          />
          <StatCard
            title="Recettes mois"
            value={`${fmt(stats?.monthRec)} F`}
            subtitle={`Bénéf: ${fmt((stats?.monthRec || 0) - (stats?.monthDep || 0))} F`}
            trend={stats?.monthTrend}
            icon={TrendingUp}
            iconBg="bg-primary/10"
            iconColor="text-primary"
          />
          <StatCard
            title="Clients"
            value={clients.length}
            icon={Users}
            iconBg="bg-violet-500/10"
            iconColor="text-violet-600"
          />
        </div>
      )}

      {/* Chart + Quick links — graphique masqué pour employés */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {!isEmploye && (
          <Card className="lg:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base">14 derniers jours</CardTitle>
              <Link to="/statistiques">
                <Button variant="ghost" size="sm" className="gap-1 text-xs">
                  Détails <ArrowRight className="h-3 w-3" />
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              <div className="h-[220px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={stats?.chartData || []}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} className="text-muted-foreground" interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} className="text-muted-foreground" />
                    <Tooltip content={<CustomTooltip />} />
                    <Area type="monotone" dataKey="recettes" name="Recettes" stroke="#10b981" fill="#10b981" fillOpacity={0.1} strokeWidth={2} />
                    <Area type="monotone" dataKey="depenses" name="Dépenses" stroke="#ef4444" fill="#ef4444" fillOpacity={0.05} strokeWidth={1.5} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}

        <div className={`space-y-4 ${isEmploye ? 'lg:col-span-3' : ''}`}>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Accès rapide</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2">
              <Link to="/rapports">
                <Button variant="outline" className="h-auto w-full flex-col gap-1 py-3 text-xs">
                  <FileSpreadsheet className="h-5 w-5 text-primary" />
                  Rapports
                </Button>
              </Link>
              {!isEmploye && (
                <Link to="/statistiques">
                  <Button variant="outline" className="h-auto w-full flex-col gap-1 py-3 text-xs">
                    <BarChart3 className="h-5 w-5 text-emerald-600" />
                    Stats
                  </Button>
                </Link>
              )}
              <Link to="/pointage">
                <Button variant="outline" className="h-auto w-full flex-col gap-1 py-3 text-xs">
                  <Clock className="h-5 w-5 text-violet-600" />
                  Pointage
                </Button>
              </Link>
              <Link to="/stocks">
                <Button variant="outline" className="h-auto w-full flex-col gap-1 py-3 text-xs">
                  <Receipt className="h-5 w-5 text-orange-500" />
                  Stocks
                </Button>
              </Link>
              {isEmploye && (
                <Link to="/commandes">
                  <Button variant="outline" className="h-auto w-full flex-col gap-1 py-3 text-xs">
                    <Package className="h-5 w-5 text-blue-600" />
                    Commandes
                  </Button>
                </Link>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Alertes stock
                <Badge variant="secondary" className="ml-auto">{stats?.lowStock?.length || 0}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(!stats?.lowStock?.length) ? (
                <p className="py-2 text-center text-sm text-muted-foreground">Tous les stocks sont OK</p>
              ) : (
                stats.lowStock.slice(0, 3).map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded-lg bg-amber-50 p-2.5">
                    <div>
                      <p className="text-sm font-medium">{p.nom}</p>
                      <p className="text-xs text-muted-foreground">{p.categorie}</p>
                    </div>
                    <Badge variant="outline" className="border-amber-300 text-xs text-amber-700">{p.stock}</Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Soldes bancaires — admin/manager uniquement */}
      {!isEmploye && comptes.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Landmark className="h-4 w-4 text-blue-600" />
              Trésorerie
            </CardTitle>
            <Link to="/finances">
              <Button variant="ghost" size="sm" className="gap-1 text-xs">
                Détails <ArrowRight className="h-3 w-3" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {comptes.map((c) => (
                <div key={c.id} className="rounded-lg border p-2.5">
                  <div className="flex items-center gap-2 mb-1">
                    {c.type === 'online' || c.type === 'international' ? <Globe className="h-3.5 w-3.5 text-muted-foreground" /> : <Building2 className="h-3.5 w-3.5 text-muted-foreground" />}
                    <span className="text-xs font-medium truncate">{c.nom}</span>
                  </div>
                  <p className="text-sm font-bold">{fmt(c.solde)} <span className="text-[10px] font-normal text-muted-foreground">{c.devise === 'XAF' ? 'FCFA' : c.devise}</span></p>
                </div>
              ))}
            </div>
            <div className="mt-2 text-right">
              <span className="text-xs text-muted-foreground">Total: </span>
              <span className="text-sm font-bold text-primary">{fmt(comptes.reduce((s, c) => s + (c.solde || 0), 0))} F</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent rapports — masqué pour les employés (contient des montants financiers) */}
      {!isEmploye && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Derniers rapports</CardTitle>
            <Link to="/rapports">
              <Button variant="ghost" size="sm" className="gap-1 text-xs">
                Voir tout <ArrowRight className="h-3 w-3" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {rapports.slice(0, 5).map((r) => {
              const rec = Object.values(r.categories || {}).reduce((s, v) => s + (v || 0), 0);
              const dep = (r.depenses || []).reduce((s, d) => s + (d.montant || 0), 0);
              return (
                <div key={r.id} className="flex items-center justify-between rounded-lg bg-muted/50 p-3">
                  <div className="flex items-center gap-3">
                    <div className="hidden h-9 w-9 items-center justify-center rounded-lg bg-primary/10 sm:flex">
                      <FileSpreadsheet className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">
                        {new Date(r.date + 'T00:00:00').toLocaleDateString('fr-FR', {
                          weekday: 'short', day: 'numeric', month: 'short',
                        })}
                      </p>
                      <p className="text-xs text-muted-foreground">{r.operateur_nom}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-semibold text-emerald-600">+{fmt(rec)} F</span>
                    {dep > 0 && <p className="text-xs text-red-400">-{fmt(dep)} F</p>}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({ title, value, subtitle, trend, icon: Icon, iconBg, iconColor }) {
  return (
    <Card>
      <CardContent className="p-3 sm:p-5">
        <div className="flex items-start gap-2 sm:gap-3">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl sm:h-12 sm:w-12 ${iconBg}`}>
            <Icon className={`h-4 w-4 sm:h-6 sm:w-6 ${iconColor}`} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[10px] font-medium text-muted-foreground sm:text-xs">{title}</p>
            <p className="text-sm font-bold sm:text-xl truncate">{value}</p>
            {subtitle && <p className="truncate text-[9px] text-muted-foreground sm:text-xs">{subtitle}</p>}
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
