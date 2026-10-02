/**
 * T25 — bandeau de la démo : « Démo — données fictives » et le bouton « Réinitialiser la démo »,
 * et sa confirmation (feuille du bas, role="alertdialog"). La bande, fine, prolonge l'en-tête
 * vert au-dessus de chaque écran ; le bouton répond au doigt sur toute sa hauteur (44 px).
 *
 * Confirmation : le focus y entre à l'ouverture et n'en sort pas (Tab et Maj+Tab tournent entre
 * ses deux boutons) ; le reste de la page est rendu inerte par ./index.tsx ; à la fermeture
 * (Annuler, Échap, tap sur le voile), le focus revient au bouton « Réinitialiser la démo ».
 */
import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';
import { BoutonPrincipal, BoutonSecondaire } from '../ui/elements.tsx';
import { TEXTE_BANDEAU, TEXTE_REINITIALISER } from './identite.ts';

export interface ProprietesBandeau {
  readonly enCours: boolean;
  readonly surOuvrir: () => void;
  /** Bouton « Réinitialiser la démo » : la confirmation lui rend le focus en se fermant. */
  readonly bouton: RefObject<HTMLButtonElement | null>;
}

export function BandeauDemo({ enCours, surOuvrir, bouton }: ProprietesBandeau) {
  return (
    <div className="demo-bande">
      <span className="demo-etiquette" data-testid="demo-bandeau">
        {TEXTE_BANDEAU}
      </span>
      <button ref={bouton} type="button" className="demo-reinitialiser" data-testid="demo-reinitialiser" disabled={enCours} onClick={surOuvrir}>
        <span className="demo-reinitialiser-pastille">
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {TEXTE_REINITIALISER}
        </span>
      </button>
    </div>
  );
}

export interface ProprietesConfirmation {
  readonly surConfirmer: () => void;
  readonly surAnnuler: () => void;
}

export function ConfirmationDemo({ surConfirmer, surAnnuler }: ProprietesConfirmation) {
  const feuille = useRef<HTMLDivElement>(null);
  const boutons = () => [...(feuille.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];

  useEffect(() => {
    boutons().at(-1)?.focus();
    const touche = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') surAnnuler();
    };
    addEventListener('keydown', touche);
    return () => {
      removeEventListener('keydown', touche);
    };
  }, [surAnnuler]);

  /** Tab et Maj+Tab tournent entre les boutons de la feuille. */
  function garderLeFocus(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key !== 'Tab') return;
    const liste = boutons();
    if (liste.length === 0) return;
    const i = liste.indexOf(document.activeElement as HTMLButtonElement);
    const suivant = e.shiftKey ? (i <= 0 ? liste.length - 1 : i - 1) : i === liste.length - 1 ? 0 : i + 1;
    e.preventDefault();
    liste[suivant]?.focus();
  }

  return (
    <div className="demo-voile" onClick={surAnnuler}>
      <div
        ref={feuille}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="demo-confirmation-titre"
        aria-describedby="demo-confirmation-message"
        className="demo-feuille"
        onKeyDown={garderLeFocus}
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <span className="demo-poignee" aria-hidden="true" />
        <h2 id="demo-confirmation-titre">Réinitialiser la démo ?</h2>
        <p id="demo-confirmation-message">
          Vos essais sur ce téléphone (tâches faites, récoltes notées) sont effacés et la ferme de démonstration revient à son état de départ.
        </p>
        <div className="demo-actions">
          <BoutonPrincipal data-testid="demo-reinitialiser-confirmer" onClick={surConfirmer}>
            Réinitialiser
          </BoutonPrincipal>
          <BoutonSecondaire data-testid="demo-reinitialiser-annuler" onClick={surAnnuler}>
            Annuler
          </BoutonSecondaire>
        </div>
      </div>
    </div>
  );
}
