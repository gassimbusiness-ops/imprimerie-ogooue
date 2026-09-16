/**
 * Ecran Mockups — pipeline hybride.
 *
 *   L'IA fait le t-shirt et la lumiere. Le logo vient du fichier du client,
 *   il n'est jamais redessine.
 *
 * Les decisions sont dans `moteur-mockup.js` (pur, teste sous `node --test`),
 * le dessin dans `composition.js`. Ce fichier ne fait que de l'affichage et de
 * l'orchestration.
 *
 * TROIS REGLES QUI ONT COUTE CHER ET QUI SONT TENUES ICI :
 *
 *  1. AUCUNE EXCEPTION NE DOIT BLANCHIR L'ECRAN. Une exception au demarrage a
 *     rendu toute l'application blanche en production. Tout ce qui peut echouer
 *     est enveloppe, et l'ecran entier est protege par une frontiere d'erreur
 *     qui affiche la panne au lieu de la propager.
 *  2. UN BOUTON GRISE DIT TOUJOURS POURQUOI, JUSTE A COTE. Le gerant a vecu
 *     « impossible de cliquer » sans explication. `validerDemandeMockup` renvoie
 *     toujours un message ; il est affiche sous le bouton, sans exception.
 *  3. LE DOUBLE-CLIC EST VERROUILLE EN SYNCHRONE (`useRef`, pas l'etat React).
 *     `setState` est asynchrone : deux clics rapides passeraient tous les deux
 *     le test `if (generating)`. Chaque generation est facturee.
 */
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Paintbrush, Upload, Loader2, Download, Image as ImageIcon, FileText,
  Eye, Palette, CheckCircle2, AlertTriangle, XCircle, Camera, Sparkles,
  Link2, Wand2, RotateCcw, Info,
} from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '@/services/api-client';
import { db } from '@/services/db';
import { supabase } from '@/services/supabase';
import { printHTML } from '@/services/export-pdf';

import {
  SUPPORTS, ANGLES, TECHNIQUES,
  trouverSupport, trouverColoris, trouverZone, trouverTechnique,
  construirePromptScene, validerDemandeMockup, verifierFaisabilite,
  analyserPixelsLogo, extraireScene, extraireMessageErreur,
  construireRecette, recetteSansImage, deciderEnregistrement,
  verifierPlafond, svgContientDuTexte, coutGeneration, formatFCFA,
  MENTION_RESERVE, PLAFOND_GENERATIONS_PAR_JOUR, QUALITE_PAR_DEFAUT,
} from './moteur-mockup.js';
import {
  chargerImage, urlDepuisFichier, lirePixelsLogo, composerMockup,
  exporterApercu, detourerFondUni, LARGEUR_APERCU,
} from './composition.js';

/* ═════════════════════════════════════════════════════════════════════════════
   Frontiere d'erreur — l'écran s'affiche TOUJOURS
   ═════════════════════════════════════════════════════════════════════════════ */

class FrontiereErreur extends React.Component {
  constructor(props) {
    super(props);
    this.state = { erreur: null };
  }

  static getDerivedStateFromError(erreur) {
    return { erreur };
  }

  componentDidCatch(erreur, info) {
    console.error('[mockup] exception capturee par la frontiere :', erreur, info);
  }

  render() {
    if (this.state.erreur) {
      return (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6">
          <h2 className="flex items-center gap-2 text-lg font-bold text-red-700">
            <AlertTriangle className="h-5 w-5" /> L&apos;écran Mockups a rencontre une erreur
          </h2>
          <p className="mt-2 text-sm text-red-700">
            Le reste de l&apos;application fonctionne normalement. Message technique :
          </p>
          <pre className="mt-2 overflow-auto rounded bg-white p-3 text-xs text-red-800">
            {String(this.state.erreur?.message || this.state.erreur)}
          </pre>
          <Button
            variant="outline"
            className="mt-3 gap-2"
            onClick={() => this.setState({ erreur: null })}
          >
            <RotateCcw className="h-4 w-4" /> Reessayer
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ═════════════════════════════════════════════════════════════════════════════
   Compteur de generations facturees — par jour, par poste
   ═════════════════════════════════════════════════════════════════════════════ */

function cleCompteur() {
  // Pas de .toISOString() : decalage de fuseau au Gabon (cf. src/lib/dates.js).
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const jj = String(d.getDate()).padStart(2, '0');
  return `io_mockup_generations_${d.getFullYear()}-${mm}-${jj}`;
}

function lireCompteur() {
  try { return Number(localStorage.getItem(cleCompteur()) || 0) || 0; } catch { return 0; }
}

function incrementerCompteur() {
  try {
    const n = lireCompteur() + 1;
    localStorage.setItem(cleCompteur(), String(n));
    return n;
  } catch { return lireCompteur(); }
}

/* ═════════════════════════════════════════════════════════════════════════════
   Petits composants
   ═════════════════════════════════════════════════════════════════════════════ */

function Etape({ numero, titre, fait, children }) {
  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div className="flex items-center gap-3">
        <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white ${fait ? 'bg-emerald-500' : 'bg-primary'}`}>
          {fait ? <CheckCircle2 className="h-4 w-4" /> : numero}
        </div>
        <h3 className="text-sm font-semibold">{titre}</h3>
      </div>
      {children}
    </div>
  );
}

function Alerte({ type = 'info', children }) {
  const styles = {
    info: 'border-blue-200 bg-blue-50 text-blue-800',
    attention: 'border-amber-200 bg-amber-50 text-amber-800',
    blocage: 'border-red-200 bg-red-50 text-red-800',
  }[type];
  const Icone = type === 'blocage' ? XCircle : type === 'attention' ? AlertTriangle : Info;
  return (
    <div className={`flex gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed ${styles}`}>
      <Icone className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════════════
   L'écran
   ═════════════════════════════════════════════════════════════════════════════ */

function EcranMockup() {
  // ── Configuration ──
  const [supportId, setSupportId] = useState('tshirt_adulte');
  const [colorisId, setColorisId] = useState('blanc');
  const [angleId, setAngleId] = useState('face');
  const [techniqueId, setTechniqueId] = useState('flex');
  const [zoneId, setZoneId] = useState('poitrine_gauche');
  const [clientNom, setClientNom] = useState('');

  // ── Logo ──
  const [logoFichier, setLogoFichier] = useState(null);
  const [logoUrl, setLogoUrl] = useState(null);
  const [logoImage, setLogoImage] = useState(null);
  const [logoAnalyse, setLogoAnalyse] = useState(null);
  const [logoNotes, setLogoNotes] = useState([]);
  const [logoOriginalUrl, setLogoOriginalUrl] = useState(null);

  // ── Scene ──
  const [sceneImage, setSceneImage] = useState(null);
  const [sceneOrigine, setSceneOrigine] = useState(null); // 'photo' | 'photo_importee' | 'ia'
  const [promptEdite, setPromptEdite] = useState(undefined);
  const [photothequeTestee, setPhotothequeTestee] = useState(false);

  // ── Position du marquage ──
  const [position, setPosition] = useState({ x: 0.635, y: 0.325, largeur: 0.16, rotation: 0 });

  // ── Etat de rendu ──
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [noteRendu, setNoteRendu] = useState('');
  const [decision, setDecision] = useState(null); // 'valide' | 'rejete' | null
  const [enregistre, setEnregistre] = useState(null);
  const [compteur, setCompteur] = useState(0);
  const [documents, setDocuments] = useState([]);
  const [documentChoisi, setDocumentChoisi] = useState('');

  // 🔒 VERROU SYNCHRONE. `setEnCours(true)` ne prend effet qu'au rendu suivant :
  // deux clics rapides passeraient tous les deux. Un ref est mis a jour
  // immediatement. Chaque generation est facturee, ce verrou vaut de l'argent.
  const verrou = useRef(false);

  const canvasRef = useRef(null);
  const inputLogoRef = useRef(null);
  const inputPhotoRef = useRef(null);
  const zoneApercuRef = useRef(null);

  const support = useMemo(() => trouverSupport(supportId), [supportId]);
  const coloris = useMemo(() => trouverColoris(supportId, colorisId), [supportId, colorisId]);
  const zone = useMemo(() => trouverZone(supportId, zoneId), [supportId, zoneId]);
  const technique = useMemo(() => trouverTechnique(techniqueId), [techniqueId]);

  useEffect(() => { setCompteur(lireCompteur()); }, []);

  // Charger les devis et commandes pour le rattachement. Best effort : si la
  // base est injoignable, l'ecran fonctionne quand meme, sans rattachement.
  useEffect(() => {
    let vivant = true;
    (async () => {
      try {
        const [devis, commandes] = await Promise.all([
          db.devis.list().catch(() => []),
          db.commandes.list().catch(() => []),
        ]);
        if (!vivant) return;
        const liste = [
          ...(devis || []).slice(-40).map((d) => ({
            cle: `devis:${d.id}`, type: 'devis', id: d.id,
            numero: d.numero || d.id, client: d.client_nom || '',
          })),
          ...(commandes || []).slice(-40).map((c) => ({
            cle: `commande:${c.id}`, type: 'commande', id: c.id,
            numero: c.numero || c.reference || c.id, client: c.client_nom || c.client || '',
          })),
        ];
        setDocuments(liste);
      } catch (e) {
        console.warn('[mockup] documents non charges :', e?.message);
      }
    })();
    return () => { vivant = false; };
  }, []);

  /* ── Coherence support / coloris / zone / technique ─────────────────────── */

  useEffect(() => {
    if (!support) return;
    if (!support.coloris.some((c) => c.id === colorisId)) setColorisId(support.coloris[0].id);
    if (!support.zones.some((z) => z.id === zoneId)) setZoneId(support.zones[0].id);
    if (!support.techniques.includes(techniqueId)) setTechniqueId(support.techniques[0]);
    if (!support.angles.includes(angleId)) setAngleId(support.angles[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supportId]);

  // Recentrer le marquage sur la zone choisie.
  useEffect(() => {
    if (!zone) return;
    setPosition((p) => ({
      ...p,
      x: zone.cx,
      y: zone.cy,
      largeur: Math.min(p.largeur, zone.wMax),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneId, supportId]);

  /* ── Photothèque : la photo reelle prime toujours sur l'IA ───────────────── */

  // Convention de nommage : `public/mockups/<support>_<coloris>_<angle>.jpg`.
  // Des que Gassim depose sa photo de t-shirt blanc sous
  // `public/mockups/tshirt_adulte_blanc_face.jpg`, elle est utilisee
  // automatiquement, sans reseau et sans un franc de cout.
  const cheminPhotothèque = `/mockups/${supportId}_${colorisId}_${angleId}.jpg`;

  useEffect(() => {
    let vivant = true;
    setPhotothequeTestee(false);
    (async () => {
      const { image } = await chargerImage(cheminPhotothèque, { delaiMs: 6000 });
      if (!vivant) return;
      setPhotothequeTestee(true);
      if (image) {
        setSceneImage(image);
        setSceneOrigine('photo');
        setErreur(null);
      } else if (sceneOrigine === 'photo') {
        setSceneImage(null);
        setSceneOrigine(null);
      }
    })();
    return () => { vivant = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cheminPhotothèque]);

  /* ── Import du logo ─────────────────────────────────────────────────────── */

  const importerLogo = useCallback(async (fichier) => {
    if (!fichier) return;
    setLogoFichier(fichier);
    setLogoAnalyse(null);
    setLogoNotes([]);
    setDecision(null);

    try {
      const { url, source, message } = await urlDepuisFichier(fichier);
      if (!url) { toast.error(message || 'Logo illisible.'); return; }

      const notes = [];
      if (source && svgContientDuTexte(source)) {
        notes.push({
          type: 'attention',
          texte: 'Ce SVG contient du texte non vectorise. Si la police n\'est pas embarquee, '
            + 'le navigateur la remplace par celle du poste SANS rien signaler : le logo s\'affiche, '
            + 'mais il est faux. Demandez au client un SVG avec les textes vectorises, ou un PNG.',
        });
      }

      const { image, message: msgImg } = await chargerImage(url);
      if (!image) {
        toast.error(msgImg || 'Logo illisible.');
        setLogoNotes([{ type: 'blocage', texte: msgImg || 'Logo illisible.' }]);
        return;
      }

      setLogoUrl(url);
      setLogoOriginalUrl(url);
      setLogoImage(image);

      const { donnees, largeur, message: msgPix } = lirePixelsLogo(image);
      if (donnees) {
        const a = analyserPixelsLogo(donnees);
        setLogoAnalyse({ ...a, largeurPx: largeur });
      } else {
        setLogoAnalyse(null);
        if (msgPix) notes.push({ type: 'attention', texte: msgPix });
      }
      setLogoNotes(notes);
      setDecision(null);
    } catch (e) {
      console.error('[mockup] import du logo :', e);
      toast.error(`Import impossible : ${e?.message || 'erreur'}`);
    }
  }, []);

  const surFichierLogo = (e) => {
    const f = e?.target?.files?.[0];
    if (f) importerLogo(f);
  };

  const surDepot = useCallback((e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f) importerLogo(f);
  }, [importerLogo]);

  const detourer = useCallback(async () => {
    if (!logoImage) return;
    const r = detourerFondUni(logoImage);
    if (!r.ok || !r.dataUrl) { toast.error(r.message); return; }
    const { image } = await chargerImage(r.dataUrl);
    if (!image) { toast.error('Detourage illisible : le logo est laisse tel quel.'); return; }
    setLogoUrl(r.dataUrl);
    setLogoImage(image);
    toast.success(r.message);
  }, [logoImage]);

  const annulerDetourage = useCallback(async () => {
    if (!logoOriginalUrl) return;
    const { image } = await chargerImage(logoOriginalUrl);
    if (image) { setLogoUrl(logoOriginalUrl); setLogoImage(image); toast.info('Logo d\'origine restaure.'); }
  }, [logoOriginalUrl]);

  /* ── Import d'une photo de support ──────────────────────────────────────── */

  const importerPhotoSupport = async (e) => {
    const f = e?.target?.files?.[0];
    if (!f) return;
    try {
      const { url, message } = await urlDepuisFichier(f);
      if (!url) { toast.error(message); return; }
      const { image, message: m2 } = await chargerImage(url);
      if (!image) { toast.error(m2); return; }
      setSceneImage(image);
      setSceneOrigine('photo_importee');
      setErreur(null);
      setDecision(null);
      toast.success('Photo du support chargee — aucun cout, aucun reseau.');
    } catch (err) {
      toast.error(`Photo illisible : ${err?.message || 'erreur'}`);
    }
  };

  /* ── Validation de la demande ───────────────────────────────────────────── */

  const promptAuto = useMemo(
    () => construirePromptScene({ supportId, colorisId, angleId }),
    [supportId, colorisId, angleId],
  );

  const largeurImpressionCm = useMemo(() => {
    if (!zone || !support) return 0;
    // La largeur du marquage est une fraction de la largeur de la scene ;
    // la largeur reelle du support fait la conversion en centimetres.
    const cm = position.largeur * support.largeurReelleCm;
    return Math.round(Math.min(cm, zone.largeurMaxCm) * 10) / 10;
  }, [position.largeur, support, zone]);

  const demande = useMemo(() => validerDemandeMockup({
    supportId, colorisId, angleId, techniqueId, zoneId,
    fichierLogo: logoFichier,
    analyseLogo: logoAnalyse,
    largeurImpressionCm,
    largeurLogoPx: logoAnalyse?.largeurPx || logoImage?.naturalWidth || 0,
    promptEdite,
    sceneExistante: sceneImage ? (sceneOrigine || 'photo') : null,
    enCours,
    compteurDuJour: compteur,
    qualité: QUALITE_PAR_DEFAUT,
  }), [
    supportId, colorisId, angleId, techniqueId, zoneId, logoFichier, logoAnalyse,
    largeurImpressionCm, logoImage, promptEdite, sceneImage, sceneOrigine, enCours, compteur,
  ]);

  // Les avertissements sont calcules meme quand la demande est bloquee ailleurs :
  // le gerant doit voir TOUS les problemes d'un coup, pas un par clic.
  const faisabilite = useMemo(() => verifierFaisabilite({
    supportId, colorisId, techniqueId,
    analyseLogo: logoAnalyse,
    largeurImpressionCm,
    largeurLogoPx: logoAnalyse?.largeurPx || logoImage?.naturalWidth || 0,
  }), [supportId, colorisId, techniqueId, logoAnalyse, largeurImpressionCm, logoImage]);

  const plafond = verifierPlafond({ compteur });

  /* ── Rendu de l'apercu ──────────────────────────────────────────────────── */

  const redessiner = useCallback(() => {
    if (!canvasRef.current || !sceneImage) return;
    const r = composerMockup({
      canvas: canvasRef.current,
      scène: sceneImage,
      logo: logoImage,
      zone,
      position,
    });
    setNoteRendu(r.message || '');
    if (!r.ok && r.message) setErreur(r.message);
  }, [sceneImage, logoImage, zone, position]);

  useEffect(() => { redessiner(); }, [redessiner]);

  /* ── Generation de la scene par l'IA ────────────────────────────────────── */

  const genererScene = async () => {
    // 🔒 Verrou synchrone : premiere ligne, avant tout await.
    if (verrou.current) return;

    const v = validerDemandeMockup({
      supportId, colorisId, angleId, techniqueId, zoneId,
      fichierLogo: logoFichier, analyseLogo: logoAnalyse,
      largeurImpressionCm,
      largeurLogoPx: logoAnalyse?.largeurPx || logoImage?.naturalWidth || 0,
      promptEdite,
      sceneExistante: null, // on demande explicitement une generation
      enCours: false,
      compteurDuJour: compteur,
    });
    if (!v.ok) { toast.error(v.message); return; }

    verrou.current = true;
    setEnCours(true);
    setErreur(null);
    setDecision(null);

    try {
      const reponse = await apiFetch('/api/generate-mockup', {
        method: 'POST',
        body: JSON.stringify({
          prompt: v.prompt,
          qualité: QUALITE_PAR_DEFAUT,
          taille: '1024x1024',
        }),
      });

      let corps = null;
      try { corps = await reponse.json(); } catch { corps = null; }

      if (!reponse.ok) {
        const m = extraireMessageErreur(reponse, corps);
        setErreur(m);
        toast.error(m);
        return;
      }

      const scène = extraireScene(corps);
      if (!scène.ok) {
        setErreur(scène.message);
        toast.error(scène.message);
        return;
      }

      // La generation est facturee des que le serveur a repondu 200.
      setCompteur(incrementerCompteur());

      const { image, message } = await chargerImage(scène.image);
      if (!image) {
        setErreur(message || 'Scène illisible.');
        toast.error(message || 'Scène illisible.');
        return;
      }
      setSceneImage(image);
      setSceneOrigine('ia');
      toast.success(`Scène generee (${formatFCFA(v.cout)} facture).`);
    } catch (e) {
      const m = e?.message || 'Erreur inconnue';
      setErreur(m);
      toast.error(m);
    } finally {
      setEnCours(false);
      verrou.current = false;
    }
  };

  /* ── Validation / rejet ─────────────────────────────────────────────────── */

  const rejeter = () => {
    setDecision('rejete');
    setEnregistre(null);
    const d = deciderEnregistrement('rejete');
    toast.info(d.message);
  };

  const valider = async () => {
    const d = deciderEnregistrement('valide');
    if (!d.enregistrer) { toast.error(d.message); return; }
    setDecision('valide');

    const tailleCm = zone
      ? {
        l: largeurImpressionCm,
        h: Math.round(largeurImpressionCm * (logoImage ? logoImage.naturalHeight / logoImage.naturalWidth : 1) * 10) / 10,
      }
      : null;

    // 1. L'apercu rendu part dans Supabase Storage — JAMAIS dans app_data.
    let apercuRef = null;
    const exp = exporterApercu(canvasRef.current);
    if (exp.ok && supabase) {
      try {
        const blob = await (await fetch(exp.dataUrl)).blob();
        const nom = `apercus/${Date.now()}_${supportId}_${colorisId}.jpg`;
        const { error } = await supabase.storage.from('mockups').upload(nom, blob, { upsert: true });
        if (error) {
          // Le bucket `mockups` n'a jamais ete verifie (question ouverte du
          // cahier des charges §9.2-1). On le dit, on ne bloque pas : la recette
          // suffit a regenerer l'apercu a l'identique depuis une photo.
          console.warn('[mockup] depot de l\'aperçu impossible :', error.message);
          toast.warning(`Aperçu non archive (${error.message}). La recette, elle, est enregistree.`);
        } else {
          apercuRef = nom;
        }
      } catch (e) {
        console.warn('[mockup] depot de l\'aperçu :', e?.message);
      }
    }

    // 2. La recette — quelques centaines d'octets — va dans app_data.
    const doc = documents.find((x) => x.cle === documentChoisi) || null;
    const r = construireRecette({
      supportId, colorisId, angleId, techniqueId, zoneId,
      position,
      tailleReelleCm: tailleCm,
      logoRef: logoFichier?.name || null,
      sceneRef: apercuRef,
      sceneOrigine: sceneOrigine || 'photo',
      promptScene: demande.prompt,
      clientNom: clientNom || doc?.client || '',
      documentType: doc?.type || null,
      documentId: doc?.id || null,
      documentNumero: doc?.numero || '',
      coutFcfa: sceneOrigine === 'ia' ? coutGeneration(QUALITE_PAR_DEFAUT) : 0,
    });
    if (!r.ok) { toast.error(r.message); return; }

    const barriere = recetteSansImage(r.recette);
    if (!barriere.ok) { toast.error(barriere.message); return; }

    try {
      const cree = await db.mockups.create(r.recette);
      setEnregistre(cree);
      toast.success(`Mockup valide et enregistre (${r.octets} octets — aucune image en base).`);

      // 3. Rattachement au devis ou a la commande.
      if (doc) {
        try {
          const collection = doc.type === 'devis' ? db.devis : db.commandes;
          await collection.update(doc.id, { mockup_id: cree.id });
          toast.success(`Rattache a ${doc.numero}.`);
        } catch (e) {
          toast.warning(`Mockup enregistre, mais le rattachement a ${doc.numero} a echoue `
            + `(${e?.message || 'erreur'}). Reessayez depuis l'écran Devis.`);
        }
      }
    } catch (e) {
      toast.error(`Enregistrement impossible (${e?.message || 'erreur'}). Rien n'a ete ecrit.`);
    }
  };

  /* ── Exports ────────────────────────────────────────────────────────────── */

  const telechargerJpeg = () => {
    const exp = exporterApercu(canvasRef.current);
    if (!exp.ok) { toast.error(exp.message); return; }
    try {
      const a = document.createElement('a');
      a.href = exp.dataUrl;
      a.download = `apercu_${supportId}_${colorisId}_${Date.now()}.jpg`;
      a.click();
      toast.success('Aperçu telecharge (JPEG — c\'est ce qui s\'envoie le mieux sur WhatsApp).');
    } catch (e) {
      toast.error(`Telechargement impossible : ${e?.message || 'erreur'}`);
    }
  };

  /**
   * Export PDF — via `printHTML` de `src/services/export-pdf.js`.
   * On ne reecrit pas de generateur : ce module porte l'en-tete, le pied de page
   * (RCCM, NIF, adresse, telephones) et le correctif d'iframe qui a ressuscite
   * les 13 exports de l'application. On lui passe du HTML, rien de plus.
   */
  const exporterPdf = () => {
    const exp = exporterApercu(canvasRef.current);
    if (!exp.ok) { toast.error(exp.message); return; }
    if (decision !== 'valide') {
      toast.error('Validez l\'aperçu avant de l\'exporter : un mockup non valide ne doit pas '
        + 'circuler chez le client.');
      return;
    }
    try {
      const e = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const doc = documents.find((x) => x.cle === documentChoisi) || null;
      const html = `
        <h2>Proposition de mockup</h2>
        <table>
          <tr><th style="width:38%">Client</th><td>${e(clientNom || doc?.client || 'Non specifie')}</td></tr>
          ${doc ? `<tr><th>Rattache a</th><td>${e(doc.type === 'devis' ? 'Devis' : 'Commande')} ${e(doc.numero)}</td></tr>` : ''}
          <tr><th>Support</th><td>${e(support?.label)}</td></tr>
          <tr><th>Coloris</th><td>${e(coloris?.label)}${coloris?.aConfirmer ? ' <em>(a confirmer en magasin)</em>' : ''}</td></tr>
          <tr><th>Technique de marquage</th><td>${e(technique?.label)}</td></tr>
          <tr><th>Zone de marquage</th><td>${e(zone?.label)}</td></tr>
          <tr><th>Largeur du marquage</th><td>${e(largeurImpressionCm)} cm</td></tr>
          <tr><th>Fichier client</th><td>${e(logoFichier?.name || '—')}</td></tr>
          <tr><th>Origine de la mise en scène</th><td>${sceneOrigine === 'ia' ? 'Scène generee par IA (support nu uniquement)' : 'Photographie du support reel'}</td></tr>
        </table>
        <div style="text-align:center;margin:12px 0">
          <img src="${exp.dataUrl}" style="max-width:150mm;max-height:150mm;border:1px solid #e5e7eb" />
        </div>
        <div class="confidential">${e(MENTION_RESERVE)}</div>
        <p style="font-size:9px;color:#6b7280;margin-top:8px">
          Le logo de cet aperçu provient du fichier fourni par le client : il n'a pas ete redessiné.
          L'aperçu est une simulation d'écran, il ne constitue pas le fichier d'impression.
        </p>
        <div style="margin-top:18px;border-top:1px solid #e5e7eb;padding-top:10px;font-size:10px">
          <strong>Bon a tirer</strong> — Nom et signature du client :
          <div style="height:26mm;border:1px dashed #cbd5e1;margin-top:6px"></div>
        </div>`;
      printHTML(`Mockup — ${support?.label || ''}`, html);
    } catch (err) {
      console.error('[mockup] export PDF :', err);
      toast.error(`Export PDF impossible : ${err?.message || 'erreur'}`);
    }
  };

  /* ── Deplacement du marquage a la main ──────────────────────────────────── */

  const deplacer = (evt) => {
    const el = zoneApercuRef.current;
    if (!el || !zone) return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const x = (evt.clientX - r.left) / r.width;
    const y = (evt.clientY - r.top) / r.height;
    // On borne au cadre de la zone imprimable : on ne laisse pas poser un
    // marquage la ou l'atelier ne peut pas presser.
    const xMin = zone.cx - zone.wMax / 2;
    const xMax = zone.cx + zone.wMax / 2;
    const yMin = zone.cy - zone.hMax / 2;
    const yMax = zone.cy + zone.hMax / 2;
    setPosition((p) => ({
      ...p,
      x: Math.min(Math.max(x, xMin), xMax),
      y: Math.min(Math.max(y, yMin), yMax),
    }));
  };

  const surPointeur = (evt) => {
    if (!sceneImage || !logoImage) return;
    deplacer(evt);
    const bouger = (e2) => deplacer(e2);
    const relacher = () => {
      window.removeEventListener('pointermove', bouger);
      window.removeEventListener('pointerup', relacher);
    };
    window.addEventListener('pointermove', bouger);
    window.addEventListener('pointerup', relacher);
  };

  /* ═══════════════════════════════════════════════════════════════════════════
     Rendu
     ═══════════════════════════════════════════════════════════════════════════ */

  const pretAApercevoir = Boolean(sceneImage);
  const coutProchaineGeneration = coutGeneration(QUALITE_PAR_DEFAUT);

  return (
    <div className="space-y-6">
      {/* En-tete */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-800 via-slate-700 to-slate-900 p-6 text-white">
        <div className="relative flex flex-wrap items-center gap-3">
          <Paintbrush className="h-6 w-6" />
          <div className="min-w-0">
            <h2 className="text-2xl font-bold">Mockups</h2>
            <p className="text-sm text-white/75">
              L&apos;IA fait le support et la lumière. <strong>Le logo vient du fichier du client :
              il n&apos;est jamais redessiné.</strong>
            </p>
          </div>
        </div>
      </div>

      <Alerte type="info">{MENTION_RESERVE}</Alerte>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* ══════ Colonne gauche — configuration ══════ */}
        <div className="space-y-4">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <Palette className="h-5 w-5 text-primary" /> Configuration
          </h2>

          {/* 1 — Support */}
          <Etape numero="1" titre="Support" fait={!!support}>
            <select
              className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm"
              value={supportId}
              onChange={(e) => setSupportId(e.target.value)}
            >
              {['Textile', 'Objet', 'Grand format'].map((cat) => (
                <optgroup key={cat} label={cat}>
                  {SUPPORTS.filter((s) => s.categorie === cat).map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Etape>

          {/* 2 — Coloris (uniquement ce qui est en stock) */}
          <Etape numero="2" titre="Coloris — uniquement le stock reel" fait={!!coloris}>
            <div className="flex flex-wrap gap-2">
              {(support?.coloris || []).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setColorisId(c.id)}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-all ${
                    colorisId === c.id
                      ? 'border-primary bg-primary/5 font-semibold ring-2 ring-primary/30'
                      : 'border-muted hover:border-primary/50'
                  }`}
                  title={c.source}
                >
                  <span className="h-5 w-5 shrink-0 rounded-full border border-gray-300" style={{ backgroundColor: c.hex }} />
                  <span>{c.label}</span>
                  {Number.isFinite(c.stock) && (
                    <Badge variant="secondary" className="text-[10px]">{c.stock}</Badge>
                  )}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Les quantites viennent de l&apos;inventaire de l&apos;application. Rouge, jaune et gris
              ne sont proposes nulle part : ils ne sont en stock sur aucun support.
            </p>
          </Etape>

          {/* 3 — Logo */}
          <Etape numero="3" titre="Logo du client" fait={!!logoImage}>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={surDepot}
              onClick={() => inputLogoRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 transition-colors ${
                logoUrl ? 'border-emerald-300 bg-emerald-50/50' : 'border-muted-foreground/30 hover:border-primary hover:bg-primary/5'
              }`}
            >
              {logoUrl ? (
                <div className="text-center">
                  <img src={logoUrl} alt="Logo du client" className="mx-auto mb-2 h-24 w-24 rounded-lg object-contain" />
                  <p className="text-xs font-medium text-emerald-700">{logoFichier?.name}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">Cliquez pour changer</p>
                </div>
              ) : (
                <>
                  <Upload className="mb-2 h-8 w-8 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">Glissez le fichier du client ici</p>
                  <p className="text-[10px] text-muted-foreground">PNG, JPG, WEBP ou SVG (max 8 Mo)</p>
                </>
              )}
              <input
                ref={inputLogoRef}
                type="file"
                accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={surFichierLogo}
              />
            </div>

            {logoImage && (
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" className="gap-1.5" onClick={detourer}>
                  <Wand2 className="h-3.5 w-3.5" /> Detourer le fond
                </Button>
                {logoUrl !== logoOriginalUrl && (
                  <Button size="sm" variant="ghost" className="gap-1.5" onClick={annulerDetourage}>
                    <RotateCcw className="h-3.5 w-3.5" /> Annuler
                  </Button>
                )}
                {logoAnalyse && (
                  <span className="text-[11px] text-muted-foreground">
                    {logoAnalyse.nbCouleurs} teintes · {logoImage.naturalWidth}×{logoImage.naturalHeight} px
                  </span>
                )}
              </div>
            )}

            {logoNotes.map((n, i) => (
              <Alerte key={i} type={n.type}>{n.texte}</Alerte>
            ))}
          </Etape>

          {/* 4 — Zone, technique, taille */}
          <Etape numero="4" titre="Marquage : zone, technique, taille" fait={!!zone && !!technique}>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium">Zone</label>
                <select
                  className="w-full rounded-lg border bg-background px-2 py-2 text-sm"
                  value={zoneId}
                  onChange={(e) => setZoneId(e.target.value)}
                >
                  {(support?.zones || []).map((z) => (
                    <option key={z.id} value={z.id}>{z.label} (max {z.largeurMaxCm} cm)</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Technique</label>
                <select
                  className="w-full rounded-lg border bg-background px-2 py-2 text-sm"
                  value={techniqueId}
                  onChange={(e) => setTechniqueId(e.target.value)}
                >
                  {(support?.techniques || []).map((t) => (
                    <option key={t} value={t}>{trouverTechnique(t)?.label || t}</option>
                  ))}
                </select>
              </div>
            </div>
            {technique && (
              <p className="text-[11px] text-muted-foreground">{technique.aide}</p>
            )}

            <div className="space-y-2">
              <label className="flex items-center justify-between text-xs font-medium">
                <span>Largeur du marquage</span>
                <span className="font-mono">{largeurImpressionCm} cm</span>
              </label>
              <input
                type="range"
                min={0.04}
                max={zone?.wMax ?? 0.5}
                step={0.005}
                value={position.largeur}
                onChange={(e) => setPosition((p) => ({ ...p, largeur: Number(e.target.value) }))}
                className="w-full"
              />
              <label className="flex items-center justify-between text-xs font-medium">
                <span>Rotation</span>
                <span className="font-mono">{position.rotation}°</span>
              </label>
              <input
                type="range"
                min={-30} max={30} step={1}
                value={position.rotation}
                onChange={(e) => setPosition((p) => ({ ...p, rotation: Number(e.target.value) }))}
                className="w-full"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium">Angle</label>
                <select
                  className="w-full rounded-lg border bg-background px-2 py-2 text-sm"
                  value={angleId}
                  onChange={(e) => setAngleId(e.target.value)}
                >
                  {ANGLES.filter((a) => (support?.angles || []).includes(a.id)).map((a) => (
                    <option key={a.id} value={a.id}>{a.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Client (pour le PDF)</label>
                <Input value={clientNom} onChange={(e) => setClientNom(e.target.value)} placeholder="Ex : BACOREF" />
              </div>
            </div>
          </Etape>

          {/* Garde-fou technique */}
          {faisabilite.bloquants.map((b) => (
            <Alerte key={b.code} type="blocage"><strong>Impossible en atelier.</strong> {b.message}</Alerte>
          ))}
          {faisabilite.avertissements.map((a) => (
            <Alerte key={a.code} type="attention">{a.message}</Alerte>
          ))}

          {/* 5 — La scène */}
          <Etape numero="5" titre="Mise en scène du support" fait={pretAApercevoir}>
            {sceneOrigine === 'photo' && (
              <Alerte type="info">
                Photo reelle du support trouvee dans la photothèque
                (<code>{cheminPhotothèque}</code>). Aucun reseau, aucun cout, resultat identique
                a chaque fois.
              </Alerte>
            )}
            {sceneOrigine === 'photo_importee' && (
              <Alerte type="info">Photo importee a la main. Aucun cout.</Alerte>
            )}
            {photothequeTestee && !sceneImage && (
              <Alerte type="attention">
                Aucune photo de <strong>{support?.label} {coloris?.label}</strong> dans la photothèque.
                Deposez <code>{cheminPhotothèque}</code> dans <code>public/mockups/</code> —
                c&apos;est gratuit, hors ligne et repetable — ou faites générer la scène par l&apos;IA
                ci-dessous.
              </Alerte>
            )}

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => inputPhotoRef.current?.click()}>
                <Camera className="h-3.5 w-3.5" /> Importer une photo du support
              </Button>
              <input
                ref={inputPhotoRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={importerPhotoSupport}
              />
            </div>

            <details className="rounded-lg border bg-muted/30 p-3">
              <summary className="cursor-pointer text-xs font-medium">
                Prompt de la scène — relisez-le, c&apos;est lui qui part au service IA
              </summary>
              <textarea
                className="mt-2 h-28 w-full rounded border bg-background p-2 font-mono text-[11px]"
                value={promptEdite ?? promptAuto}
                onChange={(e) => setPromptEdite(e.target.value)}
              />
              <div className="mt-1 flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => setPromptEdite(undefined)}>
                  Reinitialiser
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  Ce prompt ne decrit QUE le support nu. Le logo n&apos;y figure pas et n&apos;est
                  jamais envoye.
                </span>
              </div>
            </details>

            <Button
              className="h-11 w-full gap-2"
              onClick={genererScene}
              disabled={enCours || !plafond.ok}
            >
              {enCours
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Generation de la scène…</>
                : <><Sparkles className="h-4 w-4" /> Générer la scène par IA — {formatFCFA(coutProchaineGeneration)}</>}
            </Button>

            {/* 🔴 Le bouton grise dit TOUJOURS pourquoi, juste en dessous. */}
            {!plafond.ok && <Alerte type="blocage">{plafond.message}</Alerte>}
            {plafond.ok && (
              <p className="text-center text-[11px] text-muted-foreground">
                {compteur} generation{compteur > 1 ? 's' : ''} aujourd&apos;hui ·
                {' '}{plafond.restant} restante{plafond.restant > 1 ? 's' : ''} sur {PLAFOND_GENERATIONS_PAR_JOUR}
                {' '}· cout cumule ≈ {formatFCFA(compteur * coutProchaineGeneration)}
              </p>
            )}
            {!demande.ok && demande.raison !== 'plafond' && (
              <Alerte type="attention">{demande.message}</Alerte>
            )}
          </Etape>
        </div>

        {/* ══════ Colonne droite — aperçu ══════ */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <Eye className="h-5 w-5 text-primary" /> Aperçu
            </h2>
            {decision === 'valide' && <Badge className="bg-emerald-600">Validé</Badge>}
            {decision === 'rejete' && <Badge variant="destructive">Rejeté — rien enregistre</Badge>}
          </div>

          {erreur && <Alerte type="blocage">{erreur}</Alerte>}

          {!pretAApercevoir ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <div className="mb-4 rounded-full bg-muted p-4">
                  <ImageIcon className="h-10 w-10 text-muted-foreground/40" />
                </div>
                <p className="font-medium text-muted-foreground">Aucune scène</p>
                <p className="mt-1 max-w-xs text-sm text-muted-foreground/70">
                  Deposez une photo du support, ou faites générer la scène par l&apos;IA.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <CardContent className="p-0">
                <div
                  ref={zoneApercuRef}
                  onPointerDown={surPointeur}
                  className="relative cursor-move touch-none select-none"
                  title="Glissez pour deplacer le marquage"
                >
                  <canvas ref={canvasRef} className="block h-auto w-full" width={LARGEUR_APERCU} height={LARGEUR_APERCU} />
                </div>
              </CardContent>
            </Card>
          )}

          {noteRendu && <Alerte type="attention">{noteRendu}</Alerte>}

          {pretAApercevoir && (
            <>
              <div className="rounded-xl border p-4 text-sm">
                <p className="mb-2 font-semibold">Cotes pour l&apos;atelier</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <span className="text-muted-foreground">Support</span><span>{support?.label} — {coloris?.label}</span>
                  <span className="text-muted-foreground">Zone</span><span>{zone?.label}</span>
                  <span className="text-muted-foreground">Technique</span><span>{technique?.label}</span>
                  <span className="text-muted-foreground">Largeur marquage</span><span>{largeurImpressionCm} cm</span>
                  <span className="text-muted-foreground">Origine de la scène</span>
                  <span>{sceneOrigine === 'ia' ? 'Generee par IA (support nu)' : 'Photo reelle'}</span>
                  <span className="text-muted-foreground">Logo</span>
                  <span>{logoFichier?.name || '— aucun —'}</span>
                </div>
              </div>

              <div className="rounded-xl border p-4">
                <label className="mb-1.5 flex items-center gap-2 text-sm font-medium">
                  <Link2 className="h-4 w-4" /> Rattacher a un devis ou une commande
                </label>
                <select
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                  value={documentChoisi}
                  onChange={(e) => setDocumentChoisi(e.target.value)}
                >
                  <option value="">— Aucun rattachement —</option>
                  {documents.map((d) => (
                    <option key={d.cle} value={d.cle}>
                      {d.type === 'devis' ? 'Devis' : 'Commande'} {d.numero} — {d.client}
                    </option>
                  ))}
                </select>
              </div>

              {/* Validation explicite — un mockup rejete n'est jamais enregistre */}
              <div className="flex flex-wrap gap-2">
                <Button className="flex-1 gap-2 bg-emerald-600 hover:bg-emerald-700" onClick={valider}>
                  <CheckCircle2 className="h-4 w-4" /> Valider ce mockup
                </Button>
                <Button variant="outline" className="flex-1 gap-2" onClick={rejeter}>
                  <XCircle className="h-4 w-4" /> Rejeter
                </Button>
              </div>

              {decision === 'rejete' && (
                <Alerte type="attention">{deciderEnregistrement('rejete').message}</Alerte>
              )}
              {decision !== 'valide' && (
                <p className="text-center text-[11px] text-muted-foreground">
                  L&apos;export PDF s&apos;active apres validation : un mockup non valide ne doit pas
                  circuler chez le client.
                </p>
              )}
              {enregistre && (
                <Alerte type="info">
                  Recette enregistree sous <code>{enregistre.id}</code>. Aucune image en base :
                  l&apos;aperçu se recalcule depuis la recette en quelques millisecondes.
                </Alerte>
              )}

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="flex-1 gap-2" onClick={telechargerJpeg}>
                  <Download className="h-4 w-4" /> JPEG (WhatsApp)
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 gap-2"
                  onClick={exporterPdf}
                  disabled={decision !== 'valide'}
                >
                  <FileText className="h-4 w-4" /> PDF avec bon a tirer
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MockupIA() {
  return (
    <FrontiereErreur>
      <EcranMockup />
    </FrontiereErreur>
  );
}
