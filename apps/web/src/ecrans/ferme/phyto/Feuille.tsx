/**
 * Feuille plein écran des écrans phyto (T52) : un dialogue nommé par son titre, « Fermer » en
 * haut (56 px), Échap ferme. Mêmes classes que « Ma ferme » (../../parcellaire/parcellaire.css).
 */
import { useEffect, useId, useRef, type ReactElement, type ReactNode } from 'react';
import '../../parcellaire/parcellaire.css';

export function Feuille({ titre, surtitre, surFermer, children }: { readonly titre: string; readonly surtitre: string; readonly surFermer: () => void; readonly children: ReactNode }): ReactElement {
  const id = useId();
  const h = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    h.current?.focus();
  }, []);
  return (
    <div className="parc-voile">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className="parc-feuille"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            surFermer();
          }
        }}
      >
        <div className="parc-tete">
          <div className="parc-tete-textes">
            <span className="parc-surtitre">{surtitre}</span>
            <h2 id={id} ref={h} tabIndex={-1}>
              {titre}
            </h2>
          </div>
          <button type="button" aria-label="Fermer" className="parc-fermer" onClick={surFermer}>
            <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="parc-corps">{children}</div>
      </div>
    </div>
  );
}
