/**
 * Tests d'acceptation T37b — l'enveloppe de triangles du niveau de détail (plants-rendu.ts,
 * `choisirDetail`) : sur une scène très dense, les plants en détail ne dépassent pas l'enveloppe
 * (plus basse sur écran étroit), les plants les plus proches passent d'abord. three seul, sans
 * navigateur ni WebGL. Contrat : ./test/contrat-telephone.ts (section 2).
 *
 * Le test compte les triangles des plants eux-mêmes (formes) : tuteurs, fruits, balises et poteaux
 * ne comptent pas dans ce total (voir le rapport du testeur) ; l'e2e du téléphone
 * (e2e/vue-3d-fraises-pres.e2e.ts) vérifie, lui, tous les triangles de l'image.
 */
import { InstancedMesh, MeshBasicMaterial } from 'three';
import type { DateCalendaire } from '@planif/core';
import { profilParDefaut, type DatesCroissance, type FormePlant } from '@planif/core/croissance';
import { beforeAll, describe, expect, it } from 'vitest';
import { appliquerFiltres, FILTRES_TOUT, type Scene, type VolumeScene } from './scene.ts';
import { FORMES, plantsDePlanche, PLANTS_MAX_TOTAL, TRIANGLES_PAR_FORME, type PlantsPlanche } from './plants.ts';
import { RenduPlants } from './plants-rendu.ts';
import { BORNES_ENVELOPPE, type ModuleEnveloppe } from './test/contrat-telephone.ts';

const CHEMIN_PLANTS = './plants.ts';
let env: ModuleEnveloppe;
beforeAll(async () => {
  env = (await import(/* @vite-ignore */ CHEMIN_PLANTS)) as ModuleEnveloppe;
});

interface RenduEtroit {
  choisirDetail(scene: Scene, plants: readonly (PlantsPlanche | null)[], x: number, y: number, z: number, hauteurPx: number, largeurPx?: number): boolean;
}

const d = (s: string): DateCalendaire => s as DateCalendaire;
const HAUTEUR_ECRAN = 844;
const LARGEUR_TELEPHONE = 390;
const LARGEUR_ORDINATEUR = 1280;
const JOUR = d('2027-08-02');
const DATES: DatesCroissance = {
  miseEnPlace: { prevue: d('2027-05-01'), reelle: null },
  debutRecolte: { prevue: d('2027-07-01'), reelle: null },
  finRecolte: { prevue: d('2027-09-15'), reelle: null },
  arrachage: { prevue: d('2027-10-15'), reelle: null },
};

/** Planches de melon (forme rampante, 54 triangles par plant), 20 plants chacune, espacées de 3 m le long de x. */
function ferme(n: number): { scene: Scene; plants: (PlantsPlanche | null)[] } {
  const volumes: VolumeScene[] = Array.from({ length: n }, (_, i) => ({
    id: `p${String(i)}`,
    code: `P${String(i)}`,
    zoneId: 'z',
    x: 3 * i,
    z: 0,
    longueur: 12,
    largeur: 1,
    hauteur: 0.3,
    angle: 0,
    placee: true,
    couleur: '#2E7D32',
    cleFamille: 'cucurbitacees',
    culture: 'Melon',
    occupationId: `o${String(i)}`,
  }));
  const plants = volumes.map((v) => plantsDePlanche({ volume: v, culture: { espece: 'Melon', profil: profilParDefaut('Melon').profil, croissance: { sorte: 'annuelle', dates: DATES }, ecartementM: 0.5 }, jour: JOUR, horsSol: false }));
  return { scene: { semaine: 0, libelleSemaine: 'S01', socles: [], volumes, batiments: [] }, plants };
}

/** Triangles des plants posés : nombre d'instances de chaque forme × triangles de sa géométrie. */
function trianglesPoses(rendu: RenduPlants, scene: Scene, plants: readonly (PlantsPlanche | null)[], mailles: ReadonlyMap<FormePlant, InstancedMesh>): number {
  rendu.poser(scene, appliquerFiltres(scene, FILTRES_TOUT), plants);
  let n = 0;
  for (const [forme, m] of mailles) n += m.count * TRIANGLES_PAR_FORME[forme];
  return n;
}

function banc(scene: Scene, plants: readonly (PlantsPlanche | null)[]) {
  const rendu = new RenduPlants();
  const mailles = new Map<FormePlant, InstancedMesh>();
  for (const forme of FORMES) {
    const m = new InstancedMesh(rendu.geometrie(forme), new MeshBasicMaterial(), 4096);
    rendu.lierMaillage(forme, m);
    mailles.set(forme, m);
  }
  const detail = (): number[] => scene.volumes.flatMap((_, i) => (rendu.enDetail(i) ? [i] : []));
  return { rendu, mailles, detail, triangles: () => trianglesPoses(rendu, scene, plants, mailles) };
}

describe('T37b : constantes de l’enveloppe', () => {
  it('trois constantes nommées, entières, exportées de plants.ts', () => {
    for (const nom of ['ENVELOPPE_TRIANGLES_PLANTS', 'ENVELOPPE_TRIANGLES_PLANTS_ETROIT', 'LARGEUR_ECRAN_ETROIT_PX'] as const) {
      expect(Number.isInteger(env[nom]), `${nom} : un entier (absent de plants.ts ?)`).toBe(true);
      expect(env[nom], nom).toBeGreaterThan(0);
    }
  });

  it('l’enveloppe d’un écran étroit est strictement plus basse que celle d’un écran large', () => {
    expect(env.ENVELOPPE_TRIANGLES_PLANTS_ETROIT).toBeLessThan(env.ENVELOPPE_TRIANGLES_PLANTS);
  });

  it('l’enveloppe large tient dans la borne de la ferme T07 (14 000 triangles pour toute la scène)', () => {
    expect(env.ENVELOPPE_TRIANGLES_PLANTS).toBeLessThanOrEqual(BORNES_ENVELOPPE.largeMax);
  });

  it('l’enveloppe étroite laisse passer au moins une planche de 20 plants de 54 triangles (la plus proche n’est jamais privée de détail)', () => {
    expect(env.ENVELOPPE_TRIANGLES_PLANTS_ETROIT).toBeGreaterThanOrEqual(20 * 54);
  });

  it('un téléphone est un écran étroit, un ordinateur non', () => {
    expect(env.LARGEUR_ECRAN_ETROIT_PX).toBeGreaterThanOrEqual(BORNES_ENVELOPPE.seuilEtroitMin);
    expect(env.LARGEUR_ECRAN_ETROIT_PX).toBeLessThanOrEqual(BORNES_ENVELOPPE.seuilEtroitMax);
  });
});

describe('T37b : planche très dense, l’enveloppe est respectée', () => {
  // 14 planches de 20 plants de 54 triangles = 15 120 triangles, bien au-dessus de toute enveloppe.
  const { scene, plants } = ferme(14);

  it('banc : sans enveloppe, tout ce plafond de 180 plants dépasserait la borne large (le plafond de plants ne suffit plus)', () => {
    expect(plants.reduce((n, p) => n + (p?.nombre ?? 0), 0)).toBeGreaterThan(PLANTS_MAX_TOTAL);
    expect(PLANTS_MAX_TOTAL * TRIANGLES_PAR_FORME.rampant).toBeGreaterThan(BORNES_ENVELOPPE.largeMax);
  });

  it('écran large : jamais plus de ENVELOPPE_TRIANGLES_PLANTS triangles de plants, et beaucoup de détail tout de même', () => {
    const b = banc(scene, plants);
    (b.rendu as unknown as RenduEtroit).choisirDetail(scene, plants, 0, 6, 0, HAUTEUR_ECRAN, LARGEUR_ORDINATEUR);
    const t = b.triangles();
    expect(t).toBeLessThanOrEqual(env.ENVELOPPE_TRIANGLES_PLANTS);
    // L'enveloppe est remplie à une planche près (1 080 triangles) : on ne se prive pas de détail sans raison.
    expect(t).toBeGreaterThan(env.ENVELOPPE_TRIANGLES_PLANTS - 20 * TRIANGLES_PAR_FORME.rampant - 1);
  });

  it('sans largeur donnée : écran large (les appels existants ne changent pas)', () => {
    const large = banc(scene, plants);
    large.rendu.choisirDetail(scene, plants, 0, 6, 0, HAUTEUR_ECRAN);
    const explicite = banc(scene, plants);
    (explicite.rendu as unknown as RenduEtroit).choisirDetail(scene, plants, 0, 6, 0, HAUTEUR_ECRAN, LARGEUR_ORDINATEUR);
    expect(large.detail()).toEqual(explicite.detail());
  });

  it('écran étroit (390 px) : jamais plus de ENVELOPPE_TRIANGLES_PLANTS_ETROIT triangles, moins de détail qu’au bureau', () => {
    const etroit = banc(scene, plants);
    (etroit.rendu as unknown as RenduEtroit).choisirDetail(scene, plants, 0, 6, 0, HAUTEUR_ECRAN, LARGEUR_TELEPHONE);
    const tEtroit = etroit.triangles();
    expect(tEtroit).toBeLessThanOrEqual(env.ENVELOPPE_TRIANGLES_PLANTS_ETROIT);
    expect(tEtroit).toBeGreaterThan(0);
    const large = banc(scene, plants);
    (large.rendu as unknown as RenduEtroit).choisirDetail(scene, plants, 0, 6, 0, HAUTEUR_ECRAN, LARGEUR_ORDINATEUR);
    expect(etroit.detail().length).toBeLessThan(large.detail().length);
  });

  it.each([
    ['ordinateur', LARGEUR_ORDINATEUR],
    ['téléphone', LARGEUR_TELEPHONE],
  ])('%s : les plants les plus proches d’abord (les planches en détail sont les premières, sans trou)', (_nom, largeur) => {
    const b = banc(scene, plants);
    (b.rendu as unknown as RenduEtroit).choisirDetail(scene, plants, 0, 6, 0, HAUTEUR_ECRAN, largeur);
    const detail = b.detail();
    expect(detail.length).toBeGreaterThan(0);
    expect(detail.length).toBeLessThan(scene.volumes.length);
    expect(detail, 'planches en détail = les k plus proches de la caméra').toEqual(detail.map((_, i) => i));
  });

  it('la caméra à l’autre bout : ce sont les planches de ce bout qui passent d’abord', () => {
    const b = banc(scene, plants);
    const dernier = scene.volumes.length - 1;
    (b.rendu as unknown as RenduEtroit).choisirDetail(scene, plants, 3 * dernier, 6, 0, HAUTEUR_ECRAN, LARGEUR_TELEPHONE);
    const detail = b.detail();
    expect(detail).toContain(dernier);
    expect(detail).not.toContain(0);
    expect(detail).toEqual(detail.map((_, i) => dernier - detail.length + 1 + i));
  });

  it('l’enveloppe ne dépend pas de l’ordre des planches dans la scène (la distance seule décide)', () => {
    const inverse = { ...scene, volumes: [...scene.volumes].reverse() };
    const plantsInverses = [...plants].reverse();
    const b = banc(inverse, plantsInverses);
    (b.rendu as unknown as RenduEtroit).choisirDetail(inverse, plantsInverses, 0, 6, 0, HAUTEUR_ECRAN, LARGEUR_TELEPHONE);
    const ids = b.detail().map((i) => inverse.volumes[i]?.id);
    const attendu = banc(scene, plants);
    (attendu.rendu as unknown as RenduEtroit).choisirDetail(scene, plants, 0, 6, 0, HAUTEUR_ECRAN, LARGEUR_TELEPHONE);
    expect([...ids].sort()).toEqual(attendu.detail().map((i) => scene.volumes[i]?.id).sort());
  });

  it('une scène qui tient dans l’enveloppe est entièrement en détail (rien n’est retiré sans raison)', () => {
    const peu = ferme(2);
    const b = banc(peu.scene, peu.plants);
    (b.rendu as unknown as RenduEtroit).choisirDetail(peu.scene, peu.plants, 0, 6, 0, HAUTEUR_ECRAN, LARGEUR_TELEPHONE);
    expect(b.detail()).toEqual([0, 1]);
  });
});
