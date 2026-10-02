/**
 * Clé de l'instantané de la journée d'un utilisateur (T13d, ./instantane.ts). Seule dans son
 * fichier : la déconnexion (connexion/deconnexion.ts) l'efface sans charger l'écran.
 */
export const cleInstantane = (utilisateurId: string): string => `planif.aujourdhui.${utilisateurId}`;
