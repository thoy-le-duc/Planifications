/**
 * T90 : le bouton « Dupliquer » du panneau de l'élément (docs/backlog/T90-dupliquer.md), dans le morceau de la zone (chargé avec
 * l'éditeur). Il décide si l'élément choisi se duplique ; la fiche (./duplication.tsx, avec le calcul des copies) ne se charge qu'à
 * son toucher : le morceau de l'éditeur (budget.json) ne porte que `<Dupliquer />`. Contrat du DOM : ./test/contrat-dupliquer.ts.
 */
import { useState, type ReactElement } from 'react';
import type { Batiment, Planche } from './donnees.ts';
import type { PorteDonnees } from '@planif/sync';
import type { EditeurDeLaDuplication, FicheDuplication, LigneEmplacement } from './duplication.tsx';
import type { ZoneAffichee } from './EditeurPlacement.tsx';

const estSerre = (b: Batiment): boolean => (b.type === 'serre_tunnel' || b.type === 'serre_chapelle') && b.zoneId !== null;

/**
 * La zone que « Dupliquer » copie pour l'élément choisi, ou null : la zone abritée par la serre choisie, ou la zone choisie qui est
 * abritée par une serre (une bande de serre ne l'est pas : elle n'a pas de bâtiment à elle) ou de plein champ avec un contour.
 */
export function cibleDuplication(batiment: Batiment | undefined, zone: ZoneAffichee | undefined, batiments: readonly Batiment[]): string | null {
  if (batiment !== undefined) return estSerre(batiment) ? batiment.zoneId : null;
  if (zone === undefined) return null;
  return (zone.abritee ? batiments.some((b) => estSerre(b) && b.zoneId === zone.zone.id) : zone.affiche !== null) ? zone.zone.id : null;
}

/**
 * Ce que l'éditeur donne au bouton, dans cet ordre : charger le morceau de la serre (qui compte les créations au brouillon dans
 * l'enregistrement : `ouvrirFiche` sans zone), puis ce que la fiche reçoit (les brouillons où poser les copies, choisir la première,
 * le nombre de changements déjà au brouillon).
 */
export type EditeurDuBouton = EditeurDeLaDuplication extends readonly [unknown, ...infer Reste] ? readonly [charger: () => void, ...Reste] : never;

export interface ProprietesDupliquer {
  readonly batiment: Batiment | undefined;
  readonly zone: ZoneAffichee | undefined;
  readonly batiments: readonly Batiment[];
  readonly planches: readonly Planche[];
  readonly infos: ReadonlyMap<string, ZoneAffichee>;
  /** Un enregistrement est en cours : « Dupliquer » attend. */
  readonly occupe: boolean;
  readonly nouvelId: () => string;
  /** La base locale : la fiche y lit tous les emplacements de l'élément (placés ou non, toutes sortes) à son ouverture. */
  readonly porte: PorteDonnees;
  readonly editeur: EditeurDuBouton;
}

/** « Dupliquer » (si l'élément choisi se duplique) et, une fois touché, la fiche chargée à la demande. */
export function Dupliquer(p: ProprietesDupliquer): ReactElement | null {
  const [fiche, setFiche] = useState<{ readonly racineId: string; readonly emplacements: readonly LigneEmplacement[]; readonly m: { readonly FicheDuplication: typeof FicheDuplication } } | null>(null);
  const [echec, setEchec] = useState(false);
  const [charger, ...reste] = p.editeur;
  const cible = cibleDuplication(p.batiment, p.zone, p.batiments);
  return (
    <>
      {cible !== null && (
        <button
          type="button"
          className="pl-bouton"
          data-testid="dupliquer"
          disabled={p.occupe}
          onClick={() => {
            setEchec(false);
            charger();
            import('./duplication.tsx')
              .then(async (m) => ({ m, emplacements: await m.lireEmplacements(p.porte, cible) }))
              .then(
                (r) => {
                  setFiche({ racineId: cible, ...r });
                },
                () => {
                  setEchec(true);
                },
              );
          }}
        >
          Dupliquer
        </button>
      )}
      {echec && (
        <p role="alert" className="pl-message pl-erreur">
          Impossible de charger la duplication : vérifiez la connexion, puis réessayez.
        </p>
      )}
      {fiche !== null && (
        <fiche.m.FicheDuplication
          racineId={fiche.racineId}
          batiments={p.batiments}
          planches={p.planches}
          emplacements={fiche.emplacements}
          infos={p.infos}
          nouvelId={p.nouvelId}
          editeur={[() => { setFiche(null); }, ...reste]}
        />
      )}
    </>
  );
}
