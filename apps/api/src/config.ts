/**
 * Configuration du démarrage, lue depuis l'environnement. Sans effet de bord à l'import : index.ts
 * appelle `lireConfig(process.env)`, écrit le message d'erreur et sort en code 1.
 *
 * Variables (aucune valeur secrète par défaut dans le code) :
 *   DATABASE_URL       Postgres (obligatoire)
 *   JWT_CLES_PRIVEES   JWKS de clés privées RS256, la première signe (obligatoire) ;
 *                      `pnpm --filter @planif/api cles` en génère une
 *   JWT_EMETTEUR       claim iss (obligatoire)
 *   JWT_AUDIENCE       claim aud, celle configurée dans PowerSync (obligatoire)
 *   PORT               3000 par défaut
 *   COURRIEL_CONSOLE   « 1 » pour écrire les e-mails dans la console (développement seulement :
 *                      les codes y apparaissent en clair, refusé si NODE_ENV=production). Aucun
 *                      service d'envoi réel dans T09 : sans cette variable, l'API ne démarre pas.
 *   CORS_ORIGINES      origines autorisées à appeler l'API depuis un navigateur, séparées par des
 *                      virgules (ex. https://app.planif.fr,http://localhost:4174). Liste blanche
 *                      exacte, aucune par défaut : sans elle, seule la même origine fonctionne.
 */

export interface Config {
  readonly databaseUrl: string;
  /** JWKS brut, lu ensuite par trousseauDepuisJwks. */
  readonly jwtClesPrivees: string;
  readonly emetteur: string;
  readonly audience: string;
  readonly port: number;
  readonly courrielConsole: boolean;
  /** Origines CORS autorisées ; absent si CORS_ORIGINES est vide. */
  readonly corsOrigines?: readonly string[];
}

type Environnement = Readonly<Record<string, string | undefined>>;

const PORT_PAR_DEFAUT = 3000;

function obligatoire(env: Environnement, nom: string): string {
  const valeur = env[nom] ?? '';
  if (valeur === '') throw new Error(`Variable d'environnement ${nom} absente ou vide.`);
  return valeur;
}

function lirePort(env: Environnement): number {
  const brut = env.PORT ?? '';
  if (brut === '') return PORT_PAR_DEFAUT;
  const port = Number(brut);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Variable d'environnement PORT invalide : « ${brut} ».`);
  }
  return port;
}

/** Origine exacte (schéma, hôte, port), sans chemin : « https://app.planif.fr ». */
function lireOrigine(brut: string): string {
  let url: URL;
  try {
    url = new URL(brut);
  } catch {
    throw new Error(`CORS_ORIGINES : « ${brut} » n'est pas une origine.`);
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.origin !== brut) {
    throw new Error(`CORS_ORIGINES : « ${brut} » n'est pas une origine exacte (https://hote[:port], sans / final).`);
  }
  return url.origin;
}

export function lireCorsOrigines(env: Environnement): readonly string[] {
  return (env.CORS_ORIGINES ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o !== '')
    .map(lireOrigine);
}

export function lireConfig(env: Environnement): Config {
  const databaseUrl = obligatoire(env, 'DATABASE_URL');
  const jwtClesPrivees = obligatoire(env, 'JWT_CLES_PRIVEES');
  const emetteur = obligatoire(env, 'JWT_EMETTEUR');
  const audience = obligatoire(env, 'JWT_AUDIENCE');
  const port = lirePort(env);
  const corsOrigines = lireCorsOrigines(env);

  if (env.COURRIEL_CONSOLE !== '1') {
    throw new Error(
      "COURRIEL_CONSOLE : aucun service d'envoi d'e-mail configuré (ticket suivant). En développement : COURRIEL_CONSOLE=1.",
    );
  }
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'COURRIEL_CONSOLE=1 refusé en production : les codes de connexion apparaîtraient en clair dans les journaux.',
    );
  }
  return {
    databaseUrl,
    jwtClesPrivees,
    emetteur,
    audience,
    port,
    courrielConsole: true,
    ...(corsOrigines.length > 0 ? { corsOrigines } : {}),
  };
}
