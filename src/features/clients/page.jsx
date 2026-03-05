import { useState, useEffect, useMemo } from 'react';
import { db } from '@/services/db';
import { useAuth } from '@/services/auth';
import { logAction } from '@/services/audit';
import { Card, CardContent } from '@/components/ui/card';
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
  UserCheck,
  Search,
  Plus,
  Phone,
  Mail,
  Edit2,
  Trash2,
  Building2,
  User,
  MapPin,
  StickyNote,
  Package,
  FileText,
  MessageSquare,
} from 'lucide-react';
import { toast } from 'sonner';

function fmt(n) {
  return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0));
}

export default function Clients() {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('clients', 'write');
  const canDelete = hasPermission('clients', 'delete');
  const [clients, setClients] = useState([]);
  const [commandes, setCommandes] = useState([]);
  const [factures, setFactures] = useState([]);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [showDetail, setShowDetail] = useState(null);
  const [form, setForm] = useState({
    nom: '', email: '', telephone: '', type: 'particulier', adresse: '', notes: '',
  });

  const load = async () => {
    const [cData, cmdData, facData] = await Promise.all([
      db.clients.list(),
      db.commandes.list(),
      db.factures.list(),
    ]);
    setClients(cData);
    setCommandes(cmdData);
    setFactures(facData);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    return clients.filter((c) => {
      if (filterType !== 'all' && c.type !== filterType) return false;
      if (search) {
        const q = search.toLowerCase();
        return `${c.nom} ${c.email} ${c.telephone} ${c.adresse}`.toLowerCase().includes(q);
      }
      return true;
    });
  }, [clients, search, filterType]);

  // Client stats
  const getClientStats = (clientId, clientNom) => {
    const cmds = commandes.filter((c) => c.client_id === clientId || c.client_nom === clientNom);
    const facs = factures.filter((f) => f.client_id === clientId || f.client_nom === clientNom);
    const caTotal = facs.filter((f) => f.statut === 'payee').reduce((s, f) => s + (f.total || 0), 0);
    return { commandes: cmds.length, factures: facs.length, ca: caTotal };
  };

  const stats = useMemo(() => ({
    total: clients.length,
    entreprises: clients.filter((c) => c.type === 'entreprise').length,
    particuliers: clients.filter((c) => c.type === 'particulier').length,
    avecTelephone: clients.filter((c) => c.telephone).length,
  }), [clients]);

  const openAdd = () => {
    setEditItem(null);
    setForm({ nom: '', email: '', telephone: '', type: 'particulier', adresse: '', notes: '' });
    setShowForm(true);
  };

  const openEdit = (cl) => {
    setEditItem(cl);
    setForm({
      nom: cl.nom || '',
      email: cl.email || '',
      telephone: cl.telephone || '',
      type: cl.type || 'particulier',
      adresse: cl.adresse || '',
      notes: cl.notes || '',
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.nom.trim()) {
      toast.error('Le nom est requis');
      return;
    }

    const data = {
      nom: form.nom.trim(),
      email: form.email.trim(),
      telephone: form.telephone.trim(),
      type: form.type,
      adresse: form.adresse.trim(),
      notes: form.notes.trim(),
    };

    if (editItem) {
      await db.clients.update(editItem.id, data);
      await logAction('update', 'clients', {
        entityId: editItem.id,
        entityLabel: data.nom,
        details: `Modification client: ${data.nom}`,
      });
      toast.success('Client modifié');
    } else {
      const created = await db.clients.create(data);
      await logAction('create', 'clients', {
        entityId: created.id,
        entityLabel: data.nom,
        details: `Nouveau client: ${data.nom}`,
      });
      toast.success('Client ajouté');
    }
    setShowForm(false);
    load();
  };

  const handleDelete = async (cl) => {
    if (!confirm(`Supprimer le client "${cl.nom}" ?`)) return;
    await db.clients.delete(cl.id);
    await logAction('delete', 'clients', {
      entityId: cl.id,
      entityLabel: cl.nom,
      details: `Suppression client: ${cl.nom}`,
    });
    toast.success('Client supprimé');
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
          <h2 className="text-2xl font-bold tracking-tight">Clients</h2>
          <p className="text-muted-foreground">CRM — {stats.total} clients, {stats.avecTelephone} avec téléphone</p>
        </div>
        {canWrite && (
          <Button className="gap-2" onClick={openAdd}>
            <Plus className="h-4 w-4" /> Nouveau client
          </Button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                <UserCheck className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Total</p>
                <p className="text-base font-bold">{stats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10">
                <Building2 className="h-4 w-4 text-blue-600" />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Entreprises</p>
                <p className="text-base font-bold">{stats.entreprises}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10">
                <User className="h-4 w-4 text-violet-600" />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Particuliers</p>
                <p className="text-base font-bold">{stats.particuliers}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10">
                <Phone className="h-4 w-4 text-emerald-600" />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Avec tél.</p>
                <p className="text-base font-bold">{stats.avecTelephone}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search + filter */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Rechercher par nom, email, téléphone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les types</SelectItem>
            <SelectItem value="entreprise">Entreprises</SelectItem>
            <SelectItem value="particulier">Particuliers</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Client grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((c) => {
          const cStats = getClientStats(c.id, c.nom);
          return (
            <Card
              key={c.id}
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => canWrite ? openEdit(c) : setShowDetail(c)}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${c.type === 'entreprise' ? 'bg-blue-500/10' : 'bg-violet-500/10'}`}>
                    {c.type === 'entreprise' ? (
                      <Building2 className="h-5 w-5 text-blue-600" />
                    ) : (
                      <User className="h-5 w-5 text-violet-600" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-semibold">{c.nom}</p>
                      {canWrite && <Edit2 className="h-3 w-3 shrink-0 text-muted-foreground/40" />}
                    </div>
                    <Badge variant="outline" className="mt-1 text-[10px]">
                      {c.type === 'entreprise' ? 'Entreprise' : 'Particulier'}
                    </Badge>
                  </div>
                </div>

                <div className="mt-3 space-y-1 border-t pt-3">
                  {c.telephone && (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Phone className="h-3 w-3 shrink-0" /> {c.telephone}
                    </p>
                  )}
                  {c.email && (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground truncate">
                      <Mail className="h-3 w-3 shrink-0" /> {c.email}
                    </p>
                  )}
                  {c.adresse && (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground truncate">
                      <MapPin className="h-3 w-3 shrink-0" /> {c.adresse}
                    </p>
                  )}
                </div>

                {/* Mini stats */}
                {(cStats.commandes > 0 || cStats.factures > 0) && (
                  <div className="mt-2 flex items-center gap-3 border-t pt-2">
                    {cStats.commandes > 0 && (
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Package className="h-3 w-3" /> {cStats.commandes} cmd
                      </span>
                    )}
                    {cStats.factures > 0 && (
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <FileText className="h-3 w-3" /> {cStats.factures} fac
                      </span>
                    )}
                    {cStats.ca > 0 && (
                      <span className="ml-auto text-[10px] font-semibold text-emerald-600">
                        {fmt(cStats.ca)} F
                      </span>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16">
          <UserCheck className="mb-4 h-12 w-12 text-muted-foreground/30" />
          <p className="text-muted-foreground">Aucun client trouvé</p>
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editItem ? 'Modifier le client' : 'Nouveau client'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Nom / Raison sociale</label>
              <Input
                value={form.nom}
                onChange={(e) => setForm({ ...form, nom: e.target.value })}
                placeholder="Nom du client"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">Type</label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="particulier">Particulier</SelectItem>
                  <SelectItem value="entreprise">Entreprise</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="mb-1.5 flex items-center gap-1 text-sm font-medium">
                <Phone className="h-3.5 w-3.5" /> Téléphone
              </label>
              <Input
                value={form.telephone}
                onChange={(e) => setForm({ ...form, telephone: e.target.value })}
                placeholder="+241 077 XX XX XX"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                Enregistré automatiquement pour les paiements Mobile Money et notifications SMS
              </p>
            </div>

            <div>
              <label className="mb-1.5 flex items-center gap-1 text-sm font-medium">
                <Mail className="h-3.5 w-3.5" /> Email
              </label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="email@exemple.com"
              />
            </div>

            <div>
              <label className="mb-1.5 flex items-center gap-1 text-sm font-medium">
                <MapPin className="h-3.5 w-3.5" /> Adresse
              </label>
              <Input
                value={form.adresse}
                onChange={(e) => setForm({ ...form, adresse: e.target.value })}
                placeholder="Libreville, Gabon"
              />
            </div>

            <div>
              <label className="mb-1.5 flex items-center gap-1 text-sm font-medium">
                <StickyNote className="h-3.5 w-3.5" /> Notes
              </label>
              <textarea
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Notes internes sur ce client..."
              />
            </div>

            <div className="flex gap-3">
              <Button className="flex-1" onClick={handleSave}>
                {editItem ? 'Enregistrer' : 'Ajouter'}
              </Button>
              {editItem && canDelete && (
                <Button
                  variant="destructive"
                  onClick={() => { handleDelete(editItem); setShowForm(false); }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
