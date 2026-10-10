/**
 * Vue 3D (T37) — les pastilles numérotées des travaux du jour, au-dessus des planches. Elles ne
 * coûtent AUCUN appel de dessin à la scène (les garde-fous de fluidité de T29b sont tenus à l'appel
 * près) : ce sont de petits disques HTML posés sur la toile, replacés à chaque image dessinée par la
 * projection du point de la planche sur l'écran. Taille fixe à l'écran, donc lisibles de loin ; leur
 * chiffre est du vrai texte, net à toute distance. La pastille du travail choisi est plus grande.
 */
import { Vector3, type Camera } from 'three';
import type { Pastille3d } from './travaux.ts';

/** Hauteur (m) des pastilles au-dessus du sol : au-dessus des plants et de leurs tuteurs. */
export const HAUTEUR_PASTILLE_M = 2.4;

export interface PastilleDessinee {
  readonly pastille: Pastille3d;
  /** Un des travaux de la planche est en retard : pastille orange. */
  readonly retard: boolean;
}

/** Les disques, dans l'ordre de `pastilles` (placerPastilles les retrouve par leur rang). */
export function CouchePastilles({ pastilles, actif }: { readonly pastilles: readonly PastilleDessinee[]; readonly actif: string | null }) {
  return (
    <div data-testid="pastilles-3d" className="plan3d-pastilles" aria-hidden="true">
      {pastilles.map(({ pastille, retard }) => (
        <span key={pastille.planche} data-planche={pastille.planche} data-actif={pastille.planche === actif ? 'oui' : 'non'} className={retard ? 'plan3d-pastille plan3d-pastille-retard' : 'plan3d-pastille'}>
          {pastille.libelle}
        </span>
      ))}
    </div>
  );
}

const point = new Vector3();

/** Replace chaque disque sur l'écran d'après la caméra ; caché derrière la caméra ou hors du cadre. */
export function placerPastilles(couche: HTMLElement, camera: Camera, largeur: number, hauteur: number, pastilles: readonly PastilleDessinee[]): void {
  camera.updateMatrixWorld();
  pastilles.forEach(({ pastille }, i) => {
    const el = couche.children[i];
    if (!(el instanceof HTMLElement)) return;
    point.set(pastille.x, HAUTEUR_PASTILLE_M, pastille.z).project(camera);
    const visible = point.z > -1 && point.z < 1 && Math.abs(point.x) <= 1.05 && Math.abs(point.y) <= 1.05;
    el.style.visibility = visible ? 'visible' : 'hidden';
    if (visible) el.style.transform = `translate(${String(((point.x + 1) / 2) * largeur)}px, ${String(((1 - point.y) / 2) * hauteur)}px) translate(-50%, -50%)`;
  });
}
