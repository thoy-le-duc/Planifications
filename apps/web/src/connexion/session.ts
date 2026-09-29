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
  /**
   * Heure du serveur − heure du téléphone (ms), mesurée au dernier jeton reçu ; négative si le
   * téléphone avance (T09b). Rangée avec la session et relue au démarrage : l'iat du jeton rangé
   * ne prouve plus tout le retard une fois l'appli relancée.
   */
  readonly ecartHorlogeMs?: number;
}

const CHAMPS = ['utilisateurId', 'email', 'jetonAcces', 'jetonRenouvellement'] as const;

/**
 * Écart d'horloge plausible au plus (48 h, bornes comprises) : au-delà, la valeur rangée est
 * aberrante (stockage modifié) et ferait renouveler à chaque appel ou garder un jeton périmé.
 */
export const ECART_HORLOGE_MAX_MS = 48 * 60 * 60 * 1000;

/**
 * Session complète (quatre chaînes non vides), ou null. L'écart d'horloge n'est gardé que s'il est
 * un nombre fini d'au plus ±48 h : sinon il est omis sans invalider la session.
 */
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
  const ecart = o.ecartHorlogeMs;
  return {
    utilisateurId,
    email,
    jetonAcces,
    jetonRenouvellement,
    ...(typeof ecart === 'number' && Number.isFinite(ecart) && Math.abs(ecart) <= ECART_HORLOGE_MAX_MS ? { ecartHorlogeMs: ecart } : {}),
  };
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
