import { useState, useEffect, useRef } from 'react';
import { MessageCircle, X, Send, Loader2, Bot } from 'lucide-react';
import { chatAI, AI_PROMPTS } from '@/services/ai';
import { useAuth } from '@/services/auth';
import { db } from '@/services/db';

const WELCOME_MSG = {
  role: 'assistant',
  content: `👋 Bonjour ! Je suis l'assistant de l'Imprimerie Ogooué.\n\nJe peux vous aider avec :\n• 📋 Nos tarifs et services\n• 📦 Le suivi de votre commande\n• ⏱️ Nos délais habituels\n• 💡 Des conseils pour votre projet\n\nComment puis-je vous aider ? 😊`,
};

export default function Chatbot() {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([WELCOME_MSG]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [catalogueResume, setCatalogueResume] = useState('');
  const [commandesResume, setCommandesResume] = useState('');
  const messagesEndRef = useRef(null);

  // Load context data for the chatbot
  useEffect(() => {
    const loadContext = async () => {
      try {
        const [produits, commandes] = await Promise.all([
          db.produits_catalogue.list(),
          db.commandes.list(),
        ]);

        // Build catalogue summary
        const catSummary = produits.slice(0, 20).map(p => {
          const prix = p.prix?.[0]?.prix;
          return `- ${p.nom} (${p.categorie})${prix ? ` : ${prix} FCFA` : ''}`;
        }).join('\n');
        setCatalogueResume(catSummary);

        // Build client orders summary
        if (user?.id) {
          const myOrders = commandes.filter(c => c.client_id === user.id).slice(0, 5);
          const ordSummary = myOrders.map(c =>
            `- ${c.description || c.titre || 'Commande'} | Statut: ${c.statut} | ${c.montant_total || ''} FCFA`
          ).join('\n');
          setCommandesResume(ordSummary);
        }
      } catch (err) {
        console.error('[Chatbot] Context load error:', err);
      }
    };
    loadContext();
  }, [user]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMsg = { role: 'user', content: input.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      // Keep last 10 messages for context (excluding welcome)
      const recentMsgs = [...messages.filter(m => m !== WELCOME_MSG), userMsg]
        .slice(-10)
        .map(m => ({ role: m.role, content: m.content }));

      const systemPrompt = AI_PROMPTS.chatbot.system(catalogueResume, commandesResume);
      const response = await chatAI(systemPrompt, recentMsgs, 300);

      setMessages(prev => [...prev, { role: 'assistant', content: response }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '❌ Désolé, je rencontre un problème technique. Contactez-nous directement au 060 44 46 34. 🙏'
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <>
      {/* Floating button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-lg hover:bg-primary/90 transition-all hover:scale-105 active:scale-95"
          title="Assistant Ogooué"
        >
          <MessageCircle className="h-6 w-6" />
          <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[8px] font-bold text-white animate-pulse">
            1
          </span>
        </button>
      )}

      {/* Chat panel */}
      {isOpen && (
        <div className="fixed bottom-4 right-4 z-50 flex h-[500px] w-[360px] flex-col rounded-2xl border bg-white shadow-2xl sm:bottom-6 sm:right-6">
          {/* Header */}
          <div className="flex items-center justify-between rounded-t-2xl bg-primary px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5" />
              <div>
                <p className="text-sm font-semibold">Assistant Ogooué</p>
                <p className="text-[10px] text-white/70">En ligne</p>
              </div>
            </div>
            <button onClick={() => setIsOpen(false)} className="rounded-lg p-1 hover:bg-white/20 transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap ${
                  msg.role === 'user'
                    ? 'bg-primary text-white rounded-br-md'
                    : 'bg-muted text-foreground rounded-bl-md'
                }`}>
                  {msg.content}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-1.5 rounded-2xl bg-muted px-4 py-3 rounded-bl-md">
                  <div className="flex gap-1">
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:0ms]" />
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:150ms]" />
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t p-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Votre message..."
                className="flex-1 rounded-full border bg-muted/50 px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
                disabled={isLoading}
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || isLoading}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
