/**
 * Session gardée sur le téléphone (localStorage) : on ne se reconnecte pas à chaque ouverture,
 * même hors ligne. Une valeur absente, illisible ou incomplète donne null, jamais d'exception :
 * l'appli doit toujours démarrer.
 */
export const CLE_SESSION = 'planif.session';

export interface SessionConnexion {
  readonly utilisateurId: string;
  readonly email: string;
  readonly jetonAcces: string;
  readonly jetonRenouvellement: string;
}

const CHAMPS = ['utilisateurId', 'email', 'jetonAcces', 'jetonRenouvellement'] as const;

/** Session complète (quatre chaînes non vides), ou null. */
export function sessionValide(v: unknown): SessionConnexion | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const [utilisateurId, email, jetonAcces, jetonRenouvellement] = CHAMPS.map((c) => o[c]);
  if (
    typeof utilisateurId !== 'string' ||
    typeof email !== 'string' ||
    typeof jetonAcces !== 'string' ||
    typeof jetonRenouvellement !== 'string' ||
    [utilisateurId, email, jetonAcces, jetonRenouvellement].some((s) => s === '')
  ) {
    return null;
  }
  return { utilisateurId, email, jetonAcces, jetonRenouvellement };
}

export function lireSession(stockage: Pick<Storage, 'getItem'>): SessionConnexion | null {
  try {
    const brut = stockage.getItem(CLE_SESSION);
    return brut === null ? null : sessionValide(JSON.parse(brut));
  } catch {
    return null;
  }
}

/** Enregistre la session ; un stockage indisponible (navigation privée) est ignoré. */
export function enregistrerSession(stockage: Pick<Storage, 'setItem'>, session: SessionConnexion): void {
  try {
    stockage.setItem(CLE_SESSION, JSON.stringify(session));
  } catch {
    // La session vaut pour cette ouverture seulement.
  }
}

export function effacerSession(stockage: Pick<Storage, 'removeItem'>): void {
  try {
    stockage.removeItem(CLE_SESSION);
  } catch {
    // Rien à effacer.
  }
}

/** Le localStorage du navigateur, ou un stockage vide (rendu serveur, stockage bloqué). */
export function stockageNavigateur(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // Accès refusé (certains modes privés).
  }
  return { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
}
