/**
 * Utilitaires cryptographiques pour le hashing des mots de passe.
 * Utilise Web Crypto API (SHA-256 + salt) — sécurisé côté client.
 * En production avec backend, utiliser bcrypt/argon2.
 */

/**
 * Génère un salt aléatoire de 16 bytes en hex.
 */
export function generateSalt() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Hash un mot de passe avec un salt (SHA-256).
 * @param {string} password
 * @param {string} salt
 * @returns {Promise<string>} hash hex
 */
export async function hashPassword(password, salt) {
  const encoder = new TextEncoder();
  const data = encoder.encode(salt + password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Vérifie un mot de passe contre un hash stocké.
 * @param {string} password - Mot de passe en clair
 * @param {string} storedHash - Hash stocké
 * @param {string} salt - Salt utilisé
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, storedHash, salt) {
  const hash = await hashPassword(password, salt);
  return hash === storedHash;
}
