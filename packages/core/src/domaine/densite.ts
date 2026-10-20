/**
 * Disposition des rangs d'une densité « écartement » (T35a, Q34) : rangs alignés ou en
 * quinconce. Elle ne change pas le nombre de plants (besoins de T05) : c'est un renseignement
 * de pose, dessiné dans le schéma de l'itinéraire.
 */
import type { Centimetres, Densite, DensiteContenants, DensiteEcartement } from './entites.ts';

/** Plants d'un rang en face de ceux du voisin (`alignee`) ou décalés d'un demi-écartement. */
export type DispositionRangs = 'alignee' | 'quinconce';

export const DISPOSITIONS_RANGS: readonly DispositionRangs[] = ['alignee', 'quinconce'];

/** La disposition de la densité ; absente (itinéraire d'avant T35a) → `alignee`. */
export function dispositionDe(densite: DensiteEcartement): DispositionRangs {
  return densite.disposition ?? 'alignee';
}

// ── Écart entre rangs (T43) ────────────────────────────────────────────────────────────────

/**
 * Bornes de l'écart entre rangs saisi, en cm. Au-delà de la planche, ce n'est qu'un avertissement
 * de l'écran : un rang par planche se règle sur l'entraxe des planches (120 cm, par exemple).
 */
export const ECART_ENTRE_RANGS_MIN_CM = 5;
export const ECART_ENTRE_RANGS_MAX_CM = 200;

/**
 * L'écart entre rangs saisi d'une densité en rangs (écartement, mètre linéaire) ; absent (itinéraire
 * d'avant T43) ou à la volée → null. Renseignement de pose (semoir, traceur) : il ne change pas les
 * besoins de T05.
 */
export function ecartEntreRangsDe(densite: Densite): Centimetres | null {
  if (densite.facon === 'volee' || densite.facon === 'contenants') return null;
  return densite.ecartEntreRangsCm ?? null;
}

// ── Contenants : pains, sacs, pots (T51) ─────────────────────────────────────────────────────

/** Bornes d'une densité en contenants (entiers, bornes comprises) : elles arrêtent une faute de frappe. */
export const BORNES_CONTENANTS = {
  trousParContenantMax: 100,
  plantsParTrouMax: 20,
  grainesParTrouMax: 50,
  /** Pains d'une gouttière (même plafond que l'ancien nombre de places). */
  painsMax: 1_000_000,
} as const;

/** Nombre de pains proposé pour une gouttière : 1 pain par mètre, longueur arrondie, au moins 1. */
export function painsParDefaut(longueurM: number): number {
  if (!Number.isFinite(longueurM) || longueurM <= 0) return 1;
  return Math.max(1, Math.round(longueurM));
}

/** Contenants d'une série : la somme des pains occupés sur ses gouttières. */
export function sommeContenants(pains: readonly number[]): number {
  return pains.reduce((s, n) => s + n, 0);
}

/** Plants posés par trou ; clé absente → 1. */
export function plantsParTrouDe(densite: DensiteContenants): number {
  return densite.plantsParTrou ?? 1;
}
