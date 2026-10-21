/**
 * Contrat du rangement des outils dans la vue 3D (T61, docs/backlog/T61-chemins-outils.md,
 * règles 3 et 4). Même mécanique que les vannes (./contrat-vannes.ts, T57) : chargé à la demande
 * par la vue, À PART du morceau 3D (ni three ni @react-three/fiber dans ces modules) ; les repères
 * sont de petits éléments HTML posés sur la toile, replacés à chaque image par la vue
 * (`placerPastilles`).
 *
 * ── Module pur `../rangement.ts` (ni React, ni three, ni Date) ──────────────────────────────
 *
 *   pointsRangement(entree): PointsRangement | null
 * Repère de la scène : x_scène = x (mètres, est), z_scène = −y (y vers le nord dans la ferme).
 * `lieu` : position du lieu de rangement = centre du bâtiment (centre_x_m, centre_y_m) ou position
 * du point du plan (x_m, y_m), avec son nom (celui du bâtiment ou du point). `planche` : la planche
 * de la tâche, telle que la scène la dessine (x, z du volume), seulement si `plancheId` est celui
 * d'un volume PLACÉ de la scène ; sinon null. Nul (rien à montrer) si le lieu n'a ni bâtiment ni
 * point connu. Le résultat n'a QUE ces deux clés, `lieu` et `planche` : le chemin le plus court
 * n'est PAS dans ce ticket, on surligne les deux points, sans aucun calcul de trajet.
 *
 * ── Composant `../Rangement3d.tsx` (export `Rangement3d`) ───────────────────────────────────
 *
 * Lit (en surveillant la base) l'outil `cible.outilId`, son lieu, sa place, le bâtiment ou le point
 * du lieu, dans la ferme de la porte seulement ; n'écrit rien. Sans `cible`, ou pour un outil qui
 * n'est pas de la ferme, retiré, ou sans position : rien n'est dessiné et `surEtat` rend un état
 * vide (`points` vide, `evidence` nul).
 *   - couche `data-testid="rangement-3d"` (réf. `couche`) ; un repère `repere-rangement-3d` par
 *     point montré, dans l'ordre : le lieu d'abord (data-sorte="lieu"), la planche ensuite
 *     (data-sorte="planche") ; `data-surligne="oui"` sur chacun ; `data-x`, `data-z` = leur point
 *     dans la scène ; nom accessible : « Grelinette : hangar, mur nord » pour le lieu (libellé du
 *     cœur), « Planche T2-P01 » pour la planche ;
 *   - `surEtat` rend { points: [{ pastille: { x, z } }…] (même ordre que les repères), evidence:
 *     ensemble des planches mises en évidence ({plancheId}) ou nul, colorer } — AUCUNE autre clé
 *     de trajet (pas de `chemin`, `trajet`, `segments`) ;
 *   - planche absente de la scène ou non placée : seul le lieu est montré, et un message
 *     (role="status") dit que la planche n'est pas placée ;
 *   - bouton « Fermer » (`fermer-rangement-3d`) : `surFermer` est appelé ; un parent qui retire
 *     `cible` voit disparaître repères et mise en évidence.
 */
import type { PorteDonnees } from '@planif/sync';
import type { ComponentType, RefObject } from 'react';
import type { SceneFiltree, VolumeScene } from '../scene.ts';

export const CHEMIN_RANGEMENT_3D = './rangement.ts';
export const CHEMIN_COMPOSANT_RANGEMENT_3D = './Rangement3d.tsx';

export interface PointScene {
  readonly x: number;
  readonly z: number;
}

export interface PointsRangement {
  readonly lieu: PointScene & { readonly nom: string };
  readonly planche: (PointScene & { readonly id: string; readonly code: string }) | null;
}

export interface EntreeRangement {
  /** Le lieu de l'outil : un bâtiment OU un point du plan. */
  readonly lieu: { readonly batiment_id: string | null; readonly point_plan_id: string | null };
  readonly batiments: readonly { readonly id: string; readonly nom: string; readonly centre_x_m: number; readonly centre_y_m: number }[];
  readonly pointsPlan: readonly { readonly id: string; readonly nom: string; readonly x_m: number; readonly y_m: number }[];
  readonly volumes: readonly Pick<VolumeScene, 'id' | 'code' | 'x' | 'z' | 'placee'>[];
  readonly plancheId: string | null;
}

export interface ModuleRangement3d {
  pointsRangement(entree: EntreeRangement): PointsRangement | null;
}

export interface EtatRangement3d {
  readonly points: readonly { readonly pastille: PointScene }[];
  readonly evidence: ReadonlySet<string> | null;
  readonly colorer: (filtree: SceneFiltree) => SceneFiltree;
}

export interface ProprietesRangement3d {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  readonly volumes: readonly VolumeScene[];
  readonly couche: RefObject<HTMLDivElement | null>;
  readonly cible: { readonly outilId: string; readonly plancheId: string | null } | null;
  readonly surEtat: (etat: EtatRangement3d) => void;
  readonly surFermer?: () => void;
}

export interface ModuleComposantRangement3d {
  readonly Rangement3d: ComponentType<ProprietesRangement3d>;
}

export const TESTID_RANGEMENT_3D = {
  couche: 'rangement-3d',
  repere: 'repere-rangement-3d',
  fermer: 'fermer-rangement-3d',
} as const;
