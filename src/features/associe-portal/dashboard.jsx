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
        db.produits.list(),
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

  // Find the current associé's own record
  const myApport = useMemo(() => {
    const nom = `${user?.prenom || ''} ${user?.nom || ''}`.trim().toLowerCase();
    return data.actionnaires.find((a) => {
      const aNom = `${a.prenom || ''} ${a.nom || ''}`.trim().toLowerCase();
      return a.user_id === user?.id || aNom === nom || (a.nom || '').toLowerCase() === (user?.nom || '').toLowerCase();
    });
  }, [data.actionnaires, user]);

  const stats = useMemo(() => {
    const totalEmployes = data.employes.length;
    const totalProduits = data.produits.length;
    const commandesMois = data.commandes.filter((c) => {
      const d = c.created_at || '';
      return d.startsWith(new Date().toISOString().slice(0, 7));
    });
    const totalArticlesInventaire = data.inventaire.length;

    return {
      totalEmployes,
      totalProduits,
      commandesMois: commandesMois.length,
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

      {/* KPIs principaux (sans capital) */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {[
          { label: 'Employés', value: stats.totalEmployes, icon: Users, color: 'bg-blue-500/10 text-blue-600' },
          { label: 'Produits catalogue', value: stats.totalProduits, icon: BookOpen, color: 'bg-violet-500/10 text-violet-600' },
          { label: 'Commandes ce mois', value: stats.commandesMois, icon: Package, color: 'bg-amber-500/10 text-amber-600' },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${color}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-lg font-bold">{value}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Mon investissement personnel */}
      {myApport && (
        <Card className="border-indigo-200 bg-indigo-50/50">
          <CardContent className="p-4">
            <h2 className="font-semibold text-sm flex items-center gap-2 mb-3">
              <DollarSign className="h-4 w-4 text-indigo-600" />
              Mon investissement
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border bg-white p-3 text-center">
                <p className="text-xs text-muted-foreground">Mon apport</p>
                <p className="text-lg font-bold text-indigo-600">{fmt(myApport.montantActuel || myApport.montant_apport || 0)} F</p>
              </div>
              <div className="rounded-lg border bg-white p-3 text-center">
                <p className="text-xs text-muted-foreground">Ma part</p>
                <p className="text-lg font-bold text-indigo-600">{(myApport.parts || 0).toFixed(1)}%</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Inventaire (quantités uniquement, sans valeurs financières) */}
      <Card>
        <CardContent className="p-4">
          <h2 className="font-semibold text-sm flex items-center gap-2 mb-4">
            <Boxes className="h-4 w-4 text-muted-foreground" />
            Inventaire ({stats.totalArticlesInventaire} articles)
          </h2>
          {data.inventaire.length > 0 ? (
            <div className="max-h-60 overflow-y-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="px-2 py-1.5 text-left font-medium">Article</th>
                    <th className="px-2 py-1.5 text-center font-medium">Quantité</th>
                  </tr>
                </thead>
                <tbody>
                  {data.inventaire
                    .filter(p => (p.quantite || 0) > 0)
                    .sort((a, b) => (b.quantite || 0) - (a.quantite || 0))
                    .map((p) => (
                    <tr key={p.id} className="border-b border-muted/20">
                      <td className="px-2 py-1">{p.nom}</td>
                      <td className="px-2 py-1 text-center">{p.quantite}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">Aucun article en stock</p>
          )}
        </CardContent>
      </Card>

      {/* Gouvernance — uniquement mes propres données */}
      <Card>
        <CardContent className="p-4">
          <h2 className="font-semibold text-sm flex items-center gap-2 mb-4">
            <PieChart className="h-4 w-4 text-muted-foreground" />
            Gouvernance
          </h2>
          {myApport ? (
            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-600">
                  {myApport.prenom?.[0]}{myApport.nom?.[0]}
                </div>
                <div>
                  <p className="font-semibold text-sm">{myApport.prenom} {myApport.nom}</p>
                  <Badge variant="outline" className="text-[10px]">{myApport.role || 'Associé'}</Badge>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-lg bg-muted/50 p-2">
                  <p className="text-[10px] text-muted-foreground">Apport initial</p>
                  <p className="text-sm font-bold">{fmt(myApport.montantActuel || myApport.montant_apport || 0)} F</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-2">
                  <p className="text-[10px] text-muted-foreground">Parts</p>
                  <p className="text-sm font-bold">{(myApport.parts || 0).toFixed(1)}%</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-2">
                  <p className="text-[10px] text-muted-foreground">Statut</p>
                  <p className="text-sm font-bold capitalize">{myApport.statut || 'actif'}</p>
                </div>
              </div>
              {myApport.compte_courant !== undefined && myApport.compte_courant !== 0 && (
                <div className="mt-3 rounded-lg bg-muted/50 p-2 text-center">
                  <p className="text-[10px] text-muted-foreground">Compte courant associé</p>
                  <p className="text-sm font-bold">{fmt(myApport.compte_courant || 0)} F</p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              Aucune fiche associé trouvée. Contactez l&apos;administrateur.
            </p>
          )}
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
                En tant qu&apos;associé, vous avez un accès en lecture seule aux données de l&apos;entreprise :
                inventaire (quantités), catalogue, votre fiche gouvernance, et la liste des employés.
                Pour toute question, contactez l&apos;administrateur.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
