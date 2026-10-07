/**
 * Contrat de T27 — vue 3D (docs/backlog/T27-vue-3d-prototype.md, Q29). Types seuls : les tests
 * chargent les modules par import dynamique (chemin tenu dans une variable), leur typage ne dépend
 * pas du code pas encore écrit.
 *
 * ── Modules attendus ─────────────────────────────────────────────────────────────────────────
 *
 * apps/web/src/ecrans/plan3d/scene.ts — adaptateur PUR (ModuleScene) : ni React, ni three, ni
 *   réseau, ni Date. N'importe de @planif/core que des types ; ne calcule aucune valeur
 *   agronomique (ni date, ni durée, ni quantité, ni conflit) : il ne place que ce que le plan
 *   (`construirePlan`, vue 2D) a déjà calculé. Importable sous Node (e2e) et dans le JS de
 *   démarrage sans rien tirer de three.
 *
 * apps/web/src/ecrans/plan3d/index.ts — la vue (ModuleVue3d), chargée par import dynamique
 *   seulement (bouton « Voir en 3D » de l'écran Planches) : c'est le seul morceau qui importe
 *   `three` et `@react-three/fiber` (pas `@react-three/drei`).
 *
 * ── Ce que T27 demande au plan 2D (apps/web/src/ecrans/plan/calculs.ts) ─────────────────────
 *
 * Pour dimensionner les volumes, chaque `LigneEmplacementPlan` porte en plus la taille réelle de
 * l'emplacement, recopiée de la base locale (aucun calcul) :
 *   longueurM : number          (emplacement.longueur_m)
 *   largeurM  : number | null   (emplacement.largeur_m, nulle si non renseignée)
 * Rien d'autre ne change dans le plan.
 *
 * ── Règles de `versScene(plan, semaine)` ─────────────────────────────────────────────────────
 *
 * `semaine` : indice dans `plan.semaines` (0 = première colonne de la 2D). Hors bornes ou non
 *   entier → RangeError.
 * Socles : un par ligne `sorte: 'zone'` du plan, dans l'ordre du plan (les chapelles ne
 *   font pas de socle : leurs planches sont sur le socle de leur zone racine, `zoneId`). Un socle
 *   est un rectangle posé au sol : centre (x, z), largeur (selon x) et profondeur (selon z) en
 *   mètres de scène, strictement positives, même pour une zone sans planche. Les socles ne se
 *   chevauchent pas.
 * Volumes : un par ligne `sorte: 'emplacement'` du plan, dans l'ordre du plan, y compris une
 *   planche vide (aucune culture cette semaine). Dimensions en mètres de scène, proportionnelles à
 *   la réalité par UN facteur d'échelle commun à toute la scène : `longueur` (selon x) =
 *   longueurM × échelle ; `largeur` (selon z) = largeurM × échelle, ou, si largeurM est nulle,
 *   LARGEUR_PAR_DEFAUT_M × échelle ; `hauteur` > 0, la même pour toutes les planches. Chaque volume
 *   est posé dans le socle de sa zone (centre x, z ; emprise comprise dans celle du socle) et ne
 *   recouvre aucun autre volume.
 * Culture en place la semaine `i` : une barre dont [debutJour, finJour[ recoupe [7i, 7i + 7[
 *   (jours depuis le lundi de la première semaine, comme le plan). S'il y en a plusieurs, celle qui
 *   couvre le plus de jours de la semaine ; à égalité, la première dans l'ordre du plan.
 *   Le volume porte alors : `culture` = barre.libelle, `occupationId` = barre.occupationId,
 *   `cleFamille` = barre.cleFamille, `couleur` = FAMILLES[cleFamille].bande (src/ui/jetons.ts, la
 *   couleur de la 2D) ; cleFamille nulle → COULEUR_NEUTRE. Aucune culture : `culture` et
 *   `occupationId` nuls, `cleFamille` nulle, `couleur` = COULEUR_NEUTRE.
 * Pure : même entrée, même sortie ; l'entrée n'est jamais modifiée.
 */
import type { CleFamille, LigneEmplacementPlan, LigneZonePlan, Plan } from '../../plan/calculs.ts';

/** Le plan de la 2D, avec les dimensions que T27 y ajoute. */
export type LigneEmplacementPlan3d = LigneEmplacementPlan & {
  readonly longueurM: number;
  readonly largeurM: number | null;
};
export type Plan3d = Omit<Plan, 'lignes'> & {
  readonly lignes: readonly (LigneZonePlan | LigneEmplacementPlan3d)[];
};

export interface SocleScene {
  readonly id: string;
  readonly nom: string;
  readonly x: number;
  readonly z: number;
  readonly largeur: number;
  readonly profondeur: number;
}

export interface VolumeScene {
  /** Identifiant de l'emplacement. */
  readonly id: string;
  readonly code: string;
  readonly zoneId: string;
  readonly x: number;
  readonly z: number;
  readonly longueur: number;
  readonly largeur: number;
  readonly hauteur: number;
  readonly couleur: string;
  readonly cleFamille: CleFamille | null;
  readonly culture: string | null;
  readonly occupationId: string | null;
}

export interface Scene {
  readonly semaine: number;
  /** 'S14', recopié de plan.semaines. */
  readonly libelleSemaine: string;
  readonly socles: readonly SocleScene[];
  readonly volumes: readonly VolumeScene[];
}

export interface ModuleScene {
  versScene(plan: Plan3d, semaine: number): Scene;
  readonly COULEUR_NEUTRE: string;
  /** Largeur supposée (m) d'une planche sans largeur renseignée. */
  readonly LARGEUR_PAR_DEFAUT_M: number;
}

/** Ce que l'e2e lit sur la vue 3D (data-testid) : voir apps/web/e2e/vue-3d.e2e.ts. */
export const TESTID_3D = {
  bouton: 'voir-en-3d',
  vue: 'vue-3d',
  toile: 'toile-3d',
  curseur: 'curseur-semaine',
  semaine: 'semaine-3d',
  repli: 'repli-2d',
  liste: 'liste-3d',
  elementListe: 'element-liste-3d',
  retour2d: 'retour-2d',
} as const;

/**
 * ── Vue 3D (DOM), lue par apps/web/e2e/vue-3d.e2e.ts ─────────────────────────────────────────
 *
 * Écran Planches : bouton « Voir en 3D » (`voir-en-3d`), visible sur ordinateur (≥ 1024 px de
 *   large). Un tap charge le morceau 3D (import dynamique) et affiche la vue à la place du plan 2D.
 * `vue-3d` : racine de la vue 3D ; `data-etat` = 'chargement' | 'pret' ; `data-semaine` = indice
 *   (plan.semaines) de la semaine affichée, à l'ouverture celle de `plan.semaineCourante`, ou 0 s'il
 *   n'y en a pas. Contient « Retour au plan » (`retour-2d`, bouton), qui ramène à la vue 2D.
 * `toile-3d` : le <canvas> WebGL ; `data-volumes` = nombre de volumes dessinés (un par planche),
 *   `data-rendus` = nombre d'images dessinées depuis l'ouverture : rendu À LA DEMANDE, il ne bouge
 *   pas quand rien ne change (pas de boucle permanente) ; il avance quand la caméra ou la semaine
 *   change. Le pointeur (bouton gauche enfoncé, glissé) fait tourner la vue autour de la ferme.
 * `curseur-semaine` : <input type="range"> de nom accessible « Semaine », min 0, max
 *   semaines.length - 1, pas 1, `aria-valuetext` = libellé de la semaine ('S14') ; les flèches du
 *   clavier la changent d'une semaine. `semaine-3d` : le libellé de la semaine affiché.
 * `liste-3d` : l'alternative texte, une liste (role list, nom accessible commençant par
 *   « Planches et cultures »), présente en permanence ; `element-liste-3d` : un par planche, dans
 *   l'ordre du plan, `data-id` = id de l'emplacement, `data-culture` = culture de la semaine ('' si
 *   vide), le texte contient le code de la planche et la culture (ou « vide »).
 * `repli-2d` : message (role status) affiché sur la vue 2D quand la 3D est impossible (WebGL
 *   refusé) ; il contient « 3D » ; la vue 2D (`plan-defilement`) reste affichée, `vue-3d` n'existe pas.
 *
 * Marques de performance (performance.mark) :
 *   MARQUES_3D.module   : le morceau 3D est chargé et prêt à servir (à chaque ouverture ; tout de
 *                         suite si le module est déjà en mémoire) ;
 *   MARQUES_3D.affichee : la vue 3D a dessiné sa première image (planches colorées) ;
 *   MARQUES_3D.semaine  : une image est dessinée pour la nouvelle semaine ; detail = { semaine }.
 */
export const MARQUES_3D = {
  module: 'planif:vue-3d-module',
  affichee: 'planif:vue-3d-affichee',
  semaine: 'planif:vue-3d-semaine',
} as const;
