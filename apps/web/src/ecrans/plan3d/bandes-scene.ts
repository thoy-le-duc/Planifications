/**
 * Vue 3D (T86) : les bandes d'une serre dont la zone a des sous-zones, en repère de scène. Pur : ni React, ni three, ni horloge.
 * Le calcul est celui du cœur ; ici, seulement le passage au repère de la scène (x, −y).
 *
 * T88 : une serre qui a une grille (chapelles × tronçons) se découpe en cases (`casesDeSerre`) ; sans grille, les cases sont les
 * bandes de T86 (une chapelle par sous-zone, un seul tronçon). Une case vide (moins de sous-zones que de cases) a sa limite au
 * sol mais ni nom ni sous-zone.
 */
import { aUneGrille, casesDeSerre, depuisRepereZone } from '@planif/core/placement';
import type { BatimentPlan, SousZonePlan } from '../plan/calculs.ts';

/** T86 : la bande d'une sous-zone dans une serre, posée au sol : un rectangle de la famille des bâtiments (largeur selon x local, profondeur selon z local, tourné de `angle`). */
export interface BandeScene {
  /** La sous-zone ; pour une case vide (T88), « serre:chapelle:tronçon ». */
  readonly id: string;
  /** Nom de la sous-zone ; vide pour une case vide. */
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
  /** T88 : serre en grille seulement, la chapelle (de 1) et le tronçon (de 1) de la case, et le nombre de tronçons de la serre. */
  readonly chapelle?: number;
  readonly troncon?: number;
  readonly nbTroncons?: number;
}

const RAD = Math.PI / 180;

/** Une bande (ou une case, T88) par sous-zone directe de chaque zone abritée par une serre (tunnel ou chapelle), même sans planche. */
export function bandesDesSerres(batimentDeZone: ReadonlyMap<string, BatimentPlan>, sousZones: readonly SousZonePlan[]): BandeScene[] {
  const bandes: BandeScene[] = [];
  for (const [zoneId, serre] of batimentDeZone) {
    if (serre.type !== 'serre_tunnel' && serre.type !== 'serre_chapelle') continue;
    // Une sous-zone qui a sa propre serre se dessine par elle.
    const filles = sousZones.filter((s) => s.parenteId === zoneId && !batimentDeZone.has(s.id));
    const enGrille = aUneGrille(serre);
    const { cases } = casesDeSerre(serre, filles);
    const nbTroncons = cases.reduce((n, c) => Math.max(n, c.troncon), 0);
    const occupees = cases.filter((c) => c.id !== null).length;
    let rang = 0;
    for (const c of cases) {
      if (!enGrille && c.id === null) continue;
      const p = depuisRepereZone({ centre: serre.centre, orientationDeg: serre.orientationDeg }, c.centre);
      const commun = { batimentId: serre.id, x: p.x, z: -p.y, largeur: c.largeurM, profondeur: c.longueurM, angle: -serre.orientationDeg * RAD };
      if (c.id !== null) rang += 1;
      bandes.push({
        id: c.id ?? `${serre.id}:${String(c.chapelle)}:${String(c.troncon)}`,
        nom: c.nom ?? '',
        rang: c.id === null ? 0 : rang,
        total: occupees,
        ...commun,
        ...(enGrille ? { chapelle: c.chapelle, troncon: c.troncon, nbTroncons } : {}),
      });
    }
  }
  return bandes;
}
