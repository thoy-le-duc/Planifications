/**
 * @planif/sync (T10) : seule porte d'accès aux données de l'appli web. Lecture, écriture,
 * requêtes surveillées sur la base locale (PowerSync), et envoi des écritures faites hors ligne
 * à POST /sync/upload. Aucun écran n'importe PowerSync : ils passent par ici.
 */
export { exporterFerme, type ArchiveExport, type Avancement, type Compresseur, type OptionsExportFerme } from './export.ts';
export { envoyerEcritures, EchecEnvoi, SessionExpiree } from './envoi.ts';
export { creerPorte } from './porte.ts';
export { SCHEMA_LOCAL, TABLES_LOCALES, type NomTableLocale } from './schema.ts';
export type * from './types.ts';
/** Écritures au plus par transaction locale (`ecrireEnsemble`), comme par envoi à l'API (T10c). */
export { ECRITURES_MAX_PAR_LOT } from '@planif/core';
/** Octets UTF-8 au plus de `JSON.stringify(ordres)` par transaction locale (T10f ; le serveur accepte 6 Mio de corps, pour la marge). */
export { TAILLE_MAX_PAR_LOT } from '@planif/core';
