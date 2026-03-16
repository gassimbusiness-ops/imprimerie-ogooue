import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { db } from '@/services/db';
import { supabase, USE_SUPABASE } from '@/services/supabase';
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
  Factory,
  FileText,
} from 'lucide-react';
import { toast } from 'sonner';
import { calculerPoints, getBonusEvenement, determinerNiveau, BONUS_PARRAINAGE } from '@/services/fidelite';
import {
  notifyNouvelleCommande,
  notifyCommandeValidee,
  notifyCommandeProduction,
  notifyCommandePrete,
  notifyCommandeLivree,
  notifyFactureDisponible,
} from '@/services/notifications';
import { syncClientFromCommande } from '@/services/sync-clients';
import { syncCommandeToRapport } from '@/services/sync-commande-rapport';
import { syncStockFromCommande } from '@/services/sync-stock-commande';

// ── Statuts enrichis BLOC 5 ──
const STATUTS = [
  { value: 'en_attente_validation', label: 'En attente de validation', color: 'bg-amber-100 text-amber-700', icon: Clock },
  { value: 'validee_attente_paiement', label: 'Validée — Attente paiement', color: 'bg-emerald-100 text-emerald-700', icon: CreditCard },
  { value: 'paiement_initie', label: 'Paiement Mobile Money initié', color: 'bg-yellow-100 text-yellow-700', icon: CreditCard },
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

// Flow: en_attente_validation → validee_attente_paiement → [paiement_initie] → en_production → prete → livree
const NEXT_STATUT = {
  en_attente_validation: 'validee_attente_paiement',
  validee_attente_paiement: 'en_production',
  paiement_initie: 'en_production',
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
  const { hasPermission, user: currentUser, isAdmin, isManager } = useAuth();
  const isEmploye = currentUser?.role === 'employe';
  const canWrite = hasPermission('commandes', 'write'); // Employé peut aussi créer (commande comptoir)
  const canWriteAdmin = isAdmin || isManager; // Seuls admin/manager modifient prix, suppriment, etc.
  const canChangeStatut = isAdmin || isManager || isEmploye;
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
  const showDetailRef = useRef(null);
  const [form, setForm] = useState({
    client_id: '',
    client_nom: '',
    client_tel: '',
    description: '',
    date_echeance: '',
    lignes: [{ description: '', quantite: 1, prix_unitaire: 0 }],
  });

  const load = useCallback(async () => {
    const [c, cl] = await Promise.all([db.commandes.list(), db.clients.list()]);
    setCommandes(c.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')));
    setClients(cl);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Supabase Realtime — sync en temps réel entre Admin et Employé ──
  useEffect(() => {
    if (!USE_SUPABASE || !supabase) return;
    const channel = supabase
      .channel('commandes-realtime')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'app_data', filter: "collection=eq.commandes" },
        (payload) => {
          if (payload.eventType === 'UPDATE' && payload.new?.data) {
            setCommandes((prev) => {
              const updated = prev.map((c) => c.id === payload.new.id ? payload.new.data : c);
              return updated;
            });
            // Refresh detail if open
            if (showDetailRef.current && showDetailRef.current.id === payload.new.id) {
              setShowDetail(payload.new.data);
            }
          } else if (payload.eventType === 'INSERT' && payload.new?.data) {
            setCommandes((prev) => [payload.new.data, ...prev]);
          } else if (payload.eventType === 'DELETE' && payload.old?.id) {
            setCommandes((prev) => prev.filter((c) => c.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

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
        // Le tab "en_production" regroupe validee_attente_paiement + en_production
        if (filterStatut === 'en_production') return norm === 'en_production' || norm === 'validee_attente_paiement';
        return norm === filterStatut;
      });
  }, [commandes, search, filterStatut]);

  const stats = useMemo(() => {
    const counts = {};
    commandes.forEach((c) => {
      const n = normalizeStatut(c.statut);
      counts[n] = (counts[n] || 0) + 1;
    });
    const thisMonth = commandes.filter((c) => {
      const d = c.created_at?.split('T')[0] || '';
      const monthStart = new Date().toISOString().slice(0, 7) + '-01';
      const norm = normalizeStatut(c.statut);
      return d >= monthStart && norm !== 'annulee';
    });
    const ca = thisMonth.reduce((s, c) => s + (c.montant_total || c.total || 0), 0);
    return { counts, ca, total: commandes.length };
  }, [commandes]);

  // ── Filtres rapides J2 ──
  const FILTER_TABS = useMemo(() => [
    { key: 'all', label: 'Toutes', count: stats.total },
    { key: 'en_attente_validation', label: 'À valider', count: stats.counts.en_attente_validation || 0 },
    { key: 'paiement_initie', label: 'Paiement en attente', count: stats.counts.paiement_initie || 0 },
    { key: 'en_production', label: 'En production', count: (stats.counts.en_production || 0) + (stats.counts.validee_attente_paiement || 0) },
    { key: 'prete', label: 'Prêtes', count: stats.counts.prete || 0 },
    { key: 'livree', label: 'Livrées', count: stats.counts.livree || 0 },
  ], [stats]);

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
      statut: editItem ? editItem.statut : (isEmploye ? 'validee_attente_paiement' : 'en_attente_validation'),
      source: isEmploye ? 'comptoir' : undefined,
      historique_statuts: editItem?.historique_statuts || [
        { statut: isEmploye ? 'validee_attente_paiement' : 'en_attente_validation', date: new Date().toISOString(), auteur: `${currentUser?.prenom} ${currentUser?.nom}` },
      ],
    };

    if (editItem) {
      await db.commandes.update(editItem.id, data);
      toast.success('Commande modifiée');
    } else {
      await db.commandes.create(data);
      // Notifier le staff de la nouvelle commande
      notifyNouvelleCommande(data.client_nom || 'Client');
      toast.success('Commande créée');
    }
    // Sync client auto
    syncClientFromCommande({
      client_id: data.client_id,
      client_nom: data.client_nom,
      client_tel: data.client_tel,
      source: 'commande_admin',
    }).catch(() => {});
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

    // Envoyer notification au client via le service unifié
    if (cmd.client_id) {
      if (newStatut === 'validee_attente_paiement') notifyCommandeValidee(cmd.client_id);
      else if (newStatut === 'en_production') notifyCommandeProduction(cmd.client_id);
      else if (newStatut === 'prete') notifyCommandePrete(cmd.client_id);
      else if (newStatut === 'livree') notifyCommandeLivree(cmd.client_id);
    }

    // À la livraison : sync rapport + créditer points fidélité + déduction stock
    if (newStatut === 'livree') {
      syncCommandeToRapport(cmd).catch((err) => console.error('Sync rapport error:', err));
      crediterPointsFidelite(cmd).catch((err) => console.error('Fidelite error:', err));
      syncStockFromCommande(cmd).catch((err) => console.error('Sync stock error:', err));
    }

    // Auto-generation facture a la livraison
    if (newStatut === 'livree') {
      try {
        const allFactures = await db.factures.list();
        const num = `OG-${new Date().getFullYear()}-${String(allFactures.length + 1).padStart(4, '0')}`;
        const lignes = (cmd.lignes || cmd.produits || []).map((l) => ({
          description: l.description || l.nom || l.designation || 'Article',
          quantite: l.quantite || 1,
          prix_unitaire: l.prix_unitaire || l.prix || 0,
        }));
        if (lignes.length === 0 && (cmd.montant_total || cmd.total)) {
          lignes.push({ description: cmd.description || cmd.service || 'Commande', quantite: 1, prix_unitaire: cmd.montant_total || cmd.total || 0 });
        }
        const facture = await db.factures.create({
          numero: num,
          commande_id: cmd.id,
          commande_numero: cmd.numero,
          client_id: cmd.client_id,
          client_nom: cmd.client_nom,
          client_adresse: cmd.client_adresse || '',
          objet: cmd.description || cmd.service || `Commande ${cmd.numero || ''}`,
          lignes,
          sous_total: cmd.montant_total || cmd.total || 0,
          remise: 0,
          total_ttc: cmd.montant_total || cmd.total || 0,
          statut: 'envoyee',
          date_commande: cmd.created_at?.slice(0, 10) || '',
          date_livraison: new Date().toISOString().split('T')[0],
          date: new Date().toISOString().split('T')[0],
        });
        // Notifier le client
        if (cmd.client_id) notifyFactureDisponible(cmd.client_id, num);
        // Envoyer dans la messagerie
        try {
          const convs = await db.conversations.list();
          const conv = convs.find((c) => c.client_id === cmd.client_id);
          if (conv) {
            await db.messages_conv.create({
              conversation_id: conv.id,
              type: 'sortant',
              contenu: `Votre facture ${num} pour la commande ${cmd.numero || ''} est disponible.\nMontant : ${fmt(cmd.montant_total || cmd.total || 0)} F\nConsultez vos factures dans votre espace client.`,
              auteur: 'Systeme Imprimerie Ogooue',
            });
          }
        } catch {}
      } catch (err) {
        console.error('Erreur generation facture auto:', err);
      }
    }

    toast.success(`Commande passee a "${getStatut(newStatut).label}"`);
    load();
    // Refresh detail
    const updated = await db.commandes.getById(cmd.id);
    if (updated) setShowDetail(updated);
  };

  // ── Valider la commande (sans points — les points sont crédités à la livraison) ──
  const handleValider = async (cmd) => {
    await handleStatutChange(cmd, 'validee_attente_paiement');
  };

  // ── Créditer les points fidélité à la LIVRAISON ──
  const crediterPointsFidelite = async (cmd) => {
    if (!cmd.client_id) return;
    try {
      const allFidelite = await db.fidelite_clients.list();
      let fidelite = allFidelite.find((f) => f.client_id === cmd.client_id);

      // Créer le record fidélité si inexistant (nouveau client)
      if (!fidelite) {
        const code = 'OG' + Math.random().toString(36).substring(2, 8).toUpperCase();
        fidelite = await db.fidelite_clients.create({
          client_id: cmd.client_id,
          client_nom: cmd.client_nom,
          points_actuels: 0,
          total_points_gagnes: 0,
          niveau: 'bronze',
          historique: [],
          code_parrainage: code,
        });
      }

      const montant = cmd.montant_total || cmd.total || 0;
      const pointsCommande = calculerPoints(montant);
      // Bonus evenement
      const bonusEvt = getBonusEvenement(new Date());
      const pointsEvt = bonusEvt ? bonusEvt.points : 0;
      // Check if first delivered order for bonus
      const allCmds = await db.commandes.list();
      const clientDelivered = allCmds.filter((c) =>
        c.client_id === cmd.client_id && c.id !== cmd.id && normalizeStatut(c.statut) === 'livree'
      );
      const isFirstOrder = clientDelivered.length === 0;
      const bonusPremiere = isFirstOrder ? 100 : 0;
      const totalPoints = pointsCommande + bonusPremiere + pointsEvt;

      if (totalPoints > 0) {
        const newTotal = (fidelite.points_actuels || 0) + totalPoints;
        const newTotalGagnes = (fidelite.total_points_gagnes || 0) + totalPoints;
        const niveau = determinerNiveau(newTotalGagnes);

        const hist = [...(fidelite.historique || [])];
        if (bonusPremiere > 0) {
          hist.push({ type: 'premiere_commande', points: 100, description: 'Bonus premiere commande', date: new Date().toISOString() });
        }
        if (pointsCommande > 0) {
          hist.push({ type: 'commande', points: pointsCommande, description: `Commande ${cmd.numero || 'CMD'} livrée — ${fmt(montant)} F`, date: new Date().toISOString() });
        }
        if (pointsEvt > 0 && bonusEvt) {
          hist.push({ type: 'bonus_evenement', points: pointsEvt, description: bonusEvt.label, date: new Date().toISOString() });
        }

        await db.fidelite_clients.update(fidelite.id, {
          points_actuels: newTotal,
          total_points_gagnes: newTotalGagnes,
          niveau,
          historique: hist,
        });

        toast.success(`+${totalPoints} points fidélité crédités à ${cmd.client_nom}`);

        // Check parrainage bonus (if sponsored and first delivered order)
        if (isFirstOrder) {
          const allClients = await db.clients.list();
          const client = allClients.find((e) => e.id === cmd.client_id);
          if (client?.parraine_par) {
            const parrain = allClients.find((e) => e.code_parrainage === client.parraine_par);
            if (parrain) {
              const parrainFid = allFidelite.find((f) => f.client_id === parrain.id);
              if (parrainFid) {
                await db.fidelite_clients.update(parrainFid.id, {
                  points_actuels: (parrainFid.points_actuels || 0) + BONUS_PARRAINAGE,
                  total_points_gagnes: (parrainFid.total_points_gagnes || 0) + BONUS_PARRAINAGE,
                  historique: [...(parrainFid.historique || []), {
                    type: 'parrainage_valide',
                    points: BONUS_PARRAINAGE,
                    description: `Parrainage validé — ${cmd.client_nom}`,
                    date: new Date().toISOString(),
                  }],
                });
                await db.notifications_app.create({
                  type: 'parrainage_bonus',
                  titre: `🎁 +${BONUS_PARRAINAGE} points parrainage !`,
                  message: `${cmd.client_nom} a passé sa première commande. Vous gagnez ${BONUS_PARRAINAGE} points de fidélité !`,
                  destinataire: 'client',
                  destinataire_id: parrain.id,
                  lu: false,
                });
              }
            }
          }
        }
      }
    } catch (err) {
      console.error('Fidelity error:', err);
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
    if (!confirm(`Supprimer définitivement la commande ${cmd.numero} ?\nClient : ${cmd.client_nom}\nMontant : ${fmt(cmd.montant_total || cmd.total)} F`)) return;
    await db.commandes.delete(cmd.id);
    toast.success('Commande supprimée');
    load();
  };

  // ── Purger les commandes de test (montant 0 ou anciennes tests) ──
  const handlePurgeTests = async () => {
    const tests = commandes.filter((c) => {
      const montant = c.montant_total || c.total || 0;
      return montant === 0 || (c.description || '').toLowerCase().includes('test');
    });
    if (tests.length === 0) {
      toast.info('Aucune commande de test à supprimer');
      return;
    }
    if (!confirm(`Supprimer ${tests.length} commande(s) de test ?\n(montant = 0 ou description contenant "test")`)) return;
    for (const cmd of tests) {
      await db.commandes.delete(cmd.id);
    }
    toast.success(`${tests.length} commande(s) de test supprimée(s)`);
    load();
  };

  // Open detail view
  const openDetail = (cmd) => {
    setShowDetail(cmd);
    showDetailRef.current = cmd;
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
        <div className="flex gap-2">
          {isAdmin && (
            <Button variant="outline" size="sm" className="gap-1.5 text-destructive border-destructive/30" onClick={handlePurgeTests}>
              <Trash2 className="h-3.5 w-3.5" /> Purger tests
            </Button>
          )}
          {canWrite && (
            <Button className="gap-2" onClick={openAdd}>
              <Plus className="h-4 w-4" /> Nouvelle commande
            </Button>
          )}
        </div>
      </div>

      {/* CA du mois */}
      <Card>
        <CardContent className="p-3 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">CA du mois</span>
          <span className="text-lg font-bold">{fmt(stats.ca)} F</span>
        </CardContent>
      </Card>

      {/* Filtres rapides J2 */}
      <div className="flex flex-wrap gap-1.5">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilterStatut(tab.key)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              filterStatut === tab.key
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {tab.label}
            <span className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold ${
              filterStatut === tab.key ? 'bg-white/20 text-primary-foreground' : 'bg-background text-foreground'
            }`}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Rechercher une commande..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
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
            const isPaiement = normalized === 'paiement_initie';
            return (
              <Card key={cmd.id} className={`transition-shadow hover:shadow-md ${isNew ? 'border-amber-300 border-2' : ''} ${isPaiement ? 'border-yellow-400 border-2' : ''}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-primary">{cmd.numero}</span>
                        <Badge className={`${statut.color} gap-1 ${isPaiement ? 'animate-pulse' : ''}`}>
                          <StatutIcon className="h-3 w-3" />
                          {statut.label}
                        </Badge>
                        {isNew && <Badge className="bg-amber-500 text-white text-[9px] animate-pulse">NOUVEAU</Badge>}
                        {cmd.source === 'portail_client' && (
                          <Badge variant="outline" className="text-[9px] border-blue-200 text-blue-600">Portail Client</Badge>
                        )}
                        {cmd.source === 'comptoir' && (
                          <Badge variant="outline" className="text-[9px] border-emerald-200 text-emerald-600">Comptoir</Badge>
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

                      {/* ── Actions rapides contextuelles J2 ── */}
                      {canChangeStatut && (
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {/* À valider → Valider */}
                          {isNew && (
                            <Button size="sm" className="h-7 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={(e) => { e.stopPropagation(); handleValider(cmd); }}>
                              <ShieldCheck className="h-3 w-3" /> Valider
                            </Button>
                          )}
                          {/* Paiement initié → Confirmer / Non reçu */}
                          {isPaiement && (
                            <>
                              <Button size="sm" className="h-7 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={(e) => { e.stopPropagation(); handleStatutChange(cmd, 'en_production'); }}>
                                <CheckCircle2 className="h-3 w-3" /> Confirmer paiement
                              </Button>
                              <Button size="sm" variant="destructive" className="h-7 gap-1 text-xs" onClick={(e) => { e.stopPropagation(); handleStatutChange(cmd, 'validee_attente_paiement'); }}>
                                <XCircle className="h-3 w-3" /> Non reçu
                              </Button>
                            </>
                          )}
                          {/* Validée → En production */}
                          {normalized === 'validee_attente_paiement' && (
                            <Button size="sm" className="h-7 gap-1 text-xs bg-blue-600 hover:bg-blue-700" onClick={(e) => { e.stopPropagation(); handleStatutChange(cmd, 'en_production'); }}>
                              <Factory className="h-3 w-3" /> En production
                            </Button>
                          )}
                          {/* En production → Prête */}
                          {normalized === 'en_production' && (
                            <Button size="sm" className="h-7 gap-1 text-xs" onClick={(e) => { e.stopPropagation(); handleStatutChange(cmd, 'prete'); }}>
                              <Package className="h-3 w-3" /> Prête
                            </Button>
                          )}
                          {/* Prête → Livrée (admin/manager seulement) */}
                          {normalized === 'prete' && !isEmploye && (
                            <Button size="sm" className="h-7 gap-1 text-xs bg-green-600 hover:bg-green-700" onClick={(e) => { e.stopPropagation(); handleStatutChange(cmd, 'livree'); }}>
                              <Truck className="h-3 w-3" /> Livrée
                            </Button>
                          )}
                          {/* Livrée → Voir facture */}
                          {normalized === 'livree' && (
                            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={(e) => { e.stopPropagation(); openDetail(cmd); }}>
                              <FileText className="h-3 w-3" /> Voir facture
                            </Button>
                          )}
                          {/* Message client — toujours visible */}
                          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={(e) => { e.stopPropagation(); openDetail(cmd); }}>
                            <MessageSquare className="h-3 w-3" /> Message
                          </Button>
                          {/* Annuler (admin/manager seulement, si pas terminal) */}
                          {!isEmploye && normalized !== 'livree' && normalized !== 'annulee' && (
                            <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); handleAnnuler(cmd); }}>
                              <XCircle className="h-3 w-3" /> Annuler
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-lg font-bold">{fmt(cmd.montant_total || cmd.total)} F</p>
                      <div className="mt-1 flex gap-1 justify-end">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openDetail(cmd)}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        {isAdmin && (
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(cmd)} title="Supprimer la commande">
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
      <Dialog open={!!showDetail} onOpenChange={() => { setShowDetail(null); showDetailRef.current = null; }}>
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
                {canWriteAdmin && (
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
                {canWriteAdmin && (
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

                {canWriteAdmin && (commentaireClient !== (showDetail.commentaire_client || '') || noteInterne !== (showDetail.note_interne || '')) && (
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

                {/* ── Paiement Mobile Money initié — confirmation admin/employé ── */}
                {normalized === 'paiement_initie' && canChangeStatut && (
                  <div className="rounded-lg bg-yellow-50 border border-yellow-300 p-3 space-y-2">
                    <p className="text-sm font-semibold text-yellow-800">
                      Paiement {showDetail.operateur_paiement || 'Mobile Money'} initie
                    </p>
                    <p className="text-xs text-yellow-700">
                      Numero : {showDetail.telephone_paiement || '—'} | Montant : {fmt(showDetail.montant_total || showDetail.total)} F
                      {showDetail.reference_paiement && <> | Ref : {showDetail.reference_paiement}</>}
                    </p>
                    <div className="flex gap-2 pt-1">
                      <Button
                        className="flex-1 gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                        onClick={() => handleStatutChange(showDetail, 'en_production')}
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Paiement recu — En production
                      </Button>
                      <Button
                        variant="destructive"
                        className="gap-1.5"
                        onClick={() => handleStatutChange(showDetail, 'validee_attente_paiement')}
                      >
                        <XCircle className="h-4 w-4" />
                        Non recu
                      </Button>
                    </div>
                  </div>
                )}

                {/* Action buttons — Admin/Manager/Employe partagent validation + confirmation paiement */}
                {canChangeStatut && !isTerminal && normalized !== 'paiement_initie' && (
                  <div className="flex flex-wrap gap-2 pt-2 border-t">
                    {/* Valider — Admin, Manager ET Employe */}
                    {normalized === 'en_attente_validation' && (
                      <Button className="flex-1 gap-2 bg-emerald-600 hover:bg-emerald-700" onClick={() => handleValider(showDetail)}>
                        <ShieldCheck className="h-4 w-4" />
                        Valider la commande
                      </Button>
                    )}
                    {/* validee_attente_paiement → en_production — tous */}
                    {normalized === 'validee_attente_paiement' && (
                      <Button className="flex-1 gap-2 bg-blue-600 hover:bg-blue-700" onClick={() => handleStatutChange(showDetail, 'en_production')}>
                        <Factory className="h-4 w-4" />
                        Mettre en production
                      </Button>
                    )}
                    {/* en_production → prete — tous */}
                    {normalized === 'en_production' && (
                      <Button className="flex-1 gap-2" onClick={() => handleStatutChange(showDetail, 'prete')}>
                        <Package className="h-4 w-4" />
                        Marquer &quot;Prête&quot;
                      </Button>
                    )}
                    {/* prete → livree — admin/manager seulement */}
                    {!isEmploye && normalized === 'prete' && (
                      <Button className="flex-1 gap-2 bg-green-600 hover:bg-green-700" onClick={() => handleStatutChange(showDetail, 'livree')}>
                        <Truck className="h-4 w-4" />
                        Marquer &quot;Livrée&quot;
                      </Button>
                    )}
                    {/* Annuler — admin/manager seulement */}
                    {!isEmploye && (
                      <Button variant="destructive" className="gap-1.5" onClick={() => handleAnnuler(showDetail)}>
                        <XCircle className="h-4 w-4" />
                        Annuler
                      </Button>
                    )}
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
