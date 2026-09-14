/**
 * Client Supabase de service — SERVEUR UNIQUEMENT.
 *
 * La clé `service_role` contourne les policies RLS. Elle ne doit JAMAIS être préfixée
 * `VITE_`, sinon Vite l'inline dans le bundle envoyé au navigateur et l'application
 * entière devient publique en écriture.
 *
 * À configurer dans Vercel : SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from '@supabase/supabase-js';

let client = null;

export function supabaseAdmin() {
  if (client) return client;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absent cote serveur');
  }
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

/** Lit une collection de app_data et renvoie les objets `data`. */
/**
 * ⚠️ LE `.order()` CI-DESSOUS N'EST PAS COSMETIQUE — IL EST LA CONDITION DE LA CONNEXION.
 *
 * La base contient des comptes EN DOUBLE, constate le 14/09/2026 :
 * `imprimerieogooue@gmail.com` existe 3 fois en role admin, avec 3 empreintes
 * differentes (chaque enregistrement porte son propre sel, donc un meme mot de passe
 * produit 3 empreintes distinctes). Idem pour 2 autres adresses.
 *
 * `auth-login` fait un `.find()` sur l'email : il retient donc LE PREMIER de la liste.
 * Le client historique (`src/services/db.js`) lisait avec
 * `.order('created_at', { ascending: true })` — il tombait donc TOUJOURS sur le plus
 * ancien. Sans tri ici, Postgres renvoie les lignes dans un ordre non garanti : la
 * connexion aurait reussi ou echoue au hasard, sans qu'on puisse le reproduire.
 *
 * Ce tri reproduit exactement le comportement historique. Ne pas le retirer avant
 * d'avoir dedoublonne les comptes — et le dedoublonnage est une decision metier
 * (lequel des 3 mots de passe est le bon ?), pas un nettoyage technique.
 */
export async function lireCollection(nom) {
  const { data, error } = await supabaseAdmin()
    .from('app_data')
    .select('id, data')
    .eq('collection', nom)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map((r) => r.data);
}
