/**
 * Croissance des cultures (T32a, Q32) : profils de croissance par espèce, réglables par la
 * ferme (`espece.profil_croissance`), et hauteur et stade d'une culture à une date, pour le
 * jumeau numérique (T32b). Pur et déterministe : ni base, ni réseau, ni IA, ni horloge.
 *
 * Code sans effet au chargement (constantes marquées `@__PURE__`, index des noms construit au
 * premier appel) : le bundler ne l'embarque que dans les écrans qui l'appellent, jamais au
 * démarrage ni dans le morceau commun de @planif/core.
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
export {
  HAUTEUR_TRAVAIL_HORS_SOL_M,
  hauteurStructureM,
  PROFIL_GENERIQUE,
  PROFILS_PAR_DEFAUT,
  profilEffectif,
  profilParDefaut,
  surelevationHorsSolM,
} from './defauts.ts';
export { croissanceA, croissancePerenneA, FRACTION_FIN_LEVEE, FRACTION_HAUTEUR_FIN_BAISSEE, JOURS_REPLI_SANS_FIN } from './calcul.ts';
