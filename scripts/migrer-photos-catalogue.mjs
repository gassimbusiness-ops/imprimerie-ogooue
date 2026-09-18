#!/usr/bin/env node
/**
 * ════════════════════════════════════════════════════════════════════════════
 * 011 — SORTIR LES PHOTOS DU CATALOGUE DE LA BASE DE DONNÉES
 *
 *        ⛔ NON APPLIQUÉ. Écrit le 2026-09-18 après mesure en lecture seule du
 *           projet bcwkrrqmjpaohmafcncw. Aucune écriture n'a été faite.
 *
 *        📖 LIRE `migrations/011_photos_catalogue_vers_storage.sql` D'ABORD.
 *           Ce fichier-ci n'est que l'étape 2 d'une procédure en 5 étapes.
 *           Lancé seul, sans l'archive de l'étape 1, il n'a pas de retour
 *           arrière.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * POURQUOI UN SCRIPT ET PAS DU SQL
 *
 *   Postgres ne sait pas téléverser dans Supabase Storage. Le déplacement d'un
 *   octet de `app_data.data` vers un bucket passe obligatoirement par l'API
 *   Storage, donc par un client HTTP. Le SQL de la migration 011 fait tout le
 *   reste : l'archive, les contrôles, le retour arrière.
 *
 * CE QU'IL FAIT, LIGNE PAR LIGNE
 *
 *   Pour chacune des 17 lignes de `produits_catalogue` qui portent un champ
 *   `images`, et pour chaque entrée de ce tableau :
 *
 *     · déjà une URL `http(s)` → ON NE TOUCHE À RIEN et on le dit.
 *       (Une entrée est dans ce cas aujourd'hui : « Tee-shirt blanc KAF
 *       enfant », rang 1, une URL DALL·E signée. Ces URL expirent en quelques
 *       heures : l'image est cassée à l'écran depuis longtemps. On ne peut pas
 *       la rapatrier, et on ne fait pas semblant.)
 *     · une data-URL `data:image/…;base64,…` → décodée, téléversée dans le
 *       bucket, puis REMPLACÉE par son URL publique.
 *     · autre chose (null, chaîne vide) → laissée telle quelle et signalée.
 *
 *   La ligne n'est réécrite en base QUE si au moins une entrée a changé, et
 *   seul le champ `images` est modifié. `image_principale` est un INDEX
 *   numérique (0 sur les 17 lignes) : l'ordre du tableau est conservé, donc
 *   l'index continue de désigner la même photo.
 *
 * IDEMPOTENT, ET REPRENABLE
 *
 *   Le chemin de l'objet est déterminé par le contenu (`<ligne>/<rang>-<md5
 *   court>.<ext>`). Relancer le script après une coupure à Moanda reprend là
 *   où il s'est arrêté : les entrées déjà migrées sont des URL, donc sautées.
 *
 * MODE PAR DÉFAUT : SIMULATION
 *
 *   Sans `--appliquer`, RIEN n'est téléversé et RIEN n'est écrit. Le script
 *   lit, décode, calcule les chemins et imprime le compte rendu complet, avec
 *   le poids avant/après. C'est ce mode qu'il faut lancer en premier.
 *
 * CE QU'IL FAUT DANS L'ENVIRONNEMENT
 *
 *   SUPABASE_URL                 https://bcwkrrqmjpaohmafcncw.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY    Supabase → Settings → API → `service_role`
 *
 *   ⚠️ La clé `service_role` contourne RLS et autorise l'écriture dans le
 *      bucket. Elle ne doit JAMAIS porter le préfixe `VITE_`, jamais être
 *      commitée, et jamais être saisie par un agent : c'est Gassim qui
 *      l'exporte dans son shell, le temps de la commande.
 *
 *      export SUPABASE_URL='…'
 *      export SUPABASE_SERVICE_ROLE_KEY='…'
 *      node scripts/migrer-photos-catalogue.mjs                 # simulation
 *      node scripts/migrer-photos-catalogue.mjs --appliquer     # pour de vrai
 *
 *   Options :
 *      --bucket=<nom>     défaut : catalogue
 *      --limite=<n>       ne traiter que les n premières lignes (essai)
 *      --appliquer        téléverse et réécrit. Sans elle : simulation.
 */
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';

const COLLECTION = 'produits_catalogue';

/** Extensions servies, par type MIME. Un type absent de cette table est refusé. */
const EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/* ── Arguments ─────────────────────────────────────────────────────────── */

function lireArguments(argv) {
  const opts = { appliquer: false, bucket: 'catalogue', limite: Infinity };
  for (const a of argv.slice(2)) {
    if (a === '--appliquer') opts.appliquer = true;
    else if (a.startsWith('--bucket=')) opts.bucket = a.slice('--bucket='.length);
    else if (a.startsWith('--limite=')) opts.limite = Number(a.slice('--limite='.length));
    else { throw new Error(`Option inconnue : ${a}`); }
  }
  if (!opts.bucket) throw new Error('--bucket ne peut pas être vide');
  if (!Number.isFinite(opts.limite) && opts.limite !== Infinity) {
    throw new Error('--limite doit être un nombre');
  }
  return opts;
}

/* ── Décodage d'une data-URL ───────────────────────────────────────────── */

/**
 * Décode `data:image/png;base64,…` en `{ mime, ext, octets }`.
 * Rend `{ erreur }` plutôt que de lever : une photo illisible ne doit pas
 * arrêter les seize autres.
 */
export function decoderDataUrl(valeur) {
  if (typeof valeur !== 'string') return { erreur: 'entrée non textuelle' };
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/is.exec(valeur);
  if (!m) return { erreur: 'ce n’est pas une data-URL d’image en base64' };
  const mime = m[1].toLowerCase();
  const ext = EXTENSIONS[mime];
  if (!ext) return { erreur: `type non servi : ${mime}` };
  let octets;
  try {
    octets = Buffer.from(m[2], 'base64');
  } catch {
    return { erreur: 'base64 illisible' };
  }
  if (octets.length === 0) return { erreur: 'base64 vide' };
  return { mime, ext, octets };
}

/** Le chemin de l'objet dans le bucket — déterminé par le contenu. */
export function cheminObjet(idLigne, rang, octets, ext) {
  const empreinte = createHash('md5').update(octets).digest('hex').slice(0, 12);
  return `${idLigne}/${rang}-${empreinte}.${ext}`;
}

const formaterOctets = (n) => new Intl.NumberFormat('fr-FR').format(n);

/* ── Corps ─────────────────────────────────────────────────────────────── */

async function principal() {
  const opts = lireArguments(process.argv);

  const url = process.env.SUPABASE_URL;
  const cle = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !cle) {
    console.error(
      'Il manque SUPABASE_URL et/ou SUPABASE_SERVICE_ROLE_KEY dans l’environnement.\n'
      + 'Voir l’en-tête de ce fichier. Les exporter dans le shell, ne pas les écrire dans un fichier du dépôt.',
    );
    process.exit(2);
  }

  const sb = createClient(url, cle, { auth: { persistSession: false } });

  console.log(opts.appliquer
    ? '⚠️  MODE RÉEL — téléversement et réécriture des lignes.'
    : '🔎 SIMULATION — rien ne sera téléversé, rien ne sera écrit. (--appliquer pour agir)');
  console.log(`   bucket : ${opts.bucket}    collection : ${COLLECTION}\n`);

  // ── Le bucket existe-t-il, et est-il public ? ────────────────────────────
  //
  // On le VÉRIFIE, on ne le crée pas. Créer un bucket est une décision d'accès :
  // elle appartient au dirigeant, et la procédure exacte est au § B.1 du SQL.
  const { data: buckets, error: eBuckets } = await sb.storage.listBuckets();
  if (eBuckets) {
    console.error(`Impossible de lire la liste des buckets : ${eBuckets.message}`);
    process.exit(3);
  }
  const bucket = (buckets || []).find((b) => b.name === opts.bucket);
  if (!bucket) {
    console.error(
      `Le bucket « ${opts.bucket} » n’existe pas.\n`
      + 'Le créer d’abord — voir « B.1 — CRÉER LE BUCKET » dans\n'
      + 'migrations/011_photos_catalogue_vers_storage.sql.\n'
      + 'Ce script ne crée aucun bucket : les règles d’accès ne sont pas à lui.',
    );
    process.exit(4);
  }
  if (!bucket.public) {
    console.error(
      `Le bucket « ${opts.bucket} » n’est pas en lecture publique.\n`
      + 'Les photos remplaceraient une data-URL par une URL qui rend 400 : le catalogue\n'
      + 'perdrait ses images. Rendre le bucket public en LECTURE, puis relancer.',
    );
    process.exit(5);
  }

  // ── Lire les lignes porteuses de photos ─────────────────────────────────
  const { data: lignes, error: eLire } = await sb
    .from('app_data')
    .select('id, data')
    .eq('collection', COLLECTION)
    .order('created_at', { ascending: true });
  if (eLire) {
    console.error(`Lecture de ${COLLECTION} impossible : ${eLire.message}`);
    process.exit(6);
  }

  const porteuses = (lignes || [])
    .filter((l) => Array.isArray(l.data?.images) && l.data.images.length > 0)
    .slice(0, opts.limite);

  console.log(`${lignes.length} lignes lues, ${porteuses.length} portent un champ « images ».\n`);

  const bilan = {
    lignesReecrites: 0, photosTeleversees: 0, dejaDistantes: 0,
    inutilisables: 0, echecs: 0, octetsAvant: 0, octetsApres: 0,
  };

  for (const ligne of porteuses) {
    const nom = ligne.data?.nom || '(sans nom)';
    const avant = ligne.data.images;
    const apres = [...avant];
    let modifiee = false;

    for (let rang = 0; rang < avant.length; rang++) {
      const valeur = avant[rang];
      const tailleAvant = typeof valeur === 'string' ? valeur.length : 0;
      bilan.octetsAvant += tailleAvant;

      if (typeof valeur === 'string' && /^https?:\/\//i.test(valeur)) {
        bilan.dejaDistantes += 1;
        bilan.octetsApres += tailleAvant;
        console.log(`  · ${nom} [${rang}] — déjà une URL, intacte (${formaterOctets(tailleAvant)} c.)`);
        continue;
      }

      const decode = decoderDataUrl(valeur);
      if (decode.erreur) {
        bilan.inutilisables += 1;
        bilan.octetsApres += tailleAvant;
        console.log(`  ⚠ ${nom} [${rang}] — laissée telle quelle : ${decode.erreur}`);
        continue;
      }

      const chemin = cheminObjet(ligne.id, rang, decode.octets, decode.ext);
      const urlPublique = `${url.replace(/\/+$/, '')}/storage/v1/object/public/${opts.bucket}/${chemin}`;

      if (!opts.appliquer) {
        bilan.photosTeleversees += 1;
        bilan.octetsApres += urlPublique.length;
        modifiee = true;
        console.log(
          `  → ${nom} [${rang}] — ${formaterOctets(tailleAvant)} c. de base64 `
          + `(${formaterOctets(decode.octets.length)} o décodés, ${decode.mime}) → ${chemin}`,
        );
        continue;
      }

      const { error: eUp } = await sb.storage.from(opts.bucket).upload(chemin, decode.octets, {
        contentType: decode.mime,
        // `upsert` : une reprise après coupure réécrit le même objet au même
        // chemin (le chemin dépend du contenu, donc c'est bien la même photo).
        upsert: true,
      });
      if (eUp) {
        bilan.echecs += 1;
        bilan.octetsApres += tailleAvant;
        console.error(`  ✖ ${nom} [${rang}] — téléversement refusé : ${eUp.message}`);
        continue;
      }

      apres[rang] = urlPublique;
      modifiee = true;
      bilan.photosTeleversees += 1;
      bilan.octetsApres += urlPublique.length;
      console.log(`  ✓ ${nom} [${rang}] — ${formaterOctets(tailleAvant)} c. → ${chemin}`);
    }

    if (!modifiee) continue;

    if (!opts.appliquer) { bilan.lignesReecrites += 1; continue; }

    // ⚠️ SEUL `images` change. On repart de `ligne.data` relu au début du
    // script : si un écran a modifié le prix entre-temps, cette écriture
    // l'écraserait. C'est pourquoi le § B.4 du SQL demande de lancer ce script
    // hors des heures d'ouverture de l'imprimerie.
    const { error: eEcrire } = await sb
      .from('app_data')
      .update({ data: { ...ligne.data, images: apres }, updated_at: new Date().toISOString() })
      .eq('id', ligne.id)
      .eq('collection', COLLECTION);
    if (eEcrire) {
      bilan.echecs += 1;
      console.error(`  ✖ ${nom} — la ligne N’A PAS été réécrite : ${eEcrire.message}`);
      console.error('    Les objets téléversés restent dans le bucket ; relancer le script les réutilise.');
      continue;
    }
    bilan.lignesReecrites += 1;
  }

  /* ── Compte rendu ─────────────────────────────────────────────────────── */

  const gain = bilan.octetsAvant - bilan.octetsApres;
  console.log('\n────────────────────────────────────────────────────────────');
  console.log(opts.appliquer ? 'FAIT' : 'SIMULATION — rien n’a été écrit');
  console.log(`  lignes réécrites ......... ${bilan.lignesReecrites}`);
  console.log(`  photos téléversées ....... ${bilan.photosTeleversees}`);
  console.log(`  déjà des URL (intactes) .. ${bilan.dejaDistantes}`);
  console.log(`  inutilisables (laissées) . ${bilan.inutilisables}`);
  console.log(`  échecs ................... ${bilan.echecs}`);
  console.log(`  champ « images » avant ... ${formaterOctets(bilan.octetsAvant)} caractères`);
  console.log(`  champ « images » après ... ${formaterOctets(bilan.octetsApres)} caractères`);
  console.log(`  gain ..................... ${formaterOctets(gain)} caractères`);
  console.log('────────────────────────────────────────────────────────────');
  console.log(
    '\n⚠️ Le seul contrôle qui compte : ouvrir le catalogue depuis le téléphone du\n'
    + '   gérant et vérifier que les produits photographiés ont TOUJOURS leur photo.\n'
    + '   Un décompte ne prouve pas qu’une image s’affiche à Moanda.\n'
    + '   Puis relancer les contrôles du § D de migrations/011_….sql.',
  );

  if (bilan.echecs > 0) process.exit(1);
}

// Lancé directement — et pas quand un test importe `decoderDataUrl`.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  principal().catch((e) => { console.error(e); process.exit(1); });
}
