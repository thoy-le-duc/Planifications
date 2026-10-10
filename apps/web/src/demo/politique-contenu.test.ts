/**
 * Tests d'acceptation T28i — la politique de contenu de la démo autorise la photo IGN (<img>) et
 * la recherche d'adresse (fetch), comme l'appli, et rien de plus large. La démo est construite avec
 * `politiqueCsp({})` (vite.config.ts : aucun service) ; la balise du build est vérifiée en vrai
 * navigateur par e2e/demo-placement.e2e.ts. Contrat : ./test/contrat-placement.ts.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { politiqueCsp } from '../../scripts/csp.ts';

const GEOPF = 'https://data.geopf.fr';

function directives(politique: string): Map<string, string[]> {
  return new Map(
    politique
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter((d): d is [string, ...string[]] => d[0] !== undefined && d[0] !== '')
      .map(([nom, ...valeurs]) => [nom, valeurs]),
  );
}

interface Entete {
  readonly key: string;
  readonly value: string;
}
interface Regle {
  readonly source: string;
  readonly headers: readonly Entete[];
}

describe('T28i : politique de contenu de la démo', () => {
  it('build de la démo (aucun service) : img-src et connect-src autorisent data.geopf.fr, rien de plus large', () => {
    const d = directives(politiqueCsp({}));
    expect(d.get('img-src')).toEqual(["'self'", GEOPF]);
    expect(d.get('connect-src')).toEqual(["'self'", GEOPF]);
    expect(d.get('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'"]);
  });

  it('vercel.json : un éventuel en-tête Content-Security-Policy garde les deux origines (sinon il bloquerait la photo)', () => {
    const vercel = JSON.parse(readFileSync(fileURLToPath(new URL('../../vercel.json', import.meta.url)), 'utf8')) as { headers?: readonly Regle[] };
    for (const regle of vercel.headers ?? []) {
      const csp = regle.headers.find((h) => h.key.toLowerCase() === 'content-security-policy');
      if (csp === undefined) continue;
      const d = directives(csp.value);
      // frame-ancestors seul (état actuel) ne restreint ni img-src ni connect-src ; sinon, ils doivent ouvrir geopf.
      for (const nom of ['img-src', 'connect-src', 'default-src']) {
        const v = d.get(nom);
        if (v !== undefined) expect(v.includes(GEOPF) || v.includes('*'), `${regle.source} : ${nom} ouvre ${GEOPF}`).toBe(true);
      }
      if (d.has('default-src') && !d.has('img-src')) expect(d.get('default-src'), 'img-src hérite de default-src').toContain(GEOPF);
    }
  });
});
