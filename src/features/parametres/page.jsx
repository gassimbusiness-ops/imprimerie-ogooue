import { useState, useEffect, useRef } from 'react';
import { db, getSettings as loadSettingsFromDB, saveSettings as saveSettingsToDB } from '@/services/db';
import { useAuth } from '@/services/auth';
import { logAction } from '@/services/audit';
import { hashPassword, generateSalt } from '@/services/crypto';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Settings, Building2, Camera, Save, Phone, Mail, MapPin, Globe,
  Users, Shield, Key, Plus, Edit2, Trash2, UserPlus, Lock,
  Eye, EyeOff, AlertTriangle, Palette, Image, Type, ToggleLeft,
} from 'lucide-react';
import { toast } from 'sonner';

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Administrateur', color: 'bg-violet-100 text-violet-700' },
  { value: 'manager', label: 'Manager', color: 'bg-blue-100 text-blue-700' },
  { value: 'employe', label: 'Employé', color: 'bg-slate-100 text-slate-700' },
  { value: 'associe', label: 'Associé', color: 'bg-indigo-100 text-indigo-700' },
  { value: 'client', label: 'Client', color: 'bg-emerald-100 text-emerald-700' },
];

export default function Parametres() {
  const { user, isAdmin, changePassword } = useAuth();
  const [activeTab, setActiveTab] = useState('entreprise');
  const [form, setForm] = useState({
    nom_entreprise: '', slogan: '', adresse: '', ville: '', pays: '',
    telephone: '', telephone2: '', email: '', site_web: '', nif: '', rccm: '',
    logo: '', devise: 'F CFA', tva: '0',
  });
  const [employes, setEmployes] = useState([]);
  const [showUserForm, setShowUserForm] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [userForm, setUserForm] = useState({ nom: '', prenom: '', email: '', role: 'employe', poste: '', telephone: '' });
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(null);
  const [changePwdForm, setChangePwdForm] = useState({ newPwd: '', confirmPwd: '' });
  const [showPwd, setShowPwd] = useState(false);
  const logoRef = useRef(null);
  const bannerRef = useRef(null);
  const [bannerForm, setBannerForm] = useState({
    texte: '', sous_texte: '', couleur: '', image: '', actif: true,
  });

  useEffect(() => {
    loadSettingsFromDB().then((saved) => {
      setForm((f) => ({
        ...f,
        nom_entreprise: saved.nom_entreprise || 'Imprimerie OGOOUÉ',
        slogan: saved.slogan || 'Votre partenaire impression à Moanda',
        adresse: saved.adresse || 'Carrefour Fina en face de Finam',
        ville: saved.ville || 'Moanda',
        pays: saved.pays || 'Gabon',
        telephone: saved.telephone || '060 44 46 34',
        telephone2: saved.telephone2 || '074 42 41 42',
        email: saved.email || 'imprimerieogooue@gmail.com',
        site_web: saved.site_web || '',
        nif: saved.nif || '256598U',
        rccm: saved.rccm || 'RG/FCV 2023A0407',
        logo: saved.logo || '',
        devise: saved.devise || 'F CFA',
        tva: saved.tva || '0',
      }));
      // Load banner settings
      if (saved.banniere_client) {
        setBannerForm({
          texte: saved.banniere_client.texte || '',
          sous_texte: saved.banniere_client.sous_texte || '',
          couleur: saved.banniere_client.couleur || '',
          image: saved.banniere_client.image || '',
          actif: saved.banniere_client.actif !== false,
        });
      }
    });
    loadUsers();
  }, []);

  const loadUsers = async () => {
    const data = await db.employes.list();
    setEmployes(data.sort((a, b) => {
      const roleOrder = { admin: 0, manager: 1, employe: 2, client: 3 };
      return (roleOrder[a.role] || 9) - (roleOrder[b.role] || 9);
    }));
  };

  const handleLogoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1000000) { toast.error('Image trop grande (max 1 Mo)'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => setForm((f) => ({ ...f, logo: ev.target.result }));
    reader.readAsDataURL(file);
  };

  const handleSaveSettings = async () => {
    await saveSettingsToDB(form);
    toast.success('Paramètres enregistrés');
  };

  const handleBannerImageChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2000000) { toast.error('Image trop grande (max 2 Mo)'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => setBannerForm((f) => ({ ...f, image: ev.target.result }));
    reader.readAsDataURL(file);
  };

  const handleSaveBanner = async () => {
    const currentSettings = await loadSettingsFromDB();
    await saveSettingsToDB({ ...currentSettings, banniere_client: bannerForm });
    toast.success('Bannière client enregistrée');
  };

  const openAddUser = () => {
    setEditUser(null);
    setUserForm({ nom: '', prenom: '', email: '', role: 'employe', poste: '', telephone: '' });
    setNewPassword('');
    setShowUserForm(true);
  };

  const openEditUser = (emp) => {
    setEditUser(emp);
    setUserForm({
      nom: emp.nom || '', prenom: emp.prenom || '', email: emp.email || '',
      role: emp.role || 'employe', poste: emp.poste || '', telephone: emp.telephone || '',
    });
    setNewPassword('');
    setShowUserForm(true);
  };

  const handleSaveUser = async () => {
    if (!userForm.nom.trim() || !userForm.email.trim()) {
      toast.error('Nom et email requis'); return;
    }
    if (editUser) {
      const updateData = { ...userForm };
      if (newPassword) {
        const salt = generateSalt();
        const hash = await hashPassword(newPassword, salt);
        updateData.password_hash = hash;
        updateData.password_salt = salt;
        updateData.password_changed_at = new Date().toISOString();
      }
      await db.employes.update(editUser.id, updateData);
      await logAction('update', 'employes', {
        entityId: editUser.id, entityLabel: `${userForm.prenom} ${userForm.nom}`,
        details: `Modification utilisateur: ${userForm.email} (${userForm.role})`,
      });
      toast.success('Utilisateur modifié');
    } else {
      if (!newPassword || newPassword.length < 6) {
        toast.error('Mot de passe requis (min. 6 caractères)'); return;
      }
      const salt = generateSalt();
      const hash = await hashPassword(newPassword, salt);
      const created = await db.employes.create({
        ...userForm,
        password_hash: hash,
        password_salt: salt,
        password_changed_at: new Date().toISOString(),
      });
      await logAction('create', 'employes', {
        entityId: created.id, entityLabel: `${userForm.prenom} ${userForm.nom}`,
        details: `Nouvel utilisateur: ${userForm.email} (${userForm.role})`,
      });
      toast.success('Utilisateur créé');
    }
    setShowUserForm(false);
    loadUsers();
  };

  const handleDeleteUser = async (emp) => {
    if (emp.id === user?.id) { toast.error('Vous ne pouvez pas supprimer votre propre compte'); return; }
    if (!confirm(`Supprimer ${emp.prenom} ${emp.nom} ?`)) return;
    await db.employes.delete(emp.id);
    await logAction('delete', 'employes', {
      entityId: emp.id, entityLabel: `${emp.prenom} ${emp.nom}`,
      details: `Suppression utilisateur: ${emp.email}`,
    });
    toast.success('Utilisateur supprimé');
    loadUsers();
  };

  const handleChangePassword = async () => {
    if (changePwdForm.newPwd !== changePwdForm.confirmPwd) {
      toast.error('Les mots de passe ne correspondent pas'); return;
    }
    if (changePwdForm.newPwd.length < 6) {
      toast.error('Min. 6 caractères'); return;
    }
    const result = await changePassword(showChangePassword.id, changePwdForm.newPwd);
    if (result.error) { toast.error(result.error); return; }
    await logAction('update', 'employes', {
      entityId: showChangePassword.id,
      entityLabel: `${showChangePassword.prenom} ${showChangePassword.nom}`,
      details: 'Changement de mot de passe',
    });
    toast.success('Mot de passe modifié');
    setShowChangePassword(null);
    setChangePwdForm({ newPwd: '', confirmPwd: '' });
  };

  const TABS = [
    { id: 'entreprise', label: 'Entreprise', icon: Building2 },
    ...(isAdmin ? [{ id: 'utilisateurs', label: 'Utilisateurs', icon: Users }] : []),
    ...(isAdmin ? [{ id: 'interface_client', label: 'Interface Client', icon: Palette }] : []),
    { id: 'securite', label: 'Sécurité', icon: Shield },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Paramètres</h2>
          <p className="text-muted-foreground">Configuration du système</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b pb-0">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${activeTab === id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {/* ======= ENTREPRISE TAB ======= */}
      {activeTab === 'entreprise' && (
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Building2 className="h-4 w-4" /> Identité</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col items-center gap-4 sm:flex-row">
                <div className="relative">
                  {form.logo ? (
                    <img src={form.logo} alt="Logo" className="h-24 w-24 rounded-xl object-contain border p-1" />
                  ) : (
                    <div className="flex h-24 w-24 items-center justify-center rounded-xl bg-primary/10 text-primary"><Building2 className="h-10 w-10" /></div>
                  )}
                  <button type="button" onClick={() => logoRef.current?.click()} className="absolute -bottom-2 -right-2 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-white shadow-lg hover:bg-primary/90 transition-colors"><Camera className="h-4 w-4" /></button>
                  <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
                </div>
                <div className="flex-1 space-y-3 w-full">
                  <div><label className="mb-1.5 block text-sm font-medium">Nom de l'entreprise</label><Input value={form.nom_entreprise} onChange={(e) => setForm({ ...form, nom_entreprise: e.target.value })} /></div>
                  <div><label className="mb-1.5 block text-sm font-medium">Slogan</label><Input value={form.slogan} onChange={(e) => setForm({ ...form, slogan: e.target.value })} /></div>
                </div>
              </div>
              {form.logo && <Button variant="outline" size="sm" className="text-xs text-destructive" onClick={() => setForm({ ...form, logo: '' })}>Supprimer le logo</Button>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><MapPin className="h-4 w-4" /> Coordonnées</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div><label className="mb-1.5 block text-sm font-medium">Adresse</label><Input value={form.adresse} onChange={(e) => setForm({ ...form, adresse: e.target.value })} placeholder="Quartier, rue, n°..." /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1.5 block text-sm font-medium">Ville</label><Input value={form.ville} onChange={(e) => setForm({ ...form, ville: e.target.value })} /></div>
                <div><label className="mb-1.5 block text-sm font-medium">Pays</label><Input value={form.pays} onChange={(e) => setForm({ ...form, pays: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium"><Phone className="h-3.5 w-3.5" /> Téléphone 1</label><Input value={form.telephone} onChange={(e) => setForm({ ...form, telephone: e.target.value })} /></div>
                <div><label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium"><Phone className="h-3.5 w-3.5" /> Téléphone 2</label><Input value={form.telephone2} onChange={(e) => setForm({ ...form, telephone2: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium"><Mail className="h-3.5 w-3.5" /> Email</label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                <div><label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium"><Globe className="h-3.5 w-3.5" /> Site web</label><Input value={form.site_web} onChange={(e) => setForm({ ...form, site_web: e.target.value })} placeholder="https://..." /></div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Settings className="h-4 w-4" /> Informations légales & fiscales</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1.5 block text-sm font-medium">RCCM</label><Input value={form.rccm} onChange={(e) => setForm({ ...form, rccm: e.target.value })} /></div>
                <div><label className="mb-1.5 block text-sm font-medium">NIF</label><Input value={form.nif} onChange={(e) => setForm({ ...form, nif: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1.5 block text-sm font-medium">Devise</label><Input value={form.devise} onChange={(e) => setForm({ ...form, devise: e.target.value })} /></div>
                <div><label className="mb-1.5 block text-sm font-medium">TVA (%)</label><Input type="number" value={form.tva} onChange={(e) => setForm({ ...form, tva: e.target.value })} /></div>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end pb-6">
            <Button size="lg" className="gap-2" onClick={handleSaveSettings}><Save className="h-4 w-4" /> Enregistrer</Button>
          </div>
        </div>
      )}

      {/* ======= UTILISATEURS TAB ======= */}
      {activeTab === 'utilisateurs' && isAdmin && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{employes.length} utilisateurs</p>
            <Button className="gap-2" onClick={openAddUser}><UserPlus className="h-4 w-4" /> Ajouter</Button>
          </div>

          <Card>
            <CardContent className="p-0 divide-y">
              {employes.map((emp) => {
                const roleOpt = ROLE_OPTIONS.find((r) => r.value === emp.role) || ROLE_OPTIONS[2];
                const isSelf = emp.id === user?.id;
                return (
                  <div key={emp.id} className={`flex items-center gap-4 px-4 py-3 hover:bg-muted/50 ${isSelf ? 'bg-primary/5' : ''}`}>
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary shrink-0">
                      {emp.prenom?.[0]}{emp.nom?.[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sm">{emp.prenom} {emp.nom}</p>
                        {isSelf && <Badge className="text-[9px] bg-primary/10 text-primary">Vous</Badge>}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-xs text-muted-foreground">{emp.email}</span>
                        {emp.poste && <span className="text-[10px] text-muted-foreground">• {emp.poste}</span>}
                      </div>
                    </div>
                    <Badge variant="outline" className={`text-[10px] shrink-0 ${roleOpt.color}`}>{roleOpt.label}</Badge>
                    {emp.password_hash ? (
                      <Badge variant="outline" className="text-[9px] bg-emerald-50 text-emerald-600 shrink-0"><Lock className="mr-1 h-2.5 w-2.5" /> Actif</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[9px] bg-orange-50 text-orange-600 shrink-0"><AlertTriangle className="mr-1 h-2.5 w-2.5" /> Sans mdp</Badge>
                    )}
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => { setShowChangePassword(emp); setChangePwdForm({ newPwd: '', confirmPwd: '' }); setShowPwd(false); }} className="rounded p-1.5 hover:bg-muted" title="Changer mot de passe"><Key className="h-3.5 w-3.5 text-muted-foreground" /></button>
                      <button onClick={() => openEditUser(emp)} className="rounded p-1.5 hover:bg-muted" title="Modifier"><Edit2 className="h-3.5 w-3.5 text-muted-foreground" /></button>
                      {!isSelf && <button onClick={() => handleDeleteUser(emp)} className="rounded p-1.5 hover:bg-red-50" title="Supprimer"><Trash2 className="h-3.5 w-3.5 text-red-500" /></button>}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ======= INTERFACE CLIENT TAB ======= */}
      {activeTab === 'interface_client' && isAdmin && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Image className="h-4 w-4" /> Bannière de couverture
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Personnalisez la bannière affichée en haut du portail client.
              </p>

              <div className="flex items-center gap-3">
                <label className="text-sm font-medium flex items-center gap-2">
                  <ToggleLeft className="h-4 w-4" /> Bannière active
                </label>
                <button
                  onClick={() => setBannerForm((f) => ({ ...f, actif: !f.actif }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${bannerForm.actif ? 'bg-primary' : 'bg-muted'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${bannerForm.actif ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>

              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
                  <Type className="h-3.5 w-3.5" /> Texte d'accroche
                </label>
                <Input
                  value={bannerForm.texte}
                  onChange={(e) => setBannerForm({ ...bannerForm, texte: e.target.value })}
                  placeholder="Bienvenue chez Imprimerie Ogooué"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium">Sous-texte</label>
                <Input
                  value={bannerForm.sous_texte}
                  onChange={(e) => setBannerForm({ ...bannerForm, sous_texte: e.target.value })}
                  placeholder="Moanda, Gabon — Votre partenaire impression"
                />
              </div>

              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
                  <Palette className="h-3.5 w-3.5" /> Couleur de fond
                </label>
                <div className="flex items-center gap-3">
                  <Input
                    type="color"
                    value={bannerForm.couleur || '#1e40af'}
                    onChange={(e) => setBannerForm({ ...bannerForm, couleur: e.target.value })}
                    className="h-10 w-16 p-1 cursor-pointer"
                  />
                  <Input
                    value={bannerForm.couleur}
                    onChange={(e) => setBannerForm({ ...bannerForm, couleur: e.target.value })}
                    placeholder="#1e40af"
                    className="flex-1"
                  />
                  {bannerForm.couleur && (
                    <Button variant="ghost" size="sm" className="text-xs" onClick={() => setBannerForm({ ...bannerForm, couleur: '' })}>
                      Par défaut
                    </Button>
                  )}
                </div>
              </div>

              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
                  <Image className="h-3.5 w-3.5" /> Image de fond
                </label>
                {bannerForm.image ? (
                  <div className="space-y-2">
                    <div className="h-32 rounded-lg overflow-hidden bg-slate-100">
                      <img src={bannerForm.image} alt="Banner" className="w-full h-full object-cover" />
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="text-xs" onClick={() => bannerRef.current?.click()}>
                        Changer l'image
                      </Button>
                      <Button variant="outline" size="sm" className="text-xs text-destructive" onClick={() => setBannerForm({ ...bannerForm, image: '' })}>
                        Supprimer
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="outline" className="gap-2" onClick={() => bannerRef.current?.click()}>
                    <Camera className="h-4 w-4" /> Choisir une image
                  </Button>
                )}
                <input ref={bannerRef} type="file" accept="image/*" className="hidden" onChange={handleBannerImageChange} />
                <p className="text-[10px] text-muted-foreground mt-1">Max 2 Mo. Format recommandé : 1200x400px</p>
              </div>

              {/* Preview */}
              <div>
                <p className="text-sm font-medium mb-2">Aperçu</p>
                <div
                  className="relative rounded-xl overflow-hidden"
                  style={bannerForm.image ? { background: `url(${bannerForm.image}) center/cover no-repeat` } : undefined}
                >
                  <div
                    className={`${!bannerForm.image ? 'bg-gradient-to-br from-primary to-blue-700' : ''} p-6 text-white`}
                    style={bannerForm.couleur && !bannerForm.image ? { background: bannerForm.couleur } : undefined}
                  >
                    {bannerForm.image && <div className="absolute inset-0 bg-black/40" />}
                    <div className="relative z-10">
                      <p className="text-lg font-bold">{bannerForm.texte || 'Bienvenue, Client !'}</p>
                      <p className="text-white/80 text-sm mt-0.5">{bannerForm.sous_texte || 'Suivez vos commandes et gérez vos devis.'}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end">
                <Button className="gap-2" onClick={handleSaveBanner}>
                  <Save className="h-4 w-4" /> Enregistrer la bannière
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ======= SECURITE TAB ======= */}
      {activeTab === 'securite' && (
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Shield className="h-4 w-4" /> Mon compte</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                  {user?.prenom?.[0]}{user?.nom?.[0]}
                </div>
                <div>
                  <p className="font-semibold">{user?.prenom} {user?.nom}</p>
                  <p className="text-sm text-muted-foreground">{user?.email}</p>
                  <Badge variant="outline" className="mt-1 text-[10px]">{ROLE_OPTIONS.find((r) => r.value === user?.role)?.label}</Badge>
                </div>
              </div>
              <Button variant="outline" className="gap-2" onClick={() => {
                setShowChangePassword({ id: user?.id, prenom: user?.prenom, nom: user?.nom });
                setChangePwdForm({ newPwd: '', confirmPwd: '' }); setShowPwd(false);
              }}>
                <Key className="h-4 w-4" /> Changer mon mot de passe
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Lock className="h-4 w-4" /> Politique de sécurité</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div className="flex items-start gap-3 rounded-lg border p-3">
                <Shield className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-foreground">Authentification par mot de passe</p>
                  <p>Tous les utilisateurs doivent se connecter avec email + mot de passe. Les mots de passe sont hashés (SHA-256 + salt).</p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-lg border p-3">
                <Users className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-foreground">Contrôle d'accès RBAC</p>
                  <p>5 rôles : Admin (accès total), Manager (production + validation), Employé (saisie limitée), Associé (lecture stratégique), Client (portail externe).</p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-lg border p-3">
                <Lock className="h-5 w-5 text-violet-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-foreground">Verrouillage des rapports</p>
                  <p>Les rapports validés/clôturés sont verrouillés. Seul l'admin peut déverrouiller après demande motivée.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* User Form Dialog */}
      <Dialog open={showUserForm} onOpenChange={setShowUserForm}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editUser ? 'Modifier l\'utilisateur' : 'Nouvel utilisateur'}</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="mb-1.5 block text-sm font-medium">Prénom *</label><Input value={userForm.prenom} onChange={(e) => setUserForm({ ...userForm, prenom: e.target.value })} /></div>
              <div><label className="mb-1.5 block text-sm font-medium">Nom *</label><Input value={userForm.nom} onChange={(e) => setUserForm({ ...userForm, nom: e.target.value })} /></div>
            </div>
            <div><label className="mb-1.5 block text-sm font-medium">Email *</label><Input type="email" value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Rôle</label>
                <Select value={userForm.role} onValueChange={(v) => setUserForm({ ...userForm, role: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><label className="mb-1.5 block text-sm font-medium">Poste</label><Input value={userForm.poste} onChange={(e) => setUserForm({ ...userForm, poste: e.target.value })} /></div>
            </div>
            <div><label className="mb-1.5 block text-sm font-medium">Téléphone</label><Input value={userForm.telephone} onChange={(e) => setUserForm({ ...userForm, telephone: e.target.value })} /></div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">{editUser ? 'Nouveau mot de passe (vide = pas de changement)' : 'Mot de passe *'}</label>
              <div className="relative">
                <Input type={showPassword ? 'text' : 'password'} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder={editUser ? 'Laisser vide...' : 'Min. 6 caractères'} className="pr-10" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <Button className="w-full" onClick={handleSaveUser}>{editUser ? 'Enregistrer' : 'Créer l\'utilisateur'}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Change Password Dialog */}
      <Dialog open={!!showChangePassword} onOpenChange={() => setShowChangePassword(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Key className="h-5 w-5" /> Changer le mot de passe</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">
              Pour : <strong>{showChangePassword?.prenom} {showChangePassword?.nom}</strong>
            </p>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Nouveau mot de passe</label>
              <div className="relative">
                <Input type={showPwd ? 'text' : 'password'} value={changePwdForm.newPwd} onChange={(e) => setChangePwdForm({ ...changePwdForm, newPwd: e.target.value })} placeholder="Min. 6 caractères" className="pr-10" />
                <button type="button" onClick={() => setShowPwd(!showPwd)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Confirmer</label>
              <Input type={showPwd ? 'text' : 'password'} value={changePwdForm.confirmPwd} onChange={(e) => setChangePwdForm({ ...changePwdForm, confirmPwd: e.target.value })} placeholder="Retapez le mot de passe" />
            </div>
            <Button className="w-full" onClick={handleChangePassword}>Changer le mot de passe</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
