/**
 * Amorçage du test de bout en bout de la synchro (T10, apps/web/e2e-synchro) : crée une ferme
 * neuve et deux membres acceptés dans la base que l'API et le service PowerSync utilisent, et
 * leur émet un jeton d'accès avec les clés de l'API. Écrit le résultat en JSON sur la sortie :
 *
 *   { "fermeId": "…", "sessions": [SessionConnexion, SessionConnexion] }
 *
 * (SessionConnexion : apps/web/src/connexion/session.ts, rangée telle quelle dans localStorage.)
 *
 * Variables (les mêmes que le processus de l'API) : DATABASE_URL, JWT_CLES_PRIVEES,
 * JWT_EMETTEUR, JWT_AUDIENCE. Le jeton de renouvellement est factice : le test dure bien moins
 * que la vie d'un jeton d'accès (1 h).
 *
 * T09b : si API_URL est posée (c'est le cas sous `pnpm e2e:synchro`), les sessions sont de
 * VRAIES sessions de l'API : un code connu est rangé (haché) dans code_connexion, puis échangé
 * par POST {API_URL}/auth/verifier. Le jeton de renouvellement est alors réel (déconnexion,
 * rotation : e2e-synchro/deconnexion.e2e.ts).
 *
 *   node apps/api/src/sync/test/amorcer-e2e.ts
 *
 * T10c : avec `--serie-tomates`, la ferme reçoit aussi une famille, une espèce « Tomate » de la
 * ferme (récoltée en kg), une saison, un itinéraire et une série de tomates en récolte (statut
 * 'en_cours', fenêtre de récolte qui contient aujourd'hui à Europe/Paris), sans article de
 * stock ; la sortie gagne `"serieTomates": { "id", "especeId" }` (e2e-synchro/stock.e2e.ts).
 *
 *   node apps/api/src/sync/test/amorcer-e2e.ts --serie-tomates
 *
 * T10e : avec `--plan-serie`, la ferme reçoit de quoi planifier une série de batavias depuis le
 * téléphone, sans aucune série : une famille « Astéracées » de la ferme (retour minimal 2 ans,
 * conseillé 3), une espèce « Laitue », une variété « Batavia blonde », un itinéraire « Batavia de
 * printemps » (plant maison, instantané de la batavia de T02), une saison « 2027 », une zone et
 * deux planches de 30 m ; la sortie gagne `"planSerie": { "saisonId", "itineraireId",
 * "especeId", "familleId", "delaiMinimalAns", "planches" }` (e2e-synchro/serie.e2e.ts).
 *
 *   node apps/api/src/sync/test/amorcer-e2e.ts --plan-serie
 */
import { randomUUID } from 'node:crypto';
import { ajouterJours, type DateCalendaire } from '@planif/core';
import pg from 'pg';
import { emettreJetonAcces, trousseauDepuisJwks } from '../../auth/index.ts';
import { empreinteCode, tirerCode } from '../../auth/secrets.ts';

function variable(nom: string): string {
  const v = process.env[nom] ?? '';
  if (v === '') throw new Error(`variable ${nom} absente`);
  return v;
}

interface SessionAmorcee {
  readonly utilisateurId: string;
  readonly email: string;
  readonly jetonAcces: string;
  readonly jetonRenouvellement: string;
}

/** Vraie session de l'API : code rangé haché, puis POST /auth/verifier. */
async function sessionDeLApi(bd: pg.Pool, urlApi: string, email: string): Promise<SessionAmorcee> {
  const code = tirerCode();
  const maintenant = new Date();
  await bd.query(`INSERT INTO code_connexion (id, email, code_hache, expire_le, cree_le) VALUES ($1, $2, $3, $4, $5)`, [
    randomUUID(),
    email,
    empreinteCode(code),
    new Date(maintenant.getTime() + 10 * 60_000),
    maintenant,
  ]);
  const res = await fetch(`${urlApi.replace(/\/+$/, '')}/auth/verifier`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });
  if (res.status !== 200) throw new Error(`amorçage : /auth/verifier a répondu ${String(res.status)}`);
  const corps = (await res.json()) as Omit<SessionAmorcee, 'email'>;
  return { utilisateurId: corps.utilisateurId, email, jetonAcces: corps.jetonAcces, jetonRenouvellement: corps.jetonRenouvellement };
}

/** Paramètres d'itinéraire de T01 (plant maison sous tunnel), repris tels quels par la série. */
const PARAMETRES_TOMATE = {
  mode: 'plant_maison',
  densite: { facon: 'ecartement', rangsParPlanche: 2, ecartementSurRangCm: 50 },
  dureePepiniereJours: 42,
  grainesParMotte: 1,
  plantsParMotte: 1,
  pertePepiniere: 10,
  alveolesParPlaque: 77,
  periodeUsage: null,
  typeAbri: 'tunnel',
  dureeAvantRecolteJours: 70,
  fenetreRecolteJours: 90,
  margeSecurite: 10,
  rendementAttendu: null,
  perenne: null,
};

/** Aujourd'hui à Europe/Paris ('AAAA-MM-JJ'), le fuseau de la ferme amorcée. */
function aujourdhuiAParis(): DateCalendaire {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(),
  ) as DateCalendaire;
}

/** Série de tomates en récolte aujourd'hui, avec sa famille, son espèce, sa saison et son itinéraire. */
async function amorcerSerieTomates(bd: pg.Pool, fermeId: string): Promise<{ id: string; especeId: string }> {
  const [famille, espece, saison, itineraire, serie] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const jour = aujourdhuiAParis();
  const parametres = JSON.stringify(PARAMETRES_TOMATE);
  await bd.query(
    `INSERT INTO famille (id, ferme_id, nom, delai_retour_minimal_ans, delai_retour_conseille_ans) VALUES ($1, $2, 'Solanacées', 3, 4)`,
    [famille, fermeId],
  );
  await bd.query(
    `INSERT INTO espece (id, ferme_id, famille_id, nom, categorie, perenne, unite_recolte) VALUES ($1, $2, $3, 'Tomate', 'legume', false, 'kg')`,
    [espece, fermeId, famille],
  );
  await bd.query(`INSERT INTO saison (id, ferme_id, nom, debut, fin) VALUES ($1, $2, 'Saison e2e', $3, $4)`, [
    saison,
    fermeId,
    ajouterJours(jour, -200),
    ajouterJours(jour, 200),
  ]);
  await bd.query(
    `INSERT INTO itineraire (id, ferme_id, espece_id, nom, mode, parametres) VALUES ($1, $2, $3, 'Tomate sous tunnel', 'plant_maison', $4)`,
    [itineraire, fermeId, espece, parametres],
  );
  const miseEnPlace = ajouterJours(jour, -80);
  await bd.query(
    `INSERT INTO serie (id, ferme_id, saison_id, espece_id, itineraire_id, parametres, ancre_type, ancre_date,
                        prevu_semis_pepiniere, prevu_mise_en_place, prevu_debut_recolte, prevu_fin_recolte, longueur_m, statut)
     VALUES ($1, $2, $3, $4, $5, $6, 'plantation', $7, $8, $7, $9, $10, 30, 'en_cours')`,
    [serie, fermeId, saison, espece, itineraire, parametres, miseEnPlace, ajouterJours(miseEnPlace, -42), ajouterJours(jour, -10), ajouterJours(jour, 80)],
  );
  return { id: serie, especeId: espece };
}

/** Batavia de T02 : plant maison, pépinière 28 j, avant récolte 49 j, fenêtre 14 j. */
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
  dureeAvantRecolteJours: 49,
  fenetreRecolteJours: 14,
  margeSecurite: 10,
  rendementAttendu: null,
  perenne: null,
};

/** Délai de retour minimal de la famille amorcée (celui que la décision de rotation reprend). */
const DELAI_MINIMAL_ASTERACEES = 2;

interface PlanSerie {
  readonly saisonId: string;
  readonly itineraireId: string;
  readonly especeId: string;
  readonly familleId: string;
  readonly delaiMinimalAns: number;
  readonly planches: readonly [string, string];
}

/** Famille, espèce, variété, itinéraire, saison 2027 et deux planches de 30 m : de quoi créer une série au téléphone. */
async function amorcerPlanSerie(bd: pg.Pool, fermeId: string): Promise<PlanSerie> {
  const [famille, espece, variete, itineraire, saison, zone] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await bd.query(
    `INSERT INTO famille (id, ferme_id, nom, delai_retour_minimal_ans, delai_retour_conseille_ans) VALUES ($1, $2, 'Astéracées', $3, 3)`,
    [famille, fermeId, DELAI_MINIMAL_ASTERACEES],
  );
  await bd.query(
    `INSERT INTO espece (id, ferme_id, famille_id, nom, categorie, perenne, unite_recolte) VALUES ($1, $2, $3, 'Laitue', 'legume', false, 'piece')`,
    [espece, fermeId, famille],
  );
  await bd.query(`INSERT INTO variete (id, ferme_id, espece_id, nom) VALUES ($1, $2, $3, 'Batavia blonde')`, [variete, fermeId, espece]);
  await bd.query(
    `INSERT INTO itineraire (id, ferme_id, espece_id, variete_id, nom, mode, parametres)
     VALUES ($1, $2, $3, $4, 'Batavia de printemps', 'plant_maison', $5)`,
    [itineraire, fermeId, espece, variete, JSON.stringify(PARAMETRES_BATAVIA)],
  );
  await bd.query(`INSERT INTO saison (id, ferme_id, nom, debut, fin) VALUES ($1, $2, '2027', '2027-01-01', '2027-12-31')`, [saison, fermeId]);
  await bd.query(`INSERT INTO zone (id, ferme_id, nom, type_abri) VALUES ($1, $2, 'Tunnel 2', 'tunnel')`, [zone, fermeId]);
  const planches = [randomUUID(), randomUUID()] as const;
  for (const [i, planche] of planches.entries()) {
    await bd.query(
      `INSERT INTO emplacement (id, ferme_id, zone_id, code, sorte, longueur_m, actif_du) VALUES ($1, $2, $3, $4, 'planche', 30, '2026-01-01')`,
      [planche, fermeId, zone, `T2-P0${String(i + 1)}`],
    );
  }
  return { saisonId: saison, itineraireId: itineraire, especeId: espece, familleId: famille, delaiMinimalAns: DELAI_MINIMAL_ASTERACEES, planches };
}

const avecSerieTomates = process.argv.slice(2).includes('--serie-tomates');
const avecPlanSerie = process.argv.slice(2).includes('--plan-serie');
const urlApi = process.env.API_URL ?? '';
const pool = new pg.Pool({ connectionString: variable('DATABASE_URL'), max: 1 });
try {
  const cles = await trousseauDepuisJwks(variable('JWT_CLES_PRIVEES'));
  const parametres = { cles, emetteur: variable('JWT_EMETTEUR'), audience: variable('JWT_AUDIENCE') };
  const fermeId = randomUUID();
  await pool.query(`INSERT INTO ferme (id, nom, fuseau_horaire) VALUES ($1, 'Ferme e2e synchro', 'Europe/Paris')`, [fermeId]);
  const sessions = [];
  for (const role of ['gerant', 'equipier'] as const) {
    const utilisateurId = randomUUID();
    const email = `e2e-${role}-${utilisateurId.slice(0, 8)}@ferme.fr`;
    await pool.query(`INSERT INTO utilisateur (id, email, nom) VALUES ($1, $2, $3)`, [utilisateurId, email, `E2E ${role}`]);
    await pool.query(`INSERT INTO membre (id, utilisateur_id, ferme_id, role) VALUES ($1, $2, $3, $4)`, [
      randomUUID(),
      utilisateurId,
      fermeId,
      role,
    ]);
    sessions.push(
      urlApi === ''
        ? {
            utilisateurId,
            email,
            jetonAcces: await emettreJetonAcces(parametres, utilisateurId, new Date()),
            jetonRenouvellement: 'e2e-'.padEnd(43, 'r'),
          }
        : await sessionDeLApi(pool, urlApi, email),
    );
  }
  const serieTomates = avecSerieTomates ? await amorcerSerieTomates(pool, fermeId) : undefined;
  const planSerie = avecPlanSerie ? await amorcerPlanSerie(pool, fermeId) : undefined;
  const sortie = {
    fermeId,
    sessions,
    ...(serieTomates === undefined ? {} : { serieTomates }),
    ...(planSerie === undefined ? {} : { planSerie }),
  };
  process.stdout.write(`${JSON.stringify(sortie)}\n`);
} finally {
  await pool.end();
}
