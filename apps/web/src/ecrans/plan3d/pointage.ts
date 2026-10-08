/**
 * Quelle zone est sous le pointeur (T29) : un rayon contre les boîtes des socles et des planches,
 * le plus proche gagne. Pur (des nombres, pas de three), importable sous Node.
 * Une planche répond par sa zone : la sélection d'une planche seule est un autre ticket.
 * T28c : une boîte peut être tournée (`angle`, convention de three, autour de son centre) : une
 * serre inclinée se touche là où elle est, pas dans la boîte axée qui l'entoure. Une serre répond
 * par sa zone ; un bâtiment sans zone répond par lui-même (`batimentId`).
 */
import type { Point3 } from './cadrage.ts';

export interface BoiteZone {
  /** Zone touchée ; vide pour un bâtiment qui n'abrite aucune zone de la scène. */
  readonly zoneId: string;
  readonly min: Point3;
  readonly max: Point3;
  /** Rotation autour de la verticale du centre de la boîte (radians) ; absent = 0. */
  readonly angle?: number;
  /** Bâtiment touché, pour le vol vers un bâtiment sans zone. */
  readonly batimentId?: string;
}

/** Distance (en longueurs de `direction`) de l'entrée du rayon dans la boîte, `null` s'il la manque. */
function entreeDuRayon(origineMonde: Point3, directionMonde: Point3, boite: BoiteZone): number | null {
  let origine = origineMonde;
  let direction = directionMonde;
  const angle = boite.angle ?? 0;
  if (angle !== 0) {
    // Le rayon est ramené dans le repère de la boîte (rotation inverse autour de son centre) : la boîte y est droite.
    const cx = (boite.min.x + boite.max.x) / 2;
    const cz = (boite.min.z + boite.max.z) / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dx = origineMonde.x - cx;
    const dz = origineMonde.z - cz;
    origine = { x: cx + dx * cos - dz * sin, y: origineMonde.y, z: cz + dx * sin + dz * cos };
    direction = { x: directionMonde.x * cos - directionMonde.z * sin, y: directionMonde.y, z: directionMonde.x * sin + directionMonde.z * cos };
  }
  let debut = 0;
  let fin = Number.POSITIVE_INFINITY;
  for (const axe of ['x', 'y', 'z'] as const) {
    const o = origine[axe];
    const d = direction[axe];
    const bas = boite.min[axe];
    const haut = boite.max[axe];
    if (d === 0) {
      if (o < bas || o > haut) return null;
      continue;
    }
    const t1 = (bas - o) / d;
    const t2 = (haut - o) / d;
    debut = Math.max(debut, Math.min(t1, t2));
    fin = Math.min(fin, Math.max(t1, t2));
    if (debut > fin) return null;
  }
  return debut;
}

/** La boîte touchée en premier par le rayon, `null` si le rayon ne touche rien. */
export function boiteSousRayon(origine: Point3, direction: Point3, boites: readonly BoiteZone[]): BoiteZone | null {
  let meilleure: { boite: BoiteZone; t: number } | null = null;
  for (const b of boites) {
    const t = entreeDuRayon(origine, direction, b);
    if (t !== null && (meilleure === null || t < meilleure.t)) meilleure = { boite: b, t };
  }
  return (meilleure as { boite: BoiteZone } | null)?.boite ?? null;
}

/** La zone de la boîte touchée en premier par le rayon, `null` si le rayon ne touche rien. */
export function zoneSousRayon(origine: Point3, direction: Point3, boites: readonly BoiteZone[]): string | null {
  return boiteSousRayon(origine, direction, boites)?.zoneId ?? null;
}
