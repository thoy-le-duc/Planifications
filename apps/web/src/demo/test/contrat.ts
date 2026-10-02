/**
 * Contrat de T25 — démo en ligne (docs/backlog/T25-demo-en-ligne.md). Fichier de test : les
 * tests (scripts/demo.test.ts, scripts/vercel.test.ts, e2e/demo.e2e.ts) le lisent, le code de
 * production ne l'importe jamais (sinon ces valeurs entreraient dans le build de production).
 *
 * ── Ce que le développeur doit réaliser ──────────────────────────────────────────────────────
 *
 * Build : `pnpm --filter @planif/web build:demo` (`vite build --mode demo`) → apps/web/dist-demo/,
 *   l'appli complète (index.html, sw.js, précache, manifeste) AVEC le mode démo ; ajouter
 *   `dist-demo/` à .gitignore. Le build de production (`vite build`) et celui des essais ne
 *   changent pas et ne contiennent RIEN de ce qui suit.
 *
 * Mode démo (actif seulement dans le build `--mode demo`, point d'entrée dans src/main.tsx /
 *   src/App.tsx, code sous src/demo/**, chargé à la demande) :
 *   - pas d'écran de connexion : l'utilisateur UTILISATEUR_DEMO et la ferme FERME_DEMO (ci-dessous)
 *     sont ouverts d'emblée ; la synchro n'est jamais branchée, aucune requête vers l'API ni
 *     PowerSync (le build démo se fait SANS VITE_API_URL ni VITE_POWERSYNC_URL, la CSP aussi) ;
 *   - base vide au premier lancement → remplie avec les jeux de test existants (fermeDuJour,
 *     fermeSerie, fermeItineraires, refus), datés par rapport au jour du téléphone, et rattachés à
 *     UTILISATEUR_DEMO / FERME_DEMO (le développeur réécrit les identifiants de l'utilisateur et de
 *     la ferme des jeux) ; l'écran Aujourd'hui montre alors des tâches (data-testid="tache") ;
 *   - bandeau : data-testid="demo-bandeau", texte exact TEXTE_BANDEAU, visible sur l'écran
 *     Aujourd'hui (discret, mais présent) ;
 *   - bouton « Réinitialiser la démo » : data-testid="demo-reinitialiser" (nom accessible
 *     « Réinitialiser la démo »). Il ouvre une confirmation, role="alertdialog", avec deux
 *     boutons : data-testid="demo-reinitialiser-confirmer" (nom « Réinitialiser ») et
 *     data-testid="demo-reinitialiser-annuler" (nom « Annuler »). Confirmer efface la base locale
 *     de la démo et la remplit à nouveau (les tâches faites reviennent) ; annuler ne change rien.
 *   - hors ligne : service worker et précache comme la vraie appli ; rechargement sans réseau OK.
 *
 * vercel.json (apps/web/vercel.json) : voir scripts/vercel.test.ts.
 */

/** Identifiants fixes de la démo. Ne doivent apparaître QUE dans dist-demo/, jamais dans dist/. */
export const UTILISATEUR_DEMO = '0192f0c1-de00-7000-8000-000000000001';
export const FERME_DEMO = '0192f0c1-de00-7000-8000-000000000002';

/** Texte exact du bandeau. Jamais dans dist/. */
export const TEXTE_BANDEAU = 'Démo — données fictives';

export const TEXTE_REINITIALISER = 'Réinitialiser la démo';

export const TESTID = {
  bandeau: 'demo-bandeau',
  reinitialiser: 'demo-reinitialiser',
  confirmer: 'demo-reinitialiser-confirmer',
  annuler: 'demo-reinitialiser-annuler',
} as const;

/**
 * Chaînes propres aux jeux de test (noms de la ferme et de l'utilisateur des jeux), présentes dans
 * les sources des jeux et qui survivent à la minification. Le développeur peut les remplacer dans
 * dist-demo/ par des noms de démo, mais elles ne doivent JAMAIS être dans dist/.
 */
export const NOMS_DES_JEUX: readonly string[] = [
  'Ferme du jour (tests)',
  'Ferme du plan (tests)',
  'Ferme des itinéraires (tests)',
  'Théophane (test)',
  'Théophane (test plan)',
  'Théophane (test itinéraires)',
  'Filderkraut',
  '0192f0c1-1313-7000-8000-', // préfixe des identifiants des jeux de test
];

/** Dossier de sortie de `build:demo`, relatif à apps/web. */
export const DOSSIER_DEMO = 'dist-demo';
