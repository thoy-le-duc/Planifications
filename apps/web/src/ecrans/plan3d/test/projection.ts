/**
 * Projection en perspective pour les tests de T29 (unitaires et e2e) : où tombe un point de la
 * scène à l'écran, vu d'une pose de caméra. Même modèle que three (caméra qui regarde `cible`,
 * verticale y vers le haut, champ VERTICAL en degrés) ; ne dépend d'aucun code de l'appli.
 */
import type { Boite, Point3, Pose } from './contrat-camera.ts';

const moins = (a: Point3, b: Point3): Point3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const produit = (a: Point3, b: Point3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const vectoriel = (a: Point3, b: Point3): Point3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norme = (a: Point3): number => Math.hypot(a.x, a.y, a.z);
const unitaire = (a: Point3): Point3 => {
  const n = norme(a);
  return { x: a.x / n, y: a.y / n, z: a.z / n };
};

export function distance(a: Point3, b: Point3): number {
  return norme(moins(a, b));
}

/** Rotation d'un point (dx, dz) autour de la verticale, comme rotation.y de three. */
export function tourner(dx: number, dz: number, angle: number): { x: number; z: number } {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: dx * c + dz * s, z: -dx * s + dz * c };
}

/** Les 8 coins d'une boîte, après rotation. */
export function coinsDe(boite: Boite): Point3[] {
  const cx = (boite.min.x + boite.max.x) / 2;
  const cz = (boite.min.z + boite.max.z) / 2;
  const angle = boite.angle ?? 0;
  const coins: Point3[] = [];
  for (const x of [boite.min.x, boite.max.x]) {
    for (const y of [boite.min.y, boite.max.y]) {
      for (const z of [boite.min.z, boite.max.z]) {
        const r = tourner(x - cx, z - cz, angle);
        coins.push({ x: cx + r.x, y, z: cz + r.z });
      }
    }
  }
  return coins;
}

export interface Projection {
  /** Coordonnées d'écran normalisées, −1…1 (x vers la droite, y vers le haut). */
  readonly x: number;
  readonly y: number;
  /** Distance devant la caméra (négative : derrière). */
  readonly profondeur: number;
}

export function projeter(pose: Pose, champVertical: number, rapportEcran: number, point: Point3): Projection {
  const avant = unitaire(moins(pose.cible, pose.position));
  const droite = unitaire(vectoriel(avant, { x: 0, y: 1, z: 0 }));
  const haut = vectoriel(droite, avant);
  const d = moins(point, pose.position);
  const profondeur = produit(d, avant);
  const t = Math.tan((champVertical * Math.PI) / 360);
  return { x: produit(d, droite) / (profondeur * t * rapportEcran), y: produit(d, haut) / (profondeur * t), profondeur };
}

/** Pixel d'une toile de `largeur` × `hauteur` (origine en haut à gauche). */
export function versPixel(p: Projection, largeur: number, hauteur: number): { x: number; y: number } {
  return { x: ((p.x + 1) / 2) * largeur, y: ((1 - p.y) / 2) * hauteur };
}

/** Le plus grand |x| ou |y| d'écran parmi les coins ; Infinity si un coin est derrière la caméra. */
export function etendueEcran(pose: Pose, champVertical: number, rapportEcran: number, boite: Boite): number {
  let pire = 0;
  for (const coin of coinsDe(boite)) {
    const p = projeter(pose, champVertical, rapportEcran, coin);
    if (!(p.profondeur > 0)) return Number.POSITIVE_INFINITY;
    pire = Math.max(pire, Math.abs(p.x), Math.abs(p.y));
  }
  return pire;
}
