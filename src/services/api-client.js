/**
 * Appels aux fonctions serverless `/api/*`, avec le jeton de session.
 *
 * Les endpoints IA exigent desormais une session signee cote serveur : sans ce jeton,
 * ils repondent 401. Ce module centralise l'ajout de l'en-tete Authorization pour
 * qu'aucun appel n'oublie de le faire.
 */

const CLE_JETON = 'io_session_token';

export function enregistrerJeton(token) {
  try { localStorage.setItem(CLE_JETON, token); } catch { /* stockage indisponible */ }
}

export function effacerJeton() {
  try { localStorage.removeItem(CLE_JETON); } catch { /* stockage indisponible */ }
}

export function lireJeton() {
  try { return localStorage.getItem(CLE_JETON) || ''; } catch { return ''; }
}

/**
 * `fetch` vers /api/* avec le jeton de session.
 * Le jeton est signe par le serveur : le modifier cote navigateur le rend invalide.
 */
export async function apiFetch(url, options = {}) {
  const jeton = lireJeton();
  const headers = { ...(options.headers || {}) };
  if (jeton) headers.Authorization = `Bearer ${jeton}`;
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, { ...options, headers });

  if (res.status === 401) {
    effacerJeton();
    throw new Error('Session expiree. Reconnectez-vous.');
  }
  if (res.status === 429) {
    throw new Error('Trop de requetes. Patientez une minute.');
  }
  return res;
}
