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
 *                      les codes y apparaissent en clair, refusé si NODE_ENV=production). Prime
 *                      sur SMTP_* hors production.
 *   SMTP_HOTE          relais SMTP du fournisseur d'e-mail (T09b) ; sans lui ni COURRIEL_CONSOLE,
 *                      l'API ne démarre pas
 *   SMTP_SECURITE      tls | starttls | aucune, défaut starttls ; « aucune » refusée sauf
 *                      NODE_ENV=development exactement
 *   SMTP_PORT          défaut 465 (tls), 587 (starttls), 25 (aucune)
 *   SMTP_EXPEDITEUR    en-tête From (obligatoire avec SMTP_HOTE)
 *   SMTP_UTILISATEUR, SMTP_MOT_DE_PASSE   identifiants du relais : les deux ou aucun
 *   PROXY_DE_CONFIANCE « 1 » derrière le proxy de production : l'adresse IP du client (limite par
 *                      IP) est lue dans la dernière valeur de X-Forwarded-For. Sinon « 0 » ou absente :
 *                      adresse de la socket, en-têtes ignorés
 *   CORS_ORIGINES      origines autorisées à appeler l'API depuis un navigateur, séparées par des
 *                      virgules (ex. https://app.planif.fr,http://localhost:4174). Liste blanche
 *                      exacte, aucune par défaut : sans elle, seule la même origine fonctionne.
 */
import type { OptionsSmtp, SecuriteSmtp } from './auth/courriel-smtp.ts';

export interface Config {
  readonly databaseUrl: string;
  /** JWKS brut, lu ensuite par trousseauDepuisJwks. */
  readonly jwtClesPrivees: string;
  readonly emetteur: string;
  readonly audience: string;
  readonly port: number;
  /** Expéditeur que index.ts construit. */
  readonly courriel: ConfigCourriel;
  /** PROXY_DE_CONFIANCE=1 : adresse du client lue dans X-Forwarded-For (limite par IP). */
  readonly proxyDeConfiance: boolean;
  /** Origines CORS autorisées ; absent si CORS_ORIGINES est vide. */
  readonly corsOrigines?: readonly string[];
}

export type ConfigCourriel = { readonly type: 'console' } | ({ readonly type: 'smtp' } & Omit<OptionsSmtp, 'delaiMs'>);

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

  const courriel = lireCourriel(env);
  const proxyDeConfiance = lireProxyDeConfiance(env);
  return {
    databaseUrl,
    jwtClesPrivees,
    emetteur,
    audience,
    port,
    courriel,
    proxyDeConfiance,
    ...(corsOrigines.length > 0 ? { corsOrigines } : {}),
  };
}

const PORTS_SMTP: Readonly<Record<SecuriteSmtp, number>> = { tls: 465, starttls: 587, aucune: 25 };

function estSecuriteSmtp(v: string): v is SecuriteSmtp {
  return Object.hasOwn(PORTS_SMTP, v);
}

/** Valeur non vide, ou undefined (absente ou vide). */
function facultative(env: Environnement, nom: string): string | undefined {
  const valeur = env[nom] ?? '';
  return valeur === '' ? undefined : valeur;
}

/**
 * Expéditeur d'e-mail : COURRIEL_CONSOLE=1 (développement), sinon le relais SMTP. Aucun message
 * d'erreur ne contient SMTP_MOT_DE_PASSE.
 */
function lireCourriel(env: Environnement): ConfigCourriel {
  const production = env.NODE_ENV === 'production';
  if (env.COURRIEL_CONSOLE === '1') {
    if (production) {
      throw new Error(
        'COURRIEL_CONSOLE=1 refusé en production : les codes de connexion apparaîtraient en clair dans les journaux.',
      );
    }
    return { type: 'console' };
  }
  const hote = facultative(env, 'SMTP_HOTE');
  if (hote === undefined) {
    throw new Error(
      "Aucun service d'envoi d'e-mail : poser SMTP_HOTE (relais SMTP du fournisseur), ou COURRIEL_CONSOLE=1 en développement.",
    );
  }

  const securiteBrute = facultative(env, 'SMTP_SECURITE') ?? 'starttls';
  if (!estSecuriteSmtp(securiteBrute)) {
    throw new Error(`SMTP_SECURITE invalide : « ${securiteBrute} » (tls, starttls ou aucune).`);
  }
  // Liste blanche : NODE_ENV=development exactement. Absente, vide, « test », « staging »… : refus.
  if (securiteBrute === 'aucune' && env.NODE_ENV !== 'development') {
    throw new Error(
      'SMTP_SECURITE=aucune refusé hors NODE_ENV=development : identifiants et codes passeraient en clair sur le réseau.',
    );
  }

  const portBrut = facultative(env, 'SMTP_PORT');
  let port = PORTS_SMTP[securiteBrute];
  if (portBrut !== undefined) {
    port = Number(portBrut);
    if (!/^\d+$/.test(portBrut) || port < 1 || port > 65_535) {
      throw new Error(`Variable d'environnement SMTP_PORT invalide : « ${portBrut} ».`);
    }
  }

  const expediteur = obligatoire(env, 'SMTP_EXPEDITEUR');
  if (/[\r\n]/.test(expediteur)) throw new Error('SMTP_EXPEDITEUR refusé : retour à la ligne (injection d’en-tête).');

  const utilisateur = facultative(env, 'SMTP_UTILISATEUR');
  const motDePasse = facultative(env, 'SMTP_MOT_DE_PASSE');
  if ((utilisateur === undefined) !== (motDePasse === undefined)) {
    throw new Error('SMTP_UTILISATEUR et SMTP_MOT_DE_PASSE vont ensemble : les deux ou aucun.');
  }
  return {
    type: 'smtp',
    hote,
    port,
    securite: securiteBrute,
    expediteur,
    ...(utilisateur === undefined || motDePasse === undefined ? {} : { utilisateur, motDePasse }),
  };
}

/** PROXY_DE_CONFIANCE : « 1 », sinon absente, vide ou « 0 » ; une faute de frappe est refusée. */
function lireProxyDeConfiance(env: Environnement): boolean {
  const brut = env.PROXY_DE_CONFIANCE ?? '';
  if (brut === '1') return true;
  if (brut === '' || brut === '0') return false;
  throw new Error(`PROXY_DE_CONFIANCE invalide : « ${brut} » (1, 0 ou absente).`);
}
