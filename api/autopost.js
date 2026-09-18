/**
 * Vercel Serverless Function — l'auto-posteur de l'IMPRIMERIE OGOOUÉ.
 *
 * Deux voies derrière un seul fichier (plafond de 12 fonctions du plan Hobby) :
 *   GET /api/autopost-tick  → un passage : publie ce qui est dû. Appelé par les
 *                             tâches planifiées de `vercel.json`.
 *   GET /api/autopost-etat  → ce que l'écran du gérant affiche : la file, le
 *                             journal, et pourquoi chaque chose n'est pas partie.
 *
 * Le décompte après ce fichier : **11 fonctions sur 12**. Il reste une place.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 🔴 LA VRAIE QUESTION D'ARCHITECTURE : COMMENT L'APPLICATION LIT LE DRIVE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Le dirigeant a décrit la chaîne ainsi : « ChatGPT génère les affiches et met
 * dans le Drive pour que l'auto-post récupère et poste ». Le maillon qui manque
 * n'est ni ChatGPT ni Meta : c'est **le droit de lire le Drive**. L'application
 * ne l'a pas, et il ne s'obtient pas en écrivant du code.
 *
 * Les quatre options, et ce qu'elles coûtent :
 *
 * | Option | Verdict |
 * |---|---|
 * | Rendre le dossier « accessible à toute personne disposant du lien » | ⛔ **Non.** Le Drive contient les baux, les contrats de travail et la procuration bancaire. Le dossier l'interdit explicitement, et un partage par lien ne se révoque pas une fois l'URL diffusée. |
 * | Jeton OAuth d'un utilisateur Google | ⛔ **Non.** Il expire (~7 jours dans l'expérience REZYN, symptôme `invalid_grant`). Un jeton qui expire chaque semaine dans une chaîne censée tourner sans surveillance est un incident programmé, pas une intégration. |
 * | **Compte de service Google, en lecture seule, sur le seul dossier `10_PUBLICATIONS/`** | 🟢 **Recommandé.** Ne demande aucun partage public, n'expire pas (le jeton est re-signé automatiquement), et se révoque en retirant le partage d'un dossier. |
 * | Dépôt par l'application (le gérant téléverse le lot approuvé) | 🟢 **Repli immédiat, déjà en place ici.** Ne demande AUCUNE autorisation Google. Le geste existe déjà : l'approbation du dimanche est manuelle de toute façon. |
 *
 * **Ma recommandation : le compte de service, et le repli d'ici là.**
 *
 * Ce que le compte de service exige de Gassim — et de lui seul, personne
 * d'autre ne peut le faire à sa place (~15 minutes) :
 *
 *   1. Sur console.cloud.google.com, créer un projet (ou réutiliser un existant).
 *   2. Activer l'API Google Drive dessus.
 *   3. Créer un **compte de service**, sans aucun rôle IAM : il n'a besoin
 *      d'aucun droit sur le projet, seulement du partage du dossier.
 *   4. Lui créer une **clé JSON** et la télécharger.
 *   5. Dans le Drive, partager **`00_PILOTAGE_OGOOUE/10_PUBLICATIONS/` et rien
 *      d'autre** avec l'adresse du compte de service, en **Lecteur**.
 *   6. Coller dans Vercel (Production), **sans préfixe `VITE_`** :
 *        `GOOGLE_SERVICE_ACCOUNT_EMAIL`
 *        `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`   (la clé privée du JSON)
 *        `DRIVE_DOSSIER_PUBLICATIONS_ID`        (l'identifiant du dossier)
 *
 * ⛔ Je ne saisis, ne lis et ne manipule aucune de ces valeurs : une clé privée
 * de compte de service est un secret, et c'est le détenteur du compte qui la
 * pose. Tant que les trois variables sont absentes, **le code ne bricole aucun
 * accès** : il le dit dans le journal et s'arrête là.
 *
 * ⚠️ Et le compte de service ne suffira pas à lui seul. L'API Instagram ne
 * reçoit pas de fichier : elle va CHERCHER une URL publiquement accessible. Le
 * chemin complet est donc : Drive (privé) → contrôle du format et empreinte, au
 * moment de l'approbation → dépôt dans un bucket Supabase **privé** → URL
 * signée à durée courte, créée juste avant l'appel. La colonne `url_media` de
 * la file porte cette URL. Sans elle, l'exécuteur refuse de publier plutôt que
 * d'improviser.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LA PRÉCISION HORAIRE RÉELLEMENT ATTEINTE — mesurée, pas promise
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Les tâches planifiées du plan Hobby partent **une fois par jour, à l'heure
 * près** (±59 min). On ne peut donc pas tenir 17 h 30 à la minute, et ce fichier
 * ne prétend pas le contraire.
 *
 * La conception : **une tâche par heure qui publie tout ce qui est dû**, au lieu
 * d'une tâche par créneau. Résultat, calculé dans `autopost-selection.js` :
 *
 *   - créneau de 09 h 00 → publié dans les **59 minutes** au pire ;
 *   - créneau de 17 h 30 → publié dans les **89 minutes** au pire ;
 *   - jamais en avance, jamais avant l'heure dite.
 *
 * ⚠️ Conséquence à ne pas manquer : la tolérance par défaut du contrat est de
 * 30 minutes. À 17 h 30, une publication sur deux serait donc **jetée**. La
 * sélection le signale AVANT que le créneau ne passe (`alertes`), et l'écran
 * l'affiche. Le remède est au choix de Gassim : porter `tolerance_minutes` à 90
 * dans les `publication.json`, ou passer au plan Vercel Pro (≈ 20 $/mois) qui
 * ramène la précision à la minute.
 *
 * ── Ce que `vercel.json` déclare, et pourquoi ────────────────────────────────
 * 16 tâches, une par heure de **05:00Z à 20:00Z**, soit 06 h 00 à 21 h 59
 * locales. Chacune est une tâche quotidienne (la seule forme que le plan Hobby
 * accepte) ; c'est leur nombre, pas leur fréquence, qui fait la cadence horaire.
 * Chaque chemin porte un `&h=NN` distinct pour que les 16 entrées soient bien
 * des chemins différents.
 *
 * ⚠️ `[À VÉRIFIER AU PREMIER DÉPLOIEMENT]` le nombre de tâches que le plan
 * accepte réellement. Le dossier a relevé 100 par projet en plan Hobby ; si le
 * déploiement en refuse davantage que N, il suffit de retirer des lignes : le
 * code ne dépend pas de leur nombre, seul le retard maximal augmente. La
 * formule est dans `retardMaxGarantiMinutes()`, et l'écran affiche le chiffre
 * obtenu plutôt qu'un chiffre promis.
 */
import { exigerSession, empreintesEgales } from './_lib/session.js';
import { limiteDepassee } from './_lib/limite.js';
import { voieDemandee } from './_lib/routage.js';
import { supabaseAdmin } from './_lib/supabase-admin.js';
import { depotSupabaseAutopost } from './_lib/autopost-depot.js';
import { creerClientMeta } from './_lib/autopost-meta.js';
import { executerPassage, modeGlobalDemande } from './_lib/autopost-executeur.js';
import { sonderDrive, lireConfigurationDrive, DIAGNOSTICS, MESSAGES } from './_lib/drive.js';

/** Voies servies par ce point d'entrée. */
export const VOIES_AUTOPOST = Object.freeze(['tick', 'etat']);

/** Chemins publics historiques → voie (voir `api/_lib/routage.js`). */
export const CHEMINS_AUTOPOST = Object.freeze({
  '/api/autopost-tick': 'tick',
  '/api/autopost-etat': 'etat',
});

/**
 * Résout la voie. Exportée pour être testée sans réseau.
 * Défaut `null` : `/api/autopost` nu est refusé en 404 plutôt que d'atterrir au
 * hasard sur la branche qui publie.
 */
export function voieAutopost(req) {
  return voieDemandee(req, {
    cheminsConnus: CHEMINS_AUTOPOST,
    voies: VOIES_AUTOPOST,
    defaut: null,
  });
}

/**
 * Qui a le droit de déclencher un passage ?
 *
 * Deux appelants légitimes, et deux seulement :
 *   - la tâche planifiée Vercel, qui présente `Authorization: Bearer $CRON_SECRET` ;
 *   - un administrateur connecté, depuis le bouton « lancer un passage » de l'écran.
 *
 * Sans `CRON_SECRET` posé, l'endpoint refuse TOUT appel de tâche : une URL
 * publique qui publie sur la Page de l'entreprise n'est pas une option.
 *
 * @returns {{autorise: boolean, par: string}}
 */
export function autorisationTick(req) {
  const attendu = (process.env.CRON_SECRET || '').trim();
  const entete = String(req.headers?.authorization || '');
  if (attendu && entete.startsWith('Bearer ') && empreintesEgales(entete.slice(7), attendu)) {
    return { autorise: true, par: 'cron' };
  }
  return { autorise: false, par: 'inconnu' };
}

/**
 * Le gestionnaire. Les dépendances sont injectables pour que les tests ne
 * touchent ni le réseau ni la base.
 */
export function creerGestionnaireAutopost({
  depot: depotFourni = null,
  client: clientFourni = null,
  maintenant = () => new Date(),
  sonde = sonderDrive,
} = {}) {
  /**
   * ⛔ LE SONDAGE DU DRIVE, ET SON FILET.
   *
   * Il fait un VRAI appel à Google (un seul listing) pour que l'écran puisse
   * distinguer les quatre causes : variables absentes, clé refusée, dossier non
   * partagé, dossier vide. Chacune appelle un geste différent ; un message
   * unique pour les quatre fait perdre une heure.
   *
   * Et il ne peut pas faire tomber la lecture d'état : la file et le journal
   * doivent rester lisibles même quand Google est injoignable. `sonderDrive()`
   * ne lève déjà pas ; ce `catch` est le filet du filet.
   */
  async function etatDrive() {
    try {
      return await sonde();
    } catch (err) {
      return {
        diagnostic: DIAGNOSTICS.PANNE,
        message: MESSAGES.panne,
        piste: 'Réessayer au prochain passage. La file et le journal, eux, sont à jour.',
        detail: `sondage impossible : ${err?.message || err}`,
      };
    }
  }

  return async function gestionnaireAutopost(req, res) {
    const voie = voieAutopost(req);
    if (voie === null) {
      return res.status(404).json({ error: 'Ressource inconnue' });
    }
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Méthode non autorisée' });
    }

    /* ── VOIE « etat » : lecture seule, pour l'écran du gérant ───────────── */
    if (voie === 'etat') {
      if (limiteDepassee(req, { max: 60, fenetreMs: 60_000, portee: 'autopost-etat' })) {
        return res.status(429).json({ error: 'Trop de requêtes' });
      }
      const session = exigerSession(req, res);
      if (!session) return undefined;
      try {
        const depot = depotFourni || depotSupabaseAutopost(supabaseAdmin());
        const [file, journal, controle] = await Promise.all([
          depot.lireEtatComplet({ limite: 200 }),
          depot.lireJournal({ limite: 100 }),
          depot.lireArretGlobal(),
        ]);
        return res.status(200).json({
          controle,
          mode_global: modeGlobalDemande(),
          jeton_meta_present: Boolean((process.env.META_PAGE_ACCESS_TOKEN || '').trim()),
          // ⚠️ Ce booléen dit seulement que TROIS VARIABLES SONT POSÉES. Il ne
          //    dit RIEN de ce que le robot peut lire — c'était le faux témoin
          //    du 18/09 : le voyant passait au vert sans qu'aucune ligne de
          //    code n'ait jamais ouvert le Drive. Il est conservé pour la
          //    compatibilité de l'écran ; ce qui fait foi, c'est `drive`.
          acces_drive_configure: lireConfigurationDrive().configure,
          drive: await etatDrive(),
          file,
          journal,
        });
      } catch (err) {
        console.error('[autopost] lecture d\'état impossible :', err?.message);
        // Dire la panne. Un écran vide qui ressemble à « rien de prévu » est
        // exactement le piège documenté dans `src/services/db.js`.
        return res.status(503).json({ error: 'État indisponible', detail: err?.message });
      }
    }

    /* ── VOIE « tick » : le passage qui publie ───────────────────────────── */
    const droit = autorisationTick(req);
    let session = null;
    if (!droit.autorise) {
      session = exigerSession(req, res);
      if (!session) return undefined;
      if (session.role !== 'admin') {
        return res.status(403).json({ error: 'Réservé à un administrateur' });
      }
    }

    try {
      const depot = depotFourni || depotSupabaseAutopost(supabaseAdmin());
      const client = clientFourni || creerClientMeta();
      const bilan = await executerPassage({
        depot,
        client,
        instant: maintenant(),
        options: {},
      });
      return res.status(200).json({ ok: true, declenche_par: droit.autorise ? 'cron' : 'admin', bilan });
    } catch (err) {
      console.error('[autopost] passage en échec :', err?.message);
      return res.status(500).json({ error: 'Passage en échec', detail: err?.message });
    }
  };
}

export default creerGestionnaireAutopost();
