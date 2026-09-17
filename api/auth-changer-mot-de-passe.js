/**
 * Changement de mot de passe — cote serveur.
 *
 * Avant : `changePassword()` ecrivait password_hash et password_salt directement dans
 * la collection `employes` depuis le navigateur, avec la cle anon. N'importe qui
 * pouvait donc remplacer l'empreinte de n'importe quel compte et prendre sa place.
 *
 * Maintenant : l'ecriture passe par la cle service_role, et seul le titulaire du
 * compte — ou un administrateur — peut declencher le changement.
 *
 * ── CE QUI A CHANGE LE 17/09/2026 ──────────────────────────────────────────
 *
 *  • la cible est verifiee : ecrire un identifiant pour un `employe_id`
 *    inexistant creait une ligne orpheline que personne ne pouvait utiliser ;
 *  • l'absence de `auth_credentials` (migration 001 non appliquee) repond 503
 *    avec un message vrai, au lieu d'un 500 opaque qui faisait croire a un bug ;
 *  • l'acte est journalise. Jamais le mot de passe : `journaliser` passe les
 *    metadonnees par `assainir`, et aucun mot de passe ne lui est transmis.
 */
import { exigerSession } from './_lib/session.js';
import { limiteDepassee } from './_lib/limite.js';
import {
  depotSupabase,
  preparerEmpreinte,
  journaliser,
  IdentifiantsIndisponibles,
  LONGUEUR_MINI,
} from './_lib/comptes.js';

export function creerGestionnaireChangementMotDePasse({ depot } = {}) {
  return async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', process.env.APP_ORIGIN || '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Methode non autorisee' });
    if (limiteDepassee(req, { max: 10, fenetreMs: 60_000, portee: 'changer-mot-de-passe' })) {
      return res.status(429).json({ error: 'Trop de requetes' });
    }

    const session = exigerSession(req, res);
    if (!session) return;

    const { userId, nouveauMotDePasse } = req.body || {};
    const cible = userId || session.sub;

    // Un utilisateur ne peut changer que son propre mot de passe. Un admin peut agir sur
    // un autre compte — mais c'est le JETON SIGNE qui dit qu'il est admin, pas le client.
    if (cible !== session.sub && session.role !== 'admin') {
      return res.status(403).json({ error: 'Action non autorisee' });
    }

    if (!nouveauMotDePasse || String(nouveauMotDePasse).length < LONGUEUR_MINI) {
      return res.status(400).json({
        error: `Le mot de passe doit contenir au moins ${LONGUEUR_MINI} caracteres`,
      });
    }

    const d = depot || depotSupabase();

    try {
      // Une empreinte attachee a un employe inexistant n'ouvre aucune session et
      // ne se voit nulle part : autant refuser franchement.
      const employe = await d.lireEmploye(cible);
      if (!employe) return res.status(404).json({ error: 'Compte introuvable' });

      const empreinte = preparerEmpreinte({ motDePasse: nouveauMotDePasse });

      try {
        await d.ecrireIdentifiants(cible, empreinte);
      } catch (e) {
        if (e instanceof IdentifiantsIndisponibles) {
          console.error('[auth-changer-mot-de-passe]', e.message);
          return res.status(503).json({
            error: "Le changement de mot de passe est momentanement indisponible. "
              + "L'ancien mot de passe reste valide.",
          });
        }
        throw e;
      }

      await journaliser(d, {
        action: 'update',
        module: 'auth',
        session,
        entityId: cible,
        entityLabel: `${employe.prenom || ''} ${employe.nom || ''}`.trim(),
        details: cible === session.sub
          ? 'Changement de son propre mot de passe'
          : 'Changement du mot de passe par un administrateur',
      });

      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('[auth-changer-mot-de-passe]', err.message);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  };
}

export default creerGestionnaireChangementMotDePasse({});
