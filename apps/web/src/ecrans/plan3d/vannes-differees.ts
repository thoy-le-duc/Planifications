/**
 * T57 (relecture de la PR #213) : relais de chargement des vannes de la vue 3D. Le morceau 3D
 * n'importe que ce relais, à la demande ; la liste des fichiers que Vannes3d.tsx précharge (saisie,
 * cœur, styles) vit dans ce petit morceau-ci et non dans celui de la 3D (budget jsVue3dGzKio). Un
 * aller-retour de plus au premier affichage, servi par le service worker (précache).
 */
import type { ReactNode } from 'react';
import type { ProprietesVannes3d } from './Vannes3d.tsx';

export const chargerVannes3d = (): Promise<{ default: (p: ProprietesVannes3d) => ReactNode }> => import('./Vannes3d.tsx');
