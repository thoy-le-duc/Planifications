/**
 * Vue 3D (T37) — panneau « Travaux du jour » : les travaux de l'écran Aujourd'hui, numérotés,
 * pour que les ouvriers se repèrent. Composant de présentation : il ne lit ni n'écrit rien ; le
 * tap d'une ligne et « Suivant » appellent `surChoisir(rang)`, la vue fait voler la caméra.
 * Repliable (au téléphone, en bas de l'écran) ; « Suivant » reste visible replié. T37b : une zone
 * vivante annonce le travail actif (l'ouvrier qui ne regarde pas l'écran l'entend), et un message
 * dit quand la lecture des travaux a échoué.
 */
import { useState } from 'react';
import { travailSuivant, type Travail3d } from './choix-travail.ts';

export interface ProprietesPanneauTravaux3d {
  readonly travaux: readonly Travail3d[];
  /** Rang du travail mis en évidence, ou null. */
  readonly actif: number | null;
  readonly surChoisir: (rang: number) => void;
  /** Replié à l'ouverture (faux par défaut). */
  readonly replieDepart?: boolean;
  /** La lecture des travaux a échoué (T37b) : un message le dit, même sans travaux. */
  readonly erreur?: boolean;
}

/** Phrase du panneau quand la lecture des travaux échoue. */
export const TEXTE_ERREUR_TRAVAUX = 'Impossible de lire les travaux du jour';

export function PanneauTravaux3d({ travaux, actif, surChoisir, replieDepart = false, erreur = false }: ProprietesPanneauTravaux3d) {
  const [replie, setReplie] = useState(replieDepart);
  if (travaux.length === 0 && !erreur) return null;
  const suivant = travailSuivant(travaux, actif);
  const annonce = actif === null ? '' : (travaux.find((t) => t.rang === actif)?.texte ?? '');
  return (
    <section data-testid="travaux-du-jour-3d" role="region" aria-label="Travaux du jour" data-nombre={travaux.length} data-replie={replie ? 'oui' : 'non'} data-actif={actif === null ? '' : String(actif)} className="plan3d-travaux">
      <div className="plan3d-travaux-tete">
        <h2 className="plan3d-travaux-titre">Travaux du jour</h2>
        <button
          type="button"
          data-testid="travail-suivant-3d"
          className="plan3d-travaux-bouton plan3d-travaux-suivant"
          aria-label="Suivant"
          disabled={suivant === null}
          onClick={() => {
            if (suivant !== null) surChoisir(suivant);
          }}
        >
          Suivant
        </button>
        <button
          type="button"
          data-testid="travaux-replier-3d"
          className="plan3d-travaux-bouton plan3d-travaux-replier"
          aria-expanded={!replie}
          aria-label={replie ? 'Déplier les travaux du jour' : 'Replier les travaux du jour'}
          onClick={() => {
            setReplie((r) => !r);
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: replie ? 'rotate(180deg)' : undefined }}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </div>
      {erreur && (
        <p data-testid="travaux-erreur-3d" role="alert" className="plan3d-travaux-erreur">
          {TEXTE_ERREUR_TRAVAUX}
        </p>
      )}
      {/* Présente dès le premier rendu : un lecteur d'écran n'annonce que le texte d'une zone qui existait déjà. */}
      <p data-testid="travail-annonce-3d" aria-live="polite" className="plan3d-annonce">
        {annonce}
      </p>
      <ul data-testid="travaux-liste-3d" role="list" className="plan3d-travaux-liste" hidden={replie}>
        {travaux.map((t) => (
          <li key={t.cle} data-testid="travail-3d" data-rang={t.rang} data-cle={t.cle} data-planche={t.planche ?? ''} aria-current={t.rang === actif ? 'true' : undefined} className={t.enRetard ? 'plan3d-travail plan3d-travail-retard' : 'plan3d-travail'}>
            <button
              type="button"
              data-testid="aller-travail-3d"
              className="plan3d-travaux-bouton plan3d-travail-aller"
              disabled={t.planche === null}
              onClick={() => {
                surChoisir(t.rang);
              }}
            >
              {t.texte}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
