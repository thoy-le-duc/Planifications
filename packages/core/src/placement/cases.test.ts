/**
 * Tests d'acceptation T88 — une serre découpée en cases : chapelles × tronçons
 * (docs/backlog/T88-serre-en-grille-modele.md, règles 1 à 4 et « Exemples chiffrés »). Pur : mètres, repère du bâtiment
 * (origine au centre, x dans la largeur, y dans la longueur ; chapelle 1 côté x négatif, tronçon 1 côté y négatif).
 *
 * ── Contrat (à fournir dans packages/core/src/placement/cases.ts, exporté par '@planif/core/placement') ──
 *
 *   interface GrilleSerre { longueurM; largeurM; nbChapelles?: number | null; nbTroncons?: number | null; largeurAlleeM?: number | null }
 *   dimensionsGrille(serre: GrilleSerre, nbSousZones?: number): { largeurChapelleM: number; longueurTronconM: number } | null
 *       dimensions dérivées au millimètre ; null si la grille ne tient pas ou si les dimensions ne sont pas positives.
 *       Colonnes nulles : chapelles = nbSousZones (au moins 1), un seul tronçon (comportement de T86).
 *   casesDeSerre(serre: GrilleSerre, sousZones: readonly SousZoneDeSerre[]): ResultatCases
 *       ResultatCases = { cases: CaseSerre[]; sansCase: SousZoneDeSerre[]; avertissement: string | null }
 *       CaseSerre = { chapelle; troncon; id: string | null; nom: string | null; centre: {x, y}; longueurM; largeurM }
 *       `cases` : TOUTES les cases (vides comprises, id et nom nuls), tronçon par tronçon (tronçon 1 chapelles 1 à C, puis tronçon 2…).
 *       `sansCase` : les sous-zones surnuméraires, dans l'ordre naturel. `avertissement` : « 2 zones n'ont pas de place dans la serre », ou null.
 *       Grille impossible ou sans dimensions : cases = [] (sansCase = toutes les sous-zones).
 *   rangerDansCase(c: CaseSerre, planches: readonly PlancheDeParcelle[], passePiedCm: number): RangementDeBande | null
 *       même règle que rangerDansBande (T86) : bloc centré dans la case.
 *   validerPlacement({ table: 'batiment', ligne }) : accepte et valide nb_chapelles, nb_troncons, largeur_allee_m.
 */
import { describe, expect, it } from 'vitest';
import * as placement from '@planif/core/placement';
import { bandesDeSerre, validerPlacement } from '@planif/core/placement';

interface SousZone {
  readonly id: string;
  readonly nom: string;
}
interface Grille {
  readonly longueurM: number;
  readonly largeurM: number;
  readonly nbChapelles?: number | null;
  readonly nbTroncons?: number | null;
  readonly largeurAlleeM?: number | null;
}
interface CaseSerre {
  readonly chapelle: number;
  readonly troncon: number;
  readonly id: string | null;
  readonly nom: string | null;
  readonly centre: { readonly x: number; readonly y: number };
  readonly longueurM: number;
  readonly largeurM: number;
}
interface ResultatCases {
  readonly cases: readonly CaseSerre[];
  readonly sansCase: readonly SousZone[];
  readonly avertissement: string | null;
}
interface Planche {
  readonly id: string;
  readonly code: string;
  readonly longueurM: number;
  readonly largeurM: number | null;
}
interface Contrat {
  readonly casesDeSerre: (serre: Grille, sousZones: readonly SousZone[]) => ResultatCases;
  readonly dimensionsGrille: (serre: Grille, nbSousZones?: number) => { largeurChapelleM: number; longueurTronconM: number } | null;
  readonly rangerDansCase: (c: CaseSerre, planches: readonly Planche[], passePiedCm: number) => { planches: readonly { id: string; centre: { x: number; y: number } }[]; depassent: readonly string[] } | null;
}
const m = placement as unknown as Partial<Contrat>;
function fonction<K extends keyof Contrat>(nom: K): Contrat[K] {
  const f = m[nom];
  if (typeof f !== 'function') throw new Error(`@planif/core/placement doit exporter « ${nom} » (T88)`);
  return f as Contrat[K];
}

const sz = (n: number): SousZone => ({ id: `id-${String(n).padStart(2, '0')}`, nom: `Zone ${String(n)}` });
const zones = (n: number): SousZone[] => Array.from({ length: n }, (_, i) => sz(i + 1));

/** Serre à légumes : 57,6 × 128,8 m, 6 chapelles, 3 tronçons, allées de 4,40 m. */
const LEGUMES: Grille = { largeurM: 57.6, longueurM: 128.8, nbChapelles: 6, nbTroncons: 3, largeurAlleeM: 4.4 };
/** Tunnel Manon : 28,8 × 40 m, 3 chapelles, 1 tronçon. */
const MANON: Grille = { largeurM: 28.8, longueurM: 40, nbChapelles: 3, nbTroncons: 1 };

describe('T88 : dimensionsGrille (dérivées, jamais stockées, au millimètre)', () => {
  it('serre à légumes : chapelle 9,6 m, tronçon 40 m', () => {
    expect(fonction('dimensionsGrille')(LEGUMES)).toEqual({ largeurChapelleM: 9.6, longueurTronconM: 40 });
  });

  it('tunnel Manon : chapelle 9,6 m, tronçon de toute la longueur (40 m)', () => {
    expect(fonction('dimensionsGrille')(MANON)).toEqual({ largeurChapelleM: 9.6, longueurTronconM: 40 });
  });

  it('arrondi au millimètre : 10 m en 3 chapelles → 3,333 m ; 100 m en 3 tronçons sans allée → 33,333 m', () => {
    expect(fonction('dimensionsGrille')({ largeurM: 10, longueurM: 100, nbChapelles: 3, nbTroncons: 3, largeurAlleeM: 0 })).toEqual({ largeurChapelleM: 3.333, longueurTronconM: 33.333 });
  });

  it('colonnes nulles : autant de chapelles que de sous-zones, un seul tronçon', () => {
    expect(fonction('dimensionsGrille')({ largeurM: 28.8, longueurM: 40 }, 3)).toEqual({ largeurChapelleM: 9.6, longueurTronconM: 40 });
  });

  it('un seul tronçon : l’allée ne retire rien à la longueur', () => {
    expect(fonction('dimensionsGrille')({ largeurM: 28.8, longueurM: 40, nbChapelles: 3, nbTroncons: 1, largeurAlleeM: 4.4 })).toEqual({ largeurChapelleM: 9.6, longueurTronconM: 40 });
  });

  it('grille impossible (allées = toute la longueur) ou dimensions invalides : null', () => {
    const d = fonction('dimensionsGrille');
    expect(d({ largeurM: 10, longueurM: 10, nbChapelles: 2, nbTroncons: 3, largeurAlleeM: 5 })).toBeNull();
    expect(d({ largeurM: 10, longueurM: 10, nbChapelles: 2, nbTroncons: 3, largeurAlleeM: 6 })).toBeNull();
    expect(d({ largeurM: 0, longueurM: 10, nbChapelles: 2, nbTroncons: 1 })).toBeNull();
    expect(d({ largeurM: 10, longueurM: Number.NaN, nbChapelles: 2, nbTroncons: 1 })).toBeNull();
  });
});

describe('T88 : casesDeSerre — exemples chiffrés', () => {
  it('serre à légumes, 18 sous-zones : 18 cases de 9,6 × 40 m ; centres en x −24 ; −14,4 ; −4,8 ; 4,8 ; 14,4 ; 24, en y −44,4 ; 0 ; 44,4', () => {
    const { cases, sansCase, avertissement } = fonction('casesDeSerre')(LEGUMES, zones(18));
    expect(cases).toHaveLength(18);
    expect(sansCase).toEqual([]);
    expect(avertissement).toBeNull();
    expect(new Set(cases.map((c) => c.largeurM))).toEqual(new Set([9.6]));
    expect(new Set(cases.map((c) => c.longueurM))).toEqual(new Set([40]));
    expect([...new Set(cases.map((c) => c.centre.x))].sort((a, b) => a - b)).toEqual([-24, -14.4, -4.8, 4.8, 14.4, 24]);
    expect([...new Set(cases.map((c) => c.centre.y))].sort((a, b) => a - b)).toEqual([-44.4, 0, 44.4]);
  });

  it('serre à légumes : les sous-zones remplissent tronçon par tronçon (tronçon 1 chapelles 1 à 6, puis tronçon 2…)', () => {
    const { cases } = fonction('casesDeSerre')(LEGUMES, zones(18));
    cases.forEach((c, k) => {
      expect(c.nom, `case ${String(k)}`).toBe(`Zone ${String(k + 1)}`);
      expect(c.chapelle).toBe((k % 6) + 1);
      expect(c.troncon).toBe(Math.floor(k / 6) + 1);
    });
    // Zone 1 : chapelle 1 (x négatif), tronçon 1 (y négatif) ; Zone 18 : chapelle 6, tronçon 3.
    expect(cases[0]?.centre).toEqual({ x: -24, y: -44.4 });
    expect(cases[6]?.centre).toEqual({ x: -24, y: 0 });
    expect(cases[17]?.centre).toEqual({ x: 24, y: 44.4 });
  });

  it('serre à légumes : les tronçons vont de −64,4 à −24,4 m, de −20 à 20 m et de 24,4 à 64,4 m ; les allées ne sont dans aucune case', () => {
    const { cases } = fonction('casesDeSerre')(LEGUMES, zones(18));
    const bornes = (t: number): [number, number][] =>
      cases.filter((c) => c.troncon === t).map((c): [number, number] => [Math.round((c.centre.y - c.longueurM / 2) * 1000) / 1000, Math.round((c.centre.y + c.longueurM / 2) * 1000) / 1000]);
    expect(new Set(bornes(1).map((b) => b.join('/')))).toEqual(new Set(['-64.4/-24.4']));
    expect(new Set(bornes(2).map((b) => b.join('/')))).toEqual(new Set(['-20/20']));
    expect(new Set(bornes(3).map((b) => b.join('/')))).toEqual(new Set(['24.4/64.4']));
  });

  it('tunnel Manon : 3 chapelles, 1 tronçon → mêmes bandes que T86 (centres −9,6 ; 0 ; 9,6)', () => {
    const { cases, avertissement } = fonction('casesDeSerre')(MANON, [sz(1), sz(2), sz(3)]);
    expect(avertissement).toBeNull();
    expect(cases.map((c) => c.centre.x)).toEqual([-9.6, 0, 9.6]);
    expect(cases.map((c) => c.centre.y)).toEqual([0, 0, 0]);
    expect(cases.map((c) => [c.largeurM, c.longueurM])).toEqual([[9.6, 40], [9.6, 40], [9.6, 40]]);
    expect(cases.map((c) => [c.chapelle, c.troncon])).toEqual([[1, 1], [2, 1], [3, 1]]);
  });

  it('colonnes nulles avec 3 sous-zones → identique à T86 (bandesDeSerre), colonnes absentes ou nulles', () => {
    const sousZones = [sz(3), sz(1), sz(2)];
    const bandes = bandesDeSerre({ longueurM: 40, largeurM: 28.8 }, sousZones);
    for (const serre of [{ longueurM: 40, largeurM: 28.8 }, { longueurM: 40, largeurM: 28.8, nbChapelles: null, nbTroncons: null, largeurAlleeM: null }]) {
      const { cases, sansCase, avertissement } = fonction('casesDeSerre')(serre, sousZones);
      expect(cases).toHaveLength(bandes.length);
      expect(sansCase).toEqual([]);
      expect(avertissement).toBeNull();
      cases.forEach((c, i) => {
        expect(c).toMatchObject({ id: bandes[i]?.id, nom: bandes[i]?.nom, centre: bandes[i]?.centre, largeurM: bandes[i]?.largeurM, longueurM: bandes[i]?.longueurM, chapelle: i + 1, troncon: 1 });
      });
    }
  });

  it('19 sous-zones dans 18 cases → la 19e (ordre naturel) n’a pas de case', () => {
    const r = fonction('casesDeSerre')(LEGUMES, zones(19));
    expect(r.cases).toHaveLength(18);
    expect(r.cases.every((c) => c.nom !== 'Zone 19')).toBe(true);
    expect(r.sansCase.map((z) => z.nom)).toEqual(['Zone 19']);
    expect(r.avertissement).toMatch(/^1 zone n.a pas de place dans la serre/);
  });

  it('20 sous-zones → les deux dernières sans case, avertissement « 2 zones n’ont pas de place dans la serre »', () => {
    const r = fonction('casesDeSerre')(LEGUMES, zones(20));
    expect(r.sansCase.map((z) => z.nom)).toEqual(['Zone 19', 'Zone 20']);
    expect(r.avertissement).toMatch(/^2 zones n.ont pas de place dans la serre/);
  });
});

describe('T88 : casesDeSerre — cas limites', () => {
  it('ordre naturel des noms, quel que soit l’ordre donné : Zone 10 après Zone 9', () => {
    const melange = [sz(10), sz(2), sz(9), sz(1)];
    const { cases } = fonction('casesDeSerre')({ largeurM: 20, longueurM: 10, nbChapelles: 4, nbTroncons: 1 }, melange);
    expect(cases.map((c) => c.nom)).toEqual(['Zone 1', 'Zone 2', 'Zone 9', 'Zone 10']);
  });

  it('moins de sous-zones que de cases : cases vides dessinées vides (id et nom nuls), à leur place', () => {
    const { cases, sansCase, avertissement } = fonction('casesDeSerre')(LEGUMES, zones(16));
    expect(cases).toHaveLength(18);
    expect(sansCase).toEqual([]);
    expect(avertissement).toBeNull();
    expect(cases.slice(0, 16).every((c) => c.id !== null)).toBe(true);
    expect(cases.slice(16).map((c) => [c.id, c.nom, c.chapelle, c.troncon])).toEqual([[null, null, 5, 3], [null, null, 6, 3]]);
  });

  it('aucune sous-zone : toutes les cases sont vides (grille renseignée)', () => {
    const { cases } = fonction('casesDeSerre')(LEGUMES, []);
    expect(cases).toHaveLength(18);
    expect(cases.every((c) => c.id === null)).toBe(true);
  });

  it('colonnes nulles et aucune sous-zone : aucune case (comme T86)', () => {
    expect(fonction('casesDeSerre')({ longueurM: 40, largeurM: 28.8 }, []).cases).toEqual([]);
  });

  it('grille impossible : aucune case, toutes les sous-zones sans place', () => {
    const r = fonction('casesDeSerre')({ largeurM: 10, longueurM: 10, nbChapelles: 2, nbTroncons: 3, largeurAlleeM: 5 }, zones(2));
    expect(r.cases).toEqual([]);
    expect(r.sansCase).toHaveLength(2);
  });

  it('serre sans dimensions : aucune case', () => {
    expect(fonction('casesDeSerre')({ longueurM: 0, largeurM: 28.8, nbChapelles: 3, nbTroncons: 1 }, zones(3)).cases).toEqual([]);
  });

  it('chapelle seule (1 × 1) : une case sur toute la serre', () => {
    const { cases } = fonction('casesDeSerre')({ largeurM: 9.6, longueurM: 40, nbChapelles: 1, nbTroncons: 1 }, zones(1));
    expect(cases[0]).toMatchObject({ centre: { x: 0, y: 0 }, largeurM: 9.6, longueurM: 40 });
  });
});

describe('T88 : rangerDansCase (règle de T85/T86, dans la case)', () => {
  const planche = (code: string): Planche => ({ id: `id-${code}`, code, longueurM: 38, largeurM: 0.75 });

  it('une planche seule dans la case (chapelle 1, tronçon 1) : au centre de la case', () => {
    const { cases } = fonction('casesDeSerre')(LEGUMES, zones(18));
    const premiere = cases[0];
    if (premiere === undefined) throw new Error('case 1 absente');
    const r = fonction('rangerDansCase')(premiere, [planche('A')], 45);
    expect(r?.planches.map((p) => p.centre)).toEqual([{ x: -24, y: -44.4 }]);
    expect(r?.depassent).toEqual([]);
  });

  it('quatre planches dans une case du tronçon central : centres −4,8 ∓ 1,8 / 0,6 selon le bloc, y = 0', () => {
    const { cases } = fonction('casesDeSerre')(LEGUMES, zones(18));
    const c = cases.find((x) => x.chapelle === 3 && x.troncon === 2);
    if (c === undefined) throw new Error('case (3, 2) absente');
    const r = fonction('rangerDansCase')(c, ['A', 'B', 'C', 'D'].map(planche), 45);
    // bloc = 4 × 0,75 + 3 × 0,45 = 4,35 m ; centres à −4,8 + (−1,8 ; −0,6 ; 0,6 ; 1,8)
    expect(r?.planches.map((p) => p.centre.x)).toEqual([-6.6, -5.4, -4.2, -3]);
    expect(r?.planches.map((p) => p.centre.y)).toEqual([0, 0, 0, 0]);
    expect(r?.depassent).toEqual([]);
  });

  it('neuf planches de 0,75 m dans 9,6 m : la première et la dernière dépassent de la case', () => {
    const { cases } = fonction('casesDeSerre')(LEGUMES, zones(18));
    const c = cases[0];
    if (c === undefined) throw new Error('case 1 absente');
    const r = fonction('rangerDansCase')(c, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'].map(planche), 45);
    expect(r?.depassent).toEqual(['id-A', 'id-I']);
  });

  it('planche plus longue que le tronçon (45 m dans 40 m) : elle dépasse', () => {
    const { cases } = fonction('casesDeSerre')(LEGUMES, zones(18));
    const c = cases[0];
    if (c === undefined) throw new Error('case 1 absente');
    const r = fonction('rangerDansCase')(c, [{ ...planche('L'), longueurM: 45 }], 45);
    expect(r?.depassent).toEqual(['id-L']);
  });

  it('passe-pied hors bornes (501 cm) ou aucune planche : null', () => {
    const { cases } = fonction('casesDeSerre')(LEGUMES, zones(18));
    const c = cases[0];
    if (c === undefined) throw new Error('case 1 absente');
    expect(fonction('rangerDansCase')(c, [planche('A')], 501)).toBeNull();
    expect(fonction('rangerDansCase')(c, [], 45)).toBeNull();
  });
});

describe('T88 : validerPlacement, bâtiment avec grille (mêmes règles que la base)', () => {
  const base = { nom: 'Serre', type: 'serre_chapelle', longueur_m: 128.8, largeur_m: 57.6, hauteur_m: 5, centre_x_m: 0, centre_y_m: 0, orientation_deg: 0 };
  const valider = (grille: Readonly<Record<string, unknown>>) => validerPlacement({ table: 'batiment', ligne: { ...base, ...grille } });
  const champ = (grille: Readonly<Record<string, unknown>>): string | null => {
    const r = valider(grille);
    return r.ok ? null : r.erreur.champ;
  };

  it('serre à légumes : acceptée, la grille est rendue', () => {
    const r = valider({ nb_chapelles: 6, nb_troncons: 3, largeur_allee_m: 4.4 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valeur).toMatchObject({ nb_chapelles: 6, nb_troncons: 3, largeur_allee_m: 4.4 });
  });

  it('colonnes absentes ou nulles : acceptées, rendues nulles', () => {
    for (const grille of [{}, { nb_chapelles: null, nb_troncons: null, largeur_allee_m: null }]) {
      const r = valider(grille);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.valeur).toMatchObject({ nb_chapelles: null, nb_troncons: null, largeur_allee_m: null });
    }
  });

  it('bornes comprises : 1 et 100 chapelles, 1 et 50 tronçons, allée de 0', () => {
    expect(valider({ nb_chapelles: 1, nb_troncons: 1, largeur_allee_m: 0 }).ok).toBe(true);
    expect(valider({ nb_chapelles: 100, nb_troncons: 50, largeur_allee_m: 0 }).ok).toBe(true);
  });

  it('nb_chapelles : 0, 101, 1,5, texte → refusé, champ nb_chapelles', () => {
    for (const v of [0, -1, 101, 1.5, '3', Number.NaN]) expect(champ({ nb_chapelles: v }), String(v)).toBe('nb_chapelles');
  });

  it('nb_troncons : 0, 51, 1,5, texte → refusé, champ nb_troncons', () => {
    for (const v of [0, -1, 51, 1.5, '3', Number.NaN]) expect(champ({ nb_troncons: v }), String(v)).toBe('nb_troncons');
  });

  it('largeur d’allée : négative, infinie, texte, plus fine que le millimètre → refusée, champ largeur_allee_m', () => {
    for (const v of [-0.001, Number.POSITIVE_INFINITY, '4,4', 4.4005]) expect(champ({ nb_troncons: 3, largeur_allee_m: v }), String(v)).toBe('largeur_allee_m');
  });

  it('grille impossible : 128,8 m, 3 tronçons, allées de 64,4 m → refusé (champ largeur_allee_m, message en français) ; 64,39 m passe', () => {
    const r = valider({ nb_chapelles: 6, nb_troncons: 3, largeur_allee_m: 64.4 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erreur.champ).toBe('largeur_allee_m');
      expect(r.erreur.message).toMatch(/allée|tronçon/i);
    }
    expect(valider({ nb_chapelles: 6, nb_troncons: 3, largeur_allee_m: 64.39 }).ok).toBe(true);
  });

  it('un seul tronçon : l’allée ne compte pas, même très large', () => {
    expect(valider({ nb_chapelles: 6, nb_troncons: 1, largeur_allee_m: 500 }).ok).toBe(true);
  });
});
