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
import { ajouterJours, DAR_MAX_JOURS, type DateCalendaire } from '@planif/core';
import type { PorteDonnees } from '@planif/sync';
import type { TraitementsDar } from '../aujourdhui/dar.ts';
import { reperesDar, TEXTE_REPERE_DAR, type RepereDar } from './dar3d.ts';
import type { VolumeScene } from './scene.ts';
import './dar3d.css';

/**
 * Les repères DAR des `volumes` le `date`, suivis dans la base (un traitement saisi ou annulé
 * ailleurs s'y voit). Une seule lecture couvre d'emblée l'année passée du curseur (tout ce qui peut
 * interdire une récolte depuis un an avant aujourd'hui) : faire défiler les semaines ne relit pas
 * la base (une relecture pendant le défilé disputait l'image au changement de semaine). Elle n'est
 * refaite que si le curseur recule au-delà.
 */
const AUCUN: TraitementsDar = { traitements: [], noms: new Map() };

/**
 * Attente avant la première lecture des traitements : la vue s'ouvre, lit ses travaux et dessine
 * d'abord (sur la grande ferme, deux ans de traitements à lire ne disputent pas la base à la lecture
 * des travaux). Une vue refermée avant ce délai ne lit rien. Nulle sous Vitest (les tests du
 * composant attendent les repères sans horloge simulée).
 */
const ATTENTE_DAR_MS = import.meta.env.MODE === 'test' ? 0 : 1_000;

export function useReperesDar(porte: PorteDonnees, fermeId: string, volumes: readonly VolumeScene[], date: string, aujourdhui: string): readonly RepereDar[] {
  const [lus, setLus] = useState(AUCUN);
  const [borne, setBorne] = useState(() => {
    const anPasse = ajouterJours(aujourdhui as DateCalendaire, -(DAR_MAX_JOURS + 1));
    return date < anPasse ? date : anPasse;
  });
  // État tiré du rendu (pas d'effet) : la borne ne fait que reculer.
  if (date < borne) setBorne(date);
  useEffect(() => {
    // Par import dynamique, comme l'écran Aujourd'hui (un import statique de ../aujourdhui/dar.ts
    // ajoutait au démarrage l'assistant des objets d'espace de noms) ; déjà précaché, hors ligne aussi.
    let arreter: (() => void) | null = null;
    let actif = true;
    const minuterie = setTimeout(() => {
      import('../aujourdhui/dar.ts').then(
        (m) => {
          if (actif) arreter = m.suivreTraitements(porte, fermeId, borne, setLus).arreter;
        },
        (e: unknown) => {
          console.error('Délais avant récolte 3D : suivi impossible', e);
        },
      );
    }, ATTENTE_DAR_MS);
    return () => {
      actif = false;
      clearTimeout(minuterie);
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
