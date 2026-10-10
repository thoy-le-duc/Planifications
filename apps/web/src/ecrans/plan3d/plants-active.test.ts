/**
 * T37b (relecture N1) — au téléphone, la place en détail laissée par la limite d'appels de dessin
 * (APPELS_DESSIN_MAX_ETROIT) va d'abord à la forme de la planche visée par « Suivant » (planche active),
 * pas à la planche la plus proche de la caméra. three seul, sans WebGL.
 */
import type { DateCalendaire } from '@planif/core';
import { profilParDefaut, type DatesCroissance } from '@planif/core/croissance';
import { describe, expect, it } from 'vitest';
import { APPELS_DESSIN_MAX_ETROIT, plantsDePlanche, type PlantsPlanche } from './plants.ts';
import { RenduPlants } from './plants-rendu.ts';
import { appliquerFiltres, FILTRES_TOUT, type Scene, type VolumeScene } from './scene.ts';

const d = (s: string): DateCalendaire => s as DateCalendaire;
const JOUR = d('2027-08-02');
const DATES: DatesCroissance = {
  miseEnPlace: { prevue: d('2027-05-01'), reelle: null },
  debutRecolte: { prevue: d('2027-07-01'), reelle: null },
  finRecolte: { prevue: d('2027-09-15'), reelle: null },
  arrachage: { prevue: d('2027-10-15'), reelle: null },
};
const HAUTEUR = 844;
const TELEPHONE = 390;

const volume = (i: number, x: number, espece: string): VolumeScene => ({
  id: `p${String(i)}`,
  code: `P${String(i)}`,
  zoneId: 'z',
  x,
  z: 0,
  longueur: 8,
  largeur: 1,
  hauteur: 0.3,
  angle: 0,
  placee: true,
  couleur: '#2E7D32',
  cleFamille: null,
  culture: espece,
  occupationId: `o${String(i)}`,
});

/** Une tomate tout près de la caméra, un melon (autre forme) un peu plus loin. */
function banc(): { scene: Scene; plants: (PlantsPlanche | null)[] } {
  const volumes = [volume(0, 0, 'Tomate'), volume(1, 3, 'Melon')];
  const plants = volumes.map((v) => plantsDePlanche({ volume: v, culture: { espece: v.culture ?? '', profil: profilParDefaut(v.culture ?? '').profil, croissance: { sorte: 'annuelle', dates: DATES }, ecartementM: 0.5 }, jour: JOUR, horsSol: false }));
  return { scene: { semaine: 0, libelleSemaine: 'S01', socles: [], volumes, batiments: [] }, plants };
}

function rendu(active: string | null): { r: RenduPlants; scene: Scene; plants: (PlantsPlanche | null)[] } {
  const { scene, plants } = banc();
  const r = new RenduPlants();
  // La ferme prend tous les appels sauf deux : les accessoires, et UNE forme de plant.
  r.fixerAppelsHorsPlants(APPELS_DESSIN_MAX_ETROIT - 2);
  r.fixerPlancheActive(active);
  r.choisirDetail(scene, plants, 0, 5, 0, HAUTEUR, TELEPHONE);
  return { r, scene, plants };
}

describe('T37b (N1) : la planche visée garde sa place en détail au téléphone', () => {
  it('banc : deux formes différentes, la tomate plus proche de la caméra', () => {
    const { plants } = banc();
    expect(plants[0]?.forme).not.toBe(plants[1]?.forme);
  });

  it('sans planche active : la planche la plus proche est en détail, l’autre forme reste une masse', () => {
    const { r } = rendu(null);
    expect([r.enDetail(0), r.enDetail(1)]).toEqual([true, false]);
  });

  it('planche active plus loin et d’une autre forme : c’est elle qui est en détail', () => {
    const { r } = rendu('p1');
    expect(r.enDetail(1), 'la planche visée par « Suivant »').toBe(true);
    expect(r.enDetail(0), 'la voisine d’une autre forme, plus proche, reste une masse').toBe(false);
  });

  it('le bilan dit si la planche active est en détail', () => {
    const { r, scene, plants } = rendu('p1');
    const filtree = appliquerFiltres(scene, FILTRES_TOUT);
    expect(r.poser(scene, filtree, plants).activeEnDetail).toBe(true);
    r.fixerPlancheActive(null);
    expect(r.poser(scene, filtree, plants).activeEnDetail).toBeNull();
  });

  it('sur ordinateur, les deux planches sont en détail, active ou non', () => {
    const { scene, plants } = banc();
    const r = new RenduPlants();
    r.fixerAppelsHorsPlants(APPELS_DESSIN_MAX_ETROIT - 2);
    r.fixerPlancheActive('p1');
    r.choisirDetail(scene, plants, 0, 5, 0, HAUTEUR, 1280);
    expect([r.enDetail(0), r.enDetail(1)]).toEqual([true, true]);
  });
});
