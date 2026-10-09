// @vitest-environment happy-dom
/**
 * Tests d'acceptation T35a — le schéma des rangs (alignés ou en quinconce) : géométrie pure,
 * alternative texte, composant SVG et son temps de mise à jour
 * (docs/backlog/T35a-schema-rangs.md, Q34). Le schéma dans le formulaire : ./disposition.test.tsx.
 *
 * ── API attendue ─────────────────────────────────────────────────────────────────────────────
 *
 * apps/web/src/ecrans/itineraires/schema-rangs.ts — fonctions pures, sans React ni DOM :
 *
 *   type DispositionRangs = 'alignee' | 'quinconce'            // celui de @planif/core
 *   const LARGEUR_PLANCHE_DEFAUT_CM = 120                     // largeur inconnue : 1,2 m
 *   interface EntreeSchemaRangs {
 *     readonly rangs: number;               // entier ≥ 1
 *     readonly ecartementCm: number;        // > 0, décimal permis (12,5 cm)
 *     readonly disposition: DispositionRangs;
 *     readonly largeurPlancheCm: number | null;   // null : LARGEUR_PLANCHE_DEFAUT_CM
 *   }
 *   interface PlantSchema { readonly rang: number; readonly xCm: number; readonly yCm: number }
 *   interface GeometrieSchemaRangs {
 *     readonly largeurCm: number;           // largeur de la planche dessinée
 *     readonly longueurCm: number;          // longueur du tronçon dessiné
 *     readonly rangs: readonly number[];    // y de chaque rang (cm depuis le bord), rang 1 d'abord
 *     readonly plants: readonly PlantSchema[];   // rang de 1 à n
 *   }
 *   function geometrieSchemaRangs(e: EntreeSchemaRangs): GeometrieSchemaRangs
 *   function texteSchemaRangs(e: Pick<EntreeSchemaRangs, 'rangs' | 'ecartementCm' | 'disposition'>): string
 *
 *   Géométrie (vue de dessus, x le long de la planche, y en travers) :
 *     - les rangs sont répartis régulièrement sur la largeur, symétriques (y₁ + yₙ = largeur),
 *       strictement à l'intérieur ; un seul rang : au milieu ;
 *     - sur chaque rang, un plant tous les `ecartementCm` exactement ; au moins 3 plants et au
 *       plus 60 par rang (le tronçon s'adapte à l'écartement) ; tous dans [0, longueurCm] ;
 *     - alignés : mêmes x sur tous les rangs ;
 *     - quinconce : les rangs pairs décalés d'un demi-écartement par rapport aux rangs impairs ;
 *       les rangs impairs entre eux ont les mêmes x.
 *   Texte : « 3 rangs en quinconce, un plant tous les 30 cm », « 2 rangs alignés, un plant tous
 *     les 40 cm », « 1 rang, un plant tous les 30 cm » (la disposition ne se dit pas pour un
 *     rang) ; décimales à la française : « 12,5 cm ».
 *
 * apps/web/src/ecrans/itineraires/SchemaRangs.tsx — composant, export nommé `SchemaRangs`,
 *   propriétés = EntreeSchemaRangs. SVG pur, sans bibliothèque :
 *   - racine <svg data-testid="schema-rangs" role="img" aria-label=<texteSchemaRangs>>, viewBox
 *     en centimètres (« 0 0 <longueurCm> <largeurCm> ») : les coordonnées des plants sont en cm ;
 *   - un <circle data-testid="plant-schema" data-rang=<1…n> cx=<xCm> cy=<yCm>> par plant ;
 *   - la cote de l'écartement : un élément data-testid="cote-ecartement" (un <text> du SVG, par
 *     exemple) dont le texte est l'écartement saisi : « 30 cm », « 12,5 cm ».
 *   Mise à jour à chaque frappe : < 16 ms par rendu (médiane, mesurer du cœur).
 *
 * Les modules sont chargés par import dynamique (chemin tenu dans une variable) : le typage du
 * test ne dépend pas du code pas encore écrit.
 */
import { act, createElement, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mesurer } from '../../../../../packages/core/src/test/mesurer.ts';

type DispositionRangs = 'alignee' | 'quinconce';

interface EntreeSchemaRangs {
  readonly rangs: number;
  readonly ecartementCm: number;
  readonly disposition: DispositionRangs;
  readonly largeurPlancheCm: number | null;
}

interface PlantSchema {
  readonly rang: number;
  readonly xCm: number;
  readonly yCm: number;
}

interface GeometrieSchemaRangs {
  readonly largeurCm: number;
  readonly longueurCm: number;
  readonly rangs: readonly number[];
  readonly plants: readonly PlantSchema[];
}

interface ModuleSchema {
  readonly LARGEUR_PLANCHE_DEFAUT_CM: number;
  geometrieSchemaRangs(e: EntreeSchemaRangs): GeometrieSchemaRangs;
  texteSchemaRangs(e: Pick<EntreeSchemaRangs, 'rangs' | 'ecartementCm' | 'disposition'>): string;
}

interface ModuleComposant {
  readonly SchemaRangs: ComponentType<EntreeSchemaRangs>;
}

const CHEMIN_SCHEMA = './schema-rangs.ts';
const CHEMIN_COMPOSANT = './SchemaRangs.tsx';

let s: ModuleSchema | undefined;
let c: ModuleComposant | undefined;

beforeAll(async () => {
  s = await (import(/* @vite-ignore */ CHEMIN_SCHEMA) as Promise<ModuleSchema>).catch(() => undefined);
  c = await (import(/* @vite-ignore */ CHEMIN_COMPOSANT) as Promise<ModuleComposant>).catch(() => undefined);
});

function schema(): ModuleSchema {
  if (s === undefined) throw new Error(`module ${CHEMIN_SCHEMA} absent`);
  return s;
}

function composant(): ModuleComposant {
  if (c === undefined) throw new Error(`module ${CHEMIN_COMPOSANT} absent`);
  return c;
}

const PRECISION = 6;

/** x des plants du rang `r` (1…n), dans l'ordre croissant. */
const xDuRang = (g: GeometrieSchemaRangs, r: number): number[] =>
  g.plants
    .filter((p) => p.rang === r)
    .map((p) => p.xCm)
    .sort((a, b) => a - b);

/** Reste positif de a modulo m, pour comparer des décalages. */
const modulo = (a: number, m: number): number => ((a % m) + m) % m;

function verifierRang(g: GeometrieSchemaRangs, r: number, ecartement: number): void {
  const xs = xDuRang(g, r);
  expect(xs.length, `rang ${String(r)} : au moins 3 plants`).toBeGreaterThanOrEqual(3);
  expect(xs.length, `rang ${String(r)} : au plus 60 plants`).toBeLessThanOrEqual(60);
  for (const x of xs) {
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThanOrEqual(g.longueurCm);
  }
  for (let i = 1; i < xs.length; i++) expect((xs[i] ?? 0) - (xs[i - 1] ?? 0), `rang ${String(r)} : un plant tous les ${String(ecartement)} cm`).toBeCloseTo(ecartement, PRECISION);
  const y = g.rangs[r - 1];
  for (const p of g.plants.filter((q) => q.rang === r)) expect(p.yCm).toBeCloseTo(y ?? Number.NaN, PRECISION);
}

describe('T35a : géométrie du schéma (fonctions pures)', () => {
  it('largeur de planche inconnue : 1,2 m par défaut ; connue : la sienne', () => {
    expect(schema().LARGEUR_PLANCHE_DEFAUT_CM).toBe(120);
    expect(schema().geometrieSchemaRangs({ rangs: 2, ecartementCm: 30, disposition: 'alignee', largeurPlancheCm: null }).largeurCm).toBe(120);
    expect(schema().geometrieSchemaRangs({ rangs: 2, ecartementCm: 30, disposition: 'alignee', largeurPlancheCm: 80 }).largeurCm).toBe(80);
  });

  it('un rang : au milieu de la planche, un plant tous les 30 cm', () => {
    const g = schema().geometrieSchemaRangs({ rangs: 1, ecartementCm: 30, disposition: 'alignee', largeurPlancheCm: 80 });
    expect(g.rangs).toHaveLength(1);
    expect(g.rangs[0]).toBeCloseTo(40, PRECISION);
    expect(new Set(g.plants.map((p) => p.rang))).toStrictEqual(new Set([1]));
    verifierRang(g, 1, 30);
  });

  it.each([2, 3, 4])('%i rangs : répartis régulièrement, symétriques, à l’intérieur de la planche', (n) => {
    const g = schema().geometrieSchemaRangs({ rangs: n, ecartementCm: 30, disposition: 'alignee', largeurPlancheCm: 120 });
    expect(g.rangs).toHaveLength(n);
    const pas = (g.rangs[1] ?? 0) - (g.rangs[0] ?? 0);
    expect(pas).toBeGreaterThan(0);
    for (let i = 1; i < n; i++) expect((g.rangs[i] ?? 0) - (g.rangs[i - 1] ?? 0)).toBeCloseTo(pas, PRECISION);
    expect((g.rangs[0] ?? 0) + (g.rangs[n - 1] ?? 0)).toBeCloseTo(120, PRECISION);
    expect(g.rangs[0]).toBeGreaterThan(0);
    expect(g.rangs[n - 1]).toBeLessThan(120);
  });

  it('3 rangs alignés : mêmes x sur les trois rangs', () => {
    const g = schema().geometrieSchemaRangs({ rangs: 3, ecartementCm: 30, disposition: 'alignee', largeurPlancheCm: null });
    for (const r of [1, 2, 3]) verifierRang(g, r, 30);
    expect(xDuRang(g, 2)).toStrictEqual(xDuRang(g, 1));
    expect(xDuRang(g, 3)).toStrictEqual(xDuRang(g, 1));
  });

  it('3 rangs en quinconce : le rang 2 décalé d’un demi-écartement (15 cm), le rang 3 comme le rang 1', () => {
    const g = schema().geometrieSchemaRangs({ rangs: 3, ecartementCm: 30, disposition: 'quinconce', largeurPlancheCm: null });
    for (const r of [1, 2, 3]) verifierRang(g, r, 30);
    const [x1] = xDuRang(g, 1);
    const [x2] = xDuRang(g, 2);
    expect(modulo((x2 ?? 0) - (x1 ?? 0), 30), 'décalage du rang 2').toBeCloseTo(15, PRECISION);
    // Chaque plant du rang 2 est à 15 cm de ses voisins du rang 1 : au milieu de l'intervalle.
    for (const x of xDuRang(g, 2)) {
      const plusProche = Math.min(...xDuRang(g, 1).map((a) => Math.abs(a - x)));
      expect(plusProche).toBeCloseTo(15, PRECISION);
    }
    expect(xDuRang(g, 3)).toStrictEqual(xDuRang(g, 1));
  });

  it('4 rangs en quinconce, écartement décimal (12,5 cm) : rangs pairs décalés de 6,25 cm', () => {
    const g = schema().geometrieSchemaRangs({ rangs: 4, ecartementCm: 12.5, disposition: 'quinconce', largeurPlancheCm: 100 });
    for (const r of [1, 2, 3, 4]) verifierRang(g, r, 12.5);
    const premier = (r: number): number => xDuRang(g, r)[0] ?? Number.NaN;
    expect(modulo(premier(2) - premier(1), 12.5)).toBeCloseTo(6.25, PRECISION);
    expect(modulo(premier(4) - premier(1), 12.5)).toBeCloseTo(6.25, PRECISION);
    expect(xDuRang(g, 3)).toStrictEqual(xDuRang(g, 1));
  });

  it.each([2, 200])('écartement %i cm : le tronçon s’adapte (3 à 60 plants par rang)', (ecartement) => {
    const g = schema().geometrieSchemaRangs({ rangs: 2, ecartementCm: ecartement, disposition: 'quinconce', largeurPlancheCm: null });
    verifierRang(g, 1, ecartement);
    verifierRang(g, 2, ecartement);
  });
});

describe('T35a : alternative texte', () => {
  it.each([
    [{ rangs: 3, ecartementCm: 30, disposition: 'quinconce' }, '3 rangs en quinconce, un plant tous les 30 cm'],
    [{ rangs: 2, ecartementCm: 40, disposition: 'alignee' }, '2 rangs alignés, un plant tous les 40 cm'],
    [{ rangs: 1, ecartementCm: 30, disposition: 'alignee' }, '1 rang, un plant tous les 30 cm'],
    [{ rangs: 1, ecartementCm: 30, disposition: 'quinconce' }, '1 rang, un plant tous les 30 cm'],
    [{ rangs: 4, ecartementCm: 12.5, disposition: 'quinconce' }, '4 rangs en quinconce, un plant tous les 12,5 cm'],
  ] as const)('%j → « %s »', (e, attendu) => {
    expect(schema().texteSchemaRangs(e)).toBe(attendu);
  });
});

describe('T35a : composant SchemaRangs (SVG)', () => {
  let conteneur: HTMLDivElement;
  let racine: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    conteneur = document.createElement('div');
    document.body.append(conteneur);
    racine = createRoot(conteneur);
  });

  afterEach(() => {
    act(() => {
      racine.unmount();
    });
    conteneur.remove();
  });

  function rendre(p: EntreeSchemaRangs): SVGSVGElement {
    act(() => {
      racine.render(createElement(composant().SchemaRangs, p));
    });
    const svg = conteneur.querySelector<SVGSVGElement>('svg[data-testid="schema-rangs"]');
    expect(svg, 'svg data-testid="schema-rangs"').not.toBeNull();
    if (svg === null) throw new Error('schéma absent');
    return svg;
  }

  const plants = (svg: SVGSVGElement, rang: number): number[] =>
    [...svg.querySelectorAll<SVGCircleElement>(`circle[data-testid="plant-schema"][data-rang="${String(rang)}"]`)].map((p) => Number(p.getAttribute('cx'))).sort((a, b) => a - b);

  const cote = (svg: SVGSVGElement): string => (svg.querySelector('[data-testid="cote-ecartement"]')?.textContent ?? '').replace(/\s+/g, ' ').trim();

  it('3 rangs en quinconce à 30 cm : image nommée, viewBox en cm, rang 2 décalé de 15 cm, cote « 30 cm »', () => {
    const e: EntreeSchemaRangs = { rangs: 3, ecartementCm: 30, disposition: 'quinconce', largeurPlancheCm: null };
    const svg = rendre(e);
    const g = schema().geometrieSchemaRangs(e);
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('3 rangs en quinconce, un plant tous les 30 cm');
    expect(svg.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number)).toStrictEqual([0, 0, g.longueurCm, g.largeurCm]);
    expect(svg.querySelectorAll('circle[data-testid="plant-schema"]')).toHaveLength(g.plants.length);
    const r1 = plants(svg, 1);
    const r2 = plants(svg, 2);
    expect(r1.length).toBeGreaterThanOrEqual(3);
    expect(modulo((r2[0] ?? 0) - (r1[0] ?? 0), 30)).toBeCloseTo(15, 3);
    expect(plants(svg, 3)).toStrictEqual(r1);
    expect(cote(svg)).toBe('30 cm');
  });

  it('alignés : mêmes cx sur tous les rangs ; la cote suit l’écartement saisi (12,5 cm)', () => {
    const svg = rendre({ rangs: 2, ecartementCm: 12.5, disposition: 'alignee', largeurPlancheCm: 80 });
    expect(plants(svg, 2)).toStrictEqual(plants(svg, 1));
    expect(cote(svg)).toBe('12,5 cm');
    expect(svg.getAttribute('aria-label')).toBe('2 rangs alignés, un plant tous les 12,5 cm');
  });

  it('mise à jour à chaque frappe en moins de 16 ms (médiane)', () => {
    rendre({ rangs: 3, ecartementCm: 30, disposition: 'quinconce', largeurPlancheCm: null });
    // Une frappe = un nouvel écartement : 3, 30, 35, 25… On alterne pour que chaque rendu change le SVG.
    const valeurs = [3, 30, 35, 25, 2, 40, 18, 22];
    let k = 0;
    const { mediane, detail, resultat } = mesurer(
      () => {
        const ecartementCm = valeurs[k++ % valeurs.length] ?? 30;
        act(() => {
          racine.render(createElement(composant().SchemaRangs, { rangs: 3, ecartementCm, disposition: 'quinconce', largeurPlancheCm: null }));
        });
        return ecartementCm;
      },
      { echauffement: 3, mesures: 15, borneMs: 16 },
    );
    const svg = conteneur.querySelector<SVGSVGElement>('svg[data-testid="schema-rangs"]');
    expect(svg === null ? '' : cote(svg), 'le dernier rendu est bien à l’écran').toBe(`${String(resultat)} cm`);
    expect(mediane, `rendu du schéma : ${detail}`).toBeLessThan(16);
  });
});
