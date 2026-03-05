import { Badge } from '@/components/ui/badge';
import {
  Copy,
  ShoppingBag,
  ScanLine,
  Keyboard,
  CreditCard,
  Camera,
  Wrench,
  Printer,
} from 'lucide-react';

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

function fmt(n) {
  return new Intl.NumberFormat('fr-FR').format(n || 0);
}

export default function RapportDetail({ rapport }) {
  const totalRec = Object.values(rapport.categories || {}).reduce((s, v) => s + (v || 0), 0);
  const totalDep = (rapport.depenses || []).reduce((s, d) => s + (d.montant || 0), 0);
  const solde = totalRec - totalDep;

  const STATUS_MAP = {
    brouillon: { label: 'Brouillon', class: 'bg-orange-100 text-orange-700' },
    soumis: { label: 'Soumis', class: 'bg-blue-100 text-blue-700' },
    valide: { label: 'Validé', class: 'bg-emerald-100 text-emerald-700' },
  };
  const status = STATUS_MAP[rapport.statut] || STATUS_MAP.brouillon;

  const formatDate = (d) =>
    new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

  return (
    <div className="space-y-6">
      {/* Meta */}
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="outline" className={status.class}>{status.label}</Badge>
        <span className="text-sm text-muted-foreground">{formatDate(rapport.date)}</span>
        <span className="text-sm text-muted-foreground">— {rapport.operateur_nom}</span>
      </div>

      {/* Solde */}
      <div className="rounded-xl bg-primary/5 p-4 text-center">
        <p className="text-sm font-medium text-muted-foreground">Solde de la journée</p>
        <p className={`text-3xl font-bold ${solde >= 0 ? 'text-primary' : 'text-destructive'}`}>
          {fmt(solde)} FCFA
        </p>
      </div>

      {/* Catégories */}
      <div>
        <h4 className="mb-3 text-sm font-semibold">Recettes par catégorie</h4>
        <div className="grid grid-cols-2 gap-2">
          {CATEGORIES.filter((c) => (rapport.categories?.[c.key] || 0) > 0).map((cat) => {
            const Icon = cat.icon;
            const val = rapport.categories[cat.key];
            return (
              <div key={cat.key} className="flex items-center gap-3 rounded-lg border p-3">
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${cat.color}`}>
                  <Icon className="h-4 w-4 text-white" />
                </div>
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">{cat.label}</p>
                  <p className="font-semibold text-emerald-600">{fmt(val)} F</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Dépenses */}
      {rapport.depenses?.length > 0 && (
        <div>
          <h4 className="mb-3 text-sm font-semibold">Dépenses</h4>
          <div className="space-y-2">
            {rapport.depenses.map((d, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg border p-3">
                <span className="text-sm">{d.description || 'Dépense'}</span>
                <span className="font-semibold text-destructive">{fmt(d.montant)} F</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Totaux */}
      <div className="rounded-xl bg-muted/50 p-4 space-y-1">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Total recettes</span>
          <span className="font-semibold text-emerald-600">{fmt(totalRec)} F</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Total dépenses</span>
          <span className="font-semibold text-destructive">{fmt(totalDep)} F</span>
        </div>
      </div>
    </div>
  );
}
