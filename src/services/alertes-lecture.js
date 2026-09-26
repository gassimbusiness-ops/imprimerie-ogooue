/**
 * Lecture, par le navigateur, de la collection `alertes` écrite par le passage
 * planifié (`api/_lib/alertes-envoi.js`) : l'état de la vérification et le sort
 * Telegram de chaque alerte. Les phrases affichées sont dans `alertes-etat.js`.
 *
 * ⛔ LECTURE SEULE, et rien de secret : la ligne d'état dit « Telegram
 *    configuré : oui / non », jamais plus.
 *
 * Pourquoi pas `db.alertes` : `src/services/db.js` est en cours de modification
 * par un autre chantier ; une lecture de plus s'écrit ici, à côté, sans y
 * toucher. Même requête que `listOuLeve()` : elle LÈVE en cas d'échec, pour que
 * l'écran dise « état illisible » au lieu de « Telegram non configuré ».
 */
import { supabase, USE_SUPABASE } from './supabase';

/**
 * @returns {Promise<{etat: object|null, traces: Array<object>, disponible: boolean}>}
 */
export async function lireEtatAlertes() {
  if (!USE_SUPABASE || !supabase) return { etat: null, traces: [], disponible: false };
  const { data, error } = await supabase
    .from('app_data')
    .select('data')
    .eq('collection', 'alertes')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message || 'lecture des alertes impossible');
  const lignes = (data || []).map((r) => r.data || {});
  return {
    etat: lignes.find((l) => l.type_ligne === 'etat') || null,
    traces: lignes.filter((l) => l.type_ligne === 'alerte'),
    disponible: true,
  };
}
