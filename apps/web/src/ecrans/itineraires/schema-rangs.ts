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

// ── Écarts d'une densité (T42) ─────────────────────────────────────────────────────────────

/** Largeur de planche des écarts quand la ferme n'en dit rien : 75 cm (planche permanente usuelle). */
export const LARGEUR_PLANCHE_ECARTS_CM = 75;

/** Écart entre rangs et, au mètre linéaire, écart moyen équivalent entre graines sur le rang. */
export interface EcartsDensite {
  readonly rangs: number;
  /** Celle reçue, sinon LARGEUR_PLANCHE_ECARTS_CM. */
  readonly largeurPlancheCm: number;
  /** Largeur / rangs (rangs au milieu de bandes égales, comme le schéma) ; null à 1 rang. */
  readonly ecartEntreRangsCm: number | null;
  /** Au mètre linéaire : 100 / graines par mètre ; null sinon. */
  readonly ecartEquivalentCm: number | null;
}

const positif = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * Écarts d'une densité à l'écartement ou au mètre linéaire (rangs entiers ≥ 1) ; null à la volée
 * ou si la densité est illisible. Affichage seulement : le nombre de plants reste calculé par le cœur.
 */
export function ecartsDensite(densite: unknown, largeurPlancheCm: number | null): EcartsDensite | null {
  if (typeof densite !== 'object' || densite === null) return null;
  const d = densite as Readonly<Record<string, unknown>>;
  if (d.facon !== 'ecartement' && d.facon !== 'metre_lineaire') return null;
  const rangs = d.rangsParPlanche;
  if (typeof rangs !== 'number' || !Number.isInteger(rangs) || rangs < 1) return null;
  let ecartEquivalentCm: number | null = null;
  if (d.facon === 'metre_lineaire') {
    if (!positif(d.grainesParMetre)) return null;
    ecartEquivalentCm = 100 / d.grainesParMetre;
  }
  const largeur = positif(largeurPlancheCm) ? largeurPlancheCm : LARGEUR_PLANCHE_ECARTS_CM;
  return { rangs, largeurPlancheCm: largeur, ecartEntreRangsCm: rangs > 1 ? largeur / rangs : null, ecartEquivalentCm };
}

/** Centimètres arrondis : à l'unité à partir de 10 cm, au dixième en dessous (« 27 cm », « 0,7 cm »). */
function cmArrondis(cm: number): string {
  const v = cm >= 10 ? Math.round(cm) : Math.round(cm * 10) / 10;
  return texteCm(v);
}

/** « 3 rangs, ≈ 25 cm entre rangs (planche de 75 cm) », « 1 rang (planche de 75 cm) ». */
export function texteEcartsRangs(e: EcartsDensite): string {
  const planche = `(planche de ${cmArrondis(e.largeurPlancheCm)})`;
  if (e.ecartEntreRangsCm === null) return `${String(e.rangs)} rang ${planche}`;
  return `${String(e.rangs)} rangs, ≈ ${cmArrondis(e.ecartEntreRangsCm)} entre rangs ${planche}`;
}

/** « ≈ 2 cm entre graines sur le rang » ; null hors mètre linéaire. */
export function texteEcartEquivalent(e: EcartsDensite): string | null {
  return e.ecartEquivalentCm === null ? null : `≈ ${cmArrondis(e.ecartEquivalentCm)} entre graines sur le rang`;
}
