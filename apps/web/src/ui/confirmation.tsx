/**
 * Confirmation en un tap (T16) : à part des composants du démarrage, chargée avec les écrans
 * qui en ont besoin (Ferme).
 */
import { BoutonPrincipal, BoutonSecondaire, CARTE } from './elements.tsx';

export interface ProprietesConfirmation {
  readonly titre: string;
  readonly message: string;
  readonly libelleConfirmer: string;
  /** Défaut : « Annuler ». */
  readonly libelleAnnuler?: string;
  readonly surConfirmer: () => void;
  readonly surAnnuler: () => void;
  readonly testId?: string;
}

/** Confirmation en un tap : un gros bouton pour confirmer, un pour annuler. */
export function Confirmation({ titre, message, libelleConfirmer, libelleAnnuler = 'Annuler', surConfirmer, surAnnuler, testId }: ProprietesConfirmation) {
  return (
    <div
      role="alertdialog"
      aria-label={titre}
      data-testid={testId}
      style={{ ...CARTE, border: '2px solid var(--couleur-orange)', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      <strong style={{ fontFamily: 'var(--police-titre)', fontWeight: 800, fontSize: 22 }}>{titre}</strong>
      <p style={{ fontSize: 17 }}>{message}</p>
      <BoutonPrincipal onClick={surConfirmer}>{libelleConfirmer}</BoutonPrincipal>
      <BoutonSecondaire onClick={surAnnuler}>{libelleAnnuler}</BoutonSecondaire>
    </div>
  );
}
