import { useState, useRef, useCallback } from 'react';
import { useAuth } from '@/services/auth';
import { supabase } from '@/services/supabase';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Paintbrush, Upload, Sparkles, Loader2, Download, Send,
  Image, FileText, Eye, Palette, CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';

// ─── Product types by category ───
const PRODUCT_TYPES = [
  { category: 'Textile', items: ['T-Shirt', 'Polo', 'Casquette', 'Tote Bag', 'Tablier', 'Sac en tissu'] },
  { category: 'Bureau & Papeterie', items: ['Carnet', 'Stylo', 'Calendrier', 'Enveloppe', 'Cachet'] },
  { category: 'Communication', items: ['Flyer', 'Carte de visite', 'Badge', "Billet d'invitation"] },
  { category: 'Signalisation', items: ['Banderole', 'Panneau publicitaire', 'Kakemono', 'Enseigne'] },
  { category: 'Objets publicitaires', items: ['Mug', 'Bouteille de table', 'Porte-cle'] },
  { category: 'Tenues de travail', items: ['Combinaison', 'Gilet'] },
];

// ─── Colors ───
const COLORS = [
  { label: 'Blanc', value: 'white', hex: '#FFFFFF' },
  { label: 'Noir', value: 'black', hex: '#212121' },
  { label: 'Rouge', value: 'red', hex: '#C62828' },
  { label: 'Bleu', value: 'blue', hex: '#1565C0' },
  { label: 'Vert', value: 'green', hex: '#2E7D32' },
  { label: 'Jaune', value: 'yellow', hex: '#F9A825' },
  { label: 'Gris', value: 'gray', hex: '#757575' },
];

const VIEW_LABELS = {
  face: 'Vue de face',
  side: 'Vue de cote',
  perspective: 'Vue perspective',
};

export default function MockupIA() {
  const { user } = useAuth();

  // Form state
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [productType, setProductType] = useState('');
  const [selectedColor, setSelectedColor] = useState('white');
  const [clientName, setClientName] = useState('');

  // Generation state
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [mockupViews, setMockupViews] = useState([]);
  const [genError, setGenError] = useState(null);

  // Send to client modal
  const [showSendModal, setShowSendModal] = useState(false);

  const fileInputRef = useRef(null);

  // ─── File upload ───
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.match(/image\/(png|jpe?g|svg)/)) {
      toast.error('Format accepte: PNG, JPG, SVG');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Fichier trop volumineux (max 10 Mo)');
      return;
    }
    setLogoFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setLogoPreview(ev.target.result);
    reader.readAsDataURL(file);
  };

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      const fakeEvent = { target: { files: [file] } };
      handleFileChange(fakeEvent);
    }
  }, []);

  // ─── Generate mockups (3 views in parallel) ───
  const generateMockups = async () => {
    if (!productType) { toast.error('Choisissez un type de produit'); return; }
    if (!logoFile) { toast.error('Uploadez un logo/maquette'); return; }

    setGenerating(true);
    setGenerated(false);
    setMockupViews([]);
    setGenError(null);

    const colorLabel = COLORS.find((c) => c.value === selectedColor)?.label || selectedColor;

    try {
      // 1. Upload logo to Supabase Storage
      let publicUrl = null;
      if (supabase) {
        const fileName = `mockup-logos/${Date.now()}-${logoFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const { error: uploadError } = await supabase.storage
          .from('mockup-designs')
          .upload(fileName, logoFile, { upsert: true });

        if (uploadError) {
          console.warn('Supabase upload failed, using base64 fallback:', uploadError.message);
        } else {
          const { data } = supabase.storage.from('mockup-designs').getPublicUrl(fileName);
          publicUrl = data?.publicUrl;
        }
      }

      // Fallback: convert to base64 data URL if storage unavailable
      if (!publicUrl) {
        publicUrl = logoPreview; // data:image/... base64
      }

      // 2. Generate 3 views in parallel
      const views = ['face', 'side', 'perspective'];
      const results = await Promise.allSettled(
        views.map((view) =>
          fetch('/api/generate-mockup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              productType,
              color: colorLabel,
              view,
              logoUrl: publicUrl,
            }),
          }).then((r) => r.json()).then((data) => {
            if (data.error) throw new Error(data.error);
            return { ...data, view };
          })
        )
      );

      const successViews = [];
      const errors = [];
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          successViews.push(r.value);
        } else {
          errors.push({ view: views[i], error: r.reason?.message || 'Erreur' });
        }
      });

      setMockupViews(successViews);
      setGenerated(successViews.length > 0);

      if (successViews.length === 3) {
        toast.success('3 mockups generes avec succes !');
      } else if (successViews.length > 0) {
        toast.warning(`${successViews.length}/3 mockups generes`);
      } else {
        setGenError(errors[0]?.error || 'Echec de la generation');
        toast.error('Echec de la generation. Verifiez la cle API OpenAI.');
      }
    } catch (err) {
      setGenError(err.message);
      toast.error('Erreur: ' + err.message);
    } finally {
      setGenerating(false);
    }
  };

  // ─── Get image src (supports both base64 and URL) ───
  const getImageSrc = (mv) => mv.imageBase64 || mv.url;

  // ─── Export PDF ───
  const exportPDF = async () => {
    if (mockupViews.length === 0) return;
    toast.info('Generation du PDF en cours...');

    try {
      const { default: jsPDF } = await import('jspdf');
      const doc = new jsPDF('p', 'mm', 'a4');
      const pageW = 210;
      const colorLabel = COLORS.find((c) => c.value === selectedColor)?.label || selectedColor;

      // Sort views
      const viewOrder = ['face', 'side', 'perspective'];
      const sorted = [...mockupViews].sort((a, b) => viewOrder.indexOf(a.view) - viewOrder.indexOf(b.view));

      // Helper: load image as base64
      const loadImg = async (mv) => {
        if (mv.imageBase64) return mv.imageBase64;
        if (mv.url) {
          try {
            const resp = await fetch(mv.url);
            const blob = await resp.blob();
            return new Promise((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.readAsDataURL(blob);
            });
          } catch { return null; }
        }
        return null;
      };

      for (let idx = 0; idx < sorted.length; idx++) {
        const mv = sorted[idx];
        if (idx > 0) doc.addPage();

        if (idx === 0) {
          // Page 1: Header bleu + infos + vue face
          doc.setFillColor(25, 118, 210);
          doc.rect(0, 0, pageW, 35, 'F');
          doc.setTextColor(255, 255, 255);
          doc.setFontSize(20);
          doc.setFont('helvetica', 'bold');
          doc.text('Imprimerie OGOOUE', 55, 18);
          doc.setFontSize(11);
          doc.setFont('helvetica', 'normal');
          doc.text('Proposition de Mockup', 55, 27);

          doc.setTextColor(0, 0, 0);
          doc.setFontSize(11);
          doc.text(`Client: ${clientName || 'Non specifie'}`, 15, 50);
          doc.text(`Type: ${productType}`, 15, 58);
          doc.text(`Couleur: ${colorLabel}`, 15, 66);

          doc.setFontSize(14);
          doc.setFont('helvetica', 'bold');
          doc.text(VIEW_LABELS[mv.view] || mv.view, 15, 80);

          const imgData = await loadImg(mv);
          if (imgData) doc.addImage(imgData, 'PNG', 15, 88, 180, 150);
        } else {
          // Pages 2-3
          doc.setFontSize(14);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(0, 0, 0);
          doc.text(VIEW_LABELS[mv.view] || mv.view, 15, 20);

          const imgData = await loadImg(mv);
          if (imgData) doc.addImage(imgData, 'PNG', 15, 28, 180, 150);
        }

        // Footer on last page
        if (idx === sorted.length - 1) {
          doc.setFontSize(8);
          doc.setTextColor(100, 100, 100);
          doc.setFont('helvetica', 'normal');
          doc.text('RCCM : RG/FCV 2023A0407 | NIF : 256598U', 105, 260, { align: 'center' });
          doc.text('Siege social : Carrefour Fina en face de Finam Moanda - Gabon', 105, 266, { align: 'center' });
          doc.text('Tel : 060 44 46 34 / 074 42 41 42 | Email : imprimerieogooue@gmail.com', 105, 272, { align: 'center' });
        }
      }

      doc.save(`mockup_${productType.replace(/\s+/g, '_')}_${Date.now()}.pdf`);
      toast.success('PDF telecharge');
    } catch (err) {
      console.error('PDF export error:', err);
      toast.error('Erreur export PDF');
    }
  };

  // ─── Step component ───
  const Step = ({ number, title, children, done }) => (
    <div className="rounded-xl border p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white ${done ? 'bg-emerald-500' : 'bg-primary'}`}>
          {done ? <CheckCircle2 className="h-4 w-4" /> : number}
        </div>
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {children}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-600 via-purple-600 to-indigo-700 p-6 text-white">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" />
        <div className="absolute -bottom-6 -left-6 h-28 w-28 rounded-full bg-white/10" />
        <div className="relative flex items-center gap-3">
          <Paintbrush className="h-6 w-6" />
          <div>
            <h2 className="text-2xl font-bold">Mockups IA</h2>
            <p className="text-white/70 text-sm">Generez des mockups avec votre logo via gpt-image-1</p>
          </div>
        </div>
      </div>

      {/* 2 columns layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ══════ LEFT COLUMN — Configuration ══════ */}
        <div className="space-y-4">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Palette className="h-5 w-5 text-primary" />
            Configuration
          </h2>

          {/* Step 1: Upload logo */}
          <Step number="1" title="Importer le logo / maquette" done={!!logoFile}>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 cursor-pointer transition-colors ${
                logoPreview ? 'border-emerald-300 bg-emerald-50/50' : 'border-muted-foreground/30 hover:border-primary hover:bg-primary/5'
              }`}
            >
              {logoPreview ? (
                <div className="text-center">
                  <img src={logoPreview} alt="Logo" className="mx-auto h-24 w-24 object-contain rounded-lg mb-2" />
                  <p className="text-xs text-emerald-700 font-medium">{logoFile?.name}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">Cliquez pour changer</p>
                </div>
              ) : (
                <>
                  <Upload className="h-8 w-8 text-muted-foreground/50 mb-2" />
                  <p className="text-sm text-muted-foreground">Glissez votre logo ici</p>
                  <p className="text-[10px] text-muted-foreground">PNG, JPG ou SVG (max 10 Mo)</p>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".png,.jpg,.jpeg,.svg"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
          </Step>

          {/* Step 2: Product type */}
          <Step number="2" title="Type de produit" done={!!productType}>
            <select
              className="w-full rounded-lg border px-3 py-2.5 text-sm bg-background"
              value={productType}
              onChange={(e) => setProductType(e.target.value)}
            >
              <option value="">— Selectionnez un produit —</option>
              {PRODUCT_TYPES.map((cat) => (
                <optgroup key={cat.category} label={cat.category}>
                  {cat.items.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Step>

          {/* Step 3: Color */}
          <Step number="3" title="Couleur du produit" done={!!selectedColor}>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setSelectedColor(c.value)}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-all ${
                    selectedColor === c.value
                      ? 'border-primary bg-primary/5 ring-2 ring-primary/30 font-semibold'
                      : 'border-muted hover:border-primary/50'
                  }`}
                >
                  <span
                    className="h-5 w-5 rounded-full border border-gray-300 shrink-0"
                    style={{ backgroundColor: c.hex }}
                  />
                  {c.label}
                </button>
              ))}
            </div>
          </Step>

          {/* Client name */}
          <div className="rounded-xl border p-4">
            <label className="block text-sm font-medium mb-1.5">Nom du client (pour le PDF)</label>
            <Input
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Ex: Societe ABC Gabon"
            />
          </div>

          {/* Generate button */}
          <Button
            className="w-full h-12 text-base gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700"
            onClick={generateMockups}
            disabled={generating || !productType || !logoFile}
          >
            {generating ? (
              <><Loader2 className="h-5 w-5 animate-spin" /> Generation en cours...</>
            ) : (
              <><Sparkles className="h-5 w-5" /> Generer les Mockups</>
            )}
          </Button>

          {!logoFile && productType && (
            <p className="text-xs text-amber-600 text-center">Uploadez un logo pour activer la generation</p>
          )}
        </div>

        {/* ══════ RIGHT COLUMN — Preview ══════ */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Eye className="h-5 w-5 text-primary" />
              Apercu des Mockups
            </h2>
            {generated && mockupViews.length > 0 && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="gap-1.5" onClick={exportPDF}>
                  <FileText className="h-3.5 w-3.5" /> PDF
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowSendModal(true)}>
                  <Send className="h-3.5 w-3.5" /> Envoyer au client
                </Button>
              </div>
            )}
          </div>

          {/* Empty state */}
          {!generated && !generating && (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <div className="rounded-full bg-muted p-4 mb-4">
                  <Image className="h-10 w-10 text-muted-foreground/40" />
                </div>
                <p className="text-muted-foreground font-medium">Aucun mockup genere</p>
                <p className="text-sm text-muted-foreground/70 mt-1 max-w-xs">
                  Uploadez un logo, choisissez le type de produit et cliquez sur Generer
                </p>
              </CardContent>
            </Card>
          )}

          {/* Loading state */}
          {generating && (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <Loader2 className="h-12 w-12 text-primary animate-spin mb-4" />
                <p className="font-semibold text-primary">Generation des mockups en cours...</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Cela peut prendre quelques secondes (3 vues en parallele)
                </p>
                <div className="flex gap-3 mt-4">
                  {['face', 'side', 'perspective'].map((v) => (
                    <Badge key={v} variant="secondary" className="text-[10px] animate-pulse">
                      {VIEW_LABELS[v]}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Error state */}
          {genError && !generating && (
            <Card className="border-red-200">
              <CardContent className="p-4 text-center">
                <p className="text-sm text-red-600 font-medium">Erreur: {genError}</p>
                <Button size="sm" variant="outline" className="mt-2" onClick={generateMockups}>
                  Reessayer
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Generated views */}
          {generated && mockupViews.length > 0 && (
            <div className="space-y-4">
              {['face', 'side', 'perspective'].map((viewKey) => {
                const mv = mockupViews.find((m) => m.view === viewKey);
                if (!mv) return null;
                const src = getImageSrc(mv);
                return (
                  <Card key={viewKey} className="overflow-hidden">
                    <div className="bg-muted/50 px-4 py-2 border-b flex items-center justify-between">
                      <h3 className="text-sm font-semibold">{VIEW_LABELS[viewKey]}</h3>
                      <a
                        href={src}
                        download={`mockup_${productType}_${viewKey}.png`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline flex items-center gap-1"
                      >
                        <Download className="h-3 w-3" /> Telecharger
                      </a>
                    </div>
                    <CardContent className="p-0">
                      <img
                        src={src}
                        alt={`Mockup ${VIEW_LABELS[viewKey]}`}
                        className="w-full h-auto"
                        loading="lazy"
                      />
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ═══ Send to client modal ═══ */}
      <Dialog open={showSendModal} onOpenChange={setShowSendModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-4 w-4 text-primary" />
              Envoyer le mockup au client
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="rounded-lg bg-blue-50 p-3 text-sm">
              <p><strong>Produit:</strong> {productType}</p>
              <p><strong>Couleur:</strong> {COLORS.find((c) => c.value === selectedColor)?.label}</p>
              <p><strong>Vues generees:</strong> {mockupViews.length}</p>
            </div>
            <p className="text-sm text-muted-foreground">
              Telechargez le PDF et envoyez-le au client via la messagerie ou par email.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowSendModal(false)}>
                Fermer
              </Button>
              <Button className="flex-1 gap-2" onClick={() => { exportPDF(); setShowSendModal(false); }}>
                <Download className="h-4 w-4" /> Telecharger le PDF
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
