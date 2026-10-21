/**
 * Vue 3D (T61, règle 4) — étiquettes à la demande : un bouton « Étiquettes » ; pressé, le nom de
 * chaque chemin nommé et de chaque bâtiment s'affiche sur la toile (petits éléments HTML posés par
 * la vue avec `placerPastilles`, comme les vannes). Rien n'est affiché à l'ouverture : la 3D reste
 * lisible et légère. Contrat : en-tête de chemins-3d.test.tsx.
 */
import { useState, type ReactElement, type RefObject } from 'react';
import type { EtiquetteScene } from './scene.ts';

export interface ProprietesEtiquettes3d {
  readonly etiquettes: readonly EtiquetteScene[];
  readonly couche: RefObject<HTMLDivElement | null>;
  /** Les étiquettes s'affichent ou se retirent (la vue replace la couche). */
  readonly surBascule?: (ouvertes: boolean) => void;
}

export function Etiquettes3d({ etiquettes, couche, surBascule }: ProprietesEtiquettes3d): ReactElement {
  const [ouvertes, setOuvertes] = useState(false);
  return (
    <>
      <div ref={couche} data-testid="etiquettes-3d" className="plan3d-vannes" aria-hidden={!ouvertes}>
        {ouvertes &&
          etiquettes.map((e) => (
            <span key={`${e.sorte}-${e.id}`} data-testid="etiquette-3d" data-id={e.id} data-sorte={e.sorte} data-x={e.x} data-z={e.z} className="plan3d-etiquette">
              {e.nom}
            </span>
          ))}
      </div>
      <button
        type="button"
        data-testid="bascule-etiquettes-3d"
        aria-pressed={ouvertes}
        className="plan3d-bouton plan3d-bascule-etiquettes"
        onClick={() => {
          setOuvertes((o) => !o);
          surBascule?.(!ouvertes);
        }}
      >
        Étiquettes
      </button>
    </>
  );
}
