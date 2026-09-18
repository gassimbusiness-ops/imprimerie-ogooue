/**
 * Le selecteur d'activite — IMPRIMERIE / PAPETERIE / les deux.
 *
 * ── Pourquoi un composant partage ─────────────────────────────────────────
 *
 * Le meme choix apparait sur l'ecran ou l'on encaisse, sur celui ou l'on
 * compte la caisse, et sur ceux ou l'on lit les chiffres. Recopie a cinq
 * endroits, il divergera : un ecran proposera « les deux » la ou l'ecriture
 * l'interdit, un autre oubliera de normaliser la valeur. C'est la lecon des
 * notifications, deja payee (tasks/lessons.md).
 *
 * ── Pourquoi des boutons, et pas un <Select> ──────────────────────────────
 *
 * Trois raisons, dans l'ordre d'importance :
 *
 *   1. L'ERREUR DE CAISSE. Un menu deroulant cache l'etat courant derriere un
 *      clic. Quand on encaisse au comptoir, savoir DANS QUELLE CAISSE on tape
 *      doit se lire sans ouvrir quoi que ce soit — sinon on saisit la vente
 *      d'un cahier dans la caisse imprimerie, et il faut « demeler » plus tard.
 *   2. Le comptoir est tactile. Deux cibles larges valent mieux qu'un menu.
 *   3. Un groupe de boutons se teste vraiment dans jsdom ; un Select Radix
 *      s'y teste mal, et un ecran d'argent non teste finit blanc.
 *
 * ── L'etat « les deux » ───────────────────────────────────────────────────
 *
 * Present UNIQUEMENT quand `avecToutes` est vrai, c'est-a-dire sur les vues de
 * LECTURE. Un ecran qui ECRIT ne doit jamais l'afficher : une ligne appartenant
 * aux deux caisses n'appartient a aucune (voir src/services/activites.js).
 *
 * Teste par tests/caisse-par-activite.test.mjs et tests/activite-ecrans.test.mjs.
 */
import {
  ACTIVITES, TOUTES_ACTIVITES, libelleActivite,
} from '@/services/activites';

/**
 * @param {object} p
 * @param {string} p.valeur activite courante, ou `TOUTES_ACTIVITES`
 * @param {(v: string) => void} p.onChange
 * @param {boolean} [p.avecToutes] proposer l'etat consolide « Les deux »
 * @param {boolean} [p.compact] hauteur reduite, pour un en-tete de dialogue
 * @param {string} [p.className]
 */
export default function SelecteurActivite({
  valeur, onChange, avecToutes = false, compact = false, className = '',
}) {
  const options = avecToutes ? [...ACTIVITES, TOUTES_ACTIVITES] : [...ACTIVITES];
  const taille = compact ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm';

  return (
    <div
      role="group"
      aria-label="Activité"
      className={`inline-flex shrink-0 rounded-lg border bg-muted/40 p-0.5 ${className}`}
    >
      {options.map((opt) => {
        const actif = valeur === opt;
        return (
          <button
            key={opt}
            type="button"
            aria-pressed={actif}
            onClick={() => onChange?.(opt)}
            className={`rounded-md font-medium transition-colors ${taille} ${
              actif
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {libelleActivite(opt)}
          </button>
        );
      })}
    </div>
  );
}
