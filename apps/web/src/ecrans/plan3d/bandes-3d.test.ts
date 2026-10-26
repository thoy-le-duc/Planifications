/**
 * Tests d'acceptation T86 — la 3D montre les bandes d'une serre à plusieurs zones (règle 2 : le nom de chaque bande ;
 * critère : « limite au sol et nom », docs/backlog/T86-sous-zones-dans-serre.md). Pur : le plan, puis la scène, sous Node.
 *
 * Données : la petite ferme du plan (../plan/test/petite-ferme.ts) a une zone « Serre » avec deux sous-zones « Chapelle 1 » et
 * « Chapelle 2 » (et « Demi-chapelle », sous « Chapelle 1 », qui n'a pas de bande : seules les sous-zones directes en ont).
 * On l'abrite sous une serre chapelle de 40 × 8 m, centre (50 ; 30), cap 90° (la longueur va d'ouest en est).
 *
 * Calcul à la main : deux bandes de 8 / 2 = 4 m de large et 40 m de long, centres à x = −2 m et +2 m du repère de la serre ;
 * cap 90° : x_serre → vers le sud (axe x' = (cos 90°, −sin 90°) = (0 ; −1)), donc Chapelle 1 (x' = −2 m) est au NORD, en
 * (50 ; 32), Chapelle 2 en (50 ; 28). Repère de la scène : (x, −y), angle = −cap en radians = −π/2.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Z, PETITE_FERME, SAISON_2026 } from '../plan/test/petite-ferme.ts';
import type { ModuleCalculsPlan } from '../plan/test/contrat.ts';
import type { Plan } from '../plan/calculs.ts';
import type { Scene, EtiquetteScene } from './scene.ts';

interface BandeAttendue {
  readonly id: string;
  readonly nom: string;
  readonly x: number;
  readonly z: number;
  readonly largeur: number;
  readonly profondeur: number;
  readonly angle: number;
}
interface SceneAvecBandes extends Scene {
  readonly bandes?: readonly BandeAttendue[];
}
interface Modules {
  versScene(plan: Plan, semaine: number): SceneAvecBandes;
  etiquettesScene(scene: Pick<Scene, 'chemins' | 'batiments'> & { readonly bandes?: readonly BandeAttendue[] }): EtiquetteScene[];
}

let calculs: ModuleCalculsPlan;
let m: Modules;
beforeAll(async () => {
  calculs = (await import(/* @vite-ignore */ '../plan/calculs.ts')) as ModuleCalculsPlan;
  m = (await import(/* @vite-ignore */ './scene.ts'));
});

const C = '2026-01-15T08:00:00.000Z';
const batiment = (extra: Record<string, string | number | null> = {}) => ({
  id: '0192f0c1-0000-7000-8000-00000000b101',
  ferme_id: '0192f0c1-0000-7000-8000-00000000f001',
  nom: 'Serre des chapelles',
  type: 'serre_chapelle',
  longueur_m: 40,
  largeur_m: 8,
  hauteur_m: 4,
  centre_x_m: 50,
  centre_y_m: 30,
  orientation_deg: 90,
  zone_id: Z.serre,
  cree_le: C,
  modifie_le: C,
  supprime_le: null,
  ...extra,
});
const plan = (b: Record<string, string | number | null> | null = batiment(), zones = PETITE_FERME.zone): Plan =>
  calculs.construirePlan({ ...PETITE_FERME, zone: zones, ...(b === null ? {} : { batiment: [b] }) }, { saison: SAISON_2026, aujourdhui: '2026-06-10' }) as unknown as Plan;

describe('T86 : le plan porte les sous-zones', () => {
  it('sousZones : les zones qui ont un parent (id, nom, parent), pour que la 3D compte aussi celles sans planche', () => {
    const p = plan() as Plan & { sousZones?: readonly { id: string; nom: string; parenteId: string }[] };
    expect(p.sousZones?.map((s) => [s.id, s.nom, s.parenteId]).sort()).toEqual(
      [
        [Z.chapelle2, 'Chapelle 2', Z.serre],
        [Z.chapelle1, 'Chapelle 1', Z.serre],
        [Z.demiChapelle, 'Demi-chapelle', Z.chapelle1],
      ].sort(),
    );
  });

  it('une zone supprimée n’est pas une sous-zone', () => {
    const zones = PETITE_FERME.zone.map((z) => (z.id === Z.chapelle2 ? { ...z, supprime_le: C } : z));
    const p = plan(batiment(), zones) as Plan & { sousZones?: readonly { id: string }[] };
    expect(p.sousZones?.map((s) => s.id)).not.toContain(Z.chapelle2);
  });
});

describe('T86 : les bandes dans la scène 3D', () => {
  it('deux sous-zones directes → deux bandes de 4 × 40 m, aux bons centres, tournées avec la serre', () => {
    const { bandes } = m.versScene(plan(), 0);
    expect(bandes?.map((b) => b.nom)).toEqual(['Chapelle 1', 'Chapelle 2']);
    expect(bandes?.map((b) => b.id)).toEqual([Z.chapelle1, Z.chapelle2]);
    for (const b of bandes ?? []) {
      expect(b.largeur).toBeCloseTo(4, 3);
      expect(b.profondeur).toBeCloseTo(40, 3);
      expect(b.angle).toBeCloseTo(-Math.PI / 2, 6);
      expect(b.x).toBeCloseTo(50, 3);
    }
    expect(bandes?.map((b) => b.z)).toEqual([expect.closeTo(-32, 3), expect.closeTo(-28, 3)]);
  });

  it('une sous-zone sans aucune planche a sa bande aussi (Demi-chapelle exclue : sous-zone de sous-zone)', () => {
    const zones = [...PETITE_FERME.zone, { ...PETITE_FERME.zone[0], id: '0192f0c1-0000-7000-8000-0000000000e1', nom: 'Chapelle 3', zone_parente_id: Z.serre }] as typeof PETITE_FERME.zone;
    const { bandes } = m.versScene(plan(batiment(), zones), 0);
    expect(bandes?.map((b) => b.nom)).toEqual(['Chapelle 1', 'Chapelle 2', 'Chapelle 3']);
    expect(bandes?.map((b) => b.largeur)).toEqual([expect.closeTo(8 / 3, 3), expect.closeTo(8 / 3, 3), expect.closeTo(8 / 3, 3)]);
  });

  it('pas de bande : zone non abritée, ou abritée par un bâtiment qui n’est pas une serre', () => {
    expect(m.versScene(plan(null), 0).bandes ?? []).toEqual([]);
    expect(m.versScene(plan(batiment({ type: 'hangar' })), 0).bandes ?? []).toEqual([]);
  });

  it('une serre sans sous-zone : aucune bande', () => {
    expect(m.versScene(plan(batiment({ zone_id: Z.tunnel2 })), 0).bandes ?? []).toEqual([]);
  });

  it('les bandes suivent la serre : cap 0°, centre (100 ; 10) → bandes en (98 ; −10) et (102 ; −10) en scène', () => {
    const { bandes } = m.versScene(plan(batiment({ orientation_deg: 0, centre_x_m: 100, centre_y_m: 10 })), 0);
    // cap 0° : x' = est ; largeur 8 m, deux bandes de 4 m, centres à x' = −2 et +2 m.
    expect(bandes?.map((b) => b.x)).toEqual([expect.closeTo(98, 3), expect.closeTo(102, 3)]);
    expect(bandes?.map((b) => b.z)).toEqual([expect.closeTo(-10, 3), expect.closeTo(-10, 3)]);
    expect(bandes?.map((b) => b.angle)).toEqual([expect.closeTo(0, 6), expect.closeTo(0, 6)]);
  });
});

describe('T86 : le nom des bandes (étiquettes à la demande)', () => {
  it('etiquettesScene : les bandes après les bâtiments, au centre de chaque bande', () => {
    const scene = m.versScene(plan(), 0);
    const e = m.etiquettesScene(scene);
    const bandes = e.filter((x) => (x.sorte as string) === 'bande');
    expect(bandes.map((x) => x.nom)).toEqual(['Chapelle 1', 'Chapelle 2']);
    expect(bandes.map((x) => x.id)).toEqual([Z.chapelle1, Z.chapelle2]);
    expect(bandes[0]?.x).toBeCloseTo(50, 3);
    expect(bandes[0]?.z).toBeCloseTo(-32, 3);
    const dernierBatiment = e.map((x) => x.sorte).lastIndexOf('batiment');
    expect(e.findIndex((x) => (x.sorte as string) === 'bande')).toBeGreaterThan(dernierBatiment);
  });
});
