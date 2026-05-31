import { useState, useEffect, useRef } from 'react';
import { db } from '@/services/db';
import { useAuth } from '@/services/auth';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Package, Clock, CheckCircle, Truck, Printer, XCircle, CreditCard, Download, Smartphone, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { notifyNouvelleCommande } from '@/services/notifications';
import { exportDocument } from '@/services/export-pdf';
import { toast } from 'sonner';

function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)); }

const STATUTS_COMMANDE = {
  en_attente_validation: { label: '⏳ Commande envoyée — En attente de validation', shortLabel: 'Envoyée', color: 'bg-amber-100 text-amber-700', icon: Clock, step: 0 },
  en_attente: { label: '⏳ Commande envoyée — En attente', shortLabel: 'En attente', color: 'bg-amber-100 text-amber-700', icon: Clock, step: 0 },
  nouveau: { label: '⏳ Commande envoyée — En attente', shortLabel: 'En attente', color: 'bg-amber-100 text-amber-700', icon: Clock, step: 0 },
  validee_attente_paiement: { label: '✅ Commande validée — En attente de paiement', shortLabel: 'A payer', color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle, step: 1 },
  paiement_initie: { label: '💳 Paiement Mobile Money initié — En attente de confirmation', shortLabel: 'Paiement initié', color: 'bg-yellow-100 text-yellow-700', icon: Smartphone, step: 1 },
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
  { label: 'À payer', icon: '💳' },
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
  const [showPaiement, setShowPaiement] = useState(null); // commande to pay
  const [operateur, setOperateur] = useState('');
  const [telephone, setTelephone] = useState('');
  const [paiementEtape, setPaiementEtape] = useState('form'); // form | pending | success | error
  const [paiementError, setPaiementError] = useState('');
  const [paiementLoading, setPaiementLoading] = useState(false);
  const pollingRef = useRef(null);

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

  // ── Detection du retour SingPay (redirect_success / redirect_error) ──
  // SingPay redirige le client vers ?paiement=success ou ?paiement=error apres
  // le paiement via lien externe (/ext). Afficher un feedback visuel + recharger.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paiementParam = params.get('paiement');
    const refParam = params.get('ref');
    if (!paiementParam) return;

    if (paiementParam === 'success') {
      toast.success('Paiement reçu — votre commande passe en production', {
        duration: 8000,
        description: refParam ? `Référence : ${refParam}` : undefined,
      });
      // Recharger pour voir le nouveau statut
      setTimeout(() => loadData(), 1500);
    } else if (paiementParam === 'error') {
      toast.error('Paiement non abouti', {
        duration: 8000,
        description: 'Le paiement a échoué ou a été annulé. Vous pouvez réessayer.',
      });
    }

    // Nettoyer l'URL pour eviter de re-trigger au prochain render
    const url = new URL(window.location.href);
    url.searchParams.delete('paiement');
    url.searchParams.delete('ref');
    window.history.replaceState({}, '', url.toString());
  }, []);

  // ── Ouvrir modal paiement Mobile Money ──
  const openPaiement = (cmd) => {
    setShowPaiement(cmd);
    setOperateur('');
    setTelephone('');
    setPaiementEtape('form');
    setPaiementError('');
    setPaiementLoading(false);
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
  };

  // Cleanup polling on unmount
  useEffect(() => {
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, []);

  // ── Initier paiement SingPay Mobile Money ──
  const handleInitierPaiement = async () => {
    if (!operateur || !telephone) return;
    const cmd = showPaiement;
    setPaiementLoading(true);
    setPaiementError('');

    try {
      const montant = cmd.montant_total || cmd.total || 0;

      // Appel API SingPay via serverless function
      const response = await fetch('/api/singpay-initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commandeId: cmd.id,
          montant: montant,
          telephone: telephone,
          operateur: operateur,
          nomClient: cmd.client_nom || `${user?.prenom || ''} ${user?.nom || ''}`.trim(),
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        // Propager le detail SingPay si present pour debug
        const detail = data.details?.status?.message || data.details?.message || '';
        const msg = data.error || 'Erreur SingPay';
        console.error('[SingPay frontend] Erreur initiation:', data);
        throw new Error(detail ? `${msg} — ${detail}` : msg);
      }

      // Mise a jour locale aussi (au cas ou l'API serverless ne le ferait pas)
      const auteur = `${user?.prenom || ''} ${user?.nom || ''}`.trim();
      await db.commandes.update(cmd.id, {
        statut: 'paiement_initie',
        historique_statuts: [...(cmd.historique_statuts || []), {
          statut: 'paiement_initie',
          date: new Date().toISOString(),
          auteur: auteur || 'Client',
        }],
        operateur_paiement: operateur === 'airtel' ? 'Airtel Money' : 'Moov Money',
        telephone_paiement: telephone,
        singpay_reference: data.reference,
        reference_paiement: data.reference,
        date_paiement_initie: new Date().toISOString(),
      });

      // Notifier le staff
      notifyNouvelleCommande(`Paiement ${operateur === 'airtel' ? 'Airtel Money' : 'Moov Money'} initie — ${cmd.client_nom} — ${fmt(montant)} F — ${cmd.numero}`);

      setPaiementEtape('pending');

      // Polling toutes les 5 secondes pour verifier le statut
      const interval = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/singpay-status?reference=${data.reference}`);
          const statusData = await statusRes.json();

          if (statusData.status === 'paid') {
            clearInterval(interval);
            pollingRef.current = null;
            setPaiementEtape('success');
            toast.success('Paiement confirme ! Commande en production.');
            setTimeout(() => { setShowPaiement(null); loadData(); }, 2500);
          } else if (['failed', 'expired', 'cancelled'].includes(statusData.status)) {
            clearInterval(interval);
            pollingRef.current = null;
            setPaiementEtape('error');
            setPaiementError('Paiement non abouti. Reessayez ou contactez-nous au 060 44 46 34.');
          }
        } catch { /* continue polling */ }
      }, 5000);
      pollingRef.current = interval;

      // Arreter le polling apres 5 minutes
      setTimeout(() => {
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
      }, 300000);

    } catch (err) {
      console.error('Erreur paiement SingPay:', err);
      setPaiementEtape('error');
      setPaiementError(err.message || 'Erreur lors du paiement');
    } finally {
      setPaiementLoading(false);
    }
  };

  // ── Télécharger la facture PDF liée à la commande ──
  const handleDownloadFacture = async (cmd) => {
    try {
      const allFactures = await db.factures.list();
      const facture = allFactures.find((f) =>
        f.commande_id === cmd.id || f.commande_numero === cmd.numero
      );
      if (facture) {
        const lignes = (facture.lignes || []).map((l) => ({
          description: l.description || l.designation || 'Article',
          quantite: l.quantite || 1,
          prix_unitaire: l.prix_unitaire || l.prix || 0,
        }));
        if (lignes.length === 0) {
          lignes.push({ description: facture.objet || 'Commande', quantite: 1, prix_unitaire: facture.total_ttc || facture.montant_total || 0 });
        }
        exportDocument(facture, lignes, 'facture');
      } else {
        // Pas de facture trouvée, générer un PDF à partir de la commande
        const lignes = (cmd.lignes || []).map((l) => ({
          description: l.nom || l.description || 'Article',
          quantite: l.qte || l.quantite || 1,
          prix_unitaire: l.prix || l.prix_unitaire || 0,
        }));
        if (lignes.length === 0) {
          lignes.push({ description: cmd.description || 'Commande', quantite: 1, prix_unitaire: cmd.montant_total || cmd.total || 0 });
        }
        exportDocument({
          numero: cmd.numero,
          client_nom: cmd.client_nom,
          date: cmd.created_at?.slice(0, 10),
          statut: 'livree',
          objet: cmd.description,
        }, lignes, 'facture');
      }
    } catch (err) {
      console.error('Erreur téléchargement facture:', err);
      toast.error('Erreur lors du téléchargement');
    }
  };

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

                  {/* ── Bouton PAYER — uniquement quand validee_attente_paiement ── */}
                  {cmd.statut === 'validee_attente_paiement' && (
                    <div className="mt-3">
                      <Button
                        className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700 text-base py-6"
                        onClick={() => openPaiement(cmd)}
                      >
                        <Smartphone className="h-5 w-5" />
                        Payer par Mobile Money — {fmt(cmd.montant_total || cmd.total)} F
                      </Button>
                      <p className="text-[10px] text-muted-foreground text-center mt-1.5">
                        Airtel Money ou Moov Money
                      </p>
                    </div>
                  )}

                  {/* ── Statut paiement initie ── */}
                  {cmd.statut === 'paiement_initie' && (
                    <div className="mt-3 rounded-lg bg-yellow-50 border border-yellow-300 p-3">
                      <p className="text-sm font-semibold text-yellow-800">Paiement {cmd.operateur_paiement} initie</p>
                      <p className="text-xs text-yellow-700 mt-1">
                        Notre equipe va confirmer la reception de votre paiement.
                        Votre commande passera automatiquement en production.
                      </p>
                    </div>
                  )}

                  {/* ── Bouton Télécharger facture — uniquement quand livrée ── */}
                  {cmd.statut === 'livree' && (
                    <Button
                      variant="outline"
                      className="w-full gap-2 mt-3"
                      onClick={() => handleDownloadFacture(cmd)}
                    >
                      <Download className="h-4 w-4" />
                      Télécharger ma facture PDF
                    </Button>
                  )}

                  {/* Progress gauge */}
                  <ProgressGauge currentStep={cfg.step} />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ═══ Modal Paiement SingPay Mobile Money ═══ */}
      <Dialog open={!!showPaiement} onOpenChange={() => { if (paiementEtape !== 'pending') { setShowPaiement(null); if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; } } }}>
        <DialogContent className="max-w-md">
          {showPaiement && paiementEtape === 'form' && (
            <div className="space-y-4">
              <div className="text-center">
                <h2 className="text-xl font-bold flex items-center justify-center gap-2">
                  <Smartphone className="h-5 w-5 text-primary" />
                  Paiement Mobile Money
                </h2>
                <p className="text-xs text-muted-foreground mt-1">via SingPay — Agregateur gabonais securise</p>
              </div>

              <div className="rounded-xl bg-muted/50 p-4 text-center">
                <p className="text-xs text-muted-foreground">Montant a payer</p>
                <p className="text-2xl font-bold text-emerald-600">{fmt(showPaiement.montant_total || showPaiement.total)} FCFA</p>
                <p className="text-xs text-muted-foreground mt-1">Commande {showPaiement.numero}</p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Choisissez votre operateur</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setOperateur('airtel')}
                    className={`flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all ${
                      operateur === 'airtel' ? 'border-red-500 bg-red-50 ring-2 ring-red-200' : 'border-muted hover:border-red-300'
                    }`}
                  >
                    <img
                      src="/logos/airtel-money.png"
                      alt="Airtel Money"
                      className="h-12 w-12 object-contain"
                      onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'inline'; }}
                    />
                    <span className="text-2xl hidden">📱</span>
                    <span className="text-sm font-semibold">Airtel Money</span>
                  </button>
                  <button
                    onClick={() => setOperateur('moov')}
                    className={`flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all ${
                      operateur === 'moov' ? 'border-orange-500 bg-orange-50 ring-2 ring-orange-200' : 'border-muted hover:border-orange-300'
                    }`}
                  >
                    <img
                      src="/logos/moov-money.png"
                      alt="Moov Money"
                      className="h-12 w-12 object-contain"
                      onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'inline'; }}
                    />
                    <span className="text-2xl hidden">📱</span>
                    <span className="text-sm font-semibold">Moov Money</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5">Votre numero de telephone</label>
                <Input
                  type="tel"
                  placeholder="Ex: 065537128 ou 075537128"
                  value={telephone}
                  onChange={(e) => setTelephone(e.target.value)}
                  className="text-lg"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Format gabonais 9 chiffres commencant par 06 (Moov) ou 07 (Airtel)
                </p>
              </div>

              <p className="text-[10px] text-muted-foreground">
                Vous recevrez une demande de paiement sur votre telephone.
                La commande passera en production apres confirmation.
              </p>

              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setShowPaiement(null)}>
                  Annuler
                </Button>
                <Button
                  className="flex-1 gap-2 bg-emerald-600 hover:bg-emerald-700"
                  onClick={handleInitierPaiement}
                  disabled={!operateur || !telephone || telephone.length < 8 || paiementLoading}
                >
                  {paiementLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                  {paiementLoading ? 'Envoi...' : 'Confirmer le paiement'}
                </Button>
              </div>
            </div>
          )}

          {showPaiement && paiementEtape === 'pending' && (
            <div className="text-center py-8 space-y-4">
              <div className="text-5xl animate-pulse">📱</div>
              <h3 className="text-xl font-bold">En attente de confirmation</h3>
              <p className="text-muted-foreground">Veuillez confirmer le paiement de</p>
              <p className="text-2xl font-bold text-emerald-600">{fmt(showPaiement.montant_total || showPaiement.total)} FCFA</p>
              <p className="text-sm text-muted-foreground">sur votre telephone {telephone}</p>
              <div className="flex justify-center gap-1.5">
                {[0,1,2].map((i) => (
                  <div key={i} className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">Verification automatique en cours... Ne fermez pas cette fenetre.</p>
            </div>
          )}

          {showPaiement && paiementEtape === 'success' && (
            <div className="text-center py-8 space-y-3">
              <div className="text-6xl">✅</div>
              <h3 className="text-xl font-bold text-emerald-600">Paiement confirme !</h3>
              <p className="text-muted-foreground">Votre commande est maintenant en production.</p>
            </div>
          )}

          {showPaiement && paiementEtape === 'error' && (
            <div className="text-center py-8 space-y-4">
              <div className="text-5xl">❌</div>
              <h3 className="text-xl font-bold text-red-600">Paiement non abouti</h3>
              <p className="text-sm text-muted-foreground">{paiementError}</p>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setShowPaiement(null)}>
                  Fermer
                </Button>
                <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => setPaiementEtape('form')}>
                  Reessayer
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
