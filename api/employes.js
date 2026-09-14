/**
 * Acces a la collection `employes` — filtre par role, cote serveur.
 *
 * POURQUOI
 * 13 ecrans appelaient `db.employes.list()`, ce qui rapatriait dans le navigateur de
 * chaque utilisateur — quel que soit son role — la table complete du personnel :
 * salaires, telephones, et (avant la migration 001) empreintes de mots de passe.
 * Le filtrage n'existait qu'a l'affichage, en React : la donnee etait deja partie.
 *
 * Ici le filtrage est fait AVANT l'envoi, selon le role inscrit dans le jeton signe.
 * Un employe ne recoit jamais le salaire d'un collegue, meme s'il inspecte le reseau.
 */
import { supabaseAdmin, lireCollection } from './_lib/supabase-admin.js';
import { exigerSession } from './_lib/session.js';
import { limiteDepassee } from './_lib/limite.js';

/** Champs visibles par tous les utilisateurs authentifies : l'annuaire interne. */
const CHAMPS_PUBLICS = ['id', 'nom', 'prenom', 'email', 'telephone', 'poste', 'role', 'actif'];

/** Champs reserves aux administrateurs. */
const CHAMPS_SENSIBLES = ['salaire_base', 'date_entree', 'date_naissance', 'adresse', 'cnss'];

/** Ne sortent JAMAIS, quel que soit le role. */
const CHAMPS_INTERDITS = ['password_hash', 'password_salt', 'password_changed_at'];

function filtrer(employe, role) {
  const champs = role === 'admin' ? [...CHAMPS_PUBLICS, ...CHAMPS_SENSIBLES] : CHAMPS_PUBLICS;
  const sortie = {};
  for (const c of champs) {
    if (employe[c] !== undefined) sortie[c] = employe[c];
  }
  for (const interdit of CHAMPS_INTERDITS) delete sortie[interdit];
  return sortie;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.APP_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (limiteDepassee(req, { max: 60, fenetreMs: 60_000 })) {
    return res.status(429).json({ error: 'Trop de requetes' });
  }

  const session = exigerSession(req, res);
  if (!session) return;
  const estAdmin = session.role === 'admin';

  try {
    // ── LECTURE ──
    if (req.method === 'GET') {
      const employes = await lireCollection('employes');
      return res.status(200).json({ employes: employes.map((e) => filtrer(e, session.role)) });
    }

    // ── ECRITURES : administrateur uniquement ──
    if (!estAdmin) return res.status(403).json({ error: 'Action reservee a un administrateur' });

    if (req.method === 'POST') {
      const data = req.body?.data || {};
      // Les identifiants ne transitent jamais par ce chemin : voir auth-creer-utilisateur.
      for (const c of CHAMPS_INTERDITS) delete data[c];
      const id = data.id || crypto.randomUUID();
      const maintenant = new Date().toISOString();
      const { error } = await supabaseAdmin().from('app_data').insert({
        id, collection: 'employes',
        data: { ...data, id, created_at: maintenant, updated_at: maintenant },
      });
      if (error) throw new Error(error.message);
      return res.status(201).json({ id });
    }

    if (req.method === 'PATCH') {
      const { id, data } = req.body || {};
      if (!id) return res.status(400).json({ error: 'Identifiant requis' });
      for (const c of CHAMPS_INTERDITS) delete data?.[c];

      const { data: existant } = await supabaseAdmin()
        .from('app_data').select('data').eq('id', id).eq('collection', 'employes').maybeSingle();
      if (!existant) return res.status(404).json({ error: 'Employe introuvable' });

      const { error } = await supabaseAdmin().from('app_data')
        .update({ data: { ...existant.data, ...data, id, updated_at: new Date().toISOString() } })
        .eq('id', id).eq('collection', 'employes');
      if (error) throw new Error(error.message);
      return res.status(200).json({ success: true });
    }

    if (req.method === 'DELETE') {
      const id = req.query?.id || req.body?.id;
      if (!id) return res.status(400).json({ error: 'Identifiant requis' });
      if (id === session.sub) {
        return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte' });
      }
      await supabaseAdmin().from('auth_credentials').delete().eq('employe_id', id);
      const { error } = await supabaseAdmin().from('app_data')
        .delete().eq('id', id).eq('collection', 'employes');
      if (error) throw new Error(error.message);
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Methode non autorisee' });
  } catch (err) {
    console.error('[employes]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
