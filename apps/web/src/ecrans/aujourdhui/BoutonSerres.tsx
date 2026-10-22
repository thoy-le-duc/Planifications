/**
 * T58 : l'état des serres dans l'écran Aujourd'hui — le bouton « Serres » et, à partir de 18 h,
 * le rappel « 2 serres encore ouvertes » avec « Voir les serres ». Le panneau (./EtatSerres.tsx)
 * n'est chargé qu'au premier tap, et le rappel (./rappel-serres.ts) après l'affichage de l'écran :
 * ni l'un ni l'autre dans le morceau de l'écran. Inactif tant que la base n'est pas ouverte.
 */
import { useEffect, useState, type ComponentType, type ReactElement } from 'react';
import type { RappelDuSoir } from '@planif/core/abris';
import type { PorteDonnees } from '@planif/sync';
import type { ProprietesEtatSerres } from './EtatSerres.tsx';
import './bouton-serres.css';

interface ProprietesBoutonSerres {
  readonly porte: PorteDonnees | null;
  readonly fermeId: string;
  readonly aujourdhui: string;
  readonly maintenant: () => Date;
}

/** Le rappel du soir de la ferme, suivi dans la base ; null avant 18 h ou sans serre ouverte. */
function useRappelSerres(porte: PorteDonnees | null, fermeId: string, maintenant: () => Date): RappelDuSoir | null {
  const [rappel, setRappel] = useState<RappelDuSoir | null>(null);
  useEffect(() => {
    if (porte === null) return undefined;
    let actif = true;
    let arreter = (): void => undefined;
    import('./rappel-serres.ts').then(
      (m) => {
        if (actif) arreter = m.suivreRappelSerres(porte, fermeId, maintenant, setRappel);
      },
      (e: unknown) => {
        console.error('Rappel des serres : chargement impossible', e);
      },
    );
    return () => {
      actif = false;
      arreter();
    };
  }, [porte, fermeId, maintenant]);
  return rappel;
}

export function BoutonSerres({ porte, fermeId, aujourdhui, maintenant }: ProprietesBoutonSerres): ReactElement {
  const [Panneau, setPanneau] = useState<ComponentType<ProprietesEtatSerres> | null>(null);
  const [ouvert, setOuvert] = useState(false);
  const rappel = useRappelSerres(porte, fermeId, maintenant);
  function ouvrir(): void {
    setOuvert(true);
    if (Panneau !== null) return;
    import('./EtatSerres.tsx').then(
      (m) => {
        setPanneau(() => m.EtatSerres);
      },
      (e: unknown) => {
        console.error('État des serres : chargement impossible', e);
        setOuvert(false);
      },
    );
  }
  return (
    <>
      {rappel !== null && (
        <div data-testid="rappel-serres" role="status" className="serres-rappel">
          <span>{rappel.phrase}</span>
          <button type="button" className="serres-rappel-voir" onClick={ouvrir}>
            Voir les serres
          </button>
        </div>
      )}
      <button type="button" className="serres-ouvrir" disabled={porte === null} onClick={ouvrir}>
        <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 20V11a9 9 0 0 1 18 0v9M3 20h18M12 2v18" />
        </svg>
        Serres
      </button>
      {ouvert && Panneau !== null && porte !== null && (
        <Panneau
          porte={porte}
          fermeId={fermeId}
          aujourdhui={() => aujourdhui}
          maintenant={maintenant}
          surFermer={() => {
            setOuvert(false);
          }}
        />
      )}
    </>
  );
}
