import { createContext, useContext, useState, useEffect } from 'react';
import { db } from './db';

const AuthContext = createContext(null);

// Role permissions matrix — strict RBAC
const PERMISSIONS = {
  admin: {
    rapports: ['read', 'write', 'validate', 'delete'],
    statistiques: ['read'],
    pointage: ['read', 'write', 'manage'],
    employes: ['read', 'write', 'delete'],
    clients: ['read', 'write', 'delete'],
    stocks: ['read', 'write'],
    commandes: ['read', 'write'],
    devis_factures: ['read', 'write'],
    parametres: ['read', 'write'],
  },
  manager: {
    rapports: ['read', 'write', 'validate'],
    statistiques: ['read'],
    pointage: ['read', 'write', 'manage'],
    employes: ['read'],
    clients: ['read', 'write'],
    stocks: ['read', 'write'],
    commandes: ['read', 'write'],
    devis_factures: ['read', 'write'],
    parametres: ['read'],
  },
  employe: {
    rapports: ['read', 'write'],
    statistiques: [],
    pointage: ['read', 'self'],
    employes: [],
    clients: ['read'],
    stocks: ['read'],
    commandes: ['read', 'write'],
    devis_factures: [],
    parametres: [],
  },
  client: {
    rapports: [],
    statistiques: [],
    pointage: [],
    employes: [],
    clients: ['read', 'self'],
    stocks: [],
    commandes: ['read'],
    devis_factures: ['read'],
    parametres: [],
  },
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check for saved session
    const saved = localStorage.getItem('io_current_user');
    if (saved) {
      try {
        setUser(JSON.parse(saved));
      } catch {}
    }
    setLoading(false);
  }, []);

  const login = async (email) => {
    const employes = await db.employes.list();
    const found = employes.find(
      (e) => e.email?.toLowerCase() === email.toLowerCase()
    );
    if (!found) return { error: 'Aucun employé trouvé avec cet email' };

    const userData = {
      id: found.id,
      nom: found.nom,
      prenom: found.prenom,
      email: found.email,
      role: found.role || 'employe',
      poste: found.poste,
    };
    setUser(userData);
    localStorage.setItem('io_current_user', JSON.stringify(userData));
    return { success: true };
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('io_current_user');
  };

  const hasPermission = (module, action = 'read') => {
    if (!user) return false;
    const rolePerms = PERMISSIONS[user.role];
    if (!rolePerms) return false;
    const modulePerms = rolePerms[module];
    if (!modulePerms) return false;
    return modulePerms.includes(action);
  };

  const isAdmin = user?.role === 'admin';
  const isManager = user?.role === 'manager' || isAdmin;

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, hasPermission, isAdmin, isManager }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
