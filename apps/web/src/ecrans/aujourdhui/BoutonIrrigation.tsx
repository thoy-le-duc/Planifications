/**
 * T57 : le point d'entrée de la saisie d'irrigation dans l'écran Aujourd'hui — un bouton
 * « Irrigation », et « Fertirrigation » (T56 : la même saisie, recette choisie d'avance) ; la saisie (./SaisieIrrigation.tsx) n'est chargée qu'au premier tap, hors du
 * morceau de l'écran. Inactif tant que la base n'est pas ouverte (instantané d'avant la base).
 */
import { useState, type ComponentType, type ReactElement } from 'react';
import type { PorteDonnees } from '@planif/sync';
import type { ProprietesSaisieIrrigation } from './SaisieIrrigation.tsx';
import './bouton-irrigation.css';

export function BoutonIrrigation({ porte, fermeId, aujourdhui }: { readonly porte: PorteDonnees | null; readonly fermeId: string; readonly aujourdhui: string }): ReactElement {
  const [Saisie, setSaisie] = useState<ComponentType<ProprietesSaisieIrrigation> | null>(null);
  /** null : fermée ; sinon ouverte par « Irrigation » (faux) ou « Fertirrigation » (vrai, T56). */
  const [ouverte, setOuverte] = useState<boolean | null>(null);
  function ouvrir(fertirrigation: boolean): void {
    setOuverte(fertirrigation);
    if (Saisie !== null) return;
    import('./SaisieIrrigation.tsx').then(
      (m) => {
        setSaisie(() => m.SaisieIrrigation);
      },
      (e: unknown) => {
        console.error('Saisie d’irrigation : chargement impossible', e);
        setOuverte(null);
      },
    );
  }
  return (
    <>
      <button
        type="button"
        className="irr-ouvrir"
        disabled={porte === null}
        onClick={() => {
          ouvrir(false);
        }}
      >
        <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3c3.5 4.2 6 7.6 6 10.5a6 6 0 0 1-12 0C6 10.6 8.5 7.2 12 3z" />
        </svg>
        Irrigation
      </button>
      <button
        type="button"
        className="irr-ouvrir"
        disabled={porte === null}
        onClick={() => {
          ouvrir(true);
        }}
      >
        <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3c3.5 4.2 6 7.6 6 10.5a6 6 0 0 1-12 0C6 10.6 8.5 7.2 12 3zM9.5 14h5M12 11.5v5" />
        </svg>
        Fertirrigation
      </button>
      {ouverte !== null && Saisie !== null && porte !== null && (
        <Saisie
          porte={porte}
          fermeId={fermeId}
          fertirrigation={ouverte}
          aujourdhui={() => aujourdhui}
          surFermer={() => {
            setOuverte(null);
          }}
        />
      )}
    </>
  );
}
