/**
 * CORS (T10) : l'appli web (et la page de diagnostic de la synchro) appelle l'API depuis une autre
 * origine. Liste blanche exacte (CORS_ORIGINES, config.ts), aucune origine par défaut ; pas de
 * cookies : le jeton passe par l'en-tête Authorization.
 */
import { cors } from 'hono/cors';

export function corsListeBlanche(origines: readonly string[]) {
  const permises = new Set(origines);
  return cors({
    origin: (origine) => (permises.has(origine) ? origine : null),
    allowMethods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowHeaders: ['authorization', 'content-type'],
    exposeHeaders: ['retry-after'],
    maxAge: 600,
  });
}
