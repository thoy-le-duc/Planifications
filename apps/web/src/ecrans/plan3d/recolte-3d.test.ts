/**
 * Tests d'acceptation T32e — la récolte se voit dans la vue 3D : adaptateur (plants.ts, recolte.ts)
 * et rendu des instances (plants-rendu.ts), sans navigateur ni WebGL (three seul, comme
 * plants-rendu.test.ts). Écrits AVANT le code : ils échouent tant que l'API de ./test/contrat-recolte.ts
 * n'existe pas. Les garde-fous de dessin (BORNES_DEMO) et l'affichage de bout en bout sont dans
 * e2e/vue-3d-recolte.e2e.ts.
 */
import { Color, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, Vector3 } from 'three';
import { ajouterJours, type DateCalendaire } from '@planif/core';
import { profilParDefaut, type DatesCroissance } from '@planif/core/croissance';
import { beforeAll, describe, expect, it } from 'vitest';
import { COULEUR_FEUILLAGE_3D } from '../../ui/jetons.ts';
import { appliquerFiltres, COULEUR_ESTOMPEE, FILTRES_TOUT, hauteurRendue, type FiltresScene, type Scene, type VolumeScene } from './scene.ts';
import { PLANTS_MAX_TOTAL, type CultureDePlanche, type EntreePlants, type PlantsPlanche } from './plants.ts';
import type { BilanPlants, RenduPlants } from './plants-rendu.ts';
import { TAILLE_BALISE_MIN_M, TAILLE_FRUIT_MAX_M, type PhaseRecolte3d, type TypeFruit } from './test/contrat-recolte.ts';

// ── Modules chargés par import dynamique (chemin tenu dans une variable) ─────────────────────
interface Recolte {
  readonly phase: PhaseRecolte3d;
  readonly maturite: number;
}
type PlantsT32e = PlantsPlanche & { readonly recolte: Recolte; readonly typeFruit: TypeFruit; readonly fruitsParPlant: number; readonly tailleFruitM: number; readonly jaunissement: number };
interface ModulePlants {
  readonly FRUITS_MAX_PAR_PLANT: number;
  readonly FRUITS_MAX_TOTAL: number;
  plantsDePlanche(entree: EntreePlants): PlantsT32e | null;
}
interface ModuleRecolteWeb {
  typeDeFruit(espece: string): TypeFruit;
  planchesARecolter(plants: readonly (PlantsPlanche | null)[], filtree: ReturnType<typeof appliquerFiltres>): readonly string[];
  phrasePlanchesARecolter(n: number): string;
}
interface RenduT32e extends RenduPlants {
  lierFruits(m: InstancedMesh | null): void;
  lierBalises(m: InstancedMesh | null): void;
  geometrieFruit(): InstancedMesh['geometry'];
  geometrieBalise(): InstancedMesh['geometry'];
  poser(scene: Scene, filtree: ReturnType<typeof appliquerFiltres>, plants: readonly (PlantsPlanche | null)[]): BilanPlants & { readonly fruits: number; readonly balises: number };
}
interface ModuleRendu {
  hauteurDeMasse(base: number, p: PlantsPlanche | null): number;
  hauteurDalle(base: number, p: PlantsPlanche | null): number;
  readonly RenduPlants: new () => RenduT32e;
}
interface ModuleCoeur {
  recolteA(dates: DatesCroissance, jour: DateCalendaire): Recolte;
}
const CHEMIN_PLANTS = './plants.ts';
const CHEMIN_RECOLTE = './recolte.ts';
const CHEMIN_RENDU = './plants-rendu.ts';
const CHEMIN_COEUR = '@planif/core/croissance';
let pl: ModulePlants;
let rc: ModuleRecolteWeb;
let r: ModuleRendu;
let coeur: ModuleCoeur;
beforeAll(async () => {
  pl = (await import(/* @vite-ignore */ CHEMIN_PLANTS)) as ModulePlants;
  rc = (await import(/* @vite-ignore */ CHEMIN_RECOLTE)) as ModuleRecolteWeb;
  r = (await import(/* @vite-ignore */ CHEMIN_RENDU)) as ModuleRendu;
  coeur = (await import(/* @vite-ignore */ CHEMIN_COEUR)) as ModuleCoeur;
});

// ── Données ──────────────────────────────────────────────────────────────────────────────────
const d = (s: string): DateCalendaire => s as DateCalendaire;
const HAUTEUR_ECRAN = 800;
const PROCHE = { x: 3, y: 3, z: 5 };
const LOIN = { x: 3, y: 5_000, z: 5 };
const B = d('2027-07-01');
const F = d('2027-09-15');
const A = d('2027-10-15');
const dates = (decalage = 0): DatesCroissance => ({
  miseEnPlace: { prevue: ajouterJours(d('2027-04-01'), decalage), reelle: null },
  debutRecolte: { prevue: ajouterJours(B, decalage), reelle: null },
  finRecolte: { prevue: ajouterJours(F, decalage), reelle: null },
  arrachage: { prevue: ajouterJours(A, decalage), reelle: null },
});
const avant = (jour: DateCalendaire, n: number): DateCalendaire => ajouterJours(jour, -n);

type Espece = 'Courgette' | 'Tomate' | 'Laitue';
const CLE_FAMILLE: Record<Espece, VolumeScene['cleFamille']> = { Courgette: 'cucurbitacees', Tomate: 'solanacees', Laitue: 'salades' };
const ECARTEMENT: Record<Espece, number> = { Courgette: 0.6, Tomate: 0.5, Laitue: 0.3 };

function culture(espece: Espece, decalage = 0): CultureDePlanche {
  return { espece, profil: profilParDefaut(espece).profil, croissance: { sorte: 'annuelle', dates: dates(decalage) }, ecartementM: ECARTEMENT[espece] };
}
function fraise(campagne: { debut: string | null; fin: string | null } | null): CultureDePlanche {
  return {
    espece: 'Fraisier',
    profil: profilParDefaut('Fraisier').profil,
    croissance: {
      sorte: 'perenne',
      entree: { plantation: { datePlantation: d('2024-03-01'), dateArrachage: null }, campagne: campagne === null ? null : { annee: 2027, debutRecolte: campagne.debut === null ? null : d(campagne.debut), finRecolte: campagne.fin === null ? null : d(campagne.fin) } },
    },
    ecartementM: 0.3,
  };
}
const volume = (i: number, espece: Espece): VolumeScene => ({ id: `p${String(i)}`, code: `P${String(i)}`, zoneId: 'z', x: 3 * i, z: 0, longueur: 12, largeur: 1, hauteur: 0.3, angle: 0, placee: true, couleur: '#C0392B', cleFamille: CLE_FAMILLE[espece], culture: espece, occupationId: `o${String(i)}` });

interface Planche {
  readonly espece: Espece;
  /** Décalage (jours) de toutes les dates de la culture. */
  readonly decalage?: number;
}
function ferme(planches: readonly Planche[], jour: DateCalendaire): { scene: Scene; plants: (PlantsT32e | null)[] } {
  const volumes = planches.map((p, i) => volume(i, p.espece));
  const plants = volumes.map((v, i) => pl.plantsDePlanche({ volume: v, culture: culture(planches[i]?.espece ?? 'Tomate', planches[i]?.decalage ?? 0), jour, horsSol: false }));
  return { scene: { semaine: 0, libelleSemaine: 'S01', socles: [], volumes, batiments: [] }, plants };
}
const unePlanche = (espece: Espece, jour: DateCalendaire) => ferme([{ espece }], jour);
const fermeDe = (n: number, espece: Espece, jour: DateCalendaire) => ferme(Array.from({ length: n }, () => ({ espece })), jour);
/** Seules les cucurbitacées sont cochées : le reste est estompé (filtre T27b). */
const SEULEMENT_COURGETTES: FiltresScene = { familles: new Set(['cucurbitacees']), cultures: null, zones: null };

interface Pose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly ex: number;
  readonly ey: number;
  readonly ez: number;
}
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
const grand = (p: Pose): number => Math.max(p.ex, p.ey, p.ez);
const petit = (p: Pose): number => Math.min(p.ex, p.ey, p.ez);
const moyenne = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
function couleurs(m: InstancedMesh): string[] {
  const c = new Color();
  return Array.from({ length: m.count }, (_, i) => {
    m.getColorAt(i, c);
    return `#${c.getHexString().toUpperCase()}`;
  });
}
const hex = (s: string): string => `#${new Color(s).getHexString().toUpperCase()}`;

interface Pose3d {
  readonly rendu: RenduT32e;
  readonly fruits: InstancedMesh;
  readonly balises: InstancedMesh;
  readonly bilan: BilanPlants & { readonly fruits: number; readonly balises: number };
  readonly filtree: ReturnType<typeof appliquerFiltres>;
}
/** Pose la scène depuis la caméra `cam` (PROCHE : tout en détail ; LOIN : plus aucun détail), filtres donnés. */
function poser(scene: Scene, plants: readonly (PlantsPlanche | null)[], cam = PROCHE, filtres: FiltresScene = FILTRES_TOUT, capaciteFruits = 4096): Pose3d {
  const filtree = appliquerFiltres(scene, filtres);
  const rendu = new r.RenduPlants();
  for (const forme of ['erige-tuteure', 'rosette', 'touffe', 'rampant', 'buisson', 'arbre-ou-liane', 'bulbe-ou-racine'] as const) rendu.lierMaillage(forme, new InstancedMesh(rendu.geometrie(forme), new MeshBasicMaterial(), 2048));
  rendu.lierTuteurs(new InstancedMesh(rendu.geometrieTuteur(), new MeshBasicMaterial(), 2048));
  const fruits = new InstancedMesh(rendu.geometrieFruit(), new MeshBasicMaterial(), capaciteFruits);
  const balises = new InstancedMesh(rendu.geometrieBalise(), new MeshBasicMaterial(), 2048);
  rendu.lierFruits(fruits);
  rendu.lierBalises(balises);
  rendu.choisirDetail(scene, plants, cam.x, cam.y, cam.z, HAUTEUR_ECRAN);
  const bilan = rendu.poser(scene, filtree, plants);
  return { rendu, fruits, balises, bilan, filtree };
}

// ── Adaptateur : constantes ──────────────────────────────────────────────────────────────────
describe('T32e : constantes nommées', () => {
  it('plafond de fruits par plant : un entier de 1 à 8', () => {
    expect(Number.isInteger(pl.FRUITS_MAX_PAR_PLANT)).toBe(true);
    expect(pl.FRUITS_MAX_PAR_PLANT).toBeGreaterThanOrEqual(1);
    expect(pl.FRUITS_MAX_PAR_PLANT).toBeLessThanOrEqual(8);
  });

  it('plafond de fruits pour toute la scène : un entier entre PLANTS_MAX_TOTAL et 1000', () => {
    expect(Number.isInteger(pl.FRUITS_MAX_TOTAL)).toBe(true);
    expect(pl.FRUITS_MAX_TOTAL).toBeGreaterThanOrEqual(PLANTS_MAX_TOTAL);
    expect(pl.FRUITS_MAX_TOTAL).toBeLessThanOrEqual(1000);
  });
});

// ── Adaptateur : type de fruit, phrase, planches à récolter ──────────────────────────────────
describe('T32e : type de fruit par espèce', () => {
  it('courgette allongée ; tomate et fraise rondes ; le reste générique', () => {
    expect(rc.typeDeFruit('Courgette')).toBe('allonge');
    expect(rc.typeDeFruit('Tomate')).toBe('rond');
    expect(rc.typeDeFruit('Fraise')).toBe('rond');
    expect(rc.typeDeFruit('Fraisier')).toBe('rond');
    expect(rc.typeDeFruit('Aubergine')).toBe('generique');
    expect(rc.typeDeFruit('Espèce inconnue')).toBe('generique');
  });

  it('casse et accents ignorés', () => {
    expect(rc.typeDeFruit('courgette')).toBe('allonge');
    expect(rc.typeDeFruit('  TOMATE ')).toBe('rond');
  });
});

describe('T32e : « N planches à récolter »', () => {
  it('accord : aucune, une, plusieurs', () => {
    expect(rc.phrasePlanchesARecolter(0)).toBe('Aucune planche à récolter');
    expect(rc.phrasePlanchesARecolter(1)).toBe('1 planche à récolter');
    expect(rc.phrasePlanchesARecolter(2)).toBe('2 planches à récolter');
    expect(rc.phrasePlanchesARecolter(3)).toBe('3 planches à récolter');
    expect(rc.phrasePlanchesARecolter(12)).toBe('12 planches à récolter');
  });

  it('planchesARecolter : « à récolter » et, depuis T32f (Q38), « fin de récolte », dans l’ordre de la scène, sans les null', () => {
    // Même jour : la courgette est à récolter, la tomate décalée de 90 jours n'est pas encore plantée, la laitue décalée de −90 est en fin.
    const jour = ajouterJours(B, 10);
    const { scene, plants } = ferme([{ espece: 'Courgette' }, { espece: 'Tomate', decalage: 120 }, { espece: 'Tomate' }, { espece: 'Laitue', decalage: -90 }], jour);
    expect(plants.map((p) => p?.recolte.phase)).toEqual(['a-recolter', undefined, 'a-recolter', 'fin-de-recolte']);
    const filtree = appliquerFiltres(scene, FILTRES_TOUT);
    expect(rc.planchesARecolter(plants, filtree)).toEqual(['p0', 'p2', 'p3']);
    expect(rc.planchesARecolter([null, null, null, null], filtree)).toEqual([]);
  });

  it('une planche estompée par un filtre T27b n’est pas comptée', () => {
    const jour = ajouterJours(B, 10);
    const { scene, plants } = ferme([{ espece: 'Courgette' }, { espece: 'Tomate' }], jour);
    const filtree = appliquerFiltres(scene, SEULEMENT_COURGETTES);
    expect(filtree.volumes.map((v) => v.estompe)).toEqual([false, true]);
    expect(rc.planchesARecolter(plants, filtree)).toEqual(['p0']);
    expect(rc.planchesARecolter(plants, appliquerFiltres(scene, FILTRES_TOUT))).toEqual(['p0', 'p1']);
  });
});

// ── Adaptateur : plantsDePlanche ─────────────────────────────────────────────────────────────
const plantsDe = (espece: Espece, jour: DateCalendaire): PlantsT32e | null => unePlanche(espece, jour).plants[0] ?? null;

describe('T32e : plantsDePlanche porte l’état de récolte du cœur', () => {
  it('recolte = recolteA du cœur (annuelle), semaine après semaine', () => {
    for (let k = -80; k < 110; k += 7) {
      const jour = ajouterJours(B, k);
      const p = plantsDe('Courgette', jour);
      if (p === null) continue;
      expect(p.recolte, jour).toEqual(coeur.recolteA(dates(), jour));
    }
  });

  it('courgette : formation, à récolter, fin de récolte, puis plus de planche après l’arrachage', () => {
    expect(plantsDe('Courgette', avant(B, 7))?.recolte.phase).toBe('fruits-en-formation');
    expect(plantsDe('Courgette', ajouterJours(B, 10))?.recolte.phase).toBe('a-recolter');
    expect(plantsDe('Courgette', avant(F, 3))?.recolte.phase).toBe('fin-de-recolte');
    expect(plantsDe('Courgette', A)).toBeNull();
  });

  it('avant la formation des fruits : aucune récolte, aucun fruit', () => {
    const p = plantsDe('Courgette', d('2027-05-10'));
    expect(p?.recolte).toEqual({ phase: 'aucune', maturite: 0 });
    expect(p?.fruitsParPlant).toBe(0);
    expect(p?.tailleFruitM).toBe(0);
  });

  it('sans date de récolte : aucune récolte, aucun fruit, quelle que soit la saison', () => {
    const sans: CultureDePlanche = { ...culture('Courgette'), croissance: { sorte: 'annuelle', dates: { ...dates(), debutRecolte: { prevue: null, reelle: null }, finRecolte: { prevue: null, reelle: null } } } };
    for (const jour of ['2027-06-01', '2027-07-15', '2027-09-01']) {
      const p = pl.plantsDePlanche({ volume: volume(0, 'Courgette'), culture: sans, jour: d(jour), horsSol: false });
      expect(p?.recolte.phase, jour).toBe('aucune');
      expect(p?.fruitsParPlant, jour).toBe(0);
    }
  });

  it('fruits seulement en formation ou à récolter, au plus FRUITS_MAX_PAR_PLANT par plant', () => {
    const attendu: Record<PhaseRecolte3d, boolean> = { aucune: false, 'fruits-en-formation': true, 'a-recolter': true, 'fin-de-recolte': false };
    const vues = new Set<string>();
    for (let k = -90; k < 100; k += 3) {
      const p = plantsDe('Courgette', ajouterJours(B, k));
      if (p === null) continue;
      vues.add(p.recolte.phase);
      if (attendu[p.recolte.phase]) {
        expect(Number.isInteger(p.fruitsParPlant)).toBe(true);
        expect(p.fruitsParPlant, p.recolte.phase).toBeGreaterThanOrEqual(1);
        expect(p.fruitsParPlant, p.recolte.phase).toBeLessThanOrEqual(pl.FRUITS_MAX_PAR_PLANT);
        expect(p.tailleFruitM, p.recolte.phase).toBeGreaterThan(0);
        expect(p.tailleFruitM, p.recolte.phase).toBeLessThanOrEqual(TAILLE_FRUIT_MAX_M);
      } else {
        expect(p.fruitsParPlant, p.recolte.phase).toBe(0);
        expect(p.tailleFruitM, p.recolte.phase).toBe(0);
      }
    }
    expect([...vues].sort()).toEqual(['a-recolter', 'aucune', 'fin-de-recolte', 'fruits-en-formation']);
  });

  it('la taille du fruit grandit avec la maturité, puis se tient à « à récolter »', () => {
    const tailles = [6, 3, 1, 0].map((n) => plantsDe('Courgette', avant(B, n))?.tailleFruitM ?? Number.NaN);
    for (let i = 1; i < tailles.length; i += 1) expect(tailles[i], `taille ${String(i)}`).toBeGreaterThan(tailles[i - 1] ?? Number.POSITIVE_INFINITY);
    const mur = plantsDe('Courgette', ajouterJours(B, 20))?.tailleFruitM;
    expect(mur).toBeCloseTo(tailles[3] ?? Number.NaN, 12);
  });

  it('le type de fruit suit l’espèce', () => {
    expect(plantsDe('Courgette', ajouterJours(B, 10))?.typeFruit).toBe('allonge');
    expect(plantsDe('Tomate', ajouterJours(B, 10))?.typeFruit).toBe('rond');
  });

  it('fin de récolte : le feuillage jaunit (0 avant, > 0 en fin, ne redescend pas, au plus 1)', () => {
    const avantFin = plantsDe('Courgette', ajouterJours(B, 10));
    expect(avantFin?.jaunissement).toBe(0);
    let precedent = 0;
    for (let k = 14; k >= 0; k -= 1) {
      const p = plantsDe('Courgette', avant(A, k + 1));
      if (p?.recolte.phase !== 'fin-de-recolte') continue;
      expect(p.jaunissement).toBeGreaterThan(0);
      expect(p.jaunissement).toBeLessThanOrEqual(1);
      expect(p.jaunissement).toBeGreaterThanOrEqual(precedent - 1e-12);
      precedent = p.jaunissement;
    }
    expect(precedent).toBeGreaterThan(0);
    expect(plantsDe('Courgette', avant(B, 7))?.jaunissement).toBe(0);
  });

  it('fraise (pérenne) : suit sa période de récolte annuelle', () => {
    const p = (jour: string, c: { debut: string | null; fin: string | null } | null) => pl.plantsDePlanche({ volume: volume(0, 'Courgette'), culture: fraise(c), jour: d(jour), horsSol: false });
    const campagne = { debut: '2027-05-10', fin: '2027-06-30' };
    expect(p('2027-05-03', campagne)?.recolte.phase).toBe('fruits-en-formation');
    expect(p('2027-05-03', campagne)?.typeFruit).toBe('rond');
    expect(p('2027-05-20', campagne)?.recolte).toEqual({ phase: 'a-recolter', maturite: 1 });
    expect(p('2027-05-20', campagne)?.fruitsParPlant).toBeGreaterThanOrEqual(1);
    // Hors période, ou sans campagne : pas de fruits.
    expect(p('2027-03-20', campagne)?.fruitsParPlant ?? 0).toBe(0);
    expect(p('2027-05-20', null)?.fruitsParPlant ?? 0).toBe(0);
    expect(p('2027-05-20', { debut: null, fin: null })?.fruitsParPlant ?? 0).toBe(0);
  });

  it('même entrée, même sortie', () => {
    expect(plantsDe('Courgette', ajouterJours(B, 3))).toEqual(plantsDe('Courgette', ajouterJours(B, 3)));
  });
});

// ── Géométries partagées ─────────────────────────────────────────────────────────────────────
describe('T32e : géométries du fruit et de la balise', () => {
  const triangles = (g: InstancedMesh['geometry']): number => (g.index !== null ? g.index.count : g.getAttribute('position').count) / 3;

  it('fruit : légère, colorée comme les autres, de 1 m dans son plus grand sens (l’échelle donne la taille)', () => {
    const g = new r.RenduPlants().geometrieFruit();
    expect(triangles(g)).toBeGreaterThan(0);
    expect(triangles(g)).toBeLessThanOrEqual(80);
    expect(g.getAttribute('color')).toBeDefined();
    g.computeBoundingBox();
    const taille = g.boundingBox?.getSize(new Vector3());
    expect(Math.max(taille?.x ?? 0, taille?.y ?? 0, taille?.z ?? 0)).toBeCloseTo(1, 2);
  });

  it('balise : légère et colorée comme les autres', () => {
    const g = new r.RenduPlants().geometrieBalise();
    expect(triangles(g)).toBeGreaterThan(0);
    expect(triangles(g)).toBeLessThanOrEqual(80);
    expect(g.getAttribute('color')).toBeDefined();
  });

  it('partagées : le même objet à chaque appel', () => {
    const rendu = new r.RenduPlants();
    expect(rendu.geometrieFruit()).toBe(rendu.geometrieFruit());
    expect(rendu.geometrieBalise()).toBe(rendu.geometrieBalise());
  });
});

// ── Rendu : fruits ───────────────────────────────────────────────────────────────────────────
describe('T32e : fruits instanciés (un seul maillage)', () => {
  it('à récolter : au moins un fruit par plant, au plus FRUITS_MAX_PAR_PLANT, count du maillage = bilan', () => {
    const { scene, plants } = unePlanche('Courgette', ajouterJours(B, 10));
    const { fruits, bilan } = poser(scene, plants);
    expect(bilan.plants).toBe(plants[0]?.nombre);
    expect(bilan.fruits).toBeGreaterThanOrEqual(bilan.plants);
    expect(bilan.fruits).toBeLessThanOrEqual(bilan.plants * pl.FRUITS_MAX_PAR_PLANT);
    expect(fruits.count).toBe(bilan.fruits);
  });

  it('en formation : des fruits aussi', () => {
    const { scene, plants } = unePlanche('Courgette', avant(B, 4));
    const { fruits, bilan } = poser(scene, plants);
    expect(bilan.fruits).toBeGreaterThan(0);
    expect(fruits.count).toBe(bilan.fruits);
  });

  it('avant la formation, en fin de récolte : aucun fruit (les plants restent)', () => {
    for (const jour of [d('2027-05-10'), avant(F, 3), ajouterJours(F, 5)]) {
      const { scene, plants } = unePlanche('Courgette', jour);
      const { fruits, bilan } = poser(scene, plants);
      expect(bilan.plants, jour).toBeGreaterThan(0);
      expect(bilan.fruits, jour).toBe(0);
      expect(fruits.count, jour).toBe(0);
    }
  });

  it('après l’arrachage : ni plant ni fruit', () => {
    const { scene, plants } = unePlanche('Courgette', ajouterJours(A, 7));
    const { fruits, bilan } = poser(scene, plants);
    expect(bilan.plants).toBe(0);
    expect(bilan.fruits).toBe(0);
    expect(fruits.count).toBe(0);
  });

  it('de loin : plus de fruits (la masse remplace), comme les plants', () => {
    const { scene, plants } = unePlanche('Courgette', ajouterJours(B, 10));
    const { fruits, bilan } = poser(scene, plants, LOIN);
    expect(bilan.plants).toBe(0);
    expect(bilan.fruits).toBe(0);
    expect(fruits.count).toBe(0);
  });

  it('plafond total : jamais plus de FRUITS_MAX_TOTAL fruits, même avec des dizaines de planches à récolter', () => {
    const { scene, plants } = fermeDe(60, 'Courgette', ajouterJours(B, 10));
    const { fruits, bilan } = poser(scene, plants);
    expect(bilan.fruits).toBeGreaterThan(0);
    expect(bilan.fruits).toBeLessThanOrEqual(pl.FRUITS_MAX_TOTAL);
    expect(fruits.count).toBe(bilan.fruits);
    expect(bilan.plants).toBeLessThanOrEqual(PLANTS_MAX_TOTAL);
  });

  it('le maillage de fruits est plafonné : jamais d’écriture au-delà de sa capacité', () => {
    const { scene, plants } = unePlanche('Courgette', ajouterJours(B, 10));
    const { fruits, bilan } = poser(scene, plants, PROCHE, FILTRES_TOUT, 5);
    expect(fruits.count).toBeLessThanOrEqual(5);
    expect(bilan.fruits).toBeLessThanOrEqual(5);
  });

  it('chaque fruit est sur sa planche, entre la dalle et le haut du plant', () => {
    const { scene, plants } = unePlanche('Courgette', ajouterJours(B, 10));
    const p = plants[0];
    const v = scene.volumes[0];
    if (p === null || p === undefined || v === undefined) throw new Error('planche attendue');
    const { fruits } = poser(scene, plants);
    const yDalle = r.hauteurDalle(hauteurRendue(v), p) + p.surelevationM;
    expect(fruits.count).toBeGreaterThan(0);
    for (const f of poses(fruits)) {
      expect(Math.abs(f.x - v.x), 'dans la longueur').toBeLessThanOrEqual(v.longueur / 2 + 0.15);
      expect(Math.abs(f.z - v.z), 'dans la largeur').toBeLessThanOrEqual(v.largeur / 2 + 0.15);
      expect(f.y, 'au-dessus de la dalle').toBeGreaterThanOrEqual(yDalle - 1e-6);
      expect(f.y, 'sur le plant').toBeLessThanOrEqual(yDalle + p.echelleVerticale + TAILLE_FRUIT_MAX_M);
    }
  });

  it('la taille des fruits grandit avec la maturité : formation tôt < formation tard < à récolter', () => {
    const taillePosee = (jour: DateCalendaire): number => {
      const { scene, plants } = unePlanche('Courgette', jour);
      const { fruits } = poser(scene, plants);
      expect(fruits.count, jour).toBeGreaterThan(0);
      const tailles = poses(fruits).map(grand);
      // Une même planche : tous les fruits ont la même taille, celle de l'adaptateur.
      expect(moyenne(tailles), jour).toBeCloseTo(plants[0]?.tailleFruitM ?? Number.NaN, 5);
      return moyenne(tailles);
    };
    const t1 = taillePosee(avant(B, 6));
    const t2 = taillePosee(avant(B, 2));
    const t3 = taillePosee(B);
    expect(t2).toBeGreaterThan(t1);
    expect(t3).toBeGreaterThan(t2);
    expect(t3).toBeLessThanOrEqual(TAILLE_FRUIT_MAX_M + 1e-9);
    expect(t1).toBeGreaterThan(0);
  });

  it('forme par type : courgette allongée (≥ 2:1), tomate ronde (≤ 1,3:1)', () => {
    const courgette = unePlanche('Courgette', ajouterJours(B, 10));
    const poseesCourgette = poses(poser(courgette.scene, courgette.plants).fruits);
    const tomate = unePlanche('Tomate', ajouterJours(B, 10));
    const poseesTomate = poses(poser(tomate.scene, tomate.plants).fruits);
    expect(poseesCourgette.length).toBeGreaterThan(0);
    expect(poseesTomate.length).toBeGreaterThan(0);
    for (const f of poseesCourgette) expect(grand(f) / petit(f)).toBeGreaterThanOrEqual(2);
    for (const f of poseesTomate) expect(grand(f) / petit(f)).toBeLessThanOrEqual(1.3);
  });

  it('couleur : verte en formation, mûre à « à récolter », différente selon l’espèce et du feuillage', () => {
    const couleurDe = (espece: Espece, jour: DateCalendaire): string[] => {
      const { scene, plants } = unePlanche(espece, jour);
      return [...new Set(couleurs(poser(scene, plants).fruits))];
    };
    const formation = couleurDe('Courgette', avant(B, 4));
    const murCourgette = couleurDe('Courgette', ajouterJours(B, 10));
    const murTomate = couleurDe('Tomate', ajouterJours(B, 10));
    expect(formation).toHaveLength(1);
    expect(murCourgette).toHaveLength(1);
    expect(murTomate).toHaveLength(1);
    expect(murCourgette[0], 'mûre ≠ en formation').not.toBe(formation[0]);
    expect(murTomate[0], 'la tomate mûre n’a pas la couleur de la courgette mûre').not.toBe(murCourgette[0]);
    for (const c of [formation[0], murCourgette[0], murTomate[0]]) expect(c, 'fruit ≠ feuillage').not.toBe(hex(COULEUR_FEUILLAGE_3D));
  });

  it('planche estompée par un filtre : fruits à la couleur du filtre, pas de couleur vive', () => {
    const { scene, plants } = ferme([{ espece: 'Courgette' }, { espece: 'Tomate' }], ajouterJours(B, 10));
    const tout = poser(scene, plants);
    const filtre = poser(scene, plants, PROCHE, SEULEMENT_COURGETTES);
    expect(filtre.filtree.volumes.map((v) => v.estompe)).toEqual([false, true]);
    // Les fruits des deux planches sont posés (estompé ≠ retiré) ; ceux de la tomate prennent la couleur estompée.
    expect(filtre.bilan.fruits).toBe(tout.bilan.fruits);
    const pale = couleurs(filtre.fruits).filter((c) => c === hex(COULEUR_ESTOMPEE));
    const nbTomates = plants[1]?.nombre ?? 0;
    expect(pale.length).toBeGreaterThanOrEqual(nbTomates);
    expect(pale.length).toBeLessThan(couleurs(filtre.fruits).length);
    // Sans filtre, aucun fruit n'est de la couleur estompée.
    expect(couleurs(tout.fruits).filter((c) => c === hex(COULEUR_ESTOMPEE))).toHaveLength(0);
  });
});

// ── Rendu : balises ──────────────────────────────────────────────────────────────────────────
describe('T32e : balise « à récolter » au-dessus de la planche (Q35)', () => {
  it('une balise par planche à récolter ou en fin de récolte (T32f, Q38), pas pour les autres', () => {
    const jour = ajouterJours(B, 10);
    const { scene, plants } = ferme([{ espece: 'Courgette' }, { espece: 'Tomate', decalage: 120 }, { espece: 'Tomate' }, { espece: 'Laitue', decalage: -90 }, { espece: 'Courgette', decalage: 17 }], jour);
    const { balises, bilan, filtree } = poser(scene, plants);
    expect(plants.map((p) => p?.recolte.phase)).toEqual(['a-recolter', undefined, 'a-recolter', 'fin-de-recolte', 'fruits-en-formation']);
    expect(rc.planchesARecolter(plants, filtree)).toEqual(['p0', 'p2', 'p3']);
    expect(bilan.balises).toBe(3);
    expect(balises.count).toBe(3);
  });

  it('visible en vue d’ensemble : la balise reste quand les plants sont retirés de loin', () => {
    const { scene, plants } = fermeDe(3, 'Courgette', ajouterJours(B, 10));
    const { balises, bilan } = poser(scene, plants, LOIN);
    expect(bilan.plants).toBe(0);
    expect(bilan.fruits).toBe(0);
    expect(bilan.balises).toBe(3);
    expect(balises.count).toBe(3);
  });

  it('au-dessus de sa planche, plus haut que le feuillage, lisible de loin', () => {
    const { scene, plants } = fermeDe(3, 'Courgette', ajouterJours(B, 10));
    const { balises } = poser(scene, plants, LOIN);
    const bs = poses(balises);
    expect(bs).toHaveLength(3);
    bs.forEach((b, i) => {
      const v = scene.volumes[i];
      const p = plants[i];
      if (v === undefined || p === undefined) throw new Error('planche attendue');
      expect(Math.abs(b.x - v.x), `balise ${String(i)} dans l’emprise (x)`).toBeLessThanOrEqual(v.longueur / 2 + 1e-6);
      expect(Math.abs(b.z - v.z), `balise ${String(i)} dans l’emprise (z)`).toBeLessThanOrEqual(v.largeur / 2 + 1e-6);
      expect(b.y, `balise ${String(i)} au-dessus de la masse`).toBeGreaterThan(r.hauteurDeMasse(hauteurRendue(v), p));
      expect(grand(b), `balise ${String(i)} lisible de loin`).toBeGreaterThanOrEqual(TAILLE_BALISE_MIN_M);
    });
  });

  it('couleur vive, distincte du feuillage et de l’estompé', () => {
    const { scene, plants } = unePlanche('Courgette', ajouterJours(B, 10));
    const cs = couleurs(poser(scene, plants, LOIN).balises);
    expect(cs).toHaveLength(1);
    expect(cs[0]).not.toBe(hex(COULEUR_FEUILLAGE_3D));
    expect(cs[0]).not.toBe(hex(COULEUR_ESTOMPEE));
  });

  it('planche filtrée (T27b) : estompée, sans balise', () => {
    const { scene, plants } = ferme([{ espece: 'Courgette' }, { espece: 'Tomate' }], ajouterJours(B, 10));
    const tout = poser(scene, plants, LOIN);
    const filtre = poser(scene, plants, LOIN, SEULEMENT_COURGETTES);
    expect(tout.bilan.balises).toBe(2);
    expect(filtre.bilan.balises).toBe(1);
    expect(filtre.balises.count).toBe(1);
    const toutRien: FiltresScene = { familles: new Set<string>(), cultures: null, zones: null };
    expect(poser(scene, plants, LOIN, toutRien).bilan.balises).toBe(0);
  });

  it('aucune planche à récolter : aucune balise, aucun fruit mûr', () => {
    const { scene, plants } = fermeDe(2, 'Courgette', d('2027-05-10'));
    const { balises, bilan } = poser(scene, plants);
    expect(bilan.balises).toBe(0);
    expect(balises.count).toBe(0);
  });

  it('les garde-fous de nombre tiennent : un seul maillage de fruits et un seul de balises, quel que soit le nombre de planches', () => {
    // Deux maillages liés, rien d'autre : si le rendu en demandait davantage, les compteurs ne tiendraient pas dans ces deux-là.
    const { scene, plants } = fermeDe(40, 'Courgette', ajouterJours(B, 10));
    const { fruits, balises, bilan } = poser(scene, plants);
    expect(fruits.count).toBe(bilan.fruits);
    expect(balises.count).toBe(bilan.balises);
    expect(bilan.balises).toBe(40);
  });
});
