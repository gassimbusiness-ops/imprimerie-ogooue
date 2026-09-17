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
  PauseCircle, PlayCircle, Eye, EyeOff, HardDriveDownload,
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
        <Voyant
          actif={etat?.acces_drive_configure}
          Icone={HardDriveDownload}
          ouiTexte="Accès Drive configuré (compte de service Google)."
          nonTexte="Accès Drive non configuré : les publications doivent être déposées depuis l'application."
        />
      </CardContent>
    </Card>
  );
}

/* ─── UNE LIGNE DE LA FILE ─── */

function Ligne({ l }) {
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
      </div>

      <div className="mt-1 flex items-center gap-2 text-sm text-slate-600">
        <CalendarClock className="h-3.5 w-3.5" />
        <span>Créneau : {heureDeMoanda(l.instant_utc)}</span>
        {typeof l.tolerance_minutes === 'number' && (
          <span className="text-slate-400">· tolérance {l.tolerance_minutes} min</span>
        )}
      </div>

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

      <Card>
        <CardContent className="p-4">
          <h2 className="mb-2 flex items-center gap-2 font-semibold">
            <CalendarClock className="h-4 w-4" /> Prévu ({prevus.length})
          </h2>
          {prevus.length === 0
            ? <p className="text-sm text-slate-500">Rien en attente dans la file.</p>
            : prevus.map((l) => <Ligne key={l.cle_idempotence} l={l} />)}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <h2 className="mb-2 flex items-center gap-2 font-semibold">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Parti ({partis.length})
          </h2>
          {partis.length === 0
            ? <p className="text-sm text-slate-500">Aucune publication partie pour l&apos;instant.</p>
            : partis.map((l) => <Ligne key={l.cle_idempotence} l={l} />)}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <h2 className="mb-2 flex items-center gap-2 font-semibold">
            <XCircle className="h-4 w-4 text-red-600" /> Échoué ou bloqué ({bloques.length})
          </h2>
          {bloques.length === 0
            ? <p className="text-sm text-slate-500">Aucun blocage.</p>
            : bloques.map((l) => <Ligne key={l.cle_idempotence} l={l} />)}
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
export { RAISONS, DETAILS_APPROBATION, ETATS };
