import { useState, useEffect, useRef } from 'react';
import { MessageCircle, X, Send, Loader2, Bot } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { chatAI } from '@/services/ai';
import { useAuth } from '@/services/auth';
import { db } from '@/services/db';

const WELCOME_MSG = {
  role: 'assistant',
  content: `Bonjour ! Je suis l'assistant de l'Imprimerie Ogooue.\n\nJe peux vous aider avec :\n- Nos tarifs et services\n- Le suivi de votre commande\n- Nos delais habituels\n- Des conseils pour votre projet\n\nComment puis-je vous aider ?`,
};

async function buildDynamicSystemPrompt(user) {
  try {
    const [produits, commandes] = await Promise.all([
      db.produits_catalogue.list(),
      db.commandes.list(),
    ]);

    const catalogue_str = produits
      .filter((p) => p.actif !== false)
      .map((p) => {
        const prix = p.prix?.[0]?.prix || p.prix_unitaire;
        return `- ${p.nom} (${p.categorie}) : ${prix ? `${prix} FCFA` : 'sur devis'}, delai : ${p.delai_jours ? `${p.delai_jours} jours` : 'a confirmer'}`;
      })
      .join('\n') || 'Catalogue non disponible';

    let commandesClient = '';
    if (user?.id) {
      const myOrders = commandes.filter((c) => c.client_id === user.id).slice(0, 5);
      commandesClient = myOrders
        .map((c) => `- ${c.description || c.numero || 'Commande'} | Statut: ${c.statut} | ${c.montant_total || c.total || ''} FCFA`)
        .join('\n');
    }

    return `Tu es l'assistant virtuel d'Imprimerie Ogooue, une imprimerie professionnelle a Moanda, Gabon.
Tu t'appelles "Assistant Ogooue".

INFORMATIONS DE L'IMPRIMERIE :
- Nom : Imprimerie Ogooue
- Adresse : Carrefour Fina en face de Finam, Moanda, Gabon
- Telephone : +241 060 44 46 34 / +241 074 42 41 42
- Email : imprimerieogooue@gmail.com
- WhatsApp Business : +241 60 44 46 34
- RCCM : RG/FCV 2023A0407 | NIF : 256598U
- Horaires : Lundi-Samedi, 7h30-18h30

SERVICES ET TARIFS ACTUELS :
${catalogue_str}

${commandesClient ? `COMMANDES DU CLIENT :\n${commandesClient}` : ''}

REGLES DE COMMUNICATION :
- Reponds toujours en francais
- Sois chaleureux, professionnel et utile
- Ne dis jamais que tu "ne sais pas" — oriente vers WhatsApp ou la messagerie si tu n'as pas l'info
- Pour les devis personnalises, invite le client a envoyer un message ou a utiliser le simulateur de devis
- Ne donne jamais de tarifs sans preciser qu'ils sont indicatifs et que le devis final est confirme par l'equipe
- N'utilise jamais de markdown (#, **, *, _) — reponds en texte naturel
- Pour les commandes urgentes, mentionne toujours le delai de traitement
- Si le client veut passer commande, guide-le vers le bouton "Nouvelle commande"
- Max 150 mots par reponse

QUESTIONS FREQUENTES :
- "Combien coute un t-shirt ?" → Donner le tarif du catalogue + preciser que ca depend de la quantite et du type d'impression
- "Quand sera ma commande prete ?" → Demander le numero de commande + verifier le statut dans l'app
- "Pouvez-vous faire des uniformes ?" → Oui, textile personnalise disponible, demander les quantites
- "Livrez-vous ?" → Retrait en boutique uniquement actuellement, livraison en cours de deploiement`;
  } catch (err) {
    console.error('[Chatbot] Context build error:', err);
    return `Tu es l'assistant virtuel de l'Imprimerie Ogooue a Moanda, Gabon. Reponds en francais, sois professionnel et chaleureux. Max 150 mots.`;
  }
}

export default function Chatbot() {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([WELCOME_MSG]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const messagesEndRef = useRef(null);

  // Build dynamic system prompt with real data
  useEffect(() => {
    buildDynamicSystemPrompt(user).then(setSystemPrompt);
  }, [user]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMsg = { role: 'user', content: input.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const recentMsgs = [...messages.filter((m) => m !== WELCOME_MSG), userMsg]
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content }));

      const response = await chatAI(systemPrompt, recentMsgs, 300);
      setMessages((prev) => [...prev, { role: 'assistant', content: response }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Desole, je rencontre un probleme technique. Contactez-nous directement au 060 44 46 34.' },
      ]);
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
      {/* Floating button — more visible with pulsing badge */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full bg-primary pl-4 pr-5 py-3 text-white shadow-lg hover:bg-primary/90 transition-all hover:scale-105 active:scale-95"
          title="Assistant Ogooue"
        >
          <MessageCircle className="h-5 w-5" />
          <span className="text-sm font-medium hidden sm:inline">Parlez-nous !</span>
          <span className="absolute -top-1 -right-1 flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
          </span>
        </button>
      )}

      {/* Chat panel — 420px desktop, full-screen mobile */}
      {isOpen && (
        <div className="fixed bottom-0 right-0 z-50 flex flex-col bg-white shadow-2xl
          w-full h-full sm:bottom-6 sm:right-6 sm:w-[420px] sm:h-[540px] sm:rounded-2xl sm:border">
          {/* Header */}
          <div className="flex items-center justify-between bg-primary px-4 py-3 text-white sm:rounded-t-2xl">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5" />
              <div>
                <p className="text-sm font-semibold">Assistant Ogooue</p>
                <p className="text-[10px] text-white/70">En ligne — repond en temps reel</p>
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
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${
                    msg.role === 'user'
                      ? 'bg-primary text-white rounded-br-md whitespace-pre-wrap'
                      : 'bg-muted text-foreground rounded-bl-md chatbot-md'
                  }`}
                >
                  {msg.role === 'assistant' ? (
                    <ReactMarkdown
                      components={{
                        p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
                        ul: ({ children }) => <ul className="list-disc pl-4 mb-1.5 space-y-0.5">{children}</ul>,
                        ol: ({ children }) => <ol className="list-decimal pl-4 mb-1.5 space-y-0.5">{children}</ol>,
                        li: ({ children }) => <li className="text-sm">{children}</li>,
                        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                        a: ({ href, children }) => (
                          <a href={href} className="underline text-primary" target="_blank" rel="noopener noreferrer">
                            {children}
                          </a>
                        ),
                      }}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  ) : (
                    msg.content
                  )}
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
