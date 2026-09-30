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
 *   2. L'écran d'export n'entraîne pas PowerSync (`@powersync/*`, `@journeyapps/*`) de lui-même :
 *      l'écran reçoit la porte, il n'a pas à tirer le schéma PowerSync (`@powersync/common`) que
 *      @planif/sync importe dans schema.ts. Deux vérifications :
 *        a. son morceau et ses imports statiques (récursivement) ne contiennent aucun module
 *           PowerSync rendu ;
 *        b. ce que l'écran AJOUTE (tout ce qu'il atteint, imports dynamiques compris, moins ce
 *           que l'entrée atteint déjà sans lui, statiquement et dynamiquement) n'en contient
 *           aucun non plus.
 *      Depuis T11, l'appli ouvre elle-même la base locale : l'entrée mène à `@powersync/web`
 *      par import dynamique (exigé par ../plan/empaquetage.test.ts). Ce PowerSync-là est celui
 *      de l'appli, pas celui de l'écran : on le retire du compte (décision du chef, T11).
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

/**
 * Morceaux atteints depuis `depart` en suivant les imports statiques (et dynamiques si demandé),
 * sans jamais entrer dans les morceaux de `exclus`.
 */
function atteints(depart: readonly string[], dynamiques: boolean, exclus: ReadonlySet<string> = new Set()): Rollup.OutputChunk[] {
  const vus = new Set<string>(exclus);
  const pile = [...depart];
  while (pile.length > 0) {
    const nom = pile.pop();
    if (nom === undefined || vus.has(nom)) continue;
    const m = morceaux.get(nom);
    if (m === undefined) continue;
    vus.add(nom);
    pile.push(...m.imports, ...(dynamiques ? m.dynamicImports : []));
  }
  return [...vus]
    .filter((n) => !exclus.has(n))
    .map((n) => morceaux.get(n))
    .filter((m): m is Rollup.OutputChunk => m !== undefined);
}

function modulesPowerSync(liste: readonly Rollup.OutputChunk[]): string[] {
  return liste.flatMap((m) =>
    Object.entries(m.modules)
      .filter(([id, mod]) => MOTIF_POWERSYNC.test(id) && mod.renderedLength > 0)
      .map(([id]) => `${m.fileName} : ${id.replace(/^.*node_modules[\\/]/, '')}`),
  );
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
    const nomEcran = ecran?.fileName ?? '';
    // a. Ce que l'écran charge forcément avec lui : aucun PowerSync.
    expect(modulesPowerSync(atteints([nomEcran], false)), 'imports statiques de l’écran').toEqual([]);
    // b. Ce que l'écran ajoute à l'appli (dynamiques compris) : aucun PowerSync.
    const entree = [...morceaux.values()].filter((m) => m.isEntry).map((m) => m.fileName);
    const dejaAtteints = new Set(atteints(entree, true, new Set([nomEcran])).map((m) => m.fileName));
    // Témoin : l'entrée sans l'écran atteint bien PowerSync (sinon la soustraction ne prouverait rien de plus).
    expect(
      modulesPowerSync([...dejaAtteints].map((n) => morceaux.get(n)).filter((m): m is Rollup.OutputChunk => m !== undefined)).length,
      'l’entrée atteint PowerSync sans l’écran d’export',
    ).toBeGreaterThan(0);
    const ajoutes = atteints([nomEcran], true, dejaAtteints);
    expect(ajoutes.map((m) => m.fileName), 'l’écran ajoute au moins son propre morceau').toContain(nomEcran);
    expect(modulesPowerSync(ajoutes), 'ajouté par l’écran d’export').toEqual([]);
  });
});
