/**
 * Vercel Serverless Function — l'auto-posteur de l'IMPRIMERIE OGOOUÉ.
 *
 * Trois voies derrière un seul fichier (plafond de 12 fonctions du plan Hobby) :
 *   GET  /api/autopost-tick      → un passage : alimente la file depuis le
 *                                  Drive, puis publie ce qui est dû. Appelé par
 *                                  les tâches planifiées de `vercel.json`.
 *   GET  /api/autopost-etat      → ce que l'écran du gérant affiche : la file, le
 *                                  journal, et pourquoi chaque chose n'est pas
 *                                  partie.
 *   POST /api/autopost-alimenter → relit le Drive et remplit la file, sans rien
 *                                  publier. Le bouton de l'écran.
 *
 * ⚠️ `api/` compte **12 fonctions sur 12**. Il n'y a plus AUCUNE place : une
 * voie de plus est une voie de plus DANS CE FICHIER, jamais un fichier de plus.
 * Un 13e fichier fait échouer le déploiement à l'étape « Deploying outputs »,
 * build vert compris — c'est arrivé le 17/09/2026, et plus rien ne se
 * déployait, pas même le webhook Meta.
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
 * ⚠️ Et le compte de service ne suffit pas à lui seul. L'API Instagram ne reçoit
 * pas de fichier : elle va CHERCHER une URL publiquement accessible. Ce maillon
 * existe depuis le 19/09/2026 (`api/_lib/autopost-medias.js`) :
 *
 *   Drive (privé, lecture seule) → contrôle du type et du poids → dépôt dans le
 *   bucket Supabase **`publications`** → adresse publique, écrite dans la
 *   colonne `url_media` de la file. Sans elle, l'exécuteur refuse de publier
 *   plutôt que d'improviser.
 *
 * 🔴 POURQUOI UN BUCKET PUBLIC ET NON UNE URL SIGNÉE À DURÉE COURTE — la
 * question a été tranchée, et dans l'autre sens que ce fichier l'annonçait :
 *
 *   1. Meta ne va pas chercher le média au moment où on l'appelle. La création
 *      d'un conteneur Instagram est asynchrone, et la reprise d'un conteneur
 *      orphelin peut arriver bien plus tard. Une adresse qui expire est une
 *      course perdue d'avance — et elle serait perdue au pire moment, une fois
 *      la publication déjà acceptée.
 *   2. Ce bucket ne contient QUE des affiches sur le point d'être publiées sur
 *      la page publique de l'entreprise. Le rendre lisible ne révèle rien que
 *      la publication ne s'apprête à révéler elle-même. C'est la différence
 *      exacte avec le Drive, qui porte les baux et la procuration bancaire — et
 *      c'est pour ça que le Drive, lui, reste privé et en lecture seule.
 *   3. Il reste FERMÉ EN ÉCRITURE : `storage.objects` a RLS activé et aucune
 *      policy, donc seul le rôle de service (le serveur) y dépose quoi que ce
 *      soit. Public ne veut pas dire ouvert.
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
import { creerClientMeta, TYPE_JETON } from './_lib/autopost-meta.js';
import { executerPassage, modeGlobalDemande, comptesDepuisEnvironnement } from './_lib/autopost-executeur.js';
import { alimenterFile } from './_lib/autopost-alimentation.js';
import { traiterApprobation, cleSignatureApprobation } from './_lib/autopost-approbation.js';
import { creerHebergeurMedias, stockageSupabase } from './_lib/autopost-medias.js';
import { sonderDrive, lireConfigurationDrive, creerClientDrive, DIAGNOSTICS, MESSAGES } from './_lib/drive.js';

/** Voies servies par ce point d'entrée. */
export const VOIES_AUTOPOST = Object.freeze(['tick', 'etat', 'alimenter', 'approuver']);

/**
 * ⛔ LE VOYANT QUI MANQUAIT LE 19/09/2026 — LE TYPE DU JETON.
 *
 * Ce jour-là, Instagram a publié et Facebook a refusé avec le même jeton, et il
 * a fallu deux heures pour comprendre que la cause n'était pas une autorisation
 * manquante mais le TYPE du jeton (voir l'en-tête de `autopost-meta.js`).
 * Personne ne pouvait le voir : rien à l'écran ne disait ce que le jeton est.
 *
 * Mémo court, et pour une seule raison : l'écran se recharge à chaque geste du
 * gérant, et Meta compte les appels par application. La valeur mémorisée est
 * un MOT et une phrase française — jamais un jeton, jamais un fragment, jamais
 * une longueur. Une minute suffit : le type d'un jeton ne change pas dans la
 * minute, et il se remesure au rechargement suivant.
 */
const MEMO_TYPE_JETON = { pose_a: 0, valeur: null };
const MEMO_TYPE_JETON_MS = 60_000;

/** Chemins publics historiques → voie (voir `api/_lib/routage.js`). */
export const CHEMINS_AUTOPOST = Object.freeze({
  '/api/autopost-tick': 'tick',
  '/api/autopost-etat': 'etat',
  '/api/autopost-alimenter': 'alimenter',
  // ⚠️ `approuver` est une VOIE DE PLUS DANS CE FICHIER, jamais un 13e fichier
  //    dans `api/` : `ls api/*.js | wc -l` doit rendre 12. Le 17/09/2026, un 13e
  //    fichier a fait échouer le déploiement à l'étape « Deploying outputs »,
  //    build vert compris, et plus rien ne se déployait.
  '/api/autopost-approuver': 'approuver',
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
 * Le corps JSON d'une requête d'écriture.
 *
 * Vercel analyse déjà `application/json` et pose l'objet sur `req.body` ; les
 * tests le posent directement. On tolère la chaîne pour les exécutions locales
 * où l'analyse n'a pas eu lieu — et un JSON illisible rend `null`, ce que
 * l'appelant refuse en disant quoi envoyer.
 */
function corpsJson(req) {
  const brut = req?.body;
  if (brut === undefined || brut === null || brut === '') return null;
  if (typeof brut === 'string') {
    try { return JSON.parse(brut); } catch { return null; }
  }
  if (typeof brut === 'object') return brut;
  return null;
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
  alimente = null,
} = {}) {
  /**
   * ⛔ LE MAILLON QUI MANQUAIT — le Drive devient des lignes de file.
   *
   * Il tourne AVANT la sélection à chaque passage, et à la demande depuis
   * l'écran. Deux précautions qui comptent plus que le code :
   *
   *   1. il est enveloppé : une panne Google ne doit PAS empêcher de publier ce
   *      qui est déjà en file. Alimenter et publier sont deux gestes, et le
   *      second ne dépend pas du premier ;
   *   2. il ne consulte aucun verrou. Alimenter n'est pas publier : la chaîne
   *      est à l'arrêt et en simulation, et la file doit quand même se remplir,
   *      sinon il n'y a rien à regarder avant d'ouvrir les verrous.
   */
  async function alimenter(depot, instantUtc) {
    /* 🔴 LE RÉGLAGE D'APPROBATION AUTOMATIQUE — LU ICI, PAS DANS LE MODULE.
       `alimenterFile()` ne consulte AUCUN verrou, et un test l'exige
       (« l'alimentation n'appelle pas lireArretGlobal »). La politique
       d'approbation est donc lue par l'appelant et passée en paramètre : le
       module applique, il ne décide pas.

       ⛔ `lireReglages()` et NON `lireArretGlobal()`, alors que les deux lisent
          la même ligne. Approuver n'est pas publier, et le nom de la lecture le
          dit : personne ne pourra un jour se servir de l'un comme autorisation
          pour l'autre.

       En cas de panne de lecture : on retient le DÉFAUT DU SYSTÈME (`true`,
       décision de Gassim du 19/09/2026), pas un refus silencieux. Une base
       injoignable fera de toute façon échouer l'alimentation juste après — ce
       n'est pas le moment d'inventer une politique. */
    let reglages = null;
    try {
      if (typeof depot.lireReglages === 'function') reglages = await depot.lireReglages();
    } catch (err) {
      console.error('[autopost] réglages illisibles, défaut appliqué :', err?.message);
    }
    const approbationAutomatique = reglages?.approbation_automatique !== false;

    const faire = alimente || (async (arg) => {
      // ⛔ Le MÊME client Drive sert à lire les manifestes ET à télécharger les
      //    octets des médias : une seule configuration, un seul jeton, un seul
      //    compteur de requêtes. Deux clients, ce seraient deux comptages, et le
      //    garde-fou des 150 requêtes ne garderait plus rien.
      const client = creerClientDrive();
      return alimenterFile({
        ...arg,
        client,
        // 🔴 L'hébergement des médias. Sans lui, les lignes entrent en file sans
        //    adresse joignable et l'exécuteur refuse de publier. Il est construit
        //    ICI, dans le `try` de l'appelant : une clé Supabase absente donne un
        //    diagnostic, pas une exception qui traverse le passage.
        medias: creerHebergeurMedias({
          stockage: stockageSupabase(supabaseAdmin()),
          client,
          tracer: (...a) => console.log(...a),
        }),
      });
    });
    try {
      return await faire({
        depot,
        instant: instantUtc,
        approbationAutomatique,
        // La clé HMAC si elle est posée — la MÊME que celle du bouton. Absente
        // aujourd'hui : l'approbation automatique est alors écrite sans
        // signature, exactement comme celle de l'écran, et l'écran le dit.
        cleSignature: cleSignatureApprobation(),
      });
    } catch (err) {
      console.error('[autopost] alimentation impossible :', err?.message);
      return {
        instant_utc: instantUtc,
        diagnostic: DIAGNOSTICS.PANNE,
        message: MESSAGES.panne,
        detail: `alimentation impossible : ${err?.message || err}`,
        lues: 0,
        creees: 0,
        mises_a_jour: 0,
        remplacees: 0,
        inchangees: 0,
        conflits: 0,
        ecartees: [],
        ecartees_par_le_lecteur: [],
        medias: {
          hebergement: 'absent',
          heberges: 0,
          deja_presents: 0,
          reportes: 0,
          motif_report: null,
          ecartes: [],
        },
        approbation_auto: {
          reglage: approbationAutomatique ? 'activee' : 'desactivee',
          posees: 0,
          humaines_respectees: 0,
          refusees: [],
        },
      };
    }
  }

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

  /**
   * Le type du jeton Meta, pour l'écran. Ne lève jamais, et ne rend jamais
   * autre chose qu'un mot et une phrase : même filet que `etatDrive()`.
   *
   * Sans jeton configuré, `typeDuJeton()` rend `inconnu` SANS toucher au
   * réseau — c'est le garde-fou de `creerClientMeta()`, pas une précaution
   * prise ici.
   *
   * @returns {Promise<{type: string, detail: string}>}
   */
  async function etatTypeJeton(instantMs) {
    if (MEMO_TYPE_JETON.valeur && (instantMs - MEMO_TYPE_JETON.pose_a) < MEMO_TYPE_JETON_MS) {
      return MEMO_TYPE_JETON.valeur;
    }
    let valeur;
    try {
      const client = clientFourni || creerClientMeta();
      const comptes = comptesDepuisEnvironnement();
      valeur = await client.typeDuJeton(comptes.PAGE_IMPRIMERIE || null);
    } catch {
      // ⚠️ Aucun détail de l'exception ne remonte : un message brut de Meta
      //    nomme l'objet visé, et cette réponse part jusqu'au navigateur.
      valeur = {
        type: TYPE_JETON.INCONNU,
        detail: 'Type du jeton non mesurable : Meta n\'a pas répondu à la question.',
      };
    }
    MEMO_TYPE_JETON.pose_a = instantMs;
    MEMO_TYPE_JETON.valeur = valeur;
    return valeur;
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
          /* ⛔ LE TYPE DU JETON, EN UN MOT : `page`, `utilisateur` ou `inconnu`.
             Présent est une chose, du BON TYPE en est une autre — c'est toute
             la leçon du 19/09/2026. Ce champ ne porte ni jeton, ni fragment,
             ni longueur : il porte le résultat d'une question posée à Meta. */
          type_jeton_meta: await etatTypeJeton(maintenant().getTime()),
          /* ⛔ LE 19/09/2026 : les passages planifiés n'ont JAMAIS tourné, et
             personne ne pouvait le voir. Le journal ne portait que les
             pressions manuelles du bouton.

             Vercel n'envoie « Authorization: Bearer … » à une tâche planifiée
             QUE si CRON_SECRET est posée. Sans elle, `autorisationTick()`
             refuse — et un refus de tâche planifiée est SILENCIEUX : pas de
             journal, pas d'écran, rien. Un auto-poster qui ne se déclenche
             jamais tout seul et qui n'a pas l'air en panne est pire qu'un
             auto-poster en panne.

             Ce booléen ne dit QUE si la variable est posée. Jamais sa valeur,
             ni aucun fragment : c'est un secret, et un secret ne traverse pas
             cette réponse. */
          secret_taches_planifiees_pose: Boolean((process.env.CRON_SECRET || '').trim()),
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

    /* ── VOIE « approuver » : le geste humain, et lui seul ───────────────
       ⛔ CETTE VOIE N'ACCEPTE PAS LE SECRET DE LA TÂCHE PLANIFIÉE.
       C'est la différence de fond avec `tick` et `alimenter`. `CRON_SECRET` est
       posé dans Vercel : une machine le présente seize fois par jour. Si on
       l'acceptait ici, la chaîne pourrait s'approuver elle-même — exactement ce
       que tout le dossier interdit, et pour quoi `APPROBATION.json` est un
       fichier séparé que ChatGPT n'a pas le droit d'écrire.

       ⛔ ET CE N'EST PAS « UN BOUTON CACHÉ ». L'écran masque le bouton aux
       non-administrateurs pour ne pas leur proposer un geste qu'ils n'ont pas ;
       ce qui REFUSE, c'est ce bloc, côté serveur : jeton de session signé
       (HMAC, `api/_lib/session.js`), rôle relu DANS le jeton et non dans le
       corps de la requête. Un navigateur qui rétablirait le bouton, ou qui
       appellerait l'URL à la main, reçoit 401 ou 403. */
    if (voie === 'approuver') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Méthode non autorisée' });
      }
      if (limiteDepassee(req, { max: 30, fenetreMs: 60_000, portee: 'autopost-approuver' })) {
        return res.status(429).json({ error: 'Trop de requêtes' });
      }
      const session = exigerSession(req, res);
      if (!session) return undefined;
      if (session.role !== 'admin') {
        return res.status(403).json({ error: 'Réservé à un administrateur' });
      }

      const corps = corpsJson(req);
      if (!corps) return res.status(400).json({ error: 'Corps JSON attendu' });
      if (typeof corps.approuve !== 'boolean') {
        return res.status(400).json({ error: 'approuve doit valoir true (approuver) ou false (retirer)' });
      }

      try {
        const depot = depotFourni || depotSupabaseAutopost(supabaseAdmin());
        const issue = await traiterApprobation({
          depot,
          cle: corps.cle_idempotence,
          approuve: corps.approuve,
          parQui: session.sub,
          instant: maintenant(),
          cleSignature: cleSignatureApprobation(),
        });
        return res.status(issue.statut).json(issue.corps);
      } catch (err) {
        console.error('[autopost] approbation impossible :', err?.message);
        return res.status(500).json({ error: 'Approbation impossible', detail: err?.message });
      }
    }

    /* ── VOIES « tick » et « alimenter » : les deux écrivent en base ──────
       Même porte d'entrée pour les deux : la tâche planifiée avec son secret,
       ou un administrateur connecté. Lire le Drive et remplir la file n'est pas
       une lecture d'écran — c'est une écriture, et elle se protège comme telle. */
    const droit = autorisationTick(req);
    let session = null;
    if (!droit.autorise) {
      session = exigerSession(req, res);
      if (!session) return undefined;
      if (session.role !== 'admin') {
        return res.status(403).json({ error: 'Réservé à un administrateur' });
      }
    }

    const instant = maintenant();

    if (voie === 'alimenter') {
      // Chaque alimentation coûte des appels à Google : on borne le bouton.
      if (limiteDepassee(req, { max: 10, fenetreMs: 60_000, portee: 'autopost-alimenter' })) {
        return res.status(429).json({ error: 'Trop de requêtes' });
      }
      try {
        const depot = depotFourni || depotSupabaseAutopost(supabaseAdmin());
        const alimentation = await alimenter(depot, instant);
        return res.status(200).json({
          ok: true,
          declenche_par: droit.autorise ? 'cron' : 'admin',
          alimentation,
        });
      } catch (err) {
        console.error('[autopost] alimentation en échec :', err?.message);
        return res.status(500).json({ error: 'Alimentation en échec', detail: err?.message });
      }
    }

    try {
      const depot = depotFourni || depotSupabaseAutopost(supabaseAdmin());
      const client = clientFourni || creerClientMeta();

      /* ⛔ L'ORDRE COMPTE : on remplit la file AVANT de la regarder. Sinon une
         publication déposée il y a dix minutes attendrait le passage suivant,
         c'est-à-dire une heure de plus — et à 17 h 30, sa tolérance aurait
         expiré. L'alimentation ne lève pas : si le Drive est injoignable, le
         passage publie quand même ce qui est déjà en file. */
      const alimentation = await alimenter(depot, instant);

      const bilan = await executerPassage({
        depot,
        client,
        instant,
        options: {},
      });
      bilan.alimentation = alimentation;
      return res.status(200).json({ ok: true, declenche_par: droit.autorise ? 'cron' : 'admin', bilan });
    } catch (err) {
      console.error('[autopost] passage en échec :', err?.message);
      return res.status(500).json({ error: 'Passage en échec', detail: err?.message });
    }
  };
}

export default creerGestionnaireAutopost();
