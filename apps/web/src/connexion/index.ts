/**
 * Connexion (T09) : écran, client HTTP, session gardée sur le téléphone.
 * N'importe ni jose ni PowerSync : il est dans le JavaScript de démarrage.
 */
export {
  creerClientConnexion,
  normaliserEmail,
  urlApi,
  type ClientConnexion,
  type OptionsClient,
  type ResultatDemande,
  type ResultatVerification,
} from './client.ts';
export { DELAI_DECONNEXION_MS, deconnecter, type OptionsDeconnexion } from './deconnexion.ts';
export { EcranConnexion, type EtapeConnexion, type ProprietesEcranConnexion } from './EcranConnexion.tsx';
export {
  CLE_SESSION,
  effacerSession,
  enregistrerSession,
  lireSession,
  stockageNavigateur,
  type SessionConnexion,
} from './session.ts';
