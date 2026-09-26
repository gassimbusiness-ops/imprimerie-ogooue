/**
 * LA SAUVEGARDE COMPLÈTE — ce que la base contient, pas ce qu'une liste en dit.
 *
 * Mesuré le 26/09/2026 : l'export de l'écran Paramètres ne sauvegardait ni le
 * journal (`audit_logs`, 3 438 lignes), ni le stock (`mouvements_stock` — la
 * liste disait `stocks`, qui n'existe pas), ni le catalogue ; il exportait les
 * paiements SingPay VIDES (`db.paiements_singpay` n'existe pas, le `catch`
 * rendait `[]`) ; et une coupure réseau aurait produit un fichier d'apparence
 * complète, et vide.
 *
 * Ces tests chargent le VRAI src/services/sauvegarde.js, avec une base en
 * mémoire qui APPLIQUE filtres, tri et pages — une doublure qui se contente de
 * noter la requête ne verrait pas une troncature.
 *
 * Lancer : node --test tests/sauvegarde.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RACINE = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function chargerSauvegarde() {
  const dossier = mkdtempSync(join(tmpdir(), 'sauvegarde-'));
  const sortie = join(dossier, 'sauvegarde.mjs');
  await build({
    entryPoints: [join(RACINE, 'src/services/sauvegarde.js')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    outfile: sortie,
    logLevel: 'silent',
    plugins: [{
      name: 'doublures',
      setup(b) {
        b.onResolve({ filter: /^\.\/supabase$/ }, (a) => ({ path: a.path, namespace: 'doublure' }));
        b.onLoad({ filter: /.*/, namespace: 'doublure' }, () => ({
          contents: 'export const USE_SUPABASE = true; export const supabase = null;',
          loader: 'js',
        }));
      },
    }],
  });
  writeFileSync(join(dossier, 'package.json'), '{"type":"module"}');
  const mod = await import(pathToFileURL(sortie).href);
  setTimeout(() => rmSync(dossier, { recursive: true, force: true }), 0);
  return mod;
}

/** Base en mémoire : `app_data(id, collection, data)`, avec pagination réelle. */
function baseEnMemoire(lignes, { plafond = 1000, enPanne = [] } = {}) {
  return {
    from() {
      let res = [...lignes];
      let colonnes = '*';
      let collectionDemandee = null;
      const chaine = {
        select(c) { colonnes = c; return chaine; },
        eq(c, v) { if (c === 'collection') collectionDemandee = v; res = res.filter((l) => l[c] === v); return chaine; },
        order(c) { res.sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0)); return chaine; },
        range(de, a) {
          // PostgREST : jamais plus que `plafond` lignes, quoi qu'on demande.
          const fin = Math.min(a + 1, de + plafond);
          const page = res.slice(de, fin).map((l) => (colonnes === 'collection'
            ? { collection: l.collection } : { data: l.data }));
          const erreur = collectionDemandee && enPanne.includes(collectionDemandee)
            ? { message: 'Failed to fetch' } : null;
          return Promise.resolve(erreur ? { data: null, error: erreur } : { data: page, error: null });
        },
      };
      return chaine;
    },
  };
}

function lignes(collection, n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `${collection}-${String(i).padStart(6, '0')}`, collection, data: { id: `${collection}-${i}`, i },
  }));
}

/* ── La composition réelle de la base, relevée le 26/09 (extrait) ── */
const BASE_26_09 = [
  ...lignes('audit_logs', 3438),
  ...lignes('mouvements_stock', 44),
  ...lignes('produits_catalogue', 50),
  ...lignes('paiements_singpay', 3),
  ...lignes('rapports', 245),
  ...lignes('fidelite_clients', 3),
];

test('les collections viennent de la BASE, pas d\'une liste écrite à la main', async () => {
  const { collectionsEnBase } = await chargerSauvegarde();
  const noms = await collectionsEnBase(baseEnMemoire(BASE_26_09));
  for (const oubliee of ['audit_logs', 'mouvements_stock', 'produits_catalogue', 'paiements_singpay', 'fidelite_clients']) {
    assert.ok(noms.includes(oubliee), `${oubliee} manquait à l'ancienne sauvegarde et doit y être`);
  }
});

test('une collection de plus de 1 000 lignes n\'est PAS tronquée (le journal : 3 438)', async () => {
  const { exporterToutesLesCollections } = await chargerSauvegarde();
  const { dump, comptes, erreurs } = await exporterToutesLesCollections({ client: baseEnMemoire(BASE_26_09) });
  assert.deepEqual(erreurs, {});
  assert.equal(comptes.audit_logs, 3438, 'le journal a été tronqué');
  assert.equal(dump.audit_logs.length, 3438);
  assert.equal(new Set(dump.audit_logs.map((d) => d.id)).size, 3438, 'des lignes sont en double ou perdues entre deux pages');
});

test('les paiements SingPay sont exportés AVEC leurs lignes, pas vides', async () => {
  const { exporterToutesLesCollections } = await chargerSauvegarde();
  const { comptes } = await exporterToutesLesCollections({ client: baseEnMemoire(BASE_26_09) });
  assert.equal(comptes.paiements_singpay, 3);
  assert.equal(comptes.mouvements_stock, 44);
});

test('une collection illisible est NOMMÉE comme telle, jamais exportée vide', async () => {
  const { exporterToutesLesCollections } = await chargerSauvegarde();
  const { dump, erreurs, comptes } = await exporterToutesLesCollections({
    client: baseEnMemoire(BASE_26_09, { enPanne: ['mouvements_stock'] }),
  });
  assert.match(erreurs.mouvements_stock, /Failed to fetch/);
  assert.equal(dump.mouvements_stock, undefined,
    'une collection illisible ne doit pas ressembler à une collection vide dans le fichier');
  assert.deepEqual(dump._erreurs, erreurs, 'le fichier lui-même porte la liste des échecs');
  assert.equal(comptes.audit_logs, 3438, 'une panne sur une collection ne doit pas faire perdre les autres');
});

test('le fichier se vérifie lui-même : il porte le nombre de lignes de chaque collection', async () => {
  const { exporterToutesLesCollections } = await chargerSauvegarde();
  const { dump } = await exporterToutesLesCollections({ client: baseEnMemoire(BASE_26_09) });
  for (const [nom, n] of Object.entries(dump._comptes)) {
    assert.equal(dump[nom].length, n, `${nom} : le compte annoncé ne correspond pas aux lignes du fichier`);
  }
});

test('garde-fou : l\'écran Paramètres ne réintroduit ni liste à la main ni erreur changée en liste vide', () => {
  const ecran = readFileSync(join(RACINE, 'src/features/parametres/page.jsx'), 'utf8');
  assert.ok(ecran.includes('exporterToutesLesCollections'), 'l\'export doit passer par src/services/sauvegarde.js');
  assert.ok(!/dump\[\w+\]\s*=\s*\[\]/.test(ecran), 'une erreur transformée en liste vide est revenue');
  assert.ok(!/'paiements_singpay',\s*\n?\s*'notifications_app'/.test(ecran), 'la liste de noms écrite à la main est revenue');
});
