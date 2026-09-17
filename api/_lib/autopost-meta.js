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

/** Version de l'API Graph. Épinglée : une version flottante change sous les pieds. */
export const VERSION_GRAPH = 'v21.0';
const BASE = `https://graph.facebook.com/${VERSION_GRAPH}`;

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

  async function graph(chemin, { methode = 'GET', parametres = {} } = {}) {
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
    const options = {
      method: methode,
      headers: { Authorization: `Bearer ${cle}` },
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

  return {
    disponible,
    versionGraph: VERSION_GRAPH,

    /**
     * Publie une photo sur la Page Facebook.
     * @param {{pageId: string, urlMedia: string, legende: string}} arg
     */
    async publierPhotoFacebook({ pageId, urlMedia, legende }) {
      const reponse = await graph(`${pageId}/photos`, {
        methode: 'POST',
        parametres: { url: urlMedia, caption: legende, published: 'true' },
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
      return { idDistant, idConteneur: null, brut: reponse };
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
    async relire(idDistant) {
      try {
        const o = await graph(idDistant, { parametres: { fields: 'id,permalink_url,created_time' } });
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
      const flux = await graph(`${pageId}/feed`, {
        parametres: { fields: 'id,message,created_time', limit: 25 },
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
