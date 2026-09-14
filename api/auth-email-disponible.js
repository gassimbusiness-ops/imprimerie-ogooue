/**
 * Verifie si un email est deja utilise — sans exposer la liste des comptes.
 *
 * AVANT : le formulaire d'inscription publique appelait `db.employes.list()` pour
 * tester l'unicite, ce qui telechargeait toute la table dans le navigateur d'un
 * visiteur non authentifie.
 *
 * MAINTENANT : le serveur repond par un simple booleen.
 */
import { lireCollection } from './_lib/supabase-admin.js';
import { limiteDepassee } from './_lib/limite.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.APP_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Methode non autorisee' });

  if (limiteDepassee(req, { max: 20, fenetreMs: 60_000 })) {
    return res.status(429).json({ error: 'Trop de requetes' });
  }

  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email requis' });

  try {
    const employes = await lireCollection('employes');
    const pris = employes.some(
      (e) => (e.email || '').toLowerCase().trim() === String(email).toLowerCase().trim(),
    );
    return res.status(200).json({ disponible: !pris });
  } catch (err) {
    console.error('[auth-email-disponible]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
