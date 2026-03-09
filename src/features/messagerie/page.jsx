import { useState, useEffect, useMemo, useRef } from 'react';
import { db } from '@/services/db';
import { useAuth } from '@/services/auth';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  MessageCircle, Send, Search, Plus, Phone, Mail, User,
  ArrowLeft, Clock, Paperclip, FileText, Download, X, Image as ImageIcon, AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { notifyNouveauMessage } from '@/services/notifications';

const PLATFORMS = {
  whatsapp: { label: 'WhatsApp', color: 'bg-green-100 text-green-700', dot: 'bg-green-500' },
  facebook: { label: 'Facebook', color: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' },
  instagram: { label: 'Instagram', color: 'bg-pink-100 text-pink-700', dot: 'bg-pink-500' },
  interne: { label: 'Interne', color: 'bg-slate-100 text-slate-700', dot: 'bg-slate-500' },
};

const STATUTS_CONV = {
  nouveau: { label: 'Nouveau', color: 'bg-blue-100 text-blue-700' },
  en_cours: { label: 'En cours', color: 'bg-amber-100 text-amber-700' },
  en_attente: { label: 'En attente', color: 'bg-slate-100 text-slate-700' },
  clos: { label: 'Clos', color: 'bg-emerald-100 text-emerald-700' },
};

const TEMPLATES = [
  { label: 'Bienvenue', text: 'Bonjour {nom}, bienvenue à l\'Imprimerie Ogooué ! Comment puis-je vous aider ?' },
  { label: 'Devis', text: 'Merci pour votre demande. Nous préparons votre devis et vous recontactons sous 24h.' },
  { label: 'Commande prête', text: 'Bonne nouvelle {nom} ! Votre commande est prête. Vous pouvez passer la récupérer.' },
  { label: 'Suivi', text: 'Votre commande est en cours de production. Livraison estimée : {delai}.' },
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export default function Messagerie() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [messages, setMessages] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState('');
  const [filterPlatform, setFilterPlatform] = useState('all');
  const [activeConv, setActiveConv] = useState(null);
  const [newMessage, setNewMessage] = useState('');
  const [showNewConv, setShowNewConv] = useState(false);
  const [newConvClient, setNewConvClient] = useState('');
  const [newConvPlatform, setNewConvPlatform] = useState('whatsapp');

  // Pièces jointes state
  const [attachedFile, setAttachedFile] = useState(null); // { name, type, size, data (base64) }
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);

  const load = async () => {
    try {
      setLoadError(null);
      const [c, m, cl] = await Promise.all([
        db.conversations.list(),
        db.messages_conv.list(),
        db.clients.list(),
      ]);
      setConversations(
        c.sort((a, b) =>
          (b.updated_at || b.created_at || '').localeCompare(a.updated_at || a.created_at || '')
        )
      );
      setMessages(m);
      setClients(cl);
    } catch (err) {
      console.error('Erreur chargement messagerie:', err);
      setLoadError('Impossible de charger les conversations. Vérifiez votre connexion.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeConv]);

  const filtered = useMemo(() => {
    return conversations.filter((c) => {
      if (filterPlatform !== 'all' && c.plateforme !== filterPlatform) return false;
      if (search)
        return `${c.client_nom || ''} ${c.sujet || ''}`
          .toLowerCase()
          .includes(search.toLowerCase());
      return true;
    });
  }, [conversations, search, filterPlatform]);

  const activeMessages = useMemo(() => {
    if (!activeConv) return [];
    return messages
      .filter((m) => m.conversation_id === activeConv.id)
      .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  }, [messages, activeConv]);

  const stats = useMemo(
    () => ({
      total: conversations.length,
      non_lus: conversations.filter((c) => c.statut === 'nouveau').length,
      en_cours: conversations.filter((c) => c.statut === 'en_cours').length,
    }),
    [conversations]
  );

  // ─── File picker ───
  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      toast.error(`Fichier trop volumineux (max ${formatFileSize(MAX_FILE_SIZE)})`);
      return;
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error('Type de fichier non supporté. Formats acceptés : JPG, PNG, GIF, WebP, PDF');
      return;
    }
    try {
      const data = await fileToBase64(file);
      setAttachedFile({ name: file.name, type: file.type, size: file.size, data });
    } catch {
      toast.error('Erreur lors de la lecture du fichier');
    }
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = () => setAttachedFile(null);

  // ─── Send message ───
  const sendMessage = async () => {
    if ((!newMessage.trim() && !attachedFile) || !activeConv) return;
    try {
      const msgData = {
        conversation_id: activeConv.id,
        contenu: newMessage.trim(),
        auteur: `${user?.prenom || ''} ${user?.nom || ''}`.trim(),
        auteur_id: user?.id,
        type: 'sortant',
      };
      // Attach file data if present
      if (attachedFile) {
        msgData.fichier = {
          nom: attachedFile.name,
          type: attachedFile.type,
          taille: attachedFile.size,
          data: attachedFile.data,
        };
      }
      await db.messages_conv.create(msgData);
      await db.conversations.update(activeConv.id, {
        statut: 'en_cours',
        dernier_message: attachedFile
          ? `📎 ${attachedFile.name}${newMessage.trim() ? ' — ' + newMessage.trim() : ''}`
          : newMessage.trim(),
      });
      // Notify destinataire
      if (activeConv.client_id) {
        notifyNouveauMessage(activeConv.client_id, `${user?.prenom || ''} ${user?.nom || ''}`.trim());
      }
      setNewMessage('');
      setAttachedFile(null);
      load();
    } catch (err) {
      console.error('Erreur envoi message:', err);
      toast.error('Erreur lors de l\'envoi du message');
    }
  };

  const createConversation = async () => {
    if (!newConvClient) {
      toast.error('Sélectionnez un client');
      return;
    }
    const cl = clients.find((c) => c.id === newConvClient);
    const conv = await db.conversations.create({
      client_id: newConvClient,
      client_nom: cl?.nom || '',
      plateforme: newConvPlatform,
      statut: 'nouveau',
      sujet: `Conversation avec ${cl?.nom}`,
    });
    setShowNewConv(false);
    setActiveConv(conv);
    load();
    toast.success('Conversation créée');
  };

  const useTemplate = (t) => {
    let text = t.text;
    if (activeConv?.client_nom) text = text.replace('{nom}', activeConv.client_nom);
    setNewMessage(text);
  };

  // ─── Loading / Error states ───
  if (loading)
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );

  if (loadError)
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <AlertTriangle className="mb-3 h-10 w-10 text-amber-500" />
        <p className="text-muted-foreground mb-4">{loadError}</p>
        <Button
          onClick={() => {
            setLoading(true);
            load();
          }}
        >
          Réessayer
        </Button>
      </div>
    );

  // ─── Conversation detail view ───
  if (activeConv) {
    const plat = PLATFORMS[activeConv.plateforme] || PLATFORMS.interne;
    return (
      <div className="flex h-[calc(100vh-8rem)] flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 border-b pb-3">
          <button
            onClick={() => setActiveConv(null)}
            className="rounded-lg p-2 hover:bg-muted"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className={`h-3 w-3 rounded-full ${plat.dot}`} />
          <div className="flex-1">
            <p className="font-semibold">{activeConv.client_nom}</p>
            <p className="text-xs text-muted-foreground">{plat.label}</p>
          </div>
          <Select
            value={activeConv.statut}
            onValueChange={async (v) => {
              await db.conversations.update(activeConv.id, { statut: v });
              load();
              setActiveConv({ ...activeConv, statut: v });
            }}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(STATUTS_CONV).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto space-y-3 py-4">
          {activeMessages.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-12">Aucun message</p>
          )}
          {activeMessages.map((m) => (
            <div key={m.id} className={`flex ${m.type === 'sortant' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                  m.type === 'sortant' ? 'bg-primary text-primary-foreground' : 'bg-muted'
                }`}
              >
                {/* Pièce jointe affichée */}
                {m.fichier && (
                  <div className="mb-2">
                    {m.fichier.type?.startsWith('image/') ? (
                      <div className="overflow-hidden rounded-lg">
                        <img
                          src={m.fichier.data}
                          alt={m.fichier.nom}
                          className="max-h-48 max-w-full rounded-lg object-cover cursor-pointer hover:opacity-90"
                          onClick={() => {
                            const w = window.open();
                            if (w) {
                              w.document.write(`<img src="${m.fichier.data}" style="max-width:100%;height:auto;" />`);
                            }
                          }}
                        />
                        <p className="text-[10px] mt-1 opacity-70">{m.fichier.nom}</p>
                      </div>
                    ) : (
                      <a
                        href={m.fichier.data}
                        download={m.fichier.nom}
                        className={`flex items-center gap-2 rounded-lg p-2 transition-colors ${
                          m.type === 'sortant' ? 'bg-white/10 hover:bg-white/20' : 'bg-background hover:bg-muted-foreground/10'
                        }`}
                      >
                        <FileText className="h-8 w-8 shrink-0 text-red-400" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{m.fichier.nom}</p>
                          <p className="text-[10px] opacity-60">{formatFileSize(m.fichier.taille)}</p>
                        </div>
                        <Download className="h-4 w-4 shrink-0 opacity-60" />
                      </a>
                    )}
                  </div>
                )}
                {m.contenu && <p className="text-sm">{m.contenu}</p>}
                <p
                  className={`text-[10px] mt-1 ${
                    m.type === 'sortant' ? 'text-primary-foreground/60' : 'text-muted-foreground'
                  }`}
                >
                  {m.auteur} —{' '}
                  {new Date(m.created_at).toLocaleTimeString('fr-FR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Templates */}
        <div className="flex gap-1 overflow-x-auto pb-2">
          {TEMPLATES.map((t) => (
            <button
              key={t.label}
              onClick={() => useTemplate(t)}
              className="shrink-0 rounded-full border px-3 py-1 text-[10px] font-medium hover:bg-muted transition-colors"
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Attachment preview */}
        {attachedFile && (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2 mx-1 mb-1">
            {attachedFile.type?.startsWith('image/') ? (
              <img
                src={attachedFile.data}
                alt={attachedFile.name}
                className="h-10 w-10 rounded object-cover"
              />
            ) : (
              <FileText className="h-8 w-8 text-red-400" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">{attachedFile.name}</p>
              <p className="text-[10px] text-muted-foreground">{formatFileSize(attachedFile.size)}</p>
            </div>
            <button onClick={removeAttachment} className="rounded-full p-1 hover:bg-muted">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Input */}
        <div className="flex gap-2 border-t pt-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
            className="hidden"
            onChange={handleFileSelect}
          />
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 text-muted-foreground"
            onClick={() => fileInputRef.current?.click()}
            title="Joindre un fichier"
          >
            <Paperclip className="h-5 w-5" />
          </Button>
          <Input
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Tapez votre message..."
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            className="flex-1"
          />
          <Button onClick={sendMessage} disabled={!newMessage.trim() && !attachedFile}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  // ─── Conversation list ───
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Messagerie</h2>
          <p className="text-muted-foreground">
            WhatsApp, Facebook, Instagram — {stats.total} conversations
          </p>
        </div>
        <Button className="gap-2" onClick={() => setShowNewConv(true)}>
          <Plus className="h-4 w-4" /> Nouvelle conversation
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total', value: stats.total, color: 'bg-primary/10 text-primary' },
          { label: 'Non lus', value: stats.non_lus, color: 'bg-blue-500/10 text-blue-600' },
          { label: 'En cours', value: stats.en_cours, color: 'bg-amber-500/10 text-amber-600' },
        ].map(({ label, value, color }) => (
          <Card key={label}>
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}>
                  <MessageCircle className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">{label}</p>
                  <p className="text-base font-bold">{value}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Rechercher..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={filterPlatform} onValueChange={setFilterPlatform}>
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes</SelectItem>
            {Object.entries(PLATFORMS).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        {filtered.map((c) => {
          const plat = PLATFORMS[c.plateforme] || PLATFORMS.interne;
          const st = STATUTS_CONV[c.statut] || STATUTS_CONV.nouveau;
          const convMessages = messages.filter((m) => m.conversation_id === c.id);
          const lastMsg = convMessages.sort((a, b) =>
            (b.created_at || '').localeCompare(a.created_at || '')
          )[0];
          return (
            <Card
              key={c.id}
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => setActiveConv(c)}
            >
              <CardContent className="flex items-center gap-4 p-4">
                <div className="relative shrink-0">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted">
                    <User className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div
                    className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-background ${plat.dot}`}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm">{c.client_nom || 'Client'}</p>
                    <Badge className={`text-[10px] ${st.color}`}>{st.label}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {c.dernier_message || lastMsg?.contenu || 'Aucun message'}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <Badge variant="outline" className={`text-[10px] ${plat.color}`}>
                    {plat.label}
                  </Badge>
                  {lastMsg && (
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {new Date(lastMsg.created_at).toLocaleDateString('fr-FR', {
                        day: '2-digit',
                        month: 'short',
                      })}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16">
          <MessageCircle className="mb-4 h-12 w-12 text-muted-foreground/30" />
          <p className="text-muted-foreground">Aucune conversation</p>
        </div>
      )}

      {/* New conversation dialog */}
      {showNewConv && (
        <Dialog open={showNewConv} onOpenChange={setShowNewConv}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Nouvelle conversation</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Client</label>
                <Select value={newConvClient || undefined} onValueChange={setNewConvClient}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choisir un client..." />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.nom}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Plateforme</label>
                <Select value={newConvPlatform} onValueChange={setNewConvPlatform}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PLATFORMS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button className="w-full" onClick={createConversation}>
                Créer
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
