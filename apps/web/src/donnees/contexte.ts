/**
 * Contexte React de la ferme ouverte (T11), fourni par la coquille (App.tsx) : les écrans de
 * données y lisent la porte et la ferme active, et rien d'autre. JavaScript de démarrage : aucun
 * import de @planif/sync ni de PowerSync (types seuls).
 */
import { createContext } from 'react';
import type { FermeOuverte } from './etat-appli.ts';

export const ContexteFerme = createContext<FermeOuverte | null>(null);
