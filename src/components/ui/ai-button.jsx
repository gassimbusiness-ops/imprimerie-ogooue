import { useState } from 'react';
import { Sparkles, Loader2, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

/**
 * Bouton IA avec menu déroulant d'actions.
 * @param {Array} actions - [{label, icon?, onClick: async () => string}]
 * @param {string} size - 'sm' | 'default'
 */
export function AIButton({ actions = [], size = 'sm', className = '' }) {
  const [open, setOpen] = useState(false);
  const [loadingIdx, setLoadingIdx] = useState(-1);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  const handleAction = async (action, idx) => {
    setLoadingIdx(idx);
    setResult(null);
    try {
      const text = await action.onClick();
      if (action.onResult) {
        action.onResult(text);
      } else {
        setResult(text);
      }
      setOpen(false);
    } catch (err) {
      toast.error(`Erreur IA : ${err.message}`);
    } finally {
      setLoadingIdx(-1);
    }
  };

  const handleCopy = () => {
    if (result) {
      navigator.clipboard.writeText(result);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success('Copié !');
    }
  };

  return (
    <div className={`relative inline-block ${className}`}>
      <Button
        variant="ghost"
        size={size}
        className="gap-1.5 text-violet-600 hover:bg-violet-50 hover:text-violet-700"
        onClick={() => { setOpen(!open); setResult(null); }}
      >
        <Sparkles className="h-3.5 w-3.5" />
        <span className="text-xs">IA</span>
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 min-w-[200px] rounded-lg border bg-white p-1 shadow-lg">
            {actions.map((action, idx) => (
              <button
                key={idx}
                disabled={loadingIdx !== -1}
                onClick={() => handleAction(action, idx)}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-violet-50 disabled:opacity-50 transition-colors"
              >
                {loadingIdx === idx ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5 text-violet-400" />
                )}
                <span>{action.label}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {result && (
        <div className="mt-2 rounded-lg border border-violet-200 bg-violet-50 p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm text-violet-900 whitespace-pre-wrap">{result}</p>
            <button onClick={handleCopy} className="shrink-0 rounded p-1 hover:bg-violet-100">
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 text-violet-400" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
