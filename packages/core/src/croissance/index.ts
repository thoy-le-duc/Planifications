/**
 * Croissance des cultures (T32a, Q32) : profils de croissance par espèce, réglables par la
 * ferme (`espece.profil_croissance`), et hauteur et stade d'une culture à une date, pour le
 * jumeau numérique (T32b). Pur et déterministe : ni base, ni réseau, ni IA, ni horloge.
 *
 * Chargé à la demande par l'appli (vue 3D) : il n'entre pas dans le JavaScript de démarrage.
 */
export type {
  AllureCroissance,
  CodeErreurCroissance,
  CycleAnnuel,
  DateRepere,
  DatesCroissance,
  DureeCroissance,
  EntreePerenne,
  ErreurCroissance,
  EtatCroissance,
  FinDeCycle,
  FormePlant,
  ProfilCroissance,
  ProfilParDefaut,
  ResultatCroissance,
  StadeCroissance,
} from './types.ts';
export {
  ALLURES,
  DUREE_MAX_JOURS,
  FINS_DE_CYCLE,
  FORMES_PLANT,
  HAUTEUR_MAX_PROFIL_M,
  MENTION_A_VERIFIER,
  PROFIL_CARACTERES_MAX,
  validerProfilCroissance,
} from './profil.ts';
export { PROFIL_GENERIQUE, PROFILS_PAR_DEFAUT, profilEffectif, profilParDefaut } from './defauts.ts';
export { croissanceA, croissancePerenneA, FRACTION_FIN_LEVEE, FRACTION_HAUTEUR_FIN_BAISSEE, JOURS_REPLI_SANS_FIN } from './calcul.ts';
