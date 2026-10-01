/**
 * Application HTTP (Hono). `creerApp` reçoit toutes ses dépendances (base, e-mail, clés,
 * horloge) et ne lit aucune variable d'environnement : voir index.ts.
 */
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { VERSION_MODELE_DONNEES } from '@planif/core';
import { ErreurEnvoiCourriel } from './auth/courriel.ts';
import { routesAuth } from './auth/routes.ts';
import { corsListeBlanche } from './cors.ts';
import { completer, type DependancesApp } from './dependances.ts';
import { routesFermes } from './fermes.ts';
import { routesSynchro } from './sync/index.ts';

export type { DependancesApp } from './dependances.ts';

/** Sonde de santé, sans dépendance (répartiteur de charge, supervision). */
export const app = new Hono();

app.get('/sante', (c) => c.json({ ok: true, versionModele: VERSION_MODELE_DONNEES }));

export function creerApp(deps: DependancesApp): Hono {
  const ctx = completer(deps);
  const racine = new Hono();
  if (ctx.corsOrigines.length > 0) racine.use('*', corsListeBlanche(ctx.corsOrigines));
  racine.route('/', app);
  racine.route('/', routesAuth(ctx));
  racine.route('/', routesFermes(ctx));
  racine.route('/', routesSynchro(ctx));
  racine.onError((erreur, c) => {
    // Échec d'envoi d'e-mail (relais SMTP en panne, identifiants refusés) : seul le message
    // nettoyé de l'expéditeur est écrit, jamais l'erreur brute ; le client reçoit un 503 sans
    // détail. Le reste suit le comportement par défaut de Hono (500 sans détail).
    if (erreur instanceof ErreurEnvoiCourriel) {
      console.error(`[courriel] ${c.req.method} ${c.req.path} : ${erreur.message}`);
      return c.json({ erreur: 'envoi_impossible' }, 503);
    }
    if (erreur instanceof HTTPException) return erreur.getResponse();
    console.error(erreur);
    return c.text('Internal Server Error', 500);
  });
  return racine;
}
