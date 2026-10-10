/**
 * Tests d'acceptation T28i — ce que `fetch` a le droit de faire dans la démo : le géocodage de la
 * Géoplateforme (recherche d'adresse T28h) et rien d'autre hors de l'origine. Contrat :
 * ./test/contrat-placement.ts (« Réseau de la démo »). Module pur ./reseau.ts, chargé par chemin
 * dynamique : ces tests typent avant que le code n'existe.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { ModuleReseauDemo } from './test/contrat-placement.ts';

const CHEMIN = './reseau.ts';
const APP = 'https://demo.planifications.example';
let m: ModuleReseauDemo;

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN)) as ModuleReseauDemo;
});

const ok = (url: string): boolean => m.reseauAutorise(new URL(url), APP);

describe('T28i : réseau de la démo', () => {
  it('même origine : autorisé, sauf /api', () => {
    expect(ok(`${APP}/assets/index-abc.js`)).toBe(true);
    expect(ok(`${APP}/manifest.webmanifest`)).toBe(true);
    expect(ok(`${APP}/api`)).toBe(false);
    expect(ok(`${APP}/api/v1/sync`)).toBe(false);
  });

  it('géocodage de la Géoplateforme : autorisé (recherche d’adresse)', () => {
    expect(ok('https://data.geopf.fr/geocodage/search?q=Moissac&limit=5')).toBe(true);
    expect(ok('https://data.geopf.fr/geocodage/completion/?text=Moi')).toBe(true);
  });

  it('rien d’autre sur data.geopf.fr : ni les tuiles par fetch, ni la racine', () => {
    expect(ok('https://data.geopf.fr/wmts?SERVICE=WMTS')).toBe(false);
    expect(ok('https://data.geopf.fr/')).toBe(false);
    expect(ok('https://data.geopf.fr/geocodage')).toBe(false);
    expect(ok('https://data.geopf.fr/autre/geocodage/search')).toBe(false);
  });

  it('hôtes voisins, http, autre port : refusés', () => {
    expect(ok('https://data.geopf.fr.evil.test/geocodage/search?q=x')).toBe(false);
    expect(ok('https://evil-data.geopf.fr/geocodage/search?q=x')).toBe(false);
    expect(ok('https://geopf.fr/geocodage/search?q=x')).toBe(false);
    expect(ok('http://data.geopf.fr/geocodage/search?q=x')).toBe(false);
    expect(ok('https://data.geopf.fr:8443/geocodage/search?q=x')).toBe(false);
    expect(ok('https://user@data.geopf.fr@evil.test/geocodage/search')).toBe(false);
  });

  it('API, PowerSync et tout autre service : refusés', () => {
    expect(ok('https://api.planif.fr/v1/ferme')).toBe(false);
    expect(ok('https://sync.planif.fr/sync/stream')).toBe(false);
    expect(ok('https://example.com/')).toBe(false);
  });
});
