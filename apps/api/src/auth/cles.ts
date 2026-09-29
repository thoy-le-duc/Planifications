/**
 * Clés de signature des jetons d'accès (RS256, accepté par PowerSync via JWKS).
 *
 * Rotation : la variable JWT_CLES_PRIVEES est un JWKS de clés privées. La première signe, les
 * suivantes ne font que vérifier. Pour tourner : ajouter la nouvelle clé en tête, redéployer,
 * puis retirer l'ancienne une fois passée la durée de vie d'un jeton d'accès (1 h). Les sessions
 * ne tombent pas : le jeton de renouvellement est opaque, indépendant des clés.
 */
import { exportJWK, generateKeyPair, importJWK, type CryptoKey, type JSONWebKeySet, type JWK } from 'jose';

export const ALGORITHME = 'RS256';

export interface CleSignature {
  readonly kid: string;
  readonly privee: CryptoKey;
  readonly publique: CryptoKey;
}

export interface TrousseauCles {
  /** Signe tous les nouveaux jetons. */
  readonly active: CleSignature;
  /** Vérifient encore (recouvrement de rotation). */
  readonly precedentes: readonly CleSignature[];
}

/** Nouvelle paire RS256 (tests, premier déploiement). La clé privée n'est pas exportable. */
export async function genererCleSignature(kid: string): Promise<CleSignature> {
  const { privateKey, publicKey } = await generateKeyPair(ALGORITHME);
  return { kid, privee: privateKey, publique: publicKey };
}

function erreur(message: string): Error {
  return new Error(`JWT_CLES_PRIVEES : ${message}`);
}

function estObjet(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

async function importer(jwk: JWK, kid: string): Promise<CryptoKey> {
  const cle = await importJWK(jwk, ALGORITHME);
  if (cle instanceof Uint8Array) throw erreur(`la clé « ${kid} » n'est pas une clé RSA`);
  return cle;
}

async function cleDepuisJwk(brute: unknown, position: number): Promise<CleSignature> {
  if (!estObjet(brute)) throw erreur(`la clé n° ${String(position + 1)} n'est pas un objet`);
  const { kid, kty, alg, d, n, e } = brute;
  if (typeof kid !== 'string' || kid === '') throw erreur(`la clé n° ${String(position + 1)} n'a pas de kid`);
  if (kty !== 'RSA') throw erreur(`la clé « ${kid} » n'est pas une clé RSA`);
  if (alg !== undefined && alg !== ALGORITHME) throw erreur(`la clé « ${kid} » n'est pas ${ALGORITHME}`);
  if (typeof d !== 'string' || typeof n !== 'string' || typeof e !== 'string') {
    throw erreur(`la clé « ${kid} » n'est pas une clé privée RSA complète`);
  }
  try {
    const privee = await importer(brute, kid);
    const publique = await importer({ kty: 'RSA', n, e }, kid);
    return { kid, privee, publique };
  } catch (cause: unknown) {
    throw new Error(`JWT_CLES_PRIVEES : la clé « ${kid} » est illisible`, { cause });
  }
}

/** Lit JWT_CLES_PRIVEES (JWKS de clés privées RS256). Lève une erreur claire si invalide. */
export async function trousseauDepuisJwks(json: string): Promise<TrousseauCles> {
  let brut: unknown;
  try {
    brut = JSON.parse(json);
  } catch {
    throw erreur('JSON invalide');
  }
  if (!estObjet(brut) || !Array.isArray(brut.keys)) throw erreur('un objet { "keys": [...] } est attendu');
  const bruts: unknown[] = brut.keys;
  if (bruts.length === 0) throw erreur('aucune clé');
  const cles = await Promise.all(bruts.map((k, i) => cleDepuisJwk(k, i)));
  const vus = new Set<string>();
  for (const { kid } of cles) {
    if (vus.has(kid)) throw erreur(`kid « ${kid} » en double`);
    vus.add(kid);
  }
  const [active, ...precedentes] = cles;
  if (active === undefined) throw erreur('aucune clé');
  return { active, precedentes };
}

/** Ce que sert GET /.well-known/jwks.json : parties publiques seules, clé active en tête. */
export async function jwksPublic(trousseau: TrousseauCles): Promise<JSONWebKeySet> {
  const keys = await Promise.all(
    [trousseau.active, ...trousseau.precedentes].map(async ({ kid, publique }): Promise<JWK> => {
      // Liste blanche des membres publics : aucun membre privé ne peut sortir.
      const { n, e } = await exportJWK(publique);
      if (n === undefined || e === undefined) throw new Error(`clé « ${kid} » : partie publique RSA illisible`);
      return { kty: 'RSA', n, e, kid, alg: ALGORITHME, use: 'sig' };
    }),
  );
  return { keys };
}

/** Clé qui vérifie un jeton portant ce kid, ou undefined (clé retirée ou inconnue). */
export function cleDeVerification(trousseau: TrousseauCles, kid: string | undefined): CryptoKey | undefined {
  if (kid === undefined) return undefined;
  return [trousseau.active, ...trousseau.precedentes].find((c) => c.kid === kid)?.publique;
}
