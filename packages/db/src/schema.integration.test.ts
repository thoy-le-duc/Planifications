/**
 * Tests d'acceptation T08 — schéma PostgreSQL, contre un vrai Postgres (16 ou plus ; 17 en CI).
 *
 * ── Exécution ───────────────────────────────────────────────────────────────────────────────
 *
 * DATABASE_URL : URL d'un Postgres dont l'utilisateur peut créer et supprimer des bases
 *   (CREATEDB ; c'est le cas du service Postgres de GitHub Actions et du docker-compose). Exemple : postgres://postgres:postgres@localhost:5432/postgres
 *   Le test n'écrit rien dans cette base : il crée à côté des bases jetables `t08_…` et les
 *   supprime à la fin.
 *
 * Sans DATABASE_URL :
 *   - en CI (variable `CI` définie, différente de "false") : le test ÉCHOUE avec un message clair.
 *     Une CI mal configurée ne doit pas passer au vert en sautant la base ;
 *   - en local : les tests qui demandent une base sont SAUTÉS, avec un avertissement dans la
 *     console. `pnpm test` reste utilisable sans Postgres. Seul le test des fichiers de migration
 *     tourne toujours.
 *
 * Isolement : une base « modèle » reçoit toutes les migrations une fois (beforeAll) ; chaque test
 * part d'une copie neuve (`CREATE DATABASE … TEMPLATE modèle`), vide de données, supprimée après
 * le test. Le test de rejeu part, lui, d'une base entièrement vide.
 *
 * ── API attendue du paquet @planif/db (packages/db/src/index.ts) ────────────────────────────
 *
 * appliquerMigrations(url: string): Promise<void>
 *   Applique sur la base `url` toutes les migrations versionnées de `packages/db/migrations`
 *   (générées par drizzle-kit, plus les migrations SQL personnalisées : déclencheurs, vues,
 *   publication). Rejouable : sur une base déjà à jour, elle ne fait rien et ne lève pas.
 *   Elle ferme toutes ses connexions avant de rendre la main (sinon la base ne peut pas servir
 *   de modèle à CREATE DATABASE … TEMPLATE).
 *
 * Les 21 tables Drizzle, en exports nommés, clé = nom SQL en camelCase :
 *   ferme, zone, emplacement, secteurIrrigation, secteurEmplacement, famille, espece, variete,
 *   itineraire, saison, serie, plantation, campagne, occupation, assolement, evenement,
 *   articleStock, mouvementStock, produitPhyto, proposition, modification.
 *   Chaque clé TypeScript d'une colonne (camelCase) correspond à la colonne SQL de même nom en
 *   snake_case : `fermeId` ↔ `ferme_id`, `prevuMiseEnPlace` ↔ `prevu_mise_en_place`.
 *
 * Dépendances utilisées directement ici : drizzle-orm (getTableColumns), pg et @types/pg.
 *
 * ── Schéma attendu (schéma `public`) ────────────────────────────────────────────────────────
 *
 * Une table par entité de T01 (packages/core/src/domaine/entites.ts, type NomEntite), sauf
 * Utilisateur, qui vient avec les comptes (T09). Q10 : pas de tables Récolte, Intervention,
 * Traitement ; un seul `evenement` avec son détail en jsonb, et trois vues.
 *
 * Colonnes communes :
 *   - id uuid, clé primaire (UUID v7 généré par le client : pas d'exigence de défaut) ;
 *   - ferme_id uuid → ferme(id), NOT NULL ; nullable seulement dans la bibliothèque de référence
 *     (famille, espece, variete, itineraire, produit_phyto) ; absente de `ferme` ;
 *   - cree_le timestamptz NOT NULL avec défaut ;
 *   - modifie_le timestamptz NOT NULL avec défaut, supprime_le timestamptz nullable (suppression
 *     douce) ; facultatives sur `evenement` et `mouvement_stock`, qui sont en ajout seul.
 *
 * Colonnes que ce test écrit ou lit (les colonnes non citées doivent être nullables ou avoir un
 * défaut). Dates calendaires en `date`, instants en `timestamptz`, longueurs en `numeric` :
 *   ferme          nom, fuseau_horaire
 *   zone           nom, type_abri, zone_parente_id
 *   emplacement    zone_id, code, sorte, longueur_m, actif_du, nombre_places
 *   famille        nom, delai_retour_minimal_ans, delai_retour_conseille_ans
 *   espece         famille_id, nom, categorie, perenne, unite_recolte
 *   itineraire     espece_id, nom, mode, parametres (jsonb : ParametresItineraire de T01)
 *   saison         nom, debut, fin
 *   serie          saison_id, espece_id, itineraire_id, parametres (jsonb, instantané),
 *                  ancre_type, ancre_date, prevu_semis_pepiniere (nullable), prevu_mise_en_place,
 *                  prevu_debut_recolte, prevu_fin_recolte, longueur_m | nombre_plants (exactement
 *                  une des deux, > 0), statut
 *   plantation     espece_id, date_plantation, nombre_plants
 *   campagne       plantation_id, annee
 *   occupation     emplacement_id ; cible : serie_id | plantation_id | evenement_id (couverture),
 *                  exactement une ; place : longueur_m | nombre_places, exactement une, > 0 ;
 *                  prevu_du, prevu_au
 *   evenement      type, date, horodatage (timestamptz), auteur_id (uuid → utilisateur depuis
 *                  T09), source, serie_id | campagne_id (au plus une), note,
 *                  remplace_evenement_id, remplace_sorte, detail (jsonb : le Detail* de T01 tel
 *                  quel, clés camelCase)
 *   article_stock  espece_id, unite
 *   mouvement_stock article_stock_id, date, quantite, motif, recolte_id (→ evenement ;
 *                  obligatoire si et seulement si motif = 'recolte')
 *   produit_phyto  nom_commercial, numero_amm, substance_active, delai_avant_recolte_jours,
 *                  utilisable_en_bio
 *
 * Valeurs des unions : celles de T01 (ASCII, snake_case), en text + CHECK ou en enum Postgres.
 *
 * Vues (Q10), une ligne par événement du type :
 *   recoltes       id, ferme_id, date, serie_id, campagne_id, quantite, unite, categorie
 *   interventions  id, ferme_id, date, serie_id, campagne_id, categorie, type_intervention, outil
 *   traitements    id, ferme_id, date, serie_id, campagne_id, produit_phyto_id, nom_commercial,
 *                  numero_amm, dose_valeur, dose_unite, surface_traitee_m2, cible, operateur,
 *                  recolte_autorisee_le (date)
 *
 * Ajout seul : un déclencheur refuse UPDATE et DELETE sur `evenement` et `mouvement_stock`.
 * Historique : aucune clé étrangère en ON DELETE CASCADE ; supprimer physiquement une ligne
 * référencée par l'historique échoue (23503).
 * Index : occupation (emplacement_id + prevu_du/prevu_au) pour la vue 2D ; serie (dates
 * prévues) pour le semainier.
 * Publication `powersync` : liste explicite de tables (pas `FOR ALL TABLES`, qui exige un
 * superutilisateur), insert, update et delete. Elle couvre toutes les tables du schéma public
 * (pg_tables), sauf les exclusions explicites de TABLES_NON_PUBLIEES (suivi des migrations).
 *
 * Complété après relecture :
 * - détail jsonb contrôlé à l'insertion (23514) : ce que les vues convertissent doit être
 *   convertible, pour qu'un SELECT * sur une vue ne lève jamais ;
 * - un remplacement (correction, annulation) vise un événement de la même ferme et du même type ;
 * - vues : un événement corrigé plusieurs fois n'y apparaît qu'une fois, par sa correction la
 *   plus récente (horodatage le plus grand ; à égalité, id le plus grand) ;
 * - refus de l'ajout seul en 23001 (restrict_violation), TRUNCATE compris ;
 * - une campagne par an et par plantation (23505) ;
 * - aller-retour réel entité → ligne → base → ligne → entité pour Serie, Occupation,
 *   Emplacement, Evenement (conversions de @planif/db, requêtes Drizzle).
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import type {
  DateCalendaire,
  DetailIntervention,
  DetailRecolte,
  DetailTraitement,
  Emplacement,
  Evenement,
  Id,
  NomEntite,
  Occupation,
  ParametresItineraire,
  Serie,
} from '@planif/core';
import { eq, getTableColumns, is, Table } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as db from './index.ts';

const URL_BASE = process.env.DATABASE_URL ?? '';
const EN_CI = (process.env.CI ?? '') !== '' && process.env.CI !== 'false';

/** Les 21 tables du modèle v1, dans l'ordre de docs/modele-donnees.md. */
const TABLES = [
  'ferme',
  'zone',
  'emplacement',
  'secteur_irrigation',
  'secteur_emplacement',
  'famille',
  'espece',
  'variete',
  'itineraire',
  'saison',
  'serie',
  'plantation',
  'campagne',
  'occupation',
  'assolement',
  'evenement',
  'article_stock',
  'mouvement_stock',
  'produit_phyto',
  'proposition',
  'modification',
  // T28a : bâtiments de la ferme (serres, hangar, magasin).
  'batiment',
] as const;
type NomTable = (typeof TABLES)[number];

/** Bibliothèque de référence partagée : `ferme_id` nul autorisé. */
const BIBLIOTHEQUE: readonly NomTable[] = ['famille', 'espece', 'variete', 'itineraire', 'produit_phyto'];
/** Tables en ajout seul : ni modifie_le ni supprime_le exigés. */
const AJOUT_SEUL: readonly NomTable[] = ['evenement', 'mouvement_stock'];

const VUES = ['recoltes', 'interventions', 'traitements'] as const;

/** Tables du schéma public qui ne sont pas publiées vers PowerSync, chacune justifiée. */
const TABLES_NON_PUBLIEES: readonly string[] = [
  // Suivi des migrations Drizzle, s'il est un jour placé dans public (par défaut : schéma drizzle).
  '__drizzle_migrations',
  // T09 : données d'authentification (codes à usage unique, jetons de renouvellement), jamais
  // répliquées vers les téléphones. Voir comptes.integration.test.ts.
  'code_connexion',
  'jeton_renouvellement',
];

function camel(nom: string): string {
  return nom.replace(/_([a-z0-9])/g, (_m, lettre: string) => lettre.toUpperCase());
}

function snake(cle: string): string {
  return cle.replace(/[A-Z]/g, (lettre) => `_${lettre.toLowerCase()}`);
}

/** Même serveur, autre base. */
function urlDe(base: string): string {
  const url = new URL(URL_BASE);
  url.pathname = `/${base}`;
  return url.toString();
}

function nomDeBase(): string {
  return `t08_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}

/** Code SQLSTATE de l'erreur levée par la requête ; échoue si la requête passe. */
async function codeErreur(requete: Promise<unknown>): Promise<string> {
  try {
    await requete;
  } catch (e: unknown) {
    if (typeof e === 'object' && e !== null && 'code' in e && typeof e.code === 'string') {
      return e.code;
    }
    throw e;
  }
  throw new Error('la requête aurait dû être refusée par la base');
}

const VIOLATION_CHECK = '23514';
const VIOLATION_CLE_ETRANGERE = '23503';
const VIOLATION_NOT_NULL = '23502';
const VIOLATION_UNICITE = '23505';
/** restrict_violation : refus de l'ajout seul par déclencheur. */
const VIOLATION_RESTRICT = '23001';
/** Valeur hors d'un enum Postgres : accepté à la place d'un CHECK pour les unions. */
const VALEUR_ENUM_INVALIDE = '22P02';

// ---------------------------------------------------------------------------------------------
// Toujours exécuté : les migrations sont versionnées dans le dépôt
// ---------------------------------------------------------------------------------------------

describe('T08 : migrations versionnées (drizzle-kit)', () => {
  const dossier = new URL('../migrations/', import.meta.url);

  it('packages/db/migrations contient des migrations SQL et le journal drizzle-kit', () => {
    expect(existsSync(dossier)).toBe(true);
    const sql = readdirSync(dossier).filter((f) => f.endsWith('.sql'));
    expect(sql.length).toBeGreaterThan(0);
    expect(existsSync(new URL('meta/_journal.json', dossier))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Sans base : échec clair en CI, saut signalé en local
// ---------------------------------------------------------------------------------------------

if (URL_BASE === '') {
  if (EN_CI) {
    describe('T08 : base PostgreSQL', () => {
      it('DATABASE_URL est définie en CI', () => {
        throw new Error(
          'DATABASE_URL absente en CI : les tests d’intégration de T08 exigent le service Postgres ' +
            '(voir .github/workflows/ci.yml).',
        );
      });
    });
  } else {
    console.warn(
      '[T08] DATABASE_URL absente : tests d’intégration PostgreSQL sautés. ' +
        'Exemple : DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm test',
    );
  }
}

const decrireAvecBase = URL_BASE === '' ? describe.skip : describe;

// ---------------------------------------------------------------------------------------------
// Jeu de données minimal
// ---------------------------------------------------------------------------------------------

interface Base {
  readonly ferme: string;
  readonly zone: string;
  readonly planche: string;
  readonly famille: string;
  readonly laitue: string;
  readonly kiwi: string;
  readonly itineraire: string;
  readonly saison: string;
  readonly serie: string;
  readonly plantation: string;
  readonly campagne: string;
  readonly produitPhyto: string;
  readonly article: string;
  readonly auteur: string;
}

const PARAMETRES_BATAVIA = {
  mode: 'plant_maison',
  densite: { facon: 'ecartement', rangsParPlanche: 3, ecartementSurRangCm: 30 },
  dureePepiniereJours: 28,
  grainesParMotte: 1,
  plantsParMotte: 1,
  pertePepiniere: 10,
  alveolesParPlaque: 77,
  periodeUsage: null,
  typeAbri: 'tunnel',
  dureeAvantRecolteJours: 50,
  fenetreRecolteJours: 14,
  margeSecurite: 10,
  rendementAttendu: null,
  perenne: null,
} as const satisfies ParametresItineraire;

async function peupler(c: pg.Client): Promise<Base> {
  const b: Base = {
    ferme: randomUUID(),
    zone: randomUUID(),
    planche: randomUUID(),
    famille: randomUUID(),
    laitue: randomUUID(),
    kiwi: randomUUID(),
    itineraire: randomUUID(),
    saison: randomUUID(),
    serie: randomUUID(),
    plantation: randomUUID(),
    campagne: randomUUID(),
    produitPhyto: randomUUID(),
    article: randomUUID(),
    auteur: randomUUID(),
  };
  const familleKiwi = randomUUID();
  await c.query(`INSERT INTO ferme (id, nom, fuseau_horaire) VALUES ($1, 'Ferme de test', 'Europe/Paris')`, [b.ferme]);
  // T09 : auteur_id référence utilisateur(id).
  await c.query(`INSERT INTO utilisateur (id, email) VALUES ($1, $2)`, [b.auteur, `auteur-${b.auteur}@ferme.fr`]);
  await c.query(`INSERT INTO zone (id, ferme_id, nom, type_abri) VALUES ($1, $2, 'Tunnel 2', 'tunnel')`, [
    b.zone,
    b.ferme,
  ]);
  await c.query(
    `INSERT INTO emplacement (id, ferme_id, zone_id, code, sorte, longueur_m, actif_du)
     VALUES ($1, $2, $3, 'T2-P03', 'planche', 30, '2026-01-01')`,
    [b.planche, b.ferme, b.zone],
  );
  await c.query(
    `INSERT INTO famille (id, ferme_id, nom, delai_retour_minimal_ans, delai_retour_conseille_ans)
     VALUES ($1, $3, 'Astéracées', 2, 3), ($2, $3, 'Actinidiacées', 0, 0)`,
    [b.famille, familleKiwi, b.ferme],
  );
  await c.query(
    `INSERT INTO espece (id, ferme_id, famille_id, nom, categorie, perenne, unite_recolte)
     VALUES ($1, $3, $4, 'Laitue', 'legume', false, 'piece'),
            ($2, $3, $5, 'Kiwi', 'fruit', true, 'kg')`,
    [b.laitue, b.kiwi, b.ferme, b.famille, familleKiwi],
  );
  await c.query(
    `INSERT INTO itineraire (id, ferme_id, espece_id, nom, mode, parametres)
     VALUES ($1, $2, $3, 'Batavia de printemps', 'plant_maison', $4)`,
    [b.itineraire, b.ferme, b.laitue, JSON.stringify(PARAMETRES_BATAVIA)],
  );
  await c.query(`INSERT INTO saison (id, ferme_id, nom, debut, fin) VALUES ($1, $2, '2027', '2027-01-01', '2027-12-31')`, [
    b.saison,
    b.ferme,
  ]);
  await c.query(
    `INSERT INTO serie (id, ferme_id, saison_id, espece_id, itineraire_id, parametres,
                        ancre_type, ancre_date, prevu_semis_pepiniere, prevu_mise_en_place,
                        prevu_debut_recolte, prevu_fin_recolte, longueur_m, statut)
     VALUES ($1, $2, $3, $4, $5, $6, 'plantation', '2027-04-05', '2027-03-08', '2027-04-05',
             '2027-05-25', '2027-06-08', 30, 'prevue')`,
    [b.serie, b.ferme, b.saison, b.laitue, b.itineraire, JSON.stringify(PARAMETRES_BATAVIA)],
  );
  await c.query(
    `INSERT INTO plantation (id, ferme_id, espece_id, date_plantation, nombre_plants)
     VALUES ($1, $2, $3, '2019-03-15', 120)`,
    [b.plantation, b.ferme, b.kiwi],
  );
  await c.query(`INSERT INTO campagne (id, ferme_id, plantation_id, annee) VALUES ($1, $2, $3, 2027)`, [
    b.campagne,
    b.ferme,
    b.plantation,
  ]);
  await c.query(
    `INSERT INTO produit_phyto (id, ferme_id, nom_commercial, numero_amm, substance_active,
                                delai_avant_recolte_jours, utilisable_en_bio)
     VALUES ($1, $2, 'Bouillie bordelaise', '2010427', 'cuivre', 21, true)`,
    [b.produitPhyto, b.ferme],
  );
  await c.query(`INSERT INTO article_stock (id, ferme_id, espece_id, unite) VALUES ($1, $2, $3, 'piece')`, [
    b.article,
    b.ferme,
    b.laitue,
  ]);
  return b;
}

interface OptionsEvenement {
  readonly type: string;
  readonly detail: object;
  readonly serieId?: string | null;
  readonly campagneId?: string | null;
  readonly date?: string;
  /** Instant de la saisie, en SQL (timestamptz) ; par défaut now(). */
  readonly horodatage?: string;
  /** Id imposé (pour tester le départage par id). */
  readonly id?: string;
  readonly remplace?: { readonly sorte: 'correction' | 'annulation'; readonly evenementId: string };
}

async function insererEvenement(c: pg.Client, b: Base, o: OptionsEvenement): Promise<string> {
  const id = o.id ?? randomUUID();
  await c.query(
    `INSERT INTO evenement (id, ferme_id, type, date, horodatage, auteur_id, source, serie_id,
                           campagne_id, remplace_sorte, remplace_evenement_id, detail)
     VALUES ($1, $2, $3, $4, coalesce($11::timestamptz, now()), $5, 'tap', $6, $7, $8, $9, $10)`,
    [
      id,
      b.ferme,
      o.type,
      o.date ?? '2027-05-26',
      b.auteur,
      o.serieId === undefined ? b.serie : o.serieId,
      o.campagneId ?? null,
      o.remplace?.sorte ?? null,
      o.remplace?.evenementId ?? null,
      JSON.stringify(o.detail),
      o.horodatage ?? null,
    ],
  );
  return id;
}

const RECOLTE: DetailRecolte = { quantite: 42, unite: 'piece', categorie: 'I' };

interface OptionsOccupation {
  readonly serieId?: string | null;
  readonly plantationId?: string | null;
  readonly evenementId?: string | null;
  readonly emplacementId?: string;
  readonly longueurM?: number | null;
  readonly nombrePlaces?: number | null;
}

async function insererOccupation(c: pg.Client, b: Base, o: OptionsOccupation = {}): Promise<string> {
  const id = randomUUID();
  await c.query(
    `INSERT INTO occupation (id, ferme_id, emplacement_id, serie_id, plantation_id, evenement_id,
                            longueur_m, nombre_places, prevu_du, prevu_au)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '2027-04-05', '2027-06-09')`,
    [
      id,
      b.ferme,
      o.emplacementId ?? b.planche,
      o.serieId === undefined ? b.serie : o.serieId,
      o.plantationId ?? null,
      o.evenementId ?? null,
      o.longueurM === undefined ? 15 : o.longueurM,
      o.nombrePlaces ?? null,
    ],
  );
  return id;
}

async function compter(c: pg.Client, sql: string, params: readonly unknown[]): Promise<number> {
  const r = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM (${sql}) AS t`, [...params]);
  return Number(r.rows[0]?.n);
}

// ---------------------------------------------------------------------------------------------
// Tests avec base
// ---------------------------------------------------------------------------------------------

decrireAvecBase('T08 : schéma PostgreSQL', { timeout: 30_000 }, () => {
  let admin: pg.Client;
  let modele = '';
  let base = '';
  let c: pg.Client;
  const basesJetables: string[] = [];

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: URL_BASE });
    await admin.connect();
    modele = nomDeBase();
    await admin.query(`CREATE DATABASE ${modele}`);
    await db.appliquerMigrations(urlDe(modele));
  }, 120_000);

  beforeEach(async () => {
    base = nomDeBase();
    await admin.query(`CREATE DATABASE ${base} TEMPLATE ${modele}`);
    c = new pg.Client({ connectionString: urlDe(base) });
    await c.connect();
  });

  afterEach(async () => {
    await c.end();
    await admin.query(`DROP DATABASE IF EXISTS ${base} WITH (FORCE)`);
  });

  afterAll(async () => {
    for (const nom of [modele, ...basesJetables]) {
      if (nom !== '') {
        await admin.query(`DROP DATABASE IF EXISTS ${nom} WITH (FORCE)`);
      }
    }
    await admin.end();
  }, 60_000);

  async function tablesPresentes(client: pg.Client, type: 'BASE TABLE' | 'VIEW'): Promise<string[]> {
    const r = await client.query<{ nom: string }>(
      `SELECT table_name::text AS nom FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = $1 ORDER BY 1`,
      [type],
    );
    return r.rows.map((l) => l.nom);
  }

  // --- Migrations -----------------------------------------------------------------------------

  describe('migrations', () => {
    it('s’appliquent sur une base vide, puis une seconde fois sans erreur ni effet', async () => {
      const vide = nomDeBase();
      basesJetables.push(vide);
      await admin.query(`CREATE DATABASE ${vide}`);

      await db.appliquerMigrations(urlDe(vide));
      await db.appliquerMigrations(urlDe(vide));

      const client = new pg.Client({ connectionString: urlDe(vide) });
      await client.connect();
      try {
        const tables = await tablesPresentes(client, 'BASE TABLE');
        expect(tables).toEqual(expect.arrayContaining([...TABLES]));
        expect(await tablesPresentes(client, 'VIEW')).toEqual(expect.arrayContaining([...VUES]));
      } finally {
        await client.end();
      }
      await admin.query(`DROP DATABASE ${vide} WITH (FORCE)`);
    });
  });

  // --- Tables et colonnes ---------------------------------------------------------------------

  describe('tables et colonnes', () => {
    it('les 21 tables du modèle existent, en français, et les trois vues de Q10', async () => {
      const tables = await tablesPresentes(c, 'BASE TABLE');
      for (const t of TABLES) {
        expect(tables, `table ${t}`).toContain(t);
      }
      // Q10 : le détail est dans l'événement, pas dans des tables séparées.
      for (const t of ['recolte', 'intervention', 'traitement']) {
        expect(tables, `pas de table ${t} (Q10)`).not.toContain(t);
      }
      const vues = await tablesPresentes(c, 'VIEW');
      for (const v of VUES) {
        expect(vues, `vue ${v}`).toContain(v);
      }
    });

    it('toutes les colonnes sont en snake_case et correspondent aux clés camelCase des tables Drizzle', async () => {
      const r = await c.query<{ table_name: string; column_name: string }>(
        `SELECT table_name::text, column_name::text FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = ANY($1)`,
        [[...TABLES]],
      );
      for (const { table_name, column_name } of r.rows) {
        expect(column_name, `${table_name}.${column_name}`).toMatch(/^[a-z][a-z0-9_]*$/);
      }
      const exports = db as Record<string, unknown>;
      for (const t of TABLES) {
        const tableDrizzle = exports[camel(t)];
        if (!is(tableDrizzle, Table)) {
          throw new Error(`@planif/db doit exporter la table Drizzle ${camel(t)}`);
        }
        const cles = Object.keys(getTableColumns(tableDrizzle));
        const attendues = cles.map(snake).sort();
        const reelles = r.rows
          .filter((l) => l.table_name === t)
          .map((l) => l.column_name)
          .sort();
        expect(reelles, `colonnes de ${t}`).toEqual(attendues);
      }
    });

    it('colonnes communes : id uuid clé primaire, ferme_id, cree_le, modifie_le, supprime_le', async () => {
      const r = await c.query<{
        table_name: string;
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_default: string | null;
      }>(
        `SELECT table_name::text, column_name::text, data_type::text, is_nullable::text, column_default::text
         FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY($1)`,
        [[...TABLES]],
      );
      const colonne = (t: string, col: string) => r.rows.find((l) => l.table_name === t && l.column_name === col);

      const pk = await c.query<{ nom: string; colonnes: string }>(
        `SELECT cl.relname::text AS nom, string_agg(a.attname::text, ',' ORDER BY a.attname) AS colonnes
         FROM pg_constraint k
         JOIN pg_class cl ON cl.oid = k.conrelid
         JOIN pg_namespace n ON n.oid = cl.relnamespace
         JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
         WHERE k.contype = 'p' AND n.nspname = 'public'
         GROUP BY cl.relname`,
      );
      const fk = await clesEtrangeres();

      for (const t of TABLES) {
        expect(colonne(t, 'id')?.data_type, `${t}.id`).toBe('uuid');
        expect(pk.rows.find((l) => l.nom === t)?.colonnes, `clé primaire de ${t}`).toBe('id');

        const cree = colonne(t, 'cree_le');
        expect(cree?.data_type, `${t}.cree_le`).toBe('timestamp with time zone');
        expect(cree?.is_nullable, `${t}.cree_le`).toBe('NO');
        expect(cree?.column_default, `${t}.cree_le a un défaut`).not.toBeNull();

        if (t === 'ferme') {
          expect(colonne(t, 'ferme_id'), 'ferme.ferme_id').toBeUndefined();
        } else {
          const fermeId = colonne(t, 'ferme_id');
          expect(fermeId?.data_type, `${t}.ferme_id`).toBe('uuid');
          if (!BIBLIOTHEQUE.includes(t)) {
            expect(fermeId?.is_nullable, `${t}.ferme_id NOT NULL`).toBe('NO');
          }
          expect(
            fk.some((l) => l.source === t && l.colonne === 'ferme_id' && l.cible === 'ferme'),
            `${t}.ferme_id → ferme`,
          ).toBe(true);
        }

        if (!AJOUT_SEUL.includes(t)) {
          const modifie = colonne(t, 'modifie_le');
          expect(modifie?.data_type, `${t}.modifie_le`).toBe('timestamp with time zone');
          expect(modifie?.is_nullable, `${t}.modifie_le`).toBe('NO');
          expect(modifie?.column_default, `${t}.modifie_le a un défaut`).not.toBeNull();
          const supprime = colonne(t, 'supprime_le');
          expect(supprime?.data_type, `${t}.supprime_le`).toBe('timestamp with time zone');
          expect(supprime?.is_nullable, `${t}.supprime_le nullable`).toBe('YES');
        }
      }
    });

    it('dates calendaires en date, longueurs en numeric', async () => {
      const r = await c.query<{ t: string; col: string; type: string }>(
        `SELECT table_name::text AS t, column_name::text AS col, data_type::text AS type
         FROM information_schema.columns WHERE table_schema = 'public'`,
      );
      const type = (t: string, col: string) => r.rows.find((l) => l.t === t && l.col === col)?.type;
      for (const [t, col] of [
        ['emplacement', 'actif_du'],
        ['saison', 'debut'],
        ['serie', 'ancre_date'],
        ['serie', 'prevu_mise_en_place'],
        ['occupation', 'prevu_du'],
        ['occupation', 'prevu_au'],
        ['evenement', 'date'],
        ['mouvement_stock', 'date'],
        ['recoltes', 'date'],
        ['traitements', 'recolte_autorisee_le'],
      ] as const) {
        expect(type(t, col), `${t}.${col}`).toBe('date');
      }
      expect(type('evenement', 'horodatage')).toBe('timestamp with time zone');
      expect(type('evenement', 'detail')).toBe('jsonb');
      expect(type('serie', 'parametres')).toBe('jsonb');
      for (const [t, col] of [
        ['emplacement', 'longueur_m'],
        ['occupation', 'longueur_m'],
        ['serie', 'longueur_m'],
      ] as const) {
        expect(type(t, col), `${t}.${col}`).toBe('numeric');
      }
    });
  });

  // --- Contraintes ----------------------------------------------------------------------------

  interface CleEtrangere {
    source: string;
    colonne: string;
    cible: string;
    /** confdeltype : a = no action, r = restrict, c = cascade, n = set null, d = set default. */
    suppression: string;
  }

  async function clesEtrangeres(): Promise<CleEtrangere[]> {
    const r = await c.query<CleEtrangere>(
      `SELECT cl.relname::text AS source, a.attname::text AS colonne, cf.relname::text AS cible,
              k.confdeltype::text AS suppression
       FROM pg_constraint k
       JOIN pg_class cl ON cl.oid = k.conrelid
       JOIN pg_class cf ON cf.oid = k.confrelid
       JOIN pg_namespace n ON n.oid = cl.relnamespace
       JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
       WHERE k.contype = 'f' AND n.nspname = 'public'`,
    );
    return r.rows;
  }

  describe('contraintes', () => {
    it('clés étrangères du modèle', async () => {
      const fk = await clesEtrangeres();
      const attendues: readonly (readonly [string, string, NomTable])[] = [
        ['zone', 'zone_parente_id', 'zone'],
        ['emplacement', 'zone_id', 'zone'],
        ['secteur_emplacement', 'secteur_irrigation_id', 'secteur_irrigation'],
        ['secteur_emplacement', 'emplacement_id', 'emplacement'],
        ['espece', 'famille_id', 'famille'],
        ['variete', 'espece_id', 'espece'],
        ['itineraire', 'espece_id', 'espece'],
        ['itineraire', 'variete_id', 'variete'],
        ['serie', 'saison_id', 'saison'],
        ['serie', 'espece_id', 'espece'],
        ['serie', 'variete_id', 'variete'],
        ['serie', 'itineraire_id', 'itineraire'],
        ['plantation', 'espece_id', 'espece'],
        ['plantation', 'variete_id', 'variete'],
        ['campagne', 'plantation_id', 'plantation'],
        ['occupation', 'emplacement_id', 'emplacement'],
        ['occupation', 'serie_id', 'serie'],
        ['occupation', 'plantation_id', 'plantation'],
        ['occupation', 'evenement_id', 'evenement'],
        ['assolement', 'saison_id', 'saison'],
        ['assolement', 'zone_id', 'zone'],
        ['assolement', 'emplacement_id', 'emplacement'],
        ['assolement', 'famille_id', 'famille'],
        ['assolement', 'espece_id', 'espece'],
        ['evenement', 'serie_id', 'serie'],
        ['evenement', 'campagne_id', 'campagne'],
        ['evenement', 'remplace_evenement_id', 'evenement'],
        ['article_stock', 'espece_id', 'espece'],
        ['article_stock', 'variete_id', 'variete'],
        ['mouvement_stock', 'article_stock_id', 'article_stock'],
        ['mouvement_stock', 'recolte_id', 'evenement'],
        ['modification', 'proposition_id', 'proposition'],
      ];
      for (const [source, colonne, cible] of attendues) {
        expect(
          fk.some((l) => l.source === source && l.colonne === colonne && l.cible === cible),
          `${source}.${colonne} → ${cible}`,
        ).toBe(true);
      }
    });

    it('une clé étrangère vers une ligne inexistante est refusée', async () => {
      const b = await peupler(c);
      expect(await codeErreur(insererOccupation(c, b, { emplacementId: randomUUID() }))).toBe(VIOLATION_CLE_ETRANGERE);
      expect(await codeErreur(insererOccupation(c, b, { serieId: randomUUID() }))).toBe(VIOLATION_CLE_ETRANGERE);
      expect(
        await codeErreur(
          c.query(`INSERT INTO zone (id, ferme_id, nom, type_abri) VALUES ($1, $2, 'Orpheline', 'tunnel')`, [
            randomUUID(),
            randomUUID(),
          ]),
        ),
      ).toBe(VIOLATION_CLE_ETRANGERE);
    });

    it('une ligne de ferme sans ferme_id est refusée', async () => {
      expect(
        await codeErreur(
          c.query(`INSERT INTO zone (id, ferme_id, nom, type_abri) VALUES ($1, NULL, 'Sans ferme', 'tunnel')`, [
            randomUUID(),
          ]),
        ),
      ).toBe(VIOLATION_NOT_NULL);
      // La bibliothèque de référence, elle, accepte ferme_id nul.
      await c.query(
        `INSERT INTO famille (id, ferme_id, nom, delai_retour_minimal_ans, delai_retour_conseille_ans)
         VALUES ($1, NULL, 'Brassicacées', 4, 6)`,
        [randomUUID()],
      );
    });

    it('occupation : une série, une plantation ou une couverture sont acceptées seules', async () => {
      const b = await peupler(c);
      await insererOccupation(c, b, { serieId: b.serie });
      await insererOccupation(c, b, { serieId: null, plantationId: b.plantation });
      const bache = await insererEvenement(c, b, {
        type: 'intervention',
        serieId: null,
        detail: {
          categorie: 'couverture',
          type: 'bâchage ou occultation',
          outil: null,
          dureeOccupationJours: 42,
        } satisfies DetailIntervention,
      });
      await insererOccupation(c, b, { serieId: null, evenementId: bache });
      expect(await compter(c, 'SELECT id FROM occupation', [])).toBe(3);
    });

    it('occupation : exactement une cible (ni zéro, ni deux)', async () => {
      const b = await peupler(c);
      const bache = await insererEvenement(c, b, {
        type: 'intervention',
        serieId: null,
        detail: { categorie: 'couverture', type: 'paillage', outil: null, dureeOccupationJours: null },
      });
      expect(await codeErreur(insererOccupation(c, b, { serieId: null }))).toBe(VIOLATION_CHECK);
      expect(await codeErreur(insererOccupation(c, b, { serieId: b.serie, plantationId: b.plantation }))).toBe(
        VIOLATION_CHECK,
      );
      expect(await codeErreur(insererOccupation(c, b, { serieId: b.serie, evenementId: bache }))).toBe(VIOLATION_CHECK);
      expect(
        await codeErreur(insererOccupation(c, b, { serieId: null, plantationId: b.plantation, evenementId: bache })),
      ).toBe(VIOLATION_CHECK);
    });

    it('occupation : exactement une place (longueur ou nombre de places), strictement positive', async () => {
      const b = await peupler(c);
      await insererOccupation(c, b, { longueurM: null, nombrePlaces: 24 });
      expect(await codeErreur(insererOccupation(c, b, { longueurM: null, nombrePlaces: null }))).toBe(VIOLATION_CHECK);
      expect(await codeErreur(insererOccupation(c, b, { longueurM: 15, nombrePlaces: 24 }))).toBe(VIOLATION_CHECK);
      expect(await codeErreur(insererOccupation(c, b, { longueurM: 0 }))).toBe(VIOLATION_CHECK);
      expect(await codeErreur(insererOccupation(c, b, { longueurM: -3 }))).toBe(VIOLATION_CHECK);
      expect(await codeErreur(insererOccupation(c, b, { longueurM: null, nombrePlaces: 0 }))).toBe(VIOLATION_CHECK);
    });

    it('longueurs d’emplacement et de série strictement positives', async () => {
      const b = await peupler(c);
      for (const longueur of [0, -1]) {
        expect(
          await codeErreur(
            c.query(
              `INSERT INTO emplacement (id, ferme_id, zone_id, code, sorte, longueur_m, actif_du)
               VALUES ($1, $2, $3, $4, 'planche', $5, '2026-01-01')`,
              [randomUUID(), b.ferme, b.zone, `T2-X${String(longueur)}`, longueur],
            ),
          ),
          `emplacement de ${String(longueur)} m`,
        ).toBe(VIOLATION_CHECK);
      }
      expect(
        await codeErreur(c.query(`UPDATE serie SET longueur_m = -5 WHERE id = $1`, [b.serie])),
        'série de -5 m',
      ).toBe(VIOLATION_CHECK);
      expect(
        await codeErreur(c.query(`UPDATE serie SET longueur_m = NULL, nombre_plants = NULL WHERE id = $1`, [b.serie])),
        'série sans taille',
      ).toBe(VIOLATION_CHECK);
      expect(
        await codeErreur(c.query(`UPDATE serie SET nombre_plants = 300 WHERE id = $1`, [b.serie])),
        'série avec longueur et nombre de plants',
      ).toBe(VIOLATION_CHECK);
    });

    it('valeurs des unions de T01 contrôlées', async () => {
      const b = await peupler(c);
      const refusee = [VIOLATION_CHECK, VALEUR_ENUM_INVALIDE];
      expect(refusee).toContain(
        await codeErreur(c.query(`UPDATE emplacement SET sorte = 'jardiniere' WHERE id = $1`, [b.planche])),
      );
      expect(refusee).toContain(await codeErreur(insererEvenement(c, b, { type: 'arrosage', detail: {} })));
      expect(refusee).toContain(await codeErreur(c.query(`UPDATE serie SET statut = 'finie' WHERE id = $1`, [b.serie])));
    });

    it('événement : au plus une culture (série ou campagne)', async () => {
      const b = await peupler(c);
      await insererEvenement(c, b, { type: 'recolte', serieId: null, campagneId: b.campagne, detail: RECOLTE });
      expect(
        await codeErreur(
          insererEvenement(c, b, { type: 'recolte', serieId: b.serie, campagneId: b.campagne, detail: RECOLTE }),
        ),
      ).toBe(VIOLATION_CHECK);
    });

    it('événement de récolte : quantité strictement positive', async () => {
      const b = await peupler(c);
      expect(
        await codeErreur(insererEvenement(c, b, { type: 'recolte', detail: { ...RECOLTE, quantite: -3 } })),
      ).toBe(VIOLATION_CHECK);
      expect(await codeErreur(insererEvenement(c, b, { type: 'recolte', detail: { ...RECOLTE, quantite: 0 } }))).toBe(
        VIOLATION_CHECK,
      );
    });

    it('mouvement de stock : une récolte liée si et seulement si le motif est « recolte »', async () => {
      const b = await peupler(c);
      const recolte = await insererEvenement(c, b, { type: 'recolte', detail: RECOLTE });
      const mouvement = (motif: string, recolteId: string | null) =>
        c.query(
          `INSERT INTO mouvement_stock (id, ferme_id, article_stock_id, date, quantite, motif, recolte_id)
           VALUES ($1, $2, $3, '2027-05-26', 42, $4, $5)`,
          [randomUUID(), b.ferme, b.article, motif, recolteId],
        );
      await mouvement('recolte', recolte);
      await mouvement('vente', null);
      expect(await codeErreur(mouvement('recolte', null))).toBe(VIOLATION_CHECK);
      expect(await codeErreur(mouvement('perte', recolte))).toBe(VIOLATION_CHECK);
    });
  });

  // --- Ajout seul -----------------------------------------------------------------------------

  describe('journal en ajout seul', () => {
    it('evenement : UPDATE refusé par déclencheur, la ligne reste intacte', async () => {
      const b = await peupler(c);
      const id = await insererEvenement(c, b, { type: 'recolte', detail: RECOLTE });
      expect(await codeErreur(c.query(`UPDATE evenement SET note = 'corrigé' WHERE id = $1`, [id]))).toBe(
        VIOLATION_RESTRICT,
      );
      expect(
        await codeErreur(
          c.query(`UPDATE evenement SET detail = jsonb_set(detail, '{quantite}', '40') WHERE id = $1`, [id]),
        ),
      ).toBe(VIOLATION_RESTRICT);
      const r = await c.query<{ note: string | null; quantite: string }>(
        `SELECT note, detail->>'quantite' AS quantite FROM evenement WHERE id = $1`,
        [id],
      );
      expect(r.rows).toEqual([{ note: null, quantite: '42' }]);
    });

    it('evenement : DELETE refusé par déclencheur, la ligne reste', async () => {
      const b = await peupler(c);
      const id = await insererEvenement(c, b, { type: 'observation', detail: { nature: 'ravageur', gravite: 'faible' } });
      expect(await codeErreur(c.query(`DELETE FROM evenement WHERE id = $1`, [id]))).toBe(VIOLATION_RESTRICT);
      expect(await compter(c, 'SELECT id FROM evenement WHERE id = $1', [id])).toBe(1);
    });

    it('evenement : on corrige ou on annule par un nouvel événement qui désigne l’ancien', async () => {
      const b = await peupler(c);
      const ancien = await insererEvenement(c, b, { type: 'recolte', detail: RECOLTE });
      await insererEvenement(c, b, {
        type: 'recolte',
        detail: { ...RECOLTE, quantite: 40 },
        remplace: { sorte: 'correction', evenementId: ancien },
      });
      expect(await compter(c, 'SELECT id FROM evenement WHERE remplace_evenement_id = $1', [ancien])).toBe(1);
    });

    it('mouvement_stock : UPDATE et DELETE refusés par déclencheur', async () => {
      const b = await peupler(c);
      const id = randomUUID();
      await c.query(
        `INSERT INTO mouvement_stock (id, ferme_id, article_stock_id, date, quantite, motif)
         VALUES ($1, $2, $3, '2027-05-26', -10, 'vente')`,
        [id, b.ferme, b.article],
      );
      expect(await codeErreur(c.query(`UPDATE mouvement_stock SET quantite = -12 WHERE id = $1`, [id]))).toBe(
        VIOLATION_RESTRICT,
      );
      expect(await codeErreur(c.query(`DELETE FROM mouvement_stock WHERE id = $1`, [id]))).toBe(VIOLATION_RESTRICT);
      const r = await c.query<{ quantite: string }>(`SELECT quantite::text AS quantite FROM mouvement_stock WHERE id = $1`, [
        id,
      ]);
      expect(r.rows.map((l) => Number(l.quantite))).toEqual([-10]);
    });

    it('TRUNCATE refusé sur evenement et mouvement_stock, les lignes restent', async () => {
      const b = await peupler(c);
      const recolte = await insererEvenement(c, b, { type: 'recolte', detail: RECOLTE });
      await c.query(
        `INSERT INTO mouvement_stock (id, ferme_id, article_stock_id, date, quantite, motif, recolte_id)
         VALUES ($1, $2, $3, '2027-05-26', 42, 'recolte', $4)`,
        [randomUUID(), b.ferme, b.article, recolte],
      );
      expect(await codeErreur(c.query('TRUNCATE mouvement_stock'))).toBe(VIOLATION_RESTRICT);
      expect(await codeErreur(c.query('TRUNCATE evenement CASCADE'))).toBe(VIOLATION_RESTRICT);
      expect(await compter(c, 'SELECT id FROM evenement', [])).toBe(1);
      expect(await compter(c, 'SELECT id FROM mouvement_stock', [])).toBe(1);
    });

    it('les autres tables restent modifiables', async () => {
      const b = await peupler(c);
      await c.query(`UPDATE serie SET statut = 'en_cours' WHERE id = $1`, [b.serie]);
      await c.query(`UPDATE emplacement SET longueur_m = 28.5 WHERE id = $1`, [b.planche]);
      const r = await c.query<{ statut: string }>(`SELECT statut::text AS statut FROM serie WHERE id = $1`, [b.serie]);
      expect(r.rows[0]?.statut).toBe('en_cours');
    });
  });

  // --- Suppression douce et historique --------------------------------------------------------

  describe('suppression douce et historique', () => {
    it('supprime_le marque la ligne sans l’effacer, même si elle a un historique', async () => {
      const b = await peupler(c);
      await insererOccupation(c, b);
      await insererEvenement(c, b, { type: 'recolte', detail: RECOLTE });

      await c.query(`UPDATE serie SET supprime_le = now() WHERE id = $1`, [b.serie]);

      const r = await c.query<{ supprimee: boolean }>(`SELECT supprime_le IS NOT NULL AS supprimee FROM serie WHERE id = $1`, [
        b.serie,
      ]);
      expect(r.rows).toEqual([{ supprimee: true }]);
      expect(await compter(c, 'SELECT id FROM occupation WHERE serie_id = $1', [b.serie])).toBe(1);
      expect(await compter(c, 'SELECT id FROM evenement WHERE serie_id = $1', [b.serie])).toBe(1);

      // Annuler la suppression : la ligne revient telle quelle.
      await c.query(`UPDATE serie SET supprime_le = NULL WHERE id = $1`, [b.serie]);
      expect(await compter(c, 'SELECT id FROM serie WHERE id = $1 AND supprime_le IS NULL', [b.serie])).toBe(1);
    });

    it('supprimer physiquement une série qui a des événements échoue, rien n’est effacé', async () => {
      const b = await peupler(c);
      const evenement = await insererEvenement(c, b, { type: 'recolte', detail: RECOLTE });
      expect(await codeErreur(c.query(`DELETE FROM serie WHERE id = $1`, [b.serie]))).toBe(VIOLATION_CLE_ETRANGERE);
      expect(await compter(c, 'SELECT id FROM serie WHERE id = $1', [b.serie])).toBe(1);
      expect(await compter(c, 'SELECT id FROM evenement WHERE id = $1', [evenement])).toBe(1);
    });

    it('supprimer physiquement un article qui a des mouvements échoue', async () => {
      const b = await peupler(c);
      await c.query(
        `INSERT INTO mouvement_stock (id, ferme_id, article_stock_id, date, quantite, motif)
         VALUES ($1, $2, $3, '2027-05-26', 5, 'ajustement')`,
        [randomUUID(), b.ferme, b.article],
      );
      expect(await codeErreur(c.query(`DELETE FROM article_stock WHERE id = $1`, [b.article]))).toBe(
        VIOLATION_CLE_ETRANGERE,
      );
    });

    it('aucune clé étrangère en cascade ; celles de l’historique sont NO ACTION ou RESTRICT', async () => {
      const fk = await clesEtrangeres();
      expect(fk.filter((l) => l.suppression === 'c').map((l) => `${l.source}.${l.colonne}`)).toEqual([]);
      const historique = ['evenement', 'mouvement_stock', 'assolement', 'modification'];
      const permissives = fk.filter((l) => historique.includes(l.source) && !['a', 'r'].includes(l.suppression));
      expect(permissives.map((l) => `${l.source}.${l.colonne}`)).toEqual([]);
    });
  });

  // --- Vues -----------------------------------------------------------------------------------

  describe('vues recoltes, interventions, traitements (Q10)', () => {
    async function journal(b: Base): Promise<{ recolte: string; intervention: string; traitement: string }> {
      const recolte = await insererEvenement(c, b, { type: 'recolte', date: '2027-05-26', detail: RECOLTE });
      const intervention = await insererEvenement(c, b, {
        type: 'intervention',
        date: '2027-04-01',
        detail: { categorie: 'travail_sol', type: 'grelinette', outil: 'grelinette 5 dents' } satisfies DetailIntervention,
      });
      const traitement = await insererEvenement(c, b, {
        type: 'traitement',
        date: '2027-05-10',
        detail: {
          produitPhytoId: b.produitPhyto as DetailTraitement['produitPhytoId'],
          dose: { valeur: 0.5, unite: 'kg/ha' },
          surfaceTraiteeM2: 36,
          cible: 'mildiou',
          operateur: 'Théophane',
          recolteAutoriseeLe: '2027-05-31' as DetailTraitement['recolteAutoriseeLe'],
        } satisfies DetailTraitement,
      });
      await insererEvenement(c, b, { type: 'observation', detail: { nature: 'stade', gravite: null } });
      await insererEvenement(c, b, { type: 'realise', detail: { etape: 'plantation', quantiteReelle: null } });
      return { recolte, intervention, traitement };
    }

    it('recoltes : une ligne par événement de récolte, détail en colonnes', async () => {
      const b = await peupler(c);
      const { recolte } = await journal(b);
      const r = await c.query(
        `SELECT id::text, ferme_id::text, date::text, serie_id::text, campagne_id::text,
                quantite::numeric::text AS quantite, unite::text, categorie::text
         FROM recoltes`,
      );
      expect(r.rows).toEqual([
        {
          id: recolte,
          ferme_id: b.ferme,
          date: '2027-05-26',
          serie_id: b.serie,
          campagne_id: null,
          quantite: '42',
          unite: 'piece',
          categorie: 'I',
        },
      ]);
    });

    it('interventions : une ligne par intervention, avec catégorie et type', async () => {
      const b = await peupler(c);
      const { intervention } = await journal(b);
      const r = await c.query(
        `SELECT id::text, ferme_id::text, date::text, serie_id::text, campagne_id::text,
                categorie::text, type_intervention::text, outil::text
         FROM interventions`,
      );
      expect(r.rows).toEqual([
        {
          id: intervention,
          ferme_id: b.ferme,
          date: '2027-04-01',
          serie_id: b.serie,
          campagne_id: null,
          categorie: 'travail_sol',
          type_intervention: 'grelinette',
          outil: 'grelinette 5 dents',
        },
      ]);
    });

    it('traitements : le registre phyto, avec le nom et l’AMM du produit', async () => {
      const b = await peupler(c);
      const { traitement } = await journal(b);
      const r = await c.query(
        `SELECT id::text, ferme_id::text, date::text, serie_id::text, campagne_id::text,
                produit_phyto_id::text, nom_commercial::text, numero_amm::text,
                dose_valeur::numeric::text AS dose_valeur, dose_unite::text,
                surface_traitee_m2::numeric::text AS surface_traitee_m2, cible::text, operateur::text,
                recolte_autorisee_le::text
         FROM traitements`,
      );
      expect(r.rows).toEqual([
        {
          id: traitement,
          ferme_id: b.ferme,
          date: '2027-05-10',
          serie_id: b.serie,
          campagne_id: null,
          produit_phyto_id: b.produitPhyto,
          nom_commercial: 'Bouillie bordelaise',
          numero_amm: '2010427',
          dose_valeur: '0.5',
          dose_unite: 'kg/ha',
          surface_traitee_m2: '36',
          cible: 'mildiou',
          operateur: 'Théophane',
          recolte_autorisee_le: '2027-05-31',
        },
      ]);
    });
  });

  // --- Détail jsonb ---------------------------------------------------------------------------

  describe('détail jsonb des événements', () => {
    it('un détail incomplet ou mal typé est refusé à l’insertion (23514)', async () => {
      const b = await peupler(c);
      const traitementValide = {
        produitPhytoId: b.produitPhyto,
        dose: { valeur: 0.5, unite: 'kg/ha' },
        surfaceTraiteeM2: 36,
        cible: 'mildiou',
        operateur: 'Théophane',
        recolteAutoriseeLe: '2027-05-31',
      };
      const cas: readonly (readonly [string, string, object])[] = [
        ['récolte sans quantite', 'recolte', { unite: 'kg', categorie: null }],
        ['réalisé sans etape', 'realise', { quantiteReelle: null }],
        ['intervention sans categorie', 'intervention', { type: 'taille', outil: null }],
        [
          'traitement sans produitPhytoId',
          'traitement',
          Object.fromEntries(Object.entries(traitementValide).filter(([k]) => k !== 'produitPhytoId')),
        ],
        ['traitement au 2027-13-45', 'traitement', { ...traitementValide, recolteAutoriseeLe: '2027-13-45' }],
        [
          'intervention avec quantite.valeur « beaucoup »',
          'intervention',
          {
            categorie: 'fertilisation',
            type: 'engrais',
            outil: null,
            produit: 'Orgasol',
            quantite: { valeur: 'beaucoup', unite: 'kg' },
          },
        ],
        [
          'intervention avec dureeOccupationJours « x »',
          'intervention',
          { categorie: 'couverture', type: 'paillage', outil: null, dureeOccupationJours: 'x' },
        ],
      ];
      const nonRefuses: string[] = [];
      for (const [nom, type, detail] of cas) {
        try {
          const code = await codeErreur(insererEvenement(c, b, { type, detail }));
          if (code !== VIOLATION_CHECK) nonRefuses.push(`${nom} (SQLSTATE ${code})`);
        } catch {
          nonRefuses.push(`${nom} (accepté)`);
        }
      }
      expect(nonRefuses).toEqual([]);
      expect(await compter(c, 'SELECT id FROM evenement', [])).toBe(0);
    });

    it('après des saisies valides, SELECT * sur les trois vues ne lève jamais', async () => {
      const b = await peupler(c);
      const interventions: readonly DetailIntervention[] = [
        { categorie: 'travail_sol', type: 'grelinette', outil: null },
        { categorie: 'couverture', type: 'paillage', outil: null, dureeOccupationJours: null },
        { categorie: 'couverture', type: 'bâchage ou occultation', outil: 'bâche', dureeOccupationJours: 42 },
        { categorie: 'fertilisation', type: 'engrais', outil: null, produit: 'Orgasol', quantite: { valeur: 3.5, unite: 'kg' } },
        { categorie: 'amendement', type: 'compost', outil: 'épandeur', produit: 'compost', quantite: { valeur: 2, unite: 't' } },
        { categorie: 'entretien', type: 'désherbage', outil: null },
      ];
      for (const detail of interventions) {
        await insererEvenement(c, b, { type: 'intervention', detail });
      }
      await insererEvenement(c, b, { type: 'recolte', detail: RECOLTE });
      await insererEvenement(c, b, { type: 'recolte', detail: { quantite: 0.25, unite: 'kg', categorie: null } });
      await insererEvenement(c, b, {
        type: 'recolte',
        serieId: null,
        campagneId: b.campagne,
        detail: { quantite: 12, unite: 'barquette', categorie: null },
      });
      await insererEvenement(c, b, {
        type: 'traitement',
        detail: {
          produitPhytoId: b.produitPhyto as DetailTraitement['produitPhytoId'],
          dose: { valeur: 5, unite: 'kg/ha' },
          surfaceTraiteeM2: 120.5,
          cible: 'oïdium',
          operateur: 'Théophane',
          recolteAutoriseeLe: '2027-06-01' as DetailTraitement['recolteAutoriseeLe'],
        } satisfies DetailTraitement,
      });
      await insererEvenement(c, b, { type: 'realise', detail: { etape: 'arrachage', quantiteReelle: null } });
      await insererEvenement(c, b, { type: 'observation', detail: { nature: 'maladie', gravite: 'moyenne' } });
      await insererEvenement(c, b, {
        type: 'irrigation',
        serieId: null,
        detail: { secteurIrrigationId: randomUUID(), dureeMinutes: 30 },
      });

      const nombres: Record<string, number> = {};
      for (const vue of VUES) {
        const r = await c.query(`SELECT * FROM ${vue}`);
        nombres[vue] = r.rowCount ?? -1;
      }
      expect(nombres).toEqual({ recoltes: 3, interventions: interventions.length, traitements: 1 });
    });
  });

  // --- Remplacement ---------------------------------------------------------------------------

  describe('remplacement d’un événement', () => {
    it('un événement ne corrige ni n’annule un événement d’une autre ferme', async () => {
      const f = await peupler(c);
      const g = await peupler(c);
      const deF = await insererEvenement(c, f, { type: 'recolte', detail: RECOLTE });
      for (const sorte of ['correction', 'annulation'] as const) {
        const code = await codeErreur(
          insererEvenement(c, g, { type: 'recolte', detail: RECOLTE, remplace: { sorte, evenementId: deF } }),
        );
        expect(code, `${sorte} depuis une autre ferme`).toMatch(/^23/);
      }
      expect(await compter(c, 'SELECT id FROM evenement WHERE remplace_evenement_id = $1', [deF])).toBe(0);
    });

    it('un remplacement est du même type que l’événement remplacé', async () => {
      const b = await peupler(c);
      const recolte = await insererEvenement(c, b, { type: 'recolte', detail: RECOLTE });
      const intervention: DetailIntervention = { categorie: 'entretien', type: 'taille', outil: null };
      for (const sorte of ['correction', 'annulation'] as const) {
        const code = await codeErreur(
          insererEvenement(c, b, { type: 'intervention', detail: intervention, remplace: { sorte, evenementId: recolte } }),
        );
        expect(code, `intervention en ${sorte} d’une récolte`).toMatch(/^23/);
      }
      // Même type : accepté.
      await insererEvenement(c, b, { type: 'recolte', detail: RECOLTE, remplace: { sorte: 'annulation', evenementId: recolte } });
    });

    it('deux corrections du même événement : la vue ne garde que la plus récente (horodatage)', async () => {
      const b = await peupler(c);
      const origine = await insererEvenement(c, b, {
        type: 'recolte',
        horodatage: '2027-05-26T08:00:00Z',
        detail: RECOLTE,
      });
      // La plus récente est insérée en premier : l'ordre d'insertion ne doit pas compter.
      const recente = await insererEvenement(c, b, {
        type: 'recolte',
        horodatage: '2027-05-26T12:00:00Z',
        detail: { ...RECOLTE, quantite: 38 },
        remplace: { sorte: 'correction', evenementId: origine },
      });
      await insererEvenement(c, b, {
        type: 'recolte',
        horodatage: '2027-05-26T10:00:00Z',
        detail: { ...RECOLTE, quantite: 40 },
        remplace: { sorte: 'correction', evenementId: origine },
      });
      const r = await c.query<{ id: string; quantite: string }>(
        `SELECT id::text, quantite::numeric::text AS quantite FROM recoltes`,
      );
      expect(r.rows).toEqual([{ id: recente, quantite: '38' }]);
    });

    it('deux corrections au même horodatage : départage par l’id le plus grand', async () => {
      const b = await peupler(c);
      const origine = await insererEvenement(c, b, { type: 'recolte', detail: RECOLTE });
      const instant = '2027-05-26T12:00:00Z';
      const grand = '0190a5c8-ffff-7fff-bfff-ffffffffffff';
      const petit = '0190a5c8-0000-7000-8000-000000000001';
      await insererEvenement(c, b, {
        id: grand,
        type: 'recolte',
        horodatage: instant,
        detail: { ...RECOLTE, quantite: 38 },
        remplace: { sorte: 'correction', evenementId: origine },
      });
      await insererEvenement(c, b, {
        id: petit,
        type: 'recolte',
        horodatage: instant,
        detail: { ...RECOLTE, quantite: 40 },
        remplace: { sorte: 'correction', evenementId: origine },
      });
      const r = await c.query<{ id: string }>(`SELECT id::text FROM recoltes`);
      expect(r.rows).toEqual([{ id: grand }]);
    });
  });

  // --- Campagne -------------------------------------------------------------------------------

  describe('campagne', () => {
    it('une seule campagne par an et par plantation', async () => {
      const b = await peupler(c);
      const inserer = (annee: number) =>
        c.query(`INSERT INTO campagne (id, ferme_id, plantation_id, annee) VALUES ($1, $2, $3, $4)`, [
          randomUUID(),
          b.ferme,
          b.plantation,
          annee,
        ]);
      expect(await codeErreur(inserer(2027))).toBe(VIOLATION_UNICITE);
      await inserer(2028);
    });
  });

  // --- Aller-retour réel ----------------------------------------------------------------------

  describe('aller-retour réel entité → base → entité', () => {
    const idDe = <E extends NomEntite>(s: string): Id<E> => s as Id<E>;
    const jour = (s: string): DateCalendaire => s as DateCalendaire;

    it('Serie', async () => {
      const b = await peupler(c);
      const d = drizzle(c);
      const series: readonly Serie[] = [
        {
          id: idDe<'Serie'>(randomUUID()),
          fermeId: idDe<'Ferme'>(b.ferme),
          supprimeLe: null,
          saisonId: idDe<'Saison'>(b.saison),
          especeId: idDe<'Espece'>(b.laitue),
          varieteId: null,
          itineraireId: idDe<'Itineraire'>(b.itineraire),
          parametres: PARAMETRES_BATAVIA,
          ancre: { type: 'plantation', date: jour('2027-04-05') },
          datesPrevues: {
            semisPepiniere: jour('2027-03-08'),
            miseEnPlace: jour('2027-04-05'),
            debutRecolte: jour('2027-05-25'),
            finRecolte: jour('2027-06-08'),
          },
          taille: { unite: 'longueur', longueurM: 27.5 },
          statut: 'prevue',
        },
        {
          id: idDe<'Serie'>(randomUUID()),
          fermeId: idDe<'Ferme'>(b.ferme),
          supprimeLe: Date.UTC(2027, 5, 1, 8, 30, 0, 123),
          saisonId: idDe<'Saison'>(b.saison),
          especeId: idDe<'Espece'>(b.laitue),
          varieteId: null,
          itineraireId: idDe<'Itineraire'>(b.itineraire),
          parametres: {
            mode: 'semis_direct',
            densite: { facon: 'volee', largeurSemeeCm: 80, doseGParM2: 2 },
            grainesParPoquet: null,
            periodeUsage: null,
            typeAbri: null,
            dureeAvantRecolteJours: 30,
            fenetreRecolteJours: 7,
            margeSecurite: 10,
            rendementAttendu: null,
            perenne: null,
          },
          ancre: { type: 'debut_recolte', date: jour('2027-07-01') },
          datesPrevues: {
            miseEnPlace: jour('2027-06-01'),
            debutRecolte: jour('2027-07-01'),
            finRecolte: jour('2027-07-08'),
          },
          taille: { unite: 'plants', nombrePlants: 4000 },
          statut: 'abandonnee',
        },
      ];
      for (const s of series) {
        await d.insert(db.serie).values(db.ligneDepuisSerie(s));
        const lues = await d.select().from(db.serie).where(eq(db.serie.id, s.id));
        expect(lues).toHaveLength(1);
        const [lue] = lues;
        if (lue === undefined) throw new Error('série non relue');
        expect(db.serieDepuisLigne(lue)).toStrictEqual(s);
      }
    });

    it('Emplacement', async () => {
      const b = await peupler(c);
      const d = drizzle(c);
      const commun = {
        fermeId: idDe<'Ferme'>(b.ferme),
        supprimeLe: null,
        zoneId: idDe<'Zone'>(b.zone),
        largeurM: 0.8,
        actifDu: jour('2026-01-01'),
        actifAu: null,
        remplace: [],
        placementXM: null,
        placementYM: null,
        orientationDeg: null,
      } as const;
      const emplacements: readonly Emplacement[] = [
        // T28a : une planche placée dans le repère de sa zone, relue à l'identique (numeric).
        { ...commun, id: idDe<'Emplacement'>(randomUUID()), sorte: 'planche', code: 'T2-P04', longueurM: 30, placementXM: 2.25, placementYM: -0.5, orientationDeg: 92.5 },
        {
          ...commun,
          id: idDe<'Emplacement'>(randomUUID()),
          sorte: 'rang',
          code: 'V-R01',
          longueurM: 85.5,
          largeurM: null,
          actifAu: jour('2031-12-31'),
          supprimeLe: Date.UTC(2027, 0, 2, 3, 4, 5, 6),
        },
        {
          ...commun,
          id: idDe<'Emplacement'>(randomUUID()),
          sorte: 'gouttiere',
          code: 'HS-G12',
          longueurM: 40,
          largeurM: 0.25,
          nombrePlaces: 320,
          remplace: [idDe<'Emplacement'>(b.planche), idDe<'Emplacement'>(randomUUID())],
        },
      ];
      for (const e of emplacements) {
        await d.insert(db.emplacement).values(db.ligneDepuisEmplacement(e));
        const [lue] = await d.select().from(db.emplacement).where(eq(db.emplacement.id, e.id));
        if (lue === undefined) throw new Error('emplacement non relu');
        expect(db.emplacementDepuisLigne(lue)).toStrictEqual(e);
      }
    });

    it('Evenement, pour chacun des six types', async () => {
      const b = await peupler(c);
      const d = drizzle(c);
      const commun = {
        fermeId: idDe<'Ferme'>(b.ferme),
        date: jour('2027-05-26'),
        horodatage: Date.UTC(2027, 4, 27, 6, 15, 42, 7),
        auteurId: idDe<'Utilisateur'>(b.auteur),
        source: 'tap',
        culture: { sorte: 'serie', serieId: idDe<'Serie'>(b.serie) },
        emplacementIds: [idDe<'Emplacement'>(b.planche)],
        note: null,
        photos: [],
        remplaceEvenement: null,
      } as const;
      const observation = idDe<'Evenement'>(randomUUID());
      const evenements: readonly Evenement[] = [
        { ...commun, id: idDe<'Evenement'>(randomUUID()), type: 'realise', detail: { etape: 'plantation', quantiteReelle: 290 } },
        {
          ...commun,
          id: idDe<'Evenement'>(randomUUID()),
          type: 'recolte',
          culture: { sorte: 'campagne', campagneId: idDe<'Campagne'>(b.campagne) },
          emplacementIds: [],
          source: 'voix',
          note: 'belle cueillette',
          photos: ['photo-1.jpg', 'photo-2.jpg'],
          detail: { quantite: 42.5, unite: 'kg', categorie: 'I' },
        },
        {
          ...commun,
          id: idDe<'Evenement'>(randomUUID()),
          type: 'intervention',
          culture: null,
          detail: { categorie: 'fertilisation', type: 'engrais', outil: null, produit: 'Orgasol', quantite: { valeur: 3, unite: 'kg' } },
        },
        {
          ...commun,
          id: idDe<'Evenement'>(randomUUID()),
          type: 'irrigation',
          culture: null,
          detail: { secteurIrrigationId: idDe<'SecteurIrrigation'>(randomUUID()), dureeMinutes: 45 },
        },
        {
          ...commun,
          id: idDe<'Evenement'>(randomUUID()),
          type: 'traitement',
          detail: {
            produitPhytoId: idDe<'ProduitPhyto'>(b.produitPhyto),
            dose: { valeur: 0.5, unite: 'kg/ha' },
            surfaceTraiteeM2: 36,
            cible: 'mildiou',
            operateur: 'Théophane',
            recolteAutoriseeLe: jour('2027-06-16'),
          },
        },
        { ...commun, id: observation, type: 'observation', detail: { nature: 'ravageur', gravite: null } },
        {
          ...commun,
          id: idDe<'Evenement'>(randomUUID()),
          type: 'observation',
          horodatage: commun.horodatage + 60_000,
          remplaceEvenement: { sorte: 'correction', evenementId: observation },
          detail: { nature: 'ravageur', gravite: 'forte' },
        },
      ];
      for (const e of evenements) {
        await d.insert(db.evenement).values(db.ligneDepuisEvenement(e));
        const [lue] = await d.select().from(db.evenement).where(eq(db.evenement.id, e.id));
        if (lue === undefined) throw new Error('événement non relu');
        expect(db.evenementDepuisLigne(lue)).toStrictEqual(e);
      }
    });

    it('Occupation : série, plantation et couverture', async () => {
      const b = await peupler(c);
      const d = drizzle(c);
      const bache = await insererEvenement(c, b, {
        type: 'intervention',
        serieId: null,
        detail: { categorie: 'couverture', type: 'solarisation', outil: null, dureeOccupationJours: 42 },
      });
      const commun = {
        fermeId: idDe<'Ferme'>(b.ferme),
        supprimeLe: null,
        emplacementId: idDe<'Emplacement'>(b.planche),
        prevuDu: jour('2027-04-05'),
        prevuAu: jour('2027-06-09'),
      } as const;
      const occupations: readonly Occupation[] = [
        {
          ...commun,
          id: idDe<'Occupation'>(randomUUID()),
          occupant: { sorte: 'serie', serieId: idDe<'Serie'>(b.serie) },
          place: { unite: 'longueur', longueurM: 15 },
          positionM: null,
          reel: null,
        },
        {
          ...commun,
          id: idDe<'Occupation'>(randomUUID()),
          occupant: { sorte: 'plantation', plantationId: idDe<'Plantation'>(b.plantation) },
          place: { unite: 'places', nombrePlaces: 24 },
          positionM: null,
          prevuAu: jour('2030-01-01'),
          reel: { du: jour('2027-04-07'), au: null },
        },
        {
          ...commun,
          id: idDe<'Occupation'>(randomUUID()),
          supprimeLe: Date.UTC(2027, 5, 1, 8, 30, 0, 123),
          occupant: { sorte: 'couverture', evenementId: idDe<'Evenement'>(bache) },
          place: { unite: 'longueur', longueurM: 12.5 },
          positionM: 17.5,
          reel: { du: jour('2027-04-06'), au: jour('2027-05-18') },
        },
      ];
      for (const o of occupations) {
        await d.insert(db.occupation).values(db.ligneDepuisOccupation(o));
        const [lue] = await d.select().from(db.occupation).where(eq(db.occupation.id, o.id));
        if (lue === undefined) throw new Error('occupation non relue');
        expect(db.occupationDepuisLigne(lue)).toStrictEqual(o);
      }
    });
  });

  // --- Index ----------------------------------------------------------------------------------

  describe('index', () => {
    async function definitions(table: string): Promise<string[]> {
      const r = await c.query<{ def: string }>(
        `SELECT indexdef AS def FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1`,
        [table],
      );
      return r.rows.map((l) => l.def);
    }

    it('vue 2D : un index sur occupation couvre l’emplacement et la période prévue', async () => {
      const defs = await definitions('occupation');
      expect(
        defs.some((d) => d.includes('emplacement_id') && /prevu_(du|au)/.test(d)),
        `index de occupation : ${defs.join(' ; ')}`,
      ).toBe(true);
    });

    it('semainier : un index sur serie couvre les dates prévues', async () => {
      const defs = await definitions('serie');
      expect(
        defs.some((d) => /prevu_(semis_pepiniere|mise_en_place|debut_recolte|fin_recolte)/.test(d)),
        `index de serie : ${defs.join(' ; ')}`,
      ).toBe(true);
    });
  });

  // --- PowerSync ------------------------------------------------------------------------------

  describe('publication PowerSync', () => {
    it('la publication « powersync » est une liste explicite, en insert, update et delete', async () => {
      const pub = await c.query<{ ins: boolean; maj: boolean; sup: boolean; toutes: boolean }>(
        `SELECT pubinsert AS ins, pubupdate AS maj, pubdelete AS sup, puballtables AS toutes
         FROM pg_publication WHERE pubname = 'powersync'`,
      );
      expect(pub.rows).toEqual([{ ins: true, maj: true, sup: true, toutes: false }]);
    });

    it('elle couvre toutes les tables du schéma public, sauf les exclusions explicites', async () => {
      const toutes = await c.query<{ nom: string }>(
        `SELECT tablename::text AS nom FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`,
      );
      const publiees = await c.query<{ nom: string }>(
        `SELECT tablename::text AS nom FROM pg_publication_tables
         WHERE pubname = 'powersync' AND schemaname = 'public' ORDER BY 1`,
      );
      const attendues = toutes.rows.map((l) => l.nom).filter((t) => !TABLES_NON_PUBLIEES.includes(t));
      expect(publiees.rows.map((l) => l.nom)).toEqual(attendues);
      // Garde-fou : la comparaison porte bien sur les 21 tables du modèle.
      expect(attendues).toEqual(expect.arrayContaining([...TABLES]));
    });
  });
});
