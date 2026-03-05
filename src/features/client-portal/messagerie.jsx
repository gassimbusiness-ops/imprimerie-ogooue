import { useState, useEffect, useRef } from 'react';
import { db } from '@/services/db';
import { useAuth } from '@/services/auth';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Send, MessageCircle } from 'lucide-react';

export default function ClientMessagerie() {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [convId, setConvId] = useState(null);
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
      type: 'sortant',
      contenu: text.trim(),
      auteur: `${user?.prenom} ${user?.nom}`,
    });
    setMessages((prev) => [...prev, msg]);
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
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.type === 'sortant' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${m.type === 'sortant' ? 'bg-primary text-white rounded-br-md' : 'bg-muted rounded-bl-md'}`}>
                {m.contenu}
                <p className={`text-[10px] mt-1 ${m.type === 'sortant' ? 'text-white/60' : 'text-muted-foreground'}`}>
                  {m.created_at ? new Date(m.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : ''}
                </p>
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </CardContent>
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
