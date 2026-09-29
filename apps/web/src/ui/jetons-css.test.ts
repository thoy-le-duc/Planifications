/**
 * T16 — src/jetons.css (règle :root des variables CSS) est bien la sortie de `variablesCss()` :
 * un jeton modifié sans relancer `pnpm --filter @planif/web jetons` fait échouer ce test.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHEMIN_JETONS_CSS, jetonsCss } from '../../scripts/jetons-css-contenu.ts';

describe('src/jetons.css', () => {
  it('à jour avec src/ui/jetons.ts (sinon : pnpm --filter @planif/web jetons)', () => {
    expect(readFileSync(join(import.meta.dirname, '..', '..', CHEMIN_JETONS_CSS), 'utf8')).toBe(jetonsCss());
  });
});
