/**
 * Regression : consulter l'ecran Finances ne doit rien debiter, et un double
 * appel de l'execution ne doit produire qu'un seul mouvement.
 *
 * Bug d'origine (audit VAGUE 2, constat C2) :
 * src/features/finances/page.jsx:130-147 appelait `executerPrelevementsDus()`
 * et `executerChargesDues()` AU MONTAGE du composant. Ouvrir l'ecran pour
 * regarder un solde debitait les comptes. L'idempotence des services est un
 * lire-puis-ecrire : deux appels concurrents lisent tous les deux la liste des
 * mouvements AVANT que l'un ait ecrit, et prelevent tous les deux.
 * React.StrictMode monte deux fois chaque composant : la course etait reelle.
 *
 * Lancer :  node --test tests/prelevements.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { creerVerrouExecution } from '../src/services/execution-unique.js';
import {
  apercuChargesDues, apercuMensualitesDues, apercuPrelevementsDus,
} from '../src/services/prelevements-apercu.js';

/* ══════════════════════════════════════════════════════════════════
   1. UN DOUBLE APPEL NE PRODUIT QU UN MOUVEMENT
   ══════════════════════════════════════════════════════════════════ */

/**
 * Reproduit fidelement l idempotence lire-puis-ecrire des services reels :
 * la liste des mouvements est lue au debut, de facon asynchrone, puis on ecrit.
 */
function creerServicePrelevement(baseMouvements) {
  const base = [...baseMouvements];
  let lectures = 0;
  return {
    base,
    lectures: () => lectures,
    async executer() {
      // (1) LIRE — aller-retour reseau simule
      lectures++;
      const mouvements = await new Promise((r) => setTimeout(() => r([...base]), 5));
      const reference = 'charge:loyer-1:2026-09-05';
      const deja = mouvements.some((m) => m.reference === reference);
      if (deja) return { processed: [], skipped: 1, errors: [] };
      // (2) ECRIRE — c est ici que la course se joue
      await new Promise((r) => setTimeout(r, 5));
      base.push({ reference, montant: 95000, type: 'sortie' });
      return { processed: [{ charge: 'Loyer', echeances: 1, montant_total: 95000 }], skipped: 0, errors: [] };
    },
  };
}

test('LA COURSE EXISTE : sans verrou, deux appels concurrents prelevent deux fois', () => {
  // Ce test documente le defaut. S il echoue un jour, c est que les services
  // ont acquis une vraie protection (contrainte d unicite en base) et que ce
  // fichier doit etre relu.
  const svc = creerServicePrelevement([]);
  return Promise.all([svc.executer(), svc.executer()]).then(() => {
    assert.equal(svc.base.length, 2, 'la demonstration du bug doit produire 2 mouvements');
  });
});

test('un double appel CONCURRENT ne produit qu un seul mouvement', async () => {
  const svc = creerServicePrelevement([]);
  const verrou = creerVerrouExecution();

  const [a, b] = await Promise.all([
    verrou.executerUneSeuleFois('charges', () => svc.executer()),
    verrou.executerUneSeuleFois('charges', () => svc.executer()),
  ]);

  assert.equal(svc.base.length, 1, 'un seul mouvement doit avoir ete cree');
  assert.equal(svc.lectures(), 1, 'le service ne doit avoir ete invoque qu une fois');
  assert.equal(a, b, 'les deux appelants doivent recevoir le meme resultat');
  assert.equal(a.processed.length, 1);
});

test('un double montage StrictMode ne produit qu un seul mouvement', async () => {
  // StrictMode : le second montage part avant que le premier effet ait fini.
  const svc = creerServicePrelevement([]);
  const verrou = creerVerrouExecution();
  const montage1 = verrou.executerUneSeuleFois('charges', () => svc.executer());
  const montage2 = verrou.executerUneSeuleFois('charges', () => svc.executer()); // meme tick
  await Promise.all([montage1, montage2]);
  assert.equal(svc.base.length, 1);
});

test('dix clics frenetiques ne produisent qu un seul mouvement', async () => {
  const svc = creerServicePrelevement([]);
  const verrou = creerVerrouExecution();
  await Promise.all(
    Array.from({ length: 10 }, () => verrou.executerUneSeuleFois('charges', () => svc.executer())),
  );
  assert.equal(svc.base.length, 1);
});

test('apres la fin, une execution volontaire est de nouveau possible — et reste idempotente', async () => {
  const svc = creerServicePrelevement([]);
  const verrou = creerVerrouExecution();

  await verrou.executerUneSeuleFois('charges', () => svc.executer());
  assert.equal(verrou.nombreEnCours(), 0, 'le verrou doit etre libere apres coup');

  // Deuxieme execution SEQUENTIELLE : la lecture voit l ecriture precedente,
  // l idempotence par reference joue son role.
  const r = await verrou.executerUneSeuleFois('charges', () => svc.executer());
  assert.equal(svc.base.length, 1, 'aucun doublon sur un rappel sequentiel');
  assert.equal(r.processed.length, 0);
  assert.equal(r.skipped, 1);
});

test('deux cles differentes ne se bloquent pas l une l autre', async () => {
  const credits = creerServicePrelevement([]);
  const charges = creerServicePrelevement([]);
  const verrou = creerVerrouExecution();
  await Promise.all([
    verrou.executerUneSeuleFois('credit', () => credits.executer()),
    verrou.executerUneSeuleFois('charge', () => charges.executer()),
  ]);
  assert.equal(credits.base.length, 1);
  assert.equal(charges.base.length, 1);
});

test('un echec est propage aux deux appelants et libere le verrou', async () => {
  const verrou = creerVerrouExecution();
  const boum = () => Promise.reject(new Error('réseau coupé'));
  const r = await Promise.allSettled([
    verrou.executerUneSeuleFois('x', boum),
    verrou.executerUneSeuleFois('x', boum),
  ]);
  assert.equal(r[0].status, 'rejected');
  assert.equal(r[1].status, 'rejected');
  assert.equal(r[0].reason.message, 'réseau coupé');
  assert.equal(verrou.nombreEnCours(), 0, 'un echec doit liberer le verrou');
});

test('une operation qui leve de facon synchrone ressort en promesse rejetee', async () => {
  // Regle du 14/09/2026 : aucune exception ne doit casser le rendu d un ecran.
  const verrou = creerVerrouExecution();
  await assert.rejects(
    () => verrou.executerUneSeuleFois('x', () => { throw new Error('boum'); }),
    /boum/,
  );
  await assert.rejects(() => verrou.executerUneSeuleFois('x', 'pas une fonction'), TypeError);
});

/* ══════════════════════════════════════════════════════════════════
   2. L ECRAN NE PRELEVE PLUS AU MONTAGE
   ══════════════════════════════════════════════════════════════════ */

const pageFinancesBrut = readFileSync(new URL('../src/features/finances/page.jsx', import.meta.url), 'utf8');
// On raisonne sur le CODE, pas sur les commentaires (qui citent les anciens appels).
const pageFinances = pageFinancesBrut
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

test('le useEffect de montage n execute plus aucun prelevement', () => {
  // 17/09/2026 — l'ancre a change : le chargement de l'ecran ne passe plus par
  // un `useEffect` ecrit ici mais par `useChargeur(load)` (src/services/
  // chargement.js), qui porte le try/catch et le bouton « Reessayer ».
  // L'invariant teste est le meme : CE QUI S'EXECUTE AU MONTAGE ne preleve pas.
  const debut = pageFinances.indexOf('const load = useCallback');
  assert.ok(debut > -1, 'le chargeur de montage est introuvable');
  const fin = pageFinances.indexOf('useChargeur(load)', debut);
  assert.ok(fin > debut, 'le chargeur n’est plus branché sur useChargeur');
  const bloc = pageFinances.slice(debut, fin);
  for (const interdit of ['executerPrelevementsDus(', 'executerChargesDues(']) {
    assert.ok(!bloc.includes(interdit), `le montage appelle encore ${interdit} (bug C2)`);
  }
  // Et aucun autre effet de montage ne peut les rappeler dans son dos.
  assert.ok(
    !pageFinances.includes('useEffect('),
    'un useEffect est réapparu dans l’écran Finances : vérifier qu’il ne prélève pas',
  );
});

test('les prelevements ne sont appeles que depuis une fonction de confirmation', () => {
  // Chaque appel d execution doit se trouver dans confirmerPrelevement().
  const iConfirm = pageFinances.indexOf('const confirmerPrelevement');
  assert.ok(iConfirm > -1, 'confirmerPrelevement() introuvable');
  const finConfirm = pageFinances.indexOf('\n  };', iConfirm);
  const corpsConfirm = pageFinances.slice(iConfirm, finConfirm);

  for (const appel of ['executerPrelevementsDus()', 'executerChargesDues()']) {
    const total = pageFinances.split(appel).length - 1;
    const dansConfirm = corpsConfirm.split(appel).length - 1;
    assert.equal(total, dansConfirm, `${appel} est appele hors de confirmerPrelevement()`);
    assert.equal(total, 1, `${appel} doit etre appele exactement une fois`);
  }
});

test('l execution passe par le verrou d execution unique', () => {
  assert.ok(
    pageFinances.includes('verrouPrelevements.executerUneSeuleFois'),
    'l execution doit etre protegee par le verrou',
  );
});

/* ══════════════════════════════════════════════════════════════════
   3. L APERCU : ce que le gerant voit AVANT de confirmer
   ══════════════════════════════════════════════════════════════════ */

const COMPTES = [{ id: 'c1', nom: 'FINAM' }, { id: 'c2', nom: 'BGFI' }];

test('apercu : aucune echeance due = liste vide, total zero', () => {
  const r = apercuChargesDues({
    charges: [{ id: 'l1', libelle: 'Loyer', montant: 95000, compte_id: 'c1', prelevement_auto: true, prochaine_echeance: '2026-10-05' }],
    comptes: COMPTES, mouvements: [], aujourdhui: '2026-09-15',
  });
  assert.equal(r.nombre, 0);
  assert.equal(r.total, 0);
});

test('apercu : une echeance due est annoncee avec son compte et son montant', () => {
  const r = apercuChargesDues({
    charges: [{ id: 'l1', libelle: 'Loyer', montant: 95000, compte_id: 'c1', prelevement_auto: true, prochaine_echeance: '2026-09-05', periodicite: 'mensuelle' }],
    comptes: COMPTES, mouvements: [], aujourdhui: '2026-09-15',
  });
  assert.equal(r.nombre, 1);
  assert.equal(r.total, 95000);
  assert.equal(r.lignes[0].compte, 'FINAM');
  assert.equal(r.lignes[0].echeance, '2026-09-05');
  assert.equal(r.lignes[0].reference, 'charge:l1:2026-09-05');
});

test('apercu : une echeance deja prelevee est exclue', () => {
  const r = apercuChargesDues({
    charges: [{ id: 'l1', libelle: 'Loyer', montant: 95000, compte_id: 'c1', prelevement_auto: true, prochaine_echeance: '2026-09-05' }],
    comptes: COMPTES,
    mouvements: [{ reference: 'charge:l1:2026-09-05', montant: 95000 }],
    aujourdhui: '2026-09-15',
  });
  assert.equal(r.nombre, 0, 'un prelevement deja fait ne doit pas etre reannonce');
});

test('apercu : trois mois de retard annoncent trois echeances', () => {
  const r = apercuChargesDues({
    charges: [{ id: 'l1', libelle: 'Loyer', montant: 95000, compte_id: 'c1', prelevement_auto: true, prochaine_echeance: '2026-07-05', periodicite: 'mensuelle' }],
    comptes: COMPTES, mouvements: [], aujourdhui: '2026-09-15',
  });
  assert.equal(r.nombre, 3);
  assert.equal(r.total, 285000);
  assert.deepEqual(r.lignes.map((l) => l.echeance), ['2026-07-05', '2026-08-05', '2026-09-05']);
});

test('apercu : une charge inactive, sans compte ou sans auto est ignoree', () => {
  const base = { id: 'x', libelle: 'X', montant: 1000, compte_id: 'c1', prelevement_auto: true, prochaine_echeance: '2026-09-01' };
  const cas = [
    { ...base, actif: false },
    { ...base, prelevement_auto: false },
    { ...base, compte_id: undefined },
    { ...base, prochaine_echeance: undefined },
    { ...base, montant: 0 },
  ];
  for (const charge of cas) {
    assert.equal(apercuChargesDues({ charges: [charge], comptes: COMPTES, aujourdhui: '2026-09-15' }).nombre, 0);
  }
});

test('apercu : une mensualite de credit ne depasse jamais le restant du', () => {
  const r = apercuMensualitesDues({
    dettes: [{
      id: 'd1', libelle: 'Crédit FINAM', compte_id: 'c1', prelevement_auto: true,
      prochaine_echeance: '2026-09-05', montant_restant: 30000, mensualite_montant: 50000, statut: 'actif',
    }],
    comptes: COMPTES, mouvements: [], aujourdhui: '2026-09-15',
  });
  assert.equal(r.nombre, 1);
  assert.equal(r.total, 30000, 'on ne preleve jamais plus que le restant du');
});

test('apercu : une dette soldee ou suspendue n est pas prelevee', () => {
  for (const statut of ['solde', 'suspendu']) {
    const r = apercuMensualitesDues({
      dettes: [{ id: 'd1', libelle: 'X', compte_id: 'c1', prelevement_auto: true, prochaine_echeance: '2026-01-05', montant_restant: 100000, mensualite_montant: 1000, statut }],
      comptes: COMPTES, aujourdhui: '2026-09-15',
    });
    assert.equal(r.nombre, 0, `statut ${statut} ne doit rien prelever`);
  }
});

test('apercu : l ensemble est trie par echeance et additionne les deux natures', () => {
  const r = apercuPrelevementsDus({
    charges: [{ id: 'l1', libelle: 'Loyer', montant: 95000, compte_id: 'c1', prelevement_auto: true, prochaine_echeance: '2026-09-05' }],
    dettes: [{ id: 'd1', libelle: 'Crédit', compte_id: 'c2', prelevement_auto: true, prochaine_echeance: '2026-08-05', montant_restant: 500000, mensualite_montant: 40000, statut: 'actif' }],
    comptes: COMPTES, mouvements: [], aujourdhui: '2026-09-15',
  });
  assert.equal(r.nombre, 3); // credit aout + credit septembre + loyer septembre
  assert.equal(r.total, 40000 + 40000 + 95000);
  assert.deepEqual(r.lignes.map((l) => l.echeance), ['2026-08-05', '2026-09-05', '2026-09-05']);
});

test('apercu : garde-fou a 60 echeances, jamais de boucle infinie', () => {
  const r = apercuChargesDues({
    charges: [{ id: 'l1', libelle: 'Vieux', montant: 100, compte_id: 'c1', prelevement_auto: true, prochaine_echeance: '1990-01-05' }],
    comptes: COMPTES, aujourdhui: '2026-09-15',
  });
  assert.ok(r.nombre <= 60, 'le garde-fou doit plafonner a 60 echeances');
});

test('apercu : une entree vide ne casse rien', () => {
  assert.deepEqual(apercuPrelevementsDus({}), { lignes: [], nombre: 0, total: 0 });
  assert.deepEqual(apercuChargesDues(), { lignes: [], nombre: 0, total: 0 });
  assert.deepEqual(apercuMensualitesDues(), { lignes: [], nombre: 0, total: 0 });
});

test('apercu : le module ne touche a aucune couche de donnees', () => {
  const src = readFileSync(new URL('../src/services/prelevements-apercu.js', import.meta.url), 'utf8');
  for (const interdit of ['services/db', 'db.', 'supabase', 'fetch(']) {
    assert.ok(!src.includes(interdit), `prelevements-apercu.js ne doit pas contenir « ${interdit} »`);
  }
});
