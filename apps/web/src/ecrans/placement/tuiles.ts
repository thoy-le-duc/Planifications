/**
 * Tuiles WMTS de la Géoplateforme (orthophoto IGN, jeu « PM » = Web Mercator) et passage entre le
 * repère local de la ferme (mètres, x est, y nord) et les pixels de l'écran (T28b). Pur : ni
 * React, ni DOM, ni réseau, aucune bibliothèque de carte. Contrat : ./test/contrat.ts.
 *
 * Une tuile est posée là où son coin nord-ouest tombe (Mercator → latitude, longitude → repère
 * local → écran) et sa taille est la distance à la tuile voisine : la photo reste collée au repère
 * de la ferme (à 1 px près, même à plusieurs kilomètres de l'origine), sans trou entre tuiles.
 */
import { RAYON_TERRESTRE_M, versGeographique, versLocal } from './coeur.ts';

export interface Position {
  readonly latitude: number;
  readonly longitude: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Tuile {
  readonly zoom: number;
  readonly colonne: number;
  readonly ligne: number;
}

export interface TuileEtPixel extends Tuile {
  readonly px: number;
  readonly py: number;
}

export interface VueCarte {
  /** Origine du repère local (origine du plan, ou position météo en attendant). */
  readonly origine: Position;
  /** Point du repère local affiché au milieu de l'écran. */
  readonly centre: Point;
  readonly zoom: number;
  readonly largeurPx: number;
  readonly hauteurPx: number;
}

export interface TuileVisible extends Tuile {
  readonly url: string;
  readonly x: number;
  readonly y: number;
  readonly largeur: number;
  readonly hauteur: number;
}

export const URL_WMTS = 'https://data.geopf.fr/wmts';
export const COUCHE_ORTHO = 'ORTHOIMAGERY.ORTHOPHOTOS';
export const JEU_TUILES = 'PM';
export const TAILLE_TUILE_PX = 256;
/** Zoom le plus fin demandé à la Géoplateforme ; au-delà, ses tuiles sont agrandies. */
export const ZOOM_TUILES_MAX = 19;
export const ZOOM_INITIAL = 19;
/** Zoom de départ quand la ferme n'a ni origine du plan ni position : la France entière ou presque, pour retrouver la ferme avec le champ d'adresse. */
export const ZOOM_DEPART_SANS_POSITION = 6;
/** Zoom minimal de l'éditeur (boutons et molette) : la vue d'une région. */
export const ZOOM_MIN_VUE = 6;
/** Délai entre l'échec d'une tuile et sa nouvelle demande. */
export const DELAI_RELANCE_TUILE_MS = 4_000;
/** Nouvelles demandes d'une même tuile après son premier échec. */
export const ESSAIS_TUILE_MAX = 3;
export const MENTION_IGN = '© IGN';

const RAD = Math.PI / 180;

/** Pixel du point dans le monde Web Mercator au zoom donné (256·2^zoom de côté). */
export function pixelMonde(position: Position, zoom: number): Point {
  const cote = TAILLE_TUILE_PX * 2 ** zoom;
  const s = Math.sin(position.latitude * RAD);
  return {
    x: ((position.longitude + 180) / 360) * cote,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * cote,
  };
}

export function tuileDe(position: Position, zoom: number): TuileEtPixel {
  const monde = pixelMonde(position, zoom);
  const colonne = Math.floor(monde.x / TAILLE_TUILE_PX);
  const ligne = Math.floor(monde.y / TAILLE_TUILE_PX);
  return { zoom, colonne, ligne, px: monde.x - colonne * TAILLE_TUILE_PX, py: monde.y - ligne * TAILLE_TUILE_PX };
}

/** Requête KVP sans clé : service public de la Géoplateforme. */
export function urlTuile(tuile: Tuile): string {
  const q = new URLSearchParams({
    SERVICE: 'WMTS',
    REQUEST: 'GetTile',
    VERSION: '1.0.0',
    LAYER: COUCHE_ORTHO,
    STYLE: 'normal',
    TILEMATRIXSET: JEU_TUILES,
    TILEMATRIX: String(tuile.zoom),
    TILEROW: String(tuile.ligne),
    TILECOL: String(tuile.colonne),
    FORMAT: 'image/jpeg',
  });
  return `${URL_WMTS}?${q.toString()}`;
}

/** Mètres au sol par pixel de l'écran à cette latitude et ce zoom. */
export function metresParPixel(latitude: number, zoom: number): number {
  return (2 * Math.PI * RAYON_TERRESTRE_M * Math.cos(latitude * RAD)) / (TAILLE_TUILE_PX * 2 ** zoom);
}

/** Le nord est en haut, l'est à droite ; `vue.centre` est au milieu de l'écran. */
export function versEcran(vue: VueCarte, point: Point): Point {
  const mpp = metresParPixel(vue.origine.latitude, vue.zoom);
  return { x: vue.largeurPx / 2 + (point.x - vue.centre.x) / mpp, y: vue.hauteurPx / 2 - (point.y - vue.centre.y) / mpp };
}

export function depuisEcran(vue: VueCarte, pixel: Point): Point {
  const mpp = metresParPixel(vue.origine.latitude, vue.zoom);
  return { x: vue.centre.x + (pixel.x - vue.largeurPx / 2) * mpp, y: vue.centre.y - (pixel.y - vue.hauteurPx / 2) * mpp };
}

/** Coin nord-ouest de la tuile (colonne, ligne) du zoom donné, en pixels de l'écran. */
function coinEcran(vue: VueCarte, zoom: number, colonne: number, ligne: number): Point {
  const n = 2 ** zoom;
  const longitude = (colonne / n) * 360 - 180;
  const latitude = Math.atan(Math.sinh(Math.PI * (1 - (2 * ligne) / n))) / RAD;
  return versEcran(vue, versLocal(vue.origine, { latitude, longitude }));
}

/**
 * Les tuiles qui recouvrent l'écran, au zoom min(vue.zoom, ZOOM_TUILES_MAX) : aucune en double,
 * aucune entièrement hors écran.
 */
export function tuilesVisibles(vue: VueCarte): TuileVisible[] {
  const zoom = Math.min(vue.zoom, ZOOM_TUILES_MAX);
  const dernier = 2 ** zoom - 1;
  const coins = [
    { x: 0, y: 0 },
    { x: vue.largeurPx, y: 0 },
    { x: 0, y: vue.hauteurPx },
    { x: vue.largeurPx, y: vue.hauteurPx },
  ].map((p) => tuileDe(versGeographique(vue.origine, depuisEcran(vue, p)), zoom));
  const bornes = (valeurs: number[]): [number, number] => [Math.max(0, Math.min(...valeurs) - 1), Math.min(dernier, Math.max(...valeurs) + 1)];
  const [c0, c1] = bornes(coins.map((c) => c.colonne));
  const [l0, l1] = bornes(coins.map((c) => c.ligne));
  const tuiles: TuileVisible[] = [];
  for (let ligne = l0; ligne <= l1; ligne++) {
    for (let colonne = c0; colonne <= c1; colonne++) {
      const nw = coinEcran(vue, zoom, colonne, ligne);
      const se = coinEcran(vue, zoom, colonne + 1, ligne + 1);
      const largeur = se.x - nw.x;
      const hauteur = se.y - nw.y;
      if (nw.x >= vue.largeurPx || nw.y >= vue.hauteurPx || nw.x + largeur <= 0 || nw.y + hauteur <= 0) continue;
      tuiles.push({ zoom, colonne, ligne, url: urlTuile({ zoom, colonne, ligne }), x: nw.x, y: nw.y, largeur, hauteur });
    }
  }
  return tuiles;
}
