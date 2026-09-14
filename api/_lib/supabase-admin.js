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
export async function lireCollection(nom) {
  const { data, error } = await supabaseAdmin()
    .from('app_data')
    .select('id, data')
    .eq('collection', nom);
  if (error) throw new Error(error.message);
  return (data || []).map((r) => r.data);
}
