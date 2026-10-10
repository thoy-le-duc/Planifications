/**
 * Vue 3D (T32b) — la part impérative du rendu des plants, hors de React : les InstancedMesh (un par
 * forme, plus un pour les poteaux), le niveau de détail et la pose des instances. Un objet par vue,
 * créé à son ouverture ; le composant ./Plants.tsx ne fait que le brancher à fiber.
 */
import { Color, Object3D, type BufferGeometry, type InstancedMesh } from 'three';
import type { FormePlant } from '@planif/core/croissance';
import { geometrieFruit, geometriePlant, geometrieStructure } from './geometries-plants.ts';
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

/** Un fruit se dessine tant qu'il fait au moins ce nombre de pixels de large (les plants : LARGEUR_VISIBLE_PX). */
const FRUIT_VISIBLE_PX = 3;
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
const PROPORTIONS_FRUIT: Readonly<Record<TypeFruit, readonly [number, number, number]>> = { allonge: [1, 0.45, 0.45], rond: [1, 0.95, 0.95], generique: [1, 0.85, 0.85] };
/**
 * Où les fruits se posent selon la forme du plant. Une plante tuteurée (tomate) porte ses fruits en grappes sur
 * les flancs, hors du feuillage : `niveaux` = part de sa hauteur, selon le rang du fruit ; `sortie` = écart au
 * centre en part de l'échelle horizontale. Un buisson ou une touffe basse (courgette, fraise) les montre posés
 * sur le haut du feuillage, bien dégagés : `sortie` plus petit, et un fruit sur deux un peu plus haut.
 */
const PLACE_FRUIT_TUTEURE = { niveaux: [0.25, 0.4, 0.55, 0.35], sortie: 0.6 } as const;
const SORTIE_FRUIT_BUISSON = 0.2;
/** Un fruit posé sur le haut du feuillage dépasse de cette part de sa taille. */
const DEPASSEMENT_FRUIT_BUISSON = 0.15;
/** Part du pas de rang sur laquelle les fruits d'un plant s'étalent. */
const ETALEMENT_FRUIT = 0.7;
/** Balise « à récolter » : plus petite taille (m, près de la planche), part de la distance à la caméra (elle grandit de loin pour rester lisible), plus grande taille (m). */
export const BALISE_MIN_M = 0.8;
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
/** Ton du tuteur : sa géométrie est blanche, l'instance l'assombrit comme l'ancienne géométrie de bois. */
const TON_TUTEUR = 0.45;
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
  /** Planches dont les fruits se dessinent : celles en détail, et celles dont le fruit se voit de loin (ils restent sur la masse). */
  private fruitsChoisis = new Uint8Array(0);
  private dalles: (() => void) | null = null;
  private readonly maillages = new Map<FormePlant, InstancedMesh>();
  private poteaux: InstancedMesh | null = null;
  private tuteursMaillage: InstancedMesh | null = null;
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
  private readonly melangeTuteur = new Color();

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

  /** Double pyramide de 1 m partagée : le fruit, la balise et le tuteur (un seul appel de dessin pour les trois). */
  geometrieFruit(): BufferGeometry {
    this.fruit ??= geometrieFruit();
    return this.fruit;
  }

  geometrieBalise(): BufferGeometry {
    return this.geometrieFruit();
  }

  geometrieTuteur(): BufferGeometry {
    return this.geometrieFruit();
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
    const fruitables: { i: number; d: number; n: number }[] = [];
    plants.forEach((p, i) => {
      const v = scene.volumes[i];
      if (p === null || v === undefined) return;
      const d = Math.hypot(v.x - x, y, v.z - z);
      // Un fruit se voit de plus loin que son plant n'est large : il reste affiché sur la masse de la planche (T32e).
      if (p.fruitsParPlant > 0 && plantsVisibles(p.tailleFruitM, d, hauteurPx, CHAMP_DEGRES, FRUIT_VISIBLE_PX)) fruitables.push({ i, d, n: p.nombre * p.fruitsParPlant });
      if (plantsVisibles(Math.max(p.echelleHorizontale, p.echelleVerticale / HAUTEUR_POUR_LARGEUR), d, hauteurPx, CHAMP_DEGRES)) candidates.push({ i, d, n: p.nombre });
    });
    candidates.sort((a, b) => a.d - b.d);
    let reste = PLANTS_MAX_TOTAL;
    for (const c of candidates) {
      if (c.n > reste) continue;
      reste -= c.n;
      choix[c.i] = 1;
    }
    const fruits = new Uint8Array(plants.length);
    fruitables.sort((a, b) => a.d - b.d);
    let resteFruits = FRUITS_MAX_TOTAL;
    for (const c of fruitables) {
      if (c.n > resteFruits) continue;
      resteFruits -= c.n;
      fruits[c.i] = 1;
    }
    const avant = this.drapeaux;
    const pareilFruits = this.fruitsChoisis.length === fruits.length && this.fruitsChoisis.every((v, i) => v === fruits[i]);
    this.fruitsChoisis = fruits;
    const pareil = avant.length === choix.length && avant.every((v, i) => v === choix[i]) && pareilFruits;
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

  /**
   * Pose les fruits d'une planche à partir du rang `debut` du maillage (au plus FRUITS_MAX_TOTAL fruits pour la
   * scène, `depart` déjà posés) ; rend le nouveau total de fruits. L'origine de la double pyramide est son pied.
   */
  private poserFruits(p: PlantsPlanche, v: Scene['volumes'][number], yDalle: number, couleur: string | Color, debut: number, depart: number): number {
    const [lx, ly, lz] = PROPORTIONS_FRUIT[p.typeFruit];
    const taille = p.tailleFruitM;
    const cos = Math.cos(v.angle);
    const sin = Math.sin(v.angle);
    const tuteure = p.forme === 'erige-tuteure';
    const etalement = (tuteure ? p.echelleHorizontale : p.pasM) * ETALEMENT_FRUIT;
    const sortie = p.echelleHorizontale * (tuteure ? PLACE_FRUIT_TUTEURE.sortie : SORTIE_FRUIT_BUISSON);
    let n = depart;
    for (const pos of p.positions) {
      // Les fruits sortent du côté extérieur du rang : de l'autre côté, le rang voisin les cacherait.
      const cote = (pos.x - v.x) * sin + (pos.z - v.z) * cos;
      for (let j = 0; j < p.fruitsParPlant; j += 1) {
        if (n >= FRUITS_MAX_TOTAL) return n;
        const dx = ((j + 0.5) / p.fruitsParPlant - 0.5) * etalement;
        const dz = (cote >= 0 ? 1 : -1) * (j % 2 === 0 ? sortie : sortie * 0.8);
        const niveau = PLACE_FRUIT_TUTEURE.niveaux[j % PLACE_FRUIT_TUTEURE.niveaux.length] ?? 0.4;
        // Pied du fruit : sur les flancs d'un plant tuteuré, posé sur le haut du feuillage d'un buisson.
        const pied = tuteure ? yDalle + Math.max(0, p.echelleVerticale - taille) * niveau : yDalle + p.echelleVerticale + taille * (DEPASSEMENT_FRUIT_BUISSON + 0.1 * (j % 2)) - taille * ly * 0.5;
        if (this.mettre(this.fruitsMaillage, debut + n, pos.x + dx * cos + dz * sin, pied, pos.z - dx * sin + dz * cos, v.angle + 0.9 * j, taille * lx, taille * ly, taille * lz, couleur)) n += 1;
      }
    }
    return n;
  }

  /** Une balise par planche à récolter non estompée, au-dessus de son feuillage, grandie de loin pour rester lisible. */
  private poserBalises(scene: Scene, filtree: SceneFiltree, plants: readonly (PlantsPlanche | null)[], debut: number): number {
    this.balisesPosees = [];
    this.decalageBalises = debut;
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
      // Forme symétrique : lisible sous tous les angles, sans la tourner vers la caméra.
      if (this.mettre(this.balisesMaillage, this.decalageBalises + n, b.x, b.masse + b.taille * BALISE_JEU, b.z, 0, b.taille, b.taille, b.taille, COULEUR_BALISE_RECOLTE_3D)) n += 1;
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
    // Planches dont les fruits se posent après la boucle : un maillage peut porter tuteurs, fruits et balises ensemble.
    const avecFruits: { readonly p: PlantsPlanche; readonly v: Scene['volumes'][number]; readonly y: number; readonly pale: string | null }[] = [];
    plants.forEach((p, i) => {
      if (p === null) return;
      const v = scene.volumes[i];
      const f = filtree.volumes[i];
      if (v === undefined || f === undefined) return;
      if (!this.enDetail(i)) {
        // En masse : seuls les fruits qui se voient de loin, posés sur le haut de la masse (dalle entière, plus gouttière).
        if (this.fruitsChoisis[i] === 1 && p.fruitsParPlant > 0) avecFruits.push({ p, v, y: hauteurRendue(v) + p.surelevationM, pale: f.estompe ? f.couleur : null });
        return;
      }
      const y = hauteurDalle(hauteurRendue(v), p) + p.surelevationM;
      const feuillage = f.estompe ? f.couleur : this.couleurFeuillage(p.jaunissement);
      const bois = f.estompe ? f.couleur : BOIS_POTEAU;
      // Le tuteur garde le ton sombre qu'avait sa géométrie, qui est maintenant blanche et partagée avec les fruits.
      const boisTuteur = this.melangeTuteur.set(bois).multiplyScalar(TON_TUTEUR);
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
            if (tuteure && this.mettre(this.tuteursMaillage, nbTuteurs, pos.x, y, pos.z, v.angle, LARGEUR_TUTEUR_M, p.echelleVerticale + DEPASSEMENT_TUTEUR_M, LARGEUR_TUTEUR_M, boisTuteur)) nbTuteurs += 1;
          }
        }
        if (p.structureM > 0 && this.mettre(this.poteaux, nbPoteaux, pos.x, y, pos.z, v.angle, p.echelleHorizontale, p.structureM, p.echelleHorizontale, bois)) nbPoteaux += 1;
      }
      if (p.fruitsParPlant > 0) avecFruits.push({ p, v, y, pale: f.estompe ? f.couleur : null });
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
    // Rangs des maillages partagés : tuteurs d'abord, puis fruits, puis balises.
    const occupe = new Map<InstancedMesh, number>();
    if (this.tuteursMaillage !== null) occupe.set(this.tuteursMaillage, nbTuteurs);
    const debutFruits = this.fruitsMaillage === null ? 0 : (occupe.get(this.fruitsMaillage) ?? 0);
    let nbFruits = 0;
    for (const { p, v, y, pale } of avecFruits) nbFruits = this.poserFruits(p, v, y, pale ?? this.couleurFruit(p), debutFruits, nbFruits);
    if (this.fruitsMaillage !== null) occupe.set(this.fruitsMaillage, debutFruits + nbFruits);
    const debutBalises = this.balisesMaillage === null ? 0 : (occupe.get(this.balisesMaillage) ?? 0);
    const nbBalises = this.poserBalises(scene, filtree, plants, debutBalises);
    if (this.balisesMaillage !== null) occupe.set(this.balisesMaillage, debutBalises + nbBalises);
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
    for (const [m, n] of occupe) regler(m, n);
    // Hauteur du feuillage de chaque planche qui a des plants, quel que soit le détail (m, au centimètre).
    const hauteurs: Record<string, number> = {};
    for (const p of plants) if (p !== null) hauteurs[p.id] = Math.round(p.hauteurM * 100) / 100;
    return { plants: total, formes, tuteurs: nbTuteurs, hauteurs: JSON.stringify(hauteurs), semaine: scene.semaine, fruits: nbFruits, balises: nbBalises };
  }
}
