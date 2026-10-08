import { describe, expect, it } from 'vitest';
import { MESURES_MIN, medianeDe, mesurer, mesurerAsync } from './mesurer.ts';

const cpu = (): number => {
  const u = (globalThis as unknown as { process: { cpuUsage(): { user: number; system: number } } }).process.cpuUsage();
  return (u.user + u.system) / 1000;
};
/** Consomme `ms` ms de CPU (et non d'horloge, que la charge de la machine fausserait). */
const brûler = (ms: number): void => {
  const fin = cpu() + ms;
  while (cpu() < fin);
};

describe('mesurer (T31)', () => {
  it('médiane : valeur du milieu, insensible à une valeur aberrante', () => {
    expect(medianeDe([5, 1, 3])).toBe(3);
    expect(medianeDe([1, 2, 3, 4, 1000])).toBe(3);
  });

  it('échauffement hors mesure, puis au moins 5 mesures, et rend le dernier résultat', () => {
    let appels = 0;
    const r = mesurer(() => ++appels, { echauffement: 2, mesures: 5 });
    expect(appels).toBe(7);
    expect(r.serie).toHaveLength(5);
    expect(r.resultat).toBe(7);
  });

  it('refuse moins de 5 mesures', () => {
    expect(() => mesurer(() => 1, { mesures: MESURES_MIN - 1 })).toThrow(/au moins 5/);
  });

  it('un code vraiment lent reste lent (pas masqué par le min mural/CPU)', () => {
    const r = mesurer(() => { brûler(20); }, { echauffement: 0, mesures: 5 });
    expect(r.mediane).toBeGreaterThanOrEqual(20);
  });

  it('manches refaites tant que la médiane dépasse la borne, au plus 3 ; la meilleure est gardée', () => {
    const durees = [30, 30, 30, 30, 30, 5, 5, 5, 5, 5];
    let appel = 0;
    const r = mesurer(() => { brûler(durees[appel++] ?? 5); }, { echauffement: 0, mesures: 5, borneMs: 20 });
    expect(r.serie).toHaveLength(5);
    expect(r.mediane).toBeLessThan(20);
    expect(appel).toBe(10);
  });

  it('une borne toujours dépassée : trois manches, la médiane reste au-dessus de la borne', () => {
    let appels = 0;
    const r = mesurer(() => { appels++; brûler(6); }, { echauffement: 0, mesures: 5, borneMs: 3 });
    expect(appels).toBe(15);
    expect(r.mediane).toBeGreaterThanOrEqual(3);
  });

  it('version asynchrone', async () => {
    const r = await mesurerAsync(() => Promise.resolve('ok'), { echauffement: 1, mesures: 5 });
    expect(r.resultat).toBe('ok');
    expect(r.serie).toHaveLength(5);
  });
});
