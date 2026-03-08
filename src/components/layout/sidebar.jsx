import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAuth } from '@/services/auth';
import { getSettings } from '@/services/db';
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
  ChevronDown,
  X,
  Printer,
  BarChart3,
  LogOut,
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
  TrendingUp,
} from 'lucide-react';

const NAV_GROUPS = [
  {
    label: null,
    items: [
      { name: 'Tableau de bord', href: '/', icon: LayoutDashboard, module: null },
    ],
  },
  {
    label: 'Production',
    items: [
      { name: 'Rapports journaliers', href: '/rapports', icon: FileSpreadsheet, module: 'rapports' },
      { name: 'Commandes', href: '/commandes', icon: Package, module: 'commandes' },
      { name: 'Tâches', href: '/taches', icon: CheckSquare, module: 'commandes' },
      { name: 'Travaux & Projets', href: '/travaux', icon: Hammer, module: 'statistiques' },
      { name: 'Catalogue', href: '/catalogue', icon: BookOpen, module: 'catalogue' },
      { name: 'Stocks', href: '/stocks', icon: Boxes, module: 'stocks' },
    ],
  },
  {
    label: 'Finance',
    items: [
      { name: 'Dashboard Financier', href: '/statistiques', icon: BarChart3, module: 'statistiques' },
      { name: 'Bilans', href: '/bilans', icon: PieChart, module: 'statistiques' },
      { name: 'Finances', href: '/finances', icon: Landmark, module: 'finances' },
      { name: 'Objectifs', href: '/objectifs', icon: Target, module: 'statistiques' },
      { name: 'Devis & Factures', href: '/devis-factures', icon: FileText, module: 'devis_factures' },
      { name: 'Clôture de Caisse', href: '/cloture-caisse', icon: Wallet, module: 'statistiques' },
      { name: 'Paiements Mobile', href: '/paiements', icon: Smartphone, module: 'devis_factures' },
      { name: 'Rapports & Analyses', href: '/rapports-analyses', icon: PieChart, module: 'statistiques' },
    ],
  },
  {
    label: 'Ressources humaines',
    items: [
      { name: 'Employés', href: '/employes', icon: Users, module: 'employes' },
      { name: 'Pointage', href: '/pointage', icon: Clock, module: 'pointage' },
      { name: 'Demandes RH', href: '/demandes-rh', icon: ClipboardList, module: 'employes' },
      { name: 'Performance & Dashboard RH', href: '/performance-rh', icon: BarChart3, module: 'employes' },
    ],
  },
  {
    label: 'Commercial',
    items: [
      { name: 'Clients', href: '/clients', icon: UserCheck, module: 'clients' },
      { name: 'Tarifs Clients', href: '/tarifs-clients', icon: Tag, module: 'clients' },
      { name: 'Prospection', href: '/prospection', icon: Target, module: 'clients' },
      { name: 'Messagerie', href: '/messagerie', icon: MessageCircle, module: 'clients' },
      { name: 'Événements', href: '/evenements', icon: CalendarDays, module: 'clients' },
      { name: 'Notifications SMS', href: '/notifications', icon: MessageSquare, module: 'clients' },
    ],
  },
  {
    label: 'Gouvernance',
    items: [
      { name: 'Capital & Investisseurs', href: '/gouvernance', icon: TrendingUp, module: 'gouvernance' },
      { name: 'Rapports stratégiques', href: '/rapports-analyses', icon: PieChart, module: 'statistiques' },
    ],
  },
  {
    label: 'Système',
    items: [
      { name: 'Journal d\'audit', href: '/audit', icon: Shield, module: 'parametres' },
      { name: 'Paramètres', href: '/parametres', icon: Settings, module: 'parametres' },
    ],
  },
];

function NavGroup({ group, pathname, onNavClick }) {
  const isActive = group.items.some((item) =>
    item.href === '/' ? pathname === '/' : pathname.startsWith(item.href),
  );
  const [open, setOpen] = useState(true);

  return (
    <div>
      {group.label && (
        <button
          onClick={() => setOpen(!open)}
          className="flex w-full items-center justify-between px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/40 hover:text-sidebar-foreground/60 transition-colors"
        >
          {group.label}
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 transition-transform duration-200',
              open && 'rotate-180',
            )}
          />
        </button>
      )}

      {open && (
        <div className="space-y-0.5">
          {group.items.map((item) => {
            const active =
              item.href === '/'
                ? pathname === '/'
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                to={item.href}
                onClick={onNavClick}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-150',
                  active
                    ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-sm shadow-sidebar-primary/25'
                    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground',
                )}
              >
                <item.icon className="h-[16px] w-[16px] shrink-0" />
                <span className="truncate">{item.name}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

const ROLE_LABELS = { admin: 'Administrateur', manager: 'Manager', employe: 'Employé' };

function useCompanyLogo() {
  const [logo, setLogo] = useState('');
  useEffect(() => {
    getSettings().then((s) => setLogo(s.logo || ''));
    const handler = (e) => {
      const detail = e.detail;
      if (detail?.logo !== undefined) { setLogo(detail.logo || ''); return; }
      getSettings().then((s) => setLogo(s.logo || ''));
    };
    window.addEventListener('settings-updated', handler);
    return () => window.removeEventListener('settings-updated', handler);
  }, []);
  return logo;
}

export default function Sidebar({ open, onClose }) {
  const { pathname } = useLocation();
  const { user, logout, hasPermission } = useAuth();
  const companyLogo = useCompanyLogo();

  // Filter nav groups by user permissions
  const filteredGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) =>
      item.module === null || hasPermission(item.module, 'read'),
    ),
  })).filter((group) => group.items.length > 0);

  return (
    <>
      {/* Overlay mobile */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col bg-sidebar transition-transform duration-300 lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Logo */}
        <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-4">
          <Link to="/" className="flex items-center gap-3" onClick={onClose}>
            <img
              src={companyLogo || '/logo.png'}
              alt="Imprimerie Ogooué"
              className="h-10 w-10 rounded-lg object-contain"
            />
            <div className="leading-tight">
              <p className="text-sm font-bold text-sidebar-foreground">
                Imprimerie
              </p>
              <p className="text-[11px] font-medium text-sidebar-foreground/50">
                OGOOUÉ
              </p>
            </div>
          </Link>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-sidebar-foreground/40 hover:bg-sidebar-accent hover:text-sidebar-foreground lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-3 overflow-y-auto px-3 py-4">
          {filteredGroups.map((group, i) => (
            <NavGroup key={i} group={group} pathname={pathname} onNavClick={onClose} />
          ))}
        </nav>

        {/* User */}
        {user && (
          <div className="border-t border-sidebar-border p-3">
            <div className="flex items-center gap-3 rounded-lg px-3 py-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sidebar-primary text-xs font-bold text-white">
                {user.prenom?.[0]}{user.nom?.[0]}
              </div>
              <div className="flex-1 truncate">
                <p className="text-sm font-medium text-sidebar-foreground">
                  {user.prenom} {user.nom?.[0]}.
                </p>
                <p className="text-xs text-sidebar-foreground/50">{ROLE_LABELS[user.role] || user.role}</p>
              </div>
              <button
                onClick={logout}
                className="rounded-lg p-1.5 text-sidebar-foreground/30 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
                title="Déconnexion"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
