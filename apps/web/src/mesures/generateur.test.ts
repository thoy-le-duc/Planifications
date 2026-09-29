/**
 * T07 — tests d'acceptation du générateur déterministe de ferme.
 *
 * Contrat attendu de `./generateur.ts` (autonome : n'importe pas `@planif/core`,
 * pour ne pas attendre T01 ; noms de champs en snake_case comme les colonnes SQL) :
 *
 *   export function genererFerme(graine: number): FermeGeneree;
 *
 *   interface FermeGeneree {
 *     familles: { id: string; nom: string }[];                       // au moins 5
 *     zones: { id: string; nom: string }[];                           // exactement 30
 *     emplacements: { id: string; zone_id: string; code: string; longueur_m: number }[]; // 400
 *     saisons: { id: string; nom: string; debut: string; fin: string }[]; // 5 années civiles consécutives
 *     series: { id: string; saison_id: string; famille_id: string; espece: string }[];   // 3 000
 *     occupations: { id: string; emplacement_id: string; serie_id: string; du: string; au: string }[]; // 3 000
 *     evenements: {
 *       id: string;
 *       type: 'realise' | 'recolte' | 'intervention' | 'irrigation' | 'traitement' | 'observation';
 *       date: string;
 *       serie_id: string | null;
 *       emplacement_id: string | null;
 *     }[];                                                            // 30 000
 *   }
 *
 * Les objets peuvent porter d'autres champs ; seuls ceux ci-dessus sont exigés.
 * Toutes les dates sont des chaînes `AAAA-MM-JJ`. Saison = année civile : `debut` = `AAAA-01-01`,
 * `fin` = `AAAA-12-31`. Le hasard vient d'un générateur pseudo-aléatoire amorcé par `graine`
 * (jamais `Math.random`, jamais l'heure courante).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { genererFerme } from './generateur.ts';

const GRAINE = 42;
const TYPES_EVENEMENT = ['realise', 'recolte', 'intervention', 'irrigation', 'traitement', 'observation'];

const ferme = genererFerme(GRAINE);

function dateValide(texte: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texte)) return false;
  const [a, m, j] = texte.split('-').map(Number) as [number, number, number];
  const d = new Date(Date.UTC(a, m - 1, j));
  return d.getUTCFullYear() === a && d.getUTCMonth() === m - 1 && d.getUTCDate() === j;
}

function ids(lignes: readonly { id: string }[]): Set<string> {
  return new Set(lignes.map((l) => l.id));
}

describe('genererFerme : volumes d’une vraie ferme', () => {
  it('30 zones, 400 emplacements, 3 000 séries, 3 000 occupations, 30 000 événements', () => {
    expect(ferme.zones).toHaveLength(30);
    expect(ferme.emplacements).toHaveLength(400);
    expect(ferme.series).toHaveLength(3000);
    expect(ferme.occupations).toHaveLength(3000);
    expect(ferme.evenements).toHaveLength(30_000);
  });

  it('5 saisons en années civiles consécutives', () => {
    expect(ferme.saisons).toHaveLength(5);
    const annees = ferme.saisons.map((s) => Number(s.debut.slice(0, 4))).sort((a, b) => a - b);
    for (const [i, annee] of annees.entries()) expect(annee).toBe((annees[0] ?? 0) + i);
    for (const s of ferme.saisons) {
      expect(s.debut).toMatch(/^\d{4}-01-01$/);
      expect(s.fin).toBe(`${s.debut.slice(0, 4)}-12-31`);
    }
  });

  it('les séries sont réparties sur les 5 saisons (au moins 300 par saison)', () => {
    const parSaison = new Map<string, number>();
    for (const s of ferme.series) parSaison.set(s.saison_id, (parSaison.get(s.saison_id) ?? 0) + 1);
    expect(parSaison.size).toBe(5);
    for (const n of parSaison.values()) expect(n).toBeGreaterThanOrEqual(300);
  });

  it('au moins 5 familles, et des événements de plusieurs types connus', () => {
    expect(ferme.familles.length).toBeGreaterThanOrEqual(5);
    const types = new Set(ferme.evenements.map((e) => e.type));
    for (const t of types) expect(TYPES_EVENEMENT).toContain(t);
    expect(types.size).toBeGreaterThanOrEqual(3);
  });
});

describe('genererFerme : déterminisme', () => {
  it('même graine, même ferme, en profondeur', () => {
    expect(JSON.stringify(genererFerme(GRAINE))).toBe(JSON.stringify(ferme));
  });

  it('graine différente, ferme différente', () => {
    expect(JSON.stringify(genererFerme(GRAINE + 1))).not.toBe(JSON.stringify(ferme));
  });

  it('le source n’utilise ni Math.random, ni l’heure courante, ni @planif/core', () => {
    const source = readFileSync(join(import.meta.dirname, 'generateur.ts'), 'utf8');
    expect(source).not.toMatch(/Math\.random/);
    expect(source).not.toMatch(/Date\.now|new Date\(\s*\)|performance\.now/);
    expect(source).not.toMatch(/@planif\/core/);
  });
});

/** Identifiants des lignes qui ne respectent pas la règle (liste vide attendue). Un seul `expect` par règle : rapide sur 30 000 lignes. */
function fautifs<T extends { id: string }>(lignes: readonly T[], regle: (l: T) => boolean): string[] {
  return lignes.filter((l) => !regle(l)).map((l) => l.id).slice(0, 10);
}

describe('genererFerme : cohérence référentielle', () => {
  const familles = ids(ferme.familles);
  const zones = ids(ferme.zones);
  const emplacements = ids(ferme.emplacements);
  const saisons = ids(ferme.saisons);
  const series = ids(ferme.series);

  it('identifiants uniques dans chaque table', () => {
    const { familles: f, zones: z, emplacements: e, saisons: sa, series: se, occupations: o, evenements: ev } = ferme;
    for (const table of [f, z, e, sa, se, o, ev]) expect(ids(table).size).toBe(table.length);
  });

  it('chaque emplacement pointe vers une zone existante, codes uniques, longueur positive', () => {
    expect(fautifs(ferme.emplacements, (e) => zones.has(e.zone_id))).toEqual([]);
    expect(new Set(ferme.emplacements.map((e) => e.code)).size).toBe(400);
    expect(fautifs(ferme.emplacements, (e) => e.longueur_m > 0)).toEqual([]);
  });

  it('chaque série pointe vers une saison et une famille existantes', () => {
    expect(fautifs(ferme.series, (s) => saisons.has(s.saison_id) && familles.has(s.famille_id))).toEqual([]);
  });

  it('chaque occupation pointe vers un emplacement et une série existants', () => {
    expect(fautifs(ferme.occupations, (o) => emplacements.has(o.emplacement_id) && series.has(o.serie_id))).toEqual([]);
  });

  it('chaque événement pointe vers une série ou un emplacement existant', () => {
    expect(
      fautifs(
        ferme.evenements,
        (e) =>
          (e.serie_id !== null || e.emplacement_id !== null) &&
          (e.serie_id === null || series.has(e.serie_id)) &&
          (e.emplacement_id === null || emplacements.has(e.emplacement_id)),
      ),
    ).toEqual([]);
  });
});

describe('genererFerme : dates', () => {
  const debuts = ferme.saisons.map((s) => s.debut).sort();
  const fins = ferme.saisons.map((s) => s.fin).sort();
  const premier = debuts[0] ?? '';
  const dernier = fins[fins.length - 1] ?? '';
  const saisonParId = new Map(ferme.saisons.map((s) => [s.id, s]));
  const serieParId = new Map(ferme.series.map((s) => [s.id, s]));
  const dansLaPlage = (d: string): boolean => d >= premier && d <= dernier;

  it('dates des saisons valides', () => {
    expect(fautifs(ferme.saisons, (s) => dateValide(s.debut) && dateValide(s.fin))).toEqual([]);
  });

  it('occupations : dates valides, du ≤ au, dans la plage des 5 ans', () => {
    expect(
      fautifs(ferme.occupations, (o) => dateValide(o.du) && dateValide(o.au) && o.du <= o.au && dansLaPlage(o.du) && dansLaPlage(o.au)),
    ).toEqual([]);
  });

  it('une occupation commence dans la saison de sa série', () => {
    expect(
      fautifs(ferme.occupations, (o) => {
        const saison = saisonParId.get(serieParId.get(o.serie_id)?.saison_id ?? '');
        return saison !== undefined && o.du >= saison.debut && o.du <= saison.fin;
      }),
    ).toEqual([]);
  });

  it('événements : dates valides, dans la plage des 5 ans', () => {
    expect(fautifs(ferme.evenements, (e) => dateValide(e.date) && dansLaPlage(e.date))).toEqual([]);
  });
});
