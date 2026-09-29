/**
 * Relecture T16, point 7 — icône de l'appli (public/icone.svg, déclarée dans index.html) aux
 * couleurs des jetons.
 *
 * Contrat : chaque couleur écrite dans le fichier (#RGB ou #RRGGBB, en attribut ou en style) est
 * une couleur des jetons (COULEURS de ./jetons.ts) ; la forêt #1F4D3A et le fond #EEF1E8 y sont ;
 * aucune couleur nommée (fill, stroke, stop-color : une couleur hexadécimale, none ou
 * currentColor seulement).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COULEURS } from './jetons.ts';

const ICONE = readFileSync(join(import.meta.dirname, '..', '..', 'public', 'icone.svg'), 'utf8');

/** '#abc' → '#AABBCC'. */
function normaliser(hex: string): string {
  return hex.toUpperCase().replace(/^#(.)(.)(.)$/, '#$1$1$2$2$3$3');
}

describe('icône de l’appli', () => {
  const couleurs = [...ICONE.matchAll(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi)].map((m) => normaliser(m[0]));
  const jetons = new Set<string>(Object.values(COULEURS).map((c) => c.toUpperCase()));

  it('forêt et fond des jetons', () => {
    expect(couleurs).toContain(COULEURS.foret.toUpperCase());
    expect(couleurs).toContain(COULEURS.fond.toUpperCase());
  });

  it('aucune couleur hors des jetons', () => {
    expect(couleurs.filter((c) => !jetons.has(c))).toEqual([]);
  });

  it('aucune couleur nommée', () => {
    const valeurs = [...ICONE.matchAll(/(?:fill|stroke|stop-color)\s*[=:]\s*["']?([^"';\s>]+)/gi)].map((m) => m[1] ?? '');
    expect(valeurs.length).toBeGreaterThan(0);
    expect(valeurs.filter((v) => !/^(#[0-9a-f]{3}|#[0-9a-f]{6}|none|currentColor)$/i.test(v))).toEqual([]);
  });
});
