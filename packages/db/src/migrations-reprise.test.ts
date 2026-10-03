/**
 * T26 : les migrations réessaient la connexion (refusée, coupée), jamais une erreur de migration.
 * Sans base de données : `appliquer` est factice.
 *
 * ── API attendue (packages/db/src/migrations.ts, exportée aussi par index.ts) ───────────────
 *
 *   appliquerMigrationsAvecReprise(
 *     url: string,
 *     options?: {
 *       essais?: number;      // nombre total de tentatives (défaut 10), >= 1
 *       delaiMs?: number;     // attente entre deux tentatives (défaut 500)
 *       appliquer?: (url: string) => Promise<void>;  // défaut : appliquerMigrations
 *     },
 *   ): Promise<void>
 *
 * - erreur de connexion (code ECONNREFUSED / ECONNRESET / ETIMEDOUT, ou message « Connection
 *   terminated unexpectedly ») : on attend delaiMs et on réessaie, jusqu'à `essais` tentatives
 *   au total, puis on relance la dernière erreur ;
 * - toute autre erreur (SQL, code 42P01, erreur sans code…) : relancée tout de suite, sans reprise.
 * - migrer.ts s'en sert à la place de appliquerMigrations.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { appliquerMigrationsAvecReprise } from './migrations.ts';

const URL_BASE = 'postgres://planif:planif@localhost:1/planif';

function refusee(): Error {
  return Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:55432'), { code: 'ECONNREFUSED' });
}
const coupee = (): Error => new Error('Connection terminated unexpectedly');

describe('T26 : appliquerMigrationsAvecReprise', () => {
  it('réussit après trois reprises (refusée, refusée, coupée, puis ok)', async () => {
    const appliquer = vi.fn<(url: string) => Promise<void>>();
    appliquer.mockRejectedValueOnce(refusee()).mockRejectedValueOnce(refusee()).mockRejectedValueOnce(coupee()).mockResolvedValueOnce();
    await expect(appliquerMigrationsAvecReprise(URL_BASE, { essais: 10, delaiMs: 0, appliquer })).resolves.toBeUndefined();
    expect(appliquer).toHaveBeenCalledTimes(4);
    expect(appliquer).toHaveBeenCalledWith(URL_BASE);
  });

  it('une erreur SQL (code 42P01) échoue tout de suite, sans reprise', async () => {
    const erreur = Object.assign(new Error('relation "x" does not exist'), { code: '42P01' });
    const appliquer = vi.fn<(url: string) => Promise<void>>().mockRejectedValue(erreur);
    await expect(appliquerMigrationsAvecReprise(URL_BASE, { essais: 10, delaiMs: 0, appliquer })).rejects.toBe(erreur);
    expect(appliquer).toHaveBeenCalledTimes(1);
  });

  it('une erreur sans code de connexion échoue tout de suite, sans reprise', async () => {
    const erreur = new Error('migration 0007 invalide');
    const appliquer = vi.fn<(url: string) => Promise<void>>().mockRejectedValue(erreur);
    await expect(appliquerMigrationsAvecReprise(URL_BASE, { essais: 10, delaiMs: 0, appliquer })).rejects.toBe(erreur);
    expect(appliquer).toHaveBeenCalledTimes(1);
  });

  it('plus d’échecs que d’essais : échoue avec la dernière erreur, après exactement `essais` tentatives', async () => {
    const derniere = coupee();
    const appliquer = vi.fn<(url: string) => Promise<void>>();
    appliquer.mockRejectedValueOnce(refusee()).mockRejectedValueOnce(refusee()).mockRejectedValue(derniere);
    await expect(appliquerMigrationsAvecReprise(URL_BASE, { essais: 3, delaiMs: 0, appliquer })).rejects.toBe(derniere);
    expect(appliquer).toHaveBeenCalledTimes(3);
  });

  it.each(['57P01', '57P03', 'ECONNABORTED', 'EPIPE'])('reprise aussi sur le code %s', async (code) => {
    const transitoire = Object.assign(new Error(`erreur transitoire ${code}`), { code });
    const appliquer = vi.fn<(url: string) => Promise<void>>();
    appliquer.mockRejectedValueOnce(transitoire).mockResolvedValueOnce();
    await expect(appliquerMigrationsAvecReprise(URL_BASE, { essais: 5, delaiMs: 0, appliquer })).resolves.toBeUndefined();
    expect(appliquer).toHaveBeenCalledTimes(2);
  });

  it('migrer.ts passe par la reprise', () => {
    const source = readFileSync(new URL('./migrer.ts', import.meta.url), 'utf8');
    expect(source).toContain('appliquerMigrationsAvecReprise');
  });
});
