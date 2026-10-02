/**
 * T18 — réglage « Apparence » de l'onglet Ferme : suivre le téléphone (défaut), ou forcer le
 * thème clair (conseillé en plein soleil) ou sombre. Le choix vaut pour ce téléphone (localStorage,
 * src/ui/theme.ts) et s'applique tout de suite à tous les écrans.
 *
 * Trois grands boutons radio côte à côte (56 px au moins, au gant), radio natif masqué sous son
 * libellé : clavier, lecteur d'écran et clic sur le libellé sans code en plus.
 */
import { useId, useState, type ReactNode } from 'react';
import { appliquerTheme, lireTheme, type ChoixTheme } from '../../ui/theme.ts';
import './apparence.css';

/** Trait 24 × 24 de la couleur du texte. */
function Icone({ children }: { readonly children: ReactNode }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const CHOIX: readonly { readonly id: ChoixTheme; readonly libelle: string; readonly icone: ReactNode }[] = [
  {
    id: 'systeme',
    libelle: 'Comme le téléphone',
    icone: (
      <Icone>
        <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
        <path d="M10.5 18.5h3" />
      </Icone>
    ),
  },
  {
    id: 'clair',
    libelle: 'Clair',
    icone: (
      <Icone>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
      </Icone>
    ),
  },
  {
    id: 'sombre',
    libelle: 'Sombre',
    icone: (
      <Icone>
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
      </Icone>
    ),
  },
];

/** Stockage du navigateur, ou rien si son accès même est refusé (le thème s'applique quand même). */
function stockage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const SANS_STOCKAGE = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };

/** `idTitre` : id de l'intitulé de la carte, qui nomme le groupe de choix. */
export function Apparence({ idTitre }: { readonly idTitre: string }) {
  const nom = useId();
  const [choix, setChoix] = useState<ChoixTheme>(() => lireTheme(stockage() ?? SANS_STOCKAGE));

  function choisir(c: ChoixTheme): void {
    appliquerTheme(c, document, stockage() ?? SANS_STOCKAGE);
    setChoix(c);
  }

  return (
    <div className="apparence">
      <div role="radiogroup" aria-labelledby={idTitre} className="apparence-choix">
        {CHOIX.map((c) => (
          <label key={c.id} className={`apparence-option${choix === c.id ? ' apparence-choisie' : ''}`}>
            <input
              type="radio"
              name={nom}
              value={c.id}
              checked={choix === c.id}
              onChange={() => {
                choisir(c.id);
              }}
            />
            {c.icone}
            <span>{c.libelle}</span>
          </label>
        ))}
      </div>
      <p className="apparence-aide">En plein soleil, le thème clair se lit mieux.</p>
    </div>
  );
}
