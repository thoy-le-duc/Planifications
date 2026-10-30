/**
 * T88 (relecture critique) — 3D : cases visibles (limite au sol et nom) sur la serre à légumes 6 × 3, et aucune limite en double
 * quand deux tronçons se touchent (allée de 0). Pur : le plan, puis la scène, sous Node. Même ferme que ./cases-3d.test.ts, dont la
 * zone « Serre » reçoit des sous-zones « Zone 3 » à « Zone 18 » en plus de « Chapelle 1 » et « Chapelle 2 » : 18 sous-zones.
 *
 * Serre à légumes : 128,8 × 57,6 m, centre (50 ; 30), cap 0°, 6 chapelles de 9,6 m, 3 tronçons de 40 m, allées de 4,40 m. Centres
 * dans la serre en x −24 … 24, en y −44,4 ; 0 ; 44,4 → dans la scène (x, −y) : x = 26 ; 35,6 ; 45,2 ; 54,8 ; 64,4 ; 74, z = −(30 + y)
 * = 14,4 ; −30 ; −74,4.
 * Allée de 0, 2 chapelles × 2 tronçons de 20 m dans 40 × 8 m : les lignes de la scène sont z = −10, −30 et −50 (tronçons de −10 à
 * −30 et de −30 à −50) ; la ligne z = −30 est commune aux deux tronçons : une seule limite par chapelle.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { PETITE_FERME, SAISON_2026, Z } from '../plan/test/petite-ferme.ts';
import type { ModuleCalculsPlan } from '../plan/test/contrat.ts';
import type { Plan } from '../plan/calculs.ts';
import { limitesDeBandes } from './formes.ts';
import { etiquettesScene, versScene } from './scene.ts';

let calculs: ModuleCalculsPlan;
beforeAll(async () => {
  calculs = (await import(/* @vite-ignore */ '../plan/calculs.ts')) as ModuleCalculsPlan;
});

const C = '2026-01-15T08:00:00.000Z';
const batiment = (extra: Record<string, string | number | null>) => ({
  id: '0192f0c1-0000-7000-8000-00000000b188',
  ferme_id: '0192f0c1-0000-7000-8000-00000000f001',
  nom: 'Serre en grille',
  type: 'serre_chapelle',
  longueur_m: 128.8,
  largeur_m: 57.6,
  hauteur_m: 5,
  centre_x_m: 50,
  centre_y_m: 30,
  orientation_deg: 0,
  zone_id: Z.serre,
  nb_chapelles: 6,
  nb_troncons: 3,
  largeur_allee_m: 4.4,
  cree_le: C,
  modifie_le: C,
  supprime_le: null,
  ...extra,
});

/** La petite ferme, avec `n` sous-zones directes de « Serre » au total (Chapelle 1, Chapelle 2, puis Zone 3 à Zone n). */
function plan(b: Record<string, string | number | null>, n: number): Plan {
  const modele = PETITE_FERME.zone.find((z) => z.id === Z.chapelle1);
  if (modele === undefined) throw new Error('zone modèle absente');
  const autres = Array.from({ length: Math.max(0, n - 2) }, (_, i) => ({ ...modele, id: `0192f0c1-0000-7000-8000-0000000c${(i + 3).toString(16).padStart(4, '0')}`, nom: `Zone ${String(i + 3)}` }));
  return calculs.construirePlan({ ...PETITE_FERME, zone: [...PETITE_FERME.zone, ...autres], ...{ batiment: [b] } }, { saison: SAISON_2026, aujourdhui: '2026-06-10' }) as unknown as Plan;
}

const centre = (r: readonly { x: number; z: number }[]): { x: number; z: number } => ({ x: r.reduce((s, p) => s + p.x, 0) / r.length, z: r.reduce((s, p) => s + p.z, 0) / r.length });
const cle = (r: readonly { x: number; z: number }[]): string => {
  const c = centre(r);
  return `${c.x.toFixed(3)}/${c.z.toFixed(3)}`;
};

describe('T88 : 3D, la serre à légumes 6 × 3 (18 sous-zones)', () => {
  const scene = () => versScene(plan(batiment({}), 18), 0);

  it('18 cases, une par sous-zone, aux centres calculés à la main', () => {
    const bandes = scene().bandes ?? [];
    expect(bandes).toHaveLength(18);
    expect(new Set(bandes.map((b) => b.largeur.toFixed(3)))).toEqual(new Set(['9.600']));
    expect(new Set(bandes.map((b) => b.profondeur.toFixed(3)))).toEqual(new Set(['40.000']));
    expect([...new Set(bandes.map((b) => b.x.toFixed(1)))].sort((a, b) => Number(a) - Number(b))).toEqual(['26.0', '35.6', '45.2', '54.8', '64.4', '74.0']);
    expect([...new Set(bandes.map((b) => b.z.toFixed(1)))].sort((a, b) => Number(a) - Number(b))).toEqual(['-74.4', '-30.0', '14.4']);
  });

  it('le nom de chacune des 18 sous-zones est affiché, à une seule place (au centre de sa case)', () => {
    const s = scene();
    const e = etiquettesScene(s).filter((x) => x.sorte === 'bande');
    expect(e).toHaveLength(18);
    expect(new Set(e.map((x) => x.nom)).size).toBe(18);
    expect(e.map((x) => x.nom)).toEqual(expect.arrayContaining(['Chapelle 1', 'Chapelle 2', 'Zone 3', 'Zone 10', 'Zone 18']));
    const bandes = s.bandes ?? [];
    for (const x of e) {
      const b = bandes.find((y) => y.id === x.id);
      expect([x.x, x.z]).toEqual([b?.x, b?.z]);
    }
  });

  it('les limites au sol existent, toutes distinctes, y compris aux bouts de chaque tronçon (allées de 4,40 m)', () => {
    const limites = limitesDeBandes(scene().bandes ?? []);
    expect(limites.length).toBeGreaterThan(0);
    expect(new Set(limites.map(cle)).size).toBe(limites.length);
    // Le bout sud du tronçon 1 : z = −(30 − 64,4) = 34,4 ; le bout nord du tronçon 3 : z = −94,4.
    const zs = limites.map((l) => Math.round(centre(l).z * 10) / 10);
    expect(zs).toEqual(expect.arrayContaining([34.4, -94.4]));
  });
});

describe('T88 : 3D, allée de 0 entre deux tronçons', () => {
  const grille = { longueur_m: 40, largeur_m: 8, nb_chapelles: 2, nb_troncons: 2, largeur_allee_m: 0 };
  const limites = () => limitesDeBandes(versScene(plan(batiment(grille), 2), 0).bandes ?? []);

  it('aucune limite dessinée en double', () => {
    const l = limites();
    expect(new Set(l.map(cle)).size).toBe(l.length);
  });

  it('la ligne commune aux deux tronçons (z = −30) est dessinée une fois par chapelle, et les deux bouts de la serre aussi', () => {
    const l = limites().map(centre);
    for (const x of [48, 52]) {
      for (const z of [-10, -30, -50]) {
        const n = l.filter((c) => Math.abs(c.x - x) < 1e-6 && Math.abs(c.z - z) < 1e-6).length;
        expect(n, `limite en (${String(x)} ; ${String(z)})`).toBe(1);
      }
    }
  });
});
