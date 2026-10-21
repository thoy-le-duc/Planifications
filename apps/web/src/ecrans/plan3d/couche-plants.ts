/**
 * Vue 3D (T71) — la couche des plants, chargée à la demande par la vue (./Vue3d.tsx), comme les
 * vannes (T57) : lecture de la base (T32b), calcul des plants d'une planche (T32a, moteur de
 * croissance du cœur), rendu instancié et géométries. Rien de tout cela ne sert au premier
 * affichage : les plants ne se dessinent qu'après la lecture de la base, lancée à l'ouverture.
 * Sorti du morceau 3D (budget jsVue3dGzKio, scripts/vue3d.test.ts) ; dans le précache comme tout
 * morceau de l'appli : hors ligne, les plants viennent aussi.
 */
export { cultureAu, lireCultures } from './donnees-plants.ts';
// T59 : les plants de la semaine selon « Prévu / Réalisé », pendant le déroulé de la saison.
export { AvancePlants, occupationsParPlanche, plantsDeLaSemaine, sceneSelonMode } from './deroule-plants.ts';
export { plantsDePlanche } from './plants.ts';
export { RenduPlants } from './plants-rendu.ts';
export { Plants } from './Plants.tsx';
