/**
 * Tests d'acceptation T28a — validerContour (docs/backlog/T28a-placement-modele.md, critère 3).
 * Contrat (ordre des règles, codes, sens normalisé) : ./test/contrat.ts.
 *
 * Valides : triangle, carré, L, polygone concave, 200 sommets. Refusés, avec un message en
 * français : 2 sommets, 201 sommets, nœud papillon (auto-intersection), sommets alignés (aire
 * nulle), sommets confondus, sommet à 6 km. Un contour horaire est rendu antihoraire.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { aireSignee, chargerPlacement, polygoneRegulier, type CodeErreurPlacement, type ModulePlacement, type PointLocal, type ResultatPlacement } from './test/contrat.ts';

let m: ModulePlacement;

beforeAll(async () => {
  m = await chargerPlacement();
});

const TRIANGLE: readonly PointLocal[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 0, y: 8 },
];
const CARRE: readonly PointLocal[] = [
  { x: 0, y: 0 },
  { x: 30, y: 0 },
  { x: 30, y: 30 },
  { x: 0, y: 30 },
];
const L: readonly PointLocal[] = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 10 },
  { x: 10, y: 10 },
  { x: 10, y: 30 },
  { x: 0, y: 30 },
];
/** Concave : une encoche en V dans le côté nord. */
const CONCAVE: readonly PointLocal[] = [
  { x: 0, y: 0 },
  { x: 40, y: 0 },
  { x: 40, y: 25 },
  { x: 20, y: 6 },
  { x: 0, y: 25 },
];

/** Valeur d'un résultat valide, ou échec du test avec l'erreur reçue. */
function valide<T>(r: ResultatPlacement<T>): T {
  if (!r.ok) throw new Error(`refusé à tort : ${r.erreur.code} — ${r.erreur.message}`);
  return r.valeur;
}

/** Le refus attendu, avec un message en français lisible. */
function refuse<T>(r: ResultatPlacement<T>, code: CodeErreurPlacement): string {
  expect(r.ok, 'le contour aurait dû être refusé').toBe(false);
  if (r.ok) return '';
  expect(r.erreur.code).toBe(code);
  const message = r.erreur.message;
  expect(message.trim().length).toBeGreaterThan(0);
  expect(message.length).toBeLessThanOrEqual(200);
  // En français : pas de message technique anglais.
  expect(message).not.toMatch(/\b(error|invalid|must|polygon|vertex|vertices|undefined|NaN)\b/i);
  return message;
}

const cle = (p: PointLocal) => `${String(p.x)},${String(p.y)}`;

describe('T28a : validerContour, contours valides', () => {
  it.each([
    ['triangle', TRIANGLE],
    ['carré', CARRE],
    ['L', L],
    ['polygone concave', CONCAVE],
  ] as const)('%s antihoraire : accepté, rendu à l’identique', (_nom, contour) => {
    expect(valide(m.validerContour(contour))).toEqual(contour);
  });

  it('200 sommets (le plafond) : accepté', () => {
    const contour = polygoneRegulier(200, 80);
    expect(valide(m.validerContour(contour))).toHaveLength(200);
  });

  it('sommets à 5 000 m pile de l’origine : acceptés (borne comprise)', () => {
    const contour = [
      { x: 5_000, y: 0 },
      { x: 0, y: 5_000 },
      { x: 0, y: 4_990 },
    ];
    expect(valide(m.validerContour(contour))).toEqual(contour);
  });

  it('aire juste au-dessus de 0,1 m² : acceptée', () => {
    valide(
      m.validerContour([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 0.3 },
      ]),
    );
  });

  it('deux côtés parallèles à 14 cm l’un de l’autre, sans se toucher : accepté (étranglement)', () => {
    // Voisin du « sommet repassé » refusé plus bas : (5 ; 4,9) et (5 ; 5,1) restent distincts.
    valide(
      m.validerContour([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 4.9 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
        { x: 5, y: 5.1 },
      ]),
    );
  });

  it('ne garde que x et y de chaque sommet', () => {
    const r = valide(m.validerContour(TRIANGLE.map((p, i) => ({ ...p, nom: `s${String(i)}` }))));
    for (const p of r) expect(Object.keys(p).sort()).toEqual(['x', 'y']);
  });
});

describe('T28a : validerContour, sens normalisé (antihoraire)', () => {
  it.each([
    ['triangle', TRIANGLE],
    ['carré', CARRE],
    ['L', L],
    ['concave', CONCAVE],
  ] as const)('%s horaire : rendu antihoraire, mêmes sommets dans l’ordre inverse', (_nom, contour) => {
    const horaire = [...contour].reverse();
    expect(aireSignee(horaire)).toBeLessThan(0);
    const r = valide(m.validerContour(horaire));
    expect(aireSignee(r)).toBeGreaterThan(0);
    expect(aireSignee(r)).toBeCloseTo(-aireSignee(horaire), 9);
    expect(r.map(cle).sort()).toEqual(horaire.map(cle).sort());
    // Permutation circulaire de l'ordre antihoraire d'origine.
    const debut = contour.findIndex((p) => cle(p) === cle(r[0] ?? { x: NaN, y: NaN }));
    expect(debut).toBeGreaterThanOrEqual(0);
    const attendu = [...contour.slice(debut), ...contour.slice(0, debut)];
    expect(r.map(cle)).toEqual(attendu.map(cle));
  });

  it('l’entrée n’est pas modifiée', () => {
    const horaire = [...L].reverse().map((p) => ({ ...p }));
    const copie = JSON.parse(JSON.stringify(horaire)) as unknown;
    m.validerContour(horaire);
    expect(horaire).toEqual(copie);
  });
});

describe('T28a : validerContour, refus avec un message en français', () => {
  it('2 sommets → trop_peu_de_sommets', () => {
    refuse(
      m.validerContour([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]),
      'trop_peu_de_sommets',
    );
  });

  it('0 sommet → trop_peu_de_sommets', () => {
    refuse(m.validerContour([]), 'trop_peu_de_sommets');
  });

  it('201 sommets → trop_de_sommets', () => {
    refuse(m.validerContour(polygoneRegulier(201, 80)), 'trop_de_sommets');
  });

  it('pas un tableau → entree_invalide', () => {
    for (const entree of [null, undefined, 'contour', 42, { x: 0, y: 0 }]) {
      refuse(m.validerContour(entree), 'entree_invalide');
    }
  });

  it('coordonnées non finies ou mal typées → coordonnee_invalide', () => {
    const cas: unknown[] = [
      [{ x: 0, y: 0 }, { x: Number.NaN, y: 0 }, { x: 0, y: 8 }],
      [{ x: 0, y: 0 }, { x: 10, y: Number.POSITIVE_INFINITY }, { x: 0, y: 8 }],
      [{ x: 0, y: 0 }, { x: '10', y: 0 }, { x: 0, y: 8 }],
      [{ x: 0, y: 0 }, { x: 10 }, { x: 0, y: 8 }],
      [{ x: 0, y: 0 }, null, { x: 0, y: 8 }],
      [{ x: 0, y: 0 }, [10, 0], { x: 0, y: 8 }],
    ];
    for (const c of cas) refuse(m.validerContour(c), 'coordonnee_invalide');
  });

  it('sommet à 6 km de l’origine → trop_loin', () => {
    const message = refuse(
      m.validerContour([
        { x: 6_000, y: 0 },
        { x: 6_010, y: 0 },
        { x: 6_000, y: 10 },
      ]),
      'trop_loin',
    );
    expect(message).toMatch(/km|m\b/);
  });

  it('un seul sommet un peu au-delà de 5 km → trop_loin', () => {
    refuse(
      m.validerContour([
        { x: 3_000, y: 3_000 },
        { x: 3_536, y: 3_536 },
        { x: 3_000, y: 3_010 },
      ]),
      'trop_loin',
    );
  });

  it('deux sommets consécutifs confondus → sommets_confondus', () => {
    refuse(
      m.validerContour([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 8 },
      ]),
      'sommets_confondus',
    );
  });

  it('contour fermé (premier sommet répété à la fin) → sommets_confondus', () => {
    refuse(m.validerContour([...CARRE, { x: 0, y: 0 }]), 'sommets_confondus');
  });

  it('deux sommets consécutifs à moins d’un millimètre → sommets_confondus', () => {
    refuse(
      m.validerContour([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10.0005, y: 0 },
        { x: 0, y: 8 },
      ]),
      'sommets_confondus',
    );
  });

  it('nœud papillon → auto_intersection', () => {
    refuse(
      m.validerContour([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      ]),
      'auto_intersection',
    );
  });

  it('papillon dissymétrique (aire non nulle) → auto_intersection', () => {
    const contour = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
      { x: 0, y: 20 },
    ];
    expect(Math.abs(aireSignee(contour))).toBeGreaterThan(1);
    refuse(m.validerContour(contour), 'auto_intersection');
  });

  it('deux côtés non adjacents qui se touchent en un point (sommet repassé) → auto_intersection', () => {
    refuse(
      m.validerContour([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 5 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
        { x: 5, y: 5 },
      ]),
      'auto_intersection',
    );
  });

  it('un sommet posé sur un côté non adjacent → auto_intersection', () => {
    refuse(
      m.validerContour([
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 10 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      ]),
      'auto_intersection',
    );
  });

  it('sommets alignés (aire nulle) → aire_nulle', () => {
    const message = refuse(
      m.validerContour([
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
      ]),
      'aire_nulle',
    );
    expect(message).toMatch(/aire|surface/i);
  });

  it('aire de 0,05 m² (sous 0,1 m²) → aire_nulle', () => {
    refuse(
      m.validerContour([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 0.1 },
      ]),
      'aire_nulle',
    );
  });

  it('ordre des règles : 201 sommets dont un à 6 km → trop_de_sommets ; NaN et 6 km → coordonnee_invalide', () => {
    const trop = polygoneRegulier(201, 80);
    trop[3] = { x: 6_000, y: 0 };
    refuse(m.validerContour(trop), 'trop_de_sommets');
    refuse(
      m.validerContour([
        { x: 6_000, y: 0 },
        { x: Number.NaN, y: 0 },
        { x: 0, y: 8 },
      ]),
      'coordonnee_invalide',
    );
  });

  it('ne lève jamais, quelle que soit l’entrée', () => {
    const bizarres: unknown[] = [
      [{}, {}, {}],
      [{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }],
      new Array(3),
      [{ x: Number.MAX_VALUE, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }],
      Object.create(null),
    ];
    for (const b of bizarres) {
      expect(() => m.validerContour(b)).not.toThrow();
      expect(m.validerContour(b).ok).toBe(false);
    }
  });
});
