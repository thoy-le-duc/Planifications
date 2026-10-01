/**
 * Tests d'acceptation T10h — vue evenements_en_vigueur rapide sur un gros journal, sans changer
 * la règle de T10g.
 *
 * Même exécution que vues.integration.test.ts : DATABASE_URL, sinon test sauté en local (l'échec
 * clair en CI sans base est porté par schema.integration.test.ts). Base jetable `t10h_vigueur_…`
 * supprimée à la fin.
 *
 * ── Contrat ──────────────────────────────────────────────────────────────────────────────────
 *
 * Règle « en vigueur » (T10g, décision 4), inchangée : la chaîne d'un événement est son origine
 * (sans remplace_evenement_id), ses corrections, les corrections de ses corrections et toutes
 * leurs annulations.
 *   - la chaîne contient une annulation (de l'origine ou de n'importe quelle correction) : rien
 *     n'est en vigueur ;
 *   - sinon UNE seule ligne : la correction la plus récente de TOUTE la chaîne (horodatage, puis
 *     id le plus grand), à défaut l'origine.
 *
 * Performance (constat de la relecture T10g : 4,2 s pour `WHERE id = …`, 1,4 s pour une ferme
 * vide, sur 200 000 événements) :
 *   - `SELECT … FROM evenements_en_vigueur WHERE ferme_id = $1` : moins de 50 ms en médiane de 5,
 *     pour une ferme d'environ 10 000 événements comme pour une ferme sans événement ;
 *   - `SELECT … FROM evenements_en_vigueur WHERE id = $1` : moins de 50 ms en médiane de 5.
 *
 * Le journal est écrit en SQL brut (INSERT … SELECT generate_series), sans passer par l'API :
 * si la solution ajoute une colonne (par exemple l'origine de la chaîne), c'est la BASE qui doit
 * la tenir à jour (déclencheur, défaut), pas seulement l'API. Une écriture faite après coup (une
 * nouvelle correction, une annulation) doit se voir aussitôt dans la vue.
 *
 * Jeu (environ 200 000 événements, 20 fermes, i = 1 … 100 000, ferme = i mod 20, q = i div 20 :
 * les motifs suivent q pour que chaque ferme ait tous les cas) :
 *   - origine O(i) à t(i) ;
 *   - i ≤ 50 000 : correction C1(i) de O(i), à t(i) + 1 h ;
 *   - i ≤ 50 000 et q mod 3 = 0 : seconde correction C2(i) de O(i) (chaîne ramifiée), à t(i) + 2 h
 *     si q pair, à t(i) + 1 h (même heure que C1 : l'id départage) si q mod 5 = 0, sinon à
 *     t(i) + 30 min (plus ancienne que C1) ;
 *   - i ≤ 50 000 et q pair : correction de correction C3(i) de C1(i), à t(i) + 90 min ;
 *   - i ≤ 50 000 et q mod 7 = 0 : annulation de C1(i) (branche annulée d'une chaîne
 *     éventuellement ramifiée : toute la chaîne est annulée) ;
 *   - i > 50 000 et q mod 9 = 0 : annulation de l'origine.
 * La référence est recalculée en TypeScript, indépendamment de la vue, sur toutes les lignes de
 * la ferme mesurée ; plus les cas chiffrés de T10g dans une petite ferme à part.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appliquerMigrations } from './index.ts';

const URL_BASE = process.env.DATABASE_URL ?? '';
const decrireAvecBase = URL_BASE === '' ? describe.skip : describe;

const BUDGET_MS = 50;
const REPETITIONS = 5;
const NB_FERMES = 20;
const NB_ORIGINES = 100_000;

/** Id déterministe d'une ligne du jeu (SQL : md5(texte)::uuid). */
const ID_SQL = (prefixe: string, expr: string) => `md5('${prefixe}' || (${expr}))::uuid`;

interface LigneJournal {
  readonly id: string;
  readonly sorte: 'correction' | 'annulation' | null;
  readonly parent: string | null;
  /** Horodatage en texte ISO à la microseconde (ordre lexical = ordre chronologique). */
  readonly horodatage: string;
}

/** Règle de T10g, écrite ici sans la vue : ids en vigueur parmi `lignes` (chaînes complètes). */
function referenceEnVigueur(lignes: readonly LigneJournal[]): string[] {
  const parId = new Map(lignes.map((l) => [l.id, l]));
  const origineDe = (l: LigneJournal): string => {
    let courant = l;
    for (let n = 0; n < 2_000 && courant.parent !== null; n++) {
      const parent = parId.get(courant.parent);
      if (parent === undefined) throw new Error(`parent ${courant.parent} hors de la ferme`);
      courant = parent;
    }
    return courant.id;
  };
  const annulees = new Set<string>();
  const retenue = new Map<string, LigneJournal>();
  const avant = (a: LigneJournal, b: LigneJournal) => a.horodatage > b.horodatage || (a.horodatage === b.horodatage && a.id > b.id);
  for (const l of lignes) {
    const o = origineDe(l);
    if (l.sorte === 'annulation') {
      annulees.add(o);
      continue;
    }
    const r = retenue.get(o);
    if (r === undefined || (l.sorte === 'correction' && (r.sorte !== 'correction' || avant(l, r)))) retenue.set(o, l);
  }
  return [...retenue].filter(([o]) => !annulees.has(o)).map(([, l]) => l.id).sort();
}

const mediane = (valeurs: readonly number[]): number => {
  const t = [...valeurs].sort((a, b) => a - b);
  return t[Math.floor(t.length / 2)] ?? Number.NaN;
};

decrireAvecBase('T10h : vue evenements_en_vigueur sur 200 000 événements', { timeout: 120_000 }, () => {
  const nom = `t10h_vigueur_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  let admin: pg.Client;
  let c: pg.Client;
  const auteur = randomUUID();
  /** Ferme des cas chiffrés de T10g. */
  const fermeCas = randomUUID();
  /** Ferme sans aucun événement. */
  const fermeVide = randomUUID();
  let fermeMesuree = '';
  let total = 0;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: URL_BASE });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${nom}`);
    const url = new URL(URL_BASE);
    url.pathname = `/${nom}`;
    await appliquerMigrations(url.toString());
    c = new pg.Client({ connectionString: url.toString() });
    await c.connect();

    await c.query(`INSERT INTO utilisateur (id, email) VALUES ($1, 'auteur@ferme.fr')`, [auteur]);
    await c.query(
      `INSERT INTO ferme (id, nom, fuseau_horaire)
       SELECT ${ID_SQL('ferme', 'k')}, 'Ferme ' || k, 'Europe/Paris' FROM generate_series(0, ${String(NB_FERMES - 1)}) k`,
    );
    await c.query(`INSERT INTO ferme (id, nom, fuseau_horaire) VALUES ($1, 'Cas T10g', 'Europe/Paris'), ($2, 'Vide', 'Europe/Paris')`, [fermeCas, fermeVide]);
    const r = await c.query<{ id: string }>(`SELECT ${ID_SQL('ferme', '0')}::text AS id`);
    fermeMesuree = r.rows[0]?.id ?? '';

    // Une ligne du jeu : `i` (entier), id, parent, sorte, décalage d'horodatage depuis t(i).
    const inserer = (id: string, parent: string | null, sorte: string | null, decalage: string, filtre: string, borne: string) =>
      c.query(
        `INSERT INTO evenement (id, ferme_id, type, date, horodatage, auteur_id, source, detail, remplace_sorte, remplace_evenement_id)
         SELECT ${id}, ${ID_SQL('ferme', `i % ${String(NB_FERMES)}`)}, 'recolte', DATE '2026-01-01' + (i % 270),
                TIMESTAMPTZ '2026-01-01T00:00:00Z' + i * interval '1 minute' + ${decalage},
                $1, 'tap', jsonb_build_object('quantite', 1 + i % 50, 'unite', 'kg', 'categorie', null),
                ${sorte === null ? 'NULL' : `'${sorte}'`}, ${parent ?? 'NULL'}
         FROM generate_series(1, ${borne}) i WHERE ${filtre}`,
        [auteur],
      );
    const O = ID_SQL('o', 'i');
    const C1 = ID_SQL('c1', 'i');
    await inserer(O, null, null, `interval '0'`, 'true', String(NB_ORIGINES));
    await inserer(C1, O, 'correction', `interval '1 hour'`, 'true', '50000');
    await inserer(
      ID_SQL('c2', 'i'),
      O,
      'correction',
      `CASE WHEN (i / 20) % 2 = 0 THEN interval '2 hours' WHEN (i / 20) % 5 = 0 THEN interval '1 hour' ELSE interval '30 minutes' END`,
      '(i / 20) % 3 = 0',
      '50000',
    );
    await inserer(ID_SQL('c3', 'i'), C1, 'correction', `interval '90 minutes'`, '(i / 20) % 2 = 0', '50000');
    await inserer(ID_SQL('a1', 'i'), C1, 'annulation', `interval '3 hours'`, '(i / 20) % 7 = 0', '50000');
    await inserer(ID_SQL('ao', 'i'), O, 'annulation', `interval '3 hours'`, 'i > 50000 AND (i / 20) % 9 = 0', String(NB_ORIGINES));
    await c.query('ANALYZE evenement');
    const n = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM evenement');
    total = n.rows[0]?.n ?? 0;
  }, 300_000);

  afterAll(async () => {
    await c.end();
    await admin.query(`DROP DATABASE IF EXISTS ${nom} WITH (FORCE)`);
    await admin.end();
  });

  async function lignesDe(ferme: string): Promise<LigneJournal[]> {
    const r = await c.query<LigneJournal>(
      `SELECT id::text AS id, remplace_sorte AS sorte, remplace_evenement_id::text AS parent,
              to_char(horodatage AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS horodatage
       FROM evenement WHERE ferme_id = $1`,
      [ferme],
    );
    return r.rows;
  }

  async function idsVue(ferme: string): Promise<string[]> {
    const r = await c.query<{ id: string }>(`SELECT id::text AS id FROM evenements_en_vigueur WHERE ferme_id = $1 ORDER BY id`, [ferme]);
    return r.rows.map((l) => l.id);
  }

  /** Médiane de 5 lectures (après une lecture de chauffe), en ms. */
  async function mesurer(sql: string, parametres: readonly unknown[]): Promise<{ mediane: number; serie: number[] }> {
    await c.query(sql, [...parametres]);
    const serie: number[] = [];
    for (let k = 0; k < REPETITIONS; k++) {
      const debut = performance.now();
      await c.query(sql, [...parametres]);
      serie.push(Math.round((performance.now() - debut) * 10) / 10);
    }
    return { mediane: mediane(serie), serie };
  }

  it('le jeu compte environ 200 000 événements sur 20 fermes, avec des chaînes ramifiées', async () => {
    expect(total).toBeGreaterThan(195_000);
    const r = await c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM (SELECT remplace_evenement_id FROM evenement WHERE remplace_sorte = 'correction'
         GROUP BY remplace_evenement_id HAVING count(*) > 1) t`,
    );
    expect(r.rows[0]?.n ?? 0).toBeGreaterThan(10_000);
  });

  it('lecture d’une ferme (~10 000 événements) : moins de 50 ms en médiane de 5', async () => {
    const m = await mesurer(`SELECT * FROM evenements_en_vigueur WHERE ferme_id = $1`, [fermeMesuree]);
    expect(m.mediane, `ferme : ${m.serie.join(' / ')} ms`).toBeLessThan(BUDGET_MS);
  });

  it('lecture d’une ferme sans événement : moins de 50 ms en médiane de 5', async () => {
    const m = await mesurer(`SELECT * FROM evenements_en_vigueur WHERE ferme_id = $1`, [fermeVide]);
    expect(m.mediane, `ferme vide : ${m.serie.join(' / ')} ms`).toBeLessThan(BUDGET_MS);
  });

  it('lecture `WHERE id = …` (origine, correction de correction, branche annulée) : moins de 50 ms en médiane de 5', async () => {
    const r = await c.query<{ o: string; c3: string; a: string }>(
      `SELECT ${ID_SQL('o', '40')}::text AS o, ${ID_SQL('c3', '40')}::text AS c3, ${ID_SQL('c1', '140')}::text AS a`,
    );
    const ids = r.rows[0];
    if (ids === undefined) throw new Error('ids');
    for (const id of [ids.o, ids.c3, ids.a]) {
      const m = await mesurer(`SELECT * FROM evenements_en_vigueur WHERE id = $1`, [id]);
      expect(m.mediane, `id ${id} : ${m.serie.join(' / ')} ms`).toBeLessThan(BUDGET_MS);
    }
  });

  it('résultat d’une ferme entière = la règle de T10g recalculée à part (correction la plus récente de toute la chaîne ; chaîne annulée : rien)', async () => {
    const attendu = referenceEnVigueur(await lignesDe(fermeMesuree));
    expect(attendu.length).toBeGreaterThan(3_000);
    expect(await idsVue(fermeMesuree)).toEqual(attendu);
    expect(await idsVue(fermeVide)).toEqual([]);
  });

  it('`WHERE id = …` donne la même réponse que la règle, ligne par ligne, sur un échantillon de chaînes', async () => {
    const lignes = await lignesDe(fermeMesuree);
    const attendu = new Set(referenceEnVigueur(lignes));
    // Un échantillon de la ferme mesurée : origines, corrections, ramifications, annulations.
    const echantillon = lignes.filter((_, k) => k % 37 === 0).slice(0, 60);
    expect(echantillon.length).toBeGreaterThan(50);
    for (const l of echantillon) {
      const r = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM evenements_en_vigueur WHERE id = $1`, [l.id]);
      expect(r.rows[0]?.n, `${l.sorte ?? 'origine'} ${l.id}`).toBe(attendu.has(l.id) ? 1 : 0);
    }
  });

  describe('cas chiffrés de T10g (ferme à part)', () => {
    const H = (hhmm: string) => `2026-10-01T${hhmm}:00.000Z`;

    async function ecrire(horodatage: string, remplace?: readonly ['correction' | 'annulation', string], id: string = randomUUID()): Promise<string> {
      await c.query(
        `INSERT INTO evenement (id, ferme_id, type, date, horodatage, auteur_id, source, detail, remplace_sorte, remplace_evenement_id)
         VALUES ($1, $2, 'recolte', '2026-10-01', $3, $4, 'tap', '{"quantite": 12, "unite": "kg", "categorie": null}', $5, $6)`,
        [id, fermeCas, horodatage, auteur, remplace?.[0] ?? null, remplace?.[1] ?? null],
      );
      return id;
    }

    async function enVigueurParmi(ids: readonly string[]): Promise<string[]> {
      const r = await c.query<{ id: string }>(`SELECT id::text AS id FROM evenements_en_vigueur WHERE id = ANY($1::uuid[]) ORDER BY id`, [ids]);
      return r.rows.map((l) => l.id);
    }

    async function enVigueurDeLaFerme(ids: readonly string[]): Promise<string[]> {
      return (await idsVue(fermeCas)).filter((id) => ids.includes(id));
    }

    it('chaîne ramifiée 12 → 15 (06:10), 12 → 20 (06:20), 15 → 30 (06:30) : une seule ligne, 30, par id comme par ferme', async () => {
      const o = await ecrire(H('03:00'));
      const c1 = await ecrire(H('06:10'), ['correction', o]);
      const c2 = await ecrire(H('06:20'), ['correction', o]);
      const c3 = await ecrire(H('06:30'), ['correction', c1]);
      expect(await enVigueurParmi([o, c1, c2, c3])).toEqual([c3]);
      expect(await enVigueurDeLaFerme([o, c1, c2, c3])).toEqual([c3]);
    });

    it('chaîne ramifiée dont une branche est annulée : rien en vigueur', async () => {
      const o = await ecrire(H('03:00'));
      const c1 = await ecrire(H('06:10'), ['correction', o]);
      const c2 = await ecrire(H('06:20'), ['correction', o]);
      const a = await ecrire(H('06:30'), ['annulation', c1]);
      expect(await enVigueurParmi([o, c1, c2, a])).toEqual([]);
      expect(await enVigueurDeLaFerme([o, c1, c2, a])).toEqual([]);
    });

    it('deux corrections arrivées dans l’ordre inverse de leur heure : la plus récente (07:00) reste', async () => {
      const o = await ecrire(H('03:00'));
      const recente = await ecrire(H('07:00'), ['correction', o]);
      const ancienne = await ecrire(H('04:00'), ['correction', o]);
      expect(await enVigueurParmi([o, recente, ancienne])).toEqual([recente]);
    });

    it('même heure : l’id le plus grand reste', async () => {
      const o = await ecrire(H('03:00'));
      const petit = '0192f0c1-1010-7000-8000-00000000a001';
      const grand = '0192f0c1-1010-7000-8000-00000000a002';
      await ecrire(H('07:00'), ['correction', o], grand);
      await ecrire(H('07:00'), ['correction', o], petit);
      expect(await enVigueurParmi([o, petit, grand])).toEqual([grand]);
    });

    it('origine annulée après une correction, puis correction de cette correction : rien en vigueur', async () => {
      const o = await ecrire(H('03:00'));
      const c1 = await ecrire(H('04:00'), ['correction', o]);
      const a = await ecrire(H('05:00'), ['annulation', o]);
      const c2 = await ecrire(H('06:00'), ['correction', c1]);
      expect(await enVigueurParmi([o, c1, a, c2])).toEqual([]);
    });

    it('origine seule : en vigueur', async () => {
      const o = await ecrire(H('03:00'));
      expect(await enVigueurParmi([o])).toEqual([o]);
    });
  });

  it('écriture après coup dans une chaîne du gros journal : la vue suit aussitôt (correction plus récente, puis annulation)', async () => {
    // i = 40 (ferme 0, q = 2) : O, C1, C3 (q pair) ; ni C2 (q mod 3 ≠ 0) ni annulation. C3 en vigueur.
    const r = await c.query<{ o: string; c1: string; c3: string }>(
      `SELECT ${ID_SQL('o', '40')}::text AS o, ${ID_SQL('c1', '40')}::text AS c1, ${ID_SQL('c3', '40')}::text AS c3`,
    );
    const ids = r.rows[0];
    if (ids === undefined) throw new Error('ids');
    expect(await c.query(`SELECT 1 FROM evenements_en_vigueur WHERE id = $1`, [ids.c3]).then((x) => x.rowCount)).toBe(1);

    const nouvelle = randomUUID();
    await c.query(
      `INSERT INTO evenement (id, ferme_id, type, date, horodatage, auteur_id, source, detail, remplace_sorte, remplace_evenement_id)
       SELECT $1, ferme_id, 'recolte', date, horodatage + interval '1 day', auteur_id, 'tap', '{"quantite": 99, "unite": "kg", "categorie": null}', 'correction', id
       FROM evenement WHERE id = $2`,
      [nouvelle, ids.c3],
    );
    const chaine = [ids.o, ids.c1, ids.c3, nouvelle];
    const parmi = async () =>
      (await c.query<{ id: string }>(`SELECT id::text AS id FROM evenements_en_vigueur WHERE id = ANY($1::uuid[])`, [chaine])).rows.map((l) => l.id);
    expect(await parmi()).toEqual([nouvelle]);
    expect((await idsVue(fermeMesuree)).filter((id) => chaine.includes(id))).toEqual([nouvelle]);

    const annulation = randomUUID();
    await c.query(
      `INSERT INTO evenement (id, ferme_id, type, date, horodatage, auteur_id, source, detail, remplace_sorte, remplace_evenement_id)
       SELECT $1, ferme_id, 'recolte', date, horodatage + interval '1 day', auteur_id, 'tap', detail, 'annulation', id
       FROM evenement WHERE id = $2`,
      [annulation, ids.c1],
    );
    expect(await parmi()).toEqual([]);
    expect((await idsVue(fermeMesuree)).filter((id) => chaine.includes(id))).toEqual([]);
  });
});
