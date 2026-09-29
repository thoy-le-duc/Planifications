/**
 * Tests d'acceptation T15 — ce que l'écran d'export coûte au démarrage (relecture de T15).
 * Contrat : en-tête de ./export.test.tsx.
 *
 * Empaquetage en mémoire avec l'API de Vite (rolldown, sans écrire sur le disque, < 1 s), d'une
 * entrée qui simule l'appli de demain : `src/main.tsx` tel quel, plus l'import dynamique de
 * l'écran que App.tsx fera (`lazy(() => import('./ecrans/export/index.ts'))`). Pas de lecture de
 * `dist` : `pnpm verif` lance les tests avant le build, et l'appli n'importe pas encore l'écran,
 * donc `dist` ne dirait rien. La configuration de production (PWA, noms des morceaux) n'est pas
 * reprise : elle range les morceaux, elle ne change pas quel module va dans quel morceau.
 *
 *   1. JavaScript de démarrage = morceau d'entrée + ses imports statiques (récursivement) : il ne
 *      contient pas « Articles de stock » (texte de TABLES_EXPORTEES). La liste blanche et ses
 *      descriptions ne doivent jamais remonter au démarrage par le point d'entrée de @planif/core.
 *   2. Tout ce que l'import de l'écran charge (son morceau, ses imports statiques et dynamiques)
 *      ne contient aucun module de `@powersync/*` (ni `@journeyapps/*`) rendu, même
 *      indirectement : l'écran reçoit la porte, il n'a pas à tirer le schéma PowerSync
 *      (`@powersync/common`) que @planif/sync importe dans schema.ts.
 */
import { fileURLToPath } from 'node:url';
import { build, type Plugin, type Rollup } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';

const RACINE = fileURLToPath(new URL('../../../', import.meta.url));
const MAIN = fileURLToPath(new URL('../../main.tsx', import.meta.url));
const ECRAN = fileURLToPath(new URL('./index.ts', import.meta.url));
const ENTREE = 'planif:demarrage-simule';
const MOTIF_POWERSYNC = /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:@powersync|@journeyapps)[\\/]/;

/** Entrée simulée : l'appli telle qu'elle démarre, plus l'import dynamique de l'écran. */
function demarrageSimule(): Plugin {
  const id = `\0${ENTREE}`;
  return {
    name: 'planif:demarrage-simule',
    resolveId: (source) => (source === ENTREE ? id : null),
    load: (charge) =>
      charge === id
        ? `import ${JSON.stringify(MAIN)};\nglobalThis.chargerEcranExport = () => import(${JSON.stringify(ECRAN)});\n`
        : null,
  };
}

let morceaux: Map<string, Rollup.OutputChunk>;

beforeAll(async () => {
  const sortie = await build({
    configFile: false,
    root: RACINE,
    logLevel: 'silent',
    plugins: [demarrageSimule()],
    build: { write: false, rollupOptions: { input: { demarrage: ENTREE } } },
  });
  const sorties = Array.isArray(sortie) ? sortie : [sortie as Rollup.RolldownOutput];
  morceaux = new Map();
  for (const s of sorties) for (const f of s.output) if (f.type === 'chunk') morceaux.set(f.fileName, f);
}, 60_000);

/** Morceaux atteints depuis `depart` en suivant les imports statiques (et dynamiques si demandé). */
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

describe('T15 : empaquetage de l’écran d’export', () => {
  it('l’écran est un morceau à part, chargé par import dynamique', () => {
    const entree = [...morceaux.values()].filter((m) => m.isEntry);
    expect(entree).toHaveLength(1);
    const ecran = [...morceaux.values()].find((m) => m.facadeModuleId === ECRAN);
    expect(ecran, 'morceau de ecrans/export/index.ts').toBeDefined();
    expect(ecran?.isDynamicEntry).toBe(true);
  });

  it('le JavaScript de démarrage ne contient pas la liste blanche de l’export (« Articles de stock »)', () => {
    const entree = [...morceaux.values()].filter((m) => m.isEntry).map((m) => m.fileName);
    const demarrage = atteints(entree, false);
    expect(demarrage.length).toBeGreaterThan(0);
    // Témoin : le texte est bien quelque part dans l'empaquetage (sinon le test ne prouverait rien).
    expect([...morceaux.values()].some((m) => m.code.includes('Articles de stock')), 'texte présent dans l’empaquetage').toBe(true);
    for (const m of demarrage) expect(m.code.includes('Articles de stock'), m.fileName).toBe(false);
  });

  it('l’écran d’export n’entraîne pas PowerSync (@powersync/common), même indirectement', () => {
    const ecran = [...morceaux.values()].find((m) => m.facadeModuleId === ECRAN);
    expect(ecran).toBeDefined();
    const charges = atteints([ecran?.fileName ?? ''], true);
    const powersync = charges.flatMap((m) =>
      Object.entries(m.modules)
        .filter(([id, mod]) => MOTIF_POWERSYNC.test(id) && mod.renderedLength > 0)
        .map(([id]) => `${m.fileName} : ${id.replace(/^.*node_modules[\\/]/, '')}`),
    );
    expect(powersync).toEqual([]);
  });
});
