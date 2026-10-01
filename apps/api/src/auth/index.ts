/**
 * Authentification (T09) : code à 6 chiffres par e-mail (Q9), jetons d'accès JWT RS256 exposés
 * en JWKS pour PowerSync, jetons de renouvellement opaques pour la session hors ligne.
 *
 * T09b : déconnexion, rotation du jeton de renouvellement, limite par IP, garde qui relit
 * l'utilisateur, expéditeur SMTP. Tickets suivants : clé d'accès (WebAuthn) ; rôle applicatif
 * limité à INSERT/SELECT sur le journal. Voir apps/api/README.md.
 */
export {
  genererCleSignature,
  jwksPublic,
  trousseauDepuisJwks,
  type CleSignature,
  type TrousseauCles,
} from './cles.ts';
export { echapperHtml, expediteurConsole, messageCode, verifierEnTetes, type ExpediteurCourriel, type MessageCourriel } from './courriel.ts';
export { DUREE_JETON_ACCES_S, emettreJetonAcces, verifierJetonAcces } from './jetons.ts';
export { garde, type VariablesAuthentifiees } from './garde.ts';
export { routesAuth } from './routes.ts';
export { DELAI_SMTP_MS, expediteurSmtp, type ExpediteurSmtp, type OptionsSmtp, type SecuriteSmtp } from './courriel-smtp.ts';
