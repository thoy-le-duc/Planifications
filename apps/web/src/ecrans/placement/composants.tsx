/**
 * Petits composants de l'éditeur de placement (T28b) : champ numérique, fenêtre de confirmation
 * ou de saisie, piège à focus. Aucune dépendance au reste de l'appli.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';

const FOCALISABLES = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Tab reste dans l'élément courant (fenêtre modale, éditeur). */
export function garderLeFocus(e: KeyboardEvent<HTMLElement>): void {
  if (e.key !== 'Tab') return;
  const elements = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCALISABLES)];
  const premier = elements[0];
  const dernier = elements.at(-1);
  if (premier === undefined || dernier === undefined) return;
  const actif = document.activeElement;
  if (e.shiftKey && (actif === premier || !e.currentTarget.contains(actif))) {
    e.preventDefault();
    dernier.focus();
  } else if (!e.shiftKey && (actif === dernier || !e.currentTarget.contains(actif))) {
    e.preventDefault();
    premier.focus();
  }
}

const formater = (v: number): string => String(Math.round(v * 1000) / 1000);

export interface ProprietesChamp {
  readonly etiquette: string;
  readonly valeur: number;
  readonly surChange: (valeur: number) => void;
  readonly desactive: boolean;
}

/**
 * Champ numérique : le texte tapé est gardé tel quel tant qu'il vaut la valeur (« 4. » reste
 * « 4. »), la valeur n'est donnée qu'à un nombre complet, et un champ laissé invalide revient à
 * la valeur courante en le quittant.
 */
export function Champ({ etiquette, valeur, surChange, desactive }: ProprietesChamp): ReactElement {
  const id = useId();
  // Texte tapé, et la valeur qu'il donne : tant que le champ vaut cette valeur, le texte reste tel quel.
  const [saisie, setSaisie] = useState<{ readonly texte: string; readonly valeur: number } | null>(null);
  const affiche = saisie !== null && Math.abs(saisie.valeur - valeur) < 5e-4 ? saisie.texte : formater(valeur);
  return (
    <div className="pl-champ">
      <label htmlFor={id}>{etiquette}</label>
      <input
        id={id}
        type="number"
        step="any"
        inputMode="decimal"
        value={affiche}
        disabled={desactive}
        onChange={(e) => {
          const texte = e.target.value;
          const n = Number(texte);
          const complet = texte.trim() !== '' && Number.isFinite(n);
          setSaisie({ texte, valeur: complet ? n : valeur });
          if (complet) surChange(n);
        }}
        onBlur={() => {
          setSaisie(null);
        }}
      />
    </div>
  );
}

export interface ProprietesModale {
  readonly role: 'dialog' | 'alertdialog';
  readonly titre: string;
  readonly surEchap: () => void;
  readonly children: ReactNode;
}

/** Fenêtre par-dessus l'éditeur : le focus y entre, y reste, et Échap la referme. */
export function Modale({ role, titre, surEchap, children }: ProprietesModale): ReactElement {
  const idTitre = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('input, select, button')?.focus();
  }, []);
  return (
    <div className="pl-voile-modale">
      <div
        ref={ref}
        role={role}
        aria-modal="true"
        aria-labelledby={idTitre}
        className="pl-modale"
        onKeyDown={(e) => {
          garderLeFocus(e);
          if (e.key === 'Escape') surEchap();
          // Rien de ce qui se tape dans la fenêtre n'atteint l'éditeur (Ctrl+Z, Tab).
          e.stopPropagation();
        }}
      >
        <h3 id={idTitre}>{titre}</h3>
        {children}
      </div>
    </div>
  );
}
