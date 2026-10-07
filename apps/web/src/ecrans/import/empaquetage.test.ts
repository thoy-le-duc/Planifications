/**
 * Tests d'acceptation T14b — ce que l'import coûte au démarrage (principe 1). Même méthode que
 * ../itineraires/empaquetage.test.ts : empaquetage en mémoire de `src/main.tsx` avec l'API de
 * Vite (rien sur le disque).
 *
 *   1. JavaScript de démarrage (entrée + imports statiques) : ni l'écran d'import, ni le lecteur
 *      Excel (packages/core/src/import/xlsx.ts).
 *   2. Le morceau de l'écran Ferme et ses imports statiques non plus ; l'écran Ferme importe
 *      dynamiquement l'écran d'import (« Importer un tableur »).
 *   3. Le lecteur Excel n'est pas dans les imports statiques de l'écran d'import : il se charge
 *      au dépôt d'un .xlsx seulement (import dynamique, ou Worker à part), et il est bien
 *      empaqueté quelque part.
 *   4. La préparation tourne dans un Web Worker : un fichier `assets/preparation.worker-*.js`
 *      qui contient le moteur d'import (preparerImport), et PAS le lecteur Excel (un CSV ne doit
 *      pas le charger).
 *   5. L'écran n'entraîne pas PowerSync (il reçoit la porte) ; ses fichiers de test ne sont pas
 *      empaquetés.
 */
import { fileURLToPath } from 'node:url';
import { build, type Rollup } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';

const RACINE = fileURLToPath(new URL('../../../', import.meta.url));
const MAIN = fileURLToPath(new URL('../../main.tsx', import.meta.url));
const FERME = fileURLToPath(new URL('../ferme/EcranFerme.tsx', import.meta.url));
const MOTIF_POWERSYNC = /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:@powersync|@journeyapps)[\\/]/;
const MOTIF_IMPORT = /[\\/]src[\\/]ecrans[\\/]import[\\/]/;
const MOTIF_TEST = /[\\/]src[\\/]ecrans[\\/]import[\\/]test[\\/]/;
const MOTIF_XLSX = /[\\/]packages[\\/]core[\\/]src[\\/]import[\\/]xlsx\.ts$/;
/** Texte propre au lecteur Excel (packages/core/src/import/xlsx.ts). */
const TEMOIN_XLSX = 'balise démesurée';
/** Texte propre au moteur d'import (packages/core/src/import/plan.ts). */
const TEMOIN_PLAN = 'Il faut au moins une date';

let morceaux: Map<string, Rollup.OutputChunk>;
let fichiers: Map<string, string>;

beforeAll(async () => {
  const sortie = await build({
    configFile: false,
    root: RACINE,
    logLevel: 'silent',
    build: { write: false, rollupOptions: { input: { demarrage: MAIN } } },
  });
  const sorties = Array.isArray(sortie) ? sortie : [sortie as Rollup.RolldownOutput];
  morceaux = new Map();
  fichiers = new Map();
  for (const s of sorties) {
    for (const f of s.output) {
      if (f.type === 'chunk') {
        morceaux.set(f.fileName, f);
        fichiers.set(f.fileName, f.code);
      } else {
        fichiers.set(f.fileName, typeof f.source === 'string' ? f.source : new TextDecoder().decode(f.source));
      }
    }
  }
}, 60_000);

function atteints(depart: readonly string[], dynamiques: boolean): Rollup.OutputChunk[] {
  const vus = new Set<string>();
  const pile = [...depart];
  while (pile.length > 0) {
    const nom = pile.pop();
    if (nom === undefined || vus.has(nom)) continue;
    const m = morceaux.get(nom);
    if (m === undefined) continue;
    vus.add(nom);
    pile.push(...m.imports, ...(dynamiques ? m.dynamicImports : []));
  }
  return [...vus].map((n) => morceaux.get(n)).filter((m): m is Rollup.OutputChunk => m !== undefined);
}

function modulesRendus(liste: readonly Rollup.OutputChunk[], motif: RegExp): string[] {
  return liste.flatMap((m) =>
    Object.entries(m.modules)
      .filter(([id, mod]) => motif.test(id) && mod.renderedLength > 0)
      .map(([id]) => `${m.fileName} : ${id.replace(/^.*node_modules[\\/]/, '').replace(RACINE, '')}`),
  );
}

const entree = () => [...morceaux.values()].filter((m) => m.isEntry).map((m) => m.fileName);
const contenant = (motif: RegExp) => [...morceaux.values()].filter((m) => Object.entries(m.modules).some(([id, mod]) => motif.test(id) && mod.renderedLength > 0));
const morceauDe = (facade: string) => [...morceaux.values()].find((m) => m.facadeModuleId === facade);

describe('T14b : empaquetage de l’import', () => {
  it('démarrage : ni l’écran d’import, ni le lecteur Excel', () => {
    const demarrage = atteints(entree(), false);
    expect(demarrage.length).toBeGreaterThan(0);
    expect(modulesRendus(demarrage, MOTIF_IMPORT)).toEqual([]);
    expect(modulesRendus(demarrage, MOTIF_XLSX)).toEqual([]);
    for (const m of demarrage) expect(m.code.includes(TEMOIN_XLSX), `${m.fileName} : lecteur Excel au démarrage`).toBe(false);
  });

  it('écran Ferme : l’écran d’import n’est ni dans son morceau ni dans ses imports statiques, mais il l’importe dynamiquement', () => {
    const ferme = morceauDe(FERME);
    expect(ferme, 'morceau de ecrans/ferme/EcranFerme.tsx').toBeDefined();
    const statiques = atteints([ferme?.fileName ?? ''], false);
    expect(modulesRendus(statiques, MOTIF_IMPORT)).toEqual([]);
    const ecran = contenant(MOTIF_IMPORT).map((m) => m.fileName);
    expect(ecran.length, 'l’écran d’import est empaqueté avec l’appli').toBeGreaterThan(0);
    expect(
      statiques.some((m) => m.dynamicImports.some((d) => ecran.includes(d))),
      'l’écran Ferme (ou un de ses imports statiques) importe dynamiquement ecrans/import/index.ts',
    ).toBe(true);
  });

  it('le lecteur Excel n’est pas dans les imports statiques de l’écran d’import, mais il est empaqueté (à la demande)', () => {
    const ecran = contenant(MOTIF_IMPORT);
    expect(ecran.length).toBeGreaterThan(0);
    const statiques = atteints(
      ecran.map((m) => m.fileName),
      false,
    );
    expect(modulesRendus(statiques, MOTIF_XLSX), 'lecteur Excel chargé avec l’écran').toEqual([]);
    for (const m of statiques) expect(m.code.includes(TEMOIN_XLSX), `${m.fileName} : lecteur Excel chargé avec l’écran`).toBe(false);
    const ailleurs = [...fichiers.entries()].filter(([, code]) => code.includes(TEMOIN_XLSX)).map(([nom]) => nom);
    expect(ailleurs.length, 'le lecteur Excel est bien empaqueté (morceau à la demande ou Worker)').toBeGreaterThan(0);
  });

  it('la préparation tourne dans un Web Worker (assets/preparation.worker-*.js) qui ne charge pas le lecteur Excel', () => {
    const workers = [...fichiers.keys()].filter((n) => /(^|\/)preparation\.worker-[^/]*\.js$/.test(n));
    expect(workers, `Worker de préparation (fichiers : ${[...fichiers.keys()].filter((n) => /worker/i.test(n)).join(', ')})`).toHaveLength(1);
    const code = fichiers.get(workers[0] ?? '') ?? '';
    expect(code.includes(TEMOIN_PLAN), 'le Worker contient le moteur d’import (preparerImport)').toBe(true);
    expect(code.includes(TEMOIN_XLSX), 'le Worker ne charge pas le lecteur Excel pour un CSV').toBe(false);
  });

  it('l’écran n’entraîne pas PowerSync (il reçoit la porte) et ses fichiers de test ne sont pas empaquetés', () => {
    const ecran = contenant(MOTIF_IMPORT);
    expect(ecran.length).toBeGreaterThan(0);
    const charges = atteints(
      ecran.map((m) => m.fileName),
      false,
    );
    expect(modulesRendus(charges, MOTIF_POWERSYNC)).toEqual([]);
    expect(modulesRendus(atteints(entree(), true), MOTIF_TEST)).toEqual([]);
  });
});
