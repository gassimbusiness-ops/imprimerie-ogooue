import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '@/services/db';
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from '@/components/ui/command';
import {
  LayoutDashboard,
  FileSpreadsheet,
  Package,
  FileText,
  Users,
  UserCheck,
  Clock,
  Boxes,
  Settings,
  BarChart3,
  Wallet,
  Shield,
  Smartphone,
  MessageSquare,
  CheckSquare,
  BookOpen,
  Target,
  PieChart,
  Landmark,
  ClipboardList,
  Hammer,
  CalendarDays,
  MessageCircle,
  Tag,
  User,
  ShoppingBag,
} from 'lucide-react';

const PAGES = [
  { name: 'Tableau de bord', href: '/', icon: LayoutDashboard, keywords: 'accueil home dashboard' },
  { name: 'Rapports journaliers', href: '/rapports', icon: FileSpreadsheet, keywords: 'rapport recette depense journal' },
  { name: 'Commandes', href: '/commandes', icon: Package, keywords: 'commande order impression' },
  { name: 'Tâches', href: '/taches', icon: CheckSquare, keywords: 'tache kanban todo travail' },
  { name: 'Travaux & Projets', href: '/travaux', icon: Hammer, keywords: 'projet chantier etape' },
  { name: 'Catalogue Produits', href: '/catalogue', icon: BookOpen, keywords: 'produit service catalogue prix' },
  { name: 'Stocks', href: '/stocks', icon: Boxes, keywords: 'stock inventaire mouvement' },
  { name: 'Dashboard Financier', href: '/statistiques', icon: BarChart3, keywords: 'statistique graphique chiffre' },
  { name: 'Bilans Financiers', href: '/bilans', icon: PieChart, keywords: 'bilan rentabilite analyse' },
  { name: 'Finances', href: '/finances', icon: Landmark, keywords: 'charge dette actionnaire investissement' },
  { name: 'Objectifs', href: '/objectifs', icon: Target, keywords: 'objectif performance cible' },
  { name: 'Devis & Factures', href: '/devis-factures', icon: FileText, keywords: 'devis facture proforma' },
  { name: 'Clôture de Caisse', href: '/cloture-caisse', icon: Wallet, keywords: 'caisse cloture espece' },
  { name: 'Paiements Mobile', href: '/paiements', icon: Smartphone, keywords: 'mobile money airtel moov' },
  { name: 'Employés', href: '/employes', icon: Users, keywords: 'employe salarie personnel' },
  { name: 'Pointage', href: '/pointage', icon: Clock, keywords: 'pointage presence absence retard' },
  { name: 'Demandes RH', href: '/demandes-rh', icon: ClipboardList, keywords: 'conge avance formation demande rh' },
  { name: 'Clients', href: '/clients', icon: UserCheck, keywords: 'client contact' },
  { name: 'Tarifs Clients', href: '/tarifs-clients', icon: Tag, keywords: 'tarif prix remise reduction' },
  { name: 'Prospection', href: '/prospection', icon: Target, keywords: 'prospect pipeline commercial' },
  { name: 'Messagerie', href: '/messagerie', icon: MessageCircle, keywords: 'message whatsapp facebook chat' },
  { name: 'Événements', href: '/evenements', icon: CalendarDays, keywords: 'evenement marketing calendrier fete' },
  { name: 'Notifications SMS', href: '/notifications', icon: MessageSquare, keywords: 'sms notification envoi' },
  { name: 'Journal d\'audit', href: '/audit', icon: Shield, keywords: 'audit log trace securite' },
  { name: 'Paramètres', href: '/parametres', icon: Settings, keywords: 'parametre config reglage' },
];

export default function GlobalSearch({ open, onOpenChange }) {
  const navigate = useNavigate();
  const [clients, setClients] = useState([]);
  const [commandes, setCommandes] = useState([]);
  const [employes, setEmployes] = useState([]);
  const [query, setQuery] = useState('');

  // Load data when dialog opens
  useEffect(() => {
    if (open) {
      setQuery('');
      Promise.all([db.clients.list(), db.commandes.list(), db.employes.list()]).then(
        ([c, cmd, e]) => { setClients(c); setCommandes(cmd); setEmployes(e); },
      );
    }
  }, [open]);

  const go = useCallback((href) => {
    onOpenChange(false);
    navigate(href);
  }, [navigate, onOpenChange]);

  // Keyboard shortcut
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        onOpenChange((v) => !v);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onOpenChange]);

  const filteredClients = query.length >= 2
    ? clients.filter((c) => c.nom?.toLowerCase().includes(query.toLowerCase())).slice(0, 5)
    : [];
  const filteredCommandes = query.length >= 2
    ? commandes.filter((c) => `${c.numero || ''} ${c.client_nom || ''} ${c.description || ''}`.toLowerCase().includes(query.toLowerCase())).slice(0, 5)
    : [];
  const filteredEmployes = query.length >= 2
    ? employes.filter((e) => `${e.prenom || ''} ${e.nom || ''}`.toLowerCase().includes(query.toLowerCase())).slice(0, 5)
    : [];

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Rechercher un module, client, commande..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>Aucun résultat trouvé.</CommandEmpty>

        <CommandGroup heading="Pages">
          {PAGES.map((page) => (
            <CommandItem
              key={page.href}
              value={`${page.name} ${page.keywords}`}
              onSelect={() => go(page.href)}
            >
              <page.icon className="mr-2 h-4 w-4 text-muted-foreground" />
              {page.name}
            </CommandItem>
          ))}
        </CommandGroup>

        {filteredClients.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Clients">
              {filteredClients.map((c) => (
                <CommandItem key={c.id} value={`client ${c.nom}`} onSelect={() => go('/clients')}>
                  <User className="mr-2 h-4 w-4 text-muted-foreground" />
                  {c.nom}
                  {c.telephone && <span className="ml-auto text-xs text-muted-foreground">{c.telephone}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {filteredCommandes.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Commandes">
              {filteredCommandes.map((c) => (
                <CommandItem key={c.id} value={`commande ${c.numero} ${c.client_nom}`} onSelect={() => go('/commandes')}>
                  <ShoppingBag className="mr-2 h-4 w-4 text-muted-foreground" />
                  <span>{c.numero || 'CMD'}</span>
                  <span className="ml-2 text-muted-foreground">{c.client_nom}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {filteredEmployes.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Employés">
              {filteredEmployes.map((e) => (
                <CommandItem key={e.id} value={`employe ${e.prenom} ${e.nom}`} onSelect={() => go('/employes')}>
                  <Users className="mr-2 h-4 w-4 text-muted-foreground" />
                  {e.prenom} {e.nom}
                  {e.poste && <span className="ml-auto text-xs text-muted-foreground">{e.poste}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
