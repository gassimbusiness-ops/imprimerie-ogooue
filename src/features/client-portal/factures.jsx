import { useState, useEffect } from 'react';
import { db } from '@/services/db';
import { useAuth } from '@/services/auth';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FileText, Download, Smartphone } from 'lucide-react';
import { toast } from 'sonner';

function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)); }

export default function ClientFactures() {
  const { user } = useAuth();
  const [factures, setFactures] = useState([]);

  useEffect(() => {
    db.devis.list().then((all) => {
      const clientName = `${user?.prenom || ''} ${user?.nom || ''}`.trim().toLowerCase();
      setFactures(all.filter((f) => (f.client_nom || '').toLowerCase().includes(clientName)).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')));
    });
  }, [user]);

  const payMobile = (facture) => {
    toast.info(`Paiement Mobile Money de ${fmt(facture.montant_total)} F — fonctionnalité en cours d'intégration avec Airtel/Moov.`);
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Mes Factures</h1>

      {factures.length === 0 ? (
        <Card><CardContent className="p-8 text-center">
          <FileText className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-muted-foreground">Aucune facture disponible</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {factures.map((f) => {
            const isPaid = f.statut === 'payee' || f.statut === 'paid';
            return (
              <Card key={f.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold">{f.numero || 'FAC'}</p>
                      <p className="text-sm text-muted-foreground">{f.description || f.objet}</p>
                      <p className="text-xs text-muted-foreground">{f.date || f.created_at?.slice(0, 10)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold">{fmt(f.montant_total || f.total)} F</p>
                      <Badge className={isPaid ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}>
                        {isPaid ? 'Payée' : 'En attente'}
                      </Badge>
                    </div>
                  </div>
                  {!isPaid && (
                    <div className="flex gap-2 mt-3">
                      <Button size="sm" className="gap-1.5 bg-green-600 hover:bg-green-700 flex-1" onClick={() => payMobile(f)}>
                        <Smartphone className="h-3.5 w-3.5" /> Payer par Mobile Money
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
