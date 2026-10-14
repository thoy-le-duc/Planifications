/**
 * Clé de l'instantané du début du plan d'un utilisateur (T11g, ./instantane.ts). Seule dans son
 * fichier : la déconnexion (connexion/deconnexion.ts) l'efface sans charger l'écran.
 */
export const cleInstantanePlan = (utilisateurId: string): string => `planif.plan.${utilisateurId}`;
