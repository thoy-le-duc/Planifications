/**
 * Jeton d'accès : JWT RS256 court, signé par la clé active. Il ne porte que l'identité
 * (sub, iss, aud, iat, exp) : jamais la liste des fermes, relue en base à chaque requête.
 */
import { SignJWT, jwtVerify, type JWTHeaderParameters } from 'jose';
import { ALGORITHME, cleDeVerification, type TrousseauCles } from './cles.ts';

/** Durée de vie d'un jeton d'accès, en secondes (1 h au plus : voir la rotation des clés). */
export const DUREE_JETON_ACCES_S = 60 * 60;

export interface ParametresJeton {
  readonly cles: TrousseauCles;
  readonly emetteur: string;
  readonly audience: string;
}

const MOTIF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function estUuid(v: unknown): v is string {
  return typeof v === 'string' && MOTIF_UUID.test(v);
}

export async function emettreJetonAcces(p: ParametresJeton, utilisateurId: string, maintenant: Date): Promise<string> {
  const iat = Math.floor(maintenant.getTime() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: ALGORITHME, kid: p.cles.active.kid, typ: 'JWT' })
    .setSubject(utilisateurId)
    .setIssuer(p.emetteur)
    .setAudience(p.audience)
    .setIssuedAt(iat)
    .setExpirationTime(iat + DUREE_JETON_ACCES_S)
    .sign(p.cles.active.privee);
}

/**
 * Identifiant de l'utilisateur d'un jeton d'accès valide, ou null : signature d'une clé du
 * trousseau (par kid), RS256 seulement (pas de « none »), émetteur, audience, expiration.
 */
export async function verifierJetonAcces(p: ParametresJeton, jeton: string, maintenant: Date): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(
      jeton,
      (entete: JWTHeaderParameters) => {
        const cle = cleDeVerification(p.cles, entete.kid);
        if (cle === undefined) throw new Error('kid inconnu');
        return cle;
      },
      {
        algorithms: [ALGORITHME],
        issuer: p.emetteur,
        audience: p.audience,
        currentDate: maintenant,
        requiredClaims: ['sub', 'exp', 'iat'],
      },
    );
    return estUuid(payload.sub) ? payload.sub.toLowerCase() : null;
  } catch {
    return null;
  }
}
