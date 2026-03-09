import { useState, useEffect, useMemo, useCallback } from 'react';
import { db } from '@/services/db';
import { useAuth } from '@/services/auth';
import { logAction } from '@/services/audit';
import { Card, CardContent } from '@/components/ui/card';
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
  Target, Search, Plus, Edit2, Trash2, Phone, Mail, Building2,
  MapPin, ArrowRight, UserPlus, TrendingUp, ChevronRight, Eye,
  Calendar, MessageCircle, X, Clock, Send, Copy, Megaphone,
  Filter, History, DollarSign, ChevronDown, AlertCircle, Sparkles,
  Users, FileText, ShoppingCart,
} from 'lucide-react';
import { toast } from 'sonner';

/* ─── CONSTANTES ─── */

const STATUTS = {
  nouveau: { label: 'Nouveau', color: 'bg-slate-100 text-slate-700', dot: 'bg-slate-500' },
  contacte: { label: 'Contacté', color: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' },
  interesse: { label: 'Intéressé', color: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  devis_envoye: { label: 'Devis envoyé', color: 'bg-indigo-100 text-indigo-700', dot: 'bg-indigo-500' },
  negoce: { label: 'En négo', color: 'bg-violet-100 text-violet-700', dot: 'bg-violet-500' },
  converti: { label: 'Converti', color: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  perdu: { label: 'Perdu', color: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
};

const TYPES_PROSPECT = [
  { value: 'entreprise', label: 'Entreprise' },
  { value: 'particulier', label: 'Particulier' },
  { value: 'administration', label: 'Administration' },
  { value: 'ecole', label: 'École' },
  { value: 'ong', label: 'ONG' },
  { value: 'commerce', label: 'Commerce' },
];

const SOURCES = [
  { value: 'recommandation', label: 'Recommandation' },
  { value: 'passage', label: 'Passage en boutique' },
  { value: 'reseaux_sociaux', label: 'Réseaux sociaux' },
  { value: 'prospection_active', label: 'Prospection active' },
  { value: 'evenement', label: 'Événement' },
  { value: 'autre', label: 'Autre' },
];

const TYPES_INTERACTION = {
  appel: { label: 'Appel', icon: Phone, color: 'text-blue-600' },
  visite: { label: 'Visite', icon: MapPin, color: 'text-emerald-600' },
  whatsapp: { label: 'WhatsApp', icon: MessageCircle, color: 'text-green-600' },
  email: { label: 'Email', icon: Mail, color: 'text-violet-600' },
  autre: { label: 'Autre', icon: FileText, color: 'text-slate-600' },
};

const SERVICES_IMPR = [
  'Flyers', 'Affiches', 'Cartes de visite', 'T-shirts', 'Banderoles',
  'Calendriers', 'Brochures', 'Cahiers', 'Facturiers', 'Tampons',
  'Roll-up', 'Autocollants', 'Faire-part', 'Badges', 'Mugs',
];

const SECTEURS = ['Administration', 'Éducation', 'Santé', 'Commerce', 'Construction', 'Industrie', 'ONG', 'Restauration', 'Mines', 'Autre'];

const emptyForm = {
  type: 'entreprise', nomOuEntreprise: '', secteurActivite: 'Commerce',
  contactNom: '', telephone: '', email: '', adresse: '', localisation: '',
  statut: 'nouveau', source: 'passage', responsableInterne: '__none__',
  besoinsIdentifies: [], budgetEstime: '', dateProchainContact: '',
  notes: '',
};

const emptyInteraction = { type: 'appel', resume: '' };

const emptyCampagne = {
  titre: '', type: 'promotion', objetMessage: '', message: '',
  destinatairesMode: 'tous', clientsIds: [], segment: '',
};

const TYPES_CAMPAGNE = {
  promotion: { label: 'Promotion', color: 'bg-amber-100 text-amber-700' },
  evenement: { label: 'Événement', color: 'bg-blue-100 text-blue-700' },
  nouvelle_offre: { label: 'Nouvelle offre', color: 'bg-emerald-100 text-emerald-700' },
  relance: { label: 'Relance', color: 'bg-violet-100 text-violet-700' },
  annonce: { label: 'Annonce', color: 'bg-slate-100 text-slate-700' },
};

/* ─── COMPOSANT PRINCIPAL ─── */

export default function Prospection() {
  const { user, hasPermission } = useAuth();
  const canWrite = hasPermission('clients', 'write');
  const canDelete = hasPermission('clients', 'delete');
  const isAdmin = user?.role === 'admin';
  const isManager = user?.role === 'manager';
  const canManage = isAdmin || isManager;

  /* ─── STATE ─── */
  const [prospects, setProspects] = useState([]);
  const [clients, setClients] = useState([]);
  const [employes, setEmployes] = useState([]);
  const [campagnes, setCampagnes] = useState([]);
  const [evenements, setEvenements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatut, setFilterStatut] = useState('all');

  // Tabs: prospects | campagnes
  const [activeTab, setActiveTab] = useState('prospects');

  // Form modals
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState(emptyForm);

  // Detail modal
  const [showDetail, setShowDetail] = useState(null);

  // Interaction modal
  const [showInteraction, setShowInteraction] = useState(null);
  const [interactionForm, setInteractionForm] = useState(emptyInteraction);

  // Campagne modal
  const [showCampagne, setShowCampagne] = useState(false);
  const [campagneForm, setCampagneForm] = useState(emptyCampagne);

  // Event suggestions
  const [eventSuggestions, setEventSuggestions] = useState([]);

  /* ─── LOAD ─── */
  const load = useCallback(async () => {
    const [p, cl, emp, cmp, evt] = await Promise.all([
      db.prospects.list(),
      db.clients.list(),
      db.employes.list(),
      db.campagnes_prospection.list(),
      db.evenements.list(),
    ]);
    setProspects(p.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')));
    setClients(cl);
    setEmployes(emp);
    setCampagnes(cmp.sort((a, b) => (b.dateCreation || b.created_at || '').localeCompare(a.dateCreation || a.created_at || '')));

    // Event suggestions (events within 30 days)
    const today = new Date();
    const EVENEMENTS_GABON = [
      { nom: 'Nouvel An', date: '01-01', type: 'fete_nationale', opportunites: 'Cartes de voeux, calendriers, agendas' },
      { nom: 'Fête du Travail', date: '05-01', type: 'fete_nationale', opportunites: 'Affiches syndicales, badges' },
      { nom: "Fête de l'Indépendance", date: '08-17', type: 'fete_nationale', opportunites: 'Drapeaux, banderoles, T-shirts, casquettes' },
      { nom: 'Toussaint', date: '11-01', type: 'fete_religieuse', opportunites: 'Faire-part, affiches commémoratives' },
      { nom: 'Noël', date: '12-25', type: 'fete_religieuse', opportunites: 'Cartes, emballages, catalogues cadeaux' },
      { nom: 'Rentrée scolaire', date: '09-15', type: 'rentree_scolaire', opportunites: 'Cahiers, protège-cahiers, étiquettes, fournitures' },
      { nom: 'Saint-Valentin', date: '02-14', type: 'commercial', opportunites: 'Cartes, posters, T-shirts personnalisés' },
      { nom: 'Fête des Mères', date: '05-26', type: 'commercial', opportunites: 'Cartes, mugs, T-shirts, photos' },
    ];
    const allEvts = [
      ...evt.map((e) => ({ ...e, source: 'custom' })),
      ...EVENEMENTS_GABON.map((e) => ({ ...e, date: `${today.getFullYear()}-${e.date}`, source: 'default' })),
    ];
    const suggestions = allEvts.filter((e) => {
      const evtDate = new Date(e.date);
      const diff = (evtDate - today) / (1000 * 60 * 60 * 24);
      return diff >= 0 && diff <= 30;
    });
    setEventSuggestions(suggestions);
    setEvenements(allEvts);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  /* ─── FILTERED PROSPECTS ─── */
  const filtered = useMemo(() => {
    return prospects.filter((p) => {
      if (filterStatut !== 'all' && p.statut !== filterStatut) return false;
      if (search) {
        const q = search.toLowerCase();
        return `${p.nomOuEntreprise || p.nom_entreprise || ''} ${p.contactNom || p.contact_nom || ''} ${p.email || ''} ${p.telephone || ''} ${p.secteurActivite || p.secteur || ''}`.toLowerCase().includes(q);
      }
      return true;
    });
  }, [prospects, search, filterStatut]);

  const stats = useMemo(() => ({
    total: prospects.length,
    nouveaux: prospects.filter((p) => p.statut === 'nouveau').length,
    en_cours: prospects.filter((p) => ['contacte', 'interesse', 'devis_envoye', 'negoce'].includes(p.statut)).length,
    convertis: prospects.filter((p) => p.statut === 'converti').length,
    perdus: prospects.filter((p) => p.statut === 'perdu').length,
    relancesAujourdhui: prospects.filter((p) => {
      if (!p.dateProchainContact) return false;
      const today = new Date().toISOString().slice(0, 10);
      return p.dateProchainContact <= today && p.statut !== 'converti' && p.statut !== 'perdu';
    }).length,
  }), [prospects]);

  /* ─── PROSPECT CRUD ─── */
  const getName = (p) => p.nomOuEntreprise || p.nom_entreprise || '';

  const openAdd = () => { setEditItem(null); setForm(emptyForm); setShowForm(true); };

  const openEdit = (p) => {
    setEditItem(p);
    setForm({
      type: p.type || 'entreprise',
      nomOuEntreprise: getName(p),
      secteurActivite: p.secteurActivite || p.secteur || 'Commerce',
      contactNom: p.contactNom || p.contact_nom || '',
      telephone: p.telephone || '',
      email: p.email || '',
      adresse: p.adresse || '',
      localisation: p.localisation || '',
      statut: p.statut || 'nouveau',
      source: p.source || 'passage',
      responsableInterne: p.responsableInterne || '__none__',
      besoinsIdentifies: p.besoinsIdentifies || [],
      budgetEstime: p.budgetEstime || '',
      dateProchainContact: p.dateProchainContact || '',
      notes: p.notes || '',
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.nomOuEntreprise.trim()) { toast.error("Le nom / l'entreprise est requis"); return; }
    if (!form.telephone.trim()) { toast.error('Le téléphone est requis'); return; }

    const data = {
      ...form,
      nomOuEntreprise: form.nomOuEntreprise.trim(),
      contactNom: form.contactNom.trim(),
      telephone: form.telephone.trim(),
      email: form.email.trim(),
      budgetEstime: form.budgetEstime ? Number(form.budgetEstime) : null,
      responsableInterne: form.responsableInterne === '__none__' ? '' : form.responsableInterne,
    };

    if (editItem) {
      await db.prospects.update(editItem.id, data);
      await logAction('update', 'prospects', { entityId: editItem.id, entityLabel: data.nomOuEntreprise });
      toast.success('Prospect modifié');
    } else {
      data.historiqueInteractions = [];
      const created = await db.prospects.create(data);
      await logAction('create', 'prospects', { entityId: created.id, entityLabel: data.nomOuEntreprise });
      toast.success('Prospect ajouté');
    }
    setShowForm(false);
    load();
  };

  const handleDelete = async (p) => {
    if (!confirm(`Supprimer le prospect "${getName(p)}" ?`)) return;
    await db.prospects.delete(p.id);
    await logAction('delete', 'prospects', { entityId: p.id, entityLabel: getName(p) });
    toast.success('Prospect supprimé');
    load();
  };

  const handleStatutChange = async (p, newStatut) => {
    await db.prospects.update(p.id, { statut: newStatut });
    await logAction('update', 'prospects', { entityId: p.id, entityLabel: getName(p), details: `Statut → ${STATUTS[newStatut]?.label}` });
    toast.success(`Statut changé → ${STATUTS[newStatut]?.label}`);
    load();
  };

  const convertirEnClient = async (p) => {
    if (!confirm(`Convertir "${getName(p)}" en client ?`)) return;
    const typeClient = ['entreprise', 'administration', 'commerce'].includes(p.type) ? 'entreprise' : 'particulier';
    const client = await db.clients.create({
      nom: getName(p),
      email: p.email,
      telephone: p.telephone,
      type: typeClient,
      adresse: p.adresse || p.localisation || '',
      notes: `Converti depuis prospection. Contact: ${p.contactNom || p.contact_nom || ''}\nBesoins: ${(p.besoinsIdentifies || []).join(', ')}\nSource: ${p.source || 'N/A'}`,
    });
    await db.prospects.update(p.id, { statut: 'converti', convertiEnClientId: client.id });
    await logAction('create', 'clients', { entityLabel: getName(p), details: `Conversion prospect → client` });
    toast.success(`"${getName(p)}" converti en client !`);
    if (showDetail?.id === p.id) setShowDetail(null);
    load();
  };

  /* ─── INTERACTIONS ─── */
  const addInteraction = async () => {
    if (!interactionForm.resume.trim()) { toast.error('Le résumé est requis'); return; }
    const prospect = showInteraction;
    const newInteraction = {
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
      type: interactionForm.type,
      resume: interactionForm.resume.trim(),
      auteur: `${user?.prenom || ''} ${user?.nom || ''}`.trim(),
    };
    const historique = [...(prospect.historiqueInteractions || []), newInteraction];
    await db.prospects.update(prospect.id, { historiqueInteractions: historique });
    await logAction('update', 'prospects', { entityId: prospect.id, entityLabel: getName(prospect), details: `Interaction: ${newInteraction.type}` });
    toast.success('Interaction ajoutée');
    setShowInteraction(null);
    setInteractionForm(emptyInteraction);
    load();
  };

  /* ─── CAMPAGNES ─── */
  const handleSendCampagne = async () => {
    if (!campagneForm.objetMessage.trim()) { toast.error("L'objet du message est requis"); return; }
    if (!campagneForm.message.trim()) { toast.error('Le message est requis'); return; }

    let destinataires = [];
    if (campagneForm.destinatairesMode === 'tous') {
      destinataires = clients.map((c) => c.id);
    } else if (campagneForm.destinatairesMode === 'selection') {
      destinataires = campagneForm.clientsIds;
    } else if (campagneForm.destinatairesMode === 'segment') {
      if (campagneForm.segment === 'entreprises') {
        destinataires = clients.filter((c) => c.type === 'entreprise').map((c) => c.id);
      } else if (campagneForm.segment === 'particuliers') {
        destinataires = clients.filter((c) => c.type === 'particulier').map((c) => c.id);
      } else if (campagneForm.segment === 'actifs') {
        destinataires = clients.map((c) => c.id); // all considered active
      } else {
        destinataires = clients.map((c) => c.id);
      }
    }

    if (destinataires.length === 0) { toast.error('Aucun destinataire sélectionné'); return; }

    // Create campaign
    const campagne = await db.campagnes_prospection.create({
      titre: campagneForm.titre || campagneForm.objetMessage,
      type: campagneForm.type,
      objetMessage: campagneForm.objetMessage.trim(),
      message: campagneForm.message.trim(),
      destinataires: {
        mode: campagneForm.destinatairesMode,
        clientsIds: destinataires,
        segment: campagneForm.segment,
      },
      canalEnvoi: 'messagerie_app',
      statut: 'envoye',
      dateEnvoi: new Date().toISOString(),
      dateCreation: new Date().toISOString(),
      auteur: `${user?.prenom || ''} ${user?.nom || ''}`.trim(),
      statistiques: { nbEnvoyes: destinataires.length, nbVus: 0, nbCliquesCommander: 0 },
    });

    // Send message to each client via messagerie
    for (const clientId of destinataires) {
      const client = clients.find((c) => c.id === clientId);
      if (!client) continue;

      // Find or create conversation
      const convs = await db.conversations.list();
      let conv = convs.find((c) => c.client_id === clientId || c.client_nom?.toLowerCase() === client.nom?.toLowerCase());

      if (!conv) {
        conv = await db.conversations.create({
          client_id: clientId,
          client_nom: client.nom,
          client_email: client.email,
          plateforme: 'interne',
          statut: 'nouveau',
          sujet: `Conversation avec ${client.nom}`,
        });
      }

      // Send message
      await db.messages_conv.create({
        conversation_id: conv.id,
        contenu: `📢 ${campagneForm.objetMessage}\n\n${campagneForm.message}`,
        auteur: 'Imprimerie Ogooué',
        auteur_id: user?.id,
        type: 'sortant',
        campagne_id: campagne.id,
        is_campagne: true,
        campagne_type: campagneForm.type,
      });

      await db.conversations.update(conv.id, {
        statut: 'en_cours',
        dernier_message: `📢 ${campagneForm.objetMessage}`,
      });
    }

    await logAction('create', 'campagnes_prospection', { entityId: campagne.id, entityLabel: campagne.titre, details: `Envoyée à ${destinataires.length} clients` });
    toast.success(`Campagne envoyée à ${destinataires.length} clients !`);
    setShowCampagne(false);
    setCampagneForm(emptyCampagne);
    load();
  };

  const copyCampagneMessage = () => {
    const text = `${campagneForm.objetMessage}\n\n${campagneForm.message}\n\n— Imprimerie Ogooué\n📞 077 95 93 12 / 062 57 65 57\n📍 Moanda, Gabon`;
    navigator.clipboard.writeText(text);
    toast.success('Message copié dans le presse-papier !');
  };

  const createCampagneFromEvent = (evt) => {
    setCampagneForm({
      ...emptyCampagne,
      titre: `Promo ${evt.nom}`,
      type: 'promotion',
      objetMessage: `🎉 Offre spéciale — ${evt.nom}`,
      message: `Chers clients,\n\nÀ l'occasion de ${evt.nom}, l'Imprimerie Ogooué vous propose des offres spéciales sur :\n${evt.opportunites || 'nos services d\'impression'}\n\nProfitez-en dès maintenant !\n\nCordialement,\nL'équipe Imprimerie Ogooué`,
      destinatairesMode: 'tous',
    });
    setShowCampagne(true);
  };

  /* ─── LOADING ─── */
  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  }

  /* ─── DETAIL MODAL RENDER ─── */
  const renderDetailModal = () => {
    if (!showDetail) return null;
    const p = showDetail;
    const st = STATUTS[p.statut] || STATUTS.nouveau;
    const interactions = (p.historiqueInteractions || []).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const responsable = employes.find((e) => e.id === p.responsableInterne);

    return (
      <Dialog open={!!showDetail} onOpenChange={() => setShowDetail(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <Building2 className="h-5 w-5 text-blue-600" />
              {getName(p)}
              <Badge className={`${st.color} text-xs`}>{st.label}</Badge>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {/* Info section */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                {p.type && <p className="text-sm"><span className="font-medium">Type :</span> {TYPES_PROSPECT.find((t) => t.value === p.type)?.label || p.type}</p>}
                {(p.contactNom || p.contact_nom) && <p className="text-sm"><span className="font-medium">Contact :</span> {p.contactNom || p.contact_nom}</p>}
                {p.telephone && <p className="flex items-center gap-1.5 text-sm"><Phone className="h-3.5 w-3.5 text-muted-foreground" /> {p.telephone}</p>}
                {p.email && <p className="flex items-center gap-1.5 text-sm"><Mail className="h-3.5 w-3.5 text-muted-foreground" /> {p.email}</p>}
                {(p.adresse || p.localisation) && <p className="flex items-center gap-1.5 text-sm"><MapPin className="h-3.5 w-3.5 text-muted-foreground" /> {p.adresse || ''} {p.localisation ? `(${p.localisation})` : ''}</p>}
              </div>
              <div className="space-y-2">
                {(p.secteurActivite || p.secteur) && <p className="text-sm"><span className="font-medium">Secteur :</span> {p.secteurActivite || p.secteur}</p>}
                {p.source && <p className="text-sm"><span className="font-medium">Source :</span> {SOURCES.find((s) => s.value === p.source)?.label || p.source}</p>}
                {responsable && <p className="text-sm"><span className="font-medium">Responsable :</span> {responsable.prenom} {responsable.nom}</p>}
                {p.budgetEstime && <p className="text-sm"><span className="font-medium">Budget estimé :</span> {Number(p.budgetEstime).toLocaleString('fr-FR')} FCFA</p>}
                {p.dateProchainContact && <p className="flex items-center gap-1.5 text-sm"><Calendar className="h-3.5 w-3.5 text-muted-foreground" /> Relance: {new Date(p.dateProchainContact).toLocaleDateString('fr-FR')}</p>}
              </div>
            </div>

            {/* Besoins */}
            {p.besoinsIdentifies?.length > 0 && (
              <div>
                <p className="text-sm font-medium mb-1">Besoins identifiés :</p>
                <div className="flex flex-wrap gap-1">{p.besoinsIdentifies.map((b) => <Badge key={b} variant="outline" className="text-xs">{b}</Badge>)}</div>
              </div>
            )}

            {/* Notes */}
            {p.notes && <div className="rounded-lg bg-muted/50 p-3"><p className="text-sm text-muted-foreground">{p.notes}</p></div>}

            {/* Interactions */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold text-sm flex items-center gap-2"><History className="h-4 w-4" /> Historique des interactions ({interactions.length})</h4>
                {canWrite && p.statut !== 'converti' && p.statut !== 'perdu' && (
                  <Button size="sm" variant="outline" className="text-xs gap-1" onClick={() => { setShowInteraction(p); setInteractionForm(emptyInteraction); }}>
                    <Plus className="h-3 w-3" /> Interaction
                  </Button>
                )}
              </div>
              {interactions.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">Aucune interaction enregistrée</p>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {interactions.map((i) => {
                    const ti = TYPES_INTERACTION[i.type] || TYPES_INTERACTION.autre;
                    const Icon = ti.icon;
                    return (
                      <div key={i.id} className="flex items-start gap-3 rounded-lg border p-3">
                        <Icon className={`h-4 w-4 mt-0.5 ${ti.color}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-[10px]">{ti.label}</Badge>
                            <span className="text-[10px] text-muted-foreground">{new Date(i.date).toLocaleDateString('fr-FR')} à {new Date(i.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                          <p className="text-sm mt-1">{i.resume}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">Par {i.auteur}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2 border-t pt-3">
              {canWrite && (
                <Button size="sm" variant="outline" className="gap-1" onClick={() => { setShowDetail(null); openEdit(p); }}>
                  <Edit2 className="h-3 w-3" /> Modifier
                </Button>
              )}
              {canWrite && p.statut !== 'converti' && p.statut !== 'perdu' && (
                <>
                  <Button size="sm" variant="outline" className="gap-1" onClick={() => { setShowDetail(null); setShowInteraction(p); setInteractionForm(emptyInteraction); }}>
                    <Plus className="h-3 w-3" /> Interaction
                  </Button>
                  <Button size="sm" className="gap-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => convertirEnClient(p)}>
                    <UserPlus className="h-3 w-3" /> Convertir en client
                  </Button>
                </>
              )}
              {canDelete && (
                <Button size="sm" variant="destructive" className="gap-1" onClick={() => { setShowDetail(null); handleDelete(p); }}>
                  <Trash2 className="h-3 w-3" /> Supprimer
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  };

  /* ─── ONGLET PROSPECTS ─── */
  const renderProspects = () => (
    <>
      {/* Event suggestions */}
      {eventSuggestions.length > 0 && (
        <Card className="border-l-4 border-l-amber-500 bg-amber-50/50">
          <CardContent className="p-4">
            {eventSuggestions.map((evt) => {
              const daysUntil = Math.ceil((new Date(evt.date) - new Date()) / (1000 * 60 * 60 * 24));
              return (
                <div key={evt.nom} className="flex items-center justify-between gap-3 py-1">
                  <p className="text-sm flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-amber-600 shrink-0" />
                    <span>L'événement <strong>"{evt.nom}"</strong> approche {daysUntil > 0 ? `(J-${daysUntil})` : "(aujourd'hui)"}. Créer une campagne ?</span>
                  </p>
                  <Button size="sm" variant="outline" className="text-xs gap-1 shrink-0" onClick={() => createCampagneFromEvent(evt)}>
                    <Megaphone className="h-3 w-3" /> Créer campagne
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Relances alert */}
      {stats.relancesAujourdhui > 0 && (
        <Card className="border-l-4 border-l-red-500 bg-red-50/50">
          <CardContent className="p-3 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-red-600 shrink-0" />
            <p className="text-sm"><strong>{stats.relancesAujourdhui}</strong> relance{stats.relancesAujourdhui > 1 ? 's' : ''} à effectuer aujourd'hui</p>
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Total', value: stats.total, icon: Target, color: 'bg-primary/10 text-primary' },
          { label: 'Nouveaux', value: stats.nouveaux, icon: Plus, color: 'bg-slate-500/10 text-slate-600' },
          { label: 'En cours', value: stats.en_cours, icon: TrendingUp, color: 'bg-blue-500/10 text-blue-600' },
          { label: 'Convertis', value: stats.convertis, icon: UserPlus, color: 'bg-emerald-500/10 text-emerald-600' },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}><CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}><Icon className="h-4 w-4" /></div>
              <div><p className="text-[10px] text-muted-foreground">{label}</p><p className="text-base font-bold">{value}</p></div>
            </div>
          </CardContent></Card>
        ))}
      </div>

      {/* Pipeline badges - clickable to filter */}
      <div className="flex gap-1 overflow-x-auto pb-2">
        {Object.entries(STATUTS).map(([key, { label, color }]) => {
          const count = prospects.filter((p) => p.statut === key).length;
          const active = filterStatut === key;
          return (
            <button key={key} className={`flex-1 min-w-[80px] rounded-lg px-3 py-2 text-center transition-all ${active ? 'ring-2 ring-primary ring-offset-1' : ''} ${color}`}
              onClick={() => setFilterStatut(active ? 'all' : key)}>
              <p className="text-lg font-bold">{count}</p>
              <p className="text-[10px] font-medium">{label}</p>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Rechercher un prospect..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={filterStatut} onValueChange={setFilterStatut}>
          <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous statuts</SelectItem>
            {Object.entries(STATUTS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      {/* Desktop table */}
      <div className="hidden lg:block">
        <div className="rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">Nom / Entreprise</th>
                <th className="px-4 py-3 text-left font-medium">Type</th>
                <th className="px-4 py-3 text-left font-medium">Téléphone</th>
                <th className="px-4 py-3 text-left font-medium">Statut</th>
                <th className="px-4 py-3 text-left font-medium">Responsable</th>
                <th className="px-4 py-3 text-left font-medium">Relance</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const st = STATUTS[p.statut] || STATUTS.nouveau;
                const resp = employes.find((e) => e.id === p.responsableInterne);
                const isRelance = p.dateProchainContact && p.dateProchainContact <= new Date().toISOString().slice(0, 10) && p.statut !== 'converti' && p.statut !== 'perdu';
                return (
                  <tr key={p.id} className={`border-b hover:bg-muted/30 ${isRelance ? 'bg-red-50/50' : ''}`}>
                    <td className="px-4 py-3">
                      <p className="font-medium">{getName(p)}</p>
                      {(p.contactNom || p.contact_nom) && <p className="text-xs text-muted-foreground">{p.contactNom || p.contact_nom}</p>}
                    </td>
                    <td className="px-4 py-3"><Badge variant="outline" className="text-[10px]">{TYPES_PROSPECT.find((t) => t.value === p.type)?.label || p.type || '—'}</Badge></td>
                    <td className="px-4 py-3 text-muted-foreground">{p.telephone || '—'}</td>
                    <td className="px-4 py-3">
                      {canWrite && p.statut !== 'converti' && p.statut !== 'perdu' ? (
                        <Select value={p.statut} onValueChange={(v) => handleStatutChange(p, v)}>
                          <SelectTrigger className="h-7 w-[130px]"><Badge className={`${st.color} text-[10px]`}>{st.label}</Badge></SelectTrigger>
                          <SelectContent>{Object.entries(STATUTS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                        </Select>
                      ) : (
                        <Badge className={`${st.color} text-[10px]`}>{st.label}</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{resp ? `${resp.prenom} ${resp.nom}` : '—'}</td>
                    <td className="px-4 py-3">
                      {p.dateProchainContact ? (
                        <span className={`text-xs ${isRelance ? 'text-red-600 font-semibold' : 'text-muted-foreground'}`}>
                          {new Date(p.dateProchainContact).toLocaleDateString('fr-FR')}
                          {isRelance && ' ⚠️'}
                        </span>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setShowDetail(p)}><Eye className="h-3.5 w-3.5" /></Button>
                        {canWrite && p.statut !== 'converti' && (
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setShowInteraction(p); setInteractionForm(emptyInteraction); }}>
                            <MessageCircle className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {canWrite && p.statut !== 'converti' && p.statut !== 'perdu' && (
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-emerald-600" onClick={() => convertirEnClient(p)}>
                            <UserPlus className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:hidden">
        {filtered.map((p) => {
          const st = STATUTS[p.statut] || STATUTS.nouveau;
          const interactions = p.historiqueInteractions || [];
          const isRelance = p.dateProchainContact && p.dateProchainContact <= new Date().toISOString().slice(0, 10) && p.statut !== 'converti' && p.statut !== 'perdu';
          return (
            <Card key={p.id} className={`cursor-pointer transition-shadow hover:shadow-md ${isRelance ? 'border-red-300 bg-red-50/30' : ''}`}
              onClick={() => setShowDetail(p)}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                      <Building2 className="h-5 w-5 text-blue-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate">{getName(p)}</p>
                      {(p.contactNom || p.contact_nom) && <p className="text-xs text-muted-foreground">{p.contactNom || p.contact_nom}</p>}
                    </div>
                  </div>
                  <Badge variant="outline" className={`text-[10px] shrink-0 ${st.color}`}>{st.label}</Badge>
                </div>
                <div className="mt-3 space-y-1 border-t pt-3">
                  {p.telephone && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Phone className="h-3 w-3" />{p.telephone}</p>}
                  <div className="flex items-center gap-2">
                    {p.type && <Badge variant="outline" className="text-[10px]">{TYPES_PROSPECT.find((t) => t.value === p.type)?.label || p.type}</Badge>}
                    {interactions.length > 0 && <Badge variant="outline" className="text-[10px]"><MessageCircle className="h-2.5 w-2.5 mr-1" />{interactions.length}</Badge>}
                  </div>
                  {isRelance && <p className="text-[10px] text-red-600 font-semibold">⚠️ Relance à effectuer</p>}
                </div>
                {canWrite && p.statut !== 'converti' && p.statut !== 'perdu' && (
                  <div className="mt-3 flex gap-2 border-t pt-3">
                    <Button size="sm" variant="outline" className="flex-1 text-xs gap-1"
                      onClick={(e) => { e.stopPropagation(); convertirEnClient(p); }}>
                      <UserPlus className="h-3 w-3" /> Convertir
                    </Button>
                    <Button size="sm" variant="outline" className="text-xs gap-1"
                      onClick={(e) => { e.stopPropagation(); setShowInteraction(p); setInteractionForm(emptyInteraction); }}>
                      <Plus className="h-3 w-3" /> Interaction
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16">
          <Target className="mb-4 h-12 w-12 text-muted-foreground/30" />
          <p className="text-muted-foreground">Aucun prospect trouvé</p>
        </div>
      )}
    </>
  );

  /* ─── ONGLET CAMPAGNES ─── */
  const renderCampagnes = () => (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Campagnes', value: campagnes.length, icon: Megaphone, color: 'bg-violet-500/10 text-violet-600' },
          { label: 'Envoyées', value: campagnes.filter((c) => c.statut === 'envoye').length, icon: Send, color: 'bg-emerald-500/10 text-emerald-600' },
          { label: 'Clients touchés', value: campagnes.reduce((s, c) => s + (c.statistiques?.nbEnvoyes || 0), 0), icon: Users, color: 'bg-blue-500/10 text-blue-600' },
          { label: 'Clients total', value: clients.length, icon: UserPlus, color: 'bg-primary/10 text-primary' },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}><CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}><Icon className="h-4 w-4" /></div>
              <div><p className="text-[10px] text-muted-foreground">{label}</p><p className="text-base font-bold">{value}</p></div>
            </div>
          </CardContent></Card>
        ))}
      </div>

      {/* Campaigns list */}
      <div className="space-y-3">
        {campagnes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Megaphone className="mb-4 h-12 w-12 text-muted-foreground/30" />
            <p className="text-muted-foreground">Aucune campagne envoyée</p>
            <Button className="mt-4 gap-2" onClick={() => { setCampagneForm(emptyCampagne); setShowCampagne(true); }}>
              <Plus className="h-4 w-4" /> Première campagne
            </Button>
          </div>
        ) : (
          <div className="rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium">Titre</th>
                  <th className="px-4 py-3 text-left font-medium hidden sm:table-cell">Date</th>
                  <th className="px-4 py-3 text-left font-medium">Destinataires</th>
                  <th className="px-4 py-3 text-left font-medium hidden sm:table-cell">Type</th>
                  <th className="px-4 py-3 text-left font-medium">Statut</th>
                </tr>
              </thead>
              <tbody>
                {campagnes.map((c) => {
                  const typeCamp = TYPES_CAMPAGNE[c.type] || TYPES_CAMPAGNE.annonce;
                  return (
                    <tr key={c.id} className="border-b hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <p className="font-medium">{c.titre || c.objetMessage}</p>
                        <p className="text-xs text-muted-foreground truncate max-w-[200px]">{c.objetMessage}</p>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{c.dateEnvoi ? new Date(c.dateEnvoi).toLocaleDateString('fr-FR') : '—'}</td>
                      <td className="px-4 py-3"><Badge variant="outline" className="text-xs">{c.statistiques?.nbEnvoyes || 0} clients</Badge></td>
                      <td className="px-4 py-3 hidden sm:table-cell"><Badge className={`text-[10px] ${typeCamp.color}`}>{typeCamp.label}</Badge></td>
                      <td className="px-4 py-3"><Badge className="text-[10px] bg-emerald-100 text-emerald-700">Envoyée</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );

  /* ─── RENDER ─── */
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Prospection</h2>
          <p className="text-muted-foreground">{stats.total} prospects — {stats.convertis} convertis</p>
        </div>
        <div className="flex gap-2">
          {canManage && (
            <Button variant="outline" className="gap-2" onClick={() => { setCampagneForm(emptyCampagne); setShowCampagne(true); }}>
              <Megaphone className="h-4 w-4" /> Envoyer une prospection
            </Button>
          )}
          {canWrite && <Button className="gap-2" onClick={openAdd}><Plus className="h-4 w-4" /> Nouveau prospect</Button>}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {[
          { key: 'prospects', label: 'Prospects', icon: Target },
          { key: 'campagnes', label: '📢 Campagnes', icon: Megaphone },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => setActiveTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'prospects' ? renderProspects() : renderCampagnes()}

      {/* ─── MODALS ─── */}

      {/* Create/Edit prospect form */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editItem ? 'Modifier le prospect' : 'Nouveau prospect'}</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Type</label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TYPES_PROSPECT.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Source</label>
                <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SOURCES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Nom / Entreprise *</label>
              <Input value={form.nomOuEntreprise} onChange={(e) => setForm({ ...form, nomOuEntreprise: e.target.value })} placeholder="Nom de l'entreprise ou du particulier" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Personne de contact</label>
              <Input value={form.contactNom} onChange={(e) => setForm({ ...form, contactNom: e.target.value })} placeholder="Prénom et nom du responsable" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Téléphone *</label>
                <Input value={form.telephone} onChange={(e) => setForm({ ...form, telephone: e.target.value })} placeholder="+241 0XX XX XX" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Email</label>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="email@exemple.com" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Secteur d'activité</label>
                <Select value={form.secteurActivite} onValueChange={(v) => setForm({ ...form, secteurActivite: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SECTEURS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Statut</label>
                <Select value={form.statut} onValueChange={(v) => setForm({ ...form, statut: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(STATUTS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Adresse</label>
                <Input value={form.adresse} onChange={(e) => setForm({ ...form, adresse: e.target.value })} placeholder="Moanda, Gabon" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Localisation</label>
                <Input value={form.localisation} onChange={(e) => setForm({ ...form, localisation: e.target.value })} placeholder="Ex: Carrefour Shell" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Budget estimé (FCFA)</label>
                <Input type="number" value={form.budgetEstime} onChange={(e) => setForm({ ...form, budgetEstime: e.target.value })} placeholder="0" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Date de relance</label>
                <Input type="date" value={form.dateProchainContact} onChange={(e) => setForm({ ...form, dateProchainContact: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Responsable interne</label>
              <Select value={form.responsableInterne} onValueChange={(v) => setForm({ ...form, responsableInterne: v })}>
                <SelectTrigger><SelectValue placeholder="Aucun assigné" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Aucun</SelectItem>
                  {employes.map((e) => <SelectItem key={e.id} value={e.id}>{e.prenom} {e.nom}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Besoins identifiés</label>
              <div className="flex flex-wrap gap-1.5">
                {SERVICES_IMPR.map((s) => {
                  const selected = form.besoinsIdentifies.includes(s);
                  return (
                    <button key={s} type="button"
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${selected ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted'}`}
                      onClick={() => {
                        setForm({ ...form, besoinsIdentifies: selected ? form.besoinsIdentifies.filter((b) => b !== s) : [...form.besoinsIdentifies, s] });
                      }}>
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Notes</label>
              <textarea className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notes sur ce prospect..." />
            </div>
            <div className="flex gap-3">
              <Button className="flex-1" onClick={handleSave}>{editItem ? 'Enregistrer' : 'Ajouter'}</Button>
              {editItem && canDelete && <Button variant="destructive" onClick={() => { handleDelete(editItem); setShowForm(false); }}><Trash2 className="h-4 w-4" /></Button>}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Interaction modal */}
      <Dialog open={!!showInteraction} onOpenChange={() => setShowInteraction(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Ajouter une interaction — {showInteraction ? getName(showInteraction) : ''}</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Type d'interaction</label>
              <div className="flex flex-wrap gap-2">
                {Object.entries(TYPES_INTERACTION).map(([key, { label, icon: Icon, color }]) => (
                  <button key={key} type="button"
                    className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${interactionForm.type === key ? 'bg-primary text-white border-primary' : 'hover:bg-muted'}`}
                    onClick={() => setInteractionForm({ ...interactionForm, type: key })}>
                    <Icon className="h-3.5 w-3.5" /> {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Résumé *</label>
              <textarea className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={interactionForm.resume} onChange={(e) => setInteractionForm({ ...interactionForm, resume: e.target.value })}
                placeholder="Résumé de l'échange..." />
            </div>
            <Button className="w-full" onClick={addInteraction}>Enregistrer l'interaction</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Campaign modal */}
      <Dialog open={showCampagne} onOpenChange={setShowCampagne}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Megaphone className="h-5 w-5" /> Nouvelle campagne de prospection</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            {/* Step 1: Content */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">1. Contenu du message</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Titre de la campagne</label>
                  <Input value={campagneForm.titre} onChange={(e) => setCampagneForm({ ...campagneForm, titre: e.target.value })} placeholder="Ex: Promo Rentrée 2026" />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Type</label>
                  <Select value={campagneForm.type} onValueChange={(v) => setCampagneForm({ ...campagneForm, type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(TYPES_CAMPAGNE).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Objet du message (visible par les clients) *</label>
                <Input value={campagneForm.objetMessage} onChange={(e) => setCampagneForm({ ...campagneForm, objetMessage: e.target.value })} placeholder="🎉 Offre spéciale — ..." />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Corps du message *</label>
                <textarea className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={campagneForm.message} onChange={(e) => setCampagneForm({ ...campagneForm, message: e.target.value })}
                  placeholder="Chers clients,&#10;&#10;Nous avons le plaisir de vous annoncer..." />
              </div>
            </div>

            {/* Step 2: Recipients */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">2. Destinataires</h4>
              <div className="grid gap-2 sm:grid-cols-3">
                {[
                  { value: 'tous', label: 'Tous les clients', desc: `${clients.length} clients` },
                  { value: 'segment', label: 'Par segment', desc: 'Filtrer par type' },
                  { value: 'selection', label: 'Sélection manuelle', desc: 'Choisir individuellement' },
                ].map((opt) => (
                  <button key={opt.value} type="button"
                    className={`rounded-lg border p-3 text-left transition-all ${campagneForm.destinatairesMode === opt.value ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted'}`}
                    onClick={() => setCampagneForm({ ...campagneForm, destinatairesMode: opt.value })}>
                    <p className="text-sm font-medium">{opt.label}</p>
                    <p className="text-[10px] text-muted-foreground">{opt.desc}</p>
                  </button>
                ))}
              </div>

              {campagneForm.destinatairesMode === 'segment' && (
                <Select value={campagneForm.segment} onValueChange={(v) => setCampagneForm({ ...campagneForm, segment: v })}>
                  <SelectTrigger><SelectValue placeholder="Choisir un segment" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="entreprises">Entreprises ({clients.filter((c) => c.type === 'entreprise').length})</SelectItem>
                    <SelectItem value="particuliers">Particuliers ({clients.filter((c) => c.type === 'particulier').length})</SelectItem>
                    <SelectItem value="actifs">Clients actifs ({clients.length})</SelectItem>
                  </SelectContent>
                </Select>
              )}

              {campagneForm.destinatairesMode === 'selection' && (
                <div className="max-h-48 overflow-y-auto rounded-lg border p-2 space-y-1">
                  {clients.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 rounded-lg p-2 hover:bg-muted cursor-pointer">
                      <input type="checkbox" className="rounded border-gray-300"
                        checked={campagneForm.clientsIds.includes(c.id)}
                        onChange={(e) => {
                          setCampagneForm({
                            ...campagneForm,
                            clientsIds: e.target.checked ? [...campagneForm.clientsIds, c.id] : campagneForm.clientsIds.filter((id) => id !== c.id),
                          });
                        }} />
                      <span className="text-sm">{c.nom}</span>
                      {c.telephone && <span className="text-xs text-muted-foreground ml-auto">{c.telephone}</span>}
                    </label>
                  ))}
                </div>
              )}

              <p className="text-sm text-muted-foreground">
                Ce message sera envoyé à <strong>
                  {campagneForm.destinatairesMode === 'tous' ? clients.length :
                    campagneForm.destinatairesMode === 'selection' ? campagneForm.clientsIds.length :
                      campagneForm.segment === 'entreprises' ? clients.filter((c) => c.type === 'entreprise').length :
                        campagneForm.segment === 'particuliers' ? clients.filter((c) => c.type === 'particulier').length :
                          clients.length}
                </strong> client(s)
              </p>
            </div>

            {/* Step 3: Send */}
            <div className="space-y-3 border-t pt-3">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">3. Envoi</h4>
              <div className="flex gap-3">
                <Button className="flex-1 gap-2" onClick={handleSendCampagne}>
                  <Send className="h-4 w-4" /> Envoyer via messagerie app
                </Button>
                <Button variant="outline" className="gap-2" onClick={copyCampagneMessage}>
                  <Copy className="h-4 w-4" /> Copier le message
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Detail modal */}
      {renderDetailModal()}
    </div>
  );
}
