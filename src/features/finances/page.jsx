import { useState, useEffect, useMemo } from 'react';
import { db } from '@/services/db';
import { logAction } from '@/services/audit';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Landmark, Plus, Edit2, Trash2, CreditCard, Users2, TrendingUp,
  Receipt, CircleDollarSign, Percent, Calendar,
} from 'lucide-react';
import { toast } from 'sonner';

function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)); }

const TABS = [
  { id: 'charges', label: 'Charges fixes', icon: Receipt },
  { id: 'dettes', label: 'Dettes & Crédits', icon: CreditCard },
  { id: 'actionnaires', label: 'Actionnaires', icon: Users2 },
  { id: 'investissements', label: 'Investissements', icon: TrendingUp },
];

export default function Finances() {
  const [activeTab, setActiveTab] = useState('charges');
  const [charges, setCharges] = useState([]);
  const [dettes, setDettes] = useState([]);
  const [actionnaires, setActionnaires] = useState([]);
  const [investissements, setInvestissements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({});

  const load = async () => {
    const [ch, de, ac, inv] = await Promise.all([
      db.charges_fixes.list(), db.dettes.list(),
      db.actionnaires.list(), db.investissements.list(),
    ]);
    setCharges(ch); setDettes(de); setActionnaires(ac); setInvestissements(inv);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const totalCharges = charges.filter((c) => c.actif !== false).reduce((s, c) => s + (c.montant || 0), 0);
  const totalDettes = dettes.reduce((s, d) => s + (d.montant_restant || d.montant_initial || 0), 0);
  const totalInvest = investissements.reduce((s, i) => s + (i.montant || 0), 0);
  const totalParts = actionnaires.reduce((s, a) => s + (a.pourcentage || 0), 0);

  const getCollection = () => {
    const map = { charges: db.charges_fixes, dettes: db.dettes, actionnaires: db.actionnaires, investissements: db.investissements };
    return map[activeTab];
  };

  const openAdd = () => {
    setEditItem(null);
    if (activeTab === 'charges') setForm({ libelle: '', type: 'loyer', montant: '', beneficiaire: '', actif: true });
    else if (activeTab === 'dettes') setForm({ libelle: '', montant_initial: '', taux_interet: '', duree_mois: '', montant_restant: '', date_debut: '' });
    else if (activeTab === 'actionnaires') setForm({ nom: '', pourcentage: '', investissement: '' });
    else setForm({ titre: '', description: '', montant: '', roi_estime: '', statut: 'en_cours' });
    setShowForm(true);
  };

  const openEdit = (item) => {
    setEditItem(item);
    setForm({ ...item });
    setShowForm(true);
  };

  const handleSave = async () => {
    const coll = getCollection();
    const data = { ...form };
    // Convert numbers
    ['montant', 'montant_initial', 'taux_interet', 'duree_mois', 'montant_restant', 'pourcentage', 'investissement', 'roi_estime'].forEach((k) => {
      if (data[k] !== undefined && data[k] !== '') data[k] = Number(data[k]) || 0;
    });
    if (editItem) {
      await coll.update(editItem.id, data);
      toast.success('Modifié');
    } else {
      await coll.create(data);
      toast.success('Ajouté');
    }
    setShowForm(false);
    load();
  };

  const handleDelete = async (item) => {
    if (!confirm('Supprimer ?')) return;
    await getCollection().delete(item.id);
    toast.success('Supprimé');
    load();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Finances</h2>
        <p className="text-muted-foreground">Charges fixes, dettes, actionnaires et investissements</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="border-l-4 border-l-red-500"><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Charges mensuelles</p>
          <p className="text-xl font-bold">{fmt(totalCharges)} F</p>
        </CardContent></Card>
        <Card className="border-l-4 border-l-orange-500"><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Dettes restantes</p>
          <p className="text-xl font-bold">{fmt(totalDettes)} F</p>
        </CardContent></Card>
        <Card className="border-l-4 border-l-blue-500"><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Investissements</p>
          <p className="text-xl font-bold">{fmt(totalInvest)} F</p>
        </CardContent></Card>
        <Card className="border-l-4 border-l-violet-500"><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Parts actionnaires</p>
          <p className="text-xl font-bold">{totalParts.toFixed(1)}%</p>
        </CardContent></Card>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b pb-0">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${activeTab === id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {/* Add button */}
      <div className="flex justify-end">
        <Button className="gap-2" onClick={openAdd}><Plus className="h-4 w-4" /> Ajouter</Button>
      </div>

      {/* Charges Tab */}
      {activeTab === 'charges' && (
        <Card><CardContent className="p-0">
          <div className="divide-y">
            {charges.length === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">Aucune charge fixe</p> :
              charges.map((c) => (
                <div key={c.id} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/50">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-500/10 shrink-0"><Receipt className="h-4 w-4 text-red-600" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">{c.libelle}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="outline" className="text-[10px]">{c.type}</Badge>
                      {c.beneficiaire && <span className="text-[10px] text-muted-foreground">{c.beneficiaire}</span>}
                      {c.actif === false && <Badge className="text-[10px] bg-slate-200 text-slate-600">Inactif</Badge>}
                    </div>
                  </div>
                  <span className="text-sm font-bold text-red-600 shrink-0">{fmt(c.montant)} F/mois</span>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => openEdit(c)} className="rounded p-1.5 hover:bg-muted"><Edit2 className="h-3.5 w-3.5 text-muted-foreground" /></button>
                    <button onClick={() => handleDelete(c)} className="rounded p-1.5 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5 text-red-500" /></button>
                  </div>
                </div>
              ))}
          </div>
        </CardContent></Card>
      )}

      {/* Dettes Tab */}
      {activeTab === 'dettes' && (
        <Card><CardContent className="p-0">
          <div className="divide-y">
            {dettes.length === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">Aucune dette</p> :
              dettes.map((d) => {
                const progress = d.montant_initial > 0 ? ((d.montant_initial - (d.montant_restant || 0)) / d.montant_initial) * 100 : 0;
                return (
                  <div key={d.id} className="px-4 py-3 hover:bg-muted/50">
                    <div className="flex items-center gap-4">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-500/10 shrink-0"><CreditCard className="h-4 w-4 text-orange-600" /></div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm">{d.libelle}</p>
                        <p className="text-[10px] text-muted-foreground">{d.taux_interet}% sur {d.duree_mois} mois</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold">{fmt(d.montant_restant || 0)} F</p>
                        <p className="text-[10px] text-muted-foreground">sur {fmt(d.montant_initial)} F</p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button onClick={() => openEdit(d)} className="rounded p-1.5 hover:bg-muted"><Edit2 className="h-3.5 w-3.5 text-muted-foreground" /></button>
                        <button onClick={() => handleDelete(d)} className="rounded p-1.5 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5 text-red-500" /></button>
                      </div>
                    </div>
                    <div className="mt-2 ml-13">
                      <div className="h-2 w-full rounded-full bg-muted">
                        <div className="h-2 rounded-full bg-orange-500 transition-all" style={{ width: `${progress}%` }} />
                      </div>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">{progress.toFixed(0)}% remboursé</p>
                    </div>
                  </div>
                );
              })}
          </div>
        </CardContent></Card>
      )}

      {/* Actionnaires Tab */}
      {activeTab === 'actionnaires' && (
        <Card><CardContent className="p-0">
          <div className="divide-y">
            {actionnaires.length === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">Aucun actionnaire</p> :
              actionnaires.map((a) => (
                <div key={a.id} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/50">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/10 shrink-0"><Users2 className="h-4 w-4 text-violet-600" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">{a.nom}</p>
                    <p className="text-[10px] text-muted-foreground">Investissement: {fmt(a.investissement)} F</p>
                  </div>
                  <Badge className="text-sm bg-violet-100 text-violet-700">{a.pourcentage}%</Badge>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => openEdit(a)} className="rounded p-1.5 hover:bg-muted"><Edit2 className="h-3.5 w-3.5 text-muted-foreground" /></button>
                    <button onClick={() => handleDelete(a)} className="rounded p-1.5 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5 text-red-500" /></button>
                  </div>
                </div>
              ))}
          </div>
        </CardContent></Card>
      )}

      {/* Investissements Tab */}
      {activeTab === 'investissements' && (
        <Card><CardContent className="p-0">
          <div className="divide-y">
            {investissements.length === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">Aucun investissement</p> :
              investissements.map((inv) => (
                <div key={inv.id} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/50">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10 shrink-0"><TrendingUp className="h-4 w-4 text-blue-600" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">{inv.titre}</p>
                    <p className="text-[10px] text-muted-foreground line-clamp-1">{inv.description}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold">{fmt(inv.montant)} F</p>
                    {inv.roi_estime > 0 && <p className="text-[10px] text-emerald-600">ROI ~{inv.roi_estime}%</p>}
                  </div>
                  <Badge variant="outline" className="text-[10px] shrink-0">{inv.statut || 'en cours'}</Badge>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => openEdit(inv)} className="rounded p-1.5 hover:bg-muted"><Edit2 className="h-3.5 w-3.5 text-muted-foreground" /></button>
                    <button onClick={() => handleDelete(inv)} className="rounded p-1.5 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5 text-red-500" /></button>
                  </div>
                </div>
              ))}
          </div>
        </CardContent></Card>
      )}

      {/* Form Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editItem ? 'Modifier' : 'Ajouter'}</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            {activeTab === 'charges' && (<>
              <div><label className="mb-1.5 block text-sm font-medium">Libellé</label><Input value={form.libelle || ''} onChange={(e) => setForm({ ...form, libelle: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1.5 block text-sm font-medium">Type</label>
                  <Select value={form.type || 'loyer'} onValueChange={(v) => setForm({ ...form, type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {['loyer', 'salaire', 'electricite', 'eau', 'internet', 'assurance', 'autre'].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><label className="mb-1.5 block text-sm font-medium">Montant (F/mois)</label><Input type="number" value={form.montant || ''} onChange={(e) => setForm({ ...form, montant: e.target.value })} /></div>
              </div>
              <div><label className="mb-1.5 block text-sm font-medium">Bénéficiaire</label><Input value={form.beneficiaire || ''} onChange={(e) => setForm({ ...form, beneficiaire: e.target.value })} /></div>
            </>)}
            {activeTab === 'dettes' && (<>
              <div><label className="mb-1.5 block text-sm font-medium">Libellé</label><Input value={form.libelle || ''} onChange={(e) => setForm({ ...form, libelle: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1.5 block text-sm font-medium">Montant initial (F)</label><Input type="number" value={form.montant_initial || ''} onChange={(e) => setForm({ ...form, montant_initial: e.target.value })} /></div>
                <div><label className="mb-1.5 block text-sm font-medium">Restant (F)</label><Input type="number" value={form.montant_restant || ''} onChange={(e) => setForm({ ...form, montant_restant: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1.5 block text-sm font-medium">Taux d'intérêt (%)</label><Input type="number" step="0.1" value={form.taux_interet || ''} onChange={(e) => setForm({ ...form, taux_interet: e.target.value })} /></div>
                <div><label className="mb-1.5 block text-sm font-medium">Durée (mois)</label><Input type="number" value={form.duree_mois || ''} onChange={(e) => setForm({ ...form, duree_mois: e.target.value })} /></div>
              </div>
            </>)}
            {activeTab === 'actionnaires' && (<>
              <div><label className="mb-1.5 block text-sm font-medium">Nom</label><Input value={form.nom || ''} onChange={(e) => setForm({ ...form, nom: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1.5 block text-sm font-medium">Parts (%)</label><Input type="number" step="0.1" value={form.pourcentage || ''} onChange={(e) => setForm({ ...form, pourcentage: e.target.value })} /></div>
                <div><label className="mb-1.5 block text-sm font-medium">Investissement (F)</label><Input type="number" value={form.investissement || ''} onChange={(e) => setForm({ ...form, investissement: e.target.value })} /></div>
              </div>
            </>)}
            {activeTab === 'investissements' && (<>
              <div><label className="mb-1.5 block text-sm font-medium">Titre</label><Input value={form.titre || ''} onChange={(e) => setForm({ ...form, titre: e.target.value })} /></div>
              <div><label className="mb-1.5 block text-sm font-medium">Description</label><textarea className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1.5 block text-sm font-medium">Montant (F)</label><Input type="number" value={form.montant || ''} onChange={(e) => setForm({ ...form, montant: e.target.value })} /></div>
                <div><label className="mb-1.5 block text-sm font-medium">ROI estimé (%)</label><Input type="number" value={form.roi_estime || ''} onChange={(e) => setForm({ ...form, roi_estime: e.target.value })} /></div>
              </div>
            </>)}
            <Button className="w-full" onClick={handleSave}>{editItem ? 'Enregistrer' : 'Ajouter'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
