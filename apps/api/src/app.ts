import { Hono } from 'hono';
import { VERSION_MODELE_DONNEES } from '@planif/core';

export const app = new Hono();

app.get('/sante', (c) => c.json({ ok: true, versionModele: VERSION_MODELE_DONNEES }));
