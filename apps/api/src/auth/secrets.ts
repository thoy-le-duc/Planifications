/**
 * Codes de connexion et jetons de renouvellement : tirage, empreinte, comparaison.
 *
 * Choix d'empreinte (justifié dans apps/api/README.md) :
 * - code à 6 chiffres : SHA-256 avec un sel aléatoire de 16 octets par code, stocké
 *   « sel.empreinte ». Le sel évite que deux codes identiques aient la même empreinte et toute
 *   table précalculée. Aucune empreinte rapide ne protège 10^6 valeurs d'une attaque hors ligne :
 *   la vraie protection est la durée de vie (10 min), les 5 tentatives et l'usage unique.
 * - jeton de renouvellement : 256 bits aléatoires, SHA-256 sans sel. Un sel n'ajoute rien à un
 *   secret de cette entropie, et l'empreinte doit rester déterministe pour retrouver la ligne
 *   par l'index unique `jeton_hache`.
 * Un HMAC aurait demandé un secret serveur de plus, à faire tourner sans casser les sessions :
 * rien à gagner ici.
 * Comparaisons en temps constant (timingSafeEqual) sur des empreintes de même longueur.
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const LONGUEUR_CODE = 6;

/** Code à 6 chiffres, tiré uniformément par le générateur cryptographique. */
export function tirerCode(): string {
  return String(randomInt(0, 10 ** LONGUEUR_CODE)).padStart(LONGUEUR_CODE, '0');
}

function sha256(...parties: readonly Buffer[]): Buffer {
  const h = createHash('sha256');
  for (const p of parties) h.update(p);
  return h.digest();
}

/** Empreinte salée d'un code : « sel.empreinte », en base64url. */
export function empreinteCode(code: string, sel: Buffer = randomBytes(16)): string {
  return `${sel.toString('base64url')}.${sha256(sel, Buffer.from(code, 'utf8')).toString('base64url')}`;
}

/** Le code correspond-il à l'empreinte ? Temps constant ; faux pour une empreinte mal formée. */
export function codeCorrespond(code: string, empreinte: string): boolean {
  const [sel, attendue, ...reste] = empreinte.split('.');
  if (sel === undefined || attendue === undefined || reste.length > 0) return false;
  const a = Buffer.from(attendue, 'base64url');
  const b = sha256(Buffer.from(sel, 'base64url'), Buffer.from(code, 'utf8'));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Jeton de renouvellement : 32 octets aléatoires, 43 caractères base64url. */
export function tirerJetonRenouvellement(): string {
  return randomBytes(32).toString('base64url');
}

/** Empreinte déterministe d'un jeton de renouvellement (recherche par index unique). */
export function empreinteJeton(jeton: string): string {
  return sha256(Buffer.from(jeton, 'utf8')).toString('base64url');
}
