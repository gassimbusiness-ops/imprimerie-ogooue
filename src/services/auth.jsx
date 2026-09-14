import { createContext, useContext, useState, useEffect } from 'react';
import { db } from './db';
import { hashPassword, verifyPassword, generateSalt } from './crypto';
import { logAction } from './audit';
import { enregistrerJeton, effacerJeton, apiFetch } from './api-client';

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
    marketing: ['read', 'write'],
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
    marketing: ['read', 'write'],
    parametres: ['read'],
    finances: ['read'],
    gouvernance: ['read'],
  },
  employe: {
    rapports: ['read', 'write'],
    statistiques: [],
    pointage: ['read', 'self'],
    employes: [],
    clients: ['read', 'write'],
    catalogue: ['read'],
    stocks: ['read'],
    commandes: ['read', 'write'],
    devis_factures: ['read', 'write'],
    marketing: [],
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
    marketing: [],
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
    marketing: [],
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

    // Verification cote serveur.
    //
    // Avant : `db.employes.list()` telechargeait toute la collection employes dans le
    // navigateur — salaires, telephones, empreintes de mots de passe et sels — AVANT
    // meme de verifier le mot de passe. Un simple essai de connexion, sans compte,
    // suffisait a exfiltrer le personnel entier.
    //
    // Maintenant : le serveur seul lit la table et ne renvoie que l'identite publique,
    // accompagnee d'un jeton de session signe que le navigateur ne peut pas fabriquer.
    let reponse;
    try {
      reponse = await fetch('/api/auth-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
    } catch {
      return { error: 'Connexion au serveur impossible. Verifiez votre reseau.' };
    }

    const resultat = await reponse.json().catch(() => ({}));
    if (!reponse.ok) {
      return { error: resultat.error || 'Identifiants incorrects' };
    }

    const found = resultat.user;
    enregistrerJeton(resultat.token);

    const userData = { ...found, _loginAt: Date.now() };
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
    effacerJeton();
  };

  /**
   * Change password for a user.
   * @param {string} userId
   * @param {string} newPassword
   */
  const changePassword = async (userId, newPassword) => {
    if (!newPassword || newPassword.length < 8) {
      return { error: 'Le mot de passe doit contenir au moins 8 caractères' };
    }
    // Ecriture cote serveur : le navigateur ne fabrique plus d'empreinte et ne peut
    // plus ecraser celle d'un autre compte. Le jeton signe decide qui a le droit.
    const res = await apiFetch('/api/auth-changer-mot-de-passe', {
      method: 'POST',
      body: JSON.stringify({ userId, nouveauMotDePasse: newPassword }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { error: json.error || 'Changement refuse' };
    return { success: true };
  };

  /**
   * Create a user account with password.
   */
  const createUser = async (userData, password) => {
    // Creation cote serveur.
    //
    // Le champ `role` envoye par le navigateur est IGNORE sans session administrateur :
    // le serveur force 'client'. C'est ce qui ferme la prise de controle — auparavant
    // n'importe qui pouvait s'inscrire avec role: 'admin' depuis le formulaire public.
    //
    // Ce chemin sert donc aux deux usages : inscription publique d'un client (sans
    // session) et creation par un administrateur (avec session).
    // Les champs metier (code de parrainage, type de client...) partent avec la creation :
    // un `update` separe echouerait, la modification d'un employe etant reservee aux admins.
    const extras = { ...userData };
    ['email', 'nom', 'prenom', 'telephone', 'poste', 'role'].forEach((k) => delete extras[k]);

    const res = await apiFetch('/api/auth-creer-utilisateur', {
      method: 'POST',
      body: JSON.stringify({
        email: userData.email,
        motDePasse: password,
        nom: userData.nom,
        prenom: userData.prenom,
        telephone: userData.telephone,
        poste: userData.poste,
        role: userData.role,
        extras,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Creation du compte refusee');

    return json.user;
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
