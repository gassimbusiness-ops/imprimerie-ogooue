/**
 * « CE QUE CHATGPT A ÉCRIT » — l'écran qui rend tenable une écriture sans
 * confirmation.
 *
 * ── Ce que le dirigeant a demandé ─────────────────────────────────────────
 *
 * « Sans confirmation, il écrit direct — mais qu'on puisse quand même modifier
 * si c'est mal fait. »
 *
 * La première moitié de sa phrase vit dans `api/_lib/chatgpt-ecriture.js` :
 * aucune étape de confirmation, l'écriture part. La seconde moitié, c'est CET
 * ÉCRAN : tout ce que ChatGPT a écrit, dans l'ordre, avec la phrase qui l'a
 * produit, l'heure de Moanda, et un bouton pour défaire.
 *
 * ── Pourquoi l'annulation est calculée AILLEURS ───────────────────────────
 *
 * Le plan d'annulation vient de `src/services/chatgpt-gestes.js`, le MÊME
 * module pur que le serveur utilise quand ChatGPT dit « annule ça ». Deux
 * copies de cette règle, ce serait un bouton qui rembourse autrement qu'une
 * phrase — et un solde que plus personne ne sait expliquer. Ici on ne fait
 * qu'appliquer : créer, modifier, ajuster un solde.
 *
 * ── Annuler COMPENSE, n'efface pas ────────────────────────────────────────
 *
 * Aucune ligne ne disparaît. Un mouvement inverse s'ajoute, la ligne d'origine
 * reçoit la date de son annulation, et son libellé le dit à l'écran d'origine
 * (« [ANNULÉ] … »). C'est la règle comptable du dépôt, celle de
 * `src/services/contre-passation-commande.js` — et c'est aussi ce qui permet de
 * montrer, des semaines plus tard, ce qui avait été écrit par erreur.
 *
 * ⚠️ ÉCRAN D'ARGENT. Le bouton « Confirmer » contre-passe de vrais mouvements
 * et bouge de vrais soldes : il est sous verrou d'exécution unique, comme les
 * huit autres boutons d'argent du dépôt (voir `tests/verrous-argent.test.mjs`).
 *
 * Monté pour de vrai par `tests/rendu-ecran-chatgpt-ecritures.test.mjs`.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { db, lireLignesMarquees } from '@/services/db';
import { logAction } from '@/services/audit';
import { useAuth } from '@/services/auth';
import { creerVerrouExecution } from '@/services/execution-unique';
import { contexteMoanda } from '@/lib/dates';
import {
  COLLECTIONS_ECRITURES,
  CHAMP_MARQUEUR,
  CHAMP_CLE,
  CHAMPS_RESUME,
  planAnnulation,
  resumerEcriture,
  parPlusRecent,
  identifiantDe,
} from '@/services/chatgpt-gestes';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Bot, Undo2, ShieldCheck, AlertTriangle, Clock, Quote, CheckCircle2, X,
} from 'lucide-react';
import { toast } from 'sonner';

/**
 * Le verrou vit HORS du composant : un remontage ne doit pas le réinitialiser,
 * sinon il ne protège plus rien. Même règle que les autres écrans d'argent.
 */
const verrouAnnulation = creerVerrouExecution();

/** Sépare les milliers sans `Intl`, dont l'espace change selon la version d'ICU. */
function fmt(n) {
  return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Couleur du badge par geste. Un mouvement d'argent se voit du premier coup d'œil. */
const TEINTE = {
  // Rouge / vert : de l'argent a bougé pour de vrai.
  depense: 'bg-red-100 text-red-700',
  recette: 'bg-emerald-100 text-emerald-700',
  travaux: 'bg-red-100 text-red-700',
  depot_banque: 'bg-blue-100 text-blue-700',
  'cloture-caisse': 'bg-violet-100 text-violet-700',
  // Ambre : un constat, aucun franc déplacé.
  garde_en_cash: 'bg-amber-100 text-amber-700',
  // Le reste : des écritures de gestion, sans effet sur les comptes.
  tache: 'bg-slate-100 text-slate-700',
  'projet-travaux': 'bg-orange-100 text-orange-700',
  catalogue: 'bg-sky-100 text-sky-700',
  'stock-mouvement': 'bg-teal-100 text-teal-700',
  rapport: 'bg-indigo-100 text-indigo-700',
  commande: 'bg-blue-100 text-blue-700',
  client: 'bg-pink-100 text-pink-700',
  evenement: 'bg-fuchsia-100 text-fuchsia-700',
  prospect: 'bg-cyan-100 text-cyan-700',
  objectif: 'bg-lime-100 text-lime-700',
  devis: 'bg-amber-100 text-amber-700',
  facture: 'bg-emerald-100 text-emerald-700',
};

export default function ChatGPTEcritures() {
  const { user } = useAuth();
  const [lignes, setLignes] = useState([]);
  const [comptes, setComptes] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [echecLecture, setEchecLecture] = useState('');
  const [aConfirmer, setAConfirmer] = useState(null);
  const [annulationEnCours, setAnnulationEnCours] = useState(null);

  /**
   * ⚠️ LECTURE PROJETÉE, jamais `list()`.
   *
   * Les écritures du pont vivent dans dix-sept collections, dont
   * `produits_catalogue` : 20 Mo pour 195 lignes, une seule en portant 3,2 Mo
   * d'images en base64. Depuis que le pont sait corriger un prix, une de ces
   * lignes peut porter le marqueur — et ouvrir cet écran téléchargerait ces
   * mégaoctets sur la connexion de Moanda pour afficher un libellé.
   *
   * On ne demande donc que les champs du résumé. La ligne ENTIÈRE n'est relue
   * qu'au moment d'annuler, une seule, par son identifiant.
   */
  const charger = useCallback(async () => {
    try {
      const [marquees, tousComptes] = await Promise.all([
        lireLignesMarquees({
          collections: COLLECTIONS_ECRITURES,
          marqueur: CHAMP_MARQUEUR,
          champs: CHAMPS_RESUME,
        }),
        db.comptes_bancaires.listOuLeve(),
      ]);
      setLignes(marquees);
      setComptes(tousComptes || []);
      setEchecLecture('');
    } catch (e) {
      // ⚠️ Une liste vide après une lecture ratée dirait « ChatGPT n'a rien
      // écrit », et le gérant conclurait qu'il n'y a rien à vérifier. On
      // distingue donc « rien » de « on ne sait pas ».
      setEchecLecture(e?.message || 'La lecture a échoué.');
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => { charger(); }, [charger]);

  const vues = useMemo(
    () => lignes.map(resumerEcriture).sort(parPlusRecent),
    [lignes],
  );

  /**
   * ⚠️ « Argent sorti » se compte sur les MOUVEMENTS, jamais sur les gestes.
   *
   * Une étape de travaux non payée porte bien un coût, et pas un franc n'a
   * quitté la caisse : la compter ici gonflerait le chiffre, et un chiffre faux
   * ne plante pas — il s'affiche. Seule une ligne `mouvements_financiers` de
   * type `sortie`, non annulée, correspond à de l'argent réellement parti.
   */
  const stats = useMemo(() => {
    const annulees = lignes.filter((l) => l.data?.annule_le).length;
    const argent = lignes
      .filter((l) => l.collection === 'mouvements_financiers'
        && l.data?.type === 'sortie'
        && !l.data?.annule_le)
      .reduce((s, l) => s + (Number(l.data?.montant) || 0), 0);
    return { total: lignes.length, annulees, argent };
  }, [lignes]);

  /**
   * Applique le plan d'annulation.
   *
   * ⚠️ L'ORDRE compte : la ligne d'argent part D'ABORD, et le solde ne bouge
   * QUE si elle a réellement été créée. Un doublon rejeté par l'index unique
   * de `mouvements_financiers.reference` (migration 005) ne doit surtout pas
   * créditer le compte une seconde fois.
   */
  const appliquer = async (operations, refsConnues) => {
    const inserees = new Map();
    for (const op of operations) {
      if (op.op === 'creer') {
        if (op.collection === 'mouvements_financiers' && refsConnues.has(op.data.reference)) {
          if (op.id_op) inserees.set(op.id_op, false);
          continue;
        }
        await db[op.collection].create(op.data);
        if (op.data.reference) refsConnues.add(op.data.reference);
        if (op.id_op) inserees.set(op.id_op, true);
      } else if (op.op === 'modifier') {
        // Même garde que pour les soldes : une modification qui dépend d'une
        // création rejetée en doublon ne doit pas avoir lieu.
        if (op.conditionne_par && inserees.get(op.conditionne_par) !== true) continue;
        await db[op.collection].update(op.id, op.champs);
      } else if (op.op === 'solde') {
        if (op.conditionne_par && inserees.get(op.conditionne_par) !== true) continue;
        const compte = comptes.find((c) => c.id === op.compte_id);
        if (compte) {
          await db.comptes_bancaires.update(compte.id, {
            solde: (Number(compte.solde) || 0) + op.delta,
          });
        }
      }
    }
  };

  const annuler = async (vue) => {
    const resume = lignes.find((l) => l.data?.[CHAMP_CLE] === vue.cle);
    if (!resume) { toast.error('Écriture introuvable — rechargez la page.'); return; }
    if (resume.data.annule_le) { toast.message('Déjà annulée.'); return; }

    // Ici seulement on relit la ligne ENTIÈRE : le plan d'annulation a besoin
    // du type, du montant, du compte et de la référence, qui ne sont pas dans
    // le résumé. Une ligne, pas dix-sept collections.
    const complete = await db[resume.collection].getById(resume.data.id);
    if (!complete) { toast.error('Écriture introuvable en base — rechargez la page.'); return; }
    const ligne = { collection: resume.collection, data: { ...complete, id: resume.data.id } };

    // Une étape de travaux payée a produit DEUX lignes : l'étape et le
    // mouvement. Les deux doivent être traitées ensemble, sinon l'étape
    // resterait « payée » à l'écran Travaux et la modifier y déclencherait une
    // SECONDE contre-passation.
    const reference = identifiantDe(vue.cle);
    const tousMouvements = ligne.collection === 'mouvements_financiers'
      ? []
      : await db.mouvements_financiers.listOuLeve();
    const lies = tousMouvements.filter((m) => m?.reference === reference);

    const phrase = `Annulé depuis l'écran « Ce que ChatGPT a écrit » par `
      + `${[user?.prenom, user?.nom].filter(Boolean).join(' ') || 'un utilisateur'}`;

    const plan = planAnnulation(
      { collection: ligne.collection, data: ligne.data, lies },
      { ctx: contexteMoanda(), phrase },
    );
    if (!plan.ok) { toast.error(`${plan.erreur} — ${plan.detail}`); return; }

    // Les références déjà en base : elles disent si la contre-passation a déjà
    // eu lieu. L'index unique de la migration 005 la refuserait de toute façon,
    // mais un refus de la base remonterait ici en erreur brute.
    const refsConnues = new Set(
      (ligne.collection === 'mouvements_financiers'
        ? await db.mouvements_financiers.listOuLeve()
        : tousMouvements)
        .map((m) => m?.reference)
        .filter(Boolean),
    );

    // La trace AVANT l'effet, comme l'import administrateur : si l'application
    // de ce plan casse au milieu, on saura ce qui a été tenté.
    await logAction('chatgpt_annulation', plan.journal.module, {
      entityId: vue.identifiant,
      entityLabel: plan.journal.entity_label,
      details: plan.journal.details,
      metadata: plan.journal.metadata,
    });

    await appliquer(plan.operations, refsConnues);
    toast.success(plan.resume);
    setAConfirmer(null);
    await charger();
  };

  const handleAnnuler = (vue) => verrouAnnulation.executerUneSeuleFois(
    `chatgpt-annuler:${vue.identifiant}`,
    async () => {
      setAnnulationEnCours(vue.identifiant);
      try {
        await annuler(vue);
      } catch (e) {
        toast.error(
          e?.message
          || "L'annulation n'a PAS abouti. Vérifiez la trésorerie avant de réessayer.",
        );
      } finally {
        setAnnulationEnCours(null);
      }
    },
  );

  if (chargement) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <Bot className="h-7 w-7 text-primary shrink-0 mt-0.5" />
        <div>
          <h1 className="text-2xl font-bold">Ce que ChatGPT a écrit</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            ChatGPT enregistre <strong>sans demander confirmation</strong>, comme demandé.
            Tout ce qu&apos;il écrit apparaît ici, avec la phrase qui l&apos;a produit et l&apos;heure de
            Moanda. Annuler ne supprime rien : l&apos;écriture est <strong>contre-passée</strong>, les
            soldes reviennent, et la trace reste.
          </p>
        </div>
      </div>

      {echecLecture && (
        <Card className="border-red-300">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-red-700">La liste n&apos;a PAS pu être lue.</p>
              <p className="text-muted-foreground">
                Ce n&apos;est pas « ChatGPT n&apos;a rien écrit » : c&apos;est « on ne sait pas ».
                Vérifiez la connexion, puis rechargez. ({echecLecture})
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Écritures</p>
          <p className="text-2xl font-bold">{stats.total}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Annulées</p>
          <p className="text-2xl font-bold">{stats.annulees}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Argent sorti (hors annulées)</p>
          <p className="text-2xl font-bold">{fmt(stats.argent)} F</p>
        </CardContent></Card>
      </div>

      {!echecLecture && vues.length === 0 && (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
          <ShieldCheck className="h-8 w-8 mx-auto mb-3 text-emerald-600" />
          ChatGPT n&apos;a encore rien écrit dans l&apos;application.
        </CardContent></Card>
      )}

      <div className="space-y-3">
        {vues.map((v) => (
          <Card key={v.identifiant || v.ligne_id} className={v.annule ? 'opacity-60' : ''}>
            <CardContent className="p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={TEINTE[v.geste] || 'bg-slate-100 text-slate-700'}>
                  {v.libelle_geste || v.geste}
                </Badge>
                {v.annule && (
                  <Badge className="bg-slate-200 text-slate-700">Annulée</Badge>
                )}
                <span className="font-semibold">{v.intitule || '(sans libellé)'}</span>
                {v.montant > 0 && (
                  <span className="font-mono font-semibold">{fmt(v.montant)} F</span>
                )}
                {v.date && <span className="text-xs text-muted-foreground">le {v.date}</span>}
              </div>

              <p className="text-sm text-muted-foreground flex items-start gap-2">
                <Quote className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>{v.phrase || '(phrase non enregistrée)'}</span>
              </p>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  {v.ecrit_le?.lisible || '(heure inconnue)'}
                  <span className="font-mono ml-2">{v.identifiant}</span>
                </p>

                {v.annule ? (
                  <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Contre-passée — la trace reste
                  </span>
                ) : aConfirmer === v.identifiant ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      Contre-passer cette écriture ?
                    </span>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={annulationEnCours === v.identifiant}
                      onClick={() => handleAnnuler(v)}
                    >
                      {annulationEnCours === v.identifiant ? 'Annulation…' : 'Confirmer'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setAConfirmer(null)}>
                      <X className="h-3.5 w-3.5 mr-1" /> Non
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setAConfirmer(v.identifiant)}
                  >
                    <Undo2 className="h-3.5 w-3.5 mr-1.5" /> Annuler
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Couper l&apos;accès de ChatGPT en dix secondes : Vercel → Settings → Environment
        Variables → <code>CHATGPT_BRIDGE_TOKEN</code> → changer la valeur → Redeploy.
      </p>
    </div>
  );
}
