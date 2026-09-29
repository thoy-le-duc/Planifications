/**
 * Données de l'appli (T10) : base locale synchronisée, derrière la porte de @planif/sync.
 * `ouvrirDonnees` charge PowerSync : à importer dynamiquement depuis un écran, jamais dans le
 * JavaScript de démarrage.
 */
export { effacerDonneesLocales, ouvrirDonnees, etatDepuisStatut, type DonneesLocales, type EtatSynchro, type OptionsOuverture } from './ouvrir.ts';
export { SessionExpiree } from './jeton.ts';
