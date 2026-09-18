/**
 * Couche de LECTURE du pont ChatGPT — et la seule limite qu'elle ne franchit pas.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CE MODULE NE SAIT PAS ÉCRIRE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Il n'appelle que `.select()`. Aucun `.insert`, `.update`, `.upsert`, `.delete`
 * ni `.rpc` n'y figure, et `tests/chatgpt-pont.test.mjs` le vérifie sur la
 * SOURCE, pas sur l'intention. C'est volontairement grossier comme contrôle :
 * un pont ouvert à un assistant conversationnel doit être incapable d'écrire,
 * pas seulement décidé à ne pas le faire.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⛔ LES EMPREINTES DE MOTS DE PASSE NE SORTENT JAMAIS
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Le dirigeant a demandé que ChatGPT ait accès à TOUT, et il a été averti :
 * salaires, trésorerie, fichier clients, tout sort par ce pont. Ce n'est pas
 * discuté ici.
 *
 * Les empreintes de mots de passe ne sont PAS une catégorie de données de
 * l'entreprise. C'est le matériel d'authentification qui protège les comptes :
 * `hacherMotDePasse` est un simple SHA-256(sel + mot de passe), donc une
 * empreinte et son sel qui fuient se cassent hors ligne, à la vitesse d'un
 * dictionnaire. Autoriser la lecture de sa trésorerie n'est pas autoriser
 * quelqu'un à se faire passer pour soi.
 *
 * Deux barrières, et il faut les deux :
 *
 *   1. la table des identifiants (celle que gère `api/_lib/comptes.js`) n'est
 *      jamais nommée dans ce pont — la voie « collection » ne lit que la table
 *      générique `app_data`, et les identifiants n'y vivent pas. Un test vérifie
 *      que son nom n'apparaît nulle part ici : un nom de table absent ne peut
 *      pas être lu par accident, même par un futur ajout distrait ;
 *   2. `sansIdentifiants()` retire les champs de `CHAMPS_IDENTIFIANTS` de TOUT
 *      ce qui sort, à n'importe quelle profondeur. Car ces champs ont déjà
 *      voyagé dans `app_data` par le passé (voir l'en-tête de
 *      `api/_lib/comptes.js`), et une restauration de sauvegarde peut en
 *      ramener demain.
 *
 * La liste noire est IMPORTÉE de `comptes.js`, jamais recopiée : le jour où un
 * quatrième champ d'identifiant apparaît, il doit être couvert ici sans que
 * personne ait à y penser.
 *
 * ── Pourquoi ce fichier est dans `api/_lib/` ──────────────────────────────
 * Le plan Vercel Hobby plafonne le projet à 12 fonctions serverless, et seuls
 * les fichiers à la RACINE d'`api/` comptent. Tout ce qui suit ne consomme
 * aucune place. Voir l'en-tête de `api/chatgpt.js`.
 */
import { supabaseAdmin } from './supabase-admin.js';
import { CHAMPS_IDENTIFIANTS } from './comptes.js';

/**
 * Champs qui ne sortent JAMAIS par le pont, quelle que soit la voie.
 * Réexportés sous un autre nom pour que le test puisse vérifier que c'est bien
 * la MÊME liste, et non une copie qui divergera.
 */
export const CHAMPS_INTERDITS_PONT = Object.freeze([...CHAMPS_IDENTIFIANTS]);

/**
 * Profondeur maximale d'assainissement. Au-delà, la branche est coupée.
 *
 * 12 et pas 8 : le filtre s'applique à TOUT ce qui sort, sans exception de voie
 * — y compris au schéma OpenAPI, dont l'imbrication descend à 9 niveaux
 * (`paths` → chemin → `get` → `responses` → `200` → `content` → type MIME →
 * `schema`). Une limite plus basse aurait obligé à créer une exception « ce
 * contenu-là n'est pas filtré », et une exception est exactement ce qui finit
 * par laisser passer ce qu'on voulait retenir.
 */
const PROFONDEUR_MAX = 12;

/**
 * Recopie une valeur en retirant tout champ d'identifiant, à toute profondeur.
 *
 * ⚠️ Ne modifie jamais l'entrée : les synthèses relisent les mêmes objets.
 *
 * Une branche plus profonde que `PROFONDEUR_MAX` est REMPLACÉE par un marqueur
 * plutôt que recopiée telle quelle : recopier une branche non inspectée
 * reviendrait à la laisser sortir sans l'avoir filtrée, ce qui est exactement
 * ce que ce module existe pour empêcher.
 *
 * @param {unknown} valeur
 * @param {number} [profondeur]
 * @returns {unknown}
 */
export function sansIdentifiants(valeur, profondeur = 0) {
  if (valeur === null || typeof valeur !== 'object') return valeur;
  if (profondeur >= PROFONDEUR_MAX) return '[trop profond — non inspecté, donc non servi]';
  if (Array.isArray(valeur)) return valeur.map((v) => sansIdentifiants(v, profondeur + 1));
  const sortie = {};
  for (const [cle, v] of Object.entries(valeur)) {
    if (CHAMPS_INTERDITS_PONT.includes(cle)) continue;
    sortie[cle] = sansIdentifiants(v, profondeur + 1);
  }
  return sortie;
}

/**
 * Un nom de champ acceptable pour un filtre.
 *
 * Le filtre construit un sélecteur PostgREST (`data->>nom`). Un nom libre y
 * ferait passer une virgule ou un opérateur, donc une requête que personne n'a
 * voulue. On n'échappe pas : on refuse.
 */
const RE_CHAMP = /^[a-z0-9_]{1,40}$/i;

/** Un nom de collection acceptable. Même raison. */
const RE_COLLECTION = /^[a-z0-9_]{1,60}$/i;

export function champValide(nom) {
  return typeof nom === 'string' && RE_CHAMP.test(nom);
}

export function collectionValide(nom) {
  return typeof nom === 'string' && RE_COLLECTION.test(nom);
}

/** Taille d'une page Supabase. Au-delà de 1000, PostgREST tronque en silence. */
const PAGE = 1000;

/**
 * Garde-fou de volume sur `lireTout` : 40 pages, soit 40 000 lignes.
 * `audit_logs` en compte 3 350 au 18/09/2026 ; la marge est large, et la borne
 * existe pour qu'une collection qui grossit ne fasse jamais expirer la fonction.
 */
const PAGES_MAX = 40;

/**
 * Dépôt de lecture Supabase. Isolé pour que les tests le remplacent par un
 * double en mémoire — c'est la seule façon de prouver qu'une requête POST
 * n'atteint AUCUNE lecture, sans base de données.
 */
export function depotLecture() {
  const sb = () => supabaseAdmin();

  return {
    /**
     * Toutes les collections présentes, avec leur nombre de lignes.
     *
     * PostgREST ne sait pas faire un `group by` : on lit donc la seule colonne
     * `collection` (quelques octets par ligne, pas le `data` jsonb qui pèse
     * jusqu'à 3,2 Mo sur une seule ligne de `produits_catalogue`) et on compte
     * en mémoire. C'est la différence entre 100 Ko et 20 Mo sur la connexion
     * de Moanda.
     */
    async listerCollections() {
      const compte = new Map();
      for (let page = 0; page < PAGES_MAX; page += 1) {
        const debut = page * PAGE;
        const { data, error } = await sb()
          .from('app_data')
          .select('collection')
          .range(debut, debut + PAGE - 1);
        if (error) throw new Error(error.message);
        for (const ligne of data || []) {
          compte.set(ligne.collection, (compte.get(ligne.collection) || 0) + 1);
        }
        if (!data || data.length < PAGE) break;
      }
      return [...compte.entries()]
        .map(([collection, lignes]) => ({ collection, lignes }))
        .sort((a, b) => b.lignes - a.lignes);
    },

    /** Nombre de lignes d'une collection, sans les télécharger. */
    async compter(collection, { champ = null, valeur = null } = {}) {
      let requete = sb()
        .from('app_data')
        .select('id', { count: 'exact', head: true })
        .eq('collection', collection);
      if (champ && champValide(champ)) requete = requete.eq(`data->>${champ}`, String(valeur));
      const { count, error } = await requete;
      if (error) throw new Error(error.message);
      return count || 0;
    },

    /** Une page d'une collection, filtrée le cas échéant. */
    async lirePage(collection, { limite = 50, decalage = 0, champ = null, valeur = null } = {}) {
      let requete = sb()
        .from('app_data')
        .select('data')
        .eq('collection', collection)
        .order('created_at', { ascending: true });
      if (champ && champValide(champ)) requete = requete.eq(`data->>${champ}`, String(valeur));
      const { data, error } = await requete.range(decalage, decalage + limite - 1);
      if (error) throw new Error(error.message);
      return (data || []).map((r) => r.data);
    },

    /**
     * Toute une collection, paginée. Sert aux synthèses, qui doivent additionner
     * un mois entier : une page de 1 000 lignes tronquerait le chiffre sans
     * rien signaler, et un chiffre faux ne plante pas — il s'affiche.
     */
    async lireTout(collection) {
      const tout = [];
      for (let page = 0; page < PAGES_MAX; page += 1) {
        const debut = page * PAGE;
        const { data, error } = await sb()
          .from('app_data')
          .select('data')
          .eq('collection', collection)
          .order('created_at', { ascending: true })
          .range(debut, debut + PAGE - 1);
        if (error) throw new Error(error.message);
        for (const r of data || []) tout.push(r.data);
        if (!data || data.length < PAGE) break;
      }
      return tout;
    },
  };
}
