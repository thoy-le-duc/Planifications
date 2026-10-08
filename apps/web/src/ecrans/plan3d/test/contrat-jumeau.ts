/**
 * Contrat de T28c — jumeau 3D : la ferme à sa vraie place (docs/backlog/T28c-jumeau-3d.md, Q30,
 * Q31). Complète ./contrat.ts (T27), ./contrat-filtres.ts (T27b) et ./contrat-camera.ts (T29), qui
 * ne changent pas : une ferme sans placement donne exactement la scène de T27. Types et constantes
 * seulement : les tests chargent les modules par import dynamique (chemin tenu dans une variable),
 * leur typage ne dépend pas du code pas encore écrit.
 *
 * ── Ce que T28c demande au plan 2D (apps/web/src/ecrans/plan/calculs.ts) ─────────────────────
 *
 * Le placement est recopié de la base locale, sans calcul (la 2D ne l'affiche pas). Tout est
 * FACULTATIF dans le plan, de sorte qu'un plan sans placement (ou écrit à la main) reste valide :
 *   DonneesPlan.batiment?   lignes `batiment` de la ferme (colonnes snake_case du schéma local) ;
 *   ligne `zone` locale     colonne `contour` : texte JSON `[{"x":…,"y":…},…]` ou nul ;
 *   ligne `emplacement`     colonnes `placement_x_m`, `placement_y_m`, `orientation_deg` (déjà lues
 *                           par `versEmplacement`) ; `chargerPlan` et `lireDonneesPlan` lisent ces
 *                           colonnes (zone.contour, emplacement.placement_*, table batiment) ;
 *   LigneZonePlan           (sorte 'zone', pas 'chapelle') : `contour` = points {x, y} du repère de
 *                           la ferme, ou nul ; absent = nul ;
 *   LigneEmplacementPlan    `placement` = { x, y, orientationDeg } dans le repère de la ZONE RACINE
 *                           (même pour une planche de chapelle), ou nul ; absent = nul ;
 *   Plan.batiments          les bâtiments NON supprimés de la ferme, ordre de la table (tri par
 *                           nom puis id) ; absent = aucun. `zoneId` = zone abritée (racine) ou nul.
 * Les trois champs de la planche sont nuls ensemble ou renseignés ensemble (règle de la base) ; un
 * plan où ce n'est pas le cas (placement partiel) est traité comme non placé.
 *
 * ── Repère de la scène ──────────────────────────────────────────────────────────────────────
 *
 * Mètres réels = mètres de scène : l'échelle d'une scène PLACÉE est 1 (positions en mètres de la
 * ferme). x_scène = x_ferme (vers l'est) ; z_scène = −y_ferme (le nord est au fond, vers −z, la
 * carte se lit comme sur un plan). y_scène = hauteur, le sol est y = 0.
 * Un cap (degrés, sens horaire depuis le nord) devient un `angle` (radians, convention de three :
 * un point (dx, dz) relatif au centre devient (dx·cos a + dz·sin a, −dx·sin a + dz·cos a), comme
 * `Boite.angle` de T29). Deux familles de rectangles, par la place de leur longueur :
 *   - volume de planche : `longueur` selon l'axe x LOCAL, `largeur` selon z local ;
 *     angle = π/2 − cap (une planche de cap 90°, longueur vers l'est, a angle 0) ;
 *   - socle d'une zone abritée et bâtiment : `largeur` selon x local, `profondeur` (= la longueur
 *     du bâtiment) selon z local ; angle = −cap du bâtiment (cap 0 : longueur nord-sud, angle 0).
 * Les angles sont rendus à 2π près (tout représentant convient) ; pour un rectangle, à π près.
 *
 * ── Règles de `versScene(plan, semaine)` avec placement ─────────────────────────────────────
 *
 * Repère d'une zone racine : `repereZone` de @planif/core (T28a) — celui de son bâtiment s'il en a
 * un (qui prime sur un contour), sinon centroïde et cap du plus long côté de son contour. Une
 * planche placée a pour centre `depuisRepereZone(repere, {x, y})` et pour cap
 * (cap de la zone + orientationDeg) modulo 360.
 *   - Zone abritée (un bâtiment la nomme par `zoneId`) : socle = rectangle du bâtiment (x, z =
 *     centre ; largeur = largeurM ; profondeur = longueurM ; angle ; contour nul ; placee vrai).
 *   - Zone avec contour, sans bâtiment : socle = boîte englobante du contour (x, z, largeur,
 *     profondeur, angle 0), `contour` = les sommets dans l'ordre du plan, en repère de scène
 *     (x, −y) ; placee vrai.
 *   - Zone sans contour ni bâtiment : rangement automatique de T27 (placee faux, angle 0, contour
 *     nul), ses planches aussi, même si elles portent un placement (sans repère, il n'a pas de
 *     sens) ; ces zones sont rangées À CÔTÉ de la partie placée : leurs socles ne recoupent pas la
 *     boîte englobante (x, z) de tout ce qui est placé (socles, bâtiments, volumes).
 *   - Planche sans placement dans une zone placée : rangée automatiquement DANS le rectangle de la
 *     zone abritée (ou dans la boîte du contour), alignée sur la zone, sans recouvrir une autre
 *     planche ; placee faux.
 *   - Planche placée : placee vrai ; longueur et largeur recopiées (échelle 1) ; volume centré.
 *   - Les socles, bâtiments et volumes ne se recouvrent jamais (rectangles tournés pris tels
 *     quels ; un socle à contour compte par sa boîte englobante).
 *   - Bâtiment : un par bâtiment du plan, dans l'ordre du plan, abrité ou non. Rectangle :
 *     x, z (centre), largeur, profondeur, angle comme plus haut ; hauteur = hauteurM.
 *     forme   'tunnel' (serre_tunnel) | 'chapelles' (serre_chapelle) | 'volume' (hangar, magasin,
 *             autre : murs + toit) ;
 *     arceaux positions le long de l'axe z LOCAL, croissantes, de −profondeur/2 à +profondeur/2
 *             (extrémités comprises), régulièrement espacées d'environ 2 m (entre 1,5 et 2,5 m) ;
 *             au moins 2 ; [] pour un volume ;
 *     nefs    nombre de chapelles accolées : 1 pour le tunnel et le volume ; pour serre_chapelle
 *             un entier ≥ 1 tel que largeur / nefs soit entre 4 et 10 m (largeur ≥ 4 m) ;
 *     opacite 1 pour un volume ; pour une serre, la bâche : strictement entre 0 et 0,4 ;
 *     couleur une valeur de COULEURS (src/ui/jetons.ts), les jetons de l'appli.
 *   - Un socle de zone abritée porte `batimentId`.
 * Sans aucun placement : `batiments` = [], socles et volumes comme en T27 (placee faux, angle 0,
 * contour nul, batimentId nul). `batiments` est toujours présent dans la scène.
 *
 * Inchangé : semaine, cultures, couleurs, `hauteur`, ordre des volumes et des socles (ordre du plan),
 * pureté (entrée jamais modifiée, même sortie pour même entrée, ni Date ni Math.random ni three).
 *
 * ── Filtres (T27b) et vol (T29) ─────────────────────────────────────────────────────────────
 *
 * `appliquerFiltres` ne touche ni la géométrie ni les bâtiments (mêmes objets), et une zone
 * abritée est une zone comme une autre pour le filtre « zones » (`optionsFiltres.zones`).
 * `boiteDe` (cadrage.ts) accepte une scène sans `batiments` (scènes écrites à la main de T29) et :
 *   { sorte: 'zone', id }       zone abritée : le rectangle du socle, avec son `angle` (min/max
 *                               = centre ± moitié de largeur / profondeur, non tournés), hauteur
 *                               = max(hauteur du bâtiment, volumes de la zone) ; zone à contour :
 *                               boîte du socle, sans angle ; inchangé pour une zone non placée ;
 *   { sorte: 'batiment', id }   le rectangle du bâtiment, avec son angle, de 0 à sa hauteur ;
 *   { sorte: 'ferme' }          l'union des socles, bâtiments et volumes : la boîte axée sur les
 *                               axes (sans angle) des coins tournés de chacun, hauteur = la plus
 *                               haute de ces hauteurs ;
 *   identifiant inconnu → RangeError. `cadrage` accepte déjà une boîte tournée (T29).
 * Un clic sur une serre ou sur une bâche vole vers sa zone ; un bâtiment sans zone vole vers
 * `{ sorte: 'batiment', id }` (marque volFin : detail.cible = l'id du bâtiment).
 *
 * ── Vue 3D (DOM), lue par apps/web/e2e/vue-3d-jumeau.e2e.ts ──────────────────────────────────
 *
 * `toile-3d` gagne : `data-batiments` = nombre de bâtiments dessinés ; `data-arceaux` = nombre
 *   total d'arceaux dessinés (somme des `arceaux.length`) ; `data-placees` = nombre de planches
 *   placées (volumes avec placee vrai). Tous trois valent 0 sans placement, et sont écrits à
 *   chaque image comme `data-volumes`. Le rendu reste à la demande (`data-rendus` constant au
 *   repos) ; les bâches ne font pas de tri coûteux (pas de boucle de rendu permanente).
 * Alternative texte : `liste-3d` inchangée (une entrée par planche) ; en plus, une liste
 *   `liste-batiments-3d` (role list, nom accessible « Bâtiments ») avec un `element-batiment-3d` par
 *   bâtiment (`data-id`, texte = nom et type) ; absente s'il n'y a aucun bâtiment.
 *
 * Mesures de T27 conservées sur une grande ferme PLACÉE : affichage < 1 s après le chargement du
 * module, semaine < 100 ms, au plus 2 images perdues d'affilée au glissé. Budgets inchangés :
 * `jsVue3dGzKio` 200, `jsInitialGzKio` 71 (apps/web/budget.json).
 */
import type { CleFamille, LigneEmplacementPlan, LigneZonePlan } from '../../plan/calculs.ts';
import type { Scene, SocleScene, VolumeScene } from './contrat.ts';

export type { CleFamille };

/** Point du repère de la ferme : mètres, x vers l'est, y vers le nord. */
export interface PointFerme {
  readonly x: number;
  readonly y: number;
}

/** Point du repère de la scène (x, z), en mètres. */
export interface PointScene {
  readonly x: number;
  readonly z: number;
}

export type TypeBatiment = 'serre_tunnel' | 'serre_chapelle' | 'hangar' | 'magasin' | 'autre';
export const TYPES_BATIMENT_ATTENDUS: readonly TypeBatiment[] = ['serre_tunnel', 'serre_chapelle', 'hangar', 'magasin', 'autre'];

export interface BatimentPlan {
  readonly id: string;
  readonly nom: string;
  readonly type: TypeBatiment;
  readonly longueurM: number;
  readonly largeurM: number;
  readonly hauteurM: number;
  readonly centre: PointFerme;
  /** Cap de la longueur, degrés, sens horaire depuis le nord, dans [0, 360[. */
  readonly orientationDeg: number;
  /** Zone racine abritée, ou nul. */
  readonly zoneId: string | null;
}

export interface PlacementPlanche {
  readonly x: number;
  readonly y: number;
  /** Relatif à l'axe de la zone : le cap de la planche est celui de la zone plus cette valeur. */
  readonly orientationDeg: number;
}

export type LigneZonePlan3d = LigneZonePlan & { readonly contour?: readonly PointFerme[] | null };
export type LigneEmplacementPlan3d = LigneEmplacementPlan & {
  readonly longueurM: number;
  readonly largeurM: number | null;
  readonly placement?: PlacementPlanche | null;
};
export interface PlanJumeau {
  readonly saison: { readonly id: string; readonly nom: string; readonly debut: string; readonly fin: string };
  readonly semaines: readonly { readonly annee: number; readonly semaine: number; readonly libelle: string; readonly lundi: string }[];
  readonly semaineCourante: number | null;
  readonly lignes: readonly (LigneZonePlan3d | LigneEmplacementPlan3d)[];
  readonly batiments?: readonly BatimentPlan[];
}

export type FormeBatiment = 'tunnel' | 'chapelles' | 'volume';

export interface SocleJumeau extends SocleScene {
  /** Radians (convention de three) ; 0 hors zone abritée. */
  readonly angle: number;
  /** Sommets du contour en repère de scène (x, −y), ou nul (rectangle). */
  readonly contour: readonly PointScene[] | null;
  readonly placee: boolean;
  /** Bâtiment qui abrite la zone, ou nul. */
  readonly batimentId: string | null;
}

export interface VolumeJumeau extends VolumeScene {
  readonly angle: number;
  readonly placee: boolean;
}

export interface BatimentScene {
  readonly id: string;
  readonly nom: string;
  readonly type: TypeBatiment;
  readonly zoneId: string | null;
  readonly x: number;
  readonly z: number;
  readonly largeur: number;
  readonly profondeur: number;
  readonly hauteur: number;
  readonly angle: number;
  readonly forme: FormeBatiment;
  readonly arceaux: readonly number[];
  readonly nefs: number;
  readonly opacite: number;
  readonly couleur: string;
}

export interface SceneJumeau extends Omit<Scene, 'socles' | 'volumes'> {
  readonly socles: readonly SocleJumeau[];
  readonly volumes: readonly VolumeJumeau[];
  readonly batiments: readonly BatimentScene[];
}

export interface ModuleJumeau {
  versScene(plan: PlanJumeau, semaine: number): SceneJumeau;
}

/** Ce que l'e2e lit en plus sur la toile et la liste texte. */
export const TESTID_3D_JUMEAU = {
  listeBatiments: 'liste-batiments-3d',
  elementBatiment: 'element-batiment-3d',
} as const;
