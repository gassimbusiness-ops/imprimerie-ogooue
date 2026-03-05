import { useState, useEffect, useMemo } from 'react';
import { db } from '@/services/db';
import { ACTION_LABELS, MODULE_LABELS } from '@/services/audit';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Shield,
  Search,
  Clock,
  User,
  FileText,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Edit2,
  Plus,
  Trash2,
} from 'lucide-react';

const ACTION_ICONS = {
  create: Plus,
  update: Edit2,
  delete: Trash2,
  cancel: XCircle,
  cloture: CheckCircle2,
  login: User,
  logout: User,
};

export default function AuditLog() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterAction, setFilterAction] = useState('all');
  const [filterModule, setFilterModule] = useState('all');
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    db.audit_logs.list().then((data) => {
      setLogs(data.sort((a, b) => (b.timestamp || b.created_at || '').localeCompare(a.timestamp || a.created_at || '')));
      setLoading(false);
    });
  }, []);

  const filtered = useMemo(() => {
    return logs.filter((log) => {
      if (filterAction !== 'all' && log.action !== filterAction) return false;
      if (filterModule !== 'all' && log.module !== filterModule) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          (log.user_nom || '').toLowerCase().includes(q) ||
          (log.details || '').toLowerCase().includes(q) ||
          (log.entity_label || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [logs, search, filterAction, filterModule]);

  // Stats
  const stats = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const todayLogs = logs.filter((l) => (l.timestamp || l.created_at || '').startsWith(today));
    const cancellations = logs.filter((l) => l.action === 'cancel');
    const uniqueUsers = new Set(logs.map((l) => l.user_id)).size;
    return { total: logs.length, today: todayLogs.length, cancellations: cancellations.length, uniqueUsers };
  }, [logs]);

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
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Journal d'Audit</h2>
        <p className="text-muted-foreground">Traçabilité de toutes les opérations — Anti-fraude</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10">
                <FileText className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total événements</p>
                <p className="text-lg font-bold">{stats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
                <Clock className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Aujourd'hui</p>
                <p className="text-lg font-bold">{stats.today}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/10">
                <AlertTriangle className="h-5 w-5 text-orange-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Annulations</p>
                <p className="text-lg font-bold">{stats.cancellations}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10">
                <User className="h-5 w-5 text-violet-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Utilisateurs</p>
                <p className="text-lg font-bold">{stats.uniqueUsers}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Rechercher dans les logs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={filterAction} onValueChange={setFilterAction}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Action" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes actions</SelectItem>
            {Object.entries(ACTION_LABELS).map(([key, { label }]) => (
              <SelectItem key={key} value={key}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterModule} onValueChange={setFilterModule}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Module" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous modules</SelectItem>
            {Object.entries(MODULE_LABELS).map(([key, label]) => (
              <SelectItem key={key} value={key}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Log entries */}
      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Shield className="mb-4 h-12 w-12 text-muted-foreground/30" />
              <p className="text-muted-foreground">Aucun événement trouvé</p>
            </div>
          ) : (
            <div className="divide-y">
              {filtered.slice(0, 50).map((log) => {
                const actionStyle = ACTION_LABELS[log.action] || ACTION_LABELS.update;
                const ActionIcon = ACTION_ICONS[log.action] || FileText;
                const moduleName = MODULE_LABELS[log.module] || log.module;
                const ts = log.timestamp || log.created_at || '';
                const dateObj = new Date(ts);
                const isExpanded = expandedId === log.id;

                return (
                  <div key={log.id} className="px-4 py-3 hover:bg-muted/50 transition-colors">
                    <div
                      className="flex items-start gap-3 cursor-pointer"
                      onClick={() => setExpandedId(isExpanded ? null : log.id)}
                    >
                      <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${actionStyle.color}`}>
                        <ActionIcon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold">{log.user_nom}</span>
                          <Badge variant="outline" className={`text-[10px] ${actionStyle.color}`}>
                            {actionStyle.label}
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">
                            {moduleName}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mt-0.5 truncate">{log.details}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-muted-foreground">
                          {dateObj.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })} {dateObj.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="mt-2 ml-11 rounded-lg bg-muted/50 p-3 text-xs space-y-1">
                        <p><span className="font-medium">ID:</span> {log.entity_id || '—'}</p>
                        <p><span className="font-medium">Entité:</span> {log.entity_label || '—'}</p>
                        <p><span className="font-medium">Horodatage:</span> {dateObj.toLocaleString('fr-FR')}</p>
                        {log.metadata && Object.keys(log.metadata).length > 0 && (
                          <div>
                            <span className="font-medium">Métadonnées:</span>
                            <pre className="mt-1 overflow-auto rounded bg-muted p-2 text-[10px]">
                              {JSON.stringify(log.metadata, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
