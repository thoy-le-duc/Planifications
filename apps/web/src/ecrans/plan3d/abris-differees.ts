/**
 * T58 : relais de chargement des serres de la vue 3D, comme celui des vannes (T57). Le morceau 3D
 * n'importe que ce relais, à la demande ; Abris3d.tsx (cœur des abris, panneau partagé
 * d'Aujourd'hui, styles) vit dans son propre morceau et non dans celui de la 3D (budget
 * jsVue3dGzKio).
 */
import type { ReactNode } from 'react';
import type { ProprietesAbris3d } from './Abris3d.tsx';

export const chargerAbris3d = (): Promise<{ default: (p: ProprietesAbris3d) => ReactNode }> => import('./Abris3d.tsx');
