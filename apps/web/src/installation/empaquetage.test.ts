/**
 * Tests d'acceptation T40 — proposer l'installation sans ralentir le démarrage
 * (docs/backlog/T40-installer-appli.md, « Vitesse » ; le poids lui-même est vérifié par
 * `pnpm budget`, apps/web/budget.json).
 *
 * Même méthode que ../ecrans/ferme/empaquetage.test.ts : empaquetage en mémoire de
 * `src/main.tsx` TEL QUEL avec l'API de Vite (rolldown, sans écrire sur le disque).
 *
 *   1. La capture de `beforeinstallprompt` (installation/capture.ts) est dans le JavaScript de
 *      démarrage : l'événement peut partir avant le chargement des écrans.
 *   2. Rien d'autre de src/installation/ au démarrage : ni la carte, ni le bandeau, ni l'aide.
 *   3. L'aide iPhone (installation/AideIos.tsx) est chargée à la demande : ni le morceau de
 *      l'écran Ferme ni celui d'Aujourd'hui ne la portent par leurs imports statiques.
 */
import { fileURLToPath } from 'node:url';
import { build, type Rollup } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';

const RACINE = fileURLToPath(new URL('../../', import.meta.url));
const MAIN = fileURLToPath(new URL('../main.tsx', import.meta.url));
const FERME = fileURLToPath(new URL('../ecrans/ferme/EcranFerme.tsx', import.meta.url));
const AUJOURDHUI = fileURLToPath(new URL('../ecrans/aujourdhui/index.ts', import.meta.url));
const CAPTURE = fileURLToPath(new URL('./capture.ts', import.meta.url));
const AIDE = fileURLToPath(new URL('./AideIos.tsx', import.meta.url));
const DOSSIER = fileURLToPath(new URL('./', import.meta.url));

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

function atteints(depart: readonly string[]): Rollup.OutputChunk[] {
  const vus = new Set<string>();
  const pile = [...depart];
  while (pile.length > 0) {
    const nom = pile.pop();
    if (nom === undefined || vus.has(nom)) continue;
    const m = morceaux.get(nom);
    if (m === undefined) continue;
    vus.add(nom);
    pile.push(...m.imports);
  }
  return [...vus].map((n) => morceaux.get(n)).filter((m): m is Rollup.OutputChunk => m !== undefined);
}

const modules = (liste: readonly Rollup.OutputChunk[]): string[] =>
  liste.flatMap((m) =>
    Object.entries(m.modules)
      .filter(([, mod]) => mod.renderedLength > 0)
      .map(([id]) => id),
  );
const entree = () => [...morceaux.values()].filter((m) => m.isEntry).map((m) => m.fileName);
const morceauDe = (facade: string) => [...morceaux.values()].find((m) => m.facadeModuleId === facade);

describe('T40 : installation sans rien coûter au démarrage', () => {
  it('démarrage : la capture de beforeinstallprompt, et rien d’autre de src/installation/', () => {
    const demarrage = modules(atteints(entree()));
    expect(demarrage, 'capture.ts au démarrage').toContain(CAPTURE);
    expect(demarrage.filter((id) => id.startsWith(DOSSIER) && id !== CAPTURE)).toEqual([]);
  });

  it('l’aide iPhone est un morceau à part, chargé à la demande', () => {
    const aide = morceauDe(AIDE);
    expect(aide, 'morceau de installation/AideIos.tsx').toBeDefined();
    expect(aide?.isDynamicEntry).toBe(true);
    for (const facade of [FERME, AUJOURDHUI]) {
      const m = morceauDe(facade);
      expect(m, facade).toBeDefined();
      expect(modules(atteints([m?.fileName ?? ''])), `${facade} : pas d’aide iPhone par import statique`).not.toContain(AIDE);
    }
  });
});
