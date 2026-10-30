/**
 * Tests d'acceptation T90 — dupliquer une serre ou une parcelle : noms et positions des copies
 * (docs/backlog/T90-dupliquer.md, règles 1 et 3, critère « Test cœur »). Pur : mètres, degrés, aucun réseau.
 *
 * ── Contrat (à fournir dans packages/core/src/placement/duplication.ts, exporté par '@planif/core/placement') ──
 *
 *   COPIES_MAX = 20                 nombre de copies au plus (1 au moins)
 *   COPIES_PAR_DEFAUT = 1, ECART_PAR_DEFAUT_M = 1.5
 *   erreurDuplication({ nombre, ecartM }): string | null
 *       null si `nombre` est un entier de 1 à 20 et `ecartM` un nombre fini de 0 à 100 m ; sinon une phrase en français.
 *   nomsDesCopies(nom, pris, nombre): string[]
 *       `nombre` noms, dans l'ordre. Le dernier nombre du nom est incrémenté (« Tunnel 1 » → « Tunnel 2 », « Tunnel 3 »), en évitant
 *       les noms de `pris` (sans casse ni espaces autour) et ceux déjà donnés aux copies ; sans nombre, le nom reçoit « 2 » (« Serre » → « Serre 2 »).
 *   decalageDeCopie(orientationDeg, distanceM): { x, y }
 *       le vecteur, dans le repère de la ferme, d'un déplacement de `distanceM` selon l'axe x' d'un repère de cap `orientationDeg`.
 *   positionsDesCopies(repere, largeurM, ecartM, nombre): { centre, decalage, distanceM }[]
 *       copie k (de 1 à nombre) : distanceM = k × (largeur + écart), centre = centre du repère + décalage (au millimètre).
 *   largeurDuContour(contour, orientationDeg): number
 *       étendue du contour selon l'axe x' d'un repère de cap `orientationDeg` (le côté x positif de l'original).
 */
import { describe, expect, it } from 'vitest';
import * as placement from '@planif/core/placement';
import { coinsEmprise, versRepereZone } from '@planif/core/placement';

interface Point {
  readonly x: number;
  readonly y: number;
}
interface Repere {
  readonly centre: Point;
  readonly orientationDeg: number;
}
interface Copie {
  readonly centre: Point;
  readonly decalage: Point;
  readonly distanceM: number;
}
interface ModuleDuplication {
  readonly COPIES_MAX: number;
  readonly COPIES_PAR_DEFAUT: number;
  readonly ECART_PAR_DEFAUT_M: number;
  erreurDuplication(d: { nombre: number; ecartM: number }): string | null;
  nomsDesCopies(nom: string, pris: readonly string[], nombre: number): string[];
  decalageDeCopie(orientationDeg: number, distanceM: number): Point;
  positionsDesCopies(repere: Repere, largeurM: number, ecartM: number, nombre: number): Copie[];
  largeurDuContour(contour: readonly Point[], orientationDeg: number): number;
}
const f = placement as unknown as Partial<ModuleDuplication>;
const exige = <K extends keyof ModuleDuplication>(nom: K): ModuleDuplication[K] => {
  const v = f[nom];
  if (v === undefined) throw new Error(`@planif/core/placement doit exporter « ${nom} » (T90)`);
  return v;
};

describe('T90 : constantes', () => {
  it('20 copies au plus, 1 par défaut, écart de 1,5 m par défaut', () => {
    expect(exige('COPIES_MAX')).toBe(20);
    expect(exige('COPIES_PAR_DEFAUT')).toBe(1);
    expect(exige('ECART_PAR_DEFAUT_M')).toBe(1.5);
  });
});

describe('T90 : validité de la demande', () => {
  it.each([
    [1, 1.5],
    [20, 0],
    [3, 100],
  ])('%s copie(s), écart %s m : accepté', (nombre, ecartM) => {
    expect(exige('erreurDuplication')({ nombre, ecartM })).toBeNull();
  });

  it.each([
    ['0 copie', 0, 1.5],
    ['21 copies', 21, 1.5],
    ['1,5 copie', 1.5, 1.5],
    ['nombre illisible', Number.NaN, 1.5],
    ['écart négatif', 2, -0.1],
    ['écart illisible', 2, Number.NaN],
    ['écart infini', 2, Number.POSITIVE_INFINITY],
    ['écart de plus de 100 m', 2, 100.5],
  ])('%s : refusé avec une phrase', (_cas, nombre, ecartM) => {
    const erreur = exige('erreurDuplication')({ nombre, ecartM });
    expect(typeof erreur).toBe('string');
    expect((erreur ?? '').length).toBeGreaterThan(5);
  });
});

describe('T90 : noms des copies (règle 3)', () => {
  it('« Tunnel 1 » → « Tunnel 2 », « Tunnel 3 »', () => {
    expect(exige('nomsDesCopies')('Tunnel 1', ['Tunnel 1'], 2)).toEqual(['Tunnel 2', 'Tunnel 3']);
  });

  it('« Manon 1 » → « Manon 4 » quand « Manon 2 » et « Manon 3 » existent', () => {
    expect(exige('nomsDesCopies')('Manon 1', ['Manon 1', 'Manon 2', 'Manon 3'], 1)).toEqual(['Manon 4']);
  });

  it('sans nombre, « Serre » → « Serre 2 », puis « Serre 3 »', () => {
    expect(exige('nomsDesCopies')('Serre', ['Serre'], 1)).toEqual(['Serre 2']);
    expect(exige('nomsDesCopies')('Serre', ['Serre'], 2)).toEqual(['Serre 2', 'Serre 3']);
  });

  it('sans nombre, « Serre 2 » déjà pris : « Serre 3 »', () => {
    expect(exige('nomsDesCopies')('Serre', ['Serre', 'Serre 2'], 1)).toEqual(['Serre 3']);
  });

  it('le dernier nombre seulement est incrémenté, le reste du nom est gardé', () => {
    expect(exige('nomsDesCopies')('Tunnel 2 nord', [], 1)).toEqual(['Tunnel 3 nord']);
    expect(exige('nomsDesCopies')('Serre 12', [], 2)).toEqual(['Serre 13', 'Serre 14']);
    expect(exige('nomsDesCopies')('T9', [], 1)).toEqual(['T10']);
  });

  it('les noms pris se comparent sans casse ni espaces autour', () => {
    expect(exige('nomsDesCopies')('Tunnel 1', ['  TUNNEL 2 ', 'tunnel 3'], 1)).toEqual(['Tunnel 4']);
  });

  it('l’original n’a pas besoin d’être dans les noms pris', () => {
    expect(exige('nomsDesCopies')('Tunnel 1', [], 1)).toEqual(['Tunnel 2']);
  });

  it('trois copies avec des trous : chaque nom est libre et différent des autres', () => {
    expect(exige('nomsDesCopies')('Tunnel 1', ['Tunnel 1', 'Tunnel 3', 'Tunnel 5'], 3)).toEqual(['Tunnel 2', 'Tunnel 4', 'Tunnel 6']);
  });
});

describe('T90 : positions des copies (règle 1)', () => {
  it('trois copies d’une serre de 9,6 m de large, écart 1,5 m, cap 30° : centres à +11,1 ; +22,2 ; +33,3 m dans le repère de l’original', () => {
    const repere: Repere = { centre: { x: 120, y: 45 }, orientationDeg: 30 };
    const copies = exige('positionsDesCopies')(repere, 9.6, 1.5, 3);
    expect(copies).toHaveLength(3);
    [11.1, 22.2, 33.3].forEach((attendu, k) => {
      const copie = copies[k];
      expect(copie?.distanceM).toBeCloseTo(attendu, 6);
      const local = versRepereZone(repere, copie?.centre ?? { x: 0, y: 0 });
      expect(local.x).toBeCloseTo(attendu, 2);
      expect(local.y).toBeCloseTo(0, 2);
    });
  });

  it('cap 30° : la première copie est à (+11,1 cos 30°, −11,1 sin 30°) de l’original, dans le repère de la ferme', () => {
    const repere: Repere = { centre: { x: 120, y: 45 }, orientationDeg: 30 };
    const [premiere] = exige('positionsDesCopies')(repere, 9.6, 1.5, 1);
    expect(premiere?.centre.x).toBeCloseTo(120 + 11.1 * Math.cos(Math.PI / 6), 3);
    expect(premiere?.centre.y).toBeCloseTo(45 - 11.1 * Math.sin(Math.PI / 6), 3);
    expect(premiere?.decalage.x).toBeCloseTo(11.1 * Math.cos(Math.PI / 6), 3);
    expect(premiere?.decalage.y).toBeCloseTo(-11.1 * Math.sin(Math.PI / 6), 3);
  });

  it('cap 0° : les copies se suivent vers l’est, à la même ordonnée', () => {
    const copies = exige('positionsDesCopies')({ centre: { x: 200, y: 60 }, orientationDeg: 0 }, 28.8, 1.5, 2);
    expect(copies.map((c) => c.centre)).toEqual([
      { x: 230.3, y: 60 },
      { x: 260.6, y: 60 },
    ]);
  });

  it('écart nul : les copies se touchent', () => {
    const copies = exige('positionsDesCopies')({ centre: { x: 0, y: 0 }, orientationDeg: 0 }, 10, 0, 2);
    expect(copies.map((c) => c.centre.x)).toEqual([10, 20]);
  });

  it('les copies d’une serre posée ne se chevauchent pas : la distance entre deux copies voisines est largeur + écart', () => {
    const repere: Repere = { centre: { x: 10, y: 10 }, orientationDeg: 30 };
    const [a, b] = exige('positionsDesCopies')(repere, 9.6, 1.5, 2);
    const distance = Math.hypot((b?.centre.x ?? 0) - (a?.centre.x ?? 0), (b?.centre.y ?? 0) - (a?.centre.y ?? 0));
    expect(distance).toBeCloseTo(11.1, 3);
    // Les coins du côté x positif de l'original sont à 1,5 m du côté x négatif de la copie.
    const original = coinsEmprise(repere.centre, 40, 9.6, 30);
    const copie = coinsEmprise(a?.centre ?? repere.centre, 40, 9.6, 30);
    expect(Math.hypot(copie[0].x - original[1].x, copie[0].y - original[1].y)).toBeCloseTo(1.5, 3);
  });

  it('le décalage seul : 10 m selon x\' à 90° vont vers le sud (y décroît)', () => {
    const d = exige('decalageDeCopie')(90, 10);
    expect(d.x).toBeCloseTo(0, 6);
    expect(d.y).toBeCloseTo(-10, 6);
  });
});

describe('T90 : largeur d’un contour de plein champ', () => {
  const rectangle = (cx: number, cy: number, longueur: number, largeur: number, cap: number): Point[] => [...coinsEmprise({ x: cx, y: cy }, longueur, largeur, cap)];

  it('un rectangle de 9,6 m de large tourné de 30° : 9,6 m selon x\' du cap 30°', () => {
    expect(exige('largeurDuContour')(rectangle(100, 50, 40, 9.6, 30), 30)).toBeCloseTo(9.6, 6);
  });

  it('le champ du plan de test (40 × 30 m, cap 90°) : 30 m de large', () => {
    const contour = [
      { x: 100, y: 0 },
      { x: 140, y: 0 },
      { x: 140, y: 30 },
      { x: 100, y: 30 },
    ];
    expect(exige('largeurDuContour')(contour, 90)).toBeCloseTo(30, 6);
  });

  it('un contour en L : l’étendue totale, pas celle d’un morceau', () => {
    const contour = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 30 },
      { x: 0, y: 30 },
    ];
    expect(exige('largeurDuContour')(contour, 0)).toBeCloseTo(20, 6);
  });
});
