/**
 * Contrat des vannes dans la vue 3D (T57, docs/backlog/T57-vannes-irrigation.md, règles 3 et 4).
 *
 * Tout ce qui touche aux vannes est chargé à la demande par la vue, À PART du morceau 3D (budget
 * `jsVue3dGzKio`) : ni three ni @react-three/fiber dans ces modules. Les repères sont de petits
 * boutons HTML posés sur la toile (comme les pastilles des travaux, T37), replacés à chaque image
 * par la vue (`placerPastilles`) : aucun appel de dessin de plus.
 *
 * ── Module pur `../vannes.ts` (ni React, ni three, ni Date) ─────────────────────────────────
 *
 *   reperesVannes(vannes, liens, volumes, jour): Repere3d[]
 * Un repère par vanne non supprimée qui a une position dans la scène, triés par numéro :
 *   - vanne placée (position x, y dans le repère de la ferme) : x_scène = x, z_scène = −y ;
 *   - sinon, « en tête de sa première planche » : parmi les planches qu'elle arrose ce jour-là
 *     (`emplacementsArroses` du cœur) présentes dans la scène, celle au plus petit code (ordre
 *     naturel français : P2 avant P10) ; le point est le bout de DÉPART de la planche, à l'opposé
 *     de son cap : (v.x − cos(angle)·longueur/2, v.z + sin(angle)·longueur/2) ;
 *   - ni placée ni planche dans la scène : pas de repère.
 * `planches` : ids des planches arrosées ce jour-là présentes dans la scène (ordre des codes),
 * `codes` : leurs codes, dans le même ordre.
 *
 *   classesIrrigation(volumes, dernieres, aujourdhui): Map<idPlanche, ClasseIrrigation>
 * Une entrée par volume : `classeIrrigation` du cœur sur la date de sa dernière irrigation.
 *
 *   COULEURS_IRRIGATION: Record<ClasseIrrigation, string> — quatre couleurs distinctes (#rrggbb).
 *
 *   colorer(filtree, { irrigation, evidence }): SceneFiltree
 * Ne change QUE `couleur` et `estompe` des volumes (même ordre, mêmes autres champs) :
 *   - `irrigation` non nul (filtre « Irrigation ») : couleur = COULEURS_IRRIGATION[classe],
 *     planche non estompée ;
 *   - `evidence` non nul (repère touché) : les planches HORS de l'ensemble sont estompées
 *     (couleur COULEUR_ESTOMPEE, estompe vrai), celles de l'ensemble gardent leur couleur ;
 *   - les deux nuls : `filtree` rendu tel quel (même objet).
 *
 *   phraseVanne(repere, derniere, aujourdhui): string
 *   « V12 — arrose P3, P4, P5 — dernière irrigation : aujourd’hui 7 h, 20 min »
 * Heure locale du téléphone (`new Date(horodatage)`) : « 7 h », « 18 h 30 » ; jour : « aujourd’hui »,
 * « hier », sinon « le 12 octobre » ; durée : « 20 min », « 1 h », « 1 h 30 ». Sans planche :
 * « n’arrose aucune planche » ; sans irrigation : « dernière irrigation : aucune ».
 *
 * ── Composant `../Vannes3d.tsx` (export `Vannes3d`) ─────────────────────────────────────────
 *
 * Lit (en surveillant la base) les vannes, les liens et les irrigations en vigueur de la ferme ;
 * écrit seulement par la saisie d'irrigation. Propriétés : ProprietesVannes3d.
 *   - couche `data-testid="vannes-3d"` (réf. `couche`), un bouton par repère, dans l'ordre de
 *     `reperes` : `data-testid="repere-vanne-3d"`, `data-vanne` = id, texte = nom (« V12 »),
 *     nommé « Vanne V12 », `aria-pressed` vrai pour la vanne choisie, au moins 44 px de côté ;
 *   - tap sur un repère : la vanne est choisie, ses planches mises en évidence (`surEtat` :
 *     `evidence` = ses planches), fiche `data-testid="fiche-vanne-3d"` (role="dialog", nommée
 *     par le nom de la vanne) qui dit `phraseVanne`, avec « Irrigation » et « Fermer » ; un
 *     second tap ou « Fermer » : plus rien en évidence ;
 *   - bouton bascule `data-testid="filtre-irrigation-3d"` « Irrigation » (`aria-pressed`) : les
 *     planches se colorent selon la dernière irrigation (`surEtat` : `irrigation`), légende
 *     `data-testid="legende-irrigation-3d"` : « Aujourd’hui », « Hier », « Plus ancienne »,
 *     « Jamais » ;
 *   - « Irrigation » depuis la fiche : la saisie d'irrigation (aujourdhui/SaisieIrrigation.tsx),
 *     vanne déjà choisie ; l'irrigation s'écrit dans la base du téléphone, hors ligne compris.
 * `surEtat` est appelé à chaque changement avec `reperes` (même ordre que les boutons), et
 * `colorer` (fonction pure à appliquer à la scène filtrée de la vue).
 */
import type { PorteDonnees } from '@planif/sync';
import type { ComponentType, RefObject } from 'react';
import type { SceneFiltree, VolumeScene } from '../scene.ts';

export const CHEMIN_VANNES_3D = './vannes.ts';
export const CHEMIN_COMPOSANT_VANNES_3D = './Vannes3d.tsx';

export type ClasseIrrigation = 'aujourdhui' | 'hier' | 'ancienne' | 'jamais';

export interface VanneLue {
  readonly id: string;
  readonly numero: number;
  readonly nom: string;
  readonly x: number | null;
  readonly y: number | null;
}

export interface LienLu {
  readonly id: string;
  readonly secteurId: string;
  readonly emplacementId: string;
  readonly du: string;
  readonly au: string | null;
}

export interface IrrigationLue {
  readonly id: string;
  readonly secteurId: string;
  readonly date: string;
  readonly horodatage: string;
  readonly dureeMinutes: number;
}

export interface Repere3d {
  readonly id: string;
  readonly numero: number;
  readonly nom: string;
  readonly x: number;
  readonly z: number;
  readonly planches: readonly string[];
  readonly codes: readonly string[];
}

export type VolumeVanne = Pick<VolumeScene, 'id' | 'code' | 'x' | 'z' | 'longueur' | 'angle'>;

export interface ModuleVannes3d {
  reperesVannes(vannes: readonly VanneLue[], liens: readonly LienLu[], volumes: readonly VolumeVanne[], jour: string): Repere3d[];
  classesIrrigation(volumes: readonly Pick<VolumeScene, 'id'>[], dernieres: ReadonlyMap<string, IrrigationLue>, aujourdhui: string): Map<string, ClasseIrrigation>;
  readonly COULEURS_IRRIGATION: Readonly<Record<ClasseIrrigation, string>>;
  colorer(filtree: SceneFiltree, options: { readonly irrigation: ReadonlyMap<string, ClasseIrrigation> | null; readonly evidence: ReadonlySet<string> | null }): SceneFiltree;
  phraseVanne(repere: Pick<Repere3d, 'nom' | 'codes'>, derniere: IrrigationLue | null, aujourdhui: string): string;
}

export interface EtatVannes3d {
  /** Points des repères, dans l'ordre des boutons de la couche (pour `placerPastilles`). */
  readonly reperes: readonly { readonly pastille: { readonly x: number; readonly z: number } }[];
  /** Coloration des planches : filtre « Irrigation » et planches de la vanne choisie. */
  readonly colorer: (filtree: SceneFiltree) => SceneFiltree;
  /** Planches mises en évidence (vanne choisie), ou nul. */
  readonly evidence: ReadonlySet<string> | null;
  /** Filtre « Irrigation » actif. */
  readonly irrigation: boolean;
}

export interface ProprietesVannes3d {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  /** Volumes de la scène (géométrie de la vue). */
  readonly volumes: readonly VolumeScene[];
  readonly couche: RefObject<HTMLDivElement | null>;
  readonly surEtat: (etat: EtatVannes3d) => void;
  readonly aujourdhui?: () => string;
  readonly maintenant?: () => Date;
}

export interface ModuleComposantVannes3d {
  readonly Vannes3d: ComponentType<ProprietesVannes3d>;
}

export const TESTID_VANNES_3D = {
  couche: 'vannes-3d',
  repere: 'repere-vanne-3d',
  fiche: 'fiche-vanne-3d',
  irriguer: 'irriguer-3d',
  filtre: 'filtre-irrigation-3d',
  legende: 'legende-irrigation-3d',
} as const;
