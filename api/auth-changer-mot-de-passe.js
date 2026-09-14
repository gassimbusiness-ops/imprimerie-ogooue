/**
 * Changement de mot de passe — cote serveur.
 *
 * Avant : `changePassword()` ecrivait password_hash et password_salt directement dans
 * la collection `employes` depuis le navigateur, avec la cle anon. N'importe qui
 * pouvait donc remplacer l'empreinte de n'importe quel compte et prendre sa place.
 *
 * Maintenant : l'ecriture passe par la cle service_role, et seul le titulaire du
 * compte — ou un administrateur — peut declencher le changement.
 */
import { supabaseAdmin } from './_lib/supabase-admin.js';
import { exigerSession, hacherMotDePasse, genererSel } from './_lib/session.js';
import { limiteDepassee } from './_lib/limite.js';

const LONGUEUR_MINI = 8; // aligne sur l'inscription publique ; l'app acceptait 6 ailleurs

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.APP_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Methode non autorisee' });
  if (limiteDepassee(req, { max: 10, fenetreMs: 60_000 })) {
    return res.status(429).json({ error: 'Trop de requetes' });
  }

  const session = exigerSession(req, res);
  if (!session) return;

  const { userId, nouveauMotDePasse } = req.body || {};
  const cible = userId || session.sub;

  // Un utilisateur ne peut changer que son propre mot de passe. Un admin peut agir sur
  // un autre compte — mais c'est le JETON SIGNE qui dit qu'il est admin, pas le client.
  if (cible !== session.sub && session.role !== 'admin') {
    return res.status(403).json({ error: 'Action non autorisee' });
  }

  if (!nouveauMotDePasse || String(nouveauMotDePasse).length < LONGUEUR_MINI) {
    return res.status(400).json({
      error: `Le mot de passe doit contenir au moins ${LONGUEUR_MINI} caracteres`,
    });
  }

  try {
    const sel = genererSel();
    const empreinte = hacherMotDePasse(nouveauMotDePasse, sel);

    const { error } = await supabaseAdmin()
      .from('auth_credentials')
      .upsert({
        employe_id: cible,
        password_hash: empreinte,
        password_salt: sel,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'employe_id' });

    if (error) throw new Error(error.message);
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[auth-changer-mot-de-passe]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
