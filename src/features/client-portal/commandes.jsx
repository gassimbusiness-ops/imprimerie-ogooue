import { useState, useEffect } from 'react';
import { db } from '@/services/db';
import { useAuth } from '@/services/auth';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Package, Clock, CheckCircle, Truck, Printer, XCircle, ShoppingBag } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)); }

const STATUTS_COMMANDE = {
  en_attente_validation: { label: '⏳ Commande envoyée — En attente de validation', shortLabel: 'Envoyée', color: 'bg-amber-100 text-amber-700', icon: Clock, step: 0 },
  en_attente: { label: '⏳ Commande envoyée — En attente', shortLabel: 'En attente', color: 'bg-amber-100 text-amber-700', icon: Clock, step: 0 },
  nouveau: { label: '⏳ Commande envoyée — En attente', shortLabel: 'En attente', color: 'bg-amber-100 text-amber-700', icon: Clock, step: 0 },
  validee_attente_paiement: { label: '✅ Commande validée — En attente de paiement', shortLabel: 'Validée', color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle, step: 1 },
  en_production: { label: '🖨️ En cours de production', shortLabel: 'En production', color: 'bg-blue-100 text-blue-700', icon: Printer, step: 2 },
  en_cours: { label: '🖨️ En cours de production', shortLabel: 'En production', color: 'bg-blue-100 text-blue-700', icon: Printer, step: 2 },
  prete: { label: '📦 Prête à récupérer', shortLabel: 'Prête', color: 'bg-violet-100 text-violet-700', icon: Package, step: 3 },
  pret: { label: '📦 Prête à récupérer', shortLabel: 'Prête', color: 'bg-violet-100 text-violet-700', icon: Package, step: 3 },
  terminee: { label: '📦 Prête à récupérer', shortLabel: 'Prête', color: 'bg-violet-100 text-violet-700', icon: Package, step: 3 },
  livree: { label: '🎉 Livrée', shortLabel: 'Livrée', color: 'bg-gray-100 text-gray-600', icon: CheckCircle, step: 4 },
  livre: { label: '🎉 Livrée', shortLabel: 'Livrée', color: 'bg-gray-100 text-gray-600', icon: CheckCircle, step: 4 },
  annulee: { label: '❌ Annulée', shortLabel: 'Annulée', color: 'bg-red-100 text-red-700', icon: XCircle, step: -1 },
  annule: { label: '❌ Annulée', shortLabel: 'Annulée', color: 'bg-red-100 text-red-700', icon: XCircle, step: -1 },
};

const STEPS = [
  { label: 'Envoyée', icon: '✅' },
  { label: 'Validée', icon: '✅' },
  { label: 'En production', icon: '🖨️' },
  { label: 'Prête', icon: '📦' },
  { label: 'Livrée', icon: '🎉' },
];

function ProgressGauge({ currentStep }) {
  if (currentStep < 0) return null; // annulée
  const percent = Math.round((currentStep / (STEPS.length - 1)) * 100);

  return (
    <div className="mt-4 space-y-2">
      {/* Steps */}
      <div className="flex items-center justify-between">
        {STEPS.map((s, i) => {
          const isDone = i <= currentStep;
          const isCurrent = i === currentStep;
          return (
            <div key={s.label} className="flex flex-col items-center gap-1" style={{ flex: 1 }}>
              <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-all ${isDone ? 'bg-primary text-white' : 'bg-muted text-muted-foreground'} ${isCurrent ? 'ring-2 ring-primary ring-offset-2' : ''}`}>
                {isDone ? s.icon : i + 1}
              </div>
              <span className={`text-[9px] font-medium text-center leading-tight ${isCurrent ? 'text-primary font-semibold' : 'text-muted-foreground'}`}>
                {s.label}
              </span>
            </div>
          );
        })}
      </div>
      {/* Progress bar */}
      <div className="h-2.5 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full bg-gradient-to-r from-primary to-blue-500 transition-all duration-700"
          style={{ width: `${percent}%` }} />
      </div>
      <p className="text-center text-xs text-muted-foreground">{percent}% complété</p>
    </div>
  );
}

export default function ClientCommandes() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [commandes, setCommandes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState([]);

  const loadData = async () => {
    const [all, notifs] = await Promise.all([db.commandes.list(), db.notifications_app.list()]);
    const clientName = `${user?.prenom || ''} ${user?.nom || ''}`.trim().toLowerCase();
    const clientId = user?.id;
    const myCommandes = all.filter((c) =>
      (c.client_id && c.client_id === clientId) ||
      (c.client_nom || '').toLowerCase().includes(clientName)
    ).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    setCommandes(myCommandes);
    // Get client notifications
    const myNotifs = notifs.filter((n) => n.destinataire_id === clientId || n.destinataire === 'client_' + clientId);
    setNotifications(myNotifs);
    setLoading(false);
  };

  useEffect(() => { loadData(); const interval = setInterval(loadData, 30000); return () => clearInterval(interval); }, [user]);

  if (loading) return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Mes Commandes</h1>
      <p className="text-muted-foreground">{commandes.length} commande(s) — mise à jour auto toutes les 30s</p>

      {commandes.length === 0 ? (
        <Card><CardContent className="p-8 text-center">
          <Package className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-muted-foreground">Aucune commande pour le moment</p>
          <p className="text-sm text-muted-foreground mt-1">Parcourez notre catalogue pour passer votre première commande !</p>
          <button onClick={() => navigate('/client/catalogue')} className="mt-4 text-primary underline text-sm">Voir le catalogue →</button>
        </CardContent></Card>
      ) : (
        <div className="space-y-4">
          {commandes.map((cmd) => {
            const cfg = STATUTS_COMMANDE[cmd.statut] || STATUTS_COMMANDE.en_attente_validation;
            const Icon = cfg.icon;
            return (
              <Card key={cmd.id} className="overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                        <p className="font-semibold">{cmd.numero || 'CMD'}</p>
                        <Badge className={cfg.color + ' text-[10px]'}>{cfg.shortLabel}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{cmd.description || cmd.service}</p>
                      <p className="text-xs text-muted-foreground">{cmd.date_creation || cmd.created_at?.slice(0, 10)}</p>
                    </div>
                    <p className="text-lg font-bold shrink-0">{fmt(cmd.montant_total || cmd.total)} F</p>
                  </div>

                  {/* Lignes detail */}
                  {cmd.lignes && cmd.lignes.length > 0 && (
                    <div className="mt-3 space-y-1.5 border-t pt-3">
                      {cmd.lignes.map((l, i) => (
                        <div key={i} className="flex items-center gap-2 text-sm">
                          {l.image && <img src={l.image} alt="" className="h-8 w-8 rounded object-cover shrink-0" />}
                          <span className="flex-1 truncate">{l.nom || l.description}</span>
                          <span className="text-muted-foreground">x{l.qte || l.quantite}</span>
                          <span className="font-medium">{fmt((l.prix || l.prix_unitaire || 0) * (l.qte || l.quantite || 1))} F</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Admin comment */}
                  {cmd.commentaire_client && (
                    <div className="mt-3 rounded-lg bg-blue-50 p-3 border border-blue-200">
                      <p className="text-xs font-semibold text-blue-700 mb-1">Message de l'imprimerie :</p>
                      <p className="text-sm text-blue-800">{cmd.commentaire_client}</p>
                    </div>
                  )}

                  {/* Status message */}
                  <div className="mt-3 rounded-lg bg-muted/50 px-3 py-2">
                    <p className="text-sm font-medium">{cfg.label}</p>
                  </div>

                  {/* Progress gauge */}
                  <ProgressGauge currentStep={cfg.step} />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
