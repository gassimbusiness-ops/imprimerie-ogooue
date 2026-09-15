/**
 * Vercel Serverless Function — generation de la SCENE d'un mockup.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QUE CET ENDPOINT FAIT, ET CE QU'IL NE FERA PLUS JAMAIS
 *
 *   Il genere UNIQUEMENT le support nu : le t-shirt, sa couleur, sa lumiere,
 *   ses plis. Le logo du client n'entre pas ici, ne sort pas d'ici, et une
 *   requete qui en porte un est REFUSEE.
 *
 *   Le logo est incruste ensuite, dans le navigateur, pixel pour pixel, par
 *   `src/features/mockup-ia/composition.js`. Il n'est jamais redessine.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * POURQUOI CE REFUS EST ECRIT DANS LE CODE, ET PAS SEULEMENT DANS UN COMMENTAIRE
 *
 * La version precedente de ce fichier faisait, ligne 63 :
 *
 *     formData.append('image', logoBlob, 'logo.png');   // → /v1/images/edits
 *
 * Le parametre `image` de `/v1/images/edits` est LA TOILE A TRANSFORMER, pas une
 * reference a recopier. Le code demandait donc au modele de transformer le logo
 * du client EN photographie de t-shirt. Le modele obeissait : il resynthetisait
 * l'image entiere, logo compris, de memoire.
 *
 * Mesures independantes :
 *  - Photoroom, 06/07/2026, 850 produits, 10 annotateurs humains : 27,2 % de
 *    fidelite produit, et « logo and text distortion was the most common failure,
 *    affecting 20,1 % of all base-model generations » ;
 *  - Qwen-Image Technical Report (arXiv 2508.02324), glyphe rare : 3,55 %.
 *
 * Un logo de client de Moanda est, par construction, un glyphe rare. Aucun prompt
 * ne corrige ca : un modele de diffusion echantillonne dans un espace latent
 * continu, il n'a aucun mecanisme de copie. Le garde-fou `logo` ci-dessous est
 * donc structurel : c'est lui qui empeche la regression, pas la bonne volonte.
 *
 * ── LE NOM DU MODELE ──────────────────────────────────────────────────────
 * Il vit dans une variable d'environnement, comme `api/_lib/modeles.js` le fait
 * pour Anthropic, et pour la meme raison : le 14/09/2026 toute l'IA texte de
 * l'application etait morte sur un `not_found_error` HTTP 404 parce qu'un nom de
 * modele ecrit en dur avait ete retire par le fournisseur. Un nom de modele est
 * une configuration, jamais une constante.
 *
 * (Ce bloc devrait vivre dans `api/_lib/modeles.js` a cote de son equivalent
 * Anthropic. Il est ici parce que ce chantier n'a pas le droit de toucher
 * `_lib/`. A deplacer a la premiere occasion — voir le rapport de livraison.)
 */
import { exigerSession } from './_lib/session.js';
import { limiteDepassee } from './_lib/limite.js';

/**
 * Defaut au 15/09/2026, releve sur `developers.openai.com/api/docs/models`.
 *
 * OpenAI publie deux modeles d'image courants :
 *   - `gpt-image-2.5-sunburst` — « for workflows where editing precision matters most »
 *   - `gpt-image-2.5-flare`    — « for fast, high-quality everyday image generation »
 *
 * On prend `sunburst` : la scene doit respecter une couleur de support precise et
 * rester vierge de tout marquage, ce qui est un travail de precision. `flare` est
 * un repli valable si la latence devient le probleme au comptoir.
 *
 * ⚠️ Calendrier de deprecation verifie le 15/09/2026 sur
 * `developers.openai.com/api/docs/deprecations` :
 *   - `gpt-image-1`        → arret le 23 OCTOBRE 2026  (annonce le 22/04/2026)
 *   - `gpt-image-1-mini`, `gpt-image-1.5`, `chatgpt-image-latest`
 *                          → arret le 1er DECEMBRE 2026 (annonce le 02/06/2026)
 *   - `dall-e-2`, `dall-e-3` → ARRETES depuis le 12 MAI 2026
 *
 * Le cahier des charges datait l'arret de `gpt-image-1` au 1er decembre : c'est
 * cinq semaines trop tard. Et le repli `dall-e-3` de l'ancien code etait deja
 * mort au moment ou il a ete ecrit. Les deux sont corriges ici.
 *
 * Pour changer de modele : poser `OPENAI_IMAGE_MODEL` dans Vercel. Aucun
 * deploiement de code n'est necessaire.
 */
const MODELE_IMAGE_PAR_DEFAUT = 'gpt-image-2.5-sunburst';

function modeleImage() {
  const m = process.env.OPENAI_IMAGE_MODEL;
  return m && m.trim() ? m.trim() : MODELE_IMAGE_PAR_DEFAUT;
}

/** Tailles carrees acceptees. 1024 suffit pour un apercu de comptoir. */
const TAILLES_AUTORISEES = new Set(['1024x1024', '1536x1024', '1024x1536']);
/** `xhigh` et `max` existent chez OpenAI ; ils sont volontairement hors de portee ici. */
const QUALITES_AUTORISEES = new Set(['low', 'medium', 'high']);

/**
 * Message d'erreur exploitable a partir d'une reponse OpenAI.
 * Meme motif que `messageErreurAnthropic` : un 404 sur cet endpoint a une seule
 * cause plausible, autant la dire plutot que de renvoyer « Erreur API : 404 ».
 */
function messageErreurOpenAI(statut, corps) {
  if (statut === 404) {
    return `Le modele d'image « ${modeleImage()} » n'existe pas ou n'est pas accessible a cette cle. `
      + 'Corriger la variable OPENAI_IMAGE_MODEL dans Vercel. '
      + '(Rappel : gpt-image-1 est arrete depuis le 23/10/2026, dall-e-3 depuis le 12/05/2026.)';
  }
  if (statut === 401) return 'Cle API OpenAI invalide ou revoquee.';
  if (statut === 429) return 'Quota OpenAI atteint. Reessayer dans quelques minutes.';
  if (statut >= 500) return 'Service OpenAI indisponible. Reessayer plus tard.';
  // On remonte le type annonce par OpenAI, jamais le corps complet : il peut
  // contenir un echo de la requete, donc des donnees de l'entreprise.
  const type = corps?.error?.type;
  const msg = corps?.error?.message;
  if (typeof msg === 'string' && msg.trim()) return `Erreur OpenAI (${statut}) : ${msg.trim()}`;
  if (type) return `Erreur OpenAI (${statut}) : ${type}`;
  return `Erreur API OpenAI : ${statut}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.APP_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── Verrou ajoute le 13/09/2026 ──────────────────────────────────────────
  // Cet endpoint etait ouvert a Internet : CORS '*', aucune authentification,
  // aucun plafond. N'importe qui connaissant l'URL disposait d'un proxy IA
  // facture sur le compte de l'entreprise.
  //
  // La fenetre passe de 6 a 4 par minute : l'ecran ne lance plus 3 requetes par
  // clic (les 3 « vues » de l'ancien code etaient 3 images sans rapport entre
  // elles — le t-shirt de face et celui de cote n'etaient pas le meme t-shirt).
  // Un clic = une scene.
  if (limiteDepassee(req, { max: 4, fenetreMs: 60_000 })) {
    return res.status(429).json({ error: 'Trop de requetes. Reessayez dans une minute.' });
  }
  if (!exigerSession(req, res)) return;
  // ─────────────────────────────────────────────────────────────────────────

  try {
    const corps = (req.body && typeof req.body === 'object') ? req.body : {};

    // ══ GARDE-FOU STRUCTUREL ═════════════════════════════════════════════
    // Si un appelant envoie un logo, c'est que quelqu'un a reintroduit le bug
    // d'origine. On refuse, et on dit pourquoi — plutot que d'accepter en
    // silence et de rendre un logo redessine que personne ne verifiera.
    const champsInterdits = ['logoUrl', 'logoBase64', 'logo', 'logoFile', 'design', 'designUrl'];
    const present = champsInterdits.find((c) => corps[c] !== undefined && corps[c] !== null && corps[c] !== '');
    if (present) {
      return res.status(400).json({
        error: `Le champ « ${present} » n'est pas accepte : le logo du client ne doit JAMAIS `
          + 'passer par le modele d\'image, il serait redessine de memoire et non recopie '
          + '(20,1 % des generations presentent une distorsion de logo — benchmark Photoroom, '
          + '850 produits, 06/07/2026). Cet endpoint ne produit que la scene du support nu ; '
          + 'le logo est incruste ensuite dans le navigateur, pixel pour pixel.',
        code: 'logo_interdit',
      });
    }

    const { prompt, qualite, taille, supportRefUrl } = corps;

    if (typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({
        error: 'Prompt de scene requis. Il est construit par '
          + '`src/features/mockup-ia/moteur-mockup.js` (construirePromptScene) et affiche '
          + 'a l\'utilisateur avant l\'envoi : aucune generation facturee sur un prompt non relu.',
      });
    }
    if (prompt.length > 1200) {
      return res.status(400).json({ error: 'Prompt de scene trop long (max 1200 caracteres).' });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: 'Cle API OpenAI non configuree (OPENAI_API_KEY). '
          + 'L\'apercu reste possible sans IA : importez une photo du support.',
      });
    }

    const modele = modeleImage();
    const q = QUALITES_AUTORISEES.has(qualite) ? qualite : 'medium';
    const t = TAILLES_AUTORISEES.has(taille) ? taille : '1024x1024';

    let reponse;

    if (typeof supportRefUrl === 'string' && supportRefUrl.startsWith('http')) {
      // ── Chemin « photo de reference du support » ────────────────────────
      // Ici on part d'une photo REELLE d'un support NU du magasin et on demande
      // au modele de la remettre en scene (autre angle, autre coloris). C'est le
      // seul usage legitime de `/v1/images/edits` dans ce chantier, et il ne
      // concerne QUE le support : aucun logo n'y transite.
      //
      // Le parametre s'appelle `image[]` : la documentation OpenAI du 15/09/2026
      // confirme que l'endpoint edits accepte plusieurs images de reference sous
      // cette forme. (`input_fidelity: "high"` existe sur les modeles gpt-image-1.x
      // et sert justement a preserver un logo — il n'est pas utilise ici puisque
      // aucun logo n'est envoye. C'est volontaire : un parametre de fidelite ne
      // garantit rien, l'incrustation, si.)
      const refResponse = await fetch(supportRefUrl);
      if (!refResponse.ok) {
        return res.status(400).json({ error: 'Photo de support de reference illisible.' });
      }
      const buffer = await refResponse.arrayBuffer();
      if (buffer.byteLength > 4 * 1024 * 1024) {
        return res.status(400).json({
          error: 'Photo de reference trop lourde (max 4 Mo — limite de corps de requete Vercel : 4,5 Mo).',
        });
      }
      const typeRef = refResponse.headers.get('content-type') || 'image/png';
      const blob = new Blob([buffer], { type: typeRef });

      const formData = new FormData();
      formData.append('model', modele);
      formData.append('image[]', blob, 'support.png');
      formData.append('prompt', prompt.trim());
      formData.append('n', '1');
      formData.append('size', t);
      formData.append('quality', q);

      reponse = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
      });
    } else {
      // ── Chemin nominal : generation d'une scene vierge ──────────────────
      reponse = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modele,
          prompt: prompt.trim(),
          n: 1,
          size: t,
          quality: q,
        }),
      });
    }

    let data = null;
    try {
      data = await reponse.json();
    } catch {
      data = null;
    }

    if (!reponse.ok || data?.error) {
      const message = messageErreurOpenAI(reponse.status, data);
      console.error('[Mockup] scene:', reponse.status, data?.error?.message || '');
      // On remonte le statut reel : un 429 doit rester un 429 cote client, sinon
      // le message « patientez une minute » de api-client.js ne part jamais.
      const statut = reponse.status >= 400 && reponse.status < 600 ? reponse.status : 502;
      return res.status(statut).json({ error: message, modele });
    }

    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) {
      // Un 200 sans image est un echec. On ne renvoie pas un objet vide que
      // l'ecran afficherait comme un cadre blanc.
      return res.status(502).json({
        error: 'Le service a repondu sans image. Aucun apercu n\'est affiche : '
          + 'un cadre vide vaut moins que pas d\'apercu.',
        modele,
      });
    }

    return res.status(200).json({
      imageBase64: `data:image/png;base64,${b64}`,
      modele,
      qualite: q,
      taille: t,
      // Rappel porte par la reponse elle-meme, pour que rien en aval ne puisse
      // presenter cette image comme un mockup fini.
      avertissement: 'Scene du support nu uniquement. Le logo du client doit etre incruste '
        + 'localement — il ne doit jamais etre genere.',
    });
  } catch (err) {
    console.error('[Mockup] Erreur:', err?.message);
    return res.status(500).json({
      error: 'Erreur interne du service de scene. L\'apercu reste possible sans IA : '
        + 'importez une photo du support.',
    });
  }
}
