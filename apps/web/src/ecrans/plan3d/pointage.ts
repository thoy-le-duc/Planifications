/**
 * Quelle zone est sous le pointeur (T29) : un rayon contre les boîtes des socles et des planches,
 * le plus proche gagne. Pur (des nombres, pas de three), importable sous Node.
 * Une planche répond par sa zone : la sélection d'une planche seule est un autre ticket.
 */
import type { Point3 } from './cadrage.ts';

export interface BoiteZone {
  readonly zoneId: string;
  readonly min: Point3;
  readonly max: Point3;
}

/** Distance (en longueurs de `direction`) de l'entrée du rayon dans la boîte, `null` s'il la manque. */
function entreeDuRayon(origine: Point3, direction: Point3, boite: BoiteZone): number | null {
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

/** La zone de la boîte touchée en premier par le rayon, `null` si le rayon ne touche rien. */
export function zoneSousRayon(origine: Point3, direction: Point3, boites: readonly BoiteZone[]): string | null {
  let meilleure: { zoneId: string; t: number } | null = null;
  for (const b of boites) {
    const t = entreeDuRayon(origine, direction, b);
    if (t !== null && (meilleure === null || t < meilleure.t)) meilleure = { zoneId: b.zoneId, t };
  }
  return (meilleure as { zoneId: string } | null)?.zoneId ?? null;
}
