/**
 * Éditeur de placement sur la photo aérienne (T28b). À charger par import dynamique seulement,
 * depuis l'écran Ferme : hors du JavaScript de démarrage et hors du morceau Ferme. N'importe ni
 * PowerSync ni src/donnees : l'éditeur reçoit la porte. Contrat : ./test/contrat.ts.
 */
export { DELAI_ANNULATION_MS, EditeurPlacement, EditeurPlacement as default, type ProprietesEditeurPlacement } from './EditeurPlacement.tsx';
