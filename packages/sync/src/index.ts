/**
 * @planif/sync (T10) : seule porte d'accès aux données de l'appli web. Lecture, écriture,
 * requêtes surveillées sur la base locale (PowerSync), et envoi des écritures faites hors ligne
 * à POST /sync/upload. Aucun écran n'importe PowerSync : ils passent par ici.
 */
export { exporterFerme, type ArchiveExport, type OptionsExportFerme } from './export.ts';
export { envoyerEcritures, EchecEnvoi, SessionExpiree } from './envoi.ts';
export { creerPorte } from './porte.ts';
export { SCHEMA_LOCAL, TABLES_LOCALES, type NomTableLocale } from './schema.ts';
export type * from './types.ts';
