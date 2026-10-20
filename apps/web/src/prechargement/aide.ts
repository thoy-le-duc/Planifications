/**
 * T66 — aide de préchargement des imports dynamiques, à la place de celle de Vite
 * (`\0vite/preload-helper.js`, remplacée par vite.config.ts : `aidePrechargementLegere`).
 *
 * Vite enveloppe chaque `import()` de l'appli : `__vitePreload(() => import('./x.js'), deps)`, où
 * `deps` liste les fichiers que l'écran importe (préchargés en parallèle) et ses feuilles de style
 * (attendues avant l'écran). Son aide entière (≈ 0,5 Kio gzip) vivait dans le morceau d'entrée,
 * avec la table de tous les fichiers des écrans (≈ 0,5 Kio de noms hachés).
 *
 * Ici, seul ce qui sert au démarrage :
 *   - sans dépendance (`deps` vide : le morceau d'aiguillage, l'enregistrement du service worker,
 *     la préparation des écrans), l'import part tel quel ;
 *   - avec dépendances, l'aide complète (./complet.ts, son propre morceau, que le morceau
 *     d'aiguillage importe) précharge et attend les feuilles de style, comme Vite.
 * Dans les deux cas, un échec lance `vite:preloadError` sur window, comme Vite : un écran dont le
 * fichier a disparu après une mise à jour recharge la page (rechargement.ts, T11b).
 */

import { chargerComplet } from './charger-complet.ts';

type Charger<T> = () => Promise<T>;

/** Échec d'un import : `vite:preloadError`, annulable ; s'il n'est pas annulé, l'erreur suit son cours. */
export function signalerEchec(erreur: unknown): never {
  const evenement = new Event('vite:preloadError', { cancelable: true }) as Event & { payload?: unknown };
  evenement.payload = erreur;
  window.dispatchEvent(evenement);
  if (!evenement.defaultPrevented) throw erreur;
  // Annulé (la page se recharge) : l'import ne rend rien, comme avec l'aide de Vite.
  return undefined as never;
}

/**
 * Aide de l'appli : `vite.config.ts` la sert à la place de `__vitePreload`. Sans dépendance,
 * l'import tel quel ; avec, l'aide complète (./charger-complet.ts), déjà chargée en pratique :
 * le morceau d'aiguillage l'importe, et il est demandé avant le premier rendu.
 */
export function prechargerLeger<T>(charger: Charger<T>, deps?: readonly string[]): Promise<T> {
  if (deps === undefined || deps.length === 0) return charger().catch(signalerEchec);
  return chargerComplet().then((precharger) => precharger(charger, deps), signalerEchec);
}
