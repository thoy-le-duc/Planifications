/**
 * Tests d'acceptation T13b — Aujourd'hui rapide sur une grande ferme.
 *
 * Banc : la base locale du téléphone telle que PowerSync la range (./test/base-powersync.ts :
 * tables « JSON », vues, index d'expression déclarés par `SCHEMA_LOCAL`), sous node:sqlite,
 * remplie de la grande ferme (./test/grande-ferme.ts : 3 000 séries actives, ≈ 51 000
 * événements, des milliers de tâches, des chaînes de corrections et d'annulations) ;
 * aujourd'hui = 2026-09-30, maintenant = 10:00 UTC.
 *
 * 1. Index : le schéma local déclare des index sur evenement(remplace_evenement_id),
 *    evenement(serie_id) et mouvement_stock(recolte_id) ; et les requêtes de la journée s'en
 *    servent : dans le plan (EXPLAIN QUERY PLAN) de chaque requête de `lireJournee`, aucun accès
 *    au journal n'est un parcours complet (SCAN) ni un parcours de tout le journal de la ferme
 *    (index ferme_date contraint par la seule ferme). Avant T13b : la montée de `CHAINES`,
 *    `SQL_REALISES`, `SQL_INTERVENTIONS` et `SQL_RECENTS` parcourent tout le journal de la ferme.
 *
 * 3. Vitesse : `lireJournee` en moins de 250 ms, médiane de 5, après une lecture de chauffe :
 *    garde-fou de régression (décision du chef, voir le test).
 *
 * 4. Équivalence : la journée calculée (`calculerJournee(lireJournee(…))`) est identique à la
 *    référence figée ci-dessous, relevée sur le code AVANT l'allègement (commit a1a0cbc) :
 *    nombre de tâches, de saisies dans l'historique, de récoltes en cours, de dernières
 *    récoltes, et empreinte SHA-256 de toute la journée (forme canonique : clés triées, Map en
 *    entrées triées). Ce test passe avant ET après T13b.
 */
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { calculerJournee, lireJournee, type Journee } from './calculs.ts';
import { creerBasePowerSync, type BasePowerSync, type SchemaJson } from './test/base-powersync.ts';
import { ecrireGrandeFerme, FERME_GRANDE, SERIES_ACTIVES, UTILISATEUR_GRANDE, type GrandeFerme } from './test/grande-ferme.ts';

const AUJOURDHUI = '2026-09-30';
const MAINTENANT = new Date('2026-09-30T10:00:00.000Z');
const BUDGET_LECTURE_MS = 250;
const REPETITIONS = 5;

const SCHEMA = SCHEMA_LOCAL.toJSON() as SchemaJson;

// ── 1a. Index déclarés ───────────────────────────────────────────────────────────────────────

/** Index de `table` dont la PREMIÈRE colonne est `colonne` (seul cas où SQLite s'en sert pour elle). */
function indexEnTete(table: string, colonne: string): string[] {
  const t = SCHEMA.tables.find((x) => x.name === table);
  return (t?.indexes ?? []).filter((i) => i.columns[0]?.name === colonne).map((i) => i.name);
}

describe('T13b : index locaux déclarés dans le schéma de @planif/sync', () => {
  it.each([
    ['evenement', 'remplace_evenement_id'],
    ['evenement', 'serie_id'],
    ['mouvement_stock', 'recolte_id'],
  ])('%s(%s) : un index commence par cette colonne', (table, colonne) => {
    expect(indexEnTete(table, colonne), `index de ${table} en tête sur ${colonne}`).not.toEqual([]);
  });
});

// ── Banc : la grande ferme ───────────────────────────────────────────────────────────────────

let base: BasePowerSync;
let porte: PorteDonnees;
let ferme: GrandeFerme;

beforeAll(async () => {
  base = creerBasePowerSync(SCHEMA);
  ferme = await ecrireGrandeFerme(base, AUJOURDHUI);
  porte = creerPorte(base, { utilisateurId: UTILISATEUR_GRANDE as Id<'Utilisateur'>, fermeId: FERME_GRANDE as Id<'Ferme'> });
}, 120_000);

afterAll(() => {
  base.fermer();
});

it('banc : la grande ferme a 3 000 séries actives et environ 50 000 événements', () => {
  expect(ferme.evenements).toBeGreaterThanOrEqual(48_000);
  expect(ferme.evenements).toBeLessThanOrEqual(55_000);
  const actives = base.lireDirect<{ n: number }>(`SELECT count(*) AS n FROM serie WHERE ferme_id = ? AND statut IN ('prevue', 'en_cours')`, [FERME_GRANDE]);
  expect(actives[0]?.n).toBe(SERIES_ACTIVES);
  // Le banc est bien le stockage de PowerSync : le journal est une vue sur ps_data__evenement.
  expect(base.lireDirect<{ type: string }>(`SELECT type FROM sqlite_master WHERE name = 'evenement'`)[0]?.type).toBe('view');
});

// ── 1b. Plan des requêtes de la journée ──────────────────────────────────────────────────────

interface RequeteLue {
  readonly sql: string;
  readonly parametres: readonly unknown[];
}

/** `lireJournee` sur une porte espion : les requêtes envoyées, dans l'ordre. */
async function requetesDeLaJournee(): Promise<RequeteLue[]> {
  const vues: RequeteLue[] = [];
  const espion: PorteDonnees = {
    ...porte,
    lire: <T,>(sql: string, parametres?: readonly unknown[]) => {
      vues.push({ sql, parametres: parametres ?? [] });
      return porte.lire<T>(sql, parametres);
    },
  };
  await lireJournee(espion, FERME_GRANDE, AUJOURDHUI, MAINTENANT);
  return vues;
}

/** Nom court d'une requête pour les messages : son dernier SELECT principal, abrégé. */
function nomRequete(sql: string, rang: number): string {
  const corps = sql.replace(/\s+/g, ' ');
  const debut = corps.lastIndexOf(') SELECT ');
  return `requête ${String(rang + 1)} « ${(debut >= 0 ? corps.slice(debut + 2) : corps).slice(0, 90)}… »`;
}

const INTERNE = 'ps_data__evenement';

/**
 * Accès au journal qui le parcourent en entier : SCAN de la table, ou SEARCH par un index qui
 * commence par `ferme_id` contraint par cette seule colonne (tout le journal de la ferme).
 */
function parcoursDuJournal(plan: readonly string[]): string[] {
  const indexFerme = new Set(indexEnTete('evenement', 'ferme_id').map((n) => `${INTERNE}__${n}`));
  return plan.filter((chemin) => {
    const ligne = chemin.split(' › ').at(-1) ?? '';
    if (!ligne.includes(INTERNE)) return false;
    if (new RegExp(`^SCAN ${INTERNE}\\b`).test(ligne)) return true;
    const m = new RegExp(`^SEARCH ${INTERNE} USING (?:COVERING )?INDEX (\\S+) \\((.*)\\)`).exec(ligne);
    if (m === null) return false;
    const contraintes = (m[2] ?? '').split(' AND ').length;
    return indexFerme.has(m[1] ?? '') && contraintes === 1;
  });
}

describe('T13b : les requêtes de la journée se servent des index du journal', () => {
  it('aucun accès au journal (evenement) ne le parcourt en entier : ni SCAN, ni tout le journal de la ferme', async () => {
    const requetes = await requetesDeLaJournee();
    const surLeJournal = requetes.filter((r) => /\bevenement\b/.test(r.sql));
    expect(surLeJournal.length, 'requêtes de la journée qui lisent le journal').toBeGreaterThan(0);
    const fautes = surLeJournal.flatMap((r) => {
      const plan = base.plan(r.sql, r.parametres);
      return parcoursDuJournal(plan).map((ligne) => `${nomRequete(r.sql, requetes.indexOf(r))} : ${ligne}`);
    });
    expect(fautes, `parcours complets du journal :\n${fautes.join('\n')}`).toEqual([]);
  });

  it('témoin du critère : la requête « tout le journal de la ferme » est bien repérée', () => {
    const plan = base.plan('SELECT id FROM evenement WHERE ferme_id = ?', [FERME_GRANDE]);
    expect(parcoursDuJournal(plan).length).toBeGreaterThan(0);
    const parId = base.plan('SELECT id FROM evenement WHERE id = ?', ['x']);
    expect(parcoursDuJournal(parId)).toEqual([]);
  });
});

// ── 3. Vitesse ───────────────────────────────────────────────────────────────────────────────

const mediane = (valeurs: readonly number[]): number => [...valeurs].sort((a, b) => a - b)[Math.floor(valeurs.length / 2)] ?? Number.NaN;

/**
 * Garde-fou de régression, plus le critère de vitesse du ticket (décision du chef, T13b).
 * Le ticket visait 100 ms ; mesuré sur ce banc (stockage PowerSync, node:sqlite) :
 * 854 ms avant T13b (832 / 901 / 835 / 854 / 916), 102 à 126 ms après l'allègement (120 / 123 / 105 / 126 / 102, médiane 120 ; index,
 * requêtes réécrites), à résultats identiques (test 4). Le reste ne se gagne pas par les
 * requêtes seules : le budget du lancement à froid (1 s, e2e) part dans T13d (instantané de la
 * journée affiché au lancement, puis rafraîchi). Budget relevé à 250 ms : une marge sur la
 * mesure actuelle, et un échec net si la lecture repart vers les parcours complets du journal.
 */
describe('T13b : lecture de la journée sur la grande ferme', { timeout: 120_000 }, () => {
  it(`lireJournee en moins de ${String(BUDGET_LECTURE_MS)} ms (médiane de ${String(REPETITIONS)}, après une lecture de chauffe)`, async () => {
    await lireJournee(porte, FERME_GRANDE, AUJOURDHUI, MAINTENANT);
    const serie: number[] = [];
    for (let k = 0; k < REPETITIONS; k++) {
      const t0 = performance.now();
      await lireJournee(porte, FERME_GRANDE, AUJOURDHUI, MAINTENANT);
      serie.push(Math.round(performance.now() - t0));
    }
    console.log(`T13b, lireJournee sur la grande ferme : ${serie.join(' / ')} ms (médiane ${String(mediane(serie))} ms)`);
    expect(mediane(serie), `lireJournee : ${serie.join(' / ')} ms`).toBeLessThan(BUDGET_LECTURE_MS);
  });
});

// ── 4. Équivalence ───────────────────────────────────────────────────────────────────────────

/** Forme canonique : clés d'objet triées, Map en entrées triées par clé. */
function canonique(v: unknown): unknown {
  if (v instanceof Map) {
    return [...(v as Map<unknown, unknown>).entries()].map(([k, x]) => [String(k), canonique(x)] as const).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }
  if (Array.isArray(v)) return v.map(canonique);
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canonique((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

const empreinte = (v: unknown): string => createHash('sha256').update(JSON.stringify(canonique(v))).digest('hex');

/** Référence relevée sur le code d'avant l'allègement (commit a1a0cbc, branche ticket/T13b). */
const REFERENCE = {
  taches: 2045,
  historique: 1464,
  recoltesEnCours: 832,
  dernieresRecoltes: 763,
  cultures: 3040,
  empreinteTaches: '7811bc0b8eb9e21496326694a5a70c65ef08e4ba3ffb48da2526d0c1d1b5d4f5',
  empreinteHistorique: 'e029ccc56d3034b9f26f3b5bcdec6338717acca5ca65ad745116bd037b9f26c9',
  empreinteJournee: '77ac1d085dcb4206f9fbcd046fa086c8bae546f52b716491073a0b5b028a5b93',
} as const;

function releve(j: Journee) {
  return {
    taches: j.taches.length,
    historique: j.historique.length,
    recoltesEnCours: j.recoltesEnCours.length,
    dernieresRecoltes: j.dernieresRecoltes.size,
    cultures: j.cultures.size,
    empreinteTaches: empreinte(j.taches.map((t) => t.cle)),
    empreinteHistorique: empreinte(j.historique.map((h) => h.evenement.id)),
    empreinteJournee: empreinte(j),
  };
}

describe('T13b : mêmes résultats qu’avant l’allègement', { timeout: 120_000 }, () => {
  it('journée de la grande ferme identique à la référence figée (tâches, historique, récoltes, cultures)', async () => {
    const journee = calculerJournee(await lireJournee(porte, FERME_GRANDE, AUJOURDHUI, MAINTENANT), AUJOURDHUI);
    const r = releve(journee);
    console.log(`T13b, référence : ${JSON.stringify(r)}`);
    expect(r.taches, 'des milliers de tâches').toBeGreaterThanOrEqual(2_000);
    expect(r).toEqual(REFERENCE);
  });
});
