/**
 * Une ligne de `app_data` = UN identifiant. Et une ligne qui en a deux reste modifiable.
 *
 * ── L'incident ─────────────────────────────────────────────────────────────
 *
 * Le 26/09/2026, écran Tâches → « Modifier la tâche » → Enregistrer :
 * « La modification de la tâche n'a PAS été enregistrée (ligne introuvable). »
 *
 * Les écrans ne lisent que `data` : ils connaissent `data.id`. `db.update(id)`
 * cherchait la ligne par la COLONNE `id`. La tâche avait été insérée en SQL
 * brut avec deux `gen_random_uuid()` ; trois paiements SingPay et une
 * notification l'avaient été par du code serveur qui tirait deux
 * `crypto.randomUUID()`.
 *
 * Trois garanties testées ici :
 *   1. `ligneAppData()` pose le même identifiant aux deux endroits, et refuse
 *      deux valeurs différentes ;
 *   2. le VRAI `src/services/db.js`, branché sur une base en mémoire, modifie
 *      une ligne désalignée — et lève toujours sur une ligne vraiment absente ;
 *   3. aucun fichier du dépôt n'insère dans `app_data` sans `ligneAppData()`.
 *
 * Lancer :  node --test tests/ligne-app-data.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ligneAppData } from '../src/services/ligne-app-data.js';

const RACINE = resolve(fileURLToPath(new URL('..', import.meta.url)));

/* ═══════════════════════════════════════════════════════════════════════════
   1. LA FORME D'UNE LIGNE NEUVE
   ═══════════════════════════════════════════════════════════════════════════ */

test('ligneAppData : la colonne et data.id portent la même valeur', () => {
  const l = ligneAppData({ collection: 'taches', data: { titre: 'Appeler SingPay' } });
  assert.match(l.id, /^[0-9a-f-]{36}$/);
  assert.equal(l.data.id, l.id);
  assert.equal(l.collection, 'taches');
  assert.equal(l.data.titre, 'Appeler SingPay');
});

test('ligneAppData : un data.id existant est respecté, pas remplacé', () => {
  const l = ligneAppData({ collection: 'taches', data: { id: 'abc', titre: 't' } });
  assert.equal(l.id, 'abc');
  assert.equal(l.data.id, 'abc');
});

test('ligneAppData : un id imposé est recopié dans data', () => {
  const l = ligneAppData({ id: 'e1', collection: 'employes', data: { nom: 'X' } });
  assert.equal(l.id, 'e1');
  assert.equal(l.data.id, 'e1');
});

test('ligneAppData REFUSE deux identifiants différents au lieu de choisir', () => {
  assert.throws(
    () => ligneAppData({ id: 'colonne', collection: 'taches', data: { id: 'autre' } }),
    /deux identifiants/,
  );
});

test('ligneAppData : horodatages transmis tels quels, absents si non donnés', () => {
  const l = ligneAppData({ collection: 'x', data: {}, created_at: 'c', updated_at: 'u' });
  assert.equal(l.created_at, 'c');
  assert.equal(l.updated_at, 'u');
  const m = ligneAppData({ collection: 'x', data: {} });
  assert.equal('created_at' in m, false, 'la base pose sa valeur par défaut');
  assert.throws(() => ligneAppData({ data: {} }), /collection/);
});

test("ligneAppData ne modifie pas l'objet de l'appelant", () => {
  const data = { titre: 't' };
  ligneAppData({ collection: 'taches', data });
  assert.equal('id' in data, false);
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. LE VRAI db.js, SUR UNE BASE EN MÉMOIRE
   ═══════════════════════════════════════════════════════════════════════════ */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Doublure du client Supabase, réduite à ce que db.js appelle. Elle reproduit
 * les deux comportements de la vraie base qui comptent ici :
 *   - la colonne `id` est de type uuid : la comparer à autre chose lève 22P02 ;
 *   - un UPDATE / DELETE qui ne touche aucune ligne N'EST PAS une erreur.
 */
function fauxSupabase(lignes) {
  const journal = [];
  function requete(table) {
    const etat = { table, op: 'select', filtres: [], limite: null, charge: null, colonnes: 'data' };
    const valeur = (ligne, col) => {
      if (col === 'id') return ligne.id;
      if (col === 'collection') return ligne.collection;
      const m = /^data->>(.+)$/.exec(col);
      if (m) return ligne.data?.[m[1]] == null ? null : String(ligne.data[m[1]]);
      throw new Error(`filtre non géré par la doublure : ${col}`);
    };
    const executer = () => {
      for (const [col, v] of etat.filtres) {
        if (col === 'id' && !UUID.test(String(v))) {
          return { data: null, error: { code: '22P02', message: `invalid input syntax for type uuid: "${v}"` } };
        }
      }
      const vises = lignes.filter((l) => etat.filtres.every(([col, v]) => valeur(l, col) === v));
      journal.push({ op: etat.op, filtres: etat.filtres });
      if (etat.op === 'update') {
        for (const l of vises) Object.assign(l, etat.charge);
        return { data: null, error: null };
      }
      if (etat.op === 'delete') {
        for (const l of vises) lignes.splice(lignes.indexOf(l), 1);
        return { data: null, error: null };
      }
      if (etat.op === 'insert') {
        lignes.push(structuredClone(etat.charge));
        return { data: null, error: null };
      }
      const projete = vises.map((l) => (etat.colonnes.includes('id')
        ? { id: l.id, data: structuredClone(l.data) }
        : { data: structuredClone(l.data) }));
      return { data: etat.limite == null ? projete : projete.slice(0, etat.limite), error: null };
    };
    const q = {
      select(colonnes) { etat.colonnes = colonnes; return q; },
      eq(col, v) { etat.filtres.push([col, v]); return q; },
      order() { return q; },
      limit(n) { etat.limite = n; return q; },
      update(charge) { etat.op = 'update'; etat.charge = charge; return q; },
      delete() { etat.op = 'delete'; return q; },
      insert(charge) { etat.op = 'insert'; etat.charge = charge; return q; },
      async maybeSingle() {
        const r = executer();
        if (r.error) return r;
        if (r.data.length > 1) return { data: null, error: { code: 'PGRST116', message: 'plusieurs lignes' } };
        return { data: r.data[0] || null, error: null };
      },
      then(ok, ko) { return Promise.resolve(executer()).then(ok, ko); },
    };
    return q;
  }
  return { client: { from: requete }, journal };
}

/**
 * Charge le VRAI src/services/db.js. Seuls `./supabase` (le client) et
 * `./api-client` (réseau) sont remplacés ; tout le reste est le code livré.
 * `FICHIER_DB` permet de rejouer le test sur une autre version du fichier.
 */
async function chargerDb() {
  const fichierDb = process.env.FICHIER_DB || join(RACINE, 'src/services/db.js');
  const dossier = mkdtempSync(join(tmpdir(), 'ligne-app-data-'));
  try {
    const sortie = join(dossier, 'db.mjs');
    await build({
      entryPoints: [fichierDb],
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      outfile: sortie,
      logLevel: 'silent',
      plugins: [{
        name: 'doublures',
        setup(b) {
          b.onResolve({ filter: /^\.\/(supabase|api-client)$/ }, (a) => ({ path: a.path, namespace: 'doublure' }));
          b.onResolve({ filter: /^\.\/[a-z-]+$/ }, (a) => ({
            path: join(RACINE, 'src/services', `${a.path.slice(2)}.js`),
          }));
          b.onLoad({ filter: /.*/, namespace: 'doublure' }, (a) => ({
            contents: a.path === './supabase'
              ? 'export const USE_SUPABASE = true; export const supabase = { from: (t) => globalThis.__fauxSupabase.from(t) };'
              : 'export async function apiFetch() { throw new Error("réseau interdit en test"); }',
            loader: 'js',
          }));
        },
      }],
    });
    writeFileSync(join(dossier, 'package.json'), '{"type":"module"}');
    return await import(pathToFileURL(sortie).href);
  } finally {
    // Le module est déjà en mémoire une fois importé.
    setTimeout(() => rmSync(dossier, { recursive: true, force: true }), 0);
  }
}

const { db } = await chargerDb();

/** La tâche du 26/09, telle qu'elle était en base avant la réparation manuelle. */
function baseAvecTacheDesalignee() {
  return [
    {
      id: '4e1c56c5-3e71-42e3-be58-f85dbe316651',
      collection: 'taches',
      data: {
        id: '9d0c1b7e-0000-4000-8000-000000000001',
        titre: 'APPELER SingPay au téléphone — accélérer le GoLive',
        statut: 'a_faire',
      },
    },
    {
      id: '11111111-1111-4111-8111-111111111111',
      collection: 'taches',
      data: { id: '11111111-1111-4111-8111-111111111111', titre: 'Tâche normale', statut: 'a_faire' },
    },
  ];
}

test('une tâche désalignée (data.id ≠ id) redevient MODIFIABLE', async () => {
  const lignes = baseAvecTacheDesalignee();
  globalThis.__fauxSupabase = fauxSupabase(lignes).client;

  // L'écran ne connaît que data.id — c'est ce qu'il passe.
  const idEcran = lignes[0].data.id;
  const r = await db.taches.update(idEcran, { statut: 'termine' });

  assert.equal(r.statut, 'termine');
  assert.equal(lignes[0].data.statut, 'termine', "la ligne en base n'a pas été modifiée");
  assert.equal(lignes[0].data.id, idEcran, "data.id ne doit pas être réécrit : l'écran le porte");
  assert.equal(lignes[0].id, '4e1c56c5-3e71-42e3-be58-f85dbe316651', 'la colonne id ne bouge pas');
  assert.equal(lignes[1].data.statut, 'a_faire', 'une AUTRE ligne a été touchée');
});

test('getById retrouve une ligne désalignée par son data.id', async () => {
  const lignes = baseAvecTacheDesalignee();
  globalThis.__fauxSupabase = fauxSupabase(lignes).client;
  const t = await db.taches.getById(lignes[0].data.id);
  assert.equal(t?.titre, 'APPELER SingPay au téléphone — accélérer le GoLive');
});

test('le cas normal reste UNE lecture par la colonne id, puis l écriture', async () => {
  const lignes = baseAvecTacheDesalignee();
  const faux = fauxSupabase(lignes);
  globalThis.__fauxSupabase = faux.client;
  await db.taches.update('11111111-1111-4111-8111-111111111111', { statut: 'en_cours' });
  assert.equal(lignes[1].data.statut, 'en_cours');
  assert.deepEqual(faux.journal.map((j) => j.op), ['select', 'update'],
    'une ligne alignée ne doit pas coûter une seconde lecture');
});

test('une ligne VRAIMENT absente lève toujours « ligne introuvable » (règle du 16/09)', async () => {
  const lignes = baseAvecTacheDesalignee();
  globalThis.__fauxSupabase = fauxSupabase(lignes).client;
  await assert.rejects(
    db.taches.update('22222222-2222-4222-8222-222222222222', { statut: 'termine' }),
    (e) => e.estErreurEcriture === true && /introuvable/.test(e.causeTexte || e.message),
  );
});

test("la recherche par data.id reste DANS la collection", async () => {
  const lignes = baseAvecTacheDesalignee();
  lignes.push({
    id: '33333333-3333-4333-8333-333333333333',
    collection: 'notifications_app',
    data: { id: 'meme-id', titre: 'une notification' },
  });
  globalThis.__fauxSupabase = fauxSupabase(lignes).client;
  await assert.rejects(db.taches.update('meme-id', { statut: 'x' }), /introuvable|PAS/);
  assert.equal(lignes[2].data.statut, undefined, 'une ligne d une autre collection a été modifiée');
});

test('deux lignes au même data.id : aucune n est choisie, la modification lève', async () => {
  const lignes = baseAvecTacheDesalignee();
  lignes.push({ id: '44444444-4444-4444-8444-444444444444', collection: 'taches', data: { id: 'double' } });
  lignes.push({ id: '55555555-5555-4555-8555-555555555555', collection: 'taches', data: { id: 'double' } });
  globalThis.__fauxSupabase = fauxSupabase(lignes).client;
  await assert.rejects(db.taches.update('double', { statut: 'x' }));
  assert.equal(lignes[2].data.statut, undefined);
  assert.equal(lignes[3].data.statut, undefined);
});

test('une ligne désalignée se SUPPRIME vraiment (avant : succès annoncé, rien parti)', async () => {
  const lignes = baseAvecTacheDesalignee();
  globalThis.__fauxSupabase = fauxSupabase(lignes).client;
  await db.taches.delete(lignes[0].data.id);
  assert.equal(lignes.length, 1);
  assert.equal(lignes[0].data.titre, 'Tâche normale', 'la mauvaise ligne a été supprimée');
});

test('db.create pose le même identifiant aux deux endroits', async () => {
  const lignes = [];
  globalThis.__fauxSupabase = fauxSupabase(lignes).client;
  const cree = await db.taches.create({ titre: 'nouvelle' });
  assert.equal(lignes.length, 1);
  assert.equal(lignes[0].id, cree.id);
  assert.equal(lignes[0].data.id, cree.id);
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. LE GARDE-FOU : AUCUNE INSERTION DANS app_data SANS ligneAppData()
   ═══════════════════════════════════════════════════════════════════════════ */

/** Valeur littérale d'une constante `const NOM = 'valeur'` du fichier, ou null. */
function valeurConstante(source, nom) {
  const m = new RegExp(`const\\s+${nom}\\s*=\\s*['"]([^'"]+)['"]`).exec(source);
  return m ? m[1] : null;
}

/**
 * L'argument est `ligneAppData(...)`, ou une variable affectée UNE seule fois,
 * par `const X = ligneAppData(`.
 */
function passeParLigneAppData(source, argument) {
  if (argument.startsWith('ligneAppData(')) return true;
  const nom = /^([A-Za-z_$][\w$]*)\s*\)/.exec(argument)?.[1];
  if (!nom) return false;
  return new RegExp(`const\\s+${nom}\\s*=\\s*ligneAppData\\(`).test(source);
}

/**
 * Chaque `.insert(` / `.upsert(` du fichier : quelle table vise-t-il, et son
 * argument passe-t-il par `ligneAppData(` ? La table est lue sur le dernier
 * `.from(...)` qui précède. Une table qu'on ne sait pas résoudre est SUSPECTE :
 * le garde-fou échoue plutôt que de supposer.
 *
 * @returns {string[]} les fautes, lisibles
 */
function insertionsFautives(source, nomFichier = 'source') {
  const fautes = [];
  const re = /\.(insert|upsert)\(\s*/g;
  let m;
  while ((m = re.exec(source))) {
    const avant = source.slice(0, m.index);
    const ligne = avant.split('\n').length;
    const depuis = avant.lastIndexOf('.from(');
    if (depuis === -1) continue; // pas un appel Supabase (ex. Array/Set)
    const arg = /^\.from\(\s*([^)]*?)\s*\)/.exec(avant.slice(depuis))?.[1] || '';
    let table = null;
    const litteral = /^['"`]([^'"`]+)['"`]$/.exec(arg);
    if (litteral) table = litteral[1];
    else if (/^[A-Za-z_$][\w$]*$/.test(arg)) table = valeurConstante(source, arg);
    const argument = source.slice(m.index + m[0].length);
    if (table === null) {
      fautes.push(`${nomFichier}:${ligne} — .${m[1]}() sur une table non résolue (${arg || '?'})`);
    } else if (table === 'app_data' && !passeParLigneAppData(source, argument)) {
      fautes.push(`${nomFichier}:${ligne} — .${m[1]}() dans app_data sans ligneAppData() : la colonne id et data.id peuvent diverger`);
    }
  }
  return fautes;
}

function fichiersJs(dossier) {
  const sortie = [];
  for (const nom of readdirSync(dossier)) {
    if (nom === 'node_modules' || nom === 'dist') continue;
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) sortie.push(...fichiersJs(chemin));
    else if (/\.(m?js|jsx)$/.test(nom) && !/\.test\./.test(nom)) sortie.push(chemin);
  }
  return sortie;
}

test('le garde-fou reconnaît l ancien motif (sinon il ne garde rien)', () => {
  const ancien = `
    await supabase.from('app_data').insert({
      id: crypto.randomUUID(),
      collection: 'paiements_singpay',
      data: { id: crypto.randomUUID(), status: 'pending' },
    });`;
  assert.equal(insertionsFautives(ancien).length, 1);

  const viaConstante = `const TABLE = 'app_data';\n sb.from(TABLE).insert({ id, collection: 'x', data });`;
  assert.equal(insertionsFautives(viaConstante).length, 1);

  const inconnue = `sb.from(nomDeTable).insert({ a: 1 });`;
  assert.equal(insertionsFautives(inconnue).length, 1, 'une table non résolue doit être signalée');

  const correct = `await supabase.from('app_data').insert(ligneAppData({ collection: 'x', data }));`;
  assert.deepEqual(insertionsFautives(correct), []);

  const parVariable = `const ligne = ligneAppData({ collection: 'x', data });\n sb().from('app_data').insert(ligne);`;
  assert.deepEqual(insertionsFautives(parVariable), []);
  const variableFaiteMain = `const ligne = { id: a, collection: 'x', data: { id: b } };\n sb().from('app_data').insert(ligne);`;
  assert.equal(insertionsFautives(variableFaiteMain).length, 1);

  const autreTable = `await sb().from('auth_credentials').upsert({ employe_id: 1 });`;
  assert.deepEqual(insertionsFautives(autreTable), []);
});

test('aucun fichier du dépôt n insère dans app_data sans ligneAppData()', () => {
  const fautes = [];
  let vus = 0;
  for (const dossier of ['api', 'src', 'scripts']) {
    for (const fichier of fichiersJs(join(RACINE, dossier))) {
      const source = readFileSync(fichier, 'utf8');
      if (!/\.(insert|upsert)\(/.test(source)) continue;
      vus += 1;
      fautes.push(...insertionsFautives(source, relative(RACINE, fichier)));
    }
  }
  assert.ok(vus >= 7, `le parcours n'a vu que ${vus} fichiers écrivains — il ne regarde plus au bon endroit`);
  assert.deepEqual(fautes, []);
});

/**
 * Le SQL aussi : c'est un INSERT SQL à deux `gen_random_uuid()` qui a fabriqué
 * la tâche du 18/09. Tout `INSERT INTO app_data` d'un fichier du dépôt doit
 * poser `'id'` dans le JSON.
 *
 * Seule exception, nommée : l'archive de la migration 011. Ses lignes ne sont
 * lues par aucun écran (aucune entrée `db.*`), elles se retrouvent par
 * `ligne_origine`, et la migration a déjà été jouée.
 */
const EXCEPTIONS_SQL = new Set(['migrations/011_photos_catalogue_vers_storage.sql']);

test('aucun INSERT SQL dans app_data sans id dans le JSON', () => {
  const fichiers = [
    ...readdirSync(join(RACINE, 'migrations')).filter((n) => n.endsWith('.sql')).map((n) => `migrations/${n}`),
    ...readdirSync(RACINE).filter((n) => n.endsWith('.sql')),
  ];
  const fautes = [];
  for (const rel of fichiers) {
    if (EXCEPTIONS_SQL.has(rel)) continue;
    // Les commentaires ne s'exécutent pas.
    const sql = readFileSync(join(RACINE, rel), 'utf8').replace(/--[^\n]*/g, '');
    for (const bloc of sql.split(';')) {
      if (!/INSERT\s+INTO\s+app_data\b/i.test(bloc)) continue;
      if (!/'id'\s*,/.test(bloc)) fautes.push(`${rel} — INSERT INTO app_data sans 'id' dans data`);
    }
  }
  assert.deepEqual(fautes, []);
});
