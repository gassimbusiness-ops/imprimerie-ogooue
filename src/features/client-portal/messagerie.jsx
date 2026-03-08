import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '@/services/db';
import { useAuth } from '@/services/auth';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Send, MessageCircle, Megaphone, ShoppingCart, Reply } from 'lucide-react';

export default function ClientMessagerie() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [convId, setConvId] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    (async () => {
      const convs = await db.conversations.list();
      const myConv = convs.find((c) => c.client_email === user?.email || c.client_nom?.toLowerCase() === `${user?.prenom} ${user?.nom}`.toLowerCase());
      if (myConv) {
        setConvId(myConv.id);
        const msgs = await db.messages_conv.list();
        setMessages(msgs.filter((m) => m.conversation_id === myConv.id).sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '')));
      }
    })();
  }, [user]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = async () => {
    if (!text.trim()) return;
    let cid = convId;
    if (!cid) {
      const conv = await db.conversations.create({
        client_nom: `${user?.prenom} ${user?.nom}`,
        client_email: user?.email,
        plateforme: 'interne',
        statut: 'nouveau',
      });
      cid = conv.id;
      setConvId(cid);
    }
    const msg = await db.messages_conv.create({
      conversation_id: cid,
      type: 'entrant',
      contenu: text.trim(),
      auteur: `${user?.prenom} ${user?.nom}`,
    });
    setMessages((prev) => [...prev, msg]);
    setText('');
    setReplyTo(null);
  };

  const handleReply = (m) => {
    setReplyTo(m);
    setText('');
  };

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold">Messagerie</h1>
      <p className="text-muted-foreground">Discutez directement avec l'Imprimerie Ogooué</p>

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
            const isOutgoing = m.type === 'sortant';
            const isIncoming = m.type === 'entrant';

            return (
              <div key={m.id}>
                <div className={`flex ${isIncoming ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${isIncoming ? 'bg-primary text-white rounded-br-md' : isCampagne ? 'bg-gradient-to-br from-violet-50 to-amber-50 border border-violet-200 rounded-bl-md' : 'bg-muted rounded-bl-md'}`}>
                    {/* Campaign badge */}
                    {isCampagne && (
                      <div className="flex items-center gap-1.5 mb-2">
                        <Badge className="text-[10px] bg-violet-100 text-violet-700 gap-1">
                          <Megaphone className="h-2.5 w-2.5" />
                          {m.campagne_type === 'promotion' ? 'Promotion' : m.campagne_type === 'evenement' ? 'Événement' : 'Offre spéciale'}
                        </Badge>
                      </div>
                    )}

                    {/* Message content */}
                    <div className="whitespace-pre-wrap">{m.contenu}</div>

                    <p className={`text-[10px] mt-1 ${isIncoming ? 'text-white/60' : 'text-muted-foreground'}`}>
                      {m.created_at ? new Date(m.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : ''}
                      {m.auteur && !isIncoming ? ` — ${m.auteur}` : ''}
                    </p>

                    {/* Campaign action buttons */}
                    {isCampagne && (
                      <div className="flex gap-2 mt-3 pt-2 border-t border-violet-200">
                        <Button size="sm" className="flex-1 text-xs gap-1 bg-primary hover:bg-primary/90 h-8"
                          onClick={() => navigate('/client/catalogue')}>
                          <ShoppingCart className="h-3 w-3" /> Commander
                        </Button>
                        <Button size="sm" variant="outline" className="flex-1 text-xs gap-1 h-8"
                          onClick={() => handleReply(m)}>
                          <Reply className="h-3 w-3" /> Répondre
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
            <p className="text-xs text-muted-foreground truncate flex-1">Réponse à : {replyTo.contenu?.slice(0, 60)}...</p>
            <button onClick={() => setReplyTo(null)} className="text-muted-foreground hover:text-foreground">
              <span className="text-xs">✕</span>
            </button>
          </div>
        )}

        <div className="border-t p-3 flex gap-2">
          <Input
            placeholder="Votre message..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            className="flex-1"
          />
          <Button onClick={send} className="gap-1.5" disabled={!text.trim()}>
            <Send className="h-4 w-4" /> Envoyer
          </Button>
        </div>
      </Card>
    </div>
  );
}
