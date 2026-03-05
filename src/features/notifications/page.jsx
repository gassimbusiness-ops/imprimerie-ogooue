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
  MessageSquare,
  Send,
  Search,
  CheckCircle2,
  Clock,
  XCircle,
  Phone,
  Zap,
  Package,
  Users,
  Bell,
} from 'lucide-react';
import { toast } from 'sonner';

const STATUT_STYLES = {
  envoye: { label: 'Envoyé', class: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 },
  en_attente: { label: 'En attente', class: 'bg-yellow-100 text-yellow-700', icon: Clock },
  echoue: { label: 'Échoué', class: 'bg-red-100 text-red-700', icon: XCircle },
};

const TEMPLATES = [
  {
    id: 'commande_prete',
    label: 'Commande prête',
    icon: Package,
    message: 'Bonjour {nom}, votre commande {ref} est prête. Vous pouvez la retirer à l\'Imprimerie Ogooué. Merci !',
  },
  {
    id: 'rappel_paiement',
    label: 'Rappel de paiement',
    icon: Bell,
    message: 'Bonjour {nom}, nous vous rappelons que votre facture {ref} d\'un montant de {montant} F est en attente de règlement. Merci.',
  },
  {
    id: 'devis_envoye',
    label: 'Devis envoyé',
    icon: MessageSquare,
    message: 'Bonjour {nom}, votre devis {ref} a été préparé. N\'hésitez pas à nous contacter pour toute question. Imprimerie Ogooué.',
  },
  {
    id: 'personnalise',
    label: 'Message personnalisé',
    icon: Send,
    message: '',
  },
];

export default function Notifications() {
  const [sms, setSms] = useState([]);
  const [clients, setClients] = useState([]);
  const [commandes, setCommandes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({
    destinataire_nom: '',
    telephone: '',
    template: 'commande_prete',
    message: '',
    reference: '',
  });

  const load = async () => {
    const [sData, cData, cmdData] = await Promise.all([
      db.sms_notifications.list(),
      db.clients.list(),
      db.commandes.list(),
    ]);
    setSms(sData.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')));
    setClients(cData);
    setCommandes(cmdData);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = sms.filter((s) =>
    `${s.destinataire_nom} ${s.telephone} ${s.message}`.toLowerCase().includes(search.toLowerCase()),
  );

  const stats = {
    total: sms.length,
    envoyes: sms.filter((s) => s.statut === 'envoye').length,
    echoues: sms.filter((s) => s.statut === 'echoue').length,
    destinataires: new Set(sms.map((s) => s.telephone)).size,
  };

  const openForm = () => {
    const tpl = TEMPLATES[0];
    setForm({
      destinataire_nom: '',
      telephone: '',
      template: tpl.id,
      message: tpl.message,
      reference: '',
    });
    setShowForm(true);
  };

  const selectTemplate = (tplId) => {
    const tpl = TEMPLATES.find((t) => t.id === tplId);
    setForm((f) => ({ ...f, template: tplId, message: tpl?.message || '' }));
  };

  const selectClient = (clientId) => {
    const cl = clients.find((c) => c.id === clientId);
    if (cl) {
      setForm((f) => ({
        ...f,
        destinataire_nom: cl.nom,
        telephone: cl.telephone || '',
        message: f.message.replace('{nom}', cl.nom),
      }));
    }
  };

  const handleSend = async () => {
    if (!form.telephone.trim() || !form.message.trim()) {
      toast.error('Téléphone et message requis');
      return;
    }

    let msg = form.message;
    if (form.reference) {
      msg = msg.replace('{ref}', form.reference);
    }
    msg = msg.replace('{nom}', form.destinataire_nom || 'Client');
    msg = msg.replace(/\{[^}]+\}/g, '___'); // clean remaining placeholders

    const data = {
      destinataire_nom: form.destinataire_nom.trim(),
      telephone: form.telephone.trim(),
      message: msg,
      template: form.template,
      statut: 'en_attente',
    };

    await db.sms_notifications.create(data);
    toast.info('SMS en cours d\'envoi...');
    setShowForm(false);

    // Simulate delivery after 2 seconds
    setTimeout(async () => {
      const all = await db.sms_notifications.list();
      const latest = all.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0];
      if (latest && latest.statut === 'en_attente') {
        const success = Math.random() > 0.1; // 90% success
        await db.sms_notifications.update(latest.id, {
          statut: success ? 'envoye' : 'echoue',
          delivered_at: success ? new Date().toISOString() : null,
        });
        if (success) {
          toast.success(`SMS envoyé à ${data.destinataire_nom || data.telephone}`);
        } else {
          toast.error(`SMS échoué vers ${data.telephone}`);
        }
        await logAction('create', 'notifications', {
          entityLabel: `SMS → ${data.telephone}`,
          details: `SMS ${success ? 'envoyé' : 'échoué'}: "${msg.slice(0, 50)}..."`,
        });
        load();
      }
    }, 2000);

    load();
  };

  // Quick send "Commande prête" to a client from commandes
  const sendCommandePrete = (cmd) => {
    const tpl = TEMPLATES.find((t) => t.id === 'commande_prete');
    setForm({
      destinataire_nom: cmd.client_nom || '',
      telephone: cmd.client_telephone || '',
      template: 'commande_prete',
      message: (tpl?.message || '').replace('{nom}', cmd.client_nom || 'Client').replace('{ref}', cmd.numero || ''),
      reference: cmd.numero || '',
    });
    setShowForm(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  // Commandes prêtes without notification sent
  const commandesPrêtes = commandes.filter((c) => c.statut === 'pret');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Notifications SMS</h2>
          <p className="text-muted-foreground">Alertes clients — Mode simulation</p>
        </div>
        <Button className="gap-2" onClick={openForm}>
          <Send className="h-4 w-4" /> Envoyer un SMS
        </Button>
      </div>

      {/* Simulation banner */}
      <div className="flex items-center gap-3 rounded-lg border border-dashed border-orange-300 bg-orange-50 p-3">
        <Zap className="h-5 w-5 shrink-0 text-orange-500" />
        <p className="text-sm text-orange-700">
          <span className="font-semibold">Mode simulation</span> — Les SMS sont simulés localement.
          En production, connecter une API SMS (Twilio, Africa's Talking, etc.).
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10">
                <MessageSquare className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total SMS</p>
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
                <p className="text-xs text-muted-foreground">Envoyés</p>
                <p className="text-lg font-bold">{stats.envoyes}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/10">
                <XCircle className="h-5 w-5 text-red-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Échoués</p>
                <p className="text-lg font-bold">{stats.echoues}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10">
                <Users className="h-5 w-5 text-violet-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Destinataires</p>
                <p className="text-lg font-bold">{stats.destinataires}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick actions: Commandes prêtes */}
      {commandesPrêtes.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Package className="h-4 w-4" />
              Commandes prêtes à notifier ({commandesPrêtes.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {commandesPrêtes.slice(0, 5).map((cmd) => (
                <div key={cmd.id} className="flex items-center justify-between rounded-lg border p-2.5">
                  <div>
                    <p className="text-sm font-medium">{cmd.numero} — {cmd.client_nom}</p>
                    <p className="text-xs text-muted-foreground">{cmd.client_telephone || 'Pas de téléphone'}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() => sendCommandePrete(cmd)}
                    disabled={!cmd.client_telephone}
                  >
                    <Send className="h-3 w-3" /> Notifier
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Rechercher dans les SMS..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* SMS history */}
      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <MessageSquare className="mb-4 h-12 w-12 text-muted-foreground/30" />
              <p className="text-muted-foreground">Aucun SMS envoyé</p>
            </div>
          ) : (
            <div className="divide-y">
              {filtered.map((s) => {
                const st = STATUT_STYLES[s.statut] || STATUT_STYLES.en_attente;
                const StatusIcon = st.icon;
                return (
                  <div key={s.id} className="px-4 py-3 hover:bg-muted/50">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
                        <MessageSquare className="h-4 w-4 text-blue-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold">{s.destinataire_nom || 'Client'}</span>
                          <span className="text-xs text-muted-foreground">{s.telephone}</span>
                          <Badge variant="outline" className={st.class}>
                            <StatusIcon className="mr-1 h-3 w-3" />
                            {st.label}
                          </Badge>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{s.message}</p>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {new Date(s.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* SMS form dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" /> Envoyer un SMS
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {/* Template selection */}
            <div>
              <label className="mb-1.5 block text-sm font-medium">Modèle de message</label>
              <div className="grid grid-cols-2 gap-2">
                {TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => selectTemplate(tpl.id)}
                    className={`flex items-center gap-2 rounded-lg border-2 p-2.5 text-left transition-all ${
                      form.template === tpl.id
                        ? 'border-primary bg-primary/5'
                        : 'border-muted hover:border-muted-foreground/30'
                    }`}
                  >
                    <tpl.icon className="h-4 w-4 shrink-0 text-primary" />
                    <span className="text-xs font-medium">{tpl.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Client select */}
            {clients.length > 0 && (
              <div>
                <label className="mb-1.5 block text-sm font-medium">Client</label>
                <Select onValueChange={selectClient}>
                  <SelectTrigger><SelectValue placeholder="Sélectionner..." /></SelectTrigger>
                  <SelectContent>
                    {clients.filter((c) => c.telephone).map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.nom} — {c.telephone}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Nom</label>
                <Input
                  value={form.destinataire_nom}
                  onChange={(e) => setForm({ ...form, destinataire_nom: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1.5 flex items-center gap-1 text-sm font-medium">
                  <Phone className="h-3.5 w-3.5" /> Téléphone
                </label>
                <Input
                  value={form.telephone}
                  onChange={(e) => setForm({ ...form, telephone: e.target.value })}
                  placeholder="+241 ..."
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">Référence (optionnel)</label>
              <Input
                value={form.reference}
                onChange={(e) => setForm({ ...form, reference: e.target.value })}
                placeholder="CMD-0001 ou FAC-0001"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">Message</label>
              <textarea
                className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                placeholder="Votre message..."
              />
              <p className="mt-1 text-xs text-muted-foreground">{form.message.length}/160 caractères</p>
            </div>

            {/* Preview */}
            <div className="rounded-lg bg-slate-900 p-3">
              <div className="flex items-center gap-2 text-xs text-slate-400 mb-2">
                <MessageSquare className="h-3 w-3" /> Aperçu SMS
              </div>
              <p className="text-sm text-white leading-relaxed">
                {(form.message || 'Votre message apparaîtra ici...')
                  .replace('{nom}', form.destinataire_nom || 'Client')
                  .replace('{ref}', form.reference || '___')
                  .replace(/\{[^}]+\}/g, '___')}
              </p>
            </div>

            <Button className="w-full gap-2" onClick={handleSend}>
              <Send className="h-4 w-4" />
              Envoyer le SMS
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
