/**
 * Tests d'acceptation T09 — clés de signature des jetons (sans base).
 *
 * Bibliothèque JWT : `jose` (v6, sans dépendance, standard WebCrypto), dépendance de @planif/api.
 * Algorithme : RS256, accepté par le service PowerSync via JWKS.
 *
 * ── API attendue (apps/api/src/auth/index.ts) ───────────────────────────────────────────────
 *
 * interface CleSignature { readonly kid: string; readonly privee: CryptoKey; readonly publique: CryptoKey }
 *   (CryptoKey : le type exporté par jose, `import type { CryptoKey } from 'jose'` ; le type global
 *   n'existe pas sans la bibliothèque DOM.)
 *
 * interface TrousseauCles {
 *   readonly active: CleSignature;                  // signe tous les nouveaux jetons
 *   readonly precedentes: readonly CleSignature[];  // vérifient encore (recouvrement de rotation)
 * }
 *
 * genererCleSignature(kid: string): Promise<CleSignature>
 *   Nouvelle paire RS256. Sert aux tests et au premier déploiement.
 *
 * trousseauDepuisJwks(json: string): Promise<TrousseauCles>
 *   Lit la variable d'environnement JWT_CLES_PRIVEES : un JWKS (`{"keys": [...]}`) de clés
 *   PRIVÉES RS256, chacune avec son `kid`. La première signe ; les suivantes ne font que vérifier.
 *   Rotation : ajouter la nouvelle clé en tête, redéployer ; retirer l'ancienne une fois passée
 *   la durée de vie d'un jeton d'accès (1 h au plus). Lève une erreur claire si le JSON est
 *   invalide, vide, si une clé n'a pas de `kid`, n'est pas privée, n'est pas RSA, ou si deux clés
 *   ont le même `kid`.
 *
 * jwksPublic(trousseau: TrousseauCles): Promise<JSONWebKeySet>
 *   Ce que sert GET /.well-known/jwks.json : la clé active puis les précédentes, parties publiques
 *   seules, avec kid, kty 'RSA', alg 'RS256', use 'sig'.
 */
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  jwtVerify,
  createLocalJWKSet,
  type JWK,
} from 'jose';
import { describe, expect, it } from 'vitest';
import { genererCleSignature, jwksPublic, trousseauDepuisJwks } from './index.ts';

/** Membres privés d'une JWK RSA : ne doivent jamais sortir dans le JWKS public. */
const MEMBRES_PRIVES = ['d', 'p', 'q', 'dp', 'dq', 'qi'] as const;

async function jwkPrivee(kid: string): Promise<JWK> {
  const { privateKey } = await generateKeyPair('RS256', { extractable: true });
  return { ...(await exportJWK(privateKey)), kid, alg: 'RS256' };
}

describe('T09 : clés de signature', () => {
  it('genererCleSignature crée une paire RS256 qui signe et vérifie', async () => {
    const cle = await genererCleSignature('cle-2026-10');
    expect(cle.kid).toBe('cle-2026-10');
    expect(cle.privee.type).toBe('private');
    expect(cle.publique.type).toBe('public');

    const jeton = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: cle.kid })
      .setSubject('u')
      .sign(cle.privee);
    const { payload } = await jwtVerify(jeton, cle.publique);
    expect(payload.sub).toBe('u');
  });

  it('trousseauDepuisJwks : la première clé signe, les suivantes vérifient', async () => {
    const json = JSON.stringify({ keys: [await jwkPrivee('nouvelle'), await jwkPrivee('ancienne')] });
    const trousseau = await trousseauDepuisJwks(json);
    expect(trousseau.active.kid).toBe('nouvelle');
    expect(trousseau.precedentes.map((c) => c.kid)).toEqual(['ancienne']);

    for (const cle of [trousseau.active, ...trousseau.precedentes]) {
      const jeton = await new SignJWT({}).setProtectedHeader({ alg: 'RS256', kid: cle.kid }).sign(cle.privee);
      await expect(jwtVerify(jeton, cle.publique)).resolves.toBeDefined();
    }
  });

  it('trousseauDepuisJwks refuse une configuration invalide', async () => {
    const publique = await (async () => {
      const { publicKey } = await generateKeyPair('RS256', { extractable: true });
      return { ...(await exportJWK(publicKey)), kid: 'publique', alg: 'RS256' };
    })();
    const sansKid: JWK = { ...(await jwkPrivee('x')) };
    delete sansKid.kid;
    const invalides = [
      'pas du json',
      JSON.stringify({ keys: [] }),
      JSON.stringify({}),
      JSON.stringify({ keys: [sansKid] }),
      JSON.stringify({ keys: [publique] }),
      JSON.stringify({ keys: [await jwkPrivee('double'), await jwkPrivee('double')] }),
    ];
    for (const json of invalides) {
      await expect(trousseauDepuisJwks(json), json.slice(0, 40)).rejects.toThrow();
    }
  });

  it('jwksPublic expose la clé active puis les précédentes, sans aucun membre privé', async () => {
    const active = await genererCleSignature('b');
    const ancienne = await genererCleSignature('a');
    const jwks = await jwksPublic({ active, precedentes: [ancienne] });

    expect(jwks.keys.map((k) => k.kid)).toEqual(['b', 'a']);
    for (const k of jwks.keys) {
      expect(k).toMatchObject({ kty: 'RSA', alg: 'RS256', use: 'sig' });
      for (const m of MEMBRES_PRIVES) {
        expect(k, `membre privé ${m} exposé`).not.toHaveProperty(m);
      }
    }

    // Un jeton signé par l'ancienne clé se vérifie avec ce JWKS (recouvrement de rotation).
    const jeton = await new SignJWT({}).setProtectedHeader({ alg: 'RS256', kid: 'a' }).sign(ancienne.privee);
    await expect(jwtVerify(jeton, createLocalJWKSet(jwks))).resolves.toBeDefined();
  });
});
