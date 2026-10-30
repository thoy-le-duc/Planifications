/**
 * T91 : la 3D ne dessine plus que ce qui est placé. Les plans écrits à la main des tests de T27 à T59 n'ont ni
 * contour ni serre : ce petit outil donne à chaque zone racine sans contour un rectangle de 60 × 40 m, chacun
 * à 100 m du précédent (assez grand pour ranger leurs planches), pour que la scène les contienne comme avant.
 */
import type { LigneZonePlan, Plan, PointPlan } from '../../plan/calculs.ts';

const rectangle = (i: number): readonly PointPlan[] => [
  { x: 100 * i, y: 0 },
  { x: 100 * i + 60, y: 0 },
  { x: 100 * i + 60, y: 40 },
  { x: 100 * i, y: 40 },
];

/** Même plan, mais chaque zone racine sans contour en reçoit un (les zones qui en ont déjà un ne changent pas). */
export function avecZonesPlacees<P extends Pick<Plan, 'lignes'>>(plan: P): P {
  let i = 0;
  const lignes = plan.lignes.map((l) => {
    if (l.sorte !== 'zone') return l;
    const rang = i;
    i += 1;
    return l.contour == null ? ({ ...l, contour: rectangle(rang) } satisfies LigneZonePlan) : l;
  });
  return { ...plan, lignes };
}
