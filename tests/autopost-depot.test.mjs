/**
 * Auto-poster — L'ADAPTATEUR SUPABASE DE LA FILE.
 *
 * ── Pourquoi ce fichier existe ────────────────────────────────────────────
 *
 * `autopost-alimentation.js` et `autopost-executeur.js` sont testés contre un
 * dépôt en mémoire : c'est ce qui les rend testables sans base. Mais la vraie
 * sécurité de cette chaîne n'est pas dans leur logique — elle est dans la forme
 * exacte des requêtes que CET adaptateur envoie :
 *
 *   - un UPDATE qui oublierait `.in('etat', …)` réécrirait une publication
 *     pendant qu'elle part ;
 *   - un INSERT qui traiterait `23505` comme une panne ferait échouer le
 *     passage entier alors que le doublon est précisément ce qu'on voulait
 *     empêcher ;
 *   - une lecture d'écran qui ne rapporterait pas `url_media` laisserait
 *     croire au gérant qu'une file pleine est une file prête.
 *
 * Aucun de ces trois défauts ne se voit dans un dépôt en mémoire. Ils se voient
 * ici.
 *
 * ⛔ ZÉRO RÉSEAU : le client Supabase est une doublure qui enregistre la
 *    requête construite au lieu de l'envoyer.
 *
 * Lancer :  node --test tests/autopost-depot.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { depotSupabaseAutopost } from '../api/_lib/autopost-depot.js';
import { ETATS_MODIFIABLES } from '../api/_lib/autopost-alimentation.js';

/**
 * Doublure du client Supabase. Les vrais constructeurs de requête sont
 * « thenable » : on reproduit ça, et on garde la requête construite.
 */
function supabaseFactice(reponse = { data: [], error: null }) {
  const requetes = [];
  return {
    requetes,
    from(table) {
      const req = { table, op: null, colonnes: null, donnees: null, filtres: [] };
      requetes.push(req);
      const chaine = {
        select(c) { req.colonnes = c; req.op = req.op || 'select'; return chaine; },
        insert(d) { req.op = 'insert'; req.donnees = d; return chaine; },
        update(d) { req.op = 'update'; req.donnees = d; return chaine; },
        eq(c, v) { req.filtres.push(['eq', c, v]); return chaine; },
        in(c, v) { req.filtres.push(['in', c, v]); return chaine; },
        is(c, v) { req.filtres.push(['is', c, v]); return chaine; },
        order() { return chaine; },
        limit() { return chaine; },
        then(resoudre, rejeter) {
          return Promise.resolve(typeof reponse === 'function' ? reponse(req) : reponse)
            .then(resoudre, rejeter);
        },
      };
      return chaine;
    },
  };
}

const filtre = (req, type, colonne) => req.filtres.find(([t, c]) => t === type && c === colonne);

test('lireLignesDePublications interroge par publication_id, toutes versions et tous états', async () => {
  const supabase = supabaseFactice({ data: [], error: null });
  await depotSupabaseAutopost(supabase).lireLignesDePublications(['PUB-A', 'PUB-B', 'PUB-A']);

  const req = supabase.requetes[0];
  assert.equal(req.table, 'autopost_file');
  assert.deepEqual(filtre(req, 'in', 'publication_id')[2], ['PUB-A', 'PUB-B'], 'les doublons sont ôtés');
  assert.equal(filtre(req, 'eq', 'etat'), undefined,
    'filtrer par état masquerait justement les lignes déjà parties, qu on cherche à voir');
});

test('une liste vide ne part pas en base du tout', async () => {
  const supabase = supabaseFactice();
  const rendu = await depotSupabaseAutopost(supabase).lireLignesDePublications([]);
  assert.deepEqual(rendu, []);
  assert.equal(supabase.requetes.length, 0, 'aucune requête ne doit sortir pour une liste vide');
});

test('⛔ un refus d unicité (23505) est un « quelqu un l a déjà fait », pas une panne', async () => {
  const supabase = supabaseFactice({ data: null, error: { code: '23505', message: 'duplicate key' } });
  const issue = await depotSupabaseAutopost(supabase).inserer({ cle_idempotence: 'K' });
  assert.deepEqual(issue, { insere: false, conflit: true });
});

test('⛔ toute AUTRE erreur d insertion est levée — on ne l avale pas', async () => {
  const supabase = supabaseFactice({ data: null, error: { code: '42P01', message: 'relation does not exist' } });
  await assert.rejects(
    () => depotSupabaseAutopost(supabase).inserer({ cle_idempotence: 'K' }),
    /relation does not exist/,
  );
});

test('⛔ la mise à jour depuis le dépôt est CONDITIONNELLE : état modifiable ET aucun témoin', async () => {
  const supabase = supabaseFactice({ data: [{ cle_idempotence: 'K' }], error: null });
  const fait = await depotSupabaseAutopost(supabase).mettreAJourDepuisDepot('K', { legende: 'neuve' });

  const req = supabase.requetes[0];
  assert.equal(fait, true);
  assert.equal(req.op, 'update');
  assert.equal(filtre(req, 'eq', 'cle_idempotence')[2], 'K');
  assert.deepEqual(filtre(req, 'in', 'etat')[2], [...ETATS_MODIFIABLES],
    'sans ce filtre, on réécrit une publication pendant qu elle part');
  assert.deepEqual(filtre(req, 'is', 'id_distant')[2], null,
    'sans ce filtre, on réécrit une publication déjà partie');
});

test('une mise à jour qui ne mord sur aucune ligne rend false — elle ne ment pas', async () => {
  const supabase = supabaseFactice({ data: [], error: null });
  assert.equal(await depotSupabaseAutopost(supabase).mettreAJourDepuisDepot('K', {}), false);
});

test('⛔ l annulation porte les mêmes deux conditions, et pose bien « cancelled »', async () => {
  const supabase = supabaseFactice({ data: [{ cle_idempotence: 'K' }], error: null });
  await depotSupabaseAutopost(supabase).annulerLigne('K', { code_erreur: 'remplacee' });

  const req = supabase.requetes[0];
  assert.equal(req.donnees.etat, 'cancelled');
  assert.deepEqual(filtre(req, 'in', 'etat')[2], [...ETATS_MODIFIABLES]);
  assert.deepEqual(filtre(req, 'is', 'id_distant')[2], null);
});

test('🔴 la lecture d écran rapporte url_media : une file pleine n est pas une file prête', async () => {
  const supabase = supabaseFactice({ data: [], error: null });
  await depotSupabaseAutopost(supabase).lireEtatComplet();
  assert.match(supabase.requetes[0].colonnes, /url_media/,
    'sans cette colonne, l écran ne peut pas dire que rien ne peut partir');
});

/* ═══════════════════════════════════════════════════════════════════════════
   LE RÉGLAGE « APPROBATION AUTOMATIQUE » — LU SANS EXIGER LA MIGRATION 014

   Le code part AVANT que la colonne n'existe. Une lecture qui exigerait
   `approbation_automatique` ferait échouer la lecture de l'interrupteur, donc
   le passage entier, donc la PUBLICATION. Ces trois tests tiennent ça.
   ═══════════════════════════════════════════════════════════════════════════ */

test('lireReglages demande approbation_automatique et rend ce que la base porte', async () => {
  const supabase = supabaseFactice({
    data: [{ actif: true, mode: 'live', plafond_journalier: 4, approbation_automatique: false }],
    error: null,
  });
  const r = await depotSupabaseAutopost(supabase).lireReglages();

  assert.match(supabase.requetes[0].colonnes, /approbation_automatique/);
  assert.equal(r.approbation_automatique, false, 'un false en base doit gagner sur le défaut du code');
  assert.equal(r.reglage_approbation, 'en_base');
  assert.equal(r.actif, true, 'le reste de la ligne de contrôle est inchangé');
});

test('⛔ colonne absente (migration 014 non appliquée) : on relit SANS elle, on ne tombe pas', async () => {
  let appel = 0;
  const supabase = supabaseFactice(() => {
    appel += 1;
    // 42703 = undefined_column. Le premier appel le rend, le second réussit.
    if (appel === 1) return { data: null, error: { code: '42703', message: 'column autopost_controle.approbation_automatique does not exist' } };
    return { data: [{ actif: false, mode: 'dry_run', plafond_journalier: 4 }], error: null };
  });
  const r = await depotSupabaseAutopost(supabase).lireReglages();

  assert.equal(appel, 2, 'la lecture doit être retentée sans la colonne');
  assert.equal(r.approbation_automatique, true, 'le défaut du code s applique');
  assert.equal(r.reglage_approbation, 'colonne_absente',
    'l écran doit pouvoir dire « défaut appliqué » plutôt qu un réglage imaginaire');
  assert.equal(r.actif, false, 'et l interrupteur reste lisible : c est tout l intérêt');
});

test('⛔ une AUTRE erreur de lecture est levée — on ne la confond pas avec la colonne manquante', async () => {
  const supabase = supabaseFactice({ data: null, error: { code: '42P01', message: 'relation does not exist' } });
  await assert.rejects(
    () => depotSupabaseAutopost(supabase).lireReglages(),
    /relation does not exist/,
  );
});

test('lireArretGlobal et lireReglages lisent la MÊME ligne — deux noms, un seul état', async () => {
  const supabase = supabaseFactice({
    data: [{ actif: true, mode: 'live', plafond_journalier: 7, approbation_automatique: true }],
    error: null,
  });
  const depot = depotSupabaseAutopost(supabase);
  assert.deepEqual(await depot.lireArretGlobal(), await depot.lireReglages(),
    'deux vérités sur le même interrupteur, ce serait une de trop');
});
