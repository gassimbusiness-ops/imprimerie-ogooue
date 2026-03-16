import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '@/services/db';
import { useAuth } from '@/services/auth';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Send, MessageCircle, Megaphone, ShoppingCart, Reply, Paperclip, X, FileText, Download } from 'lucide-react';
import { toast } from 'sonner';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
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

export default function ClientMessagerie() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [convId, setConvId] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [attachedFile, setAttachedFile] = useState(null);
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);

  const loadMessages = async () => {
    if (!user) return;
    const convs = await db.conversations.list();
    const fullName = `${user?.prenom || ''} ${user?.nom || ''}`.trim().toLowerCase();
    const myConv = convs.find((c) => c.client_id === user?.id)
      || convs.find((c) => c.client_email === user?.email)
      || convs.find((c) => c.client_nom?.toLowerCase() === fullName);
    if (myConv) {
      setConvId(myConv.id);
      const msgs = await db.messages_conv.list();
      setMessages(msgs.filter((m) => m.conversation_id === myConv.id).sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '')));
    }
  };

  useEffect(() => { loadMessages(); }, [user]);
  useEffect(() => {
    if (!convId) return;
    const interval = setInterval(loadMessages, 5000);
    return () => clearInterval(interval);
  }, [convId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) { toast.error(`Fichier trop volumineux (max ${formatFileSize(MAX_FILE_SIZE)})`); return; }
    if (!ALLOWED_TYPES.includes(file.type)) { toast.error('Format non supporte. Acceptes : JPG, PNG, GIF, WebP, PDF'); return; }
    try {
      const data = await fileToBase64(file);
      setAttachedFile({ name: file.name, type: file.type, size: file.size, data });
    } catch { toast.error('Erreur lecture fichier'); }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const send = async () => {
    if (!text.trim() && !attachedFile) return;
    let cid = convId;
    if (!cid) {
      const conv = await db.conversations.create({
        client_id: user?.id,
        client_nom: `${user?.prenom} ${user?.nom}`,
        client_email: user?.email,
        plateforme: 'interne',
        statut: 'nouveau',
        sujet: `Conversation avec ${user?.prenom} ${user?.nom}`,
      });
      cid = conv.id;
      setConvId(cid);
    }
    const msgData = {
      conversation_id: cid,
      type: 'entrant',
      contenu: text.trim() || (attachedFile ? `Fichier : ${attachedFile.name}` : ''),
      auteur: `${user?.prenom} ${user?.nom}`,
      auteur_id: user?.id,
    };
    if (attachedFile) {
      msgData.piece_jointe = { name: attachedFile.name, type: attachedFile.type, size: attachedFile.size, data: attachedFile.data };
    }
    const msg = await db.messages_conv.create(msgData);
    await db.conversations.update(cid, {
      dernier_message: text.trim() || `Fichier : ${attachedFile?.name || ''}`,
      statut: 'nouveau',
    });
    setMessages((prev) => [...prev, msg]);
    setText('');
    setReplyTo(null);
    setAttachedFile(null);
  };

  const handleReply = (m) => { setReplyTo(m); setText(''); };

  const renderAttachment = (m) => {
    const pj = m.piece_jointe;
    if (!pj) return null;
    const isImage = pj.type?.startsWith('image/');
    return (
      <div className="mt-2">
        {isImage ? (
          <img src={pj.data} alt={pj.name} className="max-w-[200px] rounded-lg border" />
        ) : (
          <a href={pj.data} download={pj.name} className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-xs hover:bg-white/20">
            <FileText className="h-3.5 w-3.5" />
            <span className="truncate flex-1">{pj.name}</span>
            <Download className="h-3 w-3" />
          </a>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold">Messagerie</h1>
      <p className="text-muted-foreground">Discutez directement avec l'Imprimerie Ogooue</p>

      <Card className="h-[500px] flex flex-col">
        <CardContent className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <MessageCircle className="h-10 w-10 mb-2 opacity-30" />
              <p className="text-sm">Envoyez votre premier message</p>
            </div>
          )}
          {messages.map((m) => {
            const isCampagne = m.is_campagne;
            const isIncoming = m.type === 'entrant';

            return (
              <div key={m.id}>
                <div className={`flex ${isIncoming ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${isIncoming ? 'bg-primary text-white rounded-br-md' : isCampagne ? 'bg-gradient-to-br from-violet-50 to-amber-50 border border-violet-200 rounded-bl-md' : 'bg-muted rounded-bl-md'}`}>
                    {isCampagne && (
                      <div className="flex items-center gap-1.5 mb-2">
                        <Badge className="text-[10px] bg-violet-100 text-violet-700 gap-1">
                          <Megaphone className="h-2.5 w-2.5" />
                          {m.campagne_type === 'promotion' ? 'Promotion' : m.campagne_type === 'evenement' ? 'Evenement' : 'Offre speciale'}
                        </Badge>
                      </div>
                    )}

                    {/* Product card */}
                    {m.produit_partage && (
                      <div className="rounded-lg border bg-white p-2.5 mb-2">
                        <div className="flex items-center gap-2">
                          {m.produit_partage.image && <img src={m.produit_partage.image} alt="" className="h-10 w-10 rounded object-cover" />}
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-xs text-foreground truncate">{m.produit_partage.nom}</p>
                            <p className="text-xs text-primary font-bold">{m.produit_partage.prix} F</p>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="whitespace-pre-wrap">{m.contenu}</div>
                    {renderAttachment(m)}

                    <p className={`text-[10px] mt-1 ${isIncoming ? 'text-white/60' : 'text-muted-foreground'}`}>
                      {m.created_at ? new Date(m.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : ''}
                      {m.auteur && !isIncoming ? ` — ${m.auteur}` : ''}
                    </p>

                    {isCampagne && (
                      <div className="flex gap-2 mt-3 pt-2 border-t border-violet-200">
                        <Button size="sm" className="flex-1 text-xs gap-1 bg-primary hover:bg-primary/90 h-8"
                          onClick={() => navigate('/client/catalogue')}>
                          <ShoppingCart className="h-3 w-3" /> Commander
                        </Button>
                        <Button size="sm" variant="outline" className="flex-1 text-xs gap-1 h-8"
                          onClick={() => handleReply(m)}>
                          <Reply className="h-3 w-3" /> Repondre
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </CardContent>

        {/* Reply context */}
        {replyTo && (
          <div className="px-3 pt-2 flex items-center gap-2 border-t bg-muted/50">
            <Reply className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <p className="text-xs text-muted-foreground truncate flex-1">Reponse a : {replyTo.contenu?.slice(0, 60)}...</p>
            <button onClick={() => setReplyTo(null)} className="text-muted-foreground hover:text-foreground">
              <span className="text-xs">x</span>
            </button>
          </div>
        )}

        {/* File preview */}
        {attachedFile && (
          <div className="px-3 pt-2 flex items-center gap-2 border-t bg-blue-50">
            <Paperclip className="h-3.5 w-3.5 text-blue-600 shrink-0" />
            <p className="text-xs text-blue-800 truncate flex-1">{attachedFile.name} ({formatFileSize(attachedFile.size)})</p>
            <button onClick={() => setAttachedFile(null)} className="text-blue-600 hover:text-blue-800">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <div className="border-t p-3 flex gap-2">
          <input type="file" ref={fileInputRef} onChange={handleFileSelect} accept="image/*,.pdf" className="hidden" />
          <Button variant="ghost" size="icon" className="shrink-0" onClick={() => fileInputRef.current?.click()} title="Joindre un fichier">
            <Paperclip className="h-4 w-4" />
          </Button>
          <Input
            placeholder="Votre message..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            className="flex-1"
          />
          <Button onClick={send} className="gap-1.5" disabled={!text.trim() && !attachedFile}>
            <Send className="h-4 w-4" /> Envoyer
          </Button>
        </div>
      </Card>
    </div>
  );
}
