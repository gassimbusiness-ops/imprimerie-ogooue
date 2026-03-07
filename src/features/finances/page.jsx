import { useState, useEffect, useMemo } from 'react';
import { db } from '@/services/db';
import { logAction } from '@/services/audit';
import { useAuth } from '@/services/auth';
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

  useEffect(() => { load(); }, []);

  // ── KPIs ──
  const totalSoldeComptes = comptes.reduce((s, c) => s + (c.solde || 0), 0);
  const totalCharges = charges.filter((c) => c.actif !== false).reduce((s, c) => s + (c.montant || 0), 0);
  const totalDettes = dettes.reduce((s, d) => s + (d.montant_restant || d.montant_initial || 0), 0);
  const totalInvest = investissements.reduce((s, i) => s + (i.montant || 0), 0);
  const totalParts = actionnaires.reduce((s, a) => s + (a.pourcentage || 0), 0);

  // Mouvements filtrés par mois
  const mouvementsFiltres = useMemo(() => {
    return mouvements.filter((m) => (m.date || m.created_at || '').startsWith(filterMonth));
  }, [mouvements, filterMonth]);

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
      setForm({ libelle: '', type: 'loyer', montant: '', beneficiaire: '', actif: true, categorie: '' });
    } else if (activeTab === 'dettes') {
      setForm({ libelle: '', montant_initial: '', taux_interet: '', duree_mois: '', montant_restant: '', date_debut: '' });
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
    ['montant', 'solde', 'montant_initial', 'taux_interet', 'duree_mois', 'montant_restant', 'pourcentage', 'investissement', 'roi_estime'].forEach((k) => {
      if (data[k] !== undefined && data[k] !== '') data[k] = Number(data[k]) || 0;
    });

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
    await getCollection().delete(item.id);
    await logAction('delete', 'finances', { entityId: item.id, entityLabel: item.nom || item.libelle || item.titre || '', details: `Suppression ${activeTab}` });
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
          <p className="text-xs text-muted-foreground">Solde total comptes</p>
          <p className="text-xl font-bold text-emerald-700">{fmt(totalSoldeComptes)} F</p>
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
              <p className="text-[10px] text-muted-foreground uppercase">Entrées du mois</p>
              <p className="text-lg font-bold text-emerald-600">+{fmt(mvEntrees)} F</p>
            </CardContent></Card>
            <Card className="border-l-4 border-l-red-500"><CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground uppercase">Sorties du mois</p>
              <p className="text-lg font-bold text-red-600">-{fmt(mvSorties)} F</p>
            </CardContent></Card>
            <Card className="border-l-4 border-l-blue-500"><CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground uppercase">Solde net</p>
              <p className={`text-lg font-bold ${mvEntrees - mvSorties >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmt(mvEntrees - mvSorties)} F</p>
            </CardContent></Card>
          </div>
          <Card><CardContent className="p-0">
            <div className="divide-y">
              {mouvementsFiltres.length === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">Aucun mouvement ce mois</p> :
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
        <Card><CardContent className="p-0">
          <div className="divide-y">
            {charges.length === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">Aucune charge fixe</p> :
              charges.map((c) => (
                <div key={c.id} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/50">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-lg shrink-0 ${c.type === 'online' ? 'bg-purple-500/10' : 'bg-red-500/10'}`}>
                    {c.type === 'online' ? <Globe className="h-4 w-4 text-purple-600" /> : <Receipt className="h-4 w-4 text-red-600" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">{c.libelle}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="outline" className={`text-[10px] ${c.type === 'online' ? 'border-purple-300 text-purple-700' : ''}`}>{c.type}</Badge>
                      {c.beneficiaire && <span className="text-[10px] text-muted-foreground">{c.beneficiaire}</span>}
                      {c.actif === false && <Badge className="text-[10px] bg-slate-200 text-slate-600">Inactif</Badge>}
                    </div>
                  </div>
                  <span className="text-sm font-bold text-red-600 shrink-0">{fmt(c.montant)} F/mois</span>
                  {(isAdmin || isManager) && (
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => openEdit(c)} className="rounded p-1.5 hover:bg-muted"><Edit2 className="h-3.5 w-3.5 text-muted-foreground" /></button>
                      <button onClick={() => handleDelete(c)} className="rounded p-1.5 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5 text-red-500" /></button>
                    </div>
                  )}
                </div>
              ))}
          </div>
        </CardContent></Card>
      )}

      {/* ═══════════ DETTES ═══════════ */}
      {activeTab === 'dettes' && (
        <Card><CardContent className="p-0">
          <div className="divide-y">
            {dettes.length === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">Aucune dette</p> :
              dettes.map((d) => {
                const progress = d.montant_initial > 0 ? ((d.montant_initial - (d.montant_restant || 0)) / d.montant_initial) * 100 : 0;
                return (
                  <div key={d.id} className="px-4 py-3 hover:bg-muted/50">
                    <div className="flex items-center gap-4">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-500/10 shrink-0"><CreditCard className="h-4 w-4 text-orange-600" /></div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm">{d.libelle}</p>
                        <p className="text-[10px] text-muted-foreground">{d.taux_interet}% sur {d.duree_mois} mois{d.date_debut ? ` — depuis le ${d.date_debut}` : ''}</p>
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
                        <div className="h-2 rounded-full bg-orange-500 transition-all" style={{ width: `${Math.min(progress, 100)}%` }} />
                      </div>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">{progress.toFixed(0)}% remboursé</p>
                    </div>
                  </div>
                );
              })}
          </div>
        </CardContent></Card>
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
              <div><label className="mb-1.5 block text-sm font-medium">Libellé</label><Input value={form.libelle || ''} onChange={(e) => setForm({ ...form, libelle: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1.5 block text-sm font-medium">Type</label>
                  <Select value={form.type || 'loyer'} onValueChange={(v) => setForm({ ...form, type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CHARGE_TYPES.map((t) => <SelectItem key={t} value={t}>{t === 'online' ? '🌐 ONLINE' : t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><label className="mb-1.5 block text-sm font-medium">Montant (F/mois)</label><Input type="number" value={form.montant || ''} onChange={(e) => setForm({ ...form, montant: e.target.value })} /></div>
              </div>
              <div><label className="mb-1.5 block text-sm font-medium">Bénéficiaire</label><Input value={form.beneficiaire || ''} onChange={(e) => setForm({ ...form, beneficiaire: e.target.value })} /></div>
            </>)}

            {/* DETTES FORM */}
            {activeTab === 'dettes' && (<>
              <div><label className="mb-1.5 block text-sm font-medium">Libellé</label><Input value={form.libelle || ''} onChange={(e) => setForm({ ...form, libelle: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1.5 block text-sm font-medium">Montant initial (F)</label><Input type="number" value={form.montant_initial || ''} onChange={(e) => setForm({ ...form, montant_initial: e.target.value })} /></div>
                <div><label className="mb-1.5 block text-sm font-medium">Restant (F)</label><Input type="number" value={form.montant_restant || ''} onChange={(e) => setForm({ ...form, montant_restant: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1.5 block text-sm font-medium">Taux (%)</label><Input type="number" step="0.1" value={form.taux_interet || ''} onChange={(e) => setForm({ ...form, taux_interet: e.target.value })} /></div>
                <div><label className="mb-1.5 block text-sm font-medium">Durée (mois)</label><Input type="number" value={form.duree_mois || ''} onChange={(e) => setForm({ ...form, duree_mois: e.target.value })} /></div>
              </div>
              <div><label className="mb-1.5 block text-sm font-medium">Date début</label><Input type="date" value={form.date_debut || ''} onChange={(e) => setForm({ ...form, date_debut: e.target.value })} /></div>
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
