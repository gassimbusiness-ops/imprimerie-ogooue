import { useState, useEffect, useRef } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/services/auth';
import { getNotifications, markAsRead, markAllAsRead } from '@/services/notifications';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, Package, FileText, MessageCircle,
  ShoppingBag, LogOut, Menu, X, User, Printer, Gift, Calculator, Bell, CheckCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import Chatbot from '@/components/chatbot';

const CLIENT_NAV = [
  { name: 'Mon Tableau de bord', href: '/client', icon: LayoutDashboard },
  { name: 'Catalogue', href: '/client/catalogue', icon: ShoppingBag },
  { name: 'Demander un devis', href: '/client/devis', icon: Calculator },
  { name: 'Mes Commandes', href: '/client/commandes', icon: Package },
  { name: 'Mes Factures', href: '/client/factures', icon: FileText },
  { name: 'Messagerie', href: '/client/messagerie', icon: MessageCircle },
  { name: 'Fidélité', href: '/client/fidelite', icon: Gift },
  { name: 'Mon Profil', href: '/client/profil', icon: User },
];

export default function ClientLayout() {
  const { pathname } = useLocation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef(null);

  const unreadCount = notifications.filter((n) => !n.lu).length;

  // Load notifications every 15s
  useEffect(() => {
    if (!user) return;
    const loadNotifs = async () => {
      try {
        const notifs = await getNotifications(user);
        setNotifications(notifs);
      } catch {}
    };
    loadNotifs();
    const interval = setInterval(loadNotifs, 15000);
    return () => clearInterval(interval);
  }, [user]);

  // Click outside to close
  useEffect(() => {
    const handler = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false);
    };
    if (notifOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [notifOpen]);

  const handleClickNotif = async (notif) => {
    if (!notif.lu) await markAsRead(notif.id);
    setNotifications((prev) => prev.map((n) => (n.id === notif.id ? { ...n, lu: true } : n)));
    setNotifOpen(false);
    if (notif.lien) navigate(notif.lien);
  };

  const handleMarkAllRead = async () => {
    await markAllAsRead(user);
    setNotifications((prev) => prev.map((n) => ({ ...n, lu: true })));
  };

  function timeAgo(dateStr) {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "A l'instant";
    if (mins < 60) return `Il y a ${mins} min`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `Il y a ${hrs}h`;
    const days = Math.floor(hrs / 24);
    return `Il y a ${days}j`;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/30">
      {/* Top bar */}
      <header className="sticky top-0 z-50 border-b bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMenuOpen(!menuOpen)}>
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
            <Link to="/client" className="flex items-center gap-2">
              <img src="/logo.png" alt="Imprimerie Ogooué" className="h-10 w-10 rounded-lg object-contain" />
              <div className="hidden sm:block">
                <p className="text-sm font-bold leading-tight">Imprimerie Ogooué</p>
                <p className="text-[10px] text-muted-foreground">Espace Client</p>
              </div>
            </Link>
          </div>

          {/* Desktop nav */}
          <nav className="hidden lg:flex items-center gap-1">
            {CLIENT_NAV.map((item) => {
              const active = item.href === '/client' ? pathname === '/client' : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    active ? 'bg-primary text-white' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  <span className="hidden xl:inline">{item.name}</span>
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            {/* Notification bell */}
            <div className="relative" ref={notifRef}>
              <Button variant="ghost" size="icon" className="relative" onClick={() => setNotifOpen((p) => !p)}>
                <Bell className="h-4 w-4" />
                {unreadCount > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-white animate-pulse">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </Button>
              {notifOpen && (
                <div className="absolute right-0 top-full mt-2 w-80 rounded-xl border bg-white shadow-xl z-50 overflow-hidden">
                  <div className="flex items-center justify-between border-b px-4 py-3">
                    <h3 className="font-semibold text-sm">Notifications</h3>
                    {unreadCount > 0 && (
                      <button onClick={handleMarkAllRead} className="flex items-center gap-1 text-xs text-primary hover:bg-primary/10 rounded px-2 py-1">
                        <CheckCheck className="h-3.5 w-3.5" /> Tout lu
                      </button>
                    )}
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <div className="flex flex-col items-center py-8 text-muted-foreground">
                        <Bell className="h-8 w-8 opacity-30 mb-2" />
                        <p className="text-sm">Aucune notification</p>
                      </div>
                    ) : (
                      notifications.slice(0, 20).map((n) => (
                        <button
                          key={n.id}
                          onClick={() => handleClickNotif(n)}
                          className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/50 ${!n.lu ? 'bg-primary/5' : ''}`}
                        >
                          <span className="mt-0.5 text-lg shrink-0">{n.icon || '🔔'}</span>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm leading-snug ${!n.lu ? 'font-semibold' : 'text-muted-foreground'}`}>{n.message}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">{timeAgo(n.created_at)}</p>
                          </div>
                          {!n.lu && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
            <span className="hidden sm:inline text-sm text-muted-foreground">{user?.prenom}</span>
            <Button variant="ghost" size="icon" onClick={logout} title="Déconnexion">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Mobile nav */}
        {menuOpen && (
          <nav className="border-t bg-white p-2 lg:hidden">
            {CLIENT_NAV.map((item) => {
              const active = item.href === '/client' ? pathname === '/client' : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  onClick={() => setMenuOpen(false)}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium',
                    active ? 'bg-primary text-white' : 'text-muted-foreground',
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.name}
                </Link>
              );
            })}
          </nav>
        )}
      </header>

      {/* Content */}
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <Outlet />
      </main>

      {/* Chatbot - only for logged-in clients */}
      {user && <Chatbot />}
    </div>
  );
}
