/**
 * Écran « Planches » (T11) : vue 2D planches × semaines. À charger par import dynamique
 * seulement (App.tsx) : hors du JavaScript de démarrage. N'importe ni PowerSync ni src/donnees :
 * l'écran reçoit la porte.
 */
export { EcranPlan, EcranPlan as default, jourDuTelephone, MARQUE_PLAN_AFFICHE, type ProprietesEcranPlan } from './EcranPlan.tsx';
export { prechargerPlan } from './cache.ts';
