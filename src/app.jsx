import { Routes, Route, Navigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/services/auth';
import AppLayout from '@/components/layout/app-layout';
import ClientLayout from '@/components/layout/client-layout';
import Login from '@/features/login/page';
import Dashboard from '@/features/dashboard/page';
import Rapports from '@/features/rapports/page';
import Commandes from '@/features/commandes/page';
import DevisFactures from '@/features/devis-factures/page';
import Clients from '@/features/clients/page';
import Employes from '@/features/employes/page';
import Pointage from '@/features/pointage/page';
import Stocks from '@/features/stocks/page';
import Statistiques from '@/features/statistiques/page';
import ClotureCaisse from '@/features/cloture-caisse/page';
import AuditLog from '@/features/audit/page';
import Paiements from '@/features/paiements/page';
import Notifications from '@/features/notifications/page';
import Parametres from '@/features/parametres/page';
// New modules
import Taches from '@/features/taches/page';
import Catalogue from '@/features/catalogue/page';
import Prospection from '@/features/prospection/page';
import Bilans from '@/features/bilans/page';
import Finances from '@/features/finances/page';
import Objectifs from '@/features/objectifs/page';
import DemandesRH from '@/features/demandes-rh/page';
import Travaux from '@/features/travaux/page';
import Evenements from '@/features/evenements/page';
import Messagerie from '@/features/messagerie/page';
import TarifsClients from '@/features/tarifs-clients/page';
import Gouvernance from '@/features/gouvernance/page';
import RapportsAnalyses from '@/features/rapports-analyses/page';
import PerformanceRH from '@/features/performance-rh/page';
import Marketing from '@/features/marketing/page';
// Client portal
import ClientDashboard from '@/features/client-portal/dashboard';
import ClientCatalogue from '@/features/client-portal/catalogue';
import ClientCommandes from '@/features/client-portal/commandes';
import ClientFactures from '@/features/client-portal/factures';
import ClientMessagerie from '@/features/client-portal/messagerie';
import ClientProfil from '@/features/client-portal/profil';
import { Toaster } from 'sonner';

function ProtectedRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  // Client role → redirect to client portal
  if (user.role === 'client') return <Navigate to="/client" replace />;

  return <AppLayout />;
}

function ProtectedClientRoutes() {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex h-screen items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return <ClientLayout />;
}

// Route guard: redirects to dashboard if user lacks permission
function RequirePermission({ module, children }) {
  const { hasPermission } = useAuth();
  if (!hasPermission(module, 'read')) {
    toast.error('Accès refusé');
    return <Navigate to="/" replace />;
  }
  return children;
}

export default function App() {
  const { user, loading } = useAuth();

  return (
    <>
      <Routes>
        <Route path="/login" element={
          loading ? null : user ? (user.role === 'client' ? <Navigate to="/client" replace /> : <Navigate to="/" replace />) : <Login />
        } />

        {/* Client portal — separate layout */}
        <Route path="/client" element={<ProtectedClientRoutes />}>
          <Route index element={<ClientDashboard />} />
          <Route path="catalogue" element={<ClientCatalogue />} />
          <Route path="commandes" element={<ClientCommandes />} />
          <Route path="factures" element={<ClientFactures />} />
          <Route path="messagerie" element={<ClientMessagerie />} />
          <Route path="profil" element={<ClientProfil />} />
        </Route>

        {/* Internal app */}
        <Route element={<ProtectedRoutes />}>
          <Route index element={<Dashboard />} />
          <Route path="rapports" element={<RequirePermission module="rapports"><Rapports /></RequirePermission>} />
          <Route path="commandes" element={<RequirePermission module="commandes"><Commandes /></RequirePermission>} />
          <Route path="devis-factures" element={<RequirePermission module="devis_factures"><DevisFactures /></RequirePermission>} />
          <Route path="clients" element={<RequirePermission module="clients"><Clients /></RequirePermission>} />
          <Route path="employes" element={<RequirePermission module="employes"><Employes /></RequirePermission>} />
          <Route path="pointage" element={<RequirePermission module="pointage"><Pointage /></RequirePermission>} />
          <Route path="stocks" element={<RequirePermission module="stocks"><Stocks /></RequirePermission>} />
          <Route path="statistiques" element={<RequirePermission module="statistiques"><Statistiques /></RequirePermission>} />
          <Route path="cloture-caisse" element={<RequirePermission module="statistiques"><ClotureCaisse /></RequirePermission>} />
          <Route path="paiements" element={<RequirePermission module="devis_factures"><Paiements /></RequirePermission>} />
          <Route path="notifications" element={<RequirePermission module="clients"><Notifications /></RequirePermission>} />
          <Route path="audit" element={<RequirePermission module="parametres"><AuditLog /></RequirePermission>} />
          <Route path="parametres" element={<RequirePermission module="parametres"><Parametres /></RequirePermission>} />
          {/* New modules */}
          <Route path="taches" element={<RequirePermission module="commandes"><Taches /></RequirePermission>} />
          <Route path="catalogue" element={<RequirePermission module="catalogue"><Catalogue /></RequirePermission>} />
          <Route path="prospection" element={<RequirePermission module="clients"><Prospection /></RequirePermission>} />
          <Route path="bilans" element={<RequirePermission module="statistiques"><Bilans /></RequirePermission>} />
          <Route path="finances" element={<RequirePermission module="finances"><Finances /></RequirePermission>} />
          <Route path="objectifs" element={<RequirePermission module="statistiques"><Objectifs /></RequirePermission>} />
          <Route path="demandes-rh" element={<RequirePermission module="employes"><DemandesRH /></RequirePermission>} />
          <Route path="travaux" element={<RequirePermission module="statistiques"><Travaux /></RequirePermission>} />
          <Route path="evenements" element={<RequirePermission module="clients"><Evenements /></RequirePermission>} />
          <Route path="messagerie" element={<RequirePermission module="clients"><Messagerie /></RequirePermission>} />
          <Route path="tarifs-clients" element={<RequirePermission module="clients"><TarifsClients /></RequirePermission>} />
          <Route path="gouvernance" element={<RequirePermission module="gouvernance"><Gouvernance /></RequirePermission>} />
          <Route path="rapports-analyses" element={<RequirePermission module="statistiques"><RapportsAnalyses /></RequirePermission>} />
          <Route path="performance-rh" element={<RequirePermission module="employes"><PerformanceRH /></RequirePermission>} />
          <Route path="marketing" element={<RequirePermission module="clients"><Marketing /></RequirePermission>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster position="top-right" richColors closeButton />
    </>
  );
}
