/**
 * « Ma ferme : saisons, zones, planches » (T49). À charger par import dynamique seulement, depuis
 * l'écran Ferme : hors du JavaScript de démarrage et hors du morceau Ferme. N'importe ni PowerSync
 * ni src/donnees : l'écran reçoit la porte. Contrat : ./test/contrat.ts.
 */
export { EcranParcellaire, EcranParcellaire as default, type ProprietesEcranParcellaire } from './EcranParcellaire.tsx';
