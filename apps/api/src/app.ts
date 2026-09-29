/**
 * Application HTTP (Hono). `creerApp` reçoit toutes ses dépendances (base, e-mail, clés,
 * horloge) et ne lit aucune variable d'environnement : voir index.ts.
 */
import { Hono } from 'hono';
import { VERSION_MODELE_DONNEES } from '@planif/core';
import { routesAuth } from './auth/routes.ts';
import { completer, type DependancesApp } from './dependances.ts';
import { routesFermes } from './fermes.ts';

export type { DependancesApp } from './dependances.ts';

/** Sonde de santé, sans dépendance (répartiteur de charge, supervision). */
export const app = new Hono();

app.get('/sante', (c) => c.json({ ok: true, versionModele: VERSION_MODELE_DONNEES }));

export function creerApp(deps: DependancesApp): Hono {
  const ctx = completer(deps);
  const racine = new Hono();
  racine.route('/', app);
  racine.route('/', routesAuth(ctx));
  racine.route('/', routesFermes(ctx));
  return racine;
}
