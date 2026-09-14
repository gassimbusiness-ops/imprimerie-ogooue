/**
 * Test de non-regression — decalage de fuseau sur les dates metier.
 *
 * Bug d'origine : le Tableau de bord et Rapports & Analyses affichaient deux CA
 * differents pour "ce mois" (798 550 F vs 853 850 F, ecart 55 300 F).
 * Cause : new Date(y, m, 1).toISOString().slice(0,10) renvoie le 31 du mois
 * precedent des que le fuseau local est en avance sur UTC.
 *
 * Lancer :  node tests/dates.test.mjs
 * Ou sur plusieurs fuseaux :  TZ=Africa/Libreville node tests/dates.test.mjs
 */
import { toISODate, startOfMonthISO, addDaysISO } from '../src/lib/dates.js';

let echecs = 0;
const t = (nom, attendu, obtenu) => {
  const ok = attendu === obtenu;
  if (!ok) echecs++;
  console.log(`${ok ? '  ok  ' : '  ECHEC'} ${nom.padEnd(50)} attendu=${attendu} obtenu=${obtenu}`);
};

console.log(`TZ = ${process.env.TZ || 'systeme'}`);
t('startOfMonthISO -> 1er du mois', '2026-09-01', startOfMonthISO(new Date(2026, 8, 13, 12)));
t('toISODate du 1er septembre', '2026-09-01', toISODate(new Date(2026, 8, 1)));
t('toISODate du 31 aout', '2026-08-31', toISODate(new Date(2026, 7, 31)));
t('toISODate a 00h05 local', '2026-09-01', toISODate(new Date(2026, 8, 1, 0, 5)));
t('toISODate a 23h55 local', '2026-09-01', toISODate(new Date(2026, 8, 1, 23, 55)));
t('addDaysISO(-1) depuis le 1er sept', '2026-08-31', addDaysISO(-1, new Date(2026, 8, 1)));
t('addDaysISO(+1) depuis le 31 aout', '2026-09-01', addDaysISO(1, new Date(2026, 7, 31)));

const ancien = new Date(2026, 8, 1).toISOString().slice(0, 10);
console.log(`  ancien code (.toISOString().slice) donnait : ${ancien}${ancien !== '2026-09-01' ? '   <-- LE BUG' : '   (pas de decalage dans ce fuseau)'}`);

process.exit(echecs);
