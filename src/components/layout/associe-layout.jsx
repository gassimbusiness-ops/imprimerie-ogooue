import { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/services/auth';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, BookOpen, Boxes, Users,
  TrendingUp, LogOut, Menu, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

const ASSOCIE_NAV = [
  { name: 'Tableau de bord', href: '/associe', icon: LayoutDashboard },
  { name: 'Catalogue', href: '/associe/catalogue', icon: BookOpen },
  { name: 'Stocks', href: '/associe/stocks', icon: Boxes },
  { name: 'Gouvernance', href: '/associe/gouvernance', icon: TrendingUp },
];

export default function AssocieLayout() {
  const { pathname } = useLocation();
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50/30 to-purple-50/30">
      {/* Top bar */}
      <header className="sticky top-0 z-50 border-b bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMenuOpen(!menuOpen)}>
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
            <Link to="/associe" className="flex items-center gap-2">
              <img src="/logo.png" alt="Imprimerie Ogooué" className="h-10 w-10 rounded-lg object-contain" />
              <div className="hidden sm:block">
                <p className="text-sm font-bold leading-tight">Imprimerie Ogooué</p>
                <p className="text-[10px] text-muted-foreground">Espace Associé</p>
              </div>
            </Link>
          </div>

          {/* Desktop nav */}
          <nav className="hidden lg:flex items-center gap-1">
            {ASSOCIE_NAV.map((item) => {
              const active = item.href === '/associe' ? pathname === '/associe' : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    active ? 'bg-indigo-600 text-white' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  <span>{item.name}</span>
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            <span className="hidden sm:inline text-sm text-muted-foreground">{user?.prenom}</span>
            <Button variant="ghost" size="icon" onClick={logout} title="Déconnexion">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Mobile nav */}
        {menuOpen && (
          <nav className="border-t bg-white p-2 lg:hidden">
            {ASSOCIE_NAV.map((item) => {
              const active = item.href === '/associe' ? pathname === '/associe' : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  onClick={() => setMenuOpen(false)}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium',
                    active ? 'bg-indigo-600 text-white' : 'text-muted-foreground',
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
    </div>
  );
}
