import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { db } from '@/services/db';
import { useAuth } from '@/services/auth';
import { logAction } from '@/services/audit';
import { printHTML } from '@/services/export-pdf';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Paintbrush, Plus, Search, Image, Download, Trash2,
  FileText, Eye, Palette, Layers, User, Calendar,
  Sparkles, Loader2, RotateCcw, Save, Send, ArrowLeft, ArrowRight,
  Move, ZoomIn, FlipHorizontal, FlipVertical, Crosshair,
  ImagePlus, Wand2, Upload,
} from 'lucide-react';
import { toast } from 'sonner';

// ─── CONSTANTES ─────────────────────────────────────────────────
const SUPPORTS = [
  { id: 'tshirt', label: 'T-shirt', emoji: '👕' },
  { id: 'polo', label: 'Polo', emoji: '👔' },
  { id: 'mug', label: 'Mug / Tasse', emoji: '☕' },
  { id: 'casquette', label: 'Casquette', emoji: '🧢' },
  { id: 'sac', label: 'Sac / Tote bag', emoji: '🛍️' },
  { id: 'badge', label: 'Carte / Badge', emoji: '🪪' },
  { id: 'flyer', label: 'Flyer / Affiche', emoji: '📋' },
  { id: 'banderole', label: 'Banderole', emoji: '🎀' },
];

const COULEURS = [
  { id: 'blanc', label: 'Blanc', hex: '#ffffff' },
  { id: 'noir', label: 'Noir', hex: '#1a1a1a' },
  { id: 'rouge', label: 'Rouge', hex: '#dc2626' },
  { id: 'bleu', label: 'Bleu', hex: '#2563eb' },
  { id: 'vert', label: 'Vert', hex: '#16a34a' },
  { id: 'jaune', label: 'Jaune', hex: '#eab308' },
  { id: 'gris', label: 'Gris', hex: '#6b7280' },
  { id: 'marine', label: 'Marine', hex: '#1e3a5f' },
];

const ZONES_IMPRIMABLES = {
  tshirt:     { x: 30, y: 22, w: 40, h: 38 },
  polo:       { x: 32, y: 20, w: 36, h: 30 },
  mug:        { x: 15, y: 20, w: 70, h: 50 },
  casquette:  { x: 20, y: 10, w: 60, h: 35 },
  sac:        { x: 20, y: 15, w: 60, h: 55 },
  badge:      { x: 10, y: 10, w: 80, h: 80 },
  flyer:      { x: 5,  y: 5,  w: 90, h: 90 },
  banderole:  { x: 5,  y: 10, w: 90, h: 80 },
};

const STYLES_MARKETING = [
  'Moderne', 'Traditionnel africain', 'Minimaliste', 'Coloré festif', 'Professionnel',
];

const FORMATS_IMAGE = [
  { id: '1024x1024', label: 'Carré (1024×1024)' },
  { id: '1024x1792', label: 'Portrait (1024×1792)' },
  { id: '1792x1024', label: 'Paysage (1792×1024)' },
];

const TYPES_VISUEL = [
  'Affiche', 'Post réseaux sociaux', 'Bannière', 'Carte de visite', 'Flyer',
];

// ─── SVG TEMPLATES ──────────────────────────────────────────────
function getSupportSVG(support, couleurHex, view = 'face') {
  const c = couleurHex || '#ffffff';
  const dark = adjustBrightness(c, -30);
  const light = adjustBrightness(c, 30);

  const templates = {
    tshirt: `<svg viewBox="0 0 400 450" xmlns="http://www.w3.org/2000/svg">
      <path d="M100,10 L160,10 C160,40 180,60 200,60 C220,60 240,40 240,10 L300,10 L370,80 L330,120 L300,100 L300,430 L100,430 L100,100 L70,120 L30,80 Z" fill="${c}" stroke="${dark}" stroke-width="2"/>
      <path d="M160,10 C160,40 180,60 200,60 C220,60 240,40 240,10" fill="none" stroke="${dark}" stroke-width="2"/>
    </svg>`,
    polo: `<svg viewBox="0 0 400 450" xmlns="http://www.w3.org/2000/svg">
      <path d="M110,15 L165,15 C165,40 180,55 200,55 C220,55 235,40 235,15 L290,15 L360,75 L320,115 L290,95 L290,430 L110,430 L110,95 L80,115 L40,75 Z" fill="${c}" stroke="${dark}" stroke-width="2"/>
      <path d="M165,15 L185,15 L200,75 L215,15 L235,15" fill="none" stroke="${dark}" stroke-width="2"/>
      <line x1="200" y1="55" x2="200" y2="130" stroke="${dark}" stroke-width="1.5"/>
      <circle cx="200" cy="80" r="3" fill="${dark}"/>
      <circle cx="200" cy="100" r="3" fill="${dark}"/>
      <circle cx="200" cy="120" r="3" fill="${dark}"/>
    </svg>`,
    mug: `<svg viewBox="0 0 400 350" xmlns="http://www.w3.org/2000/svg">
      <rect x="60" y="50" width="220" height="250" rx="10" fill="${c}" stroke="${dark}" stroke-width="2"/>
      <path d="M280,100 C330,100 350,140 350,175 C350,210 330,250 280,250" fill="none" stroke="${dark}" stroke-width="3"/>
      <ellipse cx="170" cy="50" rx="110" ry="15" fill="${light}" stroke="${dark}" stroke-width="2"/>
    </svg>`,
    casquette: `<svg viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="200" cy="160" rx="160" ry="80" fill="${c}" stroke="${dark}" stroke-width="2"/>
      <path d="M40,160 C40,80 120,20 200,20 C280,20 360,80 360,160" fill="${c}" stroke="${dark}" stroke-width="2"/>
      <path d="M60,170 C30,180 20,200 40,220 C60,240 160,260 200,260" fill="${dark}" stroke="${dark}" stroke-width="2"/>
    </svg>`,
    sac: `<svg viewBox="0 0 400 450" xmlns="http://www.w3.org/2000/svg">
      <rect x="60" y="80" width="280" height="350" rx="5" fill="${c}" stroke="${dark}" stroke-width="2"/>
      <path d="M130,80 C130,30 270,30 270,80" fill="none" stroke="${dark}" stroke-width="3"/>
    </svg>`,
    badge: `<svg viewBox="0 0 400 250" xmlns="http://www.w3.org/2000/svg">
      <rect x="20" y="15" width="360" height="220" rx="12" fill="${c}" stroke="${dark}" stroke-width="2"/>
      <rect x="30" y="25" width="340" height="200" rx="8" fill="none" stroke="${dark}" stroke-width="1" stroke-dasharray="4,3"/>
    </svg>`,
    flyer: `<svg viewBox="0 0 400 560" xmlns="http://www.w3.org/2000/svg">
      <rect x="10" y="10" width="380" height="540" rx="4" fill="${c}" stroke="${dark}" stroke-width="2"/>
      <rect x="20" y="20" width="360" height="520" rx="2" fill="none" stroke="${dark}" stroke-width="0.5" stroke-dasharray="5,3"/>
    </svg>`,
    banderole: `<svg viewBox="0 0 600 200" xmlns="http://www.w3.org/2000/svg">
      <rect x="10" y="10" width="580" height="180" rx="4" fill="${c}" stroke="${dark}" stroke-width="2"/>
      <circle cx="25" cy="25" r="5" fill="${dark}" opacity="0.3"/>
      <circle cx="575" cy="25" r="5" fill="${dark}" opacity="0.3"/>
      <circle cx="25" cy="175" r="5" fill="${dark}" opacity="0.3"/>
      <circle cx="575" cy="175" r="5" fill="${dark}" opacity="0.3"/>
    </svg>`,
  };

  return templates[support] || templates.tshirt;
}

function adjustBrightness(hex, amount) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.max(0, ((num >> 16) & 0xff) + amount));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amount));
  const b = Math.min(255, Math.max(0, (num & 0xff) + amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

// ─── PDF EXPORT 3 VUES (style polo référence) ──────────────────
function exportMockupPDF3Views(previewImages, clientNom, support, couleur) {
  const supportLabel = SUPPORTS.find((s) => s.id === support)?.label || support;
  const couleurLabel = COULEURS.find((c) => c.id === couleur)?.label || couleur;
  const date = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  const views = ['Vue de face', 'Vue de côté', 'Vue perspective'];

  let pages = '';
  previewImages.forEach((imgSrc, i) => {
    pages += `
      ${i > 0 ? '<div style="page-break-before:always;"></div>' : ''}
      <div style="padding:20px;">
        <div style="background:#1e40af;color:white;padding:16px 24px;border-radius:8px;display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
          <div style="font-size:20px;font-weight:bold;">IMPRIMERIE OGOOUE</div>
          <div style="font-size:14px;">Proposition de Mockup</div>
        </div>
        ${i === 0 ? `
          <div style="display:flex;gap:16px;margin-bottom:20px;font-size:13px;">
            <div style="flex:1;background:#f1f5f9;padding:10px;border-radius:6px;"><strong>Client:</strong> ${clientNom || '—'}</div>
            <div style="flex:1;background:#f1f5f9;padding:10px;border-radius:6px;"><strong>Type:</strong> ${supportLabel}</div>
            <div style="flex:1;background:#f1f5f9;padding:10px;border-radius:6px;"><strong>Couleur:</strong> ${couleurLabel}</div>
            <div style="flex:1;background:#f1f5f9;padding:10px;border-radius:6px;"><strong>Date:</strong> ${date}</div>
          </div>
        ` : ''}
        <h3 style="font-size:16px;margin:16px 0 12px;color:#1e40af;">${views[i]}</h3>
        <div style="text-align:center;border:1px solid #e2e8f0;border-radius:8px;padding:20px;background:#fafafa;">
          <img src="${imgSrc}" style="max-width:100%;max-height:500px;object-fit:contain;" alt="${views[i]}" />
        </div>
        ${i === 2 ? `
          <div style="margin-top:40px;padding-top:16px;border-top:2px solid #1e40af;font-size:10px;color:#6b7280;text-align:center;line-height:1.8;">
            <div>RCCM : RG/FCV 2023A0407 | NIF : 256598U</div>
            <div>Siege social : Carrefour Fina en face de Finam Moanda - Gabon</div>
            <div>Tel : 060 44 46 34 / 074 42 41 42 | Email : imprimerieogooue@gmail.com</div>
          </div>
        ` : ''}
      </div>
    `;
  });

  printHTML(`Mockup ${supportLabel} — ${clientNom || 'Client'}`, pages);
}

// ══════════════════════════════════════════════════════════════════
// MODE 1 — MOCKUP CLIENT PRÉCIS (Canvas composite)
// ══════════════════════════════════════════════════════════════════
function MockupClientPrecis({ clients }) {
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [support, setSupport] = useState('');
  const [couleur, setCouleur] = useState('blanc');
  const [designFile, setDesignFile] = useState(null);
  const [designDataURL, setDesignDataURL] = useState('');
  const [position, setPosition] = useState({ x: 50, y: 50, scale: 100, rotation: 0 });
  const [clientId, setClientId] = useState('');
  const [clientNom, setClientNom] = useState('');
  const [previewImages, setPreviewImages] = useState([]);
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);

  const couleurHex = COULEURS.find((c) => c.id === couleur)?.hex || '#ffffff';
  const zone = ZONES_IMPRIMABLES[support] || ZONES_IMPRIMABLES.tshirt;

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast.error('Image trop lourde (max 10 Mo)'); return; }
    setDesignFile(file);
    const reader = new FileReader();
    reader.onload = () => setDesignDataURL(reader.result);
    reader.readAsDataURL(file);
    setStep(4);
  };

  // Rendu composite sur canvas
  const renderComposite = useCallback((view = 'face') => {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      canvas.width = 600;
      canvas.height = 700;
      const ctx = canvas.getContext('2d');

      // Background blanc
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, 600, 700);

      // SVG support
      const svgStr = getSupportSVG(support, couleurHex, view);
      const svgBlob = new Blob([svgStr], { type: 'image/svg+xml' });
      const svgUrl = URL.createObjectURL(svgBlob);
      const svgImg = new window.Image();
      svgImg.onload = () => {
        // Centre le SVG template
        const svgW = 500;
        const svgH = 580;
        const svgX = (600 - svgW) / 2;
        const svgY = (700 - svgH) / 2;
        ctx.drawImage(svgImg, svgX, svgY, svgW, svgH);
        URL.revokeObjectURL(svgUrl);

        // Design overlay
        if (designDataURL) {
          const designImg = new window.Image();
          designImg.onload = () => {
            ctx.save();
            const zoneX = svgX + (zone.x / 100) * svgW;
            const zoneY = svgY + (zone.y / 100) * svgH;
            const zoneW = (zone.w / 100) * svgW;
            const zoneH = (zone.h / 100) * svgH;

            const offsetX = zoneX + (position.x / 100) * zoneW;
            const offsetY = zoneY + (position.y / 100) * zoneH;
            const scale = position.scale / 100;
            const drawW = zoneW * scale;
            const drawH = (designImg.height / designImg.width) * drawW;

            // Rotation et position
            ctx.translate(offsetX, offsetY);
            ctx.rotate((position.rotation * Math.PI) / 180);

            // Vue perspective : léger skew
            if (view === 'cote') {
              ctx.transform(0.85, 0.1, 0, 1, 0, 0);
            } else if (view === 'perspective') {
              ctx.transform(0.9, 0.05, -0.05, 0.95, 0, 0);
            }

            ctx.drawImage(designImg, -drawW / 2, -drawH / 2, drawW, drawH);
            ctx.restore();
            resolve(canvas.toDataURL('image/png'));
          };
          designImg.src = designDataURL;
        } else {
          resolve(canvas.toDataURL('image/png'));
        }
      };
      svgImg.src = svgUrl;
    });
  }, [support, couleurHex, designDataURL, position, zone]);

  const handleGenerate3Views = async () => {
    toast.info('Génération des 3 vues...');
    try {
      const [face, cote, perspective] = await Promise.all([
        renderComposite('face'),
        renderComposite('cote'),
        renderComposite('perspective'),
      ]);
      setPreviewImages([face, cote, perspective]);
      setStep(5);
      toast.success('3 vues générées !');
    } catch {
      toast.error('Erreur lors de la génération');
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await db.mockups.create({
        type: 'client_precis',
        support,
        couleur,
        client_id: clientId || null,
        client_nom: clientNom || '',
        image_base64: previewImages[0] || '',
        url_preview: previewImages[0] || '',
        nom: `Mockup ${SUPPORTS.find((s) => s.id === support)?.label || support} — ${clientNom || 'Sans client'}`,
        statut: 'brouillon',
        createur_id: user?.id,
        createur_nom: `${user?.prenom || ''} ${user?.nom || ''}`.trim(),
      });
      await logAction('create', 'mockup', { entityLabel: `Mockup ${support}` });
      toast.success('Mockup sauvegardé !');
    } catch {
      toast.error('Erreur de sauvegarde');
    }
    setSaving(false);
  };

  const handleExportPDF = () => {
    if (previewImages.length < 3) { toast.error('Générez d\'abord les 3 vues'); return; }
    exportMockupPDF3Views(previewImages, clientNom, support, couleur);
  };

  const handleDownloadPNG = () => {
    if (!previewImages[0]) return;
    const a = document.createElement('a');
    a.href = previewImages[0];
    a.download = `mockup_${support}_${Date.now()}.png`;
    a.click();
  };

  return (
    <div className="space-y-6">
      {/* Steps indicator */}
      <div className="flex items-center gap-2 text-sm">
        {[
          { n: 1, label: 'Support' },
          { n: 2, label: 'Couleur' },
          { n: 3, label: 'Design' },
          { n: 4, label: 'Position' },
          { n: 5, label: 'Aperçu' },
        ].map(({ n, label }) => (
          <button
            key={n}
            onClick={() => { if (n <= step) setStep(n); }}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
              step === n ? 'bg-primary text-white' : step > n ? 'bg-primary/20 text-primary cursor-pointer' : 'bg-muted text-muted-foreground'
            }`}
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/20 text-[10px] font-bold">
              {step > n ? '✓' : n}
            </span>
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {/* ÉTAPE 1 — Support */}
      {step === 1 && (
        <div>
          <h3 className="text-lg font-semibold mb-4">Choisissez le support</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {SUPPORTS.map((s) => (
              <button
                key={s.id}
                onClick={() => { setSupport(s.id); setStep(2); }}
                className={`flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all hover:shadow-md ${
                  support === s.id ? 'border-primary bg-primary/5' : 'border-transparent bg-card hover:border-primary/30'
                }`}
              >
                <span className="text-3xl">{s.emoji}</span>
                <span className="text-sm font-medium">{s.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ÉTAPE 2 — Couleur */}
      {step === 2 && (
        <div>
          <h3 className="text-lg font-semibold mb-4">Couleur du support</h3>
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-3 mb-6">
            {COULEURS.map((c) => (
              <button
                key={c.id}
                onClick={() => setCouleur(c.id)}
                className={`flex flex-col items-center gap-1.5 rounded-lg p-3 transition-all ${
                  couleur === c.id ? 'ring-2 ring-primary ring-offset-2' : 'hover:ring-1 hover:ring-primary/30'
                }`}
              >
                <div className="h-10 w-10 rounded-full border-2 shadow-sm" style={{ backgroundColor: c.hex, borderColor: c.hex === '#ffffff' ? '#e2e8f0' : c.hex }} />
                <span className="text-[10px] font-medium">{c.label}</span>
              </button>
            ))}
          </div>
          {/* Aperçu support avec couleur */}
          <Card className="max-w-xs mx-auto">
            <CardContent className="p-4">
              <div
                className="rounded-lg overflow-hidden"
                dangerouslySetInnerHTML={{ __html: getSupportSVG(support, couleurHex) }}
              />
            </CardContent>
          </Card>
          <div className="flex justify-between mt-4">
            <Button variant="outline" onClick={() => setStep(1)}><ArrowLeft className="h-4 w-4 mr-1" /> Retour</Button>
            <Button onClick={() => setStep(3)}>Suivant <ArrowRight className="h-4 w-4 ml-1" /></Button>
          </div>
        </div>
      )}

      {/* ÉTAPE 3 — Upload design */}
      {step === 3 && (
        <div>
          <h3 className="text-lg font-semibold mb-4">Uploadez le design client</h3>
          <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/jpg,image/webp" className="hidden" onChange={handleFileUpload} />
          {designDataURL ? (
            <div className="max-w-sm mx-auto space-y-3">
              <div className="rounded-lg border overflow-hidden bg-muted/30 p-4">
                <img src={designDataURL} alt="Design" className="max-h-[200px] mx-auto object-contain" />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => { setDesignDataURL(''); setDesignFile(null); fileInputRef.current.value = ''; }}>
                  <Trash2 className="h-4 w-4 mr-1" /> Changer
                </Button>
                <Button className="flex-1" onClick={() => setStep(4)}>Continuer <ArrowRight className="h-4 w-4 ml-1" /></Button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="mx-auto block w-full max-w-sm rounded-xl border-2 border-dashed border-primary/30 p-10 text-center hover:bg-primary/5 transition-colors"
            >
              <Upload className="h-12 w-12 mx-auto text-primary/40 mb-3" />
              <p className="font-medium text-sm">Glissez ou cliquez pour uploader</p>
              <p className="text-[11px] text-muted-foreground mt-1">PNG transparent recommandé — Max 10 Mo</p>
            </button>
          )}
          <div className="flex justify-between mt-4">
            <Button variant="outline" onClick={() => setStep(2)}><ArrowLeft className="h-4 w-4 mr-1" /> Retour</Button>
            <Button variant="ghost" onClick={() => setStep(4)} className="text-muted-foreground">Passer sans design →</Button>
          </div>
        </div>
      )}

      {/* ÉTAPE 4 — Position + paramètres */}
      {step === 4 && (
        <div>
          <h3 className="text-lg font-semibold mb-4">Ajustez la position</h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Canvas preview */}
            <Card>
              <CardContent className="p-4">
                <div className="rounded-lg overflow-hidden border bg-muted/20 relative" style={{ minHeight: 350 }}>
                  <div dangerouslySetInnerHTML={{ __html: getSupportSVG(support, couleurHex) }} />
                  {designDataURL && (
                    <div
                      className="absolute"
                      style={{
                        left: `${ZONES_IMPRIMABLES[support]?.x || 30}%`,
                        top: `${ZONES_IMPRIMABLES[support]?.y || 20}%`,
                        width: `${ZONES_IMPRIMABLES[support]?.w || 40}%`,
                        height: `${ZONES_IMPRIMABLES[support]?.h || 40}%`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        pointerEvents: 'none',
                      }}
                    >
                      <img
                        src={designDataURL}
                        alt="Design"
                        style={{
                          maxWidth: `${position.scale}%`,
                          maxHeight: '100%',
                          objectFit: 'contain',
                          transform: `translate(${(position.x - 50) * 0.5}%, ${(position.y - 50) * 0.5}%) rotate(${position.rotation}deg)`,
                        }}
                      />
                    </div>
                  )}
                  {/* Zone imprimable guide */}
                  <div
                    className="absolute border-2 border-dashed border-primary/30 rounded pointer-events-none"
                    style={{
                      left: `${zone.x}%`, top: `${zone.y}%`,
                      width: `${zone.w}%`, height: `${zone.h}%`,
                    }}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Contrôles */}
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium flex items-center gap-1 mb-2"><Move className="h-3.5 w-3.5" /> Position X</label>
                <input type="range" min="0" max="100" value={position.x} onChange={(e) => setPosition({ ...position, x: +e.target.value })} className="w-full accent-primary" />
              </div>
              <div>
                <label className="text-sm font-medium flex items-center gap-1 mb-2"><Move className="h-3.5 w-3.5" /> Position Y</label>
                <input type="range" min="0" max="100" value={position.y} onChange={(e) => setPosition({ ...position, y: +e.target.value })} className="w-full accent-primary" />
              </div>
              <div>
                <label className="text-sm font-medium flex items-center gap-1 mb-2"><ZoomIn className="h-3.5 w-3.5" /> Taille ({position.scale}%)</label>
                <input type="range" min="20" max="200" value={position.scale} onChange={(e) => setPosition({ ...position, scale: +e.target.value })} className="w-full accent-primary" />
              </div>
              <div>
                <label className="text-sm font-medium flex items-center gap-1 mb-2"><RotateCcw className="h-3.5 w-3.5" /> Rotation ({position.rotation}°)</label>
                <input type="range" min="-180" max="180" value={position.rotation} onChange={(e) => setPosition({ ...position, rotation: +e.target.value })} className="w-full accent-primary" />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setPosition({ x: 50, y: 50, scale: 100, rotation: 0 })}>
                  <Crosshair className="h-3.5 w-3.5 mr-1" /> Centrer
                </Button>
              </div>

              {/* Client */}
              <div>
                <label className="text-sm font-medium mb-1.5 block">Client associé</label>
                <Select value={clientId || '__none__'} onValueChange={(v) => {
                  const cId = v === '__none__' ? '' : v;
                  const cl = clients.find((c) => c.id === cId);
                  setClientId(cId);
                  setClientNom(cl?.nom || '');
                }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Aucun client —</SelectItem>
                    {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.nom}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <Button className="w-full gap-2" onClick={handleGenerate3Views}>
                <Sparkles className="h-4 w-4" /> Générer les 3 vues
              </Button>
            </div>
          </div>
          <div className="flex justify-between mt-4">
            <Button variant="outline" onClick={() => setStep(3)}><ArrowLeft className="h-4 w-4 mr-1" /> Retour</Button>
          </div>
        </div>
      )}

      {/* ÉTAPE 5 — Aperçu 3 vues */}
      {step === 5 && previewImages.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-4">Aperçu des 3 vues</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            {['Vue de face', 'Vue de côté', 'Vue perspective'].map((label, i) => (
              <Card key={i}>
                <CardContent className="p-3">
                  <p className="text-xs font-medium text-center mb-2 text-primary">{label}</p>
                  <div className="rounded-lg overflow-hidden border bg-muted/20">
                    <img src={previewImages[i]} alt={label} className="w-full object-contain" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <Button className="gap-2" onClick={handleExportPDF}>
              <FileText className="h-4 w-4" /> Télécharger PDF (3 vues)
            </Button>
            <Button variant="outline" className="gap-2" onClick={handleDownloadPNG}>
              <Download className="h-4 w-4" /> Télécharger PNG
            </Button>
            <Button variant="outline" className="gap-2" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Sauvegarder
            </Button>
            <Button variant="outline" className="gap-2" onClick={() => setStep(4)}>
              <RotateCcw className="h-4 w-4" /> Modifier
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// MODE 2 — VISUEL MARKETING IA (DALL-E 3)
// ══════════════════════════════════════════════════════════════════
function VisuelMarketingIA() {
  const { user } = useAuth();
  const [prompt, setPrompt] = useState('');
  const [typeVisuel, setTypeVisuel] = useState('Affiche');
  const [style, setStyle] = useState('Moderne');
  const [format, setFormat] = useState('1024x1024');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const all = await (db.mockups?.list?.() || Promise.resolve([]));
        setHistory(all.filter((m) => m.type === 'marketing_ia').sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')));
      } catch { /* silent */ }
    })();
  }, []);

  const handleGenerate = async () => {
    if (!prompt.trim()) { toast.error('Décrivez votre visuel marketing'); return; }

    setGenerating(true);
    setResult(null);

    const fullPrompt = `${prompt}. Type: ${typeVisuel}. Style: ${style}. Pour une imprimerie au Gabon, Afrique.`;

    try {
      const response = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: fullPrompt, size: format, quality: 'standard' }),
      });

      const data = await response.json();

      if (data.error) {
        toast.error(data.error);
        setGenerating(false);
        return;
      }

      setResult({ url: data.url, revised_prompt: data.revised_prompt, prompt: fullPrompt });
      toast.success('Visuel généré avec succès !');
    } catch (err) {
      toast.error('Erreur de génération : ' + (err.message || 'Service indisponible'));
    }
    setGenerating(false);
  };

  const handleSaveVisuel = async () => {
    if (!result) return;
    try {
      await db.mockups.create({
        type: 'marketing_ia',
        nom: `Visuel IA — ${typeVisuel}`,
        support: typeVisuel.toLowerCase(),
        prompt_utilise: result.prompt,
        url_preview: result.url,
        image_base64: '',
        statut: 'valide',
        createur_id: user?.id,
        createur_nom: `${user?.prenom || ''} ${user?.nom || ''}`.trim(),
      });
      await logAction('create', 'mockup', { entityLabel: `Visuel IA ${typeVisuel}` });
      toast.success('Visuel sauvegardé dans la galerie !');
      // Rafraîchir l'historique
      const all = await (db.mockups?.list?.() || Promise.resolve([]));
      setHistory(all.filter((m) => m.type === 'marketing_ia').sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')));
    } catch {
      toast.error('Erreur de sauvegarde');
    }
  };

  const handleDownload = () => {
    if (!result?.url) return;
    const a = document.createElement('a');
    a.href = result.url;
    a.download = `visuel_ia_${Date.now()}.png`;
    a.target = '_blank';
    a.click();
  };

  return (
    <div className="space-y-6">
      {/* Formulaire de génération */}
      <Card>
        <CardContent className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">Décrivez votre visuel marketing</label>
            <textarea
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-primary/20"
              placeholder="Ex: Affiche promotionnelle pour impression de t-shirts personnalisés, style africain moderne, couleurs chaudes, texte 'PROMO -30%'"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">Type de visuel</label>
              <Select value={typeVisuel} onValueChange={setTypeVisuel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPES_VISUEL.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Style / Ambiance</label>
              <Select value={style} onValueChange={setStyle}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STYLES_MARKETING.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Format</label>
              <Select value={format} onValueChange={setFormat}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FORMATS_IMAGE.map((f) => <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            className="w-full gap-2 bg-violet-600 hover:bg-violet-700 text-white"
            onClick={handleGenerate}
            disabled={generating}
          >
            {generating ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> L'IA crée votre visuel...</>
            ) : (
              <><Sparkles className="h-4 w-4" /> Générer le visuel IA</>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Résultat */}
      {result && (
        <Card className="border-violet-200">
          <CardContent className="p-6 space-y-4">
            <div className="rounded-lg overflow-hidden border bg-muted/20">
              <img src={result.url} alt="Visuel IA" className="w-full object-contain max-h-[500px]" />
            </div>
            {result.revised_prompt && (
              <p className="text-xs text-muted-foreground italic">
                Ce que DALL-E a compris : {result.revised_prompt}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="gap-2" onClick={handleDownload}>
                <Download className="h-4 w-4" /> Télécharger PNG
              </Button>
              <Button variant="outline" className="gap-2" onClick={handleGenerate}>
                <RotateCcw className="h-4 w-4" /> Régénérer
              </Button>
              <Button variant="outline" className="gap-2" onClick={handleSaveVisuel}>
                <Save className="h-4 w-4" /> Sauvegarder
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Historique */}
      {history.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Calendar className="h-4 w-4" /> Historique des visuels générés ({history.length})
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {history.map((m) => (
              <Card key={m.id} className="cursor-pointer hover:shadow-md transition-shadow overflow-hidden">
                <div className="h-32 bg-muted/30 flex items-center justify-center">
                  {m.url_preview ? (
                    <img src={m.url_preview} alt={m.nom} className="h-full w-full object-cover" />
                  ) : (
                    <Sparkles className="h-8 w-8 text-violet-300" />
                  )}
                </div>
                <CardContent className="p-2">
                  <p className="text-[11px] font-medium truncate">{m.nom}</p>
                  <p className="text-[9px] text-muted-foreground">{m.created_at ? new Date(m.created_at).toLocaleDateString('fr-FR') : ''}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// COMPOSANT PRINCIPAL — MOCKUPS IA
// ══════════════════════════════════════════════════════════════════
export default function MockupIA() {
  const { user, hasPermission } = useAuth();
  const canWrite = hasPermission('catalogue', 'write');
  const [mode, setMode] = useState('client');
  const [mockups, setMockups] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterSupport, setFilterSupport] = useState('all');
  const [showDetail, setShowDetail] = useState(null);

  const load = async () => {
    const [m, c] = await Promise.all([
      db.mockups?.list?.() || Promise.resolve([]),
      db.clients.list(),
    ]);
    setMockups(m.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')));
    setClients(c);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filteredGalerie = useMemo(() => {
    return mockups.filter((m) => {
      if (filterSupport !== 'all' && m.support !== filterSupport && m.type !== filterSupport) return false;
      if (search) {
        const q = search.toLowerCase();
        return `${m.nom || ''} ${m.client_nom || ''} ${m.support || ''} ${m.type || ''}`.toLowerCase().includes(q);
      }
      return true;
    });
  }, [mockups, search, filterSupport]);

  const handleDelete = async (id) => {
    if (!confirm('Supprimer ce mockup ?')) return;
    await db.mockups.delete(id);
    await logAction('delete', 'mockup', { entityId: id });
    toast.success('Mockup supprimé');
    setShowDetail(null);
    load();
  };

  const exportMockupPDFSingle = (m) => {
    const html = `
      <h2>Mockup — ${m.nom}</h2>
      <div class="kpi-row">
        <div class="kpi-box"><div class="label">Type</div><div class="value" style="font-size:12px;">${m.type === 'marketing_ia' ? 'Marketing IA' : 'Client Précis'}</div></div>
        <div class="kpi-box"><div class="label">Support</div><div class="value" style="font-size:12px;">${m.support || '—'}</div></div>
        <div class="kpi-box"><div class="label">Client</div><div class="value" style="font-size:12px;">${m.client_nom || '—'}</div></div>
        <div class="kpi-box"><div class="label">Date</div><div class="value" style="font-size:12px;">${m.created_at ? new Date(m.created_at).toLocaleDateString('fr-FR') : '—'}</div></div>
      </div>
      ${m.image_base64 || m.url_preview ? `<div class="section"><h3>Aperçu</h3><div style="text-align:center;"><img src="${m.image_base64 || m.url_preview}" style="max-width:500px;max-height:500px;border:1px solid #e5e7eb;border-radius:8px;" alt="Mockup"/></div></div>` : ''}
      ${m.prompt_utilise ? `<div class="section"><h3>Prompt utilisé</h3><p style="font-size:11px;color:#6b7280;">${m.prompt_utilise}</p></div>` : ''}
    `;
    printHTML(`Mockup — ${m.nom}`, html);
  };

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Paintbrush className="h-6 w-6 text-primary" /> Mockups IA
          </h2>
          <p className="text-muted-foreground">Créez des maquettes clients ou des visuels marketing IA</p>
        </div>
      </div>

      {/* Mode switcher */}
      <div className="flex gap-2 border-b pb-1">
        {[
          { id: 'client', label: 'Mockup Client Précis', emoji: '🎨', desc: 'Fabric.js' },
          { id: 'marketing', label: 'Visuel Marketing IA', emoji: '✨', desc: 'DALL-E 3' },
          { id: 'galerie', label: 'Galerie', emoji: '🖼️', desc: `${mockups.length} mockups` },
        ].map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={`flex items-center gap-2 rounded-t-lg px-4 py-2.5 text-sm font-medium transition-all ${
              mode === m.id
                ? 'bg-primary text-white shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
          >
            <span>{m.emoji}</span>
            <span className="hidden sm:inline">{m.label}</span>
            <span className="sm:hidden">{m.emoji}</span>
          </button>
        ))}
      </div>

      {/* MODE CLIENT */}
      {mode === 'client' && <MockupClientPrecis clients={clients} />}

      {/* MODE MARKETING IA */}
      {mode === 'marketing' && <VisuelMarketingIA />}

      {/* GALERIE */}
      {mode === 'galerie' && (
        <div className="space-y-4">
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: 'Total mockups', value: mockups.length, icon: Layers, color: 'bg-primary/10 text-primary' },
              { label: 'Mockups clients', value: mockups.filter((m) => m.type === 'client_precis').length, icon: Paintbrush, color: 'bg-amber-500/10 text-amber-600' },
              { label: 'Visuels IA', value: mockups.filter((m) => m.type === 'marketing_ia').length, icon: Sparkles, color: 'bg-violet-500/10 text-violet-600' },
              { label: 'Supports', value: [...new Set(mockups.map((m) => m.support))].length, icon: Palette, color: 'bg-emerald-500/10 text-emerald-600' },
            ].map(({ label, value, icon: Icon, color }) => (
              <Card key={label}><CardContent className="p-3"><div className="flex items-center gap-2">
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}><Icon className="h-4 w-4" /></div>
                <div><p className="text-[10px] text-muted-foreground">{label}</p><p className="text-base font-bold">{value}</p></div>
              </div></CardContent></Card>
            ))}
          </div>

          {/* Filtres */}
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Rechercher..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
            </div>
            <Select value={filterSupport} onValueChange={setFilterSupport}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous</SelectItem>
                <SelectItem value="client_precis">Mockups clients</SelectItem>
                <SelectItem value="marketing_ia">Visuels IA</SelectItem>
                {SUPPORTS.map((s) => <SelectItem key={s.id} value={s.id}>{s.emoji} {s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Grille */}
          {filteredGalerie.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Paintbrush className="mb-4 h-12 w-12 text-muted-foreground/30" />
              <p className="text-muted-foreground">Aucun mockup trouvé</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredGalerie.map((m) => (
                <Card key={m.id} className="cursor-pointer hover:shadow-md transition-shadow overflow-hidden" onClick={() => setShowDetail(m)}>
                  <div className="h-40 flex items-center justify-center border-b bg-muted/20">
                    {m.image_base64 || m.url_preview ? (
                      <img src={m.image_base64 || m.url_preview} alt={m.nom} className="h-full w-full object-contain p-2" />
                    ) : (
                      <Paintbrush className="h-8 w-8 text-muted-foreground/30" />
                    )}
                  </div>
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm truncate">{m.nom}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge className={`text-[10px] ${m.type === 'marketing_ia' ? 'bg-violet-100 text-violet-700' : 'bg-amber-100 text-amber-700'}`}>
                            {m.type === 'marketing_ia' ? '✨ IA' : '🎨 Client'}
                          </Badge>
                          {m.support && <Badge variant="outline" className="text-[10px]">{m.support}</Badge>}
                        </div>
                      </div>
                    </div>
                    {m.client_nom && <p className="text-[10px] text-muted-foreground mt-1"><User className="inline h-3 w-3" /> {m.client_nom}</p>}
                    {m.created_at && <p className="text-[9px] text-muted-foreground mt-0.5">{new Date(m.created_at).toLocaleDateString('fr-FR')}</p>}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Dialog détail */}
      {showDetail && (
        <Dialog open={!!showDetail} onOpenChange={() => setShowDetail(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>{showDetail.nom}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              {(showDetail.image_base64 || showDetail.url_preview) && (
                <div className="rounded-lg border overflow-hidden bg-muted/20">
                  <img src={showDetail.image_base64 || showDetail.url_preview} alt={showDetail.nom} className="w-full max-h-[300px] object-contain p-4" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs text-muted-foreground">Type</p><Badge className={`text-[10px] ${showDetail.type === 'marketing_ia' ? 'bg-violet-100 text-violet-700' : 'bg-amber-100 text-amber-700'}`}>{showDetail.type === 'marketing_ia' ? 'Visuel Marketing IA' : 'Mockup Client'}</Badge></div>
                <div><p className="text-xs text-muted-foreground">Support</p><p className="font-medium">{showDetail.support || '—'}</p></div>
                <div><p className="text-xs text-muted-foreground">Client</p><p className="font-medium">{showDetail.client_nom || '—'}</p></div>
                <div><p className="text-xs text-muted-foreground">Date</p><p className="font-medium">{showDetail.created_at ? new Date(showDetail.created_at).toLocaleDateString('fr-FR') : '—'}</p></div>
              </div>
              {showDetail.prompt_utilise && (
                <div><p className="text-xs text-muted-foreground">Prompt</p><p className="text-xs bg-muted/50 rounded-lg p-2">{showDetail.prompt_utilise}</p></div>
              )}
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 gap-2" onClick={() => exportMockupPDFSingle(showDetail)}>
                  <Download className="h-4 w-4" /> Export PDF
                </Button>
                {canWrite && (
                  <Button variant="destructive" size="icon" onClick={() => handleDelete(showDetail.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
