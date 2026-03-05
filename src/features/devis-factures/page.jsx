import { useState, useEffect, useMemo } from 'react';
import { db } from '@/services/db';
import { useAuth } from '@/services/auth';
import { Card, CardContent } from '@/components/ui/card';
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
  FileText,
  Plus,
  Search,
  Eye,
  Trash2,
  ArrowRight,
  XCircle,
  Receipt,
  FileCheck,
  Download,
  Printer,
} from 'lucide-react';
import { toast } from 'sonner';

const TYPES = {
  devis: { label: 'Devis', prefix: 'DEV', color: 'bg-blue-100 text-blue-700' },
  facture: { label: 'Facture', prefix: 'FAC', color: 'bg-emerald-100 text-emerald-700' },
};

const STATUT_DEVIS = {
  brouillon: { label: 'Brouillon', color: 'bg-gray-100 text-gray-700' },
  envoye: { label: 'Envoyé', color: 'bg-blue-100 text-blue-700' },
  accepte: { label: 'Accepté', color: 'bg-emerald-100 text-emerald-700' },
  refuse: { label: 'Refusé', color: 'bg-red-100 text-red-700' },
};

const STATUT_FACTURE = {
  brouillon: { label: 'Brouillon', color: 'bg-gray-100 text-gray-700' },
  envoyee: { label: 'Envoyée', color: 'bg-blue-100 text-blue-700' },
  payee: { label: 'Payée', color: 'bg-emerald-100 text-emerald-700' },
  impayee: { label: 'Impayée', color: 'bg-red-100 text-red-700' },
};

function fmt(n) {
  return new Intl.NumberFormat('fr-FR').format(n || 0);
}

export default function DevisFactures() {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('devis_factures', 'write');
  const [documents, setDocuments] = useState([]);
  const [clients, setClients] = useState([]);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showDetail, setShowDetail] = useState(null);
  const [form, setForm] = useState({
    type: 'devis',
    client_id: '',
    client_nom: '',
    client_adresse: '',
    objet: '',
    lignes: [{ description: '', quantite: 1, prix_unitaire: 0 }],
    remise: 0,
    notes: '',
  });

  const load = async () => {
    const [devis, factures, cl] = await Promise.all([
      db.devis.list(),
      db.factures.list(),
      db.clients.list(),
    ]);
    const all = [
      ...devis.map((d) => ({ ...d, _type: 'devis' })),
      ...factures.map((f) => ({ ...f, _type: 'facture' })),
    ].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    setDocuments(all);
    setClients(cl);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    return documents
      .filter((d) =>
        (d.client_nom || '').toLowerCase().includes(search.toLowerCase()) ||
        (d.numero || '').toLowerCase().includes(search.toLowerCase()),
      )
      .filter((d) => filterType === 'all' || d._type === filterType);
  }, [documents, search, filterType]);

  const stats = useMemo(() => {
    const nbDevis = documents.filter((d) => d._type === 'devis').length;
    const nbFactures = documents.filter((d) => d._type === 'facture').length;
    const totalFactures = documents
      .filter((d) => d._type === 'facture' && d.statut === 'payee')
      .reduce((s, d) => s + (d.total_ttc || 0), 0);
    return { nbDevis, nbFactures, totalFactures };
  }, [documents]);

  const openAdd = (type = 'devis') => {
    const docs = documents.filter((d) => d._type === type);
    const num = `${TYPES[type].prefix}-${String(docs.length + 1).padStart(4, '0')}`;
    setForm({
      type,
      numero: num,
      client_id: '',
      client_nom: '',
      client_adresse: '',
      objet: '',
      lignes: [{ description: '', quantite: 1, prix_unitaire: 0 }],
      remise: 0,
      notes: '',
    });
    setShowForm(true);
  };

  const selectClient = (id) => {
    const client = clients.find((c) => c.id === id);
    if (client) {
      setForm((f) => ({
        ...f,
        client_id: id,
        client_nom: client.nom,
        client_adresse: client.adresse || '',
      }));
    }
  };

  const updateLigne = (idx, field, value) => {
    setForm((f) => {
      const lignes = [...f.lignes];
      lignes[idx] = { ...lignes[idx], [field]: value };
      return { ...f, lignes };
    });
  };

  const addLigne = () => {
    setForm((f) => ({ ...f, lignes: [...f.lignes, { description: '', quantite: 1, prix_unitaire: 0 }] }));
  };

  const removeLigne = (idx) => {
    setForm((f) => ({ ...f, lignes: f.lignes.filter((_, i) => i !== idx) }));
  };

  const getSubtotal = () => form.lignes.reduce((s, l) => s + (Number(l.quantite) || 0) * (Number(l.prix_unitaire) || 0), 0);
  const getTotal = () => {
    const sub = getSubtotal();
    return sub - (Number(form.remise) || 0);
  };

  const handleSave = async () => {
    if (!form.client_nom.trim()) { toast.error('Client requis'); return; }
    if (!form.lignes.some((l) => l.description.trim())) { toast.error('Au moins une ligne'); return; }

    const data = {
      numero: form.numero,
      client_id: form.client_id,
      client_nom: form.client_nom.trim(),
      client_adresse: form.client_adresse,
      objet: form.objet.trim(),
      lignes: form.lignes.filter((l) => l.description.trim()),
      sous_total: getSubtotal(),
      remise: Number(form.remise) || 0,
      total_ttc: getTotal(),
      statut: 'brouillon',
      date: new Date().toISOString().split('T')[0],
    };

    const collection = form.type === 'devis' ? db.devis : db.factures;
    await collection.create(data);
    toast.success(`${TYPES[form.type].label} créé`);
    setShowForm(false);
    load();
  };

  const handleStatut = async (doc, newStatut) => {
    const collection = doc._type === 'devis' ? db.devis : db.factures;
    await collection.update(doc.id, { statut: newStatut });
    toast.success('Statut mis à jour');
    setShowDetail(null);
    load();
  };

  const handleConvertToFacture = async (devis) => {
    const factures = documents.filter((d) => d._type === 'facture');
    const num = `FAC-${String(factures.length + 1).padStart(4, '0')}`;
    await db.factures.create({
      numero: num,
      client_id: devis.client_id,
      client_nom: devis.client_nom,
      client_adresse: devis.client_adresse,
      objet: devis.objet,
      lignes: devis.lignes,
      sous_total: devis.sous_total,
      remise: devis.remise,
      total_ttc: devis.total_ttc,
      statut: 'brouillon',
      date: new Date().toISOString().split('T')[0],
      devis_ref: devis.numero,
    });
    await db.devis.update(devis.id, { statut: 'accepte' });
    toast.success(`Facture ${num} créée à partir du devis`);
    setShowDetail(null);
    load();
  };

  const handleDelete = async (doc) => {
    if (!confirm(`Supprimer ${doc.numero} ?`)) return;
    const collection = doc._type === 'devis' ? db.devis : db.factures;
    await collection.delete(doc.id);
    toast.success('Document supprimé');
    load();
  };

  const handlePrint = (doc) => {
    const w = window.open('', '_blank', 'width=800,height=1000');
    const lines = (doc.lignes || []).map((l) =>
      `<tr><td style="padding:8px;border-bottom:1px solid #eee">${l.description}</td>
       <td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${l.quantite}</td>
       <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${fmt(l.prix_unitaire)} F</td>
       <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${fmt((l.quantite || 0) * (l.prix_unitaire || 0))} F</td></tr>`,
    ).join('');
    const settings = JSON.parse(localStorage.getItem('io_settings') || '{}');
    const companyName = settings.nom_entreprise || 'Imprimerie Ogooué';

    w.document.write(`<!DOCTYPE html><html><head><title>${doc.numero}</title>
      <style>body{font-family:Arial,sans-serif;max-width:800px;margin:40px auto;color:#333}
      h1{color:#4f46e5;margin-bottom:4px}table{width:100%;border-collapse:collapse;margin-top:20px}
      th{background:#f8f9fa;padding:10px 8px;text-align:left;font-size:13px;border-bottom:2px solid #dee2e6}
      .total{text-align:right;font-size:18px;font-weight:bold;margin-top:20px;padding-top:10px;border-top:2px solid #333}
      @media print{body{margin:20px}}</style></head><body>
      <h1>${companyName}</h1>
      <p style="color:#666;margin-top:0">Libreville, Gabon</p>
      <hr style="margin:20px 0">
      <div style="display:flex;justify-content:space-between">
        <div><strong>${TYPES[doc._type].label} N° ${doc.numero}</strong><br>Date: ${doc.date || '-'}</div>
        <div style="text-align:right"><strong>${doc.client_nom}</strong><br>${doc.client_adresse || ''}</div>
      </div>
      ${doc.objet ? `<p style="margin-top:16px"><strong>Objet :</strong> ${doc.objet}</p>` : ''}
      <table><thead><tr><th>Description</th><th style="text-align:center;width:60px">Qté</th><th style="text-align:right;width:100px">P.U.</th><th style="text-align:right;width:120px">Total</th></tr></thead>
      <tbody>${lines}</tbody></table>
      ${doc.remise ? `<p style="text-align:right;color:#666">Remise: -${fmt(doc.remise)} F</p>` : ''}
      <p class="total">Total : ${fmt(doc.total_ttc)} F CFA</p>
      ${doc.notes ? `<p style="margin-top:20px;padding:12px;background:#f8f9fa;border-radius:8px;font-size:13px">${doc.notes}</p>` : ''}
      <script>setTimeout(()=>window.print(),500)</script></body></html>`);
    w.document.close();
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
          <h2 className="text-2xl font-bold tracking-tight">Devis & Factures</h2>
          <p className="text-muted-foreground">Créez et gérez vos documents commerciaux</p>
        </div>
        {canWrite && (
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2" onClick={() => openAdd('devis')}>
              <FileText className="h-4 w-4" /> Devis
            </Button>
            <Button className="gap-2" onClick={() => openAdd('facture')}>
              <Receipt className="h-4 w-4" /> Facture
            </Button>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">Devis</p>
            <p className="text-2xl font-bold text-blue-600">{stats.nbDevis}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">Factures</p>
            <p className="text-2xl font-bold text-emerald-600">{stats.nbFactures}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">Encaissé</p>
            <p className="text-lg font-bold sm:text-2xl">{fmt(stats.totalFactures)} F</p>
          </CardContent>
        </Card>
      </div>

      {/* Search + Filter */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Rechercher..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tout</SelectItem>
            <SelectItem value="devis">Devis</SelectItem>
            <SelectItem value="facture">Factures</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Documents list */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="mb-3 h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">Aucun document trouvé</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((doc) => {
            const typeInfo = TYPES[doc._type];
            const statuts = doc._type === 'devis' ? STATUT_DEVIS : STATUT_FACTURE;
            const statutInfo = statuts[doc.statut] || statuts.brouillon;
            return (
              <Card key={doc.id} className="transition-shadow hover:shadow-md">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className={typeInfo.color}>{typeInfo.label}</Badge>
                        <span className="text-sm font-bold">{doc.numero}</span>
                        <Badge variant="outline" className={statutInfo.color}>{statutInfo.label}</Badge>
                      </div>
                      <p className="mt-1 font-semibold">{doc.client_nom}</p>
                      {doc.objet && <p className="mt-0.5 truncate text-sm text-muted-foreground">{doc.objet}</p>}
                      <p className="mt-1 text-xs text-muted-foreground">{doc.date || '-'}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold">{fmt(doc.total_ttc)} F</p>
                      <div className="mt-1 flex gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowDetail(doc)}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handlePrint(doc)}>
                          <Printer className="h-3.5 w-3.5" />
                        </Button>
                        {canWrite && doc.statut === 'brouillon' && (
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(doc)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nouveau {TYPES[form.type]?.label}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Client</label>
              {clients.length > 0 ? (
                <Select value={form.client_id} onValueChange={selectClient}>
                  <SelectTrigger><SelectValue placeholder="Sélectionner un client..." /></SelectTrigger>
                  <SelectContent>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.nom}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={form.client_nom} onChange={(e) => setForm({ ...form, client_nom: e.target.value })} placeholder="Nom du client" />
              )}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Objet</label>
              <Input value={form.objet} onChange={(e) => setForm({ ...form, objet: e.target.value })} placeholder="Ex: Impression 1000 flyers A5" />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium">Lignes</label>
                <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={addLigne}>
                  <Plus className="h-3 w-3" /> Ligne
                </Button>
              </div>
              <div className="space-y-2">
                {form.lignes.map((l, i) => (
                  <div key={i} className="flex gap-2">
                    <Input className="flex-1" placeholder="Description" value={l.description} onChange={(e) => updateLigne(i, 'description', e.target.value)} />
                    <Input className="w-16" type="number" placeholder="Qté" value={l.quantite} onChange={(e) => updateLigne(i, 'quantite', e.target.value)} />
                    <Input className="w-24" type="number" placeholder="Prix" value={l.prix_unitaire} onChange={(e) => updateLigne(i, 'prix_unitaire', e.target.value)} />
                    {form.lignes.length > 1 && (
                      <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0 text-destructive" onClick={() => removeLigne(i)}>
                        <XCircle className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">Remise (F)</label>
              <Input type="number" value={form.remise} onChange={(e) => setForm({ ...form, remise: e.target.value })} />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">Notes</label>
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Conditions de paiement, etc." />
            </div>

            <div className="rounded-lg bg-muted/50 p-3 text-right">
              <p className="text-sm text-muted-foreground">Sous-total : {fmt(getSubtotal())} F</p>
              {Number(form.remise) > 0 && <p className="text-sm text-red-500">Remise : -{fmt(form.remise)} F</p>}
              <p className="mt-1 text-2xl font-bold">{fmt(getTotal())} F</p>
            </div>

            <Button className="w-full" onClick={handleSave}>
              Créer le {TYPES[form.type]?.label.toLowerCase()}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={!!showDetail} onOpenChange={() => setShowDetail(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{showDetail?.numero}</DialogTitle>
          </DialogHeader>
          {showDetail && (() => {
            const statuts = showDetail._type === 'devis' ? STATUT_DEVIS : STATUT_FACTURE;
            const statutInfo = statuts[showDetail.statut] || statuts.brouillon;
            return (
              <div className="space-y-4 pt-2">
                <div className="flex items-center justify-between">
                  <div className="flex gap-2">
                    <Badge className={TYPES[showDetail._type].color}>{TYPES[showDetail._type].label}</Badge>
                    <Badge variant="outline" className={statutInfo.color}>{statutInfo.label}</Badge>
                  </div>
                  <span className="text-sm text-muted-foreground">{showDetail.date}</span>
                </div>

                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="font-semibold">{showDetail.client_nom}</p>
                  {showDetail.objet && <p className="mt-1 text-sm">{showDetail.objet}</p>}
                </div>

                {showDetail.lignes?.length > 0 && (
                  <div className="space-y-1.5">
                    {showDetail.lignes.map((l, i) => (
                      <div key={i} className="flex justify-between rounded bg-muted/30 px-3 py-2 text-sm">
                        <span>{l.description}</span>
                        <span className="font-medium">{l.quantite} x {fmt(l.prix_unitaire)} F</span>
                      </div>
                    ))}
                    {showDetail.remise > 0 && (
                      <div className="flex justify-between px-3 py-1 text-sm text-red-500">
                        <span>Remise</span>
                        <span>-{fmt(showDetail.remise)} F</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t pt-2">
                      <span className="font-semibold">Total TTC</span>
                      <span className="text-lg font-bold">{fmt(showDetail.total_ttc)} F</span>
                    </div>
                  </div>
                )}

                {canWrite && (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" className="gap-1" onClick={() => handlePrint(showDetail)}>
                      <Printer className="h-3.5 w-3.5" /> Imprimer
                    </Button>

                    {showDetail._type === 'devis' && showDetail.statut === 'brouillon' && (
                      <Button size="sm" variant="outline" onClick={() => handleStatut(showDetail, 'envoye')}>
                        Marquer envoyé
                      </Button>
                    )}
                    {showDetail._type === 'devis' && (showDetail.statut === 'envoye' || showDetail.statut === 'brouillon') && (
                      <Button size="sm" className="gap-1" onClick={() => handleConvertToFacture(showDetail)}>
                        <ArrowRight className="h-3.5 w-3.5" /> Convertir en facture
                      </Button>
                    )}

                    {showDetail._type === 'facture' && showDetail.statut === 'brouillon' && (
                      <Button size="sm" variant="outline" onClick={() => handleStatut(showDetail, 'envoyee')}>
                        Marquer envoyée
                      </Button>
                    )}
                    {showDetail._type === 'facture' && (showDetail.statut === 'envoyee' || showDetail.statut === 'brouillon') && (
                      <Button size="sm" className="gap-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => handleStatut(showDetail, 'payee')}>
                        <FileCheck className="h-3.5 w-3.5" /> Marquer payée
                      </Button>
                    )}
                    {showDetail._type === 'facture' && showDetail.statut === 'envoyee' && (
                      <Button size="sm" variant="destructive" onClick={() => handleStatut(showDetail, 'impayee')}>
                        Impayée
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
