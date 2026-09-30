/**
 * Tests d'acceptation T22 — rangement des travaux prévus en base (PostgreSQL).
 *
 * Contrat (packages/core/src/planification/test/contrat-travaux.ts) : les travaux prévus sont
 * une clé `travauxPrevus` (tableau) du jsonb `parametres` de l'itinéraire, copiée telle quelle
 * dans le jsonb `parametres` de la série (l'instantané). Aucune colonne nouvelle : le schéma
 * local PowerSync et la publication ne changent pas. Le détail est validé par le cœur
 * (validerTravauxPrevus, validerSerie) avant toute écriture ; la base garde un filet : une
 * migration ajoute sur `itineraire` et `serie` une contrainte CHECK qui refuse une clé
 * `travauxPrevus` qui n'est pas un tableau jsonb (absente : acceptée, lignes d'avant T22).
 *
 * Exécution comme schema.integration.test.ts : DATABASE_URL (Postgres avec CREATEDB) ; sans
 * elle, sautés en local (l'échec clair en CI est déjà porté par schema.integration.test.ts).
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as db from './index.ts';

const URL_BASE = process.env.DATABASE_URL ?? '';
const decrireAvecBase = URL_BASE === '' ? describe.skip : describe;

const VIOLATION_CHECK = '23514';

function urlDe(base: string): string {
  const url = new URL(URL_BASE);
  url.pathname = `/${base}`;
  return url.toString();
}

/** Code SQLSTATE de l'erreur levée par la requête ; échoue si la requête passe. */
async function codeErreur(requete: Promise<unknown>): Promise<string> {
  try {
    await requete;
  } catch (e) {
    return (e as { code?: string }).code ?? 'sans code';
  }
  throw new Error('la base a accepté la ligne : contrainte CHECK attendue sur travauxPrevus (T22)');
}

const BATAVIA = {
  mode: 'plant_maison',
  densite: { facon: 'ecartement', rangsParPlanche: 3, ecartementSurRangCm: 30 },
  dureePepiniereJours: 28,
  grainesParMotte: 1,
  plantsParMotte: 1,
  pertePepiniere: 10,
  alveolesParPlaque: 77,
  periodeUsage: null,
  typeAbri: 'tunnel',
  dureeAvantRecolteJours: 28,
  fenetreRecolteJours: 14,
  margeSecurite: 10,
  rendementAttendu: null,
  perenne: null,
};

const TRAVAUX = [
  {
    categorie: 'travail_sol',
    type: 'grelinette',
    repere: 'mise_en_place',
    decalageJours: -10,
    repetition: null,
    outil: 'grelinette',
    produit: null,
    tempsEstime: { minutes: 20, par: 'cent_metres' },
  },
  {
    categorie: 'entretien',
    type: 'désherbage',
    repere: 'mise_en_place',
    decalageJours: 14,
    repetition: { tousLesJours: 14, repereFin: 'debut_recolte' },
    outil: null,
    produit: null,
    tempsEstime: null,
  },
];

decrireAvecBase('T22 : travaux prévus dans itineraire.parametres et serie.parametres', { timeout: 30_000 }, () => {
  let admin: pg.Client;
  let c: pg.Client;
  const base = `t22_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const ferme = randomUUID();
  const espece = randomUUID();
  const saison = randomUUID();

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: URL_BASE });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${base}`);
    await db.appliquerMigrations(urlDe(base));
    c = new pg.Client({ connectionString: urlDe(base) });
    await c.connect();
    const famille = randomUUID();
    await c.query(`INSERT INTO ferme (id, nom, fuseau_horaire) VALUES ($1, 'Ferme T22', 'Europe/Paris')`, [ferme]);
    await c.query(
      `INSERT INTO famille (id, ferme_id, nom, delai_retour_minimal_ans, delai_retour_conseille_ans)
       VALUES ($1, $2, 'Astéracées', 2, 3)`,
      [famille, ferme],
    );
    await c.query(
      `INSERT INTO espece (id, ferme_id, famille_id, nom, categorie, perenne, unite_recolte)
       VALUES ($1, $2, $3, 'Laitue', 'legume', false, 'piece')`,
      [espece, ferme, famille],
    );
    await c.query(`INSERT INTO saison (id, ferme_id, nom, debut, fin) VALUES ($1, $2, '2027', '2027-01-01', '2027-12-31')`, [saison, ferme]);
  }, 120_000);

  afterAll(async () => {
    await c.end();
    await admin.query(`DROP DATABASE IF EXISTS ${base} WITH (FORCE)`);
    await admin.end();
  }, 60_000);

  async function insererItineraire(parametres: unknown): Promise<string> {
    const id = randomUUID();
    await c.query(
      `INSERT INTO itineraire (id, ferme_id, espece_id, nom, mode, parametres)
       VALUES ($1, $2, $3, 'Batavia d''été', 'plant_maison', $4)`,
      [id, ferme, espece, JSON.stringify(parametres)],
    );
    return id;
  }

  async function insererSerie(itineraire: string, parametres: unknown): Promise<string> {
    const id = randomUUID();
    await c.query(
      `INSERT INTO serie (id, ferme_id, saison_id, espece_id, itineraire_id, parametres,
                          ancre_type, ancre_date, prevu_semis_pepiniere, prevu_mise_en_place,
                          prevu_debut_recolte, prevu_fin_recolte, longueur_m, statut)
       VALUES ($1, $2, $3, $4, $5, $6, 'plantation', '2027-05-03', '2027-04-05', '2027-05-03',
               '2027-05-31', '2027-06-14', 30, 'prevue')`,
      [id, ferme, saison, espece, itineraire, JSON.stringify(parametres)],
    );
    return id;
  }

  it('aucune colonne nouvelle : les travaux sont rangés dans parametres', async () => {
    const r = await c.query<{ table_name: string; column_name: string }>(
      `SELECT table_name::text, column_name::text FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name IN ('itineraire', 'serie') AND column_name LIKE '%travau%'`,
    );
    expect(r.rows).toStrictEqual([]);
  });

  it('itinéraire avec travaux prévus, puis série qui les copie : relus à l’identique', async () => {
    const itineraire = await insererItineraire({ ...BATAVIA, travauxPrevus: TRAVAUX });
    const serie = await insererSerie(itineraire, { ...BATAVIA, travauxPrevus: TRAVAUX });
    const i = await c.query<{ travaux: unknown }>(`SELECT parametres -> 'travauxPrevus' AS travaux FROM itineraire WHERE id = $1`, [itineraire]);
    const s = await c.query<{ travaux: unknown }>(`SELECT parametres -> 'travauxPrevus' AS travaux FROM serie WHERE id = $1`, [serie]);
    expect(i.rows[0]?.travaux).toStrictEqual(TRAVAUX);
    expect(s.rows[0]?.travaux).toStrictEqual(TRAVAUX);
  });

  it('sans clé travauxPrevus (lignes d’avant T22), ou liste vide : accepté', async () => {
    const itineraire = await insererItineraire(BATAVIA);
    await insererSerie(itineraire, BATAVIA);
    const vide = await insererItineraire({ ...BATAVIA, travauxPrevus: [] });
    await insererSerie(vide, { ...BATAVIA, travauxPrevus: [] });
  });

  it.each([
    ['un objet', TRAVAUX[0]],
    ['un texte', 'grelinette'],
    ['un nombre', 3],
    ['null jsonb', null],
  ])('travauxPrevus qui est %s : refusé dans l’itinéraire (CHECK)', async (_cas, travauxPrevus) => {
    expect(await codeErreur(insererItineraire({ ...BATAVIA, travauxPrevus }))).toBe(VIOLATION_CHECK);
  });

  it('travauxPrevus qui n’est pas un tableau : refusé dans la série (CHECK)', async () => {
    const itineraire = await insererItineraire(BATAVIA);
    expect(await codeErreur(insererSerie(itineraire, { ...BATAVIA, travauxPrevus: TRAVAUX[0] }))).toBe(VIOLATION_CHECK);
    expect(await codeErreur(insererSerie(itineraire, { ...BATAVIA, travauxPrevus: 'grelinette' }))).toBe(VIOLATION_CHECK);
  });

  it('la même règle vaut pour une mise à jour de l’itinéraire', async () => {
    const itineraire = await insererItineraire({ ...BATAVIA, travauxPrevus: TRAVAUX });
    expect(
      await codeErreur(
        c.query(`UPDATE itineraire SET parametres = jsonb_set(parametres, '{travauxPrevus}', '"grelinette"') WHERE id = $1`, [itineraire]),
      ),
    ).toBe(VIOLATION_CHECK);
  });
});
