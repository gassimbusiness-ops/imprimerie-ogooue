import { useState, useEffect, useMemo } from 'react';
import { db, getSettings } from '@/services/db';
import { useAuth } from '@/services/auth';
import { FINANCIAL_SUMMARY, MACHINES, INVENTAIRE_STOCK } from '@/utils/seed-data';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  TrendingUp, Users, Boxes, BookOpen, DollarSign,
  PieChart, BarChart3, Package, Eye, Building2, Wallet,
  Hammer, Moon, Loader2, Sparkles, Calculator,
} from 'lucide-react';

function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)); }

const DEFAULT_VALUATION = {
  inventaire: INVENTAIRE_STOCK.reduce((s, i) => s + (i.qte * i.prix_achat), 0),
  machines: MACHINES.reduce((s, m) => s + m.valeur, 0),
  tresorerie_compte: FINANCIAL_SUMMARY.cash_en_compte,
  tresorerie_caisse: FINANCIAL_SUMMARY.cash_en_caisse,
};

// ── Simulateur Zakat — 2.5% sur la valeur de la part ──
function SimulateurZakat({ capInfo, myInvestisseur }) {
  const [resultatIA, setResultatIA] = useState(null);
  const [loadingIA, setLoadingIA] = useState(false);
  const [annee, setAnnee] = useState(new Date().getFullYear());

  const valeurPart = capInfo?.valeurPart || 0;
  const taux = 0.025;
  const zakatBrute = valeurPart * taux;
  // Nisab 2025-2026 : 85g d'or x ~35 000 FCFA/g = 2 975 000 FCFA
  const nisab = 2975000;
  const zakatObligatoire = valeurPart >= nisab;
  const zakatDue = zakatObligatoire ? zakatBrute : 0;

  const analyserAvecIA = async () => {
    setLoadingIA(true);
    try {
      const res = await fetch('/api/zakat-analyse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nom: myInvestisseur?.nom || 'Associe',
          valeurPart,
          parts: capInfo?.pct || 0,
          investissementDepart: myInvestisseur?.montantInitial || 0,
          annee,
          zakatCalculee: zakatDue,
          zakatObligatoire,
        }),
      });
      const data = await res.json();
      setResultatIA(data.analyse || data.error || 'Analyse non disponible.');
    } catch {
      setResultatIA('Impossible de charger l\'analyse IA.');
    } finally {
      setLoadingIA(false);
    }
  };

  return (
    <Card className="border-green-200 bg-green-50/30">
      <CardContent className="p-4 sm:p-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-green-100 text-xl">
            🌙
          </div>
          <div>
            <h2 className="text-lg font-bold">Simulateur Zakat</h2>
            <p className="text-xs text-muted-foreground">Calcule sur votre part dans Imprimerie Ogooue</p>
          </div>
        </div>

        {/* Selection annee */}
        <div className="mb-4">
          <label className="text-sm font-medium mb-1 block">Annee de calcul</label>
          <select
            value={annee}
            onChange={(e) => { setAnnee(parseInt(e.target.value)); setResultatIA(null); }}
            className="rounded-lg border px-3 py-2 text-sm bg-white"
          >
            {[2023, 2024, 2025, 2026].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        {/* Donnees de base */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="rounded-xl bg-white p-3 border">
            <p className="text-[10px] text-muted-foreground">Votre part</p>
            <p className="text-lg font-bold">{capInfo?.pct?.toFixed(1) || '—'}%</p>
          </div>
          <div className="rounded-xl bg-white p-3 border">
            <p className="text-[10px] text-muted-foreground">Valeur actuelle</p>
            <p className="text-lg font-bold">{fmt(valeurPart)} F</p>
          </div>
        </div>

        {/* Resultat principal */}
        <div className={`rounded-2xl p-5 mb-5 text-center border-2 ${zakatObligatoire ? 'bg-green-50 border-green-300' : 'bg-yellow-50 border-yellow-300'}`}>
          {zakatObligatoire ? (
            <>
              <p className="text-sm text-green-700 mb-1">Votre Zakat annuelle (2,5%)</p>
              <p className="text-3xl sm:text-4xl font-black text-green-700 my-2">{fmt(zakatDue)} F</p>
              <p className="text-xs text-green-600">
                La Zakat est obligatoire — votre part depasse le nisab ({fmt(nisab)} F)
              </p>
            </>
          ) : (
            <>
              <p className="text-3xl mb-2">ℹ️</p>
              <p className="font-bold text-yellow-800">Zakat non obligatoire cette annee</p>
              <p className="text-xs text-yellow-700 mt-1">
                Votre part ({fmt(valeurPart)} F) est inferieure au nisab ({fmt(nisab)} F)
              </p>
            </>
          )}
        </div>

        {/* Detail du calcul */}
        <div className="rounded-xl bg-white border p-4 mb-5">
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-1.5">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            Detail du calcul
          </h3>
          <div className="space-y-2 text-sm">
            {[
              { label: `Valeur de la part (${capInfo?.pct?.toFixed(1) || '—'}%)`, val: fmt(valeurPart) + ' F' },
              { label: 'Taux Zakat', val: '2,5%' },
              { label: `Nisab (seuil ${annee})`, val: '~' + fmt(nisab) + ' F' },
            ].map(({ label, val }) => (
              <div key={label} className="flex justify-between">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-medium">{val}</span>
              </div>
            ))}
            <div className="flex justify-between border-t pt-2 font-bold">
              <span>Zakat calculee</span>
              <span className={zakatObligatoire ? 'text-green-600' : 'text-muted-foreground'}>
                {zakatObligatoire ? fmt(zakatDue) + ' F' : 'Non applicable'}
              </span>
            </div>
          </div>
        </div>

        {/* Analyse IA */}
        <Button
          onClick={analyserAvecIA}
          disabled={loadingIA}
          className="w-full gap-2 bg-violet-600 hover:bg-violet-700 mb-4"
        >
          {loadingIA ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {loadingIA ? 'Analyse en cours...' : 'Analyse IA — Conseils personnalises'}
        </Button>

        {resultatIA && (
          <div className="rounded-xl bg-violet-50 border border-violet-200 p-4">
            <h3 className="font-semibold text-violet-800 mb-2 text-sm flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              Conseils de l&apos;Assistant IA
            </h3>
            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{resultatIA}</p>
          </div>
        )}

        {/* Note legale */}
        <p className="text-[10px] text-muted-foreground mt-4 text-center">
          Ce simulateur est indicatif. Le nisab est base sur le cours de l&apos;or (~85g).
          Pour un calcul precis, consultez un savant ou un expert en finances islamiques.
        </p>
      </CardContent>
    </Card>
  );
}

// ── Auto-seed investisseurs si la collection est vide ──
async function ensureInvestisseurs() {
  const existing = await db.investisseurs.list();
  if (existing && existing.length > 0) return existing;
  // Seed les deux associes fondateurs
  const inv1 = await db.investisseurs.create({
    id: 'inv-oumar',
    nom: 'Oumar Ibrahim (Abakar Senoussi)',
    prenom: 'Oumar',
    entreprise: 'Imprimerie Ogooue',
    montantInitial: 7965000,
    montantActuel: 7965000,
    pourcentage: 76.11,
    devise: 'FCFA',
    dateEntree: '2024-01-01',
    statut: 'actif',
    notes: 'Gerant — 3M + 1.965M + 2M + 1M = 7.965M',
    role: 'gerant',
  });
  const inv2 = await db.investisseurs.create({
    id: 'inv-senouss',
    nom: 'Senouss Saleh',
    prenom: 'Senouss',
    entreprise: 'Imprimerie Ogooue',
    montantInitial: 2500000,
    montantActuel: 2500000,
    pourcentage: 23.89,
    devise: 'FCFA',
    dateEntree: '2024-01-01',
    statut: 'actif',
    notes: 'Associe',
    role: 'associe',
  });
  return [inv1, inv2].filter(Boolean);
}

export default function AssocieDashboard() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({
    employes: [], stocks: [], inventaire: [], commandes: [], produits: [],
    investisseurs: [], apports: [], dettes: [], remboursements: [], projets: [], rapports: [], chargesFixes: [],
  });
  const [valuationParams, setValuationParams] = useState(DEFAULT_VALUATION);
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        // Seed investisseurs en parallele mais sans bloquer le chargement si erreur
        ensureInvestisseurs().catch((e) => console.warn('Seed investisseurs skip:', e.message));

        const [emp, stk, inv, cmd, prod, investisseurs, ap, dettes, remb, projets, params, s, comptes, raps, chFixes] = await Promise.all([
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
          db.comptes_bancaires.list(),
          db.rapports.list(),
          db.charges_fixes.list(),
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
          rapports: raps || [],
          chargesFixes: chFixes || [],
        });

        // Valuation depuis donnees REELLES Supabase
        const allProduits = inv || [];
        const stockReel = allProduits.reduce((s2, p) => {
          const prix = p.prix_unitaire || p.prix_vente || 0;
          const qte = p.quantite ?? p.stock ?? 0;
          return s2 + (prix * qte);
        }, 0);
        const machinesReel = allProduits.reduce((s2, p) => {
          if (p.type_article === 'machine') return s2 + (p.valeur_stock_achat || (p.prix_unitaire || 0) * (p.quantite ?? 1));
          return s2;
        }, 0);

        // Whitelist comptes locaux, blacklist comptes internationaux
        const COMPTES_IMPRIMERIE = ['finam', 'bgfi', 'airtel', 'moov', 'caisse', 'liquide'];
        const COMPTES_EXCLUS = ['wise', 'mercury', 'paypal', 'stripe', 'airwallex'];
        const comptesImprimerie = (comptes || []).filter((c) => {
          const nom = (c.nom || '').toLowerCase();
          if (COMPTES_EXCLUS.some((k) => nom.includes(k))) return false;
          return COMPTES_IMPRIMERIE.some((k) => nom.includes(k)) || c.appartient_imprimerie === true;
        });
        const tresorerieCompte = comptesImprimerie
          .filter((c) => !(c.nom || '').toLowerCase().includes('caisse') && !(c.nom || '').toLowerCase().includes('liquide'))
          .reduce((s2, c) => s2 + (c.solde || 0), 0);
        const tresorerieCaisse = comptesImprimerie
          .filter((c) => (c.nom || '').toLowerCase().includes('caisse') || (c.nom || '').toLowerCase().includes('liquide'))
          .reduce((s2, c) => s2 + (c.solde || 0), 0);

        const savedParams = (params || []).find((p) => p.type === 'valuation');
        const hasRealStock = allProduits.length > 0;
        const hasRealComptes = comptesImprimerie.length > 0;

        setValuationParams({
          inventaire: hasRealStock ? stockReel : (savedParams?.inventaire ?? DEFAULT_VALUATION.inventaire),
          machines: hasRealStock ? machinesReel : (savedParams?.machines ?? DEFAULT_VALUATION.machines),
          tresorerie_compte: hasRealComptes ? tresorerieCompte : (savedParams?.tresorerie_compte ?? DEFAULT_VALUATION.tresorerie_compte),
          tresorerie_caisse: hasRealComptes ? tresorerieCaisse : (savedParams?.tresorerie_caisse ?? DEFAULT_VALUATION.tresorerie_caisse),
        });
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
    const userNom = (user?.nom || '').toLowerCase();
    const userPrenom = (user?.prenom || '').toLowerCase();
    const userFull = `${userPrenom} ${userNom}`.trim();
    return data.investisseurs.find((inv) => {
      const invNom = (inv.nom || '').toLowerCase();
      const invPrenom = (inv.prenom || '').toLowerCase();
      return inv.user_id === user?.id
        || (userNom && invNom.includes(userNom))
        || (userPrenom && invPrenom.includes(userPrenom))
        || (userPrenom && invNom.includes(userPrenom))
        || (userFull && invNom.includes(userFull))
        || (inv.role === 'associe' && user?.role === 'associe');
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

  // Parts sociales FIGEES — 76.11% Oumar / 23.89% Senouss / Total 10 465 000
  const capInfo = useMemo(() => {
    if (!myInvestisseur) return null;
    const isOumar = myInvestisseur.id === 'inv-oumar' || myInvestisseur.nom?.toLowerCase().includes('oumar');
    const finalPct = isOumar ? 76.11 : 23.89;
    const myMontant = isOumar ? 7965000 : 2500000;
    const valeurPart = (valuation.valeur_nette * finalPct) / 100;
    return { montant: myMontant, pct: finalPct, valeurPart, totalCapital: 10465000 };
  }, [myInvestisseur, valuation]);

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

  // Resultat annuel (lecture seule pour associe)
  const resultatAnnuel = useMemo(() => {
    const annee = String(new Date().getFullYear());
    const rapsAnnee = data.rapports.filter((r) => (r.date || '').startsWith(annee));
    if (rapsAnnee.length === 0) return null;
    // CA et depenses operationnelles depuis rapports journaliers
    let ca = 0, depOp = 0;
    rapsAnnee.forEach((r) => {
      ca += Object.values(r.categories || {}).reduce((s, v) => s + (v || 0), 0);
      (r.depenses || []).forEach((d) => { depOp += d.montant || 0; });
    });
    // Charges fixes depuis db.charges_fixes (source dediee)
    const chFixes = (data.chargesFixes || []).reduce((s, cf) => {
      const montant = cf.montant || 0;
      const periodicite = (cf.periodicite || cf.frequence || 'mensuel').toLowerCase();
      if (periodicite === 'mensuel' || periodicite === 'mensuelle') return s + (montant * 12);
      if (periodicite === 'trimestriel' || periodicite === 'trimestrielle') return s + (montant * 4);
      return s + montant;
    }, 0);
    const benefice = ca - depOp - chFixes;
    const remGestion = benefice > 0 ? benefice * 0.20 : 0;
    const distribuable = benefice > 0 ? benefice - remGestion : benefice;
    const myPct = capInfo?.pct || 23.89;
    const maPart = distribuable * (myPct / 100);
    return { ca, benefice, distribuable, maPart, myPct, nbRapports: rapsAnnee.length };
  }, [data.rapports, data.chargesFixes, capInfo]);

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
                  <p className="text-[10px] text-muted-foreground">Valeur actuelle</p>
                  <p className="text-sm font-bold text-primary">{fmt(capInfo?.valeurPart || 0)} F</p>
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

      {/* ═══ Résultat annuel (lecture seule) ═══ */}
      {resultatAnnuel && (
        <Card className="border-emerald-200 bg-emerald-50/20">
          <CardContent className="p-4">
            <h2 className="font-semibold text-sm flex items-center gap-2 mb-3">
              <Calculator className="h-4 w-4 text-emerald-600" />
              Ma part estimée {new Date().getFullYear()} (simulation)
            </h2>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="rounded-lg bg-white border p-2.5">
                <p className="text-[10px] text-muted-foreground">CA annuel</p>
                <p className="font-bold text-sm">{fmt(resultatAnnuel.ca)} F</p>
              </div>
              <div className="rounded-lg bg-white border p-2.5">
                <p className="text-[10px] text-muted-foreground">Bénéfice net</p>
                <p className={`font-bold text-sm ${resultatAnnuel.benefice >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(resultatAnnuel.benefice)} F</p>
              </div>
            </div>
            {resultatAnnuel.distribuable > 0 ? (
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-center">
                <p className="text-xs text-emerald-700 mb-0.5">Part théorique ({resultatAnnuel.myPct}%)</p>
                <p className="text-xl font-black text-emerald-700">{fmt(resultatAnnuel.maPart)} FCFA</p>
                <p className="text-[10px] text-muted-foreground mt-1">Simulation — après rémunération gestion 20%</p>
              </div>
            ) : (
              <p className="text-xs text-center text-muted-foreground">Pas de bénéfice distribuable pour le moment.</p>
            )}
            <p className="text-[10px] text-muted-foreground mt-2 text-center">
              Basé sur {resultatAnnuel.nbRapports} rapport(s) journalier(s). Détail complet dans Gouvernance.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ═══ Simulateur Zakat ═══ */}
      {/* Simulateur Zakat — visible des que l'utilisateur est associe */}
      {(capInfo || user?.role === 'associe') && (
        <SimulateurZakat
          capInfo={capInfo || { pct: 23.89, valeurPart: 2500000, totalCapital: 10465000 }}
          myInvestisseur={myInvestisseur || { nom: `${user?.prenom || ''} ${user?.nom || ''}`.trim(), montantInitial: 2500000 }}
        />
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
