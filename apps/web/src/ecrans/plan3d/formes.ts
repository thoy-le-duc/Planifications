/**
 * Formes de la vue 3D (T28c) : les géométries three qui servent à toute la ferme, construites une
 * fois et partagées. Un seul arceau, une seule bâche, un seul bout de tunnel (instanciés avec une
 * échelle par serre), un seul toit ; le sol de toutes les zones est UNE géométrie fusionnée.
 * Pas de React ici : ce fichier ne dépend que de three et de la scène (pure), et se teste sous Node.
 */
import { BoxGeometry, BufferGeometry, CircleGeometry, CylinderGeometry, Float32BufferAttribute, Matrix4, ShapeUtils, TorusGeometry, Vector2 } from 'three';
import { coinsRectScene, type PointScene, type SocleScene } from './scene.ts';

/** Contour au sol d'un socle : son contour s'il en a un, sinon son rectangle (tourné). */
export function empreinteDe(s: SocleScene): readonly PointScene[] {
  return s.contour ?? coinsRectScene(s.x, s.z, s.largeur, s.profondeur, s.angle);
}

/**
 * Le sol de toutes les zones en une seule géométrie : pour chaque empreinte, la face du dessus
 * (polygone triangulé, concave compris : un L reste un L) à y = 0, et les flancs jusqu'à
 * y = −epaisseur. Un seul appel de dessin quel que soit le nombre de zones. À dessiner des deux
 * côtés (l'orientation des triangles dépend du sens du contour).
 */
export function geometrieSol(empreintes: readonly (readonly PointScene[])[], epaisseur: number): BufferGeometry {
  const positions: number[] = [];
  const sommet = (x: number, y: number, z: number): void => {
    positions.push(x, y, z);
  };
  for (const e of empreintes) {
    if (e.length < 3) continue;
    const triangles = ShapeUtils.triangulateShape(
      e.map((p) => new Vector2(p.x, p.z)),
      [],
    );
    for (const t of triangles) {
      for (const i of t) {
        const p = e[i];
        if (p !== undefined) sommet(p.x, 0, p.z);
      }
    }
    for (let i = 0; i < e.length; i += 1) {
      const a = e[i];
      const b = e[(i + 1) % e.length];
      if (a === undefined || b === undefined) continue;
      sommet(a.x, 0, a.z);
      sommet(b.x, 0, b.z);
      sommet(b.x, -epaisseur, b.z);
      sommet(a.x, 0, a.z);
      sommet(b.x, -epaisseur, b.z);
      sommet(a.x, -epaisseur, a.z);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return g;
}

/** Cyclique (x, y, z) → (z, x, y) : une rotation, l'axe du cylindre (y) devient z. */
const AXE_Y_VERS_Z = new Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1);

/**
 * Un arceau : demi-cercle de rayon 0,5 dans le plan x-y (de x = −0,5 à 0,5, jusqu'à y = 0,5), tube
 * fin. L'échelle (largeur, 2 × hauteur, ~) en fait l'arceau d'une chapelle.
 */
export function geometrieArceau(): BufferGeometry {
  return new TorusGeometry(0.5, 0.008, 5, 14, Math.PI);
}

/**
 * La bâche d'une chapelle : demi-cylindre ouvert de rayon 0,5, de longueur 1 selon z (de −0,5 à
 * 0,5), face extérieure en avant. Échelle (largeur, 2 × hauteur, profondeur).
 */
export function geometrieBache(): BufferGeometry {
  const g = new CylinderGeometry(0.5, 0.5, 1, 20, 1, true, 0, Math.PI);
  g.applyMatrix4(AXE_Y_VERS_Z);
  return g;
}

/** Le bout d'un tunnel : demi-disque de rayon 0,5 dans le plan x-y, face vers +z. */
export function geometrieBout(): BufferGeometry {
  return new CircleGeometry(0.5, 20, 0, Math.PI);
}

/** Les murs d'un volume simple : un cube unité, posé par l'échelle. */
export function geometrieMurs(): BufferGeometry {
  return new BoxGeometry();
}

/**
 * Le toit d'un volume simple : un prisme à deux pans, de −0,5 à 0,5 en x et en z, du faîtage
 * (y = 1, selon z) à l'égout (y = 0). Échelle (largeur, hauteur du toit, profondeur).
 */
export function geometrieToit(): BufferGeometry {
  // Sections triangulaires en x = ±... : la section est dans le plan x-y, le faîtage court selon z.
  const a = [-0.5, 0, -0.5] as const;
  const b = [0.5, 0, -0.5] as const;
  const c = [0, 1, -0.5] as const;
  const d = [-0.5, 0, 0.5] as const;
  const e = [0.5, 0, 0.5] as const;
  const f = [0, 1, 0.5] as const;
  const sommets = [
    // Pignons.
    ...a, ...c, ...b,
    ...d, ...e, ...f,
    // Pan gauche.
    ...a, ...d, ...f, ...a, ...f, ...c,
    // Pan droit.
    ...b, ...c, ...f, ...b, ...f, ...e,
  ];
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(sommets, 3));
  g.computeVertexNormals();
  return g;
}
