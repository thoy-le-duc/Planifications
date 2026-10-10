/**
 * Vue 3D (T37) — la part légère des travaux du jour : le type d'un travail et le choix du suivant.
 * Séparée de ./travaux.ts (qui lit et calcule avec le moteur de l'écran Aujourd'hui) pour que le
 * panneau n'attire pas ce moteur dans le morceau 3D : il se charge à part, à l'ouverture de la 3D.
 */

/** Un travail du jour, tel que le panneau le liste. */
export interface Travail3d {
  /** 1, 2, 3… dans l'ordre de l'écran Aujourd'hui. */
  readonly rang: number;
  /** TacheJour.cle. */
  readonly cle: string;
  /** « 2. Grelinette batavia — Tunnel 2, T2-P01 ». */
  readonly texte: string;
  /** Id de la planche placée visée, ou null. */
  readonly planche: string | null;
  readonly enRetard: boolean;
}

/** Rang du travail à montrer après `actif` (les travaux sans planche sont sautés), en boucle ; null s'il n'y en a aucun. */
export function travailSuivant(travaux: readonly Travail3d[], actif: number | null): number | null {
  const volables = travaux.filter((t) => t.planche !== null);
  if (volables.length === 0) return null;
  if (actif === null) return volables[0]?.rang ?? null;
  const apres = volables.find((t) => t.rang > actif);
  return (apres ?? volables[0])?.rang ?? null;
}
