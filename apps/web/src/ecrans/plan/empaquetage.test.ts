/**
 * Tests d'acceptation T11 — ce que l'ouverture de la base locale et l'écran Planches coûtent au
 * démarrage (critère « PowerSync et le WASM restent hors de l'entrée principale »).
 *
 * Même méthode que ../export/empaquetage.test.ts : empaquetage en mémoire de `src/main.tsx` tel
 * quel avec l'API de Vite (rolldown, sans écrire sur le disque). Depuis T11, l'appli elle-même
 * ouvre la base locale et charge l'écran Planches : aucune entrée simulée n'est nécessaire.
 *
 *   1. JavaScript de démarrage (morceau d'entrée + imports statiques, récursivement) : aucun
 *      module de `@powersync/*` ni `@journeyapps/*` rendu, aucun module de src/ecrans/plan/,
 *      ni src/donnees/ouvrir.ts, ni src/donnees/ferme-active.ts ; aucun fichier .wasm importé.
 *   2. L'appli charge à la demande (imports dynamiques depuis l'entrée) l'écran Planches
 *      (src/ecrans/plan/) et l'ouverture de la base (@powersync/web) : T11 branche vraiment la
 *      base dans l'appli.
 *   3. Le morceau de l'écran Planches et ses imports statiques n'entraînent pas PowerSync :
 *      l'écran reçoit la porte.
 */
import { fileURLToPath } from 'node:url';
import { build, type Rollup } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';

const RACINE = fileURLToPath(new URL('../../../', import.meta.url));
const MAIN = fileURLToPath(new URL('../../main.tsx', import.meta.url));
const MOTIF_POWERSYNC = /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:@powersync|@journeyapps)[\\/]/;
const MOTIF_PLAN = /[\\/]src[\\/]ecrans[\\/]plan[\\/]/;
const MOTIF_OUVERTURE = /[\\/]src[\\/]donnees[\\/](?:ouvrir|ferme-active)\.ts$/;

let morceaux: Map<string, Rollup.OutputChunk>;

beforeAll(async () => {
  const sortie = await build({
    configFile: false,
    root: RACINE,
    logLevel: 'silent',
    build: { write: false, rollupOptions: { input: { demarrage: MAIN } } },
  });
  const sorties = Array.isArray(sortie) ? sortie : [sortie as Rollup.RolldownOutput];
  morceaux = new Map();
  for (const s of sorties) for (const f of s.output) if (f.type === 'chunk') morceaux.set(f.fileName, f);
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

describe('T11 : empaquetage de la base locale et de l’écran Planches', () => {
  it('démarrage : ni PowerSync, ni WASM, ni l’écran Planches, ni l’ouverture de la base', () => {
    const demarrage = atteints(entree(), false);
    expect(demarrage.length).toBeGreaterThan(0);
    expect(modulesRendus(demarrage, MOTIF_POWERSYNC)).toEqual([]);
    expect(modulesRendus(demarrage, MOTIF_PLAN)).toEqual([]);
    expect(modulesRendus(demarrage, MOTIF_OUVERTURE)).toEqual([]);
    for (const m of demarrage) expect(m.code.includes('.wasm'), `${m.fileName} référence un .wasm`).toBe(false);
  });

  it('à la demande : l’appli charge l’écran Planches et ouvre la base locale (@powersync/web)', () => {
    const tout = atteints(entree(), true);
    expect(modulesRendus(tout, MOTIF_PLAN).length, 'écran Planches atteint par import dynamique').toBeGreaterThan(0);
    expect(modulesRendus(tout, /[\\/]@powersync[\\/]web[\\/]/).length, '@powersync/web atteint par import dynamique').toBeGreaterThan(0);
    expect(modulesRendus(tout, MOTIF_OUVERTURE).length, 'src/donnees/ouvrir.ts ou ferme-active.ts atteint').toBeGreaterThan(0);
  });

  it('l’écran Planches n’entraîne pas PowerSync (il reçoit la porte)', () => {
    const plan = [...morceaux.values()].filter((m) => Object.keys(m.modules).some((id) => MOTIF_PLAN.test(id)));
    expect(plan.length).toBeGreaterThan(0);
    const charges = atteints(
      plan.map((m) => m.fileName),
      false,
    );
    expect(modulesRendus(charges, MOTIF_POWERSYNC)).toEqual([]);
  });
});
