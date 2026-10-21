/**
 * Avertissements de volume (T72), partagés par la saisie d'un apport (Aujourd'hui) et les recettes
 * de fertirrigation (Ferme) : un liquide compté en L ou m³ pèse volume × densité ; sans densité,
 * 1 kg/L est supposé ; un solide compté en volume n'a pas d'unités calculées. Jamais bloquant.
 */
import type { FormeFertilisant } from '@planif/core';

export const TEXTE_DENSITE_SUPPOSEE = 'densité non renseignée : 1 kg/L supposé';
export const TEXTE_SOLIDE_EN_VOLUME = 'produit solide saisi en volume : pas d’unités comptées, saisissez en kg ou t';

export interface AvertissementVolume {
  /** 'solide' : unités non comptées (à corriger) ; 'densite' : 1 kg/L supposé (à renseigner). */
  readonly sorte: 'solide' | 'densite';
  readonly texte: string;
}

/** Le produit (null : texte libre) compté dans cette unité appelle-t-il un avertissement ? */
export function avertissementVolume(produit: { readonly forme: FormeFertilisant; readonly densiteKgParL: number | null } | null, unite: string): AvertissementVolume | null {
  if (produit === null || !['l', 'm3', 'm³'].includes(unite.trim().toLowerCase())) return null;
  if (produit.forme === 'solide') return { sorte: 'solide', texte: TEXTE_SOLIDE_EN_VOLUME };
  return produit.densiteKgParL === null ? { sorte: 'densite', texte: TEXTE_DENSITE_SUPPOSEE } : null;
}
