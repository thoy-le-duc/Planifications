/**
 * Tests d'acceptation T52 — démarrage de l'appli inchangé : les nouveaux écrans se chargent à la
 * demande (docs/backlog/T52-registre-phyto.md ; le poids lui-même est vérifié par `pnpm budget`,
 * apps/web/budget.json). Même méthode que ../../parcellaire/empaquetage.test.ts : empaquetage en
 * mémoire de `src/main.tsx` TEL QUEL avec l'API de Vite (sans écrire sur le disque).
 *
 *   1. Rien des écrans phyto de la ferme (src/ecrans/ferme/phyto/) ni de la saisie du traitement
 *      (src/ecrans/aujourdhui/traitement/) dans le JavaScript de démarrage.
 *   2. Les écrans phyto sont un morceau à part, atteint depuis l'écran Ferme par import dynamique.
 *   3. La saisie du traitement est un morceau à part, atteint depuis Aujourd'hui par import
 *      dynamique : ouvrir Aujourd'hui ne la charge pas.
 */
import { fileURLToPath } from 'node:url';
import { build, type Rollup } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';

const RACINE = fileURLToPath(new URL('../../../../', import.meta.url));
const MAIN = fileURLToPath(new URL('../../../main.tsx', import.meta.url));
const FERME = fileURLToPath(new URL('../EcranFerme.tsx', import.meta.url));
const AUJOURDHUI = fileURLToPath(new URL('../../aujourdhui/index.ts', import.meta.url));
const MOTIF_PHYTO = /[\\/]src[\\/]ecrans[\\/]ferme[\\/]phyto[\\/]/;
const MOTIF_TRAITEMENT = /[\\/]src[\\/]ecrans[\\/]aujourdhui[\\/]traitement[\\/]/;

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

describe('T52 : écrans phyto et saisie du traitement chargés à la demande', () => {
  it('démarrage : rien des écrans phyto ni de la saisie du traitement', () => {
    const tout = atteints(entree(), true);
    expect(modules(tout, MOTIF_PHYTO).length, 'les écrans phyto sont empaquetés avec l’appli').toBeGreaterThan(0);
    expect(modules(tout, MOTIF_TRAITEMENT).length, 'la saisie du traitement est empaquetée avec l’appli').toBeGreaterThan(0);
    const demarrage = atteints(entree(), false);
    expect(modules(demarrage, MOTIF_PHYTO)).toEqual([]);
    expect(modules(demarrage, MOTIF_TRAITEMENT)).toEqual([]);
  });

  it('écran Ferme : les écrans phyto hors de ses imports statiques, atteints par import dynamique', () => {
    const ferme = morceauDe(FERME);
    expect(ferme).toBeDefined();
    const statiques = atteints([ferme?.fileName ?? ''], false);
    expect(modules(statiques, MOTIF_PHYTO)).toEqual([]);
    const dynamiques = atteints(statiques.flatMap((m) => m.dynamicImports), false);
    expect(modules(dynamiques, MOTIF_PHYTO).length, 'l’écran Ferme importe dynamiquement les écrans phyto').toBeGreaterThan(0);
  });

  it('Aujourd’hui : la saisie du traitement hors de ses imports statiques, atteinte par import dynamique', () => {
    const auj = morceauDe(AUJOURDHUI);
    expect(auj).toBeDefined();
    const statiques = atteints([auj?.fileName ?? ''], false);
    expect(modules(statiques, MOTIF_TRAITEMENT)).toEqual([]);
    const dynamiques = atteints(statiques.flatMap((m) => m.dynamicImports), false);
    expect(modules(dynamiques, MOTIF_TRAITEMENT).length, 'Aujourd’hui importe dynamiquement la saisie du traitement').toBeGreaterThan(0);
  });
});
