/**
 * Vue 3D (T32b) — la part impérative du rendu des plants, hors de React : les InstancedMesh (un par
 * forme, plus un pour les poteaux), le niveau de détail et la pose des instances. Un objet par vue,
 * créé à son ouverture ; le composant ./Plants.tsx ne fait que le brancher à fiber.
 */
import { Color, Object3D, type BufferGeometry, type InstancedMesh } from 'three';
import type { FormePlant } from '@planif/core/croissance';
import { geometrieFruit, geometriePlant, geometrieStructure, geometrieTuteur } from './geometries-plants.ts';
import { FORMES, FRUITS_MAX_TOTAL, piedsDeGouttiere, plantsVisibles, PLANTS_MAX_TOTAL, type PlantsPlanche } from './plants.ts';
import { aBalise, type CleFruit, type TypeFruit } from './recolte.ts';
import {
  COULEUR_BALISE_RECOLTE_3D,
  COULEUR_BOIS_3D,
  COULEUR_COURGETTE_MURE_3D,
  COULEUR_FEUILLAGE_3D,
  COULEUR_FEUILLAGE_JAUNI_3D,
  COULEUR_FRAISE_MURE_3D,
  COULEUR_FRUIT_GENERIQUE_MUR_3D,
  COULEUR_FRUIT_VERT_3D,
  COULEUR_TOMATE_MURE_3D,
} from '../../ui/jetons.ts';
import { hauteurRendue, type Scene, type SceneFiltree } from './scene.ts';

/** Champ vertical de la caméra (degrés), le même que celui de la vue. */
const CHAMP_DEGRES = 40;
/** Un plant très haut (tomate sur sa ficelle) se voit de plus loin qu'il n'est large : sa hauteur compte pour ce quart. */
const HAUTEUR_POUR_LARGEUR = 4;
/** Largeur des pieds de gouttière (échelle horizontale du poteau, m) : de vrais pieds, bien visibles. */
const PIED_GOUTTIERE_M = 1.2;
/** Le feuillage est vert ; la couleur du filtre reste sur la planche (de loin, sur la masse). Décochée, la planche garde sa couleur estompée. */
const VERT_FEUILLAGE = COULEUR_FEUILLAGE_3D;
/** Bois des poteaux (pergola, pieds de gouttière). */
const BOIS_POTEAU = COULEUR_BOIS_3D;

/** Couleur mûre du fruit selon l'espèce. */
const COULEUR_MURE: Readonly<Record<CleFruit, string>> = {
  courgette: COULEUR_COURGETTE_MURE_3D,
  tomate: COULEUR_TOMATE_MURE_3D,
  fraise: COULEUR_FRAISE_MURE_3D,
  generique: COULEUR_FRUIT_GENERIQUE_MUR_3D,
};
/** Proportions (longueur, hauteur, largeur) de l'échelle d'un fruit de plus grand axe 1 : courgette allongée, tomate et fraise rondes. */
const PROPORTIONS_FRUIT: Readonly<Record<TypeFruit, readonly [number, number, number]>> = { allonge: [1, 0.3, 0.3], rond: [1, 0.95, 0.95], generique: [1, 0.85, 0.85] };
/** Part de la hauteur du plant où les fruits se posent, selon leur rang sur le plant (de bas en haut). */
const NIVEAUX_FRUIT = [0.25, 0.4, 0.55, 0.35] as const;
/** Part de la largeur du plant dont le fruit sort du feuillage (pour qu'il se voie). */
const SORTIE_FRUIT = 0.4;
/** Part du pas de rang sur laquelle les fruits d'un plant s'étalent. */
const ETALEMENT_FRUIT = 0.7;
/** Balise « à récolter » : plus petite taille (m, près de la planche), part de la distance à la caméra (elle grandit de loin pour rester lisible), plus grande taille (m). */
export const BALISE_MIN_M = 0.6;
const BALISE_PART_DISTANCE = 1 / 40;
const BALISE_MAX_M = 8;
/** Pas géométrique des tailles de balise : elle ne se repose que lorsque la caméra s'éloigne ou s'approche d'un cran. */
const BALISE_CRAN = 1.2;
/** Jeu entre le haut du feuillage et le bas de la balise, en part de sa taille. */
const BALISE_JEU = 0.25;

/** Taille d'une balise vue d'une distance `d` (m), par crans. */
export function tailleBalise(d: number): number {
  const brute = Math.min(BALISE_MAX_M, Math.max(BALISE_MIN_M, d * BALISE_PART_DISTANCE));
  return BALISE_MIN_M * BALISE_CRAN ** Math.round(Math.log(brute / BALISE_MIN_M) / Math.log(BALISE_CRAN));
}

/** Ce que la vue écrit sur la toile (attributs `data-*` de T32b). */
export interface BilanPlants {
  readonly plants: number;
  readonly formes: number;
  /** Tuteurs posés (un par plant de tomate et des autres formes `erige-tuteure`). */
  readonly tuteurs: number;
  readonly hauteurs: string;
  readonly semaine: number;
  /** Fruits posés (T32e), planches en détail seulement. */
  readonly fruits: number;
  /** Balises « à récolter » posées (T32e), en détail ou non. */
  readonly balises: number;
}

interface BalisePosee {
  readonly x: number;
  readonly z: number;
  /** Haut du feuillage de la planche. */
  readonly masse: number;
  /** Taille posée (m), par crans de la distance à la caméra. */
  taille: number;
}

/** Hauteur de la planche vue de loin : la dalle, plus la gouttière, plus le feuillage ou la structure. */
export function hauteurDeMasse(base: number, p: PlantsPlanche | null): number {
  return p === null ? base : base + p.surelevationM + Math.max(p.echelleVerticale, p.structureM);
}

/**
 * Épaisseur de la dalle d'une planche qui porte des plants, vue de près (m de scène) : les jeunes plants
 * ne s'enfouissent plus. 1/32 m (3,1 cm), exactement représentable en flottant 32 bits : la pose des instances ne l'arrondit pas.
 */
export const EPAISSEUR_DALLE_PLANTS_M = 0.03125;
/** Les tuteurs dépassent le plant de cette hauteur (m) : ficelle et tige se lisent même sur un plant de 5 cm. */
const DEPASSEMENT_TUTEUR_M = 0.1;
/** Largeur du tuteur (échelle horizontale, m). */
const LARGEUR_TUTEUR_M = 0.04;

/** Hauteur rendue de la dalle EN DÉTAIL : fine quand elle porte des plants, inchangée sinon. */
export function hauteurDalle(base: number, p: PlantsPlanche | null): number {
  return p === null ? base : Math.min(base, EPAISSEUR_DALLE_PLANTS_M);
}

/** Capacité d'un InstancedMesh : la puissance de deux au-dessus du besoin, pour ne pas le recréer à chaque semaine. */
export const capacite = (n: number): number => Math.max(64, 2 ** Math.ceil(Math.log2(Math.max(1, n))));

export class RenduPlants {
  private drapeaux = new Uint8Array(0);
  private dalles: (() => void) | null = null;
  private readonly maillages = new Map<FormePlant, InstancedMesh>();
  private poteaux: InstancedMesh | null = null;
  private tuteursMaillage: InstancedMesh | null = null;
  private tuteur: BufferGeometry | null = null;
  private fruitsMaillage: InstancedMesh | null = null;
  private balisesMaillage: InstancedMesh | null = null;
  private fruit: BufferGeometry | null = null;
  private balisesPosees: BalisePosee[] = [];
  /** Rang de la première balise dans son maillage (derrière les fruits quand ils partagent le même). */
  private decalageBalises = 0;
  private camera: { readonly x: number; readonly y: number; readonly z: number } | null = null;
  private readonly geometries = new Map<FormePlant, BufferGeometry>();
  private poteau: BufferGeometry | null = null;
  private readonly temporaire = new Object3D();
  private readonly couleur = new Color();
  private readonly melangeFeuillage = new Color();
  private readonly melangeFruit = new Color();
  private readonly cible = new Color();

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

  lierTuteurs(m: InstancedMesh | null): void {
    this.tuteursMaillage = m;
  }

  /** Fruits et balises : un seul maillage peut porter les deux (le même objet donné aux deux liens). */
  lierFruits(m: InstancedMesh | null): void {
    this.fruitsMaillage = m;
  }

  lierBalises(m: InstancedMesh | null): void {
    this.balisesMaillage = m;
  }

  /** Sphère de 1 m partagée : le fruit et la balise (un seul appel de dessin pour les deux). */
  geometrieFruit(): BufferGeometry {
    this.fruit ??= geometrieFruit();
    return this.fruit;
  }

  geometrieBalise(): BufferGeometry {
    return this.geometrieFruit();
  }

  geometrieTuteur(): BufferGeometry {
    this.tuteur ??= geometrieTuteur();
    return this.tuteur;
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
    this.tuteur?.dispose();
    this.tuteur = null;
    this.fruit?.dispose();
    this.fruit = null;
  }

  /**
   * Choisit les planches à dessiner en détail depuis la caméra : celles où un plant se voit, dans la
   * limite de PLANTS_MAX_TOTAL plants, les plus proches d'abord. Rend vrai si le choix a changé.
   */
  choisirDetail(scene: Scene, plants: readonly (PlantsPlanche | null)[], x: number, y: number, z: number, hauteurPx: number): boolean {
    this.camera = { x, y, z };
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

  private mettre(m: InstancedMesh | null | undefined, i: number, x: number, y: number, z: number, angle: number, ex: number, ey: number, ez: number, c: string | Color): boolean {
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

  private couleurFeuillage(jaunissement: number): string | Color {
    return jaunissement > 0 ? this.melangeFeuillage.set(VERT_FEUILLAGE).lerp(this.cible.set(COULEUR_FEUILLAGE_JAUNI_3D), jaunissement) : VERT_FEUILLAGE;
  }

  /** Vert en formation, qui vire à la couleur mûre de l'espèce avec la maturité ; mûre à « à récolter ». */
  private couleurFruit(p: PlantsPlanche): string | Color {
    const mure = COULEUR_MURE[p.cleFruit];
    return p.recolte.phase === 'a-recolter' ? mure : this.melangeFruit.set(COULEUR_FRUIT_VERT_3D).lerp(this.cible.set(mure), p.recolte.maturite);
  }

  /** Pose les fruits d'une planche (au plus FRUITS_MAX_TOTAL pour la scène) ; rend le nouveau total. */
  private poserFruits(p: PlantsPlanche, v: Scene['volumes'][number], yDalle: number, couleur: string | Color, depart: number): number {
    const [lx, ly, lz] = PROPORTIONS_FRUIT[p.typeFruit];
    const taille = p.tailleFruitM;
    const cos = Math.cos(v.angle);
    const sin = Math.sin(v.angle);
    const etalement = (p.forme === 'erige-tuteure' ? p.echelleHorizontale : p.pasM) * ETALEMENT_FRUIT;
    const sortie = p.echelleHorizontale * SORTIE_FRUIT;
    let n = depart;
    for (const pos of p.positions) {
      for (let j = 0; j < p.fruitsParPlant; j += 1) {
        if (n >= FRUITS_MAX_TOTAL) return n;
        const dx = ((j + 0.5) / p.fruitsParPlant - 0.5) * etalement;
        const dz = (j % 2 === 0 ? -1 : 1) * sortie;
        const bas = taille / 2;
        const y = yDalle + bas + Math.max(0, p.echelleVerticale - taille) * (NIVEAUX_FRUIT[j % NIVEAUX_FRUIT.length] ?? 0.3);
        if (this.mettre(this.fruitsMaillage, n, pos.x + dx * cos + dz * sin, y, pos.z - dx * sin + dz * cos, v.angle + 0.9 * j, taille * lx, taille * ly, taille * lz, couleur)) n += 1;
      }
    }
    return n;
  }

  /** Une balise par planche à récolter non estompée, au-dessus de son feuillage, grandie de loin pour rester lisible. */
  private poserBalises(scene: Scene, filtree: SceneFiltree, plants: readonly (PlantsPlanche | null)[], nbFruits: number): number {
    this.balisesPosees = [];
    this.decalageBalises = this.balisesMaillage !== null && this.balisesMaillage === this.fruitsMaillage ? nbFruits : 0;
    plants.forEach((p, i) => {
      const v = scene.volumes[i];
      if (p === null || v === undefined || !aBalise(p, filtree.volumes[i])) return;
      this.balisesPosees.push({ x: v.x, z: v.z, masse: hauteurDeMasse(hauteurRendue(v), p), taille: this.tailleVers(v.x, v.z) });
    });
    return this.ecrireBalises();
  }

  private tailleVers(x: number, z: number): number {
    const c = this.camera;
    return tailleBalise(c === null ? 0 : Math.hypot(x - c.x, c.y, z - c.z));
  }

  private ecrireBalises(): number {
    let n = 0;
    for (const b of this.balisesPosees) {
      // Sphère : lisible sous tous les angles, sans la tourner vers la caméra.
      if (this.mettre(this.balisesMaillage, this.decalageBalises + n, b.x, b.masse + b.taille * (0.5 + BALISE_JEU), b.z, 0, b.taille, b.taille, b.taille, COULEUR_BALISE_RECOLTE_3D)) n += 1;
    }
    return n;
  }

  /**
   * Après un mouvement de caméra : une balise change de taille quand sa distance franchit un cran
   * (plus grande de loin, plus petite de près). Rend vrai si une balise a été reposée ; à appeler avant le dessin.
   */
  ajusterBalises(): boolean {
    let change = false;
    for (const b of this.balisesPosees) {
      const t = this.tailleVers(b.x, b.z);
      if (t !== b.taille) {
        b.taille = t;
        change = true;
      }
    }
    if (change) {
      this.ecrireBalises();
      if (this.balisesMaillage !== null) this.balisesMaillage.instanceMatrix.needsUpdate = true;
    }
    return change;
  }

  /** Repose les instances des planches en détail (formes, poteaux), règle leur compte, et rend le bilan de la vue. */
  poser(scene: Scene, filtree: SceneFiltree, plants: readonly (PlantsPlanche | null)[]): BilanPlants {
    const comptes = new Map<FormePlant, number>();
    let nbPoteaux = 0;
    let nbTuteurs = 0;
    let total = 0;
    let nbFruits = 0;
    plants.forEach((p, i) => {
      if (p === null || !this.enDetail(i)) return;
      const v = scene.volumes[i];
      const f = filtree.volumes[i];
      if (v === undefined || f === undefined) return;
      const y = hauteurDalle(hauteurRendue(v), p) + p.surelevationM;
      const feuillage = f.estompe ? f.couleur : this.couleurFeuillage(p.jaunissement);
      const bois = f.estompe ? f.couleur : BOIS_POTEAU;
      // Tomate et autres formes tuteurées : un plant par instance, avec son tuteur. Les autres formes
      // restent étirées le long du rang (une longueur d'un pas joint les voisins sans déborder de la planche, relecture T32b).
      const tuteure = p.forme === 'erige-tuteure';
      const long = tuteure ? p.echelleHorizontale : p.pasM;
      for (const pos of p.positions) {
        if (p.echelleVerticale > 0) {
          const n = comptes.get(p.forme) ?? 0;
          if (this.mettre(this.maillages.get(p.forme), n, pos.x, y, pos.z, v.angle, long, p.echelleVerticale, p.echelleHorizontale, feuillage)) {
            comptes.set(p.forme, n + 1);
            total += 1;
            if (tuteure && this.mettre(this.tuteursMaillage, nbTuteurs, pos.x, y, pos.z, v.angle, LARGEUR_TUTEUR_M, p.echelleVerticale + DEPASSEMENT_TUTEUR_M, LARGEUR_TUTEUR_M, bois)) nbTuteurs += 1;
          }
        }
        if (p.structureM > 0 && this.mettre(this.poteaux, nbPoteaux, pos.x, y, pos.z, v.angle, p.echelleHorizontale, p.structureM, p.echelleHorizontale, bois)) nbPoteaux += 1;
      }
      if (p.fruitsParPlant > 0) nbFruits = this.poserFruits(p, v, y, f.estompe ? f.couleur : this.couleurFruit(p), nbFruits);
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
    const nbBalises = this.poserBalises(scene, filtree, plants, nbFruits);
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
    if (this.tuteursMaillage !== null) regler(this.tuteursMaillage, nbTuteurs);
    const partage = this.fruitsMaillage !== null && this.fruitsMaillage === this.balisesMaillage;
    if (this.fruitsMaillage !== null) regler(this.fruitsMaillage, partage ? nbFruits + nbBalises : nbFruits);
    if (this.balisesMaillage !== null && !partage) regler(this.balisesMaillage, nbBalises);
    // Hauteur du feuillage de chaque planche qui a des plants, quel que soit le détail (m, au centimètre).
    const hauteurs: Record<string, number> = {};
    for (const p of plants) if (p !== null) hauteurs[p.id] = Math.round(p.hauteurM * 100) / 100;
    return { plants: total, formes, tuteurs: nbTuteurs, hauteurs: JSON.stringify(hauteurs), semaine: scene.semaine, fruits: nbFruits, balises: nbBalises };
  }
}
