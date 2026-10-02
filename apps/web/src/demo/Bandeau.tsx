/**
 * T25 — bandeau de la démo : « Démo — données fictives » et le bouton « Réinitialiser la démo »,
 * avec sa confirmation (feuille du bas, role="alertdialog"). Une bande fine au-dessus de
 * l'en-tête, dans le vert de l'appli : présente sur chaque écran, sans rien masquer.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { BoutonPrincipal, BoutonSecondaire } from '../ui/elements.tsx';
import { TEXTE_BANDEAU, TEXTE_REINITIALISER } from './identite.ts';

export interface ProprietesBandeau {
  /** Efface la base de la démo et la remplit à nouveau (rechargement de la page). */
  readonly surReinitialiser: () => void;
}

function Confirmation({ surConfirmer, surAnnuler }: { readonly surConfirmer: () => void; readonly surAnnuler: () => void }) {
  const feuille = useRef<HTMLDivElement>(null);
  useEffect(() => {
    feuille.current?.querySelector<HTMLButtonElement>('[data-testid="demo-reinitialiser-annuler"]')?.focus();
    const touche = (e: KeyboardEvent) => {
      if (e.key === 'Escape') surAnnuler();
    };
    addEventListener('keydown', touche);
    return () => {
      removeEventListener('keydown', touche);
    };
  }, [surAnnuler]);
  return (
    <div className="demo-voile" onClick={surAnnuler}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="demo-confirmation-titre"
        aria-describedby="demo-confirmation-message"
        className="demo-feuille"
        ref={feuille}
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

export function BandeauDemo({ surReinitialiser }: ProprietesBandeau) {
  const [confirmer, setConfirmer] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const annuler = useCallback(() => {
    setConfirmer(false);
  }, []);
  return (
    <>
      <div className="demo-bande">
        <span className="demo-etiquette" data-testid="demo-bandeau">
          {TEXTE_BANDEAU}
        </span>
        <button
          type="button"
          className="demo-reinitialiser"
          data-testid="demo-reinitialiser"
          disabled={enCours}
          onClick={() => {
            setConfirmer(true);
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {TEXTE_REINITIALISER}
        </button>
      </div>
      {confirmer && (
        <Confirmation
          surAnnuler={annuler}
          surConfirmer={() => {
            setConfirmer(false);
            setEnCours(true);
            surReinitialiser();
          }}
        />
      )}
    </>
  );
}
