/**
 * Client Supabase — persistance centralisée.
 *
 * Configuration :
 * 1. Créer un projet sur https://supabase.com
 * 2. Exécuter supabase-schema.sql dans l'éditeur SQL
 * 3. Copier URL + anon key dans .env (ou Vercel Environment Variables)
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const USE_SUPABASE = !!(SUPABASE_URL && SUPABASE_KEY);

export const supabase = USE_SUPABASE
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

if (USE_SUPABASE) {
  console.log('[IO] Mode Supabase activé — persistance centralisée');
} else {
  console.warn('[IO] Supabase non configuré — fallback localStorage (données locales uniquement)');
}
