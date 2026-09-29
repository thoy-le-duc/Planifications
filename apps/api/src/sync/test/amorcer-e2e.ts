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
 *   node apps/api/src/sync/test/amorcer-e2e.ts
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { emettreJetonAcces, trousseauDepuisJwks } from '../../auth/index.ts';

function variable(nom: string): string {
  const v = process.env[nom] ?? '';
  if (v === '') throw new Error(`variable ${nom} absente`);
  return v;
}

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
    sessions.push({
      utilisateurId,
      email,
      jetonAcces: await emettreJetonAcces(parametres, utilisateurId, new Date()),
      jetonRenouvellement: 'e2e-'.padEnd(43, 'r'),
    });
  }
  process.stdout.write(`${JSON.stringify({ fermeId, sessions })}\n`);
} finally {
  await pool.end();
}
