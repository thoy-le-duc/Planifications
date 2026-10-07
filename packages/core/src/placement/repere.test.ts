/**
 * Tests d'acceptation T28a — repère local de la ferme et repère des zones (docs/backlog/
 * T28a-placement-modele.md, critères 1 et 2). Contrat : ./test/contrat.ts.
 *
 * Exemples chiffrés :
 *   - origine 44° N, 1,5° E : le point (44,000 898 315 284 12° N ; 1,501 248 805 201 236 7° E)
 *     est à 100 m au nord et 100 m à l'est → (100, 100) ;
 *   - planche à (2, 0) dans une serre centrée en (50, 30), tournée de 90° → (50, 28) ;
 *   - zone en L sans serre (0,0) (20,0) (20,10) (10,10) (10,30) (0,30) : aire 400 m²,
 *     centroïde (7,5 ; 12,5), plus long côté (0,30)→(0,0) → orientation 0°.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { aireSignee, chargerCoeurPlacement, chargerPlacement, tourner, type ModulePlacement, type PointLocal } from './test/contrat.ts';

let m: ModulePlacement;

beforeAll(async () => {
  m = await chargerPlacement();
});

const ORIGINE = { latitude: 44, longitude: 1.5 } as const;
/** 1 mm. */
const MM = 1e-3;

function proche(recu: PointLocal, attendu: PointLocal, tolerance = MM): void {
  expect(Math.abs(recu.x - attendu.x), `x reçu ${String(recu.x)}, attendu ${String(attendu.x)}`).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(recu.y - attendu.y), `y reçu ${String(recu.y)}, attendu ${String(attendu.y)}`).toBeLessThanOrEqual(tolerance);
}

/** Distance du grand cercle (haversine, même rayon) : contrôle indépendant de la projection. */
function haversine(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const r = Math.PI / 180;
  const dPhi = (b.latitude - a.latitude) * r;
  const dLambda = (b.longitude - a.longitude) * r;
  const h = Math.sin(dPhi / 2) ** 2 + Math.cos(a.latitude * r) * Math.cos(b.latitude * r) * Math.sin(dLambda / 2) ** 2;
  return 2 * 6_378_137 * Math.asin(Math.sqrt(h));
}

describe('T28a : @planif/core exporte le module de placement', () => {
  it('fonctions et constantes du contrat', async () => {
    const coeur = await chargerCoeurPlacement();
    for (const nom of ['versLocal', 'versGeographique', 'coinsEmprise', 'repereZone', 'versRepereZone', 'depuisRepereZone', 'validerContour', 'validerPlacement'] as const) {
      expect(typeof coeur[nom], nom).toBe('function');
    }
  });

  it('constantes du ticket', () => {
    expect(m.RAYON_TERRESTRE_M).toBe(6_378_137);
    expect(m.DISTANCE_MAX_ORIGINE_M).toBe(5_000);
    expect(m.CONTOUR_SOMMETS_MIN).toBe(3);
    expect(m.CONTOUR_SOMMETS_MAX).toBe(200);
    expect(m.AIRE_MIN_M2).toBe(0.1);
    expect(m.PLAFONDS_BATIMENT).toEqual({ longueurM: 500, largeurM: 200, hauteurM: 30 });
    expect([...m.TYPES_BATIMENT].sort()).toEqual(['autre', 'hangar', 'magasin', 'serre_chapelle', 'serre_tunnel']);
  });
});

describe('T28a : versLocal / versGeographique (origine à 44° N)', () => {
  it('l’origine elle-même → (0, 0)', () => {
    proche(m.versLocal(ORIGINE, ORIGINE), { x: 0, y: 0 }, 1e-9);
  });

  it('exemple chiffré : 100 m au nord et 100 m à l’est → (100, 100)', () => {
    const point = { latitude: 44.00089831528412, longitude: 1.5012488052012367 };
    proche(m.versLocal(ORIGINE, point), { x: 100, y: 100 });
  });

  it('exemple chiffré, dans l’autre sens : (100, 100) → 44,000 898 3° N ; 1,501 248 8° E', () => {
    const g = m.versGeographique(ORIGINE, { x: 100, y: 100 });
    expect(g.latitude).toBeCloseTo(44.00089831528412, 10);
    expect(g.longitude).toBeCloseTo(1.5012488052012367, 10);
  });

  it('100 m vers l’est, mesurés par le grand cercle : 100 m au centimètre près (cos de la latitude)', () => {
    const g = m.versGeographique(ORIGINE, { x: 100, y: 0 });
    expect(g.latitude).toBeCloseTo(44, 12);
    expect(Math.abs(haversine(ORIGINE, g) - 100)).toBeLessThan(0.01);
  });

  it.each([
    [0, { x: 0, y: 250 }],
    [90, { x: 250, y: 0 }],
    [180, { x: 0, y: -250 }],
    [270, { x: -250, y: 0 }],
  ] as const)('cap %i° à 250 m → %o', (cap, attendu) => {
    // Le point au cap donné, à 250 m, calculé indépendamment (petits angles, même projection).
    const r = Math.PI / 180;
    const dNord = 250 * Math.cos(cap * r);
    const dEst = 250 * Math.sin(cap * r);
    const point = {
      latitude: ORIGINE.latitude + dNord / 6_378_137 / r,
      longitude: ORIGINE.longitude + dEst / (6_378_137 * Math.cos(ORIGINE.latitude * r)) / r,
    };
    proche(m.versLocal(ORIGINE, point), attendu);
    const g = m.versGeographique(ORIGINE, attendu);
    expect(g.latitude).toBeCloseTo(point.latitude, 10);
    expect(g.longitude).toBeCloseTo(point.longitude, 10);
  });

  it('aller-retour local → géographique → local : moins de 1 cm, jusqu’à 5 km, dans toutes les directions', () => {
    for (let cap = 0; cap < 360; cap += 15) {
      for (const d of [1, 10, 100, 1_000, 2_500, 4_999, 5_000]) {
        const p = { x: d * Math.sin((cap * Math.PI) / 180), y: d * Math.cos((cap * Math.PI) / 180) };
        const retour = m.versLocal(ORIGINE, m.versGeographique(ORIGINE, p));
        proche(retour, p, 0.01);
      }
    }
  });

  it('aller-retour géographique → local → géographique : moins de 1 cm au sol, à 5 km', () => {
    for (const [dLat, dLon] of [
      [0.04, 0.05],
      [-0.03, 0.06],
      [0.044, -0.02],
      [-0.01, -0.06],
    ] as const) {
      const p = { latitude: ORIGINE.latitude + dLat, longitude: ORIGINE.longitude + dLon };
      const retour = m.versGeographique(ORIGINE, m.versLocal(ORIGINE, p));
      expect(haversine(p, retour)).toBeLessThan(0.01);
    }
  });

  it('autre origine (Bretagne, 48,1° N ; −1,7° E) : 100 m au nord reste (0, 100)', () => {
    const o = { latitude: 48.1, longitude: -1.7 };
    const g = m.versGeographique(o, { x: 0, y: 100 });
    expect(g.longitude).toBeCloseTo(-1.7, 12);
    proche(m.versLocal(o, g), { x: 0, y: 100 });
    expect(Math.abs(haversine(o, g) - 100)).toBeLessThan(0.01);
  });
});

describe('T28a : coinsEmprise', () => {
  it('orientation 0 : longueur vers le nord, coins dans l’ordre du contrat', () => {
    const coins = m.coinsEmprise({ x: 10, y: 20 }, 30, 8, 0);
    expect(coins).toHaveLength(4);
    const attendus = [
      { x: 6, y: 5 },
      { x: 14, y: 5 },
      { x: 14, y: 35 },
      { x: 6, y: 35 },
    ];
    attendus.forEach((a, i) => {
      proche(coins[i] ?? { x: NaN, y: NaN }, a, 1e-9);
    });
  });

  it('orientation 90 : longueur vers l’est', () => {
    const coins = m.coinsEmprise({ x: 10, y: 20 }, 30, 8, 90);
    const attendus = [
      { x: -5, y: 24 },
      { x: -5, y: 16 },
      { x: 25, y: 16 },
      { x: 25, y: 24 },
    ];
    attendus.forEach((a, i) => {
      proche(coins[i] ?? { x: NaN, y: NaN }, a, 1e-9);
    });
  });

  it.each([0, 30, 90, 135, 180, 270, 359.5])('orientation %s° : antihoraire, aire = longueur × largeur, centre conservé', (o) => {
    const coins = m.coinsEmprise({ x: -40, y: 12 }, 25, 9.6, o);
    expect(aireSignee(coins)).toBeCloseTo(25 * 9.6, 9);
    const cx = coins.reduce((s, p) => s + p.x, 0) / 4;
    const cy = coins.reduce((s, p) => s + p.y, 0) / 4;
    proche({ x: cx, y: cy }, { x: -40, y: 12 }, 1e-9);
  });

  it('orientation 180 : mêmes coins que 0, dans un autre ordre (un rectangle n’a pas de sens)', () => {
    const a = m.coinsEmprise({ x: 0, y: 0 }, 30, 8, 0).map((p) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`);
    const b = m.coinsEmprise({ x: 0, y: 0 }, 30, 8, 180).map((p) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`);
    expect([...b].sort()).toEqual([...a].sort());
  });
});

describe('T28a : repère d’une zone et planches', () => {
  const SERRE = { centre: { x: 50, y: 30 }, orientationDeg: 90 } as const;

  it('exemple du ticket : planche à (2, 0) dans une serre tournée de 90° → (50, 28)', () => {
    const repere = m.repereZone({ contour: null }, SERRE);
    expect(repere).not.toBeNull();
    if (repere === null) return;
    proche(m.depuisRepereZone(repere, { x: 2, y: 0 }), { x: 50, y: 28 }, 1e-9);
    // Et l'axe de la longueur : 10 m « devant » dans la serre = 10 m à l'est.
    proche(m.depuisRepereZone(repere, { x: 0, y: 10 }), { x: 60, y: 30 }, 1e-9);
  });

  it('zone abritée : le repère est celui du bâtiment, même si un contour traîne', () => {
    const r = m.repereZone({ contour: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] }, SERRE);
    expect(r?.centre).toEqual({ x: 50, y: 30 });
    expect(r?.orientationDeg).toBe(90);
  });

  it('bouger la serre bouge ses planches : même point de zone, autre serre', () => {
    const avant = m.repereZone({ contour: null }, SERRE);
    const apres = m.repereZone({ contour: null }, { centre: { x: 150, y: 30 }, orientationDeg: 0 });
    if (avant === null || apres === null) throw new Error('repère attendu');
    proche(m.depuisRepereZone(apres, { x: 2, y: 0 }), { x: 152, y: 30 }, 1e-9);
    proche(m.depuisRepereZone(avant, { x: 2, y: 0 }), { x: 50, y: 28 }, 1e-9);
  });

  it('versRepereZone est l’inverse exact de depuisRepereZone', () => {
    for (const o of [0, 17, 90, 180, 233.25, 359.99]) {
      const r = { centre: { x: -120.5, y: 48.25 }, orientationDeg: o };
      for (const p of [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: -3.5, y: 41 },
        { x: 12.75, y: -8 },
      ]) {
        proche(m.versRepereZone(r, m.depuisRepereZone(r, p)), p, 1e-9);
        proche(m.depuisRepereZone(r, m.versRepereZone(r, p)), p, 1e-9);
      }
    }
  });

  it('les coins d’une serre, ramenés dans son repère, sont (±l/2, ±L/2)', () => {
    const r = { centre: { x: 7, y: -3 }, orientationDeg: 33 };
    const coins = m.coinsEmprise(r.centre, 40, 8, r.orientationDeg).map((p) => m.versRepereZone(r, p));
    const attendus = [
      { x: -4, y: -20 },
      { x: 4, y: -20 },
      { x: 4, y: 20 },
      { x: -4, y: 20 },
    ];
    attendus.forEach((a, i) => {
      proche(coins[i] ?? { x: NaN, y: NaN }, a, 1e-9);
    });
  });

  const L: readonly PointLocal[] = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 10 },
    { x: 10, y: 10 },
    { x: 10, y: 30 },
    { x: 0, y: 30 },
  ];

  it('zone en L sans serre : centroïde de surface (7,5 ; 12,5), orientation 0 (plus long côté nord-sud)', () => {
    const r = m.repereZone({ contour: L });
    expect(r).not.toBeNull();
    proche(r?.centre ?? { x: NaN, y: NaN }, { x: 7.5, y: 12.5 }, 1e-9);
    // La moyenne des sommets donnerait (10, 13,33) : ce n'est pas elle.
    expect(r?.orientationDeg).toBeCloseTo(0, 9);
  });

  it('zone en L tournée de 30° (sens horaire) : centroïde tourné, orientation 30', () => {
    const tourne = L.map((p) => tourner(p, 30));
    const r = m.repereZone({ contour: tourne }, null);
    proche(r?.centre ?? { x: NaN, y: NaN }, tourner({ x: 7.5, y: 12.5 }, 30), 1e-9);
    expect(r?.orientationDeg).toBeCloseTo(30, 9);
  });

  it('orientation ramenée dans [0, 180[ : L tourné de 200° → 20 ; contour parcouru à l’envers → même orientation', () => {
    const tourne = L.map((p) => tourner(p, 200));
    expect(m.repereZone({ contour: tourne })?.orientationDeg).toBeCloseTo(20, 9);
    expect(m.repereZone({ contour: [...tourne].reverse() })?.orientationDeg).toBeCloseTo(20, 9);
  });

  it('plus long côté est-ouest : orientation 90', () => {
    const r = m.repereZone({
      contour: [
        { x: 0, y: 0 },
        { x: 60, y: 0 },
        { x: 60, y: 8 },
        { x: 0, y: 8 },
      ],
    });
    expect(r?.orientationDeg).toBeCloseTo(90, 9);
    proche(r?.centre ?? { x: NaN, y: NaN }, { x: 30, y: 4 }, 1e-9);
  });

  it('égalité de longueur : le premier côté le plus long dans l’ordre des sommets', () => {
    // Carré : les quatre côtés font 10 m ; le premier, (0,0)→(10,0), est au cap 90.
    const r = m.repereZone({
      contour: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
    });
    expect(r?.orientationDeg).toBeCloseTo(90, 9);
  });

  it('une planche placée dans une zone en L suit la zone quand on la tourne', () => {
    const r0 = m.repereZone({ contour: L });
    const r30 = m.repereZone({ contour: L.map((p) => tourner(p, 30)) });
    if (r0 === null || r30 === null) throw new Error('repère attendu');
    const planche = { x: 1.5, y: -4 };
    proche(m.depuisRepereZone(r30, planche), tourner(m.depuisRepereZone(r0, planche), 30), 1e-9);
  });

  it('zone ni placée ni abritée → null', () => {
    expect(m.repereZone({ contour: null })).toBeNull();
    expect(m.repereZone({ contour: null }, null)).toBeNull();
  });
});
