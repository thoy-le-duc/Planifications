/**
 * Contours de zones (T28d, Q31), en fonctions pures : insérer, déplacer, retirer un sommet,
 * clavier, tracé point par point, verdict en direct et maintien des planches en place quand le
 * contour de leur zone change. Ni React, ni DOM, ni réseau, ni horloge. Contrat :
 * ./test/contrat-contours.ts.
 *
 * Repère : celui de la ferme (mètres, x est, y nord). Aucune fonction ne modifie ses arguments.
 * La validation est celle du cœur (`validerContour`, par le sous-chemin du placement via ./coeur.ts).
 */
import { depuisRepereZone, repereZone, validerContour, versRepereZone } from './coeur.ts';
import { normaliserCap, type PlacementPlanche, type Touche } from './gestes.ts';
import type { Point } from './tuiles.ts';

/** Rayon, en pixels de l'écran, autour du premier sommet où un clic ferme le tracé. */
export const TOLERANCE_FERMETURE_PX = 12;
/** Deux clics à moins d'un millimètre l'un de l'autre sont un double clic. */
const DOUBLE_CLIC_M = 1e-3;
const PAS_FIN_M = 0.1;
const PAS_GROS_M = 1;
const SOMMETS_MIN = 3;

/** Au micromètre : efface le bruit des additions de 0,1 m. */
const net = (v: number): number => Math.round(v * 1e6) / 1e6;

const valide = (contour: readonly Point[], index: number): boolean => Number.isInteger(index) && index >= 0 && index < contour.length;

export function insererMilieu(contour: readonly Point[], cote: number): Point[] {
  const copie = [...contour];
  if (!valide(contour, cote)) return copie;
  const a = contour[cote];
  const b = contour[(cote + 1) % contour.length];
  if (a === undefined || b === undefined) return copie;
  copie.splice(cote + 1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  return copie;
}

export function deplacerSommet(contour: readonly Point[], index: number, vers: Point): Point[] {
  const copie = [...contour];
  if (valide(contour, index)) copie[index] = { x: vers.x, y: vers.y };
  return copie;
}

export function retirerSommet(contour: readonly Point[], index: number): Point[] | null {
  if (contour.length <= SOMMETS_MIN) return null;
  const copie = [...contour];
  if (valide(contour, index)) copie.splice(index, 1);
  return copie;
}

export function toucheSommet(contour: readonly Point[], index: number, touche: Touche): { contour: Point[]; index: number; refuse: boolean } | null {
  const p = contour[index];
  if (p === undefined) return null;
  const pas = touche.shiftKey ? PAS_GROS_M : PAS_FIN_M;
  const deplacer = (dx: number, dy: number) => ({ contour: deplacerSommet(contour, index, { x: net(p.x + dx), y: net(p.y + dy) }), index, refuse: false });
  switch (touche.key) {
    case 'ArrowRight':
      return deplacer(pas, 0);
    case 'ArrowLeft':
      return deplacer(-pas, 0);
    case 'ArrowUp':
      return deplacer(0, pas);
    case 'ArrowDown':
      return deplacer(0, -pas);
    case 'Insert':
      return { contour: insererMilieu(contour, index), index: index + 1, refuse: false };
    case 'Delete':
    case 'Backspace': {
      const reste = retirerSommet(contour, index);
      if (reste === null) return { contour: [...contour], index, refuse: true };
      return { contour: reste, index: index % reste.length, refuse: false };
    }
    default:
      return null;
  }
}

export function poserPoint(trace: readonly Point[], p: Point, toleranceM: number): { sommets: Point[]; ferme: boolean } {
  const sommets = [...trace];
  const premier = trace[0];
  if (premier !== undefined && Math.hypot(p.x - premier.x, p.y - premier.y) <= toleranceM) {
    return { sommets, ferme: trace.length >= SOMMETS_MIN };
  }
  const dernier = trace.at(-1);
  if (dernier !== undefined && Math.hypot(p.x - dernier.x, p.y - dernier.y) < DOUBLE_CLIC_M) return { sommets, ferme: false };
  sommets.push({ x: p.x, y: p.y });
  return { sommets, ferme: false };
}

export function verifierContour(contour: readonly Point[]): { ok: true; contour: Point[] } | { ok: false; code: string; message: string } {
  try {
    const r = validerContour(contour);
    if (r.ok) return { ok: true, contour: r.valeur.map((p) => ({ x: p.x, y: p.y })) };
    return { ok: false, code: r.erreur.code, message: r.erreur.message };
  } catch {
    return { ok: false, code: 'illisible', message: 'Le contour est illisible.' };
  }
}

export interface PlancheDansZone {
  readonly id: string;
  readonly placement: PlacementPlanche;
}

/**
 * Les planches placées d'une zone ne bougent pas sur le terrain quand son contour change : leur
 * placement est recalculé dans le repère du nouveau contour (position et cap absolus gardés).
 * Un contour sans repère (invalide, ancien ou nouveau) : copie inchangée.
 */
export function replacerPlanches(ancien: readonly Point[], nouveau: readonly Point[], planches: readonly PlancheDansZone[]): PlancheDansZone[] {
  const avant = repereZone({ contour: ancien });
  const apres = repereZone({ contour: nouveau });
  if (avant === null || apres === null) return planches.map((p) => ({ id: p.id, placement: { ...p.placement } }));
  return planches.map((p) => {
    const absolu = depuisRepereZone(avant, { x: p.placement.x, y: p.placement.y });
    const local = versRepereZone(apres, absolu);
    return {
      id: p.id,
      placement: { x: net(local.x), y: net(local.y), orientation_deg: normaliserCap(net(p.placement.orientation_deg + avant.orientationDeg - apres.orientationDeg)) },
    };
  });
}
