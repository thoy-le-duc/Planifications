/**
 * Vue 3D (T55) — repères « Ne pas récolter » des emplacements sous délai avant récolte (DAR), à la
 * date montrée par le curseur. Posés par Vannes3d.tsx dans la couche de ses repères (même placement
 * par la vue, aucun appel de dessin de plus) : ce module est chargé avec les vannes, à part du
 * morceau 3D (budget `jsVue3dGzKio`). Lecture seule.
 *
 * Les traitements se lisent par ../aujourdhui/dar.ts (même requête et même suivi que l'écran
 * Aujourd'hui), le DAR se calcule par le cœur (./dar3d.ts) : rien n'est recopié ici.
 * Contrat : ./test/contrat-dar3d.ts.
 */
import { useEffect, useMemo, useState, type PointerEventHandler, type ReactElement } from 'react';
import type { PorteDonnees } from '@planif/sync';
import type { TraitementsDar } from '../aujourdhui/dar.ts';
import { reperesDar, TEXTE_REPERE_DAR, type RepereDar } from './dar3d.ts';
import type { VolumeScene } from './scene.ts';
import './dar3d.css';

/**
 * Les repères DAR des `volumes` le `date`, suivis dans la base (un traitement saisi ou annulé
 * ailleurs s'y voit). La lecture remonte à DAR_MAX_JOURS avant la plus ancienne date montrée
 * (aujourd'hui, ou une semaine passée choisie au curseur) : elle n'est refaite que lorsque le
 * curseur recule plus loin qu'il n'est jamais allé, pas à chaque semaine.
 */
const AUCUN: TraitementsDar = { traitements: [], noms: new Map() };

export function useReperesDar(porte: PorteDonnees, fermeId: string, volumes: readonly VolumeScene[], date: string, aujourdhui: string): readonly RepereDar[] {
  const [lus, setLus] = useState(AUCUN);
  const [borne, setBorne] = useState(() => (date < aujourdhui ? date : aujourdhui));
  // État tiré du rendu (pas d'effet) : la borne ne fait que reculer.
  if (date < borne) setBorne(date);
  useEffect(() => {
    // Par import dynamique, comme l'écran Aujourd'hui (un import statique de ../aujourdhui/dar.ts
    // ajoutait au démarrage l'assistant des objets d'espace de noms) ; déjà précaché, hors ligne aussi.
    let arreter: (() => void) | null = null;
    let actif = true;
    import('../aujourdhui/dar.ts').then(
      (m) => {
        if (actif) arreter = m.suivreTraitements(porte, fermeId, borne, setLus).arreter;
      },
      (e: unknown) => {
        console.error('Délais avant récolte 3D : suivi impossible', e);
      },
    );
    return () => {
      actif = false;
      arreter?.();
    };
  }, [porte, fermeId, borne]);
  return useMemo(() => reperesDar(lus, volumes, date), [lus, volumes, date]);
}

export interface GesteRepere {
  readonly onPointerDown: PointerEventHandler<HTMLButtonElement>;
  readonly onPointerMove: PointerEventHandler<HTMLButtonElement>;
  readonly onPointerUp: PointerEventHandler<HTMLButtonElement>;
  readonly onPointerCancel: PointerEventHandler<HTMLButtonElement>;
}

/** Le bouton d'un repère, à poser dans la couche des repères (ordre de `reperes`). */
export function BoutonDar({ repere, choisi, surChoisir, geste }: { readonly repere: RepereDar; readonly choisi: boolean; readonly surChoisir: (planche: string) => void; readonly geste: GesteRepere }): ReactElement {
  return (
    <button
      type="button"
      data-testid="repere-dar-3d"
      data-planche={repere.planche}
      aria-label={`${TEXTE_REPERE_DAR}, ${repere.code}`}
      aria-pressed={choisi}
      className={choisi ? 'plan3d-repere-dar plan3d-repere-dar-choisi' : 'plan3d-repere-dar'}
      onClick={() => {
        surChoisir(repere.planche);
      }}
      {...geste}
    >
      <span aria-hidden="true" className="plan3d-repere-dar-signe" />
      {TEXTE_REPERE_DAR}
    </button>
  );
}

/** La fiche d'un repère touché : « Récolte interdite jusqu’au 13/05 (Bouillie bordelaise, traité le 10/05) ». */
export function FicheDar({ repere, surFermer }: { readonly repere: RepereDar; readonly surFermer: () => void }): ReactElement {
  return (
    <div role="dialog" aria-label={`${TEXTE_REPERE_DAR}, ${repere.code}`} data-testid="fiche-dar-3d" className="plan3d-fiche-vanne plan3d-fiche-dar">
      <p>
        {repere.code} — {repere.texte}
      </p>
      <div className="plan3d-fiche-vanne-actions">
        <button type="button" className="plan3d-bouton" onClick={surFermer}>
          Fermer
        </button>
      </div>
    </div>
  );
}
