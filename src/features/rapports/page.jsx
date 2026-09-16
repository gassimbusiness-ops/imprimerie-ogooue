import { useState, useEffect, useMemo, useCallback } from 'react';
import { db } from '@/services/db';
import { todayISO, startOfMonthISO, addDaysISO } from '@/lib/dates';
import { caRapport, depensesRapport } from '@/services/finance-calc';
import {
  filtrerRapports, indexerRapports, normaliserPlage, plageActive,
  libellePlage, totauxFiltres,
} from './filtrage';
import { useAuth } from '@/services/auth';
import { logAction } from '@/services/audit';
import { notifyRapportSoumis, notifyDemandeModification } from '@/services/notifications';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Plus, FileSpreadsheet, Calendar, Eye, Edit, Lock, Trash2,
  CheckCircle2, Send, Save, Table2, List, LockOpen, MessageSquare,
  Download, Filter, ChevronLeft, ChevronRight, Shield, Clock, Bot, Loader2, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { exportRapportsMensuels } from '@/services/export-pdf';
import { askAI } from '@/services/ai';
import RapportForm from './components/rapport-form';
import RapportDetail from './components/rapport-detail';

const STATUS_MAP = {
  brouillon: { label: 'Brouillon', class: 'bg-orange-100 text-orange-700 border-orange-200', icon: Edit },
  soumis: { label: 'Soumis', class: 'bg-blue-100 text-blue-700 border-blue-200', icon: Send },
  valide: { label: 'Validé', class: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
  cloture: { label: 'Clôturé', class: 'bg-violet-100 text-violet-700 border-violet-200', icon: Lock },
};

const CATEGORIES = [
  { key: 'copies', label: 'Copies', short: 'COP' },
  { key: 'marchandises', label: 'Marchandises', short: 'MAR' },
  { key: 'scan', label: 'Scan', short: 'SCN' },
  { key: 'tirage_saisies', label: 'Tirage/Saisies', short: 'T/S' },
  { key: 'badges_plastification', label: 'Badges/Plast.', short: 'B/P' },
  { key: 'demi_photos', label: 'Photos', short: 'PHO' },
  { key: 'maintenance', label: 'Maintenance', short: 'MNT' },
  { key: 'imprimerie', label: 'Imprimerie', short: 'IMP' },
];

function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)); }

/**
 * Montant d'une mesure éventuellement indisponible.
 * Règle du projet : une valeur indisponible vaut `null` et s'affiche « — »,
 * jamais « 0 » — afficher 0 F sur une recherche sans résultat laisserait croire
 * à une période sans recette.
 */
function fmtMontant(n) { return n == null ? '—' : `${fmt(n)} F`; }

// Recettes / dépenses : source unique de vérité dans src/services/finance-calc.js
function totalRecettes(r) { return caRapport(r); }
function totalDepenses(r) { return depensesRapport(r); }

export default function Rapports() {
  const { user, isAdmin, isManager } = useAuth();
  const isEmploye = user?.role === 'employe';
  const [rapports, setRapports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [viewMode, setViewMode] = useState('tableur');
  const [showModifRequest, setShowModifRequest] = useState(null);
  const [modifMotif, setModifMotif] = useState('');
  const [filterStatut, setFilterStatut] = useState('all');
  // Filtres avances : plage de dates + recherche mot-cle
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  // Month navigation
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  // Une plage de dates est active dès qu'une borne exploitable est saisie.
  const usePlageActive = plageActive(dateFrom, dateTo);
  // Bornes remises à l'endroit si le gérant a saisi « du 15 au 05 ».
  const plage = useMemo(() => normaliserPlage(dateFrom, dateTo), [dateFrom, dateTo]);
  const rechercheActive = usePlageActive || !!searchTerm.trim() || filterStatut !== 'all';

  const load = async () => {
    setLoading(true);
    let data = await db.rapports.list();
    if (isEmploye) {
      // Date métier locale — jamais .toISOString() (cf. src/lib/dates.js)
      const today = todayISO();
      data = data.filter((r) => r.date === today);
    }
    setRapports(data.sort((a, b) => (b.date || '').localeCompare(a.date || '')));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Index de recherche : calculé UNE fois par jeu de données (600+ rapports,
  // ~30 lignes chacun) et non à chaque frappe.
  const indexRecherche = useMemo(() => indexerRapports(rapports), [rapports]);

  // Filtrage : plage de dates ET mot-clé ET statut. Logique pure et testée
  // dans src/features/rapports/filtrage.js (tests/filtrage.test.mjs).
  const filtered = useMemo(() => filtrerRapports(rapports, {
    debut: dateFrom,
    fin: dateTo,
    mot: searchTerm,
    statut: filterStatut,
    // Le mois de la navigation ← → ne sert que si aucune plage n'est saisie.
    mois: isEmploye ? '' : currentMonth,
  }, indexRecherche), [rapports, indexRecherche, dateFrom, dateTo, searchTerm, filterStatut, currentMonth, isEmploye]);

  // Stats de CE QUI EST AFFICHÉ (et non du mois entier) : les cartes et le
  // tableau parlent ainsi toujours du même ensemble. Sur 0 résultat, les
  // montants valent null → « — », jamais « 0 F ».
  const stats = useMemo(() => {
    const t = totauxFiltres(filtered, { ca: totalRecettes, depenses: totalDepenses });
    return {
      ...t,
      aValider: filtered.filter((r) => r.statut === 'soumis').length,
      clotures: filtered.filter((r) => r.statut === 'cloture').length,
    };
  }, [filtered]);

  // Période affichée en clair : « du 05/04/2026 au 15/04/2026 » ou le mois courant.
  const periodeLabel = usePlageActive ? libellePlage(dateFrom, dateTo) : '';

  const resetFiltres = () => { setDateFrom(''); setDateTo(''); setSearchTerm(''); setFilterStatut('all'); };

  // Raccourcis de plage — évitent au gérant de saisir deux dates à la main.
  // Toutes ces bornes passent par src/lib/dates.js : jamais d'UTC.
  const appliquerPlage = (debut, fin) => { setDateFrom(debut); setDateTo(fin); };
  const plage7Jours = () => appliquerPlage(addDaysISO(-6), todayISO());
  const plageMoisEnCours = () => appliquerPlage(startOfMonthISO(), todayISO());
  const plageMoisPrecedent = () => {
    const n = new Date();
    // new Date(y, -1, 1) bascule correctement sur décembre de l'année précédente.
    const debut = startOfMonthISO(new Date(n.getFullYear(), n.getMonth() - 1, 1));
    // Dernier jour = veille du 1er du mois en cours.
    const fin = addDaysISO(-1, new Date(n.getFullYear(), n.getMonth(), 1));
    appliquerPlage(debut, fin);
  };

  const handleNew = () => { setEditing(null); setShowForm(true); };
  const handleEdit = (r) => {
    if (r.statut === 'cloture' || r.statut === 'valide') {
      toast.error('Ce rapport est verrouillé. Demandez une modification.');
      return;
    }
    setEditing(r); setShowForm(true);
  };

  const handleSave = async (data) => {
    if (editing) {
      await db.rapports.update(editing.id, data);
      await logAction('update', 'rapports', {
        entityId: editing.id, entityLabel: `Rapport ${data.date}`,
        details: `Modification rapport du ${data.date}`,
      });
      toast.success('Rapport mis à jour');
    } else {
      const created = await db.rapports.create(data);
      await logAction('create', 'rapports', {
        entityId: created.id, entityLabel: `Rapport ${data.date}`,
        details: `Nouveau rapport: ${data.date} par ${data.operateur_nom}`,
      });
      if (data.statut === 'soumis') {
        notifyRapportSoumis(data.operateur_nom, data.date);
      }
      toast.success('Rapport créé');
    }
    setShowForm(false); setEditing(null); load();
  };

  const handleDelete = async (r) => {
    if (!confirm(`Supprimer le rapport du ${r.date} ?`)) return;
    await db.rapports.delete(r.id);
    await logAction('delete', 'rapports', {
      entityId: r.id, entityLabel: `Rapport ${r.date}`,
      details: `Suppression rapport du ${r.date}`,
    });
    toast.success('Rapport supprimé'); load();
  };

  const handleValidate = async (r) => {
    await db.rapports.update(r.id, { statut: 'valide', valide_par: `${user.prenom} ${user.nom}`, valide_at: new Date().toISOString() });
    await logAction('update', 'rapports', {
      entityId: r.id, entityLabel: `Rapport ${r.date}`,
      details: `Validation rapport du ${r.date}`,
    });
    toast.success('Rapport validé'); load();
  };

  const handleCloturer = async (r) => {
    await db.rapports.update(r.id, { statut: 'cloture', cloture_par: `${user.prenom} ${user.nom}`, cloture_at: new Date().toISOString() });
    await logAction('cloture', 'rapports', {
      entityId: r.id, entityLabel: `Rapport ${r.date}`,
      details: `Clôture rapport du ${r.date}`,
    });
    toast.success('Rapport clôturé et verrouillé'); load();
  };

  const handleDeverrouiller = async (r) => {
    await db.rapports.update(r.id, { statut: 'soumis', deverrouille_par: `${user.prenom} ${user.nom}`, deverrouille_at: new Date().toISOString() });
    await logAction('update', 'rapports', {
      entityId: r.id, entityLabel: `Rapport ${r.date}`,
      details: `Déverrouillage rapport du ${r.date}`,
    });
    toast.success('Rapport déverrouillé'); load();
  };

  const handleDemandeModif = async () => {
    if (!modifMotif.trim()) { toast.error('Veuillez indiquer le motif'); return; }
    const r = showModifRequest;
    await logAction('update', 'rapports', {
      entityId: r.id, entityLabel: `Rapport ${r.date}`,
      details: `Demande de modification: ${modifMotif}`,
      metadata: { motif: modifMotif, demandeur: `${user.prenom} ${user.nom}` },
    });
    notifyDemandeModification(`${user.prenom} ${user.nom}`);
    toast.success('Demande de modification envoyee a l\'administrateur');
    setShowModifRequest(null); setModifMotif('');
  };

  const prevMonth = () => {
    const [y, m] = currentMonth.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    setCurrentMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };
  const nextMonth = () => {
    const [y, m] = currentMonth.split('-').map(Number);
    const d = new Date(y, m, 1);
    setCurrentMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };
  const monthLabel = (() => {
    const [y, m] = currentMonth.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  })();

  // Libellé de la période réellement affichée : la plage si elle est saisie,
  // sinon le mois de la navigation ← →.
  const periodeTexte = periodeLabel || monthLabel;

  const formatDate = (d) => {
    return new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', {
      weekday: 'short', day: 'numeric', month: 'short',
    });
  };

  // Inline cell editing
  const [editingCell, setEditingCell] = useState(null); // { rapportId, catKey }
  const [editValue, setEditValue] = useState('');

  const handleCellClick = useCallback((r, catKey) => {
    if (r.statut === 'cloture' || r.statut === 'valide') return;
    setEditingCell({ rapportId: r.id, catKey });
    setEditValue(String(r.categories?.[catKey] || 0));
  }, []);

  const handleCellSave = useCallback(async () => {
    if (!editingCell) return;
    const { rapportId, catKey } = editingCell;
    const num = parseInt(editValue.replace(/\s/g, ''), 10) || 0;
    const r = rapports.find((x) => x.id === rapportId);
    if (!r) return;
    const newCats = { ...r.categories, [catKey]: Math.max(0, num) };
    await db.rapports.update(rapportId, { categories: newCats });
    setEditingCell(null);
    load();
  }, [editingCell, editValue, rapports]);

  const handleCellKeyDown = useCallback((e) => {
    if (e.key === 'Enter') handleCellSave();
    if (e.key === 'Escape') setEditingCell(null);
    if (e.key === 'Tab') { e.preventDefault(); handleCellSave(); }
  }, [handleCellSave]);

  // ── IA Analysis ──
  const [iaLoading, setIaLoading] = useState(false);
  const [iaResult, setIaResult] = useState(null);

  const handleAnalyseIA = async () => {
    // On analyse EXACTEMENT ce qui est affiché à l'écran.
    const cible = filtered;
    if (cible.length === 0) { toast.error('Aucun rapport à analyser pour cette sélection'); return; }
    setIaLoading(true);
    setIaResult(null);
    try {
      const rapportsData = cible.map((r) => ({
        date: r.date,
        recettes: totalRecettes(r),
        depenses: totalDepenses(r),
        solde: totalRecettes(r) - totalDepenses(r),
        services: r.categories || {},
      }));
      const system = `Tu es analyste financier expert pour une PME gabonaise.`;
      const prompt = `Analyse ces rapports journaliers de l'imprimerie Ogooue (Moanda, Gabon) pour la periode ${periodeTexte}.\nDonnees : ${JSON.stringify(rapportsData)}\n\nDonne une analyse en 4 parties :\n1. Resume global (2 phrases)\n2. Points forts de la periode (liste de 3 elements)\n3. Points d'attention ou alertes (liste de 2-3 elements)\n4. Recommandations actionnables (liste de 2-3 elements)\n\nReponds en francais naturel, sans markdown avec des # ou **. Utilise des tirets (-) pour les listes.`;
      const result = await askAI(system, prompt, 600);
      setIaResult(result);
      toast.success('Analyse IA terminee');
    } catch (err) {
      // Le message vient de api/_lib/modeles.js:46-63 : il NOMME la cause
      // (modele retire, cle revoquee, quota atteint). Le jeter derriere
      // « Erreur lors de l'analyse IA » a coute des semaines de debug sur
      // claude-sonnet-4-20250514.
      toast.error(err?.message || 'Erreur lors de l\'analyse IA', { duration: 12000 });
    } finally {
      setIaLoading(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Rapports journaliers</h2>
          <p className="text-muted-foreground">Recettes quotidiennes — cliquez une cellule pour éditer</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border p-0.5">
            <button onClick={() => setViewMode('tableur')} className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === 'tableur' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
              <Table2 className="h-4 w-4" />
            </button>
            <button onClick={() => setViewMode('list')} className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
              <List className="h-4 w-4" />
            </button>
          </div>
          <Button onClick={handleNew} className="gap-2">
            <Plus className="h-4 w-4" /> Nouveau
          </Button>
        </div>
      </div>

      {/* Month nav + Stats (hidden for employees) */}
      {!isEmploye && (
        <>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={prevMonth} disabled={usePlageActive}><ChevronLeft className="h-4 w-4" /></Button>
              <span className={`text-sm font-semibold capitalize min-w-[150px] text-center ${usePlageActive ? 'text-muted-foreground line-through' : ''}`}>{monthLabel}</span>
              <Button variant="outline" size="icon" onClick={nextMonth} disabled={usePlageActive}><ChevronRight className="h-4 w-4" /></Button>
            </div>
            <div className="flex items-center gap-2">
              <Select value={filterStatut} onValueChange={setFilterStatut}>
                <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous statuts</SelectItem>
                  {Object.entries(STATUS_MAP).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {/* PDF et IA portent sur EXACTEMENT ce qui est affiché */}
              <Button variant="outline" size="sm" className="gap-2" disabled={filtered.length === 0}
                onClick={() => exportRapportsMensuels(filtered, currentMonth, stats, periodeLabel)}>
                <Download className="h-4 w-4" /> PDF
              </Button>
              <Button size="sm" className="gap-2 bg-violet-600 hover:bg-violet-700 text-white" onClick={handleAnalyseIA} disabled={iaLoading || filtered.length === 0}>
                {iaLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                Analyser avec IA
              </Button>
            </div>
          </div>

          {/* ── Recherche : plage de dates libre + mot-clé (demande n°1 du gérant) ── */}
          <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
            <div className="flex flex-wrap items-end gap-2">
              {/* Pas de min/max natif : saisir « du 15 au 05 » ne doit pas être
                  bloqué, les bornes sont remises à l'endroit et le signalent. */}
              <div className="flex flex-col">
                <label htmlFor="rap-du" className="text-[10px] font-medium text-muted-foreground">Du</label>
                <Input id="rap-du" type="date" value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)} className="h-8 w-[150px]" />
              </div>
              <div className="flex flex-col">
                <label htmlFor="rap-au" className="text-[10px] font-medium text-muted-foreground">Au</label>
                <Input id="rap-au" type="date" value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)} className="h-8 w-[150px]" />
              </div>
              <div className="flex min-w-[220px] flex-1 flex-col">
                <label htmlFor="rap-q" className="text-[10px] font-medium text-muted-foreground">
                  Rechercher un mot (opérateur, description, dépense, note)
                </label>
                <Input id="rap-q" type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="ex. depot, bache, Chantal…" className="h-8" />
              </div>
              {rechercheActive && (
                <Button variant="ghost" size="sm" onClick={resetFiltres} className="h-8 gap-1">
                  <X className="h-3.5 w-3.5" /> Réinitialiser
                </Button>
              )}
            </div>

            {/* Raccourcis de plage */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground">Raccourcis :</span>
              <Button variant="outline" size="sm" className="h-6 px-2 text-[11px]" onClick={plage7Jours}>7 derniers jours</Button>
              <Button variant="outline" size="sm" className="h-6 px-2 text-[11px]" onClick={plageMoisEnCours}>Mois en cours</Button>
              <Button variant="outline" size="sm" className="h-6 px-2 text-[11px]" onClick={plageMoisPrecedent}>Mois précédent</Button>
            </div>

            {/* Période appliquée, en clair + nombre de résultats */}
            <div className="flex flex-wrap items-center gap-2 border-t pt-2">
              <Badge variant="outline" className="h-6 gap-1 border-blue-500/40 text-blue-700">
                <Filter className="h-3 w-3" /> Période : {periodeTexte}
              </Badge>
              {searchTerm.trim() && (
                <Badge variant="outline" className="h-6 border-violet-500/40 text-violet-700">
                  Mot : « {searchTerm.trim()} »
                </Badge>
              )}
              <span className="text-xs font-medium">
                {filtered.length === 0
                  ? 'Aucun rapport ne correspond'
                  : `${filtered.length} rapport${filtered.length > 1 ? 's' : ''} trouvé${filtered.length > 1 ? 's' : ''}`}
              </span>
              {plage.inversee && (
                <span className="text-xs text-amber-700">
                  Les dates étaient à l'envers — la plage a été remise dans l'ordre.
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            <Card><CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground">Rapports</p>
              <p className="text-lg font-bold">{stats.count}</p>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground">Recettes</p>
              <p className={`text-lg font-bold ${stats.recettes == null ? 'text-muted-foreground/50' : 'text-emerald-600'}`}>{fmtMontant(stats.recettes)}</p>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground">Dépenses</p>
              <p className={`text-lg font-bold ${stats.depenses == null ? 'text-muted-foreground/50' : 'text-red-600'}`}>{fmtMontant(stats.depenses)}</p>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground">Solde</p>
              <p className={`text-lg font-bold ${stats.solde == null ? 'text-muted-foreground/50' : (stats.solde >= 0 ? 'text-primary' : 'text-destructive')}`}>{fmtMontant(stats.solde)}</p>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground">À valider</p>
              <p className="text-lg font-bold text-blue-600">{stats.aValider}</p>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground">Clôturés</p>
              <p className="text-lg font-bold text-violet-600">{stats.clotures}</p>
            </CardContent></Card>
          </div>
        </>
      )}

      {/* IA Analysis Result */}
      {iaResult && (
        <Card className="border-violet-200 bg-violet-50/50">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100">
                  <Bot className="h-4 w-4 text-violet-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm text-violet-900">Analyse IA — {periodeTexte}</h3>
                  <p className="text-[10px] text-violet-600">Basee sur {stats.count} rapport(s)</p>
                </div>
              </div>
              <button onClick={() => setIaResult(null)} className="text-violet-400 hover:text-violet-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="text-sm text-violet-900/80 whitespace-pre-wrap leading-relaxed">{iaResult}</div>
          </CardContent>
        </Card>
      )}

      {/* TABLEUR VIEW — édition inline */}
      {viewMode === 'tableur' && !isEmploye && (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b-2 border-primary/20 bg-muted/60">
                  <th className="sticky left-0 z-10 bg-muted/60 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground min-w-[110px]">Date</th>
                  <th className="px-2 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground min-w-[90px]">Opérateur</th>
                  {CATEGORIES.map((c) => (
                    <th key={c.key} className="px-1 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-muted-foreground min-w-[75px] border-l border-muted" title={c.label}>{c.short}</th>
                  ))}
                  <th className="px-2 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-emerald-700 min-w-[85px] border-l-2 border-emerald-200 bg-emerald-50/50">Total</th>
                  <th className="px-2 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-red-700 min-w-[75px] border-l border-muted">Dép.</th>
                  <th className="px-2 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-blue-700 min-w-[85px] border-l border-muted">Solde</th>
                  <th className="px-2 py-2.5 text-center text-[11px] font-bold uppercase tracking-wider text-muted-foreground min-w-[60px] border-l border-muted">St.</th>
                  <th className="px-2 py-2.5 text-center text-[11px] font-bold uppercase tracking-wider text-muted-foreground min-w-[90px] border-l border-muted"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={CATEGORIES.length + 6} className="py-12 text-center">
                    <p className="text-muted-foreground">
                      {rechercheActive
                        ? 'Aucun rapport ne correspond à votre recherche.'
                        : `Aucun rapport pour ${periodeTexte}.`}
                    </p>
                    {rechercheActive && (
                      <>
                        <p className="mt-1 text-xs text-muted-foreground/70">
                          Période : {periodeTexte}
                          {searchTerm.trim() && ` · mot recherché : « ${searchTerm.trim()} »`}
                          {filterStatut !== 'all' && ` · statut : ${STATUS_MAP[filterStatut]?.label}`}
                        </p>
                        <Button variant="outline" size="sm" className="mt-3 gap-1" onClick={resetFiltres}>
                          <X className="h-3.5 w-3.5" /> Réinitialiser la recherche
                        </Button>
                      </>
                    )}
                  </td></tr>
                ) : filtered.map((r, rowIdx) => {
                  const rec = totalRecettes(r);
                  const dep = totalDepenses(r);
                  const solde = rec - dep;
                  const st = STATUS_MAP[r.statut] || STATUS_MAP.brouillon;
                  const isLocked = r.statut === 'cloture' || r.statut === 'valide';
                  const zebra = rowIdx % 2 === 0 ? '' : 'bg-muted/20';

                  return (
                    <tr key={r.id} className={`border-b border-muted/50 hover:bg-blue-50/40 transition-colors ${zebra} ${isLocked ? 'opacity-75' : ''}`}>
                      <td className="sticky left-0 z-10 bg-background px-3 py-1.5 font-medium text-xs whitespace-nowrap">{formatDate(r.date)}</td>
                      <td className="px-2 py-1.5 text-xs text-muted-foreground truncate max-w-[100px]">{r.operateur_nom?.split(' ')[0] || '—'}</td>
                      {CATEGORIES.map((c) => {
                        const isEditing = editingCell?.rapportId === r.id && editingCell?.catKey === c.key;
                        const val = r.categories?.[c.key] || 0;
                        return (
                          <td key={c.key} className="px-1 py-1 text-right text-xs tabular-nums border-l border-muted/30">
                            {isEditing ? (
                              <input
                                type="text"
                                inputMode="numeric"
                                autoFocus
                                className="w-full rounded border border-primary bg-white px-1 py-0.5 text-right text-xs font-medium tabular-nums outline-none ring-1 ring-primary/30"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onBlur={handleCellSave}
                                onKeyDown={handleCellKeyDown}
                              />
                            ) : (
                              <button
                                onClick={() => handleCellClick(r, c.key)}
                                className={`w-full rounded px-1 py-0.5 text-right ${!isLocked ? 'hover:bg-primary/10 hover:ring-1 hover:ring-primary/20 cursor-cell' : 'cursor-default'}`}
                                disabled={isLocked}
                              >
                                {val > 0 ? fmt(val) : <span className="text-muted-foreground/25">—</span>}
                              </button>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-2 py-1.5 text-right text-xs font-bold text-emerald-700 tabular-nums border-l-2 border-emerald-200 bg-emerald-50/30">{fmt(rec)}</td>
                      <td className="px-2 py-1.5 text-right text-xs font-semibold text-red-600 tabular-nums border-l border-muted/30">{fmt(dep)}</td>
                      <td className={`px-2 py-1.5 text-right text-xs font-bold tabular-nums border-l border-muted/30 ${solde >= 0 ? 'text-blue-700' : 'text-destructive'}`}>{fmt(solde)}</td>
                      <td className="px-1 py-1.5 text-center border-l border-muted/30">
                        <Badge variant="outline" className={`text-[8px] px-1.5 py-0 ${st.class}`}>
                          {isLocked && <Lock className="mr-0.5 h-2 w-2" />}
                          {st.label.slice(0, 4)}
                        </Badge>
                      </td>
                      <td className="px-1 py-1.5 border-l border-muted/30">
                        <div className="flex items-center justify-center gap-0">
                          <button onClick={() => setViewing(r)} className="rounded p-1 hover:bg-muted" title="Voir"><Eye className="h-3 w-3 text-muted-foreground" /></button>
                          {!isLocked && (
                            <button onClick={() => handleEdit(r)} className="rounded p-1 hover:bg-muted" title="Modifier"><Edit className="h-3 w-3 text-muted-foreground" /></button>
                          )}
                          {r.statut === 'soumis' && isManager && (
                            <button onClick={() => handleValidate(r)} className="rounded p-1 hover:bg-emerald-50" title="Valider"><CheckCircle2 className="h-3 w-3 text-emerald-600" /></button>
                          )}
                          {r.statut === 'valide' && isAdmin && (
                            <button onClick={() => handleCloturer(r)} className="rounded p-1 hover:bg-violet-50" title="Clôturer"><Lock className="h-3 w-3 text-violet-600" /></button>
                          )}
                          {isLocked && isAdmin && (
                            <button onClick={() => handleDeverrouiller(r)} className="rounded p-1 hover:bg-orange-50" title="Déverrouiller"><LockOpen className="h-3 w-3 text-orange-600" /></button>
                          )}
                          {isLocked && !isAdmin && (
                            <button onClick={() => { setShowModifRequest(r); setModifMotif(''); }} className="rounded p-1 hover:bg-blue-50" title="Demander modification"><MessageSquare className="h-3 w-3 text-blue-600" /></button>
                          )}
                          {r.statut === 'brouillon' && (
                            <button onClick={() => handleDelete(r)} className="rounded p-1 hover:bg-red-50" title="Supprimer"><Trash2 className="h-3 w-3 text-red-500" /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {/* Total row */}
                {filtered.length > 0 && (
                  <tr className="bg-muted/60 font-bold border-t-2 border-primary/20">
                    <td className="sticky left-0 z-10 bg-muted/60 px-3 py-2 text-xs uppercase">Total</td>
                    <td className="px-2 py-2 text-xs text-muted-foreground">{filtered.length} j.</td>
                    {CATEGORIES.map((c) => (
                      <td key={c.key} className="px-1 py-2 text-right text-xs tabular-nums border-l border-muted/30">
                        {fmt(filtered.reduce((s, r) => s + (r.categories?.[c.key] || 0), 0))}
                      </td>
                    ))}
                    <td className="px-2 py-2 text-right text-xs text-emerald-700 tabular-nums border-l-2 border-emerald-200 bg-emerald-50/30">{fmt(filtered.reduce((s, r) => s + totalRecettes(r), 0))}</td>
                    <td className="px-2 py-2 text-right text-xs text-red-600 tabular-nums border-l border-muted/30">{fmt(filtered.reduce((s, r) => s + totalDepenses(r), 0))}</td>
                    <td className="px-2 py-2 text-right text-xs text-blue-700 tabular-nums border-l border-muted/30">{fmt(filtered.reduce((s, r) => s + totalRecettes(r) - totalDepenses(r), 0))}</td>
                    <td colSpan={2} className="border-l border-muted/30"></td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* LIST VIEW */}
      {(viewMode === 'list' || isEmploye) && (
        <div className="space-y-3">
          {filtered.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16">
                <FileSpreadsheet className="mb-4 h-12 w-12 text-muted-foreground/30" />
                {rechercheActive ? (
                  <>
                    <p className="text-muted-foreground">Aucun rapport ne correspond à votre recherche.</p>
                    <p className="mt-1 text-xs text-muted-foreground/70">
                      Période : {periodeTexte}
                      {searchTerm.trim() && ` · mot recherché : « ${searchTerm.trim()} »`}
                      {filterStatut !== 'all' && ` · statut : ${STATUS_MAP[filterStatut]?.label}`}
                    </p>
                    <Button variant="outline" className="mt-4 gap-1" onClick={resetFiltres}>
                      <X className="h-3.5 w-3.5" /> Réinitialiser la recherche
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="text-muted-foreground">Aucun rapport pour l&apos;instant</p>
                    <Button onClick={handleNew} variant="outline" className="mt-4">Créer le premier rapport</Button>
                  </>
                )}
              </CardContent>
            </Card>
          ) : filtered.map((r) => {
            const rec = totalRecettes(r);
            const dep = totalDepenses(r);
            const solde = rec - dep;
            const st = STATUS_MAP[r.statut] || STATUS_MAP.brouillon;
            const isLocked = r.statut === 'cloture' || r.statut === 'valide';

            return (
              <Card key={r.id} className={`group transition-shadow hover:shadow-md ${isLocked ? 'border-l-4 border-l-violet-300' : ''}`}>
                <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-4">
                    <div className="hidden h-11 w-11 items-center justify-center rounded-xl bg-primary/10 sm:flex">
                      {isLocked ? <Lock className="h-5 w-5 text-violet-600" /> : <FileSpreadsheet className="h-5 w-5 text-primary" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold">{formatDate(r.date)}</p>
                        <Badge variant="outline" className={st.class}>{st.label}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        <Calendar className="mr-1 inline h-3 w-3" />
                        {r.operateur_nom || 'Non assigné'}
                        {r.valide_par && <span className="ml-2 text-emerald-600">✓ {r.valide_par}</span>}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-6">
                    {!isEmploye && (
                      <>
                        <div className="hidden text-right sm:block">
                          <p className="text-xs text-muted-foreground">Recettes</p>
                          <p className="font-semibold text-emerald-600">{fmt(rec)} F</p>
                        </div>
                        <div className="hidden text-right sm:block">
                          <p className="text-xs text-muted-foreground">Dépenses</p>
                          <p className="font-semibold text-destructive">{fmt(dep)} F</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">Solde</p>
                          <p className={`text-lg font-bold ${solde >= 0 ? 'text-primary' : 'text-destructive'}`}>{fmt(solde)} F</p>
                        </div>
                      </>
                    )}
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" onClick={() => setViewing(r)}><Eye className="h-4 w-4" /></Button>
                      {!isLocked && <Button variant="ghost" size="icon" onClick={() => handleEdit(r)}><Edit className="h-4 w-4" /></Button>}
                      {r.statut === 'soumis' && isManager && (
                        <Button variant="ghost" size="icon" className="text-emerald-600" onClick={() => handleValidate(r)}><CheckCircle2 className="h-4 w-4" /></Button>
                      )}
                      {r.statut === 'valide' && isAdmin && (
                        <Button variant="ghost" size="icon" className="text-violet-600" onClick={() => handleCloturer(r)}><Lock className="h-4 w-4" /></Button>
                      )}
                      {isLocked && isAdmin && (
                        <Button variant="ghost" size="icon" className="text-orange-600" onClick={() => handleDeverrouiller(r)}><LockOpen className="h-4 w-4" /></Button>
                      )}
                      {isLocked && !isAdmin && (
                        <Button variant="ghost" size="icon" className="text-blue-600" onClick={() => { setShowModifRequest(r); setModifMotif(''); }}><MessageSquare className="h-4 w-4" /></Button>
                      )}
                      {r.statut === 'brouillon' && <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(r.id)}><Trash2 className="h-4 w-4" /></Button>}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Form Dialog — Mode Tableur plein écran */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="h-[95vh] w-[96vw] max-w-[1400px] overflow-hidden p-0 gap-0 flex flex-col">
          <DialogHeader className="border-b px-6 py-3 shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-blue-600" />
              {editing ? 'Modifier le rapport' : 'Nouveau rapport journalier'} — Mode Tableur
            </DialogTitle>
          </DialogHeader>
          <RapportForm rapport={editing} onSave={handleSave} onCancel={() => setShowForm(false)} />
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={!!viewing} onOpenChange={() => setViewing(null)}>
        <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>Détail du rapport</DialogTitle></DialogHeader>
          {viewing && <RapportDetail rapport={viewing} />}
        </DialogContent>
      </Dialog>

      {/* Modification Request Dialog */}
      <Dialog open={!!showModifRequest} onOpenChange={() => setShowModifRequest(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-blue-600" />
              Demande de modification
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">
              Ce rapport est verrouillé. Décrivez les modifications souhaitées pour que l'administrateur puisse le déverrouiller.
            </p>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Rapport du {showModifRequest?.date}</label>
              <Badge variant="outline" className={STATUS_MAP[showModifRequest?.statut]?.class}>
                {STATUS_MAP[showModifRequest?.statut]?.label}
              </Badge>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Motif de la modification *</label>
              <textarea
                className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={modifMotif}
                onChange={(e) => setModifMotif(e.target.value)}
                placeholder="Décrivez les corrections nécessaires..."
              />
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setShowModifRequest(null)}>Annuler</Button>
              <Button className="flex-1 gap-2" onClick={handleDemandeModif}>
                <Send className="h-4 w-4" /> Envoyer la demande
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
