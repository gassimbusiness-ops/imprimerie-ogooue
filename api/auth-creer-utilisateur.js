/**
 * Creation d'un compte — cote serveur.
 *
 * Deux usages, deux niveaux d'autorisation :
 *  - inscription publique d'un CLIENT : sans session, role force a 'client'
 *  - creation par un ADMIN : session admin requise, role libre
 *
 * Avant : `createUser()` ecrivait directement dans `employes` depuis le navigateur.
 * Le role venait du client, donc n'importe qui pouvait s'inscrire administrateur.
 * C'est le chemin de prise de controle que ferme ce fichier.
 */
import { supabaseAdmin, lireCollection } from './_lib/supabase-admin.js';
import { sessionDepuisRequete, hacherMotDePasse, genererSel } from './_lib/session.js';
import { limiteDepassee } from './_lib/limite.js';
import crypto from 'node:crypto';

const ROLES_CONNUS = ['admin', 'manager', 'employe', 'associe', 'client'];
const LONGUEUR_MINI = 8;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.APP_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Methode non autorisee' });
  if (limiteDepassee(req, { max: 5, fenetreMs: 60_000 })) {
    return res.status(429).json({ error: 'Trop de requetes' });
  }

  const session = sessionDepuisRequete(req);
  const estAdmin = session?.role === 'admin';

  const { email, motDePasse, nom, prenom, telephone, poste, role, extras } = req.body || {};

  if (!email || !motDePasse || !nom) {
    return res.status(400).json({ error: 'Email, mot de passe et nom requis' });
  }
  if (String(motDePasse).length < LONGUEUR_MINI) {
    return res.status(400).json({
      error: `Le mot de passe doit contenir au moins ${LONGUEUR_MINI} caracteres`,
    });
  }

  // LE POINT CENTRAL : sans session admin, le role est impose a 'client'.
  // Le champ `role` du corps de requete est ignore.
  let roleFinal = 'client';
  if (estAdmin) {
    roleFinal = ROLES_CONNUS.includes(role) ? role : 'employe';
  }

  // `extras` ne doit jamais transporter d'identifiants ni de role.
  if (extras && typeof extras === 'object') {
    for (const interdit of ['password_hash', 'password_salt', 'role', 'id']) delete extras[interdit];
  }

  try {
    const employes = await lireCollection('employes');
    const emailNormalise = String(email).toLowerCase().trim();
    if (employes.some((e) => (e.email || '').toLowerCase().trim() === emailNormalise)) {
      return res.status(409).json({ error: 'Un compte avec cet email existe deja' });
    }

    const id = crypto.randomUUID();
    const maintenant = new Date().toISOString();
    const sel = genererSel();
    const empreinte = hacherMotDePasse(motDePasse, sel);

    // L'enregistrement employe ne contient NI empreinte NI sel : ils vivent
    // dans auth_credentials, hors de portee de la cle anon.
    const { error: e1 } = await supabaseAdmin().from('app_data').insert({
      id,
      collection: 'employes',
      data: {
        // Champs metier libres (code de parrainage, type de client, etc.).
        // Poses EN PREMIER pour que les champs d'identite ci-dessous les ecrasent :
        // un client ne doit pas pouvoir se donner un role via `extras`.
        ...(typeof extras === 'object' && extras ? extras : {}),
        id,
        email: emailNormalise,
        nom,
        prenom: prenom || '',
        telephone: telephone || '',
        poste: poste || '',
        role: roleFinal,
        created_at: maintenant,
        updated_at: maintenant,
      },
    });
    if (e1) throw new Error(e1.message);

    const { error: e2 } = await supabaseAdmin().from('auth_credentials').insert({
      employe_id: id,
      password_hash: empreinte,
      password_salt: sel,
    });
    if (e2) throw new Error(e2.message);

    return res.status(201).json({
      user: { id, email: emailNormalise, nom, prenom: prenom || '', role: roleFinal },
    });
  } catch (err) {
    console.error('[auth-creer-utilisateur]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
