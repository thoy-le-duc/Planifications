/**
 * T81 : ce qui ne sert qu'au « Remplacer par une serre », chargé à la demande : le rectangle englobant
 * minimal du contour, et l'avertissement montré avant de confirmer. Geste rare : il n'alourdit pas
 * l'ouverture de l'éditeur (budget propre).
 */
import { coinsEmprise, depuisRepereZone, rectangleEnglobantMinimal, versRepereZone, type RectangleEnglobant, type RepereZone } from '@planif/core/placement';
import type { Point } from './tuiles.ts';
import type { Planche } from './donnees.ts';
import { depuisPlacementPlanche, normaliserCap } from './gestes.ts';

/** Marge sous laquelle un coin de planche au bord de la serre est dedans (m). */
const MARGE_M = 0.01;

/** Arrondi au millimètre, comme le bâtiment posé. */
const mm = (v: number): number => Math.round(v * 1000) / 1000;

/**
 * Ce qu'il faut savoir avant de remplacer le contour par la serre : l'avertissement (contour inutilisable, ou
 * nombre de planches qui sortent de la serre), et les planches de la zone (placées dans le repère `repere` du
 * contour) avec leur placement converti dans le repère de la serre : elles restent au même endroit du terrain.
 */
export function preparerRemplacement(
  contour: readonly Point[] | null | undefined,
  planches: readonly Planche[],
  repere: RepereZone | null | undefined,
): { englobant: RectangleEnglobant | null; avis: string | null; converties: [string, Planche][] } {
  const brut = contour == null ? null : rectangleEnglobantMinimal(contour);
  // Au millimètre, comme le bâtiment écrit.
  const serre = brut && { centre: { x: mm(brut.centre.x), y: mm(brut.centre.y) }, longueurM: mm(brut.longueurM), largeurM: mm(brut.largeurM), orientationDeg: mm(brut.orientationDeg) };
  if (serre === null) return { englobant: null, avis: 'Contour inutilisable, la serre est posée au centre de la vue.', converties: [] };
  if (repere == null) return { englobant: serre, avis: null, converties: [] };
  const hors = planches.filter((p) => {
    const { centre, orientationDeg } = depuisPlacementPlanche(repere, p.placement);
    return coinsEmprise(centre, p.longueurM, p.largeurM, orientationDeg).some((c) => {
      const l = versRepereZone(serre, c);
      return Math.abs(l.x) > serre.largeurM / 2 + MARGE_M || Math.abs(l.y) > serre.longueurM / 2 + MARGE_M;
    });
  }).length;
  return {
    englobant: serre,
    avis: hors === 0 ? null : `${String(hors)} planche${hors > 1 ? 's' : ''} hors de la serre.`,
    converties: planches.map((p) => {
      const { x, y } = versRepereZone(serre, depuisRepereZone(repere, p.placement));
      return [p.id, { ...p, placement: { x: mm(x), y: mm(y), orientation_deg: normaliserCap(mm(p.placement.orientation_deg + repere.orientationDeg - serre.orientationDeg)) } }] as [string, Planche];
    }),
  };
}
