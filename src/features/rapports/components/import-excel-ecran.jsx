/**
 * Ecran d'import Excel des rapports journaliers.
 *
 * ── LE BESOIN, TEL QU'IL A ETE FORMULE ───────────────────────────────────────
 * « Les jours ou il y a des coupures de courant dans la ville, ils ne vont pas
 *   pouvoir les rentrer en direct. Ils le font sur Excel. S'ils importent le
 *   fichier, ca va bien mettre dans le rapport de l'application, avec
 *   possibilite de modifier ? »
 *
 * Oui. Cet ecran fait exactement cela, et rien de plus.
 *
 * ── CE QU'IL GARANTIT ────────────────────────────────────────────────────────
 * 1. Rien n'est ecrit tant que le gerant n'a pas confirme. L'apercu montre, date
 *    par date et montant par montant, ce qui sera cree et ce qui sera modifie.
 * 2. Une journee deja presente en base n'est JAMAIS ecrasee d'office : elle est
 *    presentee comme un conflit, avec les deux chiffres cote a cote, et trois
 *    boutons. Le bouton « Enregistrer » reste eteint tant qu'un conflit n'est
 *    pas tranche — et il dit pourquoi, a cote.
 * 3. Le double-clic est bloque par un verrou SYNCHRONE (`verrouRef`), pose avant
 *    le premier `await`. Un booleen d'etat React ne suffirait pas : `setState`
 *    est asynchrone, deux clics rapides liraient tous deux `false`.
 * 4. Toute la decision vient de `../import-excel.js`, module pur teste par
 *    `tests/import-excel.test.mjs`. Cet ecran ne calcule aucun montant.
 * 5. Aucune exception ne peut blanchir l'ecran : la lecture du fichier, le
 *    chargement de la base et chaque ecriture sont isolees (lecon du 14/09/2026).
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { db } from '@/services/db';
import { useAuth } from '@/services/auth';
import { logAction } from '@/services/audit';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  FileUp, Download, AlertTriangle, CheckCircle2, Loader2, X,
  FilePlus2, Replace, Merge, Ban, Info, ShieldAlert,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  COLONNES_MODELE, FEUILLE_DONNEES, FEUILLE_CONSIGNES, CONSIGNES_MODELE,
  matriceModele, analyserFeuille, preparerPlan, ecrituresDuPlan,
  etatConfirmation, resumePlan, detailsHistorique,
  payloadSansTotauxFiges, MOTIF_HORS_LIGNE,
} from '../import-excel.js';

function fmt(n) {
  return new Intl.NumberFormat('fr-FR').format(Math.round(Number(n) || 0));
}

/** Date metier `YYYY-MM-DD` affichee en clair, SANS passer par UTC. */
function dateEnClair(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return String(iso || '');
  const [a, m, j] = iso.split('-').map(Number);
  // `new Date(a, m-1, j)` construit un midi local : aucun basculement de jour,
  // et rien de cette date ne repart vers la base. Cf. src/lib/dates.js.
  return new Date(a, m - 1, j).toLocaleDateString('fr-FR', {
    weekday: 'short', day: '2-digit', month: 'long', year: 'numeric',
  });
}

const NOM_MODELE = 'modele-rapport-journalier.xlsx';

/**
 * Fabrique et telecharge le modele Excel.
 * Isole dans son propre try/catch : un echec de telechargement ne doit pas
 * empecher l'import, qui est la vraie fonction de l'ecran.
 */
function telechargerModele() {
  const wb = XLSX.utils.book_new();

  const wsDonnees = XLSX.utils.aoa_to_sheet(matriceModele());
  // Des colonnes assez larges pour lire les titres sans les elargir a la main.
  wsDonnees['!cols'] = COLONNES_MODELE.map((c) => ({
    wch: Math.max(12, Math.min(26, c.libelle.length + 4)),
  }));
  // L'en-tete reste visible quand on descend dans les lignes.
  wsDonnees['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, wsDonnees, FEUILLE_DONNEES);

  const wsConsignes = XLSX.utils.aoa_to_sheet(CONSIGNES_MODELE);
  wsConsignes['!cols'] = [{ wch: 80 }];
  XLSX.utils.book_append_sheet(wb, wsConsignes, FEUILLE_CONSIGNES);

  XLSX.writeFile(wb, NOM_MODELE);
}

/** Bouton de telechargement, reutilise dans l'ecran Rapports. */
export function BoutonModeleExcel({ className = '', size = 'sm', variant = 'outline' }) {
  const cliquer = () => {
    try {
      telechargerModele();
      toast.success(`Modele telecharge : ${NOM_MODELE}`);
    } catch (e) {
      console.error('[import-excel] modele :', e);
      toast.error('Le modele n\'a pas pu etre genere sur cet appareil.');
    }
  };
  return (
    <Button variant={variant} size={size} className={`gap-2 ${className}`} onClick={cliquer}>
      <Download className="h-4 w-4" /> Modele Excel
    </Button>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   L'ECRAN
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @param {object} p
 * @param {() => void} [p.onTermine] appele apres un import applique (recharge la liste)
 * @param {() => void} [p.onFermer]
 */
export default function ImportExcelEcran({ onTermine = () => {}, onFermer = null }) {
  const { user } = useAuth();

  const [rapports, setRapports] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreurChargement, setErreurChargement] = useState('');

  const [fichier, setFichier] = useState(null);
  const [analyse, setAnalyse] = useState(null);
  const [decisions, setDecisions] = useState({});
  const [enCours, setEnCours] = useState(false);
  const [bilan, setBilan] = useState(null);
  // `navigator.onLine` ment parfois (il dit « en ligne » derriere un portail
  // captif) mais il ne ment jamais dans l'autre sens : quand il dit « hors
  // ligne », il n'y a effectivement pas de reseau. C'est le seul cas ou on
  // s'en sert — pour refuser un apercu qui serait faux.
  const [horsLigne, setHorsLigne] = useState(
    typeof navigator !== 'undefined' && navigator.onLine === false,
  );

  const inputRef = useRef(null);
  // ⚠️ VERROU SYNCHRONE — pose AVANT le premier `await`.
  // `enCours` (etat React) est mis a jour de facon asynchrone : deux clics
  // rapproches le liraient tous deux a `false` et lanceraient deux imports.
  const verrouRef = useRef(false);

  /* ── Etat du reseau ── */
  useEffect(() => {
    const majEnLigne = () => setHorsLigne(false);
    const majHorsLigne = () => setHorsLigne(true);
    try {
      window.addEventListener('online', majEnLigne);
      window.addEventListener('offline', majHorsLigne);
    } catch { /* environnement sans window */ }
    return () => {
      try {
        window.removeEventListener('online', majEnLigne);
        window.removeEventListener('offline', majHorsLigne);
      } catch { /* rien a retirer */ }
    };
  }, []);

  /* ── Lecture de la base : lecture SEULE, isolee ── */
  useEffect(() => {
    let vivant = true;
    (async () => {
      try {
        const data = await db.rapports.list();
        if (vivant) setRapports(Array.isArray(data) ? data : []);
      } catch (e) {
        console.error('[import-excel] lecture rapports :', e);
        if (vivant) {
          setErreurChargement(
            'Les rapports deja enregistres n\'ont pas pu etre lus. '
            + 'L\'import est suspendu : sans cette liste, impossible de savoir '
            + 'quelles journees existent deja.',
          );
        }
      } finally {
        if (vivant) setChargement(false);
      }
    })();
    return () => { vivant = false; };
  }, []);

  /* ── Le plan : recalcule des que le fichier ou la base changent ── */
  const plan = useMemo(() => {
    if (!analyse) return null;
    try {
      return preparerPlan({
        analyse,
        rapportsExistants: rapports,
        fichier: fichier?.name || '',
        utilisateur: user ? { id: user.id, nom: `${user.prenom || ''} ${user.nom || ''}`.trim() } : null,
        importeLe: new Date().toISOString(),
      });
    } catch (e) {
      console.error('[import-excel] plan :', e);
      return { fatal: 'Le fichier n\'a pas pu etre analyse.', creations: [], conflits: [], rejets: [], avertissements: [] };
    }
  }, [analyse, rapports, fichier, user]);

  const resume = useMemo(() => resumePlan(plan), [plan]);
  const etat = useMemo(
    () => etatConfirmation(plan, decisions, enCours, horsLigne),
    [plan, decisions, enCours, horsLigne],
  );

  /* ── Choix du fichier ── */
  const choisirFichier = useCallback((evt) => {
    const f = evt?.target?.files?.[0];
    // L'input est vide tout de suite : rechoisir LE MEME fichier doit relancer
    // la lecture (sinon `change` ne se declenche pas une seconde fois).
    if (evt?.target) evt.target.value = '';
    if (!f) return;

    setBilan(null);
    setDecisions({});
    setFichier(f);
    setAnalyse(null);

    const lecteur = new FileReader();
    lecteur.onerror = () => {
      setAnalyse({ fatal: 'Le fichier n\'a pas pu etre lu sur cet appareil.', creations: [], conflits: [], rejets: [], avertissements: [] });
      toast.error('Fichier illisible');
    };
    lecteur.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        // La feuille « Rapports » du modele si elle existe, sinon la premiere.
        const nom = wb.SheetNames.includes(FEUILLE_DONNEES) ? FEUILLE_DONNEES : wb.SheetNames[0];
        const ws = nom ? wb.Sheets[nom] : null;
        if (!ws) {
          setAnalyse({ fatal: 'Ce fichier ne contient aucune feuille de calcul.', creations: [], conflits: [], rejets: [], avertissements: [] });
          return;
        }
        // `raw: true` garde les dates sous forme de numero de serie : c'est
        // `lireDate()` qui convertit, par arithmetique entiere, jamais par UTC.
        const matrice = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: true, defval: '' });
        setAnalyse(analyserFeuille(matrice));
      } catch (err) {
        console.error('[import-excel] lecture :', err);
        setAnalyse({
          fatal: 'Ce fichier n\'est pas un tableur exploitable (.xlsx, .xls ou .csv attendu).',
          creations: [], conflits: [], rejets: [], avertissements: [],
        });
      }
    };
    try {
      lecteur.readAsArrayBuffer(f);
    } catch (err) {
      console.error('[import-excel] readAsArrayBuffer :', err);
      toast.error('Fichier illisible');
    }
  }, []);

  const decider = useCallback((date, choix) => {
    setDecisions((p) => ({ ...p, [date]: choix }));
  }, []);

  const deciderTout = useCallback((choix) => {
    setDecisions(() => {
      const d = {};
      for (const c of plan?.conflits || []) {
        // Une decision interdite (rapport verrouille) n'est pas appliquee en masse.
        d[c.date] = c.interdits?.[choix] ? 'ignorer' : choix;
      }
      return d;
    });
  }, [plan]);

  const reinitialiser = useCallback(() => {
    setFichier(null); setAnalyse(null); setDecisions({}); setBilan(null);
  }, []);

  /* ── Application : la SEULE fonction de cet ecran qui ecrit ── */
  const appliquer = useCallback(async () => {
    if (verrouRef.current) return;          // ← verrou synchrone, avant tout await
    verrouRef.current = true;
    setEnCours(true);

    const reussites = [];
    const echecs = [];
    try {
      const { ecritures } = ecrituresDuPlan(plan, decisions, {
        operateur: user ? { id: user.id, nom: `${user.prenom || ''} ${user.nom || ''}`.trim() } : null,
      });

      for (const e of ecritures) {
        try {
          if (e.type === 'creation') {
            // Garde-fou de dernier recours : le defaut de mars etait un total
            // fige ecrit a cote du detail. S'il revenait, il s'arreterait ici.
            const interdits = payloadSansTotauxFiges(e.data);
            if (interdits.length > 0) throw new Error(`champ(s) interdit(s) : ${interdits.join(', ')}`);
            await db.rapports.create(e.data);
            reussites.push({ date: e.date, action: 'cree' });
          } else {
            const existant = rapports.find((r) => r.id === e.id);
            // `e.patch` porte DEJA le contenu final (la fusion est faite dans le
            // module pur). Le refusionner ici compterait les montants deux fois.
            const details = detailsHistorique(existant, e.patch);
            const patch = {
              ...e.patch,
              historique: [
                ...(existant?.historique || []),
                {
                  timestamp: new Date().toISOString(),
                  utilisateur: `${user?.prenom || ''} ${user?.nom || ''}`.trim() || 'Import Excel',
                  nb_modifications: details.length,
                  details,
                  motif: `Import Excel « ${fichier?.name || ''} » — ${e.mode}`,
                },
              ],
            };
            const interdits = payloadSansTotauxFiges(patch);
            if (interdits.length > 0) throw new Error(`champ(s) interdit(s) : ${interdits.join(', ')}`);
            await db.rapports.update(e.id, patch);
            reussites.push({ date: e.date, action: e.mode === 'remplacer' ? 'remplace' : 'fusionne' });
          }
        } catch (err) {
          // Un echec d'ecriture ne stoppe pas les autres, et ne passe jamais
          // pour un succes (cf. la lecon de db.update, constat C6).
          console.error('[import-excel] ecriture', e.date, err);
          echecs.push({ date: e.date, message: err?.message || 'ecriture refusee' });
        }
      }

      try {
        await logAction('create', 'rapports', {
          entityLabel: `Import Excel ${fichier?.name || ''}`,
          details: `Import Excel : ${reussites.length} journee(s) enregistree(s), ${echecs.length} echec(s)`,
          metadata: { fichier: fichier?.name || '', empreinte: plan?.empreinte, reussites, echecs },
        });
      } catch (err) {
        console.error('[import-excel] journal d audit :', err);
      }

      setBilan({ reussites, echecs });

      if (reussites.length > 0) {
        toast.success(`${reussites.length} journee(s) enregistree(s)`);
        try {
          const data = await db.rapports.list();
          setRapports(Array.isArray(data) ? data : []);
        } catch { /* la liste sera rechargee par l ecran parent */ }
        setAnalyse(null); setFichier(null); setDecisions({});
        onTermine();
      }
      if (echecs.length > 0) {
        toast.error(`${echecs.length} journee(s) n'ont PAS ete enregistrees — voir le detail`);
      }
    } catch (err) {
      console.error('[import-excel] application :', err);
      toast.error(err?.message || 'L\'import a echoue');
      setBilan({ reussites, echecs: [...echecs, { date: '—', message: err?.message || 'erreur inattendue' }] });
    } finally {
      verrouRef.current = false;
      setEnCours(false);
    }
  }, [plan, decisions, rapports, user, fichier, onTermine]);

  /* ═════════════════════════════════════════════════════════════════════════
     RENDU
     ═════════════════════════════════════════════════════════════════════════ */

  return (
    <div className="flex h-full min-h-0 flex-col">

      {/* ── Bandeau ── */}
      <div className="shrink-0 border-b bg-slate-50 px-6 py-3">
        <h3 className="text-base font-bold text-slate-800">Importer un rapport saisi sur Excel</h3>
        <p className="text-xs text-slate-600">
          Pour les journees de coupure de courant. Rien n'est enregistre avant votre confirmation.
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">

        {/* ── Etape 1 : le modele ── */}
        <Card className="border-blue-200 bg-blue-50/40">
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <Info className="h-5 w-5 shrink-0 text-blue-600" />
            <div className="min-w-[220px] flex-1 text-sm text-blue-900">
              <p className="font-semibold">1. Telechargez le modele et remplissez-le</p>
              <p className="text-xs text-blue-700">
                Une ligne par entree, la date sur chaque ligne. Le mode d'emploi est dans le fichier.
              </p>
            </div>
            <BoutonModeleExcel variant="default" />
          </CardContent>
        </Card>

        {/* ── Etape 2 : le fichier ── */}
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <FileUp className="h-5 w-5 shrink-0 text-slate-500" />
            <div className="min-w-[220px] flex-1 text-sm">
              <p className="font-semibold">2. Choisissez votre fichier rempli</p>
              <p className="text-xs text-muted-foreground">
                {fichier ? `Fichier choisi : ${fichier.name}` : 'Formats acceptes : .xlsx, .xls, .csv'}
              </p>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={choisirFichier}
              data-testid="import-excel-fichier"
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => inputRef.current?.click()}
                disabled={chargement || !!erreurChargement}
                className="gap-2"
              >
                <FileUp className="h-4 w-4" /> Choisir un fichier
              </Button>
              {fichier && (
                <Button variant="ghost" onClick={reinitialiser} className="gap-1">
                  <X className="h-4 w-4" /> Retirer
                </Button>
              )}
            </div>
            {chargement && (
              <p className="w-full text-xs text-muted-foreground">
                Lecture des rapports deja enregistres…
              </p>
            )}
            {!chargement && !erreurChargement && (
              <p className="w-full text-xs text-muted-foreground">
                {rapports.length} rapport(s) deja en base — ils seront compares aux journees du fichier.
              </p>
            )}
          </CardContent>
        </Card>

        {/* ── Hors ligne : l'apercu serait faux, on le dit avant tout ── */}
        {horsLigne && (
          <Card className="border-amber-400 bg-amber-50">
            <CardContent className="flex items-start gap-3 p-4 text-sm text-amber-900">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="font-semibold">Pas de reseau sur cet appareil</p>
                <p>{MOTIF_HORS_LIGNE}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Base illisible ── */}
        {erreurChargement && (
          <Card className="border-red-300 bg-red-50">
            <CardContent className="flex items-start gap-3 p-4 text-sm text-red-800">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
              <p>{erreurChargement}</p>
            </CardContent>
          </Card>
        )}

        {/* ── Fichier refuse en entier ── */}
        {plan?.fatal && (
          <Card className="border-red-300 bg-red-50">
            <CardContent className="flex items-start gap-3 p-4 text-sm text-red-800">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="font-semibold">Ce fichier ne peut pas etre importe</p>
                <p>{plan.fatal}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Avertissements (colonnes manquantes / en trop) ── */}
        {plan && !plan.fatal && plan.avertissements?.length > 0 && (
          <Card className="border-amber-300 bg-amber-50">
            <CardContent className="p-4 text-sm text-amber-900">
              <p className="mb-1 flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4" /> A savoir sur ce fichier
              </p>
              <ul className="ml-6 list-disc space-y-0.5 text-xs">
                {plan.avertissements.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* ── APERCU ── */}
        {plan && !plan.fatal && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Card><CardContent className="p-3">
                <p className="text-[10px] text-muted-foreground">Journees a creer</p>
                <p className="text-lg font-bold text-emerald-600">{resume.aCreer}</p>
              </CardContent></Card>
              <Card><CardContent className="p-3">
                <p className="text-[10px] text-muted-foreground">Deja en base</p>
                <p className="text-lg font-bold text-amber-600">{resume.enConflit}</p>
              </CardContent></Card>
              <Card><CardContent className="p-3">
                <p className="text-[10px] text-muted-foreground">Lignes refusees</p>
                <p className="text-lg font-bold text-red-600">{resume.refusees}</p>
              </CardContent></Card>
              <Card><CardContent className="p-3">
                <p className="text-[10px] text-muted-foreground">Recettes du fichier</p>
                <p className="text-lg font-bold">{fmt(resume.recettes)} F</p>
              </CardContent></Card>
            </div>

            {/* ── Creations ── */}
            {plan.creations.length > 0 && (
              <div>
                <h4 className="mb-2 flex items-center gap-2 text-sm font-bold text-emerald-800">
                  <FilePlus2 className="h-4 w-4" /> Journees qui seront creees ({plan.creations.length})
                </h4>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/60 text-[11px] uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left">Journee</th>
                        <th className="px-3 py-2 text-right">Recettes</th>
                        <th className="px-3 py-2 text-right">Depenses</th>
                        <th className="px-3 py-2 text-right">Solde</th>
                        <th className="px-3 py-2 text-left">Lignes du fichier</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.creations.map((c) => (
                        <tr key={c.date} className="border-t">
                          <td className="px-3 py-1.5 font-medium">{dateEnClair(c.date)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700">{fmt(c.totaux.recettes)} F</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-red-700">{fmt(c.totaux.depenses)} F</td>
                          <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{fmt(c.totaux.solde)} F</td>
                          <td className="px-3 py-1.5 text-xs text-muted-foreground">
                            {c.numerosLignes.join(', ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── Conflits ── */}
            {plan.conflits.length > 0 && (
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <h4 className="flex items-center gap-2 text-sm font-bold text-amber-800">
                    <AlertTriangle className="h-4 w-4" />
                    Journees deja enregistrees ({plan.conflits.length}) — votre choix est demande
                  </h4>
                  <div className="ml-auto flex gap-1">
                    <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => deciderTout('remplacer')}>Tout remplacer</Button>
                    <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => deciderTout('fusionner')}>Tout fusionner</Button>
                    <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => deciderTout('ignorer')}>Tout ignorer</Button>
                  </div>
                </div>

                <div className="space-y-2">
                  {plan.conflits.map((c) => {
                    const choix = decisions[c.date];
                    return (
                      <Card key={c.date} className={choix ? 'border-slate-200' : 'border-amber-400'}>
                        <CardContent className="space-y-2 p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold">{dateEnClair(c.date)}</span>
                            <Badge variant="outline" className="text-[10px]">{c.existant.statut}</Badge>
                            {c.existant.verrouille && (
                              <Badge variant="outline" className="border-violet-400 text-[10px] text-violet-700">verrouille</Badge>
                            )}
                            {c.dejaImporte && (
                              <Badge variant="outline" className="border-blue-400 text-[10px] text-blue-700">
                                fichier deja importe
                              </Badge>
                            )}
                            {c.enDouble && (
                              <Badge variant="outline" className="border-red-400 text-[10px] text-red-700">
                                cette date existe en double en base
                              </Badge>
                            )}
                            {!choix && (
                              <span className="ml-auto text-xs font-medium text-amber-700">choix requis</span>
                            )}
                          </div>

                          <div className="grid gap-2 text-xs sm:grid-cols-3">
                            <div className="rounded border bg-slate-50 p-2">
                              <p className="font-semibold text-slate-600">Deja en base</p>
                              <p className="tabular-nums">{fmt(c.existant.totaux.recettes)} F de recettes</p>
                              <p className="tabular-nums">{fmt(c.existant.totaux.depenses)} F de depenses</p>
                              {c.existant.origine?.fichier && (
                                <p className="mt-1 text-[10px] text-muted-foreground">
                                  importe le {String(c.existant.origine.importe_le).slice(0, 10)} depuis
                                  {' '}« {c.existant.origine.fichier} » par {c.existant.origine.importe_par}
                                </p>
                              )}
                            </div>
                            <div className="rounded border bg-blue-50 p-2">
                              <p className="font-semibold text-blue-700">Dans le fichier</p>
                              <p className="tabular-nums">{fmt(c.entrant.totaux.recettes)} F de recettes</p>
                              <p className="tabular-nums">{fmt(c.entrant.totaux.depenses)} F de depenses</p>
                              <p className="mt-1 text-[10px] text-muted-foreground">
                                ligne(s) {c.entrant.numerosLignes.join(', ')}
                              </p>
                            </div>
                            <div className="rounded border bg-emerald-50 p-2">
                              <p className="font-semibold text-emerald-700">Si vous fusionnez</p>
                              <p className="tabular-nums">{fmt(c.apresFusion.recettes)} F de recettes</p>
                              <p className="tabular-nums">{fmt(c.apresFusion.depenses)} F de depenses</p>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            {[
                              { cle: 'remplacer', libelle: 'Remplacer', Icone: Replace },
                              { cle: 'fusionner', libelle: 'Fusionner', Icone: Merge },
                              { cle: 'ignorer', libelle: 'Ignorer', Icone: Ban },
                            ].map(({ cle, libelle, Icone }) => {
                              const interdit = c.interdits?.[cle];
                              return (
                                <div key={cle} className="flex items-center gap-1.5">
                                  <Button
                                    size="sm"
                                    variant={choix === cle ? 'default' : 'outline'}
                                    className="h-7 gap-1.5 text-[11px]"
                                    disabled={!!interdit}
                                    onClick={() => decider(c.date, cle)}
                                  >
                                    <Icone className="h-3.5 w-3.5" /> {libelle}
                                  </Button>
                                  {interdit && (
                                    <span className="max-w-[320px] text-[10px] leading-tight text-muted-foreground">
                                      {interdit}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Lignes refusees, NOMMEES ── */}
            {plan.rejets.length > 0 && (
              <div>
                <h4 className="mb-2 flex items-center gap-2 text-sm font-bold text-red-800">
                  <Ban className="h-4 w-4" /> Lignes refusees ({plan.rejets.length}) — le reste s'importe normalement
                </h4>
                <ul className="space-y-1 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900">
                  {plan.rejets.map((r, i) => (
                    <li key={i}>
                      <span className="font-semibold">ligne {r.ligne}</span> : {r.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {plan.lignesVides > 0 && (
              <p className="text-xs text-muted-foreground">
                {plan.lignesVides} ligne(s) vide(s) ignoree(s).
              </p>
            )}
          </>
        )}

        {/* ── Bilan apres application ── */}
        {bilan && (
          <Card className={bilan.echecs.length > 0 ? 'border-amber-300 bg-amber-50' : 'border-emerald-300 bg-emerald-50'}>
            <CardContent className="p-4 text-sm">
              <p className="mb-2 flex items-center gap-2 font-semibold">
                <CheckCircle2 className="h-4 w-4" /> Resultat de l'import
              </p>
              <ul className="ml-6 list-disc space-y-0.5 text-xs">
                {bilan.reussites.map((r, i) => (
                  <li key={`r${i}`}>{dateEnClair(r.date)} — {r.action}</li>
                ))}
                {bilan.echecs.map((e, i) => (
                  <li key={`e${i}`} className="text-red-700">
                    {dateEnClair(e.date)} — NON ENREGISTRE : {e.message}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── Pied : le bouton, et TOUJOURS le motif quand il est eteint ── */}
      <div className="shrink-0 border-t bg-white px-6 py-3">
        <div className="flex flex-wrap items-center justify-end gap-3">
          {!etat.actif && etat.motif && (
            <p className="mr-auto max-w-[560px] text-xs leading-tight text-amber-700">
              {etat.motif}
            </p>
          )}
          {onFermer && (
            <Button variant="ghost" onClick={onFermer} disabled={enCours}>Fermer</Button>
          )}
          <Button
            onClick={appliquer}
            disabled={!etat.actif}
            className="gap-2 bg-blue-600 hover:bg-blue-700"
          >
            {enCours ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {enCours
              ? 'Enregistrement…'
              : `Enregistrer ${etat.nbEcritures > 0 ? `(${etat.nbEcritures} journee${etat.nbEcritures > 1 ? 's' : ''})` : ''}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
