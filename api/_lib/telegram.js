/**
 * Envoi d'un message Telegram (API Bot, méthode `sendMessage`) — SERVEUR UNIQUEMENT.
 *
 * Deux variables, posées par le dirigeant dans Vercel, jamais par le code :
 *   - `TELEGRAM_BOT_TOKEN` — le jeton du bot (donné par @BotFather) ;
 *   - `TELEGRAM_CHAT_ID`   — l'identifiant du groupe « OGOOUÉ Alertes ».
 * Mode d'emploi : `livrables_claude/42_ALERTES_TELEGRAM.md`.
 *
 * ⛔ TANT QU'UNE DES DEUX MANQUE, TELEGRAM EST INACTIF — et il le DIT.
 *    `configure: false`, aucun appel réseau, et l'écran affiche « Telegram non
 *    configuré ». Un canal muet qui a l'air de marcher est un faux témoin.
 *
 * ⛔ LE JETON NE SORT JAMAIS DE CE FICHIER.
 *    Il vit dans le CHEMIN de l'URL de l'API (`/bot<jeton>/sendMessage`) : c'est
 *    la forme imposée par Telegram. Donc :
 *      - l'URL n'est jamais journalisée, jamais rendue, jamais mise dans une
 *        erreur ;
 *      - tout motif d'échec rendu à l'appelant passe par `masquer()`, qui
 *        remplace le jeton s'il apparaissait (une bibliothèque réseau peut
 *        recopier l'URL dans son message d'erreur) ;
 *      - aucun préfixe `VITE_` : Vite n'inline que `VITE_*`, et un test refuse
 *        toute mention de ces variables sous `src/`.
 *
 * ── Les trois issues d'un envoi, et pourquoi trois ───────────────────────────
 *   `envoye`    — Telegram a répondu `ok: true`. Le témoin de l'effet.
 *   `echec`     — Telegram a répondu NON (jeton refusé, groupe introuvable…),
 *                 ou la connexion a échoué AVANT tout échange. Le message
 *                 n'est pas parti : on peut réessayer au passage suivant.
 *   `incertain` — le délai a expiré en attendant la réponse. Le message est
 *                 PEUT-ÊTRE parti. On ne réessaie pas : « jamais deux fois la
 *                 même alerte » l'emporte, et l'écran dit « incertain ».
 */

const DELAI_PAR_DEFAUT_MS = 4_000;

/** Lit la configuration. Ne rend le jeton qu'au client, jamais à un appelant d'écran. */
export function lireConfigurationTelegram(env = process.env) {
  const jeton = String(env?.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = String(env?.TELEGRAM_CHAT_ID || '').trim();
  return { configure: Boolean(jeton && chatId), jeton, chatId };
}

/**
 * Remplace toute occurrence du jeton — et de sa partie secrète, après les
 * deux-points — par un masque. Rend toujours une chaîne courte.
 */
export function masquerJeton(texte, jeton) {
  let s = String(texte ?? '');
  if (jeton) {
    const morceaux = [jeton, jeton.split(':').slice(1).join(':')].filter((m) => m && m.length >= 6);
    for (const m of morceaux) s = s.split(m).join('[jeton masqué]');
  }
  // Ceinture : une forme de jeton Telegram (chiffres:35 caractères) ne passe pas non plus.
  s = s.replace(/\d{6,}:[A-Za-z0-9_-]{20,}/g, '[jeton masqué]');
  return s.slice(0, 300);
}

/**
 * @param {object} [p]
 * @param {object} [p.env]      variables d'environnement (tests : un objet)
 * @param {Function} [p.fetch]  `fetch` injecté (tests : une doublure — jamais le vrai réseau)
 */
export function creerClientTelegram({ env = process.env, fetch: fetchFourni = null } = {}) {
  const { configure, jeton, chatId } = lireConfigurationTelegram(env);
  const faireFetch = fetchFourni || globalThis.fetch;

  return {
    configure,

    /**
     * @param {string} texte
     * @param {{delaiMs?: number}} [options]
     * @returns {Promise<{statut: 'envoye'|'echec'|'incertain'|'non_configure', motif: string|null}>}
     */
    async envoyer(texte, { delaiMs = DELAI_PAR_DEFAUT_MS } = {}) {
      if (!configure) return { statut: 'non_configure', motif: 'TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID absente' };
      if (typeof faireFetch !== 'function') return { statut: 'echec', motif: 'fetch indisponible' };

      const controleur = new AbortController();
      const minuterie = setTimeout(() => controleur.abort(), Math.max(250, delaiMs));
      let reponse;
      try {
        reponse = await faireFetch(`https://api.telegram.org/bot${jeton}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: String(texte).slice(0, 4000),
            disable_web_page_preview: true,
          }),
          signal: controleur.signal,
        });
      } catch (err) {
        clearTimeout(minuterie);
        if (controleur.signal.aborted || err?.name === 'AbortError') {
          return { statut: 'incertain', motif: `pas de réponse de Telegram en ${delaiMs} ms — message peut-être parti` };
        }
        return { statut: 'echec', motif: masquerJeton(`connexion impossible : ${err?.message || err}`, jeton) };
      }

      let corps = null;
      try { corps = await reponse.json(); } catch { corps = null; }
      clearTimeout(minuterie);

      if (reponse.ok && corps?.ok === true) return { statut: 'envoye', motif: null };
      // 200 reçu mais corps illisible (délai expiré pendant la lecture) : Telegram
      // a très probablement accepté. On ne le réenverra pas.
      if (reponse.ok && corps === null) {
        return { statut: 'incertain', motif: 'réponse de Telegram illisible — message probablement parti' };
      }
      const description = corps?.description ? String(corps.description) : `HTTP ${reponse.status}`;
      return { statut: 'echec', motif: masquerJeton(`Telegram refuse : ${description}`, jeton) };
    },
  };
}
