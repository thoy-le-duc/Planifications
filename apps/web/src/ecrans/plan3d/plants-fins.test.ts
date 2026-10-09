/**
 * Tests d'acceptation T32d — jeunes plants visibles, plants découpés (planche fine, un tuteur par
 * plant de tomate). Écrits AVANT le code : ils échouent tant que l'API ci-dessous n'existe pas.
 * Les contrats de T32b (plants.test.ts, plants-rendu.test.ts, filtres.test.ts) restent intacts.
 *
 * ── API fixée ────────────────────────────────────────────────────────────────────────────────
 * ./plants-rendu.ts
 *   EPAISSEUR_DALLE_PLANTS_M: number          épaisseur de la dalle d'une planche qui porte des plants
 *                                              (m de scène), dans ]0 ; 0,05]
 *   hauteurDalle(base: number, p: PlantsPlanche | null): number
 *                                              hauteur rendue de la dalle EN DÉTAIL. `base` = hauteurRendue(volume)
 *                                              de scene.ts. p === null (planche vide, ou sans plant) : `base`
 *                                              inchangé ; sinon min(base, EPAISSEUR_DALLE_PLANTS_M).
 *                                              Vue3d.tsx l'emploie pour les dalles en détail ; de loin, la
 *                                              masse reste hauteurDeMasse (inchangée).
 *   RenduPlants.lierTuteurs(m: InstancedMesh | null): void     un InstancedMesh partagé de tuteurs
 *   RenduPlants.geometrieTuteur(): BufferGeometry              géométrie partagée (cf. geometries-plants.ts)
 *   BilanPlants.tuteurs: number               nombre de tuteurs posés (data-plants reste le nombre de plants)
 *   RenduPlants.poser :
 *     - les plants d'une planche en détail sont posés SUR la dalle fine : y de l'instance =
 *       hauteurDalle(base, p) + p.surelevationM (plus de plant enfoui dans un bloc de 30 cm) ;
 *     - forme `erige-tuteure` : un tuteur par plant, à sa position, de la dalle jusqu'au plafond du
 *       plant (échelle verticale ≥ echelleVerticale), et le plant n'est PLUS étiré en haie : son
 *       échelle le long du rang ≤ l'écartement. Autres formes : aucun tuteur, étirement libre.
 *     - mêmes plafonds : plants ≤ PLANTS_MAX_TOTAL, tuteurs ≤ PLANTS_MAX_TOTAL (et = plants tuteurés).
 *     - data-hauteurs-plants : inchangé, hauteur du feuillage du jour au centimètre, pas la dalle.
 * ./geometries-plants.ts
 *   geometrieTuteur(): BufferGeometry          1 m de haut, y dans [0 ; 1], fin (|x|,|z| ≤ 0,5), ≤ 24 triangles,
 *                                              attribut `color` comme les autres géométries.
 *
 * T32b : aucun test existant ne contredit le ticket. Seule contrainte à respecter : filtres.test.ts
 * exige hauteurRendue(volume) de scene.ts = volume.hauteur pour une culture (et plus bas pour un
 * vide) ; l'épaisseur fine passe donc par hauteurDalle, pas par scene.ts.
 */
import { InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, Vector3, type BufferGeometry } from 'three';
import { ajouterJours, type DateCalendaire } from '@planif/core';
import { profilParDefaut } from '@planif/core/croissance';
import { beforeAll, describe, expect, it } from 'vitest';
import { hauteurRendue, appliquerFiltres, FILTRES_TOUT, type Scene, type VolumeScene } from './scene.ts';
import { plantsDePlanche, PLANTS_MAX_TOTAL, type PlantsPlanche } from './plants.ts';
import type { RenduPlants, BilanPlants } from './plants-rendu.ts';

interface RenduT32d extends RenduPlants {
  lierTuteurs(m: InstancedMesh | null): void;
  geometrieTuteur(): BufferGeometry;
  poser(scene: Scene, filtree: ReturnType<typeof appliquerFiltres>, plants: readonly (PlantsPlanche | null)[]): BilanPlants & { readonly tuteurs: number };
}
interface ModuleRendu {
  readonly EPAISSEUR_DALLE_PLANTS_M: number;
  hauteurDalle(base: number, p: PlantsPlanche | null): number;
  hauteurDeMasse(base: number, p: PlantsPlanche | null): number;
  readonly RenduPlants: new () => RenduT32d;
}
interface ModuleGeometries {
  geometrieTuteur(): BufferGeometry;
  trianglesDe(g: BufferGeometry): number;
}
const CHEMIN_RENDU = './plants-rendu.ts';
const CHEMIN_GEOMETRIES = './geometries-plants.ts';
let r: ModuleRendu;
let g: ModuleGeometries;
beforeAll(async () => {
  r = (await import(/* @vite-ignore */ CHEMIN_RENDU)) as ModuleRendu;
  g = (await import(/* @vite-ignore */ CHEMIN_GEOMETRIES)) as ModuleGeometries;
});

const d = (s: string): DateCalendaire => s as DateCalendaire;
const HAUTEUR_ECRAN = 800;
const MISE_EN_PLACE = d('2027-05-01');
const DATES = {
  miseEnPlace: { prevue: MISE_EN_PLACE, reelle: null },
  debutRecolte: { prevue: d('2027-07-01'), reelle: null },
  finRecolte: { prevue: d('2027-09-15'), reelle: null },
  arrachage: { prevue: d('2027-10-15'), reelle: null },
};

function volume(i: number): VolumeScene {
  return { id: `p${String(i)}`, code: `P${String(i)}`, zoneId: 'z', x: 3 * i, z: 0, longueur: 12, largeur: 1, hauteur: 0.3, angle: 0, placee: true, couleur: '#C0392B', cleFamille: 'solanacees', culture: 'Tomate', occupationId: `o${String(i)}` };
}
/** `n` planches de 12 m × 1 m (20 plants de tomate chacune à 50 cm), au jour donné, ou de laitue (rosette). */
function ferme(n: number, jour: string, espece: 'Tomate' | 'Laitue' = 'Tomate'): { scene: Scene; plants: (PlantsPlanche | null)[] } {
  const volumes = Array.from({ length: n }, (_, i) => volume(i));
  const culture = { espece, profil: profilParDefaut(espece).profil, croissance: { sorte: 'annuelle' as const, dates: DATES }, ecartementM: espece === 'Tomate' ? 0.5 : 0.3 };
  const plants = volumes.map((v) => plantsDePlanche({ volume: v, culture, jour: d(jour), horsSol: false }));
  return { scene: { semaine: 0, libelleSemaine: 'S01', socles: [], volumes, batiments: [] }, plants };
}
function mailles(rendu: RenduT32d, forme: Parameters<RenduT32d['geometrie']>[0], capacite: number): InstancedMesh {
  const m = new InstancedMesh(rendu.geometrie(forme), new MeshBasicMaterial(), capacite);
  rendu.lierMaillage(forme, m);
  return m;
}
function tuteurs(rendu: RenduT32d, capacite: number): InstancedMesh {
  const m = new InstancedMesh(rendu.geometrieTuteur(), new MeshBasicMaterial(), capacite);
  rendu.lierTuteurs(m);
  return m;
}
interface Pose { readonly x: number; readonly y: number; readonly z: number; readonly ex: number; readonly ey: number; readonly ez: number }
function poses(m: InstancedMesh): Pose[] {
  const mat = new Matrix4();
  const p = new Vector3();
  const s = new Vector3();
  const q = new Quaternion();
  return Array.from({ length: m.count }, (_, i) => {
    m.getMatrixAt(i, mat);
    mat.decompose(p, q, s);
    return { x: p.x, y: p.y, z: p.z, ex: s.x, ey: s.y, ez: s.z };
  });
}
const PROCHE = { x: 3, y: 3, z: 5 };

describe('T32d : planche fine quand elle porte des plants', () => {
  it('l’épaisseur de la dalle est de quelques centimètres : dans ]0 ; 5 cm]', () => {
    expect(r.EPAISSEUR_DALLE_PLANTS_M).toBeGreaterThan(0);
    expect(r.EPAISSEUR_DALLE_PLANTS_M).toBeLessThanOrEqual(0.05);
  });

  it('une planche portant des plants : épaisseur rendue ≤ 5 cm, quelle que soit la hauteur de base', () => {
    const { scene, plants } = ferme(1, '2027-08-01');
    const v = scene.volumes[0];
    const p = plants[0] ?? null;
    expect(p).not.toBeNull();
    if (v === undefined) return;
    const e = r.hauteurDalle(hauteurRendue(v), p);
    expect(e).toBeGreaterThan(0);
    expect(e).toBeLessThanOrEqual(0.05);
    expect(r.hauteurDalle(0.01, p)).toBeLessThanOrEqual(0.01);
  });

  it('planche vide (ou sans plant) : volume actuel, inchangé', () => {
    expect(r.hauteurDalle(0.05, null)).toBe(0.05);
    expect(r.hauteurDalle(0.3, null)).toBe(0.3);
    const vide: VolumeScene = { ...volume(0), culture: null, occupationId: null, cleFamille: null };
    expect(r.hauteurDalle(hauteurRendue(vide), null)).toBe(hauteurRendue(vide));
  });

  it('vue d’ensemble : la masse garde la hauteur du feuillage (T32b inchangé)', () => {
    const { plants } = ferme(1, '2027-08-01');
    const p = plants[0] ?? null;
    if (p === null) throw new Error('plants attendus');
    expect(r.hauteurDeMasse(0.3, p)).toBeCloseTo(0.3 + p.surelevationM + Math.max(p.echelleVerticale, p.structureM), 9);
    expect(r.hauteurDeMasse(0.3, null)).toBe(0.3);
  });

  it('en détail, les plants sont posés sur la dalle fine, pas dans un bloc de 30 cm', () => {
    const { scene, plants } = ferme(1, '2027-08-01');
    const rendu = new r.RenduPlants();
    const m = mailles(rendu, 'erige-tuteure', 64);
    rendu.choisirDetail(scene, plants, PROCHE.x, PROCHE.y, PROCHE.z, HAUTEUR_ECRAN);
    rendu.poser(scene, appliquerFiltres(scene, FILTRES_TOUT), plants);
    const p = plants[0];
    const attendu = r.hauteurDalle(0.3, p ?? null) + (p?.surelevationM ?? 0);
    expect(m.count).toBeGreaterThan(0);
    for (const pose of poses(m)) {
      expect(pose.y).toBeCloseTo(attendu, 9);
      expect(pose.y).toBeLessThanOrEqual(0.05 + 1e-9);
    }
  });
});

describe('T32d : un plant de 5 cm se voit', () => {
  /** Un jour où la tomate vient d’être plantée : feuillage plus bas que 5 cm. */
  function jeuneTomate(): { scene: Scene; plants: (PlantsPlanche | null)[]; p: PlantsPlanche } {
    for (let k = 0; k < 14; k += 1) {
      const f = ferme(1, ajouterJours(MISE_EN_PLACE, k));
      const p = f.plants[0] ?? null;
      if (p !== null && p.hauteurM < 0.05) return { ...f, p };
    }
    throw new Error('aucun jour de levée avec un plant sous 5 cm : le profil de tomate a changé ?');
  }

  it('hauteur rendue ≥ 5 cm au-dessus de la dalle, plant posé sur la dalle (non enfoui)', () => {
    const { scene, plants, p } = jeuneTomate();
    const rendu = new r.RenduPlants();
    const m = mailles(rendu, 'erige-tuteure', 64);
    rendu.choisirDetail(scene, plants, PROCHE.x, PROCHE.y, PROCHE.z, HAUTEUR_ECRAN);
    const bilan = rendu.poser(scene, appliquerFiltres(scene, FILTRES_TOUT), plants);
    const dalle = r.hauteurDalle(0.3, p) + p.surelevationM;
    expect(bilan.plants).toBe(p.nombre);
    expect(m.count).toBe(p.nombre);
    for (const pose of poses(m)) {
      expect(pose.y).toBeGreaterThanOrEqual(dalle - 1e-9);
      expect(pose.y + pose.ey - dalle).toBeGreaterThanOrEqual(0.05 - 1e-9);
    }
  });

  it('data-hauteurs-plants garde son sens : la hauteur du feuillage du jour, pas celle rendue', () => {
    const { scene, plants, p } = jeuneTomate();
    const rendu = new r.RenduPlants();
    mailles(rendu, 'erige-tuteure', 64);
    rendu.choisirDetail(scene, plants, PROCHE.x, PROCHE.y, PROCHE.z, HAUTEUR_ECRAN);
    const bilan = rendu.poser(scene, appliquerFiltres(scene, FILTRES_TOUT), plants);
    const h = JSON.parse(bilan.hauteurs) as Record<string, number>;
    expect(h[p.id]).toBe(Math.round(p.hauteurM * 100) / 100);
    expect(h[p.id]).toBeLessThan(0.05);
  });
});

describe('T32d : tomate découpée plant par plant, avec son tuteur', () => {
  it('20 plants → 20 instances de plant et 20 tuteurs, pas une haie continue', () => {
    const { scene, plants } = ferme(1, '2027-08-01');
    expect(plants[0]?.nombre).toBe(20);
    const rendu = new r.RenduPlants();
    const mp = mailles(rendu, 'erige-tuteure', 64);
    const mt = tuteurs(rendu, 64);
    rendu.choisirDetail(scene, plants, PROCHE.x, PROCHE.y, PROCHE.z, HAUTEUR_ECRAN);
    const bilan = rendu.poser(scene, appliquerFiltres(scene, FILTRES_TOUT), plants);
    expect(bilan.plants).toBe(20);
    expect(bilan.tuteurs).toBe(20);
    expect(mp.count).toBe(20);
    expect(mt.count).toBe(20);
    const p = plants[0];
    for (const pose of poses(mp)) expect(pose.ex, 'plant séparé du voisin, pas étiré en mur').toBeLessThanOrEqual(0.5 + 1e-9);
    const plantsPoses = poses(mp);
    const tuteursPoses = poses(mt);
    const cle = (q: Pose): string => `${q.x.toFixed(6)}|${q.z.toFixed(6)}`;
    expect(tuteursPoses.map(cle).sort()).toEqual(plantsPoses.map(cle).sort());
    for (const t of tuteursPoses) {
      expect(t.ey).toBeGreaterThanOrEqual((p?.echelleVerticale ?? 0) - 1e-9);
      expect(t.ey).toBeLessThanOrEqual((p?.echelleVerticale ?? 0) + 0.5);
      expect(t.ex).toBeLessThanOrEqual(0.25);
    }
  });

  it('les plafonds tiennent : jamais plus de PLANTS_MAX_TOTAL plants ni tuteurs', () => {
    const n = Math.ceil(PLANTS_MAX_TOTAL / 20) * 3;
    const { scene, plants } = ferme(n, '2027-08-01');
    const rendu = new r.RenduPlants();
    mailles(rendu, 'erige-tuteure', 2048);
    const mt = tuteurs(rendu, 2048);
    rendu.choisirDetail(scene, plants, 0, 6, 0, HAUTEUR_ECRAN);
    const bilan = rendu.poser(scene, appliquerFiltres(scene, FILTRES_TOUT), plants);
    expect(bilan.plants).toBeGreaterThan(0);
    expect(bilan.plants).toBeLessThanOrEqual(PLANTS_MAX_TOTAL);
    expect(bilan.tuteurs).toBe(bilan.plants);
    expect(mt.count).toBe(bilan.tuteurs);
  });

  it('de loin : plus de plants ni de tuteurs (la masse remplace)', () => {
    const { scene, plants } = ferme(2, '2027-08-01');
    const rendu = new r.RenduPlants();
    mailles(rendu, 'erige-tuteure', 64);
    const mt = tuteurs(rendu, 64);
    rendu.choisirDetail(scene, plants, 3, 5_000, 5, HAUTEUR_ECRAN);
    const bilan = rendu.poser(scene, appliquerFiltres(scene, FILTRES_TOUT), plants);
    expect(bilan.plants).toBe(0);
    expect(bilan.tuteurs).toBe(0);
    expect(mt.count).toBe(0);
  });

  it('une autre forme (laitue, rosette) : aucun tuteur', () => {
    const { scene, plants } = ferme(1, '2027-06-20', 'Laitue');
    expect(plants[0]?.forme).toBe('rosette');
    const rendu = new r.RenduPlants();
    const mp = mailles(rendu, 'rosette', 64);
    const mt = tuteurs(rendu, 64);
    rendu.choisirDetail(scene, plants, PROCHE.x, PROCHE.y, PROCHE.z, HAUTEUR_ECRAN);
    const bilan = rendu.poser(scene, appliquerFiltres(scene, FILTRES_TOUT), plants);
    expect(bilan.plants).toBe(mp.count);
    expect(bilan.plants).toBeGreaterThan(0);
    expect(bilan.tuteurs).toBe(0);
    expect(mt.count).toBe(0);
  });
});

describe('T32d : géométrie du tuteur', () => {
  it('1 m de haut, fine, légère, colorée comme les autres géométries', () => {
    const t = g.geometrieTuteur();
    expect(g.trianglesDe(t)).toBeGreaterThan(0);
    expect(g.trianglesDe(t)).toBeLessThanOrEqual(24);
    const p = t.getAttribute('position');
    let haut = 0;
    for (let i = 0; i < p.count; i += 1) {
      expect(p.getY(i)).toBeGreaterThanOrEqual(-1e-9);
      expect(p.getY(i)).toBeLessThanOrEqual(1 + 1e-6);
      expect(Math.abs(p.getX(i))).toBeLessThanOrEqual(0.5 + 1e-6);
      expect(Math.abs(p.getZ(i))).toBeLessThanOrEqual(0.5 + 1e-6);
      haut = Math.max(haut, p.getY(i));
    }
    expect(haut).toBeCloseTo(1, 6);
    expect(t.getAttribute('color').count).toBe(p.count);
  });
});
