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
 */
import { describe, expect, it } from 'vitest';
import { decrireErreur } from './journal.ts';

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

  it('témoin : la racine passée est prise en compte (file:///depot/ → positions relatives)', () => {
    const erreur = new Error('x');
    erreur.stack = 'Error: x\n    at f (file:///depot/apps/api/src/a.ts:1:2)\n    at g (/depot/apps/api/src/b.ts:3:4)';
    const ligne = decrireErreur(erreur, 'file:///depot/');
    expect(ligne).toContain('apps/api/src/a.ts:1:2');
    expect(ligne).toContain('apps/api/src/b.ts:3:4');
    expect(ligne).not.toContain('/depot/');
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
