/**
 * T13n : l'ordre canonique des horodatages (`horodatage.ts`). Une seule règle en JavaScript
 * (`instantHorodatage`, `comparerSaisies`) et en SQL (`cleHorodatageSql`) : les deux doivent
 * donner exactement le même ordre, vérifié ici contre la vraie lecture de SQLite (node:sqlite).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleHorodatageSql } from './fait-unique.ts';
import { comparerSaisies, instantHorodatage } from './horodatage.ts';
import { SCHEMA_LOCAL } from './schema.ts';
import { creerBaseMemoire, type BaseMemoire } from './test/base-memoire.ts';

const bases: BaseMemoire[] = [];
afterEach(() => {
  for (const b of bases.splice(0)) b.fermer();
});

/** La clé SQL de chaque horodatage, lue par SQLite. */
function clesSql(horodatages: readonly unknown[]): string[] {
  const b = creerBaseMemoire(SCHEMA_LOCAL);
  bases.push(b);
  return horodatages.map((h) => b.lireDirect<{ c: string }>(`WITH t(h) AS (SELECT ?) SELECT ${cleHorodatageSql('h', "'x'")} AS c FROM t`, [h])[0]?.c ?? 'absente');
}

/** La même clé, calculée en JavaScript. */
const cleJs = (h: unknown): string => `${String(instantHorodatage(h)).padStart(15, '0')}|x`;

const FORMES = [
  '2026-10-01T10:00:00.000Z',
  '2026-10-01T10:00:00Z',
  '2026-10-01 10:00:00Z',
  '2026-10-01T10:00:00.5Z',
  '2026-10-01T10:00:00.001Z',
  '2026-10-01T10:00:10.001Z',
  '2026-10-01T10:00:00.0005Z',
  '2026-10-01T10:00:00.0004999Z',
  '2026-10-01T10:00:00.9999999Z',
  '2026-10-01T10:00:00.123456+00:00',
  '2026-10-01 10:00:00.5+00:00',
  '2026-10-01 10:00:00.5 +02:00',
  '2026-10-01T10:00:00-05:30',
  '2026-10-01T10:00:00+14:00',
  '2026-10-01T10:00z',
  '2026-10-01T10:00',
  '2026-10-01T10:00:00',
  '2026-10-01T',
  '2026-10-01 ',
  '2026-10-01TT 10:00:00Z ',
  '2026-02-30T24:00:00Z',
  '2026-01-15T12:00:00Z',
  '2024-02-29T23:59:59.999Z',
  '0000-01-01T00:00:00Z',
  '0000-02-28T12:00:00Z',
  '0001-03-01T00:00:00Z',
  '1582-10-15T00:00:00Z',
  '9999-12-31T23:59:59.999Z',
  // Illisibles : instant 0 des deux côtés.
  '2026-10-01T10:00:00+15:00',
  '2026-10-01T10:60:00Z',
  '2026-10-01T25:00:00Z',
  '2026-13-01T10:00:00Z',
  '2026-10-32T10:00:00Z',
  '2026-10-01T10:00:00.Z',
  '2026-10-01T10:00:00 x',
  '2026-10-01T10:00:00+0000',
  '2026-10-01T10:00:00+00',
  '2026-10-01',
  '2026-10-01\t10:00:00Z',
  '2461000.5',
  'now',
  '',
  'n’importe quoi',
  '0000-01-01T00:00:00+01:00',
  null,
  42,
];

describe('T13n : instantHorodatage, comme julianday de SQLite', () => {
  it('même instant que SQLite pour chaque forme, lisible ou non', () => {
    expect(FORMES.map(cleJs)).toEqual(clesSql(FORMES));
  });

  it('même instant que SQLite sur des horodatages tirés au hasard', () => {
    let graine = 13;
    const hasard = (n: number): number => {
      graine = (graine * 1_103_515_245 + 12_345) % 2_147_483_648;
      return graine % n;
    };
    const deux = (n: number): string => String(n).padStart(2, '0');
    const tires = Array.from({ length: 2000 }, () => {
      const date = `${String(hasard(10_000)).padStart(4, '0')}-${deux(1 + hasard(12))}-${deux(1 + hasard(31))}`;
      const fraction = hasard(3) === 0 ? '' : `.${String(hasard(10_000_000)).slice(0, 1 + hasard(7))}`;
      const fuseau = ['', 'Z', '+00:00', `-${deux(hasard(15))}:${deux(hasard(60))}`, `+${deux(hasard(15))}:${deux(hasard(60))}`][hasard(5)] ?? '';
      return `${date}${hasard(2) === 0 ? 'T' : ' '}${deux(hasard(25))}:${deux(hasard(60))}:${deux(hasard(60))}${fraction}${fuseau}`;
    });
    expect(tires.map(cleJs)).toEqual(clesSql(tires));
  });

  it('fuseau de Postgres sans deux-points (±HH, ±HHMM) : même instant que SQLite, lu comme ±HH:MM', () => {
    const formes = [
      '2026-10-10 10:00:00.123+00',
      '2026-10-10 10:00:00+00',
      '2026-10-10 10:00:00.5-05',
      '2026-10-10T10:00:00+14',
      '2026-10-10 10:00:00.123456+0000',
      '2026-10-10 10:00:00+0530',
      '2026-10-10T10:00-0930',
      '2026-10-10 10:00+02',
      // Illisibles des deux côtés.
      '2026-10-10 10:00:00+15',
      '2026-10-10 10:00:00+0560',
      '2026-10-10 10:00:00+00 ',
      '2026-10-10 10:00:00+0',
      '2026-10-10 10:00:00+000',
      '2026-10-10 10:00:00+00000',
      '2026-10-10',
      '-12',
      '+0530',
    ];
    expect(formes.map(cleJs)).toEqual(clesSql(formes));
    expect(instantHorodatage('2026-10-10 10:00:00.123+00')).toBe(instantHorodatage('2026-10-10T10:00:00.123Z'));
    expect(instantHorodatage('2026-10-10 10:00:00+0530')).toBe(instantHorodatage('2026-10-10T04:30:00Z'));
    expect(instantHorodatage('2026-10-10 10:00:00+00 ')).toBe(0);
  });

  it('fuseaux ±HH et ±HHMM tirés au hasard : même instant que SQLite', () => {
    let graine = 1013;
    const hasard = (n: number): number => {
      graine = (graine * 1_103_515_245 + 12_345) % 2_147_483_648;
      return graine % n;
    };
    const deux = (n: number): string => String(n).padStart(2, '0');
    const tires = Array.from({ length: 1000 }, () => {
      const fraction = hasard(2) === 0 ? '' : `.${String(hasard(1_000_000)).slice(0, 1 + hasard(6))}`;
      const fuseau = `${hasard(2) === 0 ? '+' : '-'}${deux(hasard(16))}${hasard(2) === 0 ? '' : deux(hasard(61))}`;
      return `2026-${deux(1 + hasard(12))}-${deux(1 + hasard(31))} ${deux(hasard(24))}:${deux(hasard(60))}:${deux(hasard(60))}${fraction}${fuseau}`;
    });
    expect(tires.map(cleJs)).toEqual(clesSql(tires));
  });

  it('même ordre que la clé SQL entre formats Postgres et toISOString', () => {
    const s = (id: string, horodatage: string) => ({ id, horodatage });
    expect(comparerSaisies(s('a', '2026-10-10 10:00:00.5+00'), s('b', '2026-10-10T10:00:00.400Z'))).toBeGreaterThan(0);
    expect(comparerSaisies(s('b', '2026-10-10 10:00:00+00'), s('a', '2026-10-10T10:00:00.000Z'))).toBeGreaterThan(0);
    const [ka, kb] = clesSql(['2026-10-10 10:00:00.5+00', '2026-10-10T10:00:00.400Z']);
    expect((ka ?? '') > (kb ?? '')).toBe(true);
  });

  it('sans fuseau, l’heure est en UTC', () => {
    expect(instantHorodatage('2026-10-01T10:00:00')).toBe(instantHorodatage('2026-10-01T10:00:00.000Z'));
  });

  it('un horodatage illisible ne lève jamais et vaut 0', () => {
    for (const h of ['', 'now', '2026-10-01', null, undefined, 42, {}]) expect(instantHorodatage(h)).toBe(0);
  });
});

describe('T13n : comparerSaisies, ordre (instant, id)', () => {
  const s = (id: string, horodatage: string) => ({ id, horodatage });

  it('le plus récent instant gagne, quel que soit le format', () => {
    expect(comparerSaisies(s('a', '2026-10-01T10:00:00.5Z'), s('b', '2026-10-01T10:00:00Z'))).toBeGreaterThan(0);
    expect(comparerSaisies(s('b', '2026-10-01T10:00:00.400Z'), s('a', '2026-10-01 10:00:00.5+00:00'))).toBeLessThan(0);
  });

  it('même instant dans deux formats : l’id départage', () => {
    expect(comparerSaisies(s('b', '2026-10-01 10:00:00+00:00'), s('a', '2026-10-01T10:00:00.000Z'))).toBeGreaterThan(0);
    expect(comparerSaisies(s('a', '2026-10-01 10:00:00+00:00'), s('b', '2026-10-01T10:00:00.000Z'))).toBeLessThan(0);
    expect(comparerSaisies(s('a', '2026-10-01T10:00:00Z'), s('a', '2026-10-01T10:00:00Z'))).toBe(0);
  });

  it('un horodatage illisible est le plus ancien, puis l’id départage', () => {
    expect(comparerSaisies(s('z', 'illisible'), s('a', '0000-01-01T00:00:00Z'))).toBeLessThan(0);
    expect(comparerSaisies(s('b', 'illisible'), s('a', ''))).toBeGreaterThan(0);
  });

  it('même ordre que la clé SQL, sur toutes les paires de formes', () => {
    const textes = FORMES.filter((h): h is string => typeof h === 'string');
    const cles = clesSql(textes);
    for (const [i, a] of textes.entries()) {
      for (const [j, b] of textes.entries()) {
        // Ordre SQL : l'instant (15 chiffres), puis l'id (ici le rang, sur trois chiffres).
        const ka = (cles[i] ?? '').slice(0, 15);
        const kb = (cles[j] ?? '').slice(0, 15);
        const attendu = ka === kb ? Math.sign(i - j) : ka > kb ? 1 : -1;
        expect(Math.sign(comparerSaisies(s(String(i).padStart(3, '0'), a), s(String(j).padStart(3, '0'), b))), `${a} / ${b}`).toBe(attendu);
      }
    }
  });
});
