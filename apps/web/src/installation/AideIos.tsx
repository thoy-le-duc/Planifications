/**
 * T40 — aide iPhone / iPad : Safari n'a pas d'API d'installation, on montre le geste. Chargée à
 * la demande (./Installer.tsx), jamais au démarrage.
 */
import { useEffect, useRef } from 'react';
import type { ProprietesAide } from './Installer.tsx';
import './aide-ios.css';

function IconePartager() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12M8 7l4-4 4 4" />
      <path d="M7 10H5.5A1.5 1.5 0 0 0 4 11.5v8A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5v-8a1.5 1.5 0 0 0-1.5-1.5H17" />
    </svg>
  );
}

function IconeAjouter() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

export default function AideIos({ surFermer }: ProprietesAide) {
  const bouton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    bouton.current?.focus();
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === 'Escape') surFermer();
    };
    document.addEventListener('keydown', surTouche);
    return () => {
      document.removeEventListener('keydown', surTouche);
    };
  }, [surFermer]);
  return (
    <div className="installation-voile">
      <div role="dialog" aria-modal="true" aria-label="Installer sur l’iPhone" className="installation-aide">
        <h2 className="installation-aide-titre">Installer sur l’iPhone</h2>
        <ol className="installation-etapes">
          <li>
            <span className="installation-pictogramme">
              <IconePartager />
            </span>
            <span>
              Touchez <strong>Partager</strong>, en bas de Safari (en haut sur iPad).
            </span>
          </li>
          <li>
            <span className="installation-pictogramme">
              <IconeAjouter />
            </span>
            <span>
              Puis <strong>Sur l’écran d’accueil</strong>, et <strong>Ajouter</strong>.
            </span>
          </li>
        </ol>
        <button ref={bouton} type="button" className="installation-aide-compris" onClick={surFermer}>
          Compris
        </button>
      </div>
    </div>
  );
}
