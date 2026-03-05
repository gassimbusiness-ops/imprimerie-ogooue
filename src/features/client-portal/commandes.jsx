import { useState, useEffect } from 'react';
import { db } from '@/services/db';
import { useAuth } from '@/services/auth';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Package, Clock, CheckCircle, Truck, AlertCircle } from 'lucide-react';

function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)); }

const STATUS_MAP = {
  en_attente: { label: 'En attente', color: 'bg-amber-100 text-amber-700', icon: Clock, step: 1 },
  en_cours: { label: 'En production', color: 'bg-blue-100 text-blue-700', icon: Truck, step: 2 },
  en_production: { label: 'En production', color: 'bg-blue-100 text-blue-700', icon: Truck, step: 2 },
  terminee: { label: 'Prêt à retirer', color: 'bg-green-100 text-green-700', icon: CheckCircle, step: 3 },
  pret: { label: 'Prêt à retirer', color: 'bg-green-100 text-green-700', icon: CheckCircle, step: 3 },
  livre: { label: 'Livré', color: 'bg-gray-100 text-gray-600', icon: CheckCircle, step: 4 },
};

function ProgressSteps({ currentStep }) {
  const steps = ['Reçue', 'En production', 'Prêt', 'Livré'];
  return (
    <div className="flex items-center gap-1 mt-3">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center gap-1 flex-1">
          <div className={`h-2 flex-1 rounded-full ${i < currentStep ? 'bg-primary' : 'bg-muted'}`} />
        </div>
      ))}
    </div>
  );
}

export default function ClientCommandes() {
  const { user } = useAuth();
  const [commandes, setCommandes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    db.commandes.list().then((all) => {
      const clientName = `${user?.prenom || ''} ${user?.nom || ''}`.trim().toLowerCase();
      setCommandes(all.filter((c) => (c.client_nom || '').toLowerCase().includes(clientName)).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')));
      setLoading(false);
    });
  }, [user]);

  if (loading) return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Mes Commandes</h1>
      <p className="text-muted-foreground">{commandes.length} commande(s)</p>

      {commandes.length === 0 ? (
        <Card><CardContent className="p-8 text-center">
          <Package className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-muted-foreground">Aucune commande pour le moment</p>
          <p className="text-sm text-muted-foreground mt-1">Parcourez notre catalogue pour passer votre première commande !</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {commandes.map((cmd) => {
            const cfg = STATUS_MAP[cmd.statut] || STATUS_MAP.en_attente;
            const Icon = cfg.icon;
            return (
              <Card key={cmd.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <p className="font-semibold">{cmd.numero || 'CMD'}</p>
                        <Badge className={cfg.color}>{cfg.label}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">{cmd.description || cmd.service}</p>
                      <p className="text-xs text-muted-foreground">{cmd.date_creation || cmd.created_at?.slice(0, 10)}</p>
                    </div>
                    <p className="text-lg font-bold">{fmt(cmd.montant_total)} F</p>
                  </div>
                  <ProgressSteps currentStep={cfg.step} />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
