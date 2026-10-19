/**
 * Tests d'acceptation T46 — la 3D matérialise l'écart entre rangs saisi dans l'itinéraire (T43).
 * Écrits AVANT le code.
 *
 * ── Contrat ──────────────────────────────────────────────────────────────────────────────────
 * ./plants.ts
 *   CultureDePlanche.ecartEntreRangsM?: number   écart entre rangs saisi (m) ; absent → bandes égales
 *   CultureDePlanche.rangsParPlanche?: number    rangs de la densité ; lu seulement avec l'écart saisi
 *     (sans écart, le nombre de rangs de la 3D reste celui de T32b : un tous les 0,5 m, 3 au plus).
 *   plantsDePlanche :
 *     - avec l'écart : les rangs sont à cet écart, CENTRÉS sur la planche ; trop larges pour la
 *       planche, les rangs du bord sont resserrés au bord (les rangs du milieu gardent l'écart) et
 *       aucun plant ne sort du rectangle de la planche ; en quinconce, rangs pairs décalés d'un demi-pas ;
 *     - sans l'écart : positions identiques à celles d'avant T46 ;
 *     - PlantsPlanche.lignesRangs : le centre de chaque ligne de rang (sillon, goutte-à-goutte),
 *       une par rang, à la position en travers des plants du rang ; vide sans écart saisi et sur
 *       une gouttière hors-sol (la ligne serait sous la gouttière) ;
 *     - PlantsPlanche.echelleHorizontale ne dépasse pas l’écart entre rangs saisi (rangs distincts).
 * ./donnees-plants.ts
 *   cultureAu(c, jour).ecartEntreRangsM / rangsParPlanche : lus dans la densité figée de la série
 *     (`densite.ecartEntreRangsCm`, de 5 à 200 cm, et `densite.rangsParPlanche`, entier ≥ 1) ;
 *     absents, hors bornes ou illisibles → absents.
 * ./plants-rendu.ts
 *   Les lignes de rang des planches EN DÉTAIL se posent dans le maillage partagé des accessoires
 *   (la double pyramide, T37b) : aucun maillage de plus, aucun appel de dessin de plus. Le bilan
 *   compte `lignesRangs` ; le maillage partagé porte tuteurs + poteaux + lignes + fruits + balises.
 *   Une planche en masse (de loin) ne dessine pas ses lignes.
 */
import { InstancedMesh, Matrix4, MeshBasicMaterial, Vector3 } from 'three';
import type { DateCalendaire } from '@planif/core';
import { profilParDefaut } from '@planif/core/croissance';
import { describe, expect, it } from 'vitest';
import { construireCultures, cultureAu, type LignesPlants } from './donnees-plants.ts';
import { RenduPlants } from './plants-rendu.ts';
import { FORMES, plantsDePlanche, type CultureDePlanche, type PlantsPlanche, type VolumePlant } from './plants.ts';
import { appliquerFiltres, FILTRES_TOUT, type Scene, type VolumeScene } from './scene.ts';

const d = (s: string): DateCalendaire => s as DateCalendaire;
const JOUR = d('2027-07-05');
const DATES = {
  miseEnPlace: { prevue: d('2027-05-01'), reelle: null },
  debutRecolte: { prevue: d('2027-07-01'), reelle: null },
  finRecolte: { prevue: d('2027-09-15'), reelle: null },
  arrachage: { prevue: d('2027-10-15'), reelle: null },
};
const volume = (autres: Partial<VolumePlant> = {}): VolumePlant => ({ id: 'p', x: 10, z: -4, longueur: 3, largeur: 0.75, angle: 0, couleur: '#ffffff', ...autres });
interface Options {
  readonly ecartEntreRangsM?: number;
  readonly rangsParPlanche?: number;
  readonly disposition?: 'alignee' | 'quinconce';
  readonly ecartementM?: number;
  readonly espece?: string;
}
const culture = ({ espece = 'Laitue', ecartementM = 0.3, ...autres }: Options = {}): CultureDePlanche => ({ espece, profil: profilParDefaut(espece).profil, croissance: { sorte: 'annuelle', dates: DATES }, ecartementM, ...autres });
const poser = (v: VolumePlant, c: CultureDePlanche, horsSol = false): PlantsPlanche => {
  const p = plantsDePlanche({ volume: v, culture: c, jour: JOUR, horsSol });
  if (p === null) throw new Error('la planche devrait porter des plants');
  return p;
};

/** Coordonnées dans le repère de la planche : dx le long du rang, dz en travers. */
function locales(v: VolumePlant, positions: readonly { readonly x: number; readonly z: number }[]): { dx: number; dz: number }[] {
  const cos = Math.cos(v.angle);
  const sin = Math.sin(v.angle);
  return positions.map((q) => ({ dx: (q.x - v.x) * cos - (q.z - v.z) * sin, dz: (q.x - v.x) * sin + (q.z - v.z) * cos }));
}
/** Les positions en travers des rangs (dz distincts, croissants, au dixième de millimètre). */
const rangsDz = (v: VolumePlant, positions: readonly { readonly x: number; readonly z: number }[]): number[] =>
  [...new Set(locales(v, positions).map((q) => Math.round(q.dz * 1e4)))].sort((a, b) => a - b).map((n) => n / 1e4);

describe('T46 : les rangs à l’écart saisi, centrés sur la planche', () => {
  it('4 rangs à 18 cm sur une planche de 75 cm → −27, −9, 9, 27 cm', () => {
    const v = volume();
    const p = poser(v, culture({ ecartEntreRangsM: 0.18, rangsParPlanche: 4 }));
    const dz = rangsDz(v, p.positions);
    expect(dz).toHaveLength(4);
    [-0.27, -0.09, 0.09, 0.27].forEach((attendu, i) => {
      expect(dz[i], `rang ${String(i + 1)}`).toBeCloseTo(attendu, 4);
    });
  });

  it('même chose sur une planche tournée, ailleurs dans la scène', () => {
    const v = volume({ angle: 0.8, x: -3, z: 12 });
    const dz = rangsDz(v, poser(v, culture({ ecartEntreRangsM: 0.18, rangsParPlanche: 4 })).positions);
    [-0.27, -0.09, 0.09, 0.27].forEach((attendu, i) => {
      expect(dz[i], `rang ${String(i + 1)}`).toBeCloseTo(attendu, 4);
    });
  });

  it('3 rangs à 30 cm sur 1,2 m → −30, 0, 30 cm (un rang impair passe au centre)', () => {
    const v = volume({ largeur: 1.2 });
    const dz = rangsDz(v, poser(v, culture({ ecartEntreRangsM: 0.3, rangsParPlanche: 3 })).positions);
    expect(dz).toHaveLength(3);
    [-0.3, 0, 0.3].forEach((attendu, i) => {
      expect(dz[i]).toBeCloseTo(attendu, 4);
    });
  });

  it('sans écart saisi → bandes égales comme avant (même sans rangsParPlanche lu)', () => {
    const v = volume();
    const sans = poser(v, culture());
    // Planche de 75 cm : 2 rangs en 3D (un tous les 0,5 m, arrondi), au milieu de deux bandes égales.
    const dz = rangsDz(v, sans.positions);
    expect(dz).toHaveLength(2);
    expect(dz[0]).toBeCloseTo(-0.75 / 4, 6);
    expect(dz[1]).toBeCloseTo(0.75 / 4, 6);
    // Les rangs de la densité seuls (sans écart) ne changent rien.
    expect(poser(v, culture({ rangsParPlanche: 4 })).positions).toEqual(sans.positions);
    expect(sans.lignesRangs).toEqual([]);
  });

  it('le nombre de plants par rang suit le plafond de la planche', () => {
    const v = volume({ longueur: 10 });
    const p = poser(v, culture({ ecartEntreRangsM: 0.18, rangsParPlanche: 4 }));
    expect(p.nombre).toBe(p.positions.length);
    expect(p.nombre % 4).toBe(0);
    expect(p.nombre).toBeGreaterThan(0);
    expect(p.nombre).toBeLessThanOrEqual(20);
  });
});

describe('T46 : écart trop grand → jamais hors de la planche', () => {
  it('4 rangs à 50 cm sur 75 cm : les rangs du milieu gardent l’écart, ceux du bord sont resserrés au bord', () => {
    const v = volume();
    const p = poser(v, culture({ ecartEntreRangsM: 0.5, rangsParPlanche: 4 }));
    const dz = rangsDz(v, p.positions);
    expect(dz).toHaveLength(4);
    for (const z of dz) expect(Math.abs(z)).toBeLessThanOrEqual(0.375 + 1e-9);
    expect((dz[2] ?? NaN) - (dz[1] ?? NaN)).toBeCloseTo(0.5, 6);
    // Symétrique : centré.
    expect((dz[0] ?? NaN) + (dz[3] ?? NaN)).toBeCloseTo(0, 6);
  });

  it('balayage : aucun plant ni aucune ligne de rang hors du rectangle, toutes tailles, tous angles', () => {
    let testes = 0;
    for (const largeur of [0.2, 0.4, 0.75, 1.2, 2]) for (const longueur of [0.3, 1, 3, 25]) for (const angle of [0, 0.7, -2.1]) for (const ecart of [0.05, 0.18, 0.5, 1.2, 2]) for (const rangs of [1, 2, 4, 7, 12]) for (const disposition of ['alignee', 'quinconce'] as const) {
      const v = volume({ largeur, longueur, angle, x: -7.5, z: 3.25 });
      const p = plantsDePlanche({ volume: v, culture: culture({ ecartEntreRangsM: ecart, rangsParPlanche: rangs, disposition }), jour: JOUR, horsSol: false });
      if (p === null) continue;
      testes += 1;
      const ou = `l${String(largeur)} L${String(longueur)} a${String(angle)} e${String(ecart)} r${String(rangs)} ${disposition}`;
      expect(p.nombre, ou).toBe(p.positions.length);
      for (const q of [...locales(v, p.positions), ...locales(v, p.lignesRangs)]) {
        expect(Number.isFinite(q.dx) && Number.isFinite(q.dz), ou).toBe(true);
        expect(Math.abs(q.dx), `${ou} : dx`).toBeLessThanOrEqual(longueur / 2 + 1e-9);
        expect(Math.abs(q.dz), `${ou} : dz`).toBeLessThanOrEqual(largeur / 2 + 1e-9);
      }
    }
    expect(testes).toBeGreaterThan(1000);
  });

  it('rangs absurdes (0, négatif, non entier, énorme) : l’affichage ne plante pas', () => {
    const v = volume();
    for (const rangsParPlanche of [0, -3, 2.5, Number.NaN, 1e6]) {
      const p = plantsDePlanche({ volume: v, culture: culture({ ecartEntreRangsM: 0.18, rangsParPlanche }), jour: JOUR, horsSol: false });
      expect(p, String(rangsParPlanche)).not.toBeNull();
      expect(p?.positions.length ?? 0, String(rangsParPlanche)).toBeGreaterThan(0);
      expect(p?.positions.length ?? 99, String(rangsParPlanche)).toBeLessThanOrEqual(20);
    }
  });
});

describe('T46 : quinconce conservé avec un écart saisi', () => {
  it('mêmes rangs en travers, rangs pairs décalés d’un demi-pas, même nombre de plants', () => {
    const v = volume({ longueur: 4 });
    const a = poser(v, culture({ ecartEntreRangsM: 0.18, rangsParPlanche: 4, disposition: 'alignee' }));
    const q = poser(v, culture({ ecartEntreRangsM: 0.18, rangsParPlanche: 4, disposition: 'quinconce' }));
    expect(q.nombre).toBe(a.nombre);
    expect(rangsDz(v, q.positions)).toEqual(rangsDz(v, a.positions));
    const parRang = new Map<number, number[]>();
    for (const { dx, dz } of locales(v, q.positions)) {
      const cle = Math.round(dz * 1e4);
      parRang.set(cle, [...(parRang.get(cle) ?? []), dx]);
    }
    const rangs = [...parRang].sort((x, y) => x[0] - y[0]).map(([, dxs]) => dxs.sort((x, y) => x - y));
    expect(rangs).toHaveLength(4);
    const premier = rangs[0] ?? [];
    const pas = (premier[1] ?? NaN) - (premier[0] ?? NaN);
    expect(pas).toBeGreaterThan(0);
    rangs.forEach((dxs, r) => {
      dxs.forEach((dx, k) => {
        expect(dx - (premier[k] ?? NaN), `rang ${String(r + 1)}, plant ${String(k)}`).toBeCloseTo(r % 2 === 1 ? pas / 2 : 0, 6);
      });
    });
  });
});

describe('T46 : lignes de rang (sillon, goutte-à-goutte)', () => {
  it('un plant n’est pas plus large que l’écart entre rangs : deux rangs voisins ne se touchent pas', () => {
    const v = volume();
    const serre = poser(v, culture({ ecartementM: 0.3, ecartEntreRangsM: 0.18, rangsParPlanche: 4 }));
    expect(serre.echelleHorizontale).toBeLessThan(0.18);
    // Sans écart saisi, rien ne change.
    expect(poser(v, culture({ ecartementM: 0.3 })).echelleHorizontale).toBeCloseTo(poser(v, culture({ ecartementM: 0.3, rangsParPlanche: 4 })).echelleHorizontale, 9);
  });

  it('une ligne par rang, à la position en travers des plants du rang', () => {
    const v = volume({ angle: 0.4 });
    const p = poser(v, culture({ ecartEntreRangsM: 0.18, rangsParPlanche: 4 }));
    expect(p.lignesRangs).toHaveLength(4);
    expect(rangsDz(v, p.lignesRangs)).toEqual(rangsDz(v, p.positions));
    // Au milieu de la planche, dans le sens de la longueur.
    for (const { dx } of locales(v, p.lignesRangs)) expect(dx).toBeCloseTo(0, 6);
  });

  it('aucune ligne sur une gouttière hors-sol', () => {
    const p = poser(volume(), culture({ espece: 'Fraisier', ecartEntreRangsM: 0.25, rangsParPlanche: 2 }), true);
    expect(p.surelevationM).toBeGreaterThan(0);
    expect(p.lignesRangs).toEqual([]);
  });
});

describe('T46 : l’écart est lu dans l’instantané de la série', () => {
  const VIDE: LignesPlants = { occupations: [], campagnes: [], zones: [], emplacements: [] };
  const ligne = (parametres: string | null) => ({ id: 'o1', plantation_id: null, prevu_du: '2027-05-01', prevu_au: '2027-10-15', reel_du: null, reel_au: null, s_parametres: parametres, s_mise_en_place: '2027-05-03', s_debut_recolte: '2027-07-01', s_fin_recolte: '2027-09-15', e_nom: 'Laitue', e_profil: null });
  const densite = (extra: Record<string, unknown>) => JSON.stringify({ densite: { facon: 'ecartement', rangsParPlanche: 4, ecartementSurRangCm: 30, ...extra } });
  const lue = (parametres: string | null): CultureDePlanche => {
    const c = construireCultures({ ...VIDE, occupations: [ligne(parametres)] }).parOccupation.get('o1');
    if (c === undefined) throw new Error('culture attendue');
    return cultureAu(c, JOUR);
  };

  it('écart de 18 cm et 4 rangs → 0,18 m et 4 rangs', () => {
    const c = lue(densite({ ecartEntreRangsCm: 18 }));
    expect(c.ecartEntreRangsM).toBeCloseTo(0.18, 9);
    expect(c.rangsParPlanche).toBe(4);
  });

  it('au mètre linéaire aussi', () => {
    const c = lue(JSON.stringify({ densite: { facon: 'metre_lineaire', rangsParPlanche: 3, grainesParMetre: 40, ecartEntreRangsCm: 25 } }));
    expect(c.ecartEntreRangsM).toBeCloseTo(0.25, 9);
    expect(c.rangsParPlanche).toBe(3);
  });

  it('absent, hors bornes, pas un nombre, à la volée ou illisible → pas d’écart (bandes égales)', () => {
    for (const p of [densite({}), densite({ ecartEntreRangsCm: 2 }), densite({ ecartEntreRangsCm: 250 }), densite({ ecartEntreRangsCm: '18' }), densite({ ecartEntreRangsCm: null }), JSON.stringify({ densite: { facon: 'volee', largeurSemeeCm: 80, doseGParM2: 5, ecartEntreRangsCm: 18 } }), '{pas du json', null]) {
      expect(lue(p).ecartEntreRangsM, String(p)).toBeUndefined();
    }
  });

  it('de la lecture au dessin : 4 rangs centrés à 18 cm sur 75 cm', () => {
    const v = volume();
    const dz = rangsDz(v, poser(v, lue(densite({ ecartEntreRangsCm: 18 }))).positions);
    [-0.27, -0.09, 0.09, 0.27].forEach((attendu, i) => {
      expect(dz[i]).toBeCloseTo(attendu, 4);
    });
  });
});

// ── Rendu : un seul maillage d'accessoires ───────────────────────────────────────────────────

describe('T46 : les lignes de rang dans le maillage partagé des accessoires', () => {
  const vol = (i: number): VolumeScene => ({ id: `p${String(i)}`, code: `P${String(i)}`, zoneId: 'z', x: 3 * i, z: 0, longueur: 9, largeur: 0.75, hauteur: 0.3, angle: 0, placee: true, couleur: '#2E7D32', cleFamille: null, culture: 'Tomate', occupationId: `o${String(i)}` });
  function banc(): { scene: Scene; plants: (PlantsPlanche | null)[] } {
    const volumes = [vol(0), vol(1)];
    const cultures = [culture({ espece: 'Tomate', ecartementM: 0.5, ecartEntreRangsM: 0.4, rangsParPlanche: 2 }), culture({ espece: 'Laitue', ecartEntreRangsM: 0.18, rangsParPlanche: 4 })];
    const plants = volumes.map((v, i) => plantsDePlanche({ volume: v, culture: cultures[i] ?? null, jour: d('2027-08-02'), horsSol: false }));
    return { scene: { semaine: 0, libelleSemaine: 'S01', socles: [], volumes, batiments: [] }, plants };
  }
  function monter(y: number) {
    const { scene, plants } = banc();
    const rendu = new RenduPlants();
    for (const forme of FORMES) rendu.lierMaillage(forme, new InstancedMesh(rendu.geometrie(forme), new MeshBasicMaterial(), 2048));
    const unique = new InstancedMesh(rendu.geometrieFruit(), new MeshBasicMaterial(), 4096);
    rendu.lierPoteaux(unique);
    rendu.lierTuteurs(unique);
    rendu.lierFruits(unique);
    rendu.lierBalises(unique);
    rendu.choisirDetail(scene, plants, 1.5, y, 4, 800);
    const bilan = rendu.poser(scene, appliquerFiltres(scene, FILTRES_TOUT), plants);
    return { scene, plants, rendu, unique, bilan };
  }

  it('de près : une ligne par rang (2 + 4), comptées dans le même maillage que tuteurs, fruits et balises', () => {
    const { rendu, unique, bilan } = monter(6);
    expect(rendu.enDetail(0) && rendu.enDetail(1)).toBe(true);
    expect(bilan.lignesRangs).toBe(6);
    expect(unique.count).toBe(bilan.tuteurs + bilan.lignesRangs + bilan.fruits + bilan.balises);
    // Aucun recouvrement d'instances.
    const vues = new Set<string>();
    const m = new Matrix4();
    for (let i = 0; i < unique.count; i += 1) {
      unique.getMatrixAt(i, m);
      const cle = m.elements.map((e) => e.toFixed(5)).join(',');
      expect(vues.has(cle), `instance ${String(i)}`).toBe(false);
      vues.add(cle);
    }
  });

  it('une ligne est longue, fine et basse : posée sur la dalle, sous les plants, le long du rang', () => {
    const { scene, plants, unique, bilan } = monter(6);
    const m = new Matrix4();
    const position = new Vector3();
    const echelle = new Vector3();
    const lignes: { x: number; y: number; z: number; ex: number; ey: number; ez: number }[] = [];
    for (let i = 0; i < unique.count; i += 1) {
      unique.getMatrixAt(i, m);
      position.setFromMatrixPosition(m);
      echelle.setFromMatrixScale(m);
      if (echelle.x > 1) lignes.push({ x: position.x, y: position.y, z: position.z, ex: echelle.x, ey: echelle.y, ez: echelle.z });
    }
    expect(lignes).toHaveLength(bilan.lignesRangs);
    const longueur = scene.volumes[0]?.longueur ?? 0;
    for (const l of lignes) {
      expect(l.ex).toBeLessThanOrEqual(longueur);
      expect(l.ex).toBeGreaterThan(longueur * 0.8);
      expect(l.ey).toBeLessThan(0.05);
      expect(l.ez).toBeLessThan(0.06);
    }
    const attendus = plants.flatMap((p) => p?.lignesRangs ?? []).map((q) => Math.round(q.z * 1e4)).sort((a, b) => a - b);
    expect(lignes.map((l) => Math.round(l.z * 1e4)).sort((a, b) => a - b)).toEqual(attendus);
  });

  it('de loin, en masse : aucune ligne', () => {
    const { bilan, unique } = monter(5_000);
    expect(bilan.lignesRangs).toBe(0);
    expect(unique.count).toBe(bilan.balises + bilan.fruits);
  });
});
