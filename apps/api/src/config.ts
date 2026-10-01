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
 *                      les codes y apparaissent en clair, refusé sauf NODE_ENV=development
 *                      exactement). Prime alors sur SMTP_*.
 *   SMTP_HOTE          relais SMTP du fournisseur d'e-mail (T09b) ; sans lui ni COURRIEL_CONSOLE,
 *                      l'API ne démarre pas
 *   SMTP_SECURITE      tls | starttls | aucune, défaut starttls ; « aucune » refusée sauf
 *                      NODE_ENV=development exactement
 *   SMTP_PORT          défaut 465 (tls), 587 (starttls), 25 (aucune)
 *   SMTP_EXPEDITEUR    en-tête From (obligatoire avec SMTP_HOTE) : une seule adresse, nue ou
 *                      « Nom <adresse> » / « "Nom" <adresse> » ; une liste est refusée
 *   SMTP_UTILISATEUR, SMTP_MOT_DE_PASSE   identifiants du relais : les deux ou aucun ; mot de
 *                      passe d'au moins 12 caractères
 *
 *   Production : relais SMTP de Brevo (T09c, hébergé en UE, Q14) :
 *     SMTP_HOTE=smtp-relay.brevo.com   SMTP_PORT=587 (défaut de starttls)
 *     SMTP_SECURITE=starttls (défaut ; TLS obligatoire, rien ne part sans lui)
 *     SMTP_EXPEDITEUR=adresse du domaine d'envoi validé chez Brevo (SPF, DKIM, DMARC) ; une
 *                      adresse nue reçoit le nom « Planifications »
 *     SMTP_UTILISATEUR, SMTP_MOT_DE_PASSE = identifiant et clé SMTP donnés par Brevo (la clé
 *                      fait bien plus de 12 caractères, le minimum exigé)
 *   Identifiants : dans les secrets de production uniquement, jamais dans le dépôt, un fichier
 *   versionné ou une session Claude. Le relais est vérifié au démarrage (demarrage.ts) ; s'il ne
 *   répond pas, l'API démarre quand même (la vérification se fait après l'écoute, sans la
 *   retarder) et l'erreur est écrite sur la sortie d'erreur.
 *
 *   PROXY_DE_CONFIANCE « 1 » derrière exactement un proxy de confiance (production) : l'adresse IP
 *                      du client (limite par IP) est la dernière valeur de X-Forwarded-For, si
 *                      c'est une adresse IP valide. Sinon « 0 » ou absente :
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

/** Une clé SMTP de fournisseur (Brevo : bien plus longue) ; en dessous, une faute de saisie. */
const LONGUEUR_MIN_MOT_DE_PASSE_SMTP = 12;

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
  if (env.COURRIEL_CONSOLE === '1') {
    // Liste blanche, comme SMTP_SECURITE=aucune : NODE_ENV=development exactement. Absente, vide,
    // « production », « prod », « test »… : refus, jamais de repli silencieux sur SMTP.
    if (env.NODE_ENV !== 'development') {
      throw new Error(
        'COURRIEL_CONSOLE=1 refusé hors NODE_ENV=development : les codes de connexion apparaîtraient en clair dans les journaux.',
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
  if (!estAdresseExpediteur(expediteur)) {
    throw new Error(
      `SMTP_EXPEDITEUR invalide : « ${expediteur} » (une seule adresse, ex. connexion@planif.fr ou Planifications <connexion@planif.fr>).`,
    );
  }

  const utilisateur = facultative(env, 'SMTP_UTILISATEUR');
  const motDePasse = facultative(env, 'SMTP_MOT_DE_PASSE');
  if ((utilisateur === undefined) !== (motDePasse === undefined)) {
    throw new Error('SMTP_UTILISATEUR et SMTP_MOT_DE_PASSE vont ensemble : les deux ou aucun.');
  }
  // Jamais la valeur dans le message : seulement le nom de la variable et la règle.
  if (motDePasse !== undefined && motDePasse.length < LONGUEUR_MIN_MOT_DE_PASSE_SMTP) {
    throw new Error(
      `SMTP_MOT_DE_PASSE refusé : il en faut au moins ${String(LONGUEUR_MIN_MOT_DE_PASSE_SMTP)} caractères (clé SMTP du fournisseur).`,
    );
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

/** Adresse simple, sans espace, virgule, point-virgule, chevron ni guillemet. */
const ADRESSE = String.raw`[^\s@<>",;()]+@[^\s@<>",;()]+`;
const EXPEDITEUR_NU = new RegExp(`^${ADRESSE}$`);
/** « Nom <adresse> » (nom sans chevron, guillemet, virgule ni point-virgule) ou « "Nom" <adresse> ». */
const EXPEDITEUR_NOMME = new RegExp(`^(?:[^<>",;@]+|"[^"<>]+") <${ADRESSE}>$`);

/** SMTP_EXPEDITEUR : UNE adresse, éventuellement précédée d'un nom d'affichage ; jamais une liste. */
function estAdresseExpediteur(valeur: string): boolean {
  return EXPEDITEUR_NU.test(valeur) || EXPEDITEUR_NOMME.test(valeur);
}

/** PROXY_DE_CONFIANCE : « 1 », sinon absente, vide ou « 0 » ; une faute de frappe est refusée. */
function lireProxyDeConfiance(env: Environnement): boolean {
  const brut = env.PROXY_DE_CONFIANCE ?? '';
  if (brut === '1') return true;
  if (brut === '' || brut === '0') return false;
  throw new Error(`PROXY_DE_CONFIANCE invalide : « ${brut} » (1, 0 ou absente).`);
}
