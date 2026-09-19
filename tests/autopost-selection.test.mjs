/**
 * Auto-poster — le noyau de sélection : « qu'est-ce qui est à publier ? »
 *
 * CE QUE CES TESTS PROTÈGENT
 *
 * Toutes les façons dont un auto-poster peut nuire passent par cette fonction :
 * publier un brouillon, publier deux fois, publier en avance, publier une offre
 * périmée, ou ne rien publier sans qu'on sache pourquoi.
 *
 * ⛔ ZÉRO APPEL RÉSEAU dans ce fichier : la fonction testée n'a même pas de quoi
 *    en faire un. Elle ne connaît ni `fetch`, ni Supabase, ni `Date.now()`.
 *
 * Les trois fuseaux de `npm test` (Africa/Libreville, UTC, America/Los_Angeles)
 * doivent donner exactement les mêmes résultats — c'est l'objet du dernier bloc.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  travauxDus,
  RAISONS,
  retardMaxGarantiMinutes,
  toleranceRecommandeeMinutes,
  resumerDecision,
} from '../api/_lib/autopost-selection.js';
import {
  empreinteCanonique,
  cleIdempotence,
  validerManifeste,
  verifierApprobation,
  signerApprobation,
} from '../api/_lib/autopost-contrat.js';
import { instantUtcDepuisCreneau, formaterInstantLocal } from '../src/lib/dates.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Fabriques — une publication conforme, qu'on abîme ensuite champ par champ
   ═══════════════════════════════════════════════════════════════════════════ */

/* ⛔ Une ÉTIQUETTE, pas un numéro. Depuis le 19/09/2026 au soir, `compte_cible_id`
   ne porte plus d'identifiant Meta : l'application résout l'étiquette elle-même
   au moment de publier. Un numéro en clair est refusé — voir
   `tests/autopost-comptes-cibles.test.mjs`. */
const PAGE_ID = 'PAGE_IMPRIMERIE';

function manifeste({
  id = 'PUB-2026-S39-1-02',
  date = '2026-09-21',
  heure = '17:30',
  version = 1,
  mode = 'live',
  offres = [{ offre_id: null, libelle: 'sans offre chiffrée', prix_affiche: false, valide_jusqu_au_local: null }],
} = {}) {
  return {
    schema_version: '2.0',
    publication_id: id,
    campagne_id: 'CAMP-RENTREE-2026-09',
    version_contenu: version,
    semaine_iso: '2026-S39',
    annee_iso: 2026,
    numero_semaine_iso: 39,
    jour_iso: 1,
    date_locale: date,
    creneau: {
      date_locale: date,
      heure_locale: heure,
      fuseau: 'Africa/Libreville',
      offset_utc: '+01:00',
      instant_utc: instantUtcDepuisCreneau({ date_locale: date, heure_locale: heure, offset_utc: '+01:00' }),
      tolerance_minutes: 90,
    },
    format: 'photo',
    mode_execution: mode,
    medias: [{
      role: 'principal',
      canal_cible: ['facebook', 'instagram'],
      chemin_relatif: '2026-09-21_OGOOUE_Textile_1080x1350_v01_APPROUVE.jpg',
      sha256: 'a'.repeat(64),
      mime_type: 'image/jpeg',
      largeur_px: 1080,
      hauteur_px: 1350,
      duree_s: null,
      ordre_carrousel: 1,
      deja_publie: false,
      origine: 'photo_reelle',
      droits: null,
    }],
    captions: {
      facebook: { chemin_relatif: 'caption_facebook.txt', sha256: 'b'.repeat(64), caracteres: 612, hashtags: 3, mentions: 0 },
    },
    cta: 'Envoyez la date, les quantités et votre logo',
    code_provenance: 'OG-01-S39',
    offres,
    canaux: [{ canal: 'facebook', compte_cible_id: PAGE_ID, type_cible: 'page', surface: 'feed', etat: 'scheduled' }],
    genere_par: 'chatgpt',
    avertissements: [],
  };
}

function approbationDe(pub, { canaux = ['facebook'], version = null, cle = null } = {}) {
  const a = {
    publication_id: pub.publication_id,
    version_contenu: version ?? pub.version_contenu,
    approuve: true,
    approuve_par: 'compte-applicatif-gassim',
    canaux_approuves: canaux,
    creneau_approuve: {
      date_locale: pub.creneau.date_locale,
      heure_locale: pub.creneau.heure_locale,
      fuseau: 'Africa/Libreville',
      instant_utc: pub.creneau.instant_utc,
    },
    payload_sha256: empreinteCanonique(pub),
  };
  if (cle) a.signature_hmac_sha256 = signerApprobation(a, cle);
  return a;
}

function ligne(pub, appro, sur = {}) {
  const canal = sur.canal || 'facebook';
  return {
    cle_idempotence: cleIdempotence(pub, { canal, compte_cible_id: PAGE_ID }),
    publication_id: pub.publication_id,
    version_contenu: pub.version_contenu,
    canal,
    compte_cible_id: PAGE_ID,
    surface: 'feed',
    instant_utc: pub.creneau.instant_utc,
    date_locale: pub.date_locale,
    tolerance_minutes: pub.creneau.tolerance_minutes,
    etat: 'scheduled',
    tentatives: 0,
    tentatives_max: 3,
    id_distant: null,
    id_conteneur: null,
    legende: 'texte de la légende',
    url_media: 'https://exemple.invalid/signee.jpg',
    publication: pub,
    approbation: appro,
    ...sur,
  };
}

/** Le créneau du 21/09 à 17 h 30 locales = 16:30:00Z. */
const CRENEAU_UTC = '2026-09-21T16:30:00Z';

/* ═══════════════════════════════════════════════════════════════════════════
   1. LE CRÉNEAU
   ═══════════════════════════════════════════════════════════════════════════ */

test('un créneau passé, dans la tolérance, part', () => {
  const p = manifeste();
  const d = travauxDus({ file: [ligne(p, approbationDe(p))], instant: '2026-09-21T16:45:00Z' });
  assert.equal(d.aPublier.length, 1, resumerDecision(d));
  assert.equal(d.ecartes.length, 0);
});

test('un créneau futur ne part pas — on ne publie JAMAIS en avance', () => {
  const p = manifeste();
  const d = travauxDus({ file: [ligne(p, approbationDe(p))], instant: '2026-09-21T16:29:00Z' });
  assert.equal(d.aPublier.length, 0);
  assert.equal(d.ecartes[0].raison, RAISONS.CRENEAU_FUTUR);
});

test('à la seconde exacte du créneau, ça part', () => {
  const p = manifeste();
  const d = travauxDus({ file: [ligne(p, approbationDe(p))], instant: CRENEAU_UTC });
  assert.equal(d.aPublier.length, 1);
});

test('hors tolérance, ça ne part pas — périmé, pas rattrapé', () => {
  const p = manifeste();
  // tolérance 90 min, on arrive 91 min après
  const d = travauxDus({ file: [ligne(p, approbationDe(p))], instant: '2026-09-21T18:01:00Z' });
  assert.equal(d.aPublier.length, 0);
  assert.equal(d.ecartes[0].raison, RAISONS.HORS_TOLERANCE);
  assert.match(d.ecartes[0].detail, /retard 91 min/);
});

test('une tolérance plus courte que la cadence est signalée AVANT que le créneau ne passe', () => {
  const p = manifeste();
  p.creneau.tolerance_minutes = 30; // le défaut du contrat
  const l = ligne(p, approbationDe(p));
  l.tolerance_minutes = 30;
  const d = travauxDus({ file: [l], instant: '2026-09-21T12:00:00Z' });

  assert.equal(d.aPublier.length, 0, 'le créneau est encore à venir');
  assert.equal(d.alertes.length, 1);
  assert.equal(d.alertes[0].alerte, 'tolerance_insuffisante');
  assert.match(d.alertes[0].detail, /89 min/);
});

test('une tolérance trop courte qui a fait perdre la publication le dit dans la raison', () => {
  const p = manifeste();
  p.creneau.tolerance_minutes = 30;
  const l = ligne(p, approbationDe(p));
  l.tolerance_minutes = 30;
  const d = travauxDus({ file: [l], instant: '2026-09-21T17:15:00Z' }); // 45 min de retard
  assert.equal(d.ecartes[0].raison, RAISONS.HORS_TOLERANCE);
  assert.match(d.ecartes[0].detail, /plus courte que les 89 min/);
});

test('le retard garanti est calculé, pas promis : 59 min à l\'heure pile, 89 min à la demie', () => {
  assert.equal(retardMaxGarantiMinutes('2026-09-21T08:00:00Z'), 59);
  assert.equal(retardMaxGarantiMinutes('2026-09-21T16:30:00Z'), 89);
  assert.equal(toleranceRecommandeeMinutes('2026-09-21T16:30:00Z'), 89);
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. L'APPROBATION — la règle qui ne se négocie pas
   ═══════════════════════════════════════════════════════════════════════════ */

test('⛔ un contenu NON APPROUVÉ ne part jamais, même l\'heure passée', () => {
  const p = manifeste();
  const d = travauxDus({ file: [ligne(p, null)], instant: '2026-09-21T16:45:00Z' });
  assert.equal(d.aPublier.length, 0);
  assert.equal(d.ecartes[0].raison, RAISONS.NON_APPROUVE);
  assert.equal(d.ecartes[0].detail, 'approbation_absente');
});

test('⛔ une approbation refusée n\'est pas une approbation', () => {
  const p = manifeste();
  const a = approbationDe(p);
  a.approuve = false;
  const d = travauxDus({ file: [ligne(p, a)], instant: '2026-09-21T16:45:00Z' });
  assert.equal(d.aPublier.length, 0);
  assert.equal(d.ecartes[0].detail, 'approbation_refusee');
});

test('⛔ une légende modifiée après approbation INVALIDE l\'approbation', () => {
  const p = manifeste();
  const a = approbationDe(p);
  p.captions.facebook.sha256 = 'c'.repeat(64); // le texte a changé
  const d = travauxDus({ file: [ligne(p, a)], instant: '2026-09-21T16:45:00Z' });
  assert.equal(d.ecartes[0].detail, 'contenu_modifie_depuis_approbation');
});

test('⛔ un créneau déplacé après approbation INVALIDE l\'approbation', () => {
  const p = manifeste();
  const a = approbationDe(p);
  // Le créneau bouge et l'empreinte est refaite : seul le bloc `creneau_approuve`
  // garde la trace de ce qui avait réellement été approuvé.
  p.creneau.heure_locale = '19:00';
  p.creneau.instant_utc = instantUtcDepuisCreneau(p.creneau);
  a.payload_sha256 = empreinteCanonique(p);
  const l = ligne(p, a);
  l.instant_utc = p.creneau.instant_utc;
  const d = travauxDus({ file: [l], instant: '2026-09-21T18:30:00Z' });
  assert.equal(d.ecartes[0].detail, 'creneau_modifie_depuis_approbation');
});

test('⛔ une approbation pour Facebook ne vaut pas pour Instagram', () => {
  const p = manifeste();
  const a = approbationDe(p, { canaux: ['facebook'] });
  const d = travauxDus({ file: [ligne(p, a, { canal: 'instagram' })], instant: '2026-09-21T16:45:00Z' });
  assert.equal(d.ecartes[0].detail, 'canal_non_approuve');
});

test('⛔ une correction après approbation (version_contenu +1) coupe la publication', () => {
  const p = manifeste();
  const a = approbationDe(p);      // approuve la version 1
  p.version_contenu = 2;           // quelqu'un corrige
  a.payload_sha256 = empreinteCanonique(p);
  const d = travauxDus({ file: [ligne(p, a)], instant: '2026-09-21T16:45:00Z' });
  assert.equal(d.ecartes[0].detail, 'approbation_perimee_version_contenu');
});

test('la signature HMAC est vérifiée quand la clé est configurée', () => {
  const p = manifeste();
  const cle = 'clé-de-test-approbation-2026-09-au-moins-32-car';
  const bonne = approbationDe(p, { cle });
  assert.equal(
    travauxDus({ file: [ligne(p, bonne)], instant: '2026-09-21T16:45:00Z', options: { cleSignature: cle } }).aPublier.length,
    1,
  );

  const falsifiee = { ...bonne, signature_hmac_sha256: crypto.randomBytes(32).toString('hex') };
  const d = travauxDus({ file: [ligne(p, falsifiee)], instant: '2026-09-21T16:45:00Z', options: { cleSignature: cle } });
  assert.equal(d.aPublier.length, 0);
  assert.equal(d.ecartes[0].detail, 'signature_approbation_invalide');
});

test('ChatGPT ne peut pas s\'auto-approuver : une approbation inventée ne correspond pas au contenu', () => {
  const p = manifeste();
  const inventee = {
    publication_id: p.publication_id,
    version_contenu: 1,
    approuve: true,
    canaux_approuves: ['facebook', 'instagram'],
    creneau_approuve: { date_locale: p.date_locale, heure_locale: p.creneau.heure_locale },
    payload_sha256: '0'.repeat(64), // il ne sait pas calculer la charge canonique
  };
  const d = travauxDus({ file: [ligne(p, inventee)], instant: '2026-09-21T16:45:00Z' });
  assert.equal(d.ecartes[0].detail, 'contenu_modifie_depuis_approbation');
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. L'IDEMPOTENCE — le témoin de l'effet, pas un statut
   ═══════════════════════════════════════════════════════════════════════════ */

test('⛔ déjà publié (id_distant présent) ne republie JAMAIS', () => {
  const p = manifeste();
  const l = ligne(p, approbationDe(p), { id_distant: '100000000000001_777' });
  const d = travauxDus({ file: [l], instant: '2026-09-21T16:45:00Z' });
  assert.equal(d.aPublier.length, 0);
  assert.equal(d.ecartes[0].raison, RAISONS.DEJA_PUBLIE);
});

test('le témoin l\'emporte sur l\'état : id_distant présent + etat scheduled → on ne republie pas', () => {
  // C'est LA leçon SingPay. Un état corrompu, remis à 'scheduled' par un autre
  // chemin, ne doit pas suffire à faire repartir une publication déjà faite.
  const p = manifeste();
  const l = ligne(p, approbationDe(p), { id_distant: '100000000000001_777', etat: 'scheduled' });
  const d = travauxDus({ file: [l], instant: '2026-09-21T16:45:00Z' });
  assert.equal(d.aPublier.length, 0);
  assert.equal(d.ecartes[0].raison, RAISONS.DEJA_PUBLIE);
});

test('un état non éligible (executing, failed, expired) ne repart pas tout seul', () => {
  const p = manifeste();
  for (const etat of ['executing', 'failed', 'expired', 'suspended', 'draft', 'cancelled']) {
    const d = travauxDus({ file: [ligne(p, approbationDe(p), { etat })], instant: '2026-09-21T16:45:00Z' });
    assert.equal(d.aPublier.length, 0, `etat=${etat} ne devrait pas partir`);
    assert.equal(d.ecartes[0].raison, RAISONS.ETAT_NON_ELIGIBLE);
  }
});

test('les reprises sont bornées', () => {
  const p = manifeste();
  const d = travauxDus({ file: [ligne(p, approbationDe(p), { tentatives: 3, tentatives_max: 3 })], instant: '2026-09-21T16:45:00Z' });
  assert.equal(d.ecartes[0].raison, RAISONS.TENTATIVES_EPUISEES);
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. LES GARDE-FOUS
   ═══════════════════════════════════════════════════════════════════════════ */

test('l\'arrêt global vide la sélection et le dit ligne par ligne', () => {
  const p = manifeste();
  const d = travauxDus({
    file: [ligne(p, approbationDe(p))],
    instant: '2026-09-21T16:45:00Z',
    options: { arretGlobal: true },
  });
  assert.equal(d.aPublier.length, 0);
  assert.equal(d.ecartes[0].raison, RAISONS.ARRET_GLOBAL);
});

test('le plafond journalier mord sur les plus récents, pas au hasard', () => {
  // Deux créneaux tous deux échus et tous deux dans leur tolérance : seul le
  // plafond peut les départager, et il doit servir le plus ancien d'abord.
  const tot = manifeste({ id: 'PUB-2026-S39-1-01', heure: '09:00' });   // 08:00Z
  const tard = manifeste({ id: 'PUB-2026-S39-1-02', heure: '09:30' });  // 08:30Z
  const d = travauxDus({
    // Volontairement donnés dans le désordre : le tri doit venir du code.
    file: [ligne(tard, approbationDe(tard)), ligne(tot, approbationDe(tot))],
    instant: '2026-09-21T09:00:00Z',
    options: { plafondJournalier: 1, dejaPubliesAujourdhui: 0 },
  });
  assert.equal(d.aPublier.length, 1);
  assert.equal(d.aPublier[0].publication_id, 'PUB-2026-S39-1-01', 'le plus ancien passe d\'abord');
  assert.equal(d.ecartes[0].raison, RAISONS.PLAFOND_JOURNALIER);
  assert.equal(d.ecartes[0].publication_id, 'PUB-2026-S39-1-02');
});

test('le plafond tient compte de ce qui est déjà parti aujourd\'hui', () => {
  const p = manifeste({ heure: '09:00' });
  const d = travauxDus({
    file: [ligne(p, approbationDe(p))],
    instant: '2026-09-21T09:00:00Z',
    options: { plafondJournalier: 4, dejaPubliesAujourdhui: 4 },
  });
  assert.equal(d.aPublier.length, 0);
  assert.equal(d.ecartes[0].raison, RAISONS.PLAFOND_JOURNALIER);
});

test('un compte cible absent arrête la publication — TopShop partage le même environnement Meta', () => {
  const p = manifeste();
  const d = travauxDus({ file: [ligne(p, approbationDe(p), { compte_cible_id: null })], instant: '2026-09-21T16:45:00Z' });
  assert.equal(d.aPublier.length, 0);
  assert.equal(d.ecartes[0].raison, RAISONS.COMPTE_CIBLE_ABSENT);
});

test('une offre périmée suspend la publication, comparaison EN DATE LOCALE', () => {
  const p = manifeste({
    offres: [{ offre_id: 'OF-1', libelle: 'offre rentrée', prix_affiche: false, valide_jusqu_au_local: '2026-09-20' }],
  });
  const d = travauxDus({ file: [ligne(p, approbationDe(p))], instant: '2026-09-21T16:45:00Z' });
  assert.equal(d.ecartes[0].raison, RAISONS.OFFRE_PERIMEE);
});

test('une offre valide le jour même passe — la veille au soir en UTC n\'est pas « hier »', () => {
  const p = manifeste({
    offres: [{ offre_id: 'OF-1', libelle: 'offre rentrée', prix_affiche: false, valide_jusqu_au_local: '2026-09-21' }],
  });
  const d = travauxDus({ file: [ligne(p, approbationDe(p))], instant: '2026-09-21T16:45:00Z' });
  assert.equal(d.aPublier.length, 1);
});

test('un canal de remise à un humain n\'appelle aucune API', () => {
  const p = manifeste();
  const d = travauxDus({ file: [ligne(p, approbationDe(p), { canal: 'whatsapp_handoff' })], instant: '2026-09-21T16:45:00Z' });
  assert.equal(d.aPublier.length, 0);
  assert.equal(d.ecartes[0].raison, RAISONS.CANAL_SANS_PUBLICATION);
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. LE CONTRAT publication.json
   ═══════════════════════════════════════════════════════════════════════════ */

test('un manifeste valide passe la validation', () => {
  assert.equal(validerManifeste(manifeste()).valide, true);
});

test('une version de schéma inconnue est refusée, pas ignorée', () => {
  const p = manifeste();
  p.schema_version = '1.0';
  const r = validerManifeste(p);
  assert.equal(r.valide, false);
  assert.match(r.erreurs.join(' '), /schema_version/);
});

test('⛔ un instant_utc incohérent avec date+heure+offset est REFUSÉ, pas corrigé', () => {
  const p = manifeste();
  p.creneau.instant_utc = '2026-09-21T17:30:00Z'; // l'erreur classique : heure locale collée en UTC
  const r = validerManifeste(p);
  assert.equal(r.valide, false);
  assert.match(r.erreurs.join(' '), /ne correspond pas au recalcul/);

  const d = travauxDus({ file: [ligne(p, approbationDe(p))], instant: '2026-09-21T18:00:00Z' });
  assert.equal(d.aPublier.length, 0);
  assert.equal(d.ecartes[0].raison, RAISONS.MANIFESTE_INVALIDE);
});

test('une divergence entre la ligne de file et le manifeste refuse au lieu de choisir', () => {
  const p = manifeste();
  const l = ligne(p, approbationDe(p), { instant_utc: '2026-09-21T15:30:00Z' });
  const d = travauxDus({ file: [l], instant: '2026-09-21T16:45:00Z' });
  assert.equal(d.ecartes[0].raison, RAISONS.CRENEAU_INCOHERENT);
});

test('un prix affiché sans catalogue validé est refusé', () => {
  const p = manifeste({
    offres: [{ offre_id: 'OF-1', libelle: 'flocage', prix_affiche: true, version_catalogue: null, valide_jusqu_au_local: null }],
  });
  const r = validerManifeste(p);
  assert.equal(r.valide, false);
  assert.match(r.erreurs.join(' '), /prix_affiche/);
});

test('un PNG destiné à Instagram est refusé à la validation, pas au moment de publier', () => {
  const p = manifeste();
  p.medias[0].mime_type = 'image/png';
  const r = validerManifeste(p);
  assert.equal(r.valide, false);
  assert.match(r.erreurs.join(' '), /image\/jpeg/);
});

test('une origine de média absente est refusée : elle ne se devine pas', () => {
  const p = manifeste();
  delete p.medias[0].origine;
  assert.equal(validerManifeste(p).valide, false);
});

test('un chemin de média absolu ou en URL est refusé', () => {
  for (const chemin of ['/var/medias/a.jpg', 'https://drive.google.com/a.jpg']) {
    const p = manifeste();
    p.medias[0].chemin_relatif = chemin;
    assert.equal(validerManifeste(p).valide, false, chemin);
  }
});

test('la validation rend TOUTES les erreurs, pas seulement la première', () => {
  const p = manifeste();
  p.schema_version = '1.0';
  p.publication_id = 'PUB-TROP-COURT';
  delete p.medias[0].origine;
  assert.ok(validerManifeste(p).erreurs.length >= 3);
});

test('la clé d\'idempotence est le quintuplet du dossier', () => {
  const p = manifeste();
  assert.equal(
    cleIdempotence(p, { canal: 'facebook', compte_cible_id: PAGE_ID }),
    `PUB-2026-S39-1-02|v1|facebook|${PAGE_ID}|2026-09-21T16:30:00Z`,
  );
});

test('la charge canonique est stable : deux calculs sur le même contenu donnent la même empreinte', () => {
  const a = manifeste();
  const b = manifeste();
  // Ordre des canaux et des captions inversé : l'empreinte ne doit pas bouger.
  b.canaux = [...b.canaux].reverse();
  assert.equal(empreinteCanonique(a), empreinteCanonique(b));
});

test('le brief et les avertissements ne comptent PAS dans l\'approbation', () => {
  const a = manifeste();
  const b = manifeste();
  b.avertissements = ['une remarque ajoutée après coup'];
  b.genere_le = '2026-09-19T08:00:00+01:00';
  assert.equal(empreinteCanonique(a), empreinteCanonique(b));
});

test('verifierApprobation refuse une approbation portant sur une autre publication', () => {
  const p = manifeste();
  const autre = manifeste({ id: 'PUB-2026-S39-2-01' });
  const r = verifierApprobation({ publication: p, approbation: approbationDe(autre), canal: 'facebook' });
  assert.equal(r.approuve, false);
  assert.equal(r.raison, 'approbation_pour_une_autre_publication');
});

/* ═══════════════════════════════════════════════════════════════════════════
   6. LE FUSEAU — le même résultat sous TZ=Libreville, UTC et Los_Angeles
   ═══════════════════════════════════════════════════════════════════════════ */

test('17 h 30 à Moanda = 16:30:00Z, quel que soit le fuseau de la machine', () => {
  assert.equal(
    instantUtcDepuisCreneau({ date_locale: '2026-09-21', heure_locale: '17:30', offset_utc: '+01:00' }),
    '2026-09-21T16:30:00Z',
  );
  assert.equal(
    instantUtcDepuisCreneau({ date_locale: '2026-09-21', heure_locale: '09:00', offset_utc: '+01:00' }),
    '2026-09-21T08:00:00Z',
  );
});

test('minuit trente à Moanda reste le même JOUR local, et recule d\'un jour en UTC', () => {
  assert.equal(
    instantUtcDepuisCreneau({ date_locale: '2026-09-21', heure_locale: '00:30', offset_utc: '+01:00' }),
    '2026-09-20T23:30:00Z',
  );
});

test('un compte rendu affiche l\'heure de Moanda avec son offset ET le nom du fuseau', () => {
  assert.equal(
    formaterInstantLocal('2026-09-21T16:30:42Z'),
    '2026-09-21 17:30:42 (+01:00 Africa/Libreville)',
  );
});

test('un créneau inventé (31 février) est refusé, pas reporté au 3 mars', () => {
  assert.equal(instantUtcDepuisCreneau({ date_locale: '2026-02-31', heure_locale: '09:00', offset_utc: '+01:00' }), null);
});

test('un instant sans Z est refusé : sans fuseau explicite, il serait lu en heure locale', () => {
  const p = manifeste();
  p.creneau.instant_utc = '2026-09-21T16:30:00';
  assert.match(validerManifeste(p).erreurs.join(' '), /finit pas par Z/);
});

test('la décision est identique quel que soit TZ — vérifié en forçant le fuseau du processus', () => {
  const p = manifeste();
  const f = [ligne(p, approbationDe(p))];
  const attendu = travauxDus({ file: f, instant: '2026-09-21T16:45:00Z' }).aPublier.length;

  const avant = process.env.TZ;
  for (const tz of ['UTC', 'America/Los_Angeles', 'Africa/Libreville', 'Asia/Tokyo']) {
    process.env.TZ = tz;
    assert.equal(
      travauxDus({ file: f, instant: '2026-09-21T16:45:00Z' }).aPublier.length,
      attendu,
      `décision différente sous TZ=${tz}`,
    );
  }
  process.env.TZ = avant;
});
