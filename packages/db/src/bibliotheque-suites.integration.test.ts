/**
 * Tests d'acceptation T41b, PostgreSQL — la mise à jour de la bibliothèque par nouvelle migration
 * (docs/backlog/T41b-bibliotheque-suites.md) :
 *
 *   - base migrée jusqu'à 0032 (comme la production de T41), puis 0033 : l'itinéraire du melon est
 *     renommé « Melon, plein champ (chenille conseillée) », même identifiant ; aucune autre ligne
 *     de la bibliothèque n'est réécrite ; aucune ligne de ferme n'est touchée ; rejouable ;
 *   - la mécanique (sqlMiseAJourBibliotheque) sur une vraie base : une ligne retirée est marquée
 *     supprimée puis rétablie si elle revient ; une ligne de ferme qui porterait le même
 *     identifiant n'est jamais écrite.
 *
 * API : ./bibliotheque-suites.test.ts. Exécution comme bibliotheque.integration.test.ts :
 * DATABASE_URL (Postgres avec CREATEDB) ; sans elle, sautés en local.
 */
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as db from './index.ts';

const URL_BASE = process.env.DATABASE_URL ?? '';
const decrireAvecBase = URL_BASE === '' ? describe.skip : describe;

const MIGRATION_MELON = '0033_bibliotheque_melon_plein_champ';
const MELON_AVANT = 'Melon sous chenille, plant maison';
const MELON_APRES = 'Melon, plein champ (chenille conseillée)';
const ID_MELON = db.idBibliotheque('itineraire', `melon:${MELON_AVANT}`);

const DOSSIER = new URL('../migrations/', import.meta.url);

interface Journal {
  entries: { idx: number; tag: string }[];
}

function urlDe(base: string): string {
  const url = new URL(URL_BASE);
  url.pathname = `/${base}`;
  return url.toString();
}

/** Copie des migrations jusqu'à `idx` comprise, pour migrer en deux temps. */
function migrationsJusquA(idx: number): string {
  const dossier = mkdtempSync(join(tmpdir(), 't41b-migrations-'));
  mkdirSync(join(dossier, 'meta'));
  const journal = JSON.parse(readFileSync(new URL('meta/_journal.json', DOSSIER), 'utf8')) as Journal;
  const gardees = journal.entries.filter((e) => e.idx <= idx);
  for (const e of gardees) copyFileSync(new URL(`${e.tag}.sql`, DOSSIER), join(dossier, `${e.tag}.sql`));
  writeFileSync(join(dossier, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries: gardees }));
  return dossier;
}

/** Instructions SQL, comme drizzle les découpe. */
const instructions = (sql: string): string[] =>
  sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.replace(/^\s*--.*$/gm, '').trim() !== '');

type Ligne = Record<string, unknown>;
/** Une ligne et son xmin : un xmin inchangé prouve que la ligne n'a pas été réécrite. */
type Instantane = Map<string, { xmin: string; ligne: Ligne }>;

decrireAvecBase('T41b : mise à jour de la bibliothèque par nouvelle migration (PostgreSQL)', { timeout: 60_000 }, () => {
  let admin: pg.Client;
  let c: pg.Client;
  const base = `t41b_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  let dossierPartiel = '';
  // T42 : la base de T41b s'arrête à 0033 ; 0034 (travaux prévus) réécrit les 46 itinéraires et a
  // son propre test (bibliotheque-travaux.integration.test.ts).
  let dossierJusqua33 = '';
  async function migrerJusqua33(): Promise<void> {
    const client = new pg.Client({ connectionString: urlDe(base) });
    await client.connect();
    try {
      await migrate(drizzle(client), { migrationsFolder: dossierJusqua33 });
    } finally {
      await client.end();
    }
  }
  const ferme = randomUUID();
  const deLaFerme = { famille: randomUUID(), espece: randomUUID(), itineraire: randomUUID(), copie: randomUUID() };
  let fermeAvant: Instantane;
  let bibliothequeAvant: Instantane;

  async function lignes(ou: 'ferme_id IS NULL' | 'ferme_id = $1'): Promise<Instantane> {
    const r = await c.query<{ cle: string; xmin: string; ligne: Ligne }>(
      `SELECT 'famille:' || id AS cle, xmin::text, to_jsonb(t) AS ligne FROM famille t WHERE ${ou}
       UNION ALL SELECT 'espece:' || id, xmin::text, to_jsonb(t) FROM espece t WHERE ${ou}
       UNION ALL SELECT 'itineraire:' || id, xmin::text, to_jsonb(t) FROM itineraire t WHERE ${ou}`,
      ou === 'ferme_id = $1' ? [ferme] : [],
    );
    return new Map(r.rows.map((l) => [l.cle, { xmin: l.xmin, ligne: l.ligne }]));
  }
  const bibliotheque = (): Promise<Instantane> => lignes('ferme_id IS NULL');
  const fermeLignes = (): Promise<Instantane> => lignes('ferme_id = $1');

  async function itineraire(id: string): Promise<Ligne | undefined> {
    return (await c.query<{ l: Ligne }>(`SELECT to_jsonb(t) AS l FROM itineraire t WHERE id = $1`, [id])).rows[0]?.l;
  }

  async function jouer(sql: string): Promise<void> {
    for (const s of instructions(sql)) await c.query(s);
  }

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: URL_BASE });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${base}`);
    // 1. La base telle que T41 l'a laissée (production de Théophane) : migrée jusqu'à 0032.
    dossierPartiel = migrationsJusquA(32);
    dossierJusqua33 = migrationsJusquA(33);
    const avant = new pg.Client({ connectionString: urlDe(base) });
    await avant.connect();
    try {
      await migrate(drizzle(avant), { migrationsFolder: dossierPartiel });
    } finally {
      await avant.end();
    }
    c = new pg.Client({ connectionString: urlDe(base) });
    await c.connect();
    // 2. Une ferme a déjà ses lignes, dont un melon sous le même nom, et une copie sur l'espèce de la bibliothèque.
    await c.query(`INSERT INTO ferme (id, nom, fuseau_horaire) VALUES ($1, 'Ferme T41b', 'Europe/Paris')`, [ferme]);
    await c.query(
      `INSERT INTO famille (id, ferme_id, nom, delai_retour_minimal_ans, delai_retour_conseille_ans) VALUES ($1, $2, 'Cucurbitacées', 3, 4)`,
      [deLaFerme.famille, ferme],
    );
    await c.query(
      `INSERT INTO espece (id, ferme_id, famille_id, nom, categorie, perenne, unite_recolte) VALUES ($1, $2, $3, 'melon', 'legume', false, 'kg')`,
      [deLaFerme.espece, ferme, deLaFerme.famille],
    );
    const melon = await itineraire(ID_MELON);
    expect(melon?.nom, 'après 0032, le melon porte son nom de T41').toBe(MELON_AVANT);
    await c.query(
      `INSERT INTO itineraire (id, ferme_id, espece_id, nom, mode, parametres) VALUES ($1, $2, $3, $4, 'plant_maison', $5), ($6, $2, $7, $4, 'plant_maison', $5)`,
      [deLaFerme.itineraire, ferme, deLaFerme.espece, MELON_AVANT, JSON.stringify(melon?.parametres), deLaFerme.copie, db.idBibliotheque('espece', 'melon')],
    );
    fermeAvant = await fermeLignes();
    bibliothequeAvant = await bibliotheque();
    // 3. Le déploiement suivant : les migrations jusqu'à 0033 (T42 : 0034 a son propre test).
    await migrerJusqua33();
  }, 120_000);

  afterAll(async () => {
    await c.end();
    await admin.query(`DROP DATABASE IF EXISTS ${base} WITH (FORCE)`);
    await admin.end();
    rmSync(dossierPartiel, { recursive: true, force: true });
    rmSync(dossierJusqua33, { recursive: true, force: true });
  }, 60_000);

  describe('0032 puis 0033 (le melon)', () => {
    it('l’itinéraire du melon de la bibliothèque est renommé, même identifiant, mêmes paramètres, pas supprimé', async () => {
      const avant = bibliothequeAvant.get(`itineraire:${ID_MELON}`)?.ligne;
      const apres = await itineraire(ID_MELON);
      expect(apres?.nom).toBe(MELON_APRES);
      expect(apres?.ferme_id).toBeNull();
      expect(apres?.supprime_le).toBeNull();
      expect(apres?.parametres).toEqual(avant?.parametres);
      expect(new Date(String(apres?.modifie_le)).getTime()).toBeGreaterThanOrEqual(new Date(String(avant?.modifie_le)).getTime());
    });

    it('aucune autre ligne de la bibliothèque n’est réécrite', async () => {
      const apres = await bibliotheque();
      expect([...apres.keys()].sort()).toEqual([...bibliothequeAvant.keys()].sort());
      for (const [cle, l] of bibliothequeAvant) {
        if (cle === `itineraire:${ID_MELON}`) continue;
        expect(apres.get(cle), cle).toEqual(l);
      }
    });

    it('aucune ligne de ferme touchée, même celle qui porte l’ancien nom du melon', async () => {
      expect(await fermeLignes()).toEqual(fermeAvant);
    });

    it('la base suit exactement l’état 0033', async () => {
      const attendu = db.lireEtatsBibliotheque().find((e) => e.migration === MIGRATION_MELON)?.lignes;
      if (attendu === undefined) throw new Error('état 0033 absent');
      const apres = await bibliotheque();
      for (const i of attendu.itineraires) expect(apres.get(`itineraire:${i.id}`)?.ligne, i.nom).toMatchObject({ nom: i.nom, mode: i.mode, parametres: i.parametres, supprime_le: null });
    });

    it('rejouable : les migrations à nouveau, puis le SQL de 0033 deux fois, ne réécrivent rien', async () => {
      const bib = await bibliotheque();
      await migrerJusqua33();
      const sql = readFileSync(new URL(`${MIGRATION_MELON}.sql`, DOSSIER), 'utf8');
      await jouer(sql);
      await jouer(sql);
      expect(await bibliotheque()).toEqual(bib);
      expect(await fermeLignes()).toEqual(fermeAvant);
    });
  });

  describe('la mécanique sur une vraie base', () => {
    const etats = (): db.LignesBibliotheque => {
      const e = db.lireEtatsBibliotheque().find((x) => x.migration === MIGRATION_MELON);
      if (e === undefined) throw new Error('aucun état');
      return e.lignes;
    };

    it('ligne retirée : supprime_le posé, ligne gardée ; rejouer ne change rien ; remise : rétablie', async () => {
      const courant = etats();
      const sans = { ...courant, itineraires: courant.itineraires.filter((i) => i.id !== ID_MELON) };
      const retrait = db.sqlMiseAJourBibliotheque('9998_essai_retrait', courant, sans) ?? '';
      await jouer(retrait);
      const supprime = await itineraire(ID_MELON);
      expect(supprime?.supprime_le).not.toBeNull();
      expect(supprime?.nom).toBe(MELON_APRES);
      const marque = await bibliotheque();
      await jouer(retrait);
      expect(await bibliotheque(), 'rejouer le retrait ne déplace pas supprime_le').toEqual(marque);
      expect(await fermeLignes()).toEqual(fermeAvant);

      await jouer(db.sqlMiseAJourBibliotheque('9999_essai_remise', sans, courant) ?? '');
      const remis = await itineraire(ID_MELON);
      expect(remis?.supprime_le).toBeNull();
      expect(remis?.nom).toBe(MELON_APRES);
      expect(await fermeLignes()).toEqual(fermeAvant);
    });

    it('une ligne de ferme au même identifiant qu’une ligne de la bibliothèque : jamais écrite, ni modifiée ni marquée supprimée', async () => {
      const courant = etats();
      const melon = courant.itineraires.find((i) => i.id === ID_MELON);
      if (melon === undefined) throw new Error('melon absent');
      const intrus = { ...melon, id: deLaFerme.itineraire, nom: 'Écrasé par la bibliothèque' };
      const avec = { ...courant, itineraires: [...courant.itineraires, intrus] };
      await jouer(db.sqlMiseAJourBibliotheque('9997_essai_collision', courant, avec) ?? '');
      expect(await fermeLignes()).toEqual(fermeAvant);
      const familleIntruse = { id: deLaFerme.famille, ferme_id: null, nom: 'Écrasée', delai_retour_minimal_ans: 9, delai_retour_conseille_ans: 9 };
      const avecFamille = { ...avec, familles: [...avec.familles, familleIntruse] };
      await jouer(db.sqlMiseAJourBibliotheque('9996_essai_collision', avec, avecFamille) ?? '');
      await jouer(db.sqlMiseAJourBibliotheque('9995_essai_retrait_collision', avecFamille, courant) ?? '');
      expect(await fermeLignes()).toEqual(fermeAvant);
    });
  });
});
