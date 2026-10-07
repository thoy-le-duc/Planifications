/**
 * Écran « Importer un tableur » (T14b). À charger par import dynamique seulement, depuis l'écran
 * Ferme : hors du JavaScript de démarrage et hors du morceau Ferme. N'importe ni PowerSync ni
 * src/donnees : l'écran reçoit la porte. Contrat : ./test/contrat.ts.
 */
export { EcranImport, EcranImport as default, type ProprietesEcranImport } from './EcranImport.tsx';
export { PLAFOND_VALEURS_A_RAPPROCHER } from './constantes.ts';
