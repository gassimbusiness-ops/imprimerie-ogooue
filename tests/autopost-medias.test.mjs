/**
 * L'HÉBERGEMENT DES MÉDIAS — le dernier maillon avant une vraie publication.
 *
 * ── Ce que ces tests protègent, et pourquoi chacun compte ─────────────────
 *
 *   1. L'OBJET DÉJÀ LÀ N'EST PAS RETÉLÉVERSÉ. Le passage tourne deux fois par
 *      jour et se relance à la main : c'est la propriété la plus sollicitée du
 *      module. Et elle se fonde sur le TÉMOIN DE L'EFFET — l'objet dans le
 *      bucket — jamais sur un drapeau « déjà fait » (leçon SingPay du 16/09).
 *   2. LE CHEMIN CHANGE QUAND LE CONTENU CHANGE, ET PAS AUTREMENT. Sans ça,
 *      une affiche corrigée serait publiée avec l'image d'avant la correction.
 *   3. TROP LOURD ou TYPE HORS LISTE : écarté AVANT de télécharger, avec le
 *      chiffre et le type exacts. Rien n'est converti, rien n'est recompressé :
 *      une affiche modifiée après coup n'est plus celle qui a été approuvée.
 *   4. GOOGLE OU LE STOCKAGE EN PANNE : un motif, jamais une exception. Perdre
 *      le dépôt entier parce qu'une image n'a pas pu être recopiée serait une
 *      punition sans rapport avec la faute.
 *   5. AUCUN LIEN DRIVE ne peut sortir d'ici : ce qui sort est une adresse de
 *      NOTRE stockage, ou rien.
 *
 * ⛔ ZÉRO RÉSEAU : le client Drive et le stockage sont des doublures en
 *    mémoire. Aucun test de ce fichier ne peut écrire chez Google ni chez
 *    Supabase.
 *
 * Lancer :  node --test tests/autopost-medias.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  creerHebergeurMedias,
  stockageSupabase,
  cheminObjet,
  choisirMedia,
  nomSur,
  erreurDeMedia,
  MOTIFS_MEDIA,
  TYPES_ADMIS,
  TAILLE_MAX_OCTETS,
  BUCKET,
} from '../api/_lib/autopost-medias.js';

const MD5 = 'd41d8cd98f00b204e9800998ecf8427e';
const NOM = '2026-09-21_OGOOUE_Textile_1080x1350_v01_BROUILLON.jpg';

/** Une publication telle que `drive.js` la rend, réduite à ce qui compte ici. */
function depose({
  id = 'PUB-2026-S39-1-01',
  version = 1,
  md5 = MD5,
  taille = 240_000,
  mime = 'image/jpeg',
  nom = NOM,
  canalCible = ['facebook', 'instagram'],
  resoluPresent = true,
} = {}) {
  return {
    publication: {
      publication_id: id,
      version_contenu: version,
      medias: [{
        role: 'principal',
        canal_cible: canalCible,
        chemin_relatif: nom,
        mime_type: mime,
        ordre_carrousel: 1,
        origine: 'chatgpt',
      }],
    },
    medias: resoluPresent
      ? [{ chemin_relatif: nom, fichier_id: 'f-media', mime_type: mime, taille, md5 }]
      : [],
  };
}

/** Client Drive de test. Compte les téléchargements — c'est ce qu'on surveille. */
function clientFactice({ octets = new Uint8Array([1, 2, 3, 4]), jete = null } = {}) {
  const appels = [];
  return {
    appels,
    async telechargerOctets(id) {
      appels.push(id);
      if (jete) throw jete;
      return octets;
    },
  };
}

/**
 * Stockage en mémoire. Il reproduit les deux comportements réels du bucket :
 * `existe()` répond sur le nom EXACT, et `televerser()` refuse un doublon au
 * lieu de l'écraser.
 */
function stockageFactice({ objets = [], jeteSurExiste = null, jeteSurDepot = null, refus = null } = {}) {
  const contenu = new Map(objets.map((c) => [c, true]));
  const appels = [];
  return {
    contenu,
    appels,
    async existe(chemin) {
      appels.push(`existe:${chemin}`);
      if (jeteSurExiste) throw jeteSurExiste;
      return contenu.has(chemin);
    },
    async televerser(chemin, octets, options) {
      appels.push(`televerser:${chemin}:${octets.length}:${options?.contentType}`);
      if (jeteSurDepot) throw jeteSurDepot;
      if (refus) return { ok: false, deja: false, erreur: refus };
      if (contenu.has(chemin)) return { ok: true, deja: true };
      contenu.set(chemin, true);
      return { ok: true, deja: false };
    },
    urlPublique(chemin) {
      return `https://exemple.supabase.co/storage/v1/object/public/${BUCKET}/${chemin}`;
    },
  };
}

const hebergeur = (stockage, client) => creerHebergeurMedias({ stockage, client });

/* ═══════════════════════════════════════════════════════════════════════════
   1. LE CAS NOMINAL
   ═══════════════════════════════════════════════════════════════════════════ */

test('un média conforme est déposé dans le bucket et rend une adresse publique', async () => {
  const stockage = stockageFactice();
  const client = clientFactice();

  const r = await hebergeur(stockage, client).heberger({ depose: depose(), canal: 'facebook' });

  assert.equal(r.motif, null, `attendu un succès : ${r.detail}`);
  assert.equal(r.televerse, true);
  assert.equal(r.deja_present, false);
  assert.equal(r.chemin, `PUB-2026-S39-1-01/v1/${MD5}-${NOM}`);
  assert.match(r.url, new RegExp(`/object/public/${BUCKET}/PUB-2026-S39-1-01/v1/`));
  assert.equal(client.appels.length, 1, 'un seul téléchargement');
  assert.equal(stockage.contenu.has(r.chemin), true);
});

test('le type déclaré au stockage est celui du fichier, pas une supposition', async () => {
  const stockage = stockageFactice();
  const r = await hebergeur(stockage, clientFactice()).heberger({
    depose: depose(), canal: 'facebook',
  });
  assert.equal(r.motif, null);
  assert.equal(stockage.appels.some((a) => a.endsWith(':image/jpeg')), true,
    `contentType attendu image/jpeg : ${stockage.appels.join(' · ')}`);
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. 🔴 L'IDEMPOTENCE — le témoin de l'effet, jamais un drapeau
   ═══════════════════════════════════════════════════════════════════════════ */

test('🔴 l objet DÉJÀ PRÉSENT n est pas retéléversé — et n est même pas retéléchargé', async () => {
  const chemin = `PUB-2026-S39-1-01/v1/${MD5}-${NOM}`;
  const stockage = stockageFactice({ objets: [chemin] });
  const client = clientFactice();

  const r = await hebergeur(stockage, client).heberger({ depose: depose(), canal: 'facebook' });

  assert.equal(r.motif, null);
  assert.equal(r.deja_present, true);
  assert.equal(r.televerse, false, 'aucun second téléversement');
  assert.equal(r.url.endsWith(chemin), true);
  assert.equal(client.appels.length, 0,
    'l objet étant déjà là, on ne redemande même pas les octets à Google');
  assert.equal(stockage.appels.filter((a) => a.startsWith('televerser')).length, 0);
});

test('🔴 deux passages de suite : un seul téléversement, la même adresse', async () => {
  const stockage = stockageFactice();
  const client = clientFactice();
  const h = hebergeur(stockage, client);

  const un = await h.heberger({ depose: depose(), canal: 'facebook' });
  const deux = await h.heberger({ depose: depose(), canal: 'facebook' });

  assert.equal(un.url, deux.url, 'la même publication rend la même adresse');
  assert.equal(un.televerse, true);
  assert.equal(deux.televerse, false, 'le second passage ne retéléverse pas');
  assert.equal(client.appels.length, 1, 'un seul téléchargement pour deux passages');
  assert.equal(stockage.contenu.size, 1);
});

test('🔴 le chemin CHANGE quand le contenu change (empreinte différente)', async () => {
  // C'est ce qui interdit de se contenter de publication_id + version : ChatGPT
  // peut corriger l'affiche sans changer version_contenu, et on publierait
  // l'image d'avant la correction.
  const stockage = stockageFactice();
  const h = hebergeur(stockage, clientFactice());

  const avant = await h.heberger({ depose: depose({ md5: 'a'.repeat(32) }), canal: 'facebook' });
  const apres = await h.heberger({ depose: depose({ md5: 'b'.repeat(32) }), canal: 'facebook' });

  assert.notEqual(avant.chemin, apres.chemin);
  assert.notEqual(avant.url, apres.url);
  assert.equal(stockage.contenu.size, 2, 'deux contenus, deux objets');
});

test('🔴 le chemin NE CHANGE PAS quand rien ne change', () => {
  const a = cheminObjet({ publicationId: 'PUB-2026-S39-1-01', version: 1, empreinte: MD5, nom: NOM });
  const b = cheminObjet({ publicationId: 'PUB-2026-S39-1-01', version: 1, empreinte: MD5, nom: NOM });
  assert.equal(a, b);
});

test('une version de contenu différente range l objet ailleurs', () => {
  const v1 = cheminObjet({ publicationId: 'P', version: 1, empreinte: MD5, nom: NOM });
  const v2 = cheminObjet({ publicationId: 'P', version: 2, empreinte: MD5, nom: NOM });
  assert.notEqual(v1, v2);
});

test('un dépôt simultané (objet apparu entre la question et l écriture) n est pas une panne', async () => {
  const chemin = `PUB-2026-S39-1-01/v1/${MD5}-${NOM}`;
  const stockage = stockageFactice();
  // `existe` dit non, puis le dépôt échoue en doublon : c'est la course réelle
  // entre deux passages, et le filet doit la lire comme un succès.
  stockage.televerser = async () => ({ ok: true, deja: true });

  const r = await hebergeur(stockage, clientFactice()).heberger({
    depose: depose(), canal: 'facebook',
  });

  assert.equal(r.motif, null);
  assert.equal(r.deja_present, true);
  assert.equal(r.televerse, false);
  assert.equal(r.url.endsWith(chemin), true);
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. LES LIMITES DU BUCKET — écarter avec le motif exact, jamais réparer
   ═══════════════════════════════════════════════════════════════════════════ */

test('⛔ un média TROP LOURD est écarté AVANT tout téléchargement, avec le chiffre exact', async () => {
  const stockage = stockageFactice();
  const client = clientFactice();

  const r = await hebergeur(stockage, client).heberger({
    depose: depose({ taille: TAILLE_MAX_OCTETS + 1 }), canal: 'facebook',
  });

  assert.equal(r.motif, MOTIFS_MEDIA.TROP_LOURD);
  assert.equal(r.url, null);
  assert.match(r.detail, new RegExp(String(TAILLE_MAX_OCTETS + 1)));
  assert.match(r.detail, new RegExp(String(TAILLE_MAX_OCTETS)));
  assert.equal(client.appels.length, 0, 'on ne télécharge pas 15 Mo pour les jeter');
  assert.equal(stockage.contenu.size, 0);
  assert.notEqual(r.piste, null, 'un motif sans piste ne dit pas quoi faire');
});

test('⛔ un média trop lourd DÉCOUVERT au téléchargement est écarté aussi', async () => {
  // `size` peut manquer dans la réponse de Google : le poids mesuré tranche.
  const stockage = stockageFactice();
  const client = clientFactice({ octets: new Uint8Array(TAILLE_MAX_OCTETS + 10) });

  const r = await hebergeur(stockage, client).heberger({
    depose: depose({ taille: null }), canal: 'facebook',
  });

  assert.equal(r.motif, MOTIFS_MEDIA.TROP_LOURD);
  assert.equal(stockage.contenu.size, 0, 'rien n est déposé');
});

test('⛔ un TYPE hors liste est écarté avec le type reçu et la liste admise', async () => {
  const stockage = stockageFactice();
  const client = clientFactice();

  const r = await hebergeur(stockage, client).heberger({
    depose: depose({ mime: 'image/gif' }), canal: 'facebook',
  });

  assert.equal(r.motif, MOTIFS_MEDIA.TYPE_NON_ADMIS);
  assert.match(r.detail, /image\/gif/);
  TYPES_ADMIS.forEach((t) => assert.match(r.detail, new RegExp(t.replace('/', '\\/'))));
  assert.equal(client.appels.length, 0);
  assert.equal(stockage.contenu.size, 0);
});

test('⛔ RIEN N EST CONVERTI : un PNG reste un PNG, il n est pas transformé en JPEG', async () => {
  // Le PNG est admis par le bucket ; c'est le contrat (`validerManifeste`) qui
  // le refuse pour Instagram, en amont. Ici on vérifie seulement qu'aucune
  // conversion ne se produit : une affiche modifiée après coup n'est plus celle
  // qui a été approuvée.
  const stockage = stockageFactice();
  const r = await hebergeur(stockage, clientFactice()).heberger({
    depose: depose({ mime: 'image/png', nom: 'affiche.png' }), canal: 'facebook',
  });
  assert.equal(r.motif, null);
  assert.equal(stockage.appels.some((a) => a.endsWith(':image/png')), true);
  assert.match(r.chemin, /affiche\.png$/);
});

test('⛔ un média SANS empreinte md5 est écarté : l idempotence ne serait plus décidable', async () => {
  const stockage = stockageFactice();
  const client = clientFactice();

  const r = await hebergeur(stockage, client).heberger({
    depose: depose({ md5: null }), canal: 'facebook',
  });

  assert.equal(r.motif, MOTIFS_MEDIA.EMPREINTE_ABSENTE);
  assert.equal(client.appels.length, 0);
  assert.equal(stockage.contenu.size, 0);
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. LES PANNES — un motif, jamais une exception
   ═══════════════════════════════════════════════════════════════════════════ */

test('⛔ GOOGLE EN PANNE : un motif lisible, aucune exception, aucun dépôt', async () => {
  const stockage = stockageFactice();
  const client = clientFactice({ jete: new Error('HTTP 503 : backend error') });

  const r = await hebergeur(stockage, client).heberger({ depose: depose(), canal: 'facebook' });

  assert.equal(r.motif, MOTIFS_MEDIA.DRIVE_INJOIGNABLE);
  assert.equal(r.url, null);
  assert.match(r.detail, /503/);
  assert.match(r.piste, /prochain passage/);
  assert.equal(stockage.contenu.size, 0);
});

test('⛔ LE STOCKAGE EN PANNE À LA QUESTION : un motif, et on ne téléverse rien à l aveugle', async () => {
  const stockage = stockageFactice({ jeteSurExiste: new Error('storage unreachable') });
  const client = clientFactice();

  const r = await hebergeur(stockage, client).heberger({ depose: depose(), canal: 'facebook' });

  assert.equal(r.motif, MOTIFS_MEDIA.STOCKAGE_INJOIGNABLE);
  assert.match(r.detail, /storage unreachable/);
  assert.equal(client.appels.length, 0,
    'ne pas savoir si l objet est là interdit de le redéposer : on s arrête avant');
});

test('⛔ LE STOCKAGE EN PANNE AU DÉPÔT : un motif, aucune adresse rendue', async () => {
  const stockage = stockageFactice({ jeteSurDepot: new Error('connexion perdue') });

  const r = await hebergeur(stockage, clientFactice()).heberger({
    depose: depose(), canal: 'facebook',
  });

  assert.equal(r.motif, MOTIFS_MEDIA.STOCKAGE_INJOIGNABLE);
  assert.equal(r.url, null, '⛔ jamais d adresse pour un objet qui n a pas été déposé');
});

test('⛔ un dépôt REFUSÉ par le bucket ne rend pas d adresse', async () => {
  const stockage = stockageFactice({ refus: 'mime type image/gif is not supported' });

  const r = await hebergeur(stockage, clientFactice()).heberger({
    depose: depose(), canal: 'facebook',
  });

  assert.equal(r.motif, MOTIFS_MEDIA.STOCKAGE_INJOIGNABLE);
  assert.equal(r.url, null);
  assert.match(r.detail, /not supported/);
});

test('⛔ un fichier revenu VIDE du Drive n est pas déposé', async () => {
  const stockage = stockageFactice();
  const r = await hebergeur(stockage, clientFactice({ octets: new Uint8Array(0) })).heberger({
    depose: depose(), canal: 'facebook',
  });
  assert.equal(r.motif, MOTIFS_MEDIA.DRIVE_INJOIGNABLE);
  assert.equal(stockage.contenu.size, 0);
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. LE CHOIX DU MÉDIA ET LES CAS SANS MÉDIA
   ═══════════════════════════════════════════════════════════════════════════ */

test('aucun média ne ciblant le canal : motif, pas exception', async () => {
  const stockage = stockageFactice();
  const r = await hebergeur(stockage, clientFactice()).heberger({
    depose: depose({ canalCible: ['instagram'] }), canal: 'facebook',
  });
  assert.equal(r.motif, MOTIFS_MEDIA.AUCUN_MEDIA);
  assert.match(r.detail, /facebook/);
});

test('un média annoncé mais absent du dossier : motif introuvable', async () => {
  const stockage = stockageFactice();
  const r = await hebergeur(stockage, clientFactice()).heberger({
    depose: depose({ resoluPresent: false }), canal: 'facebook',
  });
  assert.equal(r.motif, MOTIFS_MEDIA.MEDIA_INTROUVABLE);
});

test('le média « principal » passe avant les autres, puis l ordre du carrousel', () => {
  const pub = {
    medias: [
      { role: 'secondaire', chemin_relatif: 'b.jpg', ordre_carrousel: 1 },
      { role: 'principal', chemin_relatif: 'a.jpg', ordre_carrousel: 2 },
    ],
  };
  assert.equal(choisirMedia(pub, 'facebook').chemin_relatif, 'a.jpg');

  const sansRole = {
    medias: [
      { chemin_relatif: 'deux.jpg', ordre_carrousel: 2 },
      { chemin_relatif: 'un.jpg', ordre_carrousel: 1 },
    ],
  };
  assert.equal(choisirMedia(sansRole, 'facebook').chemin_relatif, 'un.jpg');
});

test('un média sans canal_cible est éligible à tous les canaux', () => {
  const pub = { medias: [{ chemin_relatif: 'a.jpg' }] };
  assert.equal(choisirMedia(pub, 'instagram').chemin_relatif, 'a.jpg');
});

/* ═══════════════════════════════════════════════════════════════════════════
   6. LA FORME DES CHEMINS ET DES MOTIFS
   ═══════════════════════════════════════════════════════════════════════════ */

test('un nom accentué ou espacé devient une clé d objet prévisible', () => {
  assert.equal(nomSur('Affiche Rentrée 2026.jpg'), 'Affiche-Rentree-2026.jpg');
  assert.equal(nomSur('///'), 'media');
  assert.equal(nomSur('a'.repeat(300)).length, 120);
});

test('un motif devient une derniere_erreur de la forme que l écran sait afficher', () => {
  const erreur = erreurDeMedia(
    { motif: MOTIFS_MEDIA.TROP_LOURD, detail: 'trop gros', piste: 'alléger' },
    '2026-09-21T06:00:00Z',
  );
  assert.deepEqual(erreur, {
    code_erreur: 'media_trop_lourd',
    message_erreur: 'trop gros',
    piste: 'alléger',
    a_utc: '2026-09-21T06:00:00Z',
  });
  assert.equal(erreurDeMedia({ motif: null }), null, 'un succès n écrit aucune erreur');
});

/* ═══════════════════════════════════════════════════════════════════════════
   7. CE QUI NE DOIT JAMAIS SORTIR D ICI
   ═══════════════════════════════════════════════════════════════════════════ */

test('⛔ aucune URL Drive ne peut être fabriquée par ce module', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../api/_lib/autopost-medias.js', import.meta.url)), 'utf8',
  );
  assert.equal(/drive\.google\.com|googleusercontent|uc\?export=download/.test(source), false,
    'un lien Drive n est pas une URL publique : ne jamais en fabriquer une');
});

test('⛔ ce module n écrit RIEN dans le Drive : il ne connaît que le téléchargement', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../api/_lib/autopost-medias.js', import.meta.url)), 'utf8',
  );
  assert.equal(/drive\.file|drive\.readwrite|auth\/drive['"\s]/.test(source), false,
    'aucune portée Drive en écriture ne doit apparaître ici');
  assert.equal(/\.remove\(|deleteObject|\.delete\(/.test(source), false,
    'ce module ne supprime rien : effacer un objet, c est risquer d effacer l image '
    + 'd une publication encore en vol');
});

test('⛔ le bucket visé est bien « publications », et pas un autre', () => {
  assert.equal(BUCKET, 'publications');
});

/* ═══════════════════════════════════════════════════════════════════════════
   8. LE PORT SUPABASE — sans réseau, sur une doublure de client
   ═══════════════════════════════════════════════════════════════════════════ */

/** Doublure minimale du client Supabase Storage. */
function supabaseFactice({ liste = [], erreurListe = null, erreurDepot = null } = {}) {
  const appels = [];
  return {
    appels,
    storage: {
      from(nom) {
        appels.push(`from:${nom}`);
        return {
          async list(dossier, options) {
            appels.push(`list:${dossier}:${options?.search}`);
            if (erreurListe) return { data: null, error: { message: erreurListe } };
            return { data: liste, error: null };
          },
          async upload(chemin, octets, options) {
            appels.push(`upload:${chemin}:${options?.upsert}`);
            if (erreurDepot) return { data: null, error: erreurDepot };
            return { data: { path: chemin }, error: null };
          },
          getPublicUrl(chemin) {
            return { data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/publications/${chemin}` } };
          },
        };
      },
    },
  };
}

test('le port interroge le DOSSIER de l objet et compare le nom EXACT', async () => {
  const supabase = supabaseFactice({ liste: [{ name: `${MD5}-${NOM}` }] });
  const port = stockageSupabase(supabase);

  assert.equal(await port.existe(`PUB-2026-S39-1-01/v1/${MD5}-${NOM}`), true);
  assert.equal(supabase.appels.includes(`list:PUB-2026-S39-1-01/v1:${MD5}-${NOM}`), true,
    `appels : ${supabase.appels.join(' · ')}`);
});

test('⛔ un HOMONYME PARTIEL ne compte pas comme « présent »', async () => {
  // `search` est une recherche, pas une réponse par oui ou par non. Se contenter
  // de « la liste n est pas vide » dirait « déjà hébergé » pour un autre objet,
  // et la publication partirait avec la mauvaise image.
  const supabase = supabaseFactice({ liste: [{ name: `${MD5}-autre-chose.jpg` }] });
  assert.equal(await stockageSupabase(supabase).existe(`P/v1/${MD5}-${NOM}`), false);
});

test('⛔ le port TÉLÉVERSE SANS ÉCRASER (upsert: false)', async () => {
  const supabase = supabaseFactice();
  const r = await stockageSupabase(supabase).televerser('a/b.jpg', new Uint8Array([1]), {
    contentType: 'image/jpeg',
  });
  assert.equal(r.ok, true);
  assert.equal(r.deja, false);
  assert.equal(supabase.appels.includes('upload:a/b.jpg:false'), true,
    'upsert doit valoir false : un écrasement silencieux effacerait une image approuvée');
});

test('le port lit un doublon (409) comme « déjà là », pas comme une panne', async () => {
  const parStatut = supabaseFactice({ erreurDepot: { message: 'x', statusCode: '409' } });
  assert.deepEqual(
    await stockageSupabase(parStatut).televerser('a/b.jpg', new Uint8Array([1]), {}),
    { ok: true, deja: true },
  );

  const parMessage = supabaseFactice({ erreurDepot: { message: 'The resource already exists' } });
  assert.deepEqual(
    await stockageSupabase(parMessage).televerser('a/b.jpg', new Uint8Array([1]), {}),
    { ok: true, deja: true },
  );
});

test('le port rend un refus lisible au lieu de lever', async () => {
  const supabase = supabaseFactice({ erreurDepot: { message: 'mime type not supported', statusCode: '400' } });
  const r = await stockageSupabase(supabase).televerser('a/b.jpg', new Uint8Array([1]), {});
  assert.equal(r.ok, false);
  assert.match(r.erreur, /not supported/);
});

test('une lecture de bucket en erreur LÈVE côté port — et l hébergeur la traduit en motif', async () => {
  const supabase = supabaseFactice({ erreurListe: 'bucket not found' });
  await assert.rejects(() => stockageSupabase(supabase).existe('a/b.jpg'), /bucket not found/);

  // Et vue d'en haut, ça ne casse rien : c'est un motif.
  const r = await creerHebergeurMedias({
    stockage: stockageSupabase(supabase),
    client: clientFactice(),
  }).heberger({ depose: depose(), canal: 'facebook' });
  assert.equal(r.motif, MOTIFS_MEDIA.STOCKAGE_INJOIGNABLE);
});

test('l adresse publique est construite sans appel réseau', () => {
  const supabase = supabaseFactice();
  const url = stockageSupabase(supabase).urlPublique('a/b.jpg');
  assert.equal(url, 'https://x.supabase.co/storage/v1/object/public/publications/a/b.jpg');
});

/* ══════════════════════════════════════════════════════════════════════════
   L'ÉCRAN SAIT-IL DIRE CES MOTIFS ?

   Ajouté le 19/09/2026 après une relecture : les sept codes d'hébergement
   existaient côté serveur, mais `MOTIFS_ALIMENTATION` — la table de phrases de
   l'écran Publications auto — ne les connaissait pas. Le panneau de relecture
   affiche `MOTIFS_ALIMENTATION[e.motif] || e.motif` : sans phrase, le gérant de
   Moanda lisait `empreinte_media_absente` en toutes lettres.

   Un code sans phrase n'est pas un bug de calcul ; c'est pire, c'est un écran
   qui a l'air de fonctionner. Ce test le refuse.
   ══════════════════════════════════════════════════════════════════════════ */
test('chaque motif d\'hébergement a une phrase dans l\'écran', () => {
  const ecran = readFileSync(
    fileURLToPath(new URL('../src/features/autopost/page.jsx', import.meta.url)), 'utf8',
  );
  // On lit la table de phrases de l'écran comme du TEXTE : ce fichier est du JSX,
  // que le lanceur de tests ne sait pas compiler. Un scan de source suffit —
  // c'est la présence de la clé qui est en jeu, pas sa valeur calculée.
  const table = ecran.slice(ecran.indexOf('const MOTIFS_ALIMENTATION = {'));
  const corps = table.slice(0, table.indexOf('\n};'));
  const sansPhrase = Object.values(MOTIFS_MEDIA).filter((code) => !corps.includes(`${code}:`));
  assert.deepEqual(
    sansPhrase, [],
    'Ces codes s\'afficheraient en brut dans le panneau de relecture : '
    + `${sansPhrase.join(', ')}. Ajouter leur phrase dans MOTIFS_ALIMENTATION `
    + '(src/features/autopost/page.jsx).',
  );
});
