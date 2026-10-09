/**
 * Tests d'acceptation T28h (fonctions pures) — recherche d'adresse (Géoplateforme), zoom adapté au
 * type de résultat, recul à 6, cadrage d'une emprise (« Aller à », « Toute la ferme »).
 * API attendue : ./test/contrat-adresse.ts (modules ./adresse.ts, ./sites.ts, ./tuiles.ts).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { reponseGeocodage, MOISSAC, NUMERO_MOISSAC, RUE_MOISSAC, type ModuleAdresse, type ModuleSites, type ModuleTuilesT28h } from './test/contrat-adresse.ts';
import { metresParPixel } from './tuiles.ts';

const CHEMIN_ADRESSE = './adresse.ts';
const CHEMIN_SITES = './sites.ts';
const CHEMIN_TUILES = './tuiles.ts';

let a: ModuleAdresse;
let s: ModuleSites;
let t: ModuleTuilesT28h;

beforeAll(async () => {
  a = (await import(/* @vite-ignore */ CHEMIN_ADRESSE)) as ModuleAdresse;
  s = (await import(/* @vite-ignore */ CHEMIN_SITES)) as ModuleSites;
  t = (await import(/* @vite-ignore */ CHEMIN_TUILES)) as ModuleTuilesT28h;
});

describe('T28h : URL de recherche', () => {
  it('constantes : service de la Géoplateforme, 5 propositions, 300 ms', () => {
    expect(a.URL_GEOCODAGE).toBe('https://data.geopf.fr/geocodage/search');
    expect(a.PROPOSITIONS_MAX).toBe(5);
    expect(a.DELAI_SAISIE_MS).toBe(300);
  });

  it('q = texte rogné, limit = 5, aucune clé', () => {
    const u = a.urlRechercheAdresse('  Moissac ');
    expect(u).not.toBeNull();
    const url = new URL(u ?? '');
    expect(url.origin + url.pathname).toBe('https://data.geopf.fr/geocodage/search');
    expect(url.searchParams.get('q')).toBe('Moissac');
    expect(url.searchParams.get('limit')).toBe('5');
    expect([...url.searchParams.keys()].sort()).toEqual(['limit', 'q']);
  });

  it('accents, espaces, esperluette et « # » sont encodés : un seul paramètre q', () => {
    const texte = 'Saint-Étienne & fils #3, 12 rue du Château';
    const url = new URL(a.urlRechercheAdresse(texte) ?? '');
    expect(url.searchParams.get('q')).toBe(texte);
    expect(url.hash).toBe('');
    expect([...url.searchParams.keys()].sort()).toEqual(['limit', 'q']);
  });

  it('texte vide ou fait d’espaces : pas de requête (null)', () => {
    expect(a.urlRechercheAdresse('')).toBeNull();
    expect(a.urlRechercheAdresse('   \t ')).toBeNull();
  });
});

describe('T28h : analyse de la réponse GeoJSON', () => {
  it('coordonnées [longitude, latitude] : latitude et longitude ne sont pas inversées', () => {
    const [p] = a.analyserReponseAdresse(reponseGeocodage([MOISSAC]));
    expect(p?.libelle).toBe('Moissac');
    expect(p?.latitude).toBeCloseTo(44.1043, 6);
    expect(p?.longitude).toBeCloseTo(1.0868, 6);
    expect(p?.type).toBe('municipality');
  });

  it('chaque proposition porte le zoom de son type', () => {
    const r = a.analyserReponseAdresse(reponseGeocodage([MOISSAC, RUE_MOISSAC, NUMERO_MOISSAC]));
    expect(r.map((p) => p.zoom)).toEqual([a.zoomPourType('municipality'), a.zoomPourType('street'), a.zoomPourType('housenumber')]);
  });

  it('au plus 5 propositions, dans l’ordre reçu', () => {
    const sept = Array.from({ length: 7 }, (_, i) => ({ label: `Lieu ${String(i)}`, type: 'street', longitude: 1 + i / 100, latitude: 44 }));
    const r = a.analyserReponseAdresse(reponseGeocodage(sept));
    expect(r.map((p) => p.libelle)).toEqual(['Lieu 0', 'Lieu 1', 'Lieu 2', 'Lieu 3', 'Lieu 4']);
  });

  it('ignore une feature sans libellé, sans coordonnées numériques finies ou hors du globe', () => {
    const json = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 44] }, properties: { type: 'street' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: ['1', '44'] }, properties: { label: 'texte', type: 'street' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [Number.NaN, 44] }, properties: { label: 'nan', type: 'street' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [1] }, properties: { label: 'court', type: 'street' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 95] }, properties: { label: 'pôle dépassé', type: 'street' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [200, 44] }, properties: { label: 'méridien dépassé', type: 'street' } },
        { type: 'Feature', geometry: null, properties: { label: 'sans géométrie', type: 'street' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [1.1, 44.2] }, properties: { label: 'bonne', type: 'locality' } },
      ],
    };
    expect(a.analyserReponseAdresse(json).map((p) => p.libelle)).toEqual(['bonne']);
  });

  it('toute autre forme : liste vide, sans lever', () => {
    for (const x of [null, undefined, 42, 'texte', [], {}, { features: 'non' }, { features: null }, { features: [] }, { features: [null, 3, 'x'] }]) {
      expect(a.analyserReponseAdresse(x)).toEqual([]);
    }
  });
});

describe('T28h : zoom adapté au type de résultat', () => {
  it('commune : vue large ; rue ou numéro : vue serrée ; ordre croissant avec la précision', () => {
    const z = (x: string): number => a.zoomPourType(x);
    expect(z('municipality')).toBeLessThanOrEqual(13);
    expect(z('municipality')).toBeGreaterThanOrEqual(10);
    expect(z('street')).toBeGreaterThanOrEqual(17);
    expect(z('housenumber')).toBeGreaterThanOrEqual(18);
    expect(z('municipality')).toBeLessThan(z('locality'));
    expect(z('locality')).toBeLessThan(z('street'));
    expect(z('street')).toBeLessThanOrEqual(z('housenumber'));
  });

  it('entiers dans [ZOOM_MIN_VUE, ZOOM_TUILES_MAX], type inconnu compris', () => {
    for (const x of ['municipality', 'locality', 'street', 'housenumber', 'district', '', 'inconnu']) {
      const z = a.zoomPourType(x);
      expect(Number.isInteger(z), x).toBe(true);
      expect(z).toBeGreaterThanOrEqual(t.ZOOM_MIN_VUE);
      expect(z).toBeLessThanOrEqual(t.ZOOM_TUILES_MAX);
    }
  });
});

describe('T28h : zoom minimal et zoom de départ', () => {
  it('ZOOM_MIN_VUE = 6 ; départ sans position à 6 (la France entière ou presque) ; zoom de départ avec origine inchangé', () => {
    expect(t.ZOOM_MIN_VUE).toBe(6);
    expect(t.ZOOM_DEPART_SANS_POSITION).toBe(6);
    expect(t.ZOOM_INITIAL).toBe(19);
    expect(t.ZOOM_TUILES_MAX).toBe(19);
  });
});

describe('T28h : vueSurEmprise (cadrage pour « Aller à » et « Toute la ferme »)', () => {
  const ecran = { largeurPx: 1000, hauteurPx: 800 };

  it('centre au milieu de l’emprise', () => {
    const r = s.vueSurEmprise({ minX: 100, maxX: 20140, minY: 0, maxY: 30 }, ecran, 44);
    expect(r.centre.x).toBeCloseTo(10120, 6);
    expect(r.centre.y).toBeCloseTo(15, 6);
  });

  it('deux sites à 20 km : le plus grand zoom où l’emprise tient en 90 % de la largeur (ici 12)', () => {
    const r = s.vueSurEmprise({ minX: 100, maxX: 20140, minY: 0, maxY: 30 }, ecran, 44);
    expect(r.zoom).toBe(12);
    expect(20040 / metresParPixel(44, r.zoom)).toBeLessThanOrEqual(0.9 * ecran.largeurPx);
    expect(20040 / metresParPixel(44, r.zoom + 1)).toBeGreaterThan(0.9 * ecran.largeurPx);
  });

  it('emprise haute et étroite : c’est la hauteur qui décide (ici 14)', () => {
    const r = s.vueSurEmprise({ minX: 0, maxX: 100, minY: 0, maxY: 3000 }, ecran, 44);
    expect(r.zoom).toBe(14);
  });

  it('une zone de 40 × 30 m : plafonné à ZOOM_TUILES_MAX ; un point aussi', () => {
    expect(s.vueSurEmprise({ minX: 100, maxX: 140, minY: 0, maxY: 30 }, ecran, 44).zoom).toBe(19);
    const point = s.vueSurEmprise({ minX: 5, maxX: 5, minY: -7, maxY: -7 }, ecran, 44);
    expect(point.zoom).toBe(19);
    expect(point.centre).toEqual({ x: 5, y: -7 });
  });

  it('emprise démesurée : plancher à ZOOM_MIN_VUE', () => {
    expect(s.vueSurEmprise({ minX: 0, maxX: 5_000_000, minY: 0, maxY: 10 }, ecran, 44).zoom).toBe(6);
  });
});
