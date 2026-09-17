import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { db } from '@/services/db';
import { supabase, USE_SUPABASE } from '@/services/supabase';
import { useAuth } from '@/services/auth';
import { useChargeur, executerAction, messageEchecAction } from '@/services/chargement';
import { EnChargement, EchecChargement } from '@/features/partages/etat-chargement';
import { Card, CardContent } from '@/components/ui/card';
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
  notifyCommandeAnnulee,
  notifyFactureDisponible,
  notifyTacheAssignee,
  notifyRappelOperateur,
} from '@/services/notifications';
import { syncClientFromCommande } from '@/services/sync-clients';
import { syncCommandeToRapport } from '@/services/sync-commande-rapport';
import { syncStockFromCommande } from '@/services/sync-stock-commande';
import { exportBonTravail } from '@/services/export-pdf';
import { todayISO } from '@/lib/dates';
import { creerVerrouExecution } from '@/services/execution-unique';
import {
  doitDeclencherLivraison,
  doitContrePasser,
  estStatutAnnulee,
  resumerEffets,
  referenceEffet,
  suppressionAutorisee,
  commandesPurgeables,
  ressembleACommandeTest,
} from '@/services/livraison-commande';
import { contrePasserCommande, messageAnnulationClient } from '@/services/contre-passation-commande';
// La règle « fiche client → compte portail » n'existe qu'ici. Voir le fichier.
import { resoudreCompteClient } from '@/services/compte-client';

/**
 * Verrou d'execution — une seule transition de statut a la fois PAR COMMANDE.
 *
 * Le `disabled` du bouton protege l'utilisateur ; ce verrou protege l'argent.
 * Il couvre les chemins que `disabled` ne voit pas : les DEUX boutons
 * « Livrée » (liste et panneau de detail) rendus simultanement, le double
 * montage de React.StrictMode, et un clic pendant que l'evenement Realtime
 * rafraichit la ligne. Declare hors du composant : un remontage ne le perd pas.
 */
const verrouCommande = creerVerrouExecution();

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

// Une commande est en retard si son echeance est passee et qu'elle n'est ni livree ni annulee
function isCommandeEnRetard(cmd) {
  if (!cmd.date_echeance) return false;
  const statut = (cmd.statut || '').toLowerCase();
  if (statut.includes('livr') || statut.includes('annul')) return false;
  const today = new Date().toISOString().slice(0, 10);
  return cmd.date_echeance < today;
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

// ── Ou sont passes les messages de notification client ? ──────────────────
//
// Une constante `NOTIF_CLIENT_MESSAGES` vivait ici, DECLAREE ET JAMAIS LUE.
// Elle contenait cinq textes, dont celui de l'annulation — la preuve que la
// notification d'annulation avait ete prevue, puis jamais branchee : le client
// dont la commande etait annulee a l'atelier ne recevait rien.
//
// Garder une seconde source de textes a cote de `src/services/notifications.js`
// ne pouvait que reproduire la panne. Les quatre premiers textes existent deja
// dans ce service (notifyCommandeValidee / Production / Prete / Livree). Le
// cinquieme — « Votre commande a été annulée. Contactez-nous pour plus
// d'informations. » — a ete repris, etoffe et rendu conditionnel : il dit
// maintenant QUI appeler, OU aller, et ce qu'il advient de l'argent quand
// celui-ci a ete contre-passe. Voir `messageAnnulationClient()` dans
// src/services/contre-passation-commande.js.

export default function Commandes() {
  const { hasPermission, user: currentUser, isAdmin, isManager } = useAuth();
  const isEmploye = currentUser?.role === 'employe';
  const canWrite = hasPermission('commandes', 'write'); // Employé peut aussi créer (commande comptoir)
  const canWriteAdmin = isAdmin || isManager; // Seuls admin/manager modifient prix, suppriment, etc.
  const canChangeStatut = isAdmin || isManager || isEmploye;
  const [commandes, setCommandes] = useState([]);
  const [clients, setClients] = useState([]);
  const [employes, setEmployes] = useState([]);
  const [search, setSearch] = useState('');
  const [filterStatut, setFilterStatut] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [showDetail, setShowDetail] = useState(null);
  const [editItem, setEditItem] = useState(null);
  const [commentaireClient, setCommentaireClient] = useState('');
  const [noteInterne, setNoteInterne] = useState('');
  // Identifiant de la commande dont une transition de statut est EN COURS.
  // Sert a griser les boutons : sans lui, un double-clic sur « Livrée »
  // comptait deux fois le CA, la sortie de stock, l'encaissement et les points
  // (constat C3 / 8a.1).
  const [commandeEnCours, setCommandeEnCours] = useState(null);
  const showDetailRef = useRef(null);
  const [form, setForm] = useState({
    client_id: '',
    client_nom: '',
    client_tel: '',
    description: '',
    date_echeance: '',
    lignes: [{ description: '', quantite: 1, prix_unitaire: 0 }],
  });

  // `listOuLeve()` : sur une coupure, `list()` rendait `[]` et l'ecran
  // annoncait « Aucune commande ». Un atelier qui a dix commandes en cours lit
  // alors qu'il n'en a aucune — et personne ne sait si la base a ete videe ou
  // si c'est le reseau. Le `try` est dans `useChargeur`.
  const load = useCallback(async () => {
    const [c, cl, em] = await Promise.all([
      db.commandes.listOuLeve(), db.clients.listOuLeve(), db.employes.listOuLeve(),
    ]);
    setCommandes(c.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')));
    setClients(cl);
    // Dedoublonnage : la base peut contenir plusieurs enregistrements pour la meme
    // personne (seed multiple). On garde un seul par (prenom+nom+role) normalise.
    const staff = em.filter((e) => ['employe', 'manager', 'admin'].includes(e.role));
    const seen = new Set();
    const uniqueStaff = staff.filter((e) => {
      const key = `${(e.prenom || '').trim().toLowerCase()}|${(e.nom || '').trim().toLowerCase()}|${e.role}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    setEmployes(uniqueStaff);
  }, []);

  const { enCours: loading, erreur: erreurChargement, recharger } = useChargeur(load);

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
    // Numéro unique anti-collision (length+1 provoquait des doublons)
    const num = `CMD-${Date.now().toString(36).toUpperCase().slice(-6)}`;
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

    const { ok } = await executerAction(async () => {
      if (editItem) {
        await db.commandes.update(editItem.id, data);
      } else {
        await db.commandes.create(data);
        // Notifier le staff de la nouvelle commande
        notifyNouvelleCommande(data.client_nom || 'Client');
      }
    }, {
      succes: editItem ? 'Commande modifiée' : 'Commande créée',
      quoi: `La commande de ${data.client_nom}`,
    });
    // Le formulaire reste OUVERT sur un echec : les lignes saisies ne sont pas
    // perdues, il suffit de reappuyer une fois la connexion revenue.
    if (!ok) return;
    // Sync client auto
    syncClientFromCommande({
      client_id: data.client_id,
      client_nom: data.client_nom,
      client_tel: data.client_tel,
      source: 'commande_admin',
    }).catch(() => {});
    setShowForm(false);
    recharger();
  };

  // ═══════════════════════════════════════════════════════════════════════════
  //  CHANGEMENT DE STATUT — ET LIVRAISON
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // ⚠️ Passer une commande a « Livrée » ecrit de l'argent a SIX endroits :
  //    facture, tresorerie, stock, points de fidelite, rapport journalier,
  //    tache liee. Lire src/services/livraison-commande.js avant de modifier
  //    ce bloc.
  //
  // Trois regles tenues ici :
  //   1. UN SEUL changement de statut a la fois par commande. Le `disabled` des
  //      boutons protege l'utilisateur, le verrou protege l'argent (les deux
  //      boutons « Livrée » — liste et detail — sont rendus en meme temps).
  //   2. Les six effets sont ATTENDUS (`Promise.allSettled`), plus jamais
  //      lances dans le vide avec `.catch(console.error)`. Un echec est nomme.
  //   3. `livraison_traitee` n'est pose QUE si les six ont reussi. Avant, il
  //      etait pose AVANT de les lancer : un effet manque etait perdu pour
  //      toujours. Chaque effet etant desormais idempotent, une reprise ne
  //      double rien.

  /** Cloture la tache liee a la commande, s'il y en a une. */
  const cloturerTacheLiee = async (cmd) => {
    const allTaches = await db.taches.list();
    const tache = allTaches.find((t) => t.commande_id === cmd.id);
    if (!tache) return { fait: false, motif: 'aucune tâche liée' };
    if (tache.statut === 'terminee' || tache.statut === 'validee') {
      return { fait: false, motif: 'tâche déjà close' };
    }
    await db.taches.update(tache.id, { statut: 'terminee', progression: 100 });
    return { fait: true };
  };

  /**
   * Genere la facture de livraison. Idempotent : si une facture existe deja
   * pour cette commande, on ne la recree pas (et ce n'est pas une erreur).
   */
  const genererFactureLivraison = async (cmd) => {
    const allFactures = await db.factures.list();
    if (allFactures.some((f) => f.commande_id === cmd.id)) {
      return { fait: false, motif: 'facture déjà émise' };
    }

    const num = `OG-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase().slice(-6)}`;
    // Les deux schemas de ligne coexistent en base : `quantite`/`prix_unitaire`
    // (comptoir) et `qte`/`prix` (portail client). Ignorer le second facturait
    // « 1 × » une commande de 500 flyers (constat E7/6.5).
    const lignes = (cmd.lignes || cmd.produits || []).map((l) => ({
      description: l.description || l.nom || l.designation || 'Article',
      quantite: Number(l.quantite ?? l.qte ?? 1) || 1,
      prix_unitaire: Number(l.prix_unitaire ?? l.prix ?? 0) || 0,
    }));
    if (lignes.length === 0 && (cmd.montant_total || cmd.total)) {
      lignes.push({
        description: cmd.description || cmd.service || 'Commande',
        quantite: 1,
        prix_unitaire: cmd.montant_total || cmd.total || 0,
      });
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
      // `total` est lu par clients/page.jsx:92 pour le CA par client, qui
      // affichait 0 F faute de ce champ (constat E6).
      total: cmd.montant_total || cmd.total || 0,
      statut: 'envoyee',
      date_commande: cmd.created_at?.slice(0, 10) || '',
      // `todayISO()` et non `toISOString()` : entre 00 h et 01 h heure de
      // Libreville, la facture — document legal — portait la date de la veille.
      date_livraison: todayISO(),
      date: todayISO(),
    });

    if (cmd.client_id) notifyFactureDisponible(cmd.client_id, num);

    // Depot dans la messagerie : confort, jamais bloquant.
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
    } catch (err) {
      console.error('Facture deposee en base mais message client non envoye :', err);
    }

    return { fait: true, facture };
  };

  /**
   * Lance les six effets de livraison et rend un verdict nomme.
   * Aucun n'est « lance dans le vide » : tous sont attendus.
   */
  const executerEffetsLivraison = async (cmd) => {
    const effets = [
      ['facture', () => genererFactureLivraison(cmd)],
      ['encaissement', () => encaisserCommande(cmd)],
      ['stock', () => syncStockFromCommande(cmd)],
      ['fidelite', () => crediterPointsFidelite(cmd)],
      ['rapport', () => syncCommandeToRapport(cmd)],
      ['tache', () => cloturerTacheLiee(cmd)],
    ];
    const resultats = await Promise.allSettled(effets.map(([, fn]) => fn()));
    return resumerEffets(effets.map(([cle], i) => ({ cle, resultat: resultats[i] })));
  };

  const handleStatutChange = (cmd, newStatut) =>
    verrouCommande.executerUneSeuleFois(`statut:${cmd.id}`, async () => {
      setCommandeEnCours(cmd.id);
      try {
        const auteur = `${currentUser?.prenom || ''} ${currentUser?.nom || ''}`.trim();
        const historique = [...(cmd.historique_statuts || []), {
          statut: newStatut,
          date: new Date().toISOString(),
          auteur,
        }];

        // On relit la commande EN BASE avant de decider : l'ancienne garde
        // lisait l'objet du rendu, qui peut dater d'avant un autre appareil.
        const enBase = (await db.commandes.getById(cmd.id)) || cmd;
        const declencheLivraison = doitDeclencherLivraison(enBase, newStatut);
        const contrePassation = doitContrePasser(enBase, newStatut);
        // Une commande DEJA annulee en base ne re-previent pas le client : le
        // verrou couvre le double-clic, cette garde couvre le second passage
        // volontaire (deux appareils, ou un « Annuler » reclique plus tard).
        const annulationNouvelle = estStatutAnnulee(newStatut) && !estStatutAnnulee(enBase?.statut);

        await db.commandes.update(cmd.id, { statut: newStatut, historique_statuts: historique });

        if (cmd.client_id) {
          if (newStatut === 'validee_attente_paiement') notifyCommandeValidee(cmd.client_id);
          else if (newStatut === 'en_production') notifyCommandeProduction(cmd.client_id);
          else if (newStatut === 'prete') notifyCommandePrete(cmd.client_id);
          else if (newStatut === 'livree') notifyCommandeLivree(cmd.client_id);
          // L'annulation est notifiee PLUS BAS, apres la contre-passation :
          // son texte depend de ce qui a reellement ete repris.
        }

        // Ce que la contre-passation a effectivement repris. Reste `null` si
        // elle n'a pas eu lieu ou si elle a echoue — le message au client ne
        // promet alors aucun remboursement.
        let repris = null;
        let contrePassationEchouee = false;

        if (declencheLivraison) {
          const verdict = await executerEffetsLivraison(enBase);
          if (verdict.tousReussis) {
            // Le drapeau n'est pose qu'ICI : apres, et seulement en cas de
            // succes complet.
            await db.commandes.update(cmd.id, { livraison_traitee: true });
            toast.success(`Commande passee a "${getStatut(newStatut).label}"`);
          } else {
            toast.error(verdict.message, { duration: 12000 });
          }
        } else if (contrePassation) {
          try {
            const { effets, montantRepris } = await contrePasserCommande(enBase, db);
            repris = { effets, montantRepris };
            await db.commandes.update(cmd.id, {
              livraison_traitee: false,
              contre_passee_le: new Date().toISOString(),
            });
            toast.success(
              effets.length
                ? `Commande annulée — contre-passé : ${effets.join(', ')}.`
                : 'Commande annulée (rien à contre-passer).',
              { duration: 8000 },
            );
          } catch (err) {
            contrePassationEchouee = true;
            toast.error(
              `Commande annulée, mais la contre-passation a échoué : ${err?.message || err}. `
              + 'L\'argent de cette commande est encore dans la trésorerie — à reprendre à la main.',
              { duration: 15000 },
            );
          }
        } else {
          toast.success(`Commande passee a "${getStatut(newStatut).label}"`);
        }

        // ── Prevenir le client de l'annulation ──────────────────────────────
        //
        // Placee APRES la contre-passation, et jamais avant : le message doit
        // dire ce qui a REELLEMENT ete repris. Annoncer un remboursement qui
        // n'a pas eu lieu ferait attendre un client devant le comptoir.
        //
        // Aucune exception ne remonte d'ici : annuler une commande est une
        // operation metier, prevenir est un confort. Si la notification
        // echoue, l'annulation reste faite — et l'echec se voit, pour que le
        // gerant decroche son telephone.
        if (annulationNouvelle && cmd.client_id) {
          const aAppeler = `${cmd.client_nom || 'le client'} ${cmd.client_tel || ''}`.trim();
          try {
            const resultat = await notifyCommandeAnnulee(
              cmd.client_id,
              messageAnnulationClient({
                commande: enBase,
                effets: repris?.effets || [],
                montantRepris: repris?.montantRepris || 0,
                contrePassationEchouee,
              }),
              { commande_id: cmd.id, commande_numero: enBase.numero || cmd.numero || '' },
            );
            if (!resultat?.envoyee) {
              toast.error(
                'Commande annulée, mais le client n\'a pas été prévenu '
                + `(${resultat?.erreur || 'cause inconnue'}). Appelez-le : ${aAppeler}`,
                { duration: 15000 },
              );
            }
          } catch (err) {
            console.error('Notification d\'annulation non envoyée :', err);
            toast.error(
              `Commande annulée, mais le client n'a pas été prévenu. Appelez-le : ${aAppeler}`,
              { duration: 15000 },
            );
          }
        }

        await recharger();
        const updated = await db.commandes.getById(cmd.id);
        if (updated) setShowDetail(updated);
      } catch (e) {
        // Sans ce `catch`, l'echec du `db.commandes.update()` ci-dessus sortait
        // du handler par un rejet non rattrape : les boutons sont appeles sans
        // `await` depuis le JSX (voir les avertissements « promesse perdue »),
        // et le gerant voyait la commande revenir a son ancien statut sans un
        // mot — ou, pour une erreur qui n'est pas un ErreurEcriture, rien du
        // tout, le filet global ne reconnaissant que celles-la.
        console.error('[commandes] changement de statut refusé :', e);
        toast.error(
          messageEchecAction(e, `Le passage de la commande ${cmd.numero || ''} à « ${getStatut(newStatut).label} »`),
          { duration: 12000 },
        );
      } finally {
        setCommandeEnCours(null);
      }
    });

  // ── Encaissement : créditer la trésorerie à la livraison ──
  // Crée un mouvement d'entrée sur le compte encaisseur (Caisse par défaut, ou le
  // compte de l'opérateur de paiement Mobile Money) + crédite le solde.
  // Idempotent via reference 'commande:<id>'. Skip si déjà encaissé via SingPay.
  const encaisserCommande = async (cmd) => {
    const montant = cmd.montant_total || cmd.total || 0;
    if (montant <= 0) return;
    const mouvements = await db.mouvements_financiers.list();
    const refCmd = referenceEffet(cmd, 'encaissement');
    if (!refCmd) throw new Error('commande sans identifiant : encaissement impossible');
    const refSingpay = cmd.singpay_reference ? `singpay:${cmd.singpay_reference}` : null;
    // Déjà encaissé (par cette commande OU par le callback SingPay) ?
    if (mouvements.some((m) => m.reference === refCmd || (refSingpay && m.reference === refSingpay) || (m.categorie === 'encaissement_singpay' && m.description?.includes(cmd.numero)))) return;

    const comptes = await db.comptes_bancaires.list();
    const findCompte = (kw) => comptes.find((c) => (c.nom || '').toLowerCase().includes(kw));
    // Compte selon l'opérateur de paiement, sinon Caisse/Liquide, sinon FINAM
    let compte = null;
    const op = (cmd.operateur_paiement || '').toLowerCase();
    if (op.includes('finam')) compte = findCompte('finam');
    else if (op.includes('bgfi')) compte = findCompte('bgfi');
    else if (op.includes('airtel')) compte = findCompte('airtel');
    else if (op.includes('moov')) compte = findCompte('moov');
    compte = compte || findCompte('caisse') || findCompte('liquide') || findCompte('finam') || comptes[0];
    // Sans compte, l'encaissement ne peut pas etre trace. C'est un echec, pas un
    // non-evenement : le silence d'avant laissait de l'argent hors des livres.
    if (!compte) {
      throw new Error(
        'Aucun compte de trésorerie n\'est configuré : l\'encaissement ne peut pas être '
        + 'enregistré. Créez au moins un compte « Caisse » dans Finances.',
      );
    }

    await db.mouvements_financiers.create({
      type: 'entree',
      montant,
      description: `Encaissement commande ${cmd.numero || ''} — ${cmd.client_nom || 'Client'}`,
      compte_id: compte.id,
      // `todayISO()` : `toISOString()` datait l'encaissement de la veille entre
      // 00 h et 01 h heure de Libreville.
      date: todayISO(),
      reference: refCmd,
      categorie: 'encaissement_commande',
      source: 'commande',
      pointe: true,
    });
    await db.comptes_bancaires.update(compte.id, { solde: (compte.solde || 0) + montant });
  };

  // ── Valider la commande (sans points — les points sont crédités à la livraison) ──
  const handleValider = async (cmd) => {
    await handleStatutChange(cmd, 'validee_attente_paiement');
  };

  /**
   * Credite les points de fidelite a la LIVRAISON.
   *
   * ⚠️ IDEMPOTENT. Chaque ligne d'historique ecrite ici porte `commande_id`.
   * Avant d'ecrire, on verifie qu'aucune ligne ne porte deja cet identifiant :
   * un double-clic, ou une reprise apres un echec partiel, ne credite plus deux
   * fois (constat 8a.1). C'est aussi cette marque que lit la contre-passation
   * pour savoir exactement combien de points retirer a l'annulation.
   *
   * ⚠️ LEVE en cas d'echec — le `catch` qui avalait tout faisait croire au
   * gerant que les points etaient credites (constat C4).
   */
  const crediterPointsFidelite = async (cmd) => {
    if (!cmd.client_id) return { fait: false, motif: 'commande sans client' };

    const allFidelite = await db.fidelite_clients.list();
    let fidelite = allFidelite.find((f) => f.client_id === cmd.client_id);

    if (fidelite && (fidelite.historique || []).some((h) => h.commande_id === cmd.id)) {
      return { fait: false, motif: 'points déjà crédités pour cette commande' };
    }

    {

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
          hist.push({ type: 'premiere_commande', points: 100, description: 'Bonus premiere commande', date: new Date().toISOString(), commande_id: cmd.id });
        }
        if (pointsCommande > 0) {
          hist.push({ type: 'commande', points: pointsCommande, description: `Commande ${cmd.numero || 'CMD'} livrée — ${fmt(montant)} F`, date: new Date().toISOString(), commande_id: cmd.id });
        }
        if (pointsEvt > 0 && bonusEvt) {
          hist.push({ type: 'bonus_evenement', points: pointsEvt, description: bonusEvt.label, date: new Date().toISOString(), commande_id: cmd.id });
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
          // `cmd.client_id` porte l'identifiant du COMPTE pour une commande du
          // portail, et celui de la FICHE pour une commande du comptoir. Ne
          // regarder que `id` laissait 100 % des commandes du portail sans
          // parrain — et le programme de parrainage muet.
          //
          // Cette règle était écrite ici une SECONDE fois, à la main. Elle
          // n'existe plus qu'à un endroit : `src/services/compte-client.js`.
          const client = resoudreCompteClient(allClients, cmd.client_id).fiche;
          if (client?.parraine_par) {
            const parrain = allClients.find((e) => e.code_parrainage === client.parraine_par);
            if (parrain) {
              const cibleParrain = resoudreCompteClient(allClients, parrain.id);
              // Clé du dossier fidélité : le compte quand il existe, la fiche
              // sinon. C'est ainsi que les dossiers existants ont été écrits —
              // `compteId || parrain.id` rend exactement ce que rendait
              // `parrain.user_id || parrain.id`, sans recopier la règle.
              const idParrain = cibleParrain.compteId || parrain.id;
              const parrainFid = allFidelite.find((f) => f.client_id === idParrain);
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
                // Les points sont crédités quoi qu'il arrive ; seule la
                // notification dépend d'un compte portail. Écrire une ligne sur
                // un id de fiche, c'est écrire une ligne que personne ne lira.
                if (cibleParrain.compteId) {
                  await db.notifications_app.create({
                    type: 'parrainage_bonus',
                    titre: `🎁 +${BONUS_PARRAINAGE} points parrainage !`,
                    message: `${cmd.client_nom} a passé sa première commande. Vous gagnez ${BONUS_PARRAINAGE} points de fidélité !`,
                    destinataire: 'client',
                    destinataire_id: cibleParrain.compteId,
                    lu: false,
                  });
                } else if (cibleParrain.raison) {
                  toast.warning(`Points de parrainage crédités — ${cibleParrain.raison}`, { duration: 12000 });
                }
              }
            }
          }
        }
        return { fait: true, points: totalPoints };
      }
    }
    return { fait: false, motif: 'aucun point à créditer' };
  };

  // ── Annuler la commande ──
  // L'annulation d'une commande LIVREE contre-passe desormais ses ecritures
  // d'argent (constat C5 / 8b.1). Le detail est dans handleStatutChange.
  const handleAnnuler = async (cmd) => {
    const livree = cmd.livraison_traitee === true || normalizeStatut(cmd.statut) === 'livree';
    const question = livree
      ? `Annuler la commande ${cmd.numero || ''} ?\n\n`
        + 'Elle a été livrée : l\'encaissement, la sortie de stock, les points de '
        + 'fidélité et la facture vont être contre-passés (écritures inverses, '
        + 'rien n\'est supprimé).'
      : 'Êtes-vous sûr de vouloir annuler cette commande ?';
    if (!confirm(question)) return;
    await handleStatutChange(cmd, 'annulee');
  };

  // ── Sauvegarder commentaire/note ──
  const handleSaveComments = async (cmd) => {
    const { ok } = await executerAction(
      () => db.commandes.update(cmd.id, {
        commentaire_client: commentaireClient,
        note_interne: noteInterne,
      }),
      { succes: 'Commentaires enregistrés', quoi: 'Le commentaire' },
    );
    if (!ok) return;
    const updated = await db.commandes.getById(cmd.id);
    if (updated) setShowDetail(updated);
    recharger();
  };

  /**
   * Suppression definitive.
   *
   * Constat 8b.2 : supprimer une commande livree laissait en base son mouvement
   * de tresorerie, sa facture et sa sortie de stock — ET detruisait la reference
   * d'idempotence `commande:<id>`, si bien qu'une re-saisie re-encaissait le
   * meme argent. La suppression est donc refusee des qu'il y a de l'argent en
   * jeu, avec un motif qui dit quoi faire a la place.
   */
  const handleDelete = async (cmd) => {
    const { autorise, motif } = suppressionAutorisee(cmd);
    if (!autorise) { toast.error(motif, { duration: 12000 }); return; }
    if (!confirm(`Supprimer définitivement la commande ${cmd.numero || ''} ?\nClient : ${cmd.client_nom}\nMontant : ${fmt(cmd.montant_total || cmd.total)} F`)) return;
    setCommandeEnCours(cmd.id);
    try {
      const { ok } = await executerAction(
        () => db.commandes.delete(cmd.id),
        { succes: 'Commande supprimée', quoi: `La suppression de la commande ${cmd.numero || ''}` },
      );
      if (ok) await recharger();
    } finally {
      setCommandeEnCours(null);
    }
  };

  // ── Assignation à un opérateur + auto-création tâche ──
  const handleAssignCommande = async (cmd, employeId) => {
    const employe = employes.find((e) => e.id === employeId);
    const assigneNom = employe ? `${employe.prenom || ''} ${employe.nom || ''}`.trim() : '';

    // 1) Mise a jour de la commande
    await db.commandes.update(cmd.id, {
      assignee_id: employeId || null,
      assignee_nom: assigneNom,
      historique_statuts: [
        ...(cmd.historique_statuts || []),
        {
          statut: cmd.statut,
          date: new Date().toISOString(),
          auteur: `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim() || 'Admin',
          action: employeId ? `Assignée à ${assigneNom}` : 'Désassignée',
        },
      ],
    });

    if (employeId && employe) {
      // 2) Verifier si une tache existe deja pour cette commande (idempotent)
      const allTaches = await db.taches.list();
      const existing = allTaches.find((t) => t.commande_id === cmd.id);

      if (!existing) {
        // Creer une nouvelle tache liee a la commande
        await db.taches.create({
          titre: `Commande ${cmd.numero} — ${cmd.client_nom}`,
          description: cmd.description || (cmd.lignes || []).map((l) => `${l.quantite}× ${l.description}`).join('\n'),
          priorite: 'haute',
          categorie: 'Commande',
          statut: 'en_attente',
          assigne_a: employeId,
          assigne_nom: assigneNom,
          date_echeance: cmd.date_echeance || '',
          progression: 0,
          commande_id: cmd.id,
          commande_numero: cmd.numero,
        });
      } else {
        // Reassigner la tache existante
        await db.taches.update(existing.id, {
          assigne_a: employeId,
          assigne_nom: assigneNom,
        });
      }

      // 3) Notifier l'operateur cible (par user_id)
      await notifyTacheAssignee(employeId, cmd.numero, cmd.client_nom);
      toast.success(`Assignée à ${assigneNom}`);
    } else {
      // Désassignation : on retire l'assigne de la tache mais on la garde
      const allTaches = await db.taches.list();
      const existing = allTaches.find((t) => t.commande_id === cmd.id);
      if (existing) {
        await db.taches.update(existing.id, { assigne_a: '', assigne_nom: '' });
      }
      toast.success('Désassignée');
    }

    const updated = await db.commandes.getById(cmd.id);
    if (updated) setShowDetail(updated);
    recharger();
  };

  // ── Envoyer un rappel à l'opérateur assigné ──
  const handleRappelOperateur = async (cmd) => {
    if (!cmd.assignee_id) {
      toast.error('Aucun opérateur assigné');
      return;
    }
    await notifyRappelOperateur(cmd.assignee_id, cmd.numero, cmd.client_nom);
    toast.success(`Rappel envoyé à ${cmd.assignee_nom || 'l\'opérateur'}`);
  };

  /**
   * Purge des commandes d'essai.
   *
   * ⚠️ L'ancienne version supprimait EN LOT toute commande dont la description
   * contenait « test », ou dont le montant valait 0. Deux prestations reelles
   * d'imprimerie s'appellent « test couleur » et « test daltonien » : de vraies
   * commandes livrees et encaissees tombaient dans le filet, en emportant leur
   * reference d'idempotence.
   *
   * Desormais deux conditions doivent tenir ENSEMBLE :
   *   - la commande porte le drapeau EXPLICITE `est_test` (pose a la main, ou
   *     par migrations/003_marquer_commandes_test.sql) ;
   *   - et `suppressionAutorisee()` l'autorise (donc : pas livree, pas d'argent).
   *
   * Une commande qui RESSEMBLE a un essai sans porter le drapeau est signalee,
   * jamais supprimee.
   */
  const handlePurgeTests = async () => {
    const purgeables = commandesPurgeables(commandes);
    const suspectes = commandes.filter((c) => ressembleACommandeTest(c) && !purgeables.includes(c));

    if (purgeables.length === 0) {
      toast.info(
        suspectes.length
          ? `Aucune commande marquée « test » et supprimable. ${suspectes.length} commande(s) y ressemblent `
            + 'mais ne portent pas le marquage explicite : ouvrez-les et vérifiez avant de les marquer.'
          : 'Aucune commande de test à supprimer',
        { duration: 10000 },
      );
      return;
    }
    if (!confirm(`Supprimer ${purgeables.length} commande(s) marquée(s) « test » ?\n(aucune n'est livrée ni encaissée)`)) return;
    // Une purge partielle doit se dire : annoncer « 6 supprimées » quand la
    // connexion a lache a la troisieme laisserait croire la base propre.
    let supprimees = 0;
    const { ok } = await executerAction(async () => {
      for (const cmd of purgeables) {
        await db.commandes.delete(cmd.id);
        supprimees += 1;
      }
    }, {
      succes: `${purgeables.length} commande(s) de test supprimée(s)`,
      quoi: 'La suppression des commandes de test',
    });
    if (!ok && supprimees > 0) {
      toast.info(`${supprimees} commande(s) sur ${purgeables.length} ont tout de même été supprimées.`);
    }
    await recharger();
  };

  // Open detail view
  const openDetail = (cmd) => {
    setShowDetail(cmd);
    showDetailRef.current = cmd;
    setCommentaireClient(cmd.commentaire_client || '');
    setNoteInterne(cmd.note_interne || '');
  };

  if (loading) return <EnChargement />;

  // Avant les onglets et les compteurs : « Aucune commande » sur une coupure
  // est un mensonge, et c'est sur cette phrase qu'on decide d'appeler un client.
  if (erreurChargement) {
    return (
      <EchecChargement
        quoi="les commandes"
        onReessayer={recharger}
        enCours={loading}
      />
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
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        {cmd.date_echeance && <span>Échéance : {new Date(cmd.date_echeance + 'T00:00:00').toLocaleDateString('fr-FR')}</span>}
                        {isCommandeEnRetard(cmd) && (
                          <Badge className="gap-1 bg-red-100 text-red-700 text-[10px]">
                            <Clock className="h-3 w-3" /> En retard
                          </Badge>
                        )}
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
                              <Button size="sm" disabled={commandeEnCours === cmd.id} className="h-7 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={(e) => { e.stopPropagation(); handleStatutChange(cmd, 'en_production'); }}>
                                <CheckCircle2 className="h-3 w-3" /> Confirmer paiement
                              </Button>
                              <Button size="sm" variant="destructive" disabled={commandeEnCours === cmd.id} className="h-7 gap-1 text-xs" onClick={(e) => { e.stopPropagation(); handleStatutChange(cmd, 'validee_attente_paiement'); }}>
                                <XCircle className="h-3 w-3" /> Non reçu
                              </Button>
                            </>
                          )}
                          {/* Validée → En production */}
                          {normalized === 'validee_attente_paiement' && (
                            <Button size="sm" disabled={commandeEnCours === cmd.id} className="h-7 gap-1 text-xs bg-blue-600 hover:bg-blue-700" onClick={(e) => { e.stopPropagation(); handleStatutChange(cmd, 'en_production'); }}>
                              <Factory className="h-3 w-3" /> En production
                            </Button>
                          )}
                          {/* En production → Prête */}
                          {normalized === 'en_production' && (
                            <Button size="sm" disabled={commandeEnCours === cmd.id} className="h-7 gap-1 text-xs" onClick={(e) => { e.stopPropagation(); handleStatutChange(cmd, 'prete'); }}>
                              <Package className="h-3 w-3" /> Prête
                            </Button>
                          )}
                          {/* Prête → Livrée (admin/manager seulement) */}
                          {normalized === 'prete' && !isEmploye && (
                            <Button size="sm" disabled={commandeEnCours === cmd.id} className="h-7 gap-1 text-xs bg-green-600 hover:bg-green-700" onClick={(e) => { e.stopPropagation(); handleStatutChange(cmd, 'livree'); }}>
                              <Truck className="h-3 w-3" /> {commandeEnCours === cmd.id ? 'Enregistrement…' : 'Livrée'}
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
                            <Button size="sm" variant="ghost" disabled={commandeEnCours === cmd.id} className="h-7 gap-1 text-xs text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); handleAnnuler(cmd); }}>
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
                          <Button variant="ghost" size="icon" disabled={commandeEnCours === cmd.id} className="h-8 w-8 text-destructive" onClick={() => handleDelete(cmd)} title="Supprimer la commande">
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

                {/* Commentaire pour le client — Admin, Manager ET Employé */}
                {canChangeStatut && (
                  <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
                      <MessageSquare className="h-3.5 w-3.5 text-blue-500" />
                      Message au client
                      <span className="text-[10px] text-muted-foreground">(visible par le client)</span>
                    </label>
                    <Textarea
                      placeholder="Message visible par le client..."
                      value={commentaireClient}
                      onChange={(e) => setCommentaireClient(e.target.value)}
                      className="text-sm"
                      rows={2}
                    />
                  </div>
                )}

                {/* Note interne — Admin/Manager seulement */}
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

                {canChangeStatut && (commentaireClient !== (showDetail.commentaire_client || '') || noteInterne !== (showDetail.note_interne || '')) && (
                  <Button variant="outline" className="w-full gap-1.5 text-sm" onClick={() => handleSaveComments(showDetail)}>
                    💾 Enregistrer les commentaires
                  </Button>
                )}

                {/* Bon de travail atelier (PDF) */}
                {canChangeStatut && (
                  <Button variant="outline" className="w-full gap-1.5 text-sm" onClick={() => exportBonTravail(showDetail)}>
                    <FileText className="h-4 w-4" /> Imprimer le bon de travail
                  </Button>
                )}

                {/* ── Assignation à un opérateur (Admin/Manager seulement) ── */}
                {canWriteAdmin && (
                  <div className="rounded-lg border bg-blue-500/5 p-3 space-y-2">
                    <label className="flex items-center gap-1.5 text-sm font-medium">
                      <User className="h-3.5 w-3.5 text-blue-600" />
                      Opérateur assigné
                      {showDetail.assignee_nom && (
                        <Badge variant="outline" className="text-[10px] border-blue-500/40 text-blue-700">
                          {showDetail.assignee_nom}
                        </Badge>
                      )}
                    </label>
                    <div className="flex gap-2">
                      <Select
                        value={showDetail.assignee_id || '__none__'}
                        onValueChange={(v) => handleAssignCommande(showDetail, v === '__none__' ? '' : v)}
                      >
                        <SelectTrigger className="flex-1"><SelectValue placeholder="Non assignée" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">— Non assignée —</SelectItem>
                          {employes.map((e) => (
                            <SelectItem key={e.id} value={e.id}>
                              {(e.prenom || '') + ' ' + (e.nom || '')} {e.role ? `(${e.role})` : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {showDetail.assignee_id && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRappelOperateur(showDetail)}
                          className="gap-1.5 shrink-0"
                          title="Envoyer un rappel à l'opérateur"
                        >
                          <Bell className="h-3.5 w-3.5" />
                          Rappel
                        </Button>
                      )}
                    </div>
                    {showDetail.assignee_id && (
                      <p className="text-[10px] text-muted-foreground">
                        ✓ Une tâche est créée automatiquement dans le module Tâches.
                      </p>
                    )}
                  </div>
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
                      <Button disabled={commandeEnCours === showDetail.id} className="flex-1 gap-2 bg-blue-600 hover:bg-blue-700" onClick={() => handleStatutChange(showDetail, 'en_production')}>
                        <Factory className="h-4 w-4" />
                        Mettre en production
                      </Button>
                    )}
                    {/* en_production → prete — tous */}
                    {normalized === 'en_production' && (
                      <Button disabled={commandeEnCours === showDetail.id} className="flex-1 gap-2" onClick={() => handleStatutChange(showDetail, 'prete')}>
                        <Package className="h-4 w-4" />
                        Marquer &quot;Prête&quot;
                      </Button>
                    )}
                    {/* prete → livree — admin/manager seulement */}
                    {!isEmploye && normalized === 'prete' && (
                      <Button disabled={commandeEnCours === showDetail.id} className="flex-1 gap-2 bg-green-600 hover:bg-green-700" onClick={() => handleStatutChange(showDetail, 'livree')}>
                        <Truck className="h-4 w-4" />
                        {commandeEnCours === showDetail.id ? 'Enregistrement…' : 'Marquer "Livrée"'}
                      </Button>
                    )}
                    {/* Annuler — admin/manager seulement */}
                    {!isEmploye && (
                      <Button variant="destructive" disabled={commandeEnCours === showDetail.id} className="gap-1.5" onClick={() => handleAnnuler(showDetail)}>
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
