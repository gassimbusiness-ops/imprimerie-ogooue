/**
 * Devis, facture, bon de livraison — le papier remis au client.
 *
 * Avant le 24/09/2026, `exportDocument()` (src/services/export-pdf.js)
 * imprimait, quel que soit le type :
 *   - « FACTURE N°… » en haut à droite — un DEVIS sortait donc intitulé facture ;
 *   - « Livré le … » — sur un devis, qui n'est pas livré ;
 *   - « BON DE LIVRAISON » à gauche d'une facture, en plus de « FACTURE N° » :
 *     trois titres contradictoires sur la même feuille ;
 *   - « Arrêté la présente proforma » sur un devis.
 *
 * Modèle de référence : le devis papier du dirigeant (DEVIS MUG SODIM,
 * 09/09/2026) — `DEVIS N°152/09/26/GA`, la date à droite, « Le Responsable »
 * puis « M. Ibrahim Abakar ». Le modèle écrit « Arrêté la présente facture »
 * sur un devis : c'est une erreur, et ce test interdit de la recopier.
 *
 * On regarde le document PRODUIT (le HTML écrit dans l'iframe d'impression),
 * pas la source.
 *
 * Lancer :  node --test tests/document-devis-facture.test.mjs
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RACINE = resolve(fileURLToPath(new URL('..', import.meta.url)));

/* ── Harnais : compile export-pdf.js comme Vite, capture l'iframe d'impression ── */

// La PROMESSE est mémorisée, pas le module : deux tests qui chargent en même
// temps partagent la même compilation.
let chargement = null;
let nettoyer = null;
function chargerExportPdf() {
  chargement ||= (async () => {
    const dossier = await mkdtemp(join(RACINE, '.tmp-document-devis-'));
    nettoyer = () => rm(dossier, { recursive: true, force: true });
    const sortie = join(dossier, 'export-pdf.mjs');
    await build({
      entryPoints: [resolve(RACINE, 'src/services/export-pdf.js')],
      outfile: sortie,
      bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
      logLevel: 'silent', loader: { '.js': 'jsx' },
      alias: { '@': resolve(RACINE, 'src') },
    });
    return import(pathToFileURL(sortie).href);
  })();
  return chargement;
}
after(async () => { await nettoyer?.(); });

/**
 * Rend le document imprimé : `{ titre, html, texte }`.
 * `texte` est le texte visible, espaces et `&nbsp;` normalisés — mais PAS
 * l'espace fine insécable des milliers (U+202F), gardée pour qu'on la teste.
 */
async function imprimer(doc, lignes, type) {
  const mod = await chargerExportPdf();
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://exemple.test/', pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
  });
  const w = dom.window;
  const anciens = {};
  const globales = { window: w, document: w.document, navigator: w.navigator, localStorage: w.localStorage };
  for (const [k, val] of Object.entries(globales)) {
    anciens[k] = globalThis[k];
    try { globalThis[k] = val; } catch { /* globale non inscriptible */ }
  }
  try {
    mod.exportDocument(doc, lignes, type);
    const d = w.document.querySelector('iframe')?.contentDocument;
    assert.ok(d, 'aucun document imprimé : le test ne prouverait rien');
    const texte = (d.body.textContent || '').replace(/[ \t\n\r ]+/g, ' ').trim();
    return { titre: d.title, html: d.documentElement.innerHTML, texte };
  } finally {
    for (const [k, val] of Object.entries(anciens)) {
      try { globalThis[k] = val; } catch { /* globale non inscriptible */ }
    }
    w.close();
  }
}

/* ── Les données exactes du modèle papier ── */

const MUGS = [{ description: 'Mug', quantite: 10, prix_unitaire: 4000 }];
const DOC_MODELE = {
  numero: 'DEV-0152', client_nom: 'Gabon Industries', objet: 'Impression support', date: '2026-09-09',
};

/* ═══ 1. DEVIS ═══════════════════════════════════════════════════════════ */

test('devis — titre « DEVIS N°152/09/26/GA » et la date à droite, comme le modèle', async () => {
  const { titre, texte } = await imprimer(DOC_MODELE, MUGS, 'devis');
  assert.match(texte, /DEVIS N°152\/09\/26\/GA 09\/09\/2026/);
  assert.equal(titre, 'Devis DEV-0152');
  assert.match(texte, /CLIENT : GABON INDUSTRIES/);
  assert.match(texte, /Objet : Impression support/);
});

test('devis — jamais intitulé facture ni bon de livraison, jamais « Livré le »', async () => {
  const { texte } = await imprimer(DOC_MODELE, MUGS, 'devis');
  assert.ok(!/FACTURE/i.test(texte.replace(/imprimerieogooue/g, '')), 'un devis porte le mot « facture » : ' + texte.slice(0, 200));
  assert.ok(!/BON DE LIVRAISON/i.test(texte), 'un devis porte « bon de livraison »');
  assert.ok(!/Livré le/.test(texte), 'un devis n\'est pas livré : « Livré le » ne doit pas y figurer');
  assert.ok(!/Reçu par/.test(texte), 'le modèle de devis n\'a pas de case « Reçu par »');
});

test('devis — « Arrêté le présent devis », ni l\'erreur du modèle ni « proforma »', async () => {
  const { texte } = await imprimer(DOC_MODELE, MUGS, 'devis');
  assert.match(texte, /Arrêté le présent devis à la somme de quarante mille Francs CFA\./);
  assert.ok(!/présente facture/.test(texte), 'l\'erreur du modèle papier a été recopiée');
  assert.ok(!/proforma/i.test(texte));
});

test('devis — la validité de l\'offre est imprimée, et suit la constante', async () => {
  const mod = await chargerExportPdf();
  const { texte } = await imprimer(DOC_MODELE, MUGS, 'devis');
  assert.equal(mod.VALIDITE_DEVIS_JOURS, 30);
  assert.match(texte, new RegExp(`Validité de l'offre : ${mod.VALIDITE_DEVIS_JOURS} jours`));
});

test('devis — « Le Responsable » puis le nom du signataire', async () => {
  const mod = await chargerExportPdf();
  const { texte } = await imprimer(DOC_MODELE, MUGS, 'devis');
  assert.equal(mod.SIGNATAIRE_DOCUMENTS, 'M. Ibrahim Abakar');
  assert.match(texte, /Le Responsable M\. Ibrahim Abakar/);
});

/* ═══ 2. FACTURE ═════════════════════════════════════════════════════════ */

const FACTURE = { ...DOC_MODELE, numero: 'FAC-0152' };

test('facture — un seul titre : « FACTURE N°152/09/26/GA », sans « BON DE LIVRAISON »', async () => {
  const { titre, texte } = await imprimer(FACTURE, MUGS, 'facture');
  assert.match(texte, /FACTURE N°152\/09\/26\/GA 09\/09\/2026/);
  assert.equal(titre, 'Facture FAC-0152');
  assert.ok(!/BON DE LIVRAISON/i.test(texte), 'trois titres contradictoires sur une facture');
  assert.ok(!/DEVIS/.test(texte));
  assert.ok(!/Livré le/.test(texte), '« Livré le » imprimait la date de la facture, pas une date de livraison');
});

test('facture — « Arrêtée la présente facture » (accord au féminin), sans validité', async () => {
  const { texte } = await imprimer(FACTURE, MUGS, 'facture');
  assert.match(texte, /Arrêtée la présente facture à la somme de quarante mille Francs CFA\./);
  assert.ok(!/Validité/.test(texte), 'une facture ne porte pas de durée de validité');
  assert.match(texte, /Le Responsable M\. Ibrahim Abakar/);
});

/* ═══ 3. BON DE LIVRAISON ════════════════════════════════════════════════ */

test('bon de livraison — son propre titre, « Livré le », et le bon accord', async () => {
  const { titre, texte } = await imprimer({ ...DOC_MODELE, numero: 'BL-0031' }, MUGS, 'bon_livraison');
  assert.match(texte, /BON DE LIVRAISON N°31\/09\/26\/GA 09\/09\/2026/);
  assert.equal(titre, 'Bon de livraison BL-0031');
  assert.ok(!/FACTURE N°|DEVIS N°/.test(texte));
  assert.match(texte, /Livré le 09\/09\/2026/);
  assert.match(texte, /Arrêté le présent bon de livraison à la somme de/);
  assert.match(texte, /Reçu par :/);
  assert.ok(!/Validité/.test(texte));
});

test('bon de livraison — « Livré le » suit la date de livraison quand elle existe', async () => {
  const { texte } = await imprimer(
    { ...DOC_MODELE, numero: 'BL-0031', date_livraison: '2026-09-11' }, MUGS, 'bon_livraison',
  );
  assert.match(texte, /BON DE LIVRAISON N°31\/09\/26\/GA 09\/09\/2026/);
  assert.match(texte, /Livré le 11\/09\/2026/);
});

/* ═══ 4. NUMÉRO : mois et année DE LA DATE DU DOCUMENT ═══════════════════ */

test('numéro — un document de décembre imprimé en janvier reste « /12/26/ »', async (t) => {
  // L'horloge est au 2 janvier 2027 : `todayISO()` rendrait 2027-01-02.
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2027-01-02T09:00:00Z') });
  const { texte } = await imprimer(
    { numero: 'FAC-0007', client_nom: 'X', date: '2026-12-31', created_at: '2027-01-02T08:00:00Z' },
    MUGS, 'facture',
  );
  assert.match(texte, /FACTURE N°7\/12\/26\/GA 31\/12\/2026/);
  assert.ok(!/\/01\/27\//.test(texte), 'le numéro a pris le mois d\'impression au lieu de celui du document');
});

test('numéro — sans `date`, c\'est le jour À MOANDA de `created_at` qui compte', async () => {
  // 23 h 30 UTC le 31/12 = 00 h 30 le 1er janvier à Moanda.
  const { texte } = await imprimer(
    { numero: 'DEV-0001', client_nom: 'X', created_at: '2026-12-31T23:30:00Z' }, MUGS, 'devis',
  );
  assert.match(texte, /DEVIS N°1\/01\/27\/GA 01\/01\/2027/);
});

test('numéro — affichage seulement : préfixe et zéros de tête retirés, le reste gardé entier', async () => {
  const { numeroDocumentImprime: n } = await chargerExportPdf();
  assert.equal(n('DEV-0152', 'devis', '2026-09-09'), 'N°152/09/26/GA');
  assert.equal(n('FAC-0152', 'facture', '2026-09-09'), 'N°152/09/26/GA');
  assert.equal(n('152', 'devis', '2026-09-09'), 'N°152/09/26/GA');
  assert.equal(n('DEV-0000', 'devis', '2026-09-09'), 'N°0/09/26/GA');
  // Une commande imprimée faute de facture garde son numéro : le réduire à
  // ses chiffres le ferait passer pour un numéro de facture.
  assert.equal(n('CMD-K3F9A2', 'facture', '2026-09-09'), 'N°CMD-K3F9A2/09/26/GA');
  // Un préfixe d'un AUTRE type n'est pas retiré.
  assert.equal(n('DEV-0152', 'facture', '2026-09-09'), 'N°DEV-0152/09/26/GA');
  // Date illisible : pas de mois inventé.
  assert.equal(n('DEV-0152', 'devis', 'n/a'), 'N°152/GA');
});

/* ═══ 5. MONTANTS ET EN-TÊTE ═════════════════════════════════════════════ */

test('montants — séparateur de milliers partout (4 000, 40 000 FCFA), jamais « 40000 »', async () => {
  const { texte } = await imprimer(DOC_MODELE, MUGS, 'devis');
  const esp = '[\\u202f\\u00a0 ]';
  assert.match(texte, new RegExp(`Mug 10 4${esp}000 40${esp}000`));
  assert.match(texte, new RegExp(`TOTAL GENERAL 40${esp}000 FCFA`));
  assert.ok(!/\b(4000|40000)\b/.test(texte), 'un montant sans séparateur de milliers');
});

test('en-tête — les deux numéros du pied, plus le « (+241) 60 44 46 34 » isolé', async () => {
  const { texte } = await imprimer(DOC_MODELE, MUGS, 'devis');
  assert.match(texte, /Adresse : Carrefour Fina, Moanda, Gabon Tél : 060 44 46 34 \/ 074 42 41 42/);
  assert.ok(!/\(\+241\)/.test(texte));
  assert.match(texte, /Objets publicitaires & personnalisation sur mesure/);
});

test('les trois types — ni « undefined » ni « NaN » sur un document minimal', async () => {
  for (const type of ['devis', 'facture', 'bon_livraison']) {
    const { texte } = await imprimer({ id: 'abcdef123456', created_at: '2026-09-09T10:00:00Z' }, [{}], type);
    assert.ok(!/undefined|NaN/.test(texte), `${type} : ${texte.slice(0, 200)}`);
  }
});


/* ═══ LA REMISE — le défaut qui avait mordu sur un vrai client ═══════════
   Mesuré en base le 24/09/2026 : FAC-0003, client SNEEM, remise 2 000 F.
   L'écran affichait 94 000 F ; le PDF imprimait 96 000 F, parce qu'il
   recalculait la somme des lignes sans jamais lire `remise`. Un document
   remis au client réclamait 2 000 F de plus que ce qui avait été convenu.
   Ces tests rejouent ce cas exact. */

const SNEEM = [
  { description: 'Impression', quantite: 1, prix_unitaire: 96000 },
];

test('remise — le total imprimé est celui de l\'écran : sous-total moins remise (rejeu FAC-0003 SNEEM)', async () => {
  const { texte } = await imprimer(
    { numero: 'FAC-0003', client_nom: 'SNEEM', date: '2026-09-10', remise: 2000 },
    SNEEM, 'facture',
  );
  assert.match(texte, /TOTAL GENERAL 94 000 FCFA/, 'le total général doit être 94 000, pas 96 000 : ' + texte.slice(0, 400));
  assert.ok(!/TOTAL GENERAL 96 000/.test(texte), 'le total ignore encore la remise — le client paierait 2 000 F de trop');
});

test('remise — le client voit le calcul : sous-total, remise, puis total', async () => {
  const { texte } = await imprimer(
    { numero: 'FAC-0003', client_nom: 'SNEEM', date: '2026-09-10', remise: 2000 },
    SNEEM, 'facture',
  );
  assert.match(texte, /SOUS-TOTAL 96 000/);
  assert.match(texte, /REMISE − 2 000/);
  const iSous = texte.indexOf('SOUS-TOTAL');
  const iRemise = texte.indexOf('REMISE');
  const iTotal = texte.indexOf('TOTAL GENERAL');
  assert.ok(iSous < iRemise && iRemise < iTotal, 'l\'ordre doit être sous-total, remise, total');
});

test('remise — la somme en lettres porte le total APRÈS remise', async () => {
  const { texte } = await imprimer(
    { numero: 'FAC-0003', client_nom: 'SNEEM', date: '2026-09-10', remise: 2000 },
    SNEEM, 'facture',
  );
  assert.match(texte, /à la somme de quatre-vingt-quatorze mille/i,
    'la somme en lettres doit dire 94 000 — une facture où chiffres et lettres divergent ne vaut rien');
});

test('remise — sans remise, aucune ligne de sous-total ni de remise ne s\'imprime', async () => {
  const { texte } = await imprimer(DOC_MODELE, MUGS, 'devis');
  assert.ok(!/SOUS-TOTAL/.test(texte), 'une ligne de sous-total alourdit un document sans remise');
  assert.ok(!/REMISE/.test(texte));
  assert.match(texte, /TOTAL GENERAL 40 000 FCFA/);
});

test('remise — une remise négative ou illisible ne peut pas GONFLER le total', async () => {
  for (const remise of [-5000, 'abc', null, undefined]) {
    const { texte } = await imprimer({ ...DOC_MODELE, remise }, MUGS, 'devis');
    assert.match(texte, /TOTAL GENERAL 40 000 FCFA/, `remise=${remise} a changé le total`);
  }
});
