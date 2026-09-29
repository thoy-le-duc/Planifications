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
 */
import { randomUUID } from 'node:crypto';
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
  process.stdout.write(`${JSON.stringify({ fermeId, sessions })}\n`);
} finally {
  await pool.end();
}
