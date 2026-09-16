/**
 * Composition du mockup — le calque qui INCRUSTE le logo reel sur la scene.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Les pixels affiches du logo sont CEUX DU FICHIER DU CLIENT. Rien n'est
 * redessine, rien n'est devine, rien ne passe par un modele.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * La recette, en cinq calques — c'est la technique standard de l'industrie du
 * mockup (Smart Object + displacement map de Photoshop), transposee au Canvas 2D :
 *
 *   1. la photo (ou la scene IA) du support            → le fond
 *   2. la carte de relief : luminance floutee normalisee → la geometrie des plis
 *   3. le logo deforme par cette carte, echantillonnage bilineaire → l'impression
 *   4. le masque de zone imprimable (`destination-in`)  → limite a la poitrine, au dos…
 *   5. la couche ombre/lumiere en fusion `multiply`     → remet les ombres SUR le logo
 *
 * ⚠️ REGLE DE SURVIE : aucune exception ne doit pouvoir empecher l'ecran de
 * s'afficher. Chaque etape faillible est isolee ; si elle echoue, on DEGRADE
 * (collage simple sans relief) et on le DIT, on ne casse jamais le rendu.
 *
 * ⚠️ REGLE DE PRUDENCE COMMERCIALE : ce moteur doit DEGRADER, jamais embellir.
 * Aucun effet de brillance, aucune lumiere de studio synthetique, aucun
 * rehaussement de contraste. Le motif incruste est volontairement un peu moins
 * net et un peu moins sature que le fichier source, parce que le tissu absorbe
 * et que la presse ne rend jamais un aplat d'ecran. Un apercu trop beau ne fait
 * pas perdre la vente : il fait revenir le client, mecontent, a la livraison.
 */

/** Largeur de rendu de l'apercu. 1000 px : ~180 Ko en JPEG q70. */
export const LARGEUR_APERCU = 1000;

/** Le canvas 2D ne fait pas de perspective (setTransform est affine, 6 parametres). */
export const SUPPORTE_PERSPECTIVE = false;

/* ─────────────────────────────────────────────────────────────────────────────
   Chargement — tout est enveloppe, rien ne remonte
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Charge une image depuis une data URL, une blob URL ou une URL distante.
 * Ne rejette jamais : renvoie `null` en cas d'echec, avec la raison.
 *
 * `crossOrigin = 'anonymous'` est indispensable sur une URL distante (Supabase
 * Storage) : sans lui, le canvas est « tainte » et `getImageData()` leverait
 * `SecurityError`, ce qui casserait tout le pipeline de deformation.
 *
 * @returns {Promise<{image: HTMLImageElement|null, message: string}>}
 */
export function chargerImage(src, { delaiMs = 15000 } = {}) {
  return new Promise((resolve) => {
    if (typeof src !== 'string' || !src) {
      resolve({ image: null, message: 'Source d\'image absente.' });
      return;
    }
    let fini = false;
    const terminer = (image, message) => {
      if (fini) return;
      fini = true;
      resolve({ image, message });
    };
    // Le minuteur est CONSERVE et annule des que l'image repond. Sans ca il
    // restait arme jusqu'au bout (15 s) apres chaque chargement reussi : sans
    // consequence visible dans un navigateur, mais il maintient la boucle
    // d'evenements en vie et rallonge d'autant tout test qui monte l'ecran.
    let minuteur = null;
    try {
      const img = new Image();
      if (/^https?:/i.test(src)) img.crossOrigin = 'anonymous';
      img.onload = () => { clearTimeout(minuteur); terminer(img, ''); };
      img.onerror = () => {
        clearTimeout(minuteur);
        terminer(null, 'Image illisible (format non supporte, fichier corrompu, '
          + 'ou acces refuse par le serveur distant).');
      };
      // Le minuteur est arme AVANT `src` : une doublure de test qui repond
      // synchroniquement laisserait sinon un minuteur orphelin derriere elle.
      minuteur = setTimeout(() => terminer(null, 'Chargement de l\'image trop long — abandonne.'), delaiMs);
      img.src = src;
    } catch (e) {
      clearTimeout(minuteur);
      terminer(null, `Chargement impossible : ${e?.message || 'erreur inconnue'}`);
    }
  });
}

/**
 * Transforme un fichier en URL utilisable par <img>.
 *
 * Le SVG est charge via une blob URL et JAMAIS injecte dans le DOM : dans un
 * <img>, le navigateur desactive les scripts et les ressources externes du SVG.
 * C'est aussi ce qui evite de tainter le canvas (une blob URL de meme origine
 * ne le taint pas ; un SVG qui irait chercher une ressource distante, si).
 *
 * @returns {Promise<{url: string|null, source: string, message: string}>}
 *          `source` : le texte du SVG quand c'en est un (pour detecter <text>)
 */
export async function urlDepuisFichier(fichier) {
  if (!fichier) return { url: null, source: '', message: 'Aucun fichier.' };
  try {
    const estSvg = fichier.type === 'image/svg+xml' || /\.svg$/i.test(fichier.name || '');
    let source = '';
    if (estSvg && typeof fichier.text === 'function') {
      try { source = await fichier.text(); } catch { source = ''; }
    }
    const url = URL.createObjectURL(fichier);
    return { url, source, message: '' };
  } catch (e) {
    return { url: null, source: '', message: `Lecture du fichier impossible : ${e?.message || 'erreur'}` };
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   Lecture des pixels du logo (pour l'analyse de faisabilite)
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Rend le logo sur un petit canvas et en renvoie les pixels RGBA.
 * L'echantillonnage est volontairement reduit (256 px max) : on cherche a
 * compter des teintes, pas a inspecter le fichier.
 *
 * @returns {{donnees: Uint8ClampedArray|null, largeur: number, hauteur: number, message: string}}
 */
export function lirePixelsLogo(image, { cote = 256 } = {}) {
  if (!image || !image.naturalWidth) {
    return { donnees: null, largeur: 0, hauteur: 0, message: 'Logo non charge.' };
  }
  const lNat = image.naturalWidth;
  const hNat = image.naturalHeight;
  try {
    const ratio = Math.min(1, cote / Math.max(lNat, hNat));
    const l = Math.max(1, Math.round(lNat * ratio));
    const h = Math.max(1, Math.round(hNat * ratio));
    const c = document.createElement('canvas');
    c.width = l; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { donnees: null, largeur: lNat, hauteur: hNat, message: 'Canvas 2D indisponible.' };
    ctx.drawImage(image, 0, 0, l, h);
    const d = ctx.getImageData(0, 0, l, h).data;
    return { donnees: d, largeur: lNat, hauteur: hNat, message: '' };
  } catch (e) {
    // SecurityError sur canvas tainte, ou memoire insuffisante. On renvoie les
    // dimensions (utiles pour le calcul de definition) et on dit qu'on n'a pas
    // pu analyser — le garde-fou technique passera alors en mode « inconnu ».
    return {
      donnees: null, largeur: lNat, hauteur: hNat,
      message: `Analyse des pixels impossible (${e?.name || 'erreur'}) : `
        + 'les regles de faisabilite flex/sublimation ne peuvent pas etre verifiees automatiquement. '
        + 'Verifiez a l\'oeil que le visuel est bien en aplats.',
    };
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   Carte de relief — la geometrie des plis
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Luminance → flou boite → normalisation centree sur 0.
 * Formule de luminance standard : 0.299 R + 0.587 G + 0.114 B.
 *
 * @returns {Float32Array|null} valeurs dans [-1, 1], une par pixel
 */
function carteDeRelief(donnees, largeur, hauteur, rayonFlou = 4) {
  try {
    const n = largeur * hauteur;
    const lum = new Float32Array(n);
    for (let i = 0, p = 0; p < n; i += 4, p += 1) {
      lum[p] = (0.299 * donnees[i] + 0.587 * donnees[i + 1] + 0.114 * donnees[i + 2]) / 255;
    }

    // Flou boite separable — enleve le grain du capteur, garde les plis.
    const flou = new Float32Array(n);
    const tmp = new Float32Array(n);
    const r = Math.max(1, rayonFlou | 0);
    for (let y = 0; y < hauteur; y += 1) {
      for (let x = 0; x < largeur; x += 1) {
        let s = 0; let c = 0;
        for (let k = -r; k <= r; k += 1) {
          const xx = x + k;
          if (xx < 0 || xx >= largeur) continue;
          s += lum[y * largeur + xx]; c += 1;
        }
        tmp[y * largeur + x] = s / (c || 1);
      }
    }
    for (let y = 0; y < hauteur; y += 1) {
      for (let x = 0; x < largeur; x += 1) {
        let s = 0; let c = 0;
        for (let k = -r; k <= r; k += 1) {
          const yy = y + k;
          if (yy < 0 || yy >= hauteur) continue;
          s += tmp[yy * largeur + x]; c += 1;
        }
        flou[y * largeur + x] = s / (c || 1);
      }
    }

    // Normalisation : on centre sur la moyenne, on borne a [-1, 1].
    let somme = 0;
    for (let p = 0; p < n; p += 1) somme += flou[p];
    const moyenne = somme / (n || 1);
    let ampli = 0;
    for (let p = 0; p < n; p += 1) {
      const d = Math.abs(flou[p] - moyenne);
      if (d > ampli) ampli = d;
    }
    if (ampli < 1e-4) ampli = 1e-4;
    for (let p = 0; p < n; p += 1) {
      flou[p] = (flou[p] - moyenne) / ampli;
    }
    return flou;
  } catch {
    return null;
  }
}

/** Echantillonnage bilineaire d'une source RGBA. */
function echantillonner(src, largeur, hauteur, x, y, sortie, dst) {
  const x0 = Math.floor(x); const y0 = Math.floor(y);
  const fx = x - x0; const fy = y - y0;
  const x1 = Math.min(largeur - 1, x0 + 1);
  const y1 = Math.min(hauteur - 1, y0 + 1);
  if (x0 < 0 || y0 < 0 || x0 >= largeur || y0 >= hauteur) {
    sortie[dst] = 0; sortie[dst + 1] = 0; sortie[dst + 2] = 0; sortie[dst + 3] = 0;
    return;
  }
  const i00 = (y0 * largeur + x0) * 4;
  const i10 = (y0 * largeur + x1) * 4;
  const i01 = (y1 * largeur + x0) * 4;
  const i11 = (y1 * largeur + x1) * 4;
  for (let c = 0; c < 4; c += 1) {
    const haut = src[i00 + c] * (1 - fx) + src[i10 + c] * fx;
    const bas = src[i01 + c] * (1 - fx) + src[i11 + c] * fx;
    sortie[dst + c] = haut * (1 - fy) + bas * fy;
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   La composition
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Compose le mockup dans `canvas`.
 *
 * @param {object} p
 * @param {HTMLCanvasElement} p.canvas
 * @param {HTMLImageElement}  p.scene    photo ou scene IA du support nu
 * @param {HTMLImageElement}  p.logo     logo du client, tel quel
 * @param {object} p.zone                {cx, cy, wMax, hMax} normalises
 * @param {object} p.position            {x, y, largeur, rotation} normalises sur la scene
 * @param {Array}  [p.textes]            blocs prepares — dessines ici, dans les DEUX modes
 * @param {boolean} [p.logoDejaDansLaScene] vrai en mode « Rendu 3D IA »
 * @param {number} [p.forceRelief]       0 a 1 — amplitude de la deformation par les plis
 * @param {number} [p.opacite]           0 a 1 — le motif n'est jamais a 1, le tissu absorbe
 * @param {number} [p.forceOmbre]        0 a 1 — reinjection des ombres de la scene
 * @returns {{ok: boolean, degrade: boolean, message: string}}
 */
export function composerMockup({
  canvas,
  scene,
  logo,
  zone,
  position,
  // Blocs de texte prepares par `preparerTextesPourRendu` (moteur-mockup.js).
  // Ils sont DESSINES ici, donc exacts au caractere pres — et c'est vrai DANS
  // LES DEUX MODES depuis le 16/09/2026 : « Rendu 3D IA » comme « Incrustation
  // exacte ». Le modele d'image ne recoit plus aucun texte. C'est la seule
  // facon de garantir qu'un numero imprime est le numero saisi, et surtout
  // qu'un bloc demande n'est jamais omis en silence.
  textes = [],
  // Mode « Rendu 3D IA » : le logo est DEJA dans l'image rendue par le modele.
  // Le recoller ici en donnerait deux. Ce drapeau evite surtout d'afficher au
  // gerant un avertissement « sans logo » alors que le logo est bien la.
  logoDejaDansLaScene = false,
  forceRelief = 0.55,
  opacite = 0.92,
  forceOmbre = 0.85,
} = {}) {
  if (!canvas || !scene || !scene.naturalWidth) {
    return { ok: false, degrade: false, message: 'Scène absente : rien a composer.' };
  }

  let ctx;
  try {
    const ratio = scene.naturalHeight / scene.naturalWidth;
    canvas.width = LARGEUR_APERCU;
    canvas.height = Math.max(1, Math.round(LARGEUR_APERCU * ratio));
    ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { ok: false, degrade: false, message: 'Canvas 2D indisponible sur ce poste.' };
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(scene, 0, 0, canvas.width, canvas.height);
  } catch (e) {
    return { ok: false, degrade: false, message: `Rendu de la scene impossible : ${e?.message || 'erreur'}` };
  }

  const L = canvas.width;
  const H = canvas.height;
  const z = zone || ZONE_REPLI;

  if (!logo || !logo.naturalWidth) {
    // La scene seule est un resultat valable : le gerant voit deja le support
    // et le coloris. On le dit, on ne casse rien. Les textes, eux, se dessinent
    // sans logo — un marquage « nom + telephone » se vend tres bien seul.
    // C'est aussi le chemin du mode « Rendu 3D IA », ou le logo est deja dans
    // l'image produite par le modele : seuls les textes restent a composer.
    const nb = dessinerTextes(ctx, textes, z, L, H);
    if (logoDejaDansLaScene) {
      // Rien n'est degrade : le logo vient du modele, le texte vient d'ici.
      return { ok: true, degrade: false, message: '' };
    }
    return {
      ok: true,
      degrade: true,
      message: nb
        ? `Scène affichee avec ${nb} bloc(s) de texte, sans logo : importez le fichier du client.`
        : 'Scène affichee sans logo : importez le fichier du client.',
    };
  }

  // ── Cadre du logo, borne a la zone imprimable ────────────────────────────
  const pos = position || { x: z.cx, y: z.cy, largeur: Math.min(0.25, z.wMax), rotation: 0 };
  const largeurLogo = Math.max(8, Math.min(pos.largeur, z.wMax) * L);
  const hauteurLogo = Math.max(8, largeurLogo * (logo.naturalHeight / logo.naturalWidth));
  const cx = Math.min(Math.max(pos.x, 0), 1) * L;
  const cy = Math.min(Math.max(pos.y, 0), 1) * H;
  const rot = ((Number(pos.rotation) || 0) * Math.PI) / 180;

  // ── Calque logo, seul, sur fond transparent ──────────────────────────────
  let calque;
  let ctxCalque;
  try {
    calque = document.createElement('canvas');
    calque.width = L; calque.height = H;
    ctxCalque = calque.getContext('2d', { willReadFrequently: true });
    if (!ctxCalque) throw new Error('contexte indisponible');
    ctxCalque.save();
    ctxCalque.translate(cx, cy);
    if (rot) ctxCalque.rotate(rot);
    ctxCalque.drawImage(logo, -largeurLogo / 2, -hauteurLogo / 2, largeurLogo, hauteurLogo);
    ctxCalque.restore();
  } catch (e) {
    // Repli ultime : collage direct sur le canvas visible, sans relief ni masque.
    try {
      ctx.save();
      ctx.globalAlpha = opacite;
      ctx.translate(cx, cy);
      if (rot) ctx.rotate(rot);
      ctx.drawImage(logo, -largeurLogo / 2, -hauteurLogo / 2, largeurLogo, hauteurLogo);
      ctx.restore();
      return {
        ok: true, degrade: true,
        message: 'Logo appose sans simulation de relief (calque intermediaire indisponible). '
          + 'L\'aperçu reste fidèle au fichier, il est juste moins réaliste.',
      };
    } catch {
      return { ok: false, degrade: true, message: `Incrustation impossible : ${e?.message || 'erreur'}` };
    }
  }

  // ── Deformation par les plis + masque de zone + ombres ───────────────────
  let degrade = false;
  let messageDegrade = '';

  try {
    const scenePixels = ctx.getImageData(0, 0, L, H);
    const relief = carteDeRelief(scenePixels.data, L, H, Math.max(2, Math.round(L / 250)));

    const logoImage = ctxCalque.getImageData(0, 0, L, H);
    const src = logoImage.data;

    if (relief) {
      const amplitude = Math.max(0, Math.min(1, forceRelief)) * (L / 110);
      const sortie = new Uint8ClampedArray(src.length);
      const tampon = new Float32Array(4);
      for (let y = 0; y < H; y += 1) {
        for (let x = 0; x < L; x += 1) {
          const p = y * L + x;
          // Gradient de la carte de relief : la ou le tissu monte, le motif glisse.
          const gx = relief[y * L + Math.min(L - 1, x + 1)] - relief[y * L + Math.max(0, x - 1)];
          const gy = relief[Math.min(H - 1, y + 1) * L + x] - relief[Math.max(0, y - 1) * L + x];
          echantillonner(src, L, H, x - gx * amplitude, y - gy * amplitude, tampon, 0);
          const d = p * 4;
          sortie[d] = tampon[0]; sortie[d + 1] = tampon[1];
          sortie[d + 2] = tampon[2]; sortie[d + 3] = tampon[3];
        }
      }
      logoImage.data.set(sortie);
      ctxCalque.putImageData(logoImage, 0, 0);
    } else {
      degrade = true;
      messageDegrade = 'Relief du tissu non calcule : le logo est pose a plat. Fidele, moins réaliste.';
    }

    // Calque 4 — masque de la zone imprimable.
    ctxCalque.globalCompositeOperation = 'destination-in';
    ctxCalque.fillStyle = '#000';
    dessinerZone(ctxCalque, z, L, H);
    ctxCalque.globalCompositeOperation = 'source-over';

    // Calque 5 — les ombres de la scene reviennent SUR le logo (fusion multiply),
    // limitees au calque par `source-atop` : c'est ce qui fait que le motif
    // « appartient » au tissu au lieu d'y flotter.
    if (forceOmbre > 0) {
      try {
        const ombre = document.createElement('canvas');
        ombre.width = L; ombre.height = H;
        const ctxOmbre = ombre.getContext('2d');
        if (ctxOmbre) {
          ctxOmbre.filter = 'grayscale(1) blur(1px)';
          ctxOmbre.drawImage(canvas, 0, 0);
          ctxCalque.globalCompositeOperation = 'source-atop';
          ctxCalque.globalAlpha = Math.max(0, Math.min(1, forceOmbre));
          ctxCalque.drawImage(ombre, 0, 0);
          ctxCalque.globalAlpha = 1;
          ctxCalque.globalCompositeOperation = 'source-over';
        }
      } catch {
        // `filter` n'est pas supporte partout : on s'en passe, sans rien casser.
      }
    }
  } catch (e) {
    degrade = true;
    messageDegrade = e?.name === 'SecurityError'
      ? 'La photo du support vient d\'un autre domaine et bloque la lecture des pixels : '
        + 'le logo est pose a plat, sans relief. Heberger la photo avec l\'application corrige ca.'
      : `Simulation de relief indisponible (${e?.message || 'erreur'}) : logo pose a plat.`;
  }

  // ── Report sur la scene ──────────────────────────────────────────────────
  try {
    ctx.save();
    // On DEGRADE volontairement : jamais 100 % d'opacite, un soupcon de flou.
    // Le tissu absorbe ; un aplat parfaitement net et parfaitement sature promet
    // ce que la presse ne sort pas.
    ctx.globalAlpha = Math.max(0.5, Math.min(1, opacite));
    try { ctx.filter = 'saturate(0.94) blur(0.25px)'; } catch { /* filter non supporte */ }
    ctx.drawImage(calque, 0, 0);
    ctx.restore();
    try { ctx.filter = 'none'; } catch { /* ignore */ }
  } catch (e) {
    return { ok: false, degrade: true, message: `Report du logo impossible : ${e?.message || 'erreur'}` };
  }

  // Les textes sont dessines APRES le logo, et sans le traitement de relief :
  // un texte doit rester parfaitement net et parfaitement lisible a l'ecran,
  // c'est lui que le gerant relit caractere par caractere.
  dessinerTextes(ctx, textes, z, L, H);

  return { ok: true, degrade, message: messageDegrade };
}

/** Geometrie de repli quand aucune zone n'est connue. */
const ZONE_REPLI = { id: '_repli', cx: 0.5, cy: 0.45, wMax: 0.5, hMax: 0.4, largeurMaxCm: 20 };

/**
 * Dessine les blocs de texte sur la scene, exactement tels qu'ils ont ete
 * saisis. Aucune correction, aucune capitalisation automatique : ce qui est
 * tape est ce qui s'imprime.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * C'EST ICI QUE LE TEXTE EST FABRIQUE — DANS LES DEUX MODES, DEPUIS LE 16/09.
 *
 * Plus aucun texte n'est demande au modele d'image. Mesure du 16/09/2026 : sur
 * 6 generations reelles, l'orthographe et les chiffres etaient justes, et un
 * bloc entier a quand meme ete SILENCIEUSEMENT OMIS — le modele a juge qu'il
 * faisait doublon avec le logo. Un caractere faux se voit ; un bloc absent,
 * non. `fillText` ne peut ni omettre, ni paraphraser, ni traduire : il dessine
 * la chaine qu'on lui donne, caractere par caractere.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Chaque bloc porte SA zone (`t.zone`, resolue par `preparerTextesPourRendu`) :
 * un nom sur la poitrine et un numero dans le dos ne s'empilent pas ensemble.
 * Les blocs d'une meme zone, eux, s'empilent dans l'ordre de saisie.
 *
 * @param {object} ctx        contexte 2D
 * @param {Array}  textes     blocs normalises, avec `contenu`, `hauteurCm`, `hex`, `zone`
 * @param {object} zoneDefaut zone de marquage courante, pour les blocs sans zone propre
 * @returns {number} nombre de blocs effectivement dessines
 */
export function dessinerTextes(ctx, textes, zoneDefaut, L, H) {
  const liste = Array.isArray(textes)
    ? textes.filter((t) => t && typeof t.contenu === 'string' && t.contenu.trim())
    : [];
  if (!liste.length || !ctx) return 0;

  const largeur = Number(L) > 0 ? Number(L) : 1000;
  const hauteur = Number(H) > 0 ? Number(H) : 1000;
  const parDefaut = zoneDefaut || ZONE_REPLI;
  const curseurs = new Map();
  let dessines = 0;

  for (const t of liste) {
    try {
      const z = t.zone || parDefaut || ZONE_REPLI;
      const cle = z.id || `${z.cx}:${z.cy}`;
      // Les blocs s'empilent sous le centre de LEUR zone, dans l'ordre de saisie.
      let curseurY = curseurs.has(cle) ? curseurs.get(cle) : (z.cy + (z.hMax || 0.4) * 0.32) * hauteur;

      // `hauteurCm` est une hauteur REELLE sur le support. La zone porte sa
      // largeur reelle (`largeurMaxCm`) : le rapport des deux donne la taille
      // a l'ecran, sans jamais supposer une definition d'image.
      const largeurZonePx = Math.max(1, (z.wMax || 0.5) * largeur);
      const cmParPixel = (z.largeurMaxCm || 20) / largeurZonePx;
      let taillePx = Math.max(9, Math.round((t.hauteurCm || 2) / cmParPixel));

      ctx.save();
      const police = (px) => `700 ${px}px "Helvetica Neue", Arial, sans-serif`;
      ctx.font = police(taillePx);

      // Un texte plus large que sa zone deborderait sur le reste du support et
      // promettrait un marquage que l'atelier ne peut pas presser. On reduit
      // plutot que de laisser deborder — et jamais sous 9 px, illisible.
      if (typeof ctx.measureText === 'function') {
        try {
          let garde = 0;
          while (taillePx > 9 && garde < 40) {
            const l = ctx.measureText(t.contenu)?.width || 0;
            if (!l || l <= largeurZonePx) break;
            taillePx = Math.max(9, Math.floor(taillePx * 0.92));
            ctx.font = police(taillePx);
            garde += 1;
          }
        } catch { /* measureText indisponible : on garde la taille demandee */ }
      }

      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = t.hex || '#111111';
      // Un liseré tres discret : sur un support de la meme couleur que le texte
      // (blanc sur blanc), sans lui le bloc disparait et le gerant croit a un bug.
      ctx.lineWidth = Math.max(1, taillePx * 0.03);
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.globalAlpha = 0.95;
      // ⛔ `t.contenu` part TEL QUEL. Aucune transformation, aucun `toUpperCase`,
      // aucun reformatage de numero : « 060 44 46 34 » garde ses espaces.
      ctx.fillText(t.contenu, z.cx * largeur, curseurY);
      ctx.strokeText(t.contenu, z.cx * largeur, curseurY);
      ctx.restore();

      curseurY += taillePx * 1.25;
      curseurs.set(cle, curseurY);
      dessines += 1;
    } catch {
      // Un bloc illisible ne doit pas emporter les autres ni l'apercu entier.
    }
  }
  return dessines;
}

/** Dessine le contour de la zone imprimable (rectangle a coins adoucis). */
function dessinerZone(ctx, z, L, H) {
  const l = z.wMax * L;
  const h = z.hMax * H;
  const x = z.cx * L - l / 2;
  const y = z.cy * H - h / 2;
  const r = Math.min(l, h) * 0.06;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, l, h, r);
  } else {
    ctx.rect(x, y, l, h);
  }
  ctx.fill();
}

/**
 * Exporte l'apercu en JPEG. Jamais en PNG : le PNG d'une photo pese 3 a 5 fois
 * plus lourd, et cet apercu part sur WhatsApp depuis Moanda.
 * @returns {{ok: boolean, dataUrl: string|null, message: string}}
 */
export function exporterApercu(canvas, qualite = 0.82) {
  try {
    if (!canvas || !canvas.width) {
      return { ok: false, dataUrl: null, message: 'Aucun aperçu a exporter.' };
    }
    const dataUrl = canvas.toDataURL('image/jpeg', qualite);
    if (!dataUrl || !dataUrl.startsWith('data:image/')) {
      return { ok: false, dataUrl: null, message: 'Export de l\'aperçu vide.' };
    }
    return { ok: true, dataUrl, message: '' };
  } catch (e) {
    return {
      ok: false, dataUrl: null,
      message: e?.name === 'SecurityError'
        ? 'Export bloque : la photo du support vient d\'un autre domaine. '
          + 'Heberger la photo avec l\'application corrige ca.'
        : `Export impossible : ${e?.message || 'erreur'}`,
    };
  }
}

/**
 * Prepare le logo pour un envoi au modele d'image comme IMAGE DE REFERENCE.
 *
 * Trois raisons de passer par le canvas plutot que d'envoyer le fichier brut :
 *
 *  1. LE FORMAT. `/v1/images/edits` accepte PNG, JPEG et WebP pour les modeles
 *     GPT Image — pas le SVG. Un logo de client arrive souvent en SVG ; le
 *     dessiner dans un canvas le rasterise.
 *  2. LE POIDS. OpenAI tolere 50 Mo par image, mais le corps d'une requete
 *     Vercel plafonne a 4,5 Mo : c'est LUI la contrainte, et un depassement se
 *     manifeste par un 413 opaque. On borne le cote a `cote` pixels.
 *  3. LA TRANSPARENCE. On garde le PNG (et donc l'alpha) : un logo aplati sur
 *     un fond blanc arriverait au modele avec un rectangle blanc autour, qu'il
 *     reproduirait consciencieusement sur le t-shirt.
 *
 * @returns {{ok: boolean, dataUrl: string|null, octets: number, message: string}}
 */
export function rasteriserPourReference(image, { cote = 1024 } = {}) {
  try {
    if (!image || !image.naturalWidth) {
      return { ok: false, dataUrl: null, octets: 0, message: 'Logo non charge.' };
    }
    const L = image.naturalWidth;
    const H = image.naturalHeight;
    const facteur = Math.min(1, cote / Math.max(L, H));
    const l = Math.max(1, Math.round(L * facteur));
    const h = Math.max(1, Math.round(H * facteur));

    const canvas = document.createElement('canvas');
    canvas.width = l;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return { ok: false, dataUrl: null, octets: 0, message: 'Canvas indisponible sur ce poste.' };
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, l, h);

    const dataUrl = canvas.toDataURL('image/png');
    if (!dataUrl || !dataUrl.startsWith('data:image/png')) {
      return { ok: false, dataUrl: null, octets: 0, message: 'Rasterisation du logo vide.' };
    }
    // Taille reelle apres decodage base64, pour que l'appelant puisse refuser
    // AVANT de payer un aller-retour reseau.
    const octets = Math.floor((dataUrl.length - dataUrl.indexOf(',') - 1) * 3 / 4);
    return { ok: true, dataUrl, octets, message: '' };
  } catch (e) {
    return {
      ok: false, dataUrl: null, octets: 0,
      message: e?.name === 'SecurityError'
        ? 'Logo bloque : il vient d\'un autre domaine et ne peut pas etre relu par le navigateur.'
        : `Preparation du logo impossible : ${e?.message || 'erreur'}`,
    };
  }
}

/**
 * Detourage du fond uni d'un logo (le client arrive avec un JPG sur fond blanc).
 *
 * Remplissage par diffusion depuis les quatre coins, avec alpha progressif sur la
 * bande de tolerance. Choisi contre les modeles de detourage par reseau de
 * neurones pour deux raisons : le poids (42 a 84 Mo de modele, impensable a
 * Moanda) et surtout la fidelite — un reseau LISSE et REINVENTE les bords, ce
 * qui est exactement ce qu'on cherche a eviter sur un logo. Les contre-formes
 * interieures (le trou d'un « O ») sont preservees, ce qu'un seuil global
 * detruirait.
 *
 * @returns {{ok: boolean, dataUrl: string|null, retires: number, message: string}}
 */
export function detourerFondUni(image, { tolerance = 28 } = {}) {
  try {
    if (!image || !image.naturalWidth) {
      return { ok: false, dataUrl: null, retires: 0, message: 'Logo non charge.' };
    }
    const L = image.naturalWidth;
    const H = image.naturalHeight;
    if (L * H > 16e6) {
      return { ok: false, dataUrl: null, retires: 0, message: 'Image trop grande pour le detourage automatique.' };
    }
    const c = document.createElement('canvas');
    c.width = L; c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { ok: false, dataUrl: null, retires: 0, message: 'Canvas 2D indisponible.' };
    ctx.drawImage(image, 0, 0);
    const img = ctx.getImageData(0, 0, L, H);
    const d = img.data;

    const coin = [0, (L - 1) * 4, (H - 1) * L * 4, ((H - 1) * L + L - 1) * 4];
    const refs = coin.map((i) => [d[i], d[i + 1], d[i + 2]]);

    const vus = new Uint8Array(L * H);
    const pile = [0, L - 1, (H - 1) * L, (H - 1) * L + L - 1];
    let retires = 0;

    const proche = (i) => {
      for (const [r, g, b] of refs) {
        const dist = Math.max(Math.abs(d[i] - r), Math.abs(d[i + 1] - g), Math.abs(d[i + 2] - b));
        if (dist <= tolerance) return dist;
      }
      return -1;
    };

    while (pile.length) {
      const p = pile.pop();
      if (p < 0 || p >= L * H || vus[p]) continue;
      vus[p] = 1;
      const i = p * 4;
      const dist = proche(i);
      if (dist < 0) continue;
      // Alpha progressif sur la bande de tolerance : un seuil net produit un
      // bord en escalier (« defrangeage »).
      const a = Math.round((dist / tolerance) * 255 * 0.6);
      if (d[i + 3] > a) { d[i + 3] = a; retires += 1; }
      const x = p % L; const y = (p / L) | 0;
      if (x > 0) pile.push(p - 1);
      if (x < L - 1) pile.push(p + 1);
      if (y > 0) pile.push(p - L);
      if (y < H - 1) pile.push(p + L);
    }

    ctx.putImageData(img, 0, 0);
    return {
      ok: true,
      dataUrl: c.toDataURL('image/png'),
      retires,
      message: retires === 0
        ? 'Aucun fond uni detecte : le logo est laisse tel quel.'
        : `Fond detoure (${Math.round((retires / (L * H)) * 100)} % de la surface). Annulable.`,
    };
  } catch (e) {
    return {
      ok: false, dataUrl: null, retires: 0,
      message: `Detourage impossible (${e?.name || 'erreur'}) : le logo est utilise tel quel.`,
    };
  }
}
