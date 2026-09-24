/**
 * Comptes et identifiants — le seul endroit du serveur qui touche aux mots de passe.
 *
 * ── POURQUOI CE FICHIER EXISTE (17/09/2026) ────────────────────────────────
 *
 * Trois endpoints écrivaient chacun leur version de « créer un compte » et
 * « changer un mot de passe », et les trois se contredisaient :
 *
 *   • `api/employes.js` recevait `password_hash` / `password_salt` depuis
 *     l'écran Paramètres, et les SUPPRIMAIT silencieusement (liste
 *     CHAMPS_INTERDITS) avant d'écrire dans `app_data`. Résultat mesuré :
 *     un utilisateur créé depuis Paramètres n'avait AUCUN mot de passe, et
 *     un changement de mot de passe depuis le formulaire d'édition était
 *     accepté à l'écran puis jeté. Aucune erreur, aucune trace.
 *
 *   • `api/auth-creer-utilisateur.js` insérait l'employé PUIS ses
 *     identifiants. Comme la table `auth_credentials` n'existe pas encore en
 *     production (migration 001 jamais appliquée — vérifié le 17/09/2026),
 *     la seconde écriture échouait et laissait un compte orphelin : pas de
 *     mot de passe, donc connexion impossible, mais l'adresse e-mail était
 *     désormais « déjà prise ». C'est exactement ce que vit un client qui
 *     s'inscrit et n'arrive jamais à entrer.
 *
 * Ce module impose une seule règle, et la rend impossible à contourner :
 *
 *   UN MOT DE PASSE NE S'ÉCRIT JAMAIS DANS `app_data`.
 *   Il va dans `auth_credentials`, table sans policy RLS, donc hors de portée
 *   de la clé publiable compilée dans le bundle du navigateur.
 *
 * Il vit dans `api/_lib/` et non à la racine d'`api/` : le plan Vercel Hobby
 * plafonne le projet à 12 fonctions serverless, et seuls les fichiers à la
 * racine d'`api/` comptent. Ce fichier n'en consomme aucune.
 */
import crypto from 'node:crypto';
import { supabaseAdmin } from './supabase-admin.js';
import { hacherMotDePasse, genererSel } from './session.js';
import {
  assainir,
  auteurDepuisSessionServeur,
  ligneJournal,
} from '../../src/services/journal-audit.js';

// `assainir` vit désormais dans le module partagé du journal ; ré-exporté ici
// pour les appelants et les tests qui l'importaient de ce fichier.
export { assainir };

/** Longueur minimale d'un mot de passe. Alignée sur l'inscription publique. */
export const LONGUEUR_MINI = 8;

/** Champs qui ne doivent JAMAIS atterrir dans `app_data`, ni repartir vers le client. */
export const CHAMPS_IDENTIFIANTS = ['password_hash', 'password_salt', 'password_changed_at'];

/** Rôles acceptés. Tout autre valeur est refusée, jamais « corrigée » en silence. */
export const ROLES_CONNUS = ['admin', 'manager', 'employe', 'associe', 'client'];

/**
 * Erreur dédiée : le stockage des identifiants n'est pas disponible.
 *
 * Elle existe pour que l'appelant puisse répondre 503 avec un message vrai
 * (« la migration n'est pas appliquée ») au lieu d'un 500 opaque — et surtout
 * pour qu'il sache qu'il doit ANNULER ce qu'il vient d'écrire.
 */
export class IdentifiantsIndisponibles extends Error {
  constructor(cause) {
    super(
      "Le stockage des identifiants n'est pas disponible : la table `auth_credentials` "
      + "est absente. Appliquer la PHASE A de migrations/001_securiser_employes.sql.",
    );
    this.name = 'IdentifiantsIndisponibles';
    this.cause = cause;
  }
}

/**
 * Reconnaît l'absence de la table, quelle que soit la couche qui la signale.
 * PostgREST répond `PGRST205` (table inconnue du cache de schéma), Postgres
 * `42P01` (undefined_table). Le message est le dernier recours.
 */
export function tableIdentifiantsAbsente(erreur) {
  if (!erreur) return false;
  const code = String(erreur.code || '');
  if (code === '42P01' || code === 'PGRST205' || code === 'PGRST204') return true;
  const message = `${erreur.message || ''} ${erreur.details || ''}`.toLowerCase();
  return (
    message.includes('auth_credentials')
    && (message.includes('does not exist')
      || message.includes('not find')
      || message.includes("n'existe pas"))
  );
}

/**
 * Retire les identifiants d'un objet métier et les renvoie à part.
 *
 * Renvoie `{ propre, identifiants }` où `propre` est sûr à écrire dans
 * `app_data`, et `identifiants` vaut `null` si l'appel n'en portait aucun.
 *
 * ⚠️ L'objet d'entrée n'est pas modifié : les appelants le réutilisent.
 */
export function separerIdentifiants(donnees) {
  const propre = { ...(donnees && typeof donnees === 'object' ? donnees : {}) };
  const hash = propre.password_hash;
  const sel = propre.password_salt;
  for (const champ of CHAMPS_IDENTIFIANTS) delete propre[champ];
  const identifiants = hash && sel ? { hash: String(hash), sel: String(sel) } : null;
  return { propre, identifiants };
}

/**
 * Prépare une empreinte à partir de ce que l'appelant a fourni.
 *
 * Deux entrées possibles, dans cet ordre de priorité :
 *
 *  1. `motDePasse` en clair — le serveur génère le sel et hache lui-même. C'est
 *     le chemin normal, et le seul que devraient utiliser les écrans à terme.
 *
 *  2. `hash` + `sel` déjà calculés par le navigateur — PONT DE COMPATIBILITÉ.
 *     L'écran Paramètres (`src/features/parametres/page.jsx`) hache encore
 *     côté client avec `src/services/crypto.js`. Son algorithme est
 *     SHA-256(sel + mot_de_passe) en hexadécimal, soit EXACTEMENT
 *     `hacherMotDePasse` — les empreintes sont donc interchangeables, et c'est
 *     ce qui permet de réparer le mot de passe perdu sans toucher à cet écran
 *     (sur lequel un autre chantier est en cours).
 *
 *     Ce pont n'ouvre aucune escalade : il n'est atteignable que derrière une
 *     session admin signée, et un admin peut déjà changer n'importe quel mot
 *     de passe. Il disparaîtra quand l'écran enverra `motDePasse`.
 *
 * Renvoie `null` si rien n'a été fourni (cas d'une simple modification de
 * fiche sans changement de mot de passe).
 * Lève `Error` avec `.statut = 400` si l'entrée est présente mais invalide.
 */
export function preparerEmpreinte({ motDePasse, hash, sel } = {}) {
  if (motDePasse !== undefined && motDePasse !== null && motDePasse !== '') {
    if (String(motDePasse).length < LONGUEUR_MINI) {
      const e = new Error(`Le mot de passe doit contenir au moins ${LONGUEUR_MINI} caracteres`);
      e.statut = 400;
      throw e;
    }
    const nouveauSel = genererSel();
    return { hash: hacherMotDePasse(motDePasse, nouveauSel), sel: nouveauSel };
  }
  if (hash && sel) {
    // Filet : une empreinte SHA-256 hexadécimale fait 64 caractères. Tout le
    // reste trahit un client qui n'a pas le bon algorithme — le refuser tout
    // de suite vaut mieux qu'un compte muet découvert à la prochaine connexion.
    if (!/^[0-9a-f]{64}$/i.test(String(hash))) {
      const e = new Error('Empreinte de mot de passe invalide');
      e.statut = 400;
      throw e;
    }
    return { hash: String(hash), sel: String(sel) };
  }
  return null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Dépôt — la seule couche qui parle à la base.
   Isolée pour que les tests puissent la remplacer par un double en mémoire.
   ═══════════════════════════════════════════════════════════════════════════ */

export function depotSupabase() {
  const sb = () => supabaseAdmin();

  return {
    /**
     * ⚠️ LE `.order()` CI-DESSOUS N'EST PAS COSMÉTIQUE.
     * La base contient des comptes EN DOUBLE — `imprimerieogooue@gmail.com`
     * existe 3 fois en rôle admin, avec 3 empreintes différentes (re-vérifié le
     * 17/09/2026). `auth-login` fait un `.find()` sur l'e-mail : il retient donc
     * LE PREMIER de la liste. Sans tri, Postgres renvoie les lignes dans un
     * ordre non garanti et la connexion réussirait ou échouerait au hasard.
     * Ce tri reproduit le comportement historique du client. Ne pas le retirer
     * avant d'avoir dédoublonné — voir api/_lib/supabase-admin.js.
     */
    async lireEmployes() {
      const { data, error } = await sb()
        .from('app_data')
        .select('id, data')
        .eq('collection', 'employes')
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      return (data || []).map((r) => r.data);
    },

    async lireEmploye(id) {
      const { data } = await sb()
        .from('app_data').select('data')
        .eq('id', id).eq('collection', 'employes')
        .maybeSingle();
      return data?.data || null;
    },

    async insererEmploye(id, donnees) {
      const { error } = await sb().from('app_data')
        .insert({ id, collection: 'employes', data: donnees });
      if (error) throw new Error(error.message);
    },

    async majEmploye(id, donnees) {
      const { error } = await sb().from('app_data')
        .update({ data: donnees })
        .eq('id', id).eq('collection', 'employes');
      if (error) throw new Error(error.message);
    },

    async supprimerEmploye(id) {
      const { error } = await sb().from('app_data')
        .delete().eq('id', id).eq('collection', 'employes');
      if (error) throw new Error(error.message);
    },

    async ecrireIdentifiants(employeId, { hash, sel }) {
      const { error } = await sb().from('auth_credentials').upsert(
        {
          employe_id: employeId,
          password_hash: hash,
          password_salt: sel,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'employe_id' },
      );
      if (error) {
        if (tableIdentifiantsAbsente(error)) throw new IdentifiantsIndisponibles(error);
        throw new Error(error.message);
      }
    },

    async supprimerIdentifiants(employeId) {
      const { error } = await sb().from('auth_credentials').delete().eq('employe_id', employeId);
      // Une table absente n'est pas un échec de suppression : il n'y avait rien.
      if (error && !tableIdentifiantsAbsente(error)) throw new Error(error.message);
    },

    /**
     * Quels employés possèdent un mot de passe — la QUESTION, pas l'empreinte.
     *
     * Pourquoi cette fonction existe. L'écran Paramètres affichait un badge
     * « Sans mdp » en testant `employe.password_hash`. Or `filtrer()` retire
     * volontairement ce champ avant l'envoi (CHAMPS_IDENTIFIANTS) : le badge
     * était donc TOUJOURS « Sans mdp », y compris pour les sept comptes qui
     * avaient bel et bien un mot de passe. Un indicateur de sécurité qui se
     * trompe dans le sens alarmiste finit par être ignoré — et le jour où un
     * compte est vraiment sans mot de passe, plus personne ne le voit.
     *
     * On ne renvoie donc jamais l'empreinte : seulement la liste des identifiants
     * qui en ont une. Le navigateur apprend « oui » ou « non », rien de plus.
     */
    async identifiantsExistants() {
      const { data, error } = await sb().from('auth_credentials').select('employe_id');
      if (error) {
        // Table absente : on ne sait pas. Mieux vaut ne rien affirmer que mentir.
        if (tableIdentifiantsAbsente(error)) return null;
        throw new Error(error.message);
      }
      return new Set((data || []).map((l) => l.employe_id));
    },

    async ecrireJournal(entree) {
      const id = crypto.randomUUID();
      await sb().from('app_data').insert({
        id, collection: 'audit_logs', data: { ...entree, id },
      });
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Journalisation — l'acte, jamais le secret ; et QUI l'a fait
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Écrit une ligne d'audit. N'échoue JAMAIS l'action métier : un journal
 * indisponible ne doit pas empêcher un gérant de créer un employé au comptoir.
 *
 * L'AUTEUR vient du jeton VÉRIFIÉ (`session`, rendu par `exigerSession` /
 * `sessionDepuisRequete`) : identifiant et rôle signés par le serveur, nom relu
 * sur la fiche employé. Avant le 24/09/2026 cette fonction écrivait
 * `user_nom: 'Serveur'` — l'administrateur qui a changé le mot de passe de
 * l'accueil le 18/09 s'y lisait comme une machine.
 *
 * Sans session (inscription publique), l'auteur est ANONYME, avec
 * `contexteSansSession` pour dire pourquoi.
 *
 * Aucun mot de passe n'est transmis ici par les appelants, et `ligneJournal`
 * passe les métadonnées par `assainir`.
 */
export async function journaliser(depot, {
  action, module = 'employes', session, contexteSansSession,
  entityId, entityLabel, details, metadata,
}) {
  try {
    let employe = null;
    if (session?.sub && typeof depot.lireEmploye === 'function') {
      // Un nom introuvable n'empêche pas d'écrire : l'identifiant et le rôle
      // signés suffisent à dire qui, le nom sera « non enregistré ».
      employe = await depot.lireEmploye(session.sub).catch(() => null);
    }
    await depot.ecrireJournal(ligneJournal({
      auteur: auteurDepuisSessionServeur(session, { employe, contexte: contexteSansSession }),
      action,
      module,
      entityId,
      entityLabel,
      details,
      metadata,
    }));
  } catch (e) {
    console.error('[journal]', e.message);
  }
}
