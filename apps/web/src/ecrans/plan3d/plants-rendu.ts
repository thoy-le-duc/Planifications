/**
 * Vue 3D (T32b) — la part impérative du rendu des plants, hors de React : les InstancedMesh (un par
 * forme, plus un pour les poteaux), le niveau de détail et la pose des instances. Un objet par vue,
 * créé à son ouverture ; le composant ./Plants.tsx ne fait que le brancher à fiber.
 */
import { Color, Object3D, type BufferGeometry, type InstancedMesh } from 'three';
import type { FormePlant } from '@planif/core/croissance';
import { geometriePlant, geometrieStructure } from './geometries-plants.ts';
import { FORMES, piedsDeGouttiere, plantsVisibles, PLANTS_MAX_TOTAL, type PlantsPlanche } from './plants.ts';
import { hauteurRendue, type Scene, type SceneFiltree } from './scene.ts';

/** Champ vertical de la caméra (degrés), le même que celui de la vue. */
const CHAMP_DEGRES = 40;
/** Un plant très haut (tomate sur sa ficelle) se voit de plus loin qu'il n'est large : sa hauteur compte pour ce quart. */
const HAUTEUR_POUR_LARGEUR = 4;
/** Largeur des pieds de gouttière (échelle horizontale du poteau, m) : de vrais pieds, bien visibles. */
const PIED_GOUTTIERE_M = 1.2;
/** Le feuillage est vert ; la couleur du filtre reste sur la planche (de loin, sur la masse). Décochée, la planche garde sa couleur estompée. */
const VERT_FEUILLAGE = '#4FA55B';
/** Bois des poteaux (pergola, pieds de gouttière). */
const BOIS_POTEAU = '#8A6A48';

/** Ce que la vue écrit sur la toile (attributs `data-*` de T32b). */
export interface BilanPlants {
  readonly plants: number;
  readonly formes: number;
  readonly hauteurs: string;
  readonly semaine: number;
}

/** Hauteur de la planche vue de loin : la dalle, plus la gouttière, plus le feuillage ou la structure. */
export function hauteurDeMasse(base: number, p: PlantsPlanche | null): number {
  return p === null ? base : base + p.surelevationM + Math.max(p.echelleVerticale, p.structureM);
}

/** Capacité d'un InstancedMesh : la puissance de deux au-dessus du besoin, pour ne pas le recréer à chaque semaine. */
export const capacite = (n: number): number => Math.max(64, 2 ** Math.ceil(Math.log2(Math.max(1, n))));

export class RenduPlants {
  private drapeaux = new Uint8Array(0);
  private dalles: (() => void) | null = null;
  private readonly maillages = new Map<FormePlant, InstancedMesh>();
  private poteaux: InstancedMesh | null = null;
  private readonly geometries = new Map<FormePlant, BufferGeometry>();
  private poteau: BufferGeometry | null = null;
  private readonly temporaire = new Object3D();
  private readonly couleur = new Color();

  /** Vrai si les plants de la planche `i` se dessinent en détail (sinon : en masse, ou pas de plants). */
  enDetail(i: number): boolean {
    return this.drapeaux[i] === 1;
  }

  /** La vue donne la fonction qui redessine les dalles des planches (le détail a changé). */
  lierDalles(f: (() => void) | null): void {
    this.dalles = f;
  }

  lierMaillage(forme: FormePlant, m: InstancedMesh | null): void {
    if (m === null) this.maillages.delete(forme);
    else this.maillages.set(forme, m);
  }

  lierPoteaux(m: InstancedMesh | null): void {
    this.poteaux = m;
  }

  geometrie(forme: FormePlant): BufferGeometry {
    let g = this.geometries.get(forme);
    if (g === undefined) {
      g = geometriePlant(forme);
      this.geometries.set(forme, g);
    }
    return g;
  }

  geometriePoteau(): BufferGeometry {
    this.poteau ??= geometrieStructure();
    return this.poteau;
  }

  liberer(): void {
    for (const g of this.geometries.values()) g.dispose();
    this.geometries.clear();
    this.poteau?.dispose();
    this.poteau = null;
  }

  /**
   * Choisit les planches à dessiner en détail depuis la caméra : celles où un plant se voit, dans la
   * limite de PLANTS_MAX_TOTAL plants, les plus proches d'abord. Rend vrai si le choix a changé.
   */
  choisirDetail(scene: Scene, plants: readonly (PlantsPlanche | null)[], x: number, y: number, z: number, hauteurPx: number): boolean {
    const choix = new Uint8Array(plants.length);
    const candidates: { i: number; d: number; n: number }[] = [];
    plants.forEach((p, i) => {
      const v = scene.volumes[i];
      if (p === null || v === undefined) return;
      const d = Math.hypot(v.x - x, y, v.z - z);
      if (plantsVisibles(Math.max(p.echelleHorizontale, p.echelleVerticale / HAUTEUR_POUR_LARGEUR), d, hauteurPx, CHAMP_DEGRES)) candidates.push({ i, d, n: p.nombre });
    });
    candidates.sort((a, b) => a.d - b.d);
    let reste = PLANTS_MAX_TOTAL;
    for (const c of candidates) {
      if (c.n > reste) continue;
      reste -= c.n;
      choix[c.i] = 1;
    }
    const avant = this.drapeaux;
    const pareil = avant.length === choix.length && avant.every((v, i) => v === choix[i]);
    this.drapeaux = choix;
    if (!pareil) this.dalles?.();
    return !pareil;
  }

  private mettre(m: InstancedMesh | null | undefined, i: number, x: number, y: number, z: number, angle: number, ex: number, ey: number, ez: number, c: string): boolean {
    if (m === null || m === undefined || i >= m.instanceMatrix.count) return false;
    const t = this.temporaire;
    t.position.set(x, y, z);
    t.rotation.set(0, angle, 0);
    t.scale.set(ex, ey, ez);
    t.updateMatrix();
    m.setMatrixAt(i, t.matrix);
    m.setColorAt(i, this.couleur.set(c));
    return true;
  }

  /** Repose les instances des planches en détail (formes, poteaux), règle leur compte, et rend le bilan de la vue. */
  poser(scene: Scene, filtree: SceneFiltree, plants: readonly (PlantsPlanche | null)[]): BilanPlants {
    const comptes = new Map<FormePlant, number>();
    let nbPoteaux = 0;
    let total = 0;
    plants.forEach((p, i) => {
      if (p === null || !this.enDetail(i)) return;
      const v = scene.volumes[i];
      const f = filtree.volumes[i];
      if (v === undefined || f === undefined) return;
      const y = hauteurRendue(v) + p.surelevationM;
      const feuillage = f.estompe ? f.couleur : VERT_FEUILLAGE;
      const bois = f.estompe ? f.couleur : BOIS_POTEAU;
      // Étirés le long du rang : une planche se lit comme un rang continu.
      const long = Math.max(p.echelleHorizontale, p.pasM * 1.08);
      for (const pos of p.positions) {
        if (p.echelleVerticale > 0) {
          const n = comptes.get(p.forme) ?? 0;
          if (this.mettre(this.maillages.get(p.forme), n, pos.x, y, pos.z, v.angle, long, p.echelleVerticale, p.echelleHorizontale, feuillage)) {
            comptes.set(p.forme, n + 1);
            total += 1;
          }
        }
        if (p.structureM > 0 && this.mettre(this.poteaux, nbPoteaux, pos.x, y, pos.z, v.angle, p.echelleHorizontale, p.structureM, p.echelleHorizontale, bois)) nbPoteaux += 1;
      }
      if (p.surelevationM > 0) {
        // Les pieds de la gouttière, du premier au dernier bout de la planche.
        const cos = Math.cos(v.angle);
        const sin = Math.sin(v.angle);
        const pieds = piedsDeGouttiere(v.longueur);
        const reste = Math.max(0, v.longueur - PIED_GOUTTIERE_M);
        for (let k = 0; k < pieds; k += 1) {
          const dx = (k / (pieds - 1) - 0.5) * reste;
          if (this.mettre(this.poteaux, nbPoteaux, v.x + dx * cos, 0, v.z - dx * sin, v.angle, PIED_GOUTTIERE_M, p.surelevationM, Math.min(PIED_GOUTTIERE_M, Math.max(v.largeur, 0.3)), bois)) nbPoteaux += 1;
        }
      }
    });
    let formes = 0;
    const regler = (m: InstancedMesh, n: number): void => {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor !== null) m.instanceColor.needsUpdate = true;
    };
    for (const forme of FORMES) {
      const m = this.maillages.get(forme);
      if (m === undefined) continue;
      const n = comptes.get(forme) ?? 0;
      regler(m, n);
      if (n > 0) formes += 1;
    }
    if (this.poteaux !== null) regler(this.poteaux, nbPoteaux);
    // Hauteur du feuillage de chaque planche qui a des plants, quel que soit le détail (m, au centimètre).
    const hauteurs: Record<string, number> = {};
    for (const p of plants) if (p !== null) hauteurs[p.id] = Math.round(p.hauteurM * 100) / 100;
    return { plants: total, formes, hauteurs: JSON.stringify(hauteurs), semaine: scene.semaine };
  }
}
