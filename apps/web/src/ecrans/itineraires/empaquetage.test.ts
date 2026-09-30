/**
 * Tests d'acceptation T24 — l'écran des itinéraires se charge à la demande, sans alourdir ni le
 * démarrage ni l'onglet Ferme (principe 1). Même méthode que ../serie/empaquetage.test.ts :
 * empaquetage en mémoire de `src/main.tsx` avec l'API de Vite (rien sur le disque).
 *
 *   1. JavaScript de démarrage (entrée + imports statiques) : aucun module de src/ecrans/itineraires/.
 *   2. Le morceau de l'écran Ferme et ses imports statiques non plus : l'écran Ferme le charge
 *      par import dynamique (« Mes itinéraires »).
 *   3. L'appli atteint l'écran par import dynamique depuis l'écran Ferme, sans ses fichiers de test.
 *   4. L'écran et ses imports statiques n'entraînent pas PowerSync : il reçoit la porte.
 */
import { fileURLToPath } from 'node:url';
import { build, type Rollup } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';

const RACINE = fileURLToPath(new URL('../../../', import.meta.url));
const MAIN = fileURLToPath(new URL('../../main.tsx', import.meta.url));
const FERME = fileURLToPath(new URL('../ferme/EcranFerme.tsx', import.meta.url));
const MOTIF_POWERSYNC = /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:@powersync|@journeyapps)[\\/]/;
const MOTIF_ITINERAIRES = /[\\/]src[\\/]ecrans[\\/]itineraires[\\/]/;
const MOTIF_TEST = /[\\/]src[\\/]ecrans[\\/]itineraires[\\/]test[\\/]/;

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
const contenant = (motif: RegExp) => [...morceaux.values()].filter((m) => Object.keys(m.modules).some((id) => motif.test(id)));
const morceauDe = (facade: string) => [...morceaux.values()].find((m) => m.facadeModuleId === facade);

describe('T24 : empaquetage de l’écran des itinéraires', () => {
  it('démarrage : pas l’écran des itinéraires', () => {
    const demarrage = atteints(entree(), false);
    expect(demarrage.length).toBeGreaterThan(0);
    expect(modulesRendus(demarrage, MOTIF_ITINERAIRES)).toEqual([]);
  });

  it('écran Ferme : l’écran des itinéraires n’est ni dans son morceau ni dans ses imports statiques, mais il l’importe dynamiquement', () => {
    const ferme = morceauDe(FERME);
    expect(ferme, 'morceau de ecrans/ferme/EcranFerme.tsx').toBeDefined();
    const statiques = atteints([ferme?.fileName ?? ''], false);
    expect(modulesRendus(statiques, MOTIF_ITINERAIRES)).toEqual([]);
    const itineraires = contenant(MOTIF_ITINERAIRES).map((m) => m.fileName);
    expect(itineraires.length, 'l’écran des itinéraires est empaqueté avec l’appli').toBeGreaterThan(0);
    expect(
      statiques.some((m) => m.dynamicImports.some((d) => itineraires.includes(d))),
      'l’écran Ferme (ou un de ses imports statiques) importe dynamiquement ecrans/itineraires/index.ts',
    ).toBe(true);
  });

  it('à la demande : l’appli atteint l’écran (sans ses fichiers de test)', () => {
    const tout = atteints(entree(), true);
    expect(modulesRendus(tout, MOTIF_ITINERAIRES).length, 'écran atteint par import dynamique').toBeGreaterThan(0);
    expect(modulesRendus(tout, MOTIF_TEST)).toEqual([]);
  });

  it('l’écran n’entraîne pas PowerSync (il reçoit la porte)', () => {
    const ecran = contenant(MOTIF_ITINERAIRES);
    expect(ecran.length).toBeGreaterThan(0);
    const charges = atteints(
      ecran.map((m) => m.fileName),
      false,
    );
    expect(modulesRendus(charges, MOTIF_POWERSYNC)).toEqual([]);
  });
});
