/**
 * Tests d'acceptation T28h — la CSP laisse passer la recherche d'adresse (fetch) vers le service
 * de géocodage de la Géoplateforme, et rien d'autre. `connect-src` gagne l'ORIGINE
 * https://data.geopf.fr (origine seule, sans chemin) ; `img-src` (T28b) et `script-src` ne
 * changent pas ; aucune autre directive ne cite la Géoplateforme. Contrat : scripts/csp.ts
 * (politiqueCsp), comme scripts/csp.test.ts.
 * Les tests de T09b/T28b qui figent `connect-src` à 'self' + API + PowerSync (csp.test.ts) doivent
 * être mis à jour par le développeur, avec justification dans la PR.
 */
import { describe, expect, it } from 'vitest';

interface ModuleCsp {
  politiqueCsp: (o: { readonly urlApi?: string; readonly urlPowerSync?: string }) => string;
}
const CHEMIN = './csp.ts';

function directives(csp: string): Map<string, string[]> {
  const resultat = new Map<string, string[]>();
  for (const brute of csp.split(';')) {
    const [nom, ...valeurs] = brute.trim().split(/\s+/);
    if (nom !== undefined && nom !== '') resultat.set(nom.toLowerCase(), valeurs);
  }
  return resultat;
}

async function politique(o: { readonly urlApi?: string; readonly urlPowerSync?: string } = {}): Promise<Map<string, string[]>> {
  const m = (await import(CHEMIN)) as Partial<ModuleCsp>;
  if (typeof m.politiqueCsp !== 'function') throw new Error('politiqueCsp absente de scripts/csp.ts');
  return directives(m.politiqueCsp(o));
}

describe('politiqueCsp : recherche d’adresse (T28h)', () => {
  it('connect-src contient \'self\' et https://data.geopf.fr (origine seule), avec ou sans services', async () => {
    for (const o of [{}, { urlApi: 'https://api.planif.fr', urlPowerSync: 'https://sync.planif.fr:8443' }]) {
      const cs = (await politique(o)).get('connect-src') ?? [];
      expect(cs).toContain("'self'");
      expect(cs).toContain('https://data.geopf.fr');
      expect(cs.some((v) => v.startsWith('https://data.geopf.fr/')), 'origine seule, sans chemin').toBe(false);
    }
  });

  it('les services de la ferme restent autorisés, et rien d’autre n’entre dans connect-src', async () => {
    const cs = (await politique({ urlApi: 'https://api.planif.fr', urlPowerSync: 'https://sync.planif.fr:8443' })).get('connect-src') ?? [];
    expect([...cs].sort()).toEqual(["'self'", 'https://api.planif.fr', 'https://data.geopf.fr', 'https://sync.planif.fr:8443'].sort());
    for (const v of cs) expect(v, 'ni joker, ni schéma nu').not.toMatch(/^(\*|https?:|data:|blob:|wss?:)$/);
  });

  it('img-src (T28b) et script-src ne changent pas ; aucune autre directive ne cite la Géoplateforme', async () => {
    const d = await politique();
    expect(d.get('img-src')).toEqual(["'self'", 'https://data.geopf.fr']);
    for (const v of d.get('script-src') ?? []) expect(["'self'", "'wasm-unsafe-eval'"]).toContain(v);
    for (const [nom, valeurs] of d) if (nom !== 'img-src' && nom !== 'connect-src') expect(valeurs.join(' '), nom).not.toContain('geopf');
  });
});
