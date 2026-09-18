/**
 * Acces a la collection `employes` — filtre par role, cote serveur.
 *
 * POURQUOI
 * 13 ecrans appelaient `db.employes.list()`, ce qui rapatriait dans le navigateur de
 * chaque utilisateur — quel que soit son role — la table complete du personnel :
 * salaires, telephones, et (avant la migration 001) empreintes de mots de passe.
 * Le filtrage n'existait qu'a l'affichage, en React : la donnee etait deja partie.
 *
 * Ici le filtrage est fait AVANT l'envoi, selon le role inscrit dans le jeton signe.
 * Un employe ne recoit jamais le salaire d'un collegue, meme s'il inspecte le reseau.
 *
 * ── CE QUI A CHANGE LE 17/09/2026, ET POURQUOI C'EST IMPORTANT ─────────────
 *
 * Ce fichier supprimait `password_hash` et `password_salt` du corps de requete
 * avant d'ecrire — une precaution juste, appliquee au mauvais endroit. L'ecran
 * Parametres envoie ces deux champs a CHAQUE creation d'utilisateur et a chaque
 * changement de mot de passe depuis le formulaire d'edition. Ils etaient donc
 * jetes en silence, et le resultat mesure etait :
 *
 *   • utilisateur cree depuis Parametres  → compte SANS mot de passe, connexion
 *     impossible a jamais, et l'adresse e-mail devient « deja prise » ;
 *   • mot de passe change depuis l'edition → « Utilisateur modifié » a l'ecran,
 *     et l'ancien mot de passe reste le seul valide.
 *
 * Desormais ces champs ne sont plus jetes : ils sont DEPLACES vers
 * `auth_credentials`, la table sans policy RLS. Ils n'entrent toujours jamais
 * dans `app_data`, et ne ressortent jamais vers un navigateur.
 */
import { exigerSession } from './_lib/session.js';
import { limiteDepassee } from './_lib/limite.js';
import {
  depotSupabase,
  separerIdentifiants,
  preparerEmpreinte,
  journaliser,
  IdentifiantsIndisponibles,
  CHAMPS_IDENTIFIANTS,
} from './_lib/comptes.js';
import crypto from 'node:crypto';

/** Champs visibles par tous les utilisateurs authentifies : l'annuaire interne. */
export const CHAMPS_PUBLICS = ['id', 'nom', 'prenom', 'email', 'telephone', 'poste', 'role', 'actif'];

/** Champs reserves aux administrateurs. */
export const CHAMPS_SENSIBLES = ['salaire_base', 'date_entree', 'date_naissance', 'adresse', 'cnss'];

/** Ne sortent JAMAIS, quel que soit le role. */
export const CHAMPS_INTERDITS = CHAMPS_IDENTIFIANTS;

export function filtrer(employe, role) {
  const champs = role === 'admin' ? [...CHAMPS_PUBLICS, ...CHAMPS_SENSIBLES] : CHAMPS_PUBLICS;
  const sortie = {};
  for (const c of champs) {
    if (employe[c] !== undefined) sortie[c] = employe[c];
  }
  for (const interdit of CHAMPS_INTERDITS) delete sortie[interdit];
  return sortie;
}

/**
 * Fabrique le gestionnaire. `depot` est injectable pour les tests : c'est la
 * seule facon d'exercer ces chemins sans base de donnees, et donc la seule
 * facon de prouver qu'un mot de passe n'est plus perdu.
 */
export function creerGestionnaireEmployes({ depot } = {}) {
  return async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', process.env.APP_ORIGIN || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (limiteDepassee(req, { max: 60, fenetreMs: 60_000, portee: 'employes' })) {
      return res.status(429).json({ error: 'Trop de requetes' });
    }

    const session = exigerSession(req, res);
    if (!session) return;
    const estAdmin = session.role === 'admin';

    const d = depot || depotSupabase();

    try {
      // ── LECTURE ──
      if (req.method === 'GET') {
        const employes = await d.lireEmployes();
        // `a_mot_de_passe` est une REPONSE, pas une empreinte : l'ecran a besoin de
        // savoir si le compte peut se connecter, jamais de savoir avec quoi.
        // `null` = la question n'a pas pu etre posee : l'ecran n'affiche alors aucun
        // badge plutot que d'en inventer un.
        // Un depot injecte qui ne sait pas repondre rend `null` : on n'affiche alors
        // aucun badge. Mieux vaut ne rien dire que dire faux — c'etait tout le defaut
        // de la version precedente.
        const avecIdentifiants = typeof d.identifiantsExistants === 'function'
          ? await d.identifiantsExistants()
          : null;
        return res.status(200).json({
          employes: employes.map((e) => ({
            ...filtrer(e, session.role),
            a_mot_de_passe: avecIdentifiants ? avecIdentifiants.has(e.id) : null,
          })),
        });
      }

      // ── ECRITURES : administrateur uniquement ──
      if (!estAdmin) return res.status(403).json({ error: 'Action reservee a un administrateur' });

      if (req.method === 'POST') {
        const { propre, identifiants } = separerIdentifiants(req.body?.data || {});

        // Le mot de passe est prepare AVANT toute ecriture : une entree invalide
        // doit echouer sans avoir rien cree.
        let empreinte;
        try {
          empreinte = preparerEmpreinte({ motDePasse: req.body?.motDePasse, ...(identifiants || {}) });
        } catch (e) {
          return res.status(e.statut || 400).json({ error: e.message });
        }

        const id = propre.id || crypto.randomUUID();
        const maintenant = new Date().toISOString();

        // ORDRE DELIBERE : les identifiants d'abord.
        // Si `auth_credentials` est indisponible (migration 001 non appliquee),
        // rien n'est cree du tout — plutot qu'un compte muet dont l'adresse
        // e-mail est desormais prise et que personne ne pourra jamais utiliser.
        if (empreinte) {
          try {
            await d.ecrireIdentifiants(id, empreinte);
          } catch (e) {
            if (e instanceof IdentifiantsIndisponibles) {
              return res.status(503).json({ error: e.message });
            }
            throw e;
          }
        }

        try {
          await d.insererEmploye(id, {
            ...propre, id, created_at: maintenant, updated_at: maintenant,
          });
        } catch (e) {
          // Retour arriere : pas d'identifiants orphelins pour un employe inexistant.
          if (empreinte) await d.supprimerIdentifiants(id).catch(() => {});
          throw e;
        }

        await journaliser(d, {
          action: 'create', session, entityId: id,
          entityLabel: `${propre.prenom || ''} ${propre.nom || ''}`.trim(),
          details: `Creation utilisateur ${propre.email || ''} (${propre.role || 'employe'})`
            + (empreinte ? ' avec mot de passe' : ' sans mot de passe'),
        });

        return res.status(201).json({ id });
      }

      if (req.method === 'PATCH') {
        const { id } = req.body || {};
        if (!id) return res.status(400).json({ error: 'Identifiant requis' });

        const { propre, identifiants } = separerIdentifiants(req.body?.data || {});

        let empreinte;
        try {
          empreinte = preparerEmpreinte({ motDePasse: req.body?.motDePasse, ...(identifiants || {}) });
        } catch (e) {
          return res.status(e.statut || 400).json({ error: e.message });
        }

        const existant = await d.lireEmploye(id);
        if (!existant) return res.status(404).json({ error: 'Employe introuvable' });

        // La encore les identifiants d'abord : si le stockage est indisponible,
        // l'admin recoit un refus franc au lieu d'un « Utilisateur modifié »
        // suivi d'un mot de passe qui n'a pas change.
        if (empreinte) {
          try {
            await d.ecrireIdentifiants(id, empreinte);
          } catch (e) {
            if (e instanceof IdentifiantsIndisponibles) {
              return res.status(503).json({ error: e.message });
            }
            throw e;
          }
        }

        // L'enregistrement metier est nettoye des identifiants, y compris ceux
        // qui pourraient rester d'avant la migration.
        const fusion = { ...existant, ...propre, id, updated_at: new Date().toISOString() };
        for (const champ of CHAMPS_INTERDITS) delete fusion[champ];
        if (empreinte) fusion.password_changed_at = new Date().toISOString();

        await d.majEmploye(id, fusion);

        await journaliser(d, {
          action: 'update', session, entityId: id,
          entityLabel: `${fusion.prenom || ''} ${fusion.nom || ''}`.trim(),
          details: `Modification utilisateur ${fusion.email || ''}`
            + (empreinte ? ' — mot de passe change' : ''),
        });

        return res.status(200).json({ success: true, motDePasseChange: Boolean(empreinte) });
      }

      if (req.method === 'DELETE') {
        const id = req.query?.id || req.body?.id;
        if (!id) return res.status(400).json({ error: 'Identifiant requis' });
        if (id === session.sub) {
          return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte' });
        }
        const existant = await d.lireEmploye(id);
        await d.supprimerIdentifiants(id);
        await d.supprimerEmploye(id);

        await journaliser(d, {
          action: 'delete', session, entityId: id,
          entityLabel: existant ? `${existant.prenom || ''} ${existant.nom || ''}`.trim() : '',
          details: `Suppression utilisateur ${existant?.email || id}`,
        });

        return res.status(200).json({ success: true });
      }

      return res.status(405).json({ error: 'Methode non autorisee' });
    } catch (err) {
      console.error('[employes]', err.message);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  };
}

export default creerGestionnaireEmployes({});
