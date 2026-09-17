/**
 * Vercel Serverless Function — Proxy vers l'API Anthropic.
 * Protège la clé API côté serveur (pas d'exposition côté client).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⛔ CE FICHIER SERT AUSSI /api/zakat-analyse — CONTRAINTE DE PLAN, PAS DESIGN
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Le plan **Vercel Hobby plafonne le projet à 12 fonctions serverless**. Le
 * dossier `api/` en a compté 13 le 17/09/2026 ; le déploiement du commit
 * `c97fae8` a échoué à « Deploying outputs » alors que le build avait réussi.
 * Tant que le plafond n'était pas respecté, aucun déploiement ne passait.
 *
 * `api/zakat-analyse.js` a donc été déplacé **tel quel** dans
 * `api/_lib/zakat-analyse.js` (dossier préfixé par `_`, que Vercel n'expose pas
 * comme fonction, donc hors plafond) et devient une VOIE de ce fichier.
 *
 * ⚠️ L'URL publique `/api/zakat-analyse` n'a pas changé : elle est appelée par
 * `src/features/zakat/page.jsx` et `src/features/associe-portal/dashboard.jsx`,
 * y compris depuis les versions déjà installées en PWA. Elle est conservée par
 * un `rewrite` dans `vercel.json`, placé AVANT la règle générique `/api/(.*)` :
 *
 *   { "source": "/api/zakat-analyse", "destination": "/api/ai?voie=zakat" }
 *
 * Les deux voies gardent leurs propres gardes, à l'identique :
 *   - `ai`    : CORS, préflight OPTIONS, 30 requêtes/min, session exigée ;
 *   - `zakat` : PAS de CORS (comme avant), 10 requêtes/min, session exigée.
 * Le routage a donc lieu AVANT le bloc CORS, sans quoi `/api/zakat-analyse`
 * répondrait des en-têtes qu'il n'a jamais répondus et un `OPTIONS` y
 * renverrait 200 au lieu de 405.
 *
 * 🔁 À DÉFAIRE AU PASSAGE AU PLAN PRO (1000 fonctions) : remonter
 * `api/_lib/zakat-analyse.js` en `api/zakat-analyse.js`, rétablir ses imports
 * (`./x.js` → `./_lib/x.js`), supprimer le `rewrite` correspondant et le bloc
 * de routage ci-dessous. Voir la procédure complète en tête de `api/singpay.js`.
 * Tests de non-régression : `tests/routage-api.test.mjs`.
 */
import { exigerSession } from './_lib/session.js';
import { limiteDepassee } from './_lib/limite.js';
import { modeleAnthropic, messageErreurAnthropic } from './_lib/modeles.js';
import { voieDemandee } from './_lib/routage.js';
import zakatAnalyse from './_lib/zakat-analyse.js';

/** Liste blanche des voies servies par ce point d'entrée. */
export const VOIES_IA = Object.freeze(['ai', 'zakat']);

/**
 * Chemins publics historiques → voie.
 * ⚠️ `/api/ai` n'y figure pas : c'est la destination du rewrite, il porterait
 * donc aussi les appels réécrits de `/api/zakat-analyse`. Il est traité par le
 * défaut ci-dessous.
 */
export const CHEMINS_IA = Object.freeze({ '/api/zakat-analyse': 'zakat' });

/**
 * Résout la voie demandée. Exportée pour être testée sans réseau.
 * @param {{url?: string, query?: object}} req
 * @returns {'ai'|'zakat'}
 */
export function voieIA(req) {
  return voieDemandee(req, {
    cheminsConnus: CHEMINS_IA,
    voies: VOIES_IA,
    defaut: 'ai', // `/api/ai` sans paramètre reste le proxy IA, exactement comme avant
  });
}

export default async function handler(req, res) {
  // ── Routage : voir l'en-tête. Doit précéder le bloc CORS.
  if (voieIA(req) === 'zakat') return zakatAnalyse(req, res);

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', process.env.APP_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── Verrou ajoute le 13/09/2026 ──────────────────────────────────────────
  // Cet endpoint etait ouvert a Internet : CORS '*', aucune authentification,
  // aucun plafond. N'importe qui connaissant l'URL disposait d'un proxy IA
  // facture sur le compte de l'entreprise. Verifie par requete depuis une
  // machine tierce non authentifiee.
  if (limiteDepassee(req, { max: 30, fenetreMs: 60_000, portee: 'ai' })) {
    return res.status(429).json({ error: 'Trop de requetes. Reessayez dans une minute.' });
  }
  if (!exigerSession(req, res)) return;
  // ─────────────────────────────────────────────────────────────────────────

  // Jamais de repli sur VITE_* : ce prefixe destine la variable au bundle navigateur.
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Clé API Anthropic non configurée' });

  try {
    const { system, messages, max_tokens = 300 } = req.body;
    // Plafond dur : max_tokens venait entierement du client, sans borne.
    const plafond = Math.min(Number(max_tokens) || 300, 2000);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: modeleAnthropic(),
        max_tokens: plafond,
        system: system || '',
        messages: messages || [],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[AI Proxy] Anthropic error:', response.status, errorText);
      return res.status(response.status).json({ error: messageErreurAnthropic(response.status, errorText) });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    return res.status(200).json({ text });
  } catch (err) {
    console.error('[AI Proxy] Error:', err.message);
    return res.status(500).json({ error: 'Erreur interne du service IA' });
  }
}
