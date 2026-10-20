/**
 * Tests d'acceptation T54 — démarrage de l'appli inchangé : les nouveaux écrans se chargent à la
 * demande (docs/backlog/T54-cahier-fertilisation.md ; marge de démarrage d'environ 12 octets, le
 * poids lui-même est vérifié par `pnpm budget`). Même méthode que ../phyto/empaquetage.test.ts :
 * empaquetage en mémoire de `src/main.tsx` TEL QUEL avec l'API de Vite.
 *
 *   1. Rien des écrans de fertilisation (src/ecrans/ferme/fertilisation/) ni de la saisie d'un
 *      apport (src/ecrans/aujourdhui/fertilisation/) dans le JavaScript de démarrage.
 *   2. Les écrans de fertilisation : morceau à part, atteint depuis l'écran Ferme par import dynamique.
 *   3. La saisie d'un apport : morceau à part, atteint depuis Aujourd'hui par import dynamique.
 */
import { fileURLToPath } from 'node:url';
import { build, type Rollup } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';

const RACINE = fileURLToPath(new URL('../../../../', import.meta.url));
const MAIN = fileURLToPath(new URL('../../../main.tsx', import.meta.url));
const FERME = fileURLToPath(new URL('../EcranFerme.tsx', import.meta.url));
const AUJOURDHUI = fileURLToPath(new URL('../../aujourdhui/index.ts', import.meta.url));
const MOTIF_ECRANS = /[\\/]src[\\/]ecrans[\\/]ferme[\\/]fertilisation[\\/]/;
const MOTIF_SAISIE = /[\\/]src[\\/]ecrans[\\/]aujourdhui[\\/]fertilisation[\\/]/;

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

const modules = (liste: readonly Rollup.OutputChunk[], motif: RegExp): string[] =>
  liste.flatMap((m) =>
    Object.entries(m.modules)
      .filter(([id, mod]) => motif.test(id) && mod.renderedLength > 0)
      .map(([id]) => `${m.fileName} : ${id.replace(RACINE, '')}`),
  );

const entree = () => [...morceaux.values()].filter((m) => m.isEntry).map((m) => m.fileName);
const morceauDe = (facade: string) => [...morceaux.values()].find((m) => m.facadeModuleId === facade);

describe('T54 : écrans de fertilisation et saisie d’un apport chargés à la demande', () => {
  it('démarrage : rien des écrans de fertilisation ni de la saisie d’un apport', () => {
    const tout = atteints(entree(), true);
    expect(modules(tout, MOTIF_ECRANS).length, 'les écrans de fertilisation sont empaquetés avec l’appli').toBeGreaterThan(0);
    expect(modules(tout, MOTIF_SAISIE).length, 'la saisie d’un apport est empaquetée avec l’appli').toBeGreaterThan(0);
    const demarrage = atteints(entree(), false);
    expect(modules(demarrage, MOTIF_ECRANS)).toEqual([]);
    expect(modules(demarrage, MOTIF_SAISIE)).toEqual([]);
  });

  it('écran Ferme : les écrans de fertilisation hors de ses imports statiques, atteints par import dynamique', () => {
    const ferme = morceauDe(FERME);
    expect(ferme).toBeDefined();
    const statiques = atteints([ferme?.fileName ?? ''], false);
    expect(modules(statiques, MOTIF_ECRANS)).toEqual([]);
    const dynamiques = atteints(statiques.flatMap((m) => m.dynamicImports), false);
    expect(modules(dynamiques, MOTIF_ECRANS).length, 'l’écran Ferme importe dynamiquement les écrans de fertilisation').toBeGreaterThan(0);
  });

  it('Aujourd’hui : la saisie d’un apport hors de ses imports statiques, atteinte par import dynamique', () => {
    const auj = morceauDe(AUJOURDHUI);
    expect(auj).toBeDefined();
    const statiques = atteints([auj?.fileName ?? ''], false);
    expect(modules(statiques, MOTIF_SAISIE)).toEqual([]);
    const dynamiques = atteints(statiques.flatMap((m) => m.dynamicImports), false);
    expect(modules(dynamiques, MOTIF_SAISIE).length, 'Aujourd’hui importe dynamiquement la saisie d’un apport').toBeGreaterThan(0);
  });
});
