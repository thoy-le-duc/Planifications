/**
 * Moteur d'import (T14) : lecture d'un CSV, détection, correspondance des colonnes et des
 * valeurs, normalisation, validation et aperçu (plan d'import), modèle d'import. Pur : ni base,
 * ni réseau, ni horloge ; rien ne lève ; les entrées ne sont jamais modifiées.
 *
 * Le lecteur Excel (`./xlsx.ts`) n'est PAS exporté ici : l'appli le charge par `import()` au
 * dépôt d'un .xlsx, hors du JavaScript de démarrage. Contrat détaillé : ./test/contrat.ts.
 */
export type * from './types.ts';
export { decoderTexte, detecterSeparateur, lireCsv } from './texte.ts';
export { lireDate, lireMesure, lireNombre } from './normalisation.ts';
export { CHAMPS_IMPORT, detecterEntete, proposerCorrespondance, proposerType } from './champs.ts';
export { rapprocher } from './rapprochement.ts';
export { preparerImport } from './plan.ts';
export { appliquerModele, creerModele, lireModele, serialiserModele } from './modele.ts';
export { FAMILLES_PAR_DEFAUT } from './familles.ts';
