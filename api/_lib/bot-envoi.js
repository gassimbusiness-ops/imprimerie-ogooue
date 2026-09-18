/**
 * Bot Messenger / Instagram — L'ENVOI DE LA RÉPONSE.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CE MODULE PART DU PRINCIPE QUE LE JETON N'EXISTE PAS
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Même règle que l'auto-poster : sans `META_PAGE_ACCESS_TOKEN`, le client est
 * `disponible: false` et ne touche JAMAIS le réseau — y compris appelé par
 * erreur. C'est ce qui rend les tests hors-ligne par construction, et ce qui
 * garantit qu'un déploiement sans jeton ne produit pas d'appel sauvage.
 *
 * ⚠️ Le jeton part en EN-TÊTE, jamais en paramètre d'URL : une URL finit dans
 * les journaux d'accès, un en-tête non. (Reprise de `autopost-meta.js`.)
 *
 * ════════════════════════════════════════════════════════════════════════════
 * MESSENGER ET INSTAGRAM SONT DEUX ENREGISTREMENTS DISTINCTS
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Le produit est le même (Messenger Platform), mais pas la ressource visée ni
 * la charge utile :
 *
 *   - MESSENGER  : `POST /<PAGE_ID>/messages`, avec `messaging_type=RESPONSE`.
 *     Ce champ dit à Meta « ceci répond à un message du client » : c'est la
 *     condition pour rester dans la fenêtre libre de 24 h ;
 *   - INSTAGRAM  : `POST /<IG_USER_ID>/messages`. La documentation ne demande
 *     pas `messaging_type` pour l'API Instagram avec Facebook Login, et
 *     l'envoyer quand même exposerait à un refus de paramètre inconnu.
 *
 * L'identifiant du compte n'est PAS écrit en dur ici : il vient du champ
 * `recipient.id` de l'événement reçu, c'est-à-dire du compte qui a réellement
 * reçu le message. On répond là où on a été écrit, jamais ailleurs.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LE TÉMOIN
 * ════════════════════════════════════════════════════════════════════════════
 *
 * L'API rend `{ recipient_id, message_id }`. C'est `message_id` — l'identifiant
 * attribué PAR META au message sortant — qui prouve que la réponse est partie.
 * Un 200 sans `message_id` n'est pas une preuve : il lève, comme chez
 * l'auto-poster, plutôt que de laisser croire à un succès.
 */
import { VERSION_GRAPH, ErreurMeta, diagnostiquerErreurMeta, jetonMeta } from './autopost-meta.js';

const BASE = `https://graph.facebook.com/${VERSION_GRAPH}`;

/** Canaux que ce client sait servir. */
export const CANAUX = Object.freeze(['messenger', 'instagram']);

/**
 * Crée le client d'envoi.
 *
 * @param {object} [arg]
 * @param {string|null} [arg.jeton]    défaut : `process.env.META_PAGE_ACCESS_TOKEN`
 * @param {Function} [arg.fetchImpl]   injecté dans les tests — ZÉRO appel réseau
 * @returns {{disponible: boolean, versionGraph: string, envoyerMessage: Function}}
 */
export function creerClientBot({ jeton = null, fetchImpl = null } = {}) {
  const cle = jeton === null ? jetonMeta() : String(jeton || '');
  const appeler = fetchImpl || globalThis.fetch;
  const disponible = cle.length > 0;

  /**
   * @param {{canal: string, destinataireId: string, texte: string, compteId: string}} arg
   * @returns {Promise<{idMessage: string, simule: boolean, brut: object}>}
   */
  async function envoyerMessage({ canal, destinataireId, texte, compteId }) {
    if (!disponible) {
      throw new ErreurMeta({
        message: 'jeton Meta absent : aucun appel réseau n\'est tenté',
        code: 'jeton_absent',
        piste: 'Poser META_PAGE_ACCESS_TOKEN dans les variables Vercel (Production), sans préfixe VITE_.',
        statut: 0,
      });
    }
    if (!CANAUX.includes(canal)) {
      throw new ErreurMeta({
        message: `canal inconnu : ${canal}`,
        code: 'canal_inconnu',
        piste: 'Seuls Messenger et Instagram sont servis. WhatsApp reste manuel, au comptoir.',
        statut: 0,
      });
    }
    if (!compteId || !destinataireId || !texte) {
      throw new ErreurMeta({
        message: 'envoi incomplet : compte, destinataire ou texte manquant',
        code: 'envoi_incomplet',
        piste: 'Aucun envoi « au plus probable » : sans destinataire certain, on ne parle à personne.',
        statut: 0,
      });
    }

    const corps = new URLSearchParams();
    corps.set('recipient', JSON.stringify({ id: String(destinataireId) }));
    corps.set('message', JSON.stringify({ text: String(texte) }));
    // Messenger seulement : la fenêtre libre de 24 h se réclame par ce champ.
    if (canal === 'messenger') corps.set('messaging_type', 'RESPONSE');

    let reponse;
    try {
      reponse = await appeler(`${BASE}/${compteId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cle}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: corps.toString(),
      });
    } catch (err) {
      // Réseau coupé : on ne sait PAS si Meta a reçu l'appel. Le message peut
      // être parti. On le dit — `incertain` — au lieu de renvoyer à l'aveugle.
      throw new ErreurMeta({
        message: `appel réseau impossible : ${err?.message || err}`,
        code: 'reseau',
        piste: 'Résultat INCERTAIN : le client a peut-être reçu la réponse. Ne pas renvoyer sans vérifier.',
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
        piste: diag.piste || pisteMessagerie(charge?.error),
        statut: reponse.status,
        incertain: reponse.status >= 500,
      });
    }

    const idMessage = charge?.message_id || null;
    if (!idMessage) {
      throw new ErreurMeta({
        message: 'Meta a répondu 200 sans identifiant de message',
        code: 'sans_id',
        piste: 'Sans identifiant, il n\'y a pas de témoin d\'envoi. Ne pas marquer « répondu ».',
        statut: 200,
        incertain: true,
      });
    }
    return { idMessage, simule: false, brut: charge };
  }

  return { disponible, versionGraph: VERSION_GRAPH, envoyerMessage };
}

/**
 * Pistes propres à la MESSAGERIE, que `diagnostiquerErreurMeta` (écrit pour la
 * publication) ne couvre pas. Une panne se nomme par son geste, pas par sa couche.
 *
 * @param {object} erreurBrute
 * @returns {string|null}
 */
export function pisteMessagerie(erreurBrute) {
  const sous = erreurBrute?.error_subcode ?? null;
  const code = erreurBrute?.code ?? null;

  // 2018278 : hors de la fenêtre de 24 h. Ce n'est pas une panne — c'est la
  // règle. Le rattrapage est humain (tag `human_agent`, 7 jours), pas automatique.
  if (sous === 2018278 || sous === 2018108) {
    return 'Hors de la fenêtre de 24 h : Meta refuse une réponse automatique passé ce délai. '
      + 'C\'est au gérant de reprendre la conversation — la fonctionnalité Human Agent laisse 7 jours.';
  }
  // 100 sur un compte : mauvais identifiant de Page ou de compte Instagram.
  if (code === 100) {
    return 'Identifiant de compte ou de destinataire refusé. Vérifier que l\'on répond bien sur le '
      + 'compte qui a REÇU le message (recipient.id de l\'événement), et pas sur un compte voisin '
      + 'du même portefeuille.';
  }
  return null;
}
