/**
 * T32b — niveau de détail et pose des instances (plants-rendu.ts) : de loin les instances sont
 * retirées (le compte de l'InstancedMesh baisse), de près elles reviennent, le plafond total tient,
 * les planches les plus proches passent d'abord. three seul, sans navigateur ni WebGL.
 */
import { InstancedMesh, MeshBasicMaterial } from 'three';
import type { DateCalendaire } from '@planif/core';
import { profilParDefaut } from '@planif/core/croissance';
import { describe, expect, it } from 'vitest';
import { RenduPlants } from './plants-rendu.ts';
import { LARGEUR_VISIBLE_PX, plantsDePlanche, plantsVisibles, PLANTS_MAX_PAR_PLANCHE, PLANTS_MAX_TOTAL, type PlantsPlanche } from './plants.ts';
import { appliquerFiltres, FILTRES_TOUT, type Scene, type VolumeScene } from './scene.ts';

const d = (s: string): DateCalendaire => s as DateCalendaire;
const HAUTEUR_ECRAN = 800;
const CHAMP = 40;

describe('T32b : plantsVisibles (niveau de détail)', () => {
  it('de près un plant se voit, de loin il se fond dans la masse', () => {
    expect(plantsVisibles(0.3, 5, HAUTEUR_ECRAN, CHAMP)).toBe(true);
    expect(plantsVisibles(0.3, 500, HAUTEUR_ECRAN, CHAMP)).toBe(false);
  });

  it('plus la caméra s’éloigne, moins on voit : le seuil est franchi une seule fois', () => {
    const vus = [5, 20, 40, 80, 160, 320, 640].map((m) => plantsVisibles(0.3, m, HAUTEUR_ECRAN, CHAMP));
    const premierFaux = vus.indexOf(false);
    expect(premierFaux).toBeGreaterThan(0);
    expect(vus.slice(premierFaux).every((v) => !v)).toBe(true);
  });

  it('au seuil : LARGEUR_VISIBLE_PX pixels de large', () => {
    const pixelsParMetre = HAUTEUR_ECRAN / (2 * 50 * Math.tan((CHAMP * Math.PI) / 360));
    expect(plantsVisibles(LARGEUR_VISIBLE_PX / pixelsParMetre + 1e-6, 50, HAUTEUR_ECRAN, CHAMP)).toBe(true);
    expect(plantsVisibles(LARGEUR_VISIBLE_PX / pixelsParMetre - 1e-6, 50, HAUTEUR_ECRAN, CHAMP)).toBe(false);
  });
});

/** Une rangée de planches de tomates, espacées de 3 m le long de x, de 12 m de long. */
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
    couleur: '#C0392B',
    cleFamille: 'solanacees',
    culture: 'Tomate',
    occupationId: `o${String(i)}`,
  }));
  const dates = {
    miseEnPlace: { prevue: d('2027-05-01'), reelle: null },
    debutRecolte: { prevue: d('2027-07-01'), reelle: null },
    finRecolte: { prevue: d('2027-09-15'), reelle: null },
    arrachage: { prevue: d('2027-10-15'), reelle: null },
  };
  const plants = volumes.map((v) => plantsDePlanche({ volume: v, culture: { espece: 'Tomate', profil: profilParDefaut('Tomate').profil, croissance: { sorte: 'annuelle', dates }, ecartementM: 0.5 }, jour: d('2027-08-02'), horsSol: false }));
  return { scene: { semaine: 0, libelleSemaine: 'S01', socles: [], volumes, batiments: [] }, plants };
}

function mailles(rendu: RenduPlants, capacite: number): InstancedMesh {
  const m = new InstancedMesh(rendu.geometrie('erige-tuteure'), new MeshBasicMaterial(), capacite);
  rendu.lierMaillage('erige-tuteure', m);
  return m;
}

describe('T32b : le niveau de détail retire réellement les instances', () => {
  it('de près : les plants sont posés ; de loin : plus aucune instance, le compte tombe à 0', () => {
    const { scene, plants } = ferme(3);
    const filtree = appliquerFiltres(scene, FILTRES_TOUT);
    const rendu = new RenduPlants();
    const m = mailles(rendu, 256);
    expect(rendu.choisirDetail(scene, plants, 3, 10, 5, HAUTEUR_ECRAN)).toBe(true);
    const proche = rendu.poser(scene, filtree, plants);
    expect(proche.plants).toBe(plants.reduce((n, p) => n + (p?.nombre ?? 0), 0));
    expect(m.count).toBe(proche.plants);
    expect(proche.formes).toBe(1);

    expect(rendu.choisirDetail(scene, plants, 3, 5_000, 5, HAUTEUR_ECRAN)).toBe(true);
    const loin = rendu.poser(scene, filtree, plants);
    expect(loin.plants).toBe(0);
    expect(m.count).toBe(0);
    expect(loin.formes).toBe(0);
    // Les hauteurs restent écrites : la masse, elle, a la hauteur du feuillage.
    expect(Object.keys(JSON.parse(loin.hauteurs) as Record<string, number>)).toEqual(['p0', 'p1', 'p2']);
  });

  it('une caméra qui ne change rien ne redemande rien', () => {
    const { scene, plants } = ferme(3);
    const rendu = new RenduPlants();
    expect(rendu.choisirDetail(scene, plants, 3, 10, 5, HAUTEUR_ECRAN)).toBe(true);
    expect(rendu.choisirDetail(scene, plants, 3.1, 10, 5, HAUTEUR_ECRAN)).toBe(false);
  });

  it('le détail change : les dalles sont redessinées', () => {
    const { scene, plants } = ferme(2);
    const rendu = new RenduPlants();
    let appels = 0;
    rendu.lierDalles(() => {
      appels += 1;
    });
    rendu.choisirDetail(scene, plants, 0, 10, 5, HAUTEUR_ECRAN);
    rendu.choisirDetail(scene, plants, 0, 10, 5, HAUTEUR_ECRAN);
    rendu.choisirDetail(scene, plants, 0, 9_000, 5, HAUTEUR_ECRAN);
    expect(appels).toBe(2);
  });

  it('plafond total : jamais plus de PLANTS_MAX_TOTAL plants, les planches les plus proches d’abord', () => {
    const n = Math.ceil(PLANTS_MAX_TOTAL / PLANTS_MAX_PAR_PLANCHE) * 3;
    const { scene, plants } = ferme(n);
    const filtree = appliquerFiltres(scene, FILTRES_TOUT);
    const rendu = new RenduPlants();
    mailles(rendu, 2048);
    rendu.choisirDetail(scene, plants, 0, 6, 0, HAUTEUR_ECRAN);
    const bilan = rendu.poser(scene, filtree, plants);
    expect(bilan.plants).toBeGreaterThan(0);
    expect(bilan.plants).toBeLessThanOrEqual(PLANTS_MAX_TOTAL);
    // La planche la plus proche (la première, en x = 0) est en détail ; la dernière non.
    expect(rendu.enDetail(0)).toBe(true);
    expect(rendu.enDetail(n - 1)).toBe(false);
  });
});
