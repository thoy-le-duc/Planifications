import { describe, expect, it } from 'vitest';
import { app } from './app.ts';

describe('API', () => {
  it('répond sur /sante', async () => {
    const res = await app.request('/sante');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, versionModele: 1 });
  });
});
