/**
 * Les sous-zones d'une serre en bandes (T86) : une serre abritant une zone qui a des sous-zones se découpe en bandes, une par
 * sous-zone, sur toute la longueur de la serre, côte à côte dans sa largeur. Chaque bande range ses planches comme T85 (ordre
 * naturel des codes, passe-pied, bloc centré dans la bande). Calcul pur, au millimètre ; rien n'est stocké : les bandes se
 * recalculent depuis la serre et ses sous-zones.
 *
 * Repère de la serre : origine au centre, x selon la largeur (vers l'est quand la serre est au cap 0°), y selon la longueur.
 * La première sous-zone (ordre naturel des noms) est du côté des x négatifs.
 */
import { parcelleDepuisPlanches, type PlancheDeParcelle, type PlancheRangee } from './parcelle.ts';

export interface SousZoneDeSerre {
  readonly id: string;
  readonly nom: string;
}

export interface BandeSerre {
  readonly id: string;
  readonly nom: string;
  /** Place de la bande, de 1 à `total`, dans l'ordre naturel des noms. */
  readonly rang: number;
  readonly total: number;
  /** Centre de la bande, dans le repère de la serre (mètres). */
  readonly centre: { readonly x: number; readonly y: number };
  /** Toute la longueur de la serre. */
  readonly longueurM: number;
  /** Largeur de la serre ÷ nombre de sous-zones. */
  readonly largeurM: number;
}

/** Au millimètre ; `+ 0` efface le zéro négatif. */
const mm = (v: number): number => Math.round(v * 1000) / 1000 + 0;
/** Tolérance sur le bord de la bande (m) : un millimètre. */
const TOLERANCE_M = 0.001;

export const comparerNoms = (a: SousZoneDeSerre, b: SousZoneDeSerre): number =>
  a.nom.localeCompare(b.nom, 'fr', { numeric: true, sensitivity: 'base' }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const positif = (v: number): boolean => Number.isFinite(v) && v > 0;

/** Les bandes de la serre, dans l'ordre naturel des noms ; vide sans sous-zone ou sans dimensions. */
export function bandesDeSerre(serre: { readonly longueurM: number; readonly largeurM: number }, sousZones: readonly SousZoneDeSerre[]): BandeSerre[] {
  if (sousZones.length === 0 || !positif(serre.longueurM) || !positif(serre.largeurM)) return [];
  const total = sousZones.length;
  const largeur = serre.largeurM / total;
  return [...sousZones].sort(comparerNoms).map((z, i) => ({
    id: z.id,
    nom: z.nom,
    rang: i + 1,
    total,
    centre: { x: mm(-serre.largeurM / 2 + largeur * (i + 0.5)), y: 0 },
    longueurM: mm(serre.longueurM),
    largeurM: mm(largeur),
  }));
}

export interface RangementDeBande {
  /** Dans l'ordre de rangement ; centres dans le repère de la serre. */
  readonly planches: readonly PlancheRangee[];
  /** Identifiants des planches qui sortent de la bande (en largeur) ou de la serre (en longueur). */
  readonly depassent: readonly string[];
}

/**
 * Range ces planches dans la bande, côte à côte, le bloc centré dans la bande (règle de T85). `null` : aucune planche,
 * passe-pied hors bornes (entier de 0 à 500 cm) ou longueur qui n'est pas un nombre positif.
 */
export function rangerDansBande(bande: BandeSerre, planches: readonly PlancheDeParcelle[], passePiedCm: number): RangementDeBande | null {
  return rangerDansRectangle(bande, planches, passePiedCm);
}

/** Un rectangle de la serre (bande de T86 ou case de T88) : centre dans le repère de la serre, dimensions en mètres. */
export interface RectangleDeSerre {
  readonly centre: { readonly x: number; readonly y: number };
  readonly longueurM: number;
  readonly largeurM: number;
}

/** Règle de T85 dans un rectangle de la serre : bloc centré, planches qui dépassent du rectangle signalées. */
export function rangerDansRectangle(bande: RectangleDeSerre, planches: readonly PlancheDeParcelle[], passePiedCm: number): RangementDeBande | null {
  const parcelle = parcelleDepuisPlanches(planches, passePiedCm);
  if (parcelle === null) return null;
  const rangees = parcelle.planches.map((p): PlancheRangee => ({ ...p, centre: { x: mm(bande.centre.x + p.centre.x), y: mm(bande.centre.y + p.centre.y) } }));
  const depassent = rangees
    .filter((p) => {
      const dx = Math.abs(p.centre.x - bande.centre.x) + p.largeurM / 2 - bande.largeurM / 2;
      const dy = Math.abs(p.centre.y - bande.centre.y) + p.longueurM / 2 - bande.longueurM / 2;
      return dx > TOLERANCE_M || dy > TOLERANCE_M;
    })
    .map((p) => p.id);
  return { planches: rangees, depassent };
}
