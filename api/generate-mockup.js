/**
 * Vercel Serverless Function — generation d'un mockup produit.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DEUX MODES, ET POURQUOI IL EN FAUT DEUX
 *
 *   MODE « ia » (defaut) — le logo du client part au modele comme IMAGE DE
 *   REFERENCE (`image[]` sur /v1/images/edits) et le modele rend un mockup 3D
 *   complet : t-shirt, casquette, tasse, banderole, avec le marquage dessus.
 *   C'est le mode de VENTE : on montre au client, au comptoir, un objet
 *   credible pour lui faire dire oui. Le bon a tirer se fait ailleurs.
 *
 *   MODE « incrustation » — l'IA ne fabrique que le support nu et le logo est
 *   colle par-dessus en Canvas 2D, pixel pour pixel
 *   (`src/features/mockup-ia/composition.js`). Zero franc, hors ligne, exact.
 *   C'est la SECONDE option : celle du bon a tirer et du support deja
 *   photographie. Elle n'a pas ete supprimee, elle n'est plus le defaut.
 *
 * L'ecran choisit. Cet endpoint sert les deux.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * HISTORIQUE — CE QUI A CHANGE LE 16/09/2026
 *
 * La version du 15/09 refusait en HTTP 400 toute requete portant un logo. Ce
 * refus reposait sur une mesure (Photoroom, 06/07/2026 : 27,2 % de fidelite
 * produit, 20,1 % de distorsion de logo) faite sur un modele ANTERIEUR. Le
 * modele courant, `gpt-image-2.5-sunburst`, est documente par OpenAI comme
 * « optimized for quality » et « for workflows where editing precision matters
 * most ». Opposer une mesure faite sur un autre modele n'est pas une preuve :
 * le refus est leve, et la question est tranchee par des generations reelles.
 *
 * ── LE NOM DU MODELE ──────────────────────────────────────────────────────
 * Il vit dans `OPENAI_IMAGE_MODEL`, comme `api/_lib/modeles.js` le fait pour
 * Anthropic, et pour la meme raison : le 14/09/2026 toute l'IA texte de
 * l'application etait morte sur un `not_found_error` HTTP 404 parce qu'un nom
 * de modele ecrit en dur avait ete retire par le fournisseur. Un nom de modele
 * est une configuration, jamais une constante.
 *
 * (Ce bloc devrait vivre dans `api/_lib/modeles.js` a cote de son equivalent
 * Anthropic. Il est ici parce que ce chantier n'a pas le droit de toucher
 * `_lib/`. A deplacer a la premiere occasion — voir le rapport de livraison.)
 */
import { exigerSession } from './_lib/session.js';
import { limiteDepassee } from './_lib/limite.js';

/**
 * Defaut au 16/09/2026, releve sur `developers.openai.com/api/docs/models`.
 *
 *   - `gpt-image-2.5-sunburst` — modele de base, « optimized for quality »,
 *     « Choose Sunburst for workflows where editing precision matters most »
 *   - `gpt-image-2.5-flare`    — modele rapide, qualite comparable a GPT Image 2
 *
 * On prend `sunburst` : reproduire un logo fourni EST un travail de precision
 * d'edition. `flare` reste un repli si la latence devient le probleme.
 *
 * ⚠️ Calendrier de deprecation (`developers.openai.com/api/docs/deprecations`) :
 *   - `gpt-image-1`        → arret le 23 OCTOBRE 2026
 *   - `gpt-image-1-mini`, `gpt-image-1.5`, `chatgpt-image-latest`
 *                          → arret le 1er DECEMBRE 2026
 *   - `dall-e-2`, `dall-e-3` → ARRETES depuis le 12 MAI 2026
 *
 * Pour changer de modele : poser `OPENAI_IMAGE_MODEL` dans Vercel. Aucun
 * deploiement de code n'est necessaire.
 */
const MODELE_IMAGE_PAR_DEFAUT = 'gpt-image-2.5-sunburst';

function modeleImage() {
  const m = process.env.OPENAI_IMAGE_MODEL;
  return m && m.trim() ? m.trim() : MODELE_IMAGE_PAR_DEFAUT;
}

/**
 * ── LE PARAMETRE DE FIDELITE — LISEZ CECI AVANT D'Y TOUCHER ────────────────
 *
 * `input_fidelity` existe bien, ses valeurs admises sont `"high"` et `"low"`
 * (source : `openai-python/src/openai/types/image_edit_params.py`, champ
 * `input_fidelity: Optional[Literal["high", "low"]]`, et le cookbook
 * `generate_images_with_high_input_fidelity` qui l'emploie avec
 * `model="gpt-image-1"`).
 *
 * MAIS il n'est PAS accepte par gpt-image-2 ni gpt-image-2.5. L'API repond :
 *
 *     HTTP 400 — image_generation_user_error
 *     code: invalid_input_fidelity_model
 *     "The model 'gpt-image-2' does not support the 'input_fidelity' parameter."
 *
 * Raison : ces modeles traitent TOUTES leurs images d'entree en haute fidelite,
 * d'office. La fidelite n'y est donc pas « au maximum permis » parce qu'on la
 * demande — elle l'est parce qu'on ne peut pas la baisser.
 *
 * Consequence pour ce fichier : on n'envoie le parametre QUE pour les modeles
 * ou il est documente comme accepte. Et si un modele inconnu le refuse quand
 * meme, on rejoue une fois sans lui plutot que de rendre une erreur au
 * comptoir. C'est exactement le garde-fou qui manquait le 14/09.
 */
const MODELES_AVEC_INPUT_FIDELITY = /^gpt-image-1(\.5)?(-mini)?$/;

function fidelitePourModele(modele) {
  return MODELES_AVEC_INPUT_FIDELITY.test(modele) ? 'high' : null;
}

/**
 * Tailles acceptees. Documentees pour les modeles GPT Image ; `auto` laisse le
 * modele choisir. On ne laisse pas passer une chaine libre : une taille exotique
 * change le prix sans que personne au comptoir ne le voie.
 */
const TAILLES_AUTORISEES = new Set(['1024x1024', '1536x1024', '1024x1536', 'auto']);

/**
 * Qualites. `xhigh` et `max` sont documentes pour gpt-image-2.5 ; ils sont
 * ouverts ici parce que le texte fin d'un logo en profite, mais l'ecran garde
 * `medium` par defaut — c'est lui qui affiche le cout avant le clic.
 */
const QUALITES_AUTORISEES = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

/**
 * Formats d'image acceptes en entree par /v1/images/edits pour les modeles GPT
 * (« png, webp, or jpg », jusqu'a 16 images). Le SVG n'en fait PAS partie :
 * l'ecran le rasterise avant l'envoi.
 */
const MIMES_REFERENCE = new Set(['image/png', 'image/jpeg', 'image/webp']);

/**
 * Plafond de la reference envoyee. OpenAI accepte 50 Mo par image, mais le corps
 * d'une requete Vercel plafonne a 4,5 Mo — c'est LUI la contrainte reelle, et
 * un depassement se manifeste par un 413 opaque cote client. On coupe avant.
 */
const TAILLE_REFERENCE_MAX = 3 * 1024 * 1024;

/** Nombre maximum d'images de reference (logo + photo de support eventuelle). */
const REFERENCES_MAX = 4;

/**
 * Decode une data URL `data:image/png;base64,...` en { mime, buffer }.
 * Retourne `{ erreur }` plutot que de lever : une exception ici rendrait un 500
 * muet la ou l'utilisateur a besoin de savoir que son fichier est en cause.
 */
function decoderDataUrl(valeur, etiquette) {
  if (typeof valeur !== 'string' || !valeur.startsWith('data:')) {
    return { erreur: `${etiquette} : format attendu « data:image/png;base64,… ».` };
  }
  const separateur = valeur.indexOf(',');
  const entete = valeur.slice(5, separateur);
  if (separateur < 0 || !entete.endsWith(';base64')) {
    return { erreur: `${etiquette} : seul l'encodage base64 est accepte.` };
  }
  const mime = entete.slice(0, -';base64'.length).toLowerCase();
  if (!MIMES_REFERENCE.has(mime)) {
    return {
      erreur: `${etiquette} : le format « ${mime || 'inconnu'} » n'est pas accepte comme reference. `
        + 'Formats admis par OpenAI pour l\'edition : PNG, JPEG, WebP. '
        + 'Un SVG doit etre rasterise avant l\'envoi.',
    };
  }
  let buffer;
  try {
    buffer = Buffer.from(valeur.slice(separateur + 1), 'base64');
  } catch {
    return { erreur: `${etiquette} : donnees base64 illisibles.` };
  }
  if (!buffer.length) return { erreur: `${etiquette} : image vide.` };
  if (buffer.length > TAILLE_REFERENCE_MAX) {
    return {
      erreur: `${etiquette} : ${Math.round(buffer.length / 1024)} Ko, au-dela du plafond de `
        + `${Math.round(TAILLE_REFERENCE_MAX / 1024)} Ko (limite de corps de requete Vercel : 4,5 Mo). `
        + 'Reduisez la definition du logo avant l\'envoi.',
    };
  }
  return { mime, buffer };
}

/**
 * Message d'erreur exploitable a partir d'une reponse OpenAI.
 * Un 404 sur cet endpoint a une seule cause plausible, autant la dire plutot
 * que de renvoyer « Erreur API : 404 ».
 */
function messageErreurOpenAI(statut, corps) {
  const code = corps?.error?.code;
  if (code === 'invalid_input_fidelity_model') {
    return `Le modele « ${modeleImage()} » n'accepte pas le parametre input_fidelity `
      + '(il traite deja ses images d\'entree en haute fidelite). '
      + 'Le service a rejoue la requete sans ce parametre ; si ce message apparait, '
      + 'c\'est que la seconde tentative a echoue elle aussi.';
  }
  if (statut === 404) {
    return `Le modele d'image « ${modeleImage()} » n'existe pas ou n'est pas accessible a cette cle. `
      + 'Corriger la variable OPENAI_IMAGE_MODEL dans Vercel. '
      + '(Rappel : gpt-image-1 est arrete le 23/10/2026, dall-e-3 depuis le 12/05/2026.)';
  }
  if (statut === 401) return 'Cle API OpenAI invalide ou revoquee.';
  if (statut === 429) return 'Quota OpenAI atteint. Reessayer dans quelques minutes.';
  if (statut === 413) {
    return 'Images de reference trop lourdes pour le service. Reduire la definition du logo.';
  }
  if (statut >= 500) return 'Service OpenAI indisponible. Reessayer plus tard.';
  // On remonte le type annonce par OpenAI, jamais le corps complet : il peut
  // contenir un echo de la requete, donc des donnees de l'entreprise.
  const type = corps?.error?.type;
  const msg = corps?.error?.message;
  if (typeof msg === 'string' && msg.trim()) return `Erreur OpenAI (${statut}) : ${msg.trim()}`;
  if (type) return `Erreur OpenAI (${statut}) : ${type}`;
  return `Erreur API OpenAI : ${statut}`;
}

/**
 * Appelle /v1/images/edits. Si le modele refuse `input_fidelity`, rejoue une
 * fois sans lui. `construireFormData` est une fabrique : un FormData consomme
 * n'est pas rejouable.
 */
async function appelerEdits(apiKey, construireFormData, fidelite) {
  let reponse = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: construireFormData(fidelite),
  });
  if (reponse.ok || !fidelite) return { reponse, fideliteEnvoyee: fidelite };

  let corps = null;
  try { corps = await reponse.clone().json(); } catch { corps = null; }
  if (corps?.error?.code !== 'invalid_input_fidelity_model') {
    return { reponse, fideliteEnvoyee: fidelite };
  }
  console.warn('[Mockup] input_fidelity refuse par le modele, nouvel essai sans.');
  reponse = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: construireFormData(null),
  });
  return { reponse, fideliteEnvoyee: null };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.APP_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── Verrou ajoute le 13/09/2026, conserve tel quel ───────────────────────
  // Cet endpoint etait ouvert a Internet : CORS '*', aucune authentification,
  // aucun plafond. N'importe qui connaissant l'URL disposait d'un proxy IA
  // facture sur le compte de l'entreprise.
  if (limiteDepassee(req, { max: 4, fenetreMs: 60_000 })) {
    return res.status(429).json({ error: 'Trop de requetes. Reessayez dans une minute.' });
  }
  if (!exigerSession(req, res)) return;
  // ─────────────────────────────────────────────────────────────────────────

  try {
    const corps = (req.body && typeof req.body === 'object') ? req.body : {};
    const {
      prompt, qualite, taille, supportRefUrl, logoBase64, referencesBase64,
    } = corps;

    if (typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({
        error: 'Prompt requis. Il est construit par '
          + '`src/features/mockup-ia/moteur-mockup.js` et affiche a l\'utilisateur avant '
          + 'l\'envoi : aucune generation facturee sur un prompt non relu.',
      });
    }
    if (prompt.length > 2000) {
      return res.status(400).json({ error: 'Prompt trop long (max 2000 caracteres).' });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: 'Cle API OpenAI non configuree (OPENAI_API_KEY). '
          + 'Le mode incrustation reste disponible : il ne passe par aucun service.',
      });
    }

    const modele = modeleImage();
    const q = QUALITES_AUTORISEES.has(qualite) ? qualite : 'medium';
    const t = TAILLES_AUTORISEES.has(taille) ? taille : '1024x1024';

    /* ── Rassemblement des images de reference ────────────────────────────── */
    // Ordre volontaire : le LOGO en premier. La documentation OpenAI precise que
    // « the first image in the list preserves the finest detail and richest
    // texture » — or c'est le logo, et lui seul, dont le detail se juge.
    const references = [];

    if (logoBase64 !== undefined && logoBase64 !== null && logoBase64 !== '') {
      const d = decoderDataUrl(logoBase64, 'Logo');
      if (d.erreur) return res.status(400).json({ error: d.erreur });
      references.push({ ...d, nom: 'logo.png' });
    }

    if (Array.isArray(referencesBase64)) {
      for (const [i, valeur] of referencesBase64.entries()) {
        if (references.length >= REFERENCES_MAX) break;
        const d = decoderDataUrl(valeur, `Reference ${i + 1}`);
        if (d.erreur) return res.status(400).json({ error: d.erreur });
        references.push({ ...d, nom: `reference-${i + 1}.png` });
      }
    }

    // Photo reelle d'un support nu du magasin : elle sert de reference de matiere.
    if (typeof supportRefUrl === 'string' && supportRefUrl.startsWith('http')
        && references.length < REFERENCES_MAX) {
      let refResponse;
      try {
        refResponse = await fetch(supportRefUrl);
      } catch {
        return res.status(400).json({ error: 'Photo de support de reference injoignable.' });
      }
      if (!refResponse.ok) {
        return res.status(400).json({ error: 'Photo de support de reference illisible.' });
      }
      const buffer = Buffer.from(await refResponse.arrayBuffer());
      if (buffer.length > TAILLE_REFERENCE_MAX) {
        return res.status(400).json({
          error: `Photo de reference trop lourde (max ${Math.round(TAILLE_REFERENCE_MAX / 1024)} Ko).`,
        });
      }
      const mime = (refResponse.headers.get('content-type') || 'image/png').split(';')[0].trim();
      if (!MIMES_REFERENCE.has(mime)) {
        return res.status(400).json({
          error: `Photo de reference au format « ${mime} » : seuls PNG, JPEG et WebP sont acceptes.`,
        });
      }
      references.push({ mime, buffer, nom: 'support.png' });
    }

    /* ── Appel ────────────────────────────────────────────────────────────── */

    let reponse;
    let fideliteEnvoyee = null;
    const mode = references.length ? 'edits' : 'generations';

    if (references.length) {
      // `/v1/images/edits` accepte un TABLEAU d'images de reference — le champ
      // multipart se repete sous le nom `image[]` (openai-python :
      // `image: Required[Union[FileTypes, SequenceNotStr[FileTypes]]]`,
      // « png, webp, or jpg … up to 16 images »).
      const fidelite = fidelitePourModele(modele);
      const construireFormData = (f) => {
        const fd = new FormData();
        fd.append('model', modele);
        for (const r of references) {
          fd.append('image[]', new Blob([r.buffer], { type: r.mime }), r.nom);
        }
        fd.append('prompt', prompt.trim());
        fd.append('n', '1');
        fd.append('size', t);
        fd.append('quality', q);
        if (f) fd.append('input_fidelity', f);
        return fd;
      };
      const r = await appelerEdits(apiKey, construireFormData, fidelite);
      reponse = r.reponse;
      fideliteEnvoyee = r.fideliteEnvoyee;
    } else {
      reponse = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model: modele, prompt: prompt.trim(), n: 1, size: t, quality: q }),
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
      // Jamais la cle, jamais le corps complet : seulement statut et message OpenAI.
      console.error('[Mockup]', mode, reponse.status, data?.error?.code || '', data?.error?.message || '');
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
      mode,
      references: references.length,
      inputFidelity: fideliteEnvoyee,
      avertissement: references.length
        ? 'Mockup de VENTE. Le logo a ete redessine par le modele a partir de la reference '
          + 'fournie : verifier l\'orthographe et les couleurs avant de le montrer, et ne jamais '
          + 's\'en servir comme bon a tirer.'
        : 'Scene du support nu uniquement : le logo doit etre incruste localement.',
    });
  } catch (err) {
    console.error('[Mockup] Erreur:', err?.message);
    return res.status(500).json({
      error: 'Erreur interne du service de mockup. Le mode incrustation reste disponible : '
        + 'il ne passe par aucun service.',
    });
  }
}
