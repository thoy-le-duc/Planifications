/**
 * Limites de fréquence en fenêtre glissante, calculées sur des instants relus en base (codes
 * envoyés, invitations) : plusieurs processus d'API, redémarrage sans perte.
 */

/**
 * Instant (ms) à partir duquel une action de plus respecte « au plus `max` par `fenetreMs`
 * glissante », `instants` (ms) triés du plus ancien au plus récent ; 0 si la limite n'est pas
 * atteinte à `maintenant`.
 */
export function libreSelonFenetre(instants: readonly number[], max: number, fenetreMs: number, maintenant: number): number {
  const dansLaFenetre = instants.filter((t) => t > maintenant - fenetreMs);
  const plusAncienAGarder = dansLaFenetre[dansLaFenetre.length - max];
  return plusAncienAGarder === undefined ? 0 : plusAncienAGarder + fenetreMs;
}

/** Secondes à annoncer dans Retry-After, au moins 1. */
export function secondesAvant(libreA: number, maintenant: number): number {
  return Math.max(1, Math.ceil((libreA - maintenant) / 1000));
}
