/**
 * Tests d'acceptation T16b — l'export branché dans l'onglet Ferme, sans rien coûter au démarrage
 * (docs/backlog/T16b-brancher-export.md : « Budget de démarrage inchangé » ; le poids lui-même
 * est vérifié par `pnpm budget`, apps/web/budget.json).
 *
 * Même méthode que ../export/empaquetage.test.ts et ../plan/empaquetage.test.ts : empaquetage en
 * mémoire de `src/main.tsx` TEL QUEL avec l'API de Vite (rolldown, sans écrire sur le disque),
 * sans entrée simulée : depuis T16b, c'est l'appli elle-même qui charge l'écran d'export.
 *
 *   1. L'écran Ferme (ecrans/ferme/EcranFerme.tsx) est un morceau chargé à la demande, et il
 *      charge l'écran d'export (ecrans/export/index.ts) par import dynamique : le morceau de
 *      l'export n'est atteint depuis le morceau Ferme que par un import dynamique.
 *   2. Rien de l'export n'entre dans le JavaScript de démarrage (morceau d'entrée et ses imports
 *      statiques, récursivement) : ni l'écran d'export, ni `@planif/sync/export`
 *      (packages/sync/src/export*.ts), ni le cœur de l'export (packages/core/src/export/ : ZIP,
 *      CSV, liste blanche des tables, dont le texte « Articles de stock »).
 *   3. Rien de l'export n'entre non plus dans le morceau de l'écran Ferme et ses imports
 *      statiques : ouvrir l'onglet Ferme ne charge pas l'export tant qu'on ne l'a pas demandé
 *      (ou préchargé à part).
 */
import { fileURLToPath } from 'node:url';
import { build, type Rollup } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';

const RACINE = fileURLToPath(new URL('../../../', import.meta.url));
const MAIN = fileURLToPath(new URL('../../main.tsx', import.meta.url));
const FERME = fileURLToPath(new URL('./EcranFerme.tsx', import.meta.url));
const ECRAN_EXPORT = fileURLToPath(new URL('../export/index.ts', import.meta.url));
/** Modules de l'export : l'écran, `@planif/sync/export`, le cœur de l'export (ZIP, CSV, tables). */
const MOTIF_EXPORT =
  /[\\/]apps[\\/]web[\\/]src[\\/]ecrans[\\/]export[\\/]|[\\/]packages[\\/]sync[\\/]src[\\/]export(?:-seul)?\.ts$|[\\/]packages[\\/]core[\\/]src[\\/]export[\\/]/;
/** Texte de TABLES_EXPORTEES (packages/core/src/export/tables.ts). */
const TEMOIN_EXPORT = 'Articles de stock';

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

/** Morceaux atteints depuis `depart` par les imports statiques (et dynamiques si demandé). */
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

function modulesExport(liste: readonly Rollup.OutputChunk[]): string[] {
  return liste.flatMap((m) =>
    Object.entries(m.modules)
      .filter(([id, mod]) => MOTIF_EXPORT.test(id) && mod.renderedLength > 0)
      .map(([id]) => `${m.fileName} : ${id.replace(RACINE, '')}`),
  );
}

const entree = () => [...morceaux.values()].filter((m) => m.isEntry).map((m) => m.fileName);
const morceauDe = (facade: string) => [...morceaux.values()].find((m) => m.facadeModuleId === facade);

describe('T16b : l’export chargé à la demande depuis l’onglet Ferme', () => {
  it('l’écran Ferme et l’écran d’export sont deux morceaux chargés par import dynamique', () => {
    expect(entree()).toHaveLength(1);
    const ferme = morceauDe(FERME);
    expect(ferme, 'morceau de ecrans/ferme/EcranFerme.tsx').toBeDefined();
    expect(ferme?.isDynamicEntry).toBe(true);
    const ecran = morceauDe(ECRAN_EXPORT);
    expect(ecran, 'morceau de ecrans/export/index.ts : l’appli doit le charger (import dynamique)').toBeDefined();
    expect(ecran?.isDynamicEntry).toBe(true);
    expect(ecran?.isEntry).toBe(false);
  });

  it('l’écran Ferme charge l’écran d’export par import dynamique (jamais statique)', () => {
    const ferme = morceauDe(FERME);
    const ecran = morceauDe(ECRAN_EXPORT);
    expect(ferme).toBeDefined();
    expect(ecran).toBeDefined();
    const nomEcran = ecran?.fileName ?? '';
    const statiques = atteints([ferme?.fileName ?? ''], false);
    expect(
      statiques.map((m) => m.fileName),
      'le morceau de l’export n’est pas un import statique de l’écran Ferme',
    ).not.toContain(nomEcran);
    expect(
      statiques.some((m) => m.dynamicImports.includes(nomEcran)),
      'l’écran Ferme (ou un de ses imports statiques) importe dynamiquement ecrans/export/index.ts',
    ).toBe(true);
  });

  it('démarrage (entrée + imports statiques) : rien de l’export', () => {
    const demarrage = atteints(entree(), false);
    expect(demarrage.length).toBeGreaterThan(0);
    // Témoin : l'export est bien quelque part dans l'empaquetage (sinon le test ne prouverait rien).
    expect(modulesExport([...morceaux.values()]).length, 'l’export est empaqueté avec l’appli').toBeGreaterThan(0);
    expect(modulesExport(demarrage)).toEqual([]);
    for (const m of demarrage) expect(m.code.includes(TEMOIN_EXPORT), m.fileName).toBe(false);
  });

  it('écran Ferme (son morceau + imports statiques) : rien de l’export', () => {
    const ferme = morceauDe(FERME);
    expect(ferme).toBeDefined();
    const statiques = atteints([ferme?.fileName ?? ''], false);
    expect(modulesExport(statiques)).toEqual([]);
    for (const m of statiques) expect(m.code.includes(TEMOIN_EXPORT), m.fileName).toBe(false);
  });
});
