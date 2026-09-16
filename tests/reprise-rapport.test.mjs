/**
 * Regression : la commande livree ne doit plus etre comptee DEUX FOIS dans le
 * rapport journalier.
 *
 * Gassim a confirme que le rapport journalier est saisi A LA MAIN par Ibrahim.
 * `syncCommandeToRapport()` ajoutait pourtant le montant de chaque commande
 * livree dans `categories.imprimerie` du rapport du jour.
 *
 * [MESURE le 16/09/2026 sur la base de production] le rapport du 2026-03-16
 * (id f4599794-4da1-4435-a766-5dce97e1a5dd) porte :
 *     categories.imprimerie = 5000
 *     notes = "\\n+ Commande  livrée (4500 F)"
 * La reprise automatique a donc DEJA tourne une fois, sur un vrai rapport
 * d'exploitation — et la commande qui l'a declenchee n'existe plus en base,
 * si bien qu'on ne peut meme plus prouver laquelle des deux lignes est la bonne.
 *
 * Lancer :  node --test tests/reprise-rapport.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  REPRISE_AUTO_RAPPORT, CHAMP_ORIGINES,
  decisionReprise, dejaReprise, originesRapport, montantCommande,
} from '../src/services/reprise-rapport.js';

const COMMANDE = { id: 'CMD1', numero: 'CMD-REEL1', montant_total: 45000 };

/* ══ L'interrupteur ══ */

test('la reprise automatique est DESACTIVEE par defaut', () => {
  assert.equal(
    REPRISE_AUTO_RAPPORT, false,
    'la reprise est rallumée : le montant sera compté deux fois, avec la saisie d’Ibrahim',
  );
});

test('interrupteur ferme : aucune action, quelles que soient les donnees', () => {
  const d = decisionReprise({ commande: COMMANDE, rapportDuJour: null, date: '2026-09-16' });
  assert.equal(d.action, 'ignorer');
  assert.match(d.motif, /désactivée/);
});

/* ══ Le comportement quand on rallume ══ */

test('rallume, sans rapport du jour : un rapport est cree AVEC sa trace d origine', () => {
  const d = decisionReprise({ commande: COMMANDE, rapportDuJour: null, date: '2026-09-16', actif: true });
  assert.equal(d.action, 'creer');
  assert.equal(d.patch.date, '2026-09-16');
  assert.equal(d.patch.categories.imprimerie, 45000);
  assert.deepEqual(d.patch[CHAMP_ORIGINES], ['CMD1'], 'sans trace d’origine, rien n’est déduplicable');
});

test('rallume, rapport existant : le montant s ajoute et la trace s allonge', () => {
  const rapport = { id: 'r1', date: '2026-09-16', categories: { imprimerie: 5000 }, notes: 'saisie du matin' };
  const d = decisionReprise({ commande: COMMANDE, rapportDuJour: rapport, date: '2026-09-16', actif: true });
  assert.equal(d.action, 'ajouter');
  assert.equal(d.patch.categories.imprimerie, 50000, '5 000 + 45 000 attendu');
  assert.deepEqual(d.patch[CHAMP_ORIGINES], ['CMD1']);
  assert.match(d.patch.notes, /saisie du matin/, 'les notes existantes doivent être conservées');
});

/* ══ LE CONTRAT CENTRAL : la trace d'origine rend le doublon impossible ══ */

test('une commande DEJA reprise n est jamais reprise une seconde fois', () => {
  const rapport = {
    id: 'r1', date: '2026-09-16', categories: { imprimerie: 50000 },
    [CHAMP_ORIGINES]: ['CMD1'],
  };
  const d = decisionReprise({ commande: COMMANDE, rapportDuJour: rapport, date: '2026-09-16', actif: true });
  assert.equal(d.action, 'ignorer');
  assert.match(d.motif, /déjà reprise/);
});

test('deux commandes DIFFERENTES sont bien reprises toutes les deux', () => {
  const rapport = { id: 'r1', categories: { imprimerie: 45000 }, [CHAMP_ORIGINES]: ['CMD1'] };
  const d = decisionReprise({
    commande: { id: 'CMD2', montant_total: 7000 }, rapportDuJour: rapport,
    date: '2026-09-16', actif: true,
  });
  assert.equal(d.action, 'ajouter');
  assert.deepEqual(d.patch[CHAMP_ORIGINES], ['CMD1', 'CMD2']);
  assert.equal(d.patch.categories.imprimerie, 52000);
});

test('une commande sans identifiant n est jamais reprise — elle serait intracable', () => {
  const d = decisionReprise({
    commande: { numero: 'X', montant_total: 45000 }, rapportDuJour: null,
    date: '2026-09-16', actif: true,
  });
  assert.equal(d.action, 'ignorer');
  assert.match(d.motif, /identifiant/);
});

test('un montant nul, absent ou absurde ne cree aucun rapport', () => {
  for (const montant of [0, -100, null, undefined, 'texte', NaN]) {
    const d = decisionReprise({
      commande: { id: 'C', montant_total: montant }, rapportDuJour: null,
      date: '2026-09-16', actif: true,
    });
    assert.equal(d.action, 'ignorer', `montant ${String(montant)} a déclenché une écriture`);
  }
});

/* ══ Le piege de fuseau ══ */

test('une date qui n est pas une date metier est refusee', () => {
  // Le vrai piege : `new Date().toISOString().split('T')[0]` rend bien du
  // `YYYY-MM-DD`, mais celui de la VEILLE entre 00 h et 01 h a Libreville. La
  // garde ci-dessous n'attrape que les formes manifestement fausses ; c'est
  // `todayISO()` dans sync-commande-rapport.js qui corrige le decalage, et le
  // test de source ci-dessous qui interdit le retour en arriere.
  for (const date of ['', null, undefined, '2026-9-16', '16/09/2026', '2026-09-16T00:00:00Z']) {
    const d = decisionReprise({ commande: COMMANDE, rapportDuJour: null, date, actif: true });
    assert.equal(d.action, 'ignorer', `la date « ${String(date)} » a été acceptée`);
  }
});

test('le service de synchronisation utilise todayISO, jamais toISOString', () => {
  const src = readFileSync(new URL('../src/services/sync-commande-rapport.js', import.meta.url), 'utf8');
  assert.ok(src.includes('todayISO'), 'la date métier doit venir de @/lib/dates');
  assert.ok(
    !src.includes('toISOString().split') && !src.includes('toISOString().slice'),
    'le piège de fuseau est revenu : rapport fantôme sur une journée déjà clôturée (constat C11)',
  );
});

/* ══ Utilitaires ══ */

test('originesRapport tolere tout ce que la base peut contenir', () => {
  assert.deepEqual(originesRapport(undefined), []);
  assert.deepEqual(originesRapport({}), []);
  assert.deepEqual(originesRapport({ [CHAMP_ORIGINES]: 'pas un tableau' }), []);
  assert.deepEqual(originesRapport({ [CHAMP_ORIGINES]: ['a', null, 42, '', 'b'] }), ['a', 'b']);
});

test('dejaReprise ne se trompe pas de commande', () => {
  const r = { [CHAMP_ORIGINES]: ['CMD1', 'CMD2'] };
  assert.equal(dejaReprise(r, { id: 'CMD2' }), true);
  assert.equal(dejaReprise(r, { id: 'CMD3' }), false);
  assert.equal(dejaReprise(r, {}), false);
  assert.equal(dejaReprise(null, { id: 'CMD1' }), false);
});

test('montantCommande accepte les deux champs historiques', () => {
  assert.equal(montantCommande({ montant_total: 4500 }), 4500);
  assert.equal(montantCommande({ total: 7000 }), 7000);
  assert.equal(montantCommande({ montant_total: '4500' }), 4500);
  assert.equal(montantCommande({}), 0);
});

test('le module de decision n importe aucune couche de donnees', () => {
  const src = readFileSync(new URL('../src/services/reprise-rapport.js', import.meta.url), 'utf8');
  for (const interdit of ['services/db', 'supabase', 'import ']) {
    assert.ok(!src.includes(interdit), `reprise-rapport.js ne doit pas contenir « ${interdit} »`);
  }
});
