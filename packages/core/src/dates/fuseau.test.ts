/**
 * Tests d'acceptation T01 — indépendance au fuseau horaire.
 *
 * Le fuseau d'un processus Node se fixe au démarrage par la variable TZ. On relance donc le
 * module `./index.ts` dans des processus Node séparés (Node ≥ 22.18 exécute le TypeScript
 * directement) avec des fuseaux extrêmes, et on exige des résultats identiques, octet pour octet.
 *
 * `packages/core` n'a volontairement pas les types de Node (aucune API Node dans le moteur) :
 * les deux modules Node utiles ici sont chargés dynamiquement et typés localement.
 */
import { beforeAll, describe, expect, it } from 'vitest';

type ExecFileSync = (
  fichier: string,
  args: readonly string[],
  options: { env: Record<string, string | undefined>; encoding: 'utf8'; timeout: number },
) => string;

interface OutilsNode {
  readonly execFileSync: ExecFileSync;
  readonly execPath: string;
  readonly env: Record<string, string | undefined>;
}

async function chargerOutilsNode(): Promise<OutilsNode> {
  // Spécificateurs non littéraux : TypeScript ne cherche pas les types de Node.
  const nomChildProcess = 'node:child_process';
  const nomProcess = 'node:process';
  const childProcess: unknown = await import(nomChildProcess);
  const processus: unknown = await import(nomProcess);
  if (
    typeof childProcess !== 'object' ||
    childProcess === null ||
    !('execFileSync' in childProcess) ||
    typeof childProcess.execFileSync !== 'function' ||
    typeof processus !== 'object' ||
    processus === null ||
    !('execPath' in processus) ||
    typeof processus.execPath !== 'string' ||
    !('env' in processus) ||
    typeof processus.env !== 'object' ||
    processus.env === null
  ) {
    throw new Error('modules Node introuvables');
  }
  return {
    execFileSync: childProcess.execFileSync as ExecFileSync,
    execPath: processus.execPath,
    env: processus.env as Record<string, string | undefined>,
  };
}

/** Chemin absolu du module testé, déduit du chemin de ce fichier de test. */
function cheminModuleDates(): string {
  const cheminTest = expect.getState().testPath;
  if (!cheminTest?.endsWith('fuseau.test.ts')) {
    throw new Error('chemin du fichier de test inconnu');
  }
  return cheminTest.replace(/fuseau\.test\.ts$/, 'index.ts');
}

/**
 * Script exécuté dans chaque processus enfant : il calcule les exemples du ticket, plus un
 * balayage jour par jour qui traverse les changements d'heure (mars et octobre/novembre)
 * d'Europe et d'Amérique, et imprime le tout en JSON.
 */
function script(cheminModule: string): string {
  return `
const { pathToFileURL } = await import('node:url');
const m = await import(pathToFileURL(${JSON.stringify(cheminModule)}).href);
const d = (s) => { const r = m.analyserDate(s); if (!r.ok) throw new Error(s); return r.date; };
const f = (s) => m.formaterSemaineIso(m.semaineIso(d(s)));
const exemples = {
  s1: f('2026-12-31'), s2: f('2027-01-01'), s3: f('2027-01-03'),
  s4: f('2027-01-04'), s5: f('2024-12-30'), s6: f('2026-01-01'),
  lundi: m.lundiDeSemaine(2027, 22),
  ecart: m.ecartEnJours(d('2024-02-28'), d('2024-03-01')),
  ajout: m.ajouterJours(d('2027-04-05'), -28),
  erreur: m.analyserDate('2027-02-30').ok,
  zero: m.jourAbsolu(d('1970-01-01')),
};
const balayage = [];
const debut = d('2026-01-01');
for (let i = 0; i < 800; i++) {
  const jour = m.ajouterJours(debut, i);
  const s = m.semaineIso(jour);
  balayage.push(jour + '|' + m.jourAbsolu(jour) + '|' + m.formaterSemaineIso(s) + '|' + m.lundiDeSemaine(s.annee, s.semaine) + '|' + m.estDateValide(jour));
}
process.stdout.write(JSON.stringify({ decalage: new Date(2027, 0, 1).getTimezoneOffset(), exemples, balayage }));
`;
}

interface Sortie {
  decalage: number;
  exemples: Record<string, unknown>;
  balayage: string[];
}

const EXEMPLES_ATTENDUS = {
  s1: '2026-S53',
  s2: '2026-S53',
  s3: '2026-S53',
  s4: '2027-S01',
  s5: '2025-S01',
  s6: '2026-S01',
  lundi: '2027-05-31',
  ecart: 2,
  ajout: '2027-03-08',
  erreur: false,
  zero: 0,
};

const FUSEAUX = ['UTC', 'Pacific/Kiritimati', 'America/Los_Angeles', 'Pacific/Pago_Pago'] as const;

describe('indépendance au fuseau horaire (variable TZ)', () => {
  const sorties = new Map<string, Sortie>();

  beforeAll(async () => {
    const outils = await chargerOutilsNode();
    const source = script(cheminModuleDates());
    for (const tz of FUSEAUX) {
      const brut = outils.execFileSync(outils.execPath, ['--input-type=module', '--eval', source], {
        env: { ...outils.env, TZ: tz },
        encoding: 'utf8',
        timeout: 30_000,
      });
      sorties.set(tz, JSON.parse(brut) as Sortie);
    }
  }, 60_000);

  function sortie(tz: string): Sortie {
    const s = sorties.get(tz);
    if (s === undefined) {
      throw new Error(`pas de sortie pour ${tz}`);
    }
    return s;
  }

  it('les processus enfants tournent bien dans des fuseaux différents', () => {
    expect(sortie('UTC').decalage).toBe(0);
    expect(sortie('Pacific/Kiritimati').decalage).toBe(-840);
    expect(sortie('America/Los_Angeles').decalage).toBe(480);
    expect(sortie('Pacific/Pago_Pago').decalage).toBe(660);
  });

  it.each(FUSEAUX)('TZ=%s : les exemples du ticket sont exacts', (tz) => {
    expect(sortie(tz).exemples).toEqual(EXEMPLES_ATTENDUS);
  });

  it.each(FUSEAUX)('TZ=%s : balayage de 800 jours identique à UTC', (tz) => {
    const reference = sortie('UTC').balayage;
    expect(reference).toHaveLength(800);
    expect(reference[0]).toBe('2026-01-01|20454|2026-S01|2025-12-29|true');
    expect(sortie(tz).balayage).toEqual(reference);
  });
});
