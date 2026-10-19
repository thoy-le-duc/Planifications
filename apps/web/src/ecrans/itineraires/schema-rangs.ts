/**
 * Schéma des rangs d'une densité « écartement » (T35a, Q34) : vue de dessus d'un tronçon de
 * planche, rangs alignés ou en quinconce. Fonctions pures, sans React ni DOM ; le dessin est
 * ./SchemaRangs.tsx. Rien d'agronomique ici : la géométrie ne sert qu'à montrer la pose, le
 * nombre de plants reste calculé par le cœur (besoins de T05).
 */
import type { DispositionRangs } from '@planif/core';

/**
 * Largeur de planche quand la ferme n'en dit rien : 75 cm (planche permanente usuelle). Une seule
 * valeur (T42b) pour le schéma des rangs et les écarts affichés.
 */
export const LARGEUR_PLANCHE_DEFAUT_CM = 75;

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
  /** T43 : écart entre rangs saisi ; absent ou null : rangs au milieu de bandes égales (T35a). */
  readonly ecartEntreRangsCm?: number | null;
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

/** Écart entre rangs saisi utilisable pour dessiner : 2 rangs ou plus, et les rangs tiennent sur la planche. */
function ecartDessine(n: number, largeurCm: number, ecart: number | null | undefined): number | null {
  if (n < 2 || typeof ecart !== 'number' || !Number.isFinite(ecart) || ecart <= 0) return null;
  return (n - 1) * ecart <= largeurCm ? ecart : null;
}

/**
 * Rangs répartis régulièrement sur la largeur (au milieu de bandes égales), un plant tous les
 * `ecartementCm` sur chaque rang ; en quinconce, les rangs pairs décalés d'un demi-écartement.
 * T43 : avec un écart entre rangs saisi qui tient sur la planche, les rangs en sont espacés,
 * centrés ; sinon (trop large : l'écran avertit) répartis comme avant.
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
  const entreRangs = ecartDessine(n, largeurCm, e.ecartEntreRangsCm);
  for (let r = 1; r <= n; r++) {
    const y = entreRangs === null ? (largeurCm * (2 * r - 1)) / (2 * n) : largeurCm / 2 + (r - (n + 1) / 2) * entreRangs;
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

/**
 * Alternative texte : « 3 rangs en quinconce, un plant tous les 30 cm » ; avec un écart entre rangs
 * saisi (T43) : « 3 rangs en quinconce à 25 cm l’un de l’autre, un plant tous les 30 cm ».
 */
export function texteSchemaRangs(e: Pick<EntreeSchemaRangs, 'rangs' | 'ecartementCm' | 'disposition' | 'ecartEntreRangsCm'>): string {
  const plant = `un plant tous les ${texteCm(e.ecartementCm)}`;
  if (e.rangs <= 1) return `1 rang, ${plant}`;
  const entre = typeof e.ecartEntreRangsCm === 'number' ? ` à ${texteCm(e.ecartEntreRangsCm)} l’un de l’autre` : '';
  return `${String(e.rangs)} rangs ${e.disposition === 'quinconce' ? 'en quinconce' : 'alignés'}${entre}, ${plant}`;
}

// ── Écarts d'une densité (T42) ─────────────────────────────────────────────────────────────

/** Écart entre rangs et, au mètre linéaire, écart moyen équivalent entre graines sur le rang. */
export interface EcartsDensite {
  readonly rangs: number;
  /** Celle reçue, sinon LARGEUR_PLANCHE_DEFAUT_CM. */
  readonly largeurPlancheCm: number;
  /** Largeur / rangs (rangs au milieu de bandes égales, comme le schéma) ; null à 1 rang. */
  readonly ecartEntreRangsCm: number | null;
  /** Au mètre linéaire : 100 / graines par mètre ; null sinon. */
  readonly ecartEquivalentCm: number | null;
  /** T43 : true si l'écart vient de la densité (`ecartEntreRangsCm`, la vraie donnée) ; false s'il est calculé (« ≈ »). */
  readonly ecartSaisi: boolean;
}

const positif = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * Écarts d'une densité à l'écartement ou au mètre linéaire (rangs entiers ≥ 1) ; null à la volée
 * ou si la densité est illisible. T43 : l'écart entre rangs saisi (`ecartEntreRangsCm`) s'il y en
 * a un, même à 1 rang ; sinon celui de T42, calculé. Affichage seulement : le nombre de plants
 * reste calculé par le cœur.
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
  const largeur = positif(largeurPlancheCm) ? largeurPlancheCm : LARGEUR_PLANCHE_DEFAUT_CM;
  if (positif(d.ecartEntreRangsCm)) return { rangs, largeurPlancheCm: largeur, ecartEntreRangsCm: d.ecartEntreRangsCm, ecartEquivalentCm, ecartSaisi: true };
  return { rangs, largeurPlancheCm: largeur, ecartEntreRangsCm: rangs > 1 ? largeur / rangs : null, ecartEquivalentCm, ecartSaisi: false };
}

/** Centimètres arrondis : à l'unité à partir de 10 cm, au dixième en dessous (« 27 cm », « 0,7 cm »). */
function cmArrondis(cm: number): string {
  const v = cm >= 10 ? Math.round(cm) : Math.round(cm * 10) / 10;
  return texteCm(v);
}

/**
 * « 3 rangs, ≈ 25 cm entre rangs (planche de 75 cm) », « 1 rang (planche de 75 cm) » ; écart saisi
 * (T43), tel quel et sans « ≈ » : « 3 rangs, 30 cm entre rangs (planche de 80 cm) ».
 */
export function texteEcartsRangs(e: EcartsDensite): string {
  const planche = `(planche de ${cmArrondis(e.largeurPlancheCm)})`;
  const rangs = `${String(e.rangs)} ${e.rangs > 1 ? 'rangs' : 'rang'}`;
  if (e.ecartEntreRangsCm === null) return `${rangs} ${planche}`;
  return `${rangs}, ${ecartTexte(e)} ${entreTexte(e.rangs)} ${planche}`;
}

/**
 * T48 : à 1 rang, l'écart saisi est l'entraxe, la distance d'une planche à l'autre : « entre
 * planches » ; à 2 rangs et plus « entre rangs ».
 */
export function entreTexte(rangs: number): string {
  return rangs > 1 ? 'entre rangs' : 'entre planches';
}

/** T48 : aide du champ « Écart entre rangs » ; à 1 rang, elle dit ce que vaut l'écart. */
export function texteAideEcart(rangs: number): string {
  return rangs > 1
    ? 'Distance entre deux rangs voisins, de 5 à 200 cm. Vide : rangs répartis sur la planche.'
    : 'Pour un rang, l’écart vaut la distance d’une planche à l’autre (entraxe), de 5 à 200 cm.';
}

/** L'écart entre rangs affiché : saisi, tel quel (« 17,5 cm ») ; calculé, arrondi et « ≈ ». */
function ecartTexte(e: EcartsDensite): string {
  if (e.ecartEntreRangsCm === null) return '';
  return e.ecartSaisi ? texteCm(e.ecartEntreRangsCm) : `≈ ${cmArrondis(e.ecartEntreRangsCm)}`;
}

/**
 * T43 : avertissement (jamais bloquant) quand l'écart saisi fait sortir les rangs du bord de la
 * planche : (rangs − 1) × écart > largeur. La marge « raisonnable » de la règle est d'un écart :
 * 3 rangs à 30 cm tiennent sur 75 cm (60 cm d'un rang du bord à l'autre), 4 rangs à 30 cm non.
 */
export function texteAvertissementEcart(e: EcartsDensite): string | null {
  if (!e.ecartSaisi || e.ecartEntreRangsCm === null || e.rangs < 2) return null;
  const etendue = (e.rangs - 1) * e.ecartEntreRangsCm;
  if (etendue <= e.largeurPlancheCm) return null;
  return `${String(e.rangs)} rangs à ${texteCm(e.ecartEntreRangsCm)} : ${cmArrondis(etendue)} d’un rang du bord à l’autre, plus que la planche de ${cmArrondis(e.largeurPlancheCm)}. Vérifie l’écart ou le nombre de rangs.`;
}

/**
 * Densité en quelques mots pour la liste des itinéraires (T43) : « 3 rangs à 30 cm · 30 cm sur
 * le rang », « 3 rangs à ≈ 27 cm · … » sans écart saisi, « 1 rang · 50 cm sur le rang »,
 * « 4 rangs à 15 cm · 50 graines/m », « à la volée · 2 g/m² » ; null si illisible.
 */
export function texteDensite(densite: unknown, largeurPlancheCm: number | null): string | null {
  if (typeof densite !== 'object' || densite === null) return null;
  const d = densite as Readonly<Record<string, unknown>>;
  if (d.facon === 'volee') return positif(d.doseGParM2) ? `à la volée · ${String(d.doseGParM2).replace('.', ',')} g/m²` : null;
  const e = ecartsDensite(densite, largeurPlancheCm);
  if (e === null) return null;
  let rangs: string;
  if (e.ecartEntreRangsCm === null) rangs = '1 rang';
  else if (e.rangs === 1) rangs = `1 rang, ${ecartTexte(e)} entre planches`;
  else rangs = `${String(e.rangs)} rangs à ${ecartTexte(e)}`;
  if (d.facon === 'metre_lineaire') return `${rangs} · ${String(d.grainesParMetre).replace('.', ',')} graines/m`;
  if (!positif(d.ecartementSurRangCm)) return null;
  return `${rangs} · ${texteCm(d.ecartementSurRangCm)} sur le rang`;
}

/** « ≈ 2 cm entre graines sur le rang » ; null hors mètre linéaire. */
export function texteEcartEquivalent(e: EcartsDensite): string | null {
  return e.ecartEquivalentCm === null ? null : `≈ ${cmArrondis(e.ecartEquivalentCm)} entre graines sur le rang`;
}
