import { useState, useEffect, useMemo } from 'react';
import { db } from '@/services/db';
import { useAuth } from '@/services/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
  Trash2,
  Clock,
  CheckCircle2,
  XCircle,
  Truck,
  ArrowRight,
  Phone,
  User,
  Printer,
  ShieldCheck,
  MessageSquare,
  StickyNote,
  History,
  Bell,
  CreditCard,
} from 'lucide-react';
import { toast } from 'sonner';

// ── Statuts enrichis BLOC 5 ──
const STATUTS = [
  { value: 'en_attente_validation', label: 'En attente de validation', color: 'bg-amber-100 text-amber-700', icon: Clock },
  { value: 'validee_attente_paiement', label: 'Validée — Attente paiement', color: 'bg-emerald-100 text-emerald-700', icon: CreditCard },
  { value: 'en_production', label: 'En production', color: 'bg-blue-100 text-blue-700', icon: Printer },
  { value: 'prete', label: 'Prête', color: 'bg-violet-100 text-violet-700', icon: Package },
  { value: 'livree', label: 'Livrée', color: 'bg-green-100 text-green-800', icon: Truck },
  { value: 'annulee', label: 'Annulée', color: 'bg-red-100 text-red-700', icon: XCircle },
];

// Backward-compatible mapping for old statuses
const STATUT_ALIASES = {
  nouveau: 'en_attente_validation',
  en_attente: 'en_attente_validation',
  en_cours: 'en_production',
  pret: 'prete',
  livre: 'livree',
  annule: 'annulee',
};

function normalizeStatut(val) {
  return STATUT_ALIASES[val] || val || 'en_attente_validation';
}

function fmt(n) {
  return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0));
}

function getStatut(val) {
  const normalized = normalizeStatut(val);
  return STATUTS.find((s) => s.value === normalized) || STATUTS[0];
}

// Flow: en_attente_validation → validee_attente_paiement → en_production → prete → livree
const NEXT_STATUT = {
  en_attente_validation: 'validee_attente_paiement',
  validee_attente_paiement: 'en_production',
  en_production: 'prete',
  prete: 'livree',
  // Legacy support
  nouveau: 'validee_attente_paiement',
  en_attente: 'validee_attente_paiement',
  en_cours: 'prete',
  pret: 'livree',
};

// Messages de notification client par statut
const NOTIF_CLIENT_MESSAGES = {
  validee_attente_paiement: {
    titre: '✅ Commande validée',
    message: 'Votre commande a été validée ! Elle est en attente de paiement.',
  },
  en_production: {
    titre: '🖨️ En production',
    message: 'Votre commande est en cours de production !',
  },
  prete: {
    titre: '📦 Commande prête',
    message: 'Votre commande est prête à être récupérée !',
  },
  livree: {
    titre: '🎉 Commande livrée',
    message: 'Commande livrée ! Merci de votre confiance.',
  },
  annulee: {
    titre: '❌ Commande annulée',
    message: 'Votre commande a été annulée. Contactez-nous pour plus d\'informations.',
  },
};

export default function Commandes() {
  const { hasPermission, user: currentUser } = useAuth();
  const canWrite = hasPermission('commandes', 'write');
  const [commandes, setCommandes] = useState([]);
  const [clients, setClients] = useState([]);
  const [search, setSearch] = useState('');
  const [filterStatut, setFilterStatut] = useState('all');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showDetail, setShowDetail] = useState(null);
  const [editItem, setEditItem] = useState(null);
  const [commentaireClient, setCommentaireClient] = useState('');
  const [noteInterne, setNoteInterne] = useState('');
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
      .filter((c) => {
        if (filterStatut === 'all') return true;
        const norm = normalizeStatut(c.statut);
        return norm === filterStatut;
      });
  }, [commandes, search, filterStatut]);

  const stats = useMemo(() => {
    const enAttente = commandes.filter((c) => {
      const n = normalizeStatut(c.statut);
      return n === 'en_attente_validation';
    }).length;
    const enProd = commandes.filter((c) => {
      const n = normalizeStatut(c.statut);
      return n === 'en_production' || n === 'validee_attente_paiement';
    }).length;
    const pretes = commandes.filter((c) => normalizeStatut(c.statut) === 'prete').length;
    const thisMonth = commandes.filter((c) => {
      const d = c.created_at?.split('T')[0] || '';
      const monthStart = new Date().toISOString().slice(0, 7) + '-01';
      const norm = normalizeStatut(c.statut);
      return d >= monthStart && norm !== 'annulee';
    });
    const ca = thisMonth.reduce((s, c) => s + (c.montant_total || c.total || 0), 0);
    return { enAttente, enProd, pretes, ca };
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
      montant_total: getTotal(),
      statut: editItem ? editItem.statut : 'en_attente_validation',
      historique_statuts: editItem?.historique_statuts || [
        { statut: 'en_attente_validation', date: new Date().toISOString(), auteur: `${currentUser?.prenom} ${currentUser?.nom}` },
      ],
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

  // ── Changement de statut avec notification client ──
  const handleStatutChange = async (cmd, newStatut) => {
    const auteur = `${currentUser?.prenom || ''} ${currentUser?.nom || ''}`.trim();
    const historique = [...(cmd.historique_statuts || []), {
      statut: newStatut,
      date: new Date().toISOString(),
      auteur,
    }];

    await db.commandes.update(cmd.id, {
      statut: newStatut,
      historique_statuts: historique,
    });

    // Envoyer notification au client
    const notifConfig = NOTIF_CLIENT_MESSAGES[newStatut];
    if (notifConfig && cmd.client_id) {
      await db.notifications_app.create({
        type: 'statut_commande',
        titre: notifConfig.titre,
        message: `${notifConfig.message}\nCommande : ${cmd.numero || 'CMD'}`,
        lien: '/client/commandes',
        commande_id: cmd.id,
        destinataire: 'client',
        destinataire_id: cmd.client_id,
        lu: false,
      });
    }

    toast.success(`Commande passée à "${getStatut(newStatut).label}"`);
    load();
    // Refresh detail
    const updated = await db.commandes.getById(cmd.id);
    if (updated) setShowDetail(updated);
  };

  // ── Valider la commande + créditer points fidélité ──
  const handleValider = async (cmd) => {
    await handleStatutChange(cmd, 'validee_attente_paiement');

    // Credit fidelity points
    if (cmd.client_id) {
      try {
        const allFidelite = await db.fidelite_clients.list();
        const fidelite = allFidelite.find((f) => f.client_id === cmd.client_id);
        if (fidelite) {
          const montant = cmd.montant_total || cmd.total || 0;
          const pointsCommande = Math.floor(montant / 1000) * 10; // 10 pts par 1000 FCFA
          // Check if first order for bonus
          const allCmds = await db.commandes.list();
          const clientCmds = allCmds.filter((c) => c.client_id === cmd.client_id && c.id !== cmd.id && normalizeStatut(c.statut) !== 'annulee');
          const isFirstOrder = clientCmds.length === 0;
          const bonusPremiere = isFirstOrder ? 100 : 0;
          const totalPoints = pointsCommande + bonusPremiere;

          if (totalPoints > 0) {
            const newTotal = (fidelite.points_actuels || 0) + totalPoints;
            const newTotalGagnes = (fidelite.total_points_gagnes || 0) + totalPoints;
            // Determine level
            let niveau = 'bronze';
            if (newTotalGagnes >= 5000) niveau = 'platine';
            else if (newTotalGagnes >= 2000) niveau = 'or';
            else if (newTotalGagnes >= 500) niveau = 'argent';

            const hist = [...(fidelite.historique || [])];
            if (bonusPremiere > 0) {
              hist.push({ type: 'premiere_commande', points: 100, description: 'Bonus première commande', date: new Date().toISOString() });
            }
            if (pointsCommande > 0) {
              hist.push({ type: 'commande', points: pointsCommande, description: `Commande ${cmd.numero || 'CMD'} — ${fmt(montant)} F`, date: new Date().toISOString() });
            }

            await db.fidelite_clients.update(fidelite.id, {
              points_actuels: newTotal,
              total_points_gagnes: newTotalGagnes,
              niveau,
              historique: hist,
            });

            // Check parrainage bonus (if sponsored and first order)
            if (isFirstOrder) {
              const employes = await db.employes.list();
              const client = employes.find((e) => e.id === cmd.client_id);
              if (client?.parraine_par) {
                const parrain = employes.find((e) => e.code_parrainage === client.parraine_par);
                if (parrain) {
                  const parrainFid = allFidelite.find((f) => f.client_id === parrain.id);
                  if (parrainFid) {
                    await db.fidelite_clients.update(parrainFid.id, {
                      points_actuels: (parrainFid.points_actuels || 0) + 200,
                      total_points_gagnes: (parrainFid.total_points_gagnes || 0) + 200,
                      historique: [...(parrainFid.historique || []), {
                        type: 'parrainage_valide',
                        points: 200,
                        description: `Parrainage validé — ${cmd.client_nom}`,
                        date: new Date().toISOString(),
                      }],
                    });
                    await db.notifications_app.create({
                      type: 'parrainage_bonus',
                      titre: '🎁 +200 points parrainage !',
                      message: `${cmd.client_nom} a passé sa première commande. Vous gagnez 200 points de fidélité !`,
                      destinataire: 'client',
                      destinataire_id: parrain.id,
                      lu: false,
                    });
                  }
                }
              }
            }
          }
        }
      } catch (err) {
        console.error('Fidelity error:', err);
      }
    }
  };

  // ── Annuler la commande ──
  const handleAnnuler = async (cmd) => {
    if (!confirm('Êtes-vous sûr de vouloir annuler cette commande ?')) return;
    await handleStatutChange(cmd, 'annulee');
  };

  // ── Sauvegarder commentaire/note ──
  const handleSaveComments = async (cmd) => {
    await db.commandes.update(cmd.id, {
      commentaire_client: commentaireClient,
      note_interne: noteInterne,
    });
    toast.success('Commentaires enregistrés');
    const updated = await db.commandes.getById(cmd.id);
    if (updated) setShowDetail(updated);
    load();
  };

  const handleDelete = async (cmd) => {
    if (!confirm(`Supprimer la commande ${cmd.numero} ?`)) return;
    await db.commandes.delete(cmd.id);
    toast.success('Commande supprimée');
    load();
  };

  // Open detail view
  const openDetail = (cmd) => {
    setShowDetail(cmd);
    setCommentaireClient(cmd.commentaire_client || '');
    setNoteInterne(cmd.note_interne || '');
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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">En attente</p>
            <p className="text-2xl font-bold text-amber-600">{stats.enAttente}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">En cours</p>
            <p className="text-2xl font-bold text-blue-600">{stats.enProd}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">Prêtes</p>
            <p className="text-2xl font-bold text-emerald-600">{stats.pretes}</p>
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
          <SelectTrigger className="w-full sm:w-[220px]">
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
            const normalized = normalizeStatut(cmd.statut);
            const isNew = normalized === 'en_attente_validation';
            return (
              <Card key={cmd.id} className={`transition-shadow hover:shadow-md ${isNew ? 'border-amber-300 border-2' : ''}`}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-primary">{cmd.numero}</span>
                        <Badge className={`${statut.color} gap-1`}>
                          <StatutIcon className="h-3 w-3" />
                          {statut.label}
                        </Badge>
                        {isNew && <Badge className="bg-amber-500 text-white text-[9px] animate-pulse">NOUVEAU</Badge>}
                        {cmd.source === 'portail_client' && (
                          <Badge variant="outline" className="text-[9px] border-blue-200 text-blue-600">Portail Client</Badge>
                        )}
                      </div>
                      <p className="mt-1 font-semibold">{cmd.client_nom}</p>
                      {cmd.client_tel && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          <a href={`tel:${cmd.client_tel}`} className="hover:underline">{cmd.client_tel}</a>
                        </p>
                      )}
                      {cmd.description && <p className="mt-0.5 truncate text-sm text-muted-foreground">{cmd.description}</p>}
                      {/* Mini product preview */}
                      {cmd.lignes && cmd.lignes.length > 0 && (
                        <div className="mt-1.5 flex items-center gap-1">
                          {cmd.lignes.slice(0, 3).map((l, i) => (
                            l.image ? (
                              <img key={i} src={l.image} alt="" className="h-6 w-6 rounded object-cover border" />
                            ) : null
                          ))}
                          <span className="text-xs text-muted-foreground">
                            {cmd.lignes.length} article{cmd.lignes.length > 1 ? 's' : ''}
                          </span>
                        </div>
                      )}
                      <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                        {cmd.date_echeance && <span>Échéance : {new Date(cmd.date_echeance + 'T00:00:00').toLocaleDateString('fr-FR')}</span>}
                        <span>Créée le {new Date(cmd.created_at).toLocaleDateString('fr-FR')}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-lg font-bold">{fmt(cmd.montant_total || cmd.total)} F</p>
                      <div className="mt-1 flex gap-1 justify-end">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openDetail(cmd)}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        {canWrite && normalized !== 'livree' && normalized !== 'annulee' && (
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
                <Select value={form.client_id || undefined} onValueChange={selectClient}>
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

      {/* Detail Dialog — Enhanced BLOC 5 */}
      <Dialog open={!!showDetail} onOpenChange={() => setShowDetail(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Commande {showDetail?.numero}
              {showDetail?.source === 'portail_client' && (
                <Badge variant="outline" className="text-[10px] border-blue-200 text-blue-600">Portail Client</Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          {showDetail && (() => {
            const normalized = normalizeStatut(showDetail.statut);
            const statut = getStatut(showDetail.statut);
            const isTerminal = normalized === 'livree' || normalized === 'annulee';
            return (
              <div className="space-y-4 pt-2">
                {/* Statut + Date */}
                <div className="flex items-center justify-between">
                  <Badge className={`${statut.color} gap-1 text-sm px-3 py-1`}>
                    <statut.icon className="h-4 w-4" />
                    {statut.label}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {new Date(showDetail.created_at).toLocaleDateString('fr-FR')}
                  </span>
                </div>

                {/* Client info */}
                <div className="rounded-lg bg-muted/50 p-3">
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span className="font-semibold">{showDetail.client_nom}</span>
                  </div>
                  {showDetail.client_tel && (
                    <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                      <Phone className="h-3.5 w-3.5" />
                      <a href={`tel:${showDetail.client_tel}`} className="text-primary hover:underline">{showDetail.client_tel}</a>
                    </div>
                  )}
                  {showDetail.client_email && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{showDetail.client_email}</p>
                  )}
                  {showDetail.description && (
                    <p className="mt-2 text-sm">{showDetail.description}</p>
                  )}
                </div>

                {/* Produits commandés avec images */}
                {showDetail.lignes?.length > 0 && (
                  <div>
                    <p className="mb-2 text-sm font-medium flex items-center gap-1.5">
                      <Package className="h-4 w-4 text-muted-foreground" />
                      Produits commandés
                    </p>
                    <div className="space-y-2">
                      {showDetail.lignes.map((l, i) => (
                        <div key={i} className="flex items-center gap-3 rounded-lg bg-muted/30 px-3 py-2">
                          {l.image && (
                            <img src={l.image} alt="" className="h-10 w-10 rounded object-cover border shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{l.nom || l.description}</p>
                            <p className="text-xs text-muted-foreground">
                              {l.qte || l.quantite} x {fmt(l.prix || l.prix_unitaire || 0)} F
                            </p>
                          </div>
                          <span className="text-sm font-semibold shrink-0">
                            {fmt((l.prix || l.prix_unitaire || 0) * (l.qte || l.quantite || 1))} F
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 flex justify-between border-t pt-2">
                      <span className="font-semibold">Total</span>
                      <span className="text-lg font-bold">{fmt(showDetail.montant_total || showDetail.total)} F</span>
                    </div>
                  </div>
                )}

                {/* Commentaire pour le client */}
                {canWrite && (
                  <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
                      <MessageSquare className="h-3.5 w-3.5 text-blue-500" />
                      Commentaire pour le client
                      <span className="text-[10px] text-muted-foreground">(visible par le client)</span>
                    </label>
                    <Textarea
                      placeholder="Message visible par le client après validation..."
                      value={commentaireClient}
                      onChange={(e) => setCommentaireClient(e.target.value)}
                      className="text-sm"
                      rows={2}
                    />
                  </div>
                )}

                {/* Note interne */}
                {canWrite && (
                  <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
                      <StickyNote className="h-3.5 w-3.5 text-amber-500" />
                      Note interne
                      <span className="text-[10px] text-muted-foreground">(non visible par le client)</span>
                    </label>
                    <Textarea
                      placeholder="Notes internes, instructions pour l'équipe..."
                      value={noteInterne}
                      onChange={(e) => setNoteInterne(e.target.value)}
                      className="text-sm"
                      rows={2}
                    />
                  </div>
                )}

                {canWrite && (commentaireClient !== (showDetail.commentaire_client || '') || noteInterne !== (showDetail.note_interne || '')) && (
                  <Button variant="outline" className="w-full gap-1.5 text-sm" onClick={() => handleSaveComments(showDetail)}>
                    💾 Enregistrer les commentaires
                  </Button>
                )}

                {/* Historique des statuts */}
                {showDetail.historique_statuts && showDetail.historique_statuts.length > 0 && (
                  <div>
                    <p className="mb-2 text-sm font-medium flex items-center gap-1.5">
                      <History className="h-4 w-4 text-muted-foreground" />
                      Historique
                    </p>
                    <div className="space-y-1.5">
                      {showDetail.historique_statuts.map((h, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <div className="h-2 w-2 rounded-full bg-primary shrink-0" />
                          <span className="font-medium">{getStatut(h.statut).label}</span>
                          <span className="text-muted-foreground">—</span>
                          <span className="text-muted-foreground">
                            {new Date(h.date).toLocaleDateString('fr-FR')} à {new Date(h.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {h.auteur && <span className="text-muted-foreground italic">par {h.auteur}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Action buttons */}
                {canWrite && !isTerminal && (
                  <div className="flex gap-2 pt-2 border-t">
                    {/* Bouton Valider (pour en_attente_validation) */}
                    {normalized === 'en_attente_validation' && (
                      <Button className="flex-1 gap-2 bg-emerald-600 hover:bg-emerald-700" onClick={() => handleValider(showDetail)}>
                        <ShieldCheck className="h-4 w-4" />
                        Valider la commande
                      </Button>
                    )}
                    {/* Bouton progression (pour les autres statuts) */}
                    {normalized !== 'en_attente_validation' && NEXT_STATUT[normalized] && (
                      <Button className="flex-1 gap-2" onClick={() => handleStatutChange(showDetail, NEXT_STATUT[normalized])}>
                        <ArrowRight className="h-4 w-4" />
                        Passer à "{getStatut(NEXT_STATUT[normalized]).label}"
                      </Button>
                    )}
                    <Button variant="destructive" className="gap-1.5" onClick={() => handleAnnuler(showDetail)}>
                      <XCircle className="h-4 w-4" />
                      Annuler
                    </Button>
                  </div>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
