/**
 * LE JOURNAL DU BOT MESSENGER ET INSTAGRAM.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * POURQUOI CE BLOC EXISTE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Le bot répond tout seul, sur la page publique de l'entreprise, à des clients
 * que le gérant ne verra jamais taper. Sans cet écran, personne ne saurait
 * jamais ce qu'il leur a dit — et le jour où une réponse dérange, il n'y aurait
 * rien à relire.
 *
 * Trois questions doivent trouver leur réponse ici, sans appeler personne :
 *
 *   1. le bot est-il EN MARCHE ? ⛔ « à l'arrêt » et « en panne » sont deux
 *      phrases différentes, et cet écran ne doit jamais les confondre ;
 *   2. qu'a-t-il RÉELLEMENT envoyé, et sur quel canal ?
 *   3. quels messages sont restés SANS réponse, et pourquoi ?
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LE BOUTON « COUPER » NE VA QUE DANS UN SENS
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Couper doit prendre dix secondes, depuis le téléphone du gérant, sans
 * console Supabase et sans redéploiement : c'est la définition d'un arrêt
 * d'urgence.
 *
 * RALLUMER, non. Le bouton n'existe pas dans l'autre sens — et même s'il
 * existait il ne suffirait pas : `BOT_META_MODE=live` doit aussi être posée
 * dans Vercel, ce qu'aucun écran ne peut faire. Remettre en marche est un
 * geste de déploiement, pas un clic.
 */
import { useState, useEffect, useCallback } from 'react';
import { db } from '@/services/db';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Bot, PauseCircle, PlayCircle, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';

/** Les canaux, tels que le webhook les nomme. */
const CANAUX = {
  messenger: { label: 'Messenger', couleur: 'bg-blue-100 text-blue-700' },
  instagram: { label: 'Instagram', couleur: 'bg-pink-100 text-pink-700' },
  inconnu: { label: 'Canal inconnu', couleur: 'bg-slate-100 text-slate-700' },
};

/** Ce que le bot a fait, en français de comptoir. */
const ACTIONS = {
  repondu: { label: 'Répondu', couleur: 'bg-emerald-100 text-emerald-700' },
  passer_la_main: { label: 'Passé au gérant', couleur: 'bg-amber-100 text-amber-700' },
  en_cours: { label: 'Envoi commencé', couleur: 'bg-violet-100 text-violet-700' },
  simule: { label: 'Simulation', couleur: 'bg-slate-100 text-slate-700' },
  ignore: { label: 'Sans réponse', couleur: 'bg-slate-100 text-slate-600' },
  refuse: { label: 'Refusé', couleur: 'bg-red-100 text-red-700' },
  echec: { label: 'Échec', couleur: 'bg-red-100 text-red-700' },
};

/**
 * Pourquoi rien n'est parti. Une phrase par GESTE, jamais un code.
 * C'est la leçon du voyant Drive : un message unique pour cinq causes fait
 * revérifier ce qui marche déjà.
 */
const MOTIFS = {
  bot_eteint: 'Le bot était à l\'arrêt : aucune réponse automatique n\'est partie.',
  compte_non_reconnu: 'Message reçu sur un compte qui n\'est pas celui de l\'imprimerie.',
  deja_repondu: 'Message déjà traité : Meta l\'a livré une seconde fois.',
  doublon_dans_le_lot: 'Le même message figurait deux fois dans la même livraison.',
  humain_en_charge: 'Le gérant avait repris la conversation : le bot s\'est tu.',
  temoin_illisible: 'Impossible de vérifier si une réponse était déjà partie — rien n\'a été envoyé.',
  pris_par_une_autre_execution: 'Une autre exécution s\'en occupait déjà.',
  texte_hors_catalogue: 'Texte refusé par le verrou : seules les réponses validées peuvent partir.',
  mode_simulation: 'Mode simulation : la réponse a été préparée, pas envoyée.',
  jeton_meta_absent: 'Aucun jeton Meta : la réponse a été préparée, pas envoyée.',
  envoi_refuse: 'Meta a refusé l\'envoi.',
  resultat_incertain: 'Envoi interrompu : on ne sait pas si le client a reçu la réponse.',
};

function heureCourte(iso) {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  return new Date(t).toLocaleString('fr-FR', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export default function JournalBot() {
  const [lignes, setLignes] = useState([]);
  const [controle, setControle] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [deplie, setDeplie] = useState(true);
  const [coupureEnCours, setCoupureEnCours] = useState(false);

  const charger = useCallback(async () => {
    try {
      setErreur(null);
      // ⛔ `listOuLeve()` et pas `list()` : une liste vide après une lecture
      //    ratée dirait « le bot n'a rien fait », et c'est faux.
      const [journal, interrupteurs] = await Promise.all([
        db.bot_journal.listOuLeve(),
        db.bot_controle.listOuLeve(),
      ]);
      setLignes(journal);
      setControle(interrupteurs.find((l) => l.cle === 'global') || interrupteurs[0] || null);
    } catch (e) {
      setErreur(e?.message || 'Lecture impossible.');
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => { charger(); }, [charger]);

  const couper = async () => {
    if (!controle?.id) return;
    setCoupureEnCours(true);
    try {
      await db.bot_controle.update(controle.id, { actif: false });
      toast.success('Bot coupé. Plus aucune réponse automatique ne part.');
      await charger();
    } catch (e) {
      toast.error(e?.message || 'La coupure n\'a PAS été enregistrée. Réessayez.');
    } finally {
      setCoupureEnCours(false);
    }
  };

  const actif = controle?.actif === true;
  const recentes = [...lignes]
    .sort((a, b) => String(b.recu_le || '').localeCompare(String(a.recu_le || '')))
    .slice(0, 25);
  const envoyees = lignes.filter((l) => l.id_message_sortant).length;
  const sansReponse = lignes.length - envoyees;

  return (
    <Card className="border-l-4 border-l-primary/50">
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Bot className="h-5 w-5 text-primary shrink-0" />
          <p className="font-semibold text-sm">Bot Messenger et Instagram</p>

          {chargement ? (
            <Badge className="bg-slate-100 text-slate-600 text-[10px]">Lecture…</Badge>
          ) : actif ? (
            <Badge className="bg-emerald-100 text-emerald-700 text-[10px] gap-1">
              <PlayCircle className="h-3 w-3" /> En marche
            </Badge>
          ) : (
            <Badge className="bg-orange-100 text-orange-700 text-[10px] gap-1">
              <PauseCircle className="h-3 w-3" /> Bot à l&apos;arrêt
            </Badge>
          )}

          <div className="ml-auto flex items-center gap-2">
            {actif && (
              <Button
                size="sm"
                variant="destructive"
                className="h-7 text-[11px]"
                disabled={coupureEnCours}
                onClick={couper}
              >
                Couper le bot
              </Button>
            )}
            <button
              type="button"
              onClick={() => setDeplie((v) => !v)}
              className="rounded p-1 hover:bg-muted"
              aria-label={deplie ? 'Replier le journal' : 'Déplier le journal'}
            >
              {deplie ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* ⛔ « à l'arrêt » n'est PAS « en panne ». On dit laquelle des deux. */}
        {!chargement && !actif && !erreur && (
          <p className="text-xs text-muted-foreground">
            Le bot est à l&apos;arrêt : les clients qui écrivent sur Messenger ou Instagram
            n&apos;obtiennent aucune réponse automatique. Ce n&apos;est pas une panne —
            c&apos;est l&apos;interrupteur. Le remettre en marche demande aussi la variable
            BOT_META_MODE dans Vercel.
          </p>
        )}

        {erreur && (
          <div className="flex items-start gap-2 rounded-md bg-red-50 p-2 text-xs text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Le journal du bot n&apos;a pas pu être lu ({erreur}). Ce n&apos;est pas
              « le bot n&apos;a rien fait » : c&apos;est « je ne sais pas ce qu&apos;il a fait ».
            </span>
          </div>
        )}

        {!erreur && !chargement && (
          <p className="text-[11px] text-muted-foreground">
            {lignes.length === 0
              ? 'Aucun message reçu par le bot pour l\'instant.'
              : `${envoyees} réponse(s) envoyée(s) · ${sansReponse} message(s) sans réponse.`}
          </p>
        )}

        {deplie && !erreur && recentes.length > 0 && (
          <div className="space-y-2">
            {recentes.map((l) => {
              const canal = CANAUX[l.canal] || CANAUX.inconnu;
              const action = ACTIONS[l.action] || { label: l.action || '—', couleur: 'bg-slate-100 text-slate-700' };
              return (
                <div key={l.id || l.message_id_entrant} className="rounded-md border p-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className={`text-[10px] ${canal.couleur}`}>
                      {canal.label}
                    </Badge>
                    <Badge className={`text-[10px] ${action.couleur}`}>{action.label}</Badge>
                    {l.fiche_id && (
                      <Badge variant="outline" className="text-[10px]">{l.fiche_id}</Badge>
                    )}
                    {l.intention && (
                      <span className="text-[10px] text-muted-foreground">{l.intention}</span>
                    )}
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {heureCourte(l.recu_le)}
                    </span>
                  </div>

                  {l.texte && (
                    <p className="mt-1.5 whitespace-pre-line text-xs text-foreground">{l.texte}</p>
                  )}

                  {l.motif && (
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      {MOTIFS[l.motif] || l.motif}
                    </p>
                  )}

                  {l.erreur && (
                    <p className="mt-1 text-[11px] text-red-600">{l.erreur}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
