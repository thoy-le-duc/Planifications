/** Version du modèle de données validé (docs/modele-donnees.md). */
export const VERSION_MODELE_DONNEES = 1;

export * from './dates/index.ts';
export * from './domaine/index.ts';
export * from './saisies/index.ts';
export * from './saisies/stock.ts';
export * from './export/index.ts';
export * from './import/index.ts';

// Planification (T03), exposée pour la vue 2D (T11) : conflits de place et période effective
// d'une occupation. Les écrans montrent ce que ce moteur trouve, sans réécrire de règle.
export { detecterConflits, type Conflit, type SorteConflit } from './planification/conflits.ts';
export { DATE_SANS_FIN, periodeOccupation, type PeriodeOccupation } from './planification/occupations.ts';
