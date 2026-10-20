/**
 * T66 — préchargement complet d'un import dynamique, comme l'aide de Vite 8 (`preload`, dans
 * vite/dist/node/chunks/node.js), hors du JavaScript de démarrage : son propre morceau, importé
 * par celui de l'aiguillage (src/aiguillage.ts) ; l'aide légère (./aide.ts) l'appelle pour tout
 * import qui a des dépendances.
 *
 * Pour chaque dépendance, une seule fois par page : `<link rel="modulepreload">` pour un fichier
 * JavaScript (préchargé en parallèle, non attendu), `<link rel="stylesheet">` pour une feuille de
 * style (attendue : l'écran ne s'affiche pas sans son habillage). Un fichier déjà cité par la
 * page (index.html, ou un lien déjà posé) n'est pas redemandé. Puis l'import ; tout échec lance
 * `vite:preloadError` (./aide.ts, signalerEchec).
 */
import { signalerEchec } from './aide.ts';

/** Fichiers déjà demandés (adresse absolue), pour toute la page. */
const vus = new Set<string>();

/** Adresse absolue d'un fichier du build (`assets/x.js`), sous la base de l'appli. */
export function adresse(dep: string): string {
  return new URL(import.meta.env.BASE_URL + dep, document.baseURI).href;
}

function nonceCsp(): string | null {
  const meta = document.querySelector<HTMLMetaElement>('meta[property=csp-nonce]');
  if (meta === null) return null;
  // Le nonce se cache derrière la propriété `nonce` (l'attribut se vide une fois lu) : l'une, sinon l'autre.
  return meta.nonce !== '' ? meta.nonce : meta.getAttribute('nonce');
}

/** Pose le lien d'une dépendance ; rend la promesse du chargement pour une feuille de style. */
function demander(dep: string, nonce: string | null): Promise<unknown> | undefined {
  const href = adresse(dep);
  if (vus.has(href)) return undefined;
  vus.add(href);
  const css = href.endsWith('.css');
  const liens = document.getElementsByTagName('link');
  for (let i = liens.length - 1; i >= 0; i--) {
    const l = liens[i];
    if (l?.href === href && (!css || l.rel === 'stylesheet')) return undefined;
  }
  const lien = document.createElement('link');
  lien.rel = css ? 'stylesheet' : 'modulepreload';
  if (!css) lien.as = 'script';
  lien.crossOrigin = '';
  lien.href = href;
  if (nonce !== null && nonce !== '') lien.setAttribute('nonce', nonce);
  document.head.appendChild(lien);
  if (!css) return undefined;
  return new Promise((tenir, rompre) => {
    lien.addEventListener('load', tenir);
    lien.addEventListener('error', () => {
      rompre(new Error(`Unable to preload CSS for ${href}`));
    });
  });
}

export async function precharger<T>(charger: () => Promise<T>, deps: readonly string[]): Promise<T> {
  const nonce = nonceCsp();
  const attentes = deps.map((d) => demander(d, nonce)).filter((p): p is Promise<unknown> => p !== undefined);
  for (const resultat of await Promise.allSettled(attentes)) {
    if (resultat.status === 'rejected') signalerEchec(resultat.reason);
  }
  return charger().catch(signalerEchec);
}
