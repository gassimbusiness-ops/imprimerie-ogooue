/**
 * Les règles d'alerte — caisse et stock. Module PUR.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Le 18/09/2026, le mot de passe du compte de l'ordinateur d'accueil a été
 * changé sans prévenir. Plus personne ne pouvait saisir de rapport de caisse.
 * **Du 18 au 23 septembre, six jours, aucun rapport — et personne ne l'a su.**
 * Les rapports manquants n'ont été rattrapés que le 25/09 au soir (mesuré en
 * base : trois rapports datés des 18, 21 et 22/09 ont un `created_at` du 25/09).
 *
 * Une donnée qui ne vient pas ne fait aucun bruit. Ce module transforme
 * l'absence en fait visible ; `alertes-envoi.js` la porte dans l'application et
 * sur Telegram, une seule fois.
 *
 * ⛔ PUR : aucun accès base, aucun réseau, aucun `process.env`, aucun module
 *    Node. Il est importé par le tableau de bord (navigateur) ET par le passage
 *    planifié (serveur) : la règle n'existe qu'à un endroit, et l'écran ne peut
 *    pas dire autre chose que Telegram. Un test refuse tout import qui
 *    casserait cette propriété.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * RÈGLE CAISSE — « aucun rapport depuis 2 jours ouvrés »
 * ════════════════════════════════════════════════════════════════════════════
 *
 * 1. **Jours fermés : le dimanche.** Source : `api/_lib/bot-connaissances.js`
 *    (`jour_de_fermeture: 'dimanche'`, « samedi de 7 h 30 à 15 h 00. Fermé le
 *    dimanche »). Confirmé par les données : sur les rapports d'août-septembre
 *    2026, aucun n'est daté d'un dimanche, et les samedis en ont.
 *    ⚠️ Les JOURS FÉRIÉS gabonais ne sont PAS dans le code (aucune liste dans
 *    le dépôt, et les fêtes religieuses sont mobiles). Conséquence assumée : un
 *    férié compte comme un jour ouvré, donc au pire l'alerte part UN jour plus
 *    tôt qu'elle ne devrait. Jamais plus tard.
 * 2. **La date qui compte est `rapport.date`** (date métier `YYYY-MM-DD`, celle
 *    que l'écran « Rapports journaliers » écrit), pas `created_at` : un rapport
 *    rattrapé après coup ferme bien le trou qu'il comble. Tout statut compte
 *    (un brouillon, c'est une caisse qui a été ouverte dans l'application). Une
 *    date à venir ou illisible est ignorée.
 * 3. **Le jour même n'est pas compté** : le rapport du jour peut encore venir.
 *    On compte les jours ouvrés strictement entre le dernier rapport et
 *    aujourd'hui. Deux ou plus ⇒ alerte.
 *    Rejeu du 18→23/09 : dernier rapport le jeudi 17 ; le samedi 19 il manque
 *    1 jour (ven. 18) ; le **dimanche 20 au passage de 9 h**, il en manque 2
 *    (ven. 18, sam. 19) ⇒ l'alerte part. Trois jours plus tôt que la découverte
 *    réelle.
 * 4. **Une caisse par activité** (`src/services/activites.js`) : l'absence du
 *    champ `activite` vaut « imprimerie ». La papeterie est une caisse à part :
 *    son silence est une alerte à part. TopShop n'a pas de caisse de comptoir
 *    (commerce en ligne, paiement à la livraison) : pas de règle pour elle.
 * 5. **Une caisse qui n'a JAMAIS eu de rapport n'est pas surveillée.** Sans un
 *    premier rapport, rien ne dit qu'elle est ouverte : alerter serait deviner.
 *    La papeterie entre sous surveillance à son premier rapport (24/09/2026).
 *
 * L'identifiant — `caisse:imprimerie:2026-09-18` — porte le PREMIER JOUR
 * OUVRÉ SANS RAPPORT. Il ne bouge pas tant que le trou dure : six jours de
 * silence et dix passages donnent UNE alerte. Quand un rapport arrive, le trou
 * se ferme ; un nouveau silence plus tard aura un nouvel identifiant.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * RÈGLE STOCK — « sous son seuil », et seulement un seuil CONFIRMÉ
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Mesuré le 26/09/2026 (lecture seule) : les 45 articles de `produits` portent
 * un `quantite_minimum` — le constat « aucun seuil » de la commande de mission
 * cherchait un champ `seuil_alerte` qui n'existe pas. MAIS aucun de ces seuils
 * n'est démontrablement choisi par le gérant :
 *   - 26 valent exactement 10 : c'est la valeur que l'ancien écran Stock
 *     IMPOSAIT à chaque ouverture (`migrations/002_seuils_stock_a_valider.sql`,
 *     non appliquée : l'origine de chaque 10 est perdue) ;
 *   - 5 machines valent 5 (une imprimante à 1 exemplaire « sous son seuil ») ;
 *   - les autres ressemblent à ~20 % de la quantité d'import (533 → 108,
 *     66 → 14, 74 → 15…) ;
 *   - et aucune quantité n'a bougé depuis le 03/05/2026.
 * Alerter sur ces seuils, ce serait 13 alertes le premier jour, sur des
 * chiffres vieux de quatre mois : le canal Telegram serait muet dans les
 * têtes avant d'avoir servi. « Un seuil deviné est une fausse alerte ou un
 * silence. »
 *
 * La règle exige donc un TÉMOIN HUMAIN : `seuil_confirme_le`, posé par l'écran
 * Stocks quand le gérant enregistre la fiche de l'article (le champ « Seuil
 * min » est sous ses yeux, avec une phrase qui dit ce que l'enregistrement
 * déclenche). Sans ce témoin, un article ne déclenche jamais rien — ni dans
 * l'application, ni sur Telegram. Aucun seuil n'est inventé ici.
 *
 * Condition : article non masqué, actif, seuil confirmé > 0, quantité
 * RÉELLEMENT présente (un champ vide n'est pas « zéro »), quantité ≤ seuil —
 * le même « ≤ » que l'écran Stocks (`niveauStock`), pour que l'écran et
 * l'alerte ne se contredisent pas sur l'article au seuil pile.
 *
 * L'identifiant d'une alerte stock n'est pas dans la donnée (rien ne date le
 * passage sous le seuil) : la règle rend une CLÉ d'épisode (`stock:<article>`)
 * et `identifierAlertes()` la complète avec le jour de détection, en
 * réutilisant l'épisode encore ouvert s'il existe. Réapprovisionné puis
 * retombé : nouvel épisode, nouvelle alerte.
 */
import { ACTIVITE_IMPRIMERIE, ACTIVITE_PAPETERIE, activiteDe, libelleActivite } from '../../src/services/activites.js';
import { seuilArticle } from '../../src/services/stocks-seuils.js';
import { contexteMoanda, estDateMetier } from '../../src/lib/dates.js';

/** Jours de fermeture, en numéro de jour JS (0 = dimanche). */
export const JOURS_FERMES = Object.freeze([0]);

/** Nombre de jours ouvrés sans rapport qui déclenche l'alerte. */
export const JOURS_OUVRES_SANS_RAPPORT_MAX = 2;

/** Les caisses de comptoir surveillées. TopShop n'en a pas. */
export const CAISSES_SURVEILLEES = Object.freeze([ACTIVITE_IMPRIMERIE, ACTIVITE_PAPETERIE]);

export const FAMILLES = Object.freeze({ CAISSE: 'caisse', STOCK: 'stock' });

const NOMS_JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const NOMS_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
  'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/* ── Arithmétique de dates métier, sans fuseau ─────────────────────────────
   Tout passe par `Date.UTC` : le résultat est le même à Libreville, en UTC
   et à Los Angeles. Jamais `new Date('2026-09-18')` suivi d'un `getDay()`. */

function partiesDate(dateMetier) {
  const [a, m, j] = dateMetier.split('-').map(Number);
  return { a, m, j };
}

/** Jour de la semaine d'une date métier (0 = dimanche). */
export function jourSemaine(dateMetier) {
  const { a, m, j } = partiesDate(dateMetier);
  return new Date(Date.UTC(a, m - 1, j)).getUTCDay();
}

/** Date métier décalée de `n` jours. */
export function decalerDateMetier(dateMetier, n) {
  const { a, m, j } = partiesDate(dateMetier);
  const d = new Date(Date.UTC(a, m - 1, j + n));
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/** Vrai si l'imprimerie ouvre ce jour-là (fériés non connus : voir l'en-tête). */
export function estJourOuvre(dateMetier) {
  return !JOURS_FERMES.includes(jourSemaine(dateMetier));
}

/**
 * Jours ouvrés STRICTEMENT entre deux dates métier (bornes exclues).
 * Borné à 400 jours : une date aberrante ne fait pas tourner la boucle.
 */
export function joursOuvresEntre(apres, avant) {
  const sortie = [];
  let d = decalerDateMetier(apres, 1);
  for (let i = 0; i < 400 && d < avant; i += 1) {
    if (estJourOuvre(d)) sortie.push(d);
    d = decalerDateMetier(d, 1);
  }
  return sortie;
}

/** « jeudi 17 septembre » — pour un humain, sans dépendre de la langue de la machine. */
export function libelleJour(dateMetier) {
  if (!estDateMetier(dateMetier)) return String(dateMetier || '');
  const { m, j } = partiesDate(dateMetier);
  return `${NOMS_JOURS[jourSemaine(dateMetier)]} ${j} ${NOMS_MOIS[m - 1]}`;
}

/** « ven. 18, sam. 19 » */
function libelleJoursCourts(dates) {
  return dates.map((d) => `${NOMS_JOURS[jourSemaine(d)].slice(0, 3)}. ${partiesDate(d).j}`).join(', ');
}

/* ════════════════════════════════════════════════════════════════════════════
   CAISSE
   ════════════════════════════════════════════════════════════════════════════ */

/**
 * État de chaque caisse surveillée, alerte ou pas.
 *
 * @param {{rapports: Array<{date?: string, activite?: string}>, dateDuJour: string}} p
 * @returns {Array<{activite: string, suivie: boolean, dernier_rapport: string|null,
 *                  jours_manquants: string[], en_alerte: boolean}>}
 */
export function etatDesCaisses({ rapports, dateDuJour }) {
  const derniers = new Map();
  for (const r of Array.isArray(rapports) ? rapports : []) {
    const d = r?.date;
    if (!estDateMetier(d) || d > dateDuJour) continue;
    const act = activiteDe(r);
    if (!derniers.has(act) || d > derniers.get(act)) derniers.set(act, d);
  }
  return CAISSES_SURVEILLEES.map((activite) => {
    const dernier = derniers.get(activite) || null;
    if (!dernier) {
      return { activite, suivie: false, dernier_rapport: null, jours_manquants: [], en_alerte: false };
    }
    const manquants = joursOuvresEntre(dernier, dateDuJour);
    return {
      activite,
      suivie: true,
      dernier_rapport: dernier,
      jours_manquants: manquants,
      en_alerte: manquants.length >= JOURS_OUVRES_SANS_RAPPORT_MAX,
    };
  });
}

/**
 * Les alertes de caisse — une par caisse silencieuse.
 * @returns {Array<object>}
 */
export function alertesCaisse({ rapports, dateDuJour }) {
  return etatDesCaisses({ rapports, dateDuJour })
    .filter((c) => c.en_alerte)
    .map((c) => {
      const caisse = libelleActivite(c.activite);
      const premier = c.jours_manquants[0];
      const n = c.jours_manquants.length;
      const message = `Caisse ${caisse} : aucun rapport journalier depuis le ${libelleJour(c.dernier_rapport)}. `
        + `${n} jour${n > 1 ? 's' : ''} ouvré${n > 1 ? 's' : ''} sans rapport (${libelleJoursCourts(c.jours_manquants)}). `
        + 'À faire : saisir les rapports manquants dans « Rapports journaliers ». '
        + 'Si personne ne peut se connecter à l\'ordinateur d\'accueil, prévenir Gassim aujourd\'hui.';
      return {
        id: `caisse:${c.activite}:${premier}`,
        cle_episode: `caisse:${c.activite}`,
        famille: FAMILLES.CAISSE,
        activite: c.activite,
        gravite: 'haute',
        titre: `Caisse ${caisse} sans rapport`,
        message,
        lien: '/rapports',
        depuis: premier,
        dernier_rapport: c.dernier_rapport,
        jours_manquants: c.jours_manquants,
      };
    });
}

/* ════════════════════════════════════════════════════════════════════════════
   STOCK
   ════════════════════════════════════════════════════════════════════════════ */

/** Une quantité RÉELLEMENT saisie, ou `null`. Un champ vide n'est pas zéro. */
export function quantiteMesuree(article) {
  for (const brut of [article?.quantite, article?.stock]) {
    if (brut === null || brut === undefined || brut === '') continue;
    const n = Number(brut);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Le seuil ne compte que s'il a été confirmé par un humain. Sinon 0 = aucune alerte. */
export function seuilConfirme(article) {
  const temoin = article?.seuil_confirme_le;
  if (typeof temoin !== 'string' || temoin.trim() === '') return 0;
  return seuilArticle(article);
}

/**
 * Les alertes de stock. Sans seuil confirmé, jamais rien.
 * @param {{produits: Array<object>}} p
 */
export function alertesStock({ produits }) {
  const sortie = [];
  for (const p of Array.isArray(produits) ? produits : []) {
    if (!p?.id || p.masque === true || p.actif === false) continue;
    const seuil = seuilConfirme(p);
    if (!(seuil > 0)) continue;
    const q = quantiteMesuree(p);
    if (q === null || q > seuil) continue;
    const nom = String(p.nom || 'Article sans nom');
    const unite = p.unite ? ` ${p.unite}` : '';
    const activite = activiteDe(p);
    sortie.push({
      id: null, // complété par `identifierAlertes()` : rien dans la donnée ne date l'épisode
      cle_episode: `stock:${p.id}`,
      famille: FAMILLES.STOCK,
      activite,
      gravite: q <= 0 ? 'haute' : 'moyenne',
      titre: q <= 0 ? `Rupture : ${nom}` : `Stock bas : ${nom}`,
      message: `${q <= 0 ? 'Rupture' : 'Stock bas'} — ${nom} (${libelleActivite(activite)}) : `
        + `${q}${unite} en stock pour un seuil de ${seuil}${unite}. `
        + 'À faire : réapprovisionner, ou corriger le seuil dans « Stocks ».',
      lien: '/stocks',
      produit_id: p.id,
      quantite: q,
      seuil,
    });
  }
  return sortie;
}

/**
 * Combien d'articles portent un seuil confirmé — pour que l'écran dise
 * POURQUOI il n'y a aucune alerte de stock, au lieu de laisser croire que
 * tout va bien.
 */
export function compterSeuilsConfirmes(produits) {
  const liste = (Array.isArray(produits) ? produits : []).filter((p) => p && p.masque !== true && p.actif !== false);
  return { confirmes: liste.filter((p) => seuilConfirme(p) > 0).length, total: liste.length };
}

/* ════════════════════════════════════════════════════════════════════════════
   ENSEMBLE
   ════════════════════════════════════════════════════════════════════════════ */

/**
 * Évalue toutes les règles à un instant donné.
 *
 * @param {{rapports: Array, produits: Array, instant: Date}} p
 * @returns {{date_du_jour: string, alertes: Array<object>, caisses: Array<object>,
 *            seuils: {confirmes: number, total: number}}}
 */
export function evaluerAlertes({ rapports, produits, instant }) {
  const dateDuJour = contexteMoanda(instant instanceof Date ? instant : new Date(instant)).date_locale;
  return {
    date_du_jour: dateDuJour,
    alertes: [...alertesCaisse({ rapports, dateDuJour }), ...alertesStock({ produits })],
    caisses: etatDesCaisses({ rapports, dateDuJour }),
    seuils: compterSeuilsConfirmes(produits),
  };
}

/**
 * Donne à chaque alerte son identifiant STABLE.
 *
 * - une alerte qui a déjà un `id` (caisse) le garde ;
 * - une alerte stock reprend l'identifiant de l'épisode ENCORE OUVERT de sa
 *   clé (trace sans `resolue_le`) ; sinon elle en ouvre un, daté du jour.
 *
 * @param {Array<object>} alertes
 * @param {Array<{alerte_id: string, cle_episode: string, resolue_le?: string|null}>} traces
 * @param {string} dateDuJour
 */
export function identifierAlertes(alertes, traces, dateDuJour) {
  const ouvertes = new Map();
  for (const t of Array.isArray(traces) ? traces : []) {
    if (!t?.cle_episode || !t?.alerte_id || t.resolue_le) continue;
    ouvertes.set(t.cle_episode, t.alerte_id);
  }
  return alertes.map((a) => (a.id ? a : { ...a, id: ouvertes.get(a.cle_episode) || `${a.cle_episode}:${dateDuJour}` }));
}

/** Le texte envoyé sur Telegram. Texte brut : aucun balisage à échapper. */
export function texteTelegram(alerte) {
  const tete = alerte.gravite === 'haute' ? '🔴' : '🟠';
  return `${tete} OGOOUÉ — ${alerte.titre}\n\n${alerte.message}\n\n(réf. ${alerte.id})`;
}
