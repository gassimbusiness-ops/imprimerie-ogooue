import { useState, useEffect } from 'react';
import { db } from '@/services/db';
import { useAuth } from '@/services/auth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Plus, FileSpreadsheet, Calendar, Eye, Edit, Lock, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import RapportForm from './components/rapport-form';
import RapportDetail from './components/rapport-detail';

const STATUS_MAP = {
  brouillon: { label: 'Brouillon', class: 'bg-orange-100 text-orange-700 border-orange-200' },
  soumis: { label: 'Soumis', class: 'bg-blue-100 text-blue-700 border-blue-200' },
  valide: { label: 'Validé', class: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
};

function formatFCFA(n) {
  return new Intl.NumberFormat('fr-FR').format(n || 0);
}

function totalRecettes(r) {
  return Object.values(r.categories || {}).reduce((s, v) => s + (v || 0), 0);
}

function totalDepenses(r) {
  return (r.depenses || []).reduce((s, d) => s + (d.montant || 0), 0);
}

export default function Rapports() {
  const { user, isAdmin, isManager } = useAuth();
  const isEmploye = user?.role === 'employe';
  const [rapports, setRapports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);

  const load = async () => {
    setLoading(true);
    let data = await db.rapports.list();
    // Employés : uniquement les rapports du jour
    if (isEmploye) {
      const today = new Date().toISOString().split('T')[0];
      data = data.filter((r) => r.date === today);
    }
    setRapports(data.sort((a, b) => b.date.localeCompare(a.date)));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleNew = () => {
    setEditing(null);
    setShowForm(true);
  };

  const handleEdit = (r) => {
    setEditing(r);
    setShowForm(true);
  };

  const handleSave = async (data) => {
    if (editing) {
      await db.rapports.update(editing.id, data);
      toast.success('Rapport mis à jour');
    } else {
      await db.rapports.create(data);
      toast.success('Rapport créé');
    }
    setShowForm(false);
    setEditing(null);
    load();
  };

  const handleDelete = async (id) => {
    await db.rapports.delete(id);
    toast.success('Rapport supprimé');
    load();
  };

  const formatDate = (d) => {
    return new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', {
      weekday: 'short',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Rapports journaliers</h2>
          <p className="text-muted-foreground">
            Saisissez et suivez les recettes quotidiennes de l'imprimerie
          </p>
        </div>
        <Button onClick={handleNew} size="lg" className="gap-2">
          <Plus className="h-4 w-4" />
          Nouveau rapport
        </Button>
      </div>

      {/* Stats résumé — masqué pour les employés */}
      {!loading && rapports.length > 0 && !isEmploye && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <MiniStat
            label="Aujourd'hui"
            value={formatFCFA(
              rapports
                .filter((r) => r.date === new Date().toISOString().split('T')[0])
                .reduce((s, r) => s + totalRecettes(r) - totalDepenses(r), 0),
            )}
            suffix="F"
            color="text-primary"
          />
          <MiniStat
            label="Cette semaine"
            value={formatFCFA(
              rapports
                .filter((r) => {
                  const d = new Date(r.date);
                  const now = new Date();
                  const weekStart = new Date(now);
                  weekStart.setDate(now.getDate() - now.getDay() + 1);
                  return d >= weekStart;
                })
                .reduce((s, r) => s + totalRecettes(r), 0),
            )}
            suffix="F"
            color="text-emerald-600"
          />
          <MiniStat
            label="Rapports"
            value={rapports.length}
            color="text-foreground"
          />
          <MiniStat
            label="À valider"
            value={rapports.filter((r) => r.statut === 'soumis').length}
            color="text-blue-600"
          />
        </div>
      )}

      {/* Liste */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : rapports.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <FileSpreadsheet className="mb-4 h-12 w-12 text-muted-foreground/30" />
            <p className="text-muted-foreground">Aucun rapport pour l'instant</p>
            <Button onClick={handleNew} variant="outline" className="mt-4">
              Créer le premier rapport
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rapports.map((r) => {
            const rec = totalRecettes(r);
            const dep = totalDepenses(r);
            const solde = rec - dep;
            const status = STATUS_MAP[r.statut] || STATUS_MAP.brouillon;

            return (
              <Card
                key={r.id}
                className="group transition-shadow hover:shadow-md"
              >
                <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-4">
                    <div className="hidden h-11 w-11 items-center justify-center rounded-xl bg-primary/10 sm:flex">
                      <FileSpreadsheet className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold">{formatDate(r.date)}</p>
                        <Badge variant="outline" className={status.class}>
                          {status.label}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        <Calendar className="mr-1 inline h-3 w-3" />
                        {r.operateur_nom || 'Non assigné'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-6">
                    {!isEmploye && (
                      <>
                        <div className="hidden text-right sm:block">
                          <p className="text-xs text-muted-foreground">Recettes</p>
                          <p className="font-semibold text-emerald-600">
                            {formatFCFA(rec)} F
                          </p>
                        </div>
                        <div className="hidden text-right sm:block">
                          <p className="text-xs text-muted-foreground">Dépenses</p>
                          <p className="font-semibold text-destructive">
                            {formatFCFA(dep)} F
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">Solde</p>
                          <p className={`text-lg font-bold ${solde >= 0 ? 'text-primary' : 'text-destructive'}`}>
                            {formatFCFA(solde)} F
                          </p>
                        </div>
                      </>
                    )}
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" onClick={() => setViewing(r)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                      {r.statut !== 'valide' && (
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(r)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                      )}
                      {r.statut === 'brouillon' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive"
                          onClick={() => handleDelete(r.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Form dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto p-0">
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle>
              {editing ? 'Modifier le rapport' : 'Nouveau rapport journalier'}
            </DialogTitle>
          </DialogHeader>
          <RapportForm
            rapport={editing}
            onSave={handleSave}
            onCancel={() => setShowForm(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
      <Dialog open={!!viewing} onOpenChange={() => setViewing(null)}>
        <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Détail du rapport</DialogTitle>
          </DialogHeader>
          {viewing && <RapportDetail rapport={viewing} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MiniStat({ label, value, suffix, color }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className={`mt-1 text-xl font-bold ${color}`}>
          {value} {suffix}
        </p>
      </CardContent>
    </Card>
  );
}
