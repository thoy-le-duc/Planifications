/**
 * Contrat de T27b — vue 3D : filtres et couleurs lisibles (docs/backlog/T27b-vue-3d-filtres.md, Q30).
 * Complète ./contrat.ts (T27), qui ne change pas. Types et constantes seulement : les tests
 * chargent les modules par import dynamique (chemin tenu dans une variable), leur typage ne dépend
 * pas du code pas encore écrit.
 *
 * ── Clés de famille (src/ui/jetons.ts, `CleFamille`) ─────────────────────────────────────────
 *
 * 17 clés, sans accents ni casse : les 4 de T16 (salades = Astéracées, solanacees, cruciferes =
 * Brassicacées, racines = Apiacées), les 12 autres familles de la bibliothèque commune
 * (FAMILLES_PAR_DEFAUT de @planif/core : clé = nom normalisé, singulier inchangé : 'alliacees',
 * 'amaranthacees', 'asparagacees', 'convolvulacees', 'cucurbitacees', 'fabacees', 'lamiacees',
 * 'paeoniacees', 'poacees', 'polygonacees', 'rosacees', 'valerianacees') et 'autre' (famille propre
 * à la ferme, famille inconnue, culture sans famille : couverture…).
 * `FAMILLES` et `FAMILLES_SOMBRES` ont exactement ces 17 clés, `{ bande, texte }` chacune.
 * `cleFamille(nom)` (src/ecrans/plan/calculs.ts) renvoie toujours l'une des 17 clés — plus jamais
 * null : 'autre' pour null, '' et tout nom hors bibliothèque. `BarrePlan.cleFamille` est donc
 * toujours renseignée. Le plan 2D a une règle `.famille-<clé>` par clé (plan.css), `autre` comprise.
 *
 * ── Adaptateur pur (apps/web/src/ecrans/plan3d/scene.ts, en plus de T27) ─────────────────────
 *
 * Ni React, ni three, ni DOM. Rien n'est écrit, rien n'est stocké : les filtres sont un état local
 * de l'écran, passé en argument.
 *
 * `versScene` : inchangé, sauf que `couleur` = FAMILLES[cleFamille].bande pour les 17 clés. Une
 *   barre dont `cleFamille` est nulle (plan écrit à la main) reste COULEUR_NEUTRE, comme en T27.
 *   Seule une planche SANS culture a la couleur COULEUR_NEUTRE ; `cleFamille` y reste nulle.
 *
 * FiltresScene : trois dimensions. Pour chacune, `null` = tout est coché (pas de restriction) ;
 *   un ensemble = seules ces valeurs sont cochées (ensemble vide = rien de coché). Valeurs :
 *   familles → clés de famille (une culture dont cleFamille est nulle compte pour 'autre') ;
 *   cultures → `VolumeScene.culture` (libellé de la barre) ; zones → `zoneId`.
 *
 * `estompe(volume, filtres)` : vrai si le volume n'est PAS coché sur au moins une dimension.
 *   Une planche vide (culture nulle) n'a ni famille ni culture : elle n'est cochée sur ces deux
 *   dimensions que si la dimension vaut `null` (pas de restriction) ; la zone, elle, s'applique.
 *   Donc : FILTRES_TOUT → rien d'estompé ; FILTRES_RIEN → tout est estompé, vides comprises.
 *
 * `appliquerFiltres(scene, filtres)` : mêmes socles, mêmes volumes dans le même ordre, avec en plus
 *   `estompe` et `hauteurRendue`. La géométrie (x, z, longueur, largeur, hauteur) ne change pas ;
 *   `couleur` d'un volume estompé = COULEUR_ESTOMPEE (neutre pâle, hexadécimal, distinct de chacune
 *   des 17 couleurs de famille d'au moins ΔE 10) ; sinon la couleur de `versScene`. `hauteurRendue`
 *   = hauteur pour une planche avec culture ; strictement plus petite (≥ 0, « à plat » permis) pour
 *   une planche vide : une planche vide ne se confond pas avec une culture, filtre ou pas. L'entrée
 *   n'est jamais modifiée ; même entrée, même sortie.
 *
 * `optionsFiltres(scene)` : ce que la légende et les cases proposent pour la semaine affichée.
 *   familles : clés présentes sur une planche avec culture cette semaine (sans doublon), dans
 *   l'ordre de CLES_FAMILLES ; cultures : libellés distincts de la semaine, triés (localeCompare
 *   'fr') ; zones : un { id, nom } par socle, dans l'ordre du plan.
 *
 * `basculerFiltre(filtres, dimension, valeur, valeursPossibles)` : coche la valeur si elle était
 *   décochée, la décoche sinon. `valeursPossibles` = l'univers de la dimension (options). Depuis
 *   `null`, décocher donne l'univers moins la valeur. Si le résultat contient tout l'univers, la
 *   dimension redevient `null` (forme canonique : basculer deux fois la même valeur depuis
 *   FILTRES_TOUT redonne FILTRES_TOUT, au sens de toEqual). Les autres dimensions ne bougent pas.
 * `cocherTout(filtres, dimension)` → dimension à `null` ; `cocherRien(filtres, dimension)` →
 *   ensemble vide. Fonctions pures : l'entrée n'est jamais modifiée.
 */
import type { Scene, SocleScene, VolumeScene } from './contrat.ts';

/** Les 17 clés de famille, dans l'ordre canonique (celui de la légende). */
export const CLES_FAMILLES = [
  'salades',
  'solanacees',
  'cruciferes',
  'racines',
  'alliacees',
  'amaranthacees',
  'asparagacees',
  'convolvulacees',
  'cucurbitacees',
  'fabacees',
  'lamiacees',
  'paeoniacees',
  'poacees',
  'polygonacees',
  'rosacees',
  'valerianacees',
  'autre',
] as const;
export type CleFamille17 = (typeof CLES_FAMILLES)[number];

export type DimensionFiltre = 'familles' | 'cultures' | 'zones';

export interface FiltresScene {
  readonly familles: ReadonlySet<string> | null;
  readonly cultures: ReadonlySet<string> | null;
  readonly zones: ReadonlySet<string> | null;
}

export interface VolumeFiltre extends VolumeScene {
  readonly estompe: boolean;
  readonly hauteurRendue: number;
}

export interface SceneFiltree extends Omit<Scene, 'volumes'> {
  readonly volumes: readonly VolumeFiltre[];
}

export interface OptionsFiltres {
  readonly familles: readonly string[];
  readonly cultures: readonly string[];
  readonly zones: readonly Pick<SocleScene, 'id' | 'nom'>[];
}

export interface ModuleFiltres {
  readonly COULEUR_ESTOMPEE: string;
  readonly COULEUR_NEUTRE: string;
  readonly FILTRES_TOUT: FiltresScene;
  readonly FILTRES_RIEN: FiltresScene;
  optionsFiltres(scene: Scene): OptionsFiltres;
  estompe(volume: VolumeScene, filtres: FiltresScene): boolean;
  appliquerFiltres(scene: Scene, filtres: FiltresScene): SceneFiltree;
  basculerFiltre(filtres: FiltresScene, dimension: DimensionFiltre, valeur: string, valeursPossibles: readonly string[]): FiltresScene;
  cocherTout(filtres: FiltresScene, dimension: DimensionFiltre): FiltresScene;
  cocherRien(filtres: FiltresScene, dimension: DimensionFiltre): FiltresScene;
}

/**
 * ── Vue 3D (DOM), lue par apps/web/e2e/vue-3d-filtres.e2e.ts ─────────────────────────────────
 *
 * Ordinateur (≥ 1024 px) : `panneau-3d` est un panneau À CÔTÉ de la scène (même ligne), qui contient
 *   la légende et les filtres ; sa boîte et celle de `toile-3d` n'ont aucun pixel commun, la
 *   légende (`legende-3d`) est dans le panneau. Plus de légende posée sur la scène.
 * `legende-3d` : la légende, qui sert aussi de filtre par famille : une case à cocher
 *   (`filtre-famille-3d`, <input type="checkbox">, `data-valeur` = clé de famille, nom accessible
 *   = nom de la famille, coché au départ) par famille PRÉSENTE la semaine affichée
 *   (optionsFiltres(...).familles, même ordre) ; la liste suit la semaine.
 * `filtre-culture-3d` et `filtre-zone-3d` : une case par culture de la semaine et par zone
 *   (`data-valeur` = libellé de la culture / id de la zone), dans `panneau-3d`.
 * `filtre-tout-3d` et `filtre-rien-3d` : boutons, un couple par dimension (`data-dimension` =
 *   'familles' | 'cultures' | 'zones'), qui cochent tout / décochent tout cette dimension.
 * `toile-3d` gagne : `data-estompes` = nombre de planches estompées ; `data-geometries` = nombre de
 *   fois que la géométrie des volumes a été construite depuis l'ouverture de la vue (change de
 *   semaine : peut augmenter ; changer un filtre : JAMAIS).
 * `element-liste-3d` gagne `data-estompe` = 'oui' | 'non' (planche estompée par les filtres) ; la
 *   liste garde toutes les planches (estompé ≠ retiré).
 * Marque de performance MARQUES_3D_FILTRES.filtre : une image est dessinée avec le nouvel état des
 *   filtres ; detail = { estompes } (même nombre que `data-estompes`).
 * L'état des filtres est local à la vue : « Retour au plan » puis « Voir en 3D » les remet tous
 *   cochés ; rien n'est écrit ni stocké.
 */
export const TESTID_3D_FILTRES = {
  panneau: 'panneau-3d',
  legende: 'legende-3d',
  famille: 'filtre-famille-3d',
  culture: 'filtre-culture-3d',
  zone: 'filtre-zone-3d',
  tout: 'filtre-tout-3d',
  rien: 'filtre-rien-3d',
} as const;

export const MARQUES_3D_FILTRES = {
  filtre: 'planif:vue-3d-filtre',
} as const;
