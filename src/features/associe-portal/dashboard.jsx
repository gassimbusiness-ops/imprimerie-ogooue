import { useState, useEffect, useMemo } from 'react';
import { db, getSettings } from '@/services/db';
import { useAuth } from '@/services/auth';
import { FINANCIAL_SUMMARY, MACHINES, INVENTAIRE_STOCK } from '@/utils/seed-data';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  TrendingUp, Users, Boxes, BookOpen, DollarSign,
  PieChart, BarChart3, Package, Eye, Building2, Wallet,
  Hammer,
} from 'lucide-react';

function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)); }

const DEFAULT_VALUATION = {
  inventaire: INVENTAIRE_STOCK.reduce((s, i) => s + (i.qte * i.prix_achat), 0),
  machines: MACHINES.reduce((s, m) => s + m.valeur, 0),
  tresorerie_compte: FINANCIAL_SUMMARY.cash_en_compte,
  tresorerie_caisse: FINANCIAL_SUMMARY.cash_en_caisse,
};

export default function AssocieDashboard() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({
    employes: [], stocks: [], inventaire: [], commandes: [], produits: [],
    investisseurs: [], apports: [], dettes: [], remboursements: [], projets: [],
  });
  const [valuationParams, setValuationParams] = useState(DEFAULT_VALUATION);
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [emp, stk, inv, cmd, prod, investisseurs, ap, dettes, remb, projets, params, s] = await Promise.all([
          db.employes.list(),
          db.produits_catalogue.list(),
          db.produits.list(),
          db.commandes.list(),
          db.produits_catalogue.list(),
          db.investisseurs.list(),
          db.apports_associes.list(),
          db.dettes_associes.list(),
          db.remboursements_associes.list(),
          db.projets_travaux.list(),
          db.gouvernance_parametres?.list() ?? Promise.resolve([]),
          getSettings(),
        ]);
        setData({
          employes: (emp || []).filter((e) => e.role !== 'client'),
          stocks: stk || [],
          inventaire: inv || [],
          commandes: cmd || [],
          produits: prod || [],
          investisseurs: investisseurs || [],
          apports: ap || [],
          dettes: dettes || [],
          remboursements: remb || [],
          projets: projets || [],
        });
        // Load saved valuation params
        const savedParams = (params || []).find((p) => p.type === 'valuation');
        if (savedParams) {
          setValuationParams({
            inventaire: savedParams.inventaire ?? DEFAULT_VALUATION.inventaire,
            machines: savedParams.machines ?? DEFAULT_VALUATION.machines,
            tresorerie_compte: savedParams.tresorerie_compte ?? DEFAULT_VALUATION.tresorerie_compte,
            tresorerie_caisse: savedParams.tresorerie_caisse ?? DEFAULT_VALUATION.tresorerie_caisse,
          });
        }
        setSettings(s);
      } catch (err) {
        console.error('Associe dashboard load error:', err);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  // Find the current associate's investor record
  const myInvestisseur = useMemo(() => {
    const nom = `${user?.prenom || ''} ${user?.nom || ''}`.trim().toLowerCase();
    return data.investisseurs.find((inv) => {
      const invNom = (inv.nom || '').toLowerCase();
      return inv.user_id === user?.id || invNom.includes((user?.nom || '').toLowerCase()) || invNom === nom;
    });
  }, [data.investisseurs, user]);

  // Compute valuation + cap table
  const valuation = useMemo(() => {
    const inventaire = valuationParams.inventaire;
    const machines = valuationParams.machines;
    const tresorerie = valuationParams.tresorerie_compte + valuationParams.tresorerie_caisse;
    const totalRemb = data.remboursements.reduce((s, r) => s + (r.montant || 0), 0);
    const dette = data.dettes.find((d) => d.associe === 'oumar');
    const detteRestante = (dette?.montant_initial || 2300000) - totalRemb;
    const actifs = inventaire + machines + tresorerie;
    const passifs = Math.max(0, detteRestante);
    const valeur_nette = actifs - passifs;
    return { inventaire, machines, tresorerie, actifs, passifs, valeur_nette };
  }, [valuationParams, data.dettes, data.remboursements]);

  // Cap table from investisseurs
  const capInfo = useMemo(() => {
    if (!myInvestisseur) return null;
    const totalCapital = data.investisseurs.reduce((s, inv) => s + (inv.montantActuel || inv.montantInitial || 0), 0);
    const myMontant = myInvestisseur.montantActuel || myInvestisseur.montantInitial || 0;
    const myPct = totalCapital > 0 ? (myMontant / totalCapital) * 100 : 0;
    // Adjust for management bonus (Oumar 70/30 rule)
    const isOumar = myInvestisseur.id === 'inv-oumar' || myInvestisseur.nom?.includes('Oumar');
    const finalPct = isOumar ? 70 : 30; // Simplified — matches cap table in gouvernance
    const valeurPart = (valuation.valeur_nette * finalPct) / 100;
    return { montant: myMontant, pct: finalPct, valeurPart, totalCapital };
  }, [myInvestisseur, data.investisseurs, valuation]);

  const stats = useMemo(() => {
    const totalEmployes = data.employes.length;
    const totalProduits = data.produits.length;
    const commandesMois = data.commandes.filter((c) => {
      const d = c.created_at || '';
      return d.startsWith(new Date().toISOString().slice(0, 7));
    });
    const projetsEnCours = data.projets.filter((p) => p.statut === 'en_cours').length;

    return { totalEmployes, totalProduits, commandesMois: commandesMois.length, projetsEnCours };
  }, [data]);

  if (loading) return (
    <div className="flex justify-center py-12">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="relative rounded-2xl overflow-hidden">
        <div className="bg-gradient-to-br from-indigo-600 to-purple-700 p-6 sm:p-8 text-white">
          <div className="relative z-10">
            <h1 className="text-2xl sm:text-3xl font-bold">
              Bienvenue, {user?.prenom} !
            </h1>
            <p className="text-white/80 mt-1 text-sm sm:text-base">
              Tableau de bord Associe — Vue d&apos;ensemble de l&apos;entreprise
            </p>
          </div>
        </div>
      </div>

      {/* Financial KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="p-3 sm:p-4">
            <p className="text-[10px] sm:text-[11px] text-muted-foreground uppercase tracking-wide">Valeur Entreprise</p>
            <p className="text-sm sm:text-lg font-bold mt-1">{fmt(valuation.valeur_nette)} F</p>
            <p className="text-[10px] text-muted-foreground">Actifs - Passifs</p>
          </CardContent>
        </Card>
        {capInfo && (
          <>
            <Card className="border-l-4 border-l-indigo-500">
              <CardContent className="p-3 sm:p-4">
                <p className="text-[10px] sm:text-[11px] text-muted-foreground uppercase tracking-wide">Ma part</p>
                <p className="text-sm sm:text-lg font-bold mt-1">{capInfo.pct.toFixed(1)}%</p>
                <p className="text-[10px] text-muted-foreground">du capital</p>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-emerald-500">
              <CardContent className="p-3 sm:p-4">
                <p className="text-[10px] sm:text-[11px] text-muted-foreground uppercase tracking-wide">Valeur de ma part</p>
                <p className="text-sm sm:text-lg font-bold mt-1 text-emerald-600">{fmt(capInfo.valeurPart)} F</p>
                <p className="text-[10px] text-muted-foreground">Estimation</p>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-violet-500">
              <CardContent className="p-3 sm:p-4">
                <p className="text-[10px] sm:text-[11px] text-muted-foreground uppercase tracking-wide">Mon investissement</p>
                <p className="text-sm sm:text-lg font-bold mt-1">{fmt(capInfo.montant)} F</p>
                <p className="text-[10px] text-muted-foreground">Capital investi</p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Activity KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Employes', value: stats.totalEmployes, icon: Users, color: 'bg-blue-500/10 text-blue-600', show: true },
          { label: 'Produits catalogue', value: stats.totalProduits, icon: BookOpen, color: 'bg-violet-500/10 text-violet-600', show: stats.totalProduits > 0 },
          { label: 'Commandes ce mois', value: stats.commandesMois, icon: Package, color: 'bg-amber-500/10 text-amber-600', show: true },
          { label: 'Projets en cours', value: stats.projetsEnCours, icon: Hammer, color: 'bg-emerald-500/10 text-emerald-600', show: stats.projetsEnCours > 0 },
        ].filter((k) => k.show).map(({ label, value, icon: Icon, color }) => (
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

      {/* Valorisation breakdown */}
      <Card>
        <CardContent className="p-4">
          <h2 className="font-semibold text-sm flex items-center gap-2 mb-4">
            <Building2 className="h-4 w-4 text-primary" />
            Valorisation de l&apos;entreprise
          </h2>
          <div className="rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50 p-4 mb-4 text-center">
            <p className="text-xs text-muted-foreground mb-1">Valeur nette actuelle</p>
            <p className="text-2xl sm:text-3xl font-black text-primary">{fmt(valuation.valeur_nette)} F</p>
          </div>
          <div className="space-y-2">
            {[
              { label: "Stock (prix d'achat)", val: valuation.inventaire },
              { label: 'Machines & Outils', val: valuation.machines },
              { label: 'Tresorerie', val: valuation.tresorerie },
              { label: 'Dettes', val: -valuation.passifs, neg: true },
            ].map(({ label, val, neg }) => (
              <div key={label} className="flex items-center justify-between py-1.5 border-b last:border-0">
                <span className="text-sm">{label}</span>
                <span className={`text-sm font-semibold ${neg ? 'text-red-600' : ''}`}>{neg && val < 0 ? '-' : ''}{fmt(Math.abs(val))} F</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Gouvernance — my own data */}
      {myInvestisseur && (
        <Card className="border-indigo-200 bg-indigo-50/50">
          <CardContent className="p-4">
            <h2 className="font-semibold text-sm flex items-center gap-2 mb-3">
              <PieChart className="h-4 w-4 text-indigo-600" />
              Ma fiche Gouvernance
            </h2>
            <div className="rounded-lg border bg-white p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-600">
                  {myInvestisseur.prenom?.[0] || myInvestisseur.nom?.[0]}
                </div>
                <div>
                  <p className="font-semibold text-sm">{myInvestisseur.nom}</p>
                  <Badge variant="outline" className="text-[10px]">{myInvestisseur.role === 'gerant' ? 'Gerant' : 'Associe'}</Badge>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                <div className="rounded-lg bg-muted/50 p-2">
                  <p className="text-[10px] text-muted-foreground">Montant initial</p>
                  <p className="text-sm font-bold">{fmt(myInvestisseur.montantInitial)} F</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-2">
                  <p className="text-[10px] text-muted-foreground">Montant actuel</p>
                  <p className="text-sm font-bold text-primary">{fmt(myInvestisseur.montantActuel)} F</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-2">
                  <p className="text-[10px] text-muted-foreground">Parts</p>
                  <p className="text-sm font-bold">{capInfo?.pct.toFixed(1) || '—'}%</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-2">
                  <p className="text-[10px] text-muted-foreground">Valeur part</p>
                  <p className="text-sm font-bold text-emerald-600">{fmt(capInfo?.valeurPart || 0)} F</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Projets en cours */}
      {data.projets.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h2 className="font-semibold text-sm flex items-center gap-2 mb-4">
              <Hammer className="h-4 w-4 text-muted-foreground" />
              Travaux & Projets ({data.projets.length})
            </h2>
            <div className="space-y-2">
              {data.projets.slice(0, 5).map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">{p.nom}</p>
                    <p className="text-[10px] text-muted-foreground">{p.categorie} — {p.responsable || '—'}</p>
                  </div>
                  <Badge variant="outline" className={`text-[10px] ${
                    p.statut === 'termine' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                    p.statut === 'en_cours' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                    p.statut === 'suspendu' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                    'bg-gray-50 text-gray-700 border-gray-200'
                  }`}>
                    {p.statut === 'termine' ? 'Termine' : p.statut === 'en_cours' ? 'En cours' : p.statut === 'suspendu' ? 'Suspendu' : 'Planifie'}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Team */}
      {data.employes.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h2 className="font-semibold text-sm flex items-center gap-2 mb-4">
              <Users className="h-4 w-4 text-muted-foreground" />
              Equipe ({data.employes.length} personnes)
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
      )}

      {/* Access note */}
      <Card className="border-amber-200 bg-amber-50/50">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Eye className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-800">Acces Associe</p>
              <p className="text-xs text-amber-700 mt-1">
                En tant qu&apos;associe, vous avez un acces en lecture seule aux donnees de l&apos;entreprise :
                valorisation, catalogue, stocks, travaux & projets, et votre fiche gouvernance.
                Pour toute question, contactez l&apos;administrateur.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
