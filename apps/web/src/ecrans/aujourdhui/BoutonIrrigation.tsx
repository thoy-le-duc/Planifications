/**
 * T57 : le point d'entrée de la saisie d'irrigation dans l'écran Aujourd'hui — un bouton
 * « Irrigation » ; la saisie (./SaisieIrrigation.tsx) n'est chargée qu'au premier tap, hors du
 * morceau de l'écran. Inactif tant que la base n'est pas ouverte (instantané d'avant la base).
 */
import { useState, type ComponentType, type ReactElement } from 'react';
import type { PorteDonnees } from '@planif/sync';
import type { ProprietesSaisieIrrigation } from './SaisieIrrigation.tsx';

export function BoutonIrrigation({ porte, fermeId, aujourdhui }: { readonly porte: PorteDonnees | null; readonly fermeId: string; readonly aujourdhui: string }): ReactElement {
  const [Saisie, setSaisie] = useState<ComponentType<ProprietesSaisieIrrigation> | null>(null);
  const [ouverte, setOuverte] = useState(false);
  function ouvrir(): void {
    setOuverte(true);
    if (Saisie !== null) return;
    import('./SaisieIrrigation.tsx').then(
      (m) => {
        setSaisie(() => m.SaisieIrrigation);
      },
      (e: unknown) => {
        console.error('Saisie d’irrigation : chargement impossible', e);
        setOuverte(false);
      },
    );
  }
  return (
    <>
      <button type="button" className="auj-bouton-secondaire" disabled={porte === null} onClick={ouvrir}>
        Irrigation
      </button>
      {ouverte && Saisie !== null && porte !== null && (
        <Saisie
          porte={porte}
          fermeId={fermeId}
          aujourdhui={() => aujourdhui}
          surFermer={() => {
            setOuverte(false);
          }}
        />
      )}
    </>
  );
}
