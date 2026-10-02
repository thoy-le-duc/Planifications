/** Marque posée au premier affichage de l'appli : les tests de performance la mesurent. */
export const MARQUE_APP_PRETE = 'app-prete';

/**
 * Pose la marque une seule fois, au premier écran réellement affiché (coquille ou connexion), puis
 * programme l'enregistrement du service worker au repos (T20) : le précache ne passe jamais avant
 * le premier affichage.
 *
 * T18 : le module d'enregistrement est chargé à la demande, après le premier affichage : il sort
 * du JavaScript de démarrage et laisse la place à public/theme-initial.js sans relever le budget.
 * S'il ne se charge pas (hors ligne avant toute installation), l'appli marche en ligne et le
 * service worker sera enregistré à la prochaine visite.
 */
export function marquerAppPrete(): void {
  if (performance.getEntriesByName(MARQUE_APP_PRETE, 'mark').length > 0) return;
  performance.mark(MARQUE_APP_PRETE);
  import('./serviceWorker.ts').then(
    (m) => {
      m.programmerEnregistrementServiceWorker();
    },
    () => undefined,
  );
}
