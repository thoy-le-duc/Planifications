/**
 * Déconnexion (T09b), pour un téléphone partagé : rien du compte précédent ne doit rester
 * lisible. Contrat : deconnexion.test.ts. Ni PowerSync ni jose : JavaScript de démarrage ;
 * l'effacement de la base locale est injecté (src/donnees, chargé à la demande).
 */
import { effacerSession, type SessionConnexion } from './session.ts';

export interface OptionsDeconnexion {
  readonly urlApi: string;
  readonly fetch: typeof fetch;
  readonly stockage: Pick<Storage, 'removeItem'>;
  /** Efface la base locale de cet utilisateur (données et écritures en attente). */
  readonly effacerBaseLocale: (utilisateurId: string) => Promise<void>;
  /** Attente maximale de la réponse de l'API ; 5 s par défaut. */
  readonly delaiMs?: number;
}

export const DELAI_DECONNEXION_MS = 5_000;

/** Demande à l'API de révoquer la session ; n'échoue jamais (hors ligne, erreur, délai). */
async function revoquer(session: SessionConnexion, options: OptionsDeconnexion): Promise<void> {
  const envoyer = options.fetch;
  const controleur = new AbortController();
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  const delai = new Promise<void>((fin) => {
    minuterie = setTimeout(() => {
      controleur.abort();
      fin();
    }, options.delaiMs ?? DELAI_DECONNEXION_MS);
  });
  // Sans en-tête Authorization : le jeton d'accès a pu expirer, le jeton de renouvellement suffit.
  const requete = envoyer(`${options.urlApi}/auth/deconnexion`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jetonRenouvellement: session.jetonRenouvellement }),
    signal: controleur.signal,
  }).then(
    () => undefined,
    () => undefined,
  );
  try {
    await Promise.race([requete, delai]);
  } finally {
    clearTimeout(minuterie);
  }
}

/**
 * Révoque la session auprès de l'API si elle répond, puis efface la session et la base locale,
 * QUE L'API RÉPONDE OU NON : au champ, sans réseau, on doit pouvoir rendre le téléphone.
 * Rejette si la base locale n'a pas pu être effacée (la session l'est quand même).
 */
export async function deconnecter(session: SessionConnexion, options: OptionsDeconnexion): Promise<void> {
  try {
    await revoquer(session, options);
  } finally {
    effacerSession(options.stockage);
  }
  await options.effacerBaseLocale(session.utilisateurId);
}
