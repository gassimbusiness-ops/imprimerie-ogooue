import { useState, useEffect, useMemo, useRef } from 'react';
import { db } from '@/services/db';
import { useAuth } from '@/services/auth';
import { logAction } from '@/services/audit';
import { printHTML } from '@/services/export-pdf';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Paintbrush, Plus, Search, Image, Download, Trash2,
  FileText, Eye, Palette, Layers, User, Calendar,
} from 'lucide-react';
import { toast } from 'sonner';

function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)); }

const SUPPORT_TYPES = [
  { value: 't_shirt', label: 'T-shirt' },
  { value: 'mug', label: 'Mug' },
  { value: 'casquette', label: 'Casquette' },
  { value: 'carte_visite', label: 'Carte de visite' },
  { value: 'flyer', label: 'Flyer / Affiche' },
  { value: 'banner', label: 'Bannière / Bâche' },
  { value: 'stylo', label: 'Stylo personnalisé' },
  { value: 'sac', label: 'Sac / Tote bag' },
  { value: 'autocollant', label: 'Autocollant / Sticker' },
  { value: 'calendrier', label: 'Calendrier' },
  { value: 'autre', label: 'Autre support' },
];

const VUES = [
  { value: 'face', label: 'Face avant' },
  { value: 'dos', label: 'Face arrière' },
  { value: 'cote', label: 'Vue de côté' },
  { value: 'dessus', label: 'Vue de dessus' },
  { value: 'perspective', label: 'Perspective 3D' },
];

export default function MockupIA() {
  const { user, hasPermission } = useAuth();
  const canWrite = hasPermission('catalogue', 'write');
  const [mockups, setMockups] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterSupport, setFilterSupport] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [showDetail, setShowDetail] = useState(null);
  const [form, setForm] = useState({
    nom: '', support: 't_shirt', vue: 'face',
    couleur_fond: '#ffffff', couleur_texte: '#000000',
    texte_personnalise: '', client_id: '', client_nom: '',
    notes: '', image_base64: '',
  });
  const fileInputRef = useRef(null);

  const load = async () => {
    const [m, c] = await Promise.all([
      db.mockups?.list?.() || Promise.resolve([]),
      db.clients.list(),
    ]);
    setMockups(m.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')));
    setClients(c);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    return mockups.filter((m) => {
      if (filterSupport !== 'all' && m.support !== filterSupport) return false;
      if (search) {
        const q = search.toLowerCase();
        return `${m.nom || ''} ${m.client_nom || ''} ${m.texte_personnalise || ''} ${m.support || ''}`.toLowerCase().includes(q);
      }
      return true;
    });
  }, [mockups, search, filterSupport]);

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error('Image trop lourde (max 5 Mo)'); return; }
    const reader = new FileReader();
    reader.onload = () => setForm({ ...form, image_base64: reader.result });
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    if (!form.nom.trim()) { toast.error('Nom du mockup requis'); return; }
    if (!form.support) { toast.error('Type de support requis'); return; }

    const payload = {
      ...form,
      createur_id: user?.id,
      createur_nom: `${user?.prenom} ${user?.nom}`,
      statut: 'brouillon',
    };

    await db.mockups.create(payload);
    await logAction('create', 'mockup', { entityLabel: form.nom });
    toast.success('Mockup créé !');
    setShowForm(false);
    resetForm();
    load();
  };

  const resetForm = () => {
    setForm({
      nom: '', support: 't_shirt', vue: 'face',
      couleur_fond: '#ffffff', couleur_texte: '#000000',
      texte_personnalise: '', client_id: '', client_nom: '',
      notes: '', image_base64: '',
    });
  };

  const handleDelete = async (id) => {
    if (!confirm('Supprimer ce mockup ?')) return;
    await db.mockups.delete(id);
    await logAction('delete', 'mockup', { entityId: id });
    toast.success('Mockup supprimé');
    setShowDetail(null);
    load();
  };

  const exportMockupPDF = (m) => {
    const supportLabel = SUPPORT_TYPES.find((s) => s.value === m.support)?.label || m.support;
    const vueLabel = VUES.find((v) => v.value === m.vue)?.label || m.vue;
    const html = `
      <h2>Fiche Mockup — ${m.nom}</h2>
      <div class="kpi-row">
        <div class="kpi-box"><div class="label">Support</div><div class="value" style="font-size:12px;">${supportLabel}</div></div>
        <div class="kpi-box"><div class="label">Vue</div><div class="value" style="font-size:12px;">${vueLabel}</div></div>
        <div class="kpi-box"><div class="label">Client</div><div class="value" style="font-size:12px;">${m.client_nom || '—'}</div></div>
        <div class="kpi-box"><div class="label">Date</div><div class="value" style="font-size:12px;">${m.created_at ? new Date(m.created_at).toLocaleDateString('fr-FR') : '—'}</div></div>
      </div>
      ${m.texte_personnalise ? `<div class="section"><h3>Texte personnalisé</h3><p>${m.texte_personnalise}</p></div>` : ''}
      <div class="section">
        <h3>Couleurs</h3>
        <table>
          <tr><td>Couleur de fond</td><td><span style="display:inline-block;width:20px;height:20px;background:${m.couleur_fond};border:1px solid #ccc;vertical-align:middle;border-radius:3px;"></span> ${m.couleur_fond}</td></tr>
          <tr><td>Couleur du texte</td><td><span style="display:inline-block;width:20px;height:20px;background:${m.couleur_texte};border:1px solid #ccc;vertical-align:middle;border-radius:3px;"></span> ${m.couleur_texte}</td></tr>
        </table>
      </div>
      ${m.image_base64 ? `<div class="section"><h3>Aperçu du design</h3><div style="text-align:center;margin:12px 0;"><img src="${m.image_base64}" style="max-width:400px;max-height:400px;border:1px solid #e5e7eb;border-radius:8px;" alt="Design" /></div></div>` : ''}
      ${m.notes ? `<div class="section"><h3>Notes</h3><p>${m.notes}</p></div>` : ''}
      <p style="margin-top:16px;font-size:9px;color:#6b7280;">Créé par ${m.createur_nom || 'Système'}</p>
    `;
    printHTML(`Mockup — ${m.nom}`, html);
  };

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Paintbrush className="h-6 w-6 text-primary" /> Mockups & Visuels
          </h2>
          <p className="text-muted-foreground">Créez et gérez vos maquettes produits</p>
        </div>
        {canWrite && (
          <Button className="gap-2" onClick={() => { resetForm(); setShowForm(true); }}>
            <Plus className="h-4 w-4" /> Nouveau mockup
          </Button>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Total mockups', value: mockups.length, icon: Layers, color: 'bg-primary/10 text-primary' },
          { label: 'Brouillons', value: mockups.filter((m) => m.statut === 'brouillon').length, icon: FileText, color: 'bg-amber-500/10 text-amber-600' },
          { label: 'Validés', value: mockups.filter((m) => m.statut === 'valide').length, icon: Eye, color: 'bg-emerald-500/10 text-emerald-600' },
          { label: 'Supports différents', value: [...new Set(mockups.map((m) => m.support))].length, icon: Palette, color: 'bg-violet-500/10 text-violet-600' },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}><CardContent className="p-3"><div className="flex items-center gap-2">
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}><Icon className="h-4 w-4" /></div>
            <div><p className="text-[10px] text-muted-foreground">{label}</p><p className="text-base font-bold">{value}</p></div>
          </div></CardContent></Card>
        ))}
      </div>

      {/* Filtres */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Rechercher un mockup..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={filterSupport} onValueChange={setFilterSupport}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous supports</SelectItem>
            {SUPPORT_TYPES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Grille de mockups */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16">
          <Paintbrush className="mb-4 h-12 w-12 text-muted-foreground/30" />
          <p className="text-muted-foreground">Aucun mockup</p>
          {canWrite && <Button variant="link" className="mt-2" onClick={() => { resetForm(); setShowForm(true); }}>Créer votre premier mockup →</Button>}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((m) => {
            const supportLabel = SUPPORT_TYPES.find((s) => s.value === m.support)?.label || m.support;
            return (
              <Card key={m.id} className="cursor-pointer hover:shadow-md transition-shadow overflow-hidden" onClick={() => setShowDetail(m)}>
                {/* Aperçu image ou placeholder */}
                <div
                  className="h-40 flex items-center justify-center border-b"
                  style={{ backgroundColor: m.couleur_fond || '#f8fafc' }}
                >
                  {m.image_base64 ? (
                    <img src={m.image_base64} alt={m.nom} className="h-full w-full object-contain p-2" />
                  ) : (
                    <div className="text-center p-4" style={{ color: m.couleur_texte || '#94a3b8' }}>
                      <Paintbrush className="h-8 w-8 mx-auto mb-2 opacity-30" />
                      {m.texte_personnalise && <p className="text-sm font-medium truncate max-w-[180px]">{m.texte_personnalise}</p>}
                    </div>
                  )}
                </div>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm truncate">{m.nom}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="text-[10px]">{supportLabel}</Badge>
                        <Badge className={`text-[10px] ${m.statut === 'valide' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                          {m.statut === 'valide' ? 'Validé' : 'Brouillon'}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  {m.client_nom && <p className="text-[10px] text-muted-foreground mt-1"><User className="inline h-3 w-3" /> {m.client_nom}</p>}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Dialog détail mockup ── */}
      {showDetail && (
        <Dialog open={!!showDetail} onOpenChange={() => setShowDetail(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>{showDetail.nom}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              {showDetail.image_base64 && (
                <div className="rounded-lg border overflow-hidden" style={{ backgroundColor: showDetail.couleur_fond }}>
                  <img src={showDetail.image_base64} alt={showDetail.nom} className="w-full max-h-[300px] object-contain p-4" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs text-muted-foreground">Support</p><p className="font-medium">{SUPPORT_TYPES.find((s) => s.value === showDetail.support)?.label || showDetail.support}</p></div>
                <div><p className="text-xs text-muted-foreground">Vue</p><p className="font-medium">{VUES.find((v) => v.value === showDetail.vue)?.label || showDetail.vue}</p></div>
                <div><p className="text-xs text-muted-foreground">Client</p><p className="font-medium">{showDetail.client_nom || '—'}</p></div>
                <div><p className="text-xs text-muted-foreground">Statut</p><Badge className={`text-[10px] ${showDetail.statut === 'valide' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{showDetail.statut === 'valide' ? 'Validé' : 'Brouillon'}</Badge></div>
              </div>
              {showDetail.texte_personnalise && (
                <div><p className="text-xs text-muted-foreground">Texte personnalisé</p><p className="text-sm">{showDetail.texte_personnalise}</p></div>
              )}
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded border" style={{ backgroundColor: showDetail.couleur_fond }} />
                  <span className="text-xs text-muted-foreground">Fond</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded border" style={{ backgroundColor: showDetail.couleur_texte }} />
                  <span className="text-xs text-muted-foreground">Texte</span>
                </div>
              </div>
              {showDetail.notes && (
                <div><p className="text-xs text-muted-foreground">Notes</p><p className="text-sm bg-muted/50 rounded-lg p-2">{showDetail.notes}</p></div>
              )}
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 gap-2" onClick={() => exportMockupPDF(showDetail)}>
                  <Download className="h-4 w-4" /> Export PDF
                </Button>
                {canWrite && showDetail.statut !== 'valide' && (
                  <Button variant="outline" className="gap-2" onClick={async () => {
                    await db.mockups.update(showDetail.id, { statut: 'valide' });
                    toast.success('Mockup validé');
                    setShowDetail(null);
                    load();
                  }}>
                    <Eye className="h-4 w-4" /> Valider
                  </Button>
                )}
                {canWrite && (
                  <Button variant="destructive" size="icon" onClick={() => handleDelete(showDetail.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Dialog création ── */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Nouveau mockup</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Nom du mockup *</label>
              <Input value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} placeholder="Ex: T-shirt Logo Entreprise X" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Support *</label>
                <Select value={form.support} onValueChange={(v) => setForm({ ...form, support: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SUPPORT_TYPES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Vue</label>
                <Select value={form.vue} onValueChange={(v) => setForm({ ...form, vue: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {VUES.map((v) => <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium flex items-center gap-1"><Palette className="h-3 w-3" /> Couleur fond</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={form.couleur_fond} onChange={(e) => setForm({ ...form, couleur_fond: e.target.value })} className="h-9 w-12 rounded border cursor-pointer" />
                  <Input value={form.couleur_fond} onChange={(e) => setForm({ ...form, couleur_fond: e.target.value })} className="flex-1" />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium flex items-center gap-1"><Palette className="h-3 w-3" /> Couleur texte</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={form.couleur_texte} onChange={(e) => setForm({ ...form, couleur_texte: e.target.value })} className="h-9 w-12 rounded border cursor-pointer" />
                  <Input value={form.couleur_texte} onChange={(e) => setForm({ ...form, couleur_texte: e.target.value })} className="flex-1" />
                </div>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">Texte personnalisé</label>
              <Input value={form.texte_personnalise} onChange={(e) => setForm({ ...form, texte_personnalise: e.target.value })} placeholder="Texte à apposer sur le support..." />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">Client associé (optionnel)</label>
              <Select value={form.client_id || '__none__'} onValueChange={(v) => {
                const cId = v === '__none__' ? '' : v;
                const cl = clients.find((c) => c.id === cId);
                setForm({ ...form, client_id: cId, client_nom: cl?.nom || '' });
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Aucun client —</SelectItem>
                  {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.nom}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">Image / Design</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageUpload}
              />
              {form.image_base64 ? (
                <div className="relative rounded-lg border overflow-hidden" style={{ backgroundColor: form.couleur_fond }}>
                  <img src={form.image_base64} alt="Preview" className="w-full max-h-[200px] object-contain p-2" />
                  <button
                    onClick={() => setForm({ ...form, image_base64: '' })}
                    className="absolute top-2 right-2 rounded-full bg-red-500 p-1 text-white hover:bg-red-600"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full rounded-lg border-2 border-dashed border-muted-foreground/25 p-6 text-center hover:bg-muted/50 transition-colors"
                >
                  <Image className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
                  <p className="text-sm text-muted-foreground">Cliquer pour uploader une image</p>
                  <p className="text-[10px] text-muted-foreground mt-1">PNG, JPG — Max 5 Mo</p>
                </button>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">Notes internes</label>
              <textarea
                className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Notes, instructions spéciales..."
              />
            </div>

            {/* Aperçu rapide */}
            {(form.texte_personnalise || form.image_base64) && (
              <div>
                <label className="mb-1.5 block text-sm font-medium">Aperçu</label>
                <div className="rounded-lg border p-4 flex items-center justify-center min-h-[100px]" style={{ backgroundColor: form.couleur_fond }}>
                  {form.image_base64 ? (
                    <img src={form.image_base64} alt="Preview" className="max-h-[80px] object-contain" />
                  ) : (
                    <p className="font-bold text-lg" style={{ color: form.couleur_texte }}>{form.texte_personnalise}</p>
                  )}
                </div>
              </div>
            )}

            <Button className="w-full" onClick={handleSubmit}>Créer le mockup</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
