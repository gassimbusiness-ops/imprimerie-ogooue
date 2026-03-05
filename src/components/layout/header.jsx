import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Menu, Bell, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import GlobalSearch from './global-search';

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
  '/demandes-rh': 'Demandes RH',
  '/travaux': 'Travaux & Projets',
  '/evenements': 'Événements & Marketing',
  '/messagerie': 'Messagerie',
  '/tarifs-clients': 'Tarifs Clients',
  '/gouvernance': 'Gouvernance & Capital',
};

export default function Header({ onMenuClick }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const title = PAGE_TITLES[pathname] || 'Imprimerie Ogooué';
  const [searchOpen, setSearchOpen] = useState(false);

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
            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-destructive" />
          </Button>
        </div>
      </header>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}
