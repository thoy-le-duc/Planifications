/**
 * Jeton d'accès toujours valide pour la synchro (T10) : celui de la session (T09) tant qu'il ne
 * va pas expirer, sinon un nouveau par POST /auth/renouveler, qui ne demande pas de jeton
 * d'accès valide (les écritures faites hors ligne partent au retour du réseau, même une semaine
 * plus tard). La session renouvelée est rangée comme à la connexion.
 *
 * `invalider()` : le serveur a refusé le jeton (401) alors que l'horloge du téléphone le croit
 * valide (téléphone en retard) ; le prochain `jetonValide()` en demande un neuf.
 */
import { SessionExpiree } from '@planif/sync';
import { enregistrerSession, sessionValide, type SessionConnexion } from '../connexion/session.ts';

/** La classe de @planif/sync : un seul `instanceof` pour l'envoi et le renouvellement. */
export { SessionExpiree };

/** On renouvelle un peu avant l'expiration : le jeton doit rester valide le temps de la requête. */
export const MARGE_RENOUVELLEMENT_MS = 60_000;

/** Instant d'expiration (ms) d'un JWT, lu sans vérifier la signature (le serveur la vérifie) ; null si illisible. */
export function expirationJeton(jeton: string): number | null {
  const charge = jeton.split('.')[1];
  if (charge === undefined) return null;
  try {
    const json = atob(charge.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(charge.length / 4) * 4, '='));
    const exp: unknown = (JSON.parse(json) as Record<string, unknown>).exp;
    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

export interface OptionsJetons {
  readonly urlApi: string;
  readonly fetch: typeof fetch;
  readonly stockage: Pick<Storage, 'setItem'>;
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

  async function renouveler(): Promise<string> {
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
    session = nouvelle;
    invalide = false;
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
      if (!invalide && exp !== null && exp - maintenant() > MARGE_RENOUVELLEMENT_MS) return Promise.resolve(session.jetonAcces);
      enCours ??= renouveler().finally(() => {
        enCours = null;
      });
      return enCours;
    },
  };
}
