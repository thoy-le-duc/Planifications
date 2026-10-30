/**
 * T91 (règle 2) : « À placer (n) », la liste des zones que la 3D ne dessine pas faute de contour et de
 * serre. Un tap sur une zone demande d'ouvrir l'éditeur sur elle (le gérant seulement : un équipier lit la
 * liste, rien de plus). Le composant ne touche à rien : c'est la vue qui ouvre l'éditeur. Pas de three ici.
 */
import { useId, useState, type ReactElement } from 'react';

export interface ZoneAPlacerListee {
  readonly id: string;
  readonly nom: string;
}

export interface ProprietesAPlacer {
  readonly zones: readonly ZoneAPlacerListee[];
  /** Vrai pour le gérant : chaque zone est un bouton. */
  readonly gerant: boolean;
  readonly surOuvrir: (zoneId: string) => void;
}

export function APlacer({ zones, gerant, surOuvrir }: ProprietesAPlacer): ReactElement | null {
  const [ouverte, setOuverte] = useState(false);
  const idListe = useId();
  if (zones.length === 0) return null;
  return (
    <div className="plan3d-a-placer">
      <button type="button" data-testid="a-placer-3d" className="plan3d-bouton" aria-expanded={ouverte} aria-controls={idListe} onClick={() => { setOuverte((o) => !o); }}>
        À placer ({zones.length})
      </button>
      {ouverte && (
        <ul id={idListe} data-testid="a-placer-liste" className="plan3d-a-placer-liste" aria-label="Zones à placer">
          {zones.map((z) => (
            <li key={z.id}>
              {gerant ? (
                <button type="button" data-testid="a-placer-zone" data-id={z.id} className="plan3d-bouton" onClick={() => { surOuvrir(z.id); }}>
                  {z.nom}
                </button>
              ) : (
                <span data-testid="a-placer-zone" data-id={z.id}>
                  {z.nom}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
