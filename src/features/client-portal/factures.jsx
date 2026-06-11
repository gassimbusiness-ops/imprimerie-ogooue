import { useState, useEffect } from 'react';
import { db } from '@/services/db';
import { useAuth } from '@/services/auth';
import { exportDocument } from '@/services/export-pdf';
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
    const loadAll = async () => {
      const clientName = `${user?.prenom || ''} ${user?.nom || ''}`.trim().toLowerCase();
      const clientId = user?.id;

      const [devisAll, facturesAll] = await Promise.all([
        db.devis.list(),
        db.factures.list(),
      ]);

      // Merge factures from both collections, filtering by client
      const myDevis = devisAll.filter((f) =>
        (f.client_id && f.client_id === clientId) ||
        (f.client_nom || '').toLowerCase().includes(clientName)
      ).map((d) => ({ ...d, _type: 'devis' }));

      const myFactures = facturesAll.filter((f) =>
        ((f.client_id && f.client_id === clientId) ||
        (f.client_nom || '').toLowerCase().includes(clientName)) &&
        // Ne jamais exposer les brouillons au client (uniquement factures emises/payees)
        f.statut !== 'brouillon'
      ).map((f) => ({ ...f, _type: 'facture' }));

      const all = [...myFactures, ...myDevis]
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      setFactures(all);
    };
    loadAll();
  }, [user]);

  const payMobile = (facture) => {
    toast.info(`Paiement Mobile Money de ${fmt(facture.total_ttc || facture.montant_total || facture.total)} F — fonctionnalite en cours d'integration avec Airtel/Moov.`);
  };

  const downloadPDF = (f) => {
    const lignes = (f.lignes || []).map((l) => ({
      description: l.description || l.designation || 'Article',
      quantite: l.quantite || 1,
      prix_unitaire: l.prix_unitaire || l.prix || 0,
    }));
    if (lignes.length === 0) {
      lignes.push({ description: f.objet || 'Commande', quantite: 1, prix_unitaire: f.total_ttc || f.montant_total || f.total || 0 });
    }
    exportDocument(f, lignes, f._type === 'facture' ? 'facture' : 'devis');
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Mes Factures & Devis</h1>

      {factures.length === 0 ? (
        <Card><CardContent className="p-8 text-center">
          <FileText className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-muted-foreground">Aucune facture disponible</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {factures.map((f) => {
            const isPaid = f.statut === 'payee' || f.statut === 'paid';
            const isFacture = f._type === 'facture';
            return (
              <Card key={f.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold">{f.numero || (isFacture ? 'FAC' : 'DEV')}</p>
                        <Badge variant="outline" className="text-[10px]">
                          {isFacture ? 'Facture' : 'Devis'}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5">{f.objet || f.description}</p>
                      <p className="text-xs text-muted-foreground">{f.date || f.created_at?.slice(0, 10)}</p>
                      {f.commande_numero && (
                        <p className="text-xs text-muted-foreground">Commande : {f.commande_numero}</p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold">{fmt(f.total_ttc || f.montant_total || f.total || f.sous_total)} F</p>
                      <Badge className={isPaid ? 'bg-green-100 text-green-700' : f.statut === 'envoyee' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}>
                        {isPaid ? 'Payee' : f.statut === 'envoyee' ? 'Envoyee' : f.statut || 'En attente'}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <Button size="sm" variant="outline" className="gap-1.5 flex-1" onClick={() => downloadPDF(f)}>
                      <Download className="h-3.5 w-3.5" /> Telecharger PDF
                    </Button>
                    {isFacture && !isPaid && (
                      <Button size="sm" className="gap-1.5 bg-green-600 hover:bg-green-700 flex-1" onClick={() => payMobile(f)}>
                        <Smartphone className="h-3.5 w-3.5" /> Payer Mobile Money
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
