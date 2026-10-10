/**
 * Vue 3D (T32e, Q34, Q35) — la récolte vue de la scène, en calcul PUR : le type de fruit d'une
 * espèce, les planches à récolter (celles qui reçoivent une balise) et la phrase qui les annonce.
 * Ni React, ni three. L'état de récolte lui-même vient du cœur (recolteA), jamais d'ici.
 * Contrat : ./test/contrat-recolte.ts.
 */
import type { PlantsPlanche } from './plants.ts';
import type { SceneFiltree } from './scene.ts';

export type TypeFruit = 'allonge' | 'rond' | 'generique';
/** La couleur mûre se choisit par espèce : la tomate et la fraise ont la même forme, pas la même couleur. */
export type CleFruit = 'courgette' | 'tomate' | 'fraise' | 'generique';

/** Casse, accents et espaces ignorés. */
const normaliser = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();

export function cleDeFruit(espece: string): CleFruit {
  switch (normaliser(espece)) {
    case 'courgette':
      return 'courgette';
    case 'tomate':
      return 'tomate';
    case 'fraise':
    case 'fraisier':
      return 'fraise';
    default:
      return 'generique';
  }
}

const TYPE_PAR_CLE: Readonly<Record<CleFruit, TypeFruit>> = { courgette: 'allonge', tomate: 'rond', fraise: 'rond', generique: 'generique' };

export const typeDeFruit = (espece: string): TypeFruit => TYPE_PAR_CLE[cleDeFruit(espece)];

/** Une planche porte une balise quand elle est « à récolter » et que les filtres ne l'estompent pas (Q35). */
export const aBalise = (p: PlantsPlanche | null, filtre: { readonly estompe: boolean } | undefined): boolean => p !== null && p.recolte.phase === 'a-recolter' && filtre?.estompe === false;

/** Ids des planches « à récolter » non estompées par les filtres, dans l'ordre de la scène. */
export function planchesARecolter(plants: readonly (PlantsPlanche | null)[], filtree: SceneFiltree): readonly string[] {
  const ids: string[] = [];
  plants.forEach((p, i) => {
    if (p !== null && aBalise(p, filtree.volumes[i])) ids.push(p.id);
  });
  return ids;
}

export function phrasePlanchesARecolter(n: number): string {
  if (n <= 0) return 'Aucune planche à récolter';
  return n === 1 ? '1 planche à récolter' : `${String(n)} planches à récolter`;
}
