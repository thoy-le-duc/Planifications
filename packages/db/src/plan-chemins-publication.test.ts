/**
 * Tests d'acceptation T61 — garde-fou T67 sur les nouvelles tables : les migrations publient
 * `chemin`, `point_plan`, `lieu_rangement`, `place_rangement` et `outil` dans la publication
 * « powersync », chacune a son flux dans powersync/sync-config.yaml, et le garde-fou
 * (publication-flux.test.ts) ne voit aucun écart. Un oubli d'un côté (table publiée sans flux, ou
 * flux sur une table non publiée) ferait une table qui ne descend sur aucun téléphone, sans erreur.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ecartsPublicationFlux, tablesDesFlux, tablesPublieesPowerSync } from './test/publication-flux.ts';

const RACINE = fileURLToPath(new URL('../../../', import.meta.url));
const DOSSIER = `${RACINE}packages/db/migrations/`;
const NOUVELLES = ['chemin', 'lieu_rangement', 'outil', 'place_rangement', 'point_plan'];

const journal = JSON.parse(readFileSync(`${DOSSIER}meta/_journal.json`, 'utf8')) as { entries: { idx: number; tag: string }[] };
const migrations = [...journal.entries].sort((a, b) => a.idx - b.idx).map((e) => readFileSync(`${DOSSIER}${e.tag}.sql`, 'utf8'));
const regles = readFileSync(`${RACINE}powersync/sync-config.yaml`, 'utf8');

describe('T61 : publication et flux des tables du plan et du rangement', () => {
  it('les migrations publient les cinq tables', () => {
    expect(tablesPublieesPowerSync(migrations)).toEqual(expect.arrayContaining(NOUVELLES));
  });

  it('chacune a son flux (table principale du flux)', () => {
    expect(tablesDesFlux(regles).principales).toEqual(expect.arrayContaining(NOUVELLES));
  });

  it('aucun écart entre publication et flux, avec les nouvelles tables', () => {
    expect(ecartsPublicationFlux(tablesPublieesPowerSync(migrations), regles)).toEqual({ sansFlux: [], sansPublication: [] });
  });

  it('rouge si un flux est retiré (exemple tronqué : outil)', () => {
    const lignes = regles.split('\n');
    const debut = lignes.findIndex((l) => l === '  outil:');
    expect(debut, 'flux outil présent').toBeGreaterThanOrEqual(0);
    let fin = debut + 1;
    while (fin < lignes.length && /^ {4,}\S/.test(lignes[fin] ?? '')) fin += 1;
    const tronquees = [...lignes.slice(0, debut), ...lignes.slice(fin)].join('\n');
    expect(ecartsPublicationFlux(tablesPublieesPowerSync(migrations), tronquees)).toEqual({ sansFlux: ['outil'], sansPublication: [] });
  });
});
