/**
 * LE FAUX GOOGLE — un serveur Drive en mémoire, partagé par tous les bancs.
 *
 * ⛔ ZÉRO APPEL RÉSEAU. Il route par URL comme le vrai (jeton, recherche par
 *    nom, index des dossiers, index des fichiers, listing, `alt=media`,
 *    `files.get`) et ENREGISTRE tout ce qui sort : c'est ce registre qui rend
 *    le coût MESURABLE au lieu d'être estimé.
 *
 * ⚠️ Il vit ici, dans `tests/outils/`, et non recopié dans chaque fichier de
 *    test. Deux copies d'un faux serveur, ce sont deux serveurs différents :
 *    le jour où l'un devient plus tolérant que l'autre, un test passe pendant
 *    que la production casse. (Même raison que `tests/outils/detecteur-dates.mjs`.)
 *
 * Il a été extrait de `tests/drive-lecture.test.mjs` le 19/09/2026, quand le
 * banc de coût du passage a eu besoin exactement du même Google.
 */
import { URL_JETON } from '../../api/_lib/drive.js';

export function fauxGoogle({ jeton = null, listes = {}, fichiers = {}, recherche = null, dossiers = null, plats = null, metas = null, expireIn = 3600 } = {}) {
  const appels = [];
  const impl = async (url, options = {}) => {
    const u = String(url);
    const methode = options.method || 'GET';
    appels.push({ url: u, methode, entetes: options.headers || {}, corps: options.body ?? null });

    /* ── L'échange du JWT contre un jeton d'accès ────────────────────────── */
    if (u.startsWith(URL_JETON)) {
      if (jeton && jeton.echec) {
        return {
          ok: false,
          status: jeton.statut ?? 400,
          async text() { return JSON.stringify(jeton.echec); },
          async json() { return jeton.echec; },
        };
      }
      return {
        ok: true,
        status: 200,
        async text() { return JSON.stringify({ access_token: jeton?.valeur ?? 'ya29.JETON', expires_in: expireIn, token_type: 'Bearer' }); },
        async json() { return { access_token: jeton?.valeur ?? 'ya29.JETON', expires_in: expireIn, token_type: 'Bearer' }; },
      };
    }

    /* ── Le téléchargement d'un fichier (alt=media) ──────────────────────── */
    const dl = u.match(/\/drive\/v3\/files\/([^/?]+)\?.*alt=media/);
    if (dl) {
      const contenu = fichiers[dl[1]];
      if (contenu === undefined) {
        return { ok: false, status: 404, async text() { return JSON.stringify({ error: { code: 404, message: 'File not found' } }); } };
      }
      // Un vrai `alt=media` rend des OCTETS. Le faux les rend aussi : une
      // image passée par `text()` revient corrompue, et c'est exactement ce
      // que `telechargerOctets` existe pour éviter.
      const octets = typeof contenu === 'string' ? Buffer.from(contenu, 'utf8') : Buffer.from(contenu);
      return {
        ok: true,
        status: 200,
        async text() { return typeof contenu === 'string' ? contenu : octets.toString('utf8'); },
        async arrayBuffer() { return octets; },
      };
    }

    /* ── Les métadonnées d'UN fichier (nom, parents) ─────────────────────
       Le repli du repli : quand l'index des dossiers n'est pas disponible, le
       chemin se reconstruit en remontant la filiation un dossier à la fois.
       Absent de la table ⇒ 404, ce qui doit dégrader le CHEMIN sans jamais
       faire perdre la publication. */
    const fiche = u.match(/\/drive\/v3\/files\/([^/?]+)\?/);
    if (fiche && !u.includes('alt=media')) {
      const meta = metas && metas[fiche[1]];
      if (!meta) {
        return { ok: false, status: 404, async text() { return JSON.stringify({ error: { code: 404, message: 'File not found' } }); } };
      }
      return {
        ok: true,
        status: 200,
        async text() { return JSON.stringify({ id: fiche[1], name: meta.name, parents: meta.parents || [] }); },
      };
    }

    /* ── La RECHERCHE PAR NOM ────────────────────────────────────────────
       `name = 'publication.json'`, sans `in parents`. Le vrai Google la sert
       sur tout ce que le robot peut voir ; le faux la sert depuis `recherche`. */
    const qBrut = decodeURIComponent(((u.match(/[?&]q=([^&]*)/) || [])[1] || '').replace(/\+/g, ' '));
    const parNom = qBrut.match(/^name = '([^']+)' and trashed = false$/);
    if (parNom) {
      if (recherche && recherche.statut) {
        return { ok: false, status: recherche.statut, async text() { return JSON.stringify(recherche.corps ?? {}); } };
      }
      const trouves = (recherche && recherche[parNom[1]]) || [];
      return { ok: true, status: 200, async text() { return JSON.stringify({ files: trouves }); } };
    }

    /* ── L'INDEX DES DOSSIERS ────────────────────────────────────────────
       `mimeType = '…folder'`, sans `in parents`. UNE requête qui rend le nom et
       la filiation de tout ce que le robot peut voir : c'est ce qui permet de
       reconstruire un chemin LISIBLE sans remonter la filiation dossier par
       dossier. Absent de la table ⇒ index vide, ce qui est aussi un cas à
       tester : la lecture doit continuer sans lui. */
    const parType = qBrut.match(/^mimeType = '([^']+)' and trashed = false$/);
    if (parType) {
      if (dossiers && dossiers.statut) {
        return { ok: false, status: dossiers.statut, async text() { return JSON.stringify(dossiers.corps ?? {}); } };
      }
      const liste = Array.isArray(dossiers) ? dossiers : [];
      return { ok: true, status: 200, async text() { return JSON.stringify({ files: liste }); } };
    }

    /* ── L'INDEX DES FICHIERS — la question symétrique ────────────────────
       `mimeType != '…folder'`. Elle dit, en UNE requête, ce que portent les
       dossiers qui n'ont pas de manifeste : sans elle il faudrait les lister
       un par un, et le coût se remettrait à suivre le calendrier. */
    const parTypeExclu = qBrut.match(/^mimeType != '([^']+)' and trashed = false$/);
    if (parTypeExclu) {
      if (plats && plats.statut) {
        return { ok: false, status: plats.statut, async text() { return JSON.stringify(plats.corps ?? {}); } };
      }
      const liste = Array.isArray(plats) ? plats : [];
      return { ok: true, status: 200, async text() { return JSON.stringify({ files: liste }); } };
    }

    /* ── Le listing d'un dossier ─────────────────────────────────────────── */
    // `+` vaut espace dans une chaîne de requête : c'est ce que fait un vrai
    // serveur, et ce que `URLSearchParams` produit. Décoder sans le faire
    // donnerait un faux Google plus tolérant que le vrai.
    const q = decodeURIComponent(((u.match(/[?&]q=([^&]*)/) || [])[1] || '').replace(/\+/g, ' '));
    const parent = (q.match(/'([^']+)' in parents/) || [])[1];
    const reponse = listes[parent];
    if (reponse === undefined) {
      return { ok: false, status: 404, async text() { return JSON.stringify({ error: { code: 404, message: 'File not found: ' + parent } }); } };
    }
    if (reponse && reponse.statut) {
      return { ok: false, status: reponse.statut, async text() { return JSON.stringify(reponse.corps ?? {}); } };
    }
    const page = (u.match(/[?&]pageToken=([^&]*)/) || [])[1] || null;
    const pages = Array.isArray(reponse) ? [{ files: reponse }] : reponse.pages;
    const index = page ? Number(page) : 0;
    const courante = pages[index] || { files: [] };
    const charge = { files: courante.files };
    if (index + 1 < pages.length) charge.nextPageToken = String(index + 1);
    return { ok: true, status: 200, async text() { return JSON.stringify(charge); } };
  };
  return { impl, appels };
}

export const DOSSIER_MIME = 'application/vnd.google-apps.folder';
/** Un fichier, tel que le listing le rend. */
export const f = (id, name, mimeType = 'image/jpeg', extra = {}) => ({ id, name, mimeType, ...extra });
/** Un dossier. */
export const d = (id, name) => ({ id, name, mimeType: DOSSIER_MIME });

export /** Compte les requêtes Google par famille — c'est le coût, mesuré, pas estimé. */
function compter(appels) {
  const lisible = (a) => decodeURIComponent(a.url.replace(/\+/g, ' '));
  return {
    jetons: appels.filter((a) => a.url.startsWith(URL_JETON)).length,
    recherches: appels.filter((a) => /[?&]q=name = /.test(lisible(a))).length,
    index: appels.filter((a) => /[?&]q=mimeType = /.test(lisible(a))).length,
    indexFichiers: appels.filter((a) => /[?&]q=mimeType != /.test(lisible(a))).length,
    listings: appels.filter((a) => / in parents/.test(lisible(a))).length,
    fiches: appels.filter((a) => /\/files\/[^/?]+\?/.test(a.url) && !a.url.includes('alt=media')).length,
    telechargements: appels.filter((a) => a.url.includes('alt=media')).length,
    total: appels.length,
  };
}
