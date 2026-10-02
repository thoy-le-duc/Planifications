/**
 * Ce que l'application reçoit de l'extérieur : base, envoi d'e-mail, clés, horloge.
 * `creerApp` ne lit aucune variable d'environnement (voir index.ts).
 */
import { randomBytes } from 'node:crypto';
import { creerGenerateurId, type GenerateurId } from '@planif/core';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { ExpediteurCourriel } from './auth/courriel.ts';
import type { TrousseauCles } from './auth/cles.ts';
import { journalSur } from './journal.ts';
import { ENVOIS_MAX_PAR_MINUTE } from './sync/upload.ts';

export interface DependancesApp {
  /** drizzle(pool) de drizzle-orm/node-postgres. */
  readonly db: NodePgDatabase;
  /** Envoi d'e-mail injecté : faux en test. */
  readonly expediteur: ExpediteurCourriel;
  readonly cles: TrousseauCles;
  /** Claim iss (JWT_EMETTEUR). */
  readonly emetteur: string;
  /** Claim aud (JWT_AUDIENCE, celle de PowerSync). */
  readonly audience: string;
  /**
   * Horloge ; par défaut () => new Date(). Toute comparaison de temps passe par elle, jamais
   * par now() SQL ni Date.now().
   */
  readonly maintenant?: () => Date;
  /** Origines autorisées à appeler l'API depuis un navigateur (CORS) ; aucune par défaut. */
  readonly corsOrigines?: readonly string[];
  /**
   * Derrière le proxy de production (PROXY_DE_CONFIANCE=1) : l'adresse du client, pour la limite
   * par IP, est la dernière valeur de X-Forwarded-For. Faux par défaut : adresse de la socket,
   * en-têtes ignorés (un client les falsifie).
   */
  readonly proxyDeConfiance?: boolean;
  /**
   * Envois POST /sync/upload au plus par utilisateur et par minute glissante (T10f) ; par défaut
   * ENVOIS_MAX_PAR_MINUTE (sync/upload.ts). Relevé seulement par les tests qui envoient beaucoup.
   */
  readonly envoisMaxParMinute?: number;
  /**
   * Journal du serveur, unique pour toute l'API (T10j, T10m) : refus de synchro, erreurs
   * inattendues, échecs d'envoi d'e-mail. Par défaut `journalParDefaut` (sortie d'erreur). Ne
   * reçoit jamais de donnée personnelle ; chaque entrée y arrive nettoyée sur une ligne
   * (`ligneDeJournal`, journal.ts).
   */
  readonly journal?: (ligne: string) => void;
}

/** Sortie par défaut du journal du serveur : la sortie d'erreur du processus. */
export const journalParDefaut = (ligne: string): void => {
  console.error(ligne);
};

/** Dépendances complétées, partagées par les routes. */
export interface Contexte extends Required<DependancesApp> {
  /** Nouvel identifiant UUID v7 (monotone), horodaté par `maintenant`. */
  readonly nouvelId: GenerateurId;
}

export function completer(deps: DependancesApp): Contexte {
  const sortie = deps.journal ?? journalParDefaut;
  const maintenant = deps.maintenant ?? (() => new Date());
  const nouvelId = creerGenerateurId({
    horloge: () => maintenant().getTime(),
    aleatoire: (n) => new Uint8Array(randomBytes(n)),
  });
  return {
    ...deps,
    maintenant,
    nouvelId,
    corsOrigines: deps.corsOrigines ?? [],
    proxyDeConfiance: deps.proxyDeConfiance ?? false,
    envoisMaxParMinute: deps.envoisMaxParMinute ?? ENVOIS_MAX_PAR_MINUTE,
    // Toute entrée, quelle que soit la route, passe par le même nettoyage ; un journal en panne
    // ne change jamais la réponse.
    journal: journalSur(sortie),
  };
}
