/**
 * Préparation des écrans de la ferme dès la ferme connue (T11, T13c, T13u, T13v), avant même le
 * rendu : un tap sur « Planches » juste après l'ouverture affiche le début du plan tout de suite,
 * et Aujourd'hui, écran d'accueil, lit sa journée. Chargé à la demande par App.tsx (T11g : sorti
 * du JavaScript de démarrage, qui n'a plus de marge).
 */
import type { FermeOuverte } from './etat-appli.ts';

/**
 * Au lancement, la lecture de la journée attend au plus ce délai le début du plan (T13c). Mesuré
 * (e2e, CPU ×4) : sans aucune attente, la journée et le plan se disputent la base et le tap sur
 * « Planches » juste après l'ouverture passe de ≈ 140 ms à ≈ 650 ms (budget 300 ms) ; avec
 * l'attente bornée, ≈ 110 ms, et Aujourd'hui s'affiche même si le plan ne finit jamais.
 */
export const ATTENTE_PLAN_MAX_MS = 400;

/**
 * Le début du plan passe d'abord à la base ; la journée le suit, mais ne l'attend jamais plus de
 * ATTENTE_PLAN_MAX_MS : Aujourd'hui ne reste pas bloqué derrière le plan d'une grande ferme ou
 * d'un téléphone lent. Échec : l'écran lira le plan (ou la journée) lui-même à l'ouverture.
 */
export function prechargerFerme(f: FermeOuverte): void {
  const plan = import('../ecrans/plan/index.ts').then((m) => m.prechargerPlan(f.porte, f.fermeId, m.jourDuTelephone())).catch(() => undefined);
  const auPlusTard = new Promise<void>((tenir) => {
    setTimeout(tenir, ATTENTE_PLAN_MAX_MS);
  });
  import('../ecrans/aujourdhui/index.ts')
    .then((m) => m.prechargerJournee(f.porte, f.fermeId, m.jourDuTelephone(), Promise.race([plan, auPlusTard])))
    .catch(() => undefined);
}
