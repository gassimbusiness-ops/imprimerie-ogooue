import { useState, useEffect, useMemo } from 'react';
import { db } from '@/services/db';
import { logAction } from '@/services/audit';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CalendarDays, Plus, Edit2, Trash2, Megaphone, Gift, Star, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

const TYPES_EVT = {
  fete_nationale: { label: 'Fête nationale', emoji: '🇬🇦', color: 'bg-emerald-100 text-emerald-700' },
  fete_religieuse: { label: 'Fête religieuse', emoji: '🕌', color: 'bg-violet-100 text-violet-700' },
  rentree_scolaire: { label: 'Rentrée scolaire', emoji: '📚', color: 'bg-blue-100 text-blue-700' },
  commercial: { label: 'Commercial', emoji: '🛍️', color: 'bg-amber-100 text-amber-700' },
  culturel: { label: 'Culturel', emoji: '🎭', color: 'bg-pink-100 text-pink-700' },
  autre: { label: 'Autre', emoji: '📅', color: 'bg-slate-100 text-slate-700' },
};

const EVENEMENTS_GABON = [
  { nom: 'Nouvel An', date: '01-01', type: 'fete_nationale', opportunites: 'Cartes de voeux, calendriers, agendas' },
  { nom: 'Fête du Travail', date: '05-01', type: 'fete_nationale', opportunites: 'Affiches syndicales, badges' },
  { nom: 'Fête de l\'Indépendance', date: '08-17', type: 'fete_nationale', opportunites: 'Drapeaux, banderoles, T-shirts, casquettes' },
  { nom: 'Toussaint', date: '11-01', type: 'fete_religieuse', opportunites: 'Faire-part, affiches commémoratives' },
  { nom: 'Noël', date: '12-25', type: 'fete_religieuse', opportunites: 'Cartes, emballages, catalogues cadeaux' },
  { nom: 'Rentrée scolaire', date: '09-15', type: 'rentree_scolaire', opportunites: 'Cahiers, protège-cahiers, étiquettes, fournitures' },
  { nom: 'Saint-Valentin', date: '02-14', type: 'commercial', opportunites: 'Cartes, posters, T-shirts personnalisés' },
  { nom: 'Fête des Mères', date: '05-26', type: 'commercial', opportunites: 'Cartes, mugs, T-shirts, photos' },
];

const emptyForm = { nom: '', date: '', type: 'autre', opportunites: '', description: '', recurrent: true };

export default function Evenements() {
  const [evenements, setEvenements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState(emptyForm);

  const load = async () => {
    const data = await db.evenements.list();
    setEvenements(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Merge stored + default events
  const allEvents = useMemo(() => {
    const stored = evenements.map((e) => ({ ...e, source: 'custom' }));
    const defaults = EVENEMENTS_GABON.map((e) => {
      const year = new Date().getFullYear();
      const fullDate = `${year}-${e.date}`;
      return { ...e, date: fullDate, id: `default-${e.date}`, source: 'default' };
    });
    // Filter out defaults if custom exists with same name
    const customNames = new Set(stored.map((s) => s.nom));
    const merged = [...stored, ...defaults.filter((d) => !customNames.has(d.nom))];
    return merged.sort((a, b) => {
      const da = (a.date || '').slice(5);
      const db2 = (b.date || '').slice(5);
      return da.localeCompare(db2);
    });
  }, [evenements]);

  // Upcoming events
  const upcoming = useMemo(() => {
    const today = new Date();
    const todayStr = today.toISOString().slice(5, 10);
    return allEvents.filter((e) => {
      const evtDate = (e.date || '').slice(5);
      return evtDate >= todayStr;
    }).slice(0, 6);
  }, [allEvents]);

  const openAdd = () => { setEditItem(null); setForm(emptyForm); setShowForm(true); };
  const openEdit = (e) => {
    if (e.source === 'default') return;
    setEditItem(e);
    setForm({ nom: e.nom || '', date: e.date || '', type: e.type || 'autre', opportunites: e.opportunites || '', description: e.description || '', recurrent: e.recurrent !== false });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.nom.trim()) { toast.error('Nom requis'); return; }
    if (editItem) { await db.evenements.update(editItem.id, form); toast.success('Événement modifié'); }
    else { await db.evenements.create(form); toast.success('Événement ajouté'); }
    setShowForm(false); load();
  };

  const handleDelete = async (e) => {
    if (e.source === 'default') return;
    if (!confirm(`Supprimer "${e.nom}" ?`)) return;
    await db.evenements.delete(e.id); toast.success('Supprimé'); load();
  };

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-2xl font-bold tracking-tight">Événements & Marketing</h2><p className="text-muted-foreground">Opportunités commerciales liées au calendrier gabonais</p></div>
        <Button className="gap-2" onClick={openAdd}><Plus className="h-4 w-4" /> Nouvel événement</Button>
      </div>

      {/* Upcoming */}
      {upcoming.length > 0 && (
        <Card className="border-l-4 border-l-amber-500 bg-amber-50/50">
          <CardContent className="p-4">
            <h3 className="flex items-center gap-2 font-semibold text-sm mb-3"><Sparkles className="h-4 w-4 text-amber-600" /> Prochains événements</h3>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {upcoming.map((e) => {
                const t = TYPES_EVT[e.type] || TYPES_EVT.autre;
                const dateObj = new Date(e.date);
                const daysUntil = Math.ceil((dateObj - new Date()) / (1000 * 60 * 60 * 24));
                return (
                  <div key={e.id} className="flex items-center gap-3 rounded-lg bg-white p-3 shadow-sm">
                    <span className="text-2xl">{t.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{e.nom}</p>
                      <p className="text-[10px] text-muted-foreground">{dateObj.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}</p>
                    </div>
                    {daysUntil >= 0 && daysUntil <= 30 && (
                      <Badge className="text-[10px] bg-amber-100 text-amber-700 shrink-0">J-{daysUntil}</Badge>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* All events */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {allEvents.map((e) => {
          const t = TYPES_EVT[e.type] || TYPES_EVT.autre;
          return (
            <Card key={e.id} className={`transition-shadow hover:shadow-md ${e.source === 'default' ? '' : 'cursor-pointer'}`}
              onClick={() => openEdit(e)}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <span className="text-3xl">{t.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-sm">{e.nom}</p>
                      {e.source === 'default' && <Badge variant="outline" className="text-[10px]">Auto</Badge>}
                    </div>
                    <Badge className={`mt-1 text-[10px] ${t.color}`}>{t.label}</Badge>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(e.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}
                    </p>
                  </div>
                  {e.source !== 'default' && (
                    <button onClick={(ev) => { ev.stopPropagation(); handleDelete(e); }} className="rounded p-1 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5 text-red-500" /></button>
                  )}
                </div>
                {e.opportunites && (
                  <div className="mt-3 border-t pt-3">
                    <p className="flex items-center gap-1 text-[10px] font-semibold text-amber-700 mb-1"><Megaphone className="h-3 w-3" /> Opportunités marketing</p>
                    <p className="text-xs text-muted-foreground">{e.opportunites}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle>{editItem ? 'Modifier' : 'Nouvel événement'}</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div><label className="mb-1.5 block text-sm font-medium">Nom *</label><Input value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="mb-1.5 block text-sm font-medium">Date</label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
              <div><label className="mb-1.5 block text-sm font-medium">Type</label><Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(TYPES_EVT).map(([k, v]) => <SelectItem key={k} value={k}>{v.emoji} {v.label}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <div><label className="mb-1.5 block text-sm font-medium">Opportunités marketing</label><textarea className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.opportunites} onChange={(e) => setForm({ ...form, opportunites: e.target.value })} placeholder="Quels produits promouvoir ?" /></div>
            <Button className="w-full" onClick={handleSave}>{editItem ? 'Enregistrer' : 'Ajouter'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
