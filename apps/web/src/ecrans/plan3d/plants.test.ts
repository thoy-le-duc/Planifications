/**
 * Tests d'acceptation T32b — adaptateur PUR des plants stylisés de la vue 3D (`plants.ts`).
 * Ni React, ni three, ni réseau, ni horloge : le jour est un argument. Aucun calcul de
 * croissance ici : la hauteur et le stade viennent de `croissanceA` / `croissancePerenneA` de
 * @planif/core (T32a, valeurs par défaut de Q33). La vue (instances, attributs de la toile,
 * mesures) est vérifiée par apps/web/e2e/vue-3d-plants.e2e.ts.
 *
 * ── API attendue : apps/web/src/ecrans/plan3d/plants.ts ──────────────────────────────────────
 *
 *   PLANTS_MAX_PAR_PLANCHE: number            plafond du nombre de plants d'UNE planche (entier,
 *                                              de 10 à 200 : ni dérisoire, ni sans limite)
 *   HAUTEUR_PLANT_MINIMAL_M: number           en deçà, le plant est « minimal » (jeune plant, turion) ;
 *                                              au plus 0,1 m
 *   TRIANGLES_PAR_FORME: Record<FormePlant, number>
 *                                              triangles de la géométrie partagée de chaque forme,
 *                                              un entier de 40 à 60 pour les sept formes
 *
 *   plantsDePlanche(entree: EntreePlants): PlantsPlanche | null
 *     EntreePlants = {
 *       volume: { id, x, z, longueur, largeur, angle, couleur }   (un VolumeScene ou un VolumeFiltre :
 *                                     coordonnées de scène, `angle` comme coinsRectScene ;
 *                                     `couleur` est déjà celle du filtre T27b, estompée ou non)
 *       culture: CultureDePlanche | null                          (null : planche vide)
 *       jour: DateCalendaire                                      (le lundi de la semaine du curseur)
 *       horsSol: boolean   la planche est dans une zone `hors_sol` ou sur une gouttière
 *     }
 *     CultureDePlanche = {
 *       espece: string                           nom de l'espèce (pour le fraisier hors-sol)
 *       profil: ProfilCroissance                 profilEffectif(espèce) de T32a
 *       croissance: { sorte: 'annuelle'; dates: DatesCroissance } | { sorte: 'perenne'; entree: EntreePerenne }
 *       ecartementM: number                      écartement réel des plants dans l'itinéraire (> 0)
 *     }
 *     PlantsPlanche = {
 *       id: string                               id de la planche (volume.id)
 *       forme: FormePlant
 *       stade: StadeCroissance
 *       hauteurM: number                         hauteur du feuillage du jour (T32a)
 *       echelleVerticale: number                 échelle appliquée à la géométrie de 1 m de haut = hauteurM
 *       echelleHorizontale: number               dans ]0 ; ecartementM] (bornée par l'écartement réel)
 *       structureM: number                       hauteurStructureM(profil) de T32a (kiwi : pergola, bois)
 *       surelevationM: number                    surelevationHorsSolM(espece, horsSol) de T32a (fraisier hors-sol : ≈ 1 m)
 *       couleur: string                          = volume.couleur
 *       nombre: number                           ≤ PLANTS_MAX_PAR_PLANCHE, = positions.length
 *       positions: readonly { x: number; z: number }[]   coordonnées de scène, TOUTES dans le rectangle de la planche
 *     }
 *     Rend null quand rien ne se dessine : pas de culture, avant la mise en place, à partir du jour
 *     d'arrachage, ou pérenne sans feuillage ni structure. Un plant « minimal » (hauteur ≤
 *     HAUTEUR_PLANT_MINIMAL_M) est permis à la place de null pendant la levée.
 *
 *   instancesParForme(plants: readonly (PlantsPlanche | null)[]): readonly GroupeInstances[]
 *     GroupeInstances = { forme: FormePlant; planches: readonly PlantsPlanche[]; nombreDePlants: number; triangles: number }
 *     Un groupe (donc UN InstancedMesh) par forme présente, pas un par planche ; les null sont
 *     ignorés ; triangles = nombreDePlants × TRIANGLES_PAR_FORME[forme].
 *
 * Même entrée, même sortie ; l'entrée n'est jamais modifiée.
 */
import { ajouterJours, profilParDefaut, type DatesCroissance, type DateCalendaire, type EntreePerenne, type FormePlant, type ProfilCroissance, type StadeCroissance } from '@planif/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { COULEURS, FAMILLES } from '../../ui/jetons.ts';
import { appliquerFiltres, COULEUR_ESTOMPEE, type Scene, type VolumeScene } from './scene.ts';

interface VolumePlant {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly longueur: number;
  readonly largeur: number;
  readonly angle: number;
  readonly couleur: string;
}
interface CultureDePlanche {
  readonly espece: string;
  readonly profil: ProfilCroissance;
  readonly croissance: { readonly sorte: 'annuelle'; readonly dates: DatesCroissance } | { readonly sorte: 'perenne'; readonly entree: EntreePerenne };
  readonly ecartementM: number;
}
interface EntreePlants {
  readonly volume: VolumePlant;
  readonly culture: CultureDePlanche | null;
  readonly jour: DateCalendaire;
  readonly horsSol: boolean;
}
interface PlantsPlanche {
  readonly id: string;
  readonly forme: FormePlant;
  readonly stade: StadeCroissance;
  readonly hauteurM: number;
  readonly echelleVerticale: number;
  readonly echelleHorizontale: number;
  readonly structureM: number;
  readonly surelevationM: number;
  readonly couleur: string;
  readonly nombre: number;
  readonly positions: readonly { readonly x: number; readonly z: number }[];
}
interface GroupeInstances {
  readonly forme: FormePlant;
  readonly planches: readonly PlantsPlanche[];
  readonly nombreDePlants: number;
  readonly triangles: number;
}
interface ModulePlants {
  readonly PLANTS_MAX_PAR_PLANCHE: number;
  readonly HAUTEUR_PLANT_MINIMAL_M: number;
  readonly TRIANGLES_PAR_FORME: Readonly<Record<FormePlant, number>>;
  plantsDePlanche(entree: EntreePlants): PlantsPlanche | null;
  instancesParForme(plants: readonly (PlantsPlanche | null)[]): readonly GroupeInstances[];
}

const CHEMIN_PLANTS = './plants.ts';
let m: ModulePlants;

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN_PLANTS)) as ModulePlants;
});

const d = (s: string): DateCalendaire => s as DateCalendaire;
const FORMES: readonly FormePlant[] = ['erige-tuteure', 'rosette', 'touffe', 'rampant', 'buisson', 'arbre-ou-liane', 'bulbe-ou-racine'];

function volume(autres: Partial<VolumePlant> = {}): VolumePlant {
  return { id: 'p1', x: 10, z: -4, longueur: 12, largeur: 1, angle: 0, couleur: FAMILLES.solanacees.bande, ...autres };
}

/** Tomate mise en place le 1er mai 2027, début de récolte le 1er juillet, fin le 15 septembre, arrachage le 15 octobre. */
const MISE_EN_PLACE = d('2027-05-01');
const DATES_TOMATE: DatesCroissance = {
  miseEnPlace: { prevue: MISE_EN_PLACE, reelle: null },
  debutRecolte: { prevue: d('2027-07-01'), reelle: null },
  finRecolte: { prevue: d('2027-09-15'), reelle: null },
  arrachage: { prevue: d('2027-10-15'), reelle: null },
};

function tomate(): CultureDePlanche {
  return { espece: 'Tomate', profil: profilParDefaut('Tomate').profil, croissance: { sorte: 'annuelle', dates: DATES_TOMATE }, ecartementM: 0.5 };
}
function laitue(): CultureDePlanche {
  return { espece: 'Laitue', profil: profilParDefaut('Laitue').profil, croissance: { sorte: 'annuelle', dates: DATES_TOMATE }, ecartementM: 0.3 };
}
const campagne = (annee: number): EntreePerenne['campagne'] => ({ annee, debutRecolte: null, finRecolte: null });
function perenne(espece: string, ecartementM: number): CultureDePlanche {
  return {
    espece,
    profil: profilParDefaut(espece).profil,
    croissance: { sorte: 'perenne', entree: { plantation: { datePlantation: d('2020-03-01'), dateArrachage: null }, campagne: campagne(2027) } },
    ecartementM,
  };
}

function plants(culture: CultureDePlanche | null, jour: string, vol: Partial<VolumePlant> = {}, horsSol = false): PlantsPlanche | null {
  return m.plantsDePlanche({ volume: volume(vol), culture, jour: d(jour), horsSol });
}

/** Position dans le repère de la planche (inverse de coinsRectScene de scene.ts). */
function local(v: VolumePlant, p: { x: number; z: number }): { dx: number; dz: number } {
  const c = Math.cos(v.angle);
  const s = Math.sin(v.angle);
  return { dx: (p.x - v.x) * c - (p.z - v.z) * s, dz: (p.x - v.x) * s + (p.z - v.z) * c };
}

describe('T32b : constantes de l’adaptateur', () => {
  it('plafond de plants par planche : un entier raisonnable', () => {
    expect(Number.isInteger(m.PLANTS_MAX_PAR_PLANCHE)).toBe(true);
    expect(m.PLANTS_MAX_PAR_PLANCHE).toBeGreaterThanOrEqual(10);
    expect(m.PLANTS_MAX_PAR_PLANCHE).toBeLessThanOrEqual(200);
  });

  it('plant minimal : au plus 10 cm', () => {
    expect(m.HAUTEUR_PLANT_MINIMAL_M).toBeGreaterThan(0);
    expect(m.HAUTEUR_PLANT_MINIMAL_M).toBeLessThanOrEqual(0.1);
  });

  it.each(FORMES)('forme %s : entre 40 et 60 triangles', (forme) => {
    const n = m.TRIANGLES_PAR_FORME[forme];
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(40);
    expect(n).toBeLessThanOrEqual(60);
  });
});

describe('T32b : tomate, du plant à la hauteur maximale de 3 m (Q33)', () => {
  it('à la semaine de mise en place : aucun plant, ou un plant minimal', () => {
    const p = plants(tomate(), '2027-05-01');
    if (p !== null) {
      expect(p.hauteurM).toBeLessThanOrEqual(m.HAUTEUR_PLANT_MINIMAL_M);
      expect(p.echelleVerticale).toBeLessThanOrEqual(m.HAUTEUR_PLANT_MINIMAL_M);
    }
  });

  it('avant la mise en place : aucun plant', () => {
    expect(plants(tomate(), '2027-04-30')).toBeNull();
    expect(plants(tomate(), '2027-01-04')).toBeNull();
  });

  it('à la semaine de hauteur maximale : forme tuteurée, échelle verticale 3 m', () => {
    const jours = profilParDefaut('Tomate').profil.duree;
    expect(jours.en).toBe('jours');
    const n = jours.en === 'jours' ? jours.jours : 90;
    const p = plants(tomate(), ajouterJours(MISE_EN_PLACE, n));
    expect(p).not.toBeNull();
    expect(p?.forme).toBe('erige-tuteure');
    expect(p?.stade).toBe('pleine_production');
    expect(p?.hauteurM).toBeCloseTo(3, 9);
    expect(p?.echelleVerticale).toBeCloseTo(3, 9);
  });

  it('la hauteur grandit semaine après semaine puis se tient (jamais plus de 3 m)', () => {
    let avant = -1;
    for (let semaine = 0; semaine < 24; semaine += 1) {
      const p = plants(tomate(), ajouterJours(MISE_EN_PLACE, 7 * semaine));
      const h = p?.echelleVerticale ?? 0;
      expect(h, `semaine ${String(semaine)}`).toBeGreaterThanOrEqual(avant - 1e-12);
      expect(h, `semaine ${String(semaine)}`).toBeLessThanOrEqual(3 + 1e-12);
      avant = h;
    }
    expect(avant).toBeCloseTo(3, 9);
  });

  it('après l’arrachage (et le jour même) : aucun plant', () => {
    expect(plants(tomate(), '2027-10-14')).not.toBeNull();
    expect(plants(tomate(), '2027-10-15')).toBeNull();
    expect(plants(tomate(), '2027-11-01')).toBeNull();
    expect(plants(tomate(), '2028-06-01')).toBeNull();
  });

  it('planche vide : aucun plant', () => {
    expect(plants(null, '2027-07-15')).toBeNull();
  });

  it('échelle horizontale bornée par l’écartement réel de l’itinéraire', () => {
    const p = plants({ ...tomate(), ecartementM: 0.4 }, '2027-08-01');
    expect(p?.echelleHorizontale).toBeGreaterThan(0);
    expect(p?.echelleHorizontale).toBeLessThanOrEqual(0.4 + 1e-12);
    const serre = plants({ ...tomate(), ecartementM: 0.1 }, '2027-08-01');
    expect(serre?.echelleHorizontale).toBeLessThanOrEqual(0.1 + 1e-12);
  });
});

describe('T32b : nombre de plants plafonné, positions dans la planche', () => {
  it('une planche courte : des plants à l’écartement, tous dans la planche', () => {
    const v = volume({ longueur: 10, largeur: 1, x: 3, z: 8, angle: 0.7 });
    const p = m.plantsDePlanche({ volume: v, culture: { ...tomate(), ecartementM: 0.5 }, jour: d('2027-08-01'), horsSol: false });
    expect(p).not.toBeNull();
    expect(p?.nombre).toBeGreaterThanOrEqual(5);
    expect(p?.nombre).toBeLessThanOrEqual(m.PLANTS_MAX_PAR_PLANCHE);
    expect(p?.positions.length).toBe(p?.nombre);
    for (const pos of p?.positions ?? []) {
      const { dx, dz } = local(v, pos);
      expect(Math.abs(dx)).toBeLessThanOrEqual(v.longueur / 2 + 1e-9);
      expect(Math.abs(dz)).toBeLessThanOrEqual(v.largeur / 2 + 1e-9);
    }
  });

  it('une planche très longue (5 000 m, plants tous les 30 cm) : jamais plus que le plafond, et des plants quand même', () => {
    const v = volume({ longueur: 5_000, largeur: 1.2 });
    const p = m.plantsDePlanche({ volume: v, culture: { ...laitue(), ecartementM: 0.3 }, jour: d('2027-08-01'), horsSol: false });
    expect(p).not.toBeNull();
    expect(p?.nombre).toBeLessThanOrEqual(m.PLANTS_MAX_PAR_PLANCHE);
    expect(p?.nombre).toBeGreaterThanOrEqual(1);
    expect(p?.positions.length).toBe(p?.nombre);
    // Espacés pour couvrir la planche : le dernier n'est pas collé au premier.
    const xs = (p?.positions ?? []).map((pos) => local(v, pos).dx);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(v.longueur / 2);
  });

  it('le plafond tient pour tous les écartements et longueurs essayés', () => {
    for (const longueur of [0.5, 3, 25, 400, 20_000]) {
      for (const ecartementM of [0.05, 0.25, 1, 5]) {
        const p = m.plantsDePlanche({ volume: volume({ longueur }), culture: { ...tomate(), ecartementM }, jour: d('2027-08-01'), horsSol: false });
        expect(p?.nombre ?? 0, `${String(longueur)} m, écartement ${String(ecartementM)}`).toBeLessThanOrEqual(m.PLANTS_MAX_PAR_PLANCHE);
      }
    }
  });
});

describe('T32b : une instance par forme, pas par planche', () => {
  it('deux planches de formes différentes : deux groupes distincts', () => {
    const a = plants(tomate(), '2027-08-01', { id: 'a', x: 0 });
    const b = plants(laitue(), '2027-08-01', { id: 'b', x: 5 });
    expect(a?.forme).toBe('erige-tuteure');
    expect(b?.forme).toBe('rosette');
    const g = m.instancesParForme([a, b]);
    expect(g.length).toBe(2);
    expect(g.map((x) => x.forme).sort()).toEqual(['erige-tuteure', 'rosette']);
  });

  it('deux planches de la même forme : un seul groupe, qui compte les plants des deux', () => {
    const a = plants(tomate(), '2027-08-01', { id: 'a', x: 0 });
    const b = plants(tomate(), '2027-08-01', { id: 'b', x: 5 });
    const g = m.instancesParForme([a, null, b]);
    expect(g.length).toBe(1);
    expect(g[0]?.forme).toBe('erige-tuteure');
    expect(g[0]?.planches.map((p) => p.id)).toEqual(['a', 'b']);
    expect(g[0]?.nombreDePlants).toBe((a?.nombre ?? 0) + (b?.nombre ?? 0));
  });

  it('triangles d’un groupe = plants × triangles de la forme, dans la borne de 40 à 60 par plant', () => {
    const a = plants(tomate(), '2027-08-01', { id: 'a' });
    const g = m.instancesParForme([a])[0];
    expect(g?.triangles).toBe((g?.nombreDePlants ?? 0) * m.TRIANGLES_PAR_FORME['erige-tuteure']);
    expect((g?.triangles ?? 0) / (g?.nombreDePlants ?? 1)).toBeGreaterThanOrEqual(40);
    expect((g?.triangles ?? 0) / (g?.nombreDePlants ?? 1)).toBeLessThanOrEqual(60);
  });

  it('rien à dessiner : aucun groupe', () => {
    expect(m.instancesParForme([])).toEqual([]);
    expect(m.instancesParForme([null, null])).toEqual([]);
  });
});

describe('T32b : filtres T27b, la planche garde sa couleur', () => {
  const planche: VolumeScene = {
    id: 'p1',
    code: 'P1',
    zoneId: 'z1',
    x: 10,
    z: -4,
    longueur: 12,
    largeur: 1,
    hauteur: 0.3,
    angle: 0,
    placee: false,
    couleur: FAMILLES.solanacees.bande,
    cleFamille: 'solanacees',
    culture: 'Tomate',
    occupationId: 'o1',
  };
  const scene: Scene = { semaine: 0, libelleSemaine: 'S01', socles: [], volumes: [planche], batiments: [] };

  it('planche cochée : les plants ont la couleur de la famille', () => {
    const f = appliquerFiltres(scene, { familles: null, cultures: null, zones: null }).volumes[0];
    if (f === undefined) throw new Error('volume absent');
    const p = m.plantsDePlanche({ volume: f, culture: tomate(), jour: d('2027-08-01'), horsSol: false });
    expect(p?.couleur).toBe(FAMILLES.solanacees.bande);
  });

  it('planche décochée : les plants prennent la couleur estompée, pas une autre', () => {
    const f = appliquerFiltres(scene, { familles: new Set<string>(), cultures: null, zones: null }).volumes[0];
    if (f === undefined) throw new Error('volume absent');
    expect(f.estompe).toBe(true);
    const p = m.plantsDePlanche({ volume: f, culture: tomate(), jour: d('2027-08-01'), horsSol: false });
    expect(p?.couleur).toBe(COULEUR_ESTOMPEE);
    expect(p?.couleur).not.toBe(COULEURS.trait);
  });
});

describe('T32b : pérennes (Q33)', () => {
  it('asperge pendant la récolte (avril à mi-juin) : pas de fougère, au plus un plant minimal', () => {
    for (const jour of ['2027-04-05', '2027-05-17', '2027-06-14']) {
      const p = plants(perenne('Asperge', 0.4), jour);
      if (p !== null) expect(p.echelleVerticale, jour).toBeLessThanOrEqual(m.HAUTEUR_PLANT_MINIMAL_M);
    }
  });

  it('asperge après la fin de récolte : la fougère monte, 1,5 m à l’automne', () => {
    const juillet = plants(perenne('Asperge', 0.4), '2027-07-26');
    const octobre = plants(perenne('Asperge', 0.4), '2027-10-18');
    expect(juillet?.echelleVerticale ?? 0).toBeGreaterThan(m.HAUTEUR_PLANT_MINIMAL_M);
    expect(juillet?.echelleVerticale ?? 0).toBeLessThan(1.5);
    expect(octobre?.echelleVerticale).toBeCloseTo(1.5, 9);
  });

  it('kiwi en hiver : pas de feuillage mais la structure (pergola, bois) reste dessinée', () => {
    const hiver = plants(perenne('Kiwi', 4), '2027-01-18');
    expect(hiver).not.toBeNull();
    expect(hiver?.forme).toBe('arbre-ou-liane');
    expect(hiver?.hauteurM).toBe(0);
    expect(hiver?.structureM).toBeGreaterThan(0);
    const ete = plants(perenne('Kiwi', 4), '2027-08-02');
    expect(ete?.hauteurM).toBeCloseTo(2.5, 9);
    expect(ete?.structureM).toBeGreaterThan(0);
  });

  it('un autre pérenne en hiver (pivoine) : rien', () => {
    expect(plants(perenne('Pivoine', 0.8), '2027-01-18')).toBeNull();
  });

  it('fraisier hors-sol : posé sur une gouttière surélevée d’environ 1 m ; au sol : à 0', () => {
    const haut = plants(perenne('Fraisier', 0.3), '2027-07-12', {}, true);
    const bas = plants(perenne('Fraisier', 0.3), '2027-07-12', {}, false);
    expect(haut?.surelevationM).toBeGreaterThanOrEqual(0.8);
    expect(haut?.surelevationM).toBeLessThanOrEqual(1.2);
    expect(bas?.surelevationM).toBe(0);
  });

  it('une tomate sur une zone hors-sol reste au sol', () => {
    expect(plants(tomate(), '2027-08-01', {}, true)?.surelevationM).toBe(0);
  });
});

describe('T32b : pureté', () => {
  it('même entrée, même sortie, entrée intacte', () => {
    const entree: EntreePlants = { volume: volume({ angle: 1.1 }), culture: tomate(), jour: d('2027-08-01'), horsSol: false };
    const copie = JSON.parse(JSON.stringify(entree)) as EntreePlants;
    const a = m.plantsDePlanche(entree);
    const b = m.plantsDePlanche(entree);
    expect(a).toEqual(b);
    expect(JSON.parse(JSON.stringify(entree))).toEqual(copie);
    expect(a?.id).toBe('p1');
  });
});
