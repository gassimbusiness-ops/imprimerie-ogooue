/**
 * Connexion cote serveur.
 *
 * AVANT : le navigateur telechargeait TOUTE la collection `employes` — salaires,
 * telephones, empreintes de mots de passe et sels — puis comparait le mot de passe
 * localement. Un simple essai de connexion suffisait a exfiltrer le personnel entier.
 *
 * MAINTENANT : le navigateur envoie email + mot de passe. Le serveur seul lit la table
 * (cle service_role), verifie l'empreinte, et ne renvoie que le strict necessaire,
 * accompagne d'un jeton de session signe.
 *
 * L'algorithme de hachage est INCHANGE (SHA-256 de sel+mot_de_passe, hexadecimal) :
 * les mots de passe existants continuent de fonctionner, personne n'a a le reinitialiser.
 */
import { lireCollection, supabaseAdmin } from './_lib/supabase-admin.js';
import { signerSession, hacherMotDePasse, empreintesEgales } from './_lib/session.js';
import { limiteDepassee } from './_lib/limite.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.APP_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Methode non autorisee' });

  // 10 tentatives par minute et par IP : bloque le bourrage d'identifiants.
  if (limiteDepassee(req, { max: 10, fenetreMs: 60_000 })) {
    return res.status(429).json({ error: 'Trop de tentatives. Reessayez dans une minute.' });
  }

  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email et mot de passe requis' });
  }

  try {
    const employes = await lireCollection('employes');
    const trouve = employes.find(
      (e) => (e.email || '').toLowerCase().trim() === String(email).toLowerCase().trim(),
    );

    // Message identique que le compte existe ou non : ne pas reveler quels emails sont connus.
    const echec = () => res.status(401).json({ error: 'Identifiants incorrects' });

    if (!trouve) return echec();

    // Les identifiants vivent dans la table `auth_credentials`, inaccessible a la cle
    // anon. Tant que la migration 001 n'est pas appliquee, ils sont encore inline dans
    // l'enregistrement employe : on accepte les deux, pour que le deploiement du code
    // et l'application de la migration puissent se faire dans n'importe quel ordre.
    let empreinte = trouve.password_hash;
    let sel = trouve.password_salt;

    try {
      const { data } = await supabaseAdmin()
        .from('auth_credentials')
        .select('password_hash, password_salt')
        .eq('employe_id', trouve.id)
        .maybeSingle();
      if (data?.password_hash && data?.password_salt) {
        empreinte = data.password_hash;
        sel = data.password_salt;
      }
    } catch {
      // table absente avant migration : on garde les champs inline
    }

    if (!empreinte || !sel) return echec();

    const calcule = hacherMotDePasse(password, sel);
    if (!empreintesEgales(calcule, empreinte)) return echec();

    // Seuls ces champs quittent le serveur. Ni empreinte, ni sel, ni salaire.
    const utilisateur = {
      id: trouve.id,
      nom: trouve.nom,
      prenom: trouve.prenom,
      email: trouve.email,
      telephone: trouve.telephone || '',
      role: trouve.role || 'employe',
      poste: trouve.poste || '',
    };

    return res.status(200).json({
      user: utilisateur,
      token: signerSession({ id: utilisateur.id, role: utilisateur.role }),
    });
  } catch (err) {
    console.error('[auth-login]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
