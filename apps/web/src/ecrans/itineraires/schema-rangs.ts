/**
 * Schéma des rangs d'une densité « écartement » (T35a, Q34) : vue de dessus d'un tronçon de
 * planche, rangs alignés ou en quinconce. Fonctions pures, sans React ni DOM ; le dessin est
 * ./SchemaRangs.tsx. Rien d'agronomique ici : la géométrie ne sert qu'à montrer la pose, le
 * nombre de plants reste calculé par le cœur (besoins de T05).
 */
import type { DispositionRangs } from '@planif/core';

/** Largeur de planche dessinée quand l'itinéraire ne la connaît pas : 1,2 m. */
export const LARGEUR_PLANCHE_DEFAUT_CM = 120;

/** Plants dessinés par rang : assez pour voir le motif, pas trop pour rester lisible. */
const PLANTS_MIN = 3;
const PLANTS_MAX = 60;

export interface EntreeSchemaRangs {
  /** Entier ≥ 1. */
  readonly rangs: number;
  /** > 0, décimal permis. */
  readonly ecartementCm: number;
  readonly disposition: DispositionRangs;
  /** null : LARGEUR_PLANCHE_DEFAUT_CM. */
  readonly largeurPlancheCm: number | null;
}

export interface PlantSchema {
  readonly rang: number;
  readonly xCm: number;
  readonly yCm: number;
}

export interface GeometrieSchemaRangs {
  /** Largeur de la planche dessinée (y). */
  readonly largeurCm: number;
  /** Longueur du tronçon dessiné (x). */
  readonly longueurCm: number;
  /** y de chaque rang, rang 1 d'abord. */
  readonly rangs: readonly number[];
  readonly plants: readonly PlantSchema[];
}

/**
 * Rangs répartis régulièrement sur la largeur (au milieu de bandes égales), un plant tous les
 * `ecartementCm` sur chaque rang ; en quinconce, les rangs pairs décalés d'un demi-écartement.
 * Le tronçon fait environ deux largeurs de planche, entre 3 et 60 plants par rang.
 */
export function geometrieSchemaRangs(e: EntreeSchemaRangs): GeometrieSchemaRangs {
  const largeurCm = e.largeurPlancheCm ?? LARGEUR_PLANCHE_DEFAUT_CM;
  const n = Math.max(1, Math.floor(e.rangs));
  const ecart = e.ecartementCm;
  const parRang = Math.min(PLANTS_MAX, Math.max(PLANTS_MIN, Math.ceil((2 * largeurCm) / ecart)));
  const quinconce = e.disposition === 'quinconce' && n > 1;
  const longueurCm = parRang * ecart + (quinconce ? ecart / 2 : 0);
  const rangs: number[] = [];
  const plants: PlantSchema[] = [];
  for (let r = 1; r <= n; r++) {
    const y = (largeurCm * (2 * r - 1)) / (2 * n);
    rangs.push(y);
    const depart = quinconce && r % 2 === 0 ? ecart : ecart / 2;
    for (let k = 0; k < parRang; k++) plants.push({ rang: r, xCm: depart + k * ecart, yCm: y });
  }
  return { largeurCm, longueurCm, rangs, plants };
}

/** Centimètres à la française : « 30 cm », « 12,5 cm ». */
export function texteCm(cm: number): string {
  return `${String(cm).replace('.', ',')} cm`;
}

/** Alternative texte : « 3 rangs en quinconce, un plant tous les 30 cm ». */
export function texteSchemaRangs(e: Pick<EntreeSchemaRangs, 'rangs' | 'ecartementCm' | 'disposition'>): string {
  const plant = `un plant tous les ${texteCm(e.ecartementCm)}`;
  if (e.rangs <= 1) return `1 rang, ${plant}`;
  return `${String(e.rangs)} rangs ${e.disposition === 'quinconce' ? 'en quinconce' : 'alignés'}, ${plant}`;
}
