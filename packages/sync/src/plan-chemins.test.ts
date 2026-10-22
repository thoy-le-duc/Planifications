/**
 * Tests d'acceptation T61 — chemins, points du plan, lieux de rangement et outils descendent sur
 * le téléphone (docs/backlog/T61-chemins-outils.md), filtrés par ferme dans les règles de synchro
 * (isolement entre fermes). Le garde-fou « publication ↔ flux » (T67, packages/db/src/
 * publication-flux.test.ts) doit rester vert : chaque table publiée a son flux, et inversement.
 *
 * Colonnes locales = celles de Postgres sans `id` (docs de plan-chemins.integration.test.ts) :
 * nombres en réel, `points` (jsonb) en texte JSON, horodatages en texte.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SCHEMA_LOCAL, TABLES_LOCALES } from './schema.ts';

const regles = readFileSync(new URL('../../../powersync/sync-config.yaml', import.meta.url), 'utf8');
const T = 'texte';
const HORO = { cree_le: T, modifie_le: T, supprime_le: T };

const ATTENDU: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  chemin: { ferme_id: T, nom: T, points: T, largeur_m: 'reel', ...HORO },
  point_plan: { ferme_id: T, nom: T, sorte: T, x_m: 'reel', y_m: 'reel', ...HORO },
  lieu_rangement: { ferme_id: T, batiment_id: T, point_plan_id: T, ...HORO },
  place_rangement: { ferme_id: T, lieu_rangement_id: T, nom: T, ...HORO },
  outil: { ferme_id: T, nom: T, lieu_rangement_id: T, place_rangement_id: T, ...HORO },
};

/** Les requêtes de flux (sur une ou plusieurs lignes), espaces normalisés. */
function requetes(): string[] {
  return [...regles.matchAll(/query:[ \t]*(?:>-?[ \t]*\n((?:[ \t]{6,}[^\n]*\n?)+)|(SELECT[^\n]*))/g)].map((r) => (r[1] ?? r[2] ?? '').replace(/\s+/g, ' ').trim());
}

describe('T61 : schéma local', () => {
  it.each(Object.keys(ATTENDU))('%s : colonnes locales (nombres en réel, JSON en texte)', (table) => {
    const locales = TABLES_LOCALES as Readonly<Record<string, Readonly<Record<string, string>> | undefined>>;
    expect(locales[table]).toEqual(ATTENDU[table]);
    expect(SCHEMA_LOCAL.tables.some((t) => t.name === table)).toBe(true);
  });
});

describe('T61 : règles de synchro, un flux par table, filtré par ferme', () => {
  it.each(Object.keys(ATTENDU))('%s : SELECT * … WHERE ferme_id IN (SELECT ferme_id FROM fermes_actives), une seule requête', (table) => {
    const mesRequetes = requetes().filter((q) => new RegExp(`\\bFROM ${table}\\b`).test(q));
    expect(mesRequetes).toEqual([`SELECT * FROM ${table} WHERE ferme_id IN (SELECT ferme_id FROM fermes_actives)`]);
  });

  it.each(Object.keys(ATTENDU))('%s : flux à abonnement automatique, comme batiment', (table) => {
    expect(regles).toMatch(new RegExp(`^ {2}${table}:\\n {4}auto_subscribe: true\\n`, 'm'));
  });

  it('aucune requête de ces tables n’envoie les lignes d’une autre ferme (pas de ferme_id nul, pas de jointure libre)', () => {
    const siennes = requetes().filter((x) => /\bFROM (chemin|point_plan|lieu_rangement|place_rangement|outil)\b/.test(x));
    expect(siennes, 'cinq flux').toHaveLength(5);
    for (const q of siennes) {
      expect(q, q).toContain('ferme_id IN (SELECT ferme_id FROM fermes_actives)');
      expect(q, q).not.toMatch(/\bIS NULL\b|\bOR\b|\bUNION\b/i);
    }
  });

  it('le flux batiment ne change pas (même découpage par ferme que zone)', () => {
    const q = requetes().filter((x) => /\bFROM batiment\b/.test(x));
    expect(q).toEqual(['SELECT * FROM batiment WHERE ferme_id IN (SELECT ferme_id FROM fermes_actives)']);
  });
});
