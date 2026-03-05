import { useState, useEffect, useRef } from 'react';
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
  Users,
  Plus,
  Search,
  Edit2,
  Trash2,
  Camera,
  Mail,
  Phone,
  Briefcase,
  Shield,
} from 'lucide-react';
import { toast } from 'sonner';

const ROLE_LABELS = {
  admin: { label: 'Administrateur', class: 'bg-violet-100 text-violet-700' },
  manager: { label: 'Manager', class: 'bg-blue-100 text-blue-700' },
  employe: { label: 'Employé', class: 'bg-slate-100 text-slate-700' },
};

const POSTES = [
  'Directeur',
  'Responsable production',
  'Opérateur',
  'Opératrice',
  'Technicien',
  'Comptable',
  'Commercial',
  'Livreur',
  'Secrétaire',
  'Stagiaire',
];

export default function Employes() {
  const { hasPermission, isAdmin } = useAuth();
  const canWrite = hasPermission('employes', 'write');
  const canDelete = hasPermission('employes', 'delete');
  const [employes, setEmployes] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({
    prenom: '', nom: '', email: '', telephone: '', poste: '', role: 'employe', photo: '',
  });
  const fileRef = useRef(null);

  const load = async () => {
    const data = await db.employes.list();
    setEmployes(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = employes.filter((e) =>
    `${e.prenom} ${e.nom} ${e.poste}`.toLowerCase().includes(search.toLowerCase()),
  );

  const openAdd = () => {
    setEditItem(null);
    setForm({ prenom: '', nom: '', email: '', telephone: '', poste: '', role: 'employe', photo: '' });
    setShowForm(true);
  };

  const openEdit = (emp) => {
    setEditItem(emp);
    setForm({
      prenom: emp.prenom || '',
      nom: emp.nom || '',
      email: emp.email || '',
      telephone: emp.telephone || '',
      poste: emp.poste || '',
      role: emp.role || 'employe',
      photo: emp.photo || '',
    });
    setShowForm(true);
  };

  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500000) {
      toast.error('Image trop grande (max 500 Ko)');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      setForm((f) => ({ ...f, photo: ev.target.result }));
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    if (!form.prenom.trim() || !form.nom.trim()) {
      toast.error('Prénom et nom requis');
      return;
    }

    const data = {
      prenom: form.prenom.trim(),
      nom: form.nom.trim(),
      email: form.email.trim(),
      telephone: form.telephone.trim(),
      poste: form.poste,
      role: form.role,
      photo: form.photo,
    };

    if (editItem) {
      await db.employes.update(editItem.id, data);
      // If editing current user, update session
      const session = JSON.parse(localStorage.getItem('io_current_user') || '{}');
      if (session.id === editItem.id) {
        const updated = { ...session, ...data };
        localStorage.setItem('io_current_user', JSON.stringify(updated));
      }
      toast.success('Employé modifié');
    } else {
      await db.employes.create(data);
      toast.success('Employé ajouté');
    }
    setShowForm(false);
    load();
  };

  const handleDelete = async (emp) => {
    if (!confirm(`Supprimer ${emp.prenom} ${emp.nom} ?`)) return;
    await db.employes.delete(emp.id);
    toast.success('Employé supprimé');
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
          <h2 className="text-2xl font-bold tracking-tight">Employés</h2>
          <p className="text-muted-foreground">Équipe de l'Imprimerie Ogooué — {employes.length} membres</p>
        </div>
        {canWrite && (
          <Button className="gap-2" onClick={openAdd}>
            <Plus className="h-4 w-4" /> Nouvel employé
          </Button>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Rechercher un employé..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
      </div>

      {/* Employee grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((emp) => {
          const role = ROLE_LABELS[emp.role] || ROLE_LABELS.employe;
          return (
            <Card
              key={emp.id}
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => canWrite ? openEdit(emp) : null}
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  {emp.photo ? (
                    <img
                      src={emp.photo}
                      alt={emp.prenom}
                      className="h-12 w-12 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">
                      {emp.prenom?.[0]}{emp.nom?.[0]}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{emp.prenom} {emp.nom}</p>
                    <p className="truncate text-sm text-muted-foreground">{emp.poste}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={role.class}>{role.label}</Badge>
                    </div>
                  </div>
                  {canWrite && (
                    <Edit2 className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                  )}
                </div>

                {(emp.email || emp.telephone) && (
                  <div className="mt-3 space-y-1 border-t pt-3">
                    {emp.email && (
                      <p className="flex items-center gap-2 truncate text-xs text-muted-foreground">
                        <Mail className="h-3 w-3 shrink-0" /> {emp.email}
                      </p>
                    )}
                    {emp.telephone && (
                      <p className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Phone className="h-3 w-3 shrink-0" /> {emp.telephone}
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editItem ? 'Modifier l\'employé' : 'Nouvel employé'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {/* Photo */}
            <div className="flex justify-center">
              <div className="relative">
                {form.photo ? (
                  <img src={form.photo} alt="Photo" className="h-20 w-20 rounded-full object-cover" />
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary text-lg font-bold text-white">
                    {form.prenom?.[0] || '?'}{form.nom?.[0] || ''}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-white shadow-lg hover:bg-primary/90 transition-colors"
                >
                  <Camera className="h-4 w-4" />
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handlePhotoChange}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Prénom</label>
                <Input value={form.prenom} onChange={(e) => setForm({ ...form, prenom: e.target.value })} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Nom</label>
                <Input value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">Email</label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="prenom.nom@imprimerie-ogooue.ga" />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">Téléphone</label>
              <Input value={form.telephone} onChange={(e) => setForm({ ...form, telephone: e.target.value })} placeholder="+241 ..." />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">Poste</label>
              <Select value={form.poste} onValueChange={(v) => setForm({ ...form, poste: v })}>
                <SelectTrigger><SelectValue placeholder="Sélectionner..." /></SelectTrigger>
                <SelectContent>
                  {POSTES.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isAdmin && (
              <div>
                <label className="mb-1.5 flex items-center gap-2 text-sm font-medium">
                  <Shield className="h-4 w-4" /> Rôle
                </label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Administrateur</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="employe">Employé</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex gap-3">
              <Button className="flex-1" onClick={handleSave}>
                {editItem ? 'Enregistrer' : 'Ajouter'}
              </Button>
              {editItem && canDelete && (
                <Button
                  variant="destructive"
                  onClick={() => { handleDelete(editItem); setShowForm(false); }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
