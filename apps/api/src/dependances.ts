/**
 * Ce que l'application reçoit de l'extérieur : base, envoi d'e-mail, clés, horloge.
 * `creerApp` ne lit aucune variable d'environnement (voir index.ts).
 */
import { randomBytes } from 'node:crypto';
import { creerGenerateurId, type GenerateurId } from '@planif/core';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { ExpediteurCourriel } from './auth/courriel.ts';
import type { TrousseauCles } from './auth/cles.ts';

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
}

/** Dépendances complétées, partagées par les routes. */
export interface Contexte extends Required<DependancesApp> {
  /** Nouvel identifiant UUID v7 (monotone), horodaté par `maintenant`. */
  readonly nouvelId: GenerateurId;
}

export function completer(deps: DependancesApp): Contexte {
  const maintenant = deps.maintenant ?? (() => new Date());
  const nouvelId = creerGenerateurId({
    horloge: () => maintenant().getTime(),
    aleatoire: (n) => new Uint8Array(randomBytes(n)),
  });
  return { ...deps, maintenant, nouvelId };
}
