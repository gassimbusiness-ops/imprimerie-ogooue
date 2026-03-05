import { useState, useEffect } from 'react';
import { db } from '@/services/db';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Smartphone,
  Plus,
  Search,
  CheckCircle2,
  Clock,
  XCircle,
  Wallet,
  ArrowUpRight,
  Phone,
  CreditCard,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';

function fmt(n) {
  return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0));
}

const PROVIDERS = [
  { id: 'airtel_money', name: 'Airtel Money', color: 'bg-red-500', logo: '🔴' },
  { id: 'moov_money', name: 'Moov Money', color: 'bg-blue-600', logo: '🔵' },
];

const STATUT_STYLES = {
  en_attente: { label: 'En attente', class: 'bg-yellow-100 text-yellow-700', icon: Clock },
  confirme: { label: 'Confirmé', class: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 },
  echoue: { label: 'Échoué', class: 'bg-red-100 text-red-700', icon: XCircle },
};

export default function Paiements() {
  const [paiements, setPaiements] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({
    client_nom: '',
    telephone: '',
    montant: '',
    provider: 'airtel_money',
    reference_commande: '',
    motif: '',
  });

  const load = async () => {
    const [pData, cData] = await Promise.all([
      db.paiements_mobile.list(),
      db.clients.list(),
    ]);
    setPaiements(pData.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')));
    setClients(cData);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = paiements.filter((p) =>
    `${p.client_nom} ${p.telephone} ${p.reference}`.toLowerCase().includes(search.toLowerCase()),
  );

  const stats = {
    total: paiements.length,
    confirmes: paiements.filter((p) => p.statut === 'confirme').length,
    montantTotal: paiements.filter((p) => p.statut === 'confirme').reduce((s, p) => s + (p.montant || 0), 0),
    enAttente: paiements.filter((p) => p.statut === 'en_attente').length,
  };

  const openForm = () => {
    setForm({ client_nom: '', telephone: '', montant: '', provider: 'airtel_money', reference_commande: '', motif: '' });
    setShowForm(true);
  };

  const selectClient = (clientId) => {
    const cl = clients.find((c) => c.id === clientId);
    if (cl) {
      setForm((f) => ({ ...f, client_nom: cl.nom, telephone: cl.telephone || '' }));
    }
  };

  const handleSubmit = async () => {
    if (!form.telephone.trim() || !form.montant) {
      toast.error('Téléphone et montant requis');
      return;
    }

    const ref = `PAY-${String(paiements.length + 1).padStart(4, '0')}`;
    const provider = PROVIDERS.find((p) => p.id === form.provider);
    const data = {
      reference: ref,
      client_nom: form.client_nom.trim(),
      telephone: form.telephone.trim(),
      montant: parseFloat(form.montant),
      provider: form.provider,
      provider_nom: provider?.name || form.provider,
      reference_commande: form.reference_commande.trim(),
      motif: form.motif.trim() || 'Paiement commande',
      statut: 'en_attente',
      transaction_id: `TXN${Date.now()}`,
    };

    await db.paiements_mobile.create(data);
    await logAction('create', 'paiements', {
      entityLabel: ref,
      details: `Paiement ${provider?.name}: ${fmt(data.montant)} F → ${data.telephone}`,
      metadata: data,
    });
    toast.success(`Paiement ${ref} initié — En attente de confirmation`);
    setShowForm(false);
    load();

    // Simulate confirmation after 3 seconds
    setTimeout(async () => {
      const all = await db.paiements_mobile.list();
      const found = all.find((p) => p.reference === ref);
      if (found && found.statut === 'en_attente') {
        const success = Math.random() > 0.15; // 85% success rate
        await db.paiements_mobile.update(found.id, {
          statut: success ? 'confirme' : 'echoue',
          confirmed_at: new Date().toISOString(),
        });
        if (success) {
          toast.success(`${ref} confirmé par ${provider?.name}`);
        } else {
          toast.error(`${ref} échoué — Fonds insuffisants`);
        }
        load();
      }
    }, 3000);
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
          <h2 className="text-2xl font-bold tracking-tight">Paiements Mobile Money</h2>
          <p className="text-muted-foreground">Airtel Money & Moov Money — Mode simulation</p>
        </div>
        <Button className="gap-2" onClick={openForm}>
          <Plus className="h-4 w-4" /> Nouveau paiement
        </Button>
      </div>

      {/* Simulation banner */}
      <div className="flex items-center gap-3 rounded-lg border border-dashed border-orange-300 bg-orange-50 p-3">
        <Zap className="h-5 w-5 shrink-0 text-orange-500" />
        <p className="text-sm text-orange-700">
          <span className="font-semibold">Mode simulation</span> — Les paiements sont simulés localement.
          En production, connecter l'API Bizao/PaySika pour les transactions réelles.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10">
                <CreditCard className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total paiements</p>
                <p className="text-lg font-bold">{stats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Confirmés</p>
                <p className="text-lg font-bold">{stats.confirmes}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10">
                <Wallet className="h-5 w-5 text-violet-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Montant reçu</p>
                <p className="text-lg font-bold">{fmt(stats.montantTotal)} F</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-yellow-500/10">
                <Clock className="h-5 w-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">En attente</p>
                <p className="text-lg font-bold">{stats.enAttente}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Rechercher un paiement..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Payments list */}
      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Smartphone className="mb-4 h-12 w-12 text-muted-foreground/30" />
              <p className="text-muted-foreground">Aucun paiement enregistré</p>
              <p className="mt-1 text-sm text-muted-foreground/70">Cliquez sur "Nouveau paiement" pour commencer</p>
            </div>
          ) : (
            <div className="divide-y">
              {filtered.map((p) => {
                const st = STATUT_STYLES[p.statut] || STATUT_STYLES.en_attente;
                const StatusIcon = st.icon;
                const provider = PROVIDERS.find((pr) => pr.id === p.provider);
                return (
                  <div key={p.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-xl text-white text-lg ${provider?.color || 'bg-slate-500'}`}>
                      {provider?.logo || '💳'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{p.reference}</span>
                        <Badge variant="outline" className={st.class}>
                          <StatusIcon className="mr-1 h-3 w-3" />
                          {st.label}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {p.client_nom || 'Client'} — {p.telephone}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold">{fmt(p.montant)} F</p>
                      <p className="text-[10px] text-muted-foreground">{provider?.name}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payment form dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Smartphone className="h-5 w-5" /> Nouveau paiement Mobile Money
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {/* Provider selection */}
            <div>
              <label className="mb-1.5 block text-sm font-medium">Opérateur</label>
              <div className="grid grid-cols-2 gap-2">
                {PROVIDERS.map((pr) => (
                  <button
                    key={pr.id}
                    type="button"
                    onClick={() => setForm({ ...form, provider: pr.id })}
                    className={`flex items-center gap-2 rounded-lg border-2 p-3 transition-all ${
                      form.provider === pr.id
                        ? 'border-primary bg-primary/5'
                        : 'border-muted hover:border-muted-foreground/30'
                    }`}
                  >
                    <span className="text-xl">{pr.logo}</span>
                    <span className="text-sm font-medium">{pr.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Client quick select */}
            {clients.length > 0 && (
              <div>
                <label className="mb-1.5 block text-sm font-medium">Client existant</label>
                <Select onValueChange={selectClient}>
                  <SelectTrigger><SelectValue placeholder="Sélectionner un client..." /></SelectTrigger>
                  <SelectContent>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.nom}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-sm font-medium">Nom du client</label>
              <Input
                value={form.client_nom}
                onChange={(e) => setForm({ ...form, client_nom: e.target.value })}
                placeholder="Nom ou raison sociale"
              />
            </div>

            <div>
              <label className="mb-1.5 flex items-center gap-1 text-sm font-medium">
                <Phone className="h-3.5 w-3.5" /> Numéro de téléphone
              </label>
              <Input
                value={form.telephone}
                onChange={(e) => setForm({ ...form, telephone: e.target.value })}
                placeholder="+241 077 XX XX XX"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">Montant (F CFA)</label>
              <Input
                type="number"
                min="100"
                value={form.montant}
                onChange={(e) => setForm({ ...form, montant: e.target.value })}
                placeholder="0"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">Réf. commande (optionnel)</label>
              <Input
                value={form.reference_commande}
                onChange={(e) => setForm({ ...form, reference_commande: e.target.value })}
                placeholder="CMD-0001"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">Motif</label>
              <Input
                value={form.motif}
                onChange={(e) => setForm({ ...form, motif: e.target.value })}
                placeholder="Paiement commande"
              />
            </div>

            {/* Amount preview */}
            {form.montant && (
              <div className="rounded-lg border-2 border-dashed p-3 text-center">
                <p className="text-xs text-muted-foreground">Montant à encaisser</p>
                <p className="text-2xl font-bold">{fmt(parseFloat(form.montant || 0))} F CFA</p>
                <p className="text-xs text-muted-foreground mt-1">
                  via {PROVIDERS.find((p) => p.id === form.provider)?.name}
                </p>
              </div>
            )}

            <Button className="w-full gap-2" onClick={handleSubmit}>
              <ArrowUpRight className="h-4 w-4" />
              Initier le paiement
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
