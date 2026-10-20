/**
 * Vue 3D (T55) — délai avant récolte (DAR) sur le jumeau : les emplacements sous DAR à la date
 * montrée portent un repère « Ne pas récolter ». Module pur : ni React, ni three, ni horloge.
 * Le calcul est celui du cœur (`enVigueurDesTraitements`, `interdictionRecolte`,
 * `texteInterdiction`, T52) : rien n'est recopié ici. Chargé avec les vannes (T57), à part du
 * morceau 3D (budget `jsVue3dGzKio`). Contrat : ./test/contrat-dar3d.ts.
 */
import { ajouterJours, enVigueurDesTraitements, interdictionRecolte, texteInterdiction, type DateCalendaire } from '@planif/core';
import type { TraitementsDar } from '../aujourdhui/dar.ts';
import type { SceneFiltree, VolumeScene } from './scene.ts';

/** Texte visible du repère. */
export const TEXTE_REPERE_DAR = 'Ne pas récolter';

export interface RepereDar {
  readonly planche: string;
  readonly code: string;
  readonly x: number;
  readonly z: number;
  /** « Récolte interdite jusqu’au 13/05 (Bouillie bordelaise, traité le 10/05) ». */
  readonly texte: string;
  readonly recolteAutoriseeLe: string;
}

/**
 * La date que montre la 3D : son curseur choisit une semaine (`lundi`). Aujourd'hui s'il est dans
 * cette semaine, sinon le lundi ; sans semaine, aujourd'hui.
 */
export function dateAffichee(lundi: string | undefined, aujourdhui: string): string {
  if (lundi === undefined) return aujourdhui;
  return lundi <= aujourdhui && aujourdhui < ajouterJours(lundi as DateCalendaire, 7) ? aujourdhui : lundi;
}

/** Un repère par planche placée sous DAR le `date`, dans l'ordre des volumes. */
export function reperesDar(t: TraitementsDar, volumes: readonly Pick<VolumeScene, 'id' | 'code' | 'x' | 'z' | 'placee'>[], date: string): RepereDar[] {
  // Chaînes résolues une fois, puis seuls les traitements qui interdisent ce jour-là : le cœur
  // n'est appelé, planche par planche, que sur cette courte liste.
  const actifs = enVigueurDesTraitements(t.traitements).filter((x) => x.date <= date && date < x.recolteAutoriseeLe);
  if (actifs.length === 0) return [];
  const reperes: RepereDar[] = [];
  for (const v of volumes) {
    if (!v.placee) continue;
    const i = interdictionRecolte(actifs, [v.id], date);
    if (i !== null) reperes.push({ planche: v.id, code: v.code, x: v.x, z: v.z, texte: texteInterdiction(i, t.noms.get(i.produitPhytoId) ?? 'produit inconnu'), recolteAutoriseeLe: i.recolteAutoriseeLe });
  }
  return reperes;
}

/** Marque `dar: true` les planches sous DAR (la balise « à récolter » s'efface, ./recolte.ts). */
export function marquerDar(filtree: SceneFiltree, planches: ReadonlySet<string>): SceneFiltree {
  if (planches.size === 0) return filtree;
  return { ...filtree, volumes: filtree.volumes.map((v) => (planches.has(v.id) ? { ...v, dar: true } : v)) };
}
