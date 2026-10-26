/**
 * T85 : de la parcelle calculée par le cœur au contour et aux placements du brouillon. Chargé à la
 * demande (geste rare, comme serre-englobante.ts) : il n'alourdit pas l'ouverture de l'éditeur.
 *
 * Le rectangle se pose autour de `centre` (repère de la ferme), longueur vers le nord ; chaque
 * emplacement reçoit son placement dans le repère du contour (millimètre, millième de degré), cap
 * absolu 0° : les planches y sont au nord, côte à côte.
 */
import { parcelleDepuisPlanches } from '@planif/core/placement';
import { repereZone, versRepereZone, type RepereZone } from './coeur.ts';
import { verifierContour } from './contours.ts';
import type { EmplacementEnService, Planche } from './donnees.ts';
import { normaliserCap } from './gestes.ts';
import type { Point } from './tuiles.ts';

const mm = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const millieme = (v: number): number => normaliserCap(Math.round(v * 1000) / 1000) + 0;

export type ParcelleDessinee =
  | {
      readonly ok: true;
      /** Les 4 sommets, sens antihoraire (sud-ouest, sud-est, nord-est, nord-ouest). */
      readonly contour: Point[];
      /** Repère de ce contour : celui où les planches ci-dessous sont placées. */
      readonly calage: RepereZone;
      /** Une planche par emplacement, placement dans le repère du contour. */
      readonly planches: Planche[];
    }
  | { readonly ok: false; readonly message: string };

export const MESSAGE_PASSE_PIED = 'Le passe-pied est un nombre entier de centimètres, de 0 à 500.';

export function preparerParcelle(zoneId: string, emplacements: readonly EmplacementEnService[], passePiedCm: number, centre: Point): ParcelleDessinee {
  const parcelle = parcelleDepuisPlanches(
    emplacements.map((e) => ({ id: e.id, code: e.code, longueurM: e.longueurM, largeurM: e.largeurM })),
    passePiedCm,
  );
  if (parcelle === null) return { ok: false, message: emplacements.length === 0 ? 'Cette zone n’a aucune planche à ranger.' : MESSAGE_PASSE_PIED };
  const c = { x: mm(centre.x), y: mm(centre.y) };
  const l = parcelle.largeurM / 2;
  const L = parcelle.longueurM / 2;
  const verdict = verifierContour([
    { x: mm(c.x - l), y: mm(c.y - L) },
    { x: mm(c.x + l), y: mm(c.y - L) },
    { x: mm(c.x + l), y: mm(c.y + L) },
    { x: mm(c.x - l), y: mm(c.y + L) },
  ]);
  if (!verdict.ok) return { ok: false, message: verdict.message };
  const calage = repereZone({ contour: verdict.contour });
  if (calage === null) return { ok: false, message: 'La parcelle n’a pas de forme.' };
  const parId = new Map(emplacements.map((e) => [e.id, e]));
  const planches: Planche[] = [];
  for (const r of parcelle.planches) {
    const e = parId.get(r.id);
    if (e === undefined) continue;
    const local = versRepereZone(calage, { x: c.x + r.centre.x, y: c.y + r.centre.y });
    planches.push({ id: e.id, zoneId, code: e.code, longueurM: r.longueurM, largeurM: r.largeurM, placement: { x: mm(local.x), y: mm(local.y), orientation_deg: millieme(-calage.orientationDeg) } });
  }
  return { ok: true, contour: verdict.contour, calage, planches };
}
