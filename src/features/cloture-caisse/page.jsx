import { useState, useCallback, useMemo } from 'react';
import { db } from '@/services/db';
import { todayISO } from '@/lib/dates';
import { useAuth } from '@/services/auth';
import { useChargeur, executerAction } from '@/services/chargement';
import { EnChargement, EchecChargement } from '@/features/partages/etat-chargement';
import SelecteurActivite from '@/features/partages/selecteur-activite';
import {
  ACTIVITE_DEFAUT, TOUTES_ACTIVITES, activiteDe, avecActivite,
  filtrerParActivite, libelleActivite,
} from '@/services/activites';
import { logAction } from '@/services/audit';
import { creerVerrouExecution } from '@/services/execution-unique';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Wallet,
  Calculator,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  TrendingDown,
  TrendingUp,
  Plus,
  Eye,
} from 'lucide-react';

function fmt(n) {
  return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0));
}

const STATUT_STYLES = {
  ok: { label: 'OK', icon: CheckCircle2, class: 'bg-emerald-100 text-emerald-700', iconClass: 'text-emerald-500' },
  ecart_mineur: { label: 'Écart mineur', icon: AlertTriangle, class: 'bg-orange-100 text-orange-700', iconClass: 'text-orange-500' },
  ecart_majeur: { label: 'Écart majeur', icon: XCircle, class: 'bg-red-100 text-red-700', iconClass: 'text-red-500' },
};

// Billets et pièces F CFA
const DENOMINATIONS = [
  { label: '10 000 F', value: 10000 },
  { label: '5 000 F', value: 5000 },
  { label: '2 000 F', value: 2000 },
  { label: '1 000 F', value: 1000 },
  { label: '500 F', value: 500 },
  { label: '100 F', value: 100 },
  { label: '50 F', value: 50 },
  { label: '25 F', value: 25 },
  { label: '10 F', value: 10 },
  { label: '5 F', value: 5 },
];

/**
 * Verrou d'execution — une seule cloture a la fois, pour un jour donne.
 *
 * Le `disabled` du bouton protege l'utilisateur ; ce verrou protege la piece
 * comptable. Deux clics creaient DEUX clotures pour le meme jour, avec le meme
 * ecart : l'ecart du soir etait compte deux fois dans les statistiques, et un
 * « ecart majeur » etait notifie deux fois a l'administrateur.
 *
 * Declare hors du composant : un remontage ne le perd pas.
 *
 * ⚠️ Depuis l'ouverture de la PAPETERIE (18/09/2026), la cle du verrou porte
 * l'activite EN PLUS de la date. Sans elle, compter le tiroir de la papeterie
 * pendant que celui de l'imprimerie s'enregistre recevrait la promesse de
 * l'AUTRE cloture : le gerant verrait un succes, et la seconde piece
 * comptable n'aurait jamais ete ecrite.
 */
const verrouCloture = creerVerrouExecution();

export default function ClotureCaisse() {
  const { user, hasPermission, isAdmin } = useAuth();
  const canWrite = hasPermission('statistiques', 'write');
  const [clotures, setClotures] = useState([]);
  const [rapports, setRapports] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [clotureEnCours, setClotureEnCours] = useState(false);
  const [showDetail, setShowDetail] = useState(null);
  const [counts, setCounts] = useState({});
  const [commentaire, setCommentaire] = useState('');

  // ── Quelle caisse ? ──────────────────────────────────────────────────────
  //
  // « La caisse papeterie est separee » (consigne du 18/09/2026). Deux tiroirs
  // physiques distincts, donc deux comptages distincts, donc deux ecarts
  // distincts. Additionner les recettes des deux activites face aux billets
  // d'un seul tiroir afficherait un ecart majeur imaginaire — et ferait
  // chercher un vol qui n'existe pas.
  //
  // L'ecran demarre sur l'imprimerie : c'est la caisse historique, et c'est ce
  // que voyait le gerant avant cette intervention.
  const [activite, setActivite] = useState(ACTIVITE_DEFAUT);
  // `TOUTES_ACTIVITES` est une vue de lecture. On peut consulter le consolide,
  // on ne peut pas compter un tiroir qui n'existe pas.
  const vueConsolidee = activite === TOUTES_ACTIVITES;

  // Date metier LOCALE. `.toISOString().split('T')[0]` renvoyait la veille
  // entre 00 h et 01 h heure de Libreville : le comptage du soir se comparait
  // alors aux recettes du mauvais jour. Regle du projet : src/lib/dates.js.
  const today = todayISO();

  // `listOuLeve()` : sur une coupure, `list()` rendait `[]` et l'ecran
  // affichait « 0 F attendu » — un chiffre FAUX, presente comme une mesure.
  // Un ecart de caisse calcule sur une lecture ratee n'est pas un ecart.
  const load = useCallback(async () => {
    const [cData, rData] = await Promise.all([
      db.clotures_caisse.listOuLeve(),
      db.rapports.listOuLeve(),
    ]);
    setClotures([...cData].sort((a, b) => (b.date || '').localeCompare(a.date || '')));
    setRapports(rData);
  }, []);

  const { enCours: loading, erreur: erreurChargement, recharger } = useChargeur(load);

  // Caisse attendue du jour, POUR LA CAISSE CHOISIE.
  //
  // ⚠️ `Object.values(r.categories)` somme toutes les categories de prestation,
  // dont une s'appelle `imprimerie`. Ce n'est PAS l'activite : un rapport de la
  // papeterie peut contenir une recette dans la categorie `imprimerie` (un
  // client qui achete un cahier et fait trois photocopies). La separation des
  // caisses se fait sur `r.activite`, jamais sur les noms de categories.
  // Voir l'en-tete de src/services/activites.js.
  const todayExpected = useMemo(() => {
    const todayRapports = filtrerParActivite(
      rapports.filter((r) => r.date === today),
      activite,
    );
    const recettes = todayRapports.reduce(
      (s, r) => s + Object.values(r.categories || {}).reduce((a, v) => a + (v || 0), 0), 0
    );
    const depenses = todayRapports.reduce(
      (s, r) => s + (r.depenses || []).reduce((a, d) => a + (d.montant || 0), 0), 0
    );
    return { recettes, depenses, attendu: recettes - depenses, rapportsCount: todayRapports.length };
  }, [rapports, today, activite]);

  // Cloture du jour POUR CETTE CAISSE. La cle est (date, activite) : tant
  // qu'elle etait la seule date, cloturer l'imprimerie faisait passer la
  // papeterie pour deja comptee, et son ecart du soir n'etait jamais mesure.
  const todayCloture = useMemo(
    () => (vueConsolidee
      ? null
      : clotures.find((c) => c.date === today && activiteDe(c) === activite)),
    [clotures, today, activite, vueConsolidee],
  );

  // L'historique affiche ne parle que de la caisse consultee.
  const cloturesAffichees = useMemo(
    () => filtrerParActivite(clotures, activite),
    [clotures, activite],
  );

  // Physical count total
  const totalPhysique = useMemo(() => {
    return DENOMINATIONS.reduce((sum, d) => sum + (parseInt(counts[d.value] || 0) * d.value), 0);
  }, [counts]);

  const ecart = totalPhysique - todayExpected.attendu;
  const ecartPct = todayExpected.attendu > 0 ? (ecart / todayExpected.attendu) * 100 : 0;

  const openForm = () => {
    setCounts({});
    setCommentaire('');
    setShowForm(true);
  };

  const handleSubmit = () => {
    // Garde-fou : un comptage physique se fait dans UN tiroir. La vue
    // consolidee n'a pas de billets a compter.
    if (vueConsolidee) return Promise.resolve();
    return verrouCloture.executerUneSeuleFois(`cloture:${today}:${activite}`, async () => {
      setClotureEnCours(true);
      try {
        await enregistrerCloture();
      } finally {
        setClotureEnCours(false);
      }
    });
  };

  const enregistrerCloture = async () => {
    const statut = Math.abs(ecart) < 1000 ? 'ok' : Math.abs(ecart) < 5000 ? 'ecart_mineur' : 'ecart_majeur';
    // `avecActivite` plutot qu'un champ pose a la main : il NORMALISE, et il
    // refuse d'ecrire la vue consolidee. Une piece comptable sans caisse
    // d'appartenance est exactement ce qu'il faudrait demeler plus tard.
    const data = avecActivite({
      date: today,
      employe_id: user.id,
      employe_nom: `${user.prenom} ${user.nom}`,
      montant_attendu: todayExpected.attendu,
      montant_reel: totalPhysique,
      ecart,
      commentaire,
      statut,
      denominations: counts,
      valide_par: '',
    }, activite);
    // Le comptage physique est une piece comptable : annoncer « enregistree »
    // sans ecriture ferait perdre la trace de l'ecart du jour, et personne ne
    // saurait s'il faut recompter.
    const { ok } = await executerAction(async () => {
      await db.clotures_caisse.create(data);
      await logAction('cloture', 'cloture_caisse', {
        entityLabel: `Clôture ${libelleActivite(activite)} ${new Date(`${today}T00:00:00`).toLocaleDateString('fr-FR')}`,
        details: `Clôture de caisse ${libelleActivite(activite)} — Attendu: ${fmt(todayExpected.attendu)} F, Réel: ${fmt(totalPhysique)} F, Écart: ${fmt(ecart)} F`,
        metadata: { activite, attendu: todayExpected.attendu, reel: totalPhysique, ecart, statut },
      });
    }, { succes: 'Clôture de caisse enregistrée', quoi: 'La clôture de caisse' });
    // Le dialogue reste OUVERT sur un echec : le comptage saisi billet par
    // billet n'est pas perdu, il suffit de reappuyer.
    if (!ok) return;
    setShowForm(false);
    recharger();
  };

  // Stats — de la caisse consultee, pas des deux melangees.
  const stats = useMemo(() => {
    const last7 = cloturesAffichees.filter((c) => {
      const d = new Date(c.date);
      const ago = new Date();
      ago.setDate(ago.getDate() - 7);
      return d >= ago;
    });
    const avgEcart = last7.length > 0
      ? last7.reduce((s, c) => s + (c.ecart || 0), 0) / last7.length
      : 0;
    const majeurs = cloturesAffichees.filter((c) => c.statut === 'ecart_majeur').length;
    return { total: cloturesAffichees.length, avgEcart, majeurs };
  }, [cloturesAffichees]);

  if (loading) return <EnChargement />;

  // Avant tout le reste : sans les rapports du jour, le « montant attendu »
  // vaudrait 0 F et l'ecran presenterait un ecart calcule sur du vide.
  if (erreurChargement) {
    return (
      <EchecChargement
        quoi="la caisse et les rapports du jour"
        onReessayer={recharger}
        enCours={loading}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Clôture de Caisse</h2>
          <p className="text-muted-foreground">
            {vueConsolidee
              ? 'Vue consolidée des deux caisses — le comptage se fait caisse par caisse'
              : `Comptage physique et vérification des écarts — caisse ${libelleActivite(activite)}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Quel tiroir ? La reponse doit se lire sans ouvrir de menu : on
              compte des billets, et se tromper de caisse se paie en ecart. */}
          <SelecteurActivite valeur={activite} onChange={setActivite} avecToutes />
          {canWrite && !vueConsolidee && !todayCloture && (
            <Button className="gap-2" onClick={openForm}>
              <Plus className="h-4 w-4" /> Clôturer aujourd'hui
            </Button>
          )}
        </div>
      </div>

      {/* Today's summary */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
                <TrendingUp className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Recettes du jour</p>
                <p className="text-lg font-bold">{fmt(todayExpected.recettes)} F</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/10">
                <TrendingDown className="h-5 w-5 text-red-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Dépenses du jour</p>
                <p className="text-lg font-bold">{fmt(todayExpected.depenses)} F</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10">
                <Wallet className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Caisse attendue</p>
                <p className="text-lg font-bold">{fmt(todayExpected.attendu)} F</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${todayCloture ? (todayCloture.statut === 'ok' ? 'bg-emerald-500/10' : 'bg-orange-500/10') : 'bg-slate-500/10'}`}>
                {todayCloture ? (
                  todayCloture.statut === 'ok' ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <AlertTriangle className="h-5 w-5 text-orange-500" />
                ) : (
                  <Clock className="h-5 w-5 text-slate-400" />
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Statut</p>
                <p className="text-lg font-bold">
                  {/* En vue consolidee il n'y a pas UN statut : il y a deux
                      tiroirs, comptes ou non. On dit combien, plutot que
                      d'annoncer « En attente » pour une caisse deja close. */}
                  {vueConsolidee
                    ? `${clotures.filter((c) => c.date === today).length}/2 comptées`
                    : todayCloture
                      ? STATUT_STYLES[todayCloture.statut]?.label || 'OK'
                      : 'En attente'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* History table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Historique des clôtures</CardTitle>
        </CardHeader>
        <CardContent>
          {cloturesAffichees.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">Aucune clôture enregistrée</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 pr-4">Date</th>
                    {/* La colonne n'apparait qu'en vue consolidee : dans une
                        caisse donnee, elle repeterait la meme valeur. */}
                    {vueConsolidee && <th className="pb-2 pr-4">Caisse</th>}
                    <th className="pb-2 pr-4">Opérateur</th>
                    <th className="pb-2 pr-4 text-right">Attendu</th>
                    <th className="pb-2 pr-4 text-right">Réel</th>
                    <th className="pb-2 pr-4 text-right">Écart</th>
                    <th className="pb-2 pr-4">Statut</th>
                    <th className="pb-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {cloturesAffichees.slice(0, 20).map((c) => {
                    const st = STATUT_STYLES[c.statut] || STATUT_STYLES.ok;
                    return (
                      <tr key={c.id} className="border-b last:border-0 hover:bg-muted/50">
                        <td className="py-2.5 pr-4 font-medium">
                          {new Date(c.date + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </td>
                        {vueConsolidee && (
                          <td className="py-2.5 pr-4">{libelleActivite(activiteDe(c))}</td>
                        )}
                        <td className="py-2.5 pr-4">{c.employe_nom}</td>
                        <td className="py-2.5 pr-4 text-right">{fmt(c.montant_attendu)} F</td>
                        <td className="py-2.5 pr-4 text-right">{fmt(c.montant_reel)} F</td>
                        <td className={`py-2.5 pr-4 text-right font-semibold ${c.ecart < 0 ? 'text-red-500' : c.ecart > 0 ? 'text-emerald-600' : ''}`}>
                          {c.ecart > 0 ? '+' : ''}{fmt(c.ecart)} F
                        </td>
                        <td className="py-2.5 pr-4">
                          <Badge variant="outline" className={st.class}>{st.label}</Badge>
                        </td>
                        <td className="py-2.5">
                          <button
                            onClick={() => setShowDetail(c)}
                            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Clôture form dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5" />
              Clôture {libelleActivite(activite)} — {new Date().toLocaleDateString('fr-FR')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {/* Expected amount */}
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Montant attendu (système)</p>
              <p className="text-xl font-bold">{fmt(todayExpected.attendu)} F</p>
              <p className="text-xs text-muted-foreground mt-1">
                {todayExpected.rapportsCount} rapport{todayExpected.rapportsCount > 1 ? 's' : ''} — Recettes: {fmt(todayExpected.recettes)} F, Dépenses: {fmt(todayExpected.depenses)} F
              </p>
            </div>

            {/* Denomination counting */}
            <div>
              <p className="mb-2 text-sm font-medium">Comptage physique</p>
              <div className="grid grid-cols-2 gap-2">
                {DENOMINATIONS.map((d) => (
                  <div key={d.value} className="flex items-center gap-2 rounded-lg border p-2">
                    <span className="w-20 text-xs font-medium">{d.label}</span>
                    <span className="text-xs text-muted-foreground">×</span>
                    <Input
                      type="number"
                      min="0"
                      className="h-8 text-center"
                      value={counts[d.value] || ''}
                      onChange={(e) => setCounts({ ...counts, [d.value]: e.target.value })}
                      placeholder="0"
                    />
                    <span className="w-20 text-right text-xs font-semibold">
                      {fmt((parseInt(counts[d.value] || 0)) * d.value)} F
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Total + écart */}
            <div className="rounded-lg border-2 border-dashed p-3 space-y-2">
              <div className="flex justify-between">
                <span className="text-sm font-medium">Total physique</span>
                <span className="text-lg font-bold">{fmt(totalPhysique)} F</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm font-medium">Écart</span>
                <span className={`text-lg font-bold ${ecart < 0 ? 'text-red-500' : ecart > 0 ? 'text-emerald-600' : ''}`}>
                  {ecart > 0 ? '+' : ''}{fmt(ecart)} F
                  {todayExpected.attendu > 0 && (
                    <span className="ml-1 text-xs font-normal">({ecartPct > 0 ? '+' : ''}{ecartPct.toFixed(1)}%)</span>
                  )}
                </span>
              </div>
              {Math.abs(ecart) >= 5000 && (
                <div className="flex items-center gap-2 rounded-md bg-red-50 p-2 text-red-700">
                  <XCircle className="h-4 w-4 shrink-0" />
                  <span className="text-xs font-medium">Écart majeur — L'administrateur sera notifié</span>
                </div>
              )}
              {Math.abs(ecart) >= 1000 && Math.abs(ecart) < 5000 && (
                <div className="flex items-center gap-2 rounded-md bg-orange-50 p-2 text-orange-700">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span className="text-xs font-medium">Écart mineur détecté</span>
                </div>
              )}
            </div>

            {/* Comment */}
            <div>
              <label className="mb-1 block text-sm font-medium">Commentaire</label>
              <Input
                value={commentaire}
                onChange={(e) => setCommentaire(e.target.value)}
                placeholder="Observations éventuelles..."
              />
            </div>

            <Button className="w-full gap-2" disabled={clotureEnCours} onClick={handleSubmit}>
              <CheckCircle2 className="h-4 w-4" />
              Enregistrer la clôture
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
      <Dialog open={!!showDetail} onOpenChange={() => setShowDetail(null)}>
        <DialogContent className="max-w-md">
          {showDetail && (
            <>
              <DialogHeader>
                <DialogTitle>
                  Clôture du {new Date(showDetail.date + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3 pt-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Opérateur</span>
                  <span className="font-medium">{showDetail.employe_nom}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Montant attendu</span>
                  <span className="font-medium">{fmt(showDetail.montant_attendu)} F</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Montant réel</span>
                  <span className="font-medium">{fmt(showDetail.montant_reel)} F</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Écart</span>
                  <span className={`font-bold ${showDetail.ecart < 0 ? 'text-red-500' : showDetail.ecart > 0 ? 'text-emerald-600' : ''}`}>
                    {showDetail.ecart > 0 ? '+' : ''}{fmt(showDetail.ecart)} F
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Statut</span>
                  <Badge variant="outline" className={STATUT_STYLES[showDetail.statut]?.class}>
                    {STATUT_STYLES[showDetail.statut]?.label}
                  </Badge>
                </div>
                {showDetail.commentaire && (
                  <div className="rounded-lg bg-muted/50 p-3">
                    <p className="text-xs text-muted-foreground">Commentaire</p>
                    <p className="text-sm">{showDetail.commentaire}</p>
                  </div>
                )}
                {showDetail.valide_par && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Validé par</span>
                    <span className="font-medium">{showDetail.valide_par}</span>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
