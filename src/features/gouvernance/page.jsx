import { useState, useEffect, useMemo } from 'react';
import { db } from '@/services/db';
import { logAction } from '@/services/audit';
import { useAuth } from '@/services/auth';
import { FINANCIAL_SUMMARY, MACHINES, INVENTAIRE_STOCK } from '@/utils/seed-data';
import { printHTML } from '@/services/export-pdf';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import {
  Crown, TrendingUp, Landmark, DollarSign, Users, Plus, ArrowDownCircle,
  Building2, Wallet, CreditCard, PiggyBank, Shield, History,
  Edit3, AlertTriangle, FileText, Filter, Search, ChevronDown,
  ChevronUp, Eye, Download, Pencil, Calculator, Edit2, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

// ─── Defaults from seed-data (used as initial values if no DB overrides) ───
const DEFAULT_VALUATION = {
  inventaire: INVENTAIRE_STOCK.reduce((s, i) => s + (i.qte * i.prix_achat), 0),
  machines: MACHINES.reduce((s, m) => s + m.valeur, 0),
  tresorerie_compte: FINANCIAL_SUMMARY.cash_en_compte,
  tresorerie_caisse: FINANCIAL_SUMMARY.cash_en_caisse,
};

function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)); }
function pct(n) { return (n || 0).toFixed(1) + '%'; }
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// ─── Algorithme de dilution ───
// Parts sociales FIGEES — ne changent que sur modification manuelle admin
// Oumar: 3M + 1.965M + 2M + 1M = 7 965 000 | Senouss: 2 500 000 | Total: 10 465 000
const PARTS_SOCIALES = {
  oumar: 76.11,
  senouss: 23.89,
  totalCapital: 10465000,
  apportsOumar: 7965000,
  apportsSenouss: 2500000,
};

const COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#8b5cf6'];

const TYPE_OPERATIONS = [
  { value: 'ajout_capital', label: 'Ajout de capital', color: 'bg-emerald-100 text-emerald-800' },
  { value: 'retrait', label: 'Retrait', color: 'bg-red-100 text-red-800' },
  { value: 'correction', label: 'Correction', color: 'bg-amber-100 text-amber-800' },
  { value: 'ajustement', label: 'Ajustement', color: 'bg-blue-100 text-blue-800' },
];

const TABS = [
  { id: 'capital', label: 'Capital & Investisseurs', icon: Crown },
  { id: 'resultat', label: 'Résultat Annuel', icon: Calculator },
  { id: 'historique', label: 'Historique des modifications', icon: History },
];


// ─── Seed investisseurs initiaux ───
async function seedInvestisseurs() {
  const existing = await db.investisseurs.list();
  if (existing.length > 0) return;
  await db.investisseurs.create({
    id: 'inv-oumar',
    nom: 'Oumar Ibrahim (Abakar Senoussi)',
    prenom: 'Oumar',
    entreprise: 'Imprimerie Ogooué',
    montantInitial: 7965000,
    montantActuel: 7965000,
    pourcentage: 76.11,
    devise: 'FCFA',
    dateEntree: '2024-01-01',
    statut: 'actif',
    notes: 'Gérant — 3M + 1.965M + 2M + 1M = 7.965M',
    role: 'gerant',
  });
  await db.investisseurs.create({
    id: 'inv-senouss',
    nom: 'Senouss Saleh',
    prenom: 'Senouss',
    entreprise: 'Imprimerie Ogooué',
    montantInitial: 2500000,
    montantActuel: 2500000,
    pourcentage: 23.89,
    devise: 'FCFA',
    dateEntree: '2024-01-01',
    statut: 'actif',
    notes: 'Associé',
    role: 'associe',
  });
}

export default function Gouvernance() {
  const { user, isAdmin, hasPermission } = useAuth();
  const isAssocie = user?.role === 'associe';
  const [tab, setTab] = useState('capital');
  const [apports, setApports] = useState([]);
  const [dettes, setDettes] = useState([]);
  const [remboursements, setRemboursements] = useState([]);
  const [investisseurs, setInvestisseurs] = useState([]);
  const [modifications, setModifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showApportForm, setShowApportForm] = useState(false);
  const [showRemboursementForm, setShowRemboursementForm] = useState(false);
  const [showModifModal, setShowModifModal] = useState(false);
  const [showAddInvestisseur, setShowAddInvestisseur] = useState(false);
  const [selectedInvestisseur, setSelectedInvestisseur] = useState(null);
  const [newInvForm, setNewInvForm] = useState({ nom: '', prenom: '', montant: '', role: 'associe', notes: '' });
  const [apportForm, setApportForm] = useState({ associe: 'oumar', type: 'apport_capital', montant: '', description: '', date: new Date().toISOString().slice(0, 10) });
  const [rembForm, setRembForm] = useState({ montant: '', date: new Date().toISOString().slice(0, 10), description: '' });
  const [editRembId, setEditRembId] = useState(null); // id du remboursement en cours d'edition (null = creation)
  const [modifForm, setModifForm] = useState({
    typeOperation: 'ajout_capital',
    montantVariation: '',
    motif: '',
    commentaire: '',
  });

  // Filtres historique
  const [filterInvestisseur, setFilterInvestisseur] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterDateDebut, setFilterDateDebut] = useState('');
  const [filterDateFin, setFilterDateFin] = useState('');

  const [loadError, setLoadError] = useState(null);

  // Resultat annuel
  const [rapports, setRapports] = useState([]);
  const [chargesFixes, setChargesFixes] = useState([]);
  const [anneeResultat, setAnneeResultat] = useState(new Date().getFullYear());
  const [resultatStatut, setResultatStatut] = useState(null); // from gouvernance_parametres

  // Editable valuation parameters (stored in DB)
  const [valuationParams, setValuationParams] = useState(DEFAULT_VALUATION);
  const [editField, setEditField] = useState(null); // { key, label, value }
  const [editValue, setEditValue] = useState('');

  const load = async () => {
    try {
      setLoadError(null);
      const [a, d, r, inv, mods, params, produits, comptes, raps, chFixes] = await Promise.all([
        db.apports_associes.list(),
        db.dettes_associes.list(),
        db.remboursements_associes.list(),
        db.investisseurs.list(),
        db.modifications_investisseurs.list(),
        db.gouvernance_parametres.list(),
        db.produits.list(),
        db.comptes_bancaires.list(),
        db.rapports.list(),
        db.charges_fixes.list(),
      ]);
      setApports(a);
      setDettes(d);
      setRemboursements(r);
      setInvestisseurs(inv);
      setModifications(mods);
      setRapports(raps || []);
      setChargesFixes(chFixes || []);
      // Charger statut resultat annuel
      const savedResultat = (params || []).find((p) => p.type === 'resultat_annuel');
      setResultatStatut(savedResultat || null);

      // ── Valuation depuis données REELLES Supabase ──
      // Stock réel = somme (prix_unitaire × quantite) depuis module Stocks
      const stockReel = (produits || []).reduce((s, p) => {
        const prix = p.prix_unitaire || p.prix_vente || 0;
        const qte = p.quantite ?? p.stock ?? 0;
        return s + (prix * qte);
      }, 0);

      // Machines réelles (type_article = 'machine') depuis module Stocks
      const machinesReel = (produits || []).reduce((s, p) => {
        if (p.type_article === 'machine') return s + (p.valeur_stock_achat || (p.prix_unitaire || 0) * (p.quantite ?? 1));
        return s;
      }, 0);

      // Trésorerie réelle depuis comptes bancaires Imprimerie uniquement
      // Whitelist : FINAM, BGFI, Airtel Money, Moov Money, Caisse/Liquide
      // Blacklist : Wise, Mercury, PayPal, Stripe, Airwallex (comptes internationaux)
      const COMPTES_IMPRIMERIE = ['finam', 'bgfi', 'airtel', 'moov', 'caisse', 'liquide'];
      const COMPTES_EXCLUS = ['wise', 'mercury', 'paypal', 'stripe', 'airwallex'];
      const comptesImprimerie = (comptes || []).filter((c) => {
        const nom = (c.nom || '').toLowerCase();
        if (COMPTES_EXCLUS.some((k) => nom.includes(k))) return false;
        return COMPTES_IMPRIMERIE.some((k) => nom.includes(k)) || c.appartient_imprimerie === true;
      });
      const tresorerieCompte = comptesImprimerie
        .filter((c) => !(c.nom || '').toLowerCase().includes('caisse') && !(c.nom || '').toLowerCase().includes('liquide'))
        .reduce((s, c) => s + (c.solde || 0), 0);
      const tresorerieCaisse = comptesImprimerie
        .filter((c) => (c.nom || '').toLowerCase().includes('caisse') || (c.nom || '').toLowerCase().includes('liquide'))
        .reduce((s, c) => s + (c.solde || 0), 0);

      // Utiliser données réelles si disponibles, sinon fallback sur params sauvegardés ou seed
      const savedParams = (params || []).find((p) => p.type === 'valuation');
      const hasRealStock = (produits || []).length > 0;
      const hasRealComptes = comptesImprimerie.length > 0;

      setValuationParams({
        inventaire: hasRealStock ? stockReel : (savedParams?.inventaire ?? DEFAULT_VALUATION.inventaire),
        machines: hasRealStock ? machinesReel : (savedParams?.machines ?? DEFAULT_VALUATION.machines),
        tresorerie_compte: hasRealComptes ? tresorerieCompte : (savedParams?.tresorerie_compte ?? DEFAULT_VALUATION.tresorerie_compte),
        tresorerie_caisse: hasRealComptes ? tresorerieCaisse : (savedParams?.tresorerie_caisse ?? DEFAULT_VALUATION.tresorerie_caisse),
      });
    } catch (err) {
      console.error('Gouvernance load error:', err);
      setLoadError(err.message || 'Erreur de chargement des données');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        await seedInvestisseurs();
        const existing = await db.apports_associes.list();
        if (existing.length === 0) {
          await db.apports_associes.create({
            associe: 'oumar', type: 'apport_capital', montant: 2000000,
            description: 'Réinvestissement en marchandises', date: '2025-06-15',
          });
          const existingDettes = await db.dettes_associes.list();
          if (existingDettes.length === 0) {
            await db.dettes_associes.create({
              associe: 'oumar', montant_initial: 2300000, montant_restant: 2300000,
              description: "Compte courant d'associé — avances et dépenses", date: '2025-03-01',
            });
          }
        }
      } catch (err) {
        console.error('Gouvernance seed error:', err);
      }
      load();
    })();
  }, []);

  // Parts figees — plus de calcul dynamique
  const capTable = PARTS_SOCIALES;

  const detteInfo = useMemo(() => {
    const dette = dettes.find((d) => d.associe === 'oumar');
    const totalRemb = remboursements.reduce((s, r) => s + (r.montant || 0), 0);
    const initial = dette?.montant_initial || 2300000;
    return { initial, rembourse: totalRemb, restant: initial - totalRemb };
  }, [dettes, remboursements]);

  const valuation = useMemo(() => {
    const inventaire = valuationParams.inventaire;
    const machines = valuationParams.machines;
    const tresorerie = valuationParams.tresorerie_compte + valuationParams.tresorerie_caisse;
    const actifs = inventaire + machines + tresorerie;
    const passifs = detteInfo.restant;
    return { inventaire, machines, tresorerie, actifs, passifs, valeur_nette: actifs - passifs };
  }, [detteInfo, valuationParams]);

  const pieData = [
    { name: 'Oumar Ibrahim', value: capTable.oumar, color: '#3b82f6' },
    { name: 'Senouss Saleh', value: capTable.senouss, color: '#f59e0b' },
  ];

  const valuationPie = [
    { name: 'Stock', value: valuation.inventaire, color: '#3b82f6' },
    { name: 'Machines', value: valuation.machines, color: '#8b5cf6' },
    { name: 'Trésorerie', value: valuation.tresorerie, color: '#10b981' },
  ];

  // ─── Resultat annuel ───
  const resultatAnnuel = useMemo(() => {
    const anneeStr = String(anneeResultat);
    const rapportsAnnee = rapports.filter((r) => (r.date || '').startsWith(anneeStr));

    // CA et depenses operationnelles depuis db.rapports
    let caAnnuel = 0;
    let depensesOp = 0;
    rapportsAnnee.forEach((r) => {
      const cats = r.categories || {};
      caAnnuel += Object.values(cats).reduce((s, v) => s + (v || 0), 0);
      // Toutes les depenses des rapports = depenses operationnelles
      (r.depenses || []).forEach((d) => { depensesOp += d.montant || 0; });
    });

    // Charges fixes annuelles depuis db.charges_fixes (source dediee)
    // Chaque charge fixe a un montant (mensuel ou annuel) — on somme sur l'annee
    const totalChargesFixes = chargesFixes.reduce((s, cf) => {
      const montant = cf.montant || 0;
      // Si la charge a une periodicite mensuelle, multiplier par 12
      // Sinon (annuel ou pas precise), prendre le montant tel quel
      const periodicite = (cf.periodicite || cf.frequence || 'mensuel').toLowerCase();
      if (periodicite === 'mensuel' || periodicite === 'mensuelle') return s + (montant * 12);
      if (periodicite === 'trimestriel' || periodicite === 'trimestrielle') return s + (montant * 4);
      return s + montant; // annuel par defaut
    }, 0);

    const beneficeNet = caAnnuel - depensesOp - totalChargesFixes;
    const remGestion = beneficeNet > 0 ? beneficeNet * 0.20 : 0;
    const distribuable = beneficeNet > 0 ? beneficeNet - remGestion : beneficeNet;
    const partOumar = distribuable * (capTable.oumar / 100);
    const partSenouss = distribuable * (capTable.senouss / 100);

    // Statut : soit sauvegarde en base, soit estime par defaut
    const savedStatut = resultatStatut?.annee === anneeResultat ? resultatStatut.statut : null;
    const statut = savedStatut || 'estime';

    return {
      caAnnuel, depensesOp, chargesFixes: totalChargesFixes, beneficeNet,
      remGestion, distribuable, partOumar, partSenouss,
      statut, nbRapports: rapportsAnnee.length,
    };
  }, [rapports, chargesFixes, anneeResultat, capTable, resultatStatut]);

  // Sauvegarder le statut de l'exercice
  const handleSaveStatut = async (newStatut) => {
    try {
      const data = { type: 'resultat_annuel', annee: anneeResultat, statut: newStatut };
      if (resultatStatut?.id) {
        await db.gouvernance_parametres.update(resultatStatut.id, data);
      } else {
        await db.gouvernance_parametres.create(data);
      }
      setResultatStatut({ ...resultatStatut, ...data });
      toast.success(`Exercice ${anneeResultat} marqué : ${newStatut}`);
      await logAction('update', 'gouvernance', { details: `Statut exercice ${anneeResultat} → ${newStatut}` });
    } catch (err) {
      toast.error('Erreur lors de la sauvegarde du statut');
    }
  };

  // ─── Handlers ───
  const handleAddApport = async () => {
    if (!apportForm.montant || Number(apportForm.montant) <= 0) { toast.error('Montant requis'); return; }
    await db.apports_associes.create({ ...apportForm, montant: Number(apportForm.montant) });
    await logAction('create', 'gouvernance', { details: `Apport ${fmt(apportForm.montant)} F par ${apportForm.associe}` });
    toast.success('Apport enregistré');
    setShowApportForm(false);
    load();
  };

  // Recalcule et persiste le montant_restant de la dette Oumar a partir de la
  // liste de remboursements fournie (source de verite = somme des remboursements).
  const syncMontantRestant = async (rembList) => {
    const dette = dettes.find((d) => d.associe === 'oumar');
    if (!dette) return;
    const initial = dette.montant_initial || 2300000;
    const totalRemb = rembList.reduce((s, r) => s + (Number(r.montant) || 0), 0);
    await db.dettes_associes.update(dette.id, { montant_restant: initial - totalRemb });
  };

  const handleAddRemboursement = async () => {
    if (!rembForm.montant || Number(rembForm.montant) <= 0) { toast.error('Montant requis'); return; }
    const montant = Number(rembForm.montant);

    if (editRembId) {
      // EDITION : on calcule le solde disponible HORS ce remboursement
      const autres = remboursements.filter((r) => r.id !== editRembId);
      const restantSansCe = detteInfo.initial - autres.reduce((s, r) => s + (Number(r.montant) || 0), 0);
      if (montant > restantSansCe) { toast.error('Montant supérieur au solde dû'); return; }
      await db.remboursements_associes.update(editRembId, { ...rembForm, montant });
      const nouvelleListe = remboursements.map((r) => (r.id === editRembId ? { ...r, montant } : r));
      await syncMontantRestant(nouvelleListe);
      await logAction('update', 'gouvernance', { entityId: editRembId, details: `Modification remboursement → ${fmt(montant)} F dette Oumar` });
      toast.success('Remboursement modifié');
    } else {
      // CREATION
      if (montant > detteInfo.restant) { toast.error('Montant supérieur au solde dû'); return; }
      const created = await db.remboursements_associes.create({ ...rembForm, montant, associe: 'oumar' });
      await syncMontantRestant([...remboursements, { ...created, montant }]);
      await logAction('create', 'gouvernance', { details: `Remboursement ${fmt(montant)} F dette Oumar` });
      toast.success('Remboursement enregistré');
    }
    setShowRemboursementForm(false);
    setEditRembId(null);
    load();
  };

  const handleEditRemboursement = (r) => {
    setEditRembId(r.id);
    setRembForm({ montant: String(r.montant || ''), date: r.date || new Date().toISOString().slice(0, 10), description: r.description || '' });
    setShowRemboursementForm(true);
  };

  const handleDeleteRemboursement = async (r) => {
    if (!confirm(`Supprimer ce remboursement de ${fmt(r.montant)} F du ${r.date} ?`)) return;
    await db.remboursements_associes.delete(r.id);
    const nouvelleListe = remboursements.filter((x) => x.id !== r.id);
    await syncMontantRestant(nouvelleListe);
    await logAction('delete', 'gouvernance', { entityId: r.id, details: `Suppression remboursement ${fmt(r.montant)} F dette Oumar` });
    toast.success('Remboursement supprimé');
    load();
  };

  // ─── Modification investisseur avec traçabilité ───
  const openModifModal = (inv) => {
    setSelectedInvestisseur(inv);
    setModifForm({ typeOperation: 'ajout_capital', montantVariation: '', motif: '', commentaire: '' });
    setShowModifModal(true);
  };

  const handleModification = async () => {
    if (!selectedInvestisseur) return;
    const variation = Number(modifForm.montantVariation);
    if (!variation || variation <= 0) { toast.error('Le montant doit être supérieur à 0'); return; }
    if (!modifForm.motif || modifForm.motif.trim().length < 10) {
      toast.error('Le motif est obligatoire (minimum 10 caractères)');
      return;
    }

    const ancienMontant = selectedInvestisseur.montantActuel || selectedInvestisseur.montantInitial || 0;
    let nouveauMontant;

    switch (modifForm.typeOperation) {
      case 'ajout_capital':
        nouveauMontant = ancienMontant + variation;
        break;
      case 'retrait':
        nouveauMontant = ancienMontant - variation;
        if (nouveauMontant < 0) { toast.error('Le retrait ne peut pas dépasser le montant actuel'); return; }
        break;
      case 'correction':
      case 'ajustement':
        nouveauMontant = variation; // montant direct
        break;
      default:
        return;
    }

    const difference = nouveauMontant - ancienMontant;

    // Créer l'entrée immuable dans le journal d'audit
    const modEntry = {
      investisseurId: selectedInvestisseur.id,
      investisseurNom: selectedInvestisseur.nom,
      typeOperation: modifForm.typeOperation,
      ancienMontant,
      nouveauMontant,
      difference,
      motif: modifForm.motif.trim(),
      auteur: `${user.prenom} ${user.nom}`,
      auteurEmail: user.email,
      auteurId: user.id,
      dateHeure: new Date().toISOString(),
      commentaire: modifForm.commentaire?.trim() || '',
    };

    await db.modifications_investisseurs.create(modEntry);

    // Mettre à jour le montant de l'investisseur
    await db.investisseurs.update(selectedInvestisseur.id, {
      montantActuel: nouveauMontant,
      updated_at: new Date().toISOString(),
    });

    await logAction('update', 'gouvernance', {
      entityId: selectedInvestisseur.id,
      entityLabel: selectedInvestisseur.nom,
      details: `Modification investisseur: ${modifForm.typeOperation} — ${fmt(ancienMontant)} → ${fmt(nouveauMontant)} F (${modifForm.motif})`,
    });

    toast.success('Modification enregistrée et tracée dans le journal d\'audit');
    setShowModifModal(false);
    load();
  };

  // ─── Ajouter un nouvel investisseur ───
  const handleAddInvestisseur = async () => {
    if (!newInvForm.nom.trim()) { toast.error('Nom requis'); return; }
    if (!newInvForm.montant || Number(newInvForm.montant) <= 0) { toast.error('Montant requis'); return; }
    const montant = Number(newInvForm.montant);
    const inv = await db.investisseurs.create({
      nom: newInvForm.nom.trim(),
      prenom: newInvForm.prenom.trim(),
      entreprise: 'Imprimerie Ogooué',
      montantInitial: montant,
      montantActuel: montant,
      devise: 'FCFA',
      dateEntree: new Date().toISOString().slice(0, 10),
      statut: 'actif',
      notes: newInvForm.notes,
      role: newInvForm.role,
    });
    await logAction('create', 'gouvernance', {
      entityId: inv.id,
      entityLabel: newInvForm.nom,
      details: `Nouvel investisseur: ${newInvForm.nom} — ${fmt(montant)} F (${newInvForm.role})`,
    });
    toast.success('Investisseur ajouté');
    setShowAddInvestisseur(false);
    setNewInvForm({ nom: '', prenom: '', montant: '', role: 'associe', notes: '' });
    load();
  };

  // ─── Modifier un champ de valorisation (admin) ───
  const openEditField = (key, label, currentValue) => {
    setEditField({ key, label });
    setEditValue(String(currentValue));
  };

  const handleSaveField = async () => {
    if (!editField) return;
    const newVal = Number(editValue);
    if (isNaN(newVal) || newVal < 0) { toast.error('Valeur invalide'); return; }
    const oldVal = valuationParams[editField.key];
    if (newVal === oldVal) { setEditField(null); return; }

    const newParams = { ...valuationParams, [editField.key]: newVal };
    setValuationParams(newParams);

    // Persist to DB
    try {
      const existing = await db.gouvernance_parametres.list();
      const record = existing.find((p) => p.type === 'valuation');
      if (record) {
        await db.gouvernance_parametres.update(record.id, { ...newParams, type: 'valuation' });
      } else {
        await db.gouvernance_parametres.create({ ...newParams, type: 'valuation' });
      }

      // Audit trail
      await db.modifications_investisseurs.create({
        investisseurId: '__valuation__',
        investisseurNom: 'Valorisation Entreprise',
        typeOperation: 'ajustement',
        ancienMontant: oldVal,
        nouveauMontant: newVal,
        difference: newVal - oldVal,
        motif: `Modification ${editField.label}: ${fmt(oldVal)} -> ${fmt(newVal)} F`,
        auteur: `${user.prenom} ${user.nom}`,
        auteurEmail: user.email,
        auteurId: user.id,
        dateHeure: new Date().toISOString(),
        commentaire: '',
      });

      await logAction('update', 'gouvernance', {
        details: `Valorisation modifiee: ${editField.label} ${fmt(oldVal)} -> ${fmt(newVal)} F`,
      });

      toast.success(`${editField.label} mis a jour`);
    } catch (err) {
      console.error('Save valuation error:', err);
      toast.error('Erreur lors de la sauvegarde');
      setValuationParams((prev) => ({ ...prev, [editField.key]: oldVal }));
    }

    setEditField(null);
    load();
  };

  // ─── Filtrage historique ───
  const filteredModifications = useMemo(() => {
    let mods = [...modifications].sort((a, b) => (b.dateHeure || b.created_at || '').localeCompare(a.dateHeure || a.created_at || ''));
    if (filterInvestisseur) mods = mods.filter((m) => m.investisseurId === filterInvestisseur);
    if (filterType) mods = mods.filter((m) => m.typeOperation === filterType);
    if (filterDateDebut) mods = mods.filter((m) => (m.dateHeure || m.created_at || '') >= filterDateDebut);
    if (filterDateFin) mods = mods.filter((m) => (m.dateHeure || m.created_at || '') <= filterDateFin + 'T23:59:59');
    return mods;
  }, [modifications, filterInvestisseur, filterType, filterDateDebut, filterDateFin]);

  // ─── Export PDF audit ───
  const exportAuditPDF = () => {
    const periode = filterDateDebut && filterDateFin
      ? `du ${filterDateDebut} au ${filterDateFin}`
      : 'Toutes les modifications';

    let html = `<h2>Journal d'Audit — Investisseurs</h2>
      <p style="margin-bottom:4px;font-size:10px;color:#6b7280;">Période : ${periode}</p>
      <p style="margin-bottom:12px;font-size:10px;color:#6b7280;">${filteredModifications.length} modification(s) enregistrée(s)</p>`;

    if (filteredModifications.length === 0) {
      html += '<p style="text-align:center;color:#9ca3af;padding:20px;">Aucune modification enregistrée</p>';
    } else {
      html += `<table>
        <thead><tr>
          <th>Date / Heure</th>
          <th>Investisseur</th>
          <th>Type</th>
          <th class="text-right">Ancien montant</th>
          <th class="text-right">Nouveau montant</th>
          <th class="text-right">Différence</th>
          <th>Motif</th>
          <th>Admin auteur</th>
        </tr></thead><tbody>`;

      filteredModifications.forEach((m) => {
        const typeLabel = TYPE_OPERATIONS.find((t) => t.value === m.typeOperation)?.label || m.typeOperation;
        const diff = m.difference || 0;
        const diffClass = diff >= 0 ? 'text-emerald' : 'text-red';
        html += `<tr>
          <td style="white-space:nowrap;">${fmtDate(m.dateHeure || m.created_at)}</td>
          <td>${m.investisseurNom || '—'}</td>
          <td>${typeLabel}</td>
          <td class="text-right">${fmt(m.ancienMontant)} F</td>
          <td class="text-right font-bold">${fmt(m.nouveauMontant)} F</td>
          <td class="text-right ${diffClass}">${diff >= 0 ? '+' : ''}${fmt(diff)} F</td>
          <td>${m.motif || '—'}</td>
          <td>${m.auteur || '—'}</td>
        </tr>`;
      });

      html += '</tbody></table>';
    }

    html += '<p style="margin-top:16px;font-size:9px;color:#dc2626;font-weight:600;">Document confidentiel — Réservé à l\'administration</p>';

    printHTML('Journal Audit Investisseurs', html, { orientation: 'landscape' });
  };

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;

  if (loadError) return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <AlertTriangle className="h-10 w-10 text-amber-500" />
      <p className="text-muted-foreground text-center">Impossible de charger les données de gouvernance</p>
      <p className="text-xs text-muted-foreground">{loadError}</p>
      <Button variant="outline" onClick={() => { setLoading(true); load(); }}>Réessayer</Button>
    </div>
  );

  const oumarValue = (valuation.valeur_nette * capTable.oumar) / 100;
  const senoussValue = (valuation.valeur_nette * capTable.senouss) / 100;

  return (
    <div className="space-y-6">
      {/* Header premium */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-900 p-6 text-white">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/5" />
        <div className="absolute -bottom-6 -left-6 h-28 w-28 rounded-full bg-white/5" />
        <div className="relative">
          <div className="flex items-center gap-3 mb-1">
            <Crown className="h-6 w-6 text-amber-400" />
            <h2 className="text-2xl font-bold">Gouvernance & Capital</h2>
          </div>
          <p className="text-blue-200/70 text-sm">Cap Table, valorisation, comptes courants d'associés et traçabilité</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-muted p-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
              tab === id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="h-4 w-4" />
            <span className="hidden sm:inline">{label}</span>
            <span className="sm:hidden">{id === 'capital' ? 'Capital' : id === 'resultat' ? 'Résultat' : 'Historique'}</span>
            {id === 'historique' && modifications.length > 0 && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{modifications.length}</Badge>
            )}
          </button>
        ))}
      </div>

      {/* ═══════════════ TAB 1 : CAPITAL & INVESTISSEURS ═══════════════ */}
      {tab === 'capital' && (
        <>
          {/* KPIs row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Valeur Entreprise', value: `${fmt(valuation.valeur_nette)} F`, icon: Building2, color: 'border-l-blue-500', sub: 'Actifs - Passifs', computed: true },
              { label: 'Capital Total', value: `${fmt(capTable.totalCapital)} F`, icon: PiggyBank, color: 'border-l-emerald-500', sub: `${apports.length + 2} apports` },
              { label: 'Dette Restante', value: `${fmt(detteInfo.restant)} F`, icon: CreditCard, color: 'border-l-red-500', sub: `sur ${fmt(detteInfo.initial)} F` },
              { label: 'Trésorerie', value: `${fmt(valuation.tresorerie)} F`, icon: Wallet, color: 'border-l-violet-500', sub: 'Compte + Caisse', editKey: 'tresorerie_compte', editVal: valuationParams.tresorerie_compte },
            ].map(({ label, value, icon: Icon, color, sub, editKey, editVal, computed }) => (
              <Card key={label} className={`border-l-4 ${color}`}>
                <CardContent className="p-3 sm:p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <p className="text-[10px] sm:text-[11px] text-muted-foreground uppercase tracking-wide truncate">{label}</p>
                        {isAdmin && editKey && (
                          <button onClick={() => openEditField(editKey, label, editVal)} className="rounded p-0.5 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
                            <Pencil className="h-2.5 w-2.5" />
                          </button>
                        )}
                        {computed && <span className="text-[8px] text-muted-foreground/50">(auto)</span>}
                      </div>
                      <p className="text-sm sm:text-lg font-bold mt-1 truncate">{value}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{sub}</p>
                    </div>
                    <div className="shrink-0 rounded-lg bg-muted p-1.5 sm:p-2"><Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" /></div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Investisseurs — Cartes avec bouton Modifier */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Users className="h-4 w-4 text-primary" />
                  Investisseurs
                </CardTitle>
                {isAdmin && (
                  <Button size="sm" variant="outline" className="gap-1" onClick={() => setShowAddInvestisseur(true)}>
                    <Plus className="h-3.5 w-3.5" /> Ajouter investisseur
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid sm:grid-cols-2 gap-3">
                {(isAssocie
                  ? investisseurs.filter((inv) => {
                      const invNom = (inv.nom || '').toLowerCase();
                      const userNom = `${user?.prenom || ''} ${user?.nom || ''}`.trim().toLowerCase();
                      return inv.user_id === user?.id || invNom.includes((user?.nom || '').toLowerCase()) || invNom === userNom;
                    })
                  : investisseurs
                ).map((inv) => {
                  const isOumar = inv.id === 'inv-oumar' || inv.nom?.includes('Oumar');
                  const capPct = isOumar ? capTable.oumar : capTable.senouss;
                  const valeurPart = isOumar ? oumarValue : senoussValue;
                  return (
                    <div key={inv.id} className="rounded-xl border p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`h-3 w-3 rounded-full ${isOumar ? 'bg-blue-500' : 'bg-amber-500'}`} />
                          <span className="font-semibold text-sm">{inv.nom}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">
                            {inv.statut === 'actif' ? 'Actif' : inv.statut === 'inactif' ? 'Inactif' : 'Sorti'}
                          </Badge>
                          <Badge className="text-[9px] bg-slate-100 text-slate-700">{isOumar ? 'Gérant' : 'Associé'}</Badge>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                        <div>
                          <p className="text-[10px] text-muted-foreground">Montant initial</p>
                          <p className="text-xs font-bold">{fmt(inv.montantInitial)} F</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground">Montant actuel</p>
                          <p className="text-sm font-bold text-primary">{fmt(inv.montantActuel)} F</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground">Parts</p>
                          <p className="text-xs font-bold">{capPct.toFixed(1)}%</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground">Valeur part</p>
                          <p className="text-xs font-bold">{fmt(valeurPart)} F</p>
                        </div>
                      </div>

                      {isAdmin && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full gap-2 text-orange-600 border-orange-200 hover:bg-orange-50"
                          onClick={() => openModifModal(inv)}
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                          Modifier montant
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Cap Table Pie + Valorisation */}
          <div className="grid lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Users className="h-4 w-4 text-primary" />
                  Répartition du Capital
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value"
                        label={({ name, value }) => `${name.split(' ')[0]} ${value.toFixed(1)}%`}>
                        {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                      </Pie>
                      <Tooltip formatter={(v) => `${v.toFixed(2)}%`} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-3 mt-4">
                  {[
                    { nom: 'Oumar Ibrahim (Abakar Senoussi)', pct: capTable.oumar, valeur: oumarValue, color: 'bg-blue-500', initial: '7 965 000 F', role: 'Gérant' },
                    { nom: 'Senouss Saleh', pct: capTable.senouss, valeur: senoussValue, color: 'bg-amber-500', initial: '2 500 000 F', role: 'Associé' },
                  ].map((a) => (
                    <div key={a.nom} className="rounded-xl border p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className={`h-3 w-3 rounded-full ${a.color}`} />
                          <span className="font-semibold text-sm">{a.nom}</span>
                        </div>
                        <Badge variant="outline" className="text-[10px]">{a.role}</Badge>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div><p className="text-[10px] text-muted-foreground">Parts</p><p className="text-sm font-bold">{a.pct.toFixed(1)}%</p></div>
                        <div><p className="text-[10px] text-muted-foreground">Valeur</p><p className="text-sm font-bold">{fmt(a.valeur)} F</p></div>
                        <div><p className="text-[10px] text-muted-foreground">Investissement</p><p className="text-[11px] text-muted-foreground">{a.initial}</p></div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Valorisation */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Building2 className="h-4 w-4 text-primary" />
                  Valorisation de l'Imprimerie
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50 p-4 mb-4 text-center">
                  <p className="text-xs text-muted-foreground mb-1">Valeur nette actuelle</p>
                  <p className="text-3xl font-black text-primary">{fmt(valuation.valeur_nette)} F</p>
                  <p className="text-[10px] text-muted-foreground mt-1">Actifs ({fmt(valuation.actifs)} F) - Passifs ({fmt(valuation.passifs)} F)</p>
                </div>
                <div className="h-[180px] mb-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={valuationPie} cx="50%" cy="50%" outerRadius={70} dataKey="value"
                        label={({ name, value }) => `${name}: ${fmt(value)}`}>
                        {valuationPie.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                      </Pie>
                      <Tooltip formatter={(v) => `${fmt(v)} F`} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-2">
                  {[
                    { label: "Stock (prix d'achat)", val: valuation.inventaire, icon: '\u{1F4E6}', editKey: 'inventaire' },
                    { label: 'Machines & Outils', val: valuation.machines, icon: '\u{1F5A8}', editKey: 'machines' },
                    { label: 'Trésorerie (Compte)', val: valuationParams.tresorerie_compte, icon: '\u{1F4B0}', editKey: 'tresorerie_compte' },
                    { label: 'Trésorerie (Caisse)', val: valuationParams.tresorerie_caisse, icon: '\u{1F4B0}', editKey: 'tresorerie_caisse' },
                    { label: 'Dettes associés', val: -detteInfo.restant, icon: '\u{1F4C9}', neg: true },
                  ].map(({ label, val, icon, neg, editKey }) => (
                    <div key={label} className="flex items-center justify-between py-1.5 border-b last:border-0">
                      <span className="text-sm flex items-center gap-2">{icon} {label}</span>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-sm font-semibold ${neg ? 'text-red-600' : ''}`}>{neg ? '-' : ''}{fmt(Math.abs(val))} F</span>
                        {isAdmin && editKey && (
                          <button
                            onClick={() => openEditField(editKey, label, editKey === 'tresorerie_compte' ? valuationParams.tresorerie_compte : editKey === 'tresorerie_caisse' ? valuationParams.tresorerie_caisse : val)}
                            className="rounded p-1 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                            title={`Modifier ${label}`}
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Dettes & Remboursements + Historique Apports */}
          <div className="grid lg:grid-cols-2 gap-4">
            {/* Dette Oumar */}
            <Card className="border-l-4 border-l-red-500">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <CreditCard className="h-4 w-4 text-red-500" />
                    Compte Courant d'Associé — Oumar
                  </CardTitle>
                  {isAdmin && (
                    <Button size="sm" className="gap-1" onClick={() => { setEditRembId(null); setRembForm({ montant: '', date: new Date().toISOString().slice(0, 10), description: '' }); setShowRemboursementForm(true); }}>
                      <ArrowDownCircle className="h-3.5 w-3.5" /> Remboursement
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Montant initial</span>
                    <span className="font-semibold">{fmt(detteInfo.initial)} F</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Remboursé</span>
                    <span className="font-semibold text-emerald-600">{fmt(detteInfo.rembourse)} F</span>
                  </div>
                  <div className="flex items-center justify-between text-lg">
                    <span className="font-semibold">Reste à payer</span>
                    <span className="font-black text-red-600">{fmt(detteInfo.restant)} F</span>
                  </div>
                  <div className="relative h-4 rounded-full bg-red-100 overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all"
                      style={{ width: `${Math.min(100, (detteInfo.rembourse / detteInfo.initial) * 100)}%` }}
                    />
                    <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold">
                      {((detteInfo.rembourse / detteInfo.initial) * 100).toFixed(0)}% remboursé
                    </span>
                  </div>
                  {remboursements.length > 0 && (
                    <div className="mt-3 space-y-1.5">
                      <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1"><History className="h-3 w-3" /> Historique</p>
                      {remboursements.sort((a, b) => b.date?.localeCompare(a.date)).map((r) => (
                        <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
                          <span className="text-muted-foreground flex-1 min-w-0 truncate">{r.date} — {r.description || 'Remboursement'}</span>
                          <span className="font-semibold text-emerald-600 shrink-0">+{fmt(r.montant)} F</span>
                          {isAdmin && (
                            <div className="flex gap-0.5 shrink-0">
                              <button onClick={() => handleEditRemboursement(r)} className="rounded p-1 hover:bg-muted" title="Modifier">
                                <Edit2 className="h-3.5 w-3.5 text-muted-foreground" />
                              </button>
                              <button onClick={() => handleDeleteRemboursement(r)} className="rounded p-1 hover:bg-red-50" title="Supprimer">
                                <Trash2 className="h-3.5 w-3.5 text-red-500" />
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Historique des apports */}
            <Card className="border-l-4 border-l-emerald-500">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <TrendingUp className="h-4 w-4 text-emerald-500" />
                    Historique des Apports
                  </CardTitle>
                  {isAdmin && (
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => { setApportForm({ associe: 'oumar', type: 'apport_capital', montant: '', description: '', date: new Date().toISOString().slice(0, 10) }); setShowApportForm(true); }}>
                      <Plus className="h-3.5 w-3.5" /> Nouvel apport
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {[
                    { date: '2024-01-01', associe: 'Oumar', montant: 3000000, desc: 'Investissement initial' },
                    { date: '2024-01-01', associe: 'Senouss', montant: 2500000, desc: 'Investissement initial' },
                    { date: '2024-06-01', associe: 'Oumar', montant: 1965000, desc: 'Frais de voyage Chine' },
                  ].map((a, i) => (
                    <div key={i} className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2.5 border">
                      <div>
                        <p className="text-sm font-medium">{a.desc}</p>
                        <p className="text-[10px] text-muted-foreground">{a.date} — {a.associe}</p>
                      </div>
                      <span className="font-bold text-sm">{fmt(a.montant)} F</span>
                    </div>
                  ))}
                  {apports.map((a) => (
                    <div key={a.id} className="flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2.5 border border-emerald-200">
                      <div>
                        <p className="text-sm font-medium">{a.description || 'Apport en capital'}</p>
                        <p className="text-[10px] text-muted-foreground">{a.date} — {a.associe === 'oumar' ? 'Oumar' : 'Senouss'}</p>
                      </div>
                      <div className="text-right">
                        <span className="font-bold text-sm text-emerald-700">{fmt(a.montant)} F</span>
                        <Badge className="ml-2 text-[9px] bg-emerald-100 text-emerald-700">{a.type === 'apport_capital' ? 'Capital' : 'Prêt'}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 rounded-xl bg-slate-50 p-3 border">
                  <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1"><Shield className="h-3 w-3" /> Formule de dilution</p>
                  <div className="text-[11px] text-muted-foreground space-y-1">
                    <p>Capital total : {fmt(PARTS_SOCIALES.totalCapital)} F</p>
                    <p>Oumar : {fmt(PARTS_SOCIALES.apportsOumar)} F (3M + 1.965M + 2M + 1M)</p>
                    <p>Senouss : {fmt(PARTS_SOCIALES.apportsSenouss)} F</p>
                    <p className="font-semibold text-foreground">= Oumar {capTable.oumar.toFixed(2)}% / Senouss {capTable.senouss.toFixed(2)}%</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {/* ═══════════════ TAB 2 : RESULTAT ANNUEL ═══════════════ */}
      {tab === 'resultat' && (
        <div className="space-y-4">
          {/* Selecteur d'annee */}
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <Calculator className="h-5 w-5 text-emerald-600" />
              Résultat de l'exercice {anneeResultat}
            </h3>
            <select
              value={anneeResultat}
              onChange={(e) => setAnneeResultat(parseInt(e.target.value))}
              className="rounded-lg border px-3 py-2 text-sm bg-white"
            >
              {[2024, 2025, 2026, 2027].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          {resultatAnnuel.nbRapports === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <FileText className="h-12 w-12 mx-auto mb-3 text-muted-foreground/30" />
                <p className="font-medium">Aucun rapport journalier pour {anneeResultat}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Les données apparaîtront au fur et à mesure des rapports saisis.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Indicateur estimation */}
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 flex items-center gap-2 text-sm">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                <span className="text-amber-800">
                  {resultatAnnuel.statut === 'estime'
                    ? `Estimation en cours — basée sur ${resultatAnnuel.nbRapports} rapport(s) journalier(s) de ${anneeResultat}.`
                    : `Exercice ${anneeResultat} : ${resultatAnnuel.statut}.`}
                </span>
              </div>

              {/* Tableau du resultat */}
              <Card>
                <CardContent className="p-4 sm:p-6">
                  <div className="space-y-3">
                    {/* 1. CA annuel */}
                    <div className="flex justify-between items-center py-2">
                      <span className="font-medium">Chiffre d'affaires annuel</span>
                      <span className="text-lg font-bold text-blue-600">{fmt(resultatAnnuel.caAnnuel)} FCFA</span>
                    </div>

                    {/* 2. Depenses operationnelles */}
                    <div className="flex justify-between items-center py-2 border-t">
                      <span className="text-muted-foreground">Dépenses opérationnelles</span>
                      <span className="text-red-600">- {fmt(resultatAnnuel.depensesOp)} FCFA</span>
                    </div>

                    {/* 3. Charges fixes */}
                    <div className="flex justify-between items-center py-2 border-t">
                      <span className="text-muted-foreground">Charges fixes annuelles</span>
                      <span className="text-red-600">- {fmt(resultatAnnuel.chargesFixes)} FCFA</span>
                    </div>

                    {/* 4. Benefice net */}
                    <div className={`flex justify-between items-center py-3 border-t-2 border-b-2 ${resultatAnnuel.beneficeNet >= 0 ? 'bg-green-50' : 'bg-red-50'} -mx-4 sm:-mx-6 px-4 sm:px-6`}>
                      <span className="font-bold text-lg">Bénéfice net annuel</span>
                      <span className={`text-xl font-black ${resultatAnnuel.beneficeNet >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                        {fmt(resultatAnnuel.beneficeNet)} FCFA
                      </span>
                    </div>

                    {resultatAnnuel.beneficeNet > 0 && (
                      <>
                        {/* 5. Remuneration gestion */}
                        <div className="flex justify-between items-center py-2">
                          <div>
                            <span className="font-medium">Rémunération de gestion</span>
                            <p className="text-xs text-muted-foreground">Oumar Ibrahim — 20% du bénéfice net</p>
                          </div>
                          <span className="text-orange-600 font-semibold">- {fmt(resultatAnnuel.remGestion)} FCFA</span>
                        </div>

                        {/* 6. Benefice distribuable */}
                        <div className="flex justify-between items-center py-3 border-t-2 bg-emerald-50 -mx-4 sm:-mx-6 px-4 sm:px-6">
                          <span className="font-bold text-lg">Bénéfice distribuable</span>
                          <span className="text-xl font-black text-emerald-700">{fmt(resultatAnnuel.distribuable)} FCFA</span>
                        </div>

                        {/* 7 & 8. Repartition theorique */}
                        <div className="rounded-xl bg-muted/30 border p-4 mt-2">
                          <h4 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                            <Users className="h-4 w-4 text-muted-foreground" />
                            Répartition théorique (simulation)
                          </h4>
                          <p className="text-[10px] text-muted-foreground mb-3">
                            Ces montants sont une simulation de distribution — aucun paiement automatique n'est déclenché.
                          </p>
                          <div className="space-y-2">
                            <div className="flex justify-between items-center">
                              <span className="text-sm">Oumar Ibrahim ({capTable.oumar}%)</span>
                              <span className="font-bold text-blue-600">{fmt(resultatAnnuel.partOumar)} FCFA</span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-sm">Senouss Saleh ({capTable.senouss}%)</span>
                              <span className="font-bold text-amber-600">{fmt(resultatAnnuel.partSenouss)} FCFA</span>
                            </div>
                          </div>
                        </div>
                      </>
                    )}

                    {resultatAnnuel.beneficeNet <= 0 && (
                      <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-center">
                        <p className="font-medium text-red-800">Pas de bénéfice distribuable</p>
                        <p className="text-xs text-red-600 mt-1">L'exercice est déficitaire ou à l'équilibre.</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* 9. Statut de l'exercice */}
              {isAdmin && (
                <Card>
                  <CardContent className="p-4">
                    <h4 className="text-sm font-semibold mb-3">Statut de l'exercice {anneeResultat}</h4>
                    <div className="flex flex-wrap gap-2">
                      {['estime', 'cloture', 'distribue', 'mis_en_reserve'].map((s) => (
                        <Button
                          key={s}
                          size="sm"
                          variant={resultatAnnuel.statut === s ? 'default' : 'outline'}
                          onClick={() => handleSaveStatut(s)}
                          className={resultatAnnuel.statut === s ? '' : 'text-muted-foreground'}
                        >
                          {s === 'estime' && '📊 Estimé'}
                          {s === 'cloture' && '✅ Clôturé'}
                          {s === 'distribue' && '💰 Distribué'}
                          {s === 'mis_en_reserve' && '🏦 Mis en réserve'}
                        </Button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Sources des donnees */}
              <Card>
                <CardContent className="p-4">
                  <h4 className="text-sm font-semibold mb-2 text-muted-foreground">Sources des données</h4>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg bg-blue-50 p-2">
                      <p className="font-medium text-blue-800">CA + Dép. opérationnelles</p>
                      <p className="text-blue-600">Rapports journaliers ({resultatAnnuel.nbRapports} rapport(s))</p>
                    </div>
                    <div className="rounded-lg bg-violet-50 p-2">
                      <p className="font-medium text-violet-800">Charges fixes</p>
                      <p className="text-violet-600">Module charges fixes ({chargesFixes.length} poste(s))</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}

      {/* ═══════════════ TAB 3 : HISTORIQUE DES MODIFICATIONS ═══════════════ */}
      {tab === 'historique' && (
        <>
          {/* Filtres */}
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-[140px]">
                  <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Investisseur</label>
                  <select
                    className="w-full rounded-md border px-3 py-2 text-sm"
                    value={filterInvestisseur}
                    onChange={(e) => setFilterInvestisseur(e.target.value)}
                  >
                    <option value="">Tous</option>
                    {investisseurs.map((inv) => (
                      <option key={inv.id} value={inv.id}>{inv.nom}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1 min-w-[140px]">
                  <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Type d'opération</label>
                  <select
                    className="w-full rounded-md border px-3 py-2 text-sm"
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value)}
                  >
                    <option value="">Tous</option>
                    {TYPE_OPERATIONS.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div className="min-w-[130px]">
                  <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Date début</label>
                  <Input type="date" value={filterDateDebut} onChange={(e) => setFilterDateDebut(e.target.value)} className="text-sm" />
                </div>
                <div className="min-w-[130px]">
                  <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Date fin</label>
                  <Input type="date" value={filterDateFin} onChange={(e) => setFilterDateFin(e.target.value)} className="text-sm" />
                </div>
                {isAdmin && (
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={exportAuditPDF}>
                    <Download className="h-3.5 w-3.5" /> PDF
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Tableau historique */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Shield className="h-4 w-4 text-primary" />
                  Journal d'Audit des Investisseurs
                  <Badge variant="secondary" className="text-[10px]">{filteredModifications.length} entrée(s)</Badge>
                </CardTitle>
                <Badge variant="outline" className="text-[9px] text-red-600 border-red-200">
                  Lecture seule — immuable
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {filteredModifications.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Shield className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">Aucune modification enregistrée</p>
                  <p className="text-sm mt-1">Les modifications de montants investisseurs apparaîtront ici</p>
                </div>
              ) : (
                <>
                  {/* Desktop table */}
                  <div className="hidden lg:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="text-left py-2 px-3 font-medium text-muted-foreground text-xs">Date / Heure</th>
                          <th className="text-left py-2 px-3 font-medium text-muted-foreground text-xs">Investisseur</th>
                          <th className="text-left py-2 px-3 font-medium text-muted-foreground text-xs">Type</th>
                          <th className="text-right py-2 px-3 font-medium text-muted-foreground text-xs">Ancien</th>
                          <th className="text-right py-2 px-3 font-medium text-muted-foreground text-xs">Nouveau</th>
                          <th className="text-right py-2 px-3 font-medium text-muted-foreground text-xs">Différence</th>
                          <th className="text-left py-2 px-3 font-medium text-muted-foreground text-xs">Motif</th>
                          <th className="text-left py-2 px-3 font-medium text-muted-foreground text-xs">Admin</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredModifications.map((m) => {
                          const typeOp = TYPE_OPERATIONS.find((t) => t.value === m.typeOperation);
                          const diff = m.difference || 0;
                          return (
                            <tr key={m.id} className="border-b last:border-0 hover:bg-muted/30">
                              <td className="py-2.5 px-3 text-xs whitespace-nowrap">{fmtDate(m.dateHeure || m.created_at)}</td>
                              <td className="py-2.5 px-3 font-medium">{m.investisseurNom || '—'}</td>
                              <td className="py-2.5 px-3">
                                <Badge className={`text-[10px] ${typeOp?.color || 'bg-gray-100'}`}>{typeOp?.label || m.typeOperation}</Badge>
                              </td>
                              <td className="py-2.5 px-3 text-right tabular-nums">{fmt(m.ancienMontant)} F</td>
                              <td className="py-2.5 px-3 text-right font-bold tabular-nums">{fmt(m.nouveauMontant)} F</td>
                              <td className={`py-2.5 px-3 text-right font-semibold tabular-nums ${diff >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                {diff >= 0 ? '+' : ''}{fmt(diff)} F
                              </td>
                              <td className="py-2.5 px-3 max-w-[200px]">
                                <p className="text-sm truncate" title={m.motif}>{m.motif}</p>
                                {m.commentaire && <p className="text-[10px] text-muted-foreground truncate" title={m.commentaire}>{m.commentaire}</p>}
                              </td>
                              <td className="py-2.5 px-3 text-xs text-muted-foreground">{m.auteur}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile cards */}
                  <div className="lg:hidden space-y-3">
                    {filteredModifications.map((m) => {
                      const typeOp = TYPE_OPERATIONS.find((t) => t.value === m.typeOperation);
                      const diff = m.difference || 0;
                      return (
                        <div key={m.id} className="rounded-xl border p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">{fmtDate(m.dateHeure || m.created_at)}</span>
                            <Badge className={`text-[10px] ${typeOp?.color || 'bg-gray-100'}`}>{typeOp?.label || m.typeOperation}</Badge>
                          </div>
                          <p className="font-semibold text-sm">{m.investisseurNom}</p>
                          <div className="grid grid-cols-3 gap-2 text-center">
                            <div>
                              <p className="text-[10px] text-muted-foreground">Ancien</p>
                              <p className="text-xs font-medium">{fmt(m.ancienMontant)} F</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-muted-foreground">Nouveau</p>
                              <p className="text-xs font-bold">{fmt(m.nouveauMontant)} F</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-muted-foreground">Diff.</p>
                              <p className={`text-xs font-semibold ${diff >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                {diff >= 0 ? '+' : ''}{fmt(diff)} F
                              </p>
                            </div>
                          </div>
                          <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">Motif:</span> {m.motif}</p>
                          {m.commentaire && <p className="text-xs text-muted-foreground">Note: {m.commentaire}</p>}
                          <p className="text-[10px] text-muted-foreground">Par: {m.auteur}</p>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* ═══════════════ MODALS ═══════════════ */}

      {/* Modal Modification Investisseur (avec traçabilité) */}
      <Dialog open={showModifModal} onOpenChange={setShowModifModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              Modifier montant investisseur
            </DialogTitle>
            <DialogDescription className="text-xs">
              Cette action sera tracée dans le journal d'audit de manière immuable.
            </DialogDescription>
          </DialogHeader>
          {selectedInvestisseur && (
            <div className="space-y-4 pt-2">
              {/* Info investisseur */}
              <div className="rounded-lg bg-blue-50 p-3">
                <p className="font-semibold text-sm">{selectedInvestisseur.nom}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Montant actuel : <span className="font-bold text-foreground">{fmt(selectedInvestisseur.montantActuel)} FCFA</span>
                </p>
              </div>

              {/* Type d'opération */}
              <div>
                <label className="mb-1.5 block text-sm font-medium">Type d'opération *</label>
                <select
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={modifForm.typeOperation}
                  onChange={(e) => setModifForm({ ...modifForm, typeOperation: e.target.value })}
                >
                  {TYPE_OPERATIONS.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>

              {/* Montant */}
              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  {modifForm.typeOperation === 'correction' || modifForm.typeOperation === 'ajustement'
                    ? 'Nouveau montant (FCFA) *'
                    : 'Montant de la variation (FCFA) *'}
                </label>
                <Input
                  type="number"
                  value={modifForm.montantVariation}
                  onChange={(e) => setModifForm({ ...modifForm, montantVariation: e.target.value })}
                  placeholder="0"
                  min="0"
                />
                {modifForm.montantVariation && modifForm.typeOperation !== 'correction' && modifForm.typeOperation !== 'ajustement' && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Nouveau montant estimé : {fmt(
                      modifForm.typeOperation === 'retrait'
                        ? (selectedInvestisseur.montantActuel - Number(modifForm.montantVariation))
                        : (selectedInvestisseur.montantActuel + Number(modifForm.montantVariation))
                    )} F
                  </p>
                )}
              </div>

              {/* Motif obligatoire */}
              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  Motif * <span className="text-[10px] text-muted-foreground">(minimum 10 caractères)</span>
                </label>
                <textarea
                  className="w-full rounded-md border px-3 py-2 text-sm min-h-[80px] resize-none"
                  value={modifForm.motif}
                  onChange={(e) => setModifForm({ ...modifForm, motif: e.target.value })}
                  placeholder="Expliquez la raison de cette modification..."
                  maxLength={500}
                />
                <p className={`text-[10px] mt-0.5 ${modifForm.motif.length < 10 ? 'text-red-500' : 'text-muted-foreground'}`}>
                  {modifForm.motif.length}/500 caractères
                </p>
              </div>

              {/* Commentaire optionnel */}
              <div>
                <label className="mb-1.5 block text-sm font-medium">Commentaire <span className="text-[10px] text-muted-foreground">(optionnel)</span></label>
                <Input
                  value={modifForm.commentaire}
                  onChange={(e) => setModifForm({ ...modifForm, commentaire: e.target.value })}
                  placeholder="Informations complémentaires..."
                />
              </div>

              {/* Avertissement */}
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
                <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-3.5 w-3.5" /> Attention</p>
                <p className="mt-1">Cette modification sera enregistrée de manière permanente dans le journal d'audit avec votre identité ({user?.prenom} {user?.nom}). Elle ne pourra pas être supprimée.</p>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setShowModifModal(false)}>Annuler</Button>
                <Button
                  className="flex-1 bg-orange-600 hover:bg-orange-700"
                  onClick={handleModification}
                  disabled={!modifForm.montantVariation || Number(modifForm.montantVariation) <= 0 || modifForm.motif.trim().length < 10}
                >
                  Confirmer la modification
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Apport Dialog */}
      <Dialog open={showApportForm} onOpenChange={setShowApportForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Nouvel Apport en Capital</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Associé</label>
              <select className="w-full rounded-md border px-3 py-2 text-sm" value={apportForm.associe} onChange={(e) => setApportForm({ ...apportForm, associe: e.target.value })}>
                <option value="oumar">Oumar Ibrahim</option>
                <option value="senouss">Senouss Saleh</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Type</label>
              <select className="w-full rounded-md border px-3 py-2 text-sm" value={apportForm.type} onChange={(e) => setApportForm({ ...apportForm, type: e.target.value })}>
                <option value="apport_capital">Apport en capital (modifie les parts)</option>
                <option value="pret">Prêt (dette à rembourser)</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Montant (FCFA)</label>
              <Input type="number" value={apportForm.montant} onChange={(e) => setApportForm({ ...apportForm, montant: e.target.value })} placeholder="0" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Description</label>
              <Input value={apportForm.description} onChange={(e) => setApportForm({ ...apportForm, description: e.target.value })} placeholder="Ex: Marchandises, Équipement..." />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Date</label>
              <Input type="date" value={apportForm.date} onChange={(e) => setApportForm({ ...apportForm, date: e.target.value })} />
            </div>
            <Button className="w-full" onClick={handleAddApport}>Enregistrer l'apport</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Remboursement Dialog */}
      <Dialog open={showRemboursementForm} onOpenChange={(o) => { setShowRemboursementForm(o); if (!o) setEditRembId(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editRembId ? 'Modifier le Remboursement' : 'Enregistrer un Remboursement'}</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="rounded-lg bg-red-50 p-3 text-sm">
              <p>Solde restant : <span className="font-bold text-red-600">{fmt(detteInfo.restant)} F</span></p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Montant remboursé (FCFA)</label>
              <Input type="number" value={rembForm.montant} onChange={(e) => setRembForm({ ...rembForm, montant: e.target.value })} placeholder="0" max={detteInfo.restant} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Date</label>
              <Input type="date" value={rembForm.date} onChange={(e) => setRembForm({ ...rembForm, date: e.target.value })} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Description</label>
              <Input value={rembForm.description} onChange={(e) => setRembForm({ ...rembForm, description: e.target.value })} placeholder="Ex: Versement espèces..." />
            </div>
            <Button className="w-full" onClick={handleAddRemboursement}>{editRembId ? 'Enregistrer les modifications' : 'Valider le remboursement'}</Button>
          </div>
        </DialogContent>
      </Dialog>
      {/* Edit Valuation Field Dialog */}
      <Dialog open={!!editField} onOpenChange={(open) => { if (!open) setEditField(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-4 w-4 text-primary" />
              Modifier: {editField?.label}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Cette modification sera tracee dans le journal d'audit.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="rounded-lg bg-blue-50 p-3 text-sm">
              <p className="text-muted-foreground">Valeur actuelle :</p>
              <p className="font-bold text-lg">{fmt(valuationParams[editField?.key])} F</p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Nouvelle valeur (FCFA)</label>
              <Input
                type="number"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                placeholder="0"
                min="0"
                autoFocus
              />
            </div>
            {editValue && Number(editValue) !== valuationParams[editField?.key] && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-2 text-xs">
                <p>Variation : <span className={Number(editValue) - (valuationParams[editField?.key] || 0) >= 0 ? 'text-emerald-600 font-semibold' : 'text-red-600 font-semibold'}>
                  {Number(editValue) - (valuationParams[editField?.key] || 0) >= 0 ? '+' : ''}{fmt(Number(editValue) - (valuationParams[editField?.key] || 0))} F
                </span></p>
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setEditField(null)}>Annuler</Button>
              <Button className="flex-1" onClick={handleSaveField} disabled={!editValue || Number(editValue) < 0}>
                Enregistrer
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Ajouter Investisseur Dialog */}
      <Dialog open={showAddInvestisseur} onOpenChange={setShowAddInvestisseur}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Ajouter un Investisseur</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Nom complet *</label>
              <Input value={newInvForm.nom} onChange={(e) => setNewInvForm({ ...newInvForm, nom: e.target.value })} placeholder="Ex: Jean Dupont" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Prénom</label>
              <Input value={newInvForm.prenom} onChange={(e) => setNewInvForm({ ...newInvForm, prenom: e.target.value })} placeholder="Prénom" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Montant d'investissement (FCFA) *</label>
              <Input type="number" value={newInvForm.montant} onChange={(e) => setNewInvForm({ ...newInvForm, montant: e.target.value })} placeholder="0" min="0" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Rôle</label>
              <select className="w-full rounded-md border px-3 py-2 text-sm" value={newInvForm.role} onChange={(e) => setNewInvForm({ ...newInvForm, role: e.target.value })}>
                <option value="associe">Associé</option>
                <option value="gerant">Gérant</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Notes</label>
              <Input value={newInvForm.notes} onChange={(e) => setNewInvForm({ ...newInvForm, notes: e.target.value })} placeholder="Informations complémentaires..." />
            </div>
            <Button className="w-full" onClick={handleAddInvestisseur}>Ajouter l'investisseur</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
