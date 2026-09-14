/**
 * Limitation de debit en memoire, par IP.
 *
 * Volontairement simple : une instance serverless garde son compteur le temps de sa
 * duree de vie. Ce n'est pas une protection absolue (plusieurs instances = plusieurs
 * compteurs), mais cela transforme "facture illimitee" en "facture bornee par instance",
 * sans ajouter de dependance ni de service externe.
 *
 * Pour une vraie limite globale il faudra Upstash/Redis ou Vercel KV.
 */
const compteurs = new Map();

export function limiteDepassee(req, { max = 20, fenetreMs = 60_000 } = {}) {
  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'inconnue';
  const maintenant = Date.now();
  const entree = compteurs.get(ip);

  if (!entree || maintenant > entree.reset) {
    compteurs.set(ip, { n: 1, reset: maintenant + fenetreMs });
    return false;
  }
  entree.n += 1;
  if (compteurs.size > 5000) compteurs.clear(); // garde-fou memoire
  return entree.n > max;
}
