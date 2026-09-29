/**
 * Garde des routes protégées : en-tête `Authorization: Bearer <jetonAcces>`, sinon 401.
 * Le jeton ne dit que « qui » ; les droits sur une ferme sont relus en base à chaque requête.
 */
import type { Id } from '@planif/core';
import { createMiddleware } from 'hono/factory';
import type { Contexte } from '../dependances.ts';
import { verifierJetonAcces } from './jetons.ts';

export interface VariablesAuthentifiees {
  readonly utilisateurId: Id<'Utilisateur'>;
}

export function garde(ctx: Contexte) {
  return createMiddleware<{ Variables: VariablesAuthentifiees }>(async (c, suite) => {
    const entete = c.req.header('authorization') ?? '';
    const [schema, jeton, ...reste] = entete.split(' ');
    if (schema?.toLowerCase() !== 'bearer' || jeton === undefined || jeton === '' || reste.length > 0) {
      return c.json({ erreur: 'non_authentifie' }, 401);
    }
    const utilisateurId = await verifierJetonAcces(ctx, jeton, ctx.maintenant());
    if (utilisateurId === null) return c.json({ erreur: 'non_authentifie' }, 401);
    c.set('utilisateurId', utilisateurId as Id<'Utilisateur'>);
    await suite();
    return undefined;
  });
}
