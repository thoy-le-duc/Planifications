/**
 * T61 (règles 3 et 4) : les deux points que la vue 3D surligne pour une consigne « Grelinette —
 * hangar, mur nord » : le lieu de rangement de l'outil et la planche de la tâche. Le chemin le plus
 * court entre les deux n'est PAS calculé (hors du ticket). Pur : ni React, ni three, ni Date.
 * Contrat : ./test/contrat-rangement.ts.
 */
import type { VolumeScene } from './scene.ts';

export interface PointScene {
  readonly x: number;
  readonly z: number;
}

export interface PointsRangement {
  readonly lieu: PointScene & { readonly nom: string };
  readonly planche: (PointScene & { readonly id: string; readonly code: string }) | null;
}

export interface EntreeRangement {
  readonly lieu: { readonly batiment_id: string | null; readonly point_plan_id: string | null };
  readonly batiments: readonly { readonly id: string; readonly nom: string; readonly centre_x_m: number; readonly centre_y_m: number }[];
  readonly pointsPlan: readonly { readonly id: string; readonly nom: string; readonly x_m: number; readonly y_m: number }[];
  readonly volumes: readonly Pick<VolumeScene, 'id' | 'code' | 'x' | 'z' | 'placee'>[];
  readonly plancheId: string | null;
}

/**
 * Repère de la scène : x = est, z = −nord. Le lieu : centre du bâtiment ou position du point du
 * plan ; la planche : son volume, s'il est placé dans la scène. Null si le lieu n'a pas de position.
 */
export function pointsRangement(e: EntreeRangement): PointsRangement | null {
  let lieu: PointsRangement['lieu'] | null = null;
  if (e.lieu.batiment_id !== null) {
    const b = e.batiments.find((x) => x.id === e.lieu.batiment_id);
    if (b !== undefined) lieu = { nom: b.nom, x: b.centre_x_m, z: -b.centre_y_m };
  } else if (e.lieu.point_plan_id !== null) {
    const p = e.pointsPlan.find((x) => x.id === e.lieu.point_plan_id);
    if (p !== undefined) lieu = { nom: p.nom, x: p.x_m, z: -p.y_m };
  }
  if (lieu === null) return null;
  const v = e.plancheId === null ? undefined : e.volumes.find((x) => x.id === e.plancheId && x.placee);
  return { lieu, planche: v === undefined ? null : { id: v.id, code: v.code, x: v.x, z: v.z } };
}
