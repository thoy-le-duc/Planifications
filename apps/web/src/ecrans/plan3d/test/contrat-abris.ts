/**
 * Contrat des serres dans la vue 3D (T58, docs/backlog/T58-etat-serres.md, règle 3) : ouvrants
 * relevés, porte ouverte, chauffage en pastille, filtre « Serres ». État des équipements : voir
 * packages/core/src/abris/test/contrat.ts ; le tap qui change l'état est celui de
 * aujourdhui/test/contrat-etat-serres.ts (mêmes boutons, mêmes événements, même « Annuler »).
 *
 * Comme les vannes (T57), tout est chargé à la demande par la vue, À PART du morceau 3D (budget
 * `jsVue3dGzKio`) : ni three ni @react-three/fiber dans ces modules ; la vue les atteint par un
 * relais `./abris-differees.ts`.
 *
 * ── Module pur `../abris.ts` (ni React, ni three, ni Date) ──────────────────────────────────
 *
 *   etatsBatiments(batiments, zones, evenements, instant): Map<idBatiment, EtatBatiment>
 * Une entrée par bâtiment dont `zoneId` est une zone ABRITÉE avec au moins un équipement déclaré
 * (`equipementsDeZone` du cœur) ; ni le hangar (zoneId nul), ni un bâtiment dont la zone n'est
 * pas dans `zones` (autre ferme, supprimée), ni une zone de plein champ. EtatBatiment :
 *   { zoneId, nom (de la zone), ouvert, ouverts, ouvertures }
 *   - `ouverts` : ouvrants latéraux, ouvrants de faîtage et portes actifs à `instant` (ordre
 *     canonique), `ouvert` = `ouverts` non vide (comme `abrisOuverts` du cœur) ;
 *   - `ouvertures` : { lateraux, faitage, portes, chauffage, voile } booléens, vrais si l'équipement
 *     est déclaré ET actif (état inconnu = faux) : de quoi dessiner les ouvrants relevés, la porte
 *     ouverte, la pastille de chauffage et le voile.
 *
 *   poserOuvertures(scene, etats): Scene
 * Les bâtiments de `etats` gagnent `ouvertures` (BatimentScene.ouvertures, facultative) ; les
 * autres bâtiments et tout le reste de la scène sont rendus tels quels. Sans aucun abri : la scène
 * elle-même.
 *
 *   COULEURS_SERRES: { ouverte, fermee } — deux couleurs #rrggbb distinctes ; `ouverte` est la
 *   couleur VIVE du filtre.
 *
 *   colorerSerres(filtree, etats, filtre): SceneFiltree
 * `filtre` faux : `filtree` rendue telle quelle (même objet). Vrai : les bâtiments ouverts prennent
 * COULEURS_SERRES.ouverte, les abris fermés COULEURS_SERRES.fermee, tous les autres bâtiments
 * COULEUR_ESTOMPEE ; les planches (volumes) dont `zoneId` est celle d'un abri OUVERT gardent leur
 * couleur et ne sont pas estompées, les autres sont estompées (estompe vrai, COULEUR_ESTOMPEE).
 *
 * ── Composant `../Abris3d.tsx` (export `Abris3d`) ───────────────────────────────────────────
 *
 * Lit (en surveillant la base) les zones et les événements `etat_abri` en vigueur de LA ferme ;
 * n'écrit que par le tap d'un équipement. Propriétés : ProprietesAbris3d.
 *   - couche `data-testid="abris-3d"` (réf. `couche`), un bouton par abri (`etatsBatiments`),
 *     dans l'ordre des noms de zone (ordre naturel français) :
 *     `data-testid="repere-abri-3d"`, `data-batiment`, `data-zone`, `data-ouvert` « oui » / « non »,
 *     `data-ouverts` (équipements ouverts, séparés par des virgules, vide si aucun),
 *     `data-chauffage` et `data-voile` « oui » / « non » (ATTRIBUTS DE TEST des ouvrants ouverts,
 *     du chauffage et du voile), texte = nom de la zone, nom accessible « Serre 1 : ouverte » ou
 *     « Serre 1 : fermée », au moins 44 px de côté ;
 *   - tap sur un repère : fiche `data-testid="fiche-abri-3d"` (role="dialog", nommée par la zone)
 *     avec, pour chaque équipement déclaré, le bouton `data-testid="equipement-abri"` du panneau
 *     d'Aujourd'hui (mêmes attributs, même tap, même statut `etat-abri-enregistre` et « Annuler »),
 *     et « Fermer » ; un second tap sur le repère, ou « Fermer », ferme la fiche ;
 *   - bascule `data-testid="filtre-serres-3d"` « Serres » (aria-pressed) : légende
 *     `data-testid="legende-serres-3d"` (« Ouverte », « Fermée ») ;
 *   - `surEtat` est appelé à chaque changement (EtatAbris3d) : `reperes` (points des repères dans
 *     l'ordre des boutons, x et z du bâtiment), `etats` (etatsBatiments), `filtre`, `poser` (fonction
 *     pure : poserOuvertures) et `colorer` (colorerSerres selon le filtre).
 */
import type { PorteDonnees } from '@planif/sync';
import type { ComponentType, RefObject } from 'react';
import type { BatimentScene, Scene, SceneFiltree } from '../scene.ts';

export const CHEMIN_ABRIS = './abris.ts';
export const CHEMIN_COMPOSANT_ABRIS_3D = './Abris3d.tsx';

export type EquipementAbri = 'ouvrants_lateraux' | 'ouvrants_faitage' | 'portes' | 'chauffage' | 'voile';

export interface ZoneAbri {
  readonly id: string;
  readonly nom: string;
  readonly typeAbri: 'plein_champ' | 'tunnel' | 'serre' | 'hors_sol';
  readonly equipementsAbri: readonly EquipementAbri[] | null;
}

export interface EvenementEtatAbri {
  readonly id: string;
  readonly zoneId: string;
  readonly equipement: EquipementAbri;
  readonly actif: boolean;
  readonly horodatage: string;
  readonly remplaceSorte: 'correction' | 'annulation' | null;
  readonly remplaceEvenementId: string | null;
}

export interface Ouvertures {
  readonly lateraux: boolean;
  readonly faitage: boolean;
  readonly portes: boolean;
  readonly chauffage: boolean;
  readonly voile: boolean;
}

export interface EtatBatiment {
  readonly zoneId: string;
  readonly nom: string;
  readonly ouvert: boolean;
  readonly ouverts: readonly EquipementAbri[];
  readonly ouvertures: Ouvertures;
}

export type BatimentAbri = Pick<BatimentScene, 'id' | 'zoneId'>;

export interface ModuleAbris {
  etatsBatiments(batiments: readonly BatimentAbri[], zones: readonly ZoneAbri[], evenements: readonly EvenementEtatAbri[], instant: string): Map<string, EtatBatiment>;
  poserOuvertures(scene: Scene, etats: ReadonlyMap<string, EtatBatiment>): Scene;
  readonly COULEURS_SERRES: { readonly ouverte: string; readonly fermee: string };
  colorerSerres(filtree: SceneFiltree, etats: ReadonlyMap<string, EtatBatiment>, filtre: boolean): SceneFiltree;
}

export interface EtatAbris3d {
  readonly reperes: readonly { readonly pastille: { readonly x: number; readonly z: number } }[];
  readonly etats: ReadonlyMap<string, EtatBatiment>;
  readonly filtre: boolean;
  readonly poser: (scene: Scene) => Scene;
  readonly colorer: (filtree: SceneFiltree) => SceneFiltree;
}

export interface ProprietesAbris3d {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  readonly batiments: readonly BatimentScene[];
  readonly couche: RefObject<HTMLDivElement | null>;
  readonly surEtat: (etat: EtatAbris3d) => void;
  readonly aujourdhui?: () => string;
  readonly maintenant?: () => Date;
}

export interface ModuleComposantAbris3d {
  readonly Abris3d: ComponentType<ProprietesAbris3d>;
}

export const TESTID_ABRIS_3D = {
  couche: 'abris-3d',
  repere: 'repere-abri-3d',
  fiche: 'fiche-abri-3d',
  filtre: 'filtre-serres-3d',
  legende: 'legende-serres-3d',
} as const;
