/**
 * T51 — Une densité « en contenants » (trous par pain) ne se compte que sur une gouttière : sur
 * une planche ou un rang, il n'y a pas de pains. Règle pure, rejouée par le serveur en fin de lot
 * (apps/api/src/sync/serie.ts) et par le formulaire de la série avant d'écrire.
 */
import type { ParametresItineraire, SorteEmplacement } from '../domaine/index.ts';
import type { ErreurSaisie } from './index.ts';

export const MESSAGE_CONTENANTS_HORS_GOUTTIERE =
  'une densité en contenants (trous par pain) se compte sur une gouttière : choisissez une gouttière, ou une autre façon de compter pour une planche';

/** null si la densité de `parametres` se compte sur cette sorte d'emplacement, sinon l'erreur. */
export function verifierDensiteSurEmplacement(parametres: ParametresItineraire, sorte: SorteEmplacement): ErreurSaisie | null {
  const facon = (parametres as { readonly densite?: { readonly facon?: unknown } }).densite?.facon;
  if (facon !== 'contenants' || sorte === 'gouttiere') return null;
  return { code: 'incoherent', champ: 'emplacement_id', raison: 'contenants_hors_gouttiere', message: MESSAGE_CONTENANTS_HORS_GOUTTIERE };
}
