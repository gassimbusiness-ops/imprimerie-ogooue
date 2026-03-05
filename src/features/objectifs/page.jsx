import { useState, useEffect, useMemo } from 'react';
import { db } from '@/services/db';
import { logAction } from '@/services/audit';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Target, Plus, Edit2, Trash2, TrendingUp, CheckCircle2, Clock, AlertTriangle, BarChart3 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { toast } from 'sonner';

function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)); }

const TYPES = { mensuel: 'Mensuel', annuel: 'Annuel' };
const CATEGORIES_OBJ = { global: 'Global', equipe: 'Équipe', individuel: 'Individuel' };

export default function Objectifs() {
  const [objectifs, setObjectifs] = useState([]);
  const [rapports, setRapports] = useState([]);
  const [lignes, setLignes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({ titre: '', type: 'mensuel', categorie: 'global', objectif_montant: '', mois: '' });

  const load = async () => {
    const [o, r, l] = await Promise.all([db.objectifs.list(), db.rapports.list(), db.rapportLignes.list()]);
    setObjectifs(o.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')));
    setRapports(r); setLignes(l);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Calculate real progress from rapports
  const enriched = useMemo(() => {
    return objectifs.map((obj) => {
      const targetMonth = obj.mois || new Date().toISOString().slice(0, 7);
      const moisRapports = rapports.filter((r) => obj.type === 'annuel' ? (r.date || '').startsWith(targetMonth.slice(0, 4)) : (r.date || '').startsWith(targetMonth));
      const rapportIds = new Set(moisRapports.map((r) => r.id));
      const moisLignes = lignes.filter((l) => rapportIds.has(l.rapport_id));
      const realise = moisLignes.reduce((s, l) => s + (l.recettes || 0), 0);
      const objectifMontant = obj.objectif_montant || 1;
      const progress = Math.min((realise / objectifMontant) * 100, 150);
      const statut = progress >= 100 ? 'atteint' : progress >= 70 ? 'en_cours' : progress >= 30 ? 'en_retard' : 'critique';
      return { ...obj, realise, progress, statut_calc: statut };
    });
  }, [objectifs, rapports, lignes]);

  const stats = useMemo(() => ({
    total: enriched.length,
    atteints: enriched.filter((o) => o.statut_calc === 'atteint').length,
    en_cours: enriched.filter((o) => o.statut_calc === 'en_cours').length,
    en_retard: enriched.filter((o) => o.statut_calc === 'en_retard' || o.statut_calc === 'critique').length,
  }), [enriched]);

  const chartData = enriched.slice(0, 8).map((o) => ({
    name: o.titre?.substring(0, 15) || '?',
    objectif: o.objectif_montant || 0,
    realise: o.realise || 0,
  }));

  const openAdd = () => { setEditItem(null); setForm({ titre: '', type: 'mensuel', categorie: 'global', objectif_montant: '', mois: new Date().toISOString().slice(0, 7) }); setShowForm(true); };
  const openEdit = (o) => { setEditItem(o); setForm({ ...o, objectif_montant: o.objectif_montant || '' }); setShowForm(true); };

  const handleSave = async () => {
    if (!form.titre.trim()) { toast.error('Titre requis'); return; }
    const data = { ...form, objectif_montant: Number(form.objectif_montant) || 0 };
    if (editItem) { await db.objectifs.update(editItem.id, data); toast.success('Objectif modifié'); }
    else { await db.objectifs.create(data); toast.success('Objectif créé'); }
    setShowForm(false); load();
  };

  const handleDelete = async (o) => {
    if (!confirm(`Supprimer "${o.titre}" ?`)) return;
    await db.objectifs.delete(o.id); toast.success('Supprimé'); load();
  };

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;

  const statutColors = { atteint: 'bg-emerald-100 text-emerald-700', en_cours: 'bg-blue-100 text-blue-700', en_retard: 'bg-orange-100 text-orange-700', critique: 'bg-red-100 text-red-700' };
  const statutLabels = { atteint: 'Atteint', en_cours: 'En cours', en_retard: 'En retard', critique: 'Critique' };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-2xl font-bold tracking-tight">Objectifs</h2><p className="text-muted-foreground">Suivi en temps réel depuis les rapports journaliers</p></div>
        <Button className="gap-2" onClick={openAdd}><Plus className="h-4 w-4" /> Nouvel objectif</Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Total', value: stats.total, icon: Target, color: 'bg-primary/10 text-primary' },
          { label: 'Atteints', value: stats.atteints, icon: CheckCircle2, color: 'bg-emerald-500/10 text-emerald-600' },
          { label: 'En cours', value: stats.en_cours, icon: Clock, color: 'bg-blue-500/10 text-blue-600' },
          { label: 'En retard', value: stats.en_retard, icon: AlertTriangle, color: 'bg-red-500/10 text-red-600' },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}><CardContent className="p-3"><div className="flex items-center gap-2">
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}><Icon className="h-4 w-4" /></div>
            <div><p className="text-[10px] text-muted-foreground">{label}</p><p className="text-base font-bold">{value}</p></div>
          </div></CardContent></Card>
        ))}
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <Card><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><BarChart3 className="h-4 w-4" /> Objectif vs Réalisé</CardTitle></CardHeader>
          <CardContent><ResponsiveContainer width="100%" height={250}>
            <BarChart data={chartData}><CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
              <Tooltip formatter={(v) => `${fmt(v)} F`} /><Bar dataKey="objectif" name="Objectif" fill="#94a3b8" radius={[2, 2, 0, 0]} /><Bar dataKey="realise" name="Réalisé" fill="#3b82f6" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer></CardContent>
        </Card>
      )}

      {/* Objectifs list */}
      <div className="space-y-3">
        {enriched.map((o) => (
          <Card key={o.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => openEdit(o)}>
            <CardContent className="p-4">
              <div className="flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold">{o.titre}</p>
                    <Badge variant="outline" className="text-[10px]">{TYPES[o.type]}</Badge>
                    <Badge variant="outline" className="text-[10px]">{CATEGORIES_OBJ[o.categorie]}</Badge>
                    <Badge className={`text-[10px] ${statutColors[o.statut_calc]}`}>{statutLabels[o.statut_calc]}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Période: {o.mois || '—'}</p>
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span>{fmt(o.realise)} F réalisé</span>
                      <span className="font-semibold">{o.progress.toFixed(0)}%</span>
                    </div>
                    <div className="h-2.5 w-full rounded-full bg-muted">
                      <div className={`h-2.5 rounded-full transition-all ${o.progress >= 100 ? 'bg-emerald-500' : o.progress >= 70 ? 'bg-blue-500' : o.progress >= 30 ? 'bg-orange-500' : 'bg-red-500'}`}
                        style={{ width: `${Math.min(o.progress, 100)}%` }} />
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">Objectif: {fmt(o.objectif_montant)} F</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {enriched.length === 0 && <div className="flex flex-col items-center justify-center py-16"><Target className="mb-4 h-12 w-12 text-muted-foreground/30" /><p className="text-muted-foreground">Aucun objectif défini</p></div>}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle>{editItem ? 'Modifier' : 'Nouvel objectif'}</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div><label className="mb-1.5 block text-sm font-medium">Titre *</label><Input value={form.titre} onChange={(e) => setForm({ ...form, titre: e.target.value })} placeholder="Ex: CA mensuel Mars" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="mb-1.5 block text-sm font-medium">Type</label><Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(TYPES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select></div>
              <div><label className="mb-1.5 block text-sm font-medium">Catégorie</label><Select value={form.categorie} onValueChange={(v) => setForm({ ...form, categorie: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(CATEGORIES_OBJ).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="mb-1.5 block text-sm font-medium">Montant objectif (F)</label><Input type="number" value={form.objectif_montant} onChange={(e) => setForm({ ...form, objectif_montant: e.target.value })} /></div>
              <div><label className="mb-1.5 block text-sm font-medium">Mois cible</label><input type="month" value={form.mois} onChange={(e) => setForm({ ...form, mois: e.target.value })} className="rounded-md border px-3 py-2 text-sm w-full" /></div>
            </div>
            <div className="flex gap-3">
              <Button className="flex-1" onClick={handleSave}>{editItem ? 'Enregistrer' : 'Créer'}</Button>
              {editItem && <Button variant="destructive" onClick={() => { handleDelete(editItem); setShowForm(false); }}><Trash2 className="h-4 w-4" /></Button>}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
