/**
 * Dates métier — IMPRIMERIE OGOOUÉ
 *
 * ⚠️ POURQUOI CE FICHIER EXISTE
 *
 * `new Date(2026, 8, 1)` construit minuit **en heure locale**.
 * `.toISOString()` convertit ensuite en **UTC**.
 * Sur une machine à UTC+1 (Gabon) ou UTC+2 (Europe l'été), minuit local du 1er septembre
 * devient `2026-08-31T22:00:00Z`, et `.slice(0, 10)` renvoie **"2026-08-31"**.
 *
 * Résultat constaté en production : le Tableau de bord et Rapports & Analyses affichaient
 * deux chiffres d'affaires différents pour « ce mois » — l'un incluait le dernier jour du
 * mois précédent, l'autre non. Écart observé : 55 300 F CFA.
 *
 * Les dates de ce logiciel (`rapport.date`, `commande.date`…) sont des **dates métier**
 * au format `YYYY-MM-DD`, sans heure. Elles ne doivent jamais transiter par UTC.
 *
 * RÈGLE : pour transformer un objet Date en date métier, utiliser `toISODate()`.
 * Ne jamais utiliser `.toISOString().slice(0, 10)` ni `.toISOString().split('T')[0]`.
 */

/** Fuseau de référence de l'entreprise. */
export const FUSEAU_METIER = 'Africa/Libreville';

/**
 * Convertit un objet Date en date métier `YYYY-MM-DD`, en conservant le jour local.
 * @param {Date} d
 * @returns {string}
 */
export function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const j = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${j}`;
}

/** Date métier d'aujourd'hui. */
export function todayISO() {
  return toISODate(new Date());
}

const RE_DATE_METIER = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Vrai si `valeur` est une date métier `YYYY-MM-DD` qui EXISTE vraiment.
 *
 * ⚠️ Écrit le 18/09/2026 pour l'écran Événements. `handleSave()` n'y validait
 * que le nom : un événement pouvait partir en base avec `date: ''`, et la carte
 * affichait « Invalid Date » au gérant — `new Date('')` rend `Invalid Date`,
 * que `toLocaleDateString()` imprime tel quel.
 *
 * Le contrôle de forme ne suffit pas : `2026-02-31` a la bonne forme et
 * n'existe pas. On reconstruit donc la date et on vérifie qu'elle n'a pas été
 * silencieusement reportée au 2 ou 3 mars — même précaution qu'au § créneaux.
 *
 * @param {unknown} valeur
 * @returns {boolean}
 */
export function estDateMetier(valeur) {
  if (typeof valeur !== 'string' || !RE_DATE_METIER.test(valeur)) return false;
  const [a, m, j] = valeur.split('-').map(Number);
  if (m < 1 || m > 12 || j < 1 || j > 31) return false;
  const d = new Date(a, m - 1, j);
  return d.getFullYear() === a && d.getMonth() === m - 1 && d.getDate() === j;
}

/**
 * Objet `Date` à MINUIT LOCAL pour une date métier, ou `null` si elle n'existe
 * pas.
 *
 * ⛔ Ne jamais écrire `new Date('2026-11-08')` pour afficher un jour : cette
 * forme est interprétée en UTC, et `toLocaleDateString()` la rend ensuite dans
 * le fuseau de la machine. Sur un portable réglé à Los Angeles (UTC−8), le
 * 8 novembre s'affiche « 7 novembre ». C'est le bug de 55 300 F, côté lecture.
 *
 * @param {unknown} valeur date métier `YYYY-MM-DD`
 * @returns {Date|null}
 */
export function dateMetierEnDateLocale(valeur) {
  if (!estDateMetier(valeur)) return null;
  const [a, m, j] = valeur.split('-').map(Number);
  return new Date(a, m - 1, j);
}

/** Premier jour du mois de `d` (par défaut : le mois en cours). */
export function startOfMonthISO(d = new Date()) {
  return toISODate(new Date(d.getFullYear(), d.getMonth(), 1));
}

/** Date métier décalée de `n` jours (n négatif pour reculer). */
export function addDaysISO(n, d = new Date()) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return toISODate(x);
}

/* ═══════════════════════════════════════════════════════════════════════════
   CRÉNEAUX DE PUBLICATION — le même piège, mais à l'envers
   ═══════════════════════════════════════════════════════════════════════════

   Les fonctions ci-dessus protègent une DATE MÉTIER d'une conversion en UTC.
   Celles qui suivent font le trajet inverse, et il est tout aussi piégeux :
   transformer « le 21 septembre à 17 h 30, heure de Moanda » en un INSTANT
   comparable à `Date.now()`.

   ⛔ La forme fausse, celle qu'on écrit spontanément :

       new Date('2026-09-21T17:30')      // minuit LOCAL de la machine
       new Date(2026, 8, 21, 17, 30)     // idem

   Sur Vercel (UTC) ces deux formes donnent 17:30Z, soit 18 h 30 à Moanda :
   la publication part une heure trop tard. Sur un portable réglé à Los Angeles
   (UTC−7), elles donnent 00:30Z du 22 : la publication part le lendemain.

   ✅ La forme juste : `Date.UTC(...)` avec l'offset RETIRÉ à la main. `Date.UTC`
   n'a aucun fuseau — c'est de l'arithmétique sur des nombres. Le résultat est
   donc identique quelle que soit la machine, ce que les tests vérifient sous
   TZ=Africa/Libreville, TZ=UTC et TZ=America/Los_Angeles.

   📙 `Africa/Libreville` est à UTC+1 toute l'année, sans heure d'été. Cela rend
   le calcul simple — et ne dispense pas de le faire correctement : le serveur
   qui publie n'est pas au Gabon, et le navigateur du gérant non plus.        */

const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RE_HEURE = /^\d{2}:\d{2}$/;
const RE_OFFSET = /^[+-]\d{2}:\d{2}$/;

/**
 * Convertit un créneau local (date + heure + offset écrits en clair) en instant
 * UTC, sous la forme `YYYY-MM-DDTHH:MM:SSZ`.
 *
 * Aucune dépendance au fuseau de la machine : que le processus tourne à
 * Libreville, à Los Angeles ou en UTC, la valeur rendue est la même.
 *
 * @param {{date_locale?: string, heure_locale?: string, offset_utc?: string}} creneau
 * @returns {string|null} l'instant UTC, ou `null` si un champ est absent ou mal formé.
 */
export function instantUtcDepuisCreneau(creneau) {
  const date = creneau?.date_locale;
  const heure = creneau?.heure_locale;
  const offset = creneau?.offset_utc;
  if (typeof date !== 'string' || !RE_DATE.test(date)) return null;
  if (typeof heure !== 'string' || !RE_HEURE.test(heure)) return null;
  if (typeof offset !== 'string' || !RE_OFFSET.test(offset)) return null;

  const [annee, mois, jour] = date.split('-').map(Number);
  const [hh, mm] = heure.split(':').map(Number);
  const signe = offset[0] === '-' ? -1 : 1;
  const [offH, offM] = offset.slice(1).split(':').map(Number);

  if (mois < 1 || mois > 12 || jour < 1 || jour > 31) return null;
  if (hh > 23 || mm > 59 || offH > 23 || offM > 59) return null;

  // Minutes à retrancher pour passer du local à l'UTC (+01:00 → on retire 60).
  const decalageMinutes = signe * (offH * 60 + offM);
  const ms = Date.UTC(annee, mois - 1, jour, hh, mm - decalageMinutes, 0, 0);
  const d = new Date(ms);

  // Contrôle de débordement : le 31 février serait silencieusement reporté au
  // 2 ou 3 mars. Un créneau inventé doit être refusé, pas décalé.
  const localVerif = new Date(Date.UTC(annee, mois - 1, jour));
  if (localVerif.getUTCMonth() !== mois - 1 || localVerif.getUTCDate() !== jour) return null;

  return formaterInstantUtc(d);
}

/**
 * Formate un objet Date en instant UTC `YYYY-MM-DDTHH:MM:SSZ`, à partir des
 * composantes UTC. Équivalent au début de `toISOString()` — écrit à la main
 * pour qu'aucune relecture de ce fichier n'ait à se demander si la ligne est
 * le bug de 55 300 F ou non.
 * @param {Date} d
 * @returns {string}
 */
export function formaterInstantUtc(d) {
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
    + `T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}Z`;
}

/**
 * Les formes d'horodatage DATÉ ET SITUÉ que ce logiciel accepte.
 *
 * ── Pourquoi plusieurs formes, et lesquelles exactement ───────────────────
 *
 * Un horodatage traverse ce dépôt par trois chemins, et les trois n'écrivent
 * pas pareil. Relevé le 19/09/2026 sur les 4 109 lignes de `app_data` du
 * projet `bcwkrrqmjpaohmafcncw` :
 *
 *   • `new Date().toISOString()` — le chemin normal, celui de `db.create()` :
 *     `2026-09-18T20:08:56.689Z`.                          3 975 lignes.
 *   • PostgREST (lecture directe d'une colonne `timestamptz`) :
 *     `2026-09-18T18:14:29.258082+00:00`.                      1 ligne.
 *   • `now()::text` (une correction passée par l'éditeur SQL) :
 *     `2026-09-17 21:18:28.025859+00` — ESPACE au lieu du `T`, offset `+00`
 *     sans minutes.                                           18 lignes.
 *
 * Les deux dernières ne finissaient pas par `Z` : la version précédente de
 * cette fonction les REFUSAIT. Refuser n'est pas neutre — un appelant qui
 * affiche `dateLocaleDepuisInstantUtc(x)` sans repli montre alors une case
 * VIDE, ce qui fait croire que la donnée n'existe pas. Un affichage décalé
 * d'une heure gêne ; un affichage vide ment.
 *
 * ── LA CHAÎNE AMBIGUË : DÉCISION ET RAISON ────────────────────────────────
 *
 * `2026-06-07 21:19:46` — datée, mais SANS AUCUN FUSEAU.
 *
 * ⛔ Elle est REFUSÉE (`null`). Ce n'est pas une omission, c'est le choix.
 *
 * `new Date('2026-06-07 21:19:46')` l'interprète dans le fuseau de la MACHINE.
 * La même chaîne vaudrait donc 21 h 19 UTC sur Vercel et 20 h 19 UTC dans le
 * navigateur du gérant : deux instants distants d'une heure, et deux dates
 * métier différentes une heure par jour. C'est le mécanisme exact de l'écart
 * de 55 300 F documenté en tête de ce fichier.
 *
 * Deviner « c'est sûrement de l'UTC » serait un pari : rien dans la chaîne ne
 * le dit. Ce fichier n'invente pas de fuseau — il le dit ou il refuse. Le
 * refus est sûr parce qu'il est VISIBLE au bon endroit : les appelants passent
 * par `dateMetierDepuisHorodatage()`, qui retombe alors sur les dix premiers
 * caractères, c'est-à-dire sur le comportement d'avant — au pire une heure de
 * décalage, jamais un écran vide, jamais un résultat qui dépend de la machine.
 *
 * Aucune ligne de production ne porte cette forme (0 sur 4 109). Le cas est
 * donc théorique aujourd'hui — et testé quand même, parce que la prochaine
 * correction SQL passée à la main peut l'écrire.
 *
 * Refusées pour la même raison : la date seule (`2026-06-07`, qui n'est pas un
 * instant mais une date métier — voir `dateMetierDepuisHorodatage`), et tout
 * ce qui n'a pas la forme d'un horodatage.
 */
const RE_INSTANT = new RegExp(
  '^(\\d{4})-(\\d{2})-(\\d{2})'        // date
  + '[T ]'                             // « T » (ISO) ou espace (sortie SQL)
  + '(\\d{2}):(\\d{2})'                // heures:minutes
  + '(?::(\\d{2}))?'                   // secondes, facultatives
  + '(?:\\.(\\d{1,9}))?'               // fraction (Postgres en écrit 6)
  + '(Z|z|[+-]\\d{2}(?::?\\d{2})?)$',  // Z, +01:00, +0100 ou +00
);

/**
 * Lit un horodatage DATÉ ET SITUÉ et rend le nombre de millisecondes, ou
 * `null` si la chaîne n'en est pas un — voir `RE_INSTANT` ci-dessus pour la
 * liste des formes admises et pour le sort réservé à la chaîne sans fuseau.
 *
 * Le calcul passe par `Date.UTC` et un offset retiré à la main, jamais par
 * `Date.parse` : le résultat est donc identique que le processus tourne à
 * Libreville, en UTC ou à Los Angeles, ce que les tests vérifient sous les
 * trois fuseaux.
 *
 * @param {string} instant
 * @returns {number|null}
 */
export function msDepuisInstantUtc(instant) {
  if (typeof instant !== 'string') return null;
  const m = RE_INSTANT.exec(instant);
  if (m === null) return null;

  const [, a, mo, j, hh, mi, ss, frac, zone] = m;
  const annee = Number(a);
  const mois = Number(mo);
  const jour = Number(j);
  const heures = Number(hh);
  const minutes = Number(mi);
  const secondes = ss === undefined ? 0 : Number(ss);
  // La fraction est ramenée à des millisecondes : `.258082` → 258 ms. On
  // TRONQUE au lieu d'arrondir — un horodatage ne doit jamais avancer.
  const millis = frac === undefined ? 0 : Number(`${frac}000`.slice(0, 3));

  if (mois < 1 || mois > 12 || jour < 1 || jour > 31) return null;
  if (heures > 23 || minutes > 59 || secondes > 60) return null;

  let decalageMinutes = 0;
  if (zone !== 'Z' && zone !== 'z') {
    const signe = zone[0] === '-' ? -1 : 1;
    const chiffres = zone.slice(1).replace(':', '');
    const offH = Number(chiffres.slice(0, 2));
    const offM = chiffres.length > 2 ? Number(chiffres.slice(2, 4)) : 0;
    if (offH > 23 || offM > 59) return null;
    decalageMinutes = signe * (offH * 60 + offM);
  }

  // Contrôle de débordement : le 31 février serait silencieusement reporté au
  // 2 ou 3 mars. Un horodatage inventé doit être refusé, pas décalé — même
  // précaution qu'à `instantUtcDepuisCreneau`.
  const verif = new Date(Date.UTC(annee, mois - 1, jour));
  if (verif.getUTCMonth() !== mois - 1 || verif.getUTCDate() !== jour) return null;

  const ms = Date.UTC(annee, mois - 1, jour, heures, minutes - decalageMinutes, secondes, millis);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Rend un instant UTC lisible par un humain à Moanda :
 * `2026-09-21 17:30:42 (+01:00 Africa/Libreville)`.
 *
 * Écrit avec l'offset ET le nom du fuseau : un compte rendu lu par le gérant ne
 * doit exiger aucune conversion mentale, et ne doit pas non plus laisser croire
 * qu'une heure sans fuseau se lit « comme chez moi ».
 *
 * @param {string} instantUtc
 * @param {string} [offset] offset à appliquer, `+01:00` par défaut
 * @param {string} [fuseau] nom du fuseau, `Africa/Libreville` par défaut
 * @returns {string} chaîne vide si l'instant est illisible
 */
export function formaterInstantLocal(instantUtc, offset = '+01:00', fuseau = FUSEAU_METIER) {
  const ms = msDepuisInstantUtc(instantUtc);
  if (ms === null || !RE_OFFSET.test(offset)) return '';
  const signe = offset[0] === '-' ? -1 : 1;
  const [offH, offM] = offset.slice(1).split(':').map(Number);
  const local = new Date(ms + signe * (offH * 60 + offM) * 60_000);
  const p = (n) => String(n).padStart(2, '0');
  return `${local.getUTCFullYear()}-${p(local.getUTCMonth() + 1)}-${p(local.getUTCDate())} `
    + `${p(local.getUTCHours())}:${p(local.getUTCMinutes())}:${p(local.getUTCSeconds())} `
    + `(${offset} ${fuseau})`;
}

/**
 * Africa/Libreville est à UTC+1 toute l'année, sans heure d'été.
 * Écrit ici, et pas dans chaque appelant : une constante recopiée finit par
 * diverger, et un fuseau qui diverge, c'est un chiffre d'un autre jour.
 */
export const OFFSET_MOANDA = '+01:00';

/**
 * Où en est l'horloge, VUE DE MOANDA — jamais vue du serveur.
 *
 * ⚠️ La raison d'être de cette fonction. Les fonctions serverless de Vercel
 * tournent en UTC, et le navigateur du gérant peut être réglé n'importe où.
 * `toISODate(new Date())` y rend donc la date de la MACHINE : le 31 août à
 * 23 h 30 UTC, il est déjà le 1er septembre à Moanda, et un « aujourd'hui »
 * calculé sur l'horloge du processus compterait encore août. C'est le
 * mécanisme de l'écart de 55 300 F documenté en tête de ce fichier, transposé
 * au serveur.
 *
 * Le calcul passe par `Date.UTC` et un offset retiré à la main : le résultat
 * est identique que le processus tourne à Libreville, en UTC ou à Los Angeles,
 * ce que les tests vérifient sous les trois fuseaux.
 *
 * Utilisée par le pont ChatGPT (lecture ET écriture) et par l'écran
 * « Ce que ChatGPT a écrit » : les deux doivent dater pareil, sans quoi une
 * écriture et son annulation tomberaient des jours différents.
 *
 * @param {Date} [maintenant]
 * @returns {{instant_utc: string, date_locale: string, heure_locale: string,
 *            mois_local: string, fuseau: string, offset_utc: string, lisible: string}}
 */
export function contexteMoanda(maintenant = new Date()) {
  const instantUtc = formaterInstantUtc(maintenant);
  const lisible = formaterInstantLocal(instantUtc, OFFSET_MOANDA, FUSEAU_METIER);
  const dateLocale = dateLocaleDepuisInstantUtc(instantUtc, OFFSET_MOANDA) || '';
  return {
    instant_utc: instantUtc,
    date_locale: dateLocale,
    heure_locale: lisible.slice(11, 19),
    mois_local: dateLocale.slice(0, 7),
    fuseau: FUSEAU_METIER,
    offset_utc: OFFSET_MOANDA,
    lisible,
  };
}

/**
 * Date métier locale (`YYYY-MM-DD`) d'un instant UTC, dans le fuseau donné.
 * Sert à comparer une échéance d'offre (`valide_jusqu_au_local`) à la date du
 * créneau : la comparaison se fait EN DATE LOCALE, jamais en UTC.
 * @param {string} instantUtc
 * @param {string} [offset]
 * @returns {string|null}
 */
export function dateLocaleDepuisInstantUtc(instantUtc, offset = '+01:00') {
  const rendu = formaterInstantLocal(instantUtc, offset, '');
  return rendu ? rendu.slice(0, 10) : null;
}

/**
 * Date métier `YYYY-MM-DD` d'un champ d'horodatage de la base — vue de Moanda.
 *
 * ── Le défaut qu'elle remplace ────────────────────────────────────────────
 *
 * `created_at?.slice(0, 10)` découpe la représentation UTC. À Moanda (UTC+1,
 * sans heure d'été), tout ce qui est horodaté entre 23 h et minuit UTC — donc
 * entre 00 h et 01 h heure locale — se lit alors LA VEILLE. Relevé en base le
 * 19/09/2026 : 30 lignes sur 4 109 tombent dans ce créneau, dont un client
 * créé le 1er juin à 00 h 31 qui compte comme un client de MAI.
 *
 * ── Pourquoi cette fonction, et pas `dateLocaleDepuisInstantUtc` tout court ─
 *
 * Parce qu'elle NE PEUT PAS VIDER un écran. Trois entrées possibles, trois
 * sorties, dans cet ordre :
 *
 *   1. déjà une date métier (`2026-06-07`) — rendue telle quelle. Un champ
 *      `date` saisi par le gérant n'est pas un instant : le convertir serait
 *      lui inventer une heure ;
 *   2. un horodatage daté et situé (les trois formes réelles de Supabase,
 *      cf. `RE_INSTANT`) — converti en date de Moanda. C'est la correction ;
 *   3. tout le reste — chaîne sans fuseau, champ vide, valeur inattendue :
 *      on retombe sur les dix premiers caractères, c'est-à-dire sur le
 *      comportement d'AVANT. Au pire un décalage d'une heure, jamais un
 *      écran vide.
 *
 * Le repli du point 3 est la raison d'être de cette fonction. La substitution
 * directe de `dateLocaleDepuisInstantUtc()` aux `slice(0, 10)` aurait EFFACÉ
 * les 19 lignes qui ne finissent pas par `Z` : c'est pire que le défaut
 * corrigé, et c'est pourquoi ce chantier avait été ajourné.
 *
 * @param {unknown} valeur `created_at`, `updated_at`, `date`…
 * @param {string} [offset] offset de lecture, Moanda par défaut
 * @returns {string} date métier `YYYY-MM-DD`, ou `''` si rien d'exploitable
 */
export function dateMetierDepuisHorodatage(valeur, offset = OFFSET_MOANDA) {
  if (typeof valeur !== 'string' || valeur === '') return '';
  if (RE_DATE_METIER.test(valeur)) return valeur;
  return dateLocaleDepuisInstantUtc(valeur, offset) || valeur.slice(0, 10);
}

/**
 * Mois métier `YYYY-MM` d'un champ d'horodatage — même contrat que
 * `dateMetierDepuisHorodatage`, dont elle n'est que la troncature.
 *
 * Écrite à part parce que `.slice(0, 7)` sur un `created_at` a une conséquence
 * propre : il ne décale pas d'un jour, il change de MOIS un jour par mois.
 * « Nouveaux clients ce mois » et « avances versées ce mois » en dépendent.
 *
 * @param {unknown} valeur
 * @param {string} [offset]
 * @returns {string} `YYYY-MM`, ou `''`
 */
export function moisMetierDepuisHorodatage(valeur, offset = OFFSET_MOANDA) {
  return dateMetierDepuisHorodatage(valeur, offset).slice(0, 7);
}
