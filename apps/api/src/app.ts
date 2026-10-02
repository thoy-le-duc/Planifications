/**
 * Application HTTP (Hono). `creerApp` reçoit toutes ses dépendances (base, e-mail, clés,
 * horloge) et ne lit aucune variable d'environnement : voir index.ts.
 */
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { routePath } from 'hono/route';
import { VERSION_MODELE_DONNEES } from '@planif/core';
import { ErreurEnvoiCourriel } from './auth/courriel.ts';
import { routesAuth } from './auth/routes.ts';
import { corsListeBlanche } from './cors.ts';
import { completer, type DependancesApp } from './dependances.ts';
import { routesFermes } from './fermes.ts';
import { decrireErreur } from './journal.ts';
import { routesSynchro } from './sync/index.ts';

export type { DependancesApp } from './dependances.ts';

/** Sonde de santé, sans dépendance (répartiteur de charge, supervision). */
export const app = new Hono();

app.get('/sante', (c) => c.json({ ok: true, versionModele: VERSION_MODELE_DONNEES }));

/** Méthode citée au journal seulement si elle est connue : le client peut en envoyer n'importe laquelle. */
const METHODES = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

function methode(brute: string): string {
  return METHODES.has(brute) ? brute : 'AUTRE';
}

export function creerApp(deps: DependancesApp): Hono {
  const ctx = completer(deps);
  const racine = new Hono();
  if (ctx.corsOrigines.length > 0) racine.use('*', corsListeBlanche(ctx.corsOrigines));
  racine.route('/', app);
  racine.route('/', routesAuth(ctx));
  racine.route('/', routesFermes(ctx));
  racine.route('/', routesSynchro(ctx));
  racine.onError((erreur, c) => {
    // Tout passe par le journal du contexte (T10m), qui met chaque entrée sur une ligne et ne lève
    // jamais. La route est citée par son motif (/fermes/:id), jamais par le chemin que le client choisit.
    // Échec d'envoi d'e-mail (relais SMTP en panne, identifiants refusés) : seul le message
    // nettoyé par l'expéditeur (erreurPropre) est écrit ; le client reçoit un 503 sans détail.
    if (erreur instanceof ErreurEnvoiCourriel) {
      ctx.journal(`[courriel] ${methode(c.req.method)} ${routePath(c)} : ${erreur.message}`);
      return c.json({ erreur: 'envoi_impossible' }, 503);
    }
    if (erreur instanceof HTTPException) return erreur.getResponse();
    // Erreur inattendue : sa classe, son code, sa pile, jamais son message (une erreur de la
    // base peut citer une valeur saisie). Le client reçoit un 500 sans détail.
    ctx.journal(`[erreur] ${methode(c.req.method)} ${routePath(c)} : ${decrireErreur(erreur)}`);
    return c.text('Internal Server Error', 500);
  });
  return racine;
}
