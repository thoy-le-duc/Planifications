/**
 * T28i — ce que `fetch` a le droit de faire dans la démo. Pur : ni React ni navigateur.
 * Contrat : ./test/contrat-placement.ts (« Réseau de la démo »), tests : ./reseau.test.ts.
 *
 *   - la même origine que l'appli, sauf /api et /api/… (la synchro n'est jamais branchée) ;
 *   - la recherche d'adresse (T28h) : https://data.geopf.fr/geocodage/… et rien d'autre sur cet hôte
 *     (les tuiles de la photo passent par des <img>, jamais par `fetch`).
 */

/** Origine du géocodage de la Géoplateforme (la même que dans la politique de contenu). */
const ORIGINE_GEOPF = 'https://data.geopf.fr';
const CHEMIN_GEOCODAGE = '/geocodage/';

/** Vrai si la démo laisse partir cette requête `fetch`. */
export function reseauAutorise(url: URL, origineApp: string): boolean {
  if (url.origin === origineApp) {
    // Casse et encodage ramenés à une seule forme : /API/x ou /%61pi/x restent refusés (relecture T28i).
    let chemin: string;
    try {
      chemin = decodeURIComponent(url.pathname).toLowerCase();
    } catch {
      return false;
    }
    return chemin !== '/api' && !chemin.startsWith('/api/');
  }
  return url.origin === ORIGINE_GEOPF && url.username === '' && url.password === '' && url.pathname.startsWith(CHEMIN_GEOCODAGE);
}
