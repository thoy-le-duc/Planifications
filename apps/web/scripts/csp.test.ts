/**
 * Tests d'acceptation T09b — politique de sécurité du contenu (CSP) de l'appli.
 *
 * ── Décision : balise <meta http-equiv="Content-Security-Policy"> dans dist/index.html ──────
 *
 * - Elle voyage avec le build, quel que soit l'hébergeur (aucun hébergeur choisi à ce jour),
 *   et le service worker la resert hors ligne avec index.html : un en-tête HTTP, lui, dépend du
 *   serveur et n'est pas garanti sur la réponse mise en cache.
 * - Limites de la balise (frame-ancestors, report-uri et sandbox y sont ignorés) : à poser en
 *   en-tête chez l'hébergeur le jour de la mise en production (frame-ancestors 'none').
 * - Posée au build seulement (le serveur de développement de Vite injecte un script en ligne
 *   pour le rechargement à chaud), et seulement dans index.html : les pages de mesure et de
 *   diagnostic sont hors appli.
 *
 * ── Contrat ─────────────────────────────────────────────────────────────────────────────────
 *
 * apps/web/scripts/csp.ts (utilisé par vite.config.ts, qui insère la balise en tête de <head>,
 * avant tout <script> et tout <link>) exporte :
 *
 *   politiqueCsp(o: { readonly urlApi?: string; readonly urlPowerSync?: string }): string
 *
 *   urlApi, urlPowerSync : VITE_API_URL et VITE_POWERSYNC_URL du build (absentes ou relatives
 *   → même origine). La politique rendue contient au moins :
 *     default-src 'self'
 *     script-src  'self' [+ 'wasm-unsafe-eval']   — rien d'autre : ni 'unsafe-inline', ni
 *                 'unsafe-eval', ni hôte, ni schéma, ni nonce, ni empreinte. 'wasm-unsafe-eval'
 *                 est permis : il n'autorise que la compilation WebAssembly (SQLite de
 *                 PowerSync), pas eval() ni le JavaScript en ligne.
 *     connect-src 'self' + l'ORIGINE (schéma://hôte[:port], sans chemin) de urlApi et de
 *                 urlPowerSync quand elles sont absolues
 *     object-src  'none'
 *     base-uri    'self' ou 'none'
 *     form-action 'self' ou 'none'
 *   Une URL qui n'est pas http(s) absolue ou relative, ou dont l'origine contient autre chose
 *   que schéma, hôte, port (espace, « ; », « ' », « , »…) : Error (injection dans la politique).
 *
 * Le module est chargé par un chemin dynamique pour que ce test type avant que csp.ts n'existe.
 * Le build lui-même (balise présente et efficace, aucune violation) : e2e/csp.e2e.ts.
 */
import { describe, expect, it } from 'vitest';

interface ModuleCsp {
  politiqueCsp(o: { readonly urlApi?: string; readonly urlPowerSync?: string }): string;
}

const CHEMIN = './csp.ts';

async function moduleCsp(): Promise<ModuleCsp> {
  const module = (await import(CHEMIN)) as Partial<ModuleCsp>;
  if (typeof module.politiqueCsp !== 'function') throw new Error('politiqueCsp absente de scripts/csp.ts');
  return module as ModuleCsp;
}

async function politique(o: { readonly urlApi?: string; readonly urlPowerSync?: string } = {}): Promise<string> {
  return (await moduleCsp()).politiqueCsp(o);
}

/** Directives de la politique : nom → valeurs. */
function directives(csp: string): Map<string, string[]> {
  const resultat = new Map<string, string[]>();
  for (const brute of csp.split(';')) {
    const [nom, ...valeurs] = brute.trim().split(/\s+/);
    if (nom !== undefined && nom !== '') resultat.set(nom.toLowerCase(), valeurs);
  }
  return resultat;
}

const SCRIPT_SRC_PERMIS = new Set(["'self'", "'wasm-unsafe-eval'"]);

describe('politiqueCsp (T09b)', () => {
  it('sans URL : script-src ne permet que les fichiers de l’appli, rien en ligne', async () => {
    const d = directives(await politique());
    expect(d.get('default-src')).toEqual(["'self'"]);
    const scriptSrc = d.get('script-src') ?? [];
    expect(scriptSrc).toContain("'self'");
    for (const v of scriptSrc) expect(SCRIPT_SRC_PERMIS.has(v), `script-src ${v}`).toBe(true);
    expect(d.get('object-src')).toEqual(["'none'"]);
    expect(["'self'", "'none'"]).toContain(d.get('base-uri')?.join(' '));
    expect(["'self'", "'none'"]).toContain(d.get('form-action')?.join(' '));
    expect(d.get('connect-src')).toContain("'self'");
  });

  it('aucune directive ne permet unsafe-inline pour les scripts, ni unsafe-eval nulle part', async () => {
    const csp = await politique({ urlApi: 'https://api.planif.fr', urlPowerSync: 'https://sync.planif.fr' });
    expect(csp).not.toMatch(/'unsafe-eval'/);
    const d = directives(csp);
    for (const nom of ['default-src', 'script-src', 'script-src-elem', 'script-src-attr', 'worker-src']) {
      expect(d.get(nom) ?? [], nom).not.toContain("'unsafe-inline'");
      expect(d.get(nom) ?? [], nom).not.toContain('*');
      expect(d.get(nom) ?? [], nom).not.toContain('data:');
    }
  });

  it('API et service PowerSync sur d’autres origines : connect-src les autorise (origine seule), script-src ne change pas', async () => {
    const d = directives(await politique({ urlApi: 'https://api.planif.fr/v1/', urlPowerSync: 'https://sync.planif.fr:8443' }));
    expect(d.get('connect-src')).toEqual(expect.arrayContaining(["'self'", 'https://api.planif.fr', 'https://sync.planif.fr:8443']));
    expect(d.get('connect-src')?.some((v) => v.includes('/v1'))).toBe(false);
    for (const v of d.get('script-src') ?? []) expect(SCRIPT_SRC_PERMIS.has(v), `script-src ${v}`).toBe(true);
  });

  it('développement local en http : autorisé tel quel', async () => {
    const d = directives(await politique({ urlApi: 'http://localhost:3000', urlPowerSync: 'http://localhost:8080' }));
    expect(d.get('connect-src')).toEqual(expect.arrayContaining(['http://localhost:3000', 'http://localhost:8080']));
  });

  it('URL relative (/api) : même origine, rien d’ajouté', async () => {
    const d = directives(await politique({ urlApi: '/api' }));
    expect(d.get('connect-src')).toEqual(["'self'"]);
  });

  it.each([
    "https://api.planif.fr; script-src 'unsafe-inline'",
    "https://api.planif.fr 'unsafe-inline'",
    'javascript:alert(1)',
    'data:text/plain,x',
    'ftp://api.planif.fr',
  ])('refuse une URL qui injecterait dans la politique : « %s »', async (url) => {
    // Module chargé d'abord : son absence ne doit pas passer pour un refus.
    const { politiqueCsp } = await moduleCsp();
    expect(() => politiqueCsp({ urlApi: url })).toThrow();
    expect(() => politiqueCsp({ urlPowerSync: url })).toThrow();
  });
});
