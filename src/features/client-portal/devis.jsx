import { useState, useEffect } from 'react';
import { db } from '@/services/db';
import { useAuth } from '@/services/auth';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Calculator, Send, Plus, Trash2, Info, Package } from 'lucide-react';
import { toast } from 'sonner';
import { createNotification } from '@/services/notifications';
import { syncClientFromCommande } from '@/services/sync-clients';

function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)); }

function prixPourQte(p, qte) {
  if (p.prix && Array.isArray(p.prix)) {
    const sorted = [...p.prix].sort((a, b) => a.qte_min - b.qte_min);
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (qte >= sorted[i].qte_min) return sorted[i].prix;
    }
    return sorted[0]?.prix || 0;
  }
  return p.prix_unitaire || 0;
}

export default function ClientDevis() {
  const { user } = useAuth();
  const [produits, setProduits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lignes, setLignes] = useState([]);
  const [sending, setSending] = useState(false);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    db.produits_catalogue.list().then((p) => {
      setProduits(p.filter((x) => x.actif !== false));
      setLoading(false);
    });
  }, []);

  const categories = [...new Set(produits.map((p) => p.categorie).filter(Boolean))].sort();

  const addLigne = () => {
    setLignes([...lignes, { categorie: '', produit_id: '', quantite: 1, options: '' }]);
  };

  const updateLigne = (idx, field, value) => {
    setLignes(lignes.map((l, i) => {
      if (i !== idx) return l;
      const updated = { ...l, [field]: value };
      // Reset produit when category changes
      if (field === 'categorie') updated.produit_id = '';
      return updated;
    }));
  };

  const removeLigne = (idx) => {
    setLignes(lignes.filter((_, i) => i !== idx));
  };

  const getEstimation = () => {
    let total = 0;
    lignes.forEach((l) => {
      if (l.produit_id) {
        const prod = produits.find((p) => p.id === l.produit_id);
        if (prod) {
          total += prixPourQte(prod, l.quantite || 1) * (l.quantite || 1);
        }
      }
    });
    return total;
  };

  const envoyerDemande = async () => {
    if (lignes.length === 0) { toast.error('Ajoutez au moins un produit'); return; }
    const validLignes = lignes.filter((l) => l.produit_id);
    if (validLignes.length === 0) { toast.error('Selectionnez au moins un produit'); return; }

    setSending(true);
    try {
      const clientNom = `${user?.prenom || ''} ${user?.nom || ''}`.trim();
      const estimation = getEstimation();

      // Build message
      const details = validLignes.map((l) => {
        const prod = produits.find((p) => p.id === l.produit_id);
        const pu = prod ? prixPourQte(prod, l.quantite || 1) : 0;
        return `- ${prod?.nom || 'Produit'} x${l.quantite || 1} = ${fmt(pu * (l.quantite || 1))} F${l.options ? ` (${l.options})` : ''}`;
      }).join('\n');

      const messageContent = `Demande de devis de ${clientNom}\n\n${details}\n\nEstimation : ${fmt(estimation)} F\n${notes ? `\nNotes : ${notes}` : ''}\n\nMerci de confirmer le devis officiel.`;

      // Send in messagerie
      const convs = await db.conversations.list();
      let conv = convs.find((c) => c.client_id === user?.id)
        || convs.find((c) => c.client_email === user?.email);

      if (!conv) {
        conv = await db.conversations.create({
          client_id: user?.id,
          client_nom: clientNom,
          client_email: user?.email,
          plateforme: 'interne',
          statut: 'nouveau',
          sujet: `Demande de devis — ${clientNom}`,
        });
      }

      await db.messages_conv.create({
        conversation_id: conv.id,
        type: 'entrant',
        contenu: messageContent,
        auteur: clientNom,
        auteur_id: user?.id,
      });

      await db.conversations.update(conv.id, {
        dernier_message: `Demande de devis — ${fmt(estimation)} F`,
        statut: 'nouveau',
      });

      // Notification admin
      await createNotification(
        'nouvelle_commande',
        `Nouvelle demande de devis de ${clientNom} — ${fmt(estimation)} F`,
        'admin',
        { type: 'devis' }
      );

      // Sync client auto
      syncClientFromCommande({
        client_id: user?.id,
        client_nom: clientNom,
        client_email: user?.email || '',
        source: 'devis_client',
      }).catch(() => {});
      toast.success('Demande de devis envoyee ! Notre equipe vous repondra rapidement.');
      setLignes([]);
      setNotes('');
    } finally {
      setSending(false);
    }
  };

  if (loading) return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;

  const estimation = getEstimation();

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Demander un devis</h1>
        <p className="text-muted-foreground">Estimez le prix et envoyez votre demande</p>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 rounded-lg bg-blue-50 border border-blue-200 p-4">
        <Info className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
        <div className="text-sm text-blue-800">
          <p className="font-medium">Prix indicatif</p>
          <p className="text-xs mt-0.5">L'estimation affichee est basee sur nos tarifs catalogue. Le devis officiel PDF sera confirme par notre equipe.</p>
        </div>
      </div>

      {/* Lignes */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2">
              <Package className="h-4 w-4 text-muted-foreground" /> Produits
            </h2>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={addLigne}>
              <Plus className="h-3.5 w-3.5" /> Ajouter
            </Button>
          </div>

          {lignes.length === 0 && (
            <div className="text-center py-8">
              <Calculator className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">Cliquez sur "Ajouter" pour commencer votre simulation</p>
            </div>
          )}

          {lignes.map((l, idx) => {
            const catProduits = l.categorie ? produits.filter((p) => p.categorie === l.categorie) : produits;
            const selectedProd = l.produit_id ? produits.find((p) => p.id === l.produit_id) : null;
            const unitPrice = selectedProd ? prixPourQte(selectedProd, l.quantite || 1) : 0;
            const lineTotal = unitPrice * (l.quantite || 1);

            return (
              <div key={idx} className="rounded-lg border p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Ligne {idx + 1}</span>
                  <button onClick={() => removeLigne(idx)} className="text-red-500 hover:text-red-700">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium mb-1 block">Categorie</label>
                    <Select value={l.categorie || '__none__'} onValueChange={(v) => updateLigne(idx, 'categorie', v === '__none__' ? '' : v)}>
                      <SelectTrigger><SelectValue placeholder="Choisir..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Toutes</SelectItem>
                        {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <label className="text-xs font-medium mb-1 block">Produit</label>
                    <Select value={l.produit_id || '__none__'} onValueChange={(v) => updateLigne(idx, 'produit_id', v === '__none__' ? '' : v)}>
                      <SelectTrigger><SelectValue placeholder="Choisir..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Selectionnez...</SelectItem>
                        {catProduits.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.nom} — {fmt(p.prix_unitaire || 0)} F</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-medium mb-1 block">Quantite</label>
                    <Input
                      type="number"
                      min="1"
                      value={l.quantite}
                      onChange={(e) => updateLigne(idx, 'quantite', Math.max(1, Number(e.target.value) || 1))}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block">Options</label>
                    <Input
                      placeholder="Logo, couleur..."
                      value={l.options}
                      onChange={(e) => updateLigne(idx, 'options', e.target.value)}
                    />
                  </div>
                  {selectedProd && (
                    <div className="flex items-end">
                      <div className="text-right w-full">
                        <p className="text-xs text-muted-foreground">Sous-total</p>
                        <p className="text-lg font-bold text-primary">{fmt(lineTotal)} F</p>
                      </div>
                    </div>
                  )}
                </div>

                {selectedProd?.options_personnalisables?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedProd.options_personnalisables.map((opt, i) => (
                      <Badge key={i} variant="outline" className="text-[10px]">{opt}</Badge>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Notes */}
      {lignes.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <label className="text-sm font-medium mb-2 block">Notes ou precisions (optionnel)</label>
            <textarea
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Precisions sur votre demande (format, couleurs, delais souhaites...)"
            />
          </CardContent>
        </Card>
      )}

      {/* Total + envoi */}
      {lignes.length > 0 && estimation > 0 && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm text-muted-foreground">Estimation totale</p>
                <p className="text-3xl font-black text-primary">{fmt(estimation)} F</p>
                <p className="text-[10px] text-muted-foreground mt-1">Prix indicatif — devis confirme par l'equipe</p>
              </div>
              <Calculator className="h-10 w-10 text-primary/30" />
            </div>
            <Button className="w-full gap-2" onClick={envoyerDemande} disabled={sending}>
              <Send className="h-4 w-4" /> {sending ? 'Envoi...' : 'Envoyer ma demande de devis'}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
