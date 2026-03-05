import { useState, useEffect } from 'react';
import { db } from '@/services/db';
import { useAuth } from '@/services/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { User, Phone, Mail, Building2, Save } from 'lucide-react';
import { toast } from 'sonner';

export default function ClientProfil() {
  const { user } = useAuth();
  const [form, setForm] = useState({ nom: '', prenom: '', telephone: '', whatsapp: '', email: '', entreprise: '', adresse: '' });
  const [clientId, setClientId] = useState(null);

  useEffect(() => {
    (async () => {
      const clients = await db.clients.list();
      const match = clients.find((c) => c.email?.toLowerCase() === user?.email?.toLowerCase());
      if (match) {
        setClientId(match.id);
        setForm({
          nom: match.nom || '', prenom: match.prenom || '',
          telephone: match.telephone || '', whatsapp: match.whatsapp || match.telephone || '',
          email: match.email || '', entreprise: match.entreprise || '', adresse: match.adresse || '',
        });
      } else {
        setForm((f) => ({ ...f, nom: user?.nom || '', prenom: user?.prenom || '', email: user?.email || '' }));
      }
    })();
  }, [user]);

  const save = async () => {
    if (clientId) {
      await db.clients.update(clientId, form);
    } else {
      const c = await db.clients.create({ ...form, type: 'particulier', source: 'portail_client' });
      setClientId(c.id);
    }
    toast.success('Profil enregistré');
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Mon Profil</h1>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><User className="h-5 w-5 text-primary" /> Informations personnelles</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="mb-1 block text-sm font-medium">Prénom</label><Input value={form.prenom} onChange={(e) => setForm({ ...form, prenom: e.target.value })} /></div>
            <div><label className="mb-1 block text-sm font-medium">Nom</label><Input value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="mb-1 block text-sm font-medium flex items-center gap-1"><Phone className="h-3 w-3" /> Téléphone</label><Input value={form.telephone} onChange={(e) => setForm({ ...form, telephone: e.target.value })} placeholder="+241..." /></div>
            <div><label className="mb-1 block text-sm font-medium">WhatsApp</label><Input value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} placeholder="+241..." /></div>
          </div>
          <div><label className="mb-1 block text-sm font-medium flex items-center gap-1"><Mail className="h-3 w-3" /> Email</label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div><label className="mb-1 block text-sm font-medium flex items-center gap-1"><Building2 className="h-3 w-3" /> Entreprise</label><Input value={form.entreprise} onChange={(e) => setForm({ ...form, entreprise: e.target.value })} placeholder="Nom de votre entreprise (optionnel)" /></div>
          <div><label className="mb-1 block text-sm font-medium">Adresse</label><Input value={form.adresse} onChange={(e) => setForm({ ...form, adresse: e.target.value })} placeholder="Quartier, ville" /></div>
          <Button className="w-full gap-2" onClick={save}><Save className="h-4 w-4" /> Enregistrer</Button>
        </CardContent>
      </Card>
    </div>
  );
}
