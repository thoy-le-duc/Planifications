/**
 * Tests d'acceptation T58 — garde-fous de budget de la vue 3D (CLAUDE.md, principe 1 ; budget
 * `jsVue3dGzKio`) : les serres sont chargées à la demande, par un relais, comme les vannes (T57).
 * Ni Vue3d.tsx ni scene.ts n'importent le composant ni le module des abris autrement qu'en type ;
 * ni three ni @react-three/fiber dans les fichiers des serres ; la vue référence bien les serres.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const lire = (f: string): string => readFileSync(new URL(f, import.meta.url), 'utf8');

/** Imports statiques qui ne sont pas des imports de type. */
function importsStatiques(source: string): string[] {
  return [...source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+'([^']+)'/gms)].map((x) => x[1] ?? '');
}

describe('T58 : les serres de la 3D arrivent à la demande', () => {
  it('Vue3d.tsx et scene.ts n’importent pas Abris3d.tsx ni abris.ts de façon statique', () => {
    for (const f of ['./Vue3d.tsx', './scene.ts']) {
      const statiques = importsStatiques(lire(f));
      expect(statiques.filter((s) => /Abris3d|\/abris\.ts$|^\.\/abris\.ts$/.test(s)), f).toEqual([]);
    }
  });

  it('Vue3d.tsx passe par un relais ./abris-differees.ts, comme les vannes', () => {
    const vue = lire('./Vue3d.tsx');
    expect(vue).toMatch(/abris-differees\.ts/);
    expect(vue).toMatch(/Abris3d|chargerAbris3d/);
    const relais = lire('./abris-differees.ts');
    expect(relais).toMatch(/import\(\s*'\.\/Abris3d\.tsx'\s*\)/);
  });

  it('les fichiers des serres n’importent ni three ni react-three', () => {
    for (const f of ['./Abris3d.tsx', './abris.ts', './abris-differees.ts']) {
      expect(lire(f), f).not.toMatch(/from\s+'(three|@react-three\/[^']+)'/);
    }
  });

  it('la vue reçoit l’état des abris (surEtat) pour poser les ouvertures et colorer le filtre « Serres »', () => {
    const vue = lire('./Vue3d.tsx');
    expect(vue).toMatch(/surEtatAbris|EtatAbris3d/);
  });
});
