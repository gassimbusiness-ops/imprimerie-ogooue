/**
 * Auto-poster — L'HÉBERGEMENT DU MÉDIA. Le dernier maillon avant une vraie
 * publication.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CE QUI MANQUAIT, EXACTEMENT
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Au 18/09/2026 la chaîne était complète SAUF ce chaînon :
 *
 *   ✅ ChatGPT dépose l'affiche dans le Drive ;
 *   ✅ `drive.js` sait la lire ;
 *   ✅ `autopost-alimentation.js` en fait une ligne de file ;
 *   ❌ la ligne entrait avec `url_media: null` ;
 *   ✅ l'exécuteur refusait de publier (`url_media_absente`).
 *
 * Meta ne reçoit pas de fichier : Instagram et Facebook vont CHERCHER l'image à
 * une adresse publiquement joignable. Un fichier de Drive privé n'en est pas
 * une, et le rendre public serait exactement le partage par lien que le dossier
 * interdit — le Drive porte les baux, les contrats de travail, la procuration
 * bancaire.
 *
 * Ce module prend donc les octets dans le Drive et les repose dans le bucket
 * Supabase `publications`, qui est public, plafonné à 15 Mo et n'accepte que
 * quatre types. **Ce bucket ne contient QUE des affiches déjà destinées à être
 * vues de tous** : le rendre public ne révèle rien qui ne soit pas sur le point
 * d'être publié.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 🔴 LE CHEMIN DE L'OBJET — POURQUOI CELUI-LÀ, ET PAS UN AUTRE
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   publications/<publication_id>/v<version_contenu>/<md5>-<nom_assaini>
 *
 * Le passage tourne deux fois par jour et peut être relancé à la main. La
 * question « faut-il téléverser ? » doit donc être DÉCIDABLE sans état
 * intermédiaire, et la règle de la maison — payée une fois, à l'encaissement
 * SingPay du 16/09 — est qu'on se fonde sur le TÉMOIN DE L'EFFET, jamais sur un
 * drapeau « déjà fait » qu'on se serait posé à soi-même.
 *
 * Ici l'effet recherché est « l'objet est dans le bucket ». Son témoin est donc
 * l'objet lui-même, et le chemin doit répondre à une seule exigence :
 *
 *   **il change quand le contenu change, et il ne change pas autrement.**
 *
 * D'où le `<md5>` : c'est l'empreinte que GOOGLE a calculée sur les octets
 * réellement stockés dans le Drive (`files.list` la rend dans le champ
 * `md5Checksum`, déjà lu par `drive.js` — elle ne coûte aucune requête de
 * plus). Elle est MESURÉE, pas déclarée : le `sha256` du manifeste, lui, est
 * une affirmation de ChatGPT, et bâtir l'idempotence sur une affirmation de
 * celui qu'on contrôle n'a aucun sens.
 *
 * Conséquences, toutes voulues :
 *
 *   - ChatGPT redépose le MÊME fichier → même md5 → même chemin → l'objet est
 *     déjà là → aucun téléversement. C'est le cas de très loin le plus
 *     fréquent, et il ne coûte qu'une question au bucket.
 *   - ChatGPT corrige l'affiche SANS changer `version_contenu` (il ne devrait
 *     pas, mais rien ne l'en empêche) → md5 différent → chemin différent →
 *     nouvel objet. **C'est le cas qui interdit de se contenter de
 *     `publication_id + version`** : sans le md5, on servirait l'ancienne image
 *     sous une ligne dont le contenu a changé, et l'approbation porterait sur
 *     une image que personne n'a publiée.
 *   - `publication_id` et `v<version>` ne servent PAS à l'idempotence : ils
 *     servent à ce qu'un humain qui ouvre le bucket sache ce qu'il regarde, et
 *     à ce qu'un jour on puisse balayer ce qui appartient à une publication
 *     retirée. Le md5 seul suffirait à la correction ; il ne suffirait pas à la
 *     lisibilité.
 *
 * Un média sans `md5` est ÉCARTÉ (`empreinte_media_absente`) plutôt que rangé
 * sous un chemin deviné : Google rend cette empreinte pour tout fichier binaire
 * téléversé ; son absence signale autre chose qu'une affiche (raccourci,
 * document Google), et deviner ici reviendrait à casser l'idempotence en
 * silence.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 🔴 UNE PANNE D'HÉBERGEMENT N'EST PAS UNE PANNE D'ALIMENTATION
 * ════════════════════════════════════════════════════════════════════════════
 *
 * La règle déjà tenue dans `api/autopost.js` : « alimenter et publier sont deux
 * gestes ». Elle vaut ici d'un cran plus bas : **héberger et alimenter sont
 * deux gestes**. Si Google ou Supabase Storage tombe, la ligne entre quand même
 * en file avec `url_media: null` — perdre le dépôt entier parce qu'une image
 * n'a pas pu être recopiée serait une punition sans rapport avec la faute.
 *
 * Ce module ne LÈVE donc jamais. Il rend un résultat qui porte soit une URL,
 * soit un motif — et ce motif est écrit dans `derniere_erreur` de la ligne, là
 * où l'écran « Publications automatiques » l'affiche déjà. Un motif qui meurt
 * dans un `console.error` n'existe pas.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CE QUE CE MODULE NE FAIT PAS
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   ⛔ il ne publie rien, n'approuve rien, n'ouvre aucun verrou ;
 *   ⛔ il ne RÉPARE aucun média : ni conversion PNG → JPEG, ni recompression
 *      d'un fichier trop lourd. Une affiche modifiée après coup est une affiche
 *      que personne n'a approuvée. Trop lourde ou hors liste → écartée, avec le
 *      chiffre et le type exacts ;
 *   ⛔ il ne réimplémente pas le contrat. C'est `validerManifeste()` qui refuse
 *      un PNG destiné à Instagram, en amont. Les quatre types admis ci-dessous
 *      sont ceux DU BUCKET : deux garde-fous différents, aucun des deux ne
 *      remplace l'autre ;
 *   ⛔ il n'efface rien. Un objet devenu inutile (version remplacée) reste dans
 *      le bucket : le supprimer au moment où une ligne change d'avis, c'est
 *      risquer d'effacer l'image d'une publication encore en vol.
 */
import { formaterInstantUtc } from '../../src/lib/dates.js';

/** Le bucket. Public, plafond 15 Mo, quatre types — créé hors de ce dépôt. */
export const BUCKET = 'publications';

/**
 * Le plafond du bucket, en octets (15 Mio). ⚠️ Ce n'est PAS une limite choisie
 * ici : c'est `storage.buckets.file_size_limit` du projet Supabase. La recopier
 * sert à écarter AVANT de télécharger 40 Mo pour rien et à rendre un motif
 * lisible, pas à décider. Si le bucket changeait, c'est lui qui trancherait —
 * et le téléversement échouerait avec son propre message, capté plus bas.
 */
export const TAILLE_MAX_OCTETS = 15 * 1024 * 1024;

/** Les types admis par le bucket, dans l'ordre où il les déclare. */
export const TYPES_ADMIS = Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'video/mp4']);

/**
 * Pourquoi un média n'a pas été hébergé. Ces codes sont écrits dans
 * `derniere_erreur.code_erreur` de la ligne et dans le journal.
 */
export const MOTIFS_MEDIA = Object.freeze({
  AUCUN_MEDIA: 'aucun_media_pour_ce_canal',
  MEDIA_INTROUVABLE: 'media_introuvable_dans_le_dossier',
  TYPE_NON_ADMIS: 'type_de_media_non_admis',
  TROP_LOURD: 'media_trop_lourd',
  EMPREINTE_ABSENTE: 'empreinte_media_absente',
  DRIVE_INJOIGNABLE: 'media_illisible_dans_le_drive',
  STOCKAGE_INJOIGNABLE: 'hebergement_indisponible',
});

/**
 * Ce qu'il faut FAIRE, pour chaque motif. La phrase va à l'écran telle quelle :
 * elle s'adresse au gérant de Moanda, pas à un développeur.
 */
const PISTES = Object.freeze({
  [MOTIFS_MEDIA.AUCUN_MEDIA]:
    'Vérifier que publication.json déclare bien un média ciblant ce canal (champ canal_cible).',
  [MOTIFS_MEDIA.MEDIA_INTROUVABLE]:
    'Le fichier annoncé n\'est pas dans le dossier de la publication : le redéposer dans le Drive.',
  [MOTIFS_MEDIA.TYPE_NON_ADMIS]:
    `Seuls ${TYPES_ADMIS.join(', ')} sont acceptés. Convertir le fichier AVANT de le déposer — `
    + 'rien n\'est converti ici, une affiche modifiée après coup n\'est plus celle qui a été approuvée.',
  [MOTIFS_MEDIA.TROP_LOURD]:
    'Alléger l\'image ou la vidéo avant de la déposer : le stockage refuse au-delà de 15 Mo.',
  [MOTIFS_MEDIA.EMPREINTE_ABSENTE]:
    'Google ne donne pas d\'empreinte pour ce fichier : ce n\'est probablement pas une vraie image '
    + '(raccourci ou document Google). Déposer le fichier lui-même.',
  [MOTIFS_MEDIA.DRIVE_INJOIGNABLE]:
    'Google n\'a pas rendu le fichier. La ligne reste en file : le prochain passage réessaiera.',
  [MOTIFS_MEDIA.STOCKAGE_INJOIGNABLE]:
    'Le stockage des médias n\'a pas répondu. La ligne reste en file : le prochain passage réessaiera.',
});

/**
 * Assainit un nom de fichier pour en faire une clé d'objet.
 *
 * Les noms déposés portent des accents et parfois des espaces
 * (`Affiche_Rentrée 2026.jpg`). Une clé d'objet qui voyage dans une URL doit
 * être prévisible : on garde les lettres non accentuées, les chiffres, le
 * point, le tiret et le souligné ; tout le reste devient un tiret.
 *
 * ⚠️ Le nom n'entre PAS dans la décision d'idempotence — c'est le md5 qui la
 * porte. Il est là pour qu'un humain reconnaisse l'objet dans le bucket.
 *
 * @param {string} nom
 * @returns {string}
 */
export function nomSur(nom) {
  const brut = String(nom ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const propre = brut.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return (propre || 'media').slice(0, 120);
}

/**
 * Le chemin de l'objet dans le bucket. Voir l'en-tête pour le pourquoi.
 *
 * @param {object} arg
 * @param {string} arg.publicationId
 * @param {number|string} arg.version
 * @param {string} arg.empreinte  le `md5Checksum` rendu par Google
 * @param {string} arg.nom        `chemin_relatif` du média
 * @returns {string}
 */
export function cheminObjet({ publicationId, version, empreinte, nom }) {
  return [
    nomSur(publicationId),
    `v${String(version ?? '')}`,
    `${nomSur(empreinte)}-${nomSur(nom)}`,
  ].join('/');
}

/**
 * Choisit LE média d'un canal.
 *
 * L'exécuteur publie une photo par ligne (`publierPhotoFacebook`,
 * `publierPhotoInstagram`) : il faut donc en désigner exactement un. L'ordre
 * est celui du manifeste — `role: "principal"` d'abord, puis
 * `ordre_carrousel` — et non « le premier de la liste », qui dépendrait de
 * l'ordre de sérialisation de ChatGPT.
 *
 * Un média sans `canal_cible` est éligible à tous les canaux : le contrat ne
 * rend pas ce champ obligatoire, et le lire comme « aucun canal » écarterait
 * des dépôts valides.
 *
 * @param {object} pub    le manifeste
 * @param {string} canal  'facebook' | 'instagram' | …
 * @returns {object|null}
 */
export function choisirMedia(pub, canal) {
  const candidats = (pub?.medias || []).filter((m) => {
    if (!m || typeof m !== 'object') return false;
    if (!Array.isArray(m.canal_cible) || m.canal_cible.length === 0) return true;
    return m.canal_cible.includes(canal);
  });
  if (candidats.length === 0) return null;
  const ordonnes = [...candidats].sort((a, b) => {
    const ra = a.role === 'principal' ? 0 : 1;
    const rb = b.role === 'principal' ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return (a.ordre_carrousel ?? 0) - (b.ordre_carrousel ?? 0);
  });
  return ordonnes[0];
}

/** Résultat d'échec, de forme constante. Jamais une exception. */
function echec(motif, detail, extra = {}) {
  return {
    url: null,
    chemin: extra.chemin ?? null,
    deja_present: false,
    televerse: false,
    motif,
    detail,
    piste: PISTES[motif] ?? null,
  };
}

/**
 * ⛔ L'HÉBERGEUR. Rend les octets d'un média joignables par Meta.
 *
 * @param {object} arg
 * @param {object} arg.stockage  port décrit par `stockageSupabase()`
 * @param {object} arg.client    client Drive (`telechargerOctets`)
 * @param {Function} [arg.tracer]
 * @returns {{heberger: Function}}
 */
export function creerHebergeurMedias({ stockage, client, tracer = () => {} }) {
  /**
   * Héberge le média d'un canal.
   *
   * ⛔ NE LÈVE JAMAIS : toute panne devient un motif. Une image non recopiée ne
   *    doit pas empêcher la ligne d'entrer en file.
   *
   * @param {object} arg
   * @param {object} arg.depose  la publication telle que `drive.js` la rend
   * @param {string} arg.canal
   * @returns {Promise<object>} `{url, chemin, deja_present, televerse, motif, detail, piste}`
   */
  async function heberger({ depose, canal }) {
    const pub = depose?.publication;
    const declare = choisirMedia(pub, canal);
    if (!declare) {
      return echec(MOTIFS_MEDIA.AUCUN_MEDIA,
        `aucun média de publication.json ne cible le canal « ${canal} »`);
    }

    // Le média RÉSOLU : c'est `drive.js` qui a joint le fichier réel au nom
    // annoncé. Sans lui, on n'a qu'un nom, et un nom ne se télécharge pas.
    const resolu = (depose?.medias || []).find((m) => m?.chemin_relatif === declare.chemin_relatif);
    if (!resolu?.fichier_id) {
      return echec(MOTIFS_MEDIA.MEDIA_INTROUVABLE,
        `le média « ${declare.chemin_relatif} » n'a pas été retrouvé dans le dossier de la publication`);
    }

    /* ── Le type : celui DU FICHIER, pas celui que le manifeste annonce ──── */
    const type = resolu.mime_type || declare.mime_type || null;
    if (!TYPES_ADMIS.includes(type)) {
      return echec(MOTIFS_MEDIA.TYPE_NON_ADMIS,
        `« ${declare.chemin_relatif} » est de type ${type || 'inconnu'} : le stockage n'accepte `
        + `que ${TYPES_ADMIS.join(', ')}`);
    }

    /* ── Le poids, AVANT de télécharger quoi que ce soit ─────────────────── */
    if (typeof resolu.taille === 'number' && resolu.taille > TAILLE_MAX_OCTETS) {
      return echec(MOTIFS_MEDIA.TROP_LOURD,
        `« ${declare.chemin_relatif} » pèse ${resolu.taille} octets ; le stockage refuse `
        + `au-delà de ${TAILLE_MAX_OCTETS}`);
    }

    /* ── L'empreinte, sans laquelle l'idempotence n'est pas décidable ────── */
    if (!resolu.md5) {
      return echec(MOTIFS_MEDIA.EMPREINTE_ABSENTE,
        `Google ne rend aucune empreinte md5 pour « ${declare.chemin_relatif} » : impossible de `
        + 'décider si l\'objet hébergé correspond encore à ce fichier');
    }

    const chemin = cheminObjet({
      publicationId: pub.publication_id,
      version: pub.version_contenu,
      empreinte: resolu.md5,
      nom: declare.chemin_relatif,
    });

    /* ── 1. L'OBJET EST-IL DÉJÀ LÀ ? ─────────────────────────────────────
       La question se pose au bucket, pas à une colonne « déjà téléversé » :
       le témoin de l'effet, c'est l'objet. */
    let present;
    try {
      present = await stockage.existe(chemin);
    } catch (err) {
      return echec(MOTIFS_MEDIA.STOCKAGE_INJOIGNABLE,
        `le stockage n'a pas répondu : ${err?.message || err}`, { chemin });
    }
    if (present) {
      tracer('[autopost] média déjà hébergé : %s', chemin);
      return {
        url: stockage.urlPublique(chemin),
        chemin,
        deja_present: true,
        televerse: false,
        motif: null,
        detail: null,
        piste: null,
      };
    }

    /* ── 2. LES OCTETS, PRIS DANS LE DRIVE (lecture seule) ───────────────── */
    let octets;
    try {
      octets = await client.telechargerOctets(resolu.fichier_id);
    } catch (err) {
      return echec(MOTIFS_MEDIA.DRIVE_INJOIGNABLE,
        `« ${declare.chemin_relatif} » n'a pas pu être téléchargé : ${err?.message || err}`,
        { chemin });
    }
    if (!octets || octets.length === 0) {
      return echec(MOTIFS_MEDIA.DRIVE_INJOIGNABLE,
        `« ${declare.chemin_relatif} » est revenu vide du Drive`, { chemin });
    }
    // Le poids MESURÉ, et non plus annoncé : `size` peut manquer, et un fichier
    // trop lourd téléversé quand même serait refusé par le bucket avec un
    // message bien moins clair que celui-ci.
    if (octets.length > TAILLE_MAX_OCTETS) {
      return echec(MOTIFS_MEDIA.TROP_LOURD,
        `« ${declare.chemin_relatif} » pèse ${octets.length} octets une fois téléchargé ; le `
        + `stockage refuse au-delà de ${TAILLE_MAX_OCTETS}`, { chemin });
    }

    /* ── 3. LE DÉPÔT ────────────────────────────────────────────────────── */
    let issue;
    try {
      issue = await stockage.televerser(chemin, octets, { contentType: type });
    } catch (err) {
      return echec(MOTIFS_MEDIA.STOCKAGE_INJOIGNABLE,
        `le téléversement a échoué : ${err?.message || err}`, { chemin });
    }
    if (issue?.deja) {
      // Un autre passage a déposé le même objet entre notre question et notre
      // écriture. C'est le filet qui joue son rôle, pas une panne — et comme le
      // chemin porte le md5, l'objet déjà là a EXACTEMENT le même contenu.
      tracer('[autopost] média déposé entre-temps par un autre passage : %s', chemin);
      return {
        url: stockage.urlPublique(chemin),
        chemin,
        deja_present: true,
        televerse: false,
        motif: null,
        detail: null,
        piste: null,
      };
    }
    if (!issue?.ok) {
      return echec(MOTIFS_MEDIA.STOCKAGE_INJOIGNABLE,
        `le téléversement a été refusé : ${issue?.erreur || 'raison inconnue'}`, { chemin });
    }

    tracer('[autopost] média hébergé : %s (%d octets)', chemin, octets.length);
    return {
      url: stockage.urlPublique(chemin),
      chemin,
      deja_present: false,
      televerse: true,
      motif: null,
      detail: null,
      piste: null,
    };
  }

  return { heberger };
}

/**
 * Traduit un résultat d'hébergement en `derniere_erreur` de ligne — la forme
 * que l'écran sait déjà afficher (`message_erreur`, `piste`, `a_utc`).
 *
 * Rend `null` quand tout s'est bien passé : c'est l'appelant qui décide s'il
 * efface l'erreur précédente ou s'il la laisse (voir `autopost-alimentation.js`,
 * qui n'efface QUE ses propres motifs).
 *
 * @param {object} resultat
 * @param {string} [instantUtc]
 * @returns {object|null}
 */
export function erreurDeMedia(resultat, instantUtc = formaterInstantUtc(new Date())) {
  if (!resultat?.motif) return null;
  return {
    code_erreur: resultat.motif,
    message_erreur: resultat.detail,
    piste: resultat.piste ?? null,
    a_utc: instantUtc,
  };
}

/** Tous les codes que ce module peut écrire dans `derniere_erreur`. */
export const CODES_MEDIA = Object.freeze(Object.values(MOTIFS_MEDIA));

/* ═══════════════════════════════════════════════════════════════════════════
   LE PORT SUPABASE STORAGE
   ═══════════════════════════════════════════════════════════════════════════

   Il est ici, et pas dans le module de logique, pour la même raison que le
   dépôt de la file est séparé de l'alimentation : un test qui devrait parler à
   Supabase pour vérifier « ne pas retéléverser » ne serait pas un test, ce
   serait un essai. */

/**
 * Le port réel. Le client passé doit être celui du rôle de service
 * (`supabaseAdmin()`) : le bucket est public EN LECTURE, fermé en écriture.
 *
 * @param {object} supabase
 * @param {string} [bucket]
 * @returns {object}
 */
export function stockageSupabase(supabase, bucket = BUCKET) {
  const espace = () => supabase.storage.from(bucket);

  return {
    /**
     * L'objet est-il là ?
     *
     * `list()` rend les entrées d'un DOSSIER ; `search` y filtre par préfixe de
     * nom. On compare ensuite le nom EXACT : un `search` est une recherche, pas
     * une réponse par oui ou par non, et se contenter de « la liste n'est pas
     * vide » dirait « présent » pour un homonyme partiel.
     */
    async existe(chemin) {
      const separateur = chemin.lastIndexOf('/');
      const dossier = separateur === -1 ? '' : chemin.slice(0, separateur);
      const nom = separateur === -1 ? chemin : chemin.slice(separateur + 1);
      const { data, error } = await espace().list(dossier, { search: nom, limit: 100 });
      if (error) throw new Error(error.message);
      return (data || []).some((e) => e?.name === nom);
    },

    /**
     * Dépose l'objet. `upsert: false` est délibéré : si l'objet est là, on veut
     * un REFUS, pas un écrasement silencieux. Le refus se lit « quelqu'un
     * d'autre l'a déposé », et comme le chemin porte l'empreinte du contenu,
     * ce qui est déjà là est identique à ce qu'on allait écrire.
     */
    async televerser(chemin, octets, { contentType } = {}) {
      const { error } = await espace().upload(chemin, octets, {
        contentType: contentType || 'application/octet-stream',
        upsert: false,
      });
      if (!error) return { ok: true, deja: false };
      const message = String(error.message || '');
      const statut = String(error.statusCode || error.status || '');
      const duplicata = statut === '409'
        || /already exists|duplicate|resource already/i.test(message);
      if (duplicata) return { ok: true, deja: true };
      return { ok: false, deja: false, erreur: message || 'téléversement refusé' };
    },

    /** L'adresse publique. Aucun appel réseau : c'est une construction d'URL. */
    urlPublique(chemin) {
      const { data } = espace().getPublicUrl(chemin);
      return data?.publicUrl ?? null;
    },
  };
}
