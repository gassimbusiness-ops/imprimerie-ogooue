/**
 * Auto-poster — L'ALIMENTATION DE LA FILE : le dernier maillon de la chaîne.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CE QU'IL MANQUAIT, EXACTEMENT
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Au 18/09/2026 la chaîne était complète SAUF ce chaînon :
 *
 *   ✅ ChatGPT dépose dans le Drive — 14 publications y attendent ;
 *   ✅ `drive.js` sait les lire — « Accès Drive opérationnel » ;
 *   ❌ RIEN n'en faisait des lignes de `autopost_file` ;
 *   ✅ l'exécuteur sait publier ce qui est dans la file.
 *
 * Ce module est ce chaînon, et RIEN d'autre :
 *
 *   ⛔ il ne publie pas. Il n'appelle ni Facebook, ni Instagram.
 *   ⚠️ IL APPROUVE — depuis le 19/09/2026, et SEULEMENT si l'appelant le lui
 *      demande. Ce paragraphe disait le contraire jusqu'à cette date : « une
 *      ligne qui s'auto-approuverait serait le pire défaut possible de cette
 *      chaîne ». Gassim a tranché autrement, en connaissant la réserve (ChatGPT
 *      vérifie le FORMAT du manifeste, pas le JUGEMENT éditorial) : « automatique
 *      tout de suite ». Le réglage vit en base (`autopost_controle.
 *      approbation_automatique`, défaut `true`) pour qu'on puisse revenir en
 *      arrière SANS redéployer. Trois choses restent, et elles font la
 *      différence entre « automatique » et « aveugle » :
 *        · l'empreinte du contenu est calculée et portée par l'approbation ;
 *        · une décision HUMAINE (approbation ou retrait) n'est jamais réécrite ;
 *        · l'objet écrit dit `origine: 'automatique'`, donc on sait toujours qui
 *          a approuvé quoi.
 *      Voir `approbationPourLaLigne()` plus bas, et
 *      `construireApprobationAutomatique()` dans `autopost-approbation.js`.
 *   ⛔ il n'ouvre aucun verrou. Les cinq verrous restent où ils sont : alimenter
 *      n'est pas publier, et l'alimentation doit fonctionner CHAÎNE À L'ARRÊT —
 *      sinon on ne pourrait rien vérifier avant d'ouvrir les verrous, et on les
 *      ouvrirait à l'aveugle. Ce module ne lit même pas l'interrupteur.
 *   ⛔ il ne RÉPARE rien. Un dépôt hors contrat est écarté avec son motif.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 🔴 L'IDEMPOTENCE — ELLE SE FONDE SUR LA LIGNE, PAS SUR UN DRAPEAU
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Le passage tourne toutes les heures. Alimenter deux fois ne doit jamais
 * produire deux lignes pour la même publication.
 *
 * La règle de la maison, payée une fois (encaissement SingPay du 16/09, deux
 * écritures pour un paiement) : **on se fonde sur le témoin de l'effet**, jamais
 * sur un statut intermédiaire ni sur un « déjà traité » qu'on se serait posé
 * soi-même dans le Drive ou en base.
 *
 * Ici, l'effet recherché est « la ligne de file existe ». Son témoin est donc
 * **la ligne elle-même**, retrouvée par sa clé d'idempotence — le quintuplet
 * (publication, version, canal, compte, instant) de `autopost-contrat.js`.
 * Aucun marqueur n'est écrit dans le Drive (qui est d'ailleurs en LECTURE
 * SEULE), aucun fichier n'est déplacé, aucune colonne « importé le » n'est
 * inventée : on REGARDE si la ligne est là.
 *
 * ⚠️ Nuance qui compte, et qui a été vérifiée dans la migration plutôt que
 *    supposée : la table `autopost_file` n'a PAS d'index unique sur
 *    `publication_id` — elle ne peut pas en avoir, puisqu'une publication donne
 *    UNE LIGNE PAR CANAL. Ce que la migration 008 garantit, c'est :
 *      - `cle_idempotence` en CLÉ PRIMAIRE (donc unique) ;
 *      - un index unique partiel sur `id_distant`.
 *    Le filet est donc la clé primaire. Ce module ne compte pas dessus pour
 *    être correct : il lit l'existant avant d'écrire, et traite un refus
 *    d'insertion comme « quelqu'un d'autre l'a fait », pas comme une panne.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 🔴 CE QUI EST PARTI NE REPART PAS — le risque le plus cher
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Une publication publiée puis redéposée dans le Drive ne doit pas repartir :
 * un client de Moanda qui voit deux fois la même affiche, c'est l'incident que
 * cette chaîne ne peut pas se permettre.
 *
 * Et la clé d'idempotence NE SUFFIT PAS pour ça : elle porte la version du
 * contenu. ChatGPT corrige une faute, passe en v2, la clé change, l'index
 * unique n'a plus rien à dire. Le contrôle est donc plus large que la clé :
 *
 *   **pour un couple (publication_id, canal), s'il existe une ligne qui porte
 *   un `id_distant` ou l'état `published`, aucune nouvelle ligne n'est créée,
 *   quelle que soit la version.**
 *
 * Le couple, et pas la publication entière : « parti sur Facebook » ne doit pas
 * empêcher Instagram d'entrer en file, sinon on supprimerait la moitié du plan
 * sans que personne ne l'ait décidé.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 🔴 UN DÉPÔT MODIFIÉ — LA DÉCISION, ÉCRITE ICI PLUTÔT QUE LAISSÉE AU HASARD
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ChatGPT corrige un `publication.json` déjà en file mais pas encore parti.
 * Trois cas, trois décisions explicites :
 *
 * 1. MÊME CLÉ (même version, même créneau, même canal, même compte), contenu
 *    ou approbation différents → **MISE À JOUR de la ligne.**
 *    Pourquoi la mise à jour et non le refus : sans elle, le Drive et la file
 *    divergeraient en silence, et surtout **aucune approbation ne pourrait
 *    jamais arriver** — `APPROBATION.json` est presque toujours déposé APRÈS le
 *    manifeste. Une file qu'on ne peut pas approuver ne sert à rien.
 *    Ce qui rend la mise à jour sûre : le sceau. `verifierApprobation()` compare
 *    `payload_sha256` au contenu ; un contenu modifié après approbation INVALIDE
 *    l'approbation (`contenu_modifie_depuis_approbation`) au lieu de la traîner.
 *    On ne peut donc pas glisser un contenu neuf sous un accord ancien.
 *
 * 2. CLÉ DIFFÉRENTE, même (publication, canal), ligne encore en file →
 *    **ANNULATION de l'ancienne, insertion de la nouvelle.**
 *    Deux lignes vivantes pour le même couple, ce sont DEUX publications : la
 *    v1 approuvée partirait, et la v2 aussi. On n'en garde qu'une, et c'est le
 *    dépôt qui fait foi — c'est lui que le gérant approuve.
 *    Sauf si la version déposée est ANTÉRIEURE à celle déjà en file : on ne
 *    revient pas en arrière tout seul (motif `version_anterieure_a_la_file`).
 *
 * 3. LIGNE EN VOL (`executing`, `reconciling`) ou DÉJÀ PARTIE (`published`) →
 *    **ON N'Y TOUCHE PAS.** Changer la légende d'une ligne qu'un autre passage
 *    est en train d'envoyer, c'est publier un contenu que personne n'a vu.
 *    Idem pour une ligne `cancelled` : quelqu'un — ou une version plus récente —
 *    a décidé qu'elle ne partait pas ; la ressusciter en silence annulerait
 *    cette décision.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 🔴 LE MÉDIA — LA VÉRITÉ, ÉCRITE DANS LA LIGNE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Instagram ne reçoit pas de fichier : il va CHERCHER le média à une adresse
 * publiquement joignable. Un fichier de Drive privé n'en est pas une, et le
 * rendre public serait exactement le partage par lien que le dossier interdit
 * (le Drive porte les baux, les contrats de travail, la procuration bancaire).
 *
 * Ce module n'invente donc AUCUNE adresse — il n'en a jamais fabriqué une et
 * n'en fabriquera jamais. Depuis le 19/09/2026 il en DEMANDE une à
 * `autopost-medias.js`, qui recopie les octets du Drive dans le bucket
 * Supabase `publications` (public, 15 Mo, quatre types) et rend l'adresse de
 * l'objet déposé. Aucun lien `drive.google.com` ni `googleusercontent` ne peut
 * entrer dans `url_media` : ce qui y entre est une adresse de NOTRE stockage,
 * ou rien.
 *
 * Trois règles tiennent ce câblage :
 *
 *   1. **Héberger et alimenter sont deux gestes.** Une panne Google ou Storage
 *      ne fait pas perdre le dépôt : la ligne entre en file avec
 *      `url_media: null` et le motif est écrit dans `derniere_erreur` — là où
 *      l'écran l'affiche déjà, à côté de la ligne concernée. Un motif qui
 *      meurt dans un `console.error` n'existe pas.
 *   2. **Une ligne déjà en file sans adresse est retentée à chaque passage.**
 *      Sinon les lignes entrées avant l'hébergement resteraient à jamais sans
 *      média, et la file serait pleine de publications qui ne peuvent pas
 *      partir.
 *   3. **Un MÉDIA dont les octets ont changé fait REDEMANDER l'adresse**, même
 *      si la ligne en portait déjà une : le chemin de l'objet contient
 *      l'empreinte du fichier, donc une image corrigée a une autre adresse.
 *      Sans ce point, on publierait l'ancienne image sous le contenu nouveau.
 *      ⛔ Et la réciproque compte autant : une ligne réécrite pour une AUTRE
 *      raison (une approbation qui vient s'y ajouter) GARDE son adresse. Le
 *      19/09/2026 à 13 h 29, avoir confondu les deux a fait tomber 9 lignes
 *      hébergées à 3 alors qu'aucun objet n'avait quitté le bucket — et chaque
 *      passage recommençait. Voir `mediaAChange()`.
 *
 * Sans hébergeur injecté, le comportement d'avant revient à l'identique : la
 * ligne entre sans média, et le bilan le DIT (`medias.hebergement: "absent"`)
 * plutôt que de laisser croire à une panne de Google.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LE CONTRAT DU DÉPÔT (le port, injecté — jamais Supabase en dur ici)
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   lireLignesDePublications(ids)      → ligne[]  (toutes versions, tous états)
 *   inserer(ligne)                     → { insere: boolean, conflit: boolean }
 *   mettreAJourDepuisDepot(cle, champs)→ boolean  ← CONDITIONNEL (voir plus bas)
 *   annulerLigne(cle, details)         → boolean  ← CONDITIONNEL
 *   journaliser(entree)
 *
 * `mettreAJourDepuisDepot` et `annulerLigne` doivent être conditionnelles à
 * l'état ET à l'absence de témoin, en UNE instruction : c'est ce qui empêche
 * d'écrire sous une ligne qu'un autre passage vient de prendre. Le code
 * ci-dessous vérifie déjà l'état qu'il a lu, mais entre la lecture et
 * l'écriture il y a une fenêtre — et cette fenêtre, seul le dépôt peut la
 * fermer. Voir `autopost-depot.js`.
 */
import crypto from 'node:crypto';
import {
  validerManifeste, cleIdempotence, empreinteCanonique, CANAUX_PUBLIANTS, approbationARetenir,
  verifierApprobation, estDecisionHumaine, ORIGINE_AUTOMATIQUE,
  lireDeclarationLegende, legendeUtilisable,
} from './autopost-contrat.js';
// ⚠️ Import CROISÉ avec `autopost-approbation.js`, qui lit `ETATS_MODIFIABLES`
//    ici. Il est sûr parce qu'aucun des deux ne DÉRÉFÉRENCE l'autre au moment
//    de l'évaluation du module : les deux usages sont dans des corps de
//    fonction. Et c'est le bon compromis : l'objet d'approbation est fabriqué à
//    UN SEUL endroit dans tout le dépôt. Deux fabricants, ce seraient deux
//    formes d'approbation, et un jour l'une des deux ne serait plus vérifiable.
import { construireApprobationAutomatique } from './autopost-approbation.js';
import {
  erreurDeMedia, CODES_MEDIA, MOTIFS_MEDIA, cheminAttendu, urlPorteChemin,
} from './autopost-medias.js';
import { enParalleleBorne, CONCURRENCE_PAR_DEFAUT } from './concurrence.js';
import { formaterInstantUtc, dateLocaleDepuisInstantUtc, msDepuisInstantUtc } from '../../src/lib/dates.js';

/**
 * Les états depuis lesquels une ligne peut encore être réécrite ou annulée par
 * un dépôt. Tout ce qui n'est pas là est intouchable :
 *   `executing`, `reconciling` → en vol ;
 *   `published`               → le témoin est posé ;
 *   `cancelled`               → une décision a été prise.
 */
export const ETATS_MODIFIABLES = Object.freeze(['draft', 'scheduled', 'failed', 'expired', 'suspended']);

/** État d'entrée en file. Jamais `published`, jamais rien qui ressemble à parti. */
export const ETAT_ENTREE = 'scheduled';

/**
 * Tolérance retenue quand le manifeste n'en déclare aucune. C'est le défaut de
 * la table (migration 008) et le minimum compatible avec la cadence horaire du
 * plan Hobby — pas une valeur choisie ici au hasard.
 */
export const TOLERANCE_PAR_DEFAUT = 90;

/**
 * 🔴 LE BUDGET D'HÉBERGEMENT D'UN PASSAGE — COMPTÉ EN TEMPS, PAS EN FICHIERS.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LE PROBLÈME, ET LA MESURE QUI L'A MONTRÉ
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Alimenter était une affaire de listings et de fichiers texte. Depuis
 * l'hébergement des médias, un passage descend puis remonte plusieurs
 * mégaoctets. Le 19/09/2026, un plafond de SIX téléversements par passage a été
 * posé par prudence, sans mesure. Résultat mesuré la nuit suivante : **33 lignes
 * sur 42 attendaient encore un média**, et il aurait fallu presser le bouton
 * cinq fois de plus. Un plafond en nombre de fichiers ne dit rien du temps
 * consommé : six petites images ne coûtent pas ce que coûtent six vidéos.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 🔴 CE QU'ON PROTÈGE, ET POURQUOI C'EST LA PUBLICATION
 * ════════════════════════════════════════════════════════════════════════════
 *
 * L'alimentation tourne DANS la même fonction serverless que la publication, et
 * AVANT elle (voir `api/autopost.js`). Une alimentation qui fait expirer la
 * fonction n'empêche pas seulement d'alimenter : elle empêche de PUBLIER ce qui
 * est DÉJÀ en file, et ça, c'est un rendez-vous manqué sur la page de
 * l'entreprise. C'est la règle « alimenter et publier sont deux gestes », vue du
 * côté du temps — et c'est le second qui a la priorité.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * D'OÙ VIENT LE CHIFFRE — IL N'EST PAS DEVINÉ, IL EST DÉCLARÉ
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Ce qui a été vérifié le 19/09/2026 :
 *
 *   - `vercel.json` ne déclarait AUCUN `maxDuration` : la fonction tournait donc
 *     au défaut du projet, c'est-à-dire à un chiffre que personne ici ne
 *     connaissait ;
 *   - la documentation Vercel (`/docs/functions/limitations#max-duration`) donne,
 *     avec fluid compute — activé par défaut sur les nouveaux projets — un plan
 *     Hobby à **300 s par défaut ET au maximum** ;
 *   - sans fluid compute, le plafond Hobby est de **60 s**
 *     (changelog « Vercel Functions for Hobby can now run up to 60 seconds ») ;
 *   - l'API Vercel n'expose pas lequel des deux régimes s'applique à ce projet.
 *
 * Deviner entre 60 et 300 aurait été exactement l'erreur d'origine. On ne devine
 * donc pas : `vercel.json` DÉCLARE désormais `maxDuration: 60` pour
 * `api/autopost.js` — une valeur acceptée sous les DEUX régimes — et la constante
 * ci-dessous recopie ce chiffre. `tests/autopost-alimentation.test.mjs` relit le
 * `vercel.json` et refuse que les deux divergent : si Gassim passe à 300, le test
 * le dit au lieu de laisser le code croire à 60.
 */
export const DUREE_MAX_FONCTION_MS = 60_000;

/**
 * Ce qu'on GARDE pour la suite du passage : publier ce qui est déjà en file
 * (jusqu'à `plafond_journalier` appels à Meta), écrire le journal, rendre la
 * réponse. Une marge franche, volontairement plus grande que le budget lui-même :
 * dépasser ne coûte pas l'alimentation, ça coûte la publication.
 */
export const RESERVE_PUBLICATION_MS = 35_000;

/**
 * Le budget réel : ~25 s. Tant qu'il reste du temps, on héberge. Au-delà, on
 * n'ENGAGE plus de nouveau téléversement — celui qui est en cours va au bout,
 * d'où la marge.
 */
export const BUDGET_HEBERGEMENT_MS = DUREE_MAX_FONCTION_MS - RESERVE_PUBLICATION_MS;

/**
 * 🔴 LE PLAFOND DE SÉCURITÉ, AU CAS OÙ LE CHRONOMÈTRE MENTIRAIT.
 *
 * Un chronomètre gelé (horloge non monotone, machine suspendue) rendrait le
 * budget de temps inopérant et laisserait l'hébergement tourner sans fin. Ce
 * plafond est la ceinture qui va avec les bretelles : plus haut que le besoin
 * mesuré (14 fichiers distincts dans le Drive, les canaux d'une même publication
 * partageant le même objet), assez bas pour rester borné.
 */
export const TELEVERSEMENTS_MAX_PAR_PASSAGE = 40;

/**
 * 🔴🔴 L'IMAGE DU JOUR PASSE EN PREMIER — la leçon des 20 et 21/09/2026.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CE QUI S'EST PASSÉ (audit 41, mesuré en base, confirmé dans ce code)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ChatGPT a réécrit les 47 manifestes le matin même. Nouvelle version = nouveau
 * chemin d'objet = tout est à réhéberger. La boucle parcourait les dossiers
 * DANS L'ORDRE DU DRIVE (l'ordre des noms) : les 25 s du budget sont parties
 * sur des images de semaines futures, et l'image du 20/09 a été REPORTÉE.
 * La ligne du jour est entrée en file sans adresse, l'exécuteur l'a prise,
 * `url_media_absente` sur Facebook ET Instagram. Le passage du soir est arrivé
 * hors tolérance. Deux jours perdus, et le 23/09 n'est passé que par chance.
 *
 * Le défaut n'était PAS l'ordre « alimenter, puis sélectionner » : la sélection
 * relit la file en base APRÈS l'alimentation (`lireFile()` dans l'exécuteur),
 * donc une image hébergée pendant l'alimentation est vue par la sélection du
 * même passage. Un test le prouve de bout en bout. Le défaut était QUE L'IMAGE
 * DU JOUR N'ÉTAIT PAS HÉBERGÉE : rien ne la faisait passer devant les autres.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LA RÈGLE, EN DEUX TEMPS
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   1. **L'ORDRE.** Les publications sont traitées par urgence de créneau, pas
 *      par nom de dossier : d'abord ce qui part dans les 24 h (ou qui est dû et
 *      encore dans sa tolérance), puis le reste par créneau croissant, puis ce
 *      qui ne peut plus partir. Une image à J+10 ne passe jamais devant celle
 *      du jour.
 *   2. **LE DÉPASSEMENT, BORNÉ.** Une ligne URGENTE est hébergée même si les
 *      25 s sont épuisées — mais on n'engage plus AUCUN téléversement au-delà
 *      de `PLAFOND_URGENCE_MS`. Le reste de la minute appartient à la
 *      publication.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * D'OÙ VIENNENT LES CHIFFRES
 * ════════════════════════════════════════════════════════════════════════════
 *
 * `RESERVE_PUBLICATION_MS` (35 s) reste la réserve du cas ordinaire. Ce que
 * l'urgence ne peut JAMAIS entamer, c'est la part mesurée de cette réserve :
 *
 *   - **publier Facebook + Instagram a pris jusqu'à ~25 s**. Le 23/09, le
 *     passage part à 09:53:13 et la publication Instagram est publique à
 *     09:54:03 (scraper, audit 41 §6), après un hébergement qui avait épuisé
 *     ses 25 s (8 hébergés, 12 reportés) : ~25 s pour publier, sondages du
 *     conteneur Instagram compris ;
 *   - **un téléversement engagé juste avant le plafond va au bout** : 5 s de
 *     marge pour lui (≈ 2 × la durée moyenne d'un média mesurée le 23/09,
 *     ~20 s pour 8 médias).
 *
 * Soit 30 s gardées, et un plafond d'engagement à 60 − 30 = 30 s. Cinq
 * secondes de plus que le budget ordinaire : de quoi héberger l'image du jour
 * quand le listing du Drive a mangé le budget, pas de quoi réhéberger la file.
 *
 * ⚠️ Ce qui n'est PAS garanti ici, et qui ne l'était pas avant : aucun appel
 *    réseau (Drive, stockage, Meta) n'a de délai maximal propre. Un appel qui
 *    pend fait expirer la fonction quoi qu'on compte. Ce plafond borne ce que
 *    l'alimentation ENGAGE, pas ce que le réseau rend.
 */
export const HORIZON_URGENCE_MS = 24 * 60 * 60 * 1000;
export const DUREE_PUBLICATION_MESUREE_MS = 25_000;
export const MARGE_TELEVERSEMENT_EN_COURS_MS = 5_000;
export const RESERVE_PUBLICATION_MINIMALE_MS = DUREE_PUBLICATION_MESUREE_MS + MARGE_TELEVERSEMENT_EN_COURS_MS;
export const PLAFOND_URGENCE_MS = DUREE_MAX_FONCTION_MS - RESERVE_PUBLICATION_MINIMALE_MS;

/**
 * Les rangs d'urgence, dans l'ordre où ils sont servis.
 *   URGENT   — créneau dans les 24 h, ou dû et encore dans sa tolérance ;
 *   A_VENIR  — au-delà de 24 h ;
 *   REVOLU   — tolérance dépassée : ne partira plus, servi en dernier ;
 *   ILLISIBLE — créneau inexploitable : le contrat l'écartera de toute façon.
 */
export const RANGS_URGENCE = Object.freeze({
  URGENT: 0, A_VENIR: 1, REVOLU: 2, ILLISIBLE: 3,
});

/**
 * Le rang d'urgence d'une publication à cet instant. Fonction pure.
 *
 * @param {object} publication  le manifeste
 * @param {number|null} maintenantMs
 * @param {number} [horizonMs]
 * @returns {{rang: number, instantMs: number}}
 */
export function urgenceDuCreneau(publication, maintenantMs, horizonMs = HORIZON_URGENCE_MS) {
  const instantMs = msDepuisInstantUtc(normaliserInstant(publication?.creneau?.instant_utc));
  if (instantMs === null || typeof maintenantMs !== 'number') {
    return { rang: RANGS_URGENCE.ILLISIBLE, instantMs: Number.POSITIVE_INFINITY };
  }
  const tolerance = typeof publication?.creneau?.tolerance_minutes === 'number'
    ? publication.creneau.tolerance_minutes
    : TOLERANCE_PAR_DEFAUT;
  if (maintenantMs > instantMs + tolerance * 60_000) return { rang: RANGS_URGENCE.REVOLU, instantMs };
  if (instantMs <= maintenantMs + horizonMs) return { rang: RANGS_URGENCE.URGENT, instantMs };
  return { rang: RANGS_URGENCE.A_VENIR, instantMs };
}

/**
 * Les publications du dépôt, rangées par urgence puis par créneau croissant.
 * À rang et créneau égaux, l'ordre du Drive est conservé (tri stable, et
 * l'index d'origine en dernier critère) : rien ne bouge sans raison.
 */
function ordonnerParUrgence(deposees, maintenantMs, horizonMs) {
  return deposees
    .map((depose, index) => ({ depose, index, u: urgenceDuCreneau(depose?.publication, maintenantMs, horizonMs) }))
    .sort((a, b) => (a.u.rang - b.u.rang)
      || (a.u.instantMs === b.u.instantMs ? 0 : (a.u.instantMs < b.u.instantMs ? -1 : 1))
      || (a.index - b.index));
}

/**
 * Pourquoi un média a été REPORTÉ. Un report n'est PAS une erreur : il est
 * compté (`medias.reportes`) et dit au journal, mais il n'écrit rien dans
 * `derniere_erreur`. Un bandeau rouge pour une décision volontaire serait un
 * faux témoin, dans l'autre sens. La ligne entre quand même en file, sans
 * adresse, et le passage suivant la reprend — ce qui est déjà hébergé ne coûte
 * alors qu'une question au bucket.
 */
export const MOTIFS_REPORT = Object.freeze({
  BUDGET_TEMPS: 'budget_temps_epuise',
  PLAFOND_TELEVERSEMENTS: 'plafond_televersements_atteint',
  /* Une ligne URGENTE reportée quand même : le plafond d'engagement est
     atteint, la minute restante appartient à la publication. Motif distinct,
     parce que c'est le seul report qui peut coûter une publication du jour. */
  PLAFOND_URGENCE: 'plafond_urgence_atteint',
});

/**
 * Pourquoi un canal n'est pas entré en file. Ces chaînes sont écrites dans le
 * journal et affichées au gérant : ce sont des phrases, pas des codes internes.
 */
export const MOTIFS = Object.freeze({
  MANIFESTE_INVALIDE: 'manifeste_invalide',
  CLE_EN_DOUBLE: 'cle_en_double_dans_le_depot',
  DEJA_PARTI: 'deja_parti',
  LIGNE_EN_VOL: 'ligne_en_vol',
  LIGNE_ANNULEE: 'ligne_annulee',
  VERSION_ANTERIEURE: 'version_anterieure_a_la_file',
  LEGENDE_ABSENTE: 'legende_absente',
  LEGENDE_INTROUVABLE: 'legende_introuvable',
  /* 🔴 Déclarée, et inutilisable. Distinct d'« absente » : il y a quelque chose
     à corriger dans le dépôt, et le gérant doit le lire comme tel. */
  LEGENDE_INVALIDE: 'legende_invalide',
  DEPOT_ILLISIBLE: 'depot_illisible',
});

/** Diagnostic rendu quand la lecture du Drive lève malgré ses propres filets. */
const DIAGNOSTIC_PANNE = 'panne';

/**
 * Empreinte de ce qu'une ligne porte du dépôt. Sert à répondre à une seule
 * question : « le dépôt a-t-il changé depuis la dernière alimentation ? »
 *
 * ⚠️ Elle NE compare PAS les objets tels quels. PostgreSQL range le `jsonb` en
 * réordonnant les clés : une comparaison par sérialisation dirait « différent »
 * à chaque passage, et la file serait réécrite toutes les heures pour rien.
 * On compare donc des composants ORDONNÉS et STABLES.
 */
function empreinteDepot({ publication, approbation, legende, surface, tolerance }) {
  const a = approbation || {};
  const composants = [
    empreinteCanonique(publication),
    String(publication?.mode_execution ?? ''),
    String(tolerance ?? ''),
    String(surface ?? ''),
    String(legende ?? ''),
    String(a.approuve === true),
    String(a.version_contenu ?? ''),
    String(a.payload_sha256 ?? ''),
    [...(Array.isArray(a.canaux_approuves) ? a.canaux_approuves : [])].sort().join(','),
    String(a.signature_hmac_sha256 ?? ''),
    `${a.creneau_approuve?.date_locale ?? ''}T${a.creneau_approuve?.heure_locale ?? ''}`,
  ];
  return crypto.createHash('sha256').update(composants.join('\n'), 'utf8').digest('hex');
}

/** Normalise un instant pour la comparaison : `…000Z` et `…Z` sont le même. */
function normaliserInstant(instant) {
  return String(instant ?? '').replace(/\.\d+Z$/, 'Z');
}

/**
 * Ce qu'un résultat d'hébergement change sur une ligne DÉJÀ en file — et rien
 * de plus.
 *
 * Rend `null` quand il n'y a rien à écrire : c'est ce qui empêche la file
 * d'être réécrite deux fois par jour pour un média qui échoue toujours pour la
 * même raison. Une ligne réécrite pour rien est du bruit dans `updated_at`, et
 * du bruit dans `updated_at` finit par cacher un vrai changement.
 *
 * @param {object|null} media      résultat de `heberger()`, ou `null` si non tenté
 * @param {object} existante       la ligne telle qu'elle est en base
 * @param {string} instantUtc
 * @param {object} [options]
 * @param {boolean} [options.mediaChange] le FICHIER a changé — pas la ligne.
 *   Voir `mediaAChange()` : c'est la distinction qui a coûté six adresses le
 *   19/09/2026 à 13 h 29.
 * @returns {object|null}
 */
function champsDuMedia(media, existante, instantUtc, { mediaChange = false } = {}) {
  const champs = {};
  const nouvelle = media?.url ?? null;
  const ancienneUrl = existante?.url_media ?? null;

  if (mediaChange) {
    /* 🔴 LE CAS QUI PUBLIERAIT LA MAUVAISE IMAGE.
       Le FICHIER déposé a changé, donc l'adresse d'avant pointe sur l'image
       d'avant — l'adresse porte l'empreinte du fichier. `url_media` vaut donc
       EXACTEMENT ce que cet hébergement-ci a rendu : une adresse fraîche, ou
       RIEN. Garder l'ancienne « en attendant », ce serait publier la vieille
       affiche sous la nouvelle légende, et personne n'aurait approuvé ça.
       Une ligne sans adresse ne part pas ; c'est le bon échec.

       ⛔ Et la réciproque, qui est le défaut corrigé le 19/09 au soir : tant
       que le fichier n'a PAS changé, cette branche ne doit pas s'ouvrir, même
       si la ligne est réécrite pour une tout autre raison (une approbation qui
       vient s'y ajouter, par exemple). Sinon chaque passage efface le travail
       d'hébergement du précédent et la file ne converge jamais. */
    if (nouvelle !== ancienneUrl) champs.url_media = nouvelle;
  } else if (nouvelle && nouvelle !== ancienneUrl) {
    champs.url_media = nouvelle;
  }

  // Hébergement non tenté (pas d'hébergeur, ou budget du passage atteint) : on
  // n'invente aucun motif. Le report est compté dans le bilan et dit au journal.
  if (!media) return Object.keys(champs).length > 0 ? champs : null;

  const erreur = erreurDeMedia(media, instantUtc);
  const ancienne = existante?.derniere_erreur || null;
  if (erreur) {
    // Le même motif qu'au passage précédent ne se réécrit pas.
    if (ancienne?.code_erreur !== erreur.code_erreur) champs.derniere_erreur = erreur;
  } else if (CODES_MEDIA.includes(ancienne?.code_erreur)) {
    // ⛔ On n'efface QUE nos propres motifs : une erreur laissée par l'exécuteur
    //    raconte une tentative de publication, et ce n'est pas à l'alimentation
    //    de la faire disparaître.
    champs.derniere_erreur = null;
  }

  return Object.keys(champs).length > 0 ? champs : null;
}

/**
 * 🔴 « LE MÉDIA A CHANGÉ » ≠ « LA LIGNE A ÉTÉ RÉÉCRITE ». La distinction qui
 * manquait, et ce qu'elle a coûté.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LA MESURE, D'ABORD
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Passage du 19/09/2026 à 13 h 29 (heure de Libreville). Avant : 42 lignes,
 * 9 avec `url_media`, 6 objets dans le bucket. Après : 44 lignes, 44 approuvées,
 * **3 avec `url_media`**, 8 objets. Six adresses perdues, et AUCUN objet
 * supprimé — les octets étaient toujours là, seule la ligne ne savait plus où.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CE QUI S'EST PASSÉ
 * ════════════════════════════════════════════════════════════════════════════
 *
 * La règle « dépôt changé + réhébergement reporté ⇒ l'ancienne adresse tombe »
 * est juste et elle est GARDÉE. Mais elle se déclenchait sur `empreinteDepot()`,
 * qui compare la ligne ENTIÈRE : manifeste, légende, créneau, tolérance,
 * surface **et approbation**. Quand l'approbation automatique est venue
 * s'ajouter aux 42 lignes, l'empreinte a changé pour les 42 — sans qu'un seul
 * fichier ait bougé. Chaque ligne a donc redemandé un hébergement, le budget
 * était épuisé (voir le défaut du temps), le réhébergement a été reporté, et
 * l'adresse est tombée. Le passage suivant recommençait : mouvement perpétuel.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LA QUESTION JUSTE, ET COMMENT ELLE SE TRANCHE SANS RIEN DEMANDER
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Le chemin de l'objet est `publications/<id>/v<version>/<md5>-<nom>`, et ce
 * md5 est celui que GOOGLE a calculé sur les octets stockés — mesuré, pas
 * déclaré, et déjà rendu par le listing. Donc :
 *
 *   - chemin attendu **identique** à celui que porte `url_media`
 *       → c'est le même fichier, l'objet est encore bon, **l'adresse se garde**
 *         même si l'hébergement est reporté, et on ne redemande rien ;
 *   - chemin attendu **différent**
 *       → le fichier a bougé : la règle d'origine s'applique, l'adresse tombe ;
 *   - chemin **indécidable** (`null` : pas de média pour ce canal, fichier
 *     absent du dossier, empreinte non rendue par Google)
 *       → on ne devine pas. On retombe sur la règle d'avant (« le dépôt
 *         a-t-il changé ? »), qui n'a jamais perdu une adresse sans raison
 *         quand l'empreinte manquait.
 *
 * @param {object} arg
 * @param {object} arg.depose        la publication telle que `drive.js` la rend
 * @param {string} arg.canal
 * @param {object} arg.existante     la ligne en base
 * @param {boolean} arg.depotInchange le repli quand l'empreinte du média manque
 * @returns {boolean}
 */
function mediaAChange({ depose, canal, existante, depotInchange }) {
  const attendu = cheminAttendu({ depose, canal });
  // Indécidable : la règle d'avant, ni plus stricte ni plus laxiste.
  if (attendu === null) return !depotInchange;
  return !urlPorteChemin(existante?.url_media ?? null, attendu);
}

/**
 * ⛔ CE QUE LA COLONNE `approbation` DOIT PORTER APRÈS CE PASSAGE.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * L'ORDRE DE PRÉSÉANCE, ET IL N'EST PAS NÉGOCIABLE
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   1. **Un humain d'abord.** Une approbation — ou un RETRAIT — venu de l'écran
 *      gagne sur tout. C'est ce qui fait que le bouton « Retirer l'approbation »
 *      sert à quelque chose : un retrait à 08 h 55 survit aux passages de 09 h,
 *      10 h et 11 h. Sans cette branche, la machine réapprouverait ce qu'un
 *      humain vient de refuser, et le bouton serait un décor.
 *   2. **Puis le dépôt.** Un `APPROBATION.json` posé dans le Drive est repris
 *      tel quel (règle d'avant, inchangée).
 *   3. **Puis l'automatique DÉJÀ VALIDE.** On ne la repose pas : reposer, ce
 *      serait réécrire la ligne à chaque passage avec un horodatage neuf, et
 *      `updated_at` ne dirait plus quand la ligne a vraiment changé.
 *   4. **Sinon, la machine approuve** — et seulement si le réglage le demande.
 *
 * ⛔ L'AUTO-CONTRÔLE DE LA MAISON EST GARDÉ : l'objet fabriqué repasse par
 * `verifierApprobation()`, la MÊME fonction que la sélection appellera au moment
 * de publier. Une approbation écrite mais inopérante serait un faux témoin — le
 * gérant verrait « approuvé » et rien ne partirait. Si elle refuse, on n'écrit
 * pas et le motif est rangé dans le bilan.
 *
 * @returns {{approbation: object|null, posee: boolean, humaine: boolean, refus: string|null}}
 */
function approbationPourLaLigne({
  publication, canal, approbationDuDepot, approbationDeLaLigne,
  automatique, instant, cleSignature,
}) {
  const retenue = approbationARetenir(approbationDuDepot, approbationDeLaLigne);
  const humaine = estDecisionHumaine(retenue);
  const inchange = { approbation: retenue, posee: false, humaine, refus: null };

  if (!automatique) return inchange;
  // 1. et 2. — l'humain, puis le dépôt. Tout ce qui n'est pas de la machine.
  if (retenue && retenue.origine !== ORIGINE_AUTOMATIQUE) return inchange;
  // 3. — une approbation automatique qui tient encore debout ne se repose pas.
  if (retenue && verifierApprobation({
    publication, approbation: retenue, canal, cleSignature,
  }).approuve) return inchange;

  // 4. — la machine approuve. L'empreinte du contenu est recalculée ici.
  const neuve = construireApprobationAutomatique({
    publication, canal, instant, cleSignature,
  });
  const controle = verifierApprobation({
    publication, approbation: neuve, canal, cleSignature,
  });
  if (!controle.approuve) {
    return { approbation: retenue, posee: false, humaine, refus: controle.raison };
  }
  return { approbation: neuve, posee: true, humaine: false, refus: null };
}

/**
 * ⛔ LE MAILLON. Lit les publications conformes du Drive et crée les lignes de
 * file correspondantes.
 *
 * Ne lève jamais : une panne Google ne doit pas faire tomber le passage qui
 * publie ce qui est DÉJÀ en file.
 *
 * @param {object} arg
 * @param {object} arg.depot   le port décrit en tête de fichier
 * @param {object} arg.client  client Drive (`lirePublications`, `telechargerFichier`)
 * @param {object} [arg.medias] hébergeur de `autopost-medias.js` (`heberger`).
 *   Absent, les lignes entrent sans média joignable — et le bilan le dit.
 * @param {number} [arg.televersementsMax] voir `TELEVERSEMENTS_MAX_PAR_PASSAGE`
 * @param {number} [arg.budgetHebergementMs] voir `BUDGET_HEBERGEMENT_MS`
 * @param {number} [arg.concurrenceLegendes] légendes téléchargées à la fois.
 *   `1` reproduit la file indienne d'avant le 19/09/2026 au soir — c'est ce que
 *   le banc de coût utilise pour mesurer l'AVANT.
 * @param {Function} [arg.horloge] chronomètre monotone, injecté pour les tests
 * @param {boolean} [arg.approbationAutomatique] réglage `autopost_controle.approbation_automatique`.
 *   ⛔ DÉFAUT `false`, et ce défaut est voulu : ce module ne décide pas de la
 *   politique d'approbation, il l'applique. Sans consigne explicite de
 *   l'appelant, il n'approuve RIEN — c'est la garantie qu'un futur appelant
 *   distrait (un script, un test, un outil de reprise) ne peut pas approuver
 *   par omission. La valeur par défaut du SYSTÈME, elle, est `true` : elle est
 *   en base, pas ici.
 * @param {string|null} [arg.cleSignature] `AUTOPOST_CLE_APPROBATION`, si posée
 * @param {number} [arg.plafondUrgenceMs] voir `PLAFOND_URGENCE_MS`
 * @param {number} [arg.horizonUrgenceMs] voir `HORIZON_URGENCE_MS`
 * @param {{par: string, utilisateur_id?: string|null}|null} [arg.declencheur]
 *   qui a demandé ce passage — la tâche planifiée ou un administrateur. Écrit
 *   dans le journal tel quel ; absent, le journal dit « non précisé ».
 * @param {Date|string} [arg.instant]
 * @param {Function} [arg.tracer]
 * @returns {Promise<object>} bilan de l'alimentation
 */
export async function alimenterFile({
  depot,
  client,
  medias = null,
  televersementsMax = TELEVERSEMENTS_MAX_PAR_PASSAGE,
  budgetHebergementMs = BUDGET_HEBERGEMENT_MS,
  plafondUrgenceMs = PLAFOND_URGENCE_MS,
  horizonUrgenceMs = HORIZON_URGENCE_MS,
  concurrenceLegendes = CONCURRENCE_PAR_DEFAUT,
  horloge = () => Date.now(),
  approbationAutomatique = false,
  cleSignature = null,
  declencheur = null,
  instant = new Date(),
  tracer = (...a) => console.log(...a),
}) {
  const instantUtc = typeof instant === 'string' ? instant : formaterInstantUtc(instant);
  const maintenantMs = msDepuisInstantUtc(instantUtc);
  /* 🔴 Le chronomètre part ICI, pas au premier téléversement. L'alimentation est
     la PREMIÈRE chose que fait un passage (`api/autopost.js`) : le temps déjà
     consommé par le listing du Drive et par la lecture des légendes fait donc
     bien partie du budget. Le compter à partir du premier téléversement
     laisserait ce temps-là hors du compte, et la marge serait fausse. */
  const debut = horloge();
  const ecoule = () => horloge() - debut;
  const bilan = {
    instant_utc: instantUtc,
    // ⚠️ La date de MOANDA à cet instant, pas celle du serveur Vercel (UTC).
    date_locale_moanda: dateLocaleDepuisInstantUtc(instantUtc),
    declencheur: declencheur ?? null,
    diagnostic: null,
    message: null,
    detail: null,
    lues: 0,
    creees: 0,
    mises_a_jour: 0,
    remplacees: 0,
    inchangees: 0,
    conflits: 0,
    ecartees: [],
    ecartees_par_le_lecteur: [],
    /**
     * Le média, compté À PART des écartements.
     *
     * ⚠️ Un média non hébergé n'écarte PAS la ligne : elle entre en file, elle
     *    est examinée, elle ne peut simplement pas partir. Le ranger dans
     *    `ecartees` ferait mentir le compteur affiché à l'écran (« N écartée(s) »
     *    alors que la ligne existe bel et bien).
     */
    medias: {
      hebergement: medias ? 'cable' : 'absent',
      heberges: 0,
      deja_presents: 0,
      reportes: 0,
      // Pourquoi le report a eu lieu, ou `null` s'il n'y en a pas eu. Sans ça,
      // « 12 reporté(s) » ne dirait pas s'il faut allonger le budget ou lever
      // le plafond — deux gestes différents.
      motif_report: null,
      budget_ms: budgetHebergementMs,
      // Le plafond d'engagement des lignes urgentes : au-delà, même l'image du
      // jour attend. Écrit dans le bilan pour que le journal dise sur quoi le
      // passage a compté.
      plafond_urgence_ms: plafondUrgenceMs,
      televersements_max: televersementsMax,
      televerses: 0,
      // Lignes urgentes hébergées APRÈS épuisement du budget ordinaire : le
      // dépassement a servi, et on le compte.
      urgents_hors_budget: 0,
      /* ⛔ Les lignes URGENTES reportées malgré tout. C'est le seul report qui
         peut coûter une publication du jour : il est nommé ligne par ligne, et
         le journal le dit en tête, jamais noyé dans « N reporté(s) ». */
      urgents_reportes: [],
      duree_ms: 0,
      ecartes: [],
    },
    /**
     * L'approbation automatique, comptée à part — jamais mélangée aux médias ni
     * aux écartements. Le gérant doit pouvoir lire, en une ligne du journal,
     * combien de publications la machine a approuvées à sa place.
     */
    approbation_auto: {
      reglage: approbationAutomatique ? 'activee' : 'desactivee',
      posees: 0,
      // Décisions humaines rencontrées et LAISSÉES EN PLACE. C'est le compteur
      // qui prouve que le bouton « Retirer l'approbation » gagne.
      humaines_respectees: 0,
      refusees: [],
    },
  };

  const ecarter = (pub, canal, motif, detail) => {
    bilan.ecartees.push({
      publication_id: pub?.publication_id ?? null,
      canal: canal?.canal ?? null,
      motif,
      detail: detail ?? null,
    });
  };

  /**
   * L'hébergement d'un canal, tenté une seule fois par passage.
   *
   * Le cache n'est pas une optimisation cosmétique : deux canaux d'une même
   * publication partagent souvent le même fichier, et sans lui on redemanderait
   * au stockage ce qu'on vient de lui demander.
   *
   * ⛔ NE LÈVE JAMAIS. `heberger()` ne lève déjà pas ; ce `catch` est le filet
   *    du filet, et il existe parce que la règle « alimenter et publier sont
   *    deux gestes » vaut aussi un cran plus bas.
   */
  const hebergements = new Map();
  let televersements = 0;
  const hebergerPour = async (depose, canal, { urgent = false } = {}) => {
    if (!medias) return null;
    /* 🔴 LA CLÉ DU CACHE EST LE CHEMIN DE L'OBJET, PAS LE CANAL.
       Facebook et Instagram publient presque toujours la MÊME affiche : même
       fichier, même md5, donc même objet dans le bucket. Avec une clé par
       canal, le second canal reposait au stockage une question à laquelle le
       premier venait de répondre — un aller-retour par canal supplémentaire et
       par publication, pour rien. Quand le chemin n'est pas calculable (pas de
       média pour ce canal, empreinte absente), on retombe sur la clé par canal :
       le motif d'échec, lui, parle bien du canal. */
    const cleH = cheminAttendu({ depose, canal })
      ?? `${depose?.publication?.publication_id ?? ''}|${canal}`;
    if (hebergements.has(cleH)) return hebergements.get(cleH);

    /* 🔴 LE BUDGET, DANS CET ORDRE.
       D'abord le TEMPS — c'est lui qui protège la publication. Puis le plafond
       en nombre, la ceinture qui va avec les bretelles au cas où le chronomètre
       mentirait (horloge gelée, machine suspendue).

       ⛔ Le plafond se compte en TÉLÉVERSEMENTS RÉELS, pas en tentatives : un
       média déjà hébergé ne coûte qu'une question au bucket et ne doit pas
       consommer le droit de déposer celui qui suit. Le temps, lui, se compte
       toujours : une question au bucket prend du temps elle aussi.

       🔴 UNE LIGNE URGENTE (créneau dans les 24 h) NE S'ARRÊTE PAS AU BUDGET
       ORDINAIRE : elle s'arrête au plafond d'engagement `PLAFOND_URGENCE_MS`,
       qui garde intacte la part MESURÉE de la réserve de publication. C'est la
       correction du 20/09 : l'image du jour ne doit plus attendre derrière le
       budget d'une autre. Voir `PLAFOND_URGENCE_MS`. */
    const ecouleMs = ecoule();
    let motifReport = null;
    if (urgent) {
      if (ecouleMs >= plafondUrgenceMs) motifReport = MOTIFS_REPORT.PLAFOND_URGENCE;
    } else if (ecouleMs >= budgetHebergementMs) {
      motifReport = MOTIFS_REPORT.BUDGET_TEMPS;
    }
    if (!motifReport && televersements >= televersementsMax) {
      motifReport = MOTIFS_REPORT.PLAFOND_TELEVERSEMENTS;
    }
    if (motifReport) {
      bilan.medias.reportes += 1;
      bilan.medias.motif_report = bilan.medias.motif_report || motifReport;
      if (urgent) {
        bilan.medias.urgents_reportes.push({
          publication_id: depose?.publication?.publication_id ?? null,
          canal,
          instant_utc: depose?.publication?.creneau?.instant_utc ?? null,
          motif: motifReport,
        });
      }
      tracer('[autopost] média%s reporté au prochain passage (%s, %d ms écoulées) : %s',
        urgent ? ' URGENT' : '', motifReport, ecouleMs, cleH);
      return null;
    }
    if (urgent && ecouleMs >= budgetHebergementMs) bilan.medias.urgents_hors_budget += 1;

    let resultat;
    try {
      resultat = await medias.heberger({ depose, canal });
    } catch (err) {
      resultat = {
        url: null,
        chemin: null,
        deja_present: false,
        televerse: false,
        motif: MOTIFS_MEDIA.STOCKAGE_INJOIGNABLE,
        detail: `hébergement impossible : ${err?.message || err}`,
        piste: 'La ligne reste en file : le prochain passage réessaiera.',
      };
      tracer('[autopost] hébergement impossible : %s', err?.message || err);
    }

    if (resultat?.televerse) {
      televersements += 1;
      bilan.medias.televerses = televersements;
    }

    if (resultat?.url) {
      if (resultat.deja_present) bilan.medias.deja_presents += 1;
      else bilan.medias.heberges += 1;
    } else {
      bilan.medias.ecartes.push({
        publication_id: depose?.publication?.publication_id ?? null,
        canal,
        motif: resultat?.motif ?? null,
        detail: resultat?.detail ?? null,
      });
    }

    hebergements.set(cleH, resultat);
    return resultat;
  };

  /* ── 1. LIRE LE DRIVE ─────────────────────────────────────────────────── */
  let lot;
  try {
    lot = await client.lirePublications();
  } catch (err) {
    bilan.diagnostic = DIAGNOSTIC_PANNE;
    bilan.message = 'Le Drive n\'a pas pu être lu : la file n\'a pas été alimentée.';
    bilan.detail = `lecture impossible : ${err?.message || err}`;
    tracer('[autopost] alimentation impossible : %s', err?.message || err);
    await journaliserSiUtile({ depot, bilan, instantUtc, force: true });
    return bilan;
  }

  bilan.diagnostic = lot?.diagnostic ?? null;
  bilan.message = lot?.message ?? null;
  bilan.detail = lot?.detail ?? null;
  bilan.ecartees_par_le_lecteur = (lot?.ecartees || []).map((e) => ({
    chemin: e.chemin ?? null,
    motif: MOTIFS.DEPOT_ILLISIBLE,
    detail: e.motif ?? null,
  }));

  const deposees = lot?.publications || [];
  bilan.lues = deposees.length;
  if (deposees.length === 0) {
    await journaliserSiUtile({ depot, bilan, instantUtc, force: bilan.ecartees_par_le_lecteur.length > 0 });
    return bilan;
  }

  /* ── 2. LIRE L'EXISTANT — regarder avant d'écrire ─────────────────────── */
  const ids = [...new Set(deposees.map((d) => d?.publication?.publication_id).filter(Boolean))];
  const existantes = ids.length > 0 ? (await depot.lireLignesDePublications(ids)) || [] : [];

  const parCle = new Map(existantes.map((l) => [l.cle_idempotence, l]));
  const parCouple = new Map();
  for (const l of existantes) {
    const couple = `${l.publication_id}|${l.canal}`;
    if (!parCouple.has(couple)) parCouple.set(couple, []);
    parCouple.get(couple).push(l);
  }

  const clesVues = new Set();
  /* ── 2 bis. LES LÉGENDES, TOUTES D'UN COUP ET PAR PAQUETS BORNÉS ───────
     🔴 Ce bloc est la seconde moitié de la correction du 19/09/2026 au soir.
     Avant lui, chaque canal téléchargeait sa légende à son tour, au fil de la
     boucle : 16 publications × 2 canaux = 32 allers-retours EN FILE INDIENNE,
     en plein milieu du budget de temps. Or aucune de ces lectures ne dépend
     d'une autre — elles ne dépendent que du listing, qui est déjà fait.

     On les demande donc ensemble, au plus `concurrenceLegendes` à la fois (les
     quotas Drive : voir `concurrence.js`). Le nombre de téléchargements ne
     change pas d'un seul, et un fichier cité deux fois n'est toujours lu
     qu'une fois — c'est le `Set` qui le garantit, comme la Map le faisait.

     ⛔ Une légende illisible reste un fait par CANAL, pas une panne globale :
     la valeur retenue est `null`, et la boucle écarte cette ligne-là avec son
     motif, exactement comme avant. */
  const legendesLues = new Map(); // fichier_id → texte (ou null), lu une seule fois
  const aLire = new Set();
  for (const d of deposees) {
    for (const canal of d?.publication?.canaux || []) {
      const fichierId = d?.captions?.[canal?.canal]?.fichier_id;
      if (fichierId) aLire.add(fichierId);
    }
  }
  await enParalleleBorne([...aLire], concurrenceLegendes, async (fichierId) => {
    try {
      legendesLues.set(fichierId, await client.telechargerFichier(fichierId));
    } catch (err) {
      legendesLues.set(fichierId, null);
      tracer('[autopost] légende illisible (%s) : %s', fichierId, err?.message || err);
    }
  });

  /* ── 3. UNE PUBLICATION À LA FOIS — LA PLUS URGENTE D'ABORD ─────────────
     🔴 Plus dans l'ordre des dossiers du Drive. Le 20/09, cet ordre a fait
     passer 30 dossiers de semaines futures devant celui du jour, et le budget
     d'hébergement est mort avant de l'atteindre. Voir `PLAFOND_URGENCE_MS`. */
  for (const { depose: depot_, u: urgence } of ordonnerParUrgence(deposees, maintenantMs, horizonUrgenceMs)) {
    const pub = depot_?.publication;
    const urgent = urgence.rang === RANGS_URGENCE.URGENT;

    // Le contrat, à la lettre, et importé — jamais recopié. Une seconde liste
    // de règles, ce sont deux vérités, et un jour le poster publie ce que le
    // contrat refuse.
    const controle = validerManifeste(pub);
    if (!controle.valide) {
      ecarter(pub, null, MOTIFS.MANIFESTE_INVALIDE, controle.erreurs.join(' · '));
      continue;
    }

    for (const canal of pub.canaux) {
      const cle = cleIdempotence(pub, canal);

      /* ── 3.a Deux fois la même clé dans un même dépôt ─────────────────
         La clé porte (publication, version, canal, compte, instant) mais PAS
         la surface : `facebook/feed` et `facebook/story` sur le même compte
         donnent la même clé. Sans ce contrôle, la seconde écraserait la
         première en silence. */
      if (clesVues.has(cle)) {
        ecarter(pub, canal, MOTIFS.CLE_EN_DOUBLE,
          `une autre entrée du dépôt porte déjà la clé ${cle} (surface « ${canal.surface} » ignorée)`);
        continue;
      }
      clesVues.add(cle);

      /* ── 3.b LE TÉMOIN DE L'EFFET, avant tout le reste ────────────────
         Quelle que soit la version déposée : si ce couple est déjà parti, il
         ne repart pas. C'est le contrôle qui empêche un client de Moanda de
         voir deux fois la même affiche. */
      const soeurs = parCouple.get(`${pub.publication_id}|${canal.canal}`) || [];
      const partie = soeurs.find((l) => l.id_distant || l.etat === 'published');
      if (partie) {
        ecarter(pub, canal, MOTIFS.DEJA_PARTI,
          `déjà publié (${partie.cle_idempotence}${partie.id_distant ? `, id_distant=${partie.id_distant}` : ''})`);
        continue;
      }

      /* ── 3.c La légende — DEUX FORMES, jamais fabriquée ────────────────
         `lireDeclarationLegende()` (le contrat) dit laquelle : un TEXTE posé
         directement dans `publication.json`, ou le NOM d'un fichier du dossier.
         Le texte en ligne ne coûte aucun téléchargement — c'est ce qui retire
         jusqu'à 48 appels d'un passage de 16 publications sur trois canaux. */
      const lue = lireDeclarationLegende(pub.captions?.[canal.canal]);
      const resolue = depot_?.captions?.[canal.canal];
      let legende = null;

      if (lue.forme === 'absente') {
        // Pour un canal publiant, une légende vide n'est pas « presque bon » :
        // ce serait une affiche postée sans un mot. Pour une remise à un
        // humain, l'absence de texte n'empêche rien : personne ne publie.
        if (CANAUX_PUBLIANTS.includes(canal.canal)) {
          ecarter(pub, canal, MOTIFS.LEGENDE_ABSENTE,
            `aucune légende déclarée pour « ${canal.canal} » dans publication.json`);
          continue;
        }
      } else if (lue.forme === 'invalide') {
        /* ⛔ QUELQUE CHOSE EST DÉCLARÉ, ET CE QUELQUE CHOSE N'EST PAS UNE
           LÉGENDE. Le cas mesuré : ChatGPT a écrit la chaîne « undefined ».
           On ne la publie pas, on ne devine rien à sa place, et on ne la range
           pas non plus dans « absente » — le gérant doit savoir qu'il y a à
           corriger dans le dépôt, pas croire qu'il manque une ligne. */
        ecarter(pub, canal, MOTIFS.LEGENDE_INVALIDE, lue.detail);
        continue;
      } else if (lue.forme === 'en_ligne') {
        // La légende EST dans le manifeste. Aucun appel réseau.
        legende = lue.texte;
      } else if (!resolue?.fichier_id) {
        ecarter(pub, canal, MOTIFS.LEGENDE_INTROUVABLE,
          `la légende « ${lue.chemin_relatif} » annoncée par publication.json n'est pas `
          + 'dans le dossier de la publication');
        continue;
      } else {
        // Déjà lue au bloc 2 bis, en parallèle borné. Rien ne part d'ici.
        legende = legendesLues.get(resolue.fichier_id);
        if (legende === null || legende === undefined) {
          ecarter(pub, canal, MOTIFS.LEGENDE_INTROUVABLE,
            `la légende « ${lue.chemin_relatif} » n'a pas pu être lue dans le Drive`);
          continue;
        }
        // ⛔ Le fichier existe et se lit — encore faut-il qu'il dise quelque
        //    chose. Un fichier vide, ou qui ne contient que « undefined »,
        //    partirait tel quel sur la page de l'imprimerie.
        if (!legendeUtilisable(legende)) {
          ecarter(pub, canal, MOTIFS.LEGENDE_INVALIDE,
            `la légende « ${lue.chemin_relatif} » ne contient pas de texte publiable `
            + `(« ${String(legende).trim().slice(0, 30) || '(vide)'} »)`);
          continue;
        }
      }

      const tolerance = typeof pub.creneau.tolerance_minutes === 'number'
        ? pub.creneau.tolerance_minutes
        : TOLERANCE_PAR_DEFAUT;
      /* ── 3.d LA LIGNE EXISTE-T-ELLE DÉJÀ, À CETTE CLÉ ? ───────────────── */
      const existante = parCle.get(cle);

      /* ⛔ L'APPROBATION DONNÉE DEPUIS L'APPLICATION SURVIT À CETTE RELECTURE.
         Avant le 19/09/2026, cette boucle réécrivait `approbation` avec ce que
         portait le dépôt — c'est-à-dire presque toujours `null`, puisque
         ChatGPT a interdiction d'écrire `APPROBATION.json`. Une approbation
         donnée à 08 h 55 était donc effacée par le passage de 09 h 00, juste
         avant d'être lue : l'écran d'approbation n'aurait pas tenu une heure.
         `approbationARetenir()` porte la règle, et son commentaire dit pourquoi
         conserver n'est pas contourner.

         🔴 Et depuis le 19/09/2026, la machine APPROUVE ici quand le réglage
         `approbation_automatique` le demande — y compris pour les lignes DÉJÀ
         en file : sans ça, les 42 lignes mesurées cette nuit-là seraient restées
         à approuver une par une. `approbationPourLaLigne()` porte l'ordre de
         préséance, et l'humain y passe devant la machine. */
      const decision = approbationPourLaLigne({
        publication: pub,
        canal: canal.canal,
        approbationDuDepot: depot_.approbation,
        approbationDeLaLigne: existante?.approbation,
        automatique: approbationAutomatique,
        instant: instantUtc,
        cleSignature,
      });
      const approbationRetenue = decision.approbation;
      if (decision.posee) bilan.approbation_auto.posees += 1;
      if (decision.humaine) bilan.approbation_auto.humaines_respectees += 1;
      if (decision.refus) {
        bilan.approbation_auto.refusees.push({
          publication_id: pub.publication_id,
          canal: canal.canal,
          raison: decision.refus,
        });
      }

      const empreinte = empreinteDepot({
        publication: pub,
        approbation: approbationRetenue,
        legende,
        surface: canal.surface,
        tolerance,
      });

      if (existante) {
        if (!ETATS_MODIFIABLES.includes(existante.etat)) {
          ecarter(pub, canal,
            existante.etat === 'cancelled' ? MOTIFS.LIGNE_ANNULEE : MOTIFS.LIGNE_EN_VOL,
            `la ligne est en état « ${existante.etat} » : le dépôt ne la réécrit pas`);
          continue;
        }

        const actuelle = empreinteDepot({
          publication: existante.publication,
          approbation: existante.approbation,
          legende: existante.legende,
          surface: existante.surface,
          tolerance: existante.tolerance_minutes,
        });
        const depotInchange = actuelle === empreinte;

        /* 🔴 LE MÉDIA D'UNE LIGNE DÉJÀ EN FILE.
           Deux raisons de (re)demander une adresse :
             - la ligne n'en a pas — elle ne partira jamais sans ;
             - le FICHIER a changé — l'adresse porte son empreinte, donc
               l'ancienne pointerait sur l'image d'avant la correction.
           Et une seule raison de ne rien faire : l'adresse que la ligne porte
           désigne déjà l'objet attendu. Ce cas-là ne coûte ni appel à Google ni
           appel au stockage — et c'est aussi ce qui fait CONVERGER la file :
           voir `mediaAChange()` pour ce que confondre « média changé » et
           « ligne réécrite » a coûté le 19/09/2026. */
        const mediaChange = mediaAChange({
          depose: depot_, canal: canal.canal, existante, depotInchange,
        });
        const media = (existante.url_media && !mediaChange)
          ? null
          : await hebergerPour(depot_, canal.canal, { urgent });
        const champsMedia = champsDuMedia(media, existante, instantUtc, { mediaChange });

        if (depotInchange && !champsMedia) {
          // Le cas de très loin le plus fréquent : le passage horaire relit un
          // dépôt qui n'a pas bougé. Aucune écriture, aucun bruit.
          bilan.inchangees += 1;
          continue;
        }

        const fait = await depot.mettreAJourDepuisDepot(cle, depotInchange
          // Le dépôt n'a pas bougé : on ne réécrit QUE ce que le média change.
          ? champsMedia
          : {
            surface: canal.surface,
            tolerance_minutes: tolerance,
            legende,
            publication: pub,
            // ⛔ Pas `depot_.approbation ?? null` : voir `approbationARetenir()`.
            approbation: approbationRetenue,
            ...(champsMedia || {}),
          });
        if (fait) {
          bilan.mises_a_jour += 1;
          tracer('[autopost] file mise à jour depuis le dépôt : %s', cle);
        } else {
          // La ligne a changé d'état entre notre lecture et notre écriture.
          // L'écriture conditionnelle a refusé — c'est exactement son rôle.
          bilan.conflits += 1;
        }
        continue;
      }

      /* ── 3.e PAS DE LIGNE À CETTE CLÉ : le dépôt a-t-il changé de version,
             de créneau ou de compte pour un couple déjà en file ? ───────── */
      const vivantes = soeurs.filter((l) => !l.id_distant && l.etat !== 'cancelled');
      const enVol = vivantes.find((l) => !ETATS_MODIFIABLES.includes(l.etat));
      if (enVol) {
        ecarter(pub, canal, MOTIFS.LIGNE_EN_VOL,
          `une version précédente (${enVol.cle_idempotence}) est en état « ${enVol.etat} » : `
          + 'on ne la remplace pas pendant qu\'elle est traitée');
        continue;
      }
      const plusRecente = vivantes.find((l) => Number(l.version_contenu) > Number(pub.version_contenu));
      if (plusRecente) {
        ecarter(pub, canal, MOTIFS.VERSION_ANTERIEURE,
          `la file porte déjà la version ${plusRecente.version_contenu} ; le dépôt propose la `
          + `version ${pub.version_contenu}. On ne revient pas en arrière tout seul.`);
        continue;
      }

      let remplacee = false;
      for (const ancienne of vivantes) {
        const annulee = await depot.annulerLigne(ancienne.cle_idempotence, {
          code_erreur: 'remplacee_par_un_nouveau_depot',
          message_erreur: `remplacée par ${cle} (dépôt relu dans le Drive)`,
          piste: 'Le contenu déposé a changé de version, de créneau ou de compte cible. '
            + 'Une seule ligne vivante est conservée par publication et par canal.',
          a_utc: instantUtc,
        });
        if (annulee) remplacee = true;
      }
      if (remplacee) bilan.remplacees += 1;

      /* ── 3.f L'INSERTION ─────────────────────────────────────────────── */
      // 🔴 Le média est demandé AVANT l'insertion : une ligne qui naîtrait sans
      //    adresse alors que le fichier est hébergeable attendrait le passage
      //    suivant pour rien.
      const mediaNeuf = await hebergerPour(depot_, canal.canal, { urgent });
      const issue = await depot.inserer({
        cle_idempotence: cle,
        publication_id: pub.publication_id,
        version_contenu: pub.version_contenu,
        canal: canal.canal,
        compte_cible_id: canal.compte_cible_id ?? null,
        surface: canal.surface,
        instant_utc: normaliserInstant(pub.creneau.instant_utc),
        // La date MÉTIER du créneau (Moanda), pas la date du serveur : c'est
        // elle qui sert au plafond journalier.
        date_locale: pub.creneau.date_locale,
        tolerance_minutes: tolerance,
        etat: ETAT_ENTREE,
        tentatives: 0,
        // ⛔ Écrits explicitement, et à rien. Le témoin de l'effet ne naît que
        //    d'une réponse de Meta enregistrée par l'exécuteur : aucune ligne
        //    sortie d'ici ne peut ressembler à une publication déjà partie.
        id_distant: null,
        id_conteneur: null,
        legende,
        // 🔴 L'adresse n'est pas FABRIQUÉE ici : elle est celle de l'objet
        //    réellement déposé dans le bucket `publications` par
        //    `autopost-medias.js`, ou `null`. Jamais un lien Drive, jamais une
        //    URL devinée — et jamais une adresse pour un téléversement qui a
        //    échoué : dans ce cas c'est `derniere_erreur` qui parle.
        url_media: mediaNeuf?.url ?? null,
        derniere_erreur: erreurDeMedia(mediaNeuf, instantUtc),
        publication: pub,
        /* 🔴 Ce qui a été déposé, ou — si et seulement si `approbation_automatique`
           est demandée — l'approbation posée par la machine à CETTE insertion.
           Elle porte `origine: 'automatique'`, `approuve_par: null` et
           l'empreinte du contenu : on peut toujours dire QUI a approuvé, et QUOI.
           Réglage désactivé : `null`, comme avant, et rien ne s'auto-approuve. */
        approbation: approbationRetenue,
      });

      if (issue?.insere) {
        bilan.creees += 1;
        tracer('[autopost] entrée en file : %s %s (%s)', pub.publication_id, canal.canal, cle);
      } else {
        // Refus de l'index unique : un autre passage a inséré la même ligne
        // entre notre lecture et notre écriture. C'est le filet qui joue son
        // rôle, pas une panne.
        bilan.conflits += 1;
      }
    }
  }

  bilan.medias.duree_ms = ecoule();
  await journaliserSiUtile({ depot, bilan, instantUtc });
  return bilan;
}

/**
 * Le journal — et sa retenue.
 *
 * Le passage tourne toutes les heures sur un dépôt qui, la plupart du temps,
 * n'a pas bougé. Écrire « rien de neuf » vingt-quatre fois par jour noierait
 * les lignes qui comptent : le journal affiché au gérant n'en montre que cent.
 * On n'écrit donc que si quelque chose a CHANGÉ, ou si le Drive est en panne.
 * Le bilan complet — écartements compris — est rangé dans la colonne `bilan`.
 */
async function journaliserSiUtile({ depot, bilan, instantUtc, force = false }) {
  const m = bilan.medias || { heberges: 0, ecartes: [] };
  // Un média nouvellement hébergé — ou refusé — est un changement : sans lui
  // dans ce calcul, le passage qui débloque enfin une publication resterait
  // muet au journal.
  const a = bilan.approbation_auto || { reglage: 'desactivee', posees: 0, refusees: [] };
  const urgentsReportes = m.urgents_reportes?.length || 0;
  const change = bilan.creees + bilan.mises_a_jour + bilan.remplacees
    + (m.heberges || 0) + (m.ecartes?.length || 0)
    // Une approbation posée par la machine est un changement qui se dit, même
    // si rien d'autre n'a bougé : c'est la chaîne qui décide à la place du
    // gérant, et ça ne se fait pas en silence.
    + (a.posees || 0) + (a.refusees?.length || 0)
    // ⛔ Une image urgente restée sans adresse se dit TOUJOURS : c'est une
    //    publication du jour qui risque de ne pas partir.
    + urgentsReportes;
  const pannne = bilan.diagnostic && !['ok', 'dossier_vide'].includes(bilan.diagnostic);
  if (!force && change === 0 && !pannne) return;

  await depot.journaliser({
    instant_utc: instantUtc,
    evenement: 'alimentation',
    resume: (urgentsReportes
      ? `⚠️ ${urgentsReportes} média(s) URGENT(S) — créneau dans les 24 h — sans adresse à ce passage `
        // Six noms au plus dans la phrase : la liste complète est dans `bilan`.
        + `(${m.urgents_reportes.slice(0, 6).map((u) => `${u.publication_id} ${u.canal}`).join(', ')}`
        + `${urgentsReportes > 6 ? `, et ${urgentsReportes - 6} autre(s)` : ''}) · `
      : '')
      + `Drive → file : ${bilan.creees} créée(s), ${bilan.mises_a_jour} mise(s) à jour, `
      + `${bilan.remplacees} remplacée(s), ${bilan.inchangees} inchangée(s), `
      + `${bilan.ecartees.length} écartée(s)`
      + (bilan.conflits ? `, ${bilan.conflits} conflit(s) d'écriture` : '')
      + ` · médias : ${m.heberges || 0} hébergé(s), ${m.deja_presents || 0} déjà là, `
      + `${m.ecartes?.length || 0} sans adresse`
      + (m.reportes
        ? `, ${m.reportes} reporté(s) au prochain passage (${m.motif_report}, `
          + `${m.duree_ms} ms sur un budget de ${m.budget_ms} ms)`
        : '')
      + (m.urgents_hors_budget
        ? `, ${m.urgents_hors_budget} urgent(s) traité(s) après le budget ordinaire`
        : '')
      // Le journal est lu par le gérant, pas par une machine : la phrase est en
      // français. Le code (`activee`) reste dans `bilan`, où il se relit.
      + ` · approbation automatique ${a.reglage === 'activee' ? 'activée' : 'désactivée'}`
      + ` : ${a.posees || 0} posée(s)`
      + (a.humaines_respectees ? `, ${a.humaines_respectees} décision(s) humaine(s) respectée(s)` : '')
      + (a.refusees?.length ? `, ${a.refusees.length} refusée(s) par le contrat` : '')
      + ` · ${phraseDeclencheur(bilan.declencheur)}`,
    piste: pannne ? bilan.message : (urgentsReportes
      ? 'Le plafond de temps du passage était atteint : le prochain passage réessaiera en '
        + 'premier. Si le créneau tombe avant, la publication ne partira pas — relancer un '
        + 'passage depuis l\'écran.'
      : null),
    bilan,
  });
}

/**
 * ⛔ QUI A DÉCLENCHÉ UN PASSAGE — la question que l'audit 41 n'a pas pu trancher
 * autrement qu'en devinant d'après les heures (§2 : « lecture cron ou manuel
 * SUPPOSÉE »). `autorisationTick()` le savait déjà ; le journal ne l'écrivait pas.
 *
 * Deux déclencheurs, et deux seulement — ceux que `api/autopost.js` admet :
 *   `cron`  — la tâche planifiée Vercel, qui présente `CRON_SECRET` ;
 *   `admin` — un administrateur connecté, identifié par l'identifiant de sa
 *             session signée (jamais par ce qu'un corps de requête affirme).
 */
export const DECLENCHEURS = Object.freeze({ CRON: 'cron', ADMIN: 'admin' });

/**
 * La phrase du journal, lue par le gérant.
 * @param {{par?: string, utilisateur_id?: string|null}|null} declencheur
 * @returns {string}
 */
export function phraseDeclencheur(declencheur) {
  if (declencheur?.par === DECLENCHEURS.CRON) return 'déclenché par la tâche planifiée';
  if (declencheur?.par === DECLENCHEURS.ADMIN) {
    return `déclenché par un administrateur (${declencheur.utilisateur_id || 'identifiant inconnu'})`;
  }
  return 'déclencheur non précisé';
}

export { empreinteDepot };
