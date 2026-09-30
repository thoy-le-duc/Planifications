/**
 * Écran « Mes itinéraires et mes types d'intervention » (T24). À charger par import dynamique
 * seulement, depuis l'écran Ferme : hors du JavaScript de démarrage et hors du morceau Ferme.
 * N'importe ni PowerSync ni src/donnees : l'écran reçoit la porte. Contrat : ./test/contrat.ts.
 */
export { EcranItineraires, EcranItineraires as default, MARQUE_ITINERAIRES_AFFICHES, type ProprietesEcranItineraires } from './EcranItineraires.tsx';
export { MARQUE_ITINERAIRE_AFFICHE } from './FormulaireItineraire.tsx';
