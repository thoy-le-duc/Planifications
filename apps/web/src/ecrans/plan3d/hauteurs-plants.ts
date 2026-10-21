/**
 * Vue 3D (T32b, T32f) — hauteur rendue des dalles des planches, avec ou sans plants. Dans son propre
 * module (T71) : les planches (Vue3d.tsx) s'en servent dès le premier affichage, alors que le
 * rendu des plants (./plants-rendu.ts, qui les réexporte) se charge à la demande, avec la couche
 * des plants (./couche-plants.ts). Ni three ni React ici.
 */
import type { PlantsPlanche } from './plants.ts';

/** Hauteur de la planche vue de loin : la dalle, plus la gouttière, plus le feuillage ou la structure. */
export function hauteurDeMasse(base: number, p: PlantsPlanche | null): number {
  return p === null ? base : base + p.surelevationM + Math.max(p.echelleVerticale, p.structureM);
}

/**
 * Épaisseur de la dalle d'une planche qui porte des plants, vue de près (m de scène) : les jeunes plants
 * ne s'enfouissent plus. 1/32 m (3,1 cm), exactement représentable en flottant 32 bits : la pose des instances ne l'arrondit pas.
 */
export const EPAISSEUR_DALLE_PLANTS_M = 0.03125;

/** Hauteur rendue de la dalle EN DÉTAIL : fine quand elle porte des plants, inchangée sinon. */
export function hauteurDalle(base: number, p: PlantsPlanche | null): number {
  return p === null ? base : Math.min(base, EPAISSEUR_DALLE_PLANTS_M);
}
