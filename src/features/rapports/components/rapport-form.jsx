import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { db } from '@/services/db';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  X, Save, Send, Loader2, FileSpreadsheet,
  Printer, FileUp, AlertTriangle, Clock,
} from 'lucide-react';
import { toast } from 'sonner';
import { exportRapportTableur } from '@/services/export-pdf';
import * as XLSX from 'xlsx';

/* ─── Colonnes du tableur ─── */
const COLUMNS = [
  { key: 'copies', label: 'COPIES', type: 'number' },
  { key: 'marchandises', label: 'MARCHANDISES', type: 'number' },
  { key: 'scan', label: 'SCAN', type: 'number' },
  { key: 'tirage_saisies', label: 'TIRAGE / SAISIES', type: 'number' },
  { key: 'badges_plastification', label: 'BADGES / PLASTIFICATION', type: 'number' },
  { key: 'demi_photos', label: 'DEMI-PHOTOS', type: 'number' },
  { key: 'maintenance', label: 'MAINTENANCE', type: 'number' },
  { key: 'imprimerie', label: 'IMPRIMERIE', type: 'number' },
  { key: 'sorties', label: 'SORTIES', type: 'number', isSortie: true },
  { key: 'description', label: 'DESCRIPTION', type: 'text' },
];

const NUM_COLS = COLUMNS.filter((c) => c.type === 'number');
const RECETTE_COLS = NUM_COLS.filter((c) => !c.isSortie);
const NB_ROWS = 30;

function emptyRow() {
  const row = {};
  COLUMNS.forEach((c) => {
    row[c.key] = c.type === 'number' ? 0 : '';
  });
  return row;
}

function initRows(existing) {
  if (existing && existing.length > 0) {
    const rows = existing.map((r) => ({ ...emptyRow(), ...r }));
    while (rows.length < NB_ROWS) rows.push(emptyRow());
    return rows;
  }
  return Array.from({ length: NB_ROWS }, () => emptyRow());
}

function fmt(n) {
  return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0));
}

function formatDate(d) {
  if (!d) return '';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
}

/* ─── Composant principal ─── */
export default function RapportForm({ rapport, onSave, onCancel }) {
  const [employes, setEmployes] = useState([]);
  const [saving, setSaving] = useState(false);
  const scrollRef = useRef(null);
  const fileInputRef = useRef(null);
  const initialLignesRef = useRef(null);

  const [date, setDate] = useState(
    rapport?.date || new Date().toISOString().split('T')[0],
  );
  const [operateurId, setOperateurId] = useState(rapport?.operateur_id || '');
  const [lignes, setLignes] = useState(() => initRows(rapport?.lignes));
  const [validationErrors, setValidationErrors] = useState({});
  const [showHistorique, setShowHistorique] = useState(false);

  useEffect(() => {
    db.employes.list().then(setEmployes);
  }, []);

  // Snapshot initial pour suivi d'historique
  useEffect(() => {
    if (rapport?.lignes) {
      initialLignesRef.current = JSON.parse(JSON.stringify(initRows(rapport.lignes)));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ─── Cell update (clear validation on change) ─── */
  const updateCell = useCallback((rowIdx, colKey, raw) => {
    setLignes((prev) => {
      const copy = [...prev];
      const col = COLUMNS.find((c) => c.key === colKey);
      if (col?.type === 'number') {
        const num = parseInt(String(raw).replace(/\s/g, ''), 10) || 0;
        copy[rowIdx] = { ...copy[rowIdx], [colKey]: Math.max(0, num) };
      } else {
        copy[rowIdx] = { ...copy[rowIdx], [colKey]: raw };
      }
      return copy;
    });
    setValidationErrors((prev) => {
      const key = `${rowIdx}-${colKey}`;
      if (prev[key]) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return prev;
    });
  }, []);

  /* ─── Keyboard navigation ─── */
  const handleKeyDown = useCallback((e, rowIdx, colIdx) => {
    const numColCount = COLUMNS.length;
    let nextRow = rowIdx;
    let nextCol = colIdx;

    if (e.key === 'Enter') {
      e.preventDefault();
      nextRow = Math.min(rowIdx + 1, NB_ROWS - 1);
    } else if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      nextCol = colIdx + 1;
      if (nextCol >= numColCount) { nextCol = 0; nextRow = Math.min(rowIdx + 1, NB_ROWS - 1); }
    } else if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      nextCol = colIdx - 1;
      if (nextCol < 0) { nextCol = numColCount - 1; nextRow = Math.max(rowIdx - 1, 0); }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      nextRow = Math.min(rowIdx + 1, NB_ROWS - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      nextRow = Math.max(rowIdx - 1, 0);
    } else {
      return;
    }

    const cellId = `cell-${nextRow}-${nextCol}`;
    const el = document.getElementById(cellId);
    if (el) { el.focus(); el.select?.(); }
  }, []);

  /* ─── Totals ─── */
  const columnTotals = useMemo(() => {
    const totals = {};
    NUM_COLS.forEach((c) => {
      totals[c.key] = lignes.reduce((s, row) => s + (row[c.key] || 0), 0);
    });
    return totals;
  }, [lignes]);

  const totalEntrees = useMemo(
    () => RECETTE_COLS.reduce((s, c) => s + (columnTotals[c.key] || 0), 0),
    [columnTotals],
  );
  const totalSorties = columnTotals.sorties || 0;
  const caisse = totalEntrees - totalSorties;

  const selectedEmploye = employes.find((e) => e.id === operateurId);

  /* ─── Import Excel ─── */
  const handleImportExcel = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

        if (rows.length < 2) {
          toast.error('Le fichier est vide ou ne contient pas de données');
          return;
        }

        const headers = rows[0].map((h) => String(h || '').toLowerCase().trim());
        const colMap = {};

        COLUMNS.forEach((col) => {
          const idx = headers.findIndex((h) => {
            const hN = h.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const lN = col.label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const kN = col.key.replace(/_/g, ' ');
            return h === col.key || hN.includes(lN) || h.includes(kN);
          });
          if (idx >= 0) colMap[col.key] = idx;
        });

        if (Object.keys(colMap).length === 0) {
          let start = 0;
          if (rows.length > 1 && typeof rows[1][0] === 'number' && rows[1][0] <= rows.length) {
            start = 1;
          }
          COLUMNS.forEach((col, i) => { colMap[col.key] = start + i; });
        }

        const dataRows = rows.slice(1);
        const newLignes = Array.from({ length: NB_ROWS }, () => emptyRow());
        let count = 0;

        dataRows.forEach((row, i) => {
          if (i >= NB_ROWS) return;
          COLUMNS.forEach((col) => {
            const ci = colMap[col.key];
            if (ci === undefined || ci >= row.length) return;
            const v = row[ci];
            if (col.type === 'number') {
              newLignes[i][col.key] = Math.max(0, parseInt(String(v || 0).replace(/\s/g, ''), 10) || 0);
            } else {
              newLignes[i][col.key] = String(v || '');
            }
          });
          const hasData = COLUMNS.some((c) =>
            c.type === 'number' ? newLignes[i][c.key] > 0 : (newLignes[i][c.key] || '').trim() !== '',
          );
          if (hasData) count++;
        });

        setLignes(newLignes);
        setValidationErrors({});
        toast.success(`${count} ligne(s) importées depuis Excel`);
      } catch (err) {
        console.error('Import error:', err);
        toast.error("Erreur lors de l'import du fichier Excel");
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  /* ─── Print PDF ─── */
  const handlePrintPDF = () => {
    exportRapportTableur({
      date,
      operateur_nom: selectedEmploye
        ? `${selectedEmploye.prenom} ${selectedEmploye.nom}`
        : '',
      lignes,
      columnTotals,
      totalEntrees,
      totalSorties,
      caisse,
    });
  };

  /* ─── Validation inline ─── */
  const validate = () => {
    const errors = {};
    let hasData = false;

    lignes.forEach((row, i) => {
      const hasNumeric = NUM_COLS.some((c) => (row[c.key] || 0) > 0);
      const hasDesc = (row.description || '').trim() !== '';
      if (hasNumeric || hasDesc) hasData = true;

      if ((row.sorties || 0) > 0 && !hasDesc) {
        errors[`${i}-description`] = 'Description requise pour les sorties';
      }
    });

    if (!hasData) {
      errors._global = 'Au moins une ligne doit contenir des données';
    }
    return errors;
  };

  /* ─── Save with validation + history ─── */
  const handleSubmit = async (statut) => {
    if (!date) { toast.error('Veuillez sélectionner une date'); return; }
    if (!operateurId) { toast.error('Veuillez sélectionner un opérateur'); return; }

    if (statut === 'soumis') {
      const errors = validate();
      if (Object.keys(errors).length > 0) {
        setValidationErrors(errors);
        toast.error(errors._global || 'Corrigez les erreurs surlignées avant de soumettre');
        return;
      }
    }
    setValidationErrors({});

    setSaving(true);
    try {
      const categories = {};
      RECETTE_COLS.forEach((c) => { categories[c.key] = columnTotals[c.key] || 0; });

      const depenses = lignes
        .filter((row) => row.sorties > 0)
        .map((row) => ({
          description: row.description || 'Sortie',
          montant: row.sorties,
        }));

      const savedLignes = lignes.map((row) => {
        const hasData = COLUMNS.some((c) =>
          c.type === 'number' ? (row[c.key] || 0) > 0 : (row[c.key] || '').trim() !== '',
        );
        return hasData ? row : null;
      }).filter(Boolean);

      let historique = rapport?.historique ? [...rapport.historique] : [];
      if (rapport && initialLignesRef.current) {
        const changes = [];
        const init = initialLignesRef.current;
        lignes.forEach((row, ri) => {
          COLUMNS.forEach((col) => {
            const ov = col.type === 'number' ? (init[ri]?.[col.key] || 0) : (init[ri]?.[col.key] || '');
            const nv = col.type === 'number' ? (row[col.key] || 0) : (row[col.key] || '');
            if (ov !== nv) {
              changes.push({
                ligne: ri + 1,
                colonne: col.label,
                ancien: ov,
                nouveau: nv,
              });
            }
          });
        });
        if (changes.length > 0) {
          historique.push({
            timestamp: new Date().toISOString(),
            utilisateur: selectedEmploye
              ? `${selectedEmploye.prenom} ${selectedEmploye.nom}`
              : 'Inconnu',
            nb_modifications: changes.length,
            details: changes.slice(0, 50),
          });
        }
      }

      await onSave({
        date,
        operateur_id: operateurId,
        operateur_nom: selectedEmploye
          ? `${selectedEmploye.prenom} ${selectedEmploye.nom}`
          : '',
        statut,
        categories,
        depenses,
        lignes: savedLignes,
        historique,
      });
    } finally {
      setSaving(false);
    }
  };

  const nbErrors = Object.keys(validationErrors).filter((k) => k !== '_global').length;

  /* ═══════════════════════════════════════════════════════════════
   *  STRUCTURE DU LAYOUT :
   *
   *  ┌─ FIXED (shrink-0): Banner
   *  ├─ FIXED (shrink-0): Header (date, opérateur, total caisse)
   *  ├─ FIXED (shrink-0): Toolbar (import, print, historique)
   *  ├─ FIXED (shrink-0): Historique panel (si ouvert)
   *  │
   *  ├─ SCROLLABLE (flex-1, min-h-0, overflow-auto):
   *  │    ├─ Grille 30×10 (table, minWidth 1100px)
   *  │    ├─ Barre totaux (entrées / sorties / caisse)
   *  │    └─ Résumé journée (3 cards)
   *  │
   *  └─ FIXED (shrink-0): Footer actions (annuler, brouillon, soumettre)
   *
   * ═══════════════════════════════════════════════════════════════ */

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* ───────── FIXED: Banner ───────── */}
      <div className="shrink-0 bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-700 px-6 py-3 text-white">
        <h2 className="text-center text-base font-bold tracking-wide">
          Rapport journalier : {formatDate(date)}
        </h2>
      </div>

      {/* ───────── FIXED: Header fields ───────── */}
      <div className="shrink-0 border-b bg-slate-50 px-6 py-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Date *</label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="bg-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Opérateur *</label>
            <Select value={operateurId} onValueChange={setOperateurId}>
              <SelectTrigger className="bg-white">
                <SelectValue placeholder="Choisir l'opérateur..." />
              </SelectTrigger>
              <SelectContent>
                {employes.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.prenom} {e.nom}{e.poste ? ` — ${e.poste}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-600">
              Total Caisse (auto)
            </p>
            <p className={`text-xl font-black tabular-nums ${caisse >= 0 ? 'text-blue-800' : 'text-red-600'}`}>
              {fmt(caisse)} FCFA
            </p>
          </div>
        </div>
      </div>

      {/* ───────── FIXED: Toolbar ───────── */}
      <div className="shrink-0 flex items-center gap-2 border-b bg-white px-6 py-1.5">
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={handleImportExcel}
        />
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs h-7"
          onClick={() => fileInputRef.current?.click()}
        >
          <FileUp className="h-3.5 w-3.5" /> Import Excel
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs h-7"
          onClick={handlePrintPDF}
        >
          <Printer className="h-3.5 w-3.5" /> Imprimer PDF
        </Button>
        {rapport?.historique?.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs h-7 ml-auto"
            onClick={() => setShowHistorique(!showHistorique)}
          >
            <Clock className="h-3.5 w-3.5" />
            Historique ({rapport.historique.length})
          </Button>
        )}
        {nbErrors > 0 && (
          <div className="ml-auto flex items-center gap-1 text-xs text-red-600">
            <AlertTriangle className="h-3.5 w-3.5" />
            {nbErrors} erreur(s)
          </div>
        )}
      </div>

      {/* ───────── FIXED: Historique panel (collapsible) ───────── */}
      {showHistorique && rapport?.historique?.length > 0 && (
        <div className="shrink-0 border-b bg-amber-50 px-6 py-2 max-h-[150px] overflow-y-auto">
          <h4 className="text-xs font-bold text-amber-800 mb-1.5">Historique des modifications</h4>
          {rapport.historique.slice().reverse().map((entry, i) => (
            <div key={i} className="mb-2 last:mb-0">
              <div className="flex items-center gap-2 text-[10px] text-amber-700">
                <Clock className="h-3 w-3 shrink-0" />
                <span className="font-semibold">
                  {new Date(entry.timestamp).toLocaleString('fr-FR')}
                </span>
                <span>— {entry.utilisateur}</span>
                <span className="text-amber-500">({entry.nb_modifications} modif.)</span>
              </div>
              <div className="ml-5 mt-0.5 text-[10px] text-amber-600 space-y-0.5">
                {entry.details?.slice(0, 10).map((ch, j) => (
                  <div key={j}>
                    L{ch.ligne} {ch.colonne}:{' '}
                    <span className="line-through text-red-500">{ch.ancien || '—'}</span>
                    {' → '}
                    <span className="font-medium text-emerald-700">{ch.nouveau || '—'}</span>
                  </div>
                ))}
                {entry.details?.length > 10 && (
                  <div className="text-amber-400 italic">…et {entry.details.length - 10} autre(s)</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
       *  SCROLLABLE : Grille + Totaux + Résumé
       *
       *  C'est ici que le scroll vertical ET horizontal se produit.
       *  flex-1  = prend tout l'espace restant
       *  min-h-0 = CRITIQUE : permet à flex-1 de shrink sous le
       *            contenu naturel (sinon le navigateur refuse de
       *            créer un scroll et le contenu déborde)
       * ═══════════════════════════════════════════════════════════ */}
      <div className="flex-1 min-h-0 overflow-auto" ref={scrollRef}>

        {/* ─── Grille tableur ─── */}
        <table className="w-full border-collapse text-sm" style={{ minWidth: '1100px' }}>
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="bg-blue-600 text-white px-2 py-2 text-center text-[11px] font-bold uppercase tracking-wider border border-blue-700 w-12">
                #
              </th>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={`px-2 py-2 text-center text-[11px] font-bold uppercase tracking-wider border ${
                    col.isSortie
                      ? 'bg-red-600 text-white border-red-700'
                      : 'bg-blue-600 text-white border-blue-700'
                  }`}
                  style={{ minWidth: col.type === 'text' ? '160px' : '100px' }}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lignes.map((row, rowIdx) => (
              <tr
                key={rowIdx}
                className={`${rowIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50'} hover:bg-blue-50/50 transition-colors`}
              >
                <td className="px-2 py-0 text-center text-xs font-semibold text-slate-400 border border-slate-200 bg-slate-100">
                  {rowIdx + 1}
                </td>
                {COLUMNS.map((col, colIdx) => {
                  const errKey = `${rowIdx}-${col.key}`;
                  const hasError = !!validationErrors[errKey];
                  return (
                    <td
                      key={col.key}
                      className={`px-0 py-0 border ${
                        hasError
                          ? 'border-red-400 bg-red-50'
                          : col.isSortie
                            ? 'border-red-200 bg-red-50/30'
                            : 'border-slate-200'
                      }`}
                      title={hasError ? validationErrors[errKey] : undefined}
                    >
                      <input
                        id={`cell-${rowIdx}-${colIdx}`}
                        type="text"
                        inputMode={col.type === 'number' ? 'numeric' : 'text'}
                        className={`w-full border-0 bg-transparent px-2 py-1.5 text-xs outline-none focus:bg-blue-100 focus:ring-2 focus:ring-inset focus:ring-blue-400 tabular-nums ${
                          col.type === 'number' ? 'text-right font-medium' : 'text-left'
                        } ${col.isSortie ? 'text-red-700 font-semibold' : ''} ${
                          hasError ? 'text-red-600 placeholder:text-red-400' : ''
                        }`}
                        placeholder={hasError ? '⚠ Requis' : ''}
                        value={
                          col.type === 'number'
                            ? row[col.key] === 0 ? '0' : String(row[col.key] || 0)
                            : row[col.key] || ''
                        }
                        onChange={(e) => updateCell(rowIdx, col.key, e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, rowIdx, colIdx)}
                        onFocus={(e) => {
                          if (col.type === 'number' && e.target.value === '0') {
                            e.target.select();
                          }
                        }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}

            {/* ─── TOTAL Row (sticky au bas de la zone visible) ─── */}
            <tr className="bg-slate-200 font-bold border-t-2 border-slate-400 sticky bottom-0 z-[5]">
              <td className="px-2 py-2 text-center text-xs font-black text-slate-700 border border-slate-300 bg-slate-300">
                TOTAL
              </td>
              {COLUMNS.map((col) => (
                <td
                  key={col.key}
                  className={`px-2 py-2 text-xs border border-slate-300 ${
                    col.type === 'number' ? 'text-right tabular-nums' : ''
                  } ${col.isSortie ? 'bg-red-100 text-red-700' : 'bg-slate-200'}`}
                >
                  {col.type === 'number' ? (
                    <span className="font-black">
                      {fmt(columnTotals[col.key])} F
                    </span>
                  ) : null}
                </td>
              ))}
            </tr>
          </tbody>
        </table>

        {/* ─── Barre totaux (dans la zone scrollable, après la grille) ─── */}
        <div className="border-t bg-slate-50 px-6 py-2" style={{ minWidth: '1100px' }}>
          <div className="flex flex-wrap items-center justify-between gap-4 text-sm">
            <div>
              <span className="text-slate-500">Total entrées: </span>
              <span className="font-bold text-emerald-600">{fmt(totalEntrees)} XAF</span>
            </div>
            <div>
              <span className="text-slate-500">Total sorties: </span>
              <span className="font-bold text-red-600">{fmt(totalSorties)} XAF</span>
            </div>
            <div className="text-right">
              <span className="text-slate-500">Caisse journée </span>
              <span className={`text-xl font-black ${caisse >= 0 ? 'text-blue-700' : 'text-red-600'}`}>
                {fmt(caisse)} XAF
              </span>
            </div>
          </div>
        </div>

        {/* ─── Résumé de la journée (dans la zone scrollable) ─── */}
        <div className="border-t bg-white px-6 py-3">
          <h3 className="mb-2 text-sm font-bold text-slate-700">Résumé de la journée</h3>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border bg-slate-50 p-2.5 text-center">
              <p className="text-[10px] font-medium text-slate-500">Total Recettes</p>
              <p className="text-lg font-black text-emerald-600">{fmt(totalEntrees)} F</p>
            </div>
            <div className="rounded-lg border bg-slate-50 p-2.5 text-center">
              <p className="text-[10px] font-medium text-slate-500">Total Dépenses</p>
              <p className="text-lg font-black text-red-600">{fmt(totalSorties)} F</p>
            </div>
            <div className="rounded-lg border bg-slate-50 p-2.5 text-center">
              <p className="text-[10px] font-medium text-slate-500">Total Caisse</p>
              <p className={`text-lg font-black ${caisse >= 0 ? 'text-blue-700' : 'text-red-600'}`}>
                {fmt(caisse)} F
              </p>
            </div>
          </div>
        </div>

      </div>
      {/* ═══ FIN ZONE SCROLLABLE ═══ */}

      {/* ───────── FIXED: Footer actions (toujours visible) ───────── */}
      <div className="shrink-0 flex items-center justify-end gap-3 border-t bg-white px-6 py-2.5 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving} className="gap-2">
          <X className="h-4 w-4" /> Annuler
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleSubmit('brouillon')}
          disabled={saving}
          className="gap-2"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Enregistrer brouillon
        </Button>
        <Button
          size="sm"
          onClick={() => handleSubmit('soumis')}
          disabled={saving}
          className="gap-2 bg-blue-600 hover:bg-blue-700"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Soumettre
        </Button>
      </div>
    </div>
  );
}
