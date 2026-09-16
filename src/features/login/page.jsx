import { useState } from 'react';
import { useAuth } from '@/services/auth';
import { db } from '@/services/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Loader2, AlertCircle, Eye, EyeOff, Lock, Mail,
  UserPlus, ArrowLeft, Phone, Building2, Gift, CheckCircle,
} from 'lucide-react';
import { toast } from 'sonner';

export default function Login() {
  const { login, createUser } = useAuth();
  const [mode, setMode] = useState('login'); // 'login' | 'register'

  // Login state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Register state
  const [reg, setReg] = useState({
    prenom: '',
    nom: '',
    email: '',
    password: '',
    confirmPassword: '',
    telephone: '',
    type: 'particulier',
    entreprise: '',
    codeParrainage: '',
  });
  const [regError, setRegError] = useState('');
  const [regLoading, setRegLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    if (!email.trim()) { setError('Veuillez entrer votre email'); return; }
    if (!password) { setError('Veuillez entrer votre mot de passe'); return; }
    setLoading(true);
    const result = await login(email.trim(), password);
    setLoading(false);
    if (result.error) setError(result.error);
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setRegError('');

    // Validation
    if (!reg.prenom.trim() || !reg.nom.trim()) { setRegError('Prénom et nom requis'); return; }
    if (!reg.email.trim()) { setRegError('Email requis'); return; }
    if (!reg.email.includes('@')) { setRegError('Format email invalide'); return; }
    if (!reg.password || reg.password.length < 8) { setRegError('Mot de passe requis (min 8 caractères)'); return; }
    if (reg.password !== reg.confirmPassword) { setRegError('Les mots de passe ne correspondent pas'); return; }
    if (!reg.telephone.trim()) { setRegError('Numéro de téléphone requis'); return; }
    const tel = reg.telephone.replace(/\s/g, '');
    if (!/^(\+241)?(06|07)\d{6,7}$/.test(tel) && !/^(06|07)\d{6,7}$/.test(tel)) {
      setRegError('Format téléphone invalide (06x ou 07x attendu)');
      return;
    }
    if (reg.type === 'entreprise' && !reg.entreprise.trim()) { setRegError('Nom entreprise requis pour le type Entreprise'); return; }

    setRegLoading(true);

    try {
      // Unicite de l'email verifiee cote serveur.
      // Avant : db.employes.list() telechargeait toute la table des employes
      // (salaires, empreintes de mots de passe) dans le navigateur d'un visiteur
      // non authentifie, simplement parce qu'il ouvrait l'onglet "Creer un compte".
      const dispo = await fetch('/api/auth-email-disponible', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: reg.email.trim() }),
      }).then((r) => r.json()).catch(() => null);

      if (!dispo) {
        setRegError('Verification impossible. Reessayez.');
        setRegLoading(false);
        return;
      }
      if (!dispo.disponible) {
        setRegError('Un compte avec cet email existe déjà');
        setRegLoading(false);
        return;
      }

      // Generate unique referral code
      const codeParrainage = `IMPR-${reg.prenom.toUpperCase().slice(0, 4)}${Math.floor(Math.random() * 900 + 100)}`;

      // Create the client user
      const userData = {
        prenom: reg.prenom.trim(),
        nom: reg.nom.trim(),
        email: reg.email.toLowerCase().trim(),
        telephone: reg.telephone.trim(),
        role: 'client',
        poste: 'Client',
        type_client: reg.type,
        entreprise_client: reg.type === 'entreprise' ? reg.entreprise.trim() : '',
        code_parrainage: codeParrainage,
        parraine_par: reg.codeParrainage.trim() || null,
        actif: true,
        date_inscription: new Date().toISOString(),
      };

      const created = await createUser(userData, reg.password);

      // ══════════════════════════════════════════════════════════════════════
      //  APRES CE POINT, LE COMPTE EXISTE : PLUS RIEN NE DOIT POUVOIR ECHOUER
      //  D'UNE FACON QUI EMPECHE LA CONNEXION.
      // ══════════════════════════════════════════════════════════════════════
      //
      // Constat C8 / 9.1 de l'audit VAGUE 2. Cette fonction contenait :
      //
      //     const parrain = existing.find((e) => e.code_parrainage === ...);
      //
      // ou `existing` n'etait DECLARE NULLE PART — le `db.employes.list()` qui
      // l'alimentait avait ete retire pour raison de securite (il telechargeait
      // les salaires de toute l'equipe dans le navigateur d'un visiteur non
      // authentifie). Le `ReferenceError` partait APRES `createUser` et APRES
      // la fiche fidelite, mais AVANT `db.clients.create` et l'auto-connexion.
      //
      // Ce que vivait le client : il saisit le code que son ami lui a donne, on
      // lui dit « erreur, reessayez », il reessaie, on lui dit « un compte avec
      // cet email existe deja » — et il ne peut jamais se connecter. Sa fiche
      // client n'existe pas, et le gerant voit un compte fantome.
      //
      // Deux corrections :
      //   1. La fiche client est creee AVANT tout le reste : c'est la donnee
      //      essentielle, elle ne doit dependre d'aucun confort.
      //   2. Chaque etape de confort est isolee dans son propre try/catch et
      //      ne peut plus casser l'inscription. Meme regle que l'amorcage de
      //      main.jsx depuis l'incident du 14/09.
      //
      // Le parrainage : la recherche du parrain ne peut PAS se faire ici sans
      // reintroduire la fuite de donnees qu'on venait de fermer (il faudrait
      // lister tous les comptes depuis un navigateur non authentifie). Le code
      // saisi est donc simplement CONSERVE — sur le compte (`parraine_par`) et
      // sur la fiche client — et le bonus est attribue a la premiere livraison
      // par `crediterPointsFidelite()` dans l'ecran Commandes, qui tourne, lui,
      // dans une session authentifiee.

      // ── Essentiel : la fiche client ──
      await db.clients.create({
        nom: `${reg.prenom.trim()} ${reg.nom.trim()}`,
        email: reg.email.toLowerCase().trim(),
        telephone: reg.telephone.trim(),
        type: reg.type,
        entreprise: reg.type === 'entreprise' ? reg.entreprise.trim() : '',
        source: 'inscription_portail',
        user_id: created.id,
        // Ces deux champs sont lus par crediterPointsFidelite() a la premiere
        // livraison. Sans eux, le parrainage restait definitivement muet.
        code_parrainage: codeParrainage,
        parraine_par: reg.codeParrainage.trim() || null,
      });

      // ── Confort 1 : fiche fidelite ──
      try {
        await db.fidelite_clients.create({
          client_id: created.id,
          client_nom: `${reg.prenom.trim()} ${reg.nom.trim()}`,
          points_actuels: 50,
          niveau: 'bronze',
          code_parrainage: codeParrainage,
          parraine_par: reg.codeParrainage.trim() || null,
          total_points_gagnes: 50,
          parrainages: [],
          historique: [{
            type: 'inscription_complete',
            points: 50,
            description: 'Bonus inscription',
            date: new Date().toISOString(),
          }],
        });
      } catch (err) {
        console.error('[inscription] fiche fidelite non creee :', err?.message || err);
      }

      // ── Confort 2 : notification de l'administrateur ──
      try {
        await db.notifications_app.create({
          type: 'nouveau_client',
          titre: '👤 Nouveau client inscrit',
          message: `${reg.prenom.trim()} ${reg.nom.trim()} — ${reg.telephone.trim()}`
            + (reg.codeParrainage.trim() ? ` — parrainé par le code ${reg.codeParrainage.trim()}` : ''),
          destinataire: 'admin',
          lu: false,
        });
      } catch (err) {
        console.error('[inscription] notification admin non creee :', err?.message || err);
      }

      toast.success('Compte créé avec succès ! Connexion en cours...');

      // Auto-login
      const loginResult = await login(reg.email.toLowerCase().trim(), reg.password);
      if (loginResult.error) {
        setRegError('Compte créé mais erreur de connexion. Essayez de vous connecter manuellement.');
      }
    } catch (err) {
      console.error('Registration error:', err);
      setRegError('Erreur lors de la création du compte. Veuillez réessayer.');
    }

    setRegLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 via-white to-blue-50 px-4 py-8">
      <div className="w-full max-w-sm space-y-6">
        {/* Logo */}
        <div className="text-center">
          <img src="/logo.png" alt="Imprimerie Ogooué" className="mx-auto h-28 w-28 object-contain drop-shadow-md" />
          <h1 className="mt-3 text-2xl font-bold text-foreground">
            Imprimerie Ogooué
          </h1>
          <p className="text-sm text-muted-foreground">
            {mode === 'login'
              ? 'Connectez-vous pour accéder à la gestion'
              : 'Créez votre compte client'
            }
          </p>
        </div>

        {/* ── LOGIN FORM ── */}
        {mode === 'login' && (
          <Card className="shadow-lg">
            <CardContent className="p-6">
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email" className="flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5" /> Adresse email
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="votre.email@exemple.com"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setError(''); }}
                    autoFocus
                    autoComplete="email"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password" className="flex items-center gap-1.5">
                    <Lock className="h-3.5 w-3.5" /> Mot de passe
                  </Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); setError(''); }}
                      autoComplete="current-password"
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {error}
                  </div>
                )}

                <Button type="submit" className="w-full gap-2" size="lg" disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                  Se connecter
                </Button>
              </form>

              {/* Register CTA */}
              <div className="mt-4 border-t pt-4 text-center">
                <p className="text-xs text-muted-foreground mb-2">Pas encore de compte ?</p>
                <Button
                  variant="outline"
                  className="w-full gap-2"
                  onClick={() => { setMode('register'); setError(''); }}
                >
                  <UserPlus className="h-4 w-4" />
                  Créer mon compte client
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── REGISTER FORM ── */}
        {mode === 'register' && (
          <Card className="shadow-lg">
            <CardContent className="p-6">
              <form onSubmit={handleRegister} className="space-y-3">
                <button
                  type="button"
                  onClick={() => { setMode('login'); setRegError(''); }}
                  className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Retour à la connexion
                </button>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Prénom *</Label>
                    <Input
                      placeholder="Prénom"
                      value={reg.prenom}
                      onChange={(e) => setReg({ ...reg, prenom: e.target.value })}
                      autoFocus
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Nom *</Label>
                    <Input
                      placeholder="Nom"
                      value={reg.nom}
                      onChange={(e) => setReg({ ...reg, nom: e.target.value })}
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-xs flex items-center gap-1">
                    <Mail className="h-3 w-3" /> Email *
                  </Label>
                  <Input
                    type="email"
                    placeholder="votre.email@exemple.com"
                    value={reg.email}
                    onChange={(e) => setReg({ ...reg, email: e.target.value })}
                  />
                </div>

                <div>
                  <Label className="text-xs flex items-center gap-1">
                    <Lock className="h-3 w-3" /> Mot de passe * (min 8 caractères)
                  </Label>
                  <Input
                    type="password"
                    placeholder="••••••••"
                    value={reg.password}
                    onChange={(e) => setReg({ ...reg, password: e.target.value })}
                  />
                </div>
                <div>
                  <Label className="text-xs">Confirmer le mot de passe *</Label>
                  <Input
                    type="password"
                    placeholder="••••••••"
                    value={reg.confirmPassword}
                    onChange={(e) => setReg({ ...reg, confirmPassword: e.target.value })}
                  />
                </div>

                <div>
                  <Label className="text-xs flex items-center gap-1">
                    <Phone className="h-3 w-3" /> Téléphone * (format Gabon)
                  </Label>
                  <Input
                    placeholder="06x xxx xxxx ou 07x xxx xxxx"
                    value={reg.telephone}
                    onChange={(e) => setReg({ ...reg, telephone: e.target.value })}
                  />
                </div>

                <div>
                  <Label className="text-xs flex items-center gap-1">
                    <Building2 className="h-3 w-3" /> Type de client
                  </Label>
                  <Select value={reg.type} onValueChange={(v) => setReg({ ...reg, type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="particulier">Particulier</SelectItem>
                      <SelectItem value="entreprise">Entreprise</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {reg.type === 'entreprise' && (
                  <div>
                    <Label className="text-xs">Nom de l'entreprise *</Label>
                    <Input
                      placeholder="Nom de votre entreprise"
                      value={reg.entreprise}
                      onChange={(e) => setReg({ ...reg, entreprise: e.target.value })}
                    />
                  </div>
                )}

                <div>
                  <Label className="text-xs flex items-center gap-1">
                    <Gift className="h-3 w-3" /> Code de parrainage (optionnel)
                  </Label>
                  <Input
                    placeholder="Ex: IMPR-JEAN123"
                    value={reg.codeParrainage}
                    onChange={(e) => setReg({ ...reg, codeParrainage: e.target.value.toUpperCase() })}
                  />
                </div>

                {regError && (
                  <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {regError}
                  </div>
                )}

                <Button type="submit" className="w-full gap-2" size="lg" disabled={regLoading}>
                  {regLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                  Créer mon compte
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Footer */}
        <p className="text-center text-[11px] text-muted-foreground">
          Imprimerie OGOOUÉ — Moanda, Gabon<br />
          {mode === 'login'
            ? 'Contactez l\'administrateur pour obtenir vos identifiants'
            : 'En créant un compte, vous accédez au portail client'
          }
        </p>
      </div>
    </div>
  );
}
