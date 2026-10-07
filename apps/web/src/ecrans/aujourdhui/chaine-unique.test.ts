/**
 * Tests d'acceptation T13m — une seule règle « chaîne d'une saisie ».
 *
 * API attendue (@planif/sync/fait-unique, à côté de `chaines` et `CHAINES`) :
 *
 *   export interface ChaineDe { readonly annulee: boolean; readonly enVigueur: string | null }
 *   export function chaineDe(lire: Lire, fermeId: string, id: string): Promise<ChaineDe>
 *
 * où `Lire` est la fonction de lecture d'une vérification (`Parameters<VerificationEcriture>[0]`) :
 * `chaineDe` sert dans la transaction d'écriture comme hors d'elle. Elle rend, pour la chaîne de
 * remplacements de la ligne `id` de la ferme `fermeId` : `annulee` (la chaîne contient une
 * annulation : rien n'y est en vigueur, `enVigueur` nul) ; sinon `enVigueur`, la ligne en vigueur
 * (la correction la plus récente, horodatage puis id, à défaut l'origine). Seules les lignes de la
 * ferme comptent : une ligne absente de la ferme rend { annulee: false, enVigueur: null }.
 *
 *   P1  Propriété (générateur à graine fixe, plusieurs milliers de journaux) : `chaineDe`, `chaines`
 *       (lue comme la journée : CHAINES) et `enVigueur` (calculs.ts) donnent la même chaîne
 *       annulée et la même ligne en vigueur. Journaux générés : maillons manquants, horloges
 *       décalées (une correction plus récente dans la chaîne peut porter un horodatage plus ancien,
 *       égalités d'horodatage départagées par l'id), lignes reçues du serveur (`origine_id` =
 *       l'origine vraie de la chaîne), cycles (A ↔ B par remplace_evenement_id), deux fermes dans
 *       la même base (y compris des liens d'une ferme vers l'autre).
 *         - `chaineDe` et `chaines` sont comparées ligne par ligne, sur tous les journaux ;
 *         - `enVigueur` ne connaît pas `origine_id` (l'historique de l'écran) : elle est comparée
 *           (ensemble des lignes en vigueur) partout où elle dispose de la même information, à
 *           savoir quand il ne manque aucun maillon, ou quand aucune ligne ne porte `origine_id`.
 *       Cycle (données corrompues : aucune origine atteinte) : la règle de CHAINES, que la journée
 *       applique déjà, fait foi : rien n'est en vigueur dans un cycle ni dans ce qui y remonte
 *       (`annulee` vrai pour `chaineDe`). `enVigueur` et `chaineDe` s'y alignent. Les journaux à
 *       cycle sont tirés à part, moins nombreux (chaque montée y va jusqu'à sa borne).
 *       Isolement : `chaines` ne monte jamais par une ligne d'une autre ferme (aujourd'hui elle le
 *       fait : une ligne de A dont le parent est une ligne de B rejoint la chaîne de B).
 *   P2  ecritures.ts n'a plus sa propre copie de la règle : il importe `chaineDe` de
 *       @planif/sync/fait-unique et son code (commentaires ôtés) ne lit plus `origine_id` ni ne
 *       trie le journal par horodatage.
 *   (P3 : evenementDuJournal, voir chaine-unique-journal.test.ts.)
 */
import { readFileSync } from 'node:fs';
import { SCHEMA_LOCAL } from '@planif/sync';
import { chaineDe, CHAINES } from '@planif/sync/fait-unique';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { enVigueur, type MaillonChaine } from './calculs.ts';

// ── Générateur déterministe ──────────────────────────────────────────────────────────────────

/** mulberry32 : générateur à graine fixe, reproductible. */
function generateur(graine: number): { readonly suivant: () => number; readonly entier: (n: number) => number; readonly chance: (p: number) => boolean } {
  let a = graine >>> 0;
  const suivant = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { suivant, entier: (n) => Math.floor(suivant() * n), chance: (p) => suivant() < p };
}

type Sorte = 'correction' | 'annulation' | null;

interface LigneJournal {
  readonly id: string;
  readonly ferme: string;
  readonly horodatage: string;
  readonly sorte: Sorte;
  readonly remplace: string | null;
  readonly origine: string | null;
}

type Mode = 'complet-local' | 'complet-serveur' | 'manquants-local' | 'manquants-serveur' | 'cycle';
const MODES: readonly Mode[] = ['complet-local', 'complet-serveur', 'manquants-local', 'manquants-serveur', 'cycle'];

const FERME_A = '0192f0c1-13ad-7000-8000-00000000000a';
const FERME_B = '0192f0c1-13ad-7000-8000-00000000000b';
/** Peu d'horodatages possibles : beaucoup d'égalités, et des horloges qui ne suivent pas la chaîne. */
const HEURES = ['2026-10-01T06:00:00.000Z', '2026-10-01T07:00:00.000Z', '2026-10-01T08:00:00.000Z', '2026-10-01T09:00:00.000Z'];

interface Journal {
  readonly mode: Mode;
  readonly lignes: readonly LigneJournal[];
}

/**
 * Un journal : par ferme, un « vrai » journal (origines, remplacements dont le parent est une
 * ligne antérieure de la même ferme ; origine vraie suivie), puis la vue qu'en a ce téléphone selon
 * le mode : lignes reçues du serveur (`origine_id`), maillons manquants, cycle ajouté, liens vers
 * l'autre ferme.
 */
function journal(g: ReturnType<typeof generateur>, n: number, modes: readonly Mode[]): Journal {
  const mode = modes[g.entier(modes.length)] ?? 'complet-local';
  const serveur = mode === 'complet-serveur' || mode === 'manquants-serveur';
  const manquants = mode === 'manquants-local' || mode === 'manquants-serveur';
  // Ids tirés au hasard (pas dans l'ordre de création : l'id départage les égalités d'horodatage).
  const pris = new Set<string>();
  const nouvelId = (): string => {
    for (;;) {
      const id = `0192f0c1-13ad-7000-8000-${(n * 4096 + g.entier(4096)).toString(16).padStart(12, '0')}`;
      if (!pris.has(id)) {
        pris.add(id);
        return id;
      }
    }
  };
  const lignes: LigneJournal[] = [];
  for (const ferme of [FERME_A, FERME_B]) {
    interface Vraie {
      readonly id: string;
      readonly horodatage: string;
      readonly sorte: Sorte;
      readonly remplace: string | null;
      readonly racine: string;
    }
    const vraies: Vraie[] = [];
    const origines = 1 + g.entier(3);
    for (let i = 0; i < origines; i++) {
      const id = nouvelId();
      vraies.push({ id, horodatage: HEURES[g.entier(HEURES.length)] ?? '', sorte: null, remplace: null, racine: id });
    }
    const remplacements = g.entier(7);
    for (let i = 0; i < remplacements; i++) {
      const parent = vraies[g.entier(vraies.length)];
      if (parent === undefined) continue;
      vraies.push({
        id: nouvelId(),
        horodatage: HEURES[g.entier(HEURES.length)] ?? '',
        sorte: g.chance(0.3) ? 'annulation' : 'correction',
        remplace: parent.id,
        racine: parent.racine,
      });
    }
    // Lignes reçues du serveur : un ensemble clos vers le haut (le parent d'une ligne reçue est reçu).
    const recues = new Set<string>();
    if (serveur) {
      for (const v of vraies) if ((v.remplace === null || recues.has(v.remplace)) && g.chance(0.6)) recues.add(v.id);
    }
    for (const v of vraies) {
      if (manquants && g.chance(0.3)) continue;
      lignes.push({
        id: v.id,
        ferme,
        horodatage: v.horodatage,
        sorte: v.sorte,
        remplace: v.remplace,
        origine: recues.has(v.id) ? v.racine : null,
      });
    }
    if (mode === 'cycle') {
      // A → B → (C →) A par remplace_evenement_id, parfois une queue qui y remonte.
      const cycle = [nouvelId(), nouvelId(), ...(g.chance(0.5) ? [nouvelId()] : [])];
      cycle.forEach((id, i) =>
        lignes.push({
          id,
          ferme,
          horodatage: HEURES[g.entier(HEURES.length)] ?? '',
          sorte: g.chance(0.2) ? 'annulation' : 'correction',
          remplace: cycle[(i + 1) % cycle.length] ?? null,
          origine: null,
        }),
      );
      if (g.chance(0.5)) {
        lignes.push({ id: nouvelId(), ferme, horodatage: HEURES[g.entier(HEURES.length)] ?? '', sorte: 'correction', remplace: cycle[0] ?? null, origine: null });
      }
    }
  }
  // Deux fermes : parfois une ligne de B vise une ligne de A (remplace_evenement_id, ou origine_id
  // reçue) ; parfois une ligne de A vise une ligne de B. Jamais une ligne d'une ferme ne compte
  // pour l'autre : pour A, une ligne de B est comme absente.
  if (g.chance(0.3)) {
    const deA = lignes.filter((l) => l.ferme === FERME_A);
    const cible = deA[g.entier(deA.length)];
    if (cible !== undefined) {
      const recue = g.chance(0.5);
      lignes.push({
        id: nouvelId(),
        ferme: FERME_B,
        horodatage: HEURES[g.entier(HEURES.length)] ?? '',
        sorte: g.chance(0.5) ? 'annulation' : 'correction',
        remplace: cible.id,
        origine: recue ? (cible.origine ?? cible.id) : null,
      });
    }
  }
  if (g.chance(0.3)) {
    const deB = lignes.filter((l) => l.ferme === FERME_B);
    const cible = deB[g.entier(deB.length)];
    if (cible !== undefined) {
      lignes.push({
        id: nouvelId(),
        ferme: FERME_A,
        horodatage: HEURES[g.entier(HEURES.length)] ?? '',
        sorte: g.chance(0.5) ? 'annulation' : 'correction',
        remplace: cible.id,
        origine: null,
      });
    }
  }
  return { mode, lignes };
}

// ── Base ─────────────────────────────────────────────────────────────────────────────────────

let base: BaseMemoire;

beforeAll(() => {
  base = creerBaseMemoire(SCHEMA_LOCAL);
});

afterAll(() => {
  base.fermer();
});

const lire = <T>(sql: string, parametres?: readonly unknown[]): Promise<T[]> => base.getAll<T>(sql, parametres);

function poser(lignes: readonly LigneJournal[]): void {
  base.recevoir('DELETE FROM evenement');
  for (const l of lignes) {
    base.recevoir(
      `INSERT INTO evenement (id, ferme_id, type, date, horodatage, source, serie_id, remplace_sorte, remplace_evenement_id, detail, origine_id)
       VALUES (?, ?, 'realise', '2026-10-01', ?, 'tap', '0192f0c1-13ad-7000-8000-0000000000ff', ?, ?, '{"etape":"plantation","quantiteReelle":null}', ?)`,
      [l.id, l.ferme, l.horodatage, l.sorte, l.remplace, l.origine],
    );
  }
}

interface Reponse {
  readonly annulee: boolean;
  readonly enVigueur: string | null;
}

/**
 * La réponse de `chaines` (CHAINES, comme la journée) pour chaque ligne de la ferme : la chaîne
 * d'une ligne est celle de son origine (`remplacement`) ; une origine est sa propre chaîne. Un
 * remplacement absent de `remplacement` (cycle) n'a rien en vigueur.
 */
async function selonChaines(ferme: string, ids: readonly string[], sortes: ReadonlyMap<string, Sorte>): Promise<Map<string, Reponse>> {
  const rempl = await lire<{ id: string; origine: string }>(`${CHAINES}SELECT id, origine FROM remplacement`, [ferme]);
  const ch = await lire<{ origine: string; annulations: number; cle: string | null; id: string | null }>(
    `${CHAINES}SELECT origine, annulations, cle, id FROM chaine`,
    [ferme],
  );
  const origineDe = new Map(rempl.map((r) => [r.id, r.origine]));
  const chaineDeOrigine = new Map(ch.map((c) => [c.origine, c]));
  const rep = new Map<string, Reponse>();
  for (const id of ids) {
    const origine = sortes.get(id) === null ? id : origineDe.get(id);
    if (origine === undefined) {
      rep.set(id, { annulee: true, enVigueur: null });
      continue;
    }
    const c = chaineDeOrigine.get(origine);
    if (c === undefined) rep.set(id, { annulee: false, enVigueur: origine });
    else if (c.annulations > 0) rep.set(id, { annulee: true, enVigueur: null });
    else rep.set(id, { annulee: false, enVigueur: c.cle === null ? origine : c.id });
  }
  return rep;
}

const NOMBRE_DE_JOURNAUX = 3000;
/** Les cycles coûtent une montée bornée (1 000 maillons) par ligne : moins de journaux. */
const NOMBRE_DE_CYCLES = 150;

/** Compare les trois règles sur un journal ; rend le nombre de lignes comparées. */
async function comparer(j: Journal, n: number): Promise<number> {
  poser(j.lignes);
  const contexte = (quoi: string) => `journal n° ${String(n)} (${j.mode}) : ${quoi}\n${JSON.stringify(j.lignes, null, 1)}`;
  let comparees = 0;
  for (const ferme of [FERME_A, FERME_B]) {
    const deLaFerme = j.lignes.filter((l) => l.ferme === ferme);
    const ids = deLaFerme.map((l) => l.id);
    const sortes = new Map(deLaFerme.map((l) => [l.id, l.sorte]));
    const attendu = await selonChaines(ferme, ids, sortes);
    const parChaineDe = new Map<string, Reponse>();
    for (const id of ids) {
      const r = await chaineDe(lire, ferme, id);
      parChaineDe.set(id, { annulee: r.annulee, enVigueur: r.enVigueur });
      expect(parChaineDe.get(id), contexte(`chaineDe(${id}) ≠ chaines`)).toEqual(attendu.get(id));
      comparees++;
    }
    // enVigueur (calculs.ts) : sur les lignes de la ferme seulement, sans origine_id ; comparée
    // quand elle a la même information que la base (voir l'en-tête).
    if (j.mode !== 'manquants-serveur') {
      const maillons: MaillonChaine[] = deLaFerme.map((l) => ({ id: l.id, horodatage: l.horodatage, remplaceSorte: l.sorte, remplaceEvenementId: l.remplace }));
      const selonEnVigueur = enVigueur(maillons)
        .map((e) => e.id)
        .sort();
      const selonChaineDe = [...new Set([...parChaineDe.values()].map((r) => r.enVigueur).filter((x): x is string => x !== null))].sort();
      expect(selonChaineDe, contexte('lignes en vigueur : chaineDe ≠ enVigueur')).toEqual(selonEnVigueur);
    }
  }
  return comparees;
}

// ── P1 ───────────────────────────────────────────────────────────────────────────────────────

describe('T13m, P1 : chaineDe, chaines et enVigueur, une seule règle (comparaison aléatoire)', () => {
  it(`${String(NOMBRE_DE_JOURNAUX)} journaux, graine fixe : même chaîne annulée, même ligne en vigueur`, async () => {
    const g = generateur(0x13a);
    const modes = MODES.filter((m) => m !== 'cycle');
    const vus = new Map<Mode, number>();
    let comparees = 0;
    for (let n = 0; n < NOMBRE_DE_JOURNAUX; n++) {
      const j = journal(g, n, modes);
      vus.set(j.mode, (vus.get(j.mode) ?? 0) + 1);
      comparees += await comparer(j, n);
    }
    // Le banc couvre bien chaque sorte de journal.
    for (const m of modes) expect(vus.get(m) ?? 0, `mode ${m} tiré`).toBeGreaterThan(NOMBRE_DE_JOURNAUX / 10);
    expect(comparees).toBeGreaterThan(NOMBRE_DE_JOURNAUX * 5);
  }, 60_000);

  it(`${String(NOMBRE_DE_CYCLES)} journaux avec un cycle, graine fixe : même réponse, rien en vigueur dans le cycle`, async () => {
    const g = generateur(0x13b);
    let comparees = 0;
    for (let n = 0; n < NOMBRE_DE_CYCLES; n++) comparees += await comparer(journal(g, n, ['cycle']), n);
    expect(comparees).toBeGreaterThan(NOMBRE_DE_CYCLES * 5);
  }, 60_000);

  it('une ligne d’une autre ferme : rien (jamais lue pour cette ferme)', async () => {
    poser([{ id: '0192f0c1-13ad-7000-8000-0000000000b1', ferme: FERME_B, horodatage: HEURES[0] ?? '', sorte: null, remplace: null, origine: null }]);
    expect(await chaineDe(lire, FERME_A, '0192f0c1-13ad-7000-8000-0000000000b1')).toEqual({ annulee: false, enVigueur: null });
  });

  it('cas écrits : correction gagnante (horloge décalée), annulation, cycle', async () => {
    const O = '0192f0c1-13ad-7000-8000-0000000000c0';
    const C1 = '0192f0c1-13ad-7000-8000-0000000000c1';
    const C2 = '0192f0c1-13ad-7000-8000-0000000000c2';
    // C2 corrige C1 mais porte un horodatage plus ancien : C1 (la plus récente) est en vigueur.
    poser([
      { id: O, ferme: FERME_A, horodatage: HEURES[0] ?? '', sorte: null, remplace: null, origine: null },
      { id: C1, ferme: FERME_A, horodatage: HEURES[3] ?? '', sorte: 'correction', remplace: O, origine: null },
      { id: C2, ferme: FERME_A, horodatage: HEURES[1] ?? '', sorte: 'correction', remplace: C1, origine: null },
    ]);
    for (const id of [O, C1, C2]) expect(await chaineDe(lire, FERME_A, id), id).toEqual({ annulee: false, enVigueur: C1 });
    // Annulation reçue de C2, C2 absent ici, origine_id = O : toute la chaîne de O est annulée.
    poser([
      { id: O, ferme: FERME_A, horodatage: HEURES[0] ?? '', sorte: null, remplace: null, origine: O },
      { id: C1, ferme: FERME_A, horodatage: HEURES[3] ?? '', sorte: 'correction', remplace: O, origine: O },
      { id: '0192f0c1-13ad-7000-8000-0000000000c3', ferme: FERME_A, horodatage: HEURES[2] ?? '', sorte: 'annulation', remplace: C2, origine: O },
    ]);
    for (const id of [O, C1]) expect(await chaineDe(lire, FERME_A, id), id).toEqual({ annulee: true, enVigueur: null });
    // Cycle C1 ↔ C2 : rien en vigueur.
    poser([
      { id: C1, ferme: FERME_A, horodatage: HEURES[3] ?? '', sorte: 'correction', remplace: C2, origine: null },
      { id: C2, ferme: FERME_A, horodatage: HEURES[1] ?? '', sorte: 'correction', remplace: C1, origine: null },
    ]);
    for (const id of [C1, C2]) expect(await chaineDe(lire, FERME_A, id), id).toEqual({ annulee: true, enVigueur: null });
    expect(enVigueur<MaillonChaine>([
      { id: C1, horodatage: HEURES[3] ?? '', remplaceSorte: 'correction', remplaceEvenementId: C2 },
      { id: C2, horodatage: HEURES[1] ?? '', remplaceSorte: 'correction', remplaceEvenementId: C1 },
    ]), 'enVigueur : rien en vigueur dans un cycle').toEqual([]);
  });
});

// ── P2 ───────────────────────────────────────────────────────────────────────────────────────

describe('T13m, P2 : ecritures.ts n’a plus sa propre copie de la règle', () => {
  const source = readFileSync(new URL('./ecritures.ts', import.meta.url), 'utf8');
  /** Le code seul : commentaires de bloc et de ligne ôtés (une URL dans une chaîne n'y figure pas). */
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

  it('importe chaineDe de @planif/sync/fait-unique', () => {
    expect(code).toMatch(/import\s*\{[^}]*\bchaineDe\b[^}]*\}\s*from\s*['"]@planif\/sync\/fait-unique['"]/);
  });

  it('ne refait pas la chaîne : ni origine_id, ni journal trié par horodatage, ni SQL_CHAINE_DE', () => {
    expect(code, 'origine_id : la montée vers l’origine est dans chaineDe').not.toMatch(/origine_id/);
    expect(code, 'la correction gagnante se choisit dans chaineDe').not.toMatch(/ORDER\s+BY\s+(\w+\.)?horodatage/i);
    expect(code).not.toMatch(/\bSQL_CHAINE_DE\b/);
  });
});
