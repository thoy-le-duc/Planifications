/**
 * Vue 3D (T37) — les pastilles numérotées des travaux du jour, au-dessus des planches. UN SEUL
 * appel de dessin pour toutes : un nuage de points (THREE.Points) dont chaque point est un disque
 * de taille fixe à l'écran (lisible de loin, comme la balise de récolte), ses chiffres pris dans
 * un atlas dessiné une fois sur un canvas 2D. Aucun triangle. La pastille du travail choisi est
 * plus grande et cerclée de blanc.
 */
import { useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, CanvasTexture, NearestFilter, ShaderMaterial } from 'three';
import { COULEURS } from '../../ui/jetons.ts';
import type { Pastille3d } from './travaux.ts';

/** Hauteur (m) des pastilles au-dessus du sol : au-dessus des plants et de leurs tuteurs. */
export const HAUTEUR_PASTILLE_M = 2.4;
/** Diamètre à l'écran (px CSS) : normal, et pour le travail choisi. */
const TAILLE_PX = 52;
const TAILLE_ACTIVE_PX = 72;
/** Cellule de l'atlas (px) et nombre de colonnes. */
const CELLULE = 128;
const COLONNES = 8;

export interface PastilleDessinee {
  readonly pastille: Pastille3d;
  /** Un des travaux de la planche est en retard : pastille orange. */
  readonly retard: boolean;
}

const VERTEX = `
attribute float cellule;
attribute float taille;
uniform float echelle;
varying float vCellule;
void main() {
  vCellule = cellule;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = taille * echelle;
}`;

const FRAGMENT = `
uniform sampler2D atlas;
uniform vec2 grille;
varying float vCellule;
void main() {
  float c = floor(vCellule + 0.5);
  vec2 g = vec2(mod(c, grille.x), floor(c / grille.x));
  vec4 t = texture2D(atlas, (g + gl_PointCoord) / grille);
  if (t.a < 0.04) discard;
  gl_FragColor = t;
}`;

/** Dessine l'atlas : un disque et son libellé par cellule. */
function dessinerAtlas(pastilles: readonly PastilleDessinee[]): HTMLCanvasElement | null {
  const toile = document.createElement('canvas');
  const lignes = Math.max(1, Math.ceil(pastilles.length / COLONNES));
  toile.width = COLONNES * CELLULE;
  toile.height = lignes * CELLULE;
  const c = toile.getContext('2d');
  if (c === null) return null;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  pastilles.forEach(({ pastille, retard }, i) => {
    const x = (i % COLONNES) * CELLULE + CELLULE / 2;
    const y = Math.floor(i / COLONNES) * CELLULE + CELLULE / 2;
    c.beginPath();
    c.arc(x, y, CELLULE / 2 - 3, 0, Math.PI * 2);
    c.fillStyle = COULEURS.surface;
    c.fill();
    c.beginPath();
    c.arc(x, y, CELLULE / 2 - 12, 0, Math.PI * 2);
    c.fillStyle = retard ? COULEURS.orange : COULEURS.foret;
    c.fill();
    c.fillStyle = retard ? COULEURS.surOrange : COULEURS.surForet;
    const taille = pastille.libelle.length <= 2 ? 64 : pastille.libelle.length <= 5 ? 42 : 30;
    c.font = `700 ${String(taille)}px system-ui, sans-serif`;
    c.fillText(pastille.libelle, x, y + 2, CELLULE - 34);
  });
  return toile;
}

export function Pastilles({ pastilles, actif }: { readonly pastilles: readonly PastilleDessinee[]; readonly actif: string | null }) {
  const invalider = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  const geometrie = useMemo(() => {
    const g = new BufferGeometry();
    const positions = new Float32Array(pastilles.length * 3);
    pastilles.forEach(({ pastille }, i) => {
      positions.set([pastille.x, HAUTEUR_PASTILLE_M, pastille.z], i * 3);
    });
    g.setAttribute('position', new BufferAttribute(positions, 3));
    g.setAttribute('cellule', new BufferAttribute(Float32Array.from(pastilles.map((_, i) => i)), 1));
    g.setAttribute('taille', new BufferAttribute(Float32Array.from(pastilles.map(({ pastille }) => (pastille.planche === actif ? TAILLE_ACTIVE_PX : TAILLE_PX))), 1));
    return g;
  }, [pastilles, actif]);
  const atlas = useMemo(() => {
    const toile = dessinerAtlas(pastilles);
    if (toile === null) return null;
    const t = new CanvasTexture(toile);
    t.flipY = false;
    t.generateMipmaps = false;
    t.minFilter = NearestFilter;
    t.magFilter = NearestFilter;
    return t;
  }, [pastilles]);
  const materiau = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: { atlas: { value: atlas }, grille: { value: [COLONNES, Math.max(1, Math.ceil(pastilles.length / COLONNES))] }, echelle: { value: gl.getPixelRatio() } },
      }),
    [atlas, pastilles.length, gl],
  );
  useEffect(
    () => () => {
      geometrie.dispose();
    },
    [geometrie],
  );
  useEffect(
    () => () => {
      atlas?.dispose();
      materiau.dispose();
    },
    [atlas, materiau],
  );
  // Rendu à la demande : une nouvelle pastille, ou un autre travail choisi, demande l'image.
  useLayoutEffect(() => {
    invalider();
  }, [geometrie, materiau, invalider]);
  if (pastilles.length === 0 || atlas === null) return null;
  return <points args={[geometrie, materiau]} frustumCulled={false} renderOrder={10} />;
}
