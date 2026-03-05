import { useState, useEffect, useMemo } from 'react';
import { db } from '@/services/db';
import { useAuth } from '@/services/auth';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Package,
  Plus,
  Search,
  Eye,
  Edit2,
  Trash2,
  Clock,
  CheckCircle2,
  XCircle,
  Truck,
  ArrowRight,
  Phone,
  User,
} from 'lucide-react';
import { toast } from 'sonner';

const STATUTS = [
  { value: 'nouveau', label: 'Nouveau', color: 'bg-blue-100 text-blue-700', icon: Clock },
  { value: 'en_cours', label: 'En cours', color: 'bg-amber-100 text-amber-700', icon: Package },
  { value: 'pret', label: 'Prêt', color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 },
  { value: 'livre', label: 'Livré', color: 'bg-green-100 text-green-800', icon: Truck },
  { value: 'annule', label: 'Annulé', color: 'bg-red-100 text-red-700', icon: XCircle },
];

function fmt(n) {
  return new Intl.NumberFormat('fr-FR').format(n || 0);
}

function getStatut(val) {
  return STATUTS.find((s) => s.value === val) || STATUTS[0];
}

const NEXT_STATUT = { nouveau: 'en_cours', en_cours: 'pret', pret: 'livre' };

export default function Commandes() {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('commandes', 'write');
  const [commandes, setCommandes] = useState([]);
  const [clients, setClients] = useState([]);
  const [search, setSearch] = useState('');
  const [filterStatut, setFilterStatut] = useState('all');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showDetail, setShowDetail] = useState(null);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({
    client_id: '',
    client_nom: '',
    client_tel: '',
    description: '',
    date_echeance: '',
    lignes: [{ description: '', quantite: 1, prix_unitaire: 0 }],
  });

  const load = async () => {
    const [c, cl] = await Promise.all([db.commandes.list(), db.clients.list()]);
    setCommandes(c.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')));
    setClients(cl);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    return commandes
      .filter((c) =>
        (c.client_nom || '').toLowerCase().includes(search.toLowerCase()) ||
        (c.numero || '').toLowerCase().includes(search.toLowerCase()) ||
        (c.description || '').toLowerCase().includes(search.toLowerCase()),
      )
      .filter((c) => filterStatut === 'all' || c.statut === filterStatut);
  }, [commandes, search, filterStatut]);

  const stats = useMemo(() => {
    const enCours = commandes.filter((c) => c.statut === 'en_cours' || c.statut === 'nouveau').length;
    const prets = commandes.filter((c) => c.statut === 'pret').length;
    const thisMonth = commandes.filter((c) => {
      const d = c.created_at?.split('T')[0] || '';
      const monthStart = new Date().toISOString().slice(0, 7) + '-01';
      return d >= monthStart && c.statut !== 'annule';
    });
    const ca = thisMonth.reduce((s, c) => s + (c.total || 0), 0);
    return { enCours, prets, ca };
  }, [commandes]);

  const openAdd = () => {
    setEditItem(null);
    const num = `CMD-${String(commandes.length + 1).padStart(4, '0')}`;
    setForm({
      numero: num,
      client_id: '',
      client_nom: '',
      client_tel: '',
      description: '',
      date_echeance: new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0],
      lignes: [{ description: '', quantite: 1, prix_unitaire: 0 }],
    });
    setShowForm(true);
  };

  const selectClient = (id) => {
    const client = clients.find((c) => c.id === id);
    if (client) {
      setForm((f) => ({
        ...f,
        client_id: id,
        client_nom: client.nom,
        client_tel: client.telephone || '',
      }));
    }
  };

  const updateLigne = (idx, field, value) => {
    setForm((f) => {
      const lignes = [...f.lignes];
      lignes[idx] = { ...lignes[idx], [field]: value };
      return { ...f, lignes };
    });
  };

  const addLigne = () => {
    setForm((f) => ({ ...f, lignes: [...f.lignes, { description: '', quantite: 1, prix_unitaire: 0 }] }));
  };

  const removeLigne = (idx) => {
    setForm((f) => ({ ...f, lignes: f.lignes.filter((_, i) => i !== idx) }));
  };

  const getTotal = () => {
    return form.lignes.reduce((s, l) => s + (Number(l.quantite) || 0) * (Number(l.prix_unitaire) || 0), 0);
  };

  const handleSave = async () => {
    if (!form.client_nom.trim()) { toast.error('Client requis'); return; }
    if (!form.lignes.some((l) => l.description.trim())) { toast.error('Au moins une ligne requise'); return; }

    const data = {
      numero: form.numero,
      client_id: form.client_id,
      client_nom: form.client_nom.trim(),
      client_tel: form.client_tel,
      description: form.description.trim(),
      date_echeance: form.date_echeance,
      lignes: form.lignes.filter((l) => l.description.trim()),
      total: getTotal(),
      statut: editItem ? editItem.statut : 'nouveau',
    };

    if (editItem) {
      await db.commandes.update(editItem.id, data);
      toast.success('Commande modifiée');
    } else {
      await db.commandes.create(data);
      toast.success('Commande créée');
    }
    setShowForm(false);
    load();
  };

  const handleStatutChange = async (cmd, newStatut) => {
    await db.commandes.update(cmd.id, { statut: newStatut });
    toast.success(`Commande passée à "${getStatut(newStatut).label}"`);
    load();
    setShowDetail(null);
  };

  const handleDelete = async (cmd) => {
    if (!confirm(`Supprimer la commande ${cmd.numero} ?`)) return;
    await db.commandes.delete(cmd.id);
    toast.success('Commande supprimée');
    load();
  };

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
          <h2 className="text-2xl font-bold tracking-tight">Commandes</h2>
          <p className="text-muted-foreground">Suivi des commandes clients</p>
        </div>
        {canWrite && (
          <Button className="gap-2" onClick={openAdd}>
            <Plus className="h-4 w-4" /> Nouvelle commande
          </Button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">En cours</p>
            <p className="text-2xl font-bold text-amber-600">{stats.enCours}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">Prêtes</p>
            <p className="text-2xl font-bold text-emerald-600">{stats.prets}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">CA du mois</p>
            <p className="text-lg font-bold sm:text-2xl">{fmt(stats.ca)} F</p>
          </CardContent>
        </Card>
      </div>

      {/* Search + Filter */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Rechercher une commande..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={filterStatut} onValueChange={setFilterStatut}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les statuts</SelectItem>
            {STATUTS.map((s) => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Commands list */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Package className="mb-3 h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">Aucune commande trouvée</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((cmd) => {
            const statut = getStatut(cmd.statut);
            const StatutIcon = statut.icon;
            return (
              <Card key={cmd.id} className="transition-shadow hover:shadow-md">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-primary">{cmd.numero}</span>
                        <Badge className={`${statut.color} gap-1`}>
                          <StatutIcon className="h-3 w-3" />
                          {statut.label}
                        </Badge>
                      </div>
                      <p className="mt-1 font-semibold">{cmd.client_nom}</p>
                      {cmd.description && <p className="mt-0.5 truncate text-sm text-muted-foreground">{cmd.description}</p>}
                      <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                        {cmd.date_echeance && <span>Échéance : {new Date(cmd.date_echeance + 'T00:00:00').toLocaleDateString('fr-FR')}</span>}
                        <span>Créée le {new Date(cmd.created_at).toLocaleDateString('fr-FR')}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold">{fmt(cmd.total)} F</p>
                      <div className="mt-1 flex gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowDetail(cmd)}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        {canWrite && cmd.statut !== 'livre' && cmd.statut !== 'annule' && (
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(cmd)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editItem ? 'Modifier la commande' : 'Nouvelle commande'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Client</label>
              {clients.length > 0 ? (
                <Select value={form.client_id} onValueChange={selectClient}>
                  <SelectTrigger><SelectValue placeholder="Sélectionner un client..." /></SelectTrigger>
                  <SelectContent>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.nom}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={form.client_nom} onChange={(e) => setForm({ ...form, client_nom: e.target.value })} placeholder="Nom du client" />
              )}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Téléphone client</label>
              <Input value={form.client_tel} onChange={(e) => setForm({ ...form, client_tel: e.target.value })} placeholder="+241 ..." />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Description</label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Ex: 500 affiches A3 couleur" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Date d'échéance</label>
              <Input type="date" value={form.date_echeance} onChange={(e) => setForm({ ...form, date_echeance: e.target.value })} />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium">Lignes de commande</label>
                <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={addLigne}>
                  <Plus className="h-3 w-3" /> Ligne
                </Button>
              </div>
              <div className="space-y-2">
                {form.lignes.map((l, i) => (
                  <div key={i} className="flex gap-2">
                    <Input
                      className="flex-1"
                      placeholder="Description"
                      value={l.description}
                      onChange={(e) => updateLigne(i, 'description', e.target.value)}
                    />
                    <Input
                      className="w-16"
                      type="number"
                      placeholder="Qté"
                      value={l.quantite}
                      onChange={(e) => updateLigne(i, 'quantite', e.target.value)}
                    />
                    <Input
                      className="w-24"
                      type="number"
                      placeholder="Prix"
                      value={l.prix_unitaire}
                      onChange={(e) => updateLigne(i, 'prix_unitaire', e.target.value)}
                    />
                    {form.lignes.length > 1 && (
                      <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0 text-destructive" onClick={() => removeLigne(i)}>
                        <XCircle className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg bg-muted/50 p-3 text-right">
              <p className="text-sm text-muted-foreground">Total</p>
              <p className="text-2xl font-bold">{fmt(getTotal())} F</p>
            </div>

            <Button className="w-full" onClick={handleSave}>
              {editItem ? 'Enregistrer' : 'Créer la commande'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={!!showDetail} onOpenChange={() => setShowDetail(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Commande {showDetail?.numero}</DialogTitle>
          </DialogHeader>
          {showDetail && (
            <div className="space-y-4 pt-2">
              <div className="flex items-center justify-between">
                <Badge className={`${getStatut(showDetail.statut).color} gap-1`}>
                  {getStatut(showDetail.statut).label}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {new Date(showDetail.created_at).toLocaleDateString('fr-FR')}
                </span>
              </div>

              <div className="rounded-lg bg-muted/50 p-3">
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span className="font-semibold">{showDetail.client_nom}</span>
                </div>
                {showDetail.client_tel && (
                  <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                    <Phone className="h-3.5 w-3.5" />
                    {showDetail.client_tel}
                  </div>
                )}
                {showDetail.description && (
                  <p className="mt-2 text-sm">{showDetail.description}</p>
                )}
              </div>

              {showDetail.lignes?.length > 0 && (
                <div>
                  <p className="mb-2 text-sm font-medium">Détail</p>
                  <div className="space-y-1.5">
                    {showDetail.lignes.map((l, i) => (
                      <div key={i} className="flex items-center justify-between rounded bg-muted/30 px-3 py-2 text-sm">
                        <span>{l.description}</span>
                        <span className="font-medium">{l.quantite} x {fmt(l.prix_unitaire)} F</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex justify-between border-t pt-2">
                    <span className="font-semibold">Total</span>
                    <span className="text-lg font-bold">{fmt(showDetail.total)} F</span>
                  </div>
                </div>
              )}

              {canWrite && showDetail.statut !== 'livre' && showDetail.statut !== 'annule' && (
                <div className="flex gap-2">
                  {NEXT_STATUT[showDetail.statut] && (
                    <Button className="flex-1 gap-2" onClick={() => handleStatutChange(showDetail, NEXT_STATUT[showDetail.statut])}>
                      <ArrowRight className="h-4 w-4" />
                      Passer à "{getStatut(NEXT_STATUT[showDetail.statut]).label}"
                    </Button>
                  )}
                  <Button variant="destructive" size="sm" onClick={() => handleStatutChange(showDetail, 'annule')}>
                    Annuler
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
