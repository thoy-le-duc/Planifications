/**
 * Déconnexion (T09b), pour un téléphone partagé : rien du compte précédent ne doit rester
 * lisible. Contrat : deconnexion.test.ts. Ni PowerSync ni jose : JavaScript de démarrage ;
 * l'effacement de la base locale est injecté (src/donnees, chargé à la demande).
 */
import { cleRefusVus } from '../donnees/refus-vus.ts';
import { effacerSession, lireSession, type SessionConnexion } from './session.ts';

export interface OptionsDeconnexion {
  readonly urlApi: string;
  readonly fetch: typeof fetch;
  /** Session (effacée) et marqueur d'effacement en attente (lu et réécrit). */
  readonly stockage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  /** Efface la base locale de cet utilisateur (données et écritures en attente). */
  readonly effacerBaseLocale: (utilisateurId: string) => Promise<void>;
  /** Attente maximale de la réponse de l'API ; 5 s par défaut. */
  readonly delaiMs?: number;
}

export const DELAI_DECONNEXION_MS = 5_000;

/**
 * Marqueur des bases locales qui restent à effacer (tableau JSON d'utilisateurId, sans doublon) :
 * l'effacement a échoué, en général parce qu'un autre onglet garde la base ouverte. L'appli le
 * reprend au démarrage et sur l'écran de connexion jusqu'à réussite.
 */
export const CLE_EFFACEMENT_EN_ATTENTE = 'planif.effacement-en-attente';
export const MESSAGE_EFFACEMENT_EN_ATTENTE = 'Fermez les autres onglets de Planifications ; l’effacement se terminera tout seul.';

/** Marqueur lu : absent ou illisible → [] (seules les chaînes non vides comptent). */
export function effacementsEnAttente(stockage: Pick<Storage, 'getItem'>): readonly string[] {
  try {
    const brut = stockage.getItem(CLE_EFFACEMENT_EN_ATTENTE);
    const lu: unknown = brut === null ? [] : JSON.parse(brut);
    if (!Array.isArray(lu)) return [];
    return [...new Set(lu.filter((id): id is string => typeof id === 'string' && id !== ''))];
  } catch {
    return [];
  }
}

/** Range le marqueur ; clé retirée quand plus rien n'attend. Un stockage indisponible est ignoré. */
function rangerEnAttente(stockage: Pick<Storage, 'setItem' | 'removeItem'>, ids: readonly string[]): void {
  try {
    if (ids.length === 0) stockage.removeItem(CLE_EFFACEMENT_EN_ATTENTE);
    else stockage.setItem(CLE_EFFACEMENT_EN_ATTENTE, JSON.stringify(ids));
  } catch {
    // Rien de mieux à faire : l'écran dit déjà que l'effacement a échoué.
  }
}

/** Efface la base de `utilisateurId` et tient le marqueur à jour ; rejette si l'effacement échoue. */
async function effacerEtMarquer(
  utilisateurId: string,
  o: { readonly stockage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>; readonly effacerBaseLocale: (id: string) => Promise<void> },
): Promise<void> {
  try {
    await o.effacerBaseLocale(utilisateurId);
  } catch (erreur) {
    const attente = effacementsEnAttente(o.stockage);
    if (!attente.includes(utilisateurId)) rangerEnAttente(o.stockage, [...attente, utilisateurId]);
    throw erreur;
  }
  const attente = effacementsEnAttente(o.stockage);
  if (attente.includes(utilisateurId)) rangerEnAttente(o.stockage, attente.filter((id) => id !== utilisateurId));
}

/**
 * Retire `utilisateurId` du marqueur (les autres restent ; clé retirée quand il est vide). Appelée
 * à la connexion : la base de l'utilisateur connecté ne doit plus être effacée. Ne lève jamais.
 */
export function retirerEffacementEnAttente(stockage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, utilisateurId: string): void {
  const attente = effacementsEnAttente(stockage);
  if (attente.includes(utilisateurId)) rangerEnAttente(stockage, attente.filter((id) => id !== utilisateurId));
}

/** Utilisateur de la session rangée (relue à chaque fois), ou null. */
function utilisateurConnecte(stockage: Pick<Storage, 'getItem'>): string | null {
  return lireSession(stockage)?.utilisateurId ?? null;
}

/**
 * Retente chaque effacement en attente, l'un après l'autre ; rend les utilisateurId qui attendent
 * encore. Ne rejette jamais. Marqueur illisible : clé retirée.
 *
 * 2e relecture sécurité (B2) : l'utilisateur de la session rangée, relue avant chaque essai et à
 * la fin, n'est JAMAIS effacé (reconnecté pendant que l'effacement attendait) : il quitte le
 * marqueur et n'est pas rendu.
 */
export async function reprendreEffacements(o: {
  readonly stockage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  readonly effacerBaseLocale: (utilisateurId: string) => Promise<void>;
}): Promise<readonly string[]> {
  const attente = effacementsEnAttente(o.stockage);
  const restants: string[] = [];
  for (const id of attente) {
    if (utilisateurConnecte(o.stockage) === id) continue;
    try {
      await o.effacerBaseLocale(id);
    } catch {
      restants.push(id);
    }
  }
  const connecte = utilisateurConnecte(o.stockage);
  const encore = restants.filter((id) => id !== connecte);
  let brut: string | null = null;
  try {
    brut = o.stockage.getItem(CLE_EFFACEMENT_EN_ATTENTE);
  } catch {
    // Stockage indisponible : rien à retirer.
  }
  if (brut !== null) rangerEnAttente(o.stockage, encore);
  return encore;
}

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
    // Téléphone partagé : les refus vus du compte (T10i) ne restent pas, quoi qu'il arrive ensuite.
    try {
      options.stockage.removeItem(cleRefusVus(session.utilisateurId));
    } catch {
      // Stockage refusé : rien de lisible à retirer.
    }
  }
  // Échec (base ouverte dans un autre onglet) : l'utilisateur rejoint le marqueur, repris ensuite.
  await effacerEtMarquer(session.utilisateurId, options);
}

/** « 1 saisie pas encore envoyée sera perdue », « 3 saisies pas encore envoyées seront perdues ». */
export function messagePerteSaisies(n: number): string {
  return n === 1 ? '1 saisie pas encore envoyée sera perdue' : `${String(n)} saisies pas encore envoyées seront perdues`;
}

export interface OptionsConfirmation extends OptionsDeconnexion {
  /**
   * Nombre de saisies encore dans la file d'envoi ; null si on ne sait pas les compter (base
   * locale présente, PowerSync non ouvert) : message générique.
   */
  readonly compterEnAttente: () => Promise<number | null>;
  /** Écran de confirmation en un tap : vrai pour se déconnecter quand même. */
  readonly confirmer: (message: string) => Promise<boolean>;
}

/**
 * Déconnexion qui ne perd jamais une saisie en silence : file d'envoi non vide (ou illisible),
 * confirmation d'abord ; annulée, rien n'est fait (ni réseau, ni session, ni base).
 */
export async function deconnecterAvecConfirmation(
  session: SessionConnexion,
  options: OptionsConfirmation,
): Promise<'deconnecte' | 'annule'> {
  let enAttente: number | null;
  try {
    enAttente = await options.compterEnAttente();
  } catch {
    enAttente = null; // File illisible : on demande quand même.
  }
  if (enAttente !== 0) {
    const message =
      enAttente === null
        ? 'Des saisies pas encore envoyées pourraient être perdues. Se déconnecter quand même ?'
        : `${messagePerteSaisies(enAttente)}. Se déconnecter quand même ?`;
    if (!(await options.confirmer(message))) return 'annule';
  }
  await deconnecter(session, options);
  return 'deconnecte';
}
