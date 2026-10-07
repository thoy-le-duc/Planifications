/**
 * Contrat de T29 — vue 3D : la caméra vole vers une zone (docs/backlog/T29-vol-camera.md, Q30).
 * Complète ./contrat.ts (T27) et ./contrat-filtres.ts (T27b), qui ne changent pas. Types et
 * constantes seulement : les tests chargent les modules par import dynamique (chemin tenu dans
 * une variable), leur typage ne dépend pas du code pas encore écrit.
 *
 * ── Module pur (apps/web/src/ecrans/plan3d/cadrage.ts) ───────────────────────────────────────
 *
 * Ni React, ni three, ni DOM, ni horloge (aucun Date, aucun performance.now) : des nombres en
 * entrée, des nombres en sortie, importable sous Node. Il n'importe rien d'exécutable (des types
 * seulement) : il ne pèse rien au démarrage et ne change pas `jsVue3dGzKio`.
 * Repère de la scène (celui de scene.ts) : x vers la droite, y vers le haut, z vers l'avant du
 * plan ; le sol est y = 0. Distances en mètres de scène, angles en radians sauf `champVertical`
 * (degrés, comme le `fov` de three).
 *
 * `Boite` : parallélépipède {min, max} aligné sur les axes, éventuellement tourné de `angle`
 *   radians autour de la verticale passant par son centre. Rotation à la manière de three.js
 *   (rotation.y) : un point (dx, dz) relatif au centre devient
 *   (dx·cos θ + dz·sin θ, −dx·sin θ + dz·cos θ). `angle` absent = 0. min ≤ max sur chaque axe
 *   (sinon RangeError) ; une boîte plate ou réduite à un point est permise.
 *
 * `boiteDe(scene, cible)` : la boîte à cadrer.
 *   { sorte: 'ferme' }          toute la scène : union des socles et des volumes ;
 *   { sorte: 'zone', id }       le socle `id` et les volumes dont `zoneId` est `id` ;
 *   { sorte: 'planche', id }    le volume `id`.
 *   Emprise en x, z : celle des socles et volumes (centre ± moitié de largeur / profondeur,
 *   `longueur` selon x, `largeur` selon z). Hauteur : de y = 0 (le sol, la face haute des socles)
 *   à la plus haute `VolumeScene.hauteur` de la boîte (`hauteur`, pas `hauteurRendue` : le cadrage
 *   ne dépend ni des filtres ni de la semaine) ; 0 s'il n'y a aucun volume. Pas d'`angle` : les
 *   zones de la scène sont alignées sur les axes. Scène sans socle ni volume et cible `ferme` →
 *   `null` (rien à cadrer : la vue garde sa caméra). Identifiant inconnu → RangeError.
 *
 * `cadrage(boite, champVertical, rapportEcran, direction)` → Pose { position, cible } :
 *   - `cible` = le centre de la boîte (x, y, z) ;
 *   - `direction` = vecteur HORIZONTAL {x, z} qui va de la cible vers la caméra (« dans le sens de
 *     la caméra actuelle », pas de demi-tour inutile) ; il n'a pas besoin d'être unitaire ; nul →
 *     RangeError ;
 *   - plongée de 45° : position.y − cible.y = distance horizontale entre position et cible, et la
 *     projection horizontale de (position − cible) est de même sens que `direction` ;
 *   - la boîte (ses 8 coins, après rotation) tient entière à l'écran avec 10 % de marge : vue
 *     depuis `position`, regardant `cible`, verticale y vers le haut, champ vertical
 *     `champVertical`, écran de rapport largeur/hauteur `rapportEcran`, chaque coin est devant la
 *     caméra et dans [−0,9 ; 0,9] sur les deux axes de l'écran (−1…1) ; et c'est serré : l'un des
 *     coins atteint au moins 0,75 (pas de recul inutile : un cadrage sur la sphère englobante d'un
 *     tunnel de 50 m × 8 m échoue ici) ;
 *   - distance au moins `DISTANCE_MIN_M` (boîte réduite à un point : une planche minuscule ne
 *     colle pas la caméra au sol) ;
 *   - `champVertical` hors ]0 ; 180[, `rapportEcran` ≤ 0 ou non fini → RangeError.
 *   Pure : même entrée, même sortie, entrée jamais modifiée. Une très grande zone (plusieurs km)
 *   donne des nombres finis.
 *
 * ── Le vol ───────────────────────────────────────────────────────────────────────────────────
 *
 * `demarrerVol(depart, arrivee, mouvementReduit)` → Vol { depart, arrivee, dureeMs } :
 *   - `dureeMs` ≤ DUREE_VOL_MAX_MS (600) ; `mouvementReduit` vrai → `dureeMs` = 0 (saut direct) ;
 *     deux poses distinctes de plus de 1 m → entre 100 et 600 ms (un vol, pas un saut) ;
 *   - un nouveau clic pendant le vol repart de là où on est : l'appelant passe
 *     `poseAu(volEnCours, écoulé)` comme `depart` (le vol n'a pas d'autre état).
 * `poseAu(vol, ecouleMs)` → Pose :
 *   - ecouleMs ≤ 0 → exactement `depart` ; ecouleMs ≥ dureeMs → exactement `arrivee` (toEqual,
 *     pas « presque ») ; dureeMs = 0 → toujours `arrivee` ;
 *   - entre les deux : position ET cible suivent le segment départ → arrivée au même avancement
 *     p(t) ∈ [0 ; 1] (interpolation linéaire des deux points, adoucie par p) ;
 *   - p est croissante, vaut 0,5 à mi-durée (à 0,02 près) et démarre et finit en douceur : à 5 %
 *     de la durée p < 0,05 (plus lent que du linéaire) et à 95 % p > 0,95 ; à 1 % de la durée
 *     p < 0,005.
 *
 * ── Vue 3D (DOM), lue par apps/web/e2e/vue-3d-camera.e2e.ts ──────────────────────────────────
 *
 * `toile-3d` gagne (mis à jour à chaque image dessinée, avec la caméra de cette image) :
 *   `data-camera` = JSON `{"position":{"x","y","z"},"cible":{"x","y","z"}}` (nombres complets) ;
 *   `data-champ` = champ vertical en degrés (40) ; `data-vol` = 'oui' pendant un vol, 'non' sinon
 *   (jamais 'oui' avec le mouvement réduit) ; `data-vols` = nombre de vols lancés depuis
 *   l'ouverture (un saut direct compte comme un vol ; un glissé ou la molette n'en lance pas).
 * Zone : un clic (pointeur enfoncé puis relâché sans glisser de plus de 4 px) sur un socle OU sur
 *   une planche de la scène lance le vol vers la zone (socle) concernée : la sélection d'une
 *   planche seule est hors périmètre (T29), la planche est donc cadrée par sa zone.
 *   Un glissé (tourner la vue) ne lance aucun vol.
 * Liste texte : dans le groupe « Zones » du panneau, un bouton par zone (socle), dans l'ordre du
 *   plan : `aller-zone-3d`, `data-id` = id du socle, nom accessible « Aller à <nom de la zone> » ;
 *   Entrée ou Espace au clavier le déclenche (bouton natif). Un bouton `vue-ensemble-3d`, nom
 *   accessible « Vue d’ensemble », cadre toute la ferme (`boiteDe(scene, { sorte: 'ferme' })`).
 *   Le cadrage du vol utilise le sens de la caméra au moment du clic, le champ `data-champ` et le
 *   rapport largeur/hauteur affichés de la toile (boundingBox).
 * Mouvement réduit : `matchMedia('(prefers-reduced-motion: reduce)')` est lu à CHAQUE vol (le
 *   réglage peut changer sans recharger la page) : saut direct, une seule image, sans animation.
 * Rendu à la demande conservé : `data-rendus` n'avance qu'avec le vol (au moins 3 images pendant
 *   un vol), plus du tout au repos une fois arrivé.
 * Marque de performance MARQUES_3D_CAMERA.volFin : posée à l'image dessinée avec la pose finale ;
 *   detail = { cible } : 'ferme' ou l'id de la zone. Pas de marque si le vol est remplacé par un
 *   autre avant d'arriver.
 */
import type { Scene } from './contrat.ts';

export interface Point3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Boite {
  readonly min: Point3;
  readonly max: Point3;
  /** Rotation autour de la verticale, au centre de la boîte (radians, convention de three). */
  readonly angle?: number;
}

export interface Pose {
  readonly position: Point3;
  readonly cible: Point3;
}

export interface Direction {
  readonly x: number;
  readonly z: number;
}

export type CibleVol = { readonly sorte: 'ferme' } | { readonly sorte: 'zone'; readonly id: string } | { readonly sorte: 'planche'; readonly id: string };

export interface Vol {
  readonly depart: Pose;
  readonly arrivee: Pose;
  readonly dureeMs: number;
}

export interface ModuleCadrage {
  readonly DUREE_VOL_MAX_MS: number;
  readonly MARGE_CADRAGE: number;
  readonly PLONGEE_DEGRES: number;
  readonly DISTANCE_MIN_M: number;
  boiteDe(scene: Scene, cible: CibleVol): Boite | null;
  cadrage(boite: Boite, champVertical: number, rapportEcran: number, direction: Direction): Pose;
  demarrerVol(depart: Pose, arrivee: Pose, mouvementReduit: boolean): Vol;
  poseAu(vol: Vol, ecouleMs: number): Pose;
}

export const TESTID_3D_CAMERA = {
  zone: 'aller-zone-3d',
  ensemble: 'vue-ensemble-3d',
} as const;

export const MARQUES_3D_CAMERA = {
  volFin: 'planif:vue-3d-vol-fin',
} as const;

/** Durée maximale d'un vol (ms) : le ticket T29. */
export const DUREE_VOL_MAX_MS = 600;
