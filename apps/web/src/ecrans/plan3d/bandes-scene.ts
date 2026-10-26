/**
 * Vue 3D (T86) : les bandes d'une serre dont la zone a des sous-zones, en repère de scène. Pur : ni React, ni three, ni horloge.
 * Le calcul est celui du cœur (`bandesDeSerre`) ; ici, seulement le passage au repère de la scène (x, −y).
 */
import { bandesDeSerre, depuisRepereZone } from '@planif/core/placement';
import type { BatimentPlan, SousZonePlan } from '../plan/calculs.ts';

/** T86 : la bande d'une sous-zone dans une serre, posée au sol : un rectangle de la famille des bâtiments (largeur selon x local, profondeur selon z local, tourné de `angle`). */
export interface BandeScene {
  /** La sous-zone. */
  readonly id: string;
  readonly nom: string;
  readonly batimentId: string;
  /** Place de la bande dans la serre, de 1 (côté ouest quand la serre est au cap 0°) à `total`. */
  readonly rang: number;
  readonly total: number;
  readonly x: number;
  readonly z: number;
  readonly largeur: number;
  readonly profondeur: number;
  readonly angle: number;
}

const RAD = Math.PI / 180;

/** Une bande par sous-zone directe de chaque zone abritée par une serre (tunnel ou chapelle), même sans planche. */
export function bandesDesSerres(batimentDeZone: ReadonlyMap<string, BatimentPlan>, sousZones: readonly SousZonePlan[]): BandeScene[] {
  const bandes: BandeScene[] = [];
  for (const [zoneId, serre] of batimentDeZone) {
    if (serre.type !== 'serre_tunnel' && serre.type !== 'serre_chapelle') continue;
    // Une sous-zone qui a sa propre serre se dessine par elle.
    const filles = sousZones.filter((s) => s.parenteId === zoneId && !batimentDeZone.has(s.id));
    for (const b of bandesDeSerre(serre, filles)) {
      const c = depuisRepereZone({ centre: serre.centre, orientationDeg: serre.orientationDeg }, b.centre);
      bandes.push({ id: b.id, nom: b.nom, batimentId: serre.id, rang: b.rang, total: b.total, x: c.x, z: -c.y, largeur: b.largeurM, profondeur: b.longueurM, angle: -serre.orientationDeg * RAD });
    }
  }
  return bandes;
}
