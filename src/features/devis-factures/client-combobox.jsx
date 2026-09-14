import { useState, useMemo, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Check, UserPlus, Users } from 'lucide-react';
import { suggererClients, normaliserNom } from './client-resolution';

/**
 * Champ combiné « client » — IMPRIMERIE OGOOUÉ
 *
 * On tape librement. Les clients de l'annuaire qui correspondent s'affichent
 * (insensible à la casse ET aux accents : « elan » trouve « Société Élan »).
 * On peut soit en choisir un, soit valider un nom que l'annuaire ne connaît pas.
 *
 * Remplace l'ancien `<input list=...>` + `<datalist>` : le datalist natif ne filtre
 * pas les accents, ne dit pas si l'on est sur un client existant ou sur un nom neuf,
 * et son rendu est irrégulier sur mobile — or l'écran est utilisé au comptoir.
 *
 * Ce composant n'écrit jamais en base. La décision créer/rattacher est prise par
 * `client-resolution.js` au moment de l'enregistrement.
 *
 * @param {object} props
 * @param {Array<object>} props.clients      Annuaire.
 * @param {string} props.value               Nom saisi.
 * @param {(nom: string) => void} props.onChange        Saisie libre (l'appelant retire l'id).
 * @param {(client: object) => void} props.onSelect     Choix d'une fiche existante.
 * @param {boolean} [props.disabled]
 * @param {string} [props.placeholder]
 */
export default function ClientCombobox({ clients, value, onChange, onSelect, disabled, placeholder }) {
  const [ouvert, setOuvert] = useState(false);
  const [indexActif, setIndexActif] = useState(-1);
  const conteneurRef = useRef(null);

  const suggestions = useMemo(() => suggererClients(clients, value, 8), [clients, value]);
  const saisieNormalisee = normaliserNom(value);

  // La saisie change → on repart du haut de la liste.
  useEffect(() => { setIndexActif(-1); }, [value]);

  // Fermeture au clic en dehors (le composant vit dans une Dialog).
  useEffect(() => {
    if (!ouvert) return undefined;
    const auClic = (e) => {
      if (conteneurRef.current && !conteneurRef.current.contains(e.target)) setOuvert(false);
    };
    document.addEventListener('mousedown', auClic);
    return () => document.removeEventListener('mousedown', auClic);
  }, [ouvert]);

  const choisir = (client) => {
    onSelect(client);
    setOuvert(false);
    setIndexActif(-1);
  };

  const auClavier = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOuvert(true);
      setIndexActif((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndexActif((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Enter') {
      if (ouvert && indexActif >= 0 && suggestions[indexActif]) {
        e.preventDefault();
        choisir(suggestions[indexActif]);
      } else {
        setOuvert(false);
      }
    } else if (e.key === 'Escape') {
      // Echap ferme la liste, pas la Dialog : sans stopPropagation, Radix fermerait
      // le formulaire entier et le document en cours de saisie serait perdu.
      if (ouvert) { e.preventDefault(); e.stopPropagation(); setOuvert(false); }
    }
  };

  return (
    <div ref={conteneurRef} className="relative">
      <Input
        value={value}
        disabled={disabled}
        onChange={(e) => { onChange(e.target.value); setOuvert(true); }}
        // onClick et non onFocus : la Dialog place le focus ici a l'ouverture,
        // et la liste masquerait le reste du formulaire des la creation d'un document.
        onClick={() => setOuvert(true)}
        onKeyDown={auClavier}
        placeholder={placeholder || 'Nom du client'}
        autoComplete="off"
        role="combobox"
        aria-expanded={ouvert}
        aria-autocomplete="list"
      />

      {ouvert && suggestions.length > 0 && (
        <ul
          className="absolute z-50 mt-1 max-h-52 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md"
          role="listbox"
        >
          {suggestions.map((c, i) => {
            const exact = normaliserNom(c.nom) === saisieNormalisee;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === indexActif}
                  // onMouseDown plutôt que onClick : le blur de l'input ne doit pas
                  // fermer la liste avant que le clic n'aboutisse.
                  onMouseDown={(e) => { e.preventDefault(); choisir(c); }}
                  onMouseEnter={() => setIndexActif(i)}
                  className={`flex w-full items-center justify-between gap-2 rounded px-2 py-2 text-left text-sm ${
                    i === indexActif ? 'bg-accent text-accent-foreground' : ''
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{c.nom}</span>
                    {c.telephone && <span className="ml-2 text-xs text-muted-foreground">{c.telephone}</span>}
                    {!c.telephone && c.adresse && (
                      <span className="ml-2 truncate text-xs text-muted-foreground">{c.adresse}</span>
                    )}
                  </span>
                  {exact ? (
                    <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  ) : (
                    <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {ouvert && suggestions.length === 0 && saisieNormalisee.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover p-2 shadow-md">
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <UserPlus className="h-3.5 w-3.5 shrink-0" />
            Aucun client de l&apos;annuaire ne correspond.
          </p>
        </div>
      )}
    </div>
  );
}
