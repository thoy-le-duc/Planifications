/**
 * Tests d'acceptation T85 — le bloc d'une zone (docs/backlog/T85-parcelle-depuis-planches.md, règle 5),
 * en fonctions pures : le contour et le repère de ses planches bougent ensemble, les planches gardent
 * leur place dans la zone. Repère de la ferme : x est, y nord ; rotation en degrés, sens horaire.
 *
 * Calcul à la main. Contour (100 ; 0) (140 ; 0) (140 ; 30) (100 ; 30) : centre (120 ; 15), plus long côté
 * est-ouest, donc cap 90°. Une planche en (5 ; 2) dans ce repère : x = 120 + 5·cos 90° + 2·sin 90° = 122,
 * y = 15 − 5·sin 90° + 2·cos 90° = 10, soit (122 ; 10) dans la ferme.
 *   Rotation de 90° (horaire) autour de (120 ; 15) : (dx ; dy) → (dy ; −dx).
 *     sommets : (−20 ; −15) → (−15 ; 20), (20 ; −15) → (−15 ; −20), (20 ; 15) → (15 ; −20), (−20 ; 15) → (15 ; 20),
 *     soit (105 ; 35) (105 ; −5) (135 ; −5) (135 ; 35) ;
 *     la planche (2 ; −5) → (−5 ; −2), soit (115 ; 13) ; son cap 90° devient 180°.
 *   Translation de (3 ; −2) : tout bouge de (3 ; −2), les caps ne changent pas.
 */
import { describe, expect, it } from 'vitest';
import { depuisRepereZone, repereZone } from './coeur.ts';
import { mouvoirBloc, replacerEntreReperes, replacerPlanches } from './contours.ts';

const CONTOUR = [
  { x: 100, y: 0 },
  { x: 140, y: 0 },
  { x: 140, y: 30 },
  { x: 100, y: 30 },
] as const;
const CALAGE = { centre: { x: 120, y: 15 }, orientationDeg: 90 };

const proche = (a: { x: number; y: number }, b: { x: number; y: number }, chiffres = 6): void => {
  expect(a.x).toBeCloseTo(b.x, chiffres);
  expect(a.y).toBeCloseTo(b.y, chiffres);
};
const capAbsolu = (calage: { orientationDeg: number }, local: number): number => (((calage.orientationDeg + local) % 360) + 360) % 360;

describe('T85 : mouvoirBloc', () => {
  it('translation de (3 ; −2) : contour et repère bougent du même vecteur, caps inchangés', () => {
    const r = mouvoirBloc(CONTOUR, CALAGE, { dx: 3, dy: -2, rotationDeg: 0 });
    expect(r).not.toBeNull();
    if (r === null) return;
    r.contour.forEach((p, i) => {
      proche(p, { x: (CONTOUR[i]?.x ?? 0) + 3, y: (CONTOUR[i]?.y ?? 0) - 2 });
    });
    proche(r.calage.centre, { x: 123, y: 13 });
    expect(capAbsolu(r.calage, 0)).toBeCloseTo(90, 6);
  });

  it('rotation de 90° : sommets (105 ; 35) (105 ; −5) (135 ; −5) (135 ; 35), la planche (5 ; 2) passe en (115 ; 13), cap 180°', () => {
    const r = mouvoirBloc(CONTOUR, CALAGE, { dx: 0, dy: 0, rotationDeg: 90 });
    expect(r).not.toBeNull();
    if (r === null) return;
    const attendus = [
      { x: 105, y: 35 },
      { x: 105, y: -5 },
      { x: 135, y: -5 },
      { x: 135, y: 35 },
    ];
    r.contour.forEach((p, i) => {
      proche(p, attendus[i] ?? p);
    });
    // La planche garde son placement (5 ; 2 ; 0°) dans le repère : elle suit.
    proche(depuisRepereZone(r.calage, { x: 5, y: 2 }), { x: 115, y: 13 });
    expect(capAbsolu(r.calage, 0)).toBeCloseTo(180, 6);
    // Le repère reste celui d'un contour qui garde sa forme : même centre.
    proche(r.calage.centre, { x: 120, y: 15 });
  });

  it('rotation puis translation : la rotation se fait autour du centre du contour, avant la translation', () => {
    const r = mouvoirBloc(CONTOUR, CALAGE, { dx: 10, dy: 20, rotationDeg: 90 });
    expect(r).not.toBeNull();
    if (r === null) return;
    proche(r.contour[0] ?? { x: 0, y: 0 }, { x: 115, y: 55 });
    proche(depuisRepereZone(r.calage, { x: 5, y: 2 }), { x: 125, y: 33 });
  });

  it('tourner de −90° puis de +90° remet tout à sa place (à 1 µm près)', () => {
    const a = mouvoirBloc(CONTOUR, CALAGE, { dx: 0, dy: 0, rotationDeg: -90 });
    expect(a).not.toBeNull();
    if (a === null) return;
    const b = mouvoirBloc(a.contour, a.calage, { dx: 0, dy: 0, rotationDeg: 90 });
    expect(b).not.toBeNull();
    if (b === null) return;
    b.contour.forEach((p, i) => {
      proche(p, CONTOUR[i] ?? p, 6);
    });
    proche(depuisRepereZone(b.calage, { x: 5, y: 2 }), { x: 122, y: 10 });
  });

  it('le repère du bloc tourné a le même centre que le contour tourné', () => {
    const r = mouvoirBloc(CONTOUR, CALAGE, { dx: 0, dy: 0, rotationDeg: 37 });
    expect(r).not.toBeNull();
    if (r === null) return;
    const apres = repereZone({ contour: r.contour });
    expect(apres).not.toBeNull();
    if (apres !== null) proche(apres.centre, r.calage.centre);
  });

  it('contour invalide (moins de 3 sommets, aire nulle) : null', () => {
    expect(mouvoirBloc([{ x: 0, y: 0 }, { x: 1, y: 1 }], CALAGE, { dx: 1, dy: 1, rotationDeg: 0 })).toBeNull();
    expect(
      mouvoirBloc(
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 2, y: 0 },
        ],
        CALAGE,
        { dx: 1, dy: 1, rotationDeg: 0 },
      ),
    ).toBeNull();
  });

  it('ne modifie pas ses arguments', () => {
    const contour = CONTOUR.map((p) => ({ ...p }));
    const calage = { centre: { ...CALAGE.centre }, orientationDeg: CALAGE.orientationDeg };
    mouvoirBloc(contour, calage, { dx: 1, dy: 2, rotationDeg: 30 });
    expect(contour).toEqual(CONTOUR.map((p) => ({ ...p })));
    expect(calage).toEqual(CALAGE);
  });
});

describe('T85 : replacerEntreReperes', () => {
  it('de et vers les repères de deux contours : même résultat que replacerPlanches', () => {
    const nouveau = [
      { x: 100, y: 0 },
      { x: 140, y: 0 },
      { x: 140, y: 40 },
      { x: 100, y: 40 },
    ];
    const planches = [{ id: 'a', placement: { x: 5, y: 2, orientation_deg: 0 } }];
    const avant = repereZone({ contour: CONTOUR });
    const apres = repereZone({ contour: nouveau });
    expect(avant).not.toBeNull();
    expect(apres).not.toBeNull();
    if (avant === null || apres === null) return;
    expect(replacerEntreReperes(avant, apres, planches)).toEqual(replacerPlanches(CONTOUR, nouveau, planches));
  });

  it('même repère : placements inchangés ; le terrain ne bouge pas quand le repère tourne', () => {
    const planches = [{ id: 'a', placement: { x: 5, y: 2, orientation_deg: 10 } }];
    expect(replacerEntreReperes(CALAGE, CALAGE, planches)).toEqual(planches);
    const tourne = { centre: CALAGE.centre, orientationDeg: 180 };
    const [r] = replacerEntreReperes(CALAGE, tourne, planches);
    expect(r).toBeDefined();
    if (r === undefined) return;
    proche(depuisRepereZone(tourne, r.placement), depuisRepereZone(CALAGE, planches[0]?.placement ?? { x: 0, y: 0 }));
    expect(capAbsolu(tourne, r.placement.orientation_deg)).toBeCloseTo(capAbsolu(CALAGE, 10), 6);
  });
});
