/**
 * Export complet de la ferme (T15). À charger par import dynamique seulement
 * (`lazy(() => import('./ecrans/export/index.ts'))`) : hors du JavaScript de démarrage.
 * N'importe ni PowerSync ni l'ouverture de la base : l'écran reçoit la porte.
 */
export { EcranExport, type ProprietesEcranExport } from './EcranExport.tsx';
export { jourLocal, lancerExport, telechargerDansLeNavigateur, type OptionsLancerExport } from './lancer.ts';
