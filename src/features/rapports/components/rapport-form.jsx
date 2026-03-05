import { useState, useEffect } from 'react';
import { db } from '@/services/db';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Copy,
  ShoppingBag,
  ScanLine,
  Keyboard,
  CreditCard,
  Camera,
  Wrench,
  Printer,
  Plus,
  X,
  Save,
  Send,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';

const CATEGORIES = [
  { key: 'copies', label: 'Copies', icon: Copy, color: 'bg-blue-500' },
  { key: 'marchandises', label: 'Marchandises', icon: ShoppingBag, color: 'bg-purple-500' },
  { key: 'scan', label: 'Scan', icon: ScanLine, color: 'bg-teal-500' },
  { key: 'tirage_saisies', label: 'Tirage & Saisies', icon: Keyboard, color: 'bg-orange-500' },
  { key: 'badges_plastification', label: 'Badges & Plastif.', icon: CreditCard, color: 'bg-pink-500' },
  { key: 'demi_photos', label: 'Demi-Photos', icon: Camera, color: 'bg-cyan-500' },
  { key: 'maintenance', label: 'Maintenance', icon: Wrench, color: 'bg-slate-500' },
  { key: 'imprimerie', label: 'Imprimerie', icon: Printer, color: 'bg-indigo-500' },
];

function formatFCFA(n) {
  return new Intl.NumberFormat('fr-FR').format(n || 0);
}

export default function RapportForm({ rapport, onSave, onCancel }) {
  const [employes, setEmployes] = useState([]);
  const [saving, setSaving] = useState(false);

  const [date, setDate] = useState(
    rapport?.date || new Date().toISOString().split('T')[0],
  );
  const [operateurId, setOperateurId] = useState(rapport?.operateur_id || '');
  const [categories, setCategories] = useState(
    rapport?.categories || CATEGORIES.reduce((acc, c) => ({ ...acc, [c.key]: 0 }), {}),
  );
  const [depenses, setDepenses] = useState(rapport?.depenses || []);

  useEffect(() => {
    db.employes.list().then(setEmployes);
  }, []);

  const updateCategory = (key, value) => {
    const num = value === '' ? 0 : parseInt(value.replace(/\s/g, ''), 10) || 0;
    setCategories((prev) => ({ ...prev, [key]: Math.max(0, num) }));
  };

  const addDepense = () => {
    setDepenses((prev) => [...prev, { description: '', montant: 0 }]);
  };

  const updateDepense = (index, field, value) => {
    setDepenses((prev) => {
      const copy = [...prev];
      if (field === 'montant') {
        copy[index].montant = parseInt(value.replace(/\s/g, ''), 10) || 0;
      } else {
        copy[index][field] = value;
      }
      return copy;
    });
  };

  const removeDepense = (index) => {
    setDepenses((prev) => prev.filter((_, i) => i !== index));
  };

  const totalRec = Object.values(categories).reduce((s, v) => s + (v || 0), 0);
  const totalDep = depenses.reduce((s, d) => s + (d.montant || 0), 0);
  const solde = totalRec - totalDep;

  const selectedEmploye = employes.find((e) => e.id === operateurId);

  const handleSubmit = async (statut) => {
    if (!date) {
      toast.error('Veuillez sélectionner une date');
      return;
    }
    if (!operateurId) {
      toast.error('Veuillez sélectionner un opérateur');
      return;
    }

    setSaving(true);
    try {
      await onSave({
        date,
        operateur_id: operateurId,
        operateur_nom: selectedEmploye
          ? `${selectedEmploye.prenom} ${selectedEmploye.nom}`
          : '',
        statut,
        categories,
        depenses: depenses.filter((d) => d.description || d.montant > 0),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 px-6 pb-6">
      {/* Date + Opérateur */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Date du rapport</Label>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>Opérateur</Label>
          <Select value={operateurId} onValueChange={setOperateurId}>
            <SelectTrigger>
              <SelectValue placeholder="Choisir l'opérateur..." />
            </SelectTrigger>
            <SelectContent>
              {employes.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.prenom} {e.nom} — {e.poste}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Catégories de recettes */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-foreground">
          Recettes par catégorie
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const val = categories[cat.key] || 0;
            return (
              <div
                key={cat.key}
                className="group relative overflow-hidden rounded-xl border bg-card p-3 transition-shadow focus-within:ring-2 focus-within:ring-primary/30 hover:shadow-md"
              >
                <div className="mb-2 flex items-center gap-2">
                  <div
                    className={`flex h-7 w-7 items-center justify-center rounded-lg ${cat.color}`}
                  >
                    <Icon className="h-3.5 w-3.5 text-white" />
                  </div>
                  <span className="text-xs font-medium text-muted-foreground">
                    {cat.label}
                  </span>
                </div>
                <Input
                  type="text"
                  inputMode="numeric"
                  placeholder="0"
                  value={val === 0 ? '' : formatFCFA(val)}
                  onChange={(e) => updateCategory(cat.key, e.target.value)}
                  className="h-10 border-0 bg-muted/50 text-right text-lg font-bold tabular-nums placeholder:text-muted-foreground/30 focus-visible:ring-0"
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Dépenses */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">
            Dépenses (sorties)
          </h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addDepense}
            className="gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            Ajouter
          </Button>
        </div>

        {depenses.length === 0 ? (
          <p className="rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground">
            Aucune dépense — cliquez « Ajouter » si nécessaire
          </p>
        ) : (
          <div className="space-y-2">
            {depenses.map((dep, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  placeholder="Description..."
                  value={dep.description}
                  onChange={(e) => updateDepense(i, 'description', e.target.value)}
                  className="flex-1"
                />
                <Input
                  type="text"
                  inputMode="numeric"
                  placeholder="Montant"
                  value={dep.montant === 0 ? '' : formatFCFA(dep.montant)}
                  onChange={(e) => updateDepense(i, 'montant', e.target.value)}
                  className="w-32 text-right font-medium tabular-nums"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => removeDepense(i)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Résumé */}
      <div className="rounded-xl bg-muted/50 p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Total recettes</span>
          <span className="font-semibold text-emerald-600">
            {formatFCFA(totalRec)} F
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Total dépenses</span>
          <span className="font-semibold text-destructive">
            {formatFCFA(totalDep)} F
          </span>
        </div>
        <div className="mt-3 flex items-center justify-between border-t pt-3">
          <span className="font-medium">Solde de la journée</span>
          <span
            className={`text-2xl font-bold ${solde >= 0 ? 'text-primary' : 'text-destructive'}`}
          >
            {formatFCFA(solde)} FCFA
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3 border-t pt-4">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Annuler
        </Button>
        <Button
          variant="outline"
          onClick={() => handleSubmit('brouillon')}
          disabled={saving}
          className="gap-2"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Brouillon
        </Button>
        <Button
          onClick={() => handleSubmit('soumis')}
          disabled={saving}
          className="gap-2"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Soumettre
        </Button>
      </div>
    </div>
  );
}
