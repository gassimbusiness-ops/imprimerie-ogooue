import { useState, useEffect, useMemo } from 'react';
import { db } from '@/services/db';
import { useAuth } from '@/services/auth';
import { logAction } from '@/services/audit';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Wallet,
  Calculator,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  TrendingDown,
  TrendingUp,
  Plus,
  Eye,
} from 'lucide-react';
import { toast } from 'sonner';

function fmt(n) {
  return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0));
}

const STATUT_STYLES = {
  ok: { label: 'OK', icon: CheckCircle2, class: 'bg-emerald-100 text-emerald-700', iconClass: 'text-emerald-500' },
  ecart_mineur: { label: 'Écart mineur', icon: AlertTriangle, class: 'bg-orange-100 text-orange-700', iconClass: 'text-orange-500' },
  ecart_majeur: { label: 'Écart majeur', icon: XCircle, class: 'bg-red-100 text-red-700', iconClass: 'text-red-500' },
};

// Billets et pièces F CFA
const DENOMINATIONS = [
  { label: '10 000 F', value: 10000 },
  { label: '5 000 F', value: 5000 },
  { label: '2 000 F', value: 2000 },
  { label: '1 000 F', value: 1000 },
  { label: '500 F', value: 500 },
  { label: '100 F', value: 100 },
  { label: '50 F', value: 50 },
  { label: '25 F', value: 25 },
  { label: '10 F', value: 10 },
  { label: '5 F', value: 5 },
];

export default function ClotureCaisse() {
  const { user, hasPermission, isAdmin } = useAuth();
  const canWrite = hasPermission('statistiques', 'write');
  const [clotures, setClotures] = useState([]);
  const [rapports, setRapports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showDetail, setShowDetail] = useState(null);
  const [counts, setCounts] = useState({});
  const [commentaire, setCommentaire] = useState('');

  const today = new Date().toISOString().split('T')[0];

  const load = async () => {
    const [cData, rData] = await Promise.all([
      db.clotures_caisse.list(),
      db.rapports.list(),
    ]);
    setClotures(cData.sort((a, b) => b.date.localeCompare(a.date)));
    setRapports(rData);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Calculate expected cash for today
  const todayExpected = useMemo(() => {
    const todayRapports = rapports.filter((r) => r.date === today);
    const recettes = todayRapports.reduce(
      (s, r) => s + Object.values(r.categories || {}).reduce((a, v) => a + (v || 0), 0), 0
    );
    const depenses = todayRapports.reduce(
      (s, r) => s + (r.depenses || []).reduce((a, d) => a + (d.montant || 0), 0), 0
    );
    return { recettes, depenses, attendu: recettes - depenses, rapportsCount: todayRapports.length };
  }, [rapports, today]);

  const todayCloture = clotures.find((c) => c.date === today);

  // Physical count total
  const totalPhysique = useMemo(() => {
    return DENOMINATIONS.reduce((sum, d) => sum + (parseInt(counts[d.value] || 0) * d.value), 0);
  }, [counts]);

  const ecart = totalPhysique - todayExpected.attendu;
  const ecartPct = todayExpected.attendu > 0 ? (ecart / todayExpected.attendu) * 100 : 0;

  const openForm = () => {
    setCounts({});
    setCommentaire('');
    setShowForm(true);
  };

  const handleSubmit = async () => {
    const statut = Math.abs(ecart) < 1000 ? 'ok' : Math.abs(ecart) < 5000 ? 'ecart_mineur' : 'ecart_majeur';
    const data = {
      date: today,
      employe_id: user.id,
      employe_nom: `${user.prenom} ${user.nom}`,
      montant_attendu: todayExpected.attendu,
      montant_reel: totalPhysique,
      ecart,
      commentaire,
      statut,
      denominations: counts,
      valide_par: '',
    };
    await db.clotures_caisse.create(data);
    await logAction('cloture', 'cloture_caisse', {
      entityLabel: `Clôture ${new Date(today).toLocaleDateString('fr-FR')}`,
      details: `Clôture de caisse — Attendu: ${fmt(todayExpected.attendu)} F, Réel: ${fmt(totalPhysique)} F, Écart: ${fmt(ecart)} F`,
      metadata: { attendu: todayExpected.attendu, reel: totalPhysique, ecart, statut },
    });
    toast.success('Clôture de caisse enregistrée');
    setShowForm(false);
    load();
  };

  // Stats
  const stats = useMemo(() => {
    const last7 = clotures.filter((c) => {
      const d = new Date(c.date);
      const ago = new Date();
      ago.setDate(ago.getDate() - 7);
      return d >= ago;
    });
    const avgEcart = last7.length > 0
      ? last7.reduce((s, c) => s + (c.ecart || 0), 0) / last7.length
      : 0;
    const majeurs = clotures.filter((c) => c.statut === 'ecart_majeur').length;
    return { total: clotures.length, avgEcart, majeurs };
  }, [clotures]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Clôture de Caisse</h2>
          <p className="text-muted-foreground">Comptage physique et vérification des écarts</p>
        </div>
        {canWrite && !todayCloture && (
          <Button className="gap-2" onClick={openForm}>
            <Plus className="h-4 w-4" /> Clôturer aujourd'hui
          </Button>
        )}
      </div>

      {/* Today's summary */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
                <TrendingUp className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Recettes du jour</p>
                <p className="text-lg font-bold">{fmt(todayExpected.recettes)} F</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/10">
                <TrendingDown className="h-5 w-5 text-red-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Dépenses du jour</p>
                <p className="text-lg font-bold">{fmt(todayExpected.depenses)} F</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10">
                <Wallet className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Caisse attendue</p>
                <p className="text-lg font-bold">{fmt(todayExpected.attendu)} F</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${todayCloture ? (todayCloture.statut === 'ok' ? 'bg-emerald-500/10' : 'bg-orange-500/10') : 'bg-slate-500/10'}`}>
                {todayCloture ? (
                  todayCloture.statut === 'ok' ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <AlertTriangle className="h-5 w-5 text-orange-500" />
                ) : (
                  <Clock className="h-5 w-5 text-slate-400" />
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Statut</p>
                <p className="text-lg font-bold">
                  {todayCloture ? STATUT_STYLES[todayCloture.statut]?.label || 'OK' : 'En attente'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* History table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Historique des clôtures</CardTitle>
        </CardHeader>
        <CardContent>
          {clotures.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">Aucune clôture enregistrée</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 pr-4">Date</th>
                    <th className="pb-2 pr-4">Opérateur</th>
                    <th className="pb-2 pr-4 text-right">Attendu</th>
                    <th className="pb-2 pr-4 text-right">Réel</th>
                    <th className="pb-2 pr-4 text-right">Écart</th>
                    <th className="pb-2 pr-4">Statut</th>
                    <th className="pb-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {clotures.slice(0, 20).map((c) => {
                    const st = STATUT_STYLES[c.statut] || STATUT_STYLES.ok;
                    return (
                      <tr key={c.id} className="border-b last:border-0 hover:bg-muted/50">
                        <td className="py-2.5 pr-4 font-medium">
                          {new Date(c.date + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </td>
                        <td className="py-2.5 pr-4">{c.employe_nom}</td>
                        <td className="py-2.5 pr-4 text-right">{fmt(c.montant_attendu)} F</td>
                        <td className="py-2.5 pr-4 text-right">{fmt(c.montant_reel)} F</td>
                        <td className={`py-2.5 pr-4 text-right font-semibold ${c.ecart < 0 ? 'text-red-500' : c.ecart > 0 ? 'text-emerald-600' : ''}`}>
                          {c.ecart > 0 ? '+' : ''}{fmt(c.ecart)} F
                        </td>
                        <td className="py-2.5 pr-4">
                          <Badge variant="outline" className={st.class}>{st.label}</Badge>
                        </td>
                        <td className="py-2.5">
                          <button
                            onClick={() => setShowDetail(c)}
                            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
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

      {/* Clôture form dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5" />
              Clôture de caisse — {new Date().toLocaleDateString('fr-FR')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {/* Expected amount */}
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Montant attendu (système)</p>
              <p className="text-xl font-bold">{fmt(todayExpected.attendu)} F</p>
              <p className="text-xs text-muted-foreground mt-1">
                {todayExpected.rapportsCount} rapport{todayExpected.rapportsCount > 1 ? 's' : ''} — Recettes: {fmt(todayExpected.recettes)} F, Dépenses: {fmt(todayExpected.depenses)} F
              </p>
            </div>

            {/* Denomination counting */}
            <div>
              <p className="mb-2 text-sm font-medium">Comptage physique</p>
              <div className="grid grid-cols-2 gap-2">
                {DENOMINATIONS.map((d) => (
                  <div key={d.value} className="flex items-center gap-2 rounded-lg border p-2">
                    <span className="w-20 text-xs font-medium">{d.label}</span>
                    <span className="text-xs text-muted-foreground">×</span>
                    <Input
                      type="number"
                      min="0"
                      className="h-8 text-center"
                      value={counts[d.value] || ''}
                      onChange={(e) => setCounts({ ...counts, [d.value]: e.target.value })}
                      placeholder="0"
                    />
                    <span className="w-20 text-right text-xs font-semibold">
                      {fmt((parseInt(counts[d.value] || 0)) * d.value)} F
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Total + écart */}
            <div className="rounded-lg border-2 border-dashed p-3 space-y-2">
              <div className="flex justify-between">
                <span className="text-sm font-medium">Total physique</span>
                <span className="text-lg font-bold">{fmt(totalPhysique)} F</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm font-medium">Écart</span>
                <span className={`text-lg font-bold ${ecart < 0 ? 'text-red-500' : ecart > 0 ? 'text-emerald-600' : ''}`}>
                  {ecart > 0 ? '+' : ''}{fmt(ecart)} F
                  {todayExpected.attendu > 0 && (
                    <span className="ml-1 text-xs font-normal">({ecartPct > 0 ? '+' : ''}{ecartPct.toFixed(1)}%)</span>
                  )}
                </span>
              </div>
              {Math.abs(ecart) >= 5000 && (
                <div className="flex items-center gap-2 rounded-md bg-red-50 p-2 text-red-700">
                  <XCircle className="h-4 w-4 shrink-0" />
                  <span className="text-xs font-medium">Écart majeur — L'administrateur sera notifié</span>
                </div>
              )}
              {Math.abs(ecart) >= 1000 && Math.abs(ecart) < 5000 && (
                <div className="flex items-center gap-2 rounded-md bg-orange-50 p-2 text-orange-700">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span className="text-xs font-medium">Écart mineur détecté</span>
                </div>
              )}
            </div>

            {/* Comment */}
            <div>
              <label className="mb-1 block text-sm font-medium">Commentaire</label>
              <Input
                value={commentaire}
                onChange={(e) => setCommentaire(e.target.value)}
                placeholder="Observations éventuelles..."
              />
            </div>

            <Button className="w-full gap-2" onClick={handleSubmit}>
              <CheckCircle2 className="h-4 w-4" />
              Valider la clôture
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
      <Dialog open={!!showDetail} onOpenChange={() => setShowDetail(null)}>
        <DialogContent className="max-w-md">
          {showDetail && (
            <>
              <DialogHeader>
                <DialogTitle>
                  Clôture du {new Date(showDetail.date + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3 pt-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Opérateur</span>
                  <span className="font-medium">{showDetail.employe_nom}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Montant attendu</span>
                  <span className="font-medium">{fmt(showDetail.montant_attendu)} F</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Montant réel</span>
                  <span className="font-medium">{fmt(showDetail.montant_reel)} F</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Écart</span>
                  <span className={`font-bold ${showDetail.ecart < 0 ? 'text-red-500' : showDetail.ecart > 0 ? 'text-emerald-600' : ''}`}>
                    {showDetail.ecart > 0 ? '+' : ''}{fmt(showDetail.ecart)} F
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Statut</span>
                  <Badge variant="outline" className={STATUT_STYLES[showDetail.statut]?.class}>
                    {STATUT_STYLES[showDetail.statut]?.label}
                  </Badge>
                </div>
                {showDetail.commentaire && (
                  <div className="rounded-lg bg-muted/50 p-3">
                    <p className="text-xs text-muted-foreground">Commentaire</p>
                    <p className="text-sm">{showDetail.commentaire}</p>
                  </div>
                )}
                {showDetail.valide_par && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Validé par</span>
                    <span className="font-medium">{showDetail.valide_par}</span>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
