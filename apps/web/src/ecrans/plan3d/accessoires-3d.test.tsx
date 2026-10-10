// @vitest-environment happy-dom
/**
 * Tests d'acceptation T37b — poteaux, tuteurs, fruits et balises : UN SEUL maillage instancié.
 * Deux niveaux :
 *   - le composant <Plants> (Plants.tsx), rendu par fiber sans WebGL (moteur factice) : le nombre
 *     d'InstancedMesh de la scène est « formes présentes + 1 » ;
 *   - RenduPlants (plants-rendu.ts) : un seul maillage lié aux poteaux, tuteurs, fruits et balises
 *     reçoit tout, sans recouvrement de rangs.
 * Contrat : ./test/contrat-telephone.ts (section 1).
 *
 * Banc : un kiwi en été (pergola : poteaux), des tomates en pleine récolte (tuteurs, fruits,
 * balise) et un fraisier hors-sol (pieds de gouttière) sur trois planches proches de la caméra.
 */
import { act } from 'react';
import { createRoot, extend, type ReconcilerRoot, type RootState } from '@react-three/fiber';
import { InstancedMesh, Matrix4, MeshBasicMaterial, MeshLambertMaterial, type Object3D } from 'three';
import type { DateCalendaire } from '@planif/core';
import { profilParDefaut, type DatesCroissance } from '@planif/core/croissance';
import { afterEach, describe, expect, it } from 'vitest';
import { Plants } from './Plants.tsx';
import { FORMES, instancesParForme, piedsDeGouttiere, plantsDePlanche, type CultureDePlanche, type PlantsPlanche } from './plants.ts';
import { RenduPlants, type BilanPlants } from './plants-rendu.ts';
import { appliquerFiltres, FILTRES_TOUT, type Scene, type VolumeScene } from './scene.ts';

const d = (s: string): DateCalendaire => s as DateCalendaire;
const JOUR = d('2027-08-02');
const HAUTEUR_ECRAN = 800;
const DATES_TOMATE: DatesCroissance = {
  miseEnPlace: { prevue: d('2027-05-01'), reelle: null },
  debutRecolte: { prevue: d('2027-07-01'), reelle: null },
  finRecolte: { prevue: d('2027-09-15'), reelle: null },
  arrachage: { prevue: d('2027-10-15'), reelle: null },
};
const perenne = (espece: string, ecartementM: number): CultureDePlanche => ({
  espece,
  profil: profilParDefaut(espece).profil,
  croissance: { sorte: 'perenne', entree: { plantation: { datePlantation: d('2020-03-01'), dateArrachage: null }, campagne: { annee: 2027, debutRecolte: d('2027-07-15'), finRecolte: d('2027-09-30') } } },
  ecartementM,
});
const tomate: CultureDePlanche = { espece: 'Tomate', profil: profilParDefaut('Tomate').profil, croissance: { sorte: 'annuelle', dates: DATES_TOMATE }, ecartementM: 0.5 };

const volume = (i: number, espece: string): VolumeScene => ({
  id: `p${String(i)}`,
  code: `P${String(i)}`,
  zoneId: 'z',
  x: 3 * i,
  z: 0,
  longueur: 9,
  largeur: 1,
  hauteur: 0.3,
  angle: 0,
  placee: true,
  couleur: '#2E7D32',
  cleFamille: null,
  culture: espece,
  occupationId: `o${String(i)}`,
});

function banc(): { scene: Scene; plants: (PlantsPlanche | null)[] } {
  const volumes = [volume(0, 'Kiwi'), volume(1, 'Tomate'), volume(2, 'Fraisier')];
  const cultures: [CultureDePlanche, boolean][] = [
    [perenne('Kiwi', 3), false],
    [tomate, false],
    [perenne('Fraisier', 0.3), true],
  ];
  const plants = volumes.map((v, i) => plantsDePlanche({ volume: v, culture: cultures[i]?.[0] ?? null, jour: JOUR, horsSol: cultures[i]?.[1] ?? false }));
  return { scene: { semaine: 0, libelleSemaine: 'S01', socles: [], volumes, batiments: [] }, plants };
}

/** Poteaux attendus : un par plant de kiwi (pergola), les pieds de la gouttière du fraisier. */
function poteauxAttendus(scene: Scene, plants: readonly (PlantsPlanche | null)[]): number {
  return plants.reduce((n, p, i) => n + (p === null ? 0 : (p.structureM > 0 ? p.nombre : 0) + (p.surelevationM > 0 ? piedsDeGouttiere(scene.volumes[i]?.longueur ?? 0) : 0)), 0);
}

describe('T37b : le banc a bien de quoi remplir les quatre usages', () => {
  const { scene, plants } = banc();
  it('kiwi à pergola, tomates tuteurées à fruits, fraisier sur gouttière', () => {
    expect(plants[0]?.structureM ?? 0).toBeGreaterThan(0);
    expect(plants[1]?.forme).toBe('erige-tuteure');
    expect(plants[1]?.fruitsParPlant ?? 0).toBeGreaterThan(0);
    expect(plants[2]?.surelevationM ?? 0).toBeGreaterThan(0);
    expect(poteauxAttendus(scene, plants)).toBeGreaterThan(0);
  });
});

// ── Niveau 1 : <Plants> dans fiber ───────────────────────────────────────────────────────────

extend({ InstancedMesh, MeshLambertMaterial });

let racine: ReconcilerRoot<HTMLCanvasElement> | null = null;
afterEach(() => {
  if (racine !== null) {
    const r = racine;
    act(() => {
      r.unmount();
    });
  }
  racine = null;
});

/** Un moteur de rendu factice : fiber monte la scène, rien n'est dessiné. */
function moteurFactice(toile: HTMLCanvasElement): unknown {
  return {
    domElement: toile,
    setPixelRatio: () => undefined,
    setSize: () => undefined,
    render: () => undefined,
    dispose: () => undefined,
    setClearColor: () => undefined,
    getPixelRatio: () => 1,
    shadowMap: {},
    xr: { enabled: false, addEventListener: () => undefined, removeEventListener: () => undefined, setAnimationLoop: () => undefined },
    info: { autoReset: true, reset: () => undefined },
    outputColorSpace: '',
    toneMapping: 0,
  };
}

async function monterPlants(scene: Scene, plants: readonly (PlantsPlanche | null)[]): Promise<{ meshes: InstancedMesh[]; bilan: BilanPlants | null; rendu: RenduPlants }> {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const toile = document.createElement('canvas');
  const r = createRoot(toile);
  racine = r;
  await r.configure({ gl: (() => moteurFactice(toile)) as never, frameloop: 'never', size: { width: 400, height: HAUTEUR_ECRAN, top: 0, left: 0 }, dpr: 1, camera: { position: [0, 8, 6] } } as never);
  const rendu = new RenduPlants();
  const filtree = appliquerFiltres(scene, FILTRES_TOUT);
  let bilan: BilanPlants | null = null;
  await act(async () => {
    r.render(
      <Plants
        scene={scene}
        filtree={filtree}
        plants={plants}
        rendu={rendu}
        surBilan={(b) => {
          bilan = b;
        }}
      />,
    );
    await Promise.resolve();
  });
  const etat = (await import('@react-three/fiber')) as unknown as { _roots: Map<HTMLCanvasElement, { store: { getState(): RootState } }> };
  const racineFiber = etat._roots.get(toile);
  if (racineFiber === undefined) throw new Error('racine fiber introuvable');
  const meshes: InstancedMesh[] = [];
  racineFiber.store.getState().scene.traverse((o: Object3D) => {
    if (o instanceof InstancedMesh) meshes.push(o as InstancedMesh);
  });
  return { meshes, bilan, rendu };
}

describe('T37b : <Plants> dessine un seul maillage d’accessoires', () => {
  it('maillages de la scène = une par forme présente + UN pour poteaux, tuteurs, fruits et balises', async () => {
    const { scene, plants } = banc();
    const { meshes, bilan } = await monterPlants(scene, plants);
    expect(bilan, 'le bilan de pose est rendu').not.toBeNull();
    const formes = instancesParForme(plants).length;
    expect(formes).toBe(3);
    expect(meshes.length, `maillages instanciés (formes ${String(formes)} + 1 d’accessoires)`).toBe(formes + 1);
  });

  it('le maillage d’accessoires porte tout : count = tuteurs + poteaux + fruits + balises, rangs distincts', async () => {
    const { scene, plants } = banc();
    const { meshes, bilan } = await monterPlants(scene, plants);
    if (bilan === null) throw new Error('pas de bilan');
    const attendu = bilan.tuteurs + poteauxAttendus(scene, plants) + bilan.fruits + bilan.balises;
    expect(bilan.tuteurs, 'tomates tuteurées').toBeGreaterThan(0);
    expect(bilan.fruits, 'fruits en récolte').toBeGreaterThan(0);
    expect(bilan.balises, 'balise « à récolter »').toBeGreaterThan(0);
    const accessoires = meshes.filter((m) => m.count === attendu);
    expect(accessoires.length, `un maillage a exactement ${String(attendu)} instances (tuteurs ${String(bilan.tuteurs)} + poteaux ${String(poteauxAttendus(scene, plants))} + fruits ${String(bilan.fruits)} + balises ${String(bilan.balises)}) ; comptes : ${meshes.map((m) => String(m.count)).join(', ')}`).toBe(1);
  });

  it('sans poteaux (ni kiwi ni gouttière), toujours un seul maillage d’accessoires', async () => {
    const { scene, plants } = banc();
    const sansPoteaux = { scene: { ...scene, volumes: scene.volumes.slice(1, 2) }, plants: [plants[1] ?? null] };
    const { meshes } = await monterPlants(sansPoteaux.scene, sansPoteaux.plants);
    expect(meshes.length).toBe(instancesParForme(sansPoteaux.plants).length + 1);
  });
});

// ── Niveau 2 : RenduPlants avec un maillage partagé ──────────────────────────────────────────

describe('T37b : RenduPlants, un seul maillage lié aux quatre usages', () => {
  function poser() {
    const { scene, plants } = banc();
    const rendu = new RenduPlants();
    for (const forme of FORMES) rendu.lierMaillage(forme, new InstancedMesh(rendu.geometrie(forme), new MeshBasicMaterial(), 2048));
    const unique = new InstancedMesh(rendu.geometrieFruit(), new MeshBasicMaterial(), 4096);
    rendu.lierPoteaux(unique);
    rendu.lierTuteurs(unique);
    rendu.lierFruits(unique);
    rendu.lierBalises(unique);
    rendu.choisirDetail(scene, plants, 3, 8, 6, HAUTEUR_ECRAN);
    const bilan = rendu.poser(scene, appliquerFiltres(scene, FILTRES_TOUT), plants);
    return { scene, plants, rendu, unique, bilan };
  }

  it('poteaux, tuteurs, fruits et balises dans le même maillage : tous les rangs sont posés, sans recouvrement', () => {
    const { scene, plants, unique, bilan } = poser();
    expect(unique.count).toBe(bilan.tuteurs + poteauxAttendus(scene, plants) + bilan.fruits + bilan.balises);
    // Aucune instance n’écrase une autre : deux instances n’ont jamais exactement la même matrice.
    const vues = new Set<string>();
    const m = new Matrix4();
    for (let i = 0; i < unique.count; i += 1) {
      unique.getMatrixAt(i, m);
      const cle = m.elements.map((v) => v.toFixed(5)).join(',');
      expect(vues.has(cle), `instance ${String(i)} recouvre une autre`).toBe(false);
      vues.add(cle);
    }
  });
});
