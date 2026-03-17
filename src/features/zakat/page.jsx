import { useState, useEffect, useMemo } from 'react';
import { db } from '@/services/db';
import { useAuth } from '@/services/auth';
import { INVESTISSEURS, FINANCIAL_SUMMARY, MACHINES, INVENTAIRE_STOCK } from '@/utils/seed-data';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BarChart3, Loader2, Sparkles, Users, Moon } from 'lucide-react';

function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)); }

// Valuation de l'entreprise (donnees statiques seed-data)
const VALUATION = (() => {
  const inventaire = INVENTAIRE_STOCK.reduce((s, i) => s + (i.qte * i.prix_achat), 0);
  const machines = MACHINES.reduce((s, m) => s + m.valeur, 0);
  const tresorerie = FINANCIAL_SUMMARY.cash_en_compte + FINANCIAL_SUMMARY.cash_en_caisse;
  const actifs = inventaire + machines + tresorerie;
  const passifs = Math.max(0, 2300000);
  return { inventaire, machines, tresorerie, actifs, passifs, valeurNette: actifs - passifs };
})();

// Nisab 2025-2026 : 85g d'or x ~35 000 FCFA/g
const NISAB = 2975000;

// Mapping des donnees financieres des associes (seed-data)
const ASSOCIES_DATA = {
  oumar: INVESTISSEURS.oumar,
  senouss: INVESTISSEURS.senouss,
};

// Matcher un utilisateur (employe) a un profil financier investisseur
function matchInvestisseurData(employe) {
  if (!employe) return null;
  const nom = `${employe.prenom || ''} ${employe.nom || ''}`.toLowerCase();
  // Matching par nom
  if (nom.includes('senouss') || nom.includes('saleh')) return { key: 'senouss', ...ASSOCIES_DATA.senouss };
  if (nom.includes('oumar') || nom.includes('abakar') || nom.includes('ibrahim')) return { key: 'oumar', ...ASSOCIES_DATA.oumar };
  // Fallback : si c'est un associe sans match, donner les donnees Senouss par defaut
  if (employe.role === 'associe') return { key: 'senouss', ...ASSOCIES_DATA.senouss };
  // Si c'est admin/gerant, donner Oumar
  if (employe.role === 'admin') return { key: 'oumar', ...ASSOCIES_DATA.oumar };
  return null;
}

export default function ZakatPage() {
  const { user, isAdmin } = useAuth();
  const [associes, setAssocies] = useState([]);
  const [selectedId, setSelectedId] = useState('__auto__');
  const [loading, setLoading] = useState(true);
  const [annee, setAnnee] = useState(new Date().getFullYear());
  const [resultatIA, setResultatIA] = useState(null);
  const [loadingIA, setLoadingIA] = useState(false);

  // Charger les utilisateurs avec role associe (+ admin pour le gerant)
  useEffect(() => {
    const load = async () => {
      try {
        const employes = await db.employes.list();
        // Filtrer les associes + admin (qui est aussi gerant/investisseur)
        const associesList = (employes || []).filter(
          (e) => e.role === 'associe' || e.role === 'admin'
        );
        setAssocies(associesList);
      } catch (err) {
        console.error('Zakat load error:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // Determiner l'associe courant
  const currentUser = useMemo(() => {
    if (selectedId !== '__auto__') {
      return associes.find((a) => a.id === selectedId) || null;
    }
    // Auto : l'utilisateur connecte
    if (isAdmin) {
      // Admin -> montrer son propre profil par defaut
      return associes.find((a) => a.id === user?.id) || associes[0] || null;
    }
    // Associe -> son propre profil
    return associes.find((a) => a.id === user?.id) || associes.find((a) => a.role === 'associe') || null;
  }, [selectedId, associes, isAdmin, user]);

  // Donnees financieres du profil selectionne
  const investData = useMemo(() => matchInvestisseurData(currentUser), [currentUser]);

  // Calcul Zakat
  const pourcentage = investData?.pourcentage_final || 30;
  const totalInvesti = investData?.total_investi || 2500000;
  const valeurPart = (VALUATION.valeurNette * pourcentage) / 100;
  const zakatBrute = valeurPart * 0.025;
  const zakatObligatoire = valeurPart >= NISAB;
  const zakatDue = zakatObligatoire ? zakatBrute : 0;

  const analyserAvecIA = async () => {
    setLoadingIA(true);
    try {
      const displayName = currentUser ? `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim() : 'Associe';
      const res = await fetch('/api/zakat-analyse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nom: displayName,
          valeurPart,
          parts: pourcentage,
          investissementDepart: totalInvesti,
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

  const displayName = currentUser ? `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim() : '';

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
      {isAdmin && associes.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Users className="h-5 w-5 text-muted-foreground" />
              <div className="flex-1">
                <label className="text-sm font-medium mb-1 block">Simuler pour</label>
                <Select value={selectedId} onValueChange={(v) => { setSelectedId(v); setResultatIA(null); }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selectionner un associe" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__auto__">Mon profil</SelectItem>
                    {associes.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.prenom} {a.nom} — {a.role === 'admin' ? 'Gerant' : 'Associe'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {currentUser && investData ? (
        <Card className="border-green-200 bg-green-50/30">
          <CardContent className="p-4 sm:p-6">
            {/* Profil */}
            <div className="flex items-center gap-3 mb-5">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-green-100 text-xl">
                🌙
              </div>
              <div>
                <h2 className="text-lg font-bold">{displayName}</h2>
                <p className="text-xs text-muted-foreground">
                  Part : {pourcentage}% — Valeur : {fmt(valeurPart)} FCFA
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
                <p className="text-lg font-bold">{pourcentage}%</p>
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
                  { label: 'Investissement initial', val: fmt(totalInvesti) + ' FCFA' },
                  { label: "Part dans l'entreprise", val: pourcentage + '%' },
                  { label: 'Valuation entreprise nette', val: fmt(VALUATION.valeurNette) + ' FCFA' },
                  { label: `Valeur de la part (${pourcentage}%)`, val: fmt(valeurPart) + ' FCFA' },
                  { label: 'Taux Zakat', val: '2,5%' },
                  { label: `Nisab (seuil ${annee})`, val: '~' + fmt(NISAB) + ' FCFA' },
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
            <p className="text-lg font-medium">Profil non trouve</p>
            <p className="text-sm text-muted-foreground mt-1">
              {isAdmin
                ? 'Selectionnez un profil dans la liste ci-dessus.'
                : "Votre compte n'est pas lie a un profil associe. Contactez l'administrateur."}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
