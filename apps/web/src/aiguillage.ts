/**
 * T66 — aiguillage des modules chargés à la demande par le JavaScript de démarrage (App.tsx,
 * perf.ts). Morceau à part, demandé dès le démarrage
 * (./vers-aiguillage.ts, avant le premier rendu) : c'est lui, et non le morceau d'entrée, qui
 * porte les imports des écrans, donc la table des fichiers à précharger avec chacun (noms hachés
 * de leurs morceaux et feuilles de style). Le morceau d'entrée ne cite plus que ce fichier-ci
 * et l'aide de préchargement complète (src/prechargement/charger-complet.ts), chargée avec lui.
 *
 * Mêmes écrans, mêmes préchargements qu'avant ; tous dans le précache du service worker.
 */
export const accueil = () => import('./ecrans/accueil/Accueil.tsx');
export const ferme = () => import('./ecrans/ferme/EcranFerme.tsx');
export const planches = () => import('./ecrans/plan/index.ts');
export const aujourdhui = () => import('./ecrans/aujourdhui/index.ts');
export const creerFerme = () => import('./ecrans/creer-ferme/EcranCreerFerme.tsx');
export const donneesAppli = () => import('./donnees/appli.ts');
export const precharger = () => import('./donnees/precharger.ts');
export const serviceWorker = () => import('./serviceWorker.ts');
