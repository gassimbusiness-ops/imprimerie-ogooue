import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { db, getSettings } from '@/services/db';
import { useAuth } from '@/services/auth';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Package, FileText, MessageCircle, ShoppingBag, Clock, CheckCircle, Truck,
  Printer, XCircle, Gift, Copy,
} from 'lucide-react';
import { toast } from 'sonner';

function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)); }

const STATUTS_COMMANDE = {
  en_attente_validation: { label: 'En attente', color: 'bg-amber-100 text-amber-700', step: 0 },
  en_attente: { label: 'En attente', color: 'bg-amber-100 text-amber-700', step: 0 },
  nouveau: { label: 'En attente', color: 'bg-amber-100 text-amber-700', step: 0 },
  validee_attente_paiement: { label: 'Validée', color: 'bg-emerald-100 text-emerald-700', step: 1 },
  en_production: { label: 'En production', color: 'bg-blue-100 text-blue-700', step: 2 },
  en_cours: { label: 'En production', color: 'bg-blue-100 text-blue-700', step: 2 },
  prete: { label: 'Prête', color: 'bg-violet-100 text-violet-700', step: 3 },
  pret: { label: 'Prête', color: 'bg-violet-100 text-violet-700', step: 3 },
  terminee: { label: 'Prête', color: 'bg-violet-100 text-violet-700', step: 3 },
  livree: { label: 'Livrée', color: 'bg-gray-100 text-gray-600', step: 4 },
  livre: { label: 'Livrée', color: 'bg-gray-100 text-gray-600', step: 4 },
  annulee: { label: 'Annulée', color: 'bg-red-100 text-red-700', step: -1 },
  annule: { label: 'Annulée', color: 'bg-red-100 text-red-700', step: -1 },
};

const NIVEAUX = {
  bronze: { label: 'Bronze', icon: '🥉', color: 'from-amber-600 to-amber-800', nextLabel: 'Argent', nextMin: 500 },
  argent: { label: 'Argent', icon: '🥈', color: 'from-gray-400 to-gray-600', nextLabel: 'Or', nextMin: 2000 },
  or: { label: 'Or', icon: '🥇', color: 'from-yellow-400 to-yellow-600', nextLabel: 'Platine', nextMin: 5000 },
  platine: { label: 'Platine', icon: '💎', color: 'from-blue-400 to-indigo-600', nextLabel: null, nextMin: null },
};

const STEPS = ['Envoyée', 'Validée', 'Production', 'Prête', 'Livrée'];

function MiniProgress({ step }) {
  if (step < 0) return null;
  return (
    <div className="flex items-center gap-0.5 mt-1.5">
      {STEPS.map((_, i) => (
        <div key={i} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-primary' : 'bg-muted'}`} />
      ))}
    </div>
  );
}

export default function ClientDashboard() {
  const { user } = useAuth();
  const [commandes, setCommandes] = useState([]);
  const [factures, setFactures] = useState([]);
  const [messages, setMessages] = useState([]);
  const [fidelite, setFidelite] = useState(null);
  const [bannerSettings, setBannerSettings] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      const clientName = `${user?.prenom || ''} ${user?.nom || ''}`.trim().toLowerCase();
      const clientId = user?.id;

      const [cmds, devisAll, convs, allMsgs, fidAll, settings] = await Promise.all([
        db.commandes.list(),
        db.devis.list(),
        db.conversations.list(),
        db.messages_conv.list(),
        db.fidelite_clients.list(),
        getSettings(),
      ]);

      const myCommandes = cmds
        .filter((c) => (c.client_id && c.client_id === clientId) || (c.client_nom || '').toLowerCase().includes(clientName))
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
        .slice(0, 5);
      setCommandes(myCommandes);

      setFactures(devisAll.filter((f) => (f.client_nom || '').toLowerCase().includes(clientName)).slice(0, 3));

      const myConv = convs.find((c) =>
        c.client_email === user?.email ||
        c.client_nom?.toLowerCase() === clientName
      );
      if (myConv) {
        const convMsgs = allMsgs
          .filter((m) => m.conversation_id === myConv.id)
          .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
          .slice(0, 2);
        setMessages(convMsgs);
      }

      const myFid = fidAll.find((f) => f.client_id === clientId);
      setFidelite(myFid);

      setBannerSettings(settings?.banniere_client || null);
      setLoading(false);
    };
    loadData();
  }, [user]);

  const copyCode = () => {
    if (fidelite?.code_parrainage) {
      navigator.clipboard.writeText(fidelite.code_parrainage);
      toast.success('Code copié !');
    }
  };

  if (loading) return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;

  const niveauConfig = NIVEAUX[fidelite?.niveau || 'bronze'] || NIVEAUX.bronze;

  return (
    <div className="space-y-6">
      {/* ── Bannière de couverture ── */}
      <div
        className="relative rounded-2xl overflow-hidden"
        style={bannerSettings?.image ? { background: `url(${bannerSettings.image}) center/cover no-repeat` } : undefined}
      >
        <div className={`${!bannerSettings?.image ? 'bg-gradient-to-br from-primary to-blue-700' : ''} p-6 sm:p-8 text-white`}
          style={bannerSettings?.couleur && !bannerSettings?.image ? { background: bannerSettings.couleur } : undefined}
        >
          {bannerSettings?.image && <div className="absolute inset-0 bg-black/40" />}
          <div className="relative z-10">
            <h1 className="text-2xl sm:text-3xl font-bold">
              {bannerSettings?.texte || `Bienvenue, ${user?.prenom} !`}
            </h1>
            <p className="text-white/80 mt-1 text-sm sm:text-base">
              {bannerSettings?.sous_texte || 'Suivez vos commandes et gérez vos devis depuis votre espace dédié.'}
            </p>
          </div>
        </div>
      </div>

      {/* ── Carte fidélité ── */}
      {fidelite && (
        <Card className="overflow-hidden border-0 shadow-lg">
          <div className={`bg-gradient-to-r ${niveauConfig.color} p-4 sm:p-5 text-white`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/20 text-2xl">
                  {niveauConfig.icon}
                </div>
                <div>
                  <p className="text-sm opacity-80">Programme de fidélité</p>
                  <p className="text-xl font-bold">Niveau {niveauConfig.label}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-3xl font-black">{fidelite.points_actuels || 0}</p>
                <p className="text-xs opacity-80">points</p>
              </div>
            </div>

            {niveauConfig.nextMin && (
              <div className="mt-4">
                <div className="flex justify-between text-xs opacity-80 mb-1">
                  <span>{niveauConfig.label}</span>
                  <span>{niveauConfig.nextLabel}</span>
                </div>
                <div className="h-2.5 rounded-full bg-white/20 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-white/80 transition-all duration-700"
                    style={{ width: `${Math.min(100, ((fidelite.total_points_gagnes || 0) / niveauConfig.nextMin) * 100)}%` }}
                  />
                </div>
                <p className="text-xs opacity-80 mt-1.5 text-center">
                  {niveauConfig.nextMin - (fidelite.total_points_gagnes || 0) > 0
                    ? `Plus que ${niveauConfig.nextMin - (fidelite.total_points_gagnes || 0)} points pour ${niveauConfig.nextLabel} !`
                    : `Niveau ${niveauConfig.nextLabel} atteint !`
                  }
                </p>
              </div>
            )}

            <div className="mt-4 flex items-center gap-2 rounded-lg bg-white/15 px-3 py-2">
              <Gift className="h-4 w-4 shrink-0" />
              <span className="text-xs">Mon code :</span>
              <span className="font-mono font-bold text-sm flex-1">{fidelite.code_parrainage}</span>
              <button
                onClick={copyCode}
                className="flex items-center gap-1 rounded bg-white/20 px-2 py-1 text-xs hover:bg-white/30 transition-colors"
              >
                <Copy className="h-3 w-3" /> Copier
              </button>
            </div>
          </div>
        </Card>
      )}

      {/* ── Quick actions ── */}
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

      {/* ── Dernières commandes avec mini jauge ── */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold flex items-center gap-2">
              <Package className="h-4 w-4 text-muted-foreground" />
              Dernières commandes
            </h2>
            <Link to="/client/commandes" className="text-sm text-primary hover:underline">Voir tout →</Link>
          </div>
          {commandes.length === 0 ? (
            <div className="text-center py-8">
              <ShoppingBag className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" />
              <p className="text-muted-foreground text-sm">Aucune commande pour le moment</p>
              <Link to="/client/catalogue" className="text-primary text-sm hover:underline mt-2 inline-block">
                Parcourir le catalogue →
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {commandes.map((cmd) => {
                const cfg = STATUTS_COMMANDE[cmd.statut] || STATUTS_COMMANDE.en_attente_validation;
                return (
                  <div key={cmd.id} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-sm">{cmd.numero || 'CMD'}</p>
                          <Badge className={`${cfg.color} text-[10px]`}>{cfg.label}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[200px]">{cmd.description || cmd.service}</p>
                      </div>
                      <span className="font-bold text-sm shrink-0">{fmt(cmd.montant_total || cmd.total)} F</span>
                    </div>
                    <MiniProgress step={cfg.step} />
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Derniers messages ── */}
      {messages.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-muted-foreground" />
                Derniers messages
              </h2>
              <Link to="/client/messagerie" className="text-sm text-primary hover:underline">Voir tout →</Link>
            </div>
            <div className="space-y-2">
              {messages.map((m) => (
                <div key={m.id} className="flex items-start gap-3 rounded-lg bg-muted/50 p-3">
                  <MessageCircle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{m.contenu}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {m.auteur && `${m.auteur} — `}
                      {m.created_at ? new Date(m.created_at).toLocaleDateString('fr-FR') : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Devis en attente ── */}
      {factures.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                Derniers devis
              </h2>
              <Link to="/client/factures" className="text-sm text-primary hover:underline">Voir tout →</Link>
            </div>
            <div className="space-y-2">
              {factures.map((f) => (
                <div key={f.id} className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <p className="font-medium text-sm">{f.numero || 'DEV'}</p>
                    <p className="text-xs text-muted-foreground">{f.date || f.created_at?.slice(0, 10)}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-sm">{fmt(f.total || f.montant)} F</p>
                    <Badge variant="outline" className="text-[10px]">{f.statut || 'En attente'}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
