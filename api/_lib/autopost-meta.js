/**
 * Auto-poster — l'appel à l'API Meta (Page Facebook et compte Instagram).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⛔ CE MODULE PART DU PRINCIPE QUE LE JETON N'EXISTE PAS
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Au 18/09/2026, la chaîne de jetons Meta n'a pas été faite : l'écran est
 * préparé, 24 autorisations sont cochées, le bouton n'a pas été cliqué. Et il
 * ne le sera que par Gassim, parce qu'un jeton portant `ads_management` **sans
 * plafond de dépense** est un secret financier.
 *
 * Conséquence de conception : **le mode par défaut est la simulation**, et la
 * simulation ne fait AUCUN appel réseau. Elle ne pose pas non plus
 * d'`id_distant` — sans quoi une répétition à blanc marquerait des publications
 * comme parties, et la vraie publication n'aurait jamais lieu.
 *
 * Le passage en réel exige QUATRE verrous ouverts en même temps, jamais un seul :
 *   1. `META_PAGE_ACCESS_TOKEN` présent dans l'environnement serveur ;
 *   2. la ligne `autopost_controle` en `live` (verrou d'exploitation) ;
 *   3. `AUTOPOST_MODE=live` (cran de sûreté de déploiement) ;
 *   4. `mode_execution: "live"` sur la publication elle-même.
 *
 * ⚠️ Le jeton se lit UNIQUEMENT dans `process.env`. Aucune valeur en dur, aucun
 * jeton en paramètre d'URL, aucun jeton dans un journal — les traces ci-dessous
 * écrivent la longueur du jeton, jamais le jeton.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 🔴 LA QUESTION OUVERTE QUE CE CODE NE TRANCHE PAS, ET NE DOIT PAS SUPPOSER
 * ════════════════════════════════════════════════════════════════════════════
 *
 * L'application Meta « OGOOUE Scheduler » n'est pas publiée. La documentation
 * de Meta dit : « Data generated while an app is in Development mode, such as
 * test posts, can only be seen by role users. » Des intégrateurs rapportent
 * exactement ça sur les Pages Facebook : l'API répond 200, un `post_id` existe,
 * **et le public ne voit rien**.
 *
 * Ce n'est ni confirmé ni infirmé pour notre cas : le test de cinq minutes
 * (publier une photo, la chercher depuis une fenêtre privée déconnectée, et
 * surtout la faire regarder par Ibrahim qui n'a aucun rôle sur l'application)
 * n'a jamais été fait.
 *
 * Ce module ne suppose donc RIEN. Il fait deux choses à la place :
 *
 *   - il n'écrit jamais « publié » comme un fait de visibilité : le résultat
 *     porte `visibilite_publique: "non_verifiee"`, et l'écran l'affiche tel
 *     quel. Un 200 est une acceptation par l'API, pas une preuve de visibilité ;
 *   - il journalise l'échec **précisément** : `code`, `error_subcode`, `type`,
 *     `message` et `fbtrace_id` bruts, plus une piste en français quand la
 *     signature de l'erreur correspond à un mode développement ou à une
 *     autorisation manquante. C'est ce qui permettra de trancher sur des faits.
 */

/**
 * ════════════════════════════════════════════════════════════════════════════
 * 🔵 LE JETON DE PAGE — POURQUOI L'APPLICATION L'OBTIENT ELLE-MÊME
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Mesuré en production le 19/09/2026 à 16 h 33 (Libreville). Avec UN SEUL jeton
 * — `META_PAGE_ACCESS_TOKEN` — et à la même seconde :
 *
 *   instagram — publié — id_distant=17973805920134016
 *   facebook  — code=200 type=OAuthException : (#200) The permission(s)
 *               publish_actions are not available. It has been deprecated.
 *
 * Le dirigeant a vérifié : `pages_manage_posts` EST bien sur le jeton. Le
 * premier diagnostic (« il manque une autorisation ») était donc FAUX. Ce qui
 * reste, c'est le TYPE du jeton :
 *
 *   - l'API Instagram Graph accepte un jeton d'UTILISATEUR — un jeton
 *     d'utilisateur système en est un — dès que le compte lui est attribué ;
 *   - publier sur une PAGE Facebook exige un jeton de PAGE.
 *
 * `publish_actions` était l'ancienne permission de publication *en tant
 * qu'utilisateur*, supprimée par Meta : Graph la cite quand l'appel de
 * publication part sur ce chemin-là, faute de contexte de Page.
 *
 * ⚠️ CE N'EST PAS UNE CERTITUDE, ET CE MODULE NE LA CROIT PAS : il la MESURE.
 * `typeDuJeton()` ci-dessous demande à Meta ce que le jeton configuré est
 * réellement, et le mot obtenu (`page` / `utilisateur` / `inconnu`) remonte
 * jusqu'à l'écran du gérant, à côté des autres voyants. Si l'hypothèse est
 * juste, ce voyant l'aurait dit en dix secondes ; si elle est fausse, il le
 * dira aussi.
 *
 * ── Ce que dit la documentation Meta, mot pour mot ──────────────────────────
 *
 * Champ `access_token` du nœud Page
 * (developers.facebook.com/docs/graph-api/reference/page/) :
 *
 *   « The Page's access token. Only returned if the User making the request has
 *     a role (other than Live Contributor) on the Page. If your business
 *     requires two-factor authentication, the User must also be authenticated »
 *
 * Page « Pages Access Tokens » (developers.facebook.com/docs/pages/access-tokens) :
 *
 *   « To obtain one, first get a user access token, then exchange it for a Page
 *     access token via the Graph API »,  forme documentée :
 *   `GET /{your-user-id}/accounts?access_token={user-access-token}`
 *
 * 🔴 LA FORME RETENUE ICI EST `GET /{page-id}?fields=access_token`, ET PAS
 *    `/me/accounts`. Les deux marchent ; `/me/accounts` rend la liste de TOUTES
 *    les Pages du portefeuille — y compris TopShop GABON — c'est-à-dire
 *    exactement ce que la liste fermée `COMPTES_CIBLES` s'emploie à interdire
 *    (voir `autopost-contrat.js`). On demande la Page qu'on vise, et elle seule.
 *
 * ⛔ TROIS RÈGLES QUE CE CHEMIN NE PEUT PAS ENFREINDRE :
 *
 *   1. le jeton OBTENU est un secret au même titre que le configuré : il ne
 *      sort jamais de ce module — ni journal, ni message d'erreur, ni URL, ni
 *      réponse d'API, ni bundle. Il n'est ni renvoyé, ni comparé à voix haute ;
 *   2. l'échange est tenté UNE SEULE FOIS par passage et par Page. Le succès
 *      comme l'échec sont mis en cache ; un échec est rejoué à l'identique aux
 *      publications suivantes du même passage, sans nouvel appel ;
 *   3. un échec d'échange n'est JAMAIS « incertain ». Rien n'a été publié, donc
 *      la ligne repart en file au lieu de partir en réconciliation — et AUCUN
 *      appel de publication n'est tenté.
 */

/** Version de l'API Graph. Épinglée : une version flottante change sous les pieds. */
export const VERSION_GRAPH = 'v21.0';
const BASE = `https://graph.facebook.com/${VERSION_GRAPH}`;

/**
 * Le type d'un jeton, tel qu'il est rendu à l'écran. UN MOT, jamais la valeur,
 * jamais un fragment, jamais une longueur.
 */
export const TYPE_JETON = Object.freeze({
  PAGE: 'page',
  UTILISATEUR: 'utilisateur',
  INCONNU: 'inconnu',
});

/** Le jeton, lu côté serveur uniquement. Jamais préfixé VITE_. */
export function jetonMeta() {
  return (process.env.META_PAGE_ACCESS_TOKEN || '').trim();
}

/**
 * Traduit une erreur Meta en quelque chose d'actionnable, sans rien inventer.
 * Le message brut est TOUJOURS conservé : la piste est une hypothèse posée à
 * côté du fait, jamais à sa place.
 *
 * @param {object} erreurBrute  le contenu de `error` renvoyé par Graph
 * @returns {{code: string, message: string, piste: string|null}}
 */
export function diagnostiquerErreurMeta(erreurBrute) {
  const e = erreurBrute || {};
  const code = e.code ?? null;
  const sous = e.error_subcode ?? null;
  const message = String(e.message ?? 'erreur sans message');
  const trace = e.fbtrace_id ? ` fbtrace_id=${e.fbtrace_id}` : '';
  const brut = `code=${code}${sous !== null ? ` subcode=${sous}` : ''} type=${e.type ?? '?'} : ${message}${trace}`;

  let piste = null;

  // 190 = jeton invalide/expiré. C'est l'incident le plus probable d'une chaîne
  // qui tourne sans surveillance : un jeton de Page non permanent expire.
  if (code === 190) {
    piste = 'Jeton invalide ou expiré. Refaire la chaîne de jetons (geste J1 à J9 de '
      + 'ETAT_CREATION_APP_META.md §6) et vérifier qu\'un jeton de Page LONGUE DURÉE a bien été '
      + 'échangé — un jeton court expire en quelques heures.';
  }

  // 200 / 10 / 3 = autorisation refusée. C'est AUSSI la signature attendue si
  // l'application non publiée n'a pas le droit de publier sur la Page.
  if (code === 200 || code === 10 || code === 3) {
    piste = '🔴 Autorisation refusée par Meta. DEUX causes possibles, et le dossier ne sait pas '
      + 'laquelle : (a) une autorisation manquante sur le jeton (pages_manage_posts pour la Page, '
      + 'instagram_content_publish pour Instagram) ; (b) l\'application n\'est pas publiée et le '
      + 'mode Développement interdit cette écriture. Le test qui tranche est dans '
      + '31_AUTOPOST_QUI_FAIT_QUOI.md §2.2 et coûte 5 minutes.';
  }

  // 4 / 17 / 32 / 613 = limitation de débit. Ce n'est pas un échec : c'est un report.
  if (code === 4 || code === 17 || code === 32 || code === 613) {
    piste = 'Quota Meta atteint. Ce n\'est pas une erreur de code : il faut reporter, pas réessayer '
      + 'en boucle. La ligne reste en file pour le prochain passage.';
  }

  // 9007 / 2207xxx = média refusé côté Instagram (format, ratio, poids, URL).
  if (code === 9004 || code === 9007 || String(code).startsWith('220')) {
    piste = 'Média refusé par Instagram. Vérifier : JPEG (jamais PNG), largeur 320–1440 px, '
      + 'ratio entre 4:5 et 1.91:1, ≤ 8 Mo, et surtout que l\'URL du média est accessible '
      + 'PUBLIQUEMENT par les serveurs de Meta au moment de l\'appel.';
  }

  return { code: code === null ? 'inconnu' : String(code), message: brut, piste };
}

/** Une erreur d'appel qui porte le diagnostic avec elle. */
export class ErreurMeta extends Error {
  constructor({ message, code, piste, statut, incertain = false }) {
    super(message);
    this.name = 'ErreurMeta';
    this.codeMeta = code;
    this.piste = piste;
    this.statut = statut;
    /** Vrai quand on ne sait PAS si l'effet distant a eu lieu (timeout, 5xx). */
    this.incertain = incertain;
  }
}

/**
 * Crée le client Meta.
 *
 * @param {object} [arg]
 * @param {string|null} [arg.jeton]  par défaut : `process.env.META_PAGE_ACCESS_TOKEN`
 * @param {Function} [arg.fetchImpl]  injecté dans les tests — ZÉRO appel réseau
 * @param {Function} [arg.attendre]  pause entre deux sondages du conteneur IG
 * @param {Function} [arg.maintenant]
 * @returns {object}
 */
export function creerClientMeta({
  jeton = null,
  fetchImpl = null,
  attendre = (ms) => new Promise((r) => { setTimeout(r, ms); }),
  maintenant = () => new Date(),
} = {}) {
  const cle = jeton === null ? jetonMeta() : String(jeton || '');
  const appeler = fetchImpl || globalThis.fetch;

  /** Le client peut-il réellement publier ? */
  const disponible = cle.length > 0;

  /**
   * @param {string} chemin
   * @param {object} [arg]
   * @param {'GET'|'POST'} [arg.methode]
   * @param {object} [arg.parametres]
   * @param {string|null} [arg.jetonAlternatif]  le jeton de Page obtenu par
   *   échange. Il ne traverse que cet argument, et repart en en-tête comme
   *   l'autre : la règle « jamais en paramètre d'URL » vaut pour les deux.
   */
  async function graph(chemin, { methode = 'GET', parametres = {}, jetonAlternatif = null } = {}) {
    if (!disponible) {
      // Garde-fou : même appelé par erreur, le client sans jeton ne touche pas
      // le réseau. C'est ce qui rend les tests hors-ligne par construction.
      throw new ErreurMeta({
        message: 'jeton Meta absent : aucun appel réseau n\'est tenté',
        code: 'jeton_absent',
        piste: 'Poser META_PAGE_ACCESS_TOKEN dans les variables Vercel (Production), sans préfixe VITE_.',
        statut: 0,
      });
    }
    const url = new URL(`${BASE}/${chemin}`);
    const corps = new URLSearchParams();
    for (const [k, v] of Object.entries(parametres)) {
      if (v === undefined || v === null) continue;
      if (methode === 'GET') url.searchParams.set(k, String(v));
      else corps.set(k, String(v));
    }
    // ⚠️ Le jeton part en en-tête, JAMAIS en paramètre d'URL : une URL finit
    // dans les journaux d'accès, un en-tête non.
    const cleUtilisee = (typeof jetonAlternatif === 'string' && jetonAlternatif !== '')
      ? jetonAlternatif
      : cle;
    const options = {
      method: methode,
      headers: { Authorization: `Bearer ${cleUtilisee}` },
    };
    if (methode !== 'GET') {
      options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      options.body = corps.toString();
    }

    let reponse;
    try {
      reponse = await appeler(url.toString(), options);
    } catch (err) {
      // Réseau coupé ou délai dépassé : on ne sait PAS si Meta a reçu l'appel.
      // C'est le cas `reconciling` du dossier : surtout ne pas recréer.
      throw new ErreurMeta({
        message: `appel réseau impossible : ${err?.message || err}`,
        code: 'reseau',
        piste: 'Résultat distant INCERTAIN : ne pas republier avant d\'avoir cherché si le post existe.',
        statut: 0,
        incertain: true,
      });
    }

    let charge = null;
    try { charge = await reponse.json(); } catch { charge = null; }

    if (!reponse.ok) {
      const diag = diagnostiquerErreurMeta(charge?.error);
      throw new ErreurMeta({
        message: diag.message,
        code: diag.code,
        piste: diag.piste,
        statut: reponse.status,
        // Un 5xx n'est pas un refus : c'est une panne chez Meta, et l'effet a
        // pu avoir lieu quand même.
        incertain: reponse.status >= 500,
      });
    }
    return charge || {};
  }

  /* ══════════════════════════════════════════════════════════════════════════
     LE JETON DE PAGE — obtenu une fois par passage, jamais montré
     ══════════════════════════════════════════════════════════════════════════ */

  /**
   * Cache du passage : une entrée par Page, succès COMME échec.
   *
   * ⚠️ Sa durée de vie est celle du client, et `api/autopost.js` construit un
   * client par passage. « Une fois par passage » n'est donc pas une promesse
   * dans un commentaire : c'est la portée de cette variable.
   */
  const cacheJetonPage = new Map();

  /**
   * Quelle IDENTITÉ le jeton configuré porte-t-il ?
   *
   * `GET /me` rend l'identité que le jeton représente : avec un jeton de Page,
   * c'est la Page ; avec un jeton d'utilisateur (ou d'utilisateur système),
   * c'est l'utilisateur. Comparer cet identifiant à celui de la Page visée
   * suffit à trancher le type — sans jamais regarder le jeton lui-même.
   *
   * @returns {Promise<string|null>}
   */
  async function identiteDuJeton() {
    const moi = await graph('me', { parametres: { fields: 'id' } });
    const id = String(moi?.id ?? '').trim();
    return id === '' ? null : id;
  }

  /**
   * Le jeton à présenter pour écrire sur CETTE Page.
   *
   * @param {string} pageId
   * @returns {Promise<{jeton: string, type: string, echange: boolean}>}
   * @throws {ErreurMeta} avec un motif DISTINCT par cause, et `incertain: false`
   */
  async function jetonDePage(pageId) {
    const cible = String(pageId ?? '').trim();
    const enCache = cacheJetonPage.get(cible);
    if (enCache) {
      // Un échec se rejoue à l'identique : trois publications Facebook dans le
      // même passage ne font pas trois échanges, et n'écrivent pas trois motifs
      // différents pour une seule cause.
      if (enCache.erreur) throw enCache.erreur;
      return enCache;
    }

    const retenir = (entree) => { cacheJetonPage.set(cible, entree); return entree; };
    const echouer = ({ code, message, piste }) => {
      // `incertain: false` : rien n'a été publié, l'échange a lieu AVANT le
      // premier appel qui produit un effet. La ligne repart en file.
      const erreur = new ErreurMeta({ message, code, piste, statut: 0, incertain: false });
      cacheJetonPage.set(cible, { erreur });
      throw erreur;
    };

    let reponse = null;
    let erreurEchange = null;
    try {
      reponse = await graph(cible, { parametres: { fields: 'access_token' } });
    } catch (err) {
      erreurEchange = err;
    }

    const obtenu = typeof reponse?.access_token === 'string' ? reponse.access_token.trim() : '';
    if (obtenu !== '') {
      /* 🔴 LA COMPARAISON SE FAIT EN MÉMOIRE, ET N'EST JAMAIS DITE.
         Si Meta rend exactement le jeton configuré, c'est que celui-ci ÉTAIT
         déjà le jeton de la Page : le cas qui marche peut-être déjà n'est pas
         cassé, il est simplement reconnu. Sinon, l'échange a eu lieu. */
      const type = obtenu === cle ? TYPE_JETON.PAGE : TYPE_JETON.UTILISATEUR;
      return retenir({ jeton: obtenu, type, echange: type === TYPE_JETON.UTILISATEUR });
    }

    /* Pas de jeton rendu. Avant de refuser, on demande au jeton QUI IL EST :
       la documentation ne garantit le champ `access_token` que pour « the User
       making the request », et un jeton de Page qui s'interroge lui-même n'est
       pas un utilisateur. Refuser ici casserait le chemin qui marche peut-être
       déjà — c'est précisément ce qu'il ne faut pas faire. */
    let identite = null;
    let erreurSonde = null;
    try {
      identite = await identiteDuJeton();
    } catch (err) {
      erreurSonde = err;
    }

    if (identite !== null && identite === cible) {
      return retenir({ jeton: cle, type: TYPE_JETON.PAGE, echange: false });
    }

    /* ── LES MOTIFS, UN PAR GESTE À FAIRE ──────────────────────────────────
       Le gérant de Moanda doit lire QUOI FAIRE, pas seulement que ça a raté.
       Trois causes, trois gestes différents, et ils ne se confondent pas. */
    const codes = [erreurEchange?.codeMeta, erreurSonde?.codeMeta]
      .filter((c) => c !== undefined && c !== null)
      .map(String);

    if (codes.includes('190')) {
      echouer({
        code: 'jeton_page_expire',
        message: 'échange du jeton de Page refusé : le jeton configuré est invalide ou expiré',
        piste: 'Refaire la chaîne de jetons Meta, puis reposer META_PAGE_ACCESS_TOKEN dans Vercel '
          + '(Production, sans préfixe VITE_). Un jeton d\'utilisateur SYSTÈME n\'expire pas : s\'il '
          + 'expire, c\'est un jeton d\'utilisateur ordinaire qui a été collé à sa place.',
      });
    }

    if (codes.includes('reseau')) {
      echouer({
        code: 'jeton_page_reseau',
        message: 'échange du jeton de Page impossible : Meta injoignable',
        piste: 'Ce n\'est pas un refus et RIEN n\'a été publié — l\'échange a lieu avant le premier '
          + 'appel qui produit un effet. La ligne repart en file pour le prochain passage.',
      });
    }

    if (identite !== null) {
      // Le jeton répond, il EXISTE, il n'est simplement pas celui de la Page —
      // et la Page ne lui rend pas de jeton. C'est l'écart mesuré le 19/09.
      echouer({
        code: 'jeton_page_non_attribuee',
        message: 'échange du jeton de Page refusé : le jeton configuré est un jeton d\'UTILISATEUR, '
          + 'et la Page visée ne lui rend aucun jeton de Page',
        piste: 'Business Manager → Utilisateurs système → l\'utilisateur qui porte le jeton → '
          + '« Ajouter des ressources » : attribuer LA PAGE de l\'imprimerie, avec la tâche '
          + '« Créer du contenu ». Attribuer le compte Instagram ne suffit pas — c\'est exactement '
          + 'l\'écart mesuré le 19/09/2026 à 16 h 33 : Instagram a publié, Facebook a refusé, avec '
          + 'le même jeton.',
      });
    }

    echouer({
      code: 'jeton_page_sans_droit',
      message: `échange du jeton de Page refusé (${erreurEchange?.codeMeta ?? 'sans code'}) : le jeton `
        + 'configuré n\'a pas de rôle sur cette Page',
      piste: 'La documentation Meta dit du champ access_token du nœud Page : « Only returned if the '
        + 'User making the request has a role (other than Live Contributor) on the Page. » Vérifier '
        + 'que le compte porteur du jeton a bien un rôle sur la Page, et que META_PAGE_ID désigne '
        + 'bien la Page de l\'imprimerie.',
    });
    return undefined; // inatteignable : `echouer` lève toujours
  }

  return {
    disponible,
    versionGraph: VERSION_GRAPH,

    /**
     * Le type du jeton CONFIGURÉ, en un mot — pour l'écran du gérant.
     *
     * ⛔ Ce que cette fonction rend ne contient ni jeton, ni fragment de jeton,
     *    ni longueur, ni identifiant de compte. Un mot et une phrase française.
     *
     * Elle ne lève jamais : un voyant qui fait tomber l'écran d'état ne sert à
     * personne (même raison que `etatDrive()` dans `api/autopost.js`).
     *
     * @param {string|null} pageId  l'identifiant de la Page visée
     * @returns {Promise<{type: string, detail: string}>}
     */
    async typeDuJeton(pageId) {
      if (!disponible) {
        return {
          type: TYPE_JETON.INCONNU,
          detail: 'Jeton Meta absent : le type n\'a pas été mesuré, et aucun appel n\'a été fait.',
        };
      }
      const cible = String(pageId ?? '').trim();
      if (cible === '') {
        return {
          type: TYPE_JETON.INCONNU,
          detail: 'META_PAGE_ID n\'est pas posée : sans la Page visée, le type du jeton ne se mesure pas.',
        };
      }
      try {
        const identite = await identiteDuJeton();
        if (identite === null) {
          return { type: TYPE_JETON.INCONNU, detail: 'Meta a répondu sans identité : type indéterminé.' };
        }
        if (identite === cible) {
          return {
            type: TYPE_JETON.PAGE,
            detail: 'Jeton de PAGE — c\'est le type qu\'exige la publication sur la Page Facebook.',
          };
        }
        return {
          type: TYPE_JETON.UTILISATEUR,
          detail: 'Jeton d\'UTILISATEUR (un jeton d\'utilisateur système en est un). Instagram '
            + 'l\'accepte ; publier sur la Page exige un jeton de Page, que l\'application échange '
            + 'elle-même juste avant de publier.',
        };
      } catch (err) {
        // ⚠️ `err.message` porte le message brut de Meta, qui nomme l'objet visé
        //    (« Object with ID '…' »). Seul le CODE remonte ici.
        return {
          type: TYPE_JETON.INCONNU,
          detail: `Type non mesurable (${err?.codeMeta ?? 'erreur'}) — Meta n'a pas répondu à la question.`,
          piste: err?.piste ?? null,
        };
      }
    },

    /**
     * Publie une photo sur la Page Facebook.
     * @param {{pageId: string, urlMedia: string, legende: string}} arg
     */
    async publierPhotoFacebook({ pageId, urlMedia, legende }) {
      /* ⛔ D'ABORD LE BON TYPE DE JETON, ENSUITE SEULEMENT L'APPEL QUI PUBLIE.
         Si l'échange échoue, il lève ici : aucune photo n'est envoyée, et le
         motif dit lequel des trois gestes Meta il reste à faire. */
      const { jeton: jetonPage } = await jetonDePage(pageId);
      const reponse = await graph(`${pageId}/photos`, {
        methode: 'POST',
        parametres: { url: urlMedia, caption: legende, published: 'true' },
        jetonAlternatif: jetonPage,
      });
      const idDistant = reponse.post_id || reponse.id || null;
      if (!idDistant) {
        throw new ErreurMeta({
          message: 'Meta a répondu 200 sans identifiant de publication',
          code: 'sans_id',
          piste: 'Sans identifiant, il n\'y a pas de preuve de publication. Ne pas marquer publié.',
          statut: 200,
          incertain: true,
        });
      }
      // `pageId` repart avec le résultat pour que la RELECTURE emprunte le même
      // jeton (déjà en cache : aucun appel d'échange supplémentaire).
      return { idDistant, idConteneur: null, pageId: String(pageId), brut: reponse };
    },

    /**
     * Publie une photo sur Instagram — deux temps, et c'est un avantage.
     *
     * Le `creation_id` rendu par la première étape est écrit en base AVANT la
     * seconde : si la publication échoue au milieu, on sait quoi interroger au
     * lieu de recréer un conteneur (et donc un doublon).
     *
     * @param {{igId: string, urlMedia: string, legende: string, sondagesMax?: number, pauseMs?: number}} arg
     */
    async publierPhotoInstagram({ igId, urlMedia, legende, sondagesMax = 10, pauseMs = 3000, surConteneur = null }) {
      const conteneur = await graph(`${igId}/media`, {
        methode: 'POST',
        parametres: { image_url: urlMedia, caption: legende },
      });
      const idConteneur = conteneur.id || null;
      if (!idConteneur) {
        throw new ErreurMeta({
          message: 'création du conteneur Instagram sans identifiant',
          code: 'sans_conteneur', piste: null, statut: 200, incertain: true,
        });
      }
      // ⛔ L'ANCRE. Écrite avant tout appel qui produit l'effet.
      if (surConteneur) await surConteneur(idConteneur);

      let statut = null;
      for (let i = 0; i < sondagesMax; i += 1) {
        const etat = await graph(idConteneur, { parametres: { fields: 'status_code,status' } });
        statut = etat.status_code || null;
        if (statut === 'FINISHED') break;
        if (statut === 'ERROR' || statut === 'EXPIRED') {
          throw new ErreurMeta({
            message: `conteneur Instagram en état ${statut} : ${etat.status || 'sans détail'}`,
            code: `conteneur_${String(statut).toLowerCase()}`,
            piste: 'Le média n\'a pas pu être récupéré par Meta. Vérifier que l\'URL signée n\'a pas '
              + 'expiré avant la publication : la re-signer juste avant chaque tentative.',
            statut: 200,
          });
        }
        if (statut === 'PUBLISHED') {
          // Déjà publié lors d'une tentative précédente : c'est une réconciliation
          // réussie, pas un succès neuf. On ne republie pas.
          return { idDistant: idConteneur, idConteneur, reconcilie: true, brut: etat };
        }
        await attendre(pauseMs);
      }
      if (statut !== 'FINISHED') {
        throw new ErreurMeta({
          message: `conteneur Instagram toujours en ${statut || 'état inconnu'} après ${sondagesMax} sondages`,
          code: 'conteneur_lent', piste: 'Réessayer au prochain passage : le conteneur vit 24 h.',
          statut: 200, incertain: true,
        });
      }

      const publie = await graph(`${igId}/media_publish`, {
        methode: 'POST',
        parametres: { creation_id: idConteneur },
      });
      return { idDistant: publie.id || null, idConteneur, reconcilie: false, brut: publie };
    },

    /**
     * Relit l'objet distant. Un 200 n'est pas une vérification ; une relecture
     * en est une — de l'EXISTENCE de l'objet, pas de sa visibilité publique.
     */
    async relire(idDistant, { pageId = null } = {}) {
      try {
        // Un post de Page se relit avec le jeton de Page, comme il s'écrit.
        // Instagram ne passe pas `pageId` : il garde le jeton configuré (§4).
        const jetonPage = pageId ? (await jetonDePage(pageId)).jeton : null;
        const o = await graph(idDistant, {
          parametres: { fields: 'id,permalink_url,created_time' },
          jetonAlternatif: jetonPage,
        });
        return { existe: Boolean(o.id), permalien: o.permalink_url || null, brut: o };
      } catch (err) {
        return { existe: false, permalien: null, erreur: err?.message || String(err) };
      }
    },

    /**
     * Cherche un post récent de la Page portant le `code_provenance`.
     * C'est l'ancre de réconciliation Facebook : l'API des Pages ne fournit pas
     * de clé d'idempotence, on la fabrique donc avec un marqueur qui est déjà
     * dans la légende pour une raison commerciale.
     */
    async chercherParCodeProvenance({ pageId, code, depuisMs = 0 }) {
      // Même jeton que pour écrire : lire le flux d'une Page est un geste de
      // Page. L'échange est déjà en cache si la publication l'a fait avant.
      const { jeton: jetonPage } = await jetonDePage(pageId);
      const flux = await graph(`${pageId}/feed`, {
        parametres: { fields: 'id,message,created_time', limit: 25 },
        jetonAlternatif: jetonPage,
      });
      const trouve = (flux.data || []).find((p) => {
        if (typeof p?.message !== 'string' || !p.message.includes(code)) return false;
        if (!depuisMs) return true;
        const t = Date.parse(p.created_time);
        return Number.isFinite(t) && t >= depuisMs;
      });
      return trouve ? { idDistant: trouve.id, brut: trouve } : null;
    },

    maintenant,
  };
}
