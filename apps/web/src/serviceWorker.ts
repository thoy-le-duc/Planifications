/**
 * T20 — enregistrement du service worker APRÈS le premier affichage, au repos.
 *
 * Le précache (2,8 Mio, WASM de SQLite compris) ne doit jamais concurrencer le premier affichage :
 * l'enregistrement n'est programmé qu'une fois la marque de premier affichage posée
 * (`marquerAppPrete`), puis attend que le navigateur soit au repos (`requestIdleCallback`, repli
 * sur `setTimeout` là où il n'existe pas, Safari notamment). Jamais au `load` de la fenêtre : sur
 * une machine lente, `load` passe avant le premier affichage (écrans chargés à la demande).
 *
 * Mise à jour (registerType « autoUpdate ») : le service worker généré appelle `skipWaiting` et
 * `clientsClaim` (vite.config.ts) ; une nouvelle version prend la main dès son installation, sans
 * recharger la page sous les doigts du maraîcher. Le navigateur revérifie `sw.js` à chaque
 * navigation.
 */

/** Marque posée juste avant `navigator.serviceWorker.register` (le test e2e la guette). */
export const MARQUE_SW_ENREGISTRE = 'planif:sw-enregistre';

/** Au plus tard, l'enregistrement part après ce délai même si la page n'est jamais au repos. */
const DELAI_MAX_REPOS_MS = 10_000;

/** Repli sans requestIdleCallback : laisser passer les tâches du premier affichage. */
const DELAI_REPLI_MS = 1_000;

let programme = false;

function enregistrer(): void {
  performance.mark(MARQUE_SW_ENREGISTRE);
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch((erreur: unknown) => {
    // Sans service worker, l'appli marche en ligne ; le hors-ligne reviendra à la prochaine visite.
    console.warn('Service worker non enregistré', erreur);
  });
}

/**
 * Programme l'enregistrement du service worker, une seule fois. À appeler après la marque de
 * premier affichage. Sans effet hors du build de production (développement, tests unitaires) et
 * dans un navigateur sans service worker.
 */
export function programmerEnregistrementServiceWorker(): void {
  if (programme || !import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  programme = true;
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(enregistrer, { timeout: DELAI_MAX_REPOS_MS });
  } else {
    window.setTimeout(enregistrer, DELAI_REPLI_MS);
  }
}
