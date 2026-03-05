import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { db } from '@/services/db';
import { useAuth } from '@/services/auth';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Package, FileText, MessageCircle, ShoppingBag, Clock, CheckCircle, Truck } from 'lucide-react';

function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)); }

const STATUS_CONFIG = {
  en_attente: { label: 'En attente', color: 'bg-amber-100 text-amber-700', icon: Clock },
  en_production: { label: 'En production', color: 'bg-blue-100 text-blue-700', icon: Truck },
  en_cours: { label: 'En cours', color: 'bg-blue-100 text-blue-700', icon: Truck },
  pret: { label: 'Prêt', color: 'bg-green-100 text-green-700', icon: CheckCircle },
  terminee: { label: 'Terminée', color: 'bg-green-100 text-green-700', icon: CheckCircle },
  livre: { label: 'Livré', color: 'bg-gray-100 text-gray-600', icon: CheckCircle },
};

export default function ClientDashboard() {
  const { user } = useAuth();
  const [commandes, setCommandes] = useState([]);
  const [factures, setFactures] = useState([]);

  useEffect(() => {
    Promise.all([db.commandes.list(), db.devis.list()]).then(([c, f]) => {
      // Filter by client name match (simplified)
      const clientName = `${user?.prenom || ''} ${user?.nom || ''}`.trim().toLowerCase();
      setCommandes(c.filter((cmd) => (cmd.client_nom || '').toLowerCase().includes(clientName)).slice(0, 5));
      setFactures(f.filter((fac) => (fac.client_nom || '').toLowerCase().includes(clientName)).slice(0, 5));
    });
  }, [user]);

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div className="rounded-2xl bg-gradient-to-br from-primary to-blue-700 p-6 text-white">
        <h1 className="text-2xl font-bold">Bienvenue, {user?.prenom} !</h1>
        <p className="text-blue-100 mt-1">Suivez vos commandes et gérez vos devis depuis votre espace dédié.</p>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Catalogue', href: '/client/catalogue', icon: ShoppingBag, color: 'border-l-blue-500' },
          { label: 'Mes Commandes', href: '/client/commandes', icon: Package, color: 'border-l-amber-500', count: commandes.length },
          { label: 'Mes Factures', href: '/client/factures', icon: FileText, color: 'border-l-green-500', count: factures.length },
          { label: 'Messagerie', href: '/client/messagerie', icon: MessageCircle, color: 'border-l-violet-500' },
        ].map(({ label, href, icon: Icon, color, count }) => (
          <Link key={href} to={href}>
            <Card className={`border-l-4 ${color} hover:shadow-md transition-shadow cursor-pointer`}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="rounded-lg bg-muted p-2"><Icon className="h-5 w-5 text-muted-foreground" /></div>
                <div>
                  <p className="font-semibold text-sm">{label}</p>
                  {count !== undefined && <p className="text-xs text-muted-foreground">{count} élément(s)</p>}
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Recent orders */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Dernières commandes</h2>
            <Link to="/client/commandes" className="text-sm text-primary hover:underline">Voir tout →</Link>
          </div>
          {commandes.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">Aucune commande pour le moment</p>
          ) : (
            <div className="space-y-2">
              {commandes.map((cmd) => {
                const cfg = STATUS_CONFIG[cmd.statut] || STATUS_CONFIG.en_attente;
                return (
                  <div key={cmd.id} className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <p className="font-medium text-sm">{cmd.numero || 'CMD'} — {cmd.description || cmd.service}</p>
                      <p className="text-xs text-muted-foreground">{cmd.date_creation || cmd.created_at?.slice(0, 10)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{fmt(cmd.montant_total)} F</span>
                      <Badge className={cfg.color}>{cfg.label}</Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
