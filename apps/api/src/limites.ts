/**
 * Limites de fréquence en fenêtre glissante, calculées sur des instants relus en base (codes
 * envoyés, invitations) : plusieurs processus d'API, redémarrage sans perte. Pour un débit
 * (envois de synchro), `creerLimiteMemoire` compte en mémoire, par processus.
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

/** Limite « au plus `max` actions par `fenetreMs` glissante » par clé, comptée en mémoire. */
export interface LimiteMemoire {
  /**
   * Enregistre l'action de `cle` à `maintenant` (ms) si la limite le permet et rend null ; sinon
   * rend le délai (secondes, Retry-After) sans rien enregistrer.
   */
  enregistrer(cle: string, maintenant: number): number | null;
  /** Clés suivies (pour vérifier que la mémoire reste bornée). */
  readonly taille: number;
}

export function creerLimiteMemoire(max: number, fenetreMs: number): LimiteMemoire {
  const instants = new Map<string, number[]>();
  let prochainePurge = -Infinity;

  /** Oublie les clés sans action dans la fenêtre : au plus une fois par fenêtre, en un passage. */
  function purger(maintenant: number): void {
    if (maintenant < prochainePurge) return;
    prochainePurge = maintenant + fenetreMs;
    for (const [cle, liste] of instants) {
      if ((liste.at(-1) ?? -Infinity) <= maintenant - fenetreMs) instants.delete(cle);
    }
  }

  return {
    enregistrer(cle, maintenant) {
      purger(maintenant);
      // Au plus `max` instants gardés par clé : seuls ceux de la fenêtre comptent.
      const recents = (instants.get(cle) ?? []).filter((t) => t > maintenant - fenetreMs);
      const libreA = libreSelonFenetre(recents, max, fenetreMs, maintenant);
      if (libreA > maintenant) {
        instants.set(cle, recents);
        return secondesAvant(libreA, maintenant);
      }
      recents.push(maintenant);
      instants.set(cle, recents);
      return null;
    },
    get taille() {
      return instants.size;
    },
  };
}
