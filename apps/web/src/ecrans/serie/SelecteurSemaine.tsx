/**
 * Sélecteur de semaine maison (T12b, N8) : remplace <input type="week">, qui n'a pas de sélecteur
 * sur iOS Safari ni sur Firefox Android. Deux flèches (semaine précédente, suivante) et, au
 * milieu, la semaine en clair (« S22 · 31 mai 2027 ») qui ouvre le choix rapide : toutes les
 * semaines ISO d'une année, d'année en année. Contrat : ./test/contrat.ts, « T12b : sélecteur
 * de semaine ».
 *
 * Aucun calcul de semaine ici : semaineIso, lundiDeSemaine et nombreSemainesIso de @planif/core,
 * par ./calculs.ts.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { ANNEE_MAX, ANNEE_MIN, dateCourte, libelleSemaine, semaineDe, semaineDecalee, semainesDeLAnnee } from './calculs.ts';

interface ProprietesSelecteurSemaine {
  /** Semaine choisie, 'AAAA-Www'. */
  readonly semaine: string;
  readonly surChoisir: (semaine: string) => void;
  /** Jour du téléphone, 'AAAA-MM-JJ' : sa semaine est repérée dans le choix rapide. */
  readonly aujourdhui: string;
  /** id de l'étiquette visible « Semaine » (nom accessible du groupe). */
  readonly idEtiquette: string;
}

const FOCALISABLES = 'button:not([disabled])';

function Fleche({ sens }: { readonly sens: 'gauche' | 'droite' }) {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={sens === 'gauche' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
    </svg>
  );
}

function Calendrier() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5zM4 10h16M8 3v4M16 3v4" />
    </svg>
  );
}

export function SelecteurSemaine({ semaine, surChoisir, aujourdhui, idEtiquette }: ProprietesSelecteurSemaine): ReactElement {
  const [annee, setAnnee] = useState<number | null>(null);
  const ouvrirChoix = useRef<HTMLButtonElement>(null);
  const choisie = useRef<HTMLButtonElement>(null);
  const idTitre = useId();
  const ouvert = annee !== null;

  const libelle = libelleSemaine(semaine);
  const precedente = semaineDecalee(semaine, -1);
  const suivante = semaineDecalee(semaine, 1);
  const semaineDuJour = semaineDe(aujourdhui);

  // À l'ouverture : le focus va sur la semaine choisie (le défilement suit).
  useEffect(() => {
    if (ouvert) choisie.current?.focus();
  }, [ouvert]);

  function fermer(): void {
    setAnnee(null);
    ouvrirChoix.current?.focus();
  }

  function clavier(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Escape') {
      // Échap ne ferme que le choix rapide, jamais le formulaire.
      e.preventDefault();
      e.stopPropagation();
      fermer();
      return;
    }
    if (e.key !== 'Tab') return;
    e.stopPropagation();
    const elements = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCALISABLES)];
    const premier = elements[0];
    const dernier = elements.at(-1);
    if (premier === undefined || dernier === undefined) return;
    const actif = document.activeElement;
    if (e.shiftKey && actif === premier) {
      e.preventDefault();
      dernier.focus();
    } else if (!e.shiftKey && actif === dernier) {
      e.preventDefault();
      premier.focus();
    }
  }

  return (
    <div role="group" aria-labelledby={idEtiquette} data-testid="selecteur-semaine" data-semaine={semaine} className="semaine">
      <button
        type="button"
        aria-label="Semaine précédente"
        className="semaine-fleche"
        disabled={precedente === null}
        onClick={() => {
          if (precedente !== null) surChoisir(precedente);
        }}
      >
        <Fleche sens="gauche" />
      </button>
      <button
        ref={ouvrirChoix}
        type="button"
        aria-label={libelle === null ? 'Choisir la semaine' : `Choisir la semaine, ${libelle.numero} · ${libelle.lundi}`}
        aria-haspopup="dialog"
        aria-expanded={ouvert}
        className="semaine-choisie"
        onClick={() => {
          setAnnee(Number(semaine.slice(0, 4)) || Number(aujourdhui.slice(0, 4)));
        }}
      >
        <span data-testid="semaine-libelle" aria-live="polite" className="semaine-libelle">
          {libelle === null ? (
            'Choisir'
          ) : (
            <>
              <strong>{libelle.numero}</strong>
              <span className="semaine-point"> · </span>
              <span>{libelle.lundi}</span>
            </>
          )}
        </span>
        <Calendrier />
      </button>
      <button
        type="button"
        aria-label="Semaine suivante"
        className="semaine-fleche"
        disabled={suivante === null}
        onClick={() => {
          if (suivante !== null) surChoisir(suivante);
        }}
      >
        <Fleche sens="droite" />
      </button>

      {annee !== null && (
        <div
          className="semaine-voile"
          onClick={(e) => {
            if (e.target === e.currentTarget) fermer();
          }}
        >
          <div role="dialog" aria-modal="true" aria-labelledby={idTitre} data-testid="choix-semaines" data-annee={annee} className="semaine-feuille" onKeyDown={clavier}>
            <div className="semaine-feuille-tete">
              <h3 id={idTitre}>Choisir la semaine</h3>
              <button type="button" aria-label="Fermer le choix de semaine" className="semaine-fermer" onClick={fermer}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <div className="semaine-annees">
              <button
                type="button"
                aria-label="Année précédente"
                className="semaine-fleche"
                disabled={annee <= ANNEE_MIN}
                onClick={() => {
                  setAnnee(annee - 1);
                }}
              >
                <Fleche sens="gauche" />
              </button>
              <strong className="semaine-annee">{annee}</strong>
              <button
                type="button"
                aria-label="Année suivante"
                className="semaine-fleche"
                disabled={annee >= ANNEE_MAX}
                onClick={() => {
                  setAnnee(annee + 1);
                }}
              >
                <Fleche sens="droite" />
              </button>
            </div>
            <div className="semaine-grille">
              {semainesDeLAnnee(annee).map((s) => {
                const courante = s.semaine === semaine;
                const classe = `semaine-case${courante ? ' semaine-case-choisie' : ''}${s.semaine === semaineDuJour ? ' semaine-case-jour' : ''}`;
                return (
                  <button
                    key={s.semaine}
                    ref={courante ? choisie : undefined}
                    type="button"
                    data-testid="choix-semaine"
                    data-semaine={s.semaine}
                    aria-current={courante ? 'true' : undefined}
                    className={classe}
                    onClick={() => {
                      surChoisir(s.semaine);
                      fermer();
                    }}
                  >
                    <strong>S{String(s.numero).padStart(2, '0')}</strong>
                    <span>{dateCourte(s.lundi)}</span>
                  </button>
                );
              })}
            </div>
            {semaineDuJour.startsWith(String(annee)) && (
              <p className="semaine-legende">
                <i aria-hidden="true" /> Semaine en cours
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
