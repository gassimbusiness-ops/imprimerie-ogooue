import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Settings,
  Building2,
  Camera,
  Save,
  Phone,
  Mail,
  MapPin,
  Globe,
  Palette,
} from 'lucide-react';
import { toast } from 'sonner';

const SETTINGS_KEY = 'io_settings';

function getSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveSettings(data) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
}

export default function Parametres() {
  const [form, setForm] = useState({
    nom_entreprise: '',
    slogan: '',
    adresse: '',
    ville: '',
    pays: '',
    telephone: '',
    email: '',
    site_web: '',
    nif: '',
    rccm: '',
    logo: '',
    devise: 'F CFA',
    tva: '0',
  });
  const logoRef = useRef(null);

  useEffect(() => {
    const saved = getSettings();
    setForm((f) => ({
      ...f,
      nom_entreprise: saved.nom_entreprise || 'Imprimerie Ogooué',
      slogan: saved.slogan || 'Votre partenaire impression à Libreville',
      adresse: saved.adresse || '',
      ville: saved.ville || 'Libreville',
      pays: saved.pays || 'Gabon',
      telephone: saved.telephone || '',
      email: saved.email || '',
      site_web: saved.site_web || '',
      nif: saved.nif || '',
      rccm: saved.rccm || '',
      logo: saved.logo || '',
      devise: saved.devise || 'F CFA',
      tva: saved.tva || '0',
    }));
  }, []);

  const handleLogoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1000000) {
      toast.error('Image trop grande (max 1 Mo)');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      setForm((f) => ({ ...f, logo: ev.target.result }));
    };
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    saveSettings(form);
    toast.success('Paramètres enregistrés');
    // Dispatch event so sidebar can update the logo
    window.dispatchEvent(new CustomEvent('settings-updated'));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Paramètres</h2>
          <p className="text-muted-foreground">Configuration de l'entreprise</p>
        </div>
        <Button className="gap-2" onClick={handleSave}>
          <Save className="h-4 w-4" /> Enregistrer
        </Button>
      </div>

      {/* Logo & Identity */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4" /> Identité de l'entreprise
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <div className="relative">
              {form.logo ? (
                <img src={form.logo} alt="Logo" className="h-24 w-24 rounded-xl object-contain border p-1" />
              ) : (
                <div className="flex h-24 w-24 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Building2 className="h-10 w-10" />
                </div>
              )}
              <button
                type="button"
                onClick={() => logoRef.current?.click()}
                className="absolute -bottom-2 -right-2 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-white shadow-lg hover:bg-primary/90 transition-colors"
              >
                <Camera className="h-4 w-4" />
              </button>
              <input
                ref={logoRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleLogoChange}
              />
            </div>
            <div className="flex-1 space-y-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Nom de l'entreprise</label>
                <Input value={form.nom_entreprise} onChange={(e) => setForm({ ...form, nom_entreprise: e.target.value })} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Slogan</label>
                <Input value={form.slogan} onChange={(e) => setForm({ ...form, slogan: e.target.value })} placeholder="Votre accroche..." />
              </div>
            </div>
          </div>

          {form.logo && (
            <Button variant="outline" size="sm" className="text-xs text-destructive" onClick={() => setForm({ ...form, logo: '' })}>
              Supprimer le logo
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Coordonnées */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="h-4 w-4" /> Coordonnées
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Adresse</label>
            <Input value={form.adresse} onChange={(e) => setForm({ ...form, adresse: e.target.value })} placeholder="Quartier, rue, n°..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Ville</label>
              <Input value={form.ville} onChange={(e) => setForm({ ...form, ville: e.target.value })} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Pays</label>
              <Input value={form.pays} onChange={(e) => setForm({ ...form, pays: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
                <Phone className="h-3.5 w-3.5" /> Téléphone
              </label>
              <Input value={form.telephone} onChange={(e) => setForm({ ...form, telephone: e.target.value })} placeholder="+241 ..." />
            </div>
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
                <Mail className="h-3.5 w-3.5" /> Email
              </label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
              <Globe className="h-3.5 w-3.5" /> Site web
            </label>
            <Input value={form.site_web} onChange={(e) => setForm({ ...form, site_web: e.target.value })} placeholder="https://..." />
          </div>
        </CardContent>
      </Card>

      {/* Informations légales */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings className="h-4 w-4" /> Informations légales & fiscales
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium">NIF</label>
              <Input value={form.nif} onChange={(e) => setForm({ ...form, nif: e.target.value })} placeholder="Numéro d'identification fiscale" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">RCCM</label>
              <Input value={form.rccm} onChange={(e) => setForm({ ...form, rccm: e.target.value })} placeholder="Registre de commerce" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Devise</label>
              <Input value={form.devise} onChange={(e) => setForm({ ...form, devise: e.target.value })} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">TVA (%)</label>
              <Input type="number" value={form.tva} onChange={(e) => setForm({ ...form, tva: e.target.value })} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bottom save */}
      <div className="flex justify-end pb-6">
        <Button size="lg" className="gap-2" onClick={handleSave}>
          <Save className="h-4 w-4" /> Enregistrer les paramètres
        </Button>
      </div>
    </div>
  );
}
