/**
 * Vue 3D (T37) — les pastilles numérotées des travaux du jour, au-dessus des planches. Elles ne
 * coûtent AUCUN appel de dessin à la scène (les garde-fous de fluidité de T29b sont tenus à l'appel
 * près) : ce sont de petits disques HTML posés sur la toile, replacés à chaque image dessinée par la
 * projection du point de la planche sur l'écran. Taille fixe à l'écran, donc lisibles de loin ; leur
 * chiffre est du vrai texte, net à toute distance. La pastille du travail choisi est plus grande.
 */
import type { RefObject } from 'react';
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
export function CouchePastilles({ pastilles, actif, couche }: { readonly pastilles: readonly PastilleDessinee[]; readonly actif: string | null; readonly couche: RefObject<HTMLDivElement | null> }) {
  return (
    <div ref={couche} data-testid="pastilles-3d" className="plan3d-pastilles" aria-hidden="true">
      {pastilles.map(({ pastille, retard }) => (
        <span key={pastille.planche} data-planche={pastille.planche} data-actif={pastille.planche === actif ? 'oui' : 'non'} className={retard ? 'plan3d-pastille plan3d-pastille-retard' : 'plan3d-pastille'}>
          {pastille.libelle}
        </span>
      ))}
    </div>
  );
}

const point = new Vector3();

/** Ce que la couche a posé la dernière fois : caméra (matrices), taille de la toile, pastilles. */
interface Pose {
  readonly vue: Float64Array;
  largeur: number;
  hauteur: number;
  pastilles: readonly PastilleDessinee[];
}
const poses = new WeakMap<HTMLElement, Pose>();

/** Recopie les matrices de la caméra dans `vue` ; rend vrai si l'une a changé. */
function cameraChangee(vue: Float64Array, camera: Camera): boolean {
  const monde = camera.matrixWorld.elements;
  const projection = camera.projectionMatrix.elements;
  let change = false;
  for (let i = 0; i < 16; i += 1) {
    const a = monde[i] ?? 0;
    const b = projection[i] ?? 0;
    if (vue[i] !== a || vue[16 + i] !== b) {
      vue[i] = a;
      vue[16 + i] = b;
      change = true;
    }
  }
  return change;
}

/**
 * Replace chaque disque sur l'écran d'après la caméra ; caché derrière la caméra ou hors du cadre.
 * Rien n'est écrit quand ni la caméra, ni la taille de la toile, ni les pastilles n'ont changé depuis
 * le dernier appel (T37b) : la mise en page n'est pas relancée à chaque image.
 */
export function placerPastilles(couche: HTMLElement, camera: Camera, largeur: number, hauteur: number, pastilles: readonly PastilleDessinee[]): void {
  camera.updateMatrixWorld();
  let pose = poses.get(couche);
  if (pose === undefined) {
    pose = { vue: new Float64Array(32).fill(Number.NaN), largeur, hauteur, pastilles };
    poses.set(couche, pose);
  } else if (!cameraChangee(pose.vue, camera) && pose.largeur === largeur && pose.hauteur === hauteur && pose.pastilles === pastilles) return;
  cameraChangee(pose.vue, camera);
  pose.largeur = largeur;
  pose.hauteur = hauteur;
  pose.pastilles = pastilles;
  pastilles.forEach(({ pastille }, i) => {
    const el = couche.children[i];
    if (!(el instanceof HTMLElement)) return;
    point.set(pastille.x, HAUTEUR_PASTILLE_M, pastille.z).project(camera);
    const visible = point.z > -1 && point.z < 1 && Math.abs(point.x) <= 1.05 && Math.abs(point.y) <= 1.05;
    el.style.visibility = visible ? 'visible' : 'hidden';
    if (visible) el.style.transform = `translate(${String(((point.x + 1) / 2) * largeur)}px, ${String(((1 - point.y) / 2) * hauteur)}px) translate(-50%, -50%)`;
  });
}
