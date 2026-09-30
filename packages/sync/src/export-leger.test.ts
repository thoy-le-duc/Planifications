/**
 * Tests d'acceptation T15b — export léger (docs/backlog/T15b-export-leger.md) : mémoire au pic
 * et fil principal jamais gelé, sur la ferme de T07. Contrat : « Archive légère » dans
 * packages/core/src/export/test/contrat.ts, et « Mémoire » dans ./test/contrat-export.ts.
 *
 * Les mesures tournent dans un processus Node isolé (./test/mesure-export.ts, `--expose-gc`) :
 * la mémoire d'un fil de vitest mêle celle des autres tests. Seuils :
 *   - mémoire : règle du ticket (au pic, pas plus de 2 × la taille de l'archive finale) + 8 Mio
 *     de marge. La marge couvre les tampons de travail (un morceau de CSV en cours, zlib) et le
 *     bruit de la mesure (± 1 à 3 Mio d'une exécution à l'autre, mesuré) : avec une archive de
 *     2 à 5 Mo, 2 × la taille seule serait sous le bruit. Pour mémoire, T15 ajoutait ≈ 210 Mo ;
 *   - tâches : 25 ms sous Node ≈ 100 ms sur le fil principal d'un téléphone (CPU ralenti ×4, même
 *     règle que le temps d'export de T15). Relecture T15b : mesurées en TEMPS CPU du fil principal
 *     (borné par le temps mural), plus en temps mural seul. L'ancienne mesure (meilleur de trois
 *     écarts muraux) échouait sur une machine chargée : la préemption du processus par le
 *     système comptait comme un calcul (mesuré : 32 à 39 ms murales contre 13 à 16 ms de CPU avec
 *     8 processus en boucle à côté). Le critère n'est pas affaibli, il est durci : les TROIS
 *     exports doivent rester sous 25 ms, plus seulement le meilleur ;
 *   - longue chaîne : un texte de 40 Mio en un seul morceau ne coûte pas plus de mémoire que le
 *     même texte en morceaux, à 8 Mio près (T15b : ≈ 56 Mio contre ≈ 13 Mio) ;
 *   - la lecture de la base n'est pas dans la mesure des tâches : sous Node, node:sqlite lit de
 *     façon synchrone (≈ 0,5 s pour les 30 000 événements), alors que PowerSync lit hors du fil
 *     principal. Elle est dans la mesure de mémoire d'exporterFerme (lignes lues déduites).
 */
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ResultatMesures } from './test/mesure-export.ts';

const SCRIPT = fileURLToPath(new URL('./test/mesure-export.ts', import.meta.url));
const MIO = 1_048_576;
const MARGE = 8 * MIO;
/** 100 ms de fil principal, CPU ralenti ×4. */
const TACHE_MAX_MS = 25;

let r: ResultatMesures;

beforeAll(async () => {
  const sortie = await new Promise<string>((ok, ko) => {
    execFile(
      process.execPath,
      ['--expose-gc', '--no-warnings', SCRIPT],
      { encoding: 'utf8', timeout: 170_000, maxBuffer: 1024 * 1024 },
      (erreur, stdout, stderr) => {
        if (erreur !== null) ko(new Error(`mesure-export.ts a échoué : ${erreur.message}\n${stderr}`));
        else ok(stdout);
      },
    );
  });
  r = JSON.parse(sortie.trim().split('\n').at(-1) ?? '{}') as ResultatMesures;
  console.info(`T15b : mesures ${JSON.stringify(r)}`);
}, 180_000);

const mio = (n: number) => `${(n / MIO).toFixed(1)} Mio`;

describe('T15b : export léger, ferme de T07 (processus isolé)', () => {
  it('les mesures ont pu se faire (construireArchive et exporterFerme existent)', () => {
    expect(r.erreur).toBeUndefined();
    expect(r.archive).toBeDefined();
    expect(r.ferme).toBeDefined();
  });

  it('mémoire de construireArchive au pic : au plus 2 × l’archive finale + 8 Mio (T15 : ≈ 210 Mio)', () => {
    const a = r.archive;
    expect(a, r.erreur).toBeDefined();
    if (a === undefined) return;
    expect(a.appels, 'relevés pendant l’export (appels d’avancement)').toBeGreaterThanOrEqual(20);
    expect(a.taille).toBeLessThan(8_000_000);
    expect(a.pic, `pic ${mio(a.pic)} pour une archive de ${mio(a.taille)}`).toBeLessThanOrEqual(2 * a.taille + MARGE);
  });

  it('mémoire d’exporterFerme au pic : lignes lues + 2 × l’archive finale + 8 Mio', () => {
    const f = r.ferme;
    expect(f, r.erreur).toBeDefined();
    if (f === undefined) return;
    expect(f.lignesLues, 'témoin : les lignes de T07 pèsent des dizaines de Mio').toBeGreaterThan(20 * MIO);
    expect(f.appels).toBeGreaterThanOrEqual(20);
    expect(f.taille).toBeLessThan(8_000_000);
    expect(f.pic, `pic ${mio(f.pic)}, lignes lues ${mio(f.lignesLues)}, archive ${mio(f.taille)}`).toBeLessThanOrEqual(f.lignesLues + 2 * f.taille + MARGE);
  });

  it(`fil jamais gelé : aucun calcul de plus de ${String(TACHE_MAX_MS)} ms (CPU du fil) pendant construireArchive, sur chacun des trois exports`, () => {
    const t = r.taches ?? [];
    expect(t, r.erreur).toHaveLength(3);
    const detail = t.map((x) => `${x.plusLongue.toFixed(1)} ms CPU (${x.plusLongueMurale.toFixed(1)} ms murales)`).join(', ');
    const pire = Math.max(...t.map((x) => x.plusLongue));
    expect(pire, `plus longues tâches : ${detail}`).toBeLessThan(TACHE_MAX_MS);
    // Témoin : la mesure voit bien les tranches de calcul (une mesure cassée rendrait 0).
    for (const x of t) expect(x.plusLongue, detail).toBeGreaterThan(0.5);
  });

  it('longue chaîne en un morceau (40 Mio) : mémoire au pic ≤ celle du même texte en morceaux + 8 Mio', () => {
    const c = r.chaine;
    expect(c, r.erreurChaine).toBeDefined();
    if (c === undefined) return;
    expect(c.morceaux.appels, 'relevés pendant la compression').toBeGreaterThanOrEqual(10);
    expect(c.unMorceau.appels).toBeGreaterThanOrEqual(10);
    expect(c.unMorceau.taille, 'même archive').toBe(c.morceaux.taille);
    expect(c.unMorceau.pic, `un morceau ${mio(c.unMorceau.pic)}, en morceaux ${mio(c.morceaux.pic)}`).toBeLessThanOrEqual(c.morceaux.pic + MARGE);
  });

  it('temps : construireArchive de T07 (sans lecture) sous 2,5 s de calcul, même en rendant la main (min(mural, CPU), T19)', () => {
    // T19 : temps de calcul (voir MesureTache.calcul), pas temps mural : une machine chargée ne fait plus échouer.
    const t = r.taches ?? [];
    const detail = t.map((x) => `${x.calcul.toFixed(0)} ms de calcul (${x.duree.toFixed(0)} ms murales)`).join(', ');
    for (const x of t) expect(x.calcul, detail).toBeLessThan(2500);
    expect(r.taches?.length).toBe(3);
  });
});
