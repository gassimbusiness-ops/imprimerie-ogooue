import { createContext, useContext, useState, useEffect } from 'react';
import { db } from './db';
import { hashPassword, verifyPassword, generateSalt } from './crypto';
import { logAction } from './audit';

const AuthContext = createContext(null);

// Role permissions matrix — strict RBAC
const PERMISSIONS = {
  admin: {
    rapports: ['read', 'write', 'validate', 'delete'],
    statistiques: ['read'],
    pointage: ['read', 'write', 'manage'],
    employes: ['read', 'write', 'delete'],
    clients: ['read', 'write', 'delete'],
    catalogue: ['read', 'write'],
    stocks: ['read', 'write'],
    commandes: ['read', 'write'],
    devis_factures: ['read', 'write'],
    parametres: ['read', 'write'],
    finances: ['read', 'write'],
    gouvernance: ['read', 'write'],
  },
  manager: {
    rapports: ['read', 'write', 'validate'],
    statistiques: ['read'],
    pointage: ['read', 'write', 'manage'],
    employes: ['read'],
    clients: ['read', 'write'],
    catalogue: ['read', 'write'],
    stocks: ['read', 'write'],
    commandes: ['read', 'write'],
    devis_factures: ['read', 'write'],
    parametres: ['read'],
    finances: ['read'],
    gouvernance: ['read'],
  },
  employe: {
    rapports: ['read', 'write'],
    statistiques: [],
    pointage: ['read', 'self'],
    employes: [],
    clients: ['read'],
    catalogue: ['read'],
    stocks: ['read'],
    commandes: ['read', 'write'],
    devis_factures: [],
    parametres: [],
    finances: [],
    gouvernance: [],
  },
  associe: {
    rapports: [],
    statistiques: ['read'],
    pointage: [],
    employes: ['read'],
    clients: [],
    catalogue: ['read'],
    stocks: ['read'],
    commandes: [],
    devis_factures: [],
    parametres: [],
    finances: [],
    gouvernance: ['read'],
  },
  client: {
    rapports: [],
    statistiques: [],
    pointage: [],
    employes: [],
    clients: ['read', 'self'],
    catalogue: ['read'],
    stocks: [],
    commandes: ['read'],
    devis_factures: ['read'],
    parametres: [],
    finances: [],
    gouvernance: [],
  },
};

// Session timeout in ms (8 hours)
const SESSION_TIMEOUT = 8 * 60 * 60 * 1000;

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check for saved session
    const saved = localStorage.getItem('io_current_user');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Check session expiry
        if (parsed._loginAt && Date.now() - parsed._loginAt > SESSION_TIMEOUT) {
          localStorage.removeItem('io_current_user');
        } else {
          setUser(parsed);
        }
      } catch {}
    }
    setLoading(false);
  }, []);

  /**
   * Login with email + password.
   * Checks against hashed password stored in employee record.
   */
  const login = async (email, password) => {
    if (!email || !password) {
      return { error: 'Email et mot de passe requis' };
    }

    const employes = await db.employes.list();
    const found = employes.find(
      (e) => e.email?.toLowerCase() === email.toLowerCase()
    );
    if (!found) return { error: 'Identifiants incorrects' };

    // Verify password
    if (!found.password_hash || !found.password_salt) {
      return { error: 'Compte non activé. Contactez l\'administrateur.' };
    }

    const valid = await verifyPassword(password, found.password_hash, found.password_salt);
    if (!valid) return { error: 'Identifiants incorrects' };

    const userData = {
      id: found.id,
      nom: found.nom,
      prenom: found.prenom,
      email: found.email,
      telephone: found.telephone || '',
      role: found.role || 'employe',
      poste: found.poste,
      _loginAt: Date.now(),
    };
    setUser(userData);
    localStorage.setItem('io_current_user', JSON.stringify(userData));

    // Log login
    await logAction('login', 'auth', {
      entityId: found.id,
      entityLabel: `${found.prenom} ${found.nom}`,
      details: `Connexion: ${found.email} (${found.role})`,
    });

    return { success: true };
  };

  const logout = async () => {
    if (user) {
      await logAction('logout', 'auth', {
        entityId: user.id,
        entityLabel: `${user.prenom} ${user.nom}`,
        details: `Déconnexion: ${user.email}`,
      });
    }
    setUser(null);
    localStorage.removeItem('io_current_user');
  };

  /**
   * Change password for a user.
   * @param {string} userId
   * @param {string} newPassword
   */
  const changePassword = async (userId, newPassword) => {
    if (!newPassword || newPassword.length < 6) {
      return { error: 'Le mot de passe doit contenir au moins 6 caractères' };
    }
    const salt = generateSalt();
    const hash = await hashPassword(newPassword, salt);
    await db.employes.update(userId, {
      password_hash: hash,
      password_salt: salt,
      password_changed_at: new Date().toISOString(),
    });
    return { success: true };
  };

  /**
   * Create a user account with password.
   */
  const createUser = async (userData, password) => {
    const salt = generateSalt();
    const hash = await hashPassword(password, salt);
    const created = await db.employes.create({
      ...userData,
      password_hash: hash,
      password_salt: salt,
      password_changed_at: new Date().toISOString(),
    });
    return created;
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
    <AuthContext.Provider value={{
      user, loading, login, logout,
      hasPermission, isAdmin, isManager,
      changePassword, createUser,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
