/**
 * Jeton de session signé — sans dépendance externe.
 *
 * POURQUOI CE FICHIER EXISTE
 *
 * L'application stockait l'utilisateur et son rôle dans `localStorage`, en JSON non signé.
 * N'importe qui pouvait ouvrir l'inspecteur et passer `"role":"employe"` à `"role":"admin"`.
 * Et les trois endpoints `api/` n'avaient aucun moyen de savoir qui les appelait, faute de
 * session : ils étaient donc ouverts à Internet.
 *
 * Ce module produit un jeton HMAC-SHA256 que seul le serveur peut fabriquer et vérifier.
 * Le secret vit dans la variable d'environnement SESSION_SECRET, côté serveur uniquement.
 */
import crypto from 'node:crypto';

const DUREE_SESSION_MS = 8 * 60 * 60 * 1000; // 8 heures

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error('SESSION_SECRET absent ou trop court (32 caractères minimum)');
  }
  return s;
}

/** Fabrique un jeton pour un utilisateur. */
export function signerSession({ id, role }) {
  const payload = { sub: id, role, exp: Date.now() + DUREE_SESSION_MS };
  const corps = b64url(JSON.stringify(payload));
  const signature = b64url(crypto.createHmac('sha256', secret()).update(corps).digest());
  return `${corps}.${signature}`;
}

/**
 * Vérifie un jeton. Retourne le payload, ou null si invalide/expiré.
 * La comparaison est à temps constant pour ne pas fuiter la signature octet par octet.
 */
export function verifierSession(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [corps, signature] = token.split('.');
  if (!corps || !signature) return null;

  let attendue;
  try {
    attendue = b64url(crypto.createHmac('sha256', secret()).update(corps).digest());
  } catch {
    return null;
  }

  const a = Buffer.from(signature);
  const b = Buffer.from(attendue);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(corps, 'base64url').toString('utf8'));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Lit le jeton dans l'en-tête Authorization: Bearer <token>. */
export function sessionDepuisRequete(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  return verifierSession(h.slice(7));
}

/**
 * Garde d'entrée pour un endpoint. Retourne le payload, ou répond 401 et retourne null.
 * Usage : `const session = exigerSession(req, res); if (!session) return;`
 */
export function exigerSession(req, res) {
  const session = sessionDepuisRequete(req);
  if (!session) {
    res.status(401).json({ error: 'Authentification requise' });
    return null;
  }
  return session;
}

/** Hachage identique à celui du client historique : SHA-256(salt + password), en hexadécimal. */
export function hacherMotDePasse(password, salt) {
  return crypto.createHash('sha256').update(String(salt) + String(password), 'utf8').digest('hex');
}

/** Comparaison à temps constant de deux empreintes hexadécimales. */
export function empreintesEgales(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

export function genererSel() {
  return crypto.randomBytes(16).toString('hex');
}
