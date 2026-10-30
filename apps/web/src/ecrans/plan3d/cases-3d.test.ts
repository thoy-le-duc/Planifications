/**
 * T88 — la 3D lit les cases d'une serre en grille (chapelles × tronçons) à la place des bandes (règle 5 et critère « 3D : cases
 * visibles (limite au sol et nom) », docs/backlog/T88-serre-en-grille-modele.md). Pur : le plan, puis la scène, sous Node.
 *
 * Données : la petite ferme du plan (../plan/test/petite-ferme.ts), zone « Serre » à deux sous-zones directes (« Chapelle 1 »,
 * « Chapelle 2 »), abritée par une serre de 40 × 8 m au cap 0°, centre (50 ; 30), découpée en 2 chapelles × 2 tronçons avec une
 * allée de 2 m. Calcul à la main : chapelle 4 m, tronçon (40 − 2) / 2 = 19 m ; centres de la serre x = −2 et +2, y = −10,5 et
 * +10,5. Chapelle 1 → (chapelle 1, tronçon 1) = ferme (48 ; 19,5), scène (48 ; −19,5) ; Chapelle 2 → (2, 1) = (52 ; 19,5).
 * Le tronçon 2 est fait de deux cases vides (sans nom).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { PETITE_FERME, SAISON_2026, Z } from '../plan/test/petite-ferme.ts';
import type { ModuleCalculsPlan } from '../plan/test/contrat.ts';
import type { Plan } from '../plan/calculs.ts';
import { limitesDeBandes } from './formes.ts';
import { etiquettesScene, versScene, type BandeScene } from './scene.ts';

let calculs: ModuleCalculsPlan;
beforeAll(async () => {
  calculs = (await import(/* @vite-ignore */ '../plan/calculs.ts')) as ModuleCalculsPlan;
});

const C = '2026-01-15T08:00:00.000Z';
const batiment = (extra: Record<string, string | number | null> = {}) => ({
  id: '0192f0c1-0000-7000-8000-00000000b188',
  ferme_id: '0192f0c1-0000-7000-8000-00000000f001',
  nom: 'Serre en grille',
  type: 'serre_chapelle',
  longueur_m: 40,
  largeur_m: 8,
  hauteur_m: 4,
  centre_x_m: 50,
  centre_y_m: 30,
  orientation_deg: 0,
  zone_id: Z.serre,
  nb_chapelles: 2,
  nb_troncons: 2,
  largeur_allee_m: 2,
  cree_le: C,
  modifie_le: C,
  supprime_le: null,
  ...extra,
});
const plan = (b: Record<string, string | number | null>): Plan =>
  calculs.construirePlan({ ...PETITE_FERME, ...{ batiment: [b] } }, { saison: SAISON_2026, aujourdhui: '2026-06-10' }) as unknown as Plan;

describe('T88 : le plan porte la grille de la serre', () => {
  it('batiments : nbChapelles, nbTroncons, largeurAlleeM recopiés quand ils sont renseignés', () => {
    expect(plan(batiment()).batiments?.[0]).toMatchObject({ nbChapelles: 2, nbTroncons: 2, largeurAlleeM: 2 });
  });

  it('grille nulle : les trois champs sont absents (forme de T86)', () => {
    const b = plan(batiment({ nb_chapelles: null, nb_troncons: null, largeur_allee_m: null })).batiments?.[0];
    expect(b).toBeDefined();
    expect(b !== undefined && ('nbChapelles' in b || 'nbTroncons' in b || 'largeurAlleeM' in b)).toBe(false);
  });
});

describe('T88 : les cases dans la scène 3D', () => {
  it('2 × 2 cases : les deux sous-zones au tronçon 1, deux cases vides au tronçon 2', () => {
    const bandes = versScene(plan(batiment()), 0).bandes ?? [];
    expect(bandes.map((b) => [b.nom, b.chapelle, b.troncon])).toEqual([
      ['Chapelle 1', 1, 1],
      ['Chapelle 2', 2, 1],
      ['', 1, 2],
      ['', 2, 2],
    ]);
    expect(bandes.map((b) => b.id).slice(0, 2)).toEqual([Z.chapelle1, Z.chapelle2]);
    for (const b of bandes) {
      expect(b.largeur).toBeCloseTo(4, 6);
      expect(b.profondeur).toBeCloseTo(19, 6);
    }
    expect(bandes.map((b) => [b.x, b.z])).toEqual([
      [expect.closeTo(48, 6), expect.closeTo(-19.5, 6)],
      [expect.closeTo(52, 6), expect.closeTo(-19.5, 6)],
      [expect.closeTo(48, 6), expect.closeTo(-40.5, 6)],
      [expect.closeTo(52, 6), expect.closeTo(-40.5, 6)],
    ]);
  });

  it('étiquettes : seulement les cases nommées, au centre de leur case', () => {
    const e = etiquettesScene(versScene(plan(batiment()), 0)).filter((x) => x.sorte === 'bande');
    expect(e.map((x) => [x.nom, x.x, x.z])).toEqual([
      ['Chapelle 1', expect.closeTo(48, 6), expect.closeTo(-19.5, 6)],
      ['Chapelle 2', expect.closeTo(52, 6), expect.closeTo(-19.5, 6)],
    ]);
  });

  it('un seul tronçon (tunnel Manon) : mêmes bandes qu’en T86, avec leur chapelle', () => {
    const bandes = versScene(plan(batiment({ nb_troncons: 1, largeur_allee_m: null })), 0).bandes ?? [];
    expect(bandes.map((b) => [b.nom, b.x, b.profondeur])).toEqual([
      ['Chapelle 1', expect.closeTo(48, 6), expect.closeTo(40, 6)],
      ['Chapelle 2', expect.closeTo(52, 6), expect.closeTo(40, 6)],
    ]);
  });
});

describe('T88 : limites des cases au sol (même géométrie que le sol, aucun appel de dessin de plus)', () => {
  const caseScene = (chapelle: number, troncon: number, x: number, z: number, nbTroncons = 2): BandeScene => ({
    id: `c${String(chapelle)}${String(troncon)}`,
    nom: '',
    batimentId: 'S',
    rang: 0,
    total: 0,
    x,
    z,
    largeur: 4,
    profondeur: 19,
    angle: 0,
    chapelle,
    troncon,
    nbTroncons,
  });

  it('chapelle 1 : ses deux bouts seulement ; chapelle 2 : son bord ouest en plus', () => {
    expect(limitesDeBandes([caseScene(1, 1, 48, -19.5)])).toHaveLength(2);
    const l = limitesDeBandes([caseScene(2, 1, 52, -19.5)]);
    expect(l).toHaveLength(3);
    const ouest = l[0] ?? [];
    expect(Math.min(...ouest.map((p) => p.x))).toBeCloseTo(49.94, 6);
    expect(Math.max(...ouest.map((p) => p.x))).toBeCloseTo(50.06, 6);
  });

  it('les bouts d’une case sont au sud et au nord du tronçon (z = −10 et −29 pour le tronçon 1), sur toute sa largeur', () => {
    const [sud, nord] = limitesDeBandes([caseScene(1, 1, 48, -19.5)]);
    const centreZ = (r: readonly { z: number }[] | undefined): number => (r ?? []).reduce((s, p) => s + p.z, 0) / 4;
    expect(centreZ(sud)).toBeCloseTo(-10, 6);
    expect(centreZ(nord)).toBeCloseTo(-29, 6);
    expect(Math.max(...(sud ?? []).map((p) => p.x)) - Math.min(...(sud ?? []).map((p) => p.x))).toBeCloseTo(4, 6);
  });

  it('un seul tronçon : pas de limite aux bouts (comme les bandes de T86)', () => {
    expect(limitesDeBandes([caseScene(1, 1, 48, -30, 1)])).toHaveLength(0);
    expect(limitesDeBandes([caseScene(2, 1, 52, -30, 1)])).toHaveLength(1);
  });
});
