/**
 * Le script de migration des photos — ses deux fonctions qui DÉCIDENT.
 *
 * `scripts/migrer-photos-catalogue.mjs` ne peut pas être testé de bout en bout
 * ici : il parle à Supabase Storage. Mais deux fonctions pures portent tout ce
 * qui peut mal tourner, et ce sont elles qu'on teste :
 *
 *   decoderDataUrl()  ce qu'on accepte de décoder — et ce qu'on refuse
 *   cheminObjet()     le chemin dans le bucket, DÉTERMINÉ PAR LE CONTENU,
 *                     ce qui rend le script reprenable après une coupure
 *                     réseau à Moanda
 *
 * Le reste du script est vérifié autrement : lancé sans `--appliquer`, il ne
 * téléverse rien et n'écrit rien, et le § C.3 de
 * `migrations/011_photos_catalogue_vers_storage.sql` impose cette simulation
 * avant toute écriture.
 *
 * Lancer :  node --test tests/migration-photos-catalogue.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decoderDataUrl, cheminObjet } from '../scripts/migrer-photos-catalogue.mjs';

/** Un PNG 1×1 réel, pas une chaîne inventée. */
const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('decoderDataUrl accepte les types réellement présents en base', () => {
  // Les 19 data-URL de `produits_catalogue` sont en image/png et image/jpeg.
  const png = decoderDataUrl(`data:image/png;base64,${PNG_1x1}`);
  assert.equal(png.erreur, undefined);
  assert.equal(png.mime, 'image/png');
  assert.equal(png.ext, 'png');
  assert.ok(Buffer.isBuffer(png.octets) && png.octets.length > 0);
  // Le décodage doit rendre les VRAIS octets du PNG, pas une approximation :
  // les 8 premiers sont la signature du format.
  assert.deepEqual([...png.octets.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);

  assert.equal(decoderDataUrl(`data:image/jpeg;base64,${PNG_1x1}`).ext, 'jpg');
  assert.equal(decoderDataUrl(`data:image/webp;base64,${PNG_1x1}`).ext, 'webp');
  // La casse du type MIME ne doit pas faire rater une photo.
  assert.equal(decoderDataUrl(`DATA:IMAGE/PNG;BASE64,${PNG_1x1}`).ext, 'png');
});

test('decoderDataUrl refuse, sans lever, tout le reste', () => {
  // ⚠️ Rendre une erreur plutôt que lever : une photo illisible ne doit pas
  // arrêter les seize autres au milieu de la migration.
  for (const valeur of [
    null, undefined, 42, {}, [],
    '',
    'https://exemple.test/photo.png',            // déjà une URL : traitée ailleurs
    'data:text/html;base64,PHNjcmlwdD4=',        // pas une image
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', // image, mais type non servi
    'data:image/png,pas-du-base64',              // pas de marqueur base64
    'data:image/png;base64,',                    // base64 vide
  ]) {
    const r = decoderDataUrl(valeur);
    assert.equal(typeof r.erreur, 'string', `aurait dû être refusé : ${String(valeur).slice(0, 40)}`);
    assert.equal(r.octets, undefined);
  }
});

test('cheminObjet est déterminé par le contenu — donc reprenable', () => {
  const a = Buffer.from('photo-a');
  const b = Buffer.from('photo-b');

  // Deux fois le même contenu → deux fois le même chemin. C'est ce qui rend le
  // script idempotent : relancé après une coupure, il réécrit le même objet au
  // même endroit plutôt que d'en créer un second.
  assert.equal(cheminObjet('ligne-1', 0, a, 'png'), cheminObjet('ligne-1', 0, a, 'png'));
  // Un contenu différent → un chemin différent. Une photo ne peut pas en
  // écraser une autre.
  assert.notEqual(cheminObjet('ligne-1', 0, a, 'png'), cheminObjet('ligne-1', 0, b, 'png'));
  // Le rang sépare deux photos d'une même fiche (« Enveloppe invitation » en a
  // deux, « Tasse magique » aussi).
  assert.notEqual(cheminObjet('ligne-1', 0, a, 'png'), cheminObjet('ligne-1', 1, a, 'png'));
  // Deux fiches ne se marchent pas dessus.
  assert.notEqual(cheminObjet('ligne-1', 0, a, 'png'), cheminObjet('ligne-2', 0, a, 'png'));

  // La forme du chemin : rien qui doive être échappé dans une URL.
  const chemin = cheminObjet('801cafdc-64f8-44be-b08a-4f77c273a675', 1, a, 'jpg');
  assert.match(chemin, /^[0-9a-f-]{36}\/1-[0-9a-f]{12}\.jpg$/);
  assert.equal(chemin, encodeURI(chemin), 'le chemin doit passer tel quel dans une URL');
});

/* ═══════════════════════════════════════════════════════════════════════════
   Les garde-fous du script et de la migration, vérifiés SUR LA SOURCE
   ═══════════════════════════════════════════════════════════════════════════

   Ces contrôles-là ne testent pas un comportement : ils empêchent qu'on retire
   par distraction une sécurité qui n'a de valeur que tant qu'elle est là. Même
   forme que `tests/amorcage-idempotent.test.mjs`.                           */

const SCRIPT = readFileSync(new URL('../scripts/migrer-photos-catalogue.mjs', import.meta.url), 'utf8');
const SQL = readFileSync(new URL('../migrations/011_photos_catalogue_vers_storage.sql', import.meta.url), 'utf8');

test('le script ne fait RIEN par défaut', () => {
  assert.ok(SCRIPT.includes("appliquer: false"),
    'la simulation doit rester le mode par défaut');
  assert.ok(!/createBucket/.test(SCRIPT),
    'le script ne doit JAMAIS créer de bucket : les règles d’accès ne sont pas à lui');
  assert.ok(/if \(!bucket\.public\)/.test(SCRIPT),
    'le script doit refuser un bucket privé — sinon le catalogue perd ses images');
  assert.ok(!/DELETE|\.remove\(/.test(SCRIPT),
    'le script ne doit rien supprimer : « on ne supprime rien, on déplace »');
  assert.ok(SCRIPT.includes('SUPABASE_SERVICE_ROLE_KEY'),
    'la clé doit venir de l’environnement');
  assert.ok(!/service_role_key\s*=\s*['"][A-Za-z0-9]/i.test(SCRIPT),
    'aucune clé ne doit être écrite en dur dans le dépôt');
});

test('la migration 011 est marquée NON APPLIQUÉE et garde un retour arrière', () => {
  assert.ok(SQL.includes('NON APPLIQUÉE'),
    'le fichier doit dire qu’il n’a pas été exécuté');
  assert.ok(/E\. RETOUR ARRIÈRE/.test(SQL),
    'toute migration doit porter son retour arrière');
  assert.ok(SQL.includes('produits_catalogue_photos_archive_011'),
    'les originaux doivent être archivés avant d’être remplacés');
  // Le seul DELETE du fichier est celui du § F.1, en commentaire, et il est
  // explicitement laissé à la décision du dirigeant.
  for (const ligne of SQL.split('\n')) {
    if (/\bDELETE\b/i.test(ligne)) {
      assert.match(ligne.trim(), /^--/, `DELETE hors commentaire : ${ligne.trim()}`);
    }
  }
});
