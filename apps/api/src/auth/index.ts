/**
 * Authentification (T09) : code à 6 chiffres par e-mail (Q9), jetons d'accès JWT RS256 exposés
 * en JWKS pour PowerSync, jetons de renouvellement opaques pour la session hors ligne.
 *
 * Tickets suivants (rien dans T09) : clé d'accès (WebAuthn) ; déconnexion et révocation par
 * l'API ; rôle applicatif limité à INSERT/SELECT sur le journal et contrôle des références
 * entre fermes. Voir apps/api/README.md.
 */
export {
  genererCleSignature,
  jwksPublic,
  trousseauDepuisJwks,
  type CleSignature,
  type TrousseauCles,
} from './cles.ts';
export { expediteurConsole, type ExpediteurCourriel, type MessageCourriel } from './courriel.ts';
export { DUREE_JETON_ACCES_S, emettreJetonAcces, verifierJetonAcces } from './jetons.ts';
export { garde, type VariablesAuthentifiees } from './garde.ts';
export { routesAuth } from './routes.ts';
