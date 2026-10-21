/**
 * Tests d'acceptation T53 — chargement du catalogue e-phy (docs/backlog/T53-base-e-phy.md, règle 3) :
 * fichier statique de l'appli (`/ephy/catalogue.json`), chargé à la demande, gardé dans le cache
 * du navigateur (Cache API) à la première ouverture : disponible hors ligne ensuite. Hors du
 * précache du service worker (voir budget.ts) : la ferme qui ne s'en sert pas ne le télécharge pas.
 *
 * Contrat attendu de ./catalogue.ts :
 *   - `URL_CATALOGUE_EPHY` ('/ephy/catalogue.json'), `CACHE_CATALOGUE_EPHY` (nom du cache) ;
 *   - `chargerCatalogueEphy(env?)` avec `env = { fetch, caches }` (défaut : ceux du navigateur ;
 *     `caches` absent → réseau seul) : le cache d'abord s'il existe (affichage immédiat, hors ligne
 *     compris), mis à jour en arrière-plan ; sinon le réseau, puis mise en cache ; catalogue
 *     illisible ou hors ligne sans copie : `CatalogueIndisponible`, message en français.
 */
import { describe, expect, it } from 'vitest';
import type { CatalogueEphy } from '@planif/core/ephy';
import { CACHE_CATALOGUE_EPHY, CatalogueIndisponible, chargerCatalogueEphy, URL_CATALOGUE_EPHY } from './catalogue.ts';

const CATALOGUE: CatalogueEphy = { format: 1, source: 'E-Phy, Anses (data.gouv.fr)', licence: 'Licence Ouverte 2.0', dateBase: '2026-10-14', produits: [] };
const NOUVEAU: CatalogueEphy = { ...CATALOGUE, dateBase: '2026-10-21' };

const url = (r: RequestInfo | URL): string => (typeof r === 'string' ? r : r instanceof URL ? r.href : r.url);

/** Double de la Cache API : un seul cache, des réponses rangées par URL. */
function fauxCaches(): { caches: CacheStorage; ouverts: string[]; contenu: Map<string, Response> } {
  const contenu = new Map<string, Response>();
  const ouverts: string[] = [];
  const cache = {
    match: (r: RequestInfo | URL) => Promise.resolve(contenu.get(url(r))?.clone()),
    put: async (r: RequestInfo | URL, rep: Response) => {
      contenu.set(url(r), rep.clone());
      await Promise.resolve();
    },
  } as unknown as Cache;
  const caches = {
    open: (nom: string) => {
      ouverts.push(nom);
      return Promise.resolve(cache);
    },
  } as unknown as CacheStorage;
  return { caches, ouverts, contenu };
}

function reseau(reponse: () => Response): { fetch: typeof fetch; appels: string[] } {
  const appels: string[] = [];
  const f = ((r: RequestInfo | URL) => {
    appels.push(url(r));
    return Promise.resolve(reponse());
  }) as typeof fetch;
  return { fetch: f, appels };
}

const horsLigne = (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch;
const json = (c: unknown): Response => new Response(JSON.stringify(c), { status: 200, headers: { 'Content-Type': 'application/json' } });
const tour = () => new Promise((r) => setTimeout(r, 0));

describe('T53 : catalogue e-phy chargé à la demande, gardé hors ligne', () => {
  it('première ouverture : le réseau, puis la copie dans le cache', async () => {
    const c = fauxCaches();
    const r = reseau(() => json(CATALOGUE));
    expect(await chargerCatalogueEphy({ fetch: r.fetch, caches: c.caches })).toEqual(CATALOGUE);
    expect(r.appels).toEqual([URL_CATALOGUE_EPHY]);
    await tour();
    expect(c.ouverts).toContain(CACHE_CATALOGUE_EPHY);
    expect(c.contenu.has(URL_CATALOGUE_EPHY)).toBe(true);
  });

  it('hors ligne ensuite : la copie du cache', async () => {
    const c = fauxCaches();
    await chargerCatalogueEphy({ fetch: reseau(() => json(CATALOGUE)).fetch, caches: c.caches });
    await tour();
    expect(await chargerCatalogueEphy({ fetch: horsLigne, caches: c.caches })).toEqual(CATALOGUE);
  });

  it('copie en cache : rendue tout de suite, nouvelle version rangée pour la fois suivante', async () => {
    const c = fauxCaches();
    await chargerCatalogueEphy({ fetch: reseau(() => json(CATALOGUE)).fetch, caches: c.caches });
    await tour();
    const r = reseau(() => json(NOUVEAU));
    expect(await chargerCatalogueEphy({ fetch: r.fetch, caches: c.caches })).toEqual(CATALOGUE);
    await tour();
    await tour();
    expect(await chargerCatalogueEphy({ fetch: horsLigne, caches: c.caches })).toEqual(NOUVEAU);
  });

  it('hors ligne sans copie, réponse en erreur ou catalogue illisible : CatalogueIndisponible', async () => {
    await expect(chargerCatalogueEphy({ fetch: horsLigne, caches: fauxCaches().caches })).rejects.toBeInstanceOf(CatalogueIndisponible);
    await expect(chargerCatalogueEphy({ fetch: reseau(() => new Response('absent', { status: 404 })).fetch, caches: fauxCaches().caches })).rejects.toBeInstanceOf(CatalogueIndisponible);
    const c = fauxCaches();
    await expect(chargerCatalogueEphy({ fetch: reseau(() => json({ format: 99 })).fetch, caches: c.caches })).rejects.toBeInstanceOf(CatalogueIndisponible);
    await tour();
    expect(c.contenu.size, 'un catalogue illisible n’est jamais mis en cache').toBe(0);
    await expect(chargerCatalogueEphy({ fetch: horsLigne, caches: fauxCaches().caches })).rejects.toThrow(/hors ligne|réseau/i);
  });

  it('sans Cache API (navigateur ancien, page non sécurisée) : le réseau seul', async () => {
    const r = reseau(() => json(CATALOGUE));
    expect(await chargerCatalogueEphy({ fetch: r.fetch, caches: undefined })).toEqual(CATALOGUE);
  });
});
