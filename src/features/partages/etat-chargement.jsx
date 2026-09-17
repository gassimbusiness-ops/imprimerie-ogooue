/**
 * Ce qu'un ecran montre pendant qu'il charge, et quand il n'a PAS pu charger.
 *
 * ── Pourquoi un composant partage ─────────────────────────────────────────
 *
 * Le remede ne vaut que s'il est ecrit une fois. Recopie dans vingt ecrans, il
 * divergera — c'est exactement ce qui a casse les notifications (une regle a
 * deux endroits, voir tasks/lessons.md). Les ecrans repris importent donc ces
 * deux composants ; ils n'ecrivent ni leur propre message d'erreur, ni leur
 * propre bouton « Reessayer ».
 *
 * ── La phrase ─────────────────────────────────────────────────────────────
 *
 * Le texte vient de `messageEchecChargement()` dans
 * `src/services/erreur-lecture.js`. Il ne contient jamais « aucun », jamais un
 * code d'erreur, jamais le mot « erreur » tout court : le gerant doit lire ce
 * qui s'est passe et ce qu'il peut faire. La cause technique va en console.
 *
 * Teste par tests/rendu-ecran-chargement.test.mjs.
 */
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { messageEchecChargement } from '@/services/erreur-lecture';

/**
 * Le rond qui tourne, identique dans tous les ecrans repris.
 */
export function EnChargement() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      <span className="sr-only">Chargement en cours…</span>
    </div>
  );
}

/**
 * Le panneau d'echec de chargement, avec son bouton de reessai.
 *
 * @param {{quoi?: string, erreur?: any, onReessayer?: () => any, enCours?: boolean}} p
 *   `quoi` : ce qu'on chargeait, en francais (« les rapports journaliers »).
 */
export function EchecChargement({ quoi, erreur, onReessayer, enCours = false }) {
  const message = quoi
    ? messageEchecChargement(quoi)
    : String((erreur && erreur.message) || messageEchecChargement(null));

  return (
    <div
      role="alert"
      className="mx-auto my-10 max-w-md rounded-xl border border-orange-200 bg-orange-50 p-6 text-center"
    >
      <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-orange-500" />
      <p className="mb-4 text-sm leading-relaxed text-orange-900">{message}</p>
      {onReessayer && (
        <Button variant="outline" className="gap-2" onClick={onReessayer} disabled={enCours}>
          <RefreshCw className={`h-4 w-4 ${enCours ? 'animate-spin' : ''}`} />
          {enCours ? 'Nouvelle tentative…' : 'Réessayer'}
        </Button>
      )}
    </div>
  );
}

export default EchecChargement;
