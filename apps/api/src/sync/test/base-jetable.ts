/**
 * Utilitaires des tests d'intégration de la synchro (T10) : base Postgres jetable, migrations
 * appliquées, et quelques lignes de départ (utilisateurs, fermes, membres).
 *
 * Comme T08 et T09 : DATABASE_URL désigne un Postgres où l'on peut créer des bases. Sans elle,
 * échec clair en CI, saut signalé en local.
 */
import { randomUUID } from 'node:crypto';
import { appliquerMigrations } from '@planif/db';
import pg from 'pg';
import { describe, it } from 'vitest';

export const URL_BASE = process.env.DATABASE_URL ?? '';
export const EN_CI = (process.env.CI ?? '') !== '' && process.env.CI !== 'false';

/** `describe`, ou `describe.skip` sans DATABASE_URL (avec un test qui échoue en CI). */
export function decrireAvecBase(ticket: string): typeof describe | typeof describe.skip {
  if (URL_BASE !== '') return describe;
  if (EN_CI) {
    describe(`${ticket} : base PostgreSQL`, () => {
      it('DATABASE_URL est définie en CI', () => {
        throw new Error(`DATABASE_URL absente en CI : les tests d’intégration de ${ticket} exigent le service Postgres.`);
      });
    });
  } else {
    console.warn(`[${ticket}] DATABASE_URL absente : tests d’intégration sautés.`);
  }
  return describe.skip;
}

export function urlDeLaBase(nom: string): string {
  const url = new URL(URL_BASE);
  url.pathname = `/${nom}`;
  return url.toString();
}

export function nomJetable(prefixe: string): string {
  return `${prefixe}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
}

/** Attend que plus aucune connexion n'utilise la base (pool.end() rend la main trop tôt). */
async function attendreDeconnexion(admin: pg.Client, nom: string): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const { rows } = await admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1`, [nom]);
    if (rows[0]?.n === 0) return;
    await new Promise((fin) => setTimeout(fin, 100));
  }
}

export interface BaseJetable {
  readonly nom: string;
  readonly url: string;
  readonly pool: pg.Pool;
  supprimer(): Promise<void>;
}

/** Crée une base vide (`migrer` : migrations de @planif/db appliquées), et son pool. */
export async function creerBaseJetable(prefixe: string, migrer = true): Promise<BaseJetable> {
  const nom = nomJetable(prefixe);
  const admin = new pg.Client({ connectionString: URL_BASE });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${nom}`);
  await admin.end();
  const url = urlDeLaBase(nom);
  if (migrer) await appliquerMigrations(url);
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  return {
    nom,
    url,
    pool,
    async supprimer() {
      await pool.end();
      const a = new pg.Client({ connectionString: URL_BASE });
      await a.connect();
      try {
        await attendreDeconnexion(a, nom);
        // Un slot de réplication logique (PowerSync) empêche la suppression de la base.
        await a.query(
          `SELECT pg_drop_replication_slot(slot_name) FROM pg_replication_slots WHERE database = $1 AND NOT active`,
          [nom],
        );
        await a.query(`DROP DATABASE IF EXISTS ${nom} WITH (FORCE)`);
      } finally {
        await a.end();
      }
    },
  };
}

export async function creerUtilisateur(pool: pg.Pool, email = `t10-${randomUUID()}@ferme.fr`): Promise<{ id: string; email: string }> {
  const id = randomUUID();
  await pool.query(`INSERT INTO utilisateur (id, email, nom) VALUES ($1, $2, $3)`, [id, email, `Nom ${email}`]);
  return { id, email };
}

export async function creerFerme(pool: pg.Pool, nom = 'Jardins de Garonne'): Promise<string> {
  const id = randomUUID();
  await pool.query(`INSERT INTO ferme (id, nom, fuseau_horaire) VALUES ($1, $2, 'Europe/Paris')`, [id, nom]);
  return id;
}

export interface OptionsMembre {
  readonly role?: 'gerant' | 'equipier';
  readonly etat?: 'invite' | 'accepte';
  readonly retire?: boolean;
  readonly invitePar?: string;
}

export async function ajouterMembre(pool: pg.Pool, utilisateurId: string, fermeId: string, o: OptionsMembre = {}): Promise<void> {
  const invite = o.etat === 'invite' || o.invitePar !== undefined;
  await pool.query(
    `INSERT INTO membre (id, utilisateur_id, ferme_id, role, etat, invite_par, invite_le, supprime_le)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      randomUUID(),
      utilisateurId,
      fermeId,
      o.role ?? 'equipier',
      o.etat ?? 'accepte',
      invite ? (o.invitePar ?? utilisateurId) : null,
      invite ? new Date('2026-09-30T08:00:00Z') : null,
      o.retire === true ? new Date('2026-09-30T09:00:00Z') : null,
    ],
  );
}

/** Lignes d'une ferme que les événements désignent (série, campagne, emplacement, vanne, produit phyto). */
export interface LignesDeFerme {
  readonly serie: string;
  readonly campagne: string;
  readonly emplacement: string;
  readonly secteurIrrigation: string;
  readonly produitPhyto: string;
}

const PARAMETRES_ITINERAIRE = {
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
};

/** Crée dans `fermeId` une série, une campagne, un emplacement, une vanne et un produit phyto (T10, B1). */
export async function peuplerFerme(pool: pg.Pool, fermeId: string): Promise<LignesDeFerme> {
  const [zone, famille, espece, kiwi, itineraire, saison, plantation] = Array.from({ length: 7 }, () => randomUUID());
  const l: LignesDeFerme = {
    serie: randomUUID(),
    campagne: randomUUID(),
    emplacement: randomUUID(),
    secteurIrrigation: randomUUID(),
    produitPhyto: randomUUID(),
  };
  await pool.query(`INSERT INTO zone (id, ferme_id, nom, type_abri) VALUES ($1, $2, 'Tunnel 2', 'tunnel')`, [zone, fermeId]);
  await pool.query(
    `INSERT INTO emplacement (id, ferme_id, zone_id, code, sorte, longueur_m, actif_du)
     VALUES ($1, $2, $3, 'T2-P03', 'planche', 30, '2026-01-01')`,
    [l.emplacement, fermeId, zone],
  );
  await pool.query(
    `INSERT INTO secteur_irrigation (id, ferme_id, numero_vanne, nom) VALUES ($1, $2, 12, 'Vanne 12')`,
    [l.secteurIrrigation, fermeId],
  );
  await pool.query(
    `INSERT INTO famille (id, ferme_id, nom, delai_retour_minimal_ans, delai_retour_conseille_ans)
     VALUES ($1, $2, 'Astéracées', 2, 3)`,
    [famille, fermeId],
  );
  await pool.query(
    `INSERT INTO espece (id, ferme_id, famille_id, nom, categorie, perenne, unite_recolte)
     VALUES ($1, $3, $4, 'Laitue', 'legume', false, 'piece'), ($2, $3, $4, 'Kiwi', 'fruit', true, 'kg')`,
    [espece, kiwi, fermeId, famille],
  );
  await pool.query(
    `INSERT INTO itineraire (id, ferme_id, espece_id, nom, mode, parametres)
     VALUES ($1, $2, $3, 'Batavia de printemps', 'plant_maison', $4)`,
    [itineraire, fermeId, espece, JSON.stringify(PARAMETRES_ITINERAIRE)],
  );
  await pool.query(`INSERT INTO saison (id, ferme_id, nom, debut, fin) VALUES ($1, $2, '2026', '2026-01-01', '2026-12-31')`, [
    saison,
    fermeId,
  ]);
  await pool.query(
    `INSERT INTO serie (id, ferme_id, saison_id, espece_id, itineraire_id, parametres,
                        ancre_type, ancre_date, prevu_semis_pepiniere, prevu_mise_en_place,
                        prevu_debut_recolte, prevu_fin_recolte, longueur_m, statut)
     VALUES ($1, $2, $3, $4, $5, $6, 'plantation', '2026-08-05', '2026-07-08', '2026-08-05',
             '2026-09-25', '2026-10-08', 30, 'en_cours')`,
    [l.serie, fermeId, saison, espece, itineraire, JSON.stringify(PARAMETRES_ITINERAIRE)],
  );
  await pool.query(
    `INSERT INTO plantation (id, ferme_id, espece_id, date_plantation, nombre_plants) VALUES ($1, $2, $3, '2019-03-15', 120)`,
    [plantation, fermeId, kiwi],
  );
  await pool.query(`INSERT INTO campagne (id, ferme_id, plantation_id, annee) VALUES ($1, $2, $3, 2026)`, [
    l.campagne,
    fermeId,
    plantation,
  ]);
  await pool.query(
    `INSERT INTO produit_phyto (id, ferme_id, nom_commercial, numero_amm, substance_active, delai_avant_recolte_jours, utilisable_en_bio)
     VALUES ($1, $2, 'Bouillie bordelaise', '2010427', 'cuivre', 21, true)`,
    [l.produitPhyto, fermeId],
  );
  return l;
}

/** Produit phyto de la bibliothèque partagée (`ferme_id` nul). */
export async function creerProduitPhytoBibliotheque(pool: pg.Pool): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO produit_phyto (id, ferme_id, nom_commercial, numero_amm, substance_active, delai_avant_recolte_jours, utilisable_en_bio)
     VALUES ($1, NULL, 'Soufre mouillable', '2000123', 'soufre', 3, true)`,
    [id],
  );
  return id;
}
