/**
 * T40b — aide après un refus de la fenêtre d'installation : l'invitation ne se réutilise pas, le
 * menu du navigateur (⋮) la remplace. Chargée à la demande (./Installer.tsx), jamais au démarrage.
 */
import { useEffect, useRef } from 'react';
import type { ProprietesAide } from './Installer.tsx';
import './aide-ios.css';

export default function AideAndroid({ surFermer }: ProprietesAide) {
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
      <div role="dialog" aria-modal="true" aria-label="Installer depuis le navigateur" className="installation-aide">
        <h2 className="installation-aide-titre">Installer depuis le navigateur</h2>
        <ol className="installation-etapes">
          <li>
            <span>
              Touchez le menu <strong>⋮</strong>, en haut à droite de Chrome.
            </span>
          </li>
          <li>
            <span>
              Puis <strong>Installer l’application</strong> (ou <strong>Ajouter à l’écran d’accueil</strong>).
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
