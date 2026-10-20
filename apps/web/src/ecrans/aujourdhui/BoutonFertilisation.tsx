/**
 * T54 : le point d'entrée de la saisie d'un apport (fertilisation, amendement) dans l'écran
 * Aujourd'hui — un bouton « Fertilisation » ; la saisie (./fertilisation/) n'est chargée qu'au
 * premier tap, hors du morceau de l'écran. Inactif tant que la base n'est pas ouverte.
 */
import { useState, type ComponentType, type ReactElement } from 'react';
import type { PorteDonnees } from '@planif/sync';
import type { ProprietesSaisieFertilisation } from './fertilisation/index.ts';
import './bouton-fertilisation.css';

export function BoutonFertilisation({ porte, fermeId, aujourdhui }: { readonly porte: PorteDonnees | null; readonly fermeId: string; readonly aujourdhui: string }): ReactElement {
  const [Saisie, setSaisie] = useState<ComponentType<ProprietesSaisieFertilisation> | null>(null);
  const [ouverte, setOuverte] = useState(false);
  function ouvrir(): void {
    setOuverte(true);
    if (Saisie !== null) return;
    import('./fertilisation/index.ts').then(
      (m) => {
        setSaisie(() => m.SaisieFertilisation);
      },
      (e: unknown) => {
        console.error('Saisie d’un apport : chargement impossible', e);
        setOuverte(false);
      },
    );
  }
  return (
    <>
      <button type="button" className="fert-ouvrir" disabled={porte === null} onClick={ouvrir}>
        Fertilisation
      </button>
      {ouverte && Saisie !== null && porte !== null && (
        <Saisie
          porte={porte}
          fermeId={fermeId}
          aujourdhui={aujourdhui}
          surFermer={() => {
            setOuverte(false);
          }}
        />
      )}
    </>
  );
}
