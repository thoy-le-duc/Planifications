import { programmerEnregistrementServiceWorker } from './serviceWorker.ts';

/** Marque posée au premier affichage de l'appli : les tests de performance la mesurent. */
export const MARQUE_APP_PRETE = 'app-prete';

/**
 * Pose la marque une seule fois, au premier écran réellement affiché (coquille ou connexion), puis
 * programme l'enregistrement du service worker au repos (T20) : le précache ne passe jamais avant
 * le premier affichage.
 */
export function marquerAppPrete(): void {
  if (performance.getEntriesByName(MARQUE_APP_PRETE, 'mark').length > 0) return;
  performance.mark(MARQUE_APP_PRETE);
  programmerEnregistrementServiceWorker();
}
