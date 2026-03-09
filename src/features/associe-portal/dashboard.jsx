import { useState, useEffect, useMemo } from 'react';
import { db, getSettings } from '@/services/db';
import { useAuth } from '@/services/auth';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  TrendingUp, Users, Boxes, BookOpen, DollarSign,
  PieChart, BarChart3, Package, Eye,
} from 'lucide-react';

function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)); }

export default function AssocieDashboard() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({
    employes: [], stocks: [], inventaire: [], commandes: [], produits: [],
    actionnaires: [], investissements: [], apports: [],
  });
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    const loadData = async () => {
      const [emp, stk, inv, cmd, prod, act, invest, ap, s] = await Promise.all([
        db.employes.list(),
        db.produits_catalogue.list(),
        db.produits.list(), // Inventaire réel (stocks matières/textiles/machines)
        db.commandes.list(),
        db.produits_catalogue.list(),
        db.actionnaires.list(),
        db.investissements.list(),
        db.apports_associes.list(),
        getSettings(),
      ]);
      setData({
        employes: emp.filter((e) => e.role !== 'client'),
        stocks: stk,
        inventaire: inv,
        commandes: cmd,
        produits: prod,
        actionnaires: act,
        investissements: invest,
        apports: ap,
      });
      setSettings(s);
      setLoading(false);
    };
    loadData();
  }, []);

  const stats = useMemo(() => {
    const totalEmployes = data.employes.length;
    const totalProduits = data.produits.length;
    const commandesMois = data.commandes.filter((c) => {
      const d = c.created_at || '';
      return d.startsWith(new Date().toISOString().slice(0, 7));
    });
    const totalCapital = data.actionnaires.reduce((s, a) => s + (a.montant_apport || 0), 0);
    const totalInvest = data.investissements.reduce((s, i) => s + (i.montant || 0), 0);
    const totalApports = data.apports.reduce((s, a) => s + (a.montant || 0), 0);
    // Valeur inventaire (prix d'achat × quantité)
    const valeurInventaireAchat = data.inventaire.reduce((s, p) => {
      if (p.valeur_stock_achat) return s + p.valeur_stock_achat;
      return s + ((p.prix_unitaire || 0) * (p.quantite || 0));
    }, 0);
    const valeurInventaireVente = data.inventaire.reduce((s, p) => {
      if (p.valeur_vente_totale) return s + p.valeur_vente_totale;
      return s + ((p.prix_vente || 0) * (p.quantite || 0));
    }, 0);
    const totalArticlesInventaire = data.inventaire.length;

    return {
      totalEmployes,
      totalProduits,
      commandesMois: commandesMois.length,
      totalCapital,
      totalInvest,
      totalApports,
      valeurInventaireAchat,
      valeurInventaireVente,
      totalArticlesInventaire,
    };
  }, [data]);

  if (loading) return (
    <div className="flex justify-center py-12">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Bannière */}
      <div className="relative rounded-2xl overflow-hidden">
        <div className="bg-gradient-to-br from-indigo-600 to-purple-700 p-6 sm:p-8 text-white">
          <div className="relative z-10">
            <h1 className="text-2xl sm:text-3xl font-bold">
              Bienvenue, {user?.prenom} !
            </h1>
            <p className="text-white/80 mt-1 text-sm sm:text-base">
              Tableau de bord Associé — Vue d&apos;ensemble de l&apos;entreprise
            </p>
          </div>
        </div>
      </div>

      {/* KPIs principaux */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Employés', value: stats.totalEmployes, icon: Users, color: 'bg-blue-500/10 text-blue-600' },
          { label: 'Produits catalogue', value: stats.totalProduits, icon: BookOpen, color: 'bg-violet-500/10 text-violet-600' },
          { label: 'Commandes ce mois', value: stats.commandesMois, icon: Package, color: 'bg-amber-500/10 text-amber-600' },
          { label: 'Capital total', value: `${fmt(stats.totalCapital)} F`, icon: TrendingUp, color: 'bg-emerald-500/10 text-emerald-600', isText: true },
        ].map(({ label, value, icon: Icon, color, isText }) => (
          <Card key={label}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${color}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className={`${isText ? 'text-sm' : 'text-lg'} font-bold`}>{value}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Inventaire (valeur des actifs) */}
      <Card>
        <CardContent className="p-4">
          <h2 className="font-semibold text-sm flex items-center gap-2 mb-4">
            <Boxes className="h-4 w-4 text-muted-foreground" />
            Inventaire — Valeur des actifs ({stats.totalArticlesInventaire} articles)
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-lg border p-3 text-center">
              <p className="text-xs text-muted-foreground">Valeur d&apos;achat (coût)</p>
              <p className="text-lg font-bold text-blue-600">{fmt(stats.valeurInventaireAchat)} F</p>
            </div>
            <div className="rounded-lg border p-3 text-center">
              <p className="text-xs text-muted-foreground">Valeur de vente (estimée)</p>
              <p className="text-lg font-bold text-emerald-600">{fmt(stats.valeurInventaireVente)} F</p>
            </div>
          </div>
          {data.inventaire.length > 0 && (
            <div className="mt-3 max-h-60 overflow-y-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="px-2 py-1.5 text-left font-medium">Article</th>
                    <th className="px-2 py-1.5 text-center font-medium">Qté</th>
                    <th className="px-2 py-1.5 text-right font-medium">Valeur achat</th>
                    <th className="px-2 py-1.5 text-right font-medium">Valeur vente</th>
                  </tr>
                </thead>
                <tbody>
                  {data.inventaire
                    .filter(p => (p.quantite || 0) > 0)
                    .sort((a, b) => ((b.valeur_stock_achat || 0) - (a.valeur_stock_achat || 0)))
                    .map((p) => (
                    <tr key={p.id} className="border-b border-muted/20">
                      <td className="px-2 py-1">{p.nom}</td>
                      <td className="px-2 py-1 text-center">{p.quantite}</td>
                      <td className="px-2 py-1 text-right">{fmt(p.valeur_stock_achat || (p.prix_unitaire || 0) * (p.quantite || 0))} F</td>
                      <td className="px-2 py-1 text-right">{fmt(p.valeur_vente_totale || (p.prix_vente || 0) * (p.quantite || 0))} F</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Gouvernance */}
      <Card>
        <CardContent className="p-4">
          <h2 className="font-semibold text-sm flex items-center gap-2 mb-4">
            <PieChart className="h-4 w-4 text-muted-foreground" />
            Gouvernance & Capital
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-lg border p-3 text-center">
              <p className="text-xs text-muted-foreground">Investissements</p>
              <p className="text-lg font-bold text-emerald-600">{fmt(stats.totalInvest)} F</p>
              <p className="text-[10px] text-muted-foreground">{data.investissements.length} opération(s)</p>
            </div>
            <div className="rounded-lg border p-3 text-center">
              <p className="text-xs text-muted-foreground">Apports associés</p>
              <p className="text-lg font-bold text-blue-600">{fmt(stats.totalApports)} F</p>
              <p className="text-[10px] text-muted-foreground">{data.apports.length} apport(s)</p>
            </div>
            <div className="rounded-lg border p-3 text-center">
              <p className="text-xs text-muted-foreground">Actionnaires</p>
              <p className="text-lg font-bold text-indigo-600">{data.actionnaires.length}</p>
              <p className="text-[10px] text-muted-foreground">partenaires enregistrés</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Liste employés (noms et postes uniquement) */}
      <Card>
        <CardContent className="p-4">
          <h2 className="font-semibold text-sm flex items-center gap-2 mb-4">
            <Users className="h-4 w-4 text-muted-foreground" />
            Équipe ({data.employes.length} personnes)
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {data.employes.map((emp) => (
              <div key={emp.id} className="flex items-center gap-3 rounded-lg border p-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                  {emp.prenom?.[0]}{emp.nom?.[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{emp.prenom} {emp.nom}</p>
                  <p className="text-[10px] text-muted-foreground">{emp.poste || emp.role}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Note d'accès restreint */}
      <Card className="border-amber-200 bg-amber-50/50">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Eye className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-800">Accès Associé</p>
              <p className="text-xs text-amber-700 mt-1">
                En tant qu&apos;associé, vous avez un accès en lecture seule aux données stratégiques :
                inventaire (quantités et valeurs des actifs), catalogue, gouvernance, et la liste des employés.
                L&apos;inventaire vous permet de suivre la valeur réelle de l&apos;entreprise.
                Pour toute question, contactez l&apos;administrateur.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
