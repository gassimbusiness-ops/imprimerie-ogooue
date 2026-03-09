import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Menu, Bell, Search, Check, CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import GlobalSearch from './global-search';
import { useAuth } from '@/services/auth';
import { getNotifications, markAsRead, markAllAsRead } from '@/services/notifications';

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

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'À l\'instant';
  if (mins < 60) return `Il y a ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Il y a ${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `Il y a ${days}j`;
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

export default function Header({ onMenuClick }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const title = PAGE_TITLES[pathname] || 'Imprimerie Ogooué';
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const panelRef = useRef(null);

  const unreadCount = notifications.filter((n) => !n.lu).length;

  // Load notifications every 12s
  useEffect(() => {
    if (!user) return;
    const loadNotifs = async () => {
      try {
        const notifs = await getNotifications(user);
        setNotifications(notifs);
      } catch {
        // silent
      }
    };
    loadNotifs();
    const interval = setInterval(loadNotifs, 12000);
    return () => clearInterval(interval);
  }, [user]);

  // Click outside to close
  useEffect(() => {
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setPanelOpen(false);
      }
    };
    if (panelOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [panelOpen]);

  const handleClickNotif = async (notif) => {
    if (!notif.lu) await markAsRead(notif.id);
    setNotifications((prev) => prev.map((n) => (n.id === notif.id ? { ...n, lu: true } : n)));
    setPanelOpen(false);
    if (notif.lien) navigate(notif.lien);
  };

  const handleMarkAllRead = async () => {
    await markAllAsRead(user);
    setNotifications((prev) => prev.map((n) => ({ ...n, lu: true })));
  };

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

          {/* Notification bell + dropdown */}
          <div className="relative" ref={panelRef}>
            <Button
              variant="ghost"
              size="icon"
              className="relative text-muted-foreground"
              onClick={() => setPanelOpen((p) => !p)}
            >
              <Bell className="h-5 w-5" />
              {unreadCount > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white animate-pulse">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              ) : (
                <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-muted" />
              )}
            </Button>

            {/* Notification panel */}
            {panelOpen && (
              <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 rounded-xl border bg-card shadow-xl z-50 overflow-hidden">
                {/* Panel header */}
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <h3 className="font-semibold text-sm">Notifications</h3>
                  {unreadCount > 0 && (
                    <button
                      onClick={handleMarkAllRead}
                      className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-primary hover:bg-primary/10 transition-colors"
                    >
                      <CheckCheck className="h-3.5 w-3.5" /> Tout lu
                    </button>
                  )}
                </div>

                {/* Notification list */}
                <div className="max-h-80 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                      <Bell className="mb-2 h-8 w-8 opacity-30" />
                      <p className="text-sm">Aucune notification</p>
                    </div>
                  ) : (
                    notifications.slice(0, 30).map((n) => (
                      <button
                        key={n.id}
                        onClick={() => handleClickNotif(n)}
                        className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 ${
                          !n.lu ? 'bg-primary/5' : ''
                        }`}
                      >
                        <span className="mt-0.5 text-lg shrink-0">{n.icon || '🔔'}</span>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm leading-snug ${!n.lu ? 'font-semibold' : 'text-muted-foreground'}`}>
                            {n.message}
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">{timeAgo(n.created_at)}</p>
                        </div>
                        {!n.lu && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                      </button>
                    ))
                  )}
                </div>

                {/* Panel footer */}
                {notifications.length > 0 && (
                  <div className="border-t px-4 py-2">
                    <button
                      onClick={() => { setPanelOpen(false); navigate('/notifications'); }}
                      className="w-full text-center text-xs text-primary hover:underline"
                    >
                      Voir tout l'historique
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}
