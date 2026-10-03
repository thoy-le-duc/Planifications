/**
 * Tests d'acceptation T13i — « Fait » unique partagé : temps sur la grande ferme, et une seule
 * erreur « déjà fait » pour l'écran et pour la porte.
 *
 * Banc : comme grande-ferme.test.ts — la base locale telle que PowerSync la range
 * (./test/base-powersync.ts : tables JSON, vues, index du schéma local) sous node:sqlite, remplie
 * de la grande ferme (./test/grande-ferme.ts : 3 000 séries actives, ≈ 51 000 événements, chaînes
 * de corrections et d'annulations) ; écritures par la vraie porte (`porte.saisirEvenement`, comme
 * la voix ou l'agent : sans passer par l'écran).
 *
 * Contrat attendu (voir packages/sync/src/porte-fait-unique.test.ts) : `saisirEvenement` d'un
 * réalisé nouveau rejette avec `DejaFait` (exportée par @planif/sync) si un réalisé de la même
 * étape est en vigueur pour la culture. L'écran attrape `DejaFait` de ./ecritures.ts : c'est la
 * même classe (ou une parente), pour que le refus d'une saisie vocale s'affiche comme celui d'un tap.
 *
 *   G1  refus « déjà fait » en moins de 50 ms (CPU normal, médiane de 7 après une chauffe), pour :
 *       a) un réalisé simple en vigueur ;
 *       b) un réalisé corrigé (chaîne reçue du serveur) ;
 *       c) un réalisé ressaisi après annulation (la même étape a déjà une chaîne annulée) : le cas
 *          lent de T13h (≈ 30 ms sous Node), où les chaînes de TOUTE la ferme étaient recalculées ;
 *          la règle : restreindre le calcul à la culture visée.
 *   G2  après annulation, le nouveau réalisé s'écrit (grande ferme), lui aussi en moins de 50 ms.
 *   G3  le refus est une instance du `DejaFait` de ./ecritures.ts (ce que l'écran attrape).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees, type SaisieEvenement } from '@planif/sync';
import * as sync from '@planif/sync';
import type { DateCalendaire, Id } from '@planif/core';
import { DejaFait as DejaFaitEcran } from './ecritures.ts';
import { creerBasePowerSync, type BasePowerSync, type SchemaJson } from './test/base-powersync.ts';
import { ecrireGrandeFerme, FERME_GRANDE, idSerie, SERIES_ACTIVES, UTILISATEUR_GRANDE } from './test/grande-ferme.ts';

const AUJOURDHUI = '2026-09-30';
const BUDGET_MS = 50;
const REPETITIONS = 7;

const SCHEMA = SCHEMA_LOCAL.toJSON() as SchemaJson;

const mediane = (valeurs: readonly number[]): number => [...valeurs].sort((a, b) => a - b)[Math.floor(valeurs.length / 2)] ?? Number.NaN;

/** La classe DejaFait exportée par @planif/sync (lue sans casser le typage tant qu'elle n'existe pas). */
function classeDejaFait(): new (message?: string) => Error {
  const c = (sync as unknown as Readonly<Record<string, unknown>>).DejaFait;
  expect(c, '@planif/sync exporte la classe d’erreur DejaFait (« déjà fait »)').toBeTypeOf('function');
  return c as new (message?: string) => Error;
}

// ── Séries de la grande ferme (mêmes règles que ./test/grande-ferme.ts, vérifiées sur le banc) ──

type Etape = 'semis_direct' | 'plantation';
const decalage = (k: number): number => ((7 * k) % 150) - 90;
/** Étape de mise en place de la série k (mode k mod 3 : semis direct, plant maison, plant acheté). */
const miseEnPlace = (k: number): Etape => (k % 3 === 0 ? 'semis_direct' : 'plantation');
/** Mise en place réalisée au journal (o < −3, k mod 7 ≠ 0) ; k mod 13 = 0 : avec une chaîne. */
const realisee = (k: number): boolean => decalage(k) < -3 && k % 7 !== 0;

/** a) réalisé simple, sans chaîne. */
const SIMPLE = 1;
/** b) réalisé avec une correction (k mod 4 = 0), reçue du serveur (k pair). */
const CORRIGE = 52;
/** c) réalisés annulés (chaîne k mod 4 = 3) : cinq séries. */
const ANNULES = Array.from({ length: SERIES_ACTIVES }, (_, k) => k)
  .filter((k) => realisee(k) && k % 13 === 0 && k % 4 === 3)
  .slice(0, 5);

const realiseNouveau = (k: number): SaisieEvenement => ({
  type: 'realise',
  date: AUJOURDHUI as DateCalendaire,
  source: 'voix',
  culture: { sorte: 'serie', serieId: idSerie(k) as Id<'Serie'> },
  emplacementIds: [],
  note: null,
  photos: [],
  remplaceEvenement: null,
  detail: { etape: miseEnPlace(k), quantiteReelle: null },
});

// ── Banc ─────────────────────────────────────────────────────────────────────────────────────

let base: BasePowerSync;
let porte: PorteDonnees;

beforeAll(async () => {
  base = creerBasePowerSync(SCHEMA);
  await ecrireGrandeFerme(base, AUJOURDHUI);
  porte = creerPorte(base, {
    utilisateurId: UTILISATEUR_GRANDE as Id<'Utilisateur'>,
    fermeId: FERME_GRANDE as Id<'Ferme'>,
    maintenant: () => new Date('2026-09-30T10:00:00.000Z'),
  });
}, 120_000);

afterAll(() => {
  base.fermer();
});

const nombreEvenements = (): number => base.lireDirect<{ n: number }>('SELECT count(*) AS n FROM evenement')[0]?.n ?? -1;

/** Lignes de réalisé de la mise en place de la série k, par sorte (null = original). */
function realisesDe(k: number): (string | null)[] {
  return base
    .lireDirect<{ remplace_sorte: string | null }>(
      `SELECT remplace_sorte FROM evenement WHERE serie_id = ? AND type = 'realise' AND json_extract(detail, '$.etape') = ? ORDER BY horodatage, id`,
      [idSerie(k), miseEnPlace(k)],
    )
    .map((l) => l.remplace_sorte);
}

/** Durée (ms) d'un `saisirEvenement` qui doit être refusé avec DejaFait. */
async function dureeRefus(k: number): Promise<number> {
  const DejaFait = classeDejaFait();
  const avant = nombreEvenements();
  const t0 = performance.now();
  let resultat: unknown;
  try {
    resultat = await porte.saisirEvenement(realiseNouveau(k));
  } catch (e) {
    const duree = performance.now() - t0;
    expect(e, `série ${String(k)} : rejet DejaFait (reçu : ${String(e)})`).toBeInstanceOf(DejaFait);
    expect(nombreEvenements(), `série ${String(k)} : rien n’est écrit`).toBe(avant);
    return duree;
  }
  return expect.fail(`série ${String(k)} : rejet DejaFait attendu, saisirEvenement a rendu ${String(resultat)} (un événement a été écrit)`);
}

async function serieDeRefus(k: number): Promise<number[]> {
  const durees: number[] = [];
  for (let n = 0; n < REPETITIONS; n++) durees.push(await dureeRefus(k));
  return durees.map((d) => Math.round(d * 10) / 10);
}

// ── Tests ────────────────────────────────────────────────────────────────────────────────────

it('banc : les séries choisies portent bien un réalisé simple, corrigé, annulé', () => {
  expect(realisesDe(SIMPLE), 'a) réalisé simple').toEqual([null]);
  expect(realisesDe(CORRIGE), 'b) réalisé corrigé').toEqual([null, 'correction']);
  expect(ANNULES, 'c) cinq séries au réalisé annulé').toHaveLength(5);
  for (const k of ANNULES) expect(realisesDe(k), `c) série ${String(k)} : réalisé annulé`).toEqual([null, 'annulation']);
});

describe(`T13i : refus « déjà fait » par porte.saisirEvenement en moins de ${String(BUDGET_MS)} ms (grande ferme, médiane de ${String(REPETITIONS)})`, () => {
  it('G3 : le refus de la porte est le DejaFait que l’écran attrape (./ecritures.ts)', async () => {
    let erreur: unknown;
    try {
      await porte.saisirEvenement(realiseNouveau(SIMPLE));
    } catch (e) {
      erreur = e;
    }
    expect(erreur, 'saisirEvenement d’un réalisé déjà en vigueur : rejet').toBeInstanceOf(Error);
    expect(erreur, 'même classe que DejaFait de ./ecritures.ts (ou une sous-classe)').toBeInstanceOf(DejaFaitEcran);
    expect(erreur, 'et DejaFait de @planif/sync').toBeInstanceOf(classeDejaFait());
  });

  it('a) réalisé simple en vigueur', async () => {
    await dureeRefus(SIMPLE); // chauffe
    const durees = await serieDeRefus(SIMPLE);
    console.log(`T13i, refus « déjà fait » (réalisé simple) : ${durees.join(' / ')} ms (médiane ${String(mediane(durees))} ms)`);
    expect(mediane(durees), `refus : ${durees.join(' / ')} ms`).toBeLessThan(BUDGET_MS);
  });

  it('b) réalisé corrigé (chaîne reçue du serveur)', async () => {
    await dureeRefus(CORRIGE); // chauffe
    const durees = await serieDeRefus(CORRIGE);
    console.log(`T13i, refus « déjà fait » (réalisé corrigé) : ${durees.join(' / ')} ms (médiane ${String(mediane(durees))} ms)`);
    expect(mediane(durees), `refus : ${durees.join(' / ')} ms`).toBeLessThan(BUDGET_MS);
  });

  it('G2 puis c) : après annulation, le nouveau réalisé s’écrit (< 50 ms) ; le ressaisir est refusé (< 50 ms)', async () => {
    const ecritures: number[] = [];
    for (const k of ANNULES) {
      const t0 = performance.now();
      await expect(porte.saisirEvenement(realiseNouveau(k)), `série ${String(k)} : réalisé annulé, nouveau réalisé accepté`).resolves.toBeTypeOf('string');
      ecritures.push(Math.round((performance.now() - t0) * 10) / 10);
    }
    console.log(`T13i, réalisé après annulation (écrit) : ${ecritures.join(' / ')} ms (médiane ${String(mediane(ecritures))} ms)`);
    expect(mediane(ecritures), `écriture après annulation : ${ecritures.join(' / ')} ms`).toBeLessThan(BUDGET_MS);

    const k = ANNULES[0] ?? -1;
    await dureeRefus(k); // chauffe
    const durees = await serieDeRefus(k);
    console.log(`T13i, refus « déjà fait » (chaîne annulée + réalisé) : ${durees.join(' / ')} ms (médiane ${String(mediane(durees))} ms)`);
    expect(mediane(durees), `refus : ${durees.join(' / ')} ms`).toBeLessThan(BUDGET_MS);
  });
});
