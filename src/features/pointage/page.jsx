import { useState, useEffect, useMemo } from 'react';
import { db } from '@/services/db';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Clock,
  LogIn,
  LogOut,
  Calendar,
  Users,
  ChevronLeft,
  ChevronRight,
  UserCheck,
  UserX,
  Timer,
} from 'lucide-react';
import { toast } from 'sonner';

function pad(n) {
  return String(n).padStart(2, '0');
}

function timeToMinutes(t) {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToHM(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h${pad(m)}`;
}

function getWeekDates(offset = 0) {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1) + offset * 7);
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    dates.push(d.toISOString().split('T')[0]);
  }
  return dates;
}

const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

export default function Pointage() {
  const [pointages, setPointages] = useState([]);
  const [employes, setEmployes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);
  const [showPointageDialog, setShowPointageDialog] = useState(false);
  const [selectedEmploye, setSelectedEmploye] = useState('');
  const [pointageType, setPointageType] = useState('arrivee');

  const load = async () => {
    const [p, e] = await Promise.all([
      db.pointages.list(),
      db.employes.list(),
    ]);
    setPointages(p);
    setEmployes(e.filter((emp) => emp.role !== 'admin' && emp.role !== 'client'));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const weekDates = useMemo(() => getWeekDates(weekOffset), [weekOffset]);
  const today = new Date().toISOString().split('T')[0];
  const weekStart = weekDates[0];
  const weekEnd = weekDates[6];

  const weekLabel = useMemo(() => {
    const s = new Date(weekDates[0] + 'T00:00:00');
    const e = new Date(weekDates[6] + 'T00:00:00');
    return `${s.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} — ${e.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }, [weekDates]);

  // Build a map: employeId -> date -> pointage
  const pointageMap = useMemo(() => {
    const map = {};
    for (const p of pointages) {
      const key = `${p.employe_id}_${p.date}`;
      map[key] = p;
    }
    return map;
  }, [pointages]);

  // Today's summary
  const todayStats = useMemo(() => {
    const todayP = pointages.filter((p) => p.date === today);
    const arrived = todayP.filter((p) => p.heure_arrivee);
    const departed = todayP.filter((p) => p.heure_depart);
    return {
      presents: arrived.length,
      total: employes.length,
      departed: departed.length,
    };
  }, [pointages, employes, today]);

  const handleQuickPointage = async () => {
    if (!selectedEmploye) {
      toast.error('Sélectionnez un employé');
      return;
    }

    const now = new Date();
    const heure = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const emp = employes.find((e) => e.id === selectedEmploye);
    const existing = pointages.find((p) => p.employe_id === selectedEmploye && p.date === today);

    if (pointageType === 'arrivee') {
      if (existing?.heure_arrivee) {
        toast.error(`${emp.prenom} a déjà pointé son arrivée`);
        return;
      }
      if (existing) {
        await db.pointages.update(existing.id, { heure_arrivee: heure, statut: 'present' });
      } else {
        await db.pointages.create({
          employe_id: selectedEmploye,
          employe_nom: `${emp.prenom} ${emp.nom}`,
          date: today,
          heure_arrivee: heure,
          heure_depart: null,
          statut: 'present',
        });
      }
      toast.success(`Arrivée de ${emp.prenom} enregistrée à ${heure}`);
    } else {
      if (!existing?.heure_arrivee) {
        toast.error(`${emp.prenom} n'a pas encore pointé son arrivée`);
        return;
      }
      if (existing.heure_depart) {
        toast.error(`${emp.prenom} a déjà pointé son départ`);
        return;
      }
      await db.pointages.update(existing.id, { heure_depart: heure });
      toast.success(`Départ de ${emp.prenom} enregistré à ${heure}`);
    }

    setShowPointageDialog(false);
    setSelectedEmploye('');
    load();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Pointage</h2>
          <p className="text-muted-foreground">Suivi des heures de travail</p>
        </div>
        <Button size="lg" className="gap-2" onClick={() => setShowPointageDialog(true)}>
          <Clock className="h-4 w-4" /> Pointer
        </Button>
      </div>

      {/* Today summary */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
              <UserCheck className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Présents</p>
              <p className="text-xl font-bold">{todayStats.presents}/{todayStats.total}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10">
              <LogOut className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Partis</p>
              <p className="text-xl font-bold">{todayStats.departed}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10">
              <UserX className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Absents</p>
              <p className="text-xl font-bold">{todayStats.total - todayStats.presents}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Week navigation */}
      <div className="flex items-center justify-between">
        <Button variant="outline" size="icon" onClick={() => setWeekOffset((o) => o - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium">{weekLabel}</span>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setWeekOffset((o) => Math.min(o + 1, 0))}
          disabled={weekOffset >= 0}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Weekly grid */}
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b">
                <th className="p-3 text-left font-medium text-muted-foreground">Employé</th>
                {weekDates.map((d, i) => {
                  const isToday = d === today;
                  const dayDate = new Date(d + 'T00:00:00');
                  return (
                    <th key={d} className={`p-3 text-center font-medium ${isToday ? 'bg-primary/5 text-primary' : 'text-muted-foreground'}`}>
                      <div>{JOURS[i]}</div>
                      <div className="text-xs">{dayDate.getDate()}</div>
                    </th>
                  );
                })}
                <th className="p-3 text-center font-medium text-muted-foreground">Total</th>
              </tr>
            </thead>
            <tbody>
              {employes.map((emp) => {
                let weekTotal = 0;
                return (
                  <tr key={emp.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white">
                          {emp.prenom?.[0]}{emp.nom?.[0]}
                        </div>
                        <span className="font-medium">{emp.prenom} {emp.nom?.[0]}.</span>
                      </div>
                    </td>
                    {weekDates.map((d, i) => {
                      const p = pointageMap[`${emp.id}_${d}`];
                      const isToday = d === today;
                      const isFuture = d > today;
                      let worked = 0;
                      if (p?.heure_arrivee && p?.heure_depart) {
                        worked = timeToMinutes(p.heure_depart) - timeToMinutes(p.heure_arrivee);
                        weekTotal += worked;
                      }
                      return (
                        <td key={d} className={`p-2 text-center ${isToday ? 'bg-primary/5' : ''}`}>
                          {isFuture ? (
                            <span className="text-xs text-muted-foreground/30">—</span>
                          ) : p?.heure_arrivee ? (
                            <div>
                              <div className="text-[10px] text-emerald-600 font-medium">
                                {p.heure_arrivee}
                              </div>
                              {p.heure_depart ? (
                                <div className="text-[10px] text-blue-600 font-medium">
                                  {p.heure_depart}
                                </div>
                              ) : (
                                <Badge variant="outline" className="mt-0.5 border-emerald-200 text-[9px] text-emerald-600">
                                  En cours
                                </Badge>
                              )}
                              {worked > 0 && (
                                <div className="mt-0.5 text-[10px] font-semibold text-foreground">
                                  {minutesToHM(worked)}
                                </div>
                              )}
                            </div>
                          ) : d <= today ? (
                            <Badge variant="outline" className="border-red-200 text-[9px] text-red-400">
                              Absent
                            </Badge>
                          ) : null}
                        </td>
                      );
                    })}
                    <td className="p-3 text-center">
                      <span className="font-bold text-primary">{minutesToHM(weekTotal)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Quick pointage dialog */}
      <Dialog open={showPointageDialog} onOpenChange={setShowPointageDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Enregistrer un pointage</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant={pointageType === 'arrivee' ? 'default' : 'outline'}
                onClick={() => setPointageType('arrivee')}
                className="gap-2"
              >
                <LogIn className="h-4 w-4" /> Arrivée
              </Button>
              <Button
                variant={pointageType === 'depart' ? 'default' : 'outline'}
                onClick={() => setPointageType('depart')}
                className="gap-2"
              >
                <LogOut className="h-4 w-4" /> Départ
              </Button>
            </div>

            <Select value={selectedEmploye} onValueChange={setSelectedEmploye}>
              <SelectTrigger>
                <SelectValue placeholder="Sélectionner un employé..." />
              </SelectTrigger>
              <SelectContent>
                {employes.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.prenom} {e.nom} — {e.poste}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="rounded-lg bg-muted/50 p-4 text-center">
              <p className="text-xs text-muted-foreground">Heure actuelle</p>
              <p className="text-3xl font-bold tabular-nums text-primary">
                {new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
              </p>
              <p className="text-xs text-muted-foreground">
                {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
              </p>
            </div>

            <Button className="w-full gap-2" size="lg" onClick={handleQuickPointage}>
              <Clock className="h-4 w-4" />
              Enregistrer le pointage
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
