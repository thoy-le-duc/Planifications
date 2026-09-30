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
  type ProprietesEcranAujourdhui,
} from './EcranAujourdhui.tsx';
export { prechargerJournee } from './cache.ts';
