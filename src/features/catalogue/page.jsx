import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { db } from '@/services/db';
import { useAuth } from '@/services/auth';
import { logAction } from '@/services/audit';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  BookOpen, Search, Plus, Edit2, Trash2, Tag, DollarSign,
  Package, Clock, LayoutGrid, List, ChevronLeft, ChevronRight,
  X, ZoomIn, Upload, Eye, ImageIcon, Shirt, Coffee,
  Sparkles, FileDown, ImagePlus, Brain, Loader2, ChevronDown,
} from 'lucide-react';
import { toast } from 'sonner';
import { AIButton } from '@/components/ui/ai-button';
import { askAI, AI_PROMPTS } from '@/services/ai';

/* ─── Helpers ─── */
function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)); }

function prixRange(prix) {
  if (!prix || prix.length === 0) return '—';
  const vals = prix.map((p) => p.prix).filter((v) => v > 0);
  if (vals.length === 0) return 'Sur devis';
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  return min === max ? `${fmt(min)} F` : `${fmt(min)} — ${fmt(max)} F`;
}

function prixPourQte(prix, qte) {
  if (!prix || prix.length === 0) return 0;
  const sorted = [...prix].sort((a, b) => a.qte_min - b.qte_min);
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (qte >= sorted[i].qte_min) return sorted[i].prix;
  }
  return sorted[0]?.prix || 0;
}

/* ─── Constants ─── */
const CATEGORIES = [
  'Textile', 'Accessoire', 'Papeterie', 'Impression',
  'Marketing', 'Signalétique', 'Autre',
];

const CAT_GRADIENT = {
  Textile: 'from-blue-500 to-blue-600',
  Accessoire: 'from-pink-500 to-rose-600',
  Papeterie: 'from-amber-500 to-orange-500',
  Impression: 'from-violet-500 to-purple-600',
  Marketing: 'from-fuchsia-500 to-fuchsia-600',
  Signalétique: 'from-red-500 to-red-600',
  Autre: 'from-slate-400 to-slate-600',
};
const CAT_ICON = {
  Textile: Shirt, Accessoire: Coffee, Papeterie: BookOpen,
  Impression: DollarSign, Marketing: Tag, Signalétique: LayoutGrid,
  Autre: Package,
};

const UNITES = ['pièce', 'lot', 'page', 'mètre', 'unité'];

const emptyForm = {
  nom: '', sku: '', categorie: 'Textile', description: '',
  images: [], image_principale: 0,
  prix: [{ qte_min: 1, qte_max: null, prix: 0 }],
  unite: 'pièce', delai_jours: '', tags: [],
  actif: true, stock_lie: null,
};

/* ─── Image compression ─── */
function compressImage(file, maxW = 600, quality = 0.7) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ══════════════════════════════════════════════
   Image Carousel (detail view)
   ══════════════════════════════════════════════ */
function ImageCarousel({ images, categorie, onZoom }) {
  const [idx, setIdx] = useState(0);
  const gradient = CAT_GRADIENT[categorie] || 'from-slate-400 to-slate-600';
  const CatIcon = CAT_ICON[categorie] || Package;

  if (!images || images.length === 0) {
    return (
      <div className={`relative h-56 bg-gradient-to-br ${gradient} flex items-center justify-center rounded-lg`}>
        <CatIcon className="h-16 w-16 text-white/30" />
      </div>
    );
  }

  const prev = () => setIdx((i) => (i - 1 + images.length) % images.length);
  const next = () => setIdx((i) => (i + 1) % images.length);

  return (
    <div className="relative h-56 bg-slate-100 rounded-lg overflow-hidden group">
      <img
        src={images[idx]}
        alt=""
        className="w-full h-full object-contain cursor-zoom-in"
        onClick={() => onZoom?.(images[idx])}
      />
      {images.length > 1 && (
        <>
          <button onClick={prev} className="absolute left-1 top-1/2 -translate-y-1/2 bg-black/40 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button onClick={next} className="absolute right-1 top-1/2 -translate-y-1/2 bg-black/40 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <ChevronRight className="h-4 w-4" />
          </button>
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
            {images.map((_, i) => (
              <button
                key={i}
                onClick={() => setIdx(i)}
                className={`w-2 h-2 rounded-full transition-colors ${i === idx ? 'bg-white' : 'bg-white/40'}`}
              />
            ))}
          </div>
        </>
      )}
      <button
        onClick={() => onZoom?.(images[idx])}
        className="absolute top-2 right-2 bg-black/40 text-white rounded-full p-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <ZoomIn className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/* ══════════════════════════════════════════════
   Image Zoom Overlay
   ══════════════════════════════════════════════ */
function ZoomOverlay({ src, onClose }) {
  if (!src) return null;
  return (
    <div className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4" onClick={onClose}>
      <img src={src} alt="" className="max-w-full max-h-full object-contain rounded-lg" />
      <button onClick={onClose} className="absolute top-4 right-4 text-white/80 hover:text-white">
        <X className="h-8 w-8" />
      </button>
    </div>
  );
}

/* ══════════════════════════════════════════════
   Prix par quantité table
   ══════════════════════════════════════════════ */
function PrixTable({ prix, unite }) {
  if (!prix || prix.length === 0) return null;
  const allZero = prix.every((p) => p.prix === 0);
  if (allZero) return <p className="text-sm text-muted-foreground italic">Prix sur devis</p>;

  return (
    <div className="rounded-lg border overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/50">
            <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Quantité</th>
            <th className="px-3 py-1.5 text-right font-medium text-muted-foreground">Prix / {unite}</th>
          </tr>
        </thead>
        <tbody>
          {prix.map((p, i) => (
            <tr key={i} className="border-t">
              <td className="px-3 py-1.5">
                {p.qte_max ? `${p.qte_min} — ${p.qte_max}` : `${p.qte_min}+`}
              </td>
              <td className="px-3 py-1.5 text-right font-semibold text-primary">
                {p.prix > 0 ? `${fmt(p.prix)} F` : 'Sur devis'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ══════════════════════════════════════════════
   Prix Builder (form)
   ══════════════════════════════════════════════ */
function PrixBuilder({ value, onChange }) {
  const rows = value && value.length > 0 ? value : [{ qte_min: 1, qte_max: null, prix: 0 }];

  const updateRow = (idx, field, val) => {
    const next = rows.map((r, i) => i === idx ? { ...r, [field]: val } : r);
    onChange(next);
  };
  const addRow = () => onChange([...rows, { qte_min: '', qte_max: null, prix: '' }]);
  const removeRow = (idx) => {
    if (rows.length <= 1) return;
    onChange(rows.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-2">
      <label className="mb-1 block text-sm font-medium">Grille tarifaire *</label>
      <div className="space-y-1.5">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              type="number" placeholder="Qté min" className="w-20"
              value={r.qte_min} onChange={(e) => updateRow(i, 'qte_min', e.target.value === '' ? '' : Number(e.target.value))}
            />
            <span className="text-xs text-muted-foreground">à</span>
            <Input
              type="number" placeholder="max (vide=+)" className="w-20"
              value={r.qte_max ?? ''} onChange={(e) => updateRow(i, 'qte_max', e.target.value === '' ? null : Number(e.target.value))}
            />
            <span className="text-xs text-muted-foreground">=</span>
            <Input
              type="number" placeholder="Prix" className="w-24"
              value={r.prix} onChange={(e) => updateRow(i, 'prix', e.target.value === '' ? '' : Number(e.target.value))}
            />
            <span className="text-xs text-muted-foreground shrink-0">F</span>
            {rows.length > 1 && (
              <button type="button" onClick={() => removeRow(i)} className="text-red-400 hover:text-red-600 shrink-0">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={addRow} className="gap-1">
        <Plus className="h-3 w-3" /> Ajouter un palier
      </Button>
    </div>
  );
}

/* ══════════════════════════════════════════════
   Image Uploader (form)
   ══════════════════════════════════════════════ */
function ImageUploader({ images, onChange, maxImages = 5 }) {
  const fileRef = useRef(null);

  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const remaining = maxImages - (images?.length || 0);
    if (remaining <= 0) { toast.error(`Maximum ${maxImages} images`); return; }

    const toProcess = files.slice(0, remaining);
    const compressed = await Promise.all(toProcess.map((f) => compressImage(f)));
    onChange([...(images || []), ...compressed]);
    if (fileRef.current) fileRef.current.value = '';
  };

  const remove = (idx) => {
    onChange((images || []).filter((_, i) => i !== idx));
  };

  const moveUp = (idx) => {
    if (idx === 0) return;
    const next = [...images];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <label className="mb-1 block text-sm font-medium">Images ({(images || []).length}/{maxImages})</label>
      <div className="flex flex-wrap gap-2">
        {(images || []).map((src, i) => (
          <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden border group">
            <img src={src} alt="" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {i > 0 && (
                <button type="button" onClick={() => moveUp(i)} className="text-white bg-black/30 rounded p-0.5">
                  <ChevronLeft className="h-3 w-3" />
                </button>
              )}
              <button type="button" onClick={() => remove(i)} className="text-white bg-red-500/80 rounded p-0.5">
                <X className="h-3 w-3" />
              </button>
            </div>
            {i === 0 && <span className="absolute bottom-0 left-0 right-0 bg-primary text-white text-[8px] text-center py-0.5">Principale</span>}
          </div>
        ))}
        {(images || []).length < maxImages && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-20 h-20 rounded-lg border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center gap-1 text-muted-foreground hover:border-primary hover:text-primary transition-colors"
          >
            <Upload className="h-5 w-5" />
            <span className="text-[9px]">Ajouter</span>
          </button>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFiles} />
    </div>
  );
}

/* ══════════════════════════════════════════════
   Tags Input (form)
   ══════════════════════════════════════════════ */
function TagsInput({ value, onChange }) {
  const [input, setInput] = useState('');
  const tags = value || [];

  const add = () => {
    const t = input.trim().toLowerCase();
    if (t && !tags.includes(t)) { onChange([...tags, t]); }
    setInput('');
  };

  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium">Tags</label>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <Badge key={t} variant="secondary" className="gap-1 text-xs cursor-pointer" onClick={() => onChange(tags.filter((x) => x !== t))}>
            {t} <X className="h-2.5 w-2.5" />
          </Badge>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          placeholder="Ajouter un tag..." value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          className="flex-1 h-8 text-sm"
        />
        <Button type="button" variant="outline" size="sm" onClick={add}>+</Button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   Product Detail Dialog
   ══════════════════════════════════════════════ */
function ProductDetail({ product, open, onClose, canWrite, onEdit, onDelete }) {
  const [zoomSrc, setZoomSrc] = useState(null);
  if (!product) return null;

  const isClient = !canWrite;

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0">
          {/* Carousel */}
          <div className="p-4 pb-0">
            <ImageCarousel images={product.images} categorie={product.categorie} onZoom={setZoomSrc} />
          </div>

          <div className="p-4 pt-3 space-y-4">
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold">{product.nom}</h2>
                  {canWrite && (
                    <AIButton actions={[
                      {
                        label: 'Générer une description',
                        onClick: async () => {
                          const { system, prompt } = AI_PROMPTS.catalogue.description(
                            product.nom, product.categorie, product.prix?.[0]?.prix || ''
                          );
                          return askAI(system, prompt);
                        },
                      },
                      {
                        label: 'Suggérer des tags',
                        onClick: async () => {
                          const { system, prompt } = AI_PROMPTS.catalogue.tags(
                            product.nom, product.categorie
                          );
                          return askAI(system, prompt);
                        },
                      },
                    ]} />
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="outline">{product.categorie}</Badge>
                  {product.sku && <span className="text-xs text-muted-foreground">SKU: {product.sku}</span>}
                  {!product.actif && <Badge variant="destructive" className="text-[10px]">Inactif</Badge>}
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-lg font-black text-primary">{prixRange(product.prix)}</p>
                <p className="text-xs text-muted-foreground">/{product.unite}</p>
              </div>
            </div>

            {/* Description */}
            {product.description && (
              <p className="text-sm text-muted-foreground leading-relaxed">{product.description}</p>
            )}

            {/* Prix table */}
            <PrixTable prix={product.prix} unite={product.unite} />

            {/* Details */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              {product.delai_jours > 0 && (
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span>Délai : {product.delai_jours} jour{product.delai_jours > 1 ? 's' : ''}</span>
                </div>
              )}
              {product.unite && (
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  <span>Unité : {product.unite}</span>
                </div>
              )}
            </div>

            {/* Tags */}
            {product.tags && product.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {product.tags.map((t) => (
                  <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
                ))}
              </div>
            )}

            {/* Actions */}
            {canWrite && (
              <div className="flex gap-2 pt-2 border-t">
                <Button className="flex-1 gap-2" onClick={() => { onClose(); onEdit(product); }}>
                  <Edit2 className="h-4 w-4" /> Modifier
                </Button>
                <Button variant="destructive" size="icon" onClick={() => { onClose(); onDelete(product); }}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <ZoomOverlay src={zoomSrc} onClose={() => setZoomSrc(null)} />
    </>
  );
}

/* ══════════════════════════════════════════════
   Product Form Dialog (Add/Edit)
   ══════════════════════════════════════════════ */
function ProductForm({ open, onClose, editItem, onSave }) {
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    if (editItem) {
      setForm({
        nom: editItem.nom || '',
        sku: editItem.sku || '',
        categorie: editItem.categorie || 'Textile',
        description: editItem.description || '',
        images: editItem.images || [],
        image_principale: editItem.image_principale || 0,
        prix: editItem.prix && editItem.prix.length > 0
          ? editItem.prix
          : [{ qte_min: 1, qte_max: null, prix: 0 }],
        unite: editItem.unite || 'pièce',
        delai_jours: editItem.delai_jours || '',
        tags: editItem.tags || [],
        actif: editItem.actif !== false,
        stock_lie: editItem.stock_lie || null,
      });
    } else {
      setForm(emptyForm);
    }
  }, [editItem, open]);

  const handleSubmit = () => {
    if (!form.nom.trim()) { toast.error('Le nom du produit est requis'); return; }
    if (!form.categorie) { toast.error('La catégorie est requise'); return; }

    // Clean prix rows
    const cleanPrix = (form.prix || [])
      .filter((p) => p.qte_min !== '' && p.prix !== '')
      .map((p) => ({
        qte_min: Number(p.qte_min) || 1,
        qte_max: p.qte_max != null ? Number(p.qte_max) || null : null,
        prix: Number(p.prix) || 0,
      }))
      .sort((a, b) => a.qte_min - b.qte_min);

    if (cleanPrix.length === 0) {
      toast.error('Au moins un palier de prix est requis');
      return;
    }

    const data = {
      nom: form.nom.trim(),
      sku: form.sku.trim() || null,
      categorie: form.categorie,
      description: form.description.trim(),
      images: form.images || [],
      image_principale: form.image_principale || 0,
      prix: cleanPrix,
      unite: form.unite || 'pièce',
      delai_jours: Number(form.delai_jours) || 0,
      tags: form.tags || [],
      actif: form.actif,
      stock_lie: form.stock_lie || null,
    };

    onSave(data, editItem);
  };

  const upd = (field, val) => setForm((f) => ({ ...f, [field]: val }));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editItem ? 'Modifier le produit' : 'Nouveau produit'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Nom */}
          <div>
            <label className="mb-1.5 block text-sm font-medium">Nom du produit *</label>
            <Input value={form.nom} onChange={(e) => upd('nom', e.target.value)} placeholder="Ex: Tee-shirt personnalisé" />
          </div>

          {/* Categorie + SKU */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Catégorie *</label>
              <Select value={form.categorie} onValueChange={(v) => upd('categorie', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">SKU</label>
              <Input value={form.sku} onChange={(e) => upd('sku', e.target.value)} placeholder="TEX-001" />
            </div>
          </div>

          {/* Description */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="block text-sm font-medium">Description</label>
              <AIButton actions={[
                {
                  label: 'Générer une description',
                  onClick: async () => {
                    const { system, prompt } = AI_PROMPTS.catalogue.description(
                      form.nom, form.categorie, form.prix?.[0]?.prix || ''
                    );
                    return askAI(system, prompt);
                  },
                  onResult: (text) => upd('description', text),
                },
                {
                  label: 'Suggérer des tags',
                  onClick: async () => {
                    const { system, prompt } = AI_PROMPTS.catalogue.tags(
                      form.nom, form.categorie
                    );
                    return askAI(system, prompt);
                  },
                  onResult: (text) => {
                    const newTags = text
                      .split(',')
                      .map((t) => t.trim().toLowerCase().replace(/^["']|["']$/g, ''))
                      .filter((t) => t.length > 0);
                    const existing = form.tags || [];
                    const merged = [...new Set([...existing, ...newTags])];
                    upd('tags', merged);
                    toast.success(`${newTags.length} tag(s) ajouté(s)`);
                  },
                },
              ]} />
            </div>
            <textarea
              className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={form.description}
              onChange={(e) => upd('description', e.target.value)}
              placeholder="Description du produit..."
            />
          </div>

          {/* Images */}
          <ImageUploader images={form.images} onChange={(imgs) => upd('images', imgs)} />

          {/* Prix par quantité */}
          <PrixBuilder value={form.prix} onChange={(p) => upd('prix', p)} />

          {/* Unite + Délai */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Unité</label>
              <Select value={form.unite} onValueChange={(v) => upd('unite', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{UNITES.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Délai (jours)</label>
              <Input type="number" value={form.delai_jours} onChange={(e) => upd('delai_jours', e.target.value)} placeholder="0" />
            </div>
          </div>

          {/* Tags */}
          <TagsInput value={form.tags} onChange={(t) => upd('tags', t)} />

          {/* Actif toggle */}
          <div className="flex items-center gap-3">
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox" checked={form.actif}
                onChange={(e) => upd('actif', e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-primary after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all" />
            </label>
            <span className="text-sm">Produit actif</span>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button className="flex-1" onClick={handleSubmit}>
              {editItem ? 'Enregistrer' : 'Ajouter'}
            </Button>
            <Button variant="outline" onClick={onClose}>Annuler</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ══════════════════════════════════════════════
   MAIN CATALOGUE PAGE
   ══════════════════════════════════════════════ */
export default function Catalogue() {
  const { user, hasPermission } = useAuth();
  const canWrite = hasPermission('catalogue', 'write');
  const isClient = user?.role === 'client';

  const [produits, setProduits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('all');
  const [viewMode, setViewMode] = useState('grid');

  // Dialogs
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [detailProduct, setDetailProduct] = useState(null);
  const [showDetail, setShowDetail] = useState(false);
  const [zoomSrc, setZoomSrc] = useState(null);

  // IA states
  const [iaLoading, setIaLoading] = useState(null);
  const [iaAnalysis, setIaAnalysis] = useState(null);

  const load = async () => {
    const data = await db.produits_catalogue.list();
    setProduits(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    return produits
      .filter((p) => {
        // Clients only see active products
        if (isClient && p.actif === false) return false;
        if (filterCat !== 'all' && p.categorie !== filterCat) return false;
        if (search) {
          const q = search.toLowerCase();
          return `${p.nom} ${p.categorie} ${p.description} ${(p.tags || []).join(' ')} ${p.sku || ''}`.toLowerCase().includes(q);
        }
        return true;
      });
  }, [produits, search, filterCat, isClient]);

  const stats = useMemo(() => ({
    total: produits.length,
    actifs: produits.filter((p) => p.actif !== false).length,
    categories: new Set(produits.map((p) => p.categorie)).size,
  }), [produits]);

  // Actions
  const openAdd = () => { setEditItem(null); setShowForm(true); };
  const openEdit = (p) => { setEditItem(p); setShowForm(true); };
  const openDetail = (p) => { setDetailProduct(p); setShowDetail(true); };

  const handleSave = async (data, existing) => {
    try {
      if (existing) {
        await db.produits_catalogue.update(existing.id, data);
        await logAction('update', 'catalogue', { entityId: existing.id, entityLabel: data.nom });
        toast.success('Produit modifié');
      } else {
        const created = await db.produits_catalogue.create(data);
        await logAction('create', 'catalogue', { entityId: created.id, entityLabel: data.nom });
        toast.success('Produit ajouté au catalogue');
      }
      setShowForm(false);
      load();
    } catch (err) {
      toast.error('Erreur lors de la sauvegarde');
    }
  };

  const handleDelete = async (p) => {
    if (!confirm(`Supprimer "${p.nom}" du catalogue ?`)) return;
    try {
      await db.produits_catalogue.delete(p.id);
      await logAction('delete', 'catalogue', { entityId: p.id, entityLabel: p.nom });
      toast.success('Produit supprimé');
      load();
    } catch {
      toast.error('Erreur lors de la suppression');
    }
  };

  /* ─── IA Handlers ─── */
  const handleGenImages = () => {
    toast.info('Fonctionnalité en cours de développement', {
      description: 'La génération d\'images IA sera bientôt disponible.',
    });
  };

  const handleGenDescriptions = async () => {
    const targets = filtered.length > 0 ? filtered : produits;
    if (targets.length === 0) { toast.error('Aucun produit à traiter'); return; }
    setIaLoading('descriptions');
    let count = 0;
    try {
      for (const p of targets) {
        const { system, prompt } = AI_PROMPTS.catalogue.description(
          p.nom, p.categorie, p.prix?.[0]?.prix || ''
        );
        const description = await askAI(system, prompt);
        if (description) {
          // generate tags too
          const tagsPrompt = AI_PROMPTS.catalogue.tags(p.nom, p.categorie);
          const tagsRaw = await askAI(tagsPrompt.system, tagsPrompt.prompt);
          const newTags = tagsRaw
            ? tagsRaw.split(',').map((t) => t.trim().toLowerCase().replace(/^["']|["']$/g, '')).filter((t) => t.length > 0)
            : [];
          const mergedTags = [...new Set([...(p.tags || []), ...newTags])];
          await db.produits_catalogue.update(p.id, { description, tags: mergedTags });
          count++;
        }
      }
      toast.success(`${count} produit(s) enrichi(s) par l'IA`);
      load();
    } catch (err) {
      toast.error('Erreur lors de la génération IA');
    } finally {
      setIaLoading(null);
    }
  };

  const handleExportPDF = () => {
    const targets = filtered.length > 0 ? filtered : produits;
    if (targets.length === 0) { toast.error('Aucun produit à exporter'); return; }
    // Build printable HTML catalogue
    const html = `
      <html><head><title>Catalogue Imprimerie de l'Ogooué</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 40px; color: #333; }
        h1 { color: #1a1a2e; border-bottom: 3px solid #7C3AED; padding-bottom: 10px; }
        .product { break-inside: avoid; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
        .product h3 { margin: 0 0 4px; color: #1a1a2e; }
        .category { display: inline-block; background: #f3f4f6; padding: 2px 8px; border-radius: 4px; font-size: 11px; color: #666; }
        .price { font-size: 18px; font-weight: bold; color: #7C3AED; margin-top: 8px; }
        .desc { font-size: 13px; color: #555; margin-top: 6px; }
        .tags { margin-top: 6px; } .tags span { background: #ede9fe; color: #7C3AED; font-size: 10px; padding: 2px 6px; border-radius: 3px; margin-right: 4px; }
        .footer { text-align: center; margin-top: 40px; font-size: 11px; color: #999; border-top: 1px solid #e5e7eb; padding-top: 10px; }
      </style></head><body>
      <h1>Catalogue Produits — Imprimerie de l'Ogooué</h1>
      <p style="color:#666;margin-bottom:24px;">${targets.length} produit(s) • Généré le ${new Date().toLocaleDateString('fr-FR')}</p>
      ${targets.map((p) => `
        <div class="product">
          <h3>${p.nom}</h3>
          <span class="category">${p.categorie}</span>
          ${p.sku ? `<span style="font-size:11px;color:#999;margin-left:8px;">SKU: ${p.sku}</span>` : ''}
          <div class="price">${prixRange(p.prix)} / ${p.unite}</div>
          ${p.description ? `<p class="desc">${p.description}</p>` : ''}
          ${p.tags && p.tags.length > 0 ? `<div class="tags">${p.tags.map((t) => `<span>${t}</span>`).join('')}</div>` : ''}
        </div>
      `).join('')}
      <div class="footer">Imprimerie de l'Ogooué — Catalogue généré automatiquement</div>
      </body></html>
    `;
    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
    win.print();
    toast.success('Catalogue PDF en cours d\'impression');
  };

  const handleAnalyseVentes = async () => {
    if (produits.length === 0) { toast.error('Aucun produit à analyser'); return; }
    setIaLoading('analyse');
    setIaAnalysis(null);
    try {
      const resumeProduits = produits.map((p) => ({
        nom: p.nom,
        categorie: p.categorie,
        prix: prixRange(p.prix),
        actif: p.actif !== false,
        tags: p.tags || [],
        description: p.description?.slice(0, 80) || '',
      }));
      const system = `Tu es un expert en stratégie commerciale pour une imprimerie africaine (Gabon). Analyse le catalogue produits et donne des recommandations concrètes pour optimiser les ventes. Réponds en français, de manière structurée avec des sections claires.`;
      const prompt = `Voici le catalogue actuel (${produits.length} produits):\n${JSON.stringify(resumeProduits, null, 2)}\n\nAnalyse ce catalogue et donne:\n1. Points forts du catalogue\n2. Produits manquants ou à ajouter\n3. Recommandations prix\n4. Stratégie de catégories\n5. Actions prioritaires (top 3)`;
      const result = await askAI(system, prompt);
      setIaAnalysis(result);
      toast.success('Analyse IA terminée');
    } catch (err) {
      toast.error('Erreur lors de l\'analyse IA');
    } finally {
      setIaLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Catalogue Produits</h2>
            <p className="text-muted-foreground">
              {stats.total} produit{stats.total > 1 ? 's' : ''} — {stats.categories} catégorie{stats.categories > 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border p-0.5">
              <button onClick={() => setViewMode('grid')} className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === 'grid' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button onClick={() => setViewMode('list')} className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
                <List className="h-4 w-4" />
              </button>
            </div>
            {canWrite && (
              <Button className="gap-2" onClick={openAdd}>
                <Plus className="h-4 w-4" /> Nouveau produit
              </Button>
            )}
          </div>
        </div>

        {/* IA Buttons */}
        {canWrite && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              className="gap-1.5 bg-[#E91E63] hover:bg-[#C2185B] text-white text-xs"
              size="sm"
              onClick={handleGenImages}
              disabled={!!iaLoading}
            >
              {iaLoading === 'images' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
              Générer images IA
            </Button>
            <Button
              className="gap-1.5 bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs"
              size="sm"
              onClick={handleGenDescriptions}
              disabled={!!iaLoading}
            >
              {iaLoading === 'descriptions' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Générer produits IA
            </Button>
            <Button
              variant="outline"
              className="gap-1.5 text-xs"
              size="sm"
              onClick={handleExportPDF}
            >
              <FileDown className="h-3.5 w-3.5" /> Générer catalogue
            </Button>
            <Button
              className="gap-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs"
              size="sm"
              onClick={handleAnalyseVentes}
              disabled={!!iaLoading}
            >
              {iaLoading === 'analyse' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Brain className="h-3.5 w-3.5" />}
              Analyse IA — Optimiser ventes
              <ChevronDown className="h-3 w-3 ml-0.5" />
            </Button>
          </div>
        )}
      </div>

      {/* IA Analysis Result Panel */}
      {iaAnalysis && (
        <Card className="border-emerald-200 bg-emerald-50/50">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100">
                  <Brain className="h-4 w-4 text-emerald-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm text-emerald-900">Analyse IA — Recommandations</h3>
                  <p className="text-[10px] text-emerald-600">Basée sur {produits.length} produit(s) du catalogue</p>
                </div>
              </div>
              <button
                onClick={() => setIaAnalysis(null)}
                className="text-emerald-400 hover:text-emerald-600 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="prose prose-sm prose-emerald max-w-none text-emerald-900/80 whitespace-pre-wrap text-xs leading-relaxed">
              {iaAnalysis}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {[
          { label: 'Produits', value: stats.total, icon: BookOpen, color: 'bg-primary/10 text-primary' },
          { label: 'Actifs', value: stats.actifs, icon: Package, color: 'bg-emerald-500/10 text-emerald-600' },
          { label: 'Catégories', value: stats.categories, icon: Tag, color: 'bg-blue-500/10 text-blue-600' },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}><Icon className="h-4 w-4" /></div>
                <div><p className="text-[10px] text-muted-foreground">{label}</p><p className="text-base font-bold">{value}</p></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search + Filter */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Rechercher un produit, tag, SKU..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={filterCat} onValueChange={setFilterCat}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes catégories</SelectItem>
            {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Category chips */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        <button
          onClick={() => setFilterCat('all')}
          className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${filterCat === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
        >
          Tout ({isClient ? produits.filter((p) => p.actif !== false).length : produits.length})
        </button>
        {[...new Set(produits.map((p) => p.categorie).filter(Boolean))].sort().map((c) => {
          const count = produits.filter((p) => p.categorie === c && (!isClient || p.actif !== false)).length;
          if (count === 0) return null;
          return (
            <button
              key={c}
              onClick={() => setFilterCat(c)}
              className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${filterCat === c ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
            >
              {c} ({count})
            </button>
          );
        })}
      </div>

      {/* Grid View */}
      {viewMode === 'grid' ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((p) => {
            const gradient = CAT_GRADIENT[p.categorie] || 'from-slate-400 to-slate-600';
            const CatIcon = CAT_ICON[p.categorie] || Package;
            const hasImages = p.images && p.images.length > 0;

            return (
              <Card
                key={p.id}
                className="overflow-hidden cursor-pointer group transition-all duration-200 hover:shadow-lg"
                onClick={() => openDetail(p)}
              >
                {/* Image/Gradient header */}
                <div className={`relative h-36 ${hasImages ? 'bg-slate-100' : `bg-gradient-to-br ${gradient}`} flex items-center justify-center`}>
                  {hasImages ? (
                    <img src={p.images[p.image_principale || 0] || p.images[0]} alt={p.nom} className="w-full h-full object-cover" />
                  ) : (
                    <CatIcon className="h-14 w-14 text-white/30 group-hover:scale-110 transition-transform duration-200" />
                  )}
                  {!p.actif && (
                    <Badge className="absolute top-2 left-2 bg-black/50 text-white text-[9px]">Inactif</Badge>
                  )}
                  {hasImages && p.images.length > 1 && (
                    <Badge className="absolute top-2 right-2 bg-black/40 text-white text-[9px]">
                      {p.images.length} photos
                    </Badge>
                  )}
                  {canWrite && (
                    <div className="absolute bottom-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => { e.stopPropagation(); openEdit(p); }}
                        className="rounded-full bg-white/20 p-1.5 text-white hover:bg-white/40 backdrop-blur-sm"
                      >
                        <Edit2 className="h-3 w-3" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(p); }}
                        className="rounded-full bg-white/20 p-1.5 text-white hover:bg-red-500/80 backdrop-blur-sm"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>

                <CardContent className="p-3">
                  <h3 className="font-semibold text-sm leading-tight line-clamp-2 min-h-[2.5rem]">{p.nom}</h3>
                  <div className="flex items-center gap-1.5 mt-1">
                    <Badge variant="outline" className="text-[10px]">{p.categorie}</Badge>
                    {p.sku && <span className="text-[10px] text-muted-foreground">{p.sku}</span>}
                  </div>
                  {p.description && <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">{p.description}</p>}
                  <div className="mt-2.5 flex items-center justify-between border-t pt-2.5">
                    <span className="text-base font-black text-primary">{prixRange(p.prix)}</span>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      {p.delai_jours > 0 && (
                        <span className="flex items-center gap-0.5">
                          <Clock className="h-3 w-3" />{p.delai_jours}j
                        </span>
                      )}
                      <span>/{p.unite}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        /* List View */
        <Card>
          <CardContent className="p-0">
            <div className="divide-y">
              {filtered.map((p) => {
                const gradient = CAT_GRADIENT[p.categorie] || 'from-slate-400 to-slate-600';
                const CatIcon = CAT_ICON[p.categorie] || Package;
                const hasImages = p.images && p.images.length > 0;
                return (
                  <div
                    key={p.id}
                    className="flex items-center gap-4 px-4 py-3 hover:bg-muted/50 cursor-pointer group"
                    onClick={() => openDetail(p)}
                  >
                    {/* Thumbnail */}
                    {hasImages ? (
                      <img src={p.images[0]} alt="" className="h-12 w-12 rounded-lg object-cover shrink-0" />
                    ) : (
                      <div className={`flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br ${gradient} shrink-0`}>
                        <CatIcon className="h-5 w-5 text-white/80" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm truncate">{p.nom}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="outline" className="text-[10px]">{p.categorie}</Badge>
                        {p.sku && <span className="text-[10px] text-muted-foreground">{p.sku}</span>}
                        {!p.actif && <Badge variant="destructive" className="text-[10px]">Inactif</Badge>}
                        {p.delai_jours > 0 && (
                          <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                            <Clock className="h-3 w-3" />{p.delai_jours}j
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-sm font-bold text-primary shrink-0">{prixRange(p.prix)}</span>
                    {canWrite && (
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button onClick={(e) => { e.stopPropagation(); openEdit(p); }} className="rounded p-1 hover:bg-muted">
                          <Edit2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); handleDelete(p); }} className="rounded p-1 hover:bg-red-50">
                          <Trash2 className="h-3.5 w-3.5 text-red-500" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16">
          <BookOpen className="mb-4 h-12 w-12 text-muted-foreground/30" />
          <p className="text-muted-foreground">Aucun produit trouvé</p>
          {canWrite && (
            <Button variant="outline" className="mt-4 gap-2" onClick={openAdd}>
              <Plus className="h-4 w-4" /> Ajouter un produit
            </Button>
          )}
        </div>
      )}

      {/* Product Detail Dialog */}
      <ProductDetail
        product={detailProduct}
        open={showDetail}
        onClose={() => setShowDetail(false)}
        canWrite={canWrite}
        onEdit={openEdit}
        onDelete={handleDelete}
      />

      {/* Product Form Dialog */}
      {canWrite && (
        <ProductForm
          open={showForm}
          onClose={() => setShowForm(false)}
          editItem={editItem}
          onSave={handleSave}
        />
      )}

      {/* Zoom Overlay */}
      <ZoomOverlay src={zoomSrc} onClose={() => setZoomSrc(null)} />
    </div>
  );
}
