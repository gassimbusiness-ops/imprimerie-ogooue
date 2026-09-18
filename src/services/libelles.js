/**
 * LES LIBELLES AFFICHES — aucune valeur manquante ne doit y atterrir.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * `undefined`, `null`, `NaN` et `[object Object]` sont les quatre chaines
 * qu'une interpolation JavaScript produit SANS LEVER D'ERREUR. Elles ne
 * cassent rien : elles s'affichent. Le gerant, lui, lit une panne.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Pourquoi ce fichier existe (18/09/2026) ───────────────────────────────
 *
 * Ecran « Taches » : deux cartes affichaient « Commande undefined — … ».
 *
 * Source : `src/features/commandes/page.jsx`, l'assignation d'une commande a un
 * operateur creait la tache avec
 *
 *     titre: `Commande ${cmd.numero} — ${cmd.client_nom}`
 *
 * sans repli — alors que les dix autres interpolations de `cmd.numero` du meme
 * fichier en ont une (`cmd.numero || ''`). Une commande sans numero (import,
 * saisie ancienne, creation depuis le portail client) donnait donc un titre
 * ECRIT EN BASE avec le mot `undefined` dedans.
 *
 * D'ou la double reponse, et elle est volontaire :
 *
 *   1. `libelleCommande` ferme la source : elle ne peut plus produire le mot ;
 *   2. `libelleTache` repare l'AFFICHAGE, parce que les taches deja creees
 *      portent le mot en base et qu'aucune correction de source ne les
 *      rattrape. On ne reecrit pas la base pour ca : un defaut d'affichage se
 *      corrige a l'affichage, et une migration sur des libelles est un risque
 *      sans contrepartie.
 */

/** Les quatre formes, telles qu'elles s'ecrivent a l'ecran. */
export const VALEURS_MANQUANTES_AFFICHEES = ['undefined', 'null', 'NaN', '[object Object]'];

/**
 * `undefined` / `null` sont cherches en INSENSIBLE a la casse (un « Null »
 * capitalise vient de la meme panne), `NaN` en SENSIBLE : sinon « NaNa
 * Couture », un vrai nom de cliente, serait pris pour une panne.
 * Les bornes de mot evitent l'autre faux positif : « Nullement urgent ».
 */
const MOTIF_MANQUANT = /\bundefined\b|\bnull\b|\[object Object\]/gi;
const MOTIF_MANQUANT_NAN = /\bNaN\b/g;

function enTexte(valeur) {
  if (valeur === null || valeur === undefined) return '';
  if (typeof valeur === 'number') return Number.isFinite(valeur) ? String(valeur) : '';
  if (typeof valeur === 'string') return valeur;
  try {
    const t = String(valeur);
    return t === '[object Object]' ? '' : t;
  } catch {
    return '';
  }
}

/**
 * Une valeur est-elle reellement renseignee ?
 *
 * Zero et la chaine « 0 » le sont : ce sont des valeurs, pas des absences.
 * La CHAINE « undefined » ne l'est pas : elle vient d'une base deja abimee.
 */
export function estRenseigne(valeur) {
  const t = enTexte(valeur).trim();
  if (!t) return false;
  return !contientValeurManquante(t);
}

/**
 * Le texte contient-il une valeur manquante affichee ?
 * @param {*} texte
 * @returns {boolean}
 */
export function contientValeurManquante(texte) {
  const t = typeof texte === 'string' ? texte : enTexte(texte);
  if (!t) return false;
  MOTIF_MANQUANT.lastIndex = 0;
  MOTIF_MANQUANT_NAN.lastIndex = 0;
  return MOTIF_MANQUANT.test(t) || MOTIF_MANQUANT_NAN.test(t);
}

/**
 * La valeur si elle est renseignee, le repli sinon.
 * @param {*} valeur
 * @param {string} [repli]
 */
export function texteAffichable(valeur, repli = '') {
  const t = enTexte(valeur).trim();
  return estRenseigne(t) ? t : repli;
}

/**
 * Retire d'un libelle DEJA ECRIT les valeurs manquantes, et recoud ce qui
 * reste : separateurs orphelins, espaces doubles, tiret final.
 *
 * @param {*} texte
 * @param {string} [repli] ce qui remplace le mot ('' pour le supprimer)
 * @returns {string}
 */
export function nettoyerLibelle(texte, repli = '') {
  const t = enTexte(texte);
  if (!t) return '';
  return t
    .replace(MOTIF_MANQUANT, repli)
    .replace(MOTIF_MANQUANT_NAN, repli)
    // Separateurs restes seuls apres le retrait : « Commande  —  » → « Commande ».
    .replace(/\s*[—–-]\s*(?=\s*[—–-]|\s*$)/g, ' ')
    .replace(/^\s*[—–-]\s*/, '')
    .replace(/\s*[:,]\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Le libelle d'une commande. C'est LA fonction a appeler partout ou un numero
 * de commande part dans un texte affiche ou enregistre.
 *
 * Le repli n'est pas decoratif : « Commande (numéro à confirmer) » dit au
 * gerant ce qui manque et ce qu'il a a faire. « Commande  » ne dit rien, et
 * « Commande undefined » dit que l'application est cassee.
 *
 * @param {{numero?: *, client?: *}} commande
 * @returns {string}
 */
export function libelleCommande(commande) {
  const c = commande && typeof commande === 'object' ? commande : {};
  const numero = texteAffichable(c.numero);
  const client = texteAffichable(c.client);
  const tete = numero ? `Commande ${numero}` : 'Commande (numéro à confirmer)';
  return client ? `${tete} — ${client}` : tete;
}

/**
 * Le libelle d'une tache, tel qu'il doit s'AFFICHER.
 *
 * Un titre sain est rendu tel quel — on ne reecrit pas le travail du gerant.
 * Un titre abime est reconstruit a partir de ce que la tache SAIT : son
 * `commande_numero`, et la partie encore lisible de son propre titre. On ne
 * devine rien ; on relit les champs voisins.
 *
 * @param {object} tache
 * @returns {string}
 */
export function libelleTache(tache) {
  const t = tache && typeof tache === 'object' ? tache : {};
  const titre = enTexte(t.titre).trim();

  if (titre && !contientValeurManquante(titre)) return titre;

  // Tache nee d'une commande : le libelle se reconstruit, il ne se devine pas.
  const estCommande = Boolean(t.commande_id) || t.categorie === 'Commande' || /^Commande\b/i.test(titre);
  if (estCommande) {
    // Le client survit souvent a la panne : il est apres le tiret du titre.
    const apresTiret = titre.split(/\s[—–-]\s/).slice(1).join(' — ').trim();
    return libelleCommande({
      numero: t.commande_numero,
      client: estRenseigne(apresTiret) ? apresTiret : t.client_nom,
    });
  }

  const reste = nettoyerLibelle(titre);
  if (reste) return reste;

  const description = texteAffichable(t.description);
  if (description) return description.length > 60 ? `${description.slice(0, 57)}…` : description;

  const categorie = texteAffichable(t.categorie);
  return categorie ? `Tâche — ${categorie}` : 'Tâche sans titre';
}

/**
 * Le nom affichable d'une personne (employe, client, utilisateur).
 *
 * `${e.prenom} ${e.nom}` est le second producteur d'« undefined » du depot :
 * la garde porte sur l'OBJET (`emp ? … : ''`), jamais sur ses champs. Un
 * employe saisi sans prenom donnait « undefined Abakar » — ecrit en base dans
 * `assigne_nom`, puis affiche sur la carte de tache.
 *
 * @param {{prenom?: *, nom?: *}} personne
 * @param {string} [repli]
 * @returns {string}
 */
export function nomPersonne(personne, repli = '') {
  const p = personne && typeof personne === 'object' ? personne : {};
  const parts = [texteAffichable(p.prenom), texteAffichable(p.nom)].filter(Boolean);
  return parts.length ? parts.join(' ') : repli;
}
