import { useState, useEffect, useMemo } from 'react';
import { db } from '@/services/db';
import { useAuth } from '@/services/auth';
import { FINANCIAL_SUMMARY, MACHINES, INVENTAIRE_STOCK } from '@/utils/seed-data';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  BarChart3, Loader2, Sparkles, Users, Moon,
} from 'lucide-react';

function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)); }

const DEFAULT_VALUATION = {
  inventaire: INVENTAIRE_STOCK.reduce((s, i) => s + (i.qte * i.prix_achat), 0),
  machines: MACHINES.reduce((s, m) => s + m.valeur, 0),
  tresorerie_compte: FINANCIAL_SUMMARY.cash_en_compte,
  tresorerie_caisse: FINANCIAL_SUMMARY.cash_en_caisse,
};

// Nisab 2025-2026 : 85g d'or x ~35 000 FCFA/g = 2 975 000 FCFA
const NISAB = 2975000;

export default function ZakatPage() {
  const { user, isAdmin } = useAuth();
  const [investisseurs, setInvestisseurs] = useState([]);
  const [selectedId, setSelectedId] = useState('__auto__');
  const [loading, setLoading] = useState(true);
  const [annee, setAnnee] = useState(new Date().getFullYear());
  const [resultatIA, setResultatIA] = useState(null);
  const [loadingIA, setLoadingIA] = useState(false);
  const [dettes, setDettes] = useState([]);
  const [remboursements, setRemboursements] = useState([]);
  const [valuationParams, setValuationParams] = useState(DEFAULT_VALUATION);

  useEffect(() => {
    const load = async () => {
      try {
        const [inv, det, remb, params] = await Promise.all([
          db.investisseurs.list(),
          db.dettes_associes.list(),
          db.remboursements_associes.list(),
          db.gouvernance_parametres?.list() ?? Promise.resolve([]),
        ]);
        let investisseursList = inv || [];
        // Auto-seed si vide
        if (investisseursList.length === 0) {
          const inv1 = await db.investisseurs.create({
            id: 'inv-oumar', nom: 'Oumar Ibrahim (Abakar Senoussi)', prenom: 'Oumar',
            entreprise: 'Imprimerie Ogooue', montantInitial: 4965000, montantActuel: 4965000,
            devise: 'FCFA', dateEntree: '2024-01-01', statut: 'actif', role: 'gerant',
          });
          const inv2 = await db.investisseurs.create({
            id: 'inv-senouss', nom: 'Senouss Saleh', prenom: 'Senouss',
            entreprise: 'Imprimerie Ogooue', montantInitial: 2500000, montantActuel: 2500000,
            devise: 'FCFA', dateEntree: '2024-01-01', statut: 'actif', role: 'associe',
          });
          investisseursList = [inv1, inv2].filter(Boolean);
        }
        setInvestisseurs(investisseursList);
        setDettes(det || []);
        setRemboursements(remb || []);
        const savedParams = (params || []).find((p) => p.type === 'valuation');
        if (savedParams) {
          setValuationParams({
            inventaire: savedParams.inventaire ?? DEFAULT_VALUATION.inventaire,
            machines: savedParams.machines ?? DEFAULT_VALUATION.machines,
            tresorerie_compte: savedParams.tresorerie_compte ?? DEFAULT_VALUATION.tresorerie_compte,
            tresorerie_caisse: savedParams.tresorerie_caisse ?? DEFAULT_VALUATION.tresorerie_caisse,
          });
        }
      } catch (err) {
        console.error('Zakat load error:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // Trouver l'investisseur courant (auto = matching par nom/role, ou selection admin)
  const currentInvestisseur = useMemo(() => {
    if (selectedId !== '__auto__') {
      return investisseurs.find((inv) => inv.id === selectedId);
    }
    // Auto-match pour associe
    const userNom = (user?.nom || '').toLowerCase();
    const userPrenom = (user?.prenom || '').toLowerCase();
    return investisseurs.find((inv) => {
      const invNom = (inv.nom || '').toLowerCase();
      const invPrenom = (inv.prenom || '').toLowerCase();
      return inv.user_id === user?.id
        || (userNom && invNom.includes(userNom))
        || (userPrenom && invPrenom.includes(userPrenom))
        || (userPrenom && invNom.includes(userPrenom))
        || (inv.role === 'associe' && user?.role === 'associe');
    });
  }, [investisseurs, selectedId, user]);

  // Calcul valuation
  const valuation = useMemo(() => {
    const inventaire = valuationParams.inventaire;
    const machines = valuationParams.machines;
    const tresorerie = valuationParams.tresorerie_compte + valuationParams.tresorerie_caisse;
    const totalRemb = remboursements.reduce((s, r) => s + (r.montant || 0), 0);
    const dette = dettes.find((d) => d.associe === 'oumar');
    const detteRestante = (dette?.montant_initial || 2300000) - totalRemb;
    const actifs = inventaire + machines + tresorerie;
    const passifs = Math.max(0, detteRestante);
    return actifs - passifs;
  }, [valuationParams, dettes, remboursements]);

  // Cap info
  const capInfo = useMemo(() => {
    if (!currentInvestisseur) return null;
    const totalCapital = investisseurs.reduce((s, inv) => s + (inv.montantActuel || inv.montantInitial || 0), 0);
    const myMontant = currentInvestisseur.montantActuel || currentInvestisseur.montantInitial || 0;
    const isOumar = currentInvestisseur.id === 'inv-oumar' || currentInvestisseur.nom?.includes('Oumar');
    const finalPct = isOumar ? 70 : 30;
    const valeurPart = (valuation * finalPct) / 100;
    return { montant: myMontant, pct: finalPct, valeurPart, totalCapital };
  }, [currentInvestisseur, investisseurs, valuation]);

  const valeurPart = capInfo?.valeurPart || 0;
  const zakatBrute = valeurPart * 0.025;
  const zakatObligatoire = valeurPart >= NISAB;
  const zakatDue = zakatObligatoire ? zakatBrute : 0;

  const analyserAvecIA = async () => {
    setLoadingIA(true);
    try {
      const res = await fetch('/api/zakat-analyse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nom: currentInvestisseur?.nom || 'Associe',
          valeurPart,
          parts: capInfo?.pct || 0,
          investissementDepart: currentInvestisseur?.montantInitial || 0,
          annee,
          zakatCalculee: zakatDue,
          zakatObligatoire,
        }),
      });
      const data = await res.json();
      setResultatIA(data.analyse || data.error || 'Analyse non disponible.');
    } catch {
      setResultatIA("Impossible de charger l'analyse IA.");
    } finally {
      setLoadingIA(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-green-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-2xl">
          🌙
        </div>
        <div>
          <h1 className="text-2xl font-bold">Simulateur Zakat</h1>
          <p className="text-sm text-muted-foreground">
            Calcul de la Zakat sur les parts dans Imprimerie Ogooue
          </p>
        </div>
      </div>

      {/* Selection associe (admin only) */}
      {isAdmin && investisseurs.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Users className="h-5 w-5 text-muted-foreground" />
              <div className="flex-1">
                <label className="text-sm font-medium mb-1 block">Simuler pour l&apos;associe</label>
                <Select value={selectedId} onValueChange={(v) => { setSelectedId(v); setResultatIA(null); }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selectionner un associe" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__auto__">Auto (mon profil)</SelectItem>
                    {investisseurs.map((inv) => (
                      <SelectItem key={inv.id} value={inv.id}>
                        {inv.nom} — {fmt(inv.montantActuel || inv.montantInitial)} FCFA
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {currentInvestisseur ? (
        <Card className="border-green-200 bg-green-50/30">
          <CardContent className="p-4 sm:p-6">
            {/* Profil */}
            <div className="flex items-center gap-3 mb-5">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-green-100 text-xl">
                🌙
              </div>
              <div>
                <h2 className="text-lg font-bold">{currentInvestisseur.nom}</h2>
                <p className="text-xs text-muted-foreground">
                  Part : {capInfo?.pct?.toFixed(1)}% — Valeur : {fmt(valeurPart)} FCFA
                </p>
              </div>
            </div>

            {/* Annee */}
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

            {/* Donnees */}
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="rounded-xl bg-white p-3 border">
                <p className="text-[10px] text-muted-foreground">Part</p>
                <p className="text-lg font-bold">{capInfo?.pct?.toFixed(1) || '—'}%</p>
              </div>
              <div className="rounded-xl bg-white p-3 border">
                <p className="text-[10px] text-muted-foreground">Valeur actuelle</p>
                <p className="text-lg font-bold">{fmt(valeurPart)} F</p>
              </div>
            </div>

            {/* Resultat */}
            <div className={`rounded-2xl p-5 mb-5 text-center border-2 ${zakatObligatoire ? 'bg-green-50 border-green-300' : 'bg-yellow-50 border-yellow-300'}`}>
              {zakatObligatoire ? (
                <>
                  <p className="text-sm text-green-700 mb-1">Zakat annuelle (2,5%)</p>
                  <p className="text-3xl sm:text-4xl font-black text-green-700 my-2">{fmt(zakatDue)} FCFA</p>
                  <p className="text-xs text-green-600">
                    Obligatoire — la part depasse le nisab ({fmt(NISAB)} FCFA)
                  </p>
                </>
              ) : (
                <>
                  <p className="text-3xl mb-2">ℹ️</p>
                  <p className="font-bold text-yellow-800">Zakat non obligatoire cette annee</p>
                  <p className="text-xs text-yellow-700 mt-1">
                    Valeur part ({fmt(valeurPart)} F) inferieure au nisab ({fmt(NISAB)} F)
                  </p>
                </>
              )}
            </div>

            {/* Detail */}
            <div className="rounded-xl bg-white border p-4 mb-5">
              <h3 className="font-semibold text-sm mb-3 flex items-center gap-1.5">
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
                Detail du calcul
              </h3>
              <div className="space-y-2 text-sm">
                {[
                  { label: `Valeur de la part (${capInfo?.pct?.toFixed(1) || '—'}%)`, val: fmt(valeurPart) + ' FCFA' },
                  { label: 'Taux Zakat', val: '2,5%' },
                  { label: `Nisab (seuil ${annee})`, val: '~' + fmt(NISAB) + ' FCFA' },
                  { label: 'Valuation entreprise nette', val: fmt(valuation) + ' FCFA' },
                ].map(({ label, val }) => (
                  <div key={label} className="flex justify-between">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-medium">{val}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t pt-2 font-bold">
                  <span>Zakat calculee</span>
                  <span className={zakatObligatoire ? 'text-green-600' : 'text-muted-foreground'}>
                    {zakatObligatoire ? fmt(zakatDue) + ' FCFA' : 'Non applicable'}
                  </span>
                </div>
              </div>
            </div>

            {/* IA */}
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

            <p className="text-[10px] text-muted-foreground mt-4 text-center">
              Ce simulateur est indicatif. Le nisab est base sur le cours de l&apos;or (~85g).
              Consultez un savant ou expert en finances islamiques pour un calcul precis.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-8 text-center">
            <Moon className="h-12 w-12 mx-auto mb-4 text-muted-foreground/30" />
            <p className="text-lg font-medium">Aucun profil investisseur trouve</p>
            <p className="text-sm text-muted-foreground mt-1">
              {isAdmin
                ? 'Selectionnez un associe dans la liste ci-dessus.'
                : 'Votre compte n\'est pas encore lie a un profil investisseur. Contactez l\'administrateur.'}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
