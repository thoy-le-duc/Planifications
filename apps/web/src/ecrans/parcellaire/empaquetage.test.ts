/**
 * Tests d'acceptation T49 — « Démarrage de l'appli inchangé (écrans chargés à la demande) »
 * (docs/backlog/T49-demarrer-sa-ferme.md, règle 6 ; le poids lui-même est vérifié par
 * `pnpm budget`, apps/web/budget.json).
 *
 * Même méthode que ../ferme/empaquetage.test.ts : empaquetage en mémoire de `src/main.tsx` TEL
 * QUEL avec l'API de Vite (rolldown, sans écrire sur le disque).
 *
 *   1. Rien de « Ma ferme » (src/ecrans/parcellaire/) ni du parcours guidé (src/ecrans/demarrer/)
 *      dans le JavaScript de démarrage (entrée et ses imports statiques).
 *   2. « Ma ferme » est un morceau à part, atteint depuis l'écran Ferme par import dynamique
 *      seulement : ouvrir l'onglet Ferme ne le charge pas.
 */
import { fileURLToPath } from 'node:url';
import { build, type Rollup } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';

const RACINE = fileURLToPath(new URL('../../../', import.meta.url));
const MAIN = fileURLToPath(new URL('../../main.tsx', import.meta.url));
const FERME = fileURLToPath(new URL('../ferme/EcranFerme.tsx', import.meta.url));
const MOTIF_PARCELLAIRE = /[\\/]src[\\/]ecrans[\\/]parcellaire[\\/]/;
const MOTIF_DEMARRER = /[\\/]src[\\/]ecrans[\\/]demarrer[\\/]/;

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

describe('T49 : « Ma ferme » et le parcours guidé chargés à la demande', () => {
  it('démarrage : rien de « Ma ferme » ni du parcours guidé', () => {
    const tout = atteints(entree(), true);
    expect(modules(tout, MOTIF_PARCELLAIRE).length, '« Ma ferme » est empaqueté avec l’appli').toBeGreaterThan(0);
    expect(modules(tout, MOTIF_DEMARRER).length, 'le parcours guidé est empaqueté avec l’appli').toBeGreaterThan(0);
    const demarrage = atteints(entree(), false);
    expect(modules(demarrage, MOTIF_PARCELLAIRE)).toEqual([]);
    expect(modules(demarrage, MOTIF_DEMARRER)).toEqual([]);
  });

  it('écran Ferme (son morceau + imports statiques) : rien de « Ma ferme », atteint par import dynamique', () => {
    const ferme = morceauDe(FERME);
    expect(ferme).toBeDefined();
    const statiques = atteints([ferme?.fileName ?? ''], false);
    expect(modules(statiques, MOTIF_PARCELLAIRE)).toEqual([]);
    const dynamiques = atteints(
      statiques.flatMap((m) => m.dynamicImports),
      false,
    );
    expect(modules(dynamiques, MOTIF_PARCELLAIRE).length, 'l’écran Ferme importe dynamiquement « Ma ferme »').toBeGreaterThan(0);
  });
});
