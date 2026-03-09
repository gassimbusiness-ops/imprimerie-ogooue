import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Menu, Bell, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import GlobalSearch from './global-search';
import { db } from '@/services/db';

const PAGE_TITLES = {
  '/': 'Tableau de bord',
  '/rapports': 'Rapports journaliers',
  '/commandes': 'Commandes',
  '/devis-factures': 'Devis & Factures',
  '/clients': 'Clients',
  '/employes': 'Employés',
  '/pointage': 'Pointage',
  '/stocks': 'Stocks',
  '/statistiques': 'Dashboard Financier',
  '/cloture-caisse': 'Clôture de Caisse',
  '/paiements': 'Paiements Mobile',
  '/notifications': 'Notifications SMS',
  '/audit': 'Journal d\'audit',
  '/parametres': 'Paramètres',
  '/taches': 'Tâches',
  '/catalogue': 'Catalogue Produits',
  '/prospection': 'Prospection',
  '/bilans': 'Bilans Financiers',
  '/finances': 'Finances',
  '/objectifs': 'Objectifs',
  '/demandes-rh': 'Avances & Charges',
  '/travaux': 'Travaux & Projets',
  '/evenements': 'Événements & Marketing',
  '/messagerie': 'Messagerie',
  '/tarifs-clients': 'Tarifs Clients',
  '/gouvernance': 'Gouvernance & Capital',
  '/rapports-analyses': 'Rapports & Analyses',
  '/performance-rh': 'Performance & Dashboard RH',
  '/marketing': 'Marketing',
  '/mockup-ia': 'Mockups IA',
};

export default function Header({ onMenuClick }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const title = PAGE_TITLES[pathname] || 'Imprimerie Ogooué';
  const [searchOpen, setSearchOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // Poll for unread notifications
  useEffect(() => {
    const loadNotifs = async () => {
      try {
        const notifs = await db.notifications_app.list();
        const unread = notifs.filter((n) => !n.lu && n.destinataire === 'admin').length;
        setUnreadCount(unread);
      } catch {}
    };
    loadNotifs();
    const interval = setInterval(loadNotifs, 15000); // every 15s
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      <header className="flex h-16 shrink-0 items-center gap-4 border-b bg-card px-4 sm:px-6">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={onMenuClick}
        >
          <Menu className="h-5 w-5" />
        </Button>

        <h1 className="text-base sm:text-lg font-semibold text-foreground truncate">{title}</h1>

        <div className="flex-1" />

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground"
            onClick={() => setSearchOpen(true)}
          >
            <Search className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="relative text-muted-foreground"
            onClick={() => navigate('/notifications')}
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            ) : (
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-muted" />
            )}
          </Button>
        </div>
      </header>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}
