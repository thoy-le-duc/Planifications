/**
 * Tests d'acceptation T10p (aussi) — garde de la racine du dépôt dans `decrireErreur`.
 *
 * decrireErreur ne garde d'une pile que les positions sous `node:` ou sous la racine du dépôt,
 * écrites relatives à celle-ci. La racine est calculée depuis import.meta.url de journal.ts
 * (`new URL('../../../', import.meta.url)`). Si l'API est un jour regroupée en un seul fichier
 * (/app/index.js), cette racine vaut « / » (file:///) : TOUT chemin absolu serait alors « sous la
 * racine », et /home/jean@exemple.fr/… passerait, à peine raccourci en home/jean@exemple.fr/….
 *
 * ── Forme attendue ──────────────────────────────────────────────────────────────────────────
 *
 *   decrireErreur(erreur: unknown, racine?: string): string                       (journal.ts)
 *
 * `racine` : URL file:// de la racine du dépôt, finie par « / », telle que la calcule journal.ts
 * (`new URL('../../../', import.meta.url).href`). Absente : la racine calculée par journal.ts
 * (comportement actuel, couvert par journal.test.ts). Le calcul par défaut passe par la même
 * garde.
 *
 * Règle : si la racine vaut « / » (file:///), AUCUNE position de pile n'est gardée (pas de
 * « pile » dans la description). Classe et code restent.
 *
 * Relecture :
 * - Une racine passée doit être la racine calculée ou se trouver SOUS elle (après normalisation :
 *   « .. » compris) ; plus large (file:///home/), hors du dépôt, URL invalide, sans « / » final
 *   ou non file: → aucune position.
 * - `racineDepuisModule(urlModule: string): string | null` (exportée, pure) : la racine du dépôt
 *   n'est retenue que si l'URL du module se termine par `/apps/api/src/journal.ts` (ou `.js`) ;
 *   elle vaut alors l'URL jusqu'à ce suffixe, avec son « / » final. Sinon (API regroupée,
 *   autre emplacement), ou si la racine serait « / », ou URL non file: → null.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decrireErreur, racineDepuisModule } from './journal.ts';

/** Vraie racine du dépôt (apps/api/src → ../../../). */
const URL_RACINE = new URL('../../../', import.meta.url).href;

/** Racine calculée par journal.ts s'il était regroupé dans /app/index.js. */
const RACINE_REGROUPEE = new URL('../../../', 'file:///app/index.js').href;

function erreurAvecPile(): Error {
  const erreur = new TypeError('x');
  (erreur as Error & { code: string }).code = 'E_TEST';
  erreur.stack = [
    'TypeError: x',
    '    at f (file:///home/jean@exemple.fr/tomate/a.js:1:2)',
    '    at g (/home/jean/secret/b.js:3:4)',
    '    at file:///app/index.js:5:6',
    `    at h (${URL_RACINE}apps/api/src/app.ts:7:8)`,
    '    at /srv/dupont/c.js:9:10',
  ].join('\n');
  return erreur;
}

describe('T10p — racine du dépôt « / » (API regroupée en un seul fichier)', () => {
  it('témoin : la racine regroupée vaut bien file:///', () => {
    expect(RACINE_REGROUPEE).toBe('file:///');
  });

  it('témoin : une racine passée SOUS la racine calculée est prise en compte (positions relatives à elle)', () => {
    // Ancien témoin (racine file:///depot/, hors du dépôt) remplacé à la relecture : une racine
    // passée qui n'est pas sous la racine calculée ne garde plus aucune position (règle plus bas).
    const sousRacine = `${URL_RACINE}apps/api/`;
    const erreur = new Error('x');
    erreur.stack = `Error: x\n    at f (${sousRacine}src/a.ts:1:2)\n    at g (${fileURLToPath(sousRacine)}src/b.ts:3:4)`;
    const ligne = decrireErreur(erreur, sousRacine);
    expect(ligne).toContain('pile src/a.ts:1:2');
    expect(ligne).toContain('src/b.ts:3:4');
    expect(ligne).not.toContain('apps/api');
  });

  for (const [nom, racine] of [
    ['file:/// donné tel quel', 'file:///'],
    ['racine calculée depuis /app/index.js', RACINE_REGROUPEE],
  ] as const) {
    it(`${nom} : aucune position de pile gardée, classe et code restent`, () => {
      const ligne = decrireErreur(erreurAvecPile(), racine);
      expect(ligne).toContain('TypeError');
      expect(ligne).toContain('E_TEST');
      expect(ligne, 'aucune pile').not.toContain('pile');
      for (const morceau of ['home', 'jean', 'tomate', 'secret', 'app/index.js', 'apps/api', 'srv', 'dupont']) {
        expect(ligne, `ne cite pas « ${morceau} »`).not.toContain(morceau);
      }
    });
  }
});

/** Pile dont chaque frame serait gardée par une racine trop large ; la dernière est sous le dépôt. */
function erreurLarge(): Error {
  const erreur = new TypeError('x');
  erreur.stack = [
    'TypeError: x',
    '    at f (file:///home/jean@exemple.fr/tomate/a.js:1:2)',
    '    at g (/home/jean/secret/b.js:3:4)',
    `    at h (${URL_RACINE}apps/api/src/app.ts:7:8)`,
  ].join('\n');
  return erreur;
}

describe('T10p (relecture) — racine passée : la racine calculée ou dessous, sinon rien', () => {
  it('témoin : la racine calculée elle-même garde la frame du dépôt, relative', () => {
    const ligne = decrireErreur(erreurLarge(), URL_RACINE);
    expect(ligne).toContain('pile apps/api/src/app.ts:7:8');
    expect(ligne).not.toContain('jean');
  });

  for (const [nom, racine] of [
    ['plus large que le dépôt (file:///home/)', 'file:///home/'],
    ['parent de la racine calculée', new URL('../', URL_RACINE).href],
    ['hors du dépôt (file:///srv/depot/)', 'file:///srv/depot/'],
    ['sous la racine en apparence, plus large une fois normalisée (« ../../ »)', `${URL_RACINE}apps/../../`],
    ['« .. » encodé (%2e%2e)', `${URL_RACINE}apps/%2e%2e/%2e%2e/`],
    ['URL invalide', 'pas une url'],
    ['sans « / » final', URL_RACINE.slice(0, -1)],
    ['sous-dossier sans « / » final', `${URL_RACINE}apps`],
    ['non file:', 'https://exemple.fr/'],
    ['chaîne vide', ''],
  ] as const) {
    it(`${nom} : aucune position`, () => {
      const ligne = decrireErreur(erreurLarge(), racine);
      expect(ligne).toContain('TypeError');
      expect(ligne, 'aucune pile').not.toContain('pile');
      for (const morceau of ['home', 'jean', 'tomate', 'secret', 'app.ts']) expect(ligne, `ne cite pas « ${morceau} »`).not.toContain(morceau);
    });
  }
});

describe('T10p (relecture) — racineDepuisModule : racine retenue seulement depuis apps/api/src/journal.ts|js', () => {
  for (const [urlModule, attendu] of [
    ['file:///app/index.js', null],
    ['file:///home/a/b/c/index.js', null],
    ['file:///srv/depot/apps/api/src/journal.ts', 'file:///srv/depot/'],
    ['file:///srv/depot/apps/api/src/journal.js', 'file:///srv/depot/'],
    ['file:///srv/depot/apps/api/src/journal.mjs', null],
    ['file:///srv/depot/apps/api/src/autre.ts', null],
    ['file:///srv/depot/apps/api/dist/journal.js', null],
    ['file:///apps/api/src/journal.ts', null],
    ['https://exemple.fr/apps/api/src/journal.ts', null],
    ['pas une url', null],
  ] as const) {
    it(`${urlModule} → ${String(attendu)}`, () => {
      expect(racineDepuisModule(urlModule)).toBe(attendu);
    });
  }

  it('le vrai module journal.ts donne la vraie racine du dépôt', () => {
    expect(racineDepuisModule(new URL('./journal.ts', import.meta.url).href)).toBe(URL_RACINE);
  });
});
