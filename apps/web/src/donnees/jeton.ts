/**
 * Jeton d'accès toujours valide pour la synchro (T10) : celui de la session (T09) tant qu'il ne
 * va pas expirer, sinon un nouveau par POST /auth/renouveler, qui ne demande pas de jeton
 * d'accès valide (les écritures faites hors ligne partent au retour du réseau, même une semaine
 * plus tard). La session renouvelée est rangée comme à la connexion.
 *
 * `invalider()` : le serveur a refusé le jeton (401) alors que l'horloge du téléphone le croit
 * valide (téléphone en retard) ; le prochain `jetonValide()` en demande un neuf.
 *
 * T09b :
 * - rotation : chaque renouvellement rend un jeton de renouvellement neuf, rangé aussitôt ;
 *   avant de renouveler, on relit la session rangée (une autre page a pu le faire tourner :
 *   représenter l'ancien une fois son successeur utilisé révoquerait toute la session). Réponse
 *   perdue : on garde l'ancien, que le serveur accepte tant que le successeur perdu n'a pas
 *   servi (7 jours au plus) ;
 * - écart d'horloge : l'heure du serveur est estimée par l'iat des jetons reçus (sans appel
 *   réseau de plus), et c'est elle qui décide du renouvellement. L'écart est rangé avec la
 *   session (`ecartHorlogeMs`) et relu au démarrage.
 */
import { SessionExpiree } from '@planif/sync';
import { enregistrerSession, lireSession, sessionValide, type SessionConnexion } from '../connexion/session.ts';

/** La classe de @planif/sync : un seul `instanceof` pour l'envoi et le renouvellement. */
export { SessionExpiree };

/** On renouvelle un peu avant l'expiration : le jeton doit rester valide le temps de la requête. */
export const MARGE_RENOUVELLEMENT_MS = 60_000;

/** Claim numérique (en secondes) d'un JWT, en ms, lu sans vérifier la signature ; null si illisible. */
function claimInstant(jeton: string, nom: 'exp' | 'iat'): number | null {
  const charge = jeton.split('.')[1];
  if (charge === undefined) return null;
  try {
    const json = atob(charge.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(charge.length / 4) * 4, '='));
    const valeur: unknown = (JSON.parse(json) as Record<string, unknown>)[nom];
    return typeof valeur === 'number' && Number.isFinite(valeur) ? valeur * 1000 : null;
  } catch {
    return null;
  }
}

/** Instant d'expiration (ms) d'un JWT, lu sans vérifier la signature (le serveur la vérifie) ; null si illisible. */
export function expirationJeton(jeton: string): number | null {
  return claimInstant(jeton, 'exp');
}

/** Instant d'émission (ms) d'un JWT, à l'heure du serveur ; null si illisible. */
export function emissionJeton(jeton: string): number | null {
  return claimInstant(jeton, 'iat');
}

export interface OptionsJetons {
  readonly urlApi: string;
  readonly fetch: typeof fetch;
  /**
   * Session rangée : réécrite après chaque renouvellement, et relue avant (getItem ; sans lui,
   * seul le jeton en mémoire compte).
   */
  readonly stockage: Pick<Storage, 'setItem'> & Partial<Pick<Storage, 'getItem'>>;
  readonly maintenant?: () => number;
}

export interface GestionJetons {
  /** Jeton d'accès valide encore au moins MARGE_RENOUVELLEMENT_MS ; renouvelé si besoin. */
  jetonValide(): Promise<string>;
  /** Oublie le jeton en cours : le prochain `jetonValide()` le renouvelle, quelle que soit l'horloge. */
  invalider(): void;
  session(): SessionConnexion;
}

export function gererJetons(depart: SessionConnexion, options: OptionsJetons): GestionJetons {
  const envoyer = options.fetch;
  const maintenant = options.maintenant ?? (() => Date.now());
  let session = depart;
  /** Un seul renouvellement à la fois (synchro et envoi le demandent en même temps). */
  let enCours: Promise<string> | null = null;
  /** Jeton refusé par le serveur : à renouveler même s'il paraît valide. */
  let invalide = false;
  /**
   * Heure du serveur − heure du téléphone (ms). Au départ, l'écart rangé avec la session ; à
   * défaut, seul un iat dans le futur prouve un retard du téléphone (un iat passé ne dit rien :
   * le jeton a pu être rangé la veille).
   */
  const iatDepart = emissionJeton(depart.jetonAcces);
  let ecart = depart.ecartHorlogeMs ?? (iatDepart === null ? 0 : Math.max(0, iatDepart - maintenant()));

  async function renouveler(): Promise<string> {
    // Une autre page ou un autre onglet a pu faire tourner le jeton : on présente le plus récent.
    const stockage = options.stockage;
    const rangee = stockage.getItem === undefined ? null : lireSession({ getItem: (cle) => stockage.getItem?.(cle) ?? null });
    if (rangee !== null && rangee.utilisateurId === session.utilisateurId && rangee.jetonRenouvellement !== session.jetonRenouvellement) {
      session = rangee;
    }
    const res = await envoyer(`${options.urlApi}/auth/renouveler`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jetonRenouvellement: session.jetonRenouvellement }),
    });
    if (res.status === 401) throw new SessionExpiree();
    if (res.status !== 200) throw new Error(`renouvellement du jeton : réponse ${String(res.status)}`);
    const corps: unknown = await res.json();
    const nouvelle = sessionValide({ ...session, ...(typeof corps === 'object' && corps !== null ? corps : {}) });
    if (nouvelle === null) throw new Error('renouvellement du jeton : réponse illisible');
    invalide = false;
    const iat = emissionJeton(nouvelle.jetonAcces);
    if (iat !== null) ecart = iat - maintenant();
    session = { ...nouvelle, ecartHorlogeMs: ecart };
    enregistrerSession(options.stockage, session);
    return session.jetonAcces;
  }

  return {
    session: () => session,
    invalider() {
      invalide = true;
    },
    jetonValide() {
      const exp = expirationJeton(session.jetonAcces);
      if (!invalide && exp !== null && exp - (maintenant() + ecart) > MARGE_RENOUVELLEMENT_MS) {
        return Promise.resolve(session.jetonAcces);
      }
      enCours ??= renouveler().finally(() => {
        enCours = null;
      });
      return enCours;
    },
  };
}
