/**
 * Écran « Publications automatiques ».
 *
 * ════════════════════════════════════════════════════════════════════════════
 * POURQUOI CET ÉCRAN EXISTE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Un auto-posteur qu'on ne peut pas regarder est un auto-posteur qu'on ne peut
 * pas réparer. Celui-ci tourne tout seul, à heure fixe, sur la Page publique de
 * l'entreprise : le gérant doit pouvoir répondre à quatre questions sans appeler
 * personne.
 *
 *   1. Qu'est-ce qui est PRÉVU, et à quelle heure de Moanda ?
 *   2. Qu'est-ce qui est PARTI, et où le voir ?
 *   3. Qu'est-ce qui a ÉCHOUÉ, et POURQUOI — en français, pas en code d'erreur ?
 *   4. Est-ce que la chaîne est seulement en marche ?
 *
 * ⚠️ Deux choses que cet écran refuse de faire, et c'est délibéré :
 *
 *   - il n'affiche JAMAIS « publié » comme une preuve de visibilité publique.
 *     Tant que le test de visibilité du §2.2 n'a pas été fait, une réponse 200
 *     d'une application Meta non publiée ne prouve pas qu'un client de Moanda
 *     voit le post. La mention est portée à l'écran, pas gommée ;
 *   - il ne montre pas un écran vide quand la lecture échoue. « Rien de prévu »
 *     et « je n'ai pas pu lire » sont deux phrases différentes : c'est le piège
 *     documenté dans `src/services/db.js`, 130 lectures d'écran concernées.
 */
import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/services/api-client';
import { useAuth } from '@/services/auth';
import { formaterInstantLocal } from '@/lib/dates';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  CalendarClock, CheckCircle2, XCircle, AlertTriangle, RefreshCw,
  PauseCircle, PlayCircle, Eye, EyeOff, HardDriveDownload, ImageOff,
  ShieldCheck, ShieldOff, KeyRound,
} from 'lucide-react';
import { toast } from 'sonner';

/* ─── VOCABULAIRE — les états de la file, en français ─── */

const ETATS = {
  draft: { label: 'Brouillon', couleur: 'bg-slate-100 text-slate-700' },
  scheduled: { label: 'Prévu', couleur: 'bg-blue-100 text-blue-700' },
  executing: { label: 'En cours', couleur: 'bg-amber-100 text-amber-700' },
  published: { label: 'Parti', couleur: 'bg-emerald-100 text-emerald-700' },
  failed: { label: 'Échoué', couleur: 'bg-red-100 text-red-700' },
  expired: { label: 'Périmé', couleur: 'bg-orange-100 text-orange-700' },
  suspended: { label: 'Suspendu', couleur: 'bg-orange-100 text-orange-700' },
  reconciling: { label: 'À vérifier', couleur: 'bg-violet-100 text-violet-700' },
  cancelled: { label: 'Annulé', couleur: 'bg-slate-100 text-slate-500' },
};

/**
 * Les raisons d'écartement, traduites. Elles sont écrites pour être lues par
 * quelqu'un qui n'est pas développeur, et qui doit décider quoi faire.
 */
const RAISONS = {
  arret_global: 'La chaîne est à l\'arrêt (interrupteur général).',
  canal_sans_publication: 'Ce canal est une remise à un humain : aucune publication automatique.',
  deja_publie: 'Déjà parti — l\'identifiant rendu par Meta est enregistré.',
  etat_non_eligible: 'Cet état ne permet pas de partir automatiquement.',
  tentatives_epuisees: 'Toutes les tentatives ont été utilisées.',
  manifeste_invalide: 'Le fichier publication.json est incomplet ou mal formé.',
  creneau_incoherent: 'L\'heure du fichier et celle de la file ne concordent pas. Rien n\'est publié tant que ce n\'est pas tranché.',
  creneau_futur: 'L\'heure n\'est pas encore arrivée.',
  hors_tolerance: 'Le créneau est passé depuis trop longtemps : la publication n\'a plus de sens éditorial.',
  offre_perimee: 'L\'offre citée dans le contenu a expiré.',
  non_approuve: 'Pas approuvé. Rien ne part sans approbation.',
  compte_cible_absent: 'Aucun compte Meta cible : impossible de vérifier qu\'on publie au bon endroit.',
  plafond_journalier: 'Plafond de publications du jour atteint.',
  pris_par_une_autre_execution: 'Une autre exécution s\'en occupait déjà.',
};

/**
 * Pourquoi un dépôt du Drive n'est pas entré en file. Ces phrases sont lues par
 * quelqu'un qui doit décider quoi faire — pas par un développeur.
 * Voir `api/_lib/autopost-alimentation.js`.
 */
const MOTIFS_ALIMENTATION = {
  manifeste_invalide: 'Le fichier publication.json ne respecte pas le contrat. Rien n\'est réparé en silence.',
  cle_en_double_dans_le_depot: 'Deux entrées du même dépôt visent le même compte au même moment.',
  deja_parti: 'Déjà publié : une affiche ne repart pas, même redéposée ou corrigée.',
  ligne_en_vol: 'Une version précédente est en cours de traitement : on ne la remplace pas maintenant.',
  ligne_annulee: 'Cette ligne a été annulée. Elle ne se remet pas en route toute seule.',
  version_anterieure_a_la_file: 'Le dépôt propose une version plus ancienne que celle déjà en file.',
  legende_absente: 'Aucune légende déclarée pour ce canal : une affiche ne part pas sans un mot.',
  legende_introuvable: 'La légende annoncée n\'est pas dans le dossier de la publication.',
  depot_illisible: 'Ce dossier du Drive n\'a pas pu être lu.',

  /* Hébergement du média. La SOURCE DE VÉRITÉ des codes est `MOTIFS_MEDIA` dans
     `api/_lib/autopost-medias.js` ; un test refuse qu'un code y apparaisse sans
     phrase ici, sinon l'écran affiche le code brut au gérant. */
  aucun_media_pour_ce_canal: 'Aucun média ne cible ce canal dans publication.json.',
  media_introuvable_dans_le_dossier: 'Le fichier annoncé n\'est pas dans le dossier de la publication.',
  type_de_media_non_admis: 'Format de fichier refusé par le stockage. Rien n\'est converti ici.',
  media_trop_lourd: 'Fichier trop lourd : le stockage refuse au-delà de 15 Mo.',
  empreinte_media_absente: 'Google ne donne pas d\'empreinte pour ce fichier : ce n\'est probablement pas une vraie image.',
  media_illisible_dans_le_drive: 'Google n\'a pas rendu le fichier. Le prochain passage réessaiera.',
  hebergement_indisponible: 'Le stockage des médias n\'a pas répondu. Le prochain passage réessaiera.',
};

const DETAILS_APPROBATION = {
  approbation_absente: 'aucun fichier d\'approbation',
  approbation_refusee: 'approbation explicitement refusée',
  approbation_pour_une_autre_publication: 'l\'approbation porte sur une autre publication',
  approbation_perimee_version_contenu: 'le contenu a été corrigé après l\'approbation',
  canal_non_approuve: 'ce canal n\'a pas été approuvé',
  contenu_modifie_depuis_approbation: 'le contenu a changé depuis l\'approbation',
  creneau_modifie_depuis_approbation: 'l\'horaire a changé depuis l\'approbation',
  signature_approbation_invalide: 'signature d\'approbation invalide',
};

/**
 * ⛔ LES ÉTATS SUR LESQUELS L'APPROBATION PEUT ENCORE CHANGER QUELQUE CHOSE.
 *
 * Reprise de `ETATS_MODIFIABLES` (`api/_lib/autopost-alimentation.js`). La
 * liste est ici EN DOUBLE, et c'est assumé : un écran de navigateur ne peut pas
 * importer un module `api/_lib` (il charge `node:crypto`). Ce doublon ne décide
 * de rien — il ne fait que MASQUER un bouton. Ce qui refuse réellement, c'est
 * la même condition posée dans l'instruction SQL de `ecrireApprobation()` :
 * même si cette liste dérivait, aucune ligne partie ou en vol ne pourrait être
 * approuvée.
 */
const ETATS_APPROBABLES = ['draft', 'scheduled', 'failed', 'expired', 'suspended'];

function heureDeMoanda(instantUtc) {
  const rendu = formaterInstantLocal(instantUtc);
  return rendu || '—';
}

/* ─── BANDEAU D'ÉTAT ─── */

function Voyant({ actif, ouiTexte, nonTexte, Icone }) {
  return (
    <div className="flex items-start gap-2">
      <Icone className={`mt-0.5 h-4 w-4 shrink-0 ${actif ? 'text-emerald-600' : 'text-orange-500'}`} />
      <span className="text-sm">{actif ? ouiTexte : nonTexte}</span>
    </div>
  );
}

/**
 * ⛔ LE VOYANT DRIVE — quatre pannes, quatre phrases, quatre gestes.
 *
 * Avant le 18/09/2026, cet écran affichait « Accès Drive non configuré » pour
 * QUATRE causes différentes. Et son voyant vert ne prouvait rien : il
 * constatait que trois variables étaient posées dans Vercel, sans qu'aucune
 * ligne de code n'ait jamais ouvert le Drive. Un voyant qui passe au vert sans
 * que rien ne fonctionne est exactement le faux témoin qu'on a déjà corrigé
 * deux fois cette semaine (le badge « Sans mdp », le score fabriqué à 0).
 *
 * Le bloc `drive` de `/api/autopost-etat` vient désormais d'une VRAIE lecture
 * (`api/_lib/drive.js`). On affiche SA phrase, et le geste qui la répare :
 *
 *   non_configure        → Gassim pose les variables dans Vercel ;
 *   cle_refusee          → la clé est mal collée ou révoquée ;
 *   dossier_inaccessible → le partage du dossier a été oublié (le cas le plus
 *                          fréquent), ou l'identifiant est celui d'un voisin ;
 *   dossier_vide         → tout marche, ChatGPT n'a simplement rien déposé.
 *
 * Le repli sur l'ancien texte n'est pas de la coquetterie : pendant les
 * quelques minutes qui séparent le déploiement de l'API de celui du bundle,
 * une réponse sans champ `drive` arrive ici, et l'écran doit tenir.
 */
function VoyantDrive({ drive, configure }) {
  if (!drive) {
    return (
      <Voyant
        actif={configure}
        Icone={HardDriveDownload}
        ouiTexte="Accès Drive : trois variables sont posées. Ce que le robot lit vraiment n'a pas encore été mesuré."
        nonTexte="Accès Drive non configuré : les publications doivent être déposées depuis l'application."
      />
    );
  }

  const ok = drive.diagnostic === 'ok';
  const vide = drive.diagnostic === 'dossier_vide';
  // « Vide » n'est pas une panne : le robot LIT, il n'y a rien à lire.
  const Icone = ok ? CheckCircle2 : (vide ? HardDriveDownload : AlertTriangle);
  const teinte = ok ? 'text-emerald-600' : (vide ? 'text-slate-500' : 'text-orange-500');

  return (
    <div className="flex items-start gap-2">
      <Icone className={`mt-0.5 h-4 w-4 shrink-0 ${teinte}`} />
      <div className="text-sm">
        <div>{drive.message}</div>
        {drive.piste && <div className="mt-1 text-slate-600">{drive.piste}</div>}
        {drive.detail && (
          <div className="mt-1 font-mono text-xs text-slate-400">{drive.detail}</div>
        )}
      </div>
    </div>
  );
}

/**
 * Ce que la dernière relecture du Drive a donné — y compris ce qu'elle a
 * ÉCARTÉ, avec le motif. Une alimentation qui ne rendrait qu'un nombre serait
 * un troisième faux témoin : « 0 créée » ne dit pas s'il n'y avait rien à
 * prendre ou si tout a été refusé, et ce ne sont pas les mêmes gestes.
 */
function PanneauAlimentation({ alimentation }) {
  if (!alimentation) return null;
  const a = alimentation;
  const panne = a.diagnostic && !['ok', 'dossier_vide'].includes(a.diagnostic);
  const ecartees = a.ecartees || [];
  const parLecteur = a.ecartees_par_le_lecteur || [];

  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <h2 className="flex items-center gap-2 font-semibold">
          <HardDriveDownload className="h-4 w-4" /> Dernière relecture du Drive
        </h2>

        {panne
          ? (
            <p className="text-sm text-orange-800">
              Le Drive n&apos;a pas pu être lu : {a.message}
            </p>
          )
          : (
            <p className="text-sm text-slate-700">
              {a.lues || 0} publication(s) lue(s) dans le Drive · <strong>{a.creees || 0} créée(s)</strong> dans
              la file · {a.mises_a_jour || 0} mise(s) à jour · {a.remplacees || 0} remplacée(s) ·
              {' '}{a.inchangees || 0} inchangée(s) · {ecartees.length} écartée(s).
            </p>
          )}

        {ecartees.length > 0 && (
          <div className="space-y-1">
            {ecartees.map((e, i) => (
              <div key={`${e.publication_id}-${e.canal}-${i}`} className="rounded border border-amber-200 bg-amber-50 p-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <XCircle className="h-3.5 w-3.5 shrink-0 text-amber-700" />
                  <span className="font-medium">{e.publication_id || 'dépôt sans identifiant'}</span>
                  {e.canal && <Badge variant="outline">{e.canal}</Badge>}
                </div>
                <div className="mt-1 text-amber-900">{MOTIFS_ALIMENTATION[e.motif] || e.motif}</div>
                {/* Le détail BRUT reste lisible à côté de la phrase : c'est lui
                    qui dit quelle ligne du fichier corriger. */}
                {e.detail && <div className="mt-1 font-mono text-xs text-amber-700">{e.detail}</div>}
              </div>
            ))}
          </div>
        )}

        {parLecteur.length > 0 && (
          <p className="text-sm text-slate-600">
            {parLecteur.length} dossier(s) du Drive n&apos;ont pas pu être lus ou ne contiennent pas
            de publication.json.
          </p>
        )}

        {/* 🔴 CE QUE LA MACHINE A APPROUVÉ À LA PLACE DU GÉRANT, compté à part.
            Et le REPORT de médias, avec son motif : « 12 reporté(s) » sans
            motif ne dirait pas s'il faut allonger le budget de temps ou lever
            le plafond — deux gestes différents. Un report n'est PAS une erreur,
            d'où le gris et non le rouge. */}
        {a.approbation_auto && a.approbation_auto.posees > 0 && (
          <p className="text-sm text-slate-700">
            <strong>{a.approbation_auto.posees}</strong> publication(s) approuvée(s)
            automatiquement à l&apos;entrée en file.
            {a.approbation_auto.humaines_respectees > 0 && (
              <> {a.approbation_auto.humaines_respectees} décision(s) humaine(s) laissée(s)
                intacte(s).</>
            )}
          </p>
        )}
        {a.medias?.reportes > 0 && (
          <p className="text-sm text-slate-600">
            {a.medias.reportes} média(s) reporté(s) au prochain passage — le temps réservé à
            l&apos;hébergement était écoulé ({a.medias.duree_ms} ms sur {a.medias.budget_ms} ms).
            Ce n&apos;est pas une erreur : la publication de ce qui est déjà en file passe avant.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Bandeau({ etat }) {
  const enMarche = etat?.controle?.actif === true;
  const reel = etat?.controle?.mode === 'live' && etat?.mode_global === 'live' && etat?.jeton_meta_present;

  return (
    <Card>
      <CardContent className="grid gap-3 p-4 sm:grid-cols-2">
        <Voyant
          actif={enMarche}
          Icone={enMarche ? PlayCircle : PauseCircle}
          ouiTexte="Chaîne en marche : les passages horaires examinent la file."
          nonTexte="Chaîne à l'arrêt. Rien ne partira, et la file est conservée."
        />
        <Voyant
          actif={reel}
          Icone={reel ? PlayCircle : PauseCircle}
          ouiTexte="Mode RÉEL : les publications approuvées partent sur Facebook et Instagram."
          nonTexte="Mode SIMULATION : tout est examiné, rien n'est envoyé, aucun appel réseau."
        />
        <Voyant
          actif={etat?.jeton_meta_present}
          Icone={etat?.jeton_meta_present ? CheckCircle2 : AlertTriangle}
          ouiTexte="Jeton Meta présent."
          nonTexte="Jeton Meta absent — c'est normal aujourd'hui. Tant qu'il manque, tout reste en simulation."
        />
        <VoyantDrive drive={etat?.drive} configure={etat?.acces_drive_configure} />
      </CardContent>
      <LigneApprobationAutomatique controle={etat?.controle} />
    </Card>
  );
}

/**
 * ⛔ LE RÉGLAGE D'APPROBATION AUTOMATIQUE — UNE LIGNE DE TEXTE, SANS BOUTON.
 *
 * Gassim a demandé l'automatique et a explicitement refusé l'interrupteur à
 * l'écran (« pas d'interrupteur […] on va pas utiliser »). Il n'y a donc PAS de
 * bouton ici, et c'est volontaire.
 *
 * Mais un réglage qui décide à la place du gérant et qui ne se voit nulle part
 * serait un faux témoin de plus : quelqu'un lirait « approuvé » sur 42 lignes
 * sans savoir que personne ne les a lues. L'état est donc ÉCRIT, en clair, à
 * côté des autres voyants. Le renverser se fait en base, sans redéployer :
 *   UPDATE autopost_controle SET approbation_automatique = false WHERE id = 'global';
 */
function LigneApprobationAutomatique({ controle }) {
  if (!controle) return null;
  const active = controle.approbation_automatique !== false;
  const sansColonne = controle.reglage_approbation === 'colonne_absente';

  return (
    <div className="border-t border-slate-200 px-4 py-2 text-sm text-slate-700">
      <span className="inline-flex items-center gap-1.5">
        {active
          ? <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
          : <ShieldOff className="h-3.5 w-3.5 shrink-0 text-slate-500" />}
        <span>
          Approbation automatique : <strong>{active ? 'activée' : 'désactivée'}</strong>
          {active
            ? ' — les publications entrent en file déjà approuvées par la machine.'
            : ' — chaque publication doit être approuvée à la main, ci-dessous.'}
        </span>
      </span>
      {sansColonne && (
        <div className="mt-1 text-xs text-amber-800">
          Réglage non encore créé en base (migration 014 non appliquée) : c&apos;est le défaut du
          code qui s&apos;applique. Tant qu&apos;elle manque, le seul retour arrière est
          l&apos;arrêt complet de la chaîne.
        </div>
      )}
    </div>
  );
}

/* ─── UNE LIGNE DE LA FILE ─── */

/**
 * ⛔ LE GESTE D'APPROBATION, SUR LA LIGNE QUI LE PORTE.
 *
 * Avant le 19/09/2026, `signerApprobation()` n'avait AUCUN appelant dans tout
 * le dépôt : l'écran d'approbation annoncé par les commentaires n'existait pas.
 * La sélection écartait donc chaque ligne avec `non_approuve`, et personne ne
 * pouvait lever ce refus. C'est ce bouton, et rien d'autre, qui manquait.
 *
 * Trois choses qu'il dit, et qui ne doivent pas disparaître :
 *
 *   1. ce qu'il fait, en toutes lettres — « Approuver » et « Retirer
 *      l'approbation », pas une case à cocher muette. Approuver n'est pas
 *      publier : la publication partira au passage horaire suivant son créneau,
 *      et seulement si la chaîne est en marche ;
 *   2. ce qu'il vaut. Sans `AUTOPOST_CLE_APPROBATION`, l'approbation est
 *      enregistrée SANS signature. On l'écrit, au lieu d'un voyant vert ;
 *   3. qu'une approbation se défait. Approuver par erreur à 08 h 55 doit pouvoir
 *      s'annuler avant 09 h 00, au même endroit et en un clic.
 */
function BlocApprobation({ l, peutApprouver, enCours, surApprobation }) {
  const a = l.approbation;
  const approuve = a?.approuve === true;
  const retiree = a && a.approuve !== true && a.retire_le_utc;
  const modifiable = !l.id_distant && ETATS_APPROBABLES.includes(l.etat);
  // `ORIGINE_AUTOMATIQUE` de `api/_lib/autopost-contrat.js`. Recopiée ici plutôt
  // qu'importée : rien de `api/` n'entre dans le bundle du navigateur.
  const parLaMachine = a?.origine === 'automatique';

  return (
    <div className="mt-2 rounded border border-slate-200 bg-slate-50 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-start gap-1.5 text-sm">
          {approuve
            ? <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            : <ShieldOff className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />}
          <div>
            {approuve && (
              <div className="text-emerald-800">
                Approuvé pour {(a.canaux_approuves || []).join(', ') || l.canal}
                {/* 🔴 QUI A APPROUVÉ — la machine ou un humain. Les deux objets
                    se ressemblent (même empreinte, même forme) ; seule
                    `origine` les distingue, et ne pas l'afficher laisserait
                    croire à une relecture humaine qui n'a pas eu lieu. */}
                {parLaMachine
                  ? <> <strong>automatiquement</strong>, à l&apos;entrée en file</>
                  : a.approuve_par && <> par <strong>{a.approuve_par}</strong></>}
                {a.approuve_le_utc && <> le {heureDeMoanda(a.approuve_le_utc)}</>}.
              </div>
            )}
            {approuve && parLaMachine && (
              <div className="mt-0.5 text-xs text-slate-600">
                Personne ne l&apos;a relue. Le contenu a été vérifié par le contrat
                (format du manifeste, empreinte, créneau), pas par un œil humain.
                Le bouton ci-contre retire l&apos;approbation, et ce retrait tient :
                aucun passage ne le réécrira.
              </div>
            )}
            {!approuve && retiree && (
              <div className="text-orange-800">
                Approbation retirée{a.retire_par && <> par <strong>{a.retire_par}</strong></>}
                {a.retire_le_utc && <> le {heureDeMoanda(a.retire_le_utc)}</>}.
                Cette publication ne partira pas.
              </div>
            )}
            {!approuve && !retiree && (
              <div className="text-orange-800">
                Pas approuvé. Rien ne part sans approbation, même une fois l&apos;heure passée.
              </div>
            )}
            {approuve && (
              <div className="mt-0.5 text-xs text-slate-500">
                L&apos;approbation porte l&apos;empreinte du contenu approuvé. Si la légende,
                l&apos;image, l&apos;heure ou le compte changent, elle ne vaut plus et il faut
                approuver à nouveau.
              </div>
            )}
          </div>
        </div>

        {peutApprouver && modifiable && (
          <Button
            size="sm"
            variant={approuve ? 'outline' : 'default'}
            disabled={enCours}
            onClick={() => surApprobation(l, !approuve)}
          >
            {approuve
              ? (enCours ? 'Retrait…' : 'Retirer l\'approbation')
              : (enCours ? 'Approbation…' : 'Approuver cette publication')}
          </Button>
        )}
      </div>

      {/* 🔴 CE QUE L'APPROBATION VAUT, DIT À CÔTÉ D'ELLE.
          Un voyant vert sans signature serait le quatrième faux témoin de la
          semaine. Tant que la clé n'est pas posée, une approbation déposée dans
          le Drive vaut exactement autant que celle-ci. */}
      {approuve && a.signature === 'absente' && (
        <div className="mt-2 flex items-start gap-1.5 text-xs text-amber-800">
          <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Enregistrée <strong>sans signature</strong> : la clé de signature des approbations
            n&apos;est pas posée sur le serveur. L&apos;empreinte du contenu, elle, est bien
            contrôlée. Ce qui manque, c&apos;est la preuve que l&apos;approbation vient de
            l&apos;application plutôt que d&apos;un fichier déposé dans le Drive.
          </span>
        </div>
      )}
      {approuve && a.signature === 'hmac_sha256' && (
        <div className="mt-2 flex items-start gap-1.5 text-xs text-slate-500">
          <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Approbation signée.</span>
        </div>
      )}
    </div>
  );
}

function Ligne({ l, peutApprouver = false, enCours = false, surApprobation = () => {} }) {
  const etat = ETATS[l.etat] || { label: l.etat, couleur: 'bg-slate-100 text-slate-700' };
  const erreur = l.derniere_erreur;
  const approuve = Boolean(l.approbation?.approuve);

  return (
    <div className="border-b border-slate-100 py-3 last:border-0">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={etat.couleur}>{etat.label}</Badge>
        <span className="font-medium">{l.publication_id}</span>
        <Badge variant="outline">{l.canal}</Badge>
        <Badge variant="outline">{l.surface}</Badge>
        {!approuve && (
          <Badge className="bg-orange-100 text-orange-700">non approuvé</Badge>
        )}
        {/* 🔴 La vérité sur le média, à côté de la ligne qui la porte. Une file
            qui a l'air prête alors qu'aucune image n'est joignable est un faux
            témoin de plus — le troisième de la semaine si on le laissait. */}
        {!l.id_distant && !l.url_media && (
          <Badge className="bg-amber-100 text-amber-800">média non hébergé</Badge>
        )}
      </div>

      <div className="mt-1 flex items-center gap-2 text-sm text-slate-600">
        <CalendarClock className="h-3.5 w-3.5" />
        <span>Créneau : {heureDeMoanda(l.instant_utc)}</span>
        {typeof l.tolerance_minutes === 'number' && (
          <span className="text-slate-400">· tolérance {l.tolerance_minutes} min</span>
        )}
      </div>

      <BlocApprobation
        l={l}
        peutApprouver={peutApprouver}
        enCours={enCours}
        surApprobation={surApprobation}
      />

      {l.id_distant && (
        <div className="mt-1 text-sm text-emerald-700">
          Parti — identifiant Meta <code className="rounded bg-emerald-50 px-1">{l.id_distant}</code>
          {l.resultat?.url_publique && (
            <>
              {' · '}
              <a className="underline" href={l.resultat.url_publique} target="_blank" rel="noreferrer">voir le post</a>
            </>
          )}
        </div>
      )}

      {/* 🔴 La mention qui ne doit pas disparaître tant que le test de
          visibilité n'a pas été fait. Un 200 n'est pas une preuve. */}
      {l.resultat?.visibilite_publique === 'non_verifiee' && (
        <div className="mt-1 flex items-start gap-1.5 text-sm text-amber-700">
          <EyeOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Meta a accepté la publication, mais la visibilité publique n&apos;est pas prouvée :
            l&apos;application Meta n&apos;est pas publiée. À vérifier une fois, depuis un téléphone
            qui n&apos;a aucun rôle sur l&apos;application.
          </span>
        </div>
      )}

      {erreur && (
        <div className="mt-2 rounded border border-red-100 bg-red-50 p-2 text-sm">
          <div className="flex items-start gap-1.5 text-red-800">
            <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="font-mono text-xs">{erreur.message_erreur}</span>
          </div>
          {erreur.piste && (
            <div className="mt-1 pl-5 text-red-700">{erreur.piste}</div>
          )}
          <div className="mt-1 pl-5 text-xs text-red-500">
            Tentative {l.tentatives}/{l.tentatives_max} · {heureDeMoanda(erreur.a_utc)}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── L'ÉCRAN ─── */

export default function Autopost() {
  const { user } = useAuth();
  const [etat, setEtat] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [panne, setPanne] = useState(null);
  const [passageEnCours, setPassageEnCours] = useState(false);
  const [relectureEnCours, setRelectureEnCours] = useState(false);
  const [alimentation, setAlimentation] = useState(null);
  // La clé de la ligne dont l'approbation est en cours d'écriture, ou null.
  const [approbationEnCours, setApprobationEnCours] = useState(null);

  const charger = useCallback(async () => {
    setChargement(true);
    setPanne(null);
    try {
      const res = await apiFetch('/api/autopost-etat');
      if (!res.ok) {
        const corps = await res.json().catch(() => ({}));
        throw new Error(corps.detail || corps.error || `Réponse ${res.status}`);
      }
      setEtat(await res.json());
    } catch (e) {
      // On DIT la panne. Un écran vide ressemblerait à « rien de prévu ».
      setPanne(e?.message || 'lecture impossible');
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => { void charger(); }, [charger]);

  const lancerUnPassage = async () => {
    setPassageEnCours(true);
    try {
      const res = await apiFetch('/api/autopost-tick', { method: 'POST' });
      const corps = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(corps.detail || corps.error || `Réponse ${res.status}`);
      const b = corps.bilan || {};
      toast.success(
        `Passage terminé — ${b.publies || 0} publié(s), ${b.simules || 0} simulé(s), `
        + `${b.echecs || 0} échec(s), ${b.ecartes?.length || 0} écarté(s).`,
      );
      await charger();
    } catch (e) {
      toast.error(e?.message || 'Passage impossible');
    } finally {
      setPassageEnCours(false);
    }
  };

  /**
   * ⛔ LE DERNIER MAILLON, DÉCLENCHÉ À LA MAIN.
   *
   * Le passage horaire alimente déjà la file avant de la regarder. Ce bouton
   * sert au cas qui arrive vraiment : ChatGPT vient de déposer, le gérant ne
   * veut pas attendre l'heure suivante pour voir la publication apparaître.
   *
   * Il ne publie RIEN : il lit le Drive et écrit dans la file. Les deux gestes
   * sont séparés, et celui-ci ne touche à aucun des cinq verrous.
   */
  /**
   * ⛔ APPROUVER, OU RETIRER L'APPROBATION.
   *
   * Le navigateur n'envoie QU'UNE CLÉ. Il n'envoie ni empreinte, ni manifeste,
   * ni « approuvé par » : le serveur relit le `publication.json` qu'il a
   * lui-même rangé dans la ligne, recalcule l'empreinte dessus, et lit le nom
   * de l'approbateur dans le jeton de session signé. Un navigateur ne peut donc
   * pas faire approuver un contenu qu'il aurait composé lui-même, ni signer à
   * la place de quelqu'un d'autre.
   *
   * Et ce bouton NE PUBLIE PAS. Il lève le seul refus que le gérant peut lever ;
   * l'interrupteur général, le mode réel et le jeton Meta restent où ils sont.
   */
  const changerApprobation = async (ligne, approuve) => {
    setApprobationEnCours(ligne.cle_idempotence);
    try {
      const res = await apiFetch('/api/autopost-approuver', {
        method: 'POST',
        body: JSON.stringify({ cle_idempotence: ligne.cle_idempotence, approuve }),
      });
      const corps = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(corps.detail || corps.error || `Réponse ${res.status}`);
      toast.success(approuve
        ? `${ligne.publication_id} approuvée pour ${ligne.canal}.`
          + (corps.signature === 'absente' ? ' Enregistrée sans signature.' : '')
        : `Approbation retirée pour ${ligne.publication_id} (${ligne.canal}).`);
      await charger();
    } catch (e) {
      // On DIT l'échec. Un bouton qui redevient cliquable en silence laisserait
      // croire que l'approbation est passée.
      toast.error(e?.message || 'Approbation impossible');
    } finally {
      setApprobationEnCours(null);
    }
  };

  const relireLeDrive = async () => {
    setRelectureEnCours(true);
    try {
      const res = await apiFetch('/api/autopost-alimenter', { method: 'POST' });
      const corps = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(corps.detail || corps.error || `Réponse ${res.status}`);
      const a = corps.alimentation || {};
      setAlimentation(a);
      toast.success(
        `Drive relu — ${a.creees || 0} créée(s), ${a.mises_a_jour || 0} mise(s) à jour, `
        + `${a.inchangees || 0} inchangée(s), ${a.ecartees?.length || 0} écartée(s).`,
      );
      await charger();
    } catch (e) {
      // On DIT la panne : une alimentation muette serait un faux témoin de plus.
      setAlimentation({ diagnostic: 'panne', message: e?.message || 'relecture impossible', ecartees: [] });
      toast.error(e?.message || 'Relecture du Drive impossible');
    } finally {
      setRelectureEnCours(false);
    }
  };

  if (chargement && !etat) {
    return <div className="p-6 text-slate-500">Lecture de l&apos;état de la chaîne…</div>;
  }

  if (panne) {
    return (
      <div className="space-y-3 p-6">
        <div className="flex items-start gap-2 rounded border border-orange-200 bg-orange-50 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-orange-600" />
          <div>
            <p className="font-medium text-orange-900">
              L&apos;état de la chaîne n&apos;a pas pu être lu.
            </p>
            <p className="mt-1 text-sm text-orange-800">
              Ce n&apos;est pas « rien de prévu » : c&apos;est une lecture qui a échoué.
              Détail : {panne}
            </p>
            <p className="mt-1 text-sm text-orange-800">
              Si les tables n&apos;existent pas encore, la migration
              <code className="mx-1 rounded bg-white px-1">008_autopost_file_publication.sql</code>
              n&apos;a pas été appliquée.
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={() => void charger()}>
          <RefreshCw className="mr-2 h-4 w-4" /> Réessayer
        </Button>
      </div>
    );
  }

  const file = etat?.file || [];
  const prevus = file.filter((l) => ['scheduled', 'draft', 'executing'].includes(l.etat));
  const partis = file.filter((l) => l.etat === 'published');
  const bloques = file.filter((l) => ['failed', 'expired', 'suspended', 'reconciling', 'cancelled'].includes(l.etat));
  const nonApprouves = prevus.filter((l) => !l.approbation?.approuve);
  // 🔴 Le média : la file peut être pleine et rien ne peut partir.
  const sansMedia = prevus.filter((l) => !l.url_media);

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Publications automatiques</h1>
          <p className="text-sm text-slate-500">
            Heures affichées à l&apos;heure de Moanda (UTC+1, sans heure d&apos;été).
            Les passages ont lieu une fois par heure : une publication part dans l&apos;heure
            qui suit son créneau, jamais avant.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void charger()} disabled={chargement}>
            <RefreshCw className={`mr-2 h-4 w-4 ${chargement ? 'animate-spin' : ''}`} /> Actualiser
          </Button>
          {user?.role === 'admin' && (
            <Button variant="outline" onClick={() => void relireLeDrive()} disabled={relectureEnCours}>
              <HardDriveDownload className="mr-2 h-4 w-4" />
              {relectureEnCours ? 'Lecture du Drive…' : 'Relire le Drive'}
            </Button>
          )}
          {user?.role === 'admin' && (
            <Button onClick={() => void lancerUnPassage()} disabled={passageEnCours}>
              {passageEnCours ? 'Passage en cours…' : 'Lancer un passage maintenant'}
            </Button>
          )}
        </div>
      </div>

      <Bandeau etat={etat} />

      {nonApprouves.length > 0 && (
        <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-900">
            <strong>{nonApprouves.length}</strong> publication(s) prévue(s) ne sont pas approuvées.
            Elles ne partiront pas, même une fois l&apos;heure passée.
          </p>
        </div>
      )}

      {sansMedia.length > 0 && (
        <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 p-3">
          <ImageOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-900">
            <strong>{sansMedia.length}</strong> publication(s) prévue(s) n&apos;ont pas de média hébergé.
            Facebook et Instagram ne reçoivent pas de fichier : ils vont <strong>chercher</strong> l&apos;image
            à une adresse publiquement joignable, et un fichier du Drive privé n&apos;en est pas une.
            Ces publications entrent bien dans la file et y sont examinées, mais elles
            <strong> ne partiront pas</strong> tant que le média n&apos;est pas hébergé.
            L&apos;hébergement se fait désormais tout seul à chaque passage. S&apos;il reste des lignes
            ici, la raison exacte est écrite sur chacune : fichier introuvable, format refusé,
            trop lourd, ou simplement reporté au passage suivant.
          </p>
        </div>
      )}

      <PanneauAlimentation alimentation={alimentation} />

      <Card>
        <CardContent className="p-4">
          <h2 className="mb-2 flex items-center gap-2 font-semibold">
            <CalendarClock className="h-4 w-4" /> Prévu ({prevus.length})
          </h2>
          {prevus.length === 0
            ? <p className="text-sm text-slate-500">Rien en attente dans la file.</p>
            : prevus.map((l) => (
              <Ligne
                key={l.cle_idempotence}
                l={l}
                peutApprouver={user?.role === 'admin'}
                enCours={approbationEnCours === l.cle_idempotence}
                surApprobation={(ligne, approuve) => void changerApprobation(ligne, approuve)}
              />
            ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <h2 className="mb-2 flex items-center gap-2 font-semibold">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Parti ({partis.length})
          </h2>
          {partis.length === 0
            ? <p className="text-sm text-slate-500">Aucune publication partie pour l&apos;instant.</p>
            : partis.map((l) => (
              <Ligne
                key={l.cle_idempotence}
                l={l}
                peutApprouver={user?.role === 'admin'}
                enCours={approbationEnCours === l.cle_idempotence}
                surApprobation={(ligne, approuve) => void changerApprobation(ligne, approuve)}
              />
            ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <h2 className="mb-2 flex items-center gap-2 font-semibold">
            <XCircle className="h-4 w-4 text-red-600" /> Échoué ou bloqué ({bloques.length})
          </h2>
          {bloques.length === 0
            ? <p className="text-sm text-slate-500">Aucun blocage.</p>
            : bloques.map((l) => (
              <Ligne
                key={l.cle_idempotence}
                l={l}
                peutApprouver={user?.role === 'admin'}
                enCours={approbationEnCours === l.cle_idempotence}
                surApprobation={(ligne, approuve) => void changerApprobation(ligne, approuve)}
              />
            ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <h2 className="mb-2 flex items-center gap-2 font-semibold">
            <Eye className="h-4 w-4" /> Journal des passages
          </h2>
          {(etat?.journal || []).length === 0
            ? <p className="text-sm text-slate-500">Aucun passage enregistré.</p>
            : (
              <ul className="space-y-1 text-sm">
                {etat.journal.map((e, i) => (
                  <li key={`${e.instant_utc}-${i}`} className="border-b border-slate-50 pb-1">
                    <span className="text-slate-400">{heureDeMoanda(e.instant_utc)}</span>
                    {' · '}
                    <span className="font-medium">{e.evenement}</span>
                    {e.publication_id && <> · {e.publication_id} {e.canal}</>}
                    {e.resume && <> — {e.resume}</>}
                    {e.piste && <div className="pl-2 text-xs text-amber-700">{e.piste}</div>}
                  </li>
                ))}
              </ul>
            )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Exporté pour les tests de rendu et pour réemploi dans un futur écran. */
export { RAISONS, DETAILS_APPROBATION, ETATS, MOTIFS_ALIMENTATION, ETATS_APPROBABLES };
