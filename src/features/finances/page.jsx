import { useState, useEffect, useMemo } from 'react';
import { db } from '@/services/db';
import { logAction } from '@/services/audit';
import { useAuth } from '@/services/auth';
import { executerPrelevementsDus } from '@/services/credit-mensualites';
import { executerChargesDues } from '@/services/charges-fixes-prelevement';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Landmark, Plus, Edit2, Trash2, CreditCard, Users2, TrendingUp,
  Receipt, CircleDollarSign, ArrowUpRight, ArrowDownLeft, ArrowLeftRight,
  Calendar, Building2, Globe, Wallet, Banknote, RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';

function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)); }

// ── Helpers credit ─────────────────────────────────────────────
function calcMensualite(montant_initial, taux_interet, duree_mois) {
  const m = Number(montant_initial) || 0;
  const t = Number(taux_interet) || 0;
  const d = Number(duree_mois) || 0;
  if (!m || !d) return 0;
  // Capital + interets simples sur la duree totale, divise en mensualites egales
  return Math.round((m * (1 + t / 100)) / d);
}
function addMonths(dateStr, n = 1) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
}

const TABS = [
  { id: 'comptes', label: 'Comptes bancaires', icon: Building2 },
  { id: 'mouvements', label: 'Mouvements', icon: ArrowLeftRight },
  { id: 'charges', label: 'Charges fixes', icon: Receipt },
  { id: 'dettes', label: 'Dettes & Crédits', icon: CreditCard },
  { id: 'actionnaires', label: 'Actionnaires', icon: Users2 },
  { id: 'investissements', label: 'Investissements', icon: TrendingUp },
];

const BANK_TYPES = [
  { value: 'local', label: 'Banque locale' },
  { value: 'international', label: 'Banque internationale' },
  { value: 'mobile', label: 'Mobile Money' },
  { value: 'online', label: 'Paiement en ligne' },
];

const DEFAULT_BANKS = [
  { nom: 'FINAM', type: 'local', devise: 'XAF', color: 'emerald' },
  { nom: 'BGFI Bank', type: 'local', devise: 'XAF', color: 'blue' },
  { nom: 'Wise', type: 'international', devise: 'EUR', color: 'green' },
  { nom: 'PayPal', type: 'online', devise: 'EUR', color: 'indigo' },
  { nom: 'Mercury', type: 'international', devise: 'USD', color: 'violet' },
  { nom: 'Airwallex', type: 'online', devise: 'USD', color: 'orange' },
  { nom: 'Stripe', type: 'online', devise: 'EUR', color: 'purple' },
];

const MOVEMENT_TYPES = [
  { value: 'entree', label: 'Entrée', icon: ArrowDownLeft, color: 'text-emerald-600' },
  { value: 'sortie', label: 'Sortie', icon: ArrowUpRight, color: 'text-red-600' },
  { value: 'transfert', label: 'Transfert', icon: ArrowLeftRight, color: 'text-blue-600' },
  { value: 'depot_hebdo', label: 'Dépôt hebdomadaire', icon: Banknote, color: 'text-amber-600' },
];

const CHARGE_TYPES = [
  'loyer', 'salaire', 'electricite', 'eau', 'internet', 'telephone',
  'assurance', 'transport', 'fournitures', 'maintenance', 'online',
  'abonnement', 'marketing', 'impots', 'autre',
];

export default function Finances() {
  const { isAdmin, isManager } = useAuth();
  const [activeTab, setActiveTab] = useState('comptes');

  // Data states
  const [comptes, setComptes] = useState([]);
  const [mouvements, setMouvements] = useState([]);
  const [charges, setCharges] = useState([]);
  const [dettes, setDettes] = useState([]);
  const [actionnaires, setActionnaires] = useState([]);
  const [investissements, setInvestissements] = useState([]);
  const [loading, setLoading] = useState(true);

  // UI states
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({});
  const [filterMonth, setFilterMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  // Filtres avances mouvements : plage de dates + recherche + "tout afficher"
  const [mvDateFrom, setMvDateFrom] = useState('');
  const [mvDateTo, setMvDateTo] = useState('');
  const [mvSearch, setMvSearch] = useState('');
  const [mvShowAll, setMvShowAll] = useState(false); // bypass total du filtre mois

  const load = async () => {
    const [cp, mv, ch, de, ac, inv] = await Promise.all([
      db.comptes_bancaires.list(),
      db.mouvements_financiers.list(),
      db.charges_fixes.list(),
      db.dettes.list(),
      db.actionnaires.list(),
      db.investissements.list(),
    ]);
    setComptes(cp);
    setMouvements(mv.sort((a, b) => (b.date || b.created_at || '').localeCompare(a.date || a.created_at || '')));
    setCharges(ch);
    setDettes(de);
    setActionnaires(ac);
    setInvestissements(inv);
    setLoading(false);
  };

  useEffect(() => {
    (async () => {
      await load();
      // Rattrapage automatique des mensualites + charges fixes dues au chargement (silencieux)
      try {
        const [rCredit, rCharges] = await Promise.all([
          executerPrelevementsDus(),
          executerChargesDues(),
        ]);
        const totalAuto = (rCredit.processed?.length || 0) + (rCharges.processed?.length || 0);
        if (totalAuto > 0) {
          toast.success(`${totalAuto} prélèvement(s) automatique(s) effectué(s)`);
          await load(); // refresh apres prelevements
        }
      } catch (e) {
        console.error('[Finances] Erreur prelevements auto:', e);
      }
    })();
  }, []);

  const handleForcerPrelevement = async () => {
    const r = await executerPrelevementsDus();
    if (r.errors.length > 0) {
      toast.error(`${r.errors.length} erreur(s) — voir console`);
      console.error('[Finances] Erreurs prelevement:', r.errors);
    }
    if (r.processed.length > 0) {
      const total = r.processed.reduce((s, p) => s + (p.montant_total || 0), 0);
      const totalMens = r.processed.reduce((s, p) => s + (p.mensualites || 0), 0);
      toast.success(`${totalMens} mensualité(s) prélevée(s) — ${fmt(total)} F`);
      await logAction('update', 'finances', { entityLabel: 'Prélèvement crédits', details: `${totalMens} mensualités, ${fmt(total)} F` });
      await load();
    } else if (r.errors.length === 0) {
      toast.info('Aucune échéance due');
    }
  };

  const handleForcerPrelevementCharges = async () => {
    const r = await executerChargesDues();
    if (r.errors.length > 0) {
      toast.error(`${r.errors.length} erreur(s) — voir console`);
      console.error('[Finances] Erreurs prelevement charges:', r.errors);
    }
    if (r.processed.length > 0) {
      const total = r.processed.reduce((s, p) => s + (p.montant_total || 0), 0);
      const totalEch = r.processed.reduce((s, p) => s + (p.echeances || 0), 0);
      toast.success(`${totalEch} charge(s) prélevée(s) — ${fmt(total)} F`);
      await logAction('update', 'finances', { entityLabel: 'Prélèvement charges fixes', details: `${totalEch} échéances, ${fmt(total)} F` });
      await load();
    } else if (r.errors.length === 0) {
      toast.info('Aucune charge due');
    }
  };

  // ── KPIs ──
  const totalSoldeComptes = comptes.reduce((s, c) => s + (c.solde || 0), 0);
  // Tresorerie Imprimerie uniquement (whitelist + blacklist)
  const COMPTES_IMPRIMERIE = ['finam', 'bgfi', 'airtel', 'moov', 'caisse', 'liquide'];
  const COMPTES_EXCLUS = ['wise', 'mercury', 'paypal', 'stripe', 'airwallex'];
  const tresorerieImprimerie = comptes.filter((c) => {
    const nom = (c.nom || '').toLowerCase();
    if (COMPTES_EXCLUS.some((k) => nom.includes(k))) return false;
    return COMPTES_IMPRIMERIE.some((k) => nom.includes(k)) || c.appartient_imprimerie === true;
  }).reduce((s, c) => s + (c.solde || 0), 0);
  const totalCharges = charges.filter((c) => c.actif !== false).reduce((s, c) => s + (c.montant || 0), 0);
  const totalDettes = dettes.reduce((s, d) => s + (d.montant_restant || d.montant_initial || 0), 0);
  const totalInvest = investissements.reduce((s, i) => s + (i.montant || 0), 0);
  const totalParts = actionnaires.reduce((s, a) => s + (a.pourcentage || 0), 0);

  // Mouvements filtrés : plage de dates OU mois OU tout afficher + recherche mot-cle
  const mvUsePlage = !!(mvDateFrom || mvDateTo);
  const mouvementsFiltres = useMemo(() => {
    const q = (mvSearch || '').trim().toLowerCase();
    return mouvements.filter((m) => {
      const d = (m.date || m.created_at || '').slice(0, 10);
      // Filtre date : plage > mois > all
      if (mvShowAll) {
        // pas de filtre date
      } else if (mvUsePlage) {
        if (mvDateFrom && d < mvDateFrom) return false;
        if (mvDateTo && d > mvDateTo) return false;
      } else {
        if (!d.startsWith(filterMonth)) return false;
      }
      // Filtre recherche : description, reference, source, categorie, compte_nom
      if (q) {
        const compte = comptes.find((c) => c.id === m.compte_id);
        const hay = [
          m.description, m.reference, m.source, m.categorie,
          compte?.nom,
        ].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [mouvements, filterMonth, mvDateFrom, mvDateTo, mvSearch, mvUsePlage, mvShowAll, comptes]);

  const mvEntrees = mouvementsFiltres.filter((m) => m.type === 'entree' || m.type === 'depot_hebdo').reduce((s, m) => s + (m.montant || 0), 0);
  const mvSorties = mouvementsFiltres.filter((m) => m.type === 'sortie').reduce((s, m) => s + (m.montant || 0), 0);

  // ── Helpers ──
  const getCollection = () => {
    const map = {
      comptes: db.comptes_bancaires,
      mouvements: db.mouvements_financiers,
      charges: db.charges_fixes,
      dettes: db.dettes,
      actionnaires: db.actionnaires,
      investissements: db.investissements,
    };
    return map[activeTab];
  };

  const openAdd = () => {
    setEditItem(null);
    if (activeTab === 'comptes') {
      setForm({ nom: '', type: 'local', devise: 'XAF', solde: '', numero_compte: '', notes: '' });
    } else if (activeTab === 'mouvements') {
      setForm({ type: 'entree', montant: '', description: '', compte_id: '', compte_dest_id: '', date: new Date().toISOString().slice(0, 10), reference: '' });
    } else if (activeTab === 'charges') {
      setForm({
        libelle: '', type: 'loyer', montant: '', beneficiaire: '', actif: true, categorie: '',
        compte_id: '', periodicite: 'mensuelle', jour_prelevement: '5', prelevement_auto: false,
        prochaine_echeance: '',
      });
    } else if (activeTab === 'dettes') {
      setForm({ libelle: '', montant_initial: '', taux_interet: '2.5', duree_mois: '', montant_restant: '', date_debut: new Date().toISOString().slice(0, 10), compte_id: '', jour_prelevement: '5', prelevement_auto: true, statut: 'actif' });
    } else if (activeTab === 'actionnaires') {
      setForm({ nom: '', pourcentage: '', investissement: '' });
    } else {
      setForm({ titre: '', description: '', montant: '', roi_estime: '', statut: 'en_cours' });
    }
    setShowForm(true);
  };

  const openEdit = (item) => {
    setEditItem(item);
    setForm({ ...item });
    setShowForm(true);
  };

  const handleSave = async () => {
    const coll = getCollection();
    const data = { ...form };
    // Convert numbers
    ['montant', 'solde', 'montant_initial', 'taux_interet', 'duree_mois', 'montant_restant', 'pourcentage', 'investissement', 'roi_estime', 'jour_prelevement'].forEach((k) => {
      if (data[k] !== undefined && data[k] !== '') data[k] = Number(data[k]) || 0;
    });

    // DETTES : auto-calcul mensualite + prochaine echeance si manquant
    if (activeTab === 'dettes') {
      data.mensualite_montant = calcMensualite(data.montant_initial, data.taux_interet, data.duree_mois);
      if (data.montant_restant === undefined || data.montant_restant === '' || data.montant_restant === 0) {
        // A la creation : restant = initial + interets totaux
        if (!editItem) {
          data.montant_restant = Math.round((data.montant_initial || 0) * (1 + (data.taux_interet || 0) / 100));
        }
      }
      if (!data.prochaine_echeance && data.date_debut && data.jour_prelevement) {
        // Premiere echeance = date_debut + 1 mois, ajustee au jour_prelevement
        const next = new Date(data.date_debut);
        next.setMonth(next.getMonth() + 1);
        next.setDate(Math.min(Number(data.jour_prelevement) || 5, 28));
        data.prochaine_echeance = next.toISOString().slice(0, 10);
      }
      if (!data.statut) data.statut = 'actif';
    }

    // CHARGES FIXES : auto-renseigne prochaine_echeance si manquant
    if (activeTab === 'charges' && data.prelevement_auto) {
      if (!data.prochaine_echeance) {
        // Premier prelevement = aujourd'hui + jour_prelevement du mois prochain
        const next = new Date();
        next.setMonth(next.getMonth() + 1);
        next.setDate(Math.min(Number(data.jour_prelevement) || 5, 28));
        data.prochaine_echeance = next.toISOString().slice(0, 10);
      }
    }

    // Mouvement: update account balance
    if (activeTab === 'mouvements' && !editItem) {
      const compte = comptes.find((c) => c.id === data.compte_id);
      if (data.type === 'entree' || data.type === 'depot_hebdo') {
        if (compte) await db.comptes_bancaires.update(compte.id, { solde: (compte.solde || 0) + data.montant });
      } else if (data.type === 'sortie') {
        if (compte) await db.comptes_bancaires.update(compte.id, { solde: (compte.solde || 0) - data.montant });
      } else if (data.type === 'transfert') {
        if (compte) await db.comptes_bancaires.update(compte.id, { solde: (compte.solde || 0) - data.montant });
        const dest = comptes.find((c) => c.id === data.compte_dest_id);
        if (dest) await db.comptes_bancaires.update(dest.id, { solde: (dest.solde || 0) + data.montant });
      }
    }

    if (editItem) {
      await coll.update(editItem.id, data);
      await logAction('update', 'finances', { entityId: editItem.id, entityLabel: data.nom || data.libelle || data.titre || data.description || '', details: `Modification ${activeTab}` });
      toast.success('Modifié');
    } else {
      const created = await coll.create(data);
      await logAction('create', 'finances', { entityId: created.id, entityLabel: data.nom || data.libelle || data.titre || data.description || '', details: `Ajout ${activeTab}` });
      toast.success('Ajouté');
    }
    setShowForm(false);
    load();
  };

  const handleDelete = async (item) => {
    if (!confirm('Supprimer cet élément ?')) return;

    // Si c'est un mouvement financier, annuler son impact sur le solde du compte
    // (operation inverse de ce qui est fait a la creation, lignes 307-318)
    if (activeTab === 'mouvements' && item.compte_id) {
      const compte = comptes.find((c) => c.id === item.compte_id);
      const montant = item.montant || 0;
      if (compte) {
        if (item.type === 'entree' || item.type === 'depot_hebdo') {
          // Etait un credit : on debite pour annuler
          await db.comptes_bancaires.update(compte.id, { solde: (compte.solde || 0) - montant });
        } else if (item.type === 'sortie') {
          // Etait un debit : on credite pour annuler
          await db.comptes_bancaires.update(compte.id, { solde: (compte.solde || 0) + montant });
        } else if (item.type === 'transfert') {
          // Inverse du transfert : recrediter la source + redebiter la destination
          await db.comptes_bancaires.update(compte.id, { solde: (compte.solde || 0) + montant });
          const dest = comptes.find((c) => c.id === item.compte_dest_id);
          if (dest) {
            await db.comptes_bancaires.update(dest.id, { solde: (dest.solde || 0) - montant });
          }
        }
      }
    }

    await getCollection().delete(item.id);
    await logAction('delete', 'finances', { entityId: item.id, entityLabel: item.nom || item.libelle || item.titre || item.description || '', details: `Suppression ${activeTab}` });
    toast.success('Supprimé');
    load();
  };

  const seedDefaultBanks = async () => {
    if (comptes.length > 0) { toast.info('Des comptes existent déjà'); return; }
    for (const bank of DEFAULT_BANKS) {
      await db.comptes_bancaires.create({ ...bank, solde: 0, numero_compte: '', notes: '' });
    }
    toast.success('Comptes par défaut créés');
    load();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  }

  const compteNom = (id) => comptes.find((c) => c.id === id)?.nom || '—';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Finances</h2>
        <p className="text-muted-foreground">Comptes bancaires, mouvements, charges, dettes et investissements</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Card className="border-l-4 border-l-emerald-500"><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Tresorerie Imprimerie</p>
          <p className="text-xl font-bold text-emerald-700">{fmt(tresorerieImprimerie)} F</p>
          {totalSoldeComptes !== tresorerieImprimerie && (
            <p className="text-[10px] text-muted-foreground mt-0.5">Tous comptes : {fmt(totalSoldeComptes)} F</p>
          )}
        </CardContent></Card>
        <Card className="border-l-4 border-l-red-500"><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Charges mensuelles</p>
          <p className="text-xl font-bold text-red-600">{fmt(totalCharges)} F</p>
        </CardContent></Card>
        <Card className="border-l-4 border-l-orange-500"><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Dettes restantes</p>
          <p className="text-xl font-bold">{fmt(totalDettes)} F</p>
        </CardContent></Card>
        <Card className="border-l-4 border-l-blue-500"><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Investissements</p>
          <p className="text-xl font-bold">{fmt(totalInvest)} F</p>
        </CardContent></Card>
        <Card className="border-l-4 border-l-violet-500"><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Parts actionnaires</p>
          <p className="text-xl font-bold">{totalParts.toFixed(1)}%</p>
        </CardContent></Card>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b pb-0">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${activeTab === id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {activeTab === 'mouvements' && (
          <Input type="month" value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} className="w-auto" />
        )}
        {activeTab === 'comptes' && comptes.length === 0 && isAdmin && (
          <Button variant="outline" className="gap-2" onClick={seedDefaultBanks}><RefreshCw className="h-4 w-4" /> Créer comptes par défaut</Button>
        )}
        <div className="flex-1" />
        {(isAdmin || isManager) && (
          <Button className="gap-2" onClick={openAdd}><Plus className="h-4 w-4" /> Ajouter</Button>
        )}
      </div>

      {/* ═══════════ COMPTES BANCAIRES ═══════════ */}
      {activeTab === 'comptes' && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {comptes.length === 0 ? (
            <p className="col-span-full py-12 text-center text-sm text-muted-foreground">Aucun compte bancaire — cliquez &quot;Créer comptes par défaut&quot;</p>
          ) : comptes.map((c) => {
            const colorMap = { emerald: 'bg-emerald-500', blue: 'bg-blue-500', green: 'bg-green-500', indigo: 'bg-indigo-500', violet: 'bg-violet-500', orange: 'bg-orange-500', purple: 'bg-purple-500' };
            const bgClass = colorMap[c.color] || 'bg-slate-500';
            const typeLabel = BANK_TYPES.find((t) => t.value === c.type)?.label || c.type;
            return (
              <Card key={c.id} className="relative overflow-hidden">
                <div className={`absolute inset-x-0 top-0 h-1 ${bgClass}`} />
                <CardContent className="p-4 pt-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        {c.type === 'online' || c.type === 'international' ? <Globe className="h-4 w-4 text-muted-foreground" /> : <Building2 className="h-4 w-4 text-muted-foreground" />}
                        <h3 className="font-bold text-sm">{c.nom}</h3>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="text-[10px]">{typeLabel}</Badge>
                        <span className="text-[10px] text-muted-foreground">{c.devise}</span>
                      </div>
                    </div>
                    {(isAdmin || isManager) && (
                      <div className="flex gap-1">
                        <button onClick={() => openEdit(c)} className="rounded p-1.5 hover:bg-muted"><Edit2 className="h-3.5 w-3.5 text-muted-foreground" /></button>
                        <button onClick={() => handleDelete(c)} className="rounded p-1.5 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5 text-red-500" /></button>
                      </div>
                    )}
                  </div>
                  <div className="mt-4">
                    <p className="text-2xl font-bold">{fmt(c.solde)} <span className="text-sm font-normal text-muted-foreground">{c.devise === 'XAF' ? 'FCFA' : c.devise}</span></p>
                  </div>
                  {c.numero_compte && <p className="mt-1 text-[10px] text-muted-foreground">N° {c.numero_compte}</p>}
                  {c.notes && <p className="mt-1 text-[10px] text-muted-foreground">{c.notes}</p>}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ═══════════ MOUVEMENTS FINANCIERS ═══════════ */}
      {activeTab === 'mouvements' && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Card className="border-l-4 border-l-emerald-500"><CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground uppercase">Entrées {mvShowAll ? '(tout)' : mvUsePlage ? '(plage)' : 'du mois'}</p>
              <p className="text-lg font-bold text-emerald-600">+{fmt(mvEntrees)} F</p>
            </CardContent></Card>
            <Card className="border-l-4 border-l-red-500"><CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground uppercase">Sorties {mvShowAll ? '(tout)' : mvUsePlage ? '(plage)' : 'du mois'}</p>
              <p className="text-lg font-bold text-red-600">-{fmt(mvSorties)} F</p>
            </CardContent></Card>
            <Card className="border-l-4 border-l-blue-500"><CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground uppercase">Solde net</p>
              <p className={`text-lg font-bold ${mvEntrees - mvSorties >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmt(mvEntrees - mvSorties)} F</p>
            </CardContent></Card>
          </div>

          {/* Bandeau filtres avances */}
          <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">Filtrer :</span>
            </div>
            <div className="flex flex-col">
              <label className="text-[10px] text-muted-foreground">Du</label>
              <Input type="date" value={mvDateFrom} onChange={(e) => { setMvDateFrom(e.target.value); setMvShowAll(false); }} className="h-8 w-[140px]" disabled={mvShowAll} />
            </div>
            <div className="flex flex-col">
              <label className="text-[10px] text-muted-foreground">Au</label>
              <Input type="date" value={mvDateTo} onChange={(e) => { setMvDateTo(e.target.value); setMvShowAll(false); }} className="h-8 w-[140px]" disabled={mvShowAll} />
            </div>
            <div className="flex flex-col flex-1 min-w-[180px]">
              <label className="text-[10px] text-muted-foreground">Recherche (description, réf, compte, source)</label>
              <Input type="text" value={mvSearch} onChange={(e) => setMvSearch(e.target.value)} placeholder="Mot-clé..." className="h-8" />
            </div>
            <Button
              variant={mvShowAll ? 'default' : 'outline'}
              size="sm"
              onClick={() => { setMvShowAll((v) => !v); if (!mvShowAll) { setMvDateFrom(''); setMvDateTo(''); } }}
              className="h-8 gap-1"
            >
              <RefreshCw className="h-3.5 w-3.5" /> {mvShowAll ? 'Tout affiché' : 'Tout afficher'}
            </Button>
            {(mvDateFrom || mvDateTo || mvSearch || mvShowAll) && (
              <Button variant="ghost" size="sm" onClick={() => { setMvDateFrom(''); setMvDateTo(''); setMvSearch(''); setMvShowAll(false); }} className="h-8">
                Réinitialiser
              </Button>
            )}
            <Badge variant="outline" className="h-7">
              {mouvementsFiltres.length} / {mouvements.length} mouvements
            </Badge>
          </div>

          <Card><CardContent className="p-0">
            <div className="divide-y max-h-[70vh] overflow-y-auto">
              {mouvementsFiltres.length === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">Aucun mouvement</p> :
                mouvementsFiltres.map((m) => {
                  const mt = MOVEMENT_TYPES.find((t) => t.value === m.type);
                  const MtIcon = mt?.icon || ArrowLeftRight;
                  return (
                    <div key={m.id} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/50">
                      <div className={`flex h-9 w-9 items-center justify-center rounded-lg shrink-0 ${m.type === 'entree' || m.type === 'depot_hebdo' ? 'bg-emerald-500/10' : m.type === 'sortie' ? 'bg-red-500/10' : 'bg-blue-500/10'}`}>
                        <MtIcon className={`h-4 w-4 ${mt?.color || 'text-muted-foreground'}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm">{m.description || mt?.label}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Badge variant="outline" className="text-[10px]">{mt?.label}</Badge>
                          <span className="text-[10px] text-muted-foreground">{compteNom(m.compte_id)}</span>
                          {m.type === 'transfert' && <span className="text-[10px] text-muted-foreground">→ {compteNom(m.compte_dest_id)}</span>}
                          {m.reference && <span className="text-[10px] text-muted-foreground">Réf: {m.reference}</span>}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-sm font-bold ${m.type === 'entree' || m.type === 'depot_hebdo' ? 'text-emerald-600' : m.type === 'sortie' ? 'text-red-600' : 'text-blue-600'}`}>
                          {m.type === 'sortie' ? '-' : '+'}{fmt(m.montant)} F
                        </p>
                        <p className="text-[10px] text-muted-foreground">{m.date || m.created_at?.slice(0, 10)}</p>
                      </div>
                      {(isAdmin || isManager) && (
                        <div className="flex gap-1 shrink-0">
                          <button onClick={() => openEdit(m)} className="rounded p-1.5 hover:bg-muted"><Edit2 className="h-3.5 w-3.5 text-muted-foreground" /></button>
                          <button onClick={() => handleDelete(m)} className="rounded p-1.5 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5 text-red-500" /></button>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </CardContent></Card>
        </>
      )}

      {/* ═══════════ CHARGES FIXES ═══════════ */}
      {activeTab === 'charges' && (
        <>
          {/* Bouton forcer prelevement charges */}
          {(isAdmin || isManager) && charges.some((c) => c.prelevement_auto && c.actif !== false) && (
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={handleForcerPrelevementCharges} className="gap-2">
                <RefreshCw className="h-3.5 w-3.5" />
                Forcer prélèvement charges (échéances dues)
              </Button>
            </div>
          )}
          <Card><CardContent className="p-0">
            <div className="divide-y">
              {charges.length === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">Aucune charge fixe</p> :
                charges.map((c) => {
                  const compteSrc = c.compte_id ? compteNom(c.compte_id) : null;
                  const periodLabel = c.periodicite === 'annuelle' ? '/an' : c.periodicite === 'trimestrielle' ? '/trim.' : '/mois';
                  return (
                    <div key={c.id} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/50">
                      <div className={`flex h-9 w-9 items-center justify-center rounded-lg shrink-0 ${c.type === 'online' ? 'bg-purple-500/10' : 'bg-red-500/10'}`}>
                        {c.type === 'online' ? <Globe className="h-4 w-4 text-purple-600" /> : <Receipt className="h-4 w-4 text-red-600" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-sm">{c.libelle}</p>
                          {c.prelevement_auto && c.actif !== false && (
                            <Badge variant="outline" className="text-[9px] px-1.5 py-0 gap-1 border-emerald-500/40 text-emerald-700">
                              <RefreshCw className="h-2.5 w-2.5" />Auto
                            </Badge>
                          )}
                          {c.actif === false && <Badge className="text-[9px] px-1.5 py-0 bg-slate-200 text-slate-600">Inactif</Badge>}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <Badge variant="outline" className={`text-[10px] ${c.type === 'online' ? 'border-purple-300 text-purple-700' : ''}`}>{c.type}</Badge>
                          {c.beneficiaire && <span className="text-[10px] text-muted-foreground">{c.beneficiaire}</span>}
                          {compteSrc && <span className="text-[10px] text-muted-foreground">→ {compteSrc}</span>}
                          {c.prochaine_echeance && c.prelevement_auto && (
                            <span className="text-[10px] text-emerald-700 font-medium">échéance: {c.prochaine_echeance}</span>
                          )}
                        </div>
                      </div>
                      <span className="text-sm font-bold text-red-600 shrink-0">{fmt(c.montant)} F{periodLabel}</span>
                      {(isAdmin || isManager) && (
                        <div className="flex gap-1 shrink-0">
                          <button onClick={() => openEdit(c)} className="rounded p-1.5 hover:bg-muted"><Edit2 className="h-3.5 w-3.5 text-muted-foreground" /></button>
                          <button onClick={() => handleDelete(c)} className="rounded p-1.5 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5 text-red-500" /></button>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </CardContent></Card>
        </>
      )}

      {/* ═══════════ DETTES ═══════════ */}
      {activeTab === 'dettes' && (
        <>
          {/* Bouton forcer prelevement */}
          {(isAdmin || isManager) && dettes.some((d) => d.prelevement_auto && d.statut !== 'solde') && (
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={handleForcerPrelevement} className="gap-2">
                <RefreshCw className="h-3.5 w-3.5" />
                Forcer prélèvement (échéances dues)
              </Button>
            </div>
          )}
          <Card><CardContent className="p-0">
            <div className="divide-y">
              {dettes.length === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">Aucune dette</p> :
                dettes.map((d) => {
                  const progress = d.montant_initial > 0 ? ((d.montant_initial - (d.montant_restant || 0)) / d.montant_initial) * 100 : 0;
                  const mens = d.mensualite_montant || calcMensualite(d.montant_initial, d.taux_interet, d.duree_mois);
                  const compteSrc = d.compte_id ? compteNom(d.compte_id) : null;
                  const isSolde = d.statut === 'solde' || (d.montant_restant || 0) <= 0;
                  const isSuspendu = d.statut === 'suspendu';
                  return (
                    <div key={d.id} className="px-4 py-3 hover:bg-muted/50">
                      <div className="flex items-center gap-4">
                        <div className={`flex h-9 w-9 items-center justify-center rounded-lg shrink-0 ${isSolde ? 'bg-emerald-500/10' : 'bg-orange-500/10'}`}>
                          <CreditCard className={`h-4 w-4 ${isSolde ? 'text-emerald-600' : 'text-orange-600'}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold text-sm">{d.libelle}</p>
                            {d.prelevement_auto && !isSolde && (
                              <Badge variant="outline" className="text-[9px] px-1.5 py-0 gap-1 border-emerald-500/40 text-emerald-700">
                                <RefreshCw className="h-2.5 w-2.5" />Auto
                              </Badge>
                            )}
                            {isSolde && <Badge className="text-[9px] px-1.5 py-0 bg-emerald-100 text-emerald-700">Soldé</Badge>}
                            {isSuspendu && <Badge className="text-[9px] px-1.5 py-0 bg-amber-100 text-amber-700">Suspendu</Badge>}
                          </div>
                          <p className="text-[10px] text-muted-foreground">
                            {d.taux_interet || 0}% sur {d.duree_mois || 0} mois
                            {d.date_debut ? ` — depuis le ${d.date_debut}` : ''}
                            {compteSrc ? ` — débit ${compteSrc}` : ''}
                          </p>
                          {!isSolde && mens > 0 && (
                            <p className="text-[10px] text-orange-700 font-medium mt-0.5">
                              Mensualité {fmt(mens)} F
                              {d.prochaine_echeance ? ` — prochaine échéance le ${d.prochaine_echeance}` : ''}
                            </p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-bold">{fmt(d.montant_restant || 0)} F</p>
                          <p className="text-[10px] text-muted-foreground">sur {fmt(d.montant_initial)} F</p>
                        </div>
                        {(isAdmin || isManager) && (
                          <div className="flex gap-1 shrink-0">
                            <button onClick={() => openEdit(d)} className="rounded p-1.5 hover:bg-muted"><Edit2 className="h-3.5 w-3.5 text-muted-foreground" /></button>
                            <button onClick={() => handleDelete(d)} className="rounded p-1.5 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5 text-red-500" /></button>
                          </div>
                        )}
                      </div>
                      <div className="mt-2 ml-13">
                        <div className="h-2 w-full rounded-full bg-muted">
                          <div className={`h-2 rounded-full transition-all ${isSolde ? 'bg-emerald-500' : 'bg-orange-500'}`} style={{ width: `${Math.min(progress, 100)}%` }} />
                        </div>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">{progress.toFixed(0)}% remboursé</p>
                      </div>
                    </div>
                  );
                })}
            </div>
          </CardContent></Card>
        </>
      )}

      {/* ═══════════ ACTIONNAIRES ═══════════ */}
      {activeTab === 'actionnaires' && (
        <Card><CardContent className="p-0">
          <div className="divide-y">
            {actionnaires.length === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">Aucun actionnaire</p> :
              actionnaires.map((a) => (
                <div key={a.id} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/50">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/10 shrink-0"><Users2 className="h-4 w-4 text-violet-600" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">{a.nom}</p>
                    <p className="text-[10px] text-muted-foreground">Investissement: {fmt(a.investissement)} F</p>
                  </div>
                  <Badge className="text-sm bg-violet-100 text-violet-700">{a.pourcentage}%</Badge>
                  {(isAdmin || isManager) && (
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => openEdit(a)} className="rounded p-1.5 hover:bg-muted"><Edit2 className="h-3.5 w-3.5 text-muted-foreground" /></button>
                      <button onClick={() => handleDelete(a)} className="rounded p-1.5 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5 text-red-500" /></button>
                    </div>
                  )}
                </div>
              ))}
          </div>
        </CardContent></Card>
      )}

      {/* ═══════════ INVESTISSEMENTS ═══════════ */}
      {activeTab === 'investissements' && (
        <Card><CardContent className="p-0">
          <div className="divide-y">
            {investissements.length === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">Aucun investissement</p> :
              investissements.map((inv) => (
                <div key={inv.id} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/50">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10 shrink-0"><TrendingUp className="h-4 w-4 text-blue-600" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">{inv.titre}</p>
                    <p className="text-[10px] text-muted-foreground line-clamp-1">{inv.description}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold">{fmt(inv.montant)} F</p>
                    {inv.roi_estime > 0 && <p className="text-[10px] text-emerald-600">ROI ~{inv.roi_estime}%</p>}
                  </div>
                  <Badge variant="outline" className="text-[10px] shrink-0">{inv.statut || 'en cours'}</Badge>
                  {(isAdmin || isManager) && (
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => openEdit(inv)} className="rounded p-1.5 hover:bg-muted"><Edit2 className="h-3.5 w-3.5 text-muted-foreground" /></button>
                      <button onClick={() => handleDelete(inv)} className="rounded p-1.5 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5 text-red-500" /></button>
                    </div>
                  )}
                </div>
              ))}
          </div>
        </CardContent></Card>
      )}

      {/* ═══════════ FORM DIALOG ═══════════ */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editItem ? 'Modifier' : 'Ajouter'} — {TABS.find((t) => t.id === activeTab)?.label}</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            {/* COMPTES FORM */}
            {activeTab === 'comptes' && (<>
              <div><label className="mb-1.5 block text-sm font-medium">Nom du compte</label><Input value={form.nom || ''} onChange={(e) => setForm({ ...form, nom: e.target.value })} placeholder="Ex: FINAM, Wise..." /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1.5 block text-sm font-medium">Type</label>
                  <Select value={form.type || 'local'} onValueChange={(v) => setForm({ ...form, type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {BANK_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><label className="mb-1.5 block text-sm font-medium">Devise</label>
                  <Select value={form.devise || 'XAF'} onValueChange={(v) => setForm({ ...form, devise: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {['XAF', 'EUR', 'USD', 'GBP'].map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div><label className="mb-1.5 block text-sm font-medium">Solde actuel</label><Input type="number" value={form.solde || ''} onChange={(e) => setForm({ ...form, solde: e.target.value })} /></div>
              <div><label className="mb-1.5 block text-sm font-medium">N° de compte</label><Input value={form.numero_compte || ''} onChange={(e) => setForm({ ...form, numero_compte: e.target.value })} /></div>
              <div><label className="mb-1.5 block text-sm font-medium">Notes</label><Input value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            </>)}

            {/* MOUVEMENTS FORM */}
            {activeTab === 'mouvements' && (<>
              <div><label className="mb-1.5 block text-sm font-medium">Type de mouvement</label>
                <Select value={form.type || 'entree'} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MOVEMENT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><label className="mb-1.5 block text-sm font-medium">Compte</label>
                <Select value={form.compte_id || '__none__'} onValueChange={(v) => setForm({ ...form, compte_id: v === '__none__' ? '' : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Sélectionner...</SelectItem>
                    {comptes.map((c) => <SelectItem key={c.id} value={c.id}>{c.nom} ({c.devise})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {form.type === 'transfert' && (
                <div><label className="mb-1.5 block text-sm font-medium">Compte destination</label>
                  <Select value={form.compte_dest_id || '__none__'} onValueChange={(v) => setForm({ ...form, compte_dest_id: v === '__none__' ? '' : v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Sélectionner...</SelectItem>
                      {comptes.filter((c) => c.id !== form.compte_id).map((c) => <SelectItem key={c.id} value={c.id}>{c.nom} ({c.devise})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1.5 block text-sm font-medium">Montant</label><Input type="number" value={form.montant || ''} onChange={(e) => setForm({ ...form, montant: e.target.value })} /></div>
                <div><label className="mb-1.5 block text-sm font-medium">Date</label><Input type="date" value={form.date || ''} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
              </div>
              <div><label className="mb-1.5 block text-sm font-medium">Description</label><Input value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
              <div><label className="mb-1.5 block text-sm font-medium">Référence</label><Input value={form.reference || ''} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="N° chèque, virement..." /></div>
            </>)}

            {/* CHARGES FORM */}
            {activeTab === 'charges' && (<>
              <div><label className="mb-1.5 block text-sm font-medium">Libellé</label><Input value={form.libelle || ''} onChange={(e) => setForm({ ...form, libelle: e.target.value })} placeholder="Ex: Loyer, Wifi, Salaires..." /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1.5 block text-sm font-medium">Type</label>
                  <Select value={form.type || 'loyer'} onValueChange={(v) => setForm({ ...form, type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CHARGE_TYPES.map((t) => <SelectItem key={t} value={t}>{t === 'online' ? '🌐 ONLINE' : t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><label className="mb-1.5 block text-sm font-medium">Montant ({form.periodicite === 'annuelle' ? 'F/an' : form.periodicite === 'trimestrielle' ? 'F/trim.' : 'F/mois'})</label><Input type="number" value={form.montant || ''} onChange={(e) => setForm({ ...form, montant: e.target.value })} /></div>
              </div>
              <div><label className="mb-1.5 block text-sm font-medium">Bénéficiaire</label><Input value={form.beneficiaire || ''} onChange={(e) => setForm({ ...form, beneficiaire: e.target.value })} placeholder="À qui est versée cette charge" /></div>

              {/* Section prelevement auto */}
              <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <RefreshCw className="h-3.5 w-3.5" />
                    Prélèvement automatique récurrent
                  </label>
                  <input
                    type="checkbox"
                    checked={form.prelevement_auto === true}
                    onChange={(e) => setForm({ ...form, prelevement_auto: e.target.checked })}
                    className="h-4 w-4"
                  />
                </div>

                {form.prelevement_auto && (
                  <>
                    <div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">Compte source (débité à chaque échéance)</label>
                      <Select value={form.compte_id || '__none__'} onValueChange={(v) => setForm({ ...form, compte_id: v === '__none__' ? '' : v })}>
                        <SelectTrigger><SelectValue placeholder="Choisir un compte..." /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">— Aucun —</SelectItem>
                          {comptes.map((c) => <SelectItem key={c.id} value={c.id}>{c.nom} ({c.devise})</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">Périodicité</label>
                        <Select value={form.periodicite || 'mensuelle'} onValueChange={(v) => setForm({ ...form, periodicite: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="mensuelle">Mensuelle</SelectItem>
                            <SelectItem value="trimestrielle">Trimestrielle</SelectItem>
                            <SelectItem value="annuelle">Annuelle</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">Jour</label>
                        <Input type="number" min="1" max="28" value={form.jour_prelevement || ''} onChange={(e) => setForm({ ...form, jour_prelevement: e.target.value })} placeholder="ex: 5" />
                      </div>
                      <div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">Prochaine échéance</label>
                        <Input type="date" value={form.prochaine_echeance || ''} onChange={(e) => setForm({ ...form, prochaine_echeance: e.target.value })} placeholder="auto" />
                      </div>
                    </div>

                    {form.montant && (
                      <div className="rounded bg-blue-500/10 border border-blue-500/30 px-3 py-2 text-xs">
                        <strong>{fmt(form.montant)} F</strong> seront prélevés{' '}
                        {form.periodicite === 'mensuelle' && 'chaque mois'}
                        {form.periodicite === 'trimestrielle' && 'chaque trimestre'}
                        {form.periodicite === 'annuelle' && 'chaque année'}
                        {form.compte_id && <> sur <strong>{comptes.find((c) => c.id === form.compte_id)?.nom || '—'}</strong></>}
                      </div>
                    )}
                  </>
                )}
              </div>
            </>)}

            {/* DETTES FORM */}
            {activeTab === 'dettes' && (<>
              <div><label className="mb-1.5 block text-sm font-medium">Libellé</label><Input value={form.libelle || ''} onChange={(e) => setForm({ ...form, libelle: e.target.value })} placeholder="Ex: Crédit FINAM achat matériel" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1.5 block text-sm font-medium">Montant initial (F)</label><Input type="number" value={form.montant_initial || ''} onChange={(e) => setForm({ ...form, montant_initial: e.target.value })} /></div>
                <div><label className="mb-1.5 block text-sm font-medium">Restant (F)</label><Input type="number" value={form.montant_restant || ''} onChange={(e) => setForm({ ...form, montant_restant: e.target.value })} placeholder="auto si vide" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1.5 block text-sm font-medium">Taux (%)</label><Input type="number" step="0.1" value={form.taux_interet || ''} onChange={(e) => setForm({ ...form, taux_interet: e.target.value })} /></div>
                <div><label className="mb-1.5 block text-sm font-medium">Durée (mois)</label><Input type="number" value={form.duree_mois || ''} onChange={(e) => setForm({ ...form, duree_mois: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1.5 block text-sm font-medium">Date début</label><Input type="date" value={form.date_debut || ''} onChange={(e) => setForm({ ...form, date_debut: e.target.value })} /></div>
                <div><label className="mb-1.5 block text-sm font-medium">Statut</label>
                  <Select value={form.statut || 'actif'} onValueChange={(v) => setForm({ ...form, statut: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="actif">Actif</SelectItem>
                      <SelectItem value="suspendu">Suspendu</SelectItem>
                      <SelectItem value="solde">Soldé</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Section prelevement auto */}
              <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <RefreshCw className="h-3.5 w-3.5" />
                    Prélèvement automatique
                  </label>
                  <input
                    type="checkbox"
                    checked={form.prelevement_auto !== false}
                    onChange={(e) => setForm({ ...form, prelevement_auto: e.target.checked })}
                    className="h-4 w-4"
                  />
                </div>

                <div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">Compte source (débité chaque mois)</label>
                  <Select value={form.compte_id || '__none__'} onValueChange={(v) => setForm({ ...form, compte_id: v === '__none__' ? '' : v })}>
                    <SelectTrigger><SelectValue placeholder="Choisir un compte..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Aucun —</SelectItem>
                      {comptes.map((c) => <SelectItem key={c.id} value={c.id}>{c.nom} ({c.devise})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">Jour du prélèvement</label>
                    <Input type="number" min="1" max="28" value={form.jour_prelevement || ''} onChange={(e) => setForm({ ...form, jour_prelevement: e.target.value })} placeholder="ex: 5" />
                  </div>
                  <div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">Prochaine échéance</label>
                    <Input type="date" value={form.prochaine_echeance || ''} onChange={(e) => setForm({ ...form, prochaine_echeance: e.target.value })} placeholder="auto" />
                  </div>
                </div>

                {/* Apercu mensualite calculee */}
                {form.montant_initial && form.duree_mois && (
                  <div className="rounded bg-orange-500/10 border border-orange-500/30 px-3 py-2">
                    <p className="text-xs text-muted-foreground">Mensualité calculée</p>
                    <p className="text-lg font-bold text-orange-700">{fmt(calcMensualite(form.montant_initial, form.taux_interet, form.duree_mois))} F / mois</p>
                    <p className="text-[10px] text-muted-foreground">
                      ({fmt(form.montant_initial)} × (1 + {form.taux_interet || 0}%)) / {form.duree_mois} mois
                    </p>
                  </div>
                )}
              </div>
            </>)}

            {/* ACTIONNAIRES FORM */}
            {activeTab === 'actionnaires' && (<>
              <div><label className="mb-1.5 block text-sm font-medium">Nom</label><Input value={form.nom || ''} onChange={(e) => setForm({ ...form, nom: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1.5 block text-sm font-medium">Parts (%)</label><Input type="number" step="0.1" value={form.pourcentage || ''} onChange={(e) => setForm({ ...form, pourcentage: e.target.value })} /></div>
                <div><label className="mb-1.5 block text-sm font-medium">Investissement (F)</label><Input type="number" value={form.investissement || ''} onChange={(e) => setForm({ ...form, investissement: e.target.value })} /></div>
              </div>
            </>)}

            {/* INVESTISSEMENTS FORM */}
            {activeTab === 'investissements' && (<>
              <div><label className="mb-1.5 block text-sm font-medium">Titre</label><Input value={form.titre || ''} onChange={(e) => setForm({ ...form, titre: e.target.value })} /></div>
              <div><label className="mb-1.5 block text-sm font-medium">Description</label><textarea className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1.5 block text-sm font-medium">Montant (F)</label><Input type="number" value={form.montant || ''} onChange={(e) => setForm({ ...form, montant: e.target.value })} /></div>
                <div><label className="mb-1.5 block text-sm font-medium">ROI estimé (%)</label><Input type="number" value={form.roi_estime || ''} onChange={(e) => setForm({ ...form, roi_estime: e.target.value })} /></div>
              </div>
              <div><label className="mb-1.5 block text-sm font-medium">Statut</label>
                <Select value={form.statut || 'en_cours'} onValueChange={(v) => setForm({ ...form, statut: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['en_cours', 'planifie', 'termine', 'annule'].map((s) => <SelectItem key={s} value={s}>{s.replace('_', ' ')}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </>)}

            <Button className="w-full" onClick={handleSave}>{editItem ? 'Enregistrer' : 'Ajouter'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
