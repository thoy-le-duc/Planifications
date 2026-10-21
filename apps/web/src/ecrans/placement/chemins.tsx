/**
 * T61 (règle 1) : tracer un chemin dans l'éditeur de placement, point par point, puis régler sa
 * largeur. Chargé à la demande, au premier « Tracer un chemin » (le morceau de l'éditeur ne porte
 * que l'affichage des chemins déjà posés : budget jsPlacementGzKio). Contrat : en-tête de
 * chemins-editeur.test.tsx.
 *
 * L'éditeur garde le brouillon (données seules) ; ce module en fait les gestes (point posé, Entrée,
 * Échap), le verdict du cœur (validerChemin), le changement à donner à `porte.placer` et le
 * panneau. Rien n'est écrit pendant le tracé.
 */
import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import type { ChangementPlacement } from '@planif/sync';
import { validerChemin } from '@planif/core/placement';
import type { Point } from './tuiles.ts';

// Aucun import du morceau de l'éditeur (scripts/placement.test.ts) : ce module ne prend que des types.
const arrondiM = (v: number): number => Math.round(v * 1000) / 1000;

/** Largeur de départ d'un chemin, en mètres. */
const LARGEUR_DEPART_M = 2;

export interface BrouillonChemin {
  readonly id: string;
  readonly points: readonly Point[];
  readonly largeurM: number;
  readonly nom: string;
  /** Le tracé est terminé (2 points au moins) : le chemin est au brouillon. */
  readonly termine: boolean;
}

export const nouveau = (id: string): BrouillonChemin => ({ id, points: [], largeurM: LARGEUR_DEPART_M, nom: '', termine: false });

/** Un point posé sur le plan pendant le tracé (au millimètre). */
export function poser(b: BrouillonChemin, local: Point): BrouillonChemin {
  return b.termine ? b : { ...b, points: [...b.points, { x: arrondiM(local.x), y: arrondiM(local.y) }] };
}

export const terminer = (b: BrouillonChemin): BrouillonChemin => (b.points.length >= 2 ? { ...b, termine: true } : b);

/** Entrée termine le tracé (2 points au moins), Échap l'abandonne (null) ; undefined : touche sans effet ici. */
export function touche(b: BrouillonChemin, cle: string): BrouillonChemin | null | undefined {
  if (b.termine) return undefined;
  if (cle === 'Escape') return null;
  if (cle === 'Enter') return terminer(b);
  return undefined;
}

const verdict = (b: BrouillonChemin) => validerChemin({ points: b.points, largeur_m: b.largeurM });

/** Le chemin terminé et valide, tel que `porte.placer` l'écrit ; vide sinon. */
export function changements(b: BrouillonChemin): ChangementPlacement[] {
  if (!b.termine) return [];
  const v = verdict(b);
  if (!v.ok) return [];
  const nom = b.nom.trim();
  return [{ sorte: 'chemin', id: b.id, valeurs: { nom: nom === '' ? null : nom, points: v.valeur.points.map((p) => ({ x: arrondiM(p.x), y: arrondiM(p.y) })), largeur_m: v.valeur.largeur_m } }];
}

/** Ce qui empêche d'enregistrer, ou null. */
export function raison(b: BrouillonChemin): string | null {
  if (!b.termine) return 'Finissez d’abord le tracé du chemin';
  return verdict(b).ok ? null : 'Corrigez d’abord le chemin refusé';
}

/** Les points du tracé en cours, sur le plan, et la ligne qui les joint. */
export function TraceSurPlan({ b, versEcran, taille }: { readonly b: BrouillonChemin; readonly versEcran: (p: Point) => Point; readonly taille: { readonly w: number; readonly h: number } }): ReactElement {
  const ecran = b.points.map(versEcran);
  return (
    <>
      <svg className="pl-svg pl-svg-edition" width={taille.w} height={taille.h} aria-hidden="true">
        <polyline className="pl-trace-ligne" points={ecran.map((e) => `${String(e.x)},${String(e.y)}`).join(' ')} />
      </svg>
      {b.points.map((p, i) => {
        const e = ecran[i] ?? { x: 0, y: 0 };
        return <div key={i} data-testid="point-chemin" data-index={i} data-x={p.x} data-y={p.y} aria-hidden="true" className="pl-sommet pl-point-chemin" style={{ left: e.x - 12, top: e.y - 12, width: 24, height: 24 }} />;
      })}
    </>
  );
}

export interface ProprietesPanneauChemin {
  readonly b: BrouillonChemin;
  readonly surChange: (b: BrouillonChemin | null) => void;
}

/** Panneau du chemin : consigne du tracé, « Terminer le chemin », « Renoncer au tracé », largeur, nom, verdict du cœur. */
export function PanneauChemin({ b, surChange }: ProprietesPanneauChemin): ReactElement {
  const idNom = useId();
  const conteneur = useRef<HTMLDivElement>(null);
  // Le focus va au panneau quand le tracé s'ouvre : Entrée le termine, Échap l'abandonne.
  useEffect(() => {
    conteneur.current?.focus();
  }, []);
  const v = verdict(b);
  const etat = !b.termine ? 'trace' : v.ok ? 'valide' : 'invalide';
  return (
    <div ref={conteneur} tabIndex={-1} className="pl-contour-edition" data-testid="chemin-edition" data-id={b.id} data-etat={etat} data-points={b.points.length}>
      <h3>Chemin</h3>
      {!b.termine && (
        <>
          <p className="pl-aide">
            Touchez la photo pour poser chaque point du chemin ({String(b.points.length)} posé{b.points.length > 1 ? 's' : ''}). Entrée ou « Terminer le chemin » (2 points au moins) ; Échap abandonne.
          </p>
          <button
            type="button"
            className="pl-bouton pl-principal"
            disabled={b.points.length < 2}
            onClick={() => {
              surChange(terminer(b));
            }}
          >
            Terminer le chemin
          </button>
          <button
            type="button"
            className="pl-bouton"
            onClick={() => {
              surChange(null);
            }}
          >
            Renoncer au tracé
          </button>
        </>
      )}
      {b.termine && !v.ok && (
        <p role="alert" data-testid="chemin-erreur" className="pl-message pl-erreur">
          {v.erreur.message}
        </p>
      )}
      <ChampLargeur
        valeur={b.largeurM}
        surChange={(largeurM) => {
          surChange({ ...b, largeurM });
        }}
      />
      <div className="pl-champ">
        <label htmlFor={idNom}>Nom du chemin (facultatif)</label>
        <input
          id={idNom}
          type="text"
          autoComplete="off"
          maxLength={80}
          value={b.nom}
          onChange={(e) => {
            surChange({ ...b, nom: e.target.value });
          }}
        />
      </div>
      {b.termine && (
        <button
          type="button"
          className="pl-bouton"
          onClick={() => {
            surChange(null);
          }}
        >
          Abandonner le chemin
        </button>
      )}
    </div>
  );
}

/** Largeur en mètres : le texte tapé est gardé tel quel, la valeur suit chaque nombre complet (un texte vide ou illisible : largeur invalide). */
function ChampLargeur({ valeur, surChange }: { readonly valeur: number; readonly surChange: (v: number) => void }): ReactElement {
  const id = useId();
  const [texte, setTexte] = useState(() => String(valeur));
  return (
    <div className="pl-champ">
      <label htmlFor={id}>Largeur du chemin (m)</label>
      <input
        id={id}
        type="number"
        step="any"
        min="0"
        inputMode="decimal"
        value={texte}
        onChange={(e) => {
          const t = e.target.value;
          setTexte(t);
          surChange(t.trim() === '' ? Number.NaN : Number(t));
        }}
      />
    </div>
  );
}
