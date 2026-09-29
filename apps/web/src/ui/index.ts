/**
 * Interface de l'appli (T16) : jetons (./jetons.ts) et composants repris des maquettes validées.
 * CSS et React seuls, aucune bibliothèque d'interface.
 *
 * Dans l'appli, importer depuis le fichier du composant plutôt que d'ici : le découpage en
 * fichiers garde hors du JavaScript de démarrage ce que la coquille n'utilise pas.
 */
export { BarreNavigation, EnTete, ONGLETS, Pastille, type Onglet, type ProprietesBarreNavigation, type ProprietesEnTete, type ProprietesPastille } from './composants.tsx';
export { AlerteOrange, BoutonPrincipal, BoutonSecondaire, CARTE, type ProprietesAlerteOrange } from './elements.tsx';
export { CarteTache, type Bande, type ProprietesCarteTache } from './carte-tache.tsx';
export { Confirmation, type ProprietesConfirmation } from './confirmation.tsx';
