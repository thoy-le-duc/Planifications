/** CORS (T10) : liste blanche exacte, rien par défaut. */
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { lireCorsOrigines } from './config.ts';
import { corsListeBlanche } from './cors.ts';

describe('CORS_ORIGINES', () => {
  it('absente ou vide : aucune origine', () => {
    expect(lireCorsOrigines({})).toEqual([]);
    expect(lireCorsOrigines({ CORS_ORIGINES: ' ' })).toEqual([]);
  });

  it('lit une liste séparée par des virgules', () => {
    expect(lireCorsOrigines({ CORS_ORIGINES: 'https://app.planif.fr, http://localhost:4174' })).toEqual([
      'https://app.planif.fr',
      'http://localhost:4174',
    ]);
  });

  it.each(['*', 'app.planif.fr', 'https://app.planif.fr/', 'https://app.planif.fr/chemin', 'ftp://planif.fr'])(
    'refuse « %s » (pas une origine exacte)',
    (origine) => {
      expect(() => lireCorsOrigines({ CORS_ORIGINES: origine })).toThrow(/CORS_ORIGINES/);
    },
  );
});

describe('corsListeBlanche', () => {
  const app = new Hono();
  app.use('*', corsListeBlanche(['http://localhost:4174']));
  app.post('/sync/upload', (c) => c.json({ ok: true }));

  it('autorise une origine de la liste, préflight compris', async () => {
    const res = await app.request('/sync/upload', {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:4174',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization, content-type',
      },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:4174');
    expect(res.headers.get('access-control-allow-headers')).toMatch(/authorization/);
  });

  it('n’autorise pas une autre origine', async () => {
    const res = await app.request('/sync/upload', { method: 'POST', headers: { origin: 'https://piege.example' } });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});
