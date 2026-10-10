/**
 * Contrat de T28k — le placement au doigt sur le téléphone (docs/backlog/T28k-placement-au-doigt.md, Q36).
 * Lu par doigt-editeur.test.tsx et e2e/placement-doigt.e2e.ts. Le DOM décrit ici s'ajoute à celui de
 * ./contrat.ts, ./contrat-contours.ts et ./contrat-etapes.ts, sans le changer, sauf ce qui suit.
 *
 * ── Ce qui change ────────────────────────────────────────────────────────────────────────────
 * Le gérant édite aussi sur téléphone et tablette : `data-mode` vaut 'edition' pour un gérant actif
 * QUELLE QUE SOIT la taille de l'écran. La prop `ordinateur` ne décide plus du mode ; elle dit
 * seulement la taille de l'écran (défaut : matchMedia('(min-width: 1024px)')) et se lit dans
 * `data-ecran`. Le message MESSAGES_PLACEMENT.ordinateur (« à faire sur ordinateur ») disparaît
 * de l'éditeur. Un équipier reste en lecture seule (MESSAGES_PLACEMENT.seulGerant), partout.
 *
 * ── Attributs d'état de `editeur-placement` ──────────────────────────────────────────────────
 *   data-ecran  = 'telephone' (écran de moins de 1 024 px) | 'ordinateur' ;
 *   data-geste  = 'aucun' | 'carte' | 'element' | 'sommet' | 'deux-doigts' : le geste au doigt en
 *                 cours ('aucun' au repos et dès que le dernier doigt est levé).
 *
 * ── Gestes au doigt (PointerEvent, pointerType 'touch', un pointerId par doigt) ──────────────
 *   - Un tap (doigt posé puis levé, déplacement sous 4 px) sur un élément le SÉLECTIONNE
 *     (aria-pressed="true") et ne le déplace pas : data-x, data-y, data-orientation inchangés.
 *   - Un doigt qui glisse sur l'élément DÉJÀ sélectionné le déplace (même calcul que la souris :
 *     translation en mètres, 1 px = metresParPixel du zoom). Rien n'est écrit pendant le geste.
 *   - Un doigt qui glisse sur la carte, ou sur un élément NON sélectionné, déplace la carte (la
 *     vue) ; l'élément ne bouge pas (data-x, data-y inchangés) et n'est pas sélectionné.
 *   - Deux doigts qui s'écartent ou se rapprochent zooment : à la levée du dernier doigt, data-zoom
 *     a changé de round(log2(distance finale / distance initiale)) niveaux (borné par les zooms
 *     minimal et maximal de l'éditeur). Distance ×2 → +1 ; distance ÷2 → −1.
 *   - Deux doigts qui tournent, un élément étant sélectionné, tournent l'élément : son cap
 *     (data-orientation) change de l'angle dont a tourné la droite qui joint les doigts (sens
 *     horaire à l'écran = cap qui augmente), au degré près. Sans élément sélectionné, les deux
 *     doigts ne font que zoomer. Rien n'est écrit pendant le geste ; un doigt qui se lève met fin
 *     au geste à deux doigts, le doigt restant ne déplace plus rien avant d'être levé.
 *   - Un doigt sur un sommet de contour le déplace (comme la souris).
 *   - `plan-placement` a style.touchAction = 'none' (attribut `style` en ligne, pas seulement la
 *     feuille de style), en édition comme en lecture seule : la page ne défile pas pendant un geste
 *     sur la carte. Il en va de même pour chaque `batiment`, `planche` et `sommet`.
 *
 * ── Barre du bas (`barre-doigt`) ─────────────────────────────────────────────────────────────
 *   Mode édition seulement, après le plan dans le DOM. Elle contient les boutons larges (au moins
 *   TAILLE_MIN_CIBLE_PX de haut et de large, vérifié par le e2e) :
 *   `tourner-moins` (nom accessible BOUTONS_DOIGT.moins) et `tourner-plus` (BOUTONS_DOIGT.plus) :
 *     présents seulement quand un bâtiment ou une planche est sélectionné ; un tap tourne la
 *     sélection de 5° (cap ramené dans [0, 360[), au brouillon, sans rien écrire ;
 *   « Enregistrer » (le bouton existant) et « Annuler » (`annuler-placement`) y sont aussi.
 *
 * ── Sommets de contour ───────────────────────────────────────────────────────────────────────
 *   Écran 'telephone', mode édition : chaque `sommet` a style.width et style.height en ligne d'au
 *   moins TAILLE_MIN_CIBLE_PX px (zone tactile ; le dessin peut rester plus petit à l'intérieur).
 *   Appui long (doigt posé immobile sur un `cote-contour`, DELAI_APPUI_LONG_MS ms, puis levé) :
 *   ajoute un sommet au milieu de ce côté (comme le clic de la souris), au brouillon. Un tap bref
 *   au doigt sur un côté n'ajoute RIEN (aucun ajout involontaire) ; le clic de la souris garde son
 *   comportement. Un doigt qui bouge de plus de 4 px pendant l'attente annule l'appui long.
 *
 * ── Mineurs de la relecture de T28j ──────────────────────────────────────────────────────────
 *   - `etapes-placement` est visible aussi en lecture seule (équipier) : quatre étapes, mêmes états.
 *   - Une étape 'a-venir' est aria-disabled="true" et a un aria-describedby qui désigne un élément
 *     au texte non vide, la raison. Une étape 'faite' ou 'en-cours' n'est pas aria-disabled
 *     (attribut absent ou "false").
 */

/** Zone tactile minimale, en pixels CSS (gants). */
export const TAILLE_MIN_CIBLE_PX = 44;

/** L'appui long dure entre ces deux bornes (ms). */
export const DELAI_APPUI_LONG_MS = { min: 400, max: 800 } as const;

/** Pas des boutons de rotation, en degrés. */
export const PAS_ROTATION_DEG = 5;

export const TESTID_DOIGT = {
  barre: 'barre-doigt',
  tournerMoins: 'tourner-moins',
  tournerPlus: 'tourner-plus',
} as const;

/** Noms accessibles exacts (le signe moins est U+2212). */
export const BOUTONS_DOIGT = {
  moins: 'Tourner −5°',
  plus: 'Tourner +5°',
} as const;

export type GesteDoigt = 'aucun' | 'carte' | 'element' | 'sommet' | 'deux-doigts';
