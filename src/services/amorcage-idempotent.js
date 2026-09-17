/**
 * Amorcage idempotent — par CLE NATURELLE, sur une lecture qui LEVE.
 *
 * ── CE QUI S'EST REELLEMENT PASSE ─────────────────────────────────────────
 *
 * `seedDatabase()` se protegeait du rejeu ainsi :
 *
 *     const existing = await db.employes.list();
 *     if (existing.length > 0) return;          // « base deja amorcee »
 *
 * Le critere vivait donc BIEN dans la base, pas dans le navigateur. Ce n'est
 * pas lui qui a lache : c'est la LECTURE. `list()` n'echoue jamais — elle
 * attrape l'erreur, la met dans la console et rend `[]` (voir le commentaire
 * de `Collection.list()` dans db.js et le module erreur-lecture.js). Une
 * coupure reseau a Moanda, un delai depasse, un refus RLS : dans les trois cas
 * `list()` rend le MEME tableau vide qu'une base neuve.
 *
 * « Je n'ai pas pu lire les comptes » et « il n'y a pas de comptes » sont deux
 * phrases differentes. Partout ailleurs la confusion fait afficher « aucun
 * rapport ce mois-ci ». ICI, elle ECRIT.
 *
 * MESURE DU 2026-09-17, base bcwkrrqmjpaohmafcncw :
 *   employes .............. 13 lignes pour 7 identites, 3 vagues (07-13/03,
 *                           18/03 01:14, 05/05 06:27)
 *   produits_catalogue .... 195 lignes, 20 Mo de JSON, une ligne a 3,2 Mo
 *                           (images en base64). `seedInventaire()` a rejoue
 *                           le 18/08, le 12/09 et ENCORE le 17/09 a 06:52.
 *
 * Le poids explique la frequence : la collection la plus lourde est celle dont
 * la lecture echoue le plus souvent, et chaque rejeu l'alourdit de 45 lignes.
 *
 * ── LES DEUX REGLES QUI SORTENT DE LA ─────────────────────────────────────
 *
 * 1. Un amorcage ne decide JAMAIS sur `list()`. Il lit avec `listOuLeve()` ou
 *    `compterOuLeve()` : si la lecture echoue, l'exception remonte, main.jsx la
 *    journalise, et RIEN n'est ecrit. Ne rien ecrire sur une lecture ratee est
 *    le comportement correct — pas un pis-aller.
 *
 * 2. L'idempotence se fonde sur le TEMOIN DE L'EFFET, enregistrement par
 *    enregistrement, pas sur un etat global (lecon des encaissements SingPay,
 *    migrations/005). Le temoin d'un compte, c'est son e-mail : si la ligne
 *    portant cet e-mail est la, le compte n'est pas a creer ; si elle manque,
 *    il l'est — et lui seul.
 *
 * Module PUR : aucun import. La lecture et l'ecriture sont injectees, ce qui
 * permet de rejouer un amorcage complet contre une base factice.
 * Teste par tests/amorcage-idempotent.test.mjs.
 */

/**
 * Forme comparable d'une cle naturelle. Un e-mail saisi « Minguisilou@gmail.com »
 * et le meme e-mail stocke « minguisilou@gmail.com » designent une seule personne.
 *
 * @param {*} valeur
 * @returns {string} chaine normalisee, ou '' si la valeur n'en porte pas
 */
export function normaliserCle(valeur) {
  if (valeur === null || valeur === undefined) return '';
  return String(valeur).trim().toLowerCase();
}

/**
 * Les cles deja presentes en base, sous forme comparable.
 *
 * @param {Array<Object>} existants
 * @param {string} champ nom du champ portant la cle naturelle
 * @returns {Set<string>}
 */
export function clesPresentes(existants, champ) {
  const cles = new Set();
  for (const item of Array.isArray(existants) ? existants : []) {
    const cle = normaliserCle(item && item[champ]);
    if (cle) cles.add(cle);
  }
  return cles;
}

/**
 * Ce qu'il reste a creer — et rien d'autre.
 *
 * Deux comportements volontaires :
 *   - un souhait SANS cle est ignore : on ne sait pas reconnaitre son double,
 *     donc on ne l'ecrit pas. Mieux vaut un compte absent qu'un compte en
 *     double, puisque le double, lui, ne se repare pas tout seul ;
 *   - deux souhaits portant la MEME cle ne produisent qu'une creation : la
 *     liste de reference elle-meme ne doit pas pouvoir semer un doublon.
 *
 * @param {{existants: Array<Object>, souhaites: Array<Object>, champ: string}} args
 * @returns {Array<Object>} sous-ensemble de `souhaites`, dans l'ordre d'origine
 */
export function manquants({ existants, souhaites, champ } = {}) {
  if (!champ) throw new TypeError('manquants : le champ de la cle naturelle est obligatoire');
  const presentes = clesPresentes(existants, champ);
  const retenues = new Set();
  const aCreer = [];
  for (const item of Array.isArray(souhaites) ? souhaites : []) {
    const cle = normaliserCle(item && item[champ]);
    if (!cle) continue;
    if (presentes.has(cle) || retenues.has(cle)) continue;
    retenues.add(cle);
    aCreer.push(item);
  }
  return aCreer;
}

/**
 * Joue un amorcage idempotent sur une cle naturelle.
 *
 * ⚠️ `lire` DOIT lever si la lecture echoue. Une fonction de lecture qui rend
 * `[]` sur une panne fait croire a une base vide et provoque exactement le
 * rejeu que ce module corrige : passer `listOuLeve()`, jamais `list()`.
 *
 * @param {{
 *   lire: () => Promise<Array<Object>>,
 *   creer: (item: Object) => Promise<any>,
 *   souhaites: Array<Object>,
 *   champ: string
 * }} args
 * @returns {Promise<{lus: number, crees: string[], baseVide: boolean}>}
 */
export async function amorcerParCle({ lire, creer, souhaites, champ } = {}) {
  if (typeof lire !== 'function') throw new TypeError('amorcerParCle : `lire` doit etre une fonction');
  if (typeof creer !== 'function') throw new TypeError('amorcerParCle : `creer` doit etre une fonction');

  // Si cette lecture echoue, l'exception remonte et aucune ecriture n'a lieu.
  const existants = await lire();
  if (!Array.isArray(existants)) {
    throw new TypeError('amorcerParCle : la lecture doit rendre un tableau');
  }

  const aCreer = manquants({ existants, souhaites, champ });
  const crees = [];
  for (const item of aCreer) {
    await creer(item);
    crees.push(normaliserCle(item[champ]));
  }
  return { lus: existants.length, crees, baseVide: existants.length === 0 };
}
