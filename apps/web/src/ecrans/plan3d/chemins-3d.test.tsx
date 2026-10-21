// @vitest-environment happy-dom
/**
 * Tests d'acceptation T61 — règle 4 : dans la vue 3D, les chemins sont posés au sol, les bâtiments
 * sont des volumes simples (local et chambre froide compris), les étiquettes viennent à la demande
 * (docs/backlog/T61-chemins-outils.md). Pur, sans three ni WebGL : le plan 2D (calculs.ts)
 * recopie, la scène (scene.ts) place, l'étiquetage (Etiquettes3d.tsx) montre. Sur le modèle de
 * plan-place.test.ts (T28c) ; repère et conventions : ./test/contrat-jumeau.ts.
 *
 * ── Contrat ─────────────────────────────────────────────────────────────────────────────────
 *
 * Plan 2D : `DonneesPlan.chemin?` = lignes `chemin` de la ferme (colonnes du schéma local, `points`
 *   en texte JSON) ; `Plan.chemins` = ceux NON supprimés, triés par nom (sans nom en dernier) puis
 *   id, chacun { id, nom: string | null, points: {x, y}[] (repère de la ferme), largeurM } ; clé
 *   absente (ou vide) sans chemin.
 * Scène : `Scene.chemins` (toujours un tableau, vide sans chemin), dans l'ordre du plan, chacun
 *   { id, nom: string | null, largeur, epaisseur, segments } ; `largeur` = largeurM (échelle 1 d'une
 *   scène placée) ; `epaisseur` entre 0 (exclu) et 0,05 m : le chemin est posé AU SOL, en bande
 *   plate. `segments` : un rectangle par segment du tracé, dans l'ordre des points, de la même
 *   famille que les bâtiments (`largeur` selon x local, `longueur` selon z local, `angle` = −cap du
 *   segment, cap en degrés sens horaire depuis le nord) :
 *     { cx, cz, longueur, angle } avec (cx, cz) = milieu du segment en repère de scène (x, −y),
 *     longueur = longueur du segment ; les coins sont `coinsRectScene(cx, cz, largeur, longueur, angle)`.
 *   Un chemin de n points a n − 1 segments.
 * Bâtiments : `local` et `chambre_froide` sont des volumes simples comme hangar et magasin
 *   (forme 'volume', opacité 1, hauteur = hauteurM, profondeur = longueurM) ; local, chambre
 *   froide et hangar ont trois couleurs DISTINCTES.
 * Étiquettes : `etiquettesScene(scene)` (scene.ts) = [{ id, sorte: 'chemin' | 'batiment', nom, x,
 *   z }] : les chemins NOMMÉS d'abord (au milieu de leur plus long segment ; à égalité de
 *   longueur, le premier), puis les bâtiments (à leur centre), dans l'ordre de la scène ; ni chemin
 *   sans nom, ni nom blanc.
 * Composant `Etiquettes3d.tsx` (export `Etiquettes3d`, props { etiquettes, couche }) : à
 *   l'ouverture, un bouton `bascule-etiquettes-3d` « Étiquettes » (aria-pressed="false", 44 px au
 *   moins) et AUCUNE étiquette dans le DOM ; une fois pressé (aria-pressed="true"), un élément
 *   `etiquette-3d` par étiquette (data-id, data-sorte, data-x, data-z, texte = le nom), dans la
 *   couche `etiquettes-3d` ; un second tap les retire.
 */
import { act, createElement, createRef, type ComponentType, type RefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ModuleCalculsPlan } from '../plan/test/contrat.ts';
import { PETITE_FERME, SAISON_2026, Z, E } from '../plan/test/petite-ferme.ts';
import { coinsRectScene, type PointScene } from './scene.ts';
import type { BatimentScene } from './scene.ts';

const CHEMIN_CALCULS = '../plan/calculs.ts';
const CHEMIN_SCENE = './scene.ts';
const CHEMIN_ETIQUETTES = './Etiquettes3d.tsx';
const OPTIONS = { saison: SAISON_2026, aujourdhui: '2026-06-10' };
const C = '2026-10-21T08:00:00.000Z';
const CONTOUR = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 10 },
  { x: 10, y: 10 },
  { x: 10, y: 30 },
  { x: 0, y: 30 },
];

interface CheminPlan {
  readonly id: string;
  readonly nom: string | null;
  readonly points: readonly { x: number; y: number }[];
  readonly largeurM: number;
}
interface SegmentScene {
  readonly cx: number;
  readonly cz: number;
  readonly longueur: number;
  readonly angle: number;
}
interface CheminScene {
  readonly id: string;
  readonly nom: string | null;
  readonly largeur: number;
  readonly epaisseur: number;
  readonly segments: readonly SegmentScene[];
}
interface Etiquette {
  readonly id: string;
  readonly sorte: 'chemin' | 'batiment';
  readonly nom: string;
  readonly x: number;
  readonly z: number;
}
interface SceneT61 {
  readonly batiments: readonly BatimentScene[];
  readonly chemins: readonly CheminScene[];
}
interface ModuleSceneT61 {
  versScene(plan: unknown, semaine: number): SceneT61;
  etiquettesScene(scene: SceneT61): Etiquette[];
}

let calculs: ModuleCalculsPlan;
let m: ModuleSceneT61;

beforeAll(async () => {
  calculs = (await import(/* @vite-ignore */ CHEMIN_CALCULS)) as ModuleCalculsPlan;
  m = (await import(/* @vite-ignore */ CHEMIN_SCENE)) as unknown as ModuleSceneT61;
});

const ligneChemin = (n: number, nom: string | null, points: readonly { x: number; y: number }[], largeur: number, supprime: string | null = null) => ({
  id: `0192f0c1-6161-7000-8000-00000000c${String(n).padStart(3, '0')}`,
  ferme_id: '0192f0c1-0000-7000-8000-00000000f001',
  nom,
  points: JSON.stringify(points),
  largeur_m: largeur,
  cree_le: C,
  modifie_le: C,
  supprime_le: supprime,
});
const batiment = (n: number, nom: string, type: string, longueur: number, largeur: number, hauteur: number, x: number, y: number) => ({
  id: `0192f0c1-6161-7000-8000-00000000b${String(n).padStart(3, '0')}`,
  ferme_id: '0192f0c1-0000-7000-8000-00000000f001',
  nom,
  type,
  longueur_m: longueur,
  largeur_m: largeur,
  hauteur_m: hauteur,
  centre_x_m: x,
  centre_y_m: y,
  orientation_deg: 0,
  zone_id: null,
  cree_le: C,
  modifie_le: C,
  supprime_le: null,
});

const ALLEE = ligneChemin(1, 'Allée centrale', [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 25.5 }], 2);
const SENTIER = ligneChemin(2, null, [{ x: -10, y: -5 }, { x: -10, y: -15 }], 1);
const ANCIEN = ligneChemin(3, 'Ancien chemin', [{ x: 1, y: 1 }, { x: 2, y: 2 }], 1, C);

function donnees(extra: Record<string, unknown> = {}) {
  return {
    ...PETITE_FERME,
    zone: PETITE_FERME.zone.map((z) => (z.id === Z.tunnel10 ? { ...z, contour: JSON.stringify(CONTOUR) } : z)),
    emplacement: PETITE_FERME.emplacement.map((e) => (e.id === E.t10p1 ? { ...e, placement_x_m: -2.5, placement_y_m: 4, orientation_deg: 90 } : e)),
    chemin: [SENTIER, ALLEE, ANCIEN],
    batiment: [
      batiment(1, 'Hangar', 'hangar', 20, 12, 6, -60, 15),
      batiment(2, 'Local', 'local', 6, 4, 2.8, -60, 40),
      batiment(3, 'Chambre froide', 'chambre_froide', 6, 4, 2.5, -50, 40),
      batiment(4, 'Magasin', 'magasin', 12, 8, 4, -60, 60),
    ],
    ...extra,
  };
}
const plan = () => calculs.construirePlan(donnees(), OPTIONS) as unknown as { chemins?: readonly CheminPlan[] };
const arrondis = (pts: readonly PointScene[]): string[] => pts.map((p) => `${(Math.round(p.x * 1000) / 1000).toString()};${(Math.round(p.z * 1000) / 1000).toString()}`).sort();

describe('T61 : le plan 2D recopie les chemins', () => {
  it('les chemins non supprimés, triés par nom (sans nom en dernier), points relus', () => {
    const chemins = plan().chemins ?? [];
    expect(chemins.map((c) => c.nom)).toEqual(['Allée centrale', null]);
    expect(chemins[0]).toEqual({ id: ALLEE.id, nom: 'Allée centrale', points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 25.5 }], largeurM: 2 });
  });

  it('sans ligne de chemin : le plan est celui d’avant', () => {
    const p = calculs.construirePlan(donnees({ chemin: [] }), OPTIONS) as unknown as { chemins?: readonly CheminPlan[] };
    expect(p.chemins ?? []).toEqual([]);
  });
});

describe('T61 : la scène pose les chemins au sol, en bandes', () => {
  it('un chemin de trois points : deux segments, une largeur, une épaisseur de bande plate', () => {
    const c = m.versScene(plan(), 0).chemins.find((x) => x.id === ALLEE.id);
    expect(c?.segments).toHaveLength(2);
    expect(c?.largeur).toBe(2);
    expect(c?.epaisseur).toBeGreaterThan(0);
    expect(c?.epaisseur).toBeLessThanOrEqual(0.05);
  });

  it('les coins de chaque bande : (0,0)→(40,0) large de 2 m et (40,0)→(40,25,5) — z de scène = −y', () => {
    const c = m.versScene(plan(), 0).chemins.find((x) => x.id === ALLEE.id);
    if (c === undefined) throw new Error('chemin absent de la scène');
    const coins = (i: number) => {
      const s = c.segments[i];
      if (s === undefined) throw new Error('segment absent');
      return arrondis(coinsRectScene(s.cx, s.cz, c.largeur, s.longueur, s.angle));
    };
    expect(c.segments[0]?.longueur).toBeCloseTo(40, 6);
    expect(c.segments[1]?.longueur).toBeCloseTo(25.5, 6);
    expect(coins(0)).toEqual(arrondis([{ x: 0, z: -1 }, { x: 0, z: 1 }, { x: 40, z: -1 }, { x: 40, z: 1 }]));
    expect(coins(1)).toEqual(arrondis([{ x: 39, z: 0 }, { x: 41, z: 0 }, { x: 39, z: -25.5 }, { x: 41, z: -25.5 }]));
  });

  it('un segment oblique (3-4-5) : longueur 5 et bande de la bonne largeur autour de la droite', () => {
    const p = calculs.construirePlan(donnees({ chemin: [ligneChemin(9, 'Diagonale', [{ x: 0, y: 0 }, { x: 3, y: 4 }], 1)] }), OPTIONS);
    const c = m.versScene(p, 0).chemins[0];
    const s = c?.segments[0];
    if (c === undefined || s === undefined) throw new Error('chemin absent');
    expect(s.longueur).toBeCloseTo(5, 6);
    expect(s.cx).toBeCloseTo(1.5, 6);
    expect(s.cz).toBeCloseTo(-2, 6);
    // Les quatre coins sont à 0,5 m de la droite (0,0)→(3,−4) de scène, entre ses deux bouts.
    for (const q of coinsRectScene(s.cx, s.cz, c.largeur, s.longueur, s.angle)) {
      const distance = Math.abs(4 * q.x + 3 * q.z) / 5;
      const along = (3 * q.x - 4 * q.z) / 5;
      expect(distance === 0.5 || Math.abs(distance - 0.5) < 1e-6).toBe(true);
      expect(along).toBeGreaterThanOrEqual(-1e-6);
      expect(along).toBeLessThanOrEqual(5 + 1e-6);
    }
  });

  it('sans chemin : Scene.chemins est un tableau vide', () => {
    const p = calculs.construirePlan(donnees({ chemin: [] }), OPTIONS);
    expect(m.versScene(p, 0).chemins).toEqual([]);
  });

  it('le chemin supprimé n’est pas dans la scène', () => {
    expect(m.versScene(plan(), 0).chemins.map((c) => c.id)).not.toContain(ANCIEN.id);
  });
});

describe('T61 : bâtiments en volumes simples, local et chambre froide compris', () => {
  const batiments = () => m.versScene(plan(), 0).batiments;

  it.each([
    ['Hangar', 6],
    ['Local', 2.8],
    ['Chambre froide', 2.5],
    ['Magasin', 4],
  ])('%s : un volume (forme volume, opacité 1) de la hauteur du bâtiment', (nom, hauteur) => {
    const b = batiments().find((x) => x.nom === nom);
    expect(b?.forme).toBe('volume');
    expect(b?.opacite).toBe(1);
    expect(b?.hauteur).toBe(hauteur);
  });

  it('local et chambre froide gardent leur sorte et ont chacun leur couleur', () => {
    const par = new Map(batiments().map((b) => [b.type, b.couleur]));
    expect([...par.keys()].sort()).toEqual(['chambre_froide', 'hangar', 'local', 'magasin']);
    expect(new Set([par.get('local'), par.get('chambre_froide'), par.get('hangar')]).size, 'local, chambre froide et hangar se distinguent').toBe(3);
  });
});

describe('T61 : étiquettes à la demande', () => {
  it('etiquettesScene : les chemins nommés au milieu de leur plus long segment, puis les bâtiments à leur centre', () => {
    const e = m.etiquettesScene(m.versScene(plan(), 0));
    expect(e.map((x) => [x.sorte, x.nom])).toEqual([
      ['chemin', 'Allée centrale'],
      ['batiment', 'Chambre froide'],
      ['batiment', 'Hangar'],
      ['batiment', 'Local'],
      ['batiment', 'Magasin'],
    ].sort((a, b) => (a[0] === b[0] ? 0 : a[0] === 'chemin' ? -1 : 1)));
    const allee = e.find((x) => x.sorte === 'chemin');
    // Plus long segment : (0,0)→(40,0), milieu (20, 0) en repère de scène.
    expect([allee?.x, allee?.z === 0 ? 0 : allee?.z]).toEqual([20, 0]);
    const hangar = e.find((x) => x.nom === 'Hangar');
    expect([hangar?.x, hangar?.z]).toEqual([-60, -15]);
  });

  it('un chemin sans nom n’a pas d’étiquette', () => {
    const e = m.etiquettesScene(m.versScene(plan(), 0));
    expect(e.filter((x) => x.sorte === 'chemin')).toHaveLength(1);
  });

  describe('composant : rien d’affiché tant qu’on ne le demande pas', () => {
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

    const ETIQUETTES: readonly Etiquette[] = [
      { id: 'c1', sorte: 'chemin', nom: 'Allée centrale', x: 20, z: 0 },
      { id: 'b1', sorte: 'batiment', nom: 'Hangar', x: -60, z: -15 },
    ];
    const etiquettes = (): HTMLElement[] => [...conteneur.querySelectorAll<HTMLElement>('[data-testid="etiquette-3d"]')];
    const bascule = (): HTMLElement => {
      const b = conteneur.querySelector<HTMLElement>('[data-testid="bascule-etiquettes-3d"]');
      if (b === null) throw new Error('bouton Étiquettes absent');
      return b;
    };

    async function rendre(): Promise<void> {
      let module: Record<string, unknown>;
      try {
        module = (await import(/* @vite-ignore */ CHEMIN_ETIQUETTES)) as Record<string, unknown>;
      } catch {
        throw new Error(`${CHEMIN_ETIQUETTES} n’existe pas encore (T61)`);
      }
      const Composant = module.Etiquettes3d as ComponentType<{ etiquettes: readonly Etiquette[]; couche: RefObject<HTMLDivElement | null> }>;
      await act(async () => {
        racine.render(createElement(Composant, { etiquettes: ETIQUETTES, couche: createRef<HTMLDivElement>() }));
        await Promise.resolve();
      });
    }

    it('fermé à l’ouverture (aucune étiquette), ouvert au tap, refermé au second tap', async () => {
      await rendre();
      expect(bascule().getAttribute('aria-pressed')).toBe('false');
      expect(bascule().textContent).toContain('Étiquettes');
      expect(etiquettes()).toEqual([]);
      await act(async () => {
        bascule().click();
        await Promise.resolve();
      });
      expect(bascule().getAttribute('aria-pressed')).toBe('true');
      expect(etiquettes().map((e) => [e.dataset.id, e.dataset.sorte, e.textContent.trim()])).toEqual([
        ['c1', 'chemin', 'Allée centrale'],
        ['b1', 'batiment', 'Hangar'],
      ]);
      expect(etiquettes().map((e) => [Number(e.dataset.x), Number(e.dataset.z)])).toEqual([
        [20, 0],
        [-60, -15],
      ]);
      expect(conteneur.querySelector('[data-testid="etiquettes-3d"]')).not.toBeNull();
      await act(async () => {
        bascule().click();
        await Promise.resolve();
      });
      expect(etiquettes()).toEqual([]);
    });
  });
});
