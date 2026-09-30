/**
 * Récolte en trois gestes (T13, maquette Saisie) : la culture parmi les récoltes en cours, la
 * quantité au pavé géant, « Valider ». L'unité est préremplie depuis la culture
 * (espece.unite_recolte). Valider écrit tout de suite, sans confirmation (saisie manuelle,
 * principe 3) : « Annuler » reste possible 10 s, puis depuis l'historique.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { UniteRecolte } from '@planif/core';
import { codesEmplacements, dateCourte, nomCulture, quantiteAvecUnite, type Culture, type DerniereRecolte } from './calculs.ts';
import { useFocusDuDialogue } from './dialogue.ts';
import { appuyer, quantiteDe, type Touche } from './pave.ts';

/** Unités proposées, dans l'ordre du sélecteur, et leur libellé. */
const UNITES: readonly { readonly id: UniteRecolte; readonly libelle: string }[] = [
  { id: 'kg', libelle: 'kg' },
  { id: 'botte', libelle: 'Bottes' },
  { id: 'piece', libelle: 'Pièces' },
  { id: 'barquette', libelle: 'Barquettes' },
];

const CHIFFRES: readonly Touche[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

export interface ProprietesRecolte {
  /** Culture déjà choisie (tâche de début de récolte) : pas de première étape. */
  readonly culture: Culture | null;
  readonly recoltesEnCours: readonly Culture[];
  readonly dernieres: ReadonlyMap<string, DerniereRecolte>;
  readonly surValider: (culture: Culture, quantite: number, unite: UniteRecolte) => void;
  readonly surFermer: () => void;
  /** Échec de la dernière écriture, montré dans la récolte (l'écran est dessous). */
  readonly erreur?: string | null;
}

function IconeRetour() {
  return (
    <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function IconeEffacer() {
  return (
    <svg aria-hidden="true" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1Z" />
      <path d="m16 9-5 6M11 9l5 6" />
    </svg>
  );
}

export function IconeCoche({ taille = 26 }: { readonly taille?: number }) {
  return (
    <svg aria-hidden="true" width={taille} height={taille} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/** Panier de la maquette (« Peser », « Noter une récolte »). */
export function IconePanier({ taille = 28 }: { readonly taille?: number }) {
  return (
    <svg aria-hidden="true" width={taille} height={taille} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16l-1.5 11a2 2 0 0 1-2 1.7H7.5a2 2 0 0 1-2-1.7L4 7Z" />
      <path d="M9 7V5a3 3 0 0 1 6 0v2" />
    </svg>
  );
}

/** Taille de la quantité : 84 px (maquette) tant qu'elle tient à 360 px de large. */
function classeQuantite(texte: string): string {
  return texte.length <= 4 ? 'auj-quantite' : texte.length <= 6 ? 'auj-quantite auj-quantite-longue' : 'auj-quantite auj-quantite-tres-longue';
}

/** Libellé de l'unité à côté de la quantité : « kg », « bottes », « barquette ». */
function uniteAffichee(quantite: number, u: UniteRecolte): string {
  return quantiteAvecUnite(quantite, u).replace(/^\S+ /, '');
}

export function Recolte({ culture: initiale, recoltesEnCours, dernieres, surValider, surFermer, erreur = null }: ProprietesRecolte) {
  const [culture, setCulture] = useState<Culture | null>(initiale);
  const [unite, setUnite] = useState<UniteRecolte>(initiale?.unite ?? 'kg');
  const [texte, setTexte] = useState('');
  const retour = useRef<HTMLButtonElement>(null);
  const garderFocus = useFocusDuDialogue();
  const radios = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    retour.current?.focus();
  }, []);

  const quantite = quantiteDe(texte);
  const valide = culture !== null && quantite > 0;
  const affichee = texte === '' ? '0' : texte;
  const libelleUnite = uniteAffichee(quantite === 0 ? 2 : quantite, unite);
  const valider = () => {
    if (culture !== null && quantite > 0) surValider(culture, quantite, unite);
  };
  const toucher = (t: Touche) => {
    setTexte((x) => appuyer(x, t));
  };

  function choisir(c: Culture): void {
    setCulture(c);
    setUnite(c.unite);
    setTexte('');
  }

  // Clavier physique (tablette, ordinateur) : chiffres, virgule ou point, effacement, Entrée, Échap.
  function surTouche(e: KeyboardEvent<HTMLDivElement>): void {
    garderFocus(e);
    if (e.key === 'Escape') {
      e.preventDefault();
      surFermer();
      return;
    }
    if (culture === null) return;
    const cible = e.target instanceof HTMLElement ? e.target : null;
    if (cible?.getAttribute('role') === 'radio' && e.key.startsWith('Arrow')) return;
    if (/^[0-9]$/.test(e.key)) toucher(e.key as Touche);
    else if (e.key === ',' || e.key === '.') toucher(',');
    else if (e.key === 'Backspace') toucher('effacer');
    else if (e.key === 'Enter' && cible?.tagName !== 'BUTTON') valider();
    else return;
    e.preventDefault();
  }

  function surFlecheUnite(e: KeyboardEvent<HTMLButtonElement>, i: number): void {
    const pas = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (pas === 0) return;
    e.preventDefault();
    const j = (i + pas + UNITES.length) % UNITES.length;
    const u = UNITES[j];
    if (u === undefined) return;
    setUnite(u.id);
    radios.current[j]?.focus();
  }

  const codes = culture === null ? null : codesEmplacements(culture.emplacements);
  const derniere = culture === null ? undefined : dernieres.get(culture.cibleId);

  return (
    <div className="auj-voile auj-voile-plein">
      <div role="dialog" aria-modal="true" aria-label={culture === null ? 'Récolte' : `Récolte : ${nomCulture(culture)}`} className="auj-recolte" onKeyDown={surTouche}>
        <div className="auj-recolte-tete">
          <button ref={retour} type="button" aria-label="Retour" className="auj-retour" onClick={surFermer}>
            <IconeRetour />
          </button>
          <div className="auj-recolte-titres">
            <span className="auj-recolte-sur">{culture === null ? 'Quelle culture ?' : [codes, nomCulture(culture)].filter((x) => x !== null).join(' · ')}</span>
            <span className="auj-recolte-titre">Récolte</span>
          </div>
        </div>

        {culture === null ? (
          recoltesEnCours.length === 0 ? (
            <p className="auj-recolte-vide">Aucune récolte en cours cette semaine. Les cultures dont la fenêtre de récolte est ouverte s’afficheront ici.</p>
          ) : (
            <ul className="auj-choix">
              {recoltesEnCours.map((c) => (
                <li key={c.cibleId}>
                  <button type="button" data-testid="choix-recolte" data-cible={c.cibleId} className="auj-choix-bouton" onClick={() => { choisir(c); }}>
                    <span aria-hidden="true" className={`auj-bande auj-bande-${c.famille ?? 'neutre'}`} />
                    <span className="auj-choix-corps">
                      <span className="auj-choix-nom">{c.espece}</span>
                      {c.variete !== null && <span className="auj-choix-variete">{c.variete}</span>}
                    </span>
                    {codesEmplacements(c.emplacements) !== null && <span className="auj-code">{codesEmplacements(c.emplacements)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : (
          <>
            <div className="auj-recolte-carte">
              <div role="radiogroup" aria-label="Unité" className="auj-unites">
                {UNITES.map((u, i) => {
                  const coche = u.id === unite;
                  return (
                    <button
                      key={u.id}
                      ref={(el) => {
                        radios.current[i] = el;
                      }}
                      type="button"
                      role="radio"
                      aria-checked={coche}
                      tabIndex={coche ? 0 : -1}
                      className="auj-unite"
                      onClick={() => {
                        setUnite(u.id);
                      }}
                      onKeyDown={(e) => {
                        surFlecheUnite(e, i);
                      }}
                    >
                      {u.libelle}
                    </button>
                  );
                })}
              </div>
              <div className="auj-quantite-ligne">
                <span data-testid="quantite" className={`${classeQuantite(affichee)}${texte === '' ? ' auj-quantite-vide' : ''}`}>
                  {affichee}
                </span>
                <span className="auj-quantite-unite">{libelleUnite}</span>
              </div>
              {derniere !== undefined && (
                <span className="auj-recolte-rappel">
                  Dernière récolte : {quantiteAvecUnite(derniere.quantite, derniere.unite)} le {dateCourte(derniere.date)}
                </span>
              )}
            </div>

            <div className="auj-pave">
              {CHIFFRES.map((c) => (
                <button key={c} type="button" className="auj-touche" onClick={() => { toucher(c); }}>
                  {c}
                </button>
              ))}
              <button type="button" aria-label="Virgule" className="auj-touche auj-touche-annexe" onClick={() => { toucher(','); }}>
                ,
              </button>
              <button type="button" className="auj-touche" onClick={() => { toucher('0'); }}>
                0
              </button>
              <button type="button" aria-label="Effacer" className="auj-touche auj-touche-annexe" onClick={() => { toucher('effacer'); }}>
                <IconeEffacer />
              </button>
            </div>

            <div className="auj-recolte-pied">
              {erreur !== null && (
                <p role="alert" className="auj-erreur">
                  {erreur}
                </p>
              )}
              <button type="button" className="auj-valider" disabled={!valide} onClick={valider}>
                <IconeCoche />
                {valide ? `Valider ${quantiteAvecUnite(quantite, unite)}` : 'Valider'}
              </button>
              <span className="auj-recolte-note">Enregistré sur le téléphone, envoyé dès que le réseau revient. Annulable 10 secondes.</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
