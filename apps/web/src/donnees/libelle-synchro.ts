/**
 * Texte de l'indicateur de synchro de la coquille (T11, data-testid="etat-synchro", sur chaque
 * onglet). JavaScript de démarrage : aucun import de @planif/sync ni de PowerSync (le type seul).
 */
import type { EtatSynchro } from './connecteur.ts';

/** « 1 saisie en attente », « 3 saisies en attente ». */
function enAttenteTexte(n: number): string {
  return n === 1 ? '1 saisie en attente' : `${String(n)} saisies en attente`;
}

/**
 * Libellé de l'état de la synchro. La session expirée prime ; sinon, les saisies pas encore
 * envoyées comptent plus que l'état de la connexion (sauf hors ligne, où les deux se disent).
 */
export function libelleSynchro(etat: EtatSynchro, enAttente: number): string {
  const attente = enAttente > 0 ? enAttenteTexte(enAttente) : null;
  switch (etat) {
    case 'session-expiree':
      return 'Session expirée';
    case 'hors-ligne':
      return attente === null ? 'Hors ligne' : `Hors ligne · ${attente}`;
    case 'synchronise':
      return attente ?? 'À jour';
    case 'connexion':
      return attente ?? 'Connexion…';
  }
}
