/**
 * Brouillon de l'éditeur de placement (T28b) : ce que l'on a changé depuis la dernière lecture de
 * la base, et les changements à donner à `porte.placer` (un seul appel pour tout le brouillon).
 * Rien n'est écrit pendant un geste ; les valeurs écrites sont arrondies au millimètre (cap :
 * millième de degré) pour effacer le bruit des calculs en virgule flottante.
 */
import type { ChangementPlacement, ValeursBatiment } from '@planif/sync';
import { normaliserCap } from './gestes.ts';
import { replacerPlanches, verifierContour } from './contours.ts';
import type { Batiment, EmplacementPlace, Planche, Zone } from './donnees.ts';
import type { Point } from './tuiles.ts';

/** Limite d'écritures d'un envoi (ECRITURES_MAX_PAR_LOT du cœur : 500). Le cœur entier n'entre pas dans le morceau de l'éditeur. */
export const ECRITURES_MAX_PAR_LOT = 500;

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
  /** Tous les emplacements placés de la ferme (planches, rangs…), pour les replacer quand le contour de leur zone change. */
  readonly emplacements: readonly EmplacementPlace[];
  readonly brouillonPlanches: ReadonlyMap<string, Planche>;
  /** Contours de zone changés au brouillon (ordre des sommets tel que dessiné). */
  readonly brouillonZones: ReadonlyMap<string, readonly Point[]>;
  /** Zones abritées par un bâtiment, au brouillon compris : leur contour n'existe pas. */
  readonly zonesAbritees: ReadonlySet<string>;
}

/**
 * Le contour tel que la porte le range : sommets au millimètre, sens antihoraire. `null` si
 * `validerContour` le refuse.
 */
export function contourEcrit(contour: readonly Point[]): Point[] | null {
  const v = verifierContour(contour.map((p) => ({ x: arrondiM(p.x), y: arrondiM(p.y) })));
  return v.ok ? v.contour : null;
}

/** Le contour du brouillon diffère-t-il de celui de la base (refusé par le cœur : toujours différent) ? */
export function contourChange(lu: readonly Point[] | null, brouillon: readonly Point[]): boolean {
  const ecrit = contourEcrit(brouillon);
  if (ecrit === null || lu === null) return true;
  if (ecrit.length !== lu.length) return true;
  return ecrit.some((p, i) => {
    const q = lu[i];
    return q === undefined || !memeM(p.x, q.x) || !memeM(p.y, q.y);
  });
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
 * a un contour ne peut pas être abritée), bâtiments (une serre détachée avant que sa zone reçoive
 * un contour), contours posés ou changés, puis emplacements (tous ceux d'une zone dont le contour
 * change sont réécrits : leur repère change, pas leur place sur le terrain). Liste vide : rien à écrire.
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
  const effaces: ChangementPlacement[] = [...zonesAEffacer].map((id) => ({ sorte: 'zone', id, contour: null }));
  const posees: ChangementPlacement[] = [];

  // Contours changés (valides, zone non abritée) : le contour, et ses planches replacées au même endroit du terrain.
  const contours = new Map<string, { readonly lu: readonly Point[] | null; readonly nouveau: readonly Point[] }>();
  for (const z of e.zones) {
    const b = e.brouillonZones.get(z.id);
    if (b === undefined || e.zonesAbritees.has(z.id) || !contourChange(z.contour, b)) continue;
    const nouveau = contourEcrit(b);
    if (nouveau === null) continue;
    contours.set(z.id, { lu: z.contour, nouveau });
    posees.push({ sorte: 'zone', id: z.id, contour: nouveau });
  }

  const emplacements: ChangementPlacement[] = [];
  const ecrits = new Set<string>();
  for (const emp of e.emplacements) {
    const contour = contours.get(emp.zoneId);
    if (contour?.lu == null) continue;
    const base = e.brouillonPlanches.get(emp.id)?.placement ?? emp.placement;
    const [replacee] = replacerPlanches(contour.lu, contour.nouveau, [{ id: emp.id, placement: base }]);
    if (replacee === undefined) continue;
    const n = replacee.placement;
    ecrits.add(emp.id);
    emplacements.push({ sorte: 'emplacement', id: emp.id, placement: { x: arrondiM(n.x), y: arrondiM(n.y), orientation_deg: arrondiDeg(n.orientation_deg) } });
  }
  for (const avant of e.planches) {
    const id = avant.id;
    const nouvelle = e.brouillonPlanches.get(id);
    if (ecrits.has(id) || nouvelle === undefined) continue;
    const a = avant.placement;
    const n = nouvelle.placement;
    if (memeM(a.x, n.x) && memeM(a.y, n.y) && memeCap(a.orientation_deg, n.orientation_deg)) continue;
    emplacements.push({ sorte: 'emplacement', id, placement: { x: arrondiM(n.x), y: arrondiM(n.y), orientation_deg: arrondiDeg(n.orientation_deg) } });
  }
  return [...effaces, ...batiments, ...posees, ...emplacements];
}
