/**
 * Catalogue e-phy (T53, règle 3) : fichier statique de l'appli, chargé à la demande (premier usage
 * de la recherche), jamais au démarrage.
 *
 * Hors ligne : gardé dans le cache du navigateur (Cache API) à la première ouverture, plutôt que
 * dans le précache du service worker. Choix : le précache le ferait télécharger (≈ 250 Kio
 * compressés) à chaque installation et à chaque mise à jour de l'appli, par toutes les fermes,
 * même celles qui ne s'en servent jamais ; ici, seule la ferme qui cherche un produit le charge,
 * une fois, et le retrouve sans réseau ensuite. La copie en cache est rendue tout de suite (au
 * champ, pas d'attente réseau), et la version du serveur est rangée en arrière-plan pour la fois
 * suivante (une nouvelle base sort chaque semaine).
 */
import { validerCatalogueEphy, type CatalogueEphy } from '@planif/core/ephy';

export const URL_CATALOGUE_EPHY = '/ephy/catalogue.json';
export const CACHE_CATALOGUE_EPHY = 'planif-catalogue-ephy';

/** Catalogue introuvable (hors ligne sans copie) ou illisible. */
export class CatalogueIndisponible extends Error {}

export interface EnvironnementCatalogue {
  readonly fetch: typeof fetch;
  readonly caches: CacheStorage | undefined;
}

function navigateur(): EnvironnementCatalogue {
  return { fetch: (...a) => globalThis.fetch(...a), caches: typeof caches === 'undefined' ? undefined : caches };
}

async function lireReponse(r: Response): Promise<CatalogueEphy | null> {
  try {
    return validerCatalogueEphy(await r.json());
  } catch {
    return null;
  }
}

async function ouvrir(env: EnvironnementCatalogue): Promise<Cache | null> {
  try {
    return (await env.caches?.open(CACHE_CATALOGUE_EPHY)) ?? null;
  } catch {
    return null;
  }
}

/** Réseau ; la réponse lisible est rangée dans le cache. Rend null si rien de lisible. */
async function depuisReseau(env: EnvironnementCatalogue, cache: Cache | null): Promise<CatalogueEphy | null> {
  const r = await env.fetch(URL_CATALOGUE_EPHY, { cache: 'no-cache' });
  if (!r.ok) return null;
  const copie = r.clone();
  const c = await lireReponse(r);
  if (c !== null && cache !== null) await cache.put(URL_CATALOGUE_EPHY, copie).catch(() => undefined);
  return c;
}

export async function chargerCatalogueEphy(env: EnvironnementCatalogue = navigateur()): Promise<CatalogueEphy> {
  const cache = await ouvrir(env);
  const enCache = cache === null ? undefined : await cache.match(URL_CATALOGUE_EPHY).catch(() => undefined);
  const copie = enCache === undefined ? null : await lireReponse(enCache);
  if (copie !== null) {
    // Mise à jour discrète pour la fois suivante ; hors ligne, rien à faire.
    depuisReseau(env, cache).catch(() => undefined);
    return copie;
  }
  let c: CatalogueEphy | null;
  try {
    c = await depuisReseau(env, cache);
  } catch {
    throw new CatalogueIndisponible('Base e-phy indisponible hors ligne : elle se charge une première fois avec du réseau, puis reste sur le téléphone.');
  }
  if (c === null) throw new CatalogueIndisponible('Base e-phy illisible sur le serveur. Réessayez plus tard ; la saisie à la main reste possible.');
  return c;
}
