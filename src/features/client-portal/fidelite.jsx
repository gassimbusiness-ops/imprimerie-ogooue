import { useState, useEffect } from 'react';
import { db } from '@/services/db';
import { useAuth } from '@/services/auth';
import { NIVEAUX, RECOMPENSES, calculerPoints } from '@/services/fidelite';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Gift, Star, TrendingUp, Clock, Award, ChevronRight, Copy, History } from 'lucide-react';
import { toast } from 'sonner';

function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)); }

export default function ClientFidelite() {
  const { user } = useAuth();
  const [fidelite, setFidelite] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    db.fidelite_clients.list().then((all) => {
      const mine = all.find((f) => f.client_id === user?.id);
      setFidelite(mine);
      setLoading(false);
    });
  }, [user]);

  const handleReclamer = async (recompense) => {
    if (!fidelite) return;
    if ((fidelite.points_actuels || 0) < recompense.points) {
      toast.error('Points insuffisants');
      return;
    }
    const newPoints = fidelite.points_actuels - recompense.points;
    const hist = [...(fidelite.historique || []), {
      type: 'recompense',
      points: -recompense.points,
      description: `Récompense : ${recompense.label}`,
      date: new Date().toISOString(),
    }];
    await db.fidelite_clients.update(fidelite.id, {
      points_actuels: newPoints,
      historique: hist,
    });
    setFidelite({ ...fidelite, points_actuels: newPoints, historique: hist });
    toast.success(`${recompense.label} réclamée ! Un conseiller vous contactera.`);
  };

  const copyCode = () => {
    if (fidelite?.code_parrainage) {
      navigator.clipboard.writeText(fidelite.code_parrainage);
      toast.success('Code copié !');
    }
  };

  if (loading) return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;

  if (!fidelite) {
    return (
      <div className="space-y-4 max-w-2xl mx-auto text-center py-12">
        <Gift className="h-16 w-16 mx-auto text-muted-foreground/30" />
        <h1 className="text-2xl font-bold">Programme de Fidélité</h1>
        <p className="text-muted-foreground">Votre programme de fidélité sera activé lors de votre première commande.</p>
      </div>
    );
  }

  const niveau = NIVEAUX[fidelite.niveau || 'bronze'] || NIVEAUX.bronze;
  const points = fidelite.points_actuels || 0;
  const totalGagnes = fidelite.total_points_gagnes || 0;
  const historique = (fidelite.historique || []).slice().reverse();

  // Progress towards next level
  const progressPercent = niveau.nextMin
    ? Math.min(100, (totalGagnes / niveau.nextMin) * 100)
    : 100;
  const pointsRestants = niveau.nextMin ? Math.max(0, niveau.nextMin - totalGagnes) : 0;

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold">Programme de Fidélité</h1>

      {/* ── Carte niveau + points ── */}
      <Card className="overflow-hidden border-0 shadow-lg">
        <div className={`bg-gradient-to-r ${niveau.color} p-5 sm:p-6 text-white`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/20 text-3xl">
                {niveau.icon}
              </div>
              <div>
                <p className="text-sm opacity-80">Niveau actuel</p>
                <p className="text-2xl font-bold">{niveau.label}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-4xl font-black">{fmt(points)}</p>
              <p className="text-xs opacity-80">points disponibles</p>
            </div>
          </div>

          {/* Barre de progression */}
          {niveau.nextMin && (
            <div className="mt-5">
              <div className="flex justify-between text-xs opacity-80 mb-1.5">
                <span>{niveau.label} ({niveau.min} pts)</span>
                <span>{niveau.nextLabel} ({niveau.nextMin} pts)</span>
              </div>
              <div className="h-3 rounded-full bg-white/20 overflow-hidden">
                <div
                  className="h-full rounded-full bg-white/80 transition-all duration-700"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <p className="text-xs opacity-80 mt-1.5 text-center">
                {pointsRestants > 0
                  ? `Plus que ${fmt(pointsRestants)} points pour ${niveau.nextLabel}`
                  : `Niveau ${niveau.nextLabel} atteint !`}
              </p>
            </div>
          )}

          {/* Code parrainage */}
          <div className="mt-4 flex items-center gap-2 rounded-lg bg-white/15 px-3 py-2.5">
            <Gift className="h-4 w-4 shrink-0" />
            <span className="text-xs">Code parrainage :</span>
            <span className="font-mono font-bold text-sm flex-1">{fidelite.code_parrainage}</span>
            <button onClick={copyCode} className="flex items-center gap-1 rounded bg-white/20 px-2 py-1 text-xs hover:bg-white/30 transition-colors">
              <Copy className="h-3 w-3" /> Copier
            </button>
          </div>
          <p className="text-[10px] opacity-60 mt-1.5">Partagez ce code : +100 pts pour vous et votre filleul lors de sa 1re commande</p>
        </div>
      </Card>

      {/* ── Niveaux de fidélité ── */}
      <Card>
        <CardContent className="p-4">
          <h2 className="font-semibold flex items-center gap-2 mb-4">
            <Award className="h-4 w-4 text-muted-foreground" /> Niveaux de fidélité
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Object.entries(NIVEAUX).map(([key, niv]) => {
              const isActive = key === (fidelite.niveau || 'bronze');
              return (
                <div key={key} className={`rounded-xl p-3 text-center border-2 transition-all ${isActive ? 'border-primary bg-primary/5 shadow-md' : 'border-muted'}`}>
                  <span className="text-2xl">{niv.icon}</span>
                  <p className={`font-bold text-sm mt-1 ${isActive ? 'text-primary' : ''}`}>{niv.label}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {niv.max ? `${fmt(niv.min)} – ${fmt(niv.max)} pts` : `${fmt(niv.min)}+ pts`}
                  </p>
                  {isActive && <Badge className="mt-1.5 text-[9px]">Actuel</Badge>}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ── Comment gagner des points ── */}
      <Card>
        <CardContent className="p-4">
          <h2 className="font-semibold flex items-center gap-2 mb-3">
            <TrendingUp className="h-4 w-4 text-muted-foreground" /> Comment gagner des points
          </h2>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between rounded-lg bg-muted/50 p-3">
              <span>Commande &lt; 10 000 F</span>
              <Badge variant="outline">1 pt / 1 000 F</Badge>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-muted/50 p-3">
              <span>Commande 10 000 – 50 000 F</span>
              <Badge variant="outline">1 pt / 800 F</Badge>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-muted/50 p-3">
              <span>Commande &gt; 50 000 F</span>
              <Badge variant="outline">1 pt / 600 F</Badge>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-emerald-50 p-3">
              <span>Parrainage (1re commande filleul)</span>
              <Badge className="bg-emerald-100 text-emerald-700">+100 pts</Badge>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-violet-50 p-3">
              <span>Bonus Noël / Rentrée / Fête nationale</span>
              <Badge className="bg-violet-100 text-violet-700">+50 pts</Badge>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground mt-3">Les points expirent après 12 mois d'inactivité.</p>
        </CardContent>
      </Card>

      {/* ── Récompenses disponibles ── */}
      <Card>
        <CardContent className="p-4">
          <h2 className="font-semibold flex items-center gap-2 mb-3">
            <Star className="h-4 w-4 text-muted-foreground" /> Récompenses
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {RECOMPENSES.map((r) => {
              const canClaim = points >= r.points;
              return (
                <div key={r.id} className={`rounded-xl border p-4 flex items-center gap-3 transition-all ${canClaim ? 'border-primary/30 bg-primary/5' : 'opacity-60'}`}>
                  <span className="text-2xl">{r.icon}</span>
                  <div className="flex-1">
                    <p className="font-semibold text-sm">{r.label}</p>
                    <p className="text-[11px] text-muted-foreground">{r.description}</p>
                    <p className="text-xs font-bold mt-1">{fmt(r.points)} points</p>
                  </div>
                  <Button
                    size="sm"
                    variant={canClaim ? 'default' : 'outline'}
                    disabled={!canClaim}
                    onClick={() => handleReclamer(r)}
                    className="text-xs shrink-0"
                  >
                    {canClaim ? 'Réclamer' : 'Indisponible'}
                  </Button>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ── Historique des transactions ── */}
      <Card>
        <CardContent className="p-4">
          <h2 className="font-semibold flex items-center gap-2 mb-3">
            <History className="h-4 w-4 text-muted-foreground" /> Historique des points
          </h2>
          {historique.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Aucune transaction pour le moment</p>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {historique.map((h, i) => {
                const isPositive = (h.points || 0) > 0;
                return (
                  <div key={i} className="flex items-center justify-between rounded-lg border p-3">
                    <div className="flex items-center gap-3">
                      <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold ${isPositive ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                        {isPositive ? '+' : '-'}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{h.description}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {h.date ? new Date(h.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}
                        </p>
                      </div>
                    </div>
                    <span className={`font-bold text-sm ${isPositive ? 'text-emerald-600' : 'text-red-600'}`}>
                      {isPositive ? '+' : ''}{h.points} pts
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
