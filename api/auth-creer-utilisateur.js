/**
 * Creation d'un compte — cote serveur.
 *
 * Deux usages, deux niveaux d'autorisation :
 *  - inscription publique d'un CLIENT : sans session, role force a 'client'
 *  - creation par un ADMIN : session admin requise, role libre
 *
 * Avant : `createUser()` ecrivait directement dans `employes` depuis le navigateur.
 * Le role venait du client, donc n'importe qui pouvait s'inscrire administrateur.
 * C'est le chemin de prise de controle que ferme ce fichier.
 *
 * ── CE QUI A CHANGE LE 17/09/2026 ──────────────────────────────────────────
 *
 * L'ordre des deux ecritures etait : employe d'abord, identifiants ensuite.
 * La table `auth_credentials` n'existant pas encore en production (migration 001
 * jamais appliquee, verifie le 17/09/2026), la seconde echouait SYSTEMATIQUEMENT
 * et la premiere restait. Chaque tentative d'inscription laissait donc derriere
 * elle un compte sans mot de passe : le visiteur voyait « Erreur serveur », puis
 * « Un compte avec cet email existe deja » a l'essai suivant, et ne pouvait plus
 * jamais entrer ni recommencer.
 *
 * L'ordre est desormais inverse, et le retour arriere est explicite : soit le
 * compte existe AVEC son mot de passe, soit il n'existe pas du tout.
 */
import { sessionDepuisRequete } from './_lib/session.js';
import { limiteDepassee } from './_lib/limite.js';
import {
  depotSupabase,
  preparerEmpreinte,
  journaliser,
  IdentifiantsIndisponibles,
  ROLES_CONNUS,
  LONGUEUR_MINI,
} from './_lib/comptes.js';
import crypto from 'node:crypto';

export function creerGestionnaireCreationUtilisateur({ depot } = {}) {
  return async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', process.env.APP_ORIGIN || '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Methode non autorisee' });
    if (limiteDepassee(req, { max: 5, fenetreMs: 60_000, portee: 'creer-utilisateur' })) {
      return res.status(429).json({ error: 'Trop de requetes' });
    }

    const session = sessionDepuisRequete(req);
    const estAdmin = session?.role === 'admin';

    const { email, motDePasse, nom, prenom, telephone, poste, role, extras } = req.body || {};

    if (!email || !motDePasse || !nom) {
      return res.status(400).json({ error: 'Email, mot de passe et nom requis' });
    }
    if (String(motDePasse).length < LONGUEUR_MINI) {
      return res.status(400).json({
        error: `Le mot de passe doit contenir au moins ${LONGUEUR_MINI} caracteres`,
      });
    }

    // LE POINT CENTRAL : sans session admin, le role est impose a 'client'.
    // Le champ `role` du corps de requete est ignore.
    let roleFinal = 'client';
    if (estAdmin) {
      roleFinal = ROLES_CONNUS.includes(role) ? role : 'employe';
    }

    // `extras` ne doit jamais transporter d'identifiants ni de role.
    const extrasPropres = {};
    if (extras && typeof extras === 'object') {
      for (const [cle, valeur] of Object.entries(extras)) {
        if (['password_hash', 'password_salt', 'password_changed_at', 'role', 'id'].includes(cle)) continue;
        extrasPropres[cle] = valeur;
      }
    }

    const d = depot || depotSupabase();

    try {
      const employes = await d.lireEmployes();
      const emailNormalise = String(email).toLowerCase().trim();
      if (employes.some((e) => (e.email || '').toLowerCase().trim() === emailNormalise)) {
        return res.status(409).json({ error: 'Un compte avec cet email existe deja' });
      }

      const id = crypto.randomUUID();
      const maintenant = new Date().toISOString();
      const empreinte = preparerEmpreinte({ motDePasse });

      // ÉTAPE 1 — les identifiants. Si le stockage n'est pas en place, on
      // s'arrete ici : rien n'a ete cree, l'adresse e-mail reste libre, et le
      // visiteur pourra reessayer une fois la migration appliquee.
      try {
        await d.ecrireIdentifiants(id, empreinte);
      } catch (e) {
        if (e instanceof IdentifiantsIndisponibles) {
          console.error('[auth-creer-utilisateur]', e.message);
          return res.status(503).json({
            error: "La creation de compte est momentanement indisponible. Aucun compte n'a ete cree.",
          });
        }
        throw e;
      }

      // ÉTAPE 2 — l'enregistrement metier. Il ne contient NI empreinte NI sel.
      try {
        await d.insererEmploye(id, {
          // Champs metier libres (code de parrainage, type de client, etc.).
          // Poses EN PREMIER pour que les champs d'identite ci-dessous les ecrasent :
          // un client ne doit pas pouvoir se donner un role via `extras`.
          ...extrasPropres,
          id,
          email: emailNormalise,
          nom,
          prenom: prenom || '',
          telephone: telephone || '',
          poste: poste || '',
          role: roleFinal,
          created_at: maintenant,
          updated_at: maintenant,
        });
      } catch (e) {
        // Retour arriere : sans cet appel, un identifiant reste attache a un
        // employe qui n'existe pas, et l'id sera refuse a la prochaine tentative.
        await d.supprimerIdentifiants(id).catch(() => {});
        throw e;
      }

      await journaliser(d, {
        action: 'create',
        module: 'auth',
        session,
        // Sans session, c'est un visiteur qui s'inscrit : un auteur ANONYME,
        // pas « Serveur ».
        contexteSansSession: 'inscription publique',
        entityId: id,
        entityLabel: `${prenom || ''} ${nom}`.trim(),
        details: `Creation de compte ${emailNormalise} (${roleFinal})`
          + (estAdmin ? ' par un administrateur' : ' par inscription publique'),
      });

      return res.status(201).json({
        user: { id, email: emailNormalise, nom, prenom: prenom || '', role: roleFinal },
      });
    } catch (err) {
      console.error('[auth-creer-utilisateur]', err.message);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  };
}

export default creerGestionnaireCreationUtilisateur({});
