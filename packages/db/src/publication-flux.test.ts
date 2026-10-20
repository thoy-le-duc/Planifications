/**
 * T67 : garde-fou « publication ↔ flux ».
 *
 * Toute table de la publication PowerSync `powersync`, telle que les migrations de @planif/db la
 * construisent (dans l'ordre du journal Drizzle), a son flux dans `powersync/sync-config.yaml`, et
 * inversement : chaque flux lit une table publiée. Sans ce garde-fou, une table publiée sans flux
 * ne descend sur aucun téléphone (T60, T54 : sans erreur visible), et un flux sur une table non
 * publiée reste vide.
 *
 * - `tablesPublieesPowerSync(migrations)` : rejoue CREATE / ALTER … ADD, DROP, SET TABLE / DROP
 *   PUBLICATION sur la publication `powersync`, commentaires SQL ignorés ; une forme inconnue
 *   (FOR ALL TABLES…) lève une erreur plutôt que d'être ignorée.
 * - `tablesDesFlux(regles)` : `principales`, la table de chaque flux (premier FROM de sa requête) ;
 *   `lues`, toutes les tables lues (FROM, JOIN) par les flux et les requêtes `with`, sans les noms
 *   des requêtes `with` elles-mêmes.
 * - `ecartsPublicationFlux(publiees, regles)` : `sansFlux` (publiée, aucun flux), `sansPublication`
 *   (lue par les règles, non publiée), triées.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ecartsPublicationFlux, tablesDesFlux, tablesPublieesPowerSync } from './test/publication-flux.ts';

const RACINE = fileURLToPath(new URL('../../../', import.meta.url));
const DOSSIER_MIGRATIONS = `${RACINE}packages/db/migrations/`;
const CHEMIN_REGLES = `${RACINE}powersync/sync-config.yaml`;

/** Les migrations dans l'ordre où `migrer` les applique (journal Drizzle). */
function migrationsDansLOrdre(): string[] {
  const journal = JSON.parse(readFileSync(`${DOSSIER_MIGRATIONS}meta/_journal.json`, 'utf8')) as {
    entries: { idx: number; tag: string }[];
  };
  return [...journal.entries]
    .sort((a, b) => a.idx - b.idx)
    .map((entree) => readFileSync(`${DOSSIER_MIGRATIONS}${entree.tag}.sql`, 'utf8'));
}

const regles = readFileSync(CHEMIN_REGLES, 'utf8');

/** Retire un flux (sa clé et ses lignes indentées) du texte des règles. */
function sansLeFlux(texte: string, flux: string): string {
  const lignes = texte.split('\n');
  const debut = lignes.findIndex((ligne) => ligne === `  ${flux}:`);
  if (debut < 0) throw new Error(`flux ${flux} introuvable`);
  let fin = debut + 1;
  while (fin < lignes.length && /^ {4,}\S/.test(lignes[fin] ?? '')) fin += 1;
  return [...lignes.slice(0, debut), ...lignes.slice(fin)].join('\n');
}

describe('T67 : tablesPublieesPowerSync', () => {
  it('rejoue CREATE puis ALTER … ADD, DROP et SET TABLE, commentaires ignorés', () => {
    const publiees = tablesPublieesPowerSync([
      `-- CREATE PUBLICATION powersync FOR TABLE piege;
       CREATE PUBLICATION powersync FOR TABLE
         ferme, zone, -- commentaire, autre_piege
         public.emplacement
         WITH (publish = 'insert, update, delete');`,
      'ALTER PUBLICATION powersync ADD TABLE utilisateur, membre;',
      "ALTER PUBLICATION powersync SET (publish = 'insert, update, delete, truncate');",
      'ALTER PUBLICATION powersync DROP TABLE zone;',
      'alter publication powersync add table "batiment";',
    ]);
    expect(publiees).toEqual(['batiment', 'emplacement', 'ferme', 'membre', 'utilisateur']);
  });

  it('SET TABLE remplace la liste, DROP PUBLICATION la vide', () => {
    expect(
      tablesPublieesPowerSync(['CREATE PUBLICATION powersync FOR TABLE a, b;', 'ALTER PUBLICATION powersync SET TABLE c;']),
    ).toEqual(['c']);
    expect(
      tablesPublieesPowerSync([
        'CREATE PUBLICATION powersync FOR TABLE a;',
        'DROP PUBLICATION powersync;',
        'CREATE PUBLICATION powersync FOR TABLE b;',
      ]),
    ).toEqual(['b']);
  });

  it('ignore les autres publications', () => {
    expect(
      tablesPublieesPowerSync(['CREATE PUBLICATION autre FOR TABLE x;', 'CREATE PUBLICATION powersync FOR TABLE a;']),
    ).toEqual(['a']);
  });

  it('refuse une forme qu’il ne sait pas lire, plutôt que de l’ignorer', () => {
    expect(() => tablesPublieesPowerSync(['CREATE PUBLICATION powersync FOR ALL TABLES;'])).toThrow(/powersync/);
    expect(() => tablesPublieesPowerSync(['ALTER PUBLICATION powersync RENAME TO autre;'])).toThrow(/powersync/);
  });

  it('les vraies migrations publient les tables connues (dont celles de T60 et T54)', () => {
    const publiees = tablesPublieesPowerSync(migrationsDansLOrdre());
    expect(publiees).toEqual(
      expect.arrayContaining(['ferme', 'membre', 'refus_synchro', 'batiment', 'personne', 'attribution', 'produit_fertilisant']),
    );
    expect(publiees).not.toContain('code_connexion');
    expect(publiees).not.toContain('jeton_renouvellement');
  });
});

describe('T67 : tablesDesFlux', () => {
  it('donne la table de chaque flux et toutes les tables lues, sans les noms des requêtes with', () => {
    const exemple = `
config:
  edition: 3
with:
  fermes_actives: >-
    SELECT m.ferme_id AS ferme_id FROM membre m
    INNER JOIN ferme f ON f.id = m.ferme_id
streams:
  zone:
    auto_subscribe: true
    query: SELECT * FROM zone WHERE ferme_id IN (SELECT ferme_id FROM fermes_actives)
  famille_ferme:
    query: SELECT * FROM famille WHERE ferme_id IN (SELECT ferme_id FROM fermes_actives)
  famille_reference:
    query: select * from famille where ferme_id is null
`;
    const flux = tablesDesFlux(exemple);
    expect(flux.principales).toEqual(['famille', 'zone']);
    expect(flux.lues).toEqual(['famille', 'ferme', 'membre', 'zone']);
  });
});

describe('T67 : chaque table publiée a son flux, et inversement', () => {
  const publiees = tablesPublieesPowerSync(migrationsDansLOrdre());

  it('aucun écart entre la publication des migrations et powersync/sync-config.yaml', () => {
    expect(ecartsPublicationFlux(publiees, regles)).toEqual({ sansFlux: [], sansPublication: [] });
  });

  it('rouge si l’on retire un flux (exemple tronqué : produit_fertilisant)', () => {
    const tronquees = sansLeFlux(regles, 'produit_fertilisant');
    expect(tronquees).not.toContain('FROM produit_fertilisant');
    expect(ecartsPublicationFlux(publiees, tronquees)).toEqual({ sansFlux: ['produit_fertilisant'], sansPublication: [] });
  });

  it('rouge si une migration oublie de publier une table qu’un flux lit (exemple tronqué : 0041)', () => {
    const tronquees = migrationsDansLOrdre().map((sql) =>
      sql.replace('ALTER PUBLICATION powersync ADD TABLE produit_fertilisant;', ''),
    );
    const publieesTronquees = tablesPublieesPowerSync(tronquees);
    expect(publieesTronquees).not.toContain('produit_fertilisant');
    expect(ecartsPublicationFlux(publieesTronquees, regles)).toEqual({ sansFlux: [], sansPublication: ['produit_fertilisant'] });
  });
});
