/**
 * Vue 3D (T37) — panneau « Travaux du jour » : les travaux de l'écran Aujourd'hui, numérotés,
 * pour que les ouvriers se repèrent. Composant de présentation : il ne lit ni n'écrit rien ; le
 * tap d'une ligne et « Suivant » appellent `surChoisir(rang)`, la vue fait voler la caméra.
 * Repliable (au téléphone, en bas de l'écran) ; « Suivant » reste visible replié.
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
}

export function PanneauTravaux3d({ travaux, actif, surChoisir, replieDepart = false }: ProprietesPanneauTravaux3d) {
  const [replie, setReplie] = useState(replieDepart);
  if (travaux.length === 0) return null;
  const suivant = travailSuivant(travaux, actif);
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
