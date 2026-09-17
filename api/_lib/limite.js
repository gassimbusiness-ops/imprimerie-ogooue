/**
 * Limitation de debit en memoire, par IP.
 *
 * Volontairement simple : une instance serverless garde son compteur le temps de sa
 * duree de vie. Ce n'est pas une protection absolue (plusieurs instances = plusieurs
 * compteurs), mais cela transforme "facture illimitee" en "facture bornee par instance",
 * sans ajouter de dependance ni de service externe.
 *
 * Pour une vraie limite globale il faudra Upstash/Redis ou Vercel KV.
 *
 * ── POURQUOI `portee` EXISTE (ajoutée le 17/09/2026) ──────────────────────
 * Tant qu'un endpoint = une fonction serverless, deux endpoints ne partageaient
 * jamais cette Map : deux processus, deux compteurs. Le regroupement imposé par
 * le plafond de 12 fonctions du plan Hobby (voir `api/singpay.js`) met
 * plusieurs endpoints DANS LA MÊME fonction — donc dans le même module, donc
 * dans la même Map. Sans séparation, un visiteur qui consomme les 30 appels/min
 * de `/api/ai` recevrait un 429 sur `/api/zakat-analyse` (plafond 10) sans
 * l'avoir appelé une seule fois : un plafond emprunté à un autre endpoint.
 *
 * `portee` préfixe la clé pour rendre chaque endpoint indépendant à nouveau.
 * Valeur par défaut vide : le comportement des appelants qui ne la passent pas
 * est strictement inchangé.
 */
const compteurs = new Map();

export function limiteDepassee(req, { max = 20, fenetreMs = 60_000, portee = '' } = {}) {
  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'inconnue';
  const cle = portee ? `${portee}|${ip}` : ip;
  const maintenant = Date.now();
  const entree = compteurs.get(cle);

  if (!entree || maintenant > entree.reset) {
    compteurs.set(cle, { n: 1, reset: maintenant + fenetreMs });
    return false;
  }
  entree.n += 1;
  if (compteurs.size > 5000) compteurs.clear(); // garde-fou memoire
  return entree.n > max;
}
