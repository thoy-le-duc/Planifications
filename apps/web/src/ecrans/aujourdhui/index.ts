/**
 * Écran « Aujourd'hui » (T13) : semainier de la semaine, « Fait » en un geste, récolte en trois
 * gestes, « Annuler ». À charger par import dynamique seulement (App.tsx) : hors du JavaScript de
 * démarrage. N'importe ni PowerSync ni src/donnees : l'écran reçoit la porte.
 */
export {
  EcranAujourdhui,
  EcranAujourdhui as default,
  jourDuTelephone,
  MARQUE_AUJOURDHUI_AFFICHE,
  TACHES_PAR_GROUPE,
  type ProprietesEcranAujourdhui,
} from './EcranAujourdhui.tsx';
// T37b : la vue 3D retire les tâches cochées et pas encore relues, comme l'écran (masques du cache).
export { marquerEcriture, masquesDe, prechargerJournee, suivreMasques, toutVoirDe, type Masque, type Masques } from './cache.ts';
// T60 : la 3D numérote les travaux de la personne quand l'écran montre « Mes travaux ».
export { modeEquipeDe, type ModeEquipe } from './cache.ts';
// T37 : ce que la vue 3D lit des travaux du jour (plan3d/travaux.ts), par l'entrée du morceau : la 3D
// charge ce morceau à l'ouverture, sans que le moteur de la journée forme un morceau de plus.
export { calculerJournee, capitale, codesEmplacements, lireJournee, phraseDeTache, tachesDeLEcran, type TacheJour } from './calculs.ts';
// T57 : les vannes de la 3D jugent les chaînes d'irrigations par la même règle, par la même entrée.
export { enVigueur } from './calculs.ts';
