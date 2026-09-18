/**
 * GARDE-FOU — plus aucun horodatage de la base tronqué à la main.
 *
 * ── La seconde famille ────────────────────────────────────────────────────
 *
 * `tests/dates-heure-de-londres.test.mjs` interdit de FABRIQUER une date
 * métier à partir de `toISOString()`. Celui-ci interdit le geste jumeau :
 * TRONQUER un horodatage déjà en base.
 *
 *     commande.created_at?.slice(0, 10)
 *     (mouvement.date || mouvement.created_at || '').slice(0, 10)
 *     client.created_at?.slice(0, 7)
 *
 * `created_at` est un instant UTC. Moanda est à UTC+1 toute l'année : ce qui
 * est horodaté entre 23 h et minuit UTC s'est produit entre 00 h et 01 h
 * heure locale, et ces expressions le datent alors de LA VEILLE. Sur `.slice(0, 7)`,
 * c'est du MOIS précédent.
 *
 * Ce n'est pas théorique. Relevé le 19/09/2026 dans `app_data`
 * (projet `bcwkrrqmjpaohmafcncw`, 4 109 lignes) : 30 lignes tombent dans ce
 * créneau, dont le client `TEST_E2E_NouveauClient2` créé le
 * `2026-05-31T23:31:51.494Z` — c'est-à-dire le 1er JUIN à 00 h 31 à Moanda.
 * « Nouveaux clients ce mois » le comptait en mai.
 *
 * ── Pourquoi la correction a été ajournée une fois ────────────────────────
 *
 * Parce que la correction évidente était PIRE que le défaut.
 * `dateLocaleDepuisInstantUtc()` passe par `msDepuisInstantUtc()`, qui
 * exigeait un `Z` final. Or la base contient trois formes :
 *
 *   `2026-09-18T20:08:56.689Z`          3 975 lignes — `toISOString()`
 *   `2026-09-18T18:14:29.258082+00:00`      1 ligne  — PostgREST
 *   `2026-09-17 21:18:28.025859+00`        18 lignes — `now()::text` en SQL
 *
 * Les deux dernières auraient rendu `null`, donc une case VIDE. Un affichage
 * décalé d'une heure gêne ; un affichage vide fait croire que la donnée
 * n'existe pas.
 *
 * La correction tient donc en deux temps, et c'est l'ordre qui compte :
 *   1. `msDepuisInstantUtc()` accepte désormais les trois formes ;
 *   2. les appelants passent par `dateMetierDepuisHorodatage()`, qui ne peut
 *      pas vider un écran — forme inconnue, on retombe sur les dix premiers
 *      caractères, c'est-à-dire sur le comportement d'avant.
 *
 * Lancer :  node --test tests/dates-horodatage-supabase.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relever, occurrencesDans, formaterReleve } from './outils/detecteur-dates.mjs';
import { rendreEcran } from './outils/rendu-ecran.mjs';
import {
  msDepuisInstantUtc,
  dateLocaleDepuisInstantUtc,
  dateMetierDepuisHorodatage,
  moisMetierDepuisHorodatage,
} from '../src/lib/dates.js';

/* ═══════════════════════════════════════════════════════════════════════════
   1. LES FORMES RÉELLES, RELEVÉES EN BASE — PAS SUPPOSÉES
   ═══════════════════════════════════════════════════════════════════════════ */

test('les trois formes que Supabase rend réellement sont lues', () => {
  // `toISOString()` — le chemin normal, celui de db.create().
  assert.equal(msDepuisInstantUtc('2026-09-18T20:08:56.689Z'), Date.UTC(2026, 8, 18, 20, 8, 56, 689));
  // PostgREST : « T », offset complet, six décimales.
  assert.equal(msDepuisInstantUtc('2026-09-18T18:14:29.258082+00:00'), Date.UTC(2026, 8, 18, 18, 14, 29, 258));
  // `now()::text` : ESPACE au lieu du « T », offset « +00 » sans les minutes.
  assert.equal(msDepuisInstantUtc('2026-09-17 21:18:28.025859+00'), Date.UTC(2026, 8, 17, 21, 18, 28, 25));
});

test('un offset non nul est retiré, pas ignoré', () => {
  assert.equal(msDepuisInstantUtc('2026-09-21T17:30:00+01:00'), Date.UTC(2026, 8, 21, 16, 30, 0));
  assert.equal(msDepuisInstantUtc('2026-09-21T17:30:00+0100'), Date.UTC(2026, 8, 21, 16, 30, 0));
  assert.equal(msDepuisInstantUtc('2026-09-21T09:30:00-08:00'), Date.UTC(2026, 8, 21, 17, 30, 0));
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. LA CHAÎNE AMBIGUË — LA DÉCISION, ET CE QU'ELLE PROTÈGE
   ═══════════════════════════════════════════════════════════════════════════ */

test('⛔ une chaîne SANS fuseau est refusée : on n’en invente pas un', () => {
  // `new Date('2026-06-07 21:19:46')` l'interpréterait dans le fuseau de la
  // MACHINE : 21 h 19 UTC sur Vercel, 20 h 19 UTC dans le navigateur du gérant.
  // Deux instants, deux dates métier. C'est le mécanisme de l'écart de 55 300 F.
  assert.equal(msDepuisInstantUtc('2026-06-07 21:19:46'), null);
  assert.equal(msDepuisInstantUtc('2026-06-07T21:19:46'), null);
  assert.equal(msDepuisInstantUtc('2026-06-07T21:19:46.511'), null);
  // Une date seule n'est pas un instant : c'est une date métier.
  assert.equal(msDepuisInstantUtc('2026-06-07'), null);
  assert.equal(msDepuisInstantUtc(''), null);
  assert.equal(msDepuisInstantUtc('hier matin'), null);
  assert.equal(msDepuisInstantUtc(null), null);
  assert.equal(msDepuisInstantUtc(new Date()), null);
});

test('le refus ne VIDE rien : dateMetierDepuisHorodatage retombe sur l’ancien découpage', () => {
  // C'est tout l'intérêt du passage par cette fonction plutôt que par
  // `dateLocaleDepuisInstantUtc()` en direct.
  assert.equal(dateLocaleDepuisInstantUtc('2026-06-07 21:19:46'), null);
  assert.equal(dateMetierDepuisHorodatage('2026-06-07 21:19:46'), '2026-06-07');
  assert.equal(dateMetierDepuisHorodatage(''), '');
  assert.equal(dateMetierDepuisHorodatage(undefined), '');
});

test('une date métier traverse sans être convertie — on ne lui invente pas d’heure', () => {
  assert.equal(dateMetierDepuisHorodatage('2026-06-07'), '2026-06-07');
  assert.equal(moisMetierDepuisHorodatage('2026-06-07'), '2026-06');
});

test('un horodatage inventé est refusé, pas décalé', () => {
  assert.equal(msDepuisInstantUtc('2026-02-31T10:00:00Z'), null);
  assert.equal(msDepuisInstantUtc('2026-13-01T10:00:00Z'), null);
  assert.equal(msDepuisInstantUtc('2026-09-21T25:00:00Z'), null);
  assert.equal(msDepuisInstantUtc('2026-09-21T10:00:00+99:00'), null);
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. LA CORRECTION, SUR LA LIGNE RÉELLE DE LA BASE
   ═══════════════════════════════════════════════════════════════════════════ */

test('le client créé le 1er juin à 00 h 31 à Moanda n’est plus un client de mai', () => {
  // Ligne réelle : collection `clients`, `TEST_E2E_NouveauClient2`.
  const instant = '2026-05-31T23:31:51.494Z';
  assert.equal(instant.slice(0, 10), '2026-05-31', 'l’ancien découpage datait bien de la veille');
  assert.equal(instant.slice(0, 7), '2026-05', 'et rangeait le client dans le mois précédent');
  assert.equal(dateMetierDepuisHorodatage(instant), '2026-06-01');
  assert.equal(moisMetierDepuisHorodatage(instant), '2026-06');
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. LA VÉRIFICATION QUI COMPTE : UN ÉCRAN MONTÉ POUR DE VRAI
   ═══════════════════════════════════════════════════════════════════════════

   Un test sur la bibliothèque ne dit rien de l'écran. Celui-ci monte « Mes
   Factures & Devis » du portail client avec la forme Supabase à espace — celle
   qui rendait `null` — et vérifie que la date S'AFFICHE. C'est la preuve que
   la correction n'a pas effacé ce qu'elle devait redresser.                  */

/** Monte le portail factures avec une seule facture, et rend son texte. */
async function texteDuPortail(facture) {
  const v = await rendreEcran({
    ecran: 'src/features/client-portal/factures.jsx',
    utilisateur: { id: 'c-1', prenom: 'Ibrahim', nom: 'Abakar', role: 'client' },
    donnees: {
      factures: [{
        id: 'f-1', numero: 'FAC-001', client_id: 'c-1', statut: 'envoyee',
        total_ttc: 25000, ...facture,
      }],
      devis: [],
    },
  });
  try {
    assert.ok(v.texte.includes('FAC-001'), `l’écran n’a pas monté : ${v.texte.slice(0, 200)}`);
    return v.texte;
  } finally {
    await v.demonter();
  }
}

test('rendu — la forme Supabase à espace affiche bien une date, pas une case vide', async () => {
  const texte = await texteDuPortail({ created_at: '2026-06-07 21:19:46.511+00' });
  assert.ok(texte.includes('2026-06-07'), `date absente de l’écran : ${texte}`);
});

test('rendu — la forme PostgREST affiche bien une date, pas une case vide', async () => {
  const texte = await texteDuPortail({ created_at: '2026-09-18T18:14:29.258082+00:00' });
  assert.ok(texte.includes('2026-09-18'), `date absente de l’écran : ${texte}`);
});

test('rendu — une facture de 23 h 31 UTC porte la date du LENDEMAIN à Moanda', async () => {
  const texte = await texteDuPortail({ created_at: '2026-05-31T23:31:51.494Z' });
  assert.ok(texte.includes('2026-06-01'), `l’écran date encore de la veille : ${texte}`);
  assert.ok(!texte.includes('2026-05-31'), 'la date de Londres est encore affichée');
});

test('rendu — le portail Commandes date du LENDEMAIN une commande de 23 h 31 UTC', async () => {
  const v = await rendreEcran({
    ecran: 'src/features/client-portal/commandes.jsx',
    routeur: true,
    utilisateur: { id: 'c-1', prenom: 'Ibrahim', nom: 'Abakar', role: 'client' },
    donnees: {
      commandes: [{
        id: 'k-1', numero: 'CMD-001', client_id: 'c-1', statut: 'en_attente',
        description: 'Banderole', montant_total: 15000,
        created_at: '2026-05-31T23:31:51.494Z',
      }],
    },
  });
  try {
    assert.ok(v.texte.includes('CMD-001'), `l’écran n’a pas monté : ${v.texte.slice(0, 200)}`);
    assert.ok(v.texte.includes('2026-06-01'), `l’écran date encore de la veille : ${v.texte}`);
  } finally {
    await v.demonter();
  }
});

test('rendu — le tableau de bord client date du LENDEMAIN une facture de 23 h 31 UTC', async () => {
  // ⚠️ La facture est INDISPENSABLE, et pas pour le décor : le bloc
  // « Dernières factures » est conditionné à `factures.length > 0`. Sans elle,
  // l'écran monte très bien avec un `dateMetierDepuisHorodatage` non importé —
  // c'est arrivé pendant ce chantier, et seul `npm run lint` l'a vu. Un écran
  // monté sur des données vides ne prouve pas grand-chose.
  const v = await rendreEcran({
    ecran: 'src/features/client-portal/dashboard.jsx',
    routeur: true,
    utilisateur: { id: 'c-1', prenom: 'Ibrahim', nom: 'Abakar', role: 'client' },
    donnees: {
      factures: [{
        id: 'f-1', numero: 'FAC-007', client_id: 'c-1', statut: 'envoyee',
        total: 30000, created_at: '2026-05-31T23:31:51.494Z',
      }],
    },
  });
  try {
    assert.ok(v.texte.includes('FAC-007'), `le bloc factures ne s’est pas affiché : ${v.texte.slice(0, 300)}`);
    assert.ok(v.texte.includes('2026-06-01'), `l’écran date encore de la veille : ${v.texte}`);
  } finally {
    await v.demonter();
  }
});

/**
 * LES DEUX ÉCRANS DE PILOTAGE MONTENT — ET C'EST UN TEST À PART ENTIÈRE.
 *
 * Une erreur au chargement d'un module rend TOUTE l'application blanche sans
 * qu'aucun lint ne la voie : c'est arrivé le 14/09/2026 avec 112 tests verts.
 * Les autres écrans touchés par ce chantier — commandes, finances, le portail
 * Factures et Commandes, le tableau de bord client — sont montés par les tests
 * ci-dessus et par `tests/rendu-ecrans.test.mjs`.
 */
for (const ecran of [
  'src/features/rapports-analyses/page.jsx',
  'src/features/performance-rh/page.jsx',
]) {
  test(`rendu — ${ecran} monte sans écran blanc`, async () => {
    const v = await rendreEcran({
      ecran,
      routeur: true,
      utilisateur: { id: 'u-1', prenom: 'Test', nom: 'Gerant', role: 'gerant' },
      donnees: {
        clients: [{ id: 'c-1', nom: 'Client de nuit', created_at: '2026-05-31T23:31:51.494Z' }],
        commandes: [{ id: 'k-1', numero: 'CMD-001', client_id: 'c-1', montant_total: 15000, created_at: '2026-05-31T23:31:51.494Z' }],
        demandes_rh: [{ id: 'r-1', employe_id: 'e-1', type: 'avance', statut: 'approuvee', montant: 5000, created_at: '2026-05-31T23:31:51.494Z' }],
        employes: [{ id: 'e-1', nom: 'Employe', prenom: 'Un', salaire_base: 200000 }],
      },
    });
    try {
      assert.ok(v.texte.trim().length > 0, 'écran blanc');
    } finally {
      await v.demonter();
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. LE GARDE-FOU : PLUS AUCUNE TRONCATURE DANS src/ ET api/
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * `src/lib/dates.js` est dispensé : c'est lui qui DÉFINIT la lecture juste, et
 * `dateMetierDepuisHorodatage()` y contient le repli `valeur.slice(0, 10)` qui
 * est précisément ce que ce garde-fou interdit ailleurs.
 */
const DISPENSES = new Set(['src/lib/dates.js']);

/**
 * Les deux écritures sous lesquelles la troncature se présente réellement.
 *
 * La seconde couvre la forme parenthésée `(m.date || m.created_at || '')` —
 * `[^()]*` empêche d'attraper au passage un `.slice(0, 10)` qui tronque une
 * LISTE après un `.sort(…)`, lequel contient toujours des parenthèses
 * imbriquées. Ce cas existe pour de bon dans rapports-analyses/page.jsx.
 */
const FORMES_INTERDITES = [
  {
    motif: /\.(?:created_at|updated_at)\s*\??\s*\.\s*(?:slice|split|substring|substr)\s*\(/g,
    nom: 'created_at.slice(…)',
  },
  {
    motif: /\([^()]*\b(?:created_at|updated_at)\b[^()]*\)\s*\.\s*(?:slice|split|substring|substr)\s*\(/g,
    nom: '(… || created_at || …).slice(…)',
  },
];

test('aucun horodatage de la base n’est tronqué à la main dans src/ et api/', () => {
  const fautes = relever({ formes: FORMES_INTERDITES, dispenses: DISPENSES });
  const total = fautes.reduce((n, f) => n + f.occurrences, 0);

  assert.equal(
    total,
    0,
    `${total} horodatage(s) tronqué(s) à la main, dans ${fautes.length} fichier(s).\n\n`
    + `\`created_at\` et \`updated_at\` sont des INSTANTS UTC. Les découper rend\n`
    + `la date de Londres : à Moanda (UTC+1), c'est LA VEILLE entre 00 h et 01 h,\n`
    + `et le MOIS PRÉCÉDENT sur .slice(0, 7).\n\n`
    + `Utiliser src/lib/dates.js — dateMetierDepuisHorodatage(v) pour une date,\n`
    + `moisMetierDepuisHorodatage(v) pour un mois. Ces deux fonctions ne rendent\n`
    + `JAMAIS une chaîne vide sur une forme inconnue : elles retombent sur les\n`
    + `dix premiers caractères.\n\n${formaterReleve(fautes)}\n`,
  );
});

/* ═══════════════════════════════════════════════════════════════════════════
   LE DÉTECTEUR SE FAIT CONTRÔLER
   ═══════════════════════════════════════════════════════════════════════════ */

/** Reproduit le chemin de lecture du garde-fou sur un extrait. */
const compter = (extrait) => occurrencesDans(extrait, FORMES_INTERDITES);

test('le détecteur voit les deux écritures de la troncature', () => {
  assert.equal(compter("export const a = c.created_at?.slice(0, 10);"), 1);
  assert.equal(compter("export const b = c.created_at.slice(0, 7);"), 1);
  assert.equal(compter("export const c = x.updated_at?.split('T')[0];"), 1);
  assert.equal(compter("export const d = (m.date || m.created_at || '').slice(0, 10);"), 1);
});

test('le détecteur ignore ce qui n’est qu’un commentaire ou une chaîne', () => {
  const extrait = [
    "// interdit : c.created_at?.slice(0, 10)",
    "/* interdit aussi : (m.date || m.created_at || '').slice(0, 10) */",
    "export const message = 'ne pas écrire created_at.slice(0, 10)';",
    "export const legitime = ligne.created_at;",
    "export const aussi = new Date(ligne.created_at).toLocaleDateString('fr-FR');",
  ].join('\n');

  assert.equal(compter(extrait), 0);
});

/**
 * LE FAUX POSITIF À NE PAS ATTRAPER — il existe en vrai, dans
 * rapports-analyses/page.jsx : `.slice(0, 10)` y tronque une LISTE de
 * mouvements, pas une date. L'interdire aurait fait « corriger » du code juste.
 */
test('le détecteur ne confond pas une liste tronquée avec une date tronquée', () => {
  const extrait = "export const derniers = [...mouvements]"
    + ".sort((a, b) => (b.date || b.created_at || '').localeCompare(a.date || a.created_at || ''))"
    + '.slice(0, 10);';

  assert.equal(compter(extrait), 0, 'Array.slice(0, 10) n’est pas une troncature de date');
});

/**
 * LE CAS QUI AVAIT FAIT ÉCHOUER LA PREMIÈRE VERSION DU DÉTECTEUR : une
 * apostrophe française dans du texte JSX ouvrait une chaîne qui ne se fermait
 * jamais, et la faute placée plus bas devenait invisible.
 */
test('le détecteur voit une faute placée après une apostrophe en texte JSX', () => {
  const extrait = [
    'export function Ecran({ lignes }) {',
    '  return (',
    '    <table>',
    "      <thead><tr><th>Jusqu'à la relance d'aujourd'hui</th></tr></thead>",
    '      <tbody>',
    '        {lignes.map((p) => <tr key={p.id}>{p.created_at?.slice(0, 10)}</tr>)}',
    '      </tbody>',
    '    </table>',
    '  );',
    '}',
  ].join('\n');

  assert.equal(compter(extrait), 1, 'l’apostrophe JSX ne doit rien masquer');
});
