import { useState, useEffect, useMemo } from 'react';
import { db } from '@/services/db';
import { useAuth } from '@/services/auth';
import { exportInventairePDF, exportClientsPDF, exportRapportCompletPDF, exportCSV } from '@/services/export-pdf';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, AreaChart, Area,
  ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import {
  TrendingUp, TrendingDown, ShoppingCart, DollarSign, Users, Boxes,
  AlertTriangle, Package, CreditCard, PieChart as PieChartIcon, Download,
  FileText, ArrowUpRight, ArrowDownRight, Wallet, BarChart3, UserCheck,
  PackageMinus, Eye, Filter,
} from 'lucide-react';
import { toast } from 'sonner';

function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)); }

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899', '#84cc16'];

const TABS = [
  { id: 'ventes', label: 'Ventes', icon: ShoppingCart },
  { id: 'stocks', label: 'Stocks', icon: Boxes },
  { id: 'clients', label: 'Clients', icon: Users },
  { id: 'finance', label: 'Finance', icon: DollarSign },
  { id: 'exports', label: 'Exports', icon: Download },
];

const PERIODES = [
  { value: 'jour', label: "Aujourd'hui" },
  { value: 'semaine', label: 'Cette semaine' },
  { value: 'mois', label: 'Ce mois' },
  { value: '3mois', label: '3 mois' },
  { value: '6mois', label: '6 mois' },
  { value: 'annee', label: 'Cette année' },
];

function getDateRange(periode) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let start;
  switch (periode) {
    case 'jour': start = today; break;
    case 'semaine': start = new Date(today); start.setDate(start.getDate() - start.getDay() + 1); break;
    case 'mois': start = new Date(today.getFullYear(), today.getMonth(), 1); break;
    case '3mois': start = new Date(today.getFullYear(), today.getMonth() - 2, 1); break;
    case '6mois': start = new Date(today.getFullYear(), today.getMonth() - 5, 1); break;
    case 'annee': start = new Date(today.getFullYear(), 0, 1); break;
    default: start = new Date(today.getFullYear(), today.getMonth(), 1);
  }
  return { start: start.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
}

function getPrevRange(periode) {
  const { start, end } = getDateRange(periode);
  const s = new Date(start);
  const e = new Date(end);
  const diff = e - s;
  const prevEnd = new Date(s.getTime() - 86400000);
  const prevStart = new Date(prevEnd.getTime() - diff);
  return { start: prevStart.toISOString().slice(0, 10), end: prevEnd.toISOString().slice(0, 10) };
}

export default function RapportsAnalyses() {
  const { isAdmin, isManager, hasPermission } = useAuth();
  const [tab, setTab] = useState('ventes');
  const [periode, setPeriode] = useState('mois');
  const [loading, setLoading] = useState(true);

  // Data sources
  const [rapports, setRapports] = useState([]);
  const [commandes, setCommandes] = useState([]);
  const [clients, setClients] = useState([]);
  const [produits, setProduits] = useState([]);
  const [catalogue, setCatalogue] = useState([]);
  const [comptes, setComptes] = useState([]);
  const [mouvements, setMouvements] = useState([]);

  useEffect(() => {
    (async () => {
      const [r, cmd, cl, pr, cat, cp, mv] = await Promise.all([
        db.rapports.list(),
        db.commandes.list(),
        db.clients.list(),
        db.produits.list(),
        db.produits_catalogue.list(),
        db.comptes_bancaires.list(),
        db.mouvements_financiers.list(),
      ]);
      setRapports(r);
      setCommandes(cmd);
      setClients(cl);
      setProduits(pr);
      setCatalogue(cat);
      setComptes(cp);
      setMouvements(mv);
      setLoading(false);
    })();
  }, []);

  const { start, end } = useMemo(() => getDateRange(periode), [periode]);
  const prevRange = useMemo(() => getPrevRange(periode), [periode]);

  // Filter by period
  const periodRapports = useMemo(() =>
    rapports.filter((r) => r.date >= start && r.date <= end),
    [rapports, start, end]
  );
  const prevRapports = useMemo(() =>
    rapports.filter((r) => r.date >= prevRange.start && r.date <= prevRange.end),
    [rapports, prevRange]
  );
  const periodCommandes = useMemo(() =>
    commandes.filter((c) => (c.date || c.created_at?.slice(0, 10) || '') >= start && (c.date || c.created_at?.slice(0, 10) || '') <= end),
    [commandes, start, end]
  );
  const prevCommandes = useMemo(() =>
    commandes.filter((c) => (c.date || c.created_at?.slice(0, 10) || '') >= prevRange.start && (c.date || c.created_at?.slice(0, 10) || '') <= prevRange.end),
    [commandes, prevRange]
  );

  // ═══ VENTES data ═══
  const ventesData = useMemo(() => {
    const catKeys = ['copies', 'marchandises', 'scan', 'tirage_saisies', 'badges_plastification', 'demi_photos', 'maintenance', 'imprimerie'];
    const ca = periodRapports.reduce((s, r) => {
      const cats = r.categories || {};
      return s + catKeys.reduce((ss, k) => ss + (cats[k] || 0), 0);
    }, 0);
    const prevCA = prevRapports.reduce((s, r) => {
      const cats = r.categories || {};
      return s + catKeys.reduce((ss, k) => ss + (cats[k] || 0), 0);
    }, 0);
    const nbCommandes = periodCommandes.length;
    const prevNbCommandes = prevCommandes.length;
    const panierMoyen = nbCommandes > 0 ? periodCommandes.reduce((s, c) => s + (c.montant_total || c.total || 0), 0) / nbCommandes : 0;
    const variationCA = prevCA > 0 ? ((ca - prevCA) / prevCA * 100) : 0;
    const variationCmd = prevNbCommandes > 0 ? ((nbCommandes - prevNbCommandes) / prevNbCommandes * 100) : 0;

    // CA par jour pour courbe
    const caParJour = {};
    periodRapports.forEach((r) => {
      const cats = r.categories || {};
      const total = catKeys.reduce((ss, k) => ss + (cats[k] || 0), 0);
      caParJour[r.date] = (caParJour[r.date] || 0) + total;
    });
    const courbeCA = Object.entries(caParJour)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, montant]) => ({ date: date.slice(5), montant }));

    // Par catégorie de service
    const parCategorie = {};
    periodRapports.forEach((r) => {
      const cats = r.categories || {};
      catKeys.forEach((k) => {
        const label = k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
        parCategorie[label] = (parCategorie[label] || 0) + (cats[k] || 0);
      });
    });
    const histoCategorie = Object.entries(parCategorie)
      .filter(([, v]) => v > 0)
      .sort(([, a], [, b]) => b - a)
      .map(([name, value]) => ({ name: name.length > 10 ? name.slice(0, 10) + '.' : name, value }));

    // Top produits/services vendus (from commandes)
    const prodMap = {};
    periodCommandes.forEach((c) => {
      const items = c.lignes || c.produits || [];
      items.forEach((item) => {
        const nom = item.designation || item.nom || item.description || 'Produit';
        if (!prodMap[nom]) prodMap[nom] = { nom, qte: 0, ca: 0 };
        prodMap[nom].qte += (item.quantite || 1);
        prodMap[nom].ca += ((item.quantite || 1) * (item.prix_unitaire || 0));
      });
    });
    const topProduits = Object.values(prodMap).sort((a, b) => b.ca - a.ca).slice(0, 10);

    return { ca, prevCA, variationCA, nbCommandes, variationCmd, panierMoyen, courbeCA, histoCategorie, topProduits };
  }, [periodRapports, prevRapports, periodCommandes, prevCommandes]);

  // ═══ STOCKS data ═══
  const stocksData = useMemo(() => {
    const articles = produits.filter((p) => !p.masque);
    const valeurTotale = articles.reduce((s, a) => s + ((a.prix_unitaire || 0) * (a.quantite ?? a.stock ?? 0)), 0);
    const enAlerte = articles.filter((a) => {
      const q = a.quantite ?? a.stock ?? 0;
      const min = a.quantite_minimum ?? a.stock_min ?? 0;
      return q > 0 && q <= min;
    });
    const enRupture = articles.filter((a) => (a.quantite ?? a.stock ?? 0) <= 0);
    const masques = produits.filter((p) => p.masque).length;

    return { articles, valeurTotale, enAlerte, enRupture, masques, total: articles.length };
  }, [produits]);

  // ═══ CLIENTS data ═══
  const clientsData = useMemo(() => {
    const total = clients.length;
    const thisMonth = new Date().toISOString().slice(0, 7);
    const nouveaux = clients.filter((c) => (c.created_at || '').slice(0, 7) === thisMonth).length;
    const recurrents = clients.filter((c) => {
      const cmdCount = commandes.filter((cmd) => cmd.client_id === c.id).length;
      return cmdCount >= 2;
    }).length;
    const tauxFidelisation = total > 0 ? (recurrents / total * 100) : 0;

    // Top 10 clients
    const topClients = clients.map((c) => {
      const cmds = commandes.filter((cmd) => cmd.client_id === c.id);
      const caTotal = cmds.reduce((s, cmd) => s + (cmd.montant_total || cmd.total || 0), 0);
      const derniere = cmds.sort((a, b) => (b.date || b.created_at || '').localeCompare(a.date || a.created_at || ''))[0];
      return { ...c, nbCommandes: cmds.length, caTotal, derniereCommande: derniere?.date || derniere?.created_at?.slice(0, 10) || '—' };
    }).sort((a, b) => b.caTotal - a.caTotal).slice(0, 10);

    // Inactifs > 30 jours
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const inactifs = clients.filter((c) => {
      const cmds = commandes.filter((cmd) => cmd.client_id === c.id);
      if (cmds.length === 0) return true;
      const lastDate = cmds.reduce((max, cmd) => {
        const d = cmd.date || cmd.created_at?.slice(0, 10) || '';
        return d > max ? d : max;
      }, '');
      return lastDate < thirtyDaysAgo;
    }).slice(0, 10);

    // Répartition type
    const entreprises = clients.filter((c) => c.type === 'entreprise').length;
    const particuliers = total - entreprises;

    // Évolution nombre de clients par mois
    const parMois = {};
    clients.forEach((c) => {
      const m = (c.created_at || '').slice(0, 7);
      if (m) parMois[m] = (parMois[m] || 0) + 1;
    });
    const evolutionClients = Object.entries(parMois)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mois, count]) => ({ mois: mois.slice(2), count }));

    return { total, nouveaux, recurrents, tauxFidelisation, topClients, inactifs, entreprises, particuliers, evolutionClients };
  }, [clients, commandes]);

  // ═══ FINANCE data ═══
  const financeData = useMemo(() => {
    const catKeys = ['copies', 'marchandises', 'scan', 'tirage_saisies', 'badges_plastification', 'demi_photos', 'maintenance', 'imprimerie'];

    const monthRapports = rapports.filter((r) => (r.date || '').slice(0, 7) === new Date().toISOString().slice(0, 7));
    const recettes = monthRapports.reduce((s, r) => {
      const cats = r.categories || {};
      return s + catKeys.reduce((ss, k) => ss + (cats[k] || 0), 0);
    }, 0);

    const depenses = monthRapports.reduce((s, r) => {
      const lignes = r.lignes || [];
      return s + lignes.reduce((ss, l) => ss + (l.sorties || 0), 0);
    }, 0);

    const marge = recettes - depenses;
    const soldeCaisse = recettes - depenses;

    // Recettes vs dépenses par mois (12 derniers mois)
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      months.push(d.toISOString().slice(0, 7));
    }
    const recettesVsDepenses = months.map((m) => {
      const mRaps = rapports.filter((r) => (r.date || '').slice(0, 7) === m);
      const rec = mRaps.reduce((s, r) => {
        const cats = r.categories || {};
        return s + catKeys.reduce((ss, k) => ss + (cats[k] || 0), 0);
      }, 0);
      const dep = mRaps.reduce((s, r) => {
        const lignes = r.lignes || [];
        return s + lignes.reduce((ss, l) => ss + (l.sorties || 0), 0);
      }, 0);
      return { mois: m.slice(2), recettes: rec, depenses: dep };
    });

    // Derniers mouvements financiers
    const derniersMouvements = [...mouvements].sort((a, b) => (b.date || b.created_at || '').localeCompare(a.date || a.created_at || '')).slice(0, 10);

    return { recettes, depenses, marge, soldeCaisse, recettesVsDepenses, comptes, derniersMouvements };
  }, [rapports, mouvements, comptes]);

  // ═══ Visibility ═══
  const canSeeFinance = isAdmin;
  const visibleTabs = TABS.filter((t) => {
    if (t.id === 'finance' && !canSeeFinance) return false;
    return true;
  });

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-900 via-blue-900 to-cyan-900 p-6 text-white">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/5" />
        <div className="relative">
          <div className="flex items-center gap-3 mb-1">
            <BarChart3 className="h-6 w-6 text-cyan-300" />
            <h2 className="text-2xl font-bold">Rapports & Analyses</h2>
          </div>
          <p className="text-blue-200/70 text-sm">Tableau de bord analytique complet</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-muted p-1 overflow-x-auto">
        {visibleTabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 min-w-[80px] flex items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-all whitespace-nowrap ${
              tab === id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="h-4 w-4" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {/* ═══════════════ ONGLET VENTES ═══════════════ */}
      {tab === 'ventes' && (
        <>
          {/* Filtre période */}
          <div className="flex flex-wrap gap-1.5">
            {PERIODES.map((p) => (
              <button
                key={p.value}
                onClick={() => setPeriode(p.value)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                  periode === p.value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              {
                label: 'Chiffre d\'affaires',
                value: `${fmt(ventesData.ca)} F`,
                variation: ventesData.variationCA,
                icon: DollarSign,
                color: 'border-l-emerald-500',
              },
              {
                label: 'Commandes',
                value: ventesData.nbCommandes,
                variation: ventesData.variationCmd,
                icon: ShoppingCart,
                color: 'border-l-blue-500',
              },
              {
                label: 'Panier moyen',
                value: `${fmt(ventesData.panierMoyen)} F`,
                icon: CreditCard,
                color: 'border-l-violet-500',
              },
              {
                label: 'Rapports jour',
                value: periodRapports.length,
                icon: FileText,
                color: 'border-l-amber-500',
              },
            ].map(({ label, value, variation, icon: Icon, color }) => (
              <Card key={label} className={`border-l-4 ${color}`}>
                <CardContent className="p-3 sm:p-4">
                  <div className="flex items-start justify-between gap-1">
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] sm:text-[11px] text-muted-foreground uppercase tracking-wide truncate">{label}</p>
                      <p className="text-sm sm:text-xl font-bold mt-1">{value}</p>
                      {variation !== undefined && (
                        <p className={`text-[10px] flex items-center gap-0.5 mt-0.5 ${variation >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                          {variation >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                          {Math.abs(variation).toFixed(1)}% vs période préc.
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 rounded-lg bg-muted p-1.5 sm:p-2"><Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" /></div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Charts */}
          <div className="grid lg:grid-cols-2 gap-4">
            {/* Courbe CA */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Évolution du CA</CardTitle>
              </CardHeader>
              <CardContent>
                {ventesData.courbeCA.length === 0 ? (
                  <p className="text-center text-muted-foreground text-sm py-8">Aucune donnée pour cette période</p>
                ) : (
                  <div className="h-[220px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={ventesData.courbeCA}>
                        <defs>
                          <linearGradient id="caGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3} />
                            <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                        <Tooltip formatter={(v) => `${fmt(v)} F`} />
                        <Area type="monotone" dataKey="montant" stroke="#3b82f6" fill="url(#caGradient)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Histogramme par catégorie */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">CA par Service</CardTitle>
              </CardHeader>
              <CardContent>
                {ventesData.histoCategorie.length === 0 ? (
                  <p className="text-center text-muted-foreground text-sm py-8">Aucune donnée</p>
                ) : (
                  <div className="h-[220px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={ventesData.histoCategorie} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                        <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} width={80} />
                        <Tooltip formatter={(v) => `${fmt(v)} F`} />
                        <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Top 10 Produits */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Top 10 Produits/Services vendus</CardTitle>
            </CardHeader>
            <CardContent>
              {ventesData.topProduits.length === 0 ? (
                <p className="text-center text-muted-foreground text-sm py-6">Aucune donnée de vente pour cette période</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground">#</th>
                        <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground">Produit</th>
                        <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">Qté vendue</th>
                        <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">CA généré</th>
                        <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">% du total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ventesData.topProduits.map((p, i) => {
                        const totalCA = ventesData.topProduits.reduce((s, pp) => s + pp.ca, 0);
                        const pct = totalCA > 0 ? (p.ca / totalCA * 100) : 0;
                        return (
                          <tr key={i} className="border-b last:border-0">
                            <td className="py-2 px-3 text-muted-foreground font-bold">{i + 1}</td>
                            <td className="py-2 px-3 font-medium">{p.nom}</td>
                            <td className="py-2 px-3 text-right">{p.qte}</td>
                            <td className="py-2 px-3 text-right font-bold">{fmt(p.ca)} F</td>
                            <td className="py-2 px-3 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden">
                                  <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.min(100, pct)}%` }} />
                                </div>
                                <span className="text-xs text-muted-foreground w-10 text-right">{pct.toFixed(1)}%</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* ═══════════════ ONGLET STOCKS ═══════════════ */}
      {tab === 'stocks' && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Valeur totale', value: `${fmt(stocksData.valeurTotale)} F`, icon: DollarSign, color: 'border-l-blue-500' },
              { label: 'En alerte', value: stocksData.enAlerte.length, icon: AlertTriangle, color: 'border-l-amber-500' },
              { label: 'En rupture', value: stocksData.enRupture.length, icon: PackageMinus, color: 'border-l-red-500' },
              { label: 'Articles masqués', value: stocksData.masques, icon: Eye, color: 'border-l-gray-400' },
            ].map(({ label, value, icon: Icon, color }) => (
              <Card key={label} className={`border-l-4 ${color}`}>
                <CardContent className="p-3 sm:p-4">
                  <div className="flex items-center gap-3">
                    <div className="shrink-0 rounded-lg bg-muted p-2"><Icon className="h-4 w-4 text-muted-foreground" /></div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase">{label}</p>
                      <p className="text-lg font-bold">{value}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Articles en alerte / rupture */}
          {(stocksData.enAlerte.length > 0 || stocksData.enRupture.length > 0) && (
            <Card className="border-l-4 border-l-red-500">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-500" /> Articles à surveiller
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  {[...stocksData.enRupture, ...stocksData.enAlerte].slice(0, 10).map((a) => {
                    const q = a.quantite ?? a.stock ?? 0;
                    const isRupture = q <= 0;
                    return (
                      <div key={a.id} className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${isRupture ? 'bg-red-50 border border-red-200' : 'bg-amber-50 border border-amber-200'}`}>
                        <div>
                          <span className="font-medium">{a.nom}</span>
                          <span className="text-xs text-muted-foreground ml-2">{a.categorie}</span>
                        </div>
                        <Badge className={isRupture ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}>
                          {isRupture ? 'Rupture' : `Stock bas: ${q}`}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Tableau complet stock */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">État complet du stock</CardTitle>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => exportInventairePDF(stocksData.articles)}>
                  <Download className="h-3.5 w-3.5" /> PDF
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground">Nom</th>
                      <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground">Catégorie</th>
                      <th className="text-center py-2 px-3 text-xs font-medium text-muted-foreground">Quantité</th>
                      <th className="text-center py-2 px-3 text-xs font-medium text-muted-foreground">Seuil min</th>
                      <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground">Statut</th>
                      <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">Valeur</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stocksData.articles.slice(0, 30).map((a) => {
                      const q = a.quantite ?? a.stock ?? 0;
                      const min = a.quantite_minimum ?? a.stock_min ?? 0;
                      const val = (a.prix_unitaire || 0) * q;
                      const isRupture = q <= 0;
                      const isBas = q > 0 && q <= min;
                      return (
                        <tr key={a.id} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="py-2 px-3 font-medium">{a.nom}</td>
                          <td className="py-2 px-3 text-muted-foreground text-xs">{a.categorie || '—'}</td>
                          <td className="py-2 px-3 text-center font-bold">{q}</td>
                          <td className="py-2 px-3 text-center text-muted-foreground">{min}</td>
                          <td className="py-2 px-3">
                            <Badge className={`text-[10px] ${isRupture ? 'bg-red-100 text-red-700' : isBas ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                              {isRupture ? 'Rupture' : isBas ? 'Bas' : 'OK'}
                            </Badge>
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums">{fmt(val)} F</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* ═══════════════ ONGLET CLIENTS ═══════════════ */}
      {tab === 'clients' && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Clients actifs', value: clientsData.total, icon: Users, color: 'border-l-blue-500' },
              { label: 'Nouveaux ce mois', value: clientsData.nouveaux, icon: UserCheck, color: 'border-l-emerald-500' },
              { label: 'Récurrents (2+ cmd)', value: clientsData.recurrents, icon: TrendingUp, color: 'border-l-violet-500' },
              { label: 'Taux fidélisation', value: `${clientsData.tauxFidelisation.toFixed(1)}%`, icon: PieChartIcon, color: 'border-l-amber-500' },
            ].map(({ label, value, icon: Icon, color }) => (
              <Card key={label} className={`border-l-4 ${color}`}>
                <CardContent className="p-3 sm:p-4">
                  <div className="flex items-center gap-3">
                    <div className="shrink-0 rounded-lg bg-muted p-2"><Icon className="h-4 w-4 text-muted-foreground" /></div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase">{label}</p>
                      <p className="text-lg font-bold">{value}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            {/* Top 10 clients */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Top 10 Clients</CardTitle>
              </CardHeader>
              <CardContent>
                {clientsData.topClients.length === 0 ? (
                  <p className="text-center text-muted-foreground text-sm py-6">Aucun client</p>
                ) : (
                  <div className="space-y-1.5">
                    {clientsData.topClients.map((c, i) => (
                      <div key={c.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground font-bold w-5">{i + 1}</span>
                          <div>
                            <p className="text-sm font-medium">{c.nom}</p>
                            <p className="text-[10px] text-muted-foreground">{c.nbCommandes} cmd — Dern. {c.derniereCommande}</p>
                          </div>
                        </div>
                        <span className="text-sm font-bold">{fmt(c.caTotal)} F</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Répartition + Évolution */}
            <div className="space-y-4">
              {/* Type pie */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Répartition par type</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[180px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={[
                            { name: 'Entreprises', value: clientsData.entreprises },
                            { name: 'Particuliers', value: clientsData.particuliers },
                          ]}
                          cx="50%" cy="50%" outerRadius={65} dataKey="value"
                          label={({ name, value }) => `${name}: ${value}`}
                        >
                          <Cell fill="#3b82f6" />
                          <Cell fill="#f59e0b" />
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {/* Évolution */}
              {clientsData.evolutionClients.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Nouveaux clients / mois</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[150px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={clientsData.evolutionClients}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis dataKey="mois" tick={{ fontSize: 10 }} />
                          <YAxis tick={{ fontSize: 10 }} />
                          <Tooltip />
                          <Bar dataKey="count" fill="#10b981" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>

          {/* Clients inactifs */}
          {clientsData.inactifs.length > 0 && (
            <Card className="border-l-4 border-l-amber-500">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" /> Clients inactifs (&gt; 30 jours)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  {clientsData.inactifs.map((c) => (
                    <div key={c.id} className="flex items-center justify-between rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm">
                      <span className="font-medium">{c.nom}</span>
                      <span className="text-xs text-muted-foreground">{c.telephone || c.email || '—'}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* ═══════════════ ONGLET FINANCE ═══════════════ */}
      {tab === 'finance' && canSeeFinance && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Recettes (mois)', value: `${fmt(financeData.recettes)} F`, icon: TrendingUp, color: 'border-l-emerald-500' },
              { label: 'Dépenses (mois)', value: `${fmt(financeData.depenses)} F`, icon: TrendingDown, color: 'border-l-red-500' },
              { label: 'Marge brute', value: `${fmt(financeData.marge)} F`, icon: DollarSign, color: 'border-l-blue-500' },
              { label: 'Solde caisse net', value: `${fmt(financeData.soldeCaisse)} F`, icon: Wallet, color: 'border-l-violet-500' },
            ].map(({ label, value, icon: Icon, color }) => (
              <Card key={label} className={`border-l-4 ${color}`}>
                <CardContent className="p-3 sm:p-4">
                  <div className="flex items-center gap-3">
                    <div className="shrink-0 rounded-lg bg-muted p-2"><Icon className="h-4 w-4 text-muted-foreground" /></div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase">{label}</p>
                      <p className="text-lg font-bold">{value}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Recettes vs Dépenses chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Recettes vs Dépenses (12 derniers mois)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={financeData.recettesVsDepenses}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="mois" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                    <Tooltip formatter={(v) => `${fmt(v)} F`} />
                    <Legend />
                    <Bar dataKey="recettes" name="Recettes" fill="#10b981" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="depenses" name="Dépenses" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <div className="grid lg:grid-cols-2 gap-4">
            {/* Comptes bancaires */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <CreditCard className="h-4 w-4" /> Comptes bancaires
                </CardTitle>
              </CardHeader>
              <CardContent>
                {financeData.comptes.length === 0 ? (
                  <p className="text-center text-muted-foreground text-sm py-6">Aucun compte enregistré</p>
                ) : (
                  <div className="space-y-2">
                    {financeData.comptes.map((c) => (
                      <div key={c.id} className="flex items-center justify-between rounded-lg border px-3 py-2.5">
                        <div>
                          <p className="text-sm font-medium">{c.nom || c.banque || '—'}</p>
                          <p className="text-[10px] text-muted-foreground">{c.devise || 'FCFA'}</p>
                        </div>
                        <span className={`text-sm font-bold ${(c.solde || 0) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                          {fmt(c.solde || 0)} F
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Alertes finance */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-500" /> Alertes financières
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {financeData.marge < 0 && (
                    <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      Marge négative ce mois : {fmt(financeData.marge)} F
                    </div>
                  )}
                  {financeData.comptes.filter((c) => (c.solde || 0) < 0).map((c) => (
                    <div key={c.id} className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      Solde négatif : {c.nom || c.banque} ({fmt(c.solde)} F)
                    </div>
                  ))}
                  {financeData.marge >= 0 && financeData.comptes.filter((c) => (c.solde || 0) < 0).length === 0 && (
                    <p className="text-center text-emerald-600 text-sm py-6">Aucune alerte financière</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {/* ═══════════════ ONGLET EXPORTS ═══════════════ */}
      {tab === 'exports' && (
        <div className="grid sm:grid-cols-2 gap-4">
          <Card className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => {
            const mois = new Date().toISOString().slice(0, 7);
            exportRapportCompletPDF({
              mois,
              ventes: { ca: ventesData.ca, nbCommandes: ventesData.nbCommandes, panierMoyen: ventesData.panierMoyen },
              topProduits: ventesData.topProduits,
              finance: { recettes: financeData.recettes, depenses: financeData.depenses, marge: financeData.marge },
              stock: { totalArticles: stocksData.total, enAlerte: stocksData.enAlerte.length, enRupture: stocksData.enRupture.length, valeurTotale: stocksData.valeurTotale },
              topClients: clientsData.topClients.map((c) => ({ nom: c.nom, nbCommandes: c.nbCommandes, ca: c.caTotal })),
            });
            toast.success('Rapport complet généré');
          }}>
            <CardContent className="p-6 text-center">
              <Download className="h-8 w-8 mx-auto mb-3 text-primary" />
              <h3 className="font-bold">Rapport complet du mois</h3>
              <p className="text-sm text-muted-foreground mt-1">PDF récapitulatif de tous les onglets</p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => {
            const catKeys = ['copies', 'marchandises', 'scan', 'tirage_saisies', 'badges_plastification', 'demi_photos', 'maintenance', 'imprimerie'];
            const data = periodRapports.map((r) => {
              const cats = r.categories || {};
              const total = catKeys.reduce((s, k) => s + (cats[k] || 0), 0);
              return { date: r.date, operateur: r.operateur_nom || '—', total, ...cats };
            });
            exportCSV(data, [
              { label: 'Date', accessor: 'date' },
              { label: 'Opérateur', accessor: 'operateur' },
              ...catKeys.map((k) => ({ label: k, accessor: k })),
              { label: 'Total', accessor: 'total' },
            ], 'ventes_export.csv');
            toast.success('Export ventes CSV généré');
          }}>
            <CardContent className="p-6 text-center">
              <FileText className="h-8 w-8 mx-auto mb-3 text-emerald-600" />
              <h3 className="font-bold">Export ventes CSV</h3>
              <p className="text-sm text-muted-foreground mt-1">Tableau des ventes de la période</p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => {
            exportCSV(clients, [
              { label: 'Nom', accessor: 'nom' },
              { label: 'Email', accessor: 'email' },
              { label: 'Téléphone', accessor: 'telephone' },
              { label: 'Ville', accessor: 'ville' },
              { label: 'Type', accessor: 'type' },
            ], 'clients_export.csv');
            toast.success('Export clients CSV généré');
          }}>
            <CardContent className="p-6 text-center">
              <Users className="h-8 w-8 mx-auto mb-3 text-violet-600" />
              <h3 className="font-bold">Export clients CSV</h3>
              <p className="text-sm text-muted-foreground mt-1">Liste complète des clients</p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => {
            exportCSV(produits.filter((p) => !p.masque), [
              { label: 'Nom', accessor: 'nom' },
              { label: 'Référence', accessor: 'reference' },
              { label: 'Catégorie', accessor: 'categorie' },
              { label: 'Quantité', accessor: (r) => r.quantite ?? r.stock ?? 0 },
              { label: 'Minimum', accessor: (r) => r.quantite_minimum ?? r.stock_min ?? 0 },
              { label: 'Prix unitaire', accessor: 'prix_unitaire' },
              { label: 'Unité', accessor: 'unite' },
              { label: 'Fournisseur', accessor: 'fournisseur' },
            ], 'stock_export.csv');
            toast.success('Export stock CSV généré');
          }}>
            <CardContent className="p-6 text-center">
              <Boxes className="h-8 w-8 mx-auto mb-3 text-amber-600" />
              <h3 className="font-bold">Export stock CSV</h3>
              <p className="text-sm text-muted-foreground mt-1">État complet du stock</p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
