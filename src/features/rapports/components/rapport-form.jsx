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
import { X, Save, Send, Loader2, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';

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
    // Pad to NB_ROWS
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
  const tableRef = useRef(null);

  const [date, setDate] = useState(
    rapport?.date || new Date().toISOString().split('T')[0],
  );
  const [operateurId, setOperateurId] = useState(rapport?.operateur_id || '');
  const [lignes, setLignes] = useState(() => initRows(rapport?.lignes));

  useEffect(() => {
    db.employes.list().then(setEmployes);
  }, []);

  /* ─── Cell update ─── */
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

  /* ─── Save ─── */
  const handleSubmit = async (statut) => {
    if (!date) { toast.error('Veuillez sélectionner une date'); return; }
    if (!operateurId) { toast.error('Veuillez sélectionner un opérateur'); return; }

    setSaving(true);
    try {
      // Build category totals (backward compatible with page.jsx list/tableur views)
      const categories = {};
      RECETTE_COLS.forEach((c) => { categories[c.key] = columnTotals[c.key] || 0; });

      // Build depenses from sorties column lines
      const depenses = lignes
        .filter((row) => row.sorties > 0)
        .map((row) => ({
          description: row.description || 'Sortie',
          montant: row.sorties,
        }));

      // Keep non-empty lines for restoration on edit
      const savedLignes = lignes.map((row) => {
        const hasData = COLUMNS.some((c) =>
          c.type === 'number' ? (row[c.key] || 0) > 0 : (row[c.key] || '').trim() !== '',
        );
        return hasData ? row : null;
      }).filter(Boolean);

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
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* ─── Banner ─── */}
      <div className="bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-700 px-6 py-4 text-white">
        <h2 className="text-center text-lg font-bold tracking-wide">
          Rapport journalier : {formatDate(date)}
        </h2>
      </div>

      {/* ─── Header fields ─── */}
      <div className="border-b bg-slate-50 px-6 py-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
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
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-600">
              Total Caisse (Calculé automatiquement)
            </p>
            <p className={`text-2xl font-black tabular-nums ${caisse >= 0 ? 'text-blue-800' : 'text-red-600'}`}>
              {fmt(caisse)} FCFA
            </p>
            <p className="text-[10px] text-blue-500">Recettes totales − Dépenses totales</p>
          </div>
        </div>
      </div>

      {/* ─── Spreadsheet Grid ─── */}
      <div className="flex-1 overflow-auto" ref={tableRef}>
        <table className="w-full border-collapse text-sm" style={{ minWidth: '1100px' }}>
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="bg-blue-600 text-white px-2 py-2.5 text-center text-[11px] font-bold uppercase tracking-wider border border-blue-700 w-12">
                #
              </th>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={`px-2 py-2.5 text-center text-[11px] font-bold uppercase tracking-wider border ${
                    col.isSortie
                      ? 'bg-red-600 text-white border-red-700'
                      : col.type === 'text'
                        ? 'bg-blue-600 text-white border-blue-700'
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
                {COLUMNS.map((col, colIdx) => (
                  <td
                    key={col.key}
                    className={`px-0 py-0 border ${
                      col.isSortie ? 'border-red-200 bg-red-50/30' : 'border-slate-200'
                    }`}
                  >
                    <input
                      id={`cell-${rowIdx}-${colIdx}`}
                      type="text"
                      inputMode={col.type === 'number' ? 'numeric' : 'text'}
                      className={`w-full border-0 bg-transparent px-2 py-1.5 text-xs outline-none focus:bg-blue-100 focus:ring-2 focus:ring-inset focus:ring-blue-400 tabular-nums ${
                        col.type === 'number' ? 'text-right font-medium' : 'text-left'
                      } ${col.isSortie ? 'text-red-700 font-semibold' : ''}`}
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
                ))}
              </tr>
            ))}

            {/* ─── TOTAL Row ─── */}
            <tr className="bg-slate-200 font-bold border-t-2 border-slate-400 sticky bottom-0">
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
      </div>

      {/* ─── Totals bar ─── */}
      <div className="border-t bg-slate-50 px-6 py-2">
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

      {/* ─── Résumé de la journée ─── */}
      <div className="border-t bg-white px-6 py-4">
        <h3 className="mb-3 text-sm font-bold text-slate-700">Résumé de la journée</h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-lg border bg-slate-50 p-3 text-center">
            <p className="text-[10px] font-medium text-slate-500">Total Recettes</p>
            <p className="text-lg font-black text-emerald-600">{fmt(totalEntrees)} F</p>
          </div>
          <div className="rounded-lg border bg-slate-50 p-3 text-center">
            <p className="text-[10px] font-medium text-slate-500">Total Dépenses</p>
            <p className="text-lg font-black text-red-600">{fmt(totalSorties)} F</p>
          </div>
          <div className="rounded-lg border bg-slate-50 p-3 text-center">
            <p className="text-[10px] font-medium text-slate-500">Total Caisse</p>
            <p className={`text-lg font-black ${caisse >= 0 ? 'text-blue-700' : 'text-red-600'}`}>
              {fmt(caisse)} F
            </p>
          </div>
        </div>
      </div>

      {/* ─── Actions ─── */}
      <div className="flex items-center justify-end gap-3 border-t bg-white px-6 py-3">
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
