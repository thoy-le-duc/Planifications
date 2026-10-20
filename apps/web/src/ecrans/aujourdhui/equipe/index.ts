/**
 * T60 — consignes par ouvrier : morceau chargé à la demande par l'écran Aujourd'hui, une fois la
 * journée relue (jamais au démarrage). La vue 3D lit l'équipe par ./donnees.ts, chargé à part.
 */
export { estPourPersonne } from '@planif/core';
export { Consignes, prenomsDe, type ProprietesConsignes } from './Consignes.tsx';
export { suivreEquipe, type Equipe } from './donnees.ts';
