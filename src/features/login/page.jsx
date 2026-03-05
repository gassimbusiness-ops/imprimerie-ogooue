import { useState } from 'react';
import { useAuth } from '@/services/auth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Printer, Loader2, AlertCircle } from 'lucide-react';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!email.trim()) {
      setError('Veuillez entrer votre email');
      return;
    }
    setLoading(true);
    const result = await login(email.trim());
    setLoading(false);
    if (result.error) setError(result.error);
  };

  const quickLogin = async (email) => {
    setEmail(email);
    setLoading(true);
    setError('');
    const result = await login(email);
    setLoading(false);
    if (result.error) setError(result.error);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 via-white to-blue-50 px-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Logo */}
        <div className="text-center">
          <img src="/logo.png" alt="Imprimerie Ogooué" className="mx-auto h-28 w-28 object-contain" />
          <h1 className="mt-2 text-2xl font-bold text-foreground">
            Imprimerie Ogooué
          </h1>
          <p className="text-sm text-muted-foreground">
            Connectez-vous pour accéder à la gestion
          </p>
        </div>

        {/* Login form */}
        <Card>
          <CardContent className="p-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Adresse email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="votre.email@imprimerie-ogooue.ga"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(''); }}
                  autoFocus
                  autoComplete="email"
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}

              <Button type="submit" className="w-full gap-2" size="lg" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Se connecter
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Quick login (dev mode) */}
        <Card>
          <CardContent className="p-4">
            <p className="mb-3 text-center text-xs font-medium text-muted-foreground">
              Connexion rapide
            </p>
            <div className="space-y-2">
              <button
                onClick={() => quickLogin('jp.moussavou@imprimerie-ogooue.ga')}
                className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-700">
                  JP
                </div>
                <div>
                  <p className="text-sm font-medium">Jean-Pierre Moussavou</p>
                  <p className="text-xs text-muted-foreground">Administrateur</p>
                </div>
              </button>
              <button
                onClick={() => quickLogin('marie.nze@imprimerie-ogooue.ga')}
                className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">
                  MN
                </div>
                <div>
                  <p className="text-sm font-medium">Marie Nzé</p>
                  <p className="text-xs text-muted-foreground">Manager</p>
                </div>
              </button>
              <button
                onClick={() => quickLogin('patrick.obiang@imprimerie-ogooue.ga')}
                className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-700">
                  PO
                </div>
                <div>
                  <p className="text-sm font-medium">Patrick Obiang</p>
                  <p className="text-xs text-muted-foreground">Employé</p>
                </div>
              </button>
              <button
                onClick={() => quickLogin('client.test@gmail.com')}
                className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">
                  CT
                </div>
                <div>
                  <p className="text-sm font-medium">Client Test</p>
                  <p className="text-xs text-muted-foreground">Client (Portail externe)</p>
                </div>
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
