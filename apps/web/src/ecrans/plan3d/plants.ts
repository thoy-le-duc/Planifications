/**
 * Vue 3D (T32b, Q33) — adaptateur PUR des plants stylisés : pour une planche et un jour, quelle
 * forme, quelle taille, combien de plants et où. Aucun calcul de croissance ici : la hauteur et le
 * stade viennent de `croissanceA` et `croissancePerenneA` de @planif/core (T32a). Ni React, ni
 * three, ni réseau, ni horloge : le jour est un argument. Contrat : ./plants.test.ts.
 *
 * Une géométrie partagée par forme (./geometries-plants.ts), instanciée : `instancesParForme`
 * regroupe les planches par forme, la vue en fait un InstancedMesh par forme.
 */
import type { DateCalendaire } from '@planif/core';
import { cleDeFruit, type CleFruit, type TypeFruit, typeDeFruit } from './recolte.ts';
import {
  croissanceA,
  croissancePerenneA,
  hauteurStructureM,
  jaunissementA,
  jaunissementPerenneA,
  recolteA,
  recoltePerenneA,
  surelevationHorsSolM,
  type DatesCroissance,
  type EntreePerenne,
  type EtatCroissance,
  type EtatRecolte,
  type FormePlant,
  type ProfilCroissance,
  type StadeCroissance,
} from '@planif/core/croissance';

/** Plafond de plants d'UNE planche : au-delà on espace les plants, on n'en dessine pas plus. */
export const PLANTS_MAX_PAR_PLANCHE = 20;
/** Plafond de plants dessinés pour toute la scène : les planches les plus proches d'abord (200 → 180 en T32f : les balises de fin de récolte ajoutent des triangles, et la ferme T07 en zoom serré, 4 300 + 200 × 48 + 79 × 8, dépassait 14 000). */
export const PLANTS_MAX_TOTAL = 180;
/** Plafond de fruits dessinés par plant (T32e). */
export const FRUITS_MAX_PAR_PLANT = 4;
/** Plafond de fruits dessinés pour toute la scène (T32e). */
export const FRUITS_MAX_TOTAL = 600;
/** Un fruit en formation fait au moins cette part de sa taille mûre ; il grossit de là jusqu'à 1 avec la maturité. */
const PART_FRUIT_NAISSANT = 0.25;
/** Longueur mûre du fruit (m, plus grand axe), stylisée pour se lire d'un peu loin : la courgette fait ~28 cm (0,28125 = 9/32 est exact en flottant 32 bits : la taille relue dans la matrice reste sous le plafond de 0,3 m), la tomate et la fraise sont grossies. */
export const TAILLE_FRUIT_MURE_M: Readonly<Record<TypeFruit, number>> = { allonge: 0.28125, rond: 0.2, generique: 0.2 };
/** Un jeune plant (levée, turion) se dessine à cette hauteur au moins (m). */
export const HAUTEUR_PLANT_MINIMAL_M = 0.05;
/** Triangles de la géométrie partagée de chaque forme (vérifié sur les géométries par geometries-plants.test.ts). */
export const TRIANGLES_PAR_FORME: Readonly<Record<FormePlant, number>> = {
  'erige-tuteure': 48,
  rosette: 42,
  touffe: 48,
  rampant: 54,
  buisson: 50,
  'arbre-ou-liane': 50,
  'bulbe-ou-racine': 40,
};
/** Les formes, dans un ordre fixe (un InstancedMesh chacune, 7 au plus). */
export const FORMES: readonly FormePlant[] = ['erige-tuteure', 'rosette', 'touffe', 'rampant', 'buisson', 'arbre-ou-liane', 'bulbe-ou-racine'];

/** Part de l'écartement qu'un plant adulte occupe : deux plants voisins ne se touchent pas. */
const REMPLISSAGE_ADULTE = 0.9;
/** Part de cet encombrement à la levée. */
const REMPLISSAGE_JEUNE = 0.35;
/** Un plant se voit de loin tant qu'il fait au moins ce nombre de pixels de large. */
export const LARGEUR_VISIBLE_PX = 4;
/** Rang de plants tous les tant de mètres de largeur de planche. */
const LARGEUR_PAR_RANG_M = 0.5;
const RANGS_MAX = 3;
/** Un plant étiré le long du rang ne couvre pas plus de tant d'écartements. */
const PAS_MAX_ECARTEMENTS = 12;
/** Pieds d'une gouttière surélevée : un tous les 3 m environ, aux deux bouts au moins, 6 au plus. */
export const piedsDeGouttiere = (longueurM: number): number => Math.min(6, Math.max(2, Math.round(longueurM / 3) + 1));

export interface VolumePlant {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly longueur: number;
  readonly largeur: number;
  /** Radians, comme `coinsRectScene`. */
  readonly angle: number;
  /** Couleur de la planche, celle du filtre T27b déjà appliquée (estompée ou non). */
  readonly couleur: string;
}

export interface CultureDePlanche {
  readonly espece: string;
  readonly profil: ProfilCroissance;
  readonly croissance: { readonly sorte: 'annuelle'; readonly dates: DatesCroissance } | { readonly sorte: 'perenne'; readonly entree: EntreePerenne };
  /** Écartement réel des plants dans l'itinéraire (m). */
  readonly ecartementM: number;
}

export interface EntreePlants {
  readonly volume: VolumePlant;
  readonly culture: CultureDePlanche | null;
  /** Le lundi de la semaine du curseur. */
  readonly jour: DateCalendaire;
  /** La planche est dans une zone `hors_sol` ou sur une gouttière. */
  readonly horsSol: boolean;
}

export interface PlantsPlanche {
  readonly id: string;
  readonly forme: FormePlant;
  readonly stade: StadeCroissance;
  /** Hauteur du feuillage du jour (T32a). */
  readonly hauteurM: number;
  /** Échelle verticale de la géométrie de 1 m de haut : la hauteur du jour, au moins celle d'un plant minimal sauf au repos. */
  readonly echelleVerticale: number;
  /** Échelle horizontale, dans ]0 ; écartement]. */
  readonly echelleHorizontale: number;
  /** Hauteur de la structure qui reste au repos (pergola et bois du kiwi). */
  readonly structureM: number;
  /** Gouttière surélevée du fraisier hors-sol. */
  readonly surelevationM: number;
  readonly couleur: string;
  /** Longueur (m) du tronçon de rang que chaque plant couvre : une planche se lit comme un rang continu (bornée à 12 écartements). */
  readonly pasM: number;
  readonly nombre: number;
  /** État de récolte du jour (T32e), calculé par le cœur. */
  readonly recolte: EtatRecolte;
  readonly typeFruit: TypeFruit;
  /** Espèce de fruit pour la couleur mûre (la tomate et la fraise sont toutes deux rondes). */
  readonly cleFruit: CleFruit;
  /** Fruits dessinés par plant : 0 hors formation et récolte, sinon de 1 à FRUITS_MAX_PAR_PLANT. */
  readonly fruitsParPlant: number;
  /** Plus grand axe du fruit (m) : 0 sans fruit, sinon strictement croissant avec la maturité, au plus sa taille mûre. */
  readonly tailleFruitM: number;
  /** Jaunissement du feuillage en fin de récolte, de 0 à 1. */
  readonly jaunissement: number;
  /** Coordonnées de scène, toutes dans le rectangle de la planche. */
  readonly positions: readonly { readonly x: number; readonly z: number }[];
}

export interface GroupeInstances {
  readonly forme: FormePlant;
  readonly planches: readonly PlantsPlanche[];
  readonly nombreDePlants: number;
  readonly triangles: number;
}

function etatDuJour(culture: CultureDePlanche, jour: DateCalendaire): EtatCroissance {
  return culture.croissance.sorte === 'annuelle' ? croissanceA(culture.croissance.dates, culture.profil, jour) : croissancePerenneA(culture.croissance.entree, culture.profil, jour);
}

/**
 * Les fruits se dessinent pour la courgette, la tomate et la fraise (quelle que soit leur forme), et pour
 * les autres espèces dont la forme porte des fruits (buisson, rampant, tuteurée, liane). Pas de fruit sur
 * une salade, une racine, une touffe de feuilles : la balise suffit à dire qu'il y a de la récolte.
 */
const FORMES_A_FRUITS: ReadonlySet<FormePlant> = new Set<FormePlant>(['erige-tuteure', 'rampant', 'buisson', 'arbre-ou-liane']);
const dessineDesFruits = (cle: CleFruit, forme: FormePlant): boolean => cle !== 'generique' || FORMES_A_FRUITS.has(forme);

function recolteDuJour(culture: CultureDePlanche, jour: DateCalendaire): { readonly recolte: EtatRecolte; readonly jaunissement: number } {
  return culture.croissance.sorte === 'annuelle'
    ? { recolte: recolteA(culture.croissance.dates, jour), jaunissement: jaunissementA(culture.croissance.dates, jour) }
    : { recolte: recoltePerenneA(culture.croissance.entree, jour), jaunissement: jaunissementPerenneA(culture.croissance.entree, jour) };
}

/** Positions des plants sur `rangs` rangs, `parRang` par rang, régulièrement répartis sur la longueur. */
function positionsDe(v: VolumePlant, rangs: number, parRang: number): { x: number; z: number }[] {
  const cos = Math.cos(v.angle);
  const sin = Math.sin(v.angle);
  const positions: { x: number; z: number }[] = [];
  for (let r = 0; r < rangs; r += 1) {
    const dz = ((r + 0.5) / rangs - 0.5) * v.largeur;
    for (let k = 0; k < parRang; k += 1) {
      const dx = ((k + 0.5) / parRang - 0.5) * v.longueur;
      positions.push({ x: v.x + dx * cos + dz * sin, z: v.z - dx * sin + dz * cos });
    }
  }
  return positions;
}

/** Les plants d'une planche pour ce jour, ou nul quand rien ne se dessine. */
export function plantsDePlanche(entree: EntreePlants): PlantsPlanche | null {
  const { volume, culture, jour, horsSol } = entree;
  if (culture === null) return null;
  const etat = etatDuJour(culture, jour);
  if (etat.stade === 'aucun') return null;
  const structureM = hauteurStructureM(culture.profil);
  const auRepos = etat.stade === 'repos';
  if (auRepos && structureM === 0) return null;

  const ecart = culture.ecartementM > 0 ? culture.ecartementM : 0.3;
  const rangs = Math.min(RANGS_MAX, Math.max(1, Math.round(volume.largeur / LARGEUR_PAR_RANG_M)));
  const parRang = Math.max(1, Math.min(Math.floor(volume.longueur / ecart), Math.floor(PLANTS_MAX_PAR_PLANCHE / rangs)));
  const positions = positionsDe(volume, rangs, parRang);
  const { recolte, jaunissement } = recolteDuJour(culture, jour);
  const typeFruit = typeDeFruit(culture.espece);
  const enFormation = recolte.phase === 'fruits-en-formation';
  const cleFruit = cleDeFruit(culture.espece);
  const avecFruits = (enFormation || recolte.phase === 'a-recolter') && dessineDesFruits(cleFruit, culture.profil.forme);
  const adulte = culture.profil.hauteurMaxM > 0 ? Math.min(1, etat.hauteurM / culture.profil.hauteurMaxM) : 1;
  return {
    id: volume.id,
    forme: culture.profil.forme,
    stade: etat.stade,
    hauteurM: etat.hauteurM,
    echelleVerticale: auRepos ? 0 : Math.max(etat.hauteurM, HAUTEUR_PLANT_MINIMAL_M),
    echelleHorizontale: ecart * REMPLISSAGE_ADULTE * (REMPLISSAGE_JEUNE + (1 - REMPLISSAGE_JEUNE) * adulte),
    structureM,
    surelevationM: surelevationHorsSolM(culture.espece, horsSol),
    couleur: volume.couleur,
    pasM: Math.min(volume.longueur / parRang, PAS_MAX_ECARTEMENTS * ecart),
    nombre: positions.length,
    recolte,
    typeFruit,
    cleFruit,
    fruitsParPlant: avecFruits ? (enFormation ? 1 + Math.floor(recolte.maturite * (FRUITS_MAX_PAR_PLANT - 1)) : FRUITS_MAX_PAR_PLANT) : 0,
    tailleFruitM: avecFruits ? TAILLE_FRUIT_MURE_M[typeFruit] * (PART_FRUIT_NAISSANT + (1 - PART_FRUIT_NAISSANT) * recolte.maturite) : 0,
    jaunissement,
    positions,
  };
}

/** Un groupe par forme présente, donc un InstancedMesh, pas un par planche. Les nuls sont ignorés. */
export function instancesParForme(plants: readonly (PlantsPlanche | null)[]): readonly GroupeInstances[] {
  const parForme = new Map<FormePlant, PlantsPlanche[]>();
  for (const p of plants) {
    if (p === null) continue;
    const liste = parForme.get(p.forme);
    if (liste === undefined) parForme.set(p.forme, [p]);
    else liste.push(p);
  }
  return [...parForme].map(([forme, planches]) => {
    const nombreDePlants = planches.reduce((n, p) => n + p.nombre, 0);
    return { forme, planches, nombreDePlants, triangles: nombreDePlants * TRIANGLES_PAR_FORME[forme] };
  });
}

/**
 * Niveau de détail : les plants d'une planche se dessinent tant que l'un d'eux fait au moins
 * LARGEUR_VISIBLE_PX de large à l'écran ; de plus loin, la planche entière devient un volume à la
 * hauteur du feuillage (une masse à la couleur du filtre) et ses instances sont retirées.
 * `largeurM` : largeur apparente d'un plant ; `distanceM` : de la caméra à la planche ;
 * `hauteurEcranPx` : hauteur de la toile ; `champDegres` : champ vertical.
 */
export function plantsVisibles(largeurM: number, distanceM: number, hauteurEcranPx: number, champDegres: number, pixelsMin: number = LARGEUR_VISIBLE_PX): boolean {
  const pixelsParMetre = hauteurEcranPx / (2 * Math.max(distanceM, 1e-6) * Math.tan((champDegres * Math.PI) / 360));
  return largeurM * pixelsParMetre >= pixelsMin;
}
