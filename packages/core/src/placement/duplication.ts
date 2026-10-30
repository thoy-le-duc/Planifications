/**
 * T90 : dupliquer une serre ou une parcelle (docs/backlog/T90-dupliquer.md) : nom et position des copies. Calcul pur, au millimètre :
 * ni base, ni réseau, ni horloge. Les copies se suivent du côté x positif de l'original (axe x' de son repère, même cap), à
 * largeur + écart l'une de l'autre.
 */
import { depuisRepereZone, versRepereZone, type RepereZone } from './repere.ts';

/** Copies au plus en une fois (une au moins). */
export const COPIES_MAX = 20;
export const COPIES_PAR_DEFAUT = 1;
export const ECART_PAR_DEFAUT_M = 1.5;
/** Écart au plus entre deux copies (m) : au-delà, la saisie est probablement une erreur. */
const ECART_MAX_M = 100;
/** Chiffres au plus du nombre d'un nom incrémenté : au-delà, le nombre n'est plus exact en virgule flottante. */
const CHIFFRES_MAX = 9;

/** Au millimètre ; `+ 0` efface le zéro négatif. */
const mm = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const cle = (nom: string): string => nom.trim().toLowerCase();

export function erreurDuplication(d: { readonly nombre: number; readonly ecartM: number }): string | null {
  if (!Number.isInteger(d.nombre) || d.nombre < 1 || d.nombre > COPIES_MAX) return `Le nombre de copies est un entier de 1 à ${String(COPIES_MAX)}.`;
  if (!Number.isFinite(d.ecartM) || d.ecartM < 0 || d.ecartM > ECART_MAX_M) return `L’écart entre deux copies va de 0 à ${String(ECART_MAX_M)} m.`;
  return null;
}

/**
 * Le nom d'une copie : le dernier nombre du nom est incrémenté (« Tunnel 1 » → « Tunnel 2 »), sans nombre le nom reçoit 2
 * (« Serre » → « Serre 2 »), jusqu'au premier nom libre. `pris` est complété du nom rendu.
 */
function nomLibre(nom: string, pris: Set<string>): string {
  const trouve = /^([\s\S]*?)(\d+)(\D*)$/.exec(nom);
  const chiffres = trouve?.[2];
  const fabrique =
    trouve !== null && chiffres !== undefined && chiffres.length <= CHIFFRES_MAX
      ? (k: number): string => `${trouve[1] ?? ''}${String(k)}${trouve[3] ?? ''}`
      : (k: number): string => `${nom.trim()} ${String(k)}`;
  const depart = trouve !== null && chiffres !== undefined && chiffres.length <= CHIFFRES_MAX ? Number(chiffres) + 1 : 2;
  let k = depart;
  while (pris.has(cle(fabrique(k)))) k++;
  const rendu = fabrique(k);
  pris.add(cle(rendu));
  return rendu;
}

/** Les noms de `nombre` copies de `nom`, en évitant `pris` (sans casse ni espaces autour) et les noms déjà donnés aux copies. */
export function nomsDesCopies(nom: string, pris: readonly string[], nombre: number): string[] {
  const dejaPris = new Set(pris.map(cle));
  return Array.from({ length: nombre }, () => nomLibre(nom, dejaPris));
}

/** Le déplacement, dans le repère de la ferme, de `distanceM` selon l'axe x' d'un repère de cap `orientationDeg`. */
export function decalageDeCopie(orientationDeg: number, distanceM: number): { readonly x: number; readonly y: number } {
  const { x, y } = depuisRepereZone({ centre: { x: 0, y: 0 }, orientationDeg }, { x: distanceM, y: 0 });
  return { x: mm(x), y: mm(y) };
}

export interface CopiePositionnee {
  /** Centre de la copie, repère de la ferme. */
  readonly centre: { readonly x: number; readonly y: number };
  /** Déplacement de l'original à la copie, repère de la ferme (les contours et les points de la copie s'en déduisent). */
  readonly decalage: { readonly x: number; readonly y: number };
  /** Distance selon x' de l'original à la copie : k × (largeur + écart). */
  readonly distanceM: number;
}

/** Les `nombre` copies alignées du côté x positif de l'original : la k-ième à k × (largeur + écart). */
export function positionsDesCopies(repere: RepereZone, largeurM: number, ecartM: number, nombre: number): CopiePositionnee[] {
  return Array.from({ length: nombre }, (_v, i) => {
    const distanceM = mm((i + 1) * (largeurM + ecartM));
    const decalage = decalageDeCopie(repere.orientationDeg, distanceM);
    return { centre: { x: mm(repere.centre.x + decalage.x), y: mm(repere.centre.y + decalage.y) }, decalage, distanceM };
  });
}

/** L'étendue d'un contour selon l'axe x' d'un repère de cap `orientationDeg` (sa largeur, quand x' est la largeur de la parcelle). */
export function largeurDuContour(contour: readonly { readonly x: number; readonly y: number }[], orientationDeg: number): number {
  const repere: RepereZone = { centre: { x: 0, y: 0 }, orientationDeg };
  const xs = contour.map((p) => versRepereZone(repere, p).x);
  return xs.length === 0 ? 0 : mm(Math.max(...xs) - Math.min(...xs));
}
