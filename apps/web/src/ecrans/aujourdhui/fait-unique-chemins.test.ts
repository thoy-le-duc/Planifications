/**
 * Tests d'acceptation T13j — « Fait » unique, tous les chemins : temps du refus sur la grande ferme.
 *
 * Banc : comme fait-unique-partage.test.ts (T13i) — la base locale telle que PowerSync la range
 * (./test/base-powersync.ts) sous node:sqlite, remplie de la grande ferme (./test/grande-ferme.ts :
 * 3 000 séries actives, ≈ 51 000 événements, chaînes reçues du serveur avec `origine_id`) ;
 * écritures par la vraie porte, sans passer par l'écran (voix, agent).
 *
 * Contrat attendu (voir packages/sync/src/porte-fait-unique-chemins.test.ts) :
 *   - `porte.saisirEvenement` d'une intervention NOUVELLE qui solde un travail prévu
 *     (occurrenceVisee) rejette avec `DejaFait` si ce travail (libellé, catégorie, occurrence) est
 *     déjà soldé par une intervention en vigueur de la culture — la règle de l'écran ;
 *   - `porte.preparerSaisie` rend `verification`, à passer à `ecrireEnsemble`.
 *
 *   M1  refus « déjà fait » d'une intervention soldante par saisirEvenement, en moins de 50 ms
 *       (CPU normal, médiane de 7 après une chauffe), pour :
 *       a) une grelinette soldée sans chaîne ;
 *       b) un désherbage soldé par une chaîne de corrections reçue du serveur (`origine_id` :
 *          la branche de la vérification qui parcourt l'index `remplacement`, ticket T13j) ;
 *   M2  désherbage annulé : le travail se solde de nouveau (écrit), puis le ressaisir est refusé ;
 *   M3  réalisé corrigé (chaîne reçue du serveur) par preparerSaisie + ecrireEnsemble avec la
 *       vérification rendue : refusé avec DejaFait, en moins de 50 ms.
 *
 * Mesure CPU ×4 (critère du ticket, seuil de l'index `origine_id` : 50 ms) : chaque cas journalise
 * aussi 4 × la médiane, ESTIMATION seulement (node:sqlite natif, plus rapide que wa-sqlite du
 * navigateur). La mesure navigateur CPU ×4 la plus proche existe déjà : l'étape « relecture après
 * Fait » de apps/web/e2e/aujourdhui-grande-ferme.e2e.ts (le « Fait » de l'écran passe par la même
 * vérification, branche `origine_id` comprise) : `pnpm build:essais && pnpm e2e -- aujourdhui-grande-ferme`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerPorte, DejaFait, SCHEMA_LOCAL, type EvenementPrepare, type PorteDonnees, type SaisieEvenement, type VerificationEcriture } from '@planif/sync';
import { ajouterJours, type DateCalendaire, type DetailIntervention, type Id } from '@planif/core';
import { creerBasePowerSync, type BasePowerSync, type SchemaJson } from './test/base-powersync.ts';
import { ecrireGrandeFerme, FERME_GRANDE, idSerie, UTILISATEUR_GRANDE } from './test/grande-ferme.ts';

const AUJOURDHUI = '2026-09-30' as DateCalendaire;
const BUDGET_MS = 50;
const REPETITIONS = 7;
const RALENTISSEMENT = 4;

const SCHEMA = SCHEMA_LOCAL.toJSON() as SchemaJson;

const mediane = (valeurs: readonly number[]): number => [...valeurs].sort((a, b) => a - b)[Math.floor(valeurs.length / 2)] ?? Number.NaN;
const j = (n: number): DateCalendaire => ajouterJours(AUJOURDHUI, n);

// ── Séries de la grande ferme (mêmes règles que ./test/grande-ferme.ts, vérifiées sur le banc) ──

const decalage = (k: number): number => ((7 * k) % 150) - 90;

/** a) série 1 : grelinette soldée (occurrence = mise en place − 12), sans chaîne. */
const GRELINETTE = 1;
const detailGrelinette = (k: number): DetailIntervention => ({ categorie: 'travail_sol', type: 'grelinette', outil: 'grelinette', occurrenceVisee: j(decalage(k) - 12) });

/** Occurrence visée par le DERNIER désherbage fait de la série k (celui qui porte une chaîne si k mod 17 = 0). */
function dernierDesherbage(k: number): DateCalendaire {
  const o = decalage(k);
  const occurrences: number[] = [];
  for (let d = o + 14; d < 0 && d <= o + 100; d += 14) occurrences.push(d);
  const faites = k % 5 === 0 ? occurrences.slice(0, -1) : occurrences;
  const d = faites.at(-1);
  if (d === undefined) throw new Error(`série ${String(k)} : aucun désherbage fait`);
  return j(d);
}
const detailDesherbage = (k: number): DetailIntervention => ({ categorie: 'entretien', type: 'désherbage', outil: null, occurrenceVisee: dernierDesherbage(k) });

/** b) série 374 (k mod 17 = 0, k mod 4 = 2, paire) : correction de correction reçue du serveur (origine_id). */
const DESHERBAGE_CORRIGE = 374;
/** M2) série 68 (k mod 17 = 0, k mod 4 = 0, paire) : dernier désherbage annulé, chaîne reçue du serveur. */
const DESHERBAGE_ANNULE = 68;
/** M3) série 52 : réalisé de plantation corrigé, chaîne reçue du serveur (fait-unique-partage.test.ts). */
const REALISE_CORRIGE = 52;

const commun = (k: number) => ({
  date: AUJOURDHUI,
  source: 'agent' as const,
  culture: { sorte: 'serie' as const, serieId: idSerie(k) as Id<'Serie'> },
  emplacementIds: [],
  note: null,
  photos: [],
  remplaceEvenement: null,
});

const intervention = (k: number, detail: DetailIntervention): SaisieEvenement => ({ ...commun(k), type: 'intervention', detail });
const realisePlantation = (k: number): SaisieEvenement => ({ ...commun(k), type: 'realise', detail: { etape: 'plantation', quantiteReelle: null } });

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

/** Lignes d'intervention de la série k qui portent ce libellé et cette occurrence : (sorte, origine_id renseignée). */
function interventionsDe(k: number, d: DetailIntervention): string[] {
  return base
    .lireDirect<{ remplace_sorte: string | null; origine_id: string | null }>(
      `SELECT remplace_sorte, origine_id FROM evenement WHERE serie_id = ? AND type = 'intervention'
         AND json_extract(detail, '$.type') = ? AND json_extract(detail, '$.occurrenceVisee') = ? ORDER BY horodatage, id`,
      [idSerie(k), d.type, d.occurrenceVisee ?? null],
    )
    .map((l) => `${l.remplace_sorte ?? 'original'}${l.origine_id === null ? '' : ' (serveur)'}`);
}

/** Rejet DejaFait attendu, rien d'écrit ; rend la durée (ms). */
async function dureeRefus(ecrire: () => Promise<unknown>, nom: string): Promise<number> {
  const avant = nombreEvenements();
  const t0 = performance.now();
  let resultat: unknown;
  try {
    resultat = await ecrire();
  } catch (e) {
    const duree = performance.now() - t0;
    expect(e, `${nom} : rejet DejaFait (reçu : ${String(e)})`).toBeInstanceOf(DejaFait);
    expect(nombreEvenements(), `${nom} : rien n’est écrit`).toBe(avant);
    return duree;
  }
  return expect.fail(`${nom} : rejet DejaFait attendu, l’écriture a réussi (rendu : ${String(resultat)})`);
}

async function mesurer(ecrire: () => Promise<unknown>, nom: string): Promise<void> {
  await dureeRefus(ecrire, nom); // chauffe
  const durees: number[] = [];
  for (let n = 0; n < REPETITIONS; n++) durees.push(Math.round((await dureeRefus(ecrire, nom)) * 10) / 10);
  const m = mediane(durees);
  console.log(
    `T13j, refus « déjà fait » (${nom}) : ${durees.join(' / ')} ms (médiane ${String(m)} ms ; estimation CPU ×${String(RALENTISSEMENT)} : ${(m * RALENTISSEMENT).toFixed(1)} ms)`,
  );
  expect(m, `refus : ${durees.join(' / ')} ms`).toBeLessThan(BUDGET_MS);
}

/** La vérification que `preparerSaisie` rend (`verification`), lue sans casser le typage tant qu'elle n'existe pas. */
function verificationRendue(p: EvenementPrepare): VerificationEcriture {
  const v = (p as unknown as { readonly verification?: unknown }).verification;
  expect(v, 'preparerSaisie rend la vérification « déjà fait » (champ `verification`)').toBeTypeOf('function');
  return v as VerificationEcriture;
}

// ── Tests ────────────────────────────────────────────────────────────────────────────────────

it('banc : les séries choisies portent une grelinette simple, un désherbage corrigé (serveur), un désherbage annulé, un réalisé corrigé', () => {
  expect(interventionsDe(GRELINETTE, detailGrelinette(GRELINETTE)), 'a) grelinette sans chaîne').toEqual(['original']);
  expect(interventionsDe(DESHERBAGE_CORRIGE, detailDesherbage(DESHERBAGE_CORRIGE)), 'b) correction de correction reçue du serveur').toEqual([
    'original (serveur)',
    'correction (serveur)',
    'correction (serveur)',
  ]);
  expect(interventionsDe(DESHERBAGE_ANNULE, detailDesherbage(DESHERBAGE_ANNULE)), 'M2) désherbage annulé').toEqual(['original (serveur)', 'annulation (serveur)']);
  const realises = base
    .lireDirect<{ remplace_sorte: string | null; origine_id: string | null }>(
      `SELECT remplace_sorte, origine_id FROM evenement WHERE serie_id = ? AND type = 'realise' AND json_extract(detail, '$.etape') = 'plantation' ORDER BY horodatage, id`,
      [idSerie(REALISE_CORRIGE)],
    )
    .map((l) => `${l.remplace_sorte ?? 'original'}${l.origine_id === null ? '' : ' (serveur)'}`);
  expect(realises, 'M3) réalisé corrigé reçu du serveur').toEqual(['original (serveur)', 'correction (serveur)']);
});

describe(`T13j : refus « déjà fait » d’une intervention qui solde un travail prévu, par saisirEvenement, en moins de ${String(BUDGET_MS)} ms (grande ferme, médiane de ${String(REPETITIONS)})`, { timeout: 60_000 }, () => {
  it('M1a : grelinette déjà soldée, sans chaîne', async () => {
    await mesurer(() => porte.saisirEvenement(intervention(GRELINETTE, detailGrelinette(GRELINETTE))), 'grelinette soldée');
  });

  it('M1b : désherbage soldé par une chaîne de corrections reçue du serveur (branche origine_id)', async () => {
    await mesurer(() => porte.saisirEvenement(intervention(DESHERBAGE_CORRIGE, detailDesherbage(DESHERBAGE_CORRIGE))), 'désherbage corrigé, serveur');
  });

  it('M2 : désherbage annulé : le travail se solde de nouveau, puis le ressaisir est refusé', async () => {
    const s = intervention(DESHERBAGE_ANNULE, detailDesherbage(DESHERBAGE_ANNULE));
    await expect(porte.saisirEvenement(s), 'chaîne annulée : écrit').resolves.toBeTypeOf('string');
    await mesurer(() => porte.saisirEvenement(s), 'désherbage annulé puis soldé de nouveau');
  });

  it('M3 : réalisé corrigé (serveur), par preparerSaisie + ecrireEnsemble avec la vérification rendue', async () => {
    verificationRendue(porte.preparerSaisie(realisePlantation(REALISE_CORRIGE)));
    await mesurer(() => {
      const p = porte.preparerSaisie(realisePlantation(REALISE_CORRIGE));
      return porte.ecrireEnsemble([p.ordre], verificationRendue(p));
    }, 'réalisé corrigé, chemin préparé');
  });
});
