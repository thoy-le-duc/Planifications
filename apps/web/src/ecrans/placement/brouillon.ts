/**
 * Brouillon de l'éditeur de placement (T28b) : ce que l'on a changé depuis la dernière lecture de
 * la base, et les changements à donner à `porte.placer` (un seul appel pour tout le brouillon).
 * Rien n'est écrit pendant un geste ; les valeurs écrites sont arrondies au millimètre (cap :
 * millième de degré) pour effacer le bruit des calculs en virgule flottante.
 */
import type { ChangementPlacement, ValeursBatiment } from '@planif/sync';
import { normaliserCap } from './gestes.ts';
import type { Batiment, Planche, Zone } from './donnees.ts';

export const arrondiM = (v: number): number => Math.round(v * 1000) / 1000;
export const arrondiDeg = (v: number): number => normaliserCap(Math.round(v * 1000) / 1000);

const EPSILON_M = 5e-4;
const EPSILON_DEG = 5e-3;
const memeM = (a: number, b: number): boolean => Math.abs(a - b) < EPSILON_M;
const memeCap = (a: number, b: number): boolean => Math.abs(((a - b + 540) % 360) - 180) < EPSILON_DEG;

type Modifiable<T> = { -readonly [K in keyof T]?: T[K] };

export interface EntreeBrouillon {
  readonly batiments: readonly Batiment[];
  readonly brouillonBatiments: ReadonlyMap<string, Batiment>;
  readonly zones: readonly Zone[];
  readonly planches: readonly Planche[];
  readonly brouillonPlanches: ReadonlyMap<string, Planche>;
}

function changementBatiment(avant: Batiment | undefined, b: Batiment): { readonly valeurs: ValeursBatiment; readonly change: boolean } {
  const v: Modifiable<ValeursBatiment> = {};
  if (avant === undefined) {
    v.nom = b.nom;
    v.type = b.type;
  }
  if (avant === undefined || !memeM(avant.longueurM, b.longueurM)) v.longueur_m = arrondiM(b.longueurM);
  if (avant === undefined || !memeM(avant.largeurM, b.largeurM)) v.largeur_m = arrondiM(b.largeurM);
  if (avant === undefined || !memeM(avant.hauteurM, b.hauteurM)) v.hauteur_m = arrondiM(b.hauteurM);
  if (avant === undefined || !memeM(avant.centre.x, b.centre.x)) v.centre_x_m = arrondiM(b.centre.x);
  if (avant === undefined || !memeM(avant.centre.y, b.centre.y)) v.centre_y_m = arrondiM(b.centre.y);
  if (avant === undefined || !memeCap(avant.orientationDeg, b.orientationDeg)) v.orientation_deg = arrondiDeg(b.orientationDeg);
  if (b.zoneId !== (avant?.zoneId ?? null)) v.zone_id = b.zoneId;
  return { valeurs: v, change: avant === undefined || Object.keys(v).length > 0 };
}

/**
 * Les changements du brouillon, dans l'ordre d'écriture : contours de zone effacés (une zone qui
 * a un contour ne peut pas être abritée), bâtiments, puis planches. Liste vide : rien à écrire.
 */
export function changementsDuBrouillon(e: EntreeBrouillon): ChangementPlacement[] {
  const lus = new Map(e.batiments.map((b) => [b.id, b]));
  const batiments: ChangementPlacement[] = [];
  const zonesAEffacer = new Set<string>();
  for (const [id, b] of e.brouillonBatiments) {
    const avant = lus.get(id);
    const { valeurs, change } = changementBatiment(avant, b);
    if (!change) continue;
    batiments.push({ sorte: 'batiment', id, valeurs });
    if (b.zoneId !== null && b.zoneId !== (avant?.zoneId ?? null) && e.zones.some((z) => z.id === b.zoneId && z.contour !== null)) zonesAEffacer.add(b.zoneId);
  }
  const zones: ChangementPlacement[] = [...zonesAEffacer].map((id) => ({ sorte: 'zone', id, contour: null }));
  const lues = new Map(e.planches.map((p) => [p.id, p]));
  const planches: ChangementPlacement[] = [];
  for (const [id, p] of e.brouillonPlanches) {
    const avant = lues.get(id);
    if (avant === undefined) continue;
    const a = avant.placement;
    const n = p.placement;
    if (memeM(a.x, n.x) && memeM(a.y, n.y) && memeCap(a.orientation_deg, n.orientation_deg)) continue;
    planches.push({ sorte: 'emplacement', id, placement: { x: arrondiM(n.x), y: arrondiM(n.y), orientation_deg: arrondiDeg(n.orientation_deg) } });
  }
  return [...zones, ...batiments, ...planches];
}
