/**
 * Tests d'acceptation T13 — l'écran « Aujourd'hui » est branché dans l'appli sans alourdir le
 * démarrage (budget de poids, principe 1). Même méthode que ../plan/empaquetage.test.ts :
 * empaquetage en mémoire de `src/main.tsx` avec l'API de Vite (rolldown, rien sur le disque).
 *
 *   1. JavaScript de démarrage (entrée + imports statiques) : aucun module de
 *      src/ecrans/aujourdhui/, ni de PowerSync.
 *   2. L'appli atteint l'écran par import dynamique (onglet « Aujourd'hui », à la place de
 *      « Bientôt »).
 *   3. Le morceau de l'écran et ses imports statiques n'entraînent pas PowerSync : l'écran
 *      reçoit la porte.
 */
import { fileURLToPath } from 'node:url';
import { build, type Rollup } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';

const RACINE = fileURLToPath(new URL('../../../', import.meta.url));
const MAIN = fileURLToPath(new URL('../../main.tsx', import.meta.url));
const MOTIF_POWERSYNC = /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:@powersync|@journeyapps)[\\/]/;
const MOTIF_AUJOURDHUI = /[\\/]src[\\/]ecrans[\\/]aujourdhui[\\/]/;
/** Les fichiers de test (fixture, contrat) n'ont rien à faire dans l'appli. */
const MOTIF_TEST = /[\\/]src[\\/]ecrans[\\/]aujourdhui[\\/]test[\\/]/;

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

describe('T13 : empaquetage de l’écran Aujourd’hui', () => {
  it('démarrage : ni l’écran Aujourd’hui, ni PowerSync', () => {
    const demarrage = atteints(entree(), false);
    expect(demarrage.length).toBeGreaterThan(0);
    expect(modulesRendus(demarrage, MOTIF_AUJOURDHUI)).toEqual([]);
    expect(modulesRendus(demarrage, MOTIF_POWERSYNC)).toEqual([]);
  });

  it('à la demande : l’appli charge l’écran Aujourd’hui (sans ses fichiers de test)', () => {
    const tout = atteints(entree(), true);
    expect(modulesRendus(tout, MOTIF_AUJOURDHUI).length, 'écran Aujourd’hui atteint par import dynamique').toBeGreaterThan(0);
    expect(modulesRendus(tout, MOTIF_TEST)).toEqual([]);
  });

  it('l’écran Aujourd’hui n’entraîne pas PowerSync (il reçoit la porte)', () => {
    const ecran = [...morceaux.values()].filter((m) => Object.keys(m.modules).some((id) => MOTIF_AUJOURDHUI.test(id)));
    expect(ecran.length).toBeGreaterThan(0);
    const charges = atteints(
      ecran.map((m) => m.fileName),
      false,
    );
    expect(modulesRendus(charges, MOTIF_POWERSYNC)).toEqual([]);
  });
});
