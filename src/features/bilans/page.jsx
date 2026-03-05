import { useState, useEffect, useMemo } from 'react';
import { db } from '@/services/db';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  TrendingUp, TrendingDown, DollarSign, BarChart3, PieChart as PieIcon,
  Calendar, ArrowUpRight, ArrowDownRight, Minus,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';

function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)); }

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

export default function Bilans() {
  const [rapports, setRapports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [periode, setPeriode] = useState('mois');
  const [mois, setMois] = useState(() => new Date().toISOString().slice(0, 7));

  useEffect(() => {
    Promise.all([db.rapports.list(), db.rapportLignes.list()]).then(([r, l]) => {
      const enriched = r.map((rap) => ({
        ...rap,
        lignes: l.filter((li) => li.rapport_id === rap.id),
      }));
      setRapports(enriched);
      setLoading(false);
    });
  }, []);

  const data = useMemo(() => {
    let filtered = rapports;
    if (periode === 'mois') {
      filtered = rapports.filter((r) => (r.date || '').startsWith(mois));
    } else if (periode === 'annee') {
      filtered = rapports.filter((r) => (r.date || '').startsWith(mois.slice(0, 4)));
    }

    // Totals
    let totalCA = 0; let totalDepenses = 0;
    const parService = {};
    const parJour = {};

    filtered.forEach((r) => {
      const recettes = r.lignes.reduce((s, li) => s + (li.recettes || 0), 0);
      const depenses = r.lignes.reduce((s, li) => s + (li.depenses || 0), 0);
      totalCA += recettes;
      totalDepenses += depenses;

      // By service
      r.lignes.forEach((li) => {
        const svc = li.service || 'Autre';
        if (!parService[svc]) parService[svc] = { recettes: 0, depenses: 0 };
        parService[svc].recettes += li.recettes || 0;
        parService[svc].depenses += li.depenses || 0;
      });

      // By day
      const jour = r.date || 'inconnu';
      if (!parJour[jour]) parJour[jour] = { recettes: 0, depenses: 0 };
      parJour[jour].recettes += recettes;
      parJour[jour].depenses += depenses;
    });

    const benefice = totalCA - totalDepenses;
    const marge = totalCA > 0 ? (benefice / totalCA) * 100 : 0;
    const nbJours = Object.keys(parJour).length || 1;

    // Service chart data
    const serviceData = Object.entries(parService)
      .map(([name, v]) => ({ name, recettes: v.recettes, depenses: v.depenses, benefice: v.recettes - v.depenses }))
      .sort((a, b) => b.recettes - a.recettes);

    // Daily trend
    const dailyData = Object.entries(parJour)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({
        date: new Date(date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }),
        recettes: v.recettes, depenses: v.depenses, benefice: v.recettes - v.depenses,
      }));

    // Pie data
    const pieData = serviceData.map((s) => ({ name: s.name, value: s.recettes }));

    return { totalCA, totalDepenses, benefice, marge, nbJours, moyenne: totalCA / nbJours, serviceData, dailyData, pieData, nbRapports: filtered.length };
  }, [rapports, periode, mois]);

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  }

  const TrendIcon = data.benefice >= 0 ? ArrowUpRight : ArrowDownRight;
  const trendColor = data.benefice >= 0 ? 'text-emerald-600' : 'text-red-600';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Bilans Financiers</h2>
          <p className="text-muted-foreground">Analyse de rentabilité — {data.nbRapports} rapports</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={periode} onValueChange={setPeriode}>
            <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="semaine">Semaine</SelectItem>
              <SelectItem value="mois">Mois</SelectItem>
              <SelectItem value="annee">Année</SelectItem>
            </SelectContent>
          </Select>
          <input type="month" value={mois} onChange={(e) => setMois(e.target.value)}
            className="rounded-md border px-3 py-2 text-sm" />
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="border-l-4 border-l-emerald-500">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Chiffre d'affaires</p>
            <p className="text-xl font-bold">{fmt(data.totalCA)} F</p>
            <p className="text-[10px] text-muted-foreground mt-1">Moy. {fmt(data.moyenne)}/jour</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-red-500">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Dépenses</p>
            <p className="text-xl font-bold">{fmt(data.totalDepenses)} F</p>
            <p className="text-[10px] text-muted-foreground mt-1">{data.totalCA > 0 ? Math.round((data.totalDepenses / data.totalCA) * 100) : 0}% du CA</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Bénéfice net</p>
            <div className="flex items-center gap-2">
              <p className={`text-xl font-bold ${data.benefice >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmt(data.benefice)} F</p>
              <TrendIcon className={`h-4 w-4 ${trendColor}`} />
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-violet-500">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Marge nette</p>
            <p className={`text-xl font-bold ${data.marge >= 50 ? 'text-emerald-600' : data.marge >= 20 ? 'text-amber-600' : 'text-red-600'}`}>
              {data.marge.toFixed(1)}%
            </p>
            <Badge variant="outline" className={`mt-1 text-[10px] ${data.marge >= 50 ? 'text-emerald-600' : data.marge >= 20 ? 'text-amber-600' : 'text-red-600'}`}>
              {data.marge >= 50 ? 'Excellent' : data.marge >= 20 ? 'Correct' : 'Faible'}
            </Badge>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Daily trend */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><BarChart3 className="h-4 w-4" /> Évolution journalière</CardTitle>
          </CardHeader>
          <CardContent>
            {data.dailyData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={data.dailyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                  <Tooltip formatter={(v) => `${fmt(v)} F`} />
                  <Legend />
                  <Bar dataKey="recettes" name="Recettes" fill="#10b981" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="depenses" name="Dépenses" fill="#ef4444" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">Aucune donnée pour cette période</p>
            )}
          </CardContent>
        </Card>

        {/* Pie by service */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><PieIcon className="h-4 w-4" /> Répartition par service</CardTitle>
          </CardHeader>
          <CardContent>
            {data.pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={data.pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={100}
                    paddingAngle={3} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {data.pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => `${fmt(v)} F`} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">Aucune donnée</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Service details table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Rentabilité par service</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {data.serviceData.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left font-medium">Service</th>
                    <th className="px-4 py-3 text-right font-medium">Recettes</th>
                    <th className="px-4 py-3 text-right font-medium">Dépenses</th>
                    <th className="px-4 py-3 text-right font-medium">Bénéfice</th>
                    <th className="px-4 py-3 text-right font-medium">Marge</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.serviceData.map((s, i) => {
                    const m = s.recettes > 0 ? ((s.benefice / s.recettes) * 100).toFixed(1) : '0.0';
                    return (
                      <tr key={s.name} className="hover:bg-muted/30">
                        <td className="px-4 py-3 font-medium">
                          <div className="flex items-center gap-2">
                            <div className="h-3 w-3 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                            {s.name}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right text-emerald-600">{fmt(s.recettes)} F</td>
                        <td className="px-4 py-3 text-right text-red-600">{fmt(s.depenses)} F</td>
                        <td className={`px-4 py-3 text-right font-semibold ${s.benefice >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmt(s.benefice)} F</td>
                        <td className="px-4 py-3 text-right">
                          <Badge variant="outline" className={`text-[10px] ${Number(m) >= 50 ? 'text-emerald-600' : Number(m) >= 20 ? 'text-amber-600' : 'text-red-600'}`}>
                            {m}%
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 bg-muted/30 font-bold">
                    <td className="px-4 py-3">TOTAL</td>
                    <td className="px-4 py-3 text-right text-emerald-600">{fmt(data.totalCA)} F</td>
                    <td className="px-4 py-3 text-right text-red-600">{fmt(data.totalDepenses)} F</td>
                    <td className={`px-4 py-3 text-right ${data.benefice >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmt(data.benefice)} F</td>
                    <td className="px-4 py-3 text-right">{data.marge.toFixed(1)}%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">Aucune donnée pour cette période</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
