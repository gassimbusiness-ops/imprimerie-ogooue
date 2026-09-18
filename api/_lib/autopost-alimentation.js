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
 *   ⛔ il n'approuve pas. Une ligne qui s'auto-approuverait serait le pire
 *      défaut possible de cette chaîne.
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
 *   3. **Un dépôt dont le contenu a changé fait REDEMANDER l'adresse**, même
 *      si la ligne en portait déjà une : le chemin de l'objet contient
 *      l'empreinte du fichier, donc une image corrigée a une autre adresse.
 *      Sans ce point, on publierait l'ancienne image sous le contenu nouveau.
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
import { validerManifeste, cleIdempotence, empreinteCanonique, CANAUX_PUBLIANTS } from './autopost-contrat.js';
import { erreurDeMedia, CODES_MEDIA, MOTIFS_MEDIA } from './autopost-medias.js';
import { formaterInstantUtc, dateLocaleDepuisInstantUtc } from '../../src/lib/dates.js';

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
 * 🔴 LE BUDGET DE TÉLÉVERSEMENTS D'UN PASSAGE.
 *
 * Alimenter était jusqu'ici une affaire de listings et de quelques fichiers
 * texte. Depuis l'hébergement des médias, un passage peut avoir à descendre
 * puis remonter plusieurs mégaoctets — et les 14 publications qui attendent
 * dans le Drive en feraient une vingtaine d'un coup, au premier passage.
 *
 * Or l'alimentation tourne DANS la même fonction serverless que la publication.
 * Une alimentation qui fait expirer la fonction n'empêche pas seulement
 * d'alimenter : elle empêche de PUBLIER ce qui est déjà en file. C'est
 * exactement la règle « alimenter et publier sont deux gestes », vue du côté du
 * temps.
 *
 * Au-delà de ce budget, les médias restants ne sont pas tentés : leur ligne
 * entre quand même en file, sans adresse, et le passage suivant les reprend —
 * ce qui est déjà hébergé ne coûte alors qu'une question au bucket. Un report
 * n'est PAS une erreur : il est compté (`medias.reportes`) et dit au journal,
 * mais il n'écrit rien dans `derniere_erreur`. Un bandeau rouge pour une
 * décision volontaire est un faux témoin, dans l'autre sens.
 */
export const TELEVERSEMENTS_MAX_PAR_PASSAGE = 6;

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
 * @returns {object|null}
 */
function champsDuMedia(media, existante, instantUtc, { contenuChange = false } = {}) {
  const champs = {};
  const nouvelle = media?.url ?? null;
  const ancienneUrl = existante?.url_media ?? null;

  if (contenuChange) {
    /* 🔴 LE CAS QUI PUBLIERAIT LA MAUVAISE IMAGE.
       Le contenu déposé a changé, donc l'adresse d'avant pointe sur l'image
       d'avant — l'adresse porte l'empreinte du fichier. `url_media` vaut donc
       EXACTEMENT ce que cet hébergement-ci a rendu : une adresse fraîche, ou
       RIEN. Garder l'ancienne « en attendant », ce serait publier la vieille
       affiche sous la nouvelle légende, et personne n'aurait approuvé ça.
       Une ligne sans adresse ne part pas ; c'est le bon échec. */
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
 * @param {Date|string} [arg.instant]
 * @param {Function} [arg.tracer]
 * @returns {Promise<object>} bilan de l'alimentation
 */
export async function alimenterFile({
  depot,
  client,
  medias = null,
  televersementsMax = TELEVERSEMENTS_MAX_PAR_PASSAGE,
  instant = new Date(),
  tracer = (...a) => console.log(...a),
}) {
  const instantUtc = typeof instant === 'string' ? instant : formaterInstantUtc(instant);
  const bilan = {
    instant_utc: instantUtc,
    // ⚠️ La date de MOANDA à cet instant, pas celle du serveur Vercel (UTC).
    date_locale_moanda: dateLocaleDepuisInstantUtc(instantUtc),
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
      ecartes: [],
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
  const hebergerPour = async (depose, canal) => {
    if (!medias) return null;
    const cleH = `${depose?.publication?.publication_id ?? ''}|${canal}`;
    if (hebergements.has(cleH)) return hebergements.get(cleH);

    // ⛔ Le budget se compte en TÉLÉVERSEMENTS RÉELS, pas en tentatives : un
    //    média déjà hébergé ne coûte qu'une question au bucket et ne doit pas
    //    consommer le droit de déposer celui qui suit.
    if (televersements >= televersementsMax) {
      bilan.medias.reportes += 1;
      tracer('[autopost] média reporté au prochain passage (budget atteint) : %s', cleH);
      return null;
    }

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

    if (resultat?.televerse) televersements += 1;

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
  const legendesLues = new Map(); // fichier_id → texte, pour ne télécharger qu'une fois

  /* ── 3. UNE PUBLICATION À LA FOIS ─────────────────────────────────────── */
  for (const depot_ of deposees) {
    const pub = depot_?.publication;

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

      /* ── 3.c La légende, lue dans le Drive — jamais fabriquée ────────── */
      const declaree = pub.captions?.[canal.canal];
      const resolue = depot_?.captions?.[canal.canal];
      let legende = null;
      if (!declaree) {
        // Pour un canal publiant, une légende vide n'est pas « presque bon » :
        // ce serait une affiche postée sans un mot. Pour une remise à un
        // humain, l'absence de texte n'empêche rien : personne ne publie.
        if (CANAUX_PUBLIANTS.includes(canal.canal)) {
          ecarter(pub, canal, MOTIFS.LEGENDE_ABSENTE,
            `aucune légende déclarée pour « ${canal.canal} » dans publication.json`);
          continue;
        }
      } else if (!resolue?.fichier_id) {
        ecarter(pub, canal, MOTIFS.LEGENDE_INTROUVABLE,
          `la légende « ${declaree.chemin_relatif} » annoncée par publication.json n'est pas `
          + 'dans le dossier de la publication');
        continue;
      } else {
        if (!legendesLues.has(resolue.fichier_id)) {
          try {
            legendesLues.set(resolue.fichier_id, await client.telechargerFichier(resolue.fichier_id));
          } catch (err) {
            legendesLues.set(resolue.fichier_id, null);
            tracer('[autopost] légende illisible (%s) : %s', resolue.chemin_relatif, err?.message || err);
          }
        }
        legende = legendesLues.get(resolue.fichier_id);
        if (legende === null || legende === undefined) {
          ecarter(pub, canal, MOTIFS.LEGENDE_INTROUVABLE,
            `la légende « ${declaree.chemin_relatif} » n'a pas pu être lue dans le Drive`);
          continue;
        }
      }

      const tolerance = typeof pub.creneau.tolerance_minutes === 'number'
        ? pub.creneau.tolerance_minutes
        : TOLERANCE_PAR_DEFAUT;
      const empreinte = empreinteDepot({
        publication: pub,
        approbation: depot_.approbation,
        legende,
        surface: canal.surface,
        tolerance,
      });

      /* ── 3.d LA LIGNE EXISTE-T-ELLE DÉJÀ, À CETTE CLÉ ? ───────────────── */
      const existante = parCle.get(cle);
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
             - le dépôt a changé — l'adresse porte l'empreinte du fichier, donc
               l'ancienne pointerait sur l'image d'avant la correction.
           Et une seule raison de ne rien faire : la ligne a une adresse ET le
           dépôt n'a pas bougé. C'est le cas le plus fréquent, et il ne coûte
           alors ni appel à Google ni appel au stockage. */
        const media = (existante.url_media && depotInchange)
          ? null
          : await hebergerPour(depot_, canal.canal);
        const champsMedia = champsDuMedia(media, existante, instantUtc, {
          contenuChange: !depotInchange,
        });

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
            approbation: depot_.approbation ?? null,
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
      const mediaNeuf = await hebergerPour(depot_, canal.canal);
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
        // ⛔ Ce qui a été déposé, ou `null`. JAMAIS une approbation fabriquée.
        approbation: depot_.approbation ?? null,
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
  const change = bilan.creees + bilan.mises_a_jour + bilan.remplacees
    + (m.heberges || 0) + (m.ecartes?.length || 0);
  const pannne = bilan.diagnostic && !['ok', 'dossier_vide'].includes(bilan.diagnostic);
  if (!force && change === 0 && !pannne) return;

  await depot.journaliser({
    instant_utc: instantUtc,
    evenement: 'alimentation',
    resume: `Drive → file : ${bilan.creees} créée(s), ${bilan.mises_a_jour} mise(s) à jour, `
      + `${bilan.remplacees} remplacée(s), ${bilan.inchangees} inchangée(s), `
      + `${bilan.ecartees.length} écartée(s)`
      + (bilan.conflits ? `, ${bilan.conflits} conflit(s) d'écriture` : '')
      + ` · médias : ${m.heberges || 0} hébergé(s), ${m.deja_presents || 0} déjà là, `
      + `${m.ecartes?.length || 0} sans adresse`
      + (m.reportes ? `, ${m.reportes} reporté(s) au prochain passage` : ''),
    piste: pannne ? bilan.message : null,
    bilan,
  });
}

export { empreinteDepot };
