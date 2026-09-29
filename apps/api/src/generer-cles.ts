/**
 * `pnpm --filter @planif/api cles [kid]` : écrit sur la sortie standard un JWKS contenant une
 * nouvelle clé privée RS256, à placer (en tête, pour une rotation) dans JWT_CLES_PRIVEES.
 * Rien n'est écrit sur disque.
 */
import { exportJWK, generateKeyPair } from 'jose';

const kid = process.argv[2] ?? `cle-${new Date().toISOString().slice(0, 10)}`;
const { privateKey } = await generateKeyPair('RS256', { extractable: true });
console.log(JSON.stringify({ keys: [{ ...(await exportJWK(privateKey)), kid, alg: 'RS256', use: 'sig' }] }));
