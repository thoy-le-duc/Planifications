/**
 * Contrat de T28d — contours de zones en formes libres dans l'éditeur de placement
 * (docs/backlog/T28d-contours-zones.md, Q31 ; modèle : docs/modele-donnees.md, « 1 bis. Placement
 * réel — v1.x »). Complète ./contrat.ts (T28b), qui reste valable en entier. Types seuls : les
 * tests chargent les modules par import dynamique (chemin tenu dans une variable).
 *
 * ── Module attendu (apps/web/src/ecrans/placement/) ──────────────────────────────────────────
 *
 * contours.ts — PUR (ModuleContours) : ni React, ni DOM, ni réseau, ni horloge. Gestes sur les
 *   sommets d'un contour (repère local de la ferme : mètres, x est, y nord) et tracé point par
 *   point. La validation est celle du cœur, `validerContour` de @planif/core (par le sous-chemin
 *   '@planif/core/placement', via ./coeur.ts, comme T28b : le point d'entrée racine du cœur
 *   alourdirait le morceau de l'éditeur). Aucune fonction ne modifie ses arguments ; chacune rend
 *   un tableau neuf.
 *
 * ── Écran (EditeurPlacement, mêmes props que T28b) ───────────────────────────────────────────
 *
 * `liste-zones` : liste des zones non supprimées de la ferme, dans le panneau latéral, en
 *   édition comme en lecture. Un bouton `zone-choix` par zone : data-id, nom accessible qui
 *   contient le nom de la zone, aria-pressed="true" quand la zone est sélectionnée. Le toucher
 *   sélectionne la zone (et désélectionne bâtiment ou planche ; sélectionner un bâtiment
 *   désélectionne la zone).
 *
 * Zone sélectionnée, abritée par un bâtiment (lu ou au brouillon, `zone_id` = la zone) : message
 *   `zone-abritee` (role="status") qui contient MESSAGES_CONTOURS.zoneAbritee ; ni « Tracer le
 *   contour », ni `contour-edition`, ni `sommet`, ni `cote-contour` (sa forme suit la serre, Q31).
 *
 * Zone sélectionnée, non abritée, en mode édition (gérant actif sur ordinateur) :
 *   - Sans contour : bouton « Tracer le contour » (désactivé sans point de départ du plan : aucun
 *     placement sans origine). Le toucher ouvre le tracé : `contour-edition` data-etat="trace" ;
 *     chaque clic sur le plan (pointerdown + pointerup au même endroit, sans glisser) pose un
 *     sommet au point cliqué (depuisEcran) — `poserPoint` ; un clic sur le premier sommet (ou à
 *     moins de TOLERANCE_FERMETURE_PX de lui), ou Entrée, ferme le tracé s'il a 3 sommets au
 *     moins ; Échap ou le bouton « Renoncer au tracé » l'abandonne (rien au brouillon). Pendant le
 *     tracé, « Enregistrer » est désactivé et rien n'est écrit. Fermé, le contour va au brouillon
 *     (même s'il est invalide : il est alors montré en rouge, voir plus bas).
 *   - Avec contour (lu ou au brouillon) : `contour-edition` data-id = la zone, data-etat =
 *     'valide' | 'invalide' (verdict de validerContour sur le contour affiché), data-sommets = n.
 *     Dedans (ou à côté, dans le plan) :
 *       `sommet` × n, dans l'ordre des index dans le DOM (Tab passe du sommet i au sommet i + 1) :
 *         centré sur son point à l'écran (versEcran, à 2 px près), au-dessus des bâtiments et planches ;
 *         role="button", tabindex 0, nom accessible qui contient « Sommet {i + 1} », data-index i,
 *         data-x, data-y (m, valeurs AFFICHÉES, brouillon compris), aria-pressed="true" quand il
 *         est sélectionné (focus ou clic). Glisser (pointerdown, pointermove, pointerup) déplace le
 *         sommet (depuisEcran) ; clic droit (événement contextmenu, empêché) le retire ; touches :
 *         `toucheSommet` (flèches, Maj, Inser, Suppr / Retour arrière). Un retrait refusé (3
 *         sommets) laisse le contour tel quel et affiche un message (role="status" ou "alert") qui
 *         contient « au moins 3 sommets ».
 *       `cote-contour` × n : data-index i = le côté du sommet i au sommet (i + 1) mod n. Un clic
 *         (pointerdown + pointerup sans glisser, ou click) insère le MILIEU de ce côté
 *         (`insererMilieu`), quel que soit le point cliqué sur le côté.
 *     `contour-erreur` (role="alert") : présent quand le contour affiché est invalide, contient le
 *       message exact de validerContour ; « Enregistrer » est alors désactivé (même si le reste du
 *       brouillon est valide). Absent quand le contour est valide.
 *   - Panneau `panneau-placement` : pour chaque sommet k = 1..n, deux <input type="number">
 *     nommés « Sommet {k} x (m) » et « Sommet {k} y (m) » ; une saisie (change) modifie le
 *     brouillon. En lecture : désactivés (disabled ou readonly), ou absents.
 *
 * Lecture seule (équipier, ou téléphone) : `liste-zones` présente, une zone se sélectionne, mais
 *   ni « Tracer le contour », ni `sommet`, ni `cote-contour` ; les touches et clics ne changent
 *   rien ; rien n'est écrit.
 *
 * Planches de la zone (décision du chef) : un contour modifié (ou tracé) d'une zone sans serre
 *   laisse ses planches placées à leur place et à leur cap ABSOLUS, à l'affichage (data-x, data-y,
 *   data-orientation des `planche` inchangés pendant le geste) comme en base : « Enregistrer » écrit
 *   dans le MÊME porte.placer le contour { sorte: 'zone' } ET, pour chaque planche placée de la
 *   zone, { sorte: 'emplacement', id, placement } recalculé (replacerPlanches, arrondi au mm et au
 *   millième de degré). L'annulation remet contour et planches exactement. Zone sans planche
 *   placée : le contour seul.
 * Écriture : « Enregistrer » = UN appel à porte.placer avec tout le brouillon (bâtiments,
 *   planches, contours) ; un contour s'écrit { sorte: 'zone', id, contour } (sommets arrondis au
 *   millimètre ; la porte le range en sens antihoraire). Puis « Annuler » (`annuler-placement`)
 *   et Ctrl+Z comme T28b : l'annulation remet le contour d'avant à l'identique (null compris).
 *   Rien n'est écrit pendant un geste, un tracé, une saisie.
 * Changement de porte ou de fermeId sans démontage (T28b, B1) : tracé, brouillon de contour,
 *   sélection de zone, « Annuler » et pile Ctrl+Z repartent à vide.
 * Hors ligne : fond neutre (T28b), le tracé et l'enregistrement marchent pareil.
 */
import type { Point, Touche } from './contrat.ts';

export type { Point, Touche };

export interface ModuleContours {
  /** Rayon, en pixels de l'écran, autour du premier sommet où un clic ferme le tracé : entre 6 et 24. */
  readonly TOLERANCE_FERMETURE_PX: number;
  /**
   * Insère le milieu du côté `cote` (du sommet `cote` au sommet (cote + 1) mod n) à l'index
   * cote + 1 (pour le dernier côté : à la fin). `cote` hors de [0, n[ ou non entier : copie
   * inchangée. Pas de plafond ici (au-delà de 200 sommets, validerContour refuse).
   */
  insererMilieu(contour: readonly Point[], cote: number): Point[];
  /** Le sommet `index` vient en `vers` ; les autres inchangés. Index hors bornes : copie inchangée. */
  deplacerSommet(contour: readonly Point[], index: number, vers: Point): Point[];
  /** Retire le sommet `index`. Jamais sous 3 sommets : à 3 sommets (ou moins), null. Index hors bornes : copie inchangée. */
  retirerSommet(contour: readonly Point[], index: number): Point[] | null;
  /**
   * Clavier sur le sommet `index` (repère de la ferme, nord en haut) :
   *   flèches = 0,1 m (Maj : 1 m) — droite → +x, gauche → −x, haut → +y, bas → −y — coordonnées
   *     arrondies au micromètre (comme appliquerTouche de T28b) ; index inchangé ;
   *   'Insert' = insererMilieu(contour, index) ; index → index + 1 (le nouveau sommet) ;
   *   'Delete' ou 'Backspace' = retirerSommet ; index → index mod (n − 1) (le sommet qui suit,
   *     ou le premier) ; à 3 sommets : refus, { contour inchangé (copie), index inchangé, refuse: true } ;
   *   toute autre touche : null (l'éditeur la laisse passer, Tab compris).
   * `refuse` vaut true seulement pour le retrait refusé.
   */
  toucheSommet(contour: readonly Point[], index: number, touche: Touche): { contour: Point[]; index: number; refuse: boolean } | null;
  /**
   * Tracé point par point. `toleranceM` = TOLERANCE_FERMETURE_PX × m/px de la vue.
   *   - 3 sommets ou plus et p à toleranceM au plus du premier : { sommets inchangés, ferme: true }
   *     (le premier sommet n'est jamais répété à la fin) ;
   *   - moins de 3 sommets et p à toleranceM au plus du premier : ignoré { inchangés, ferme: false } ;
   *   - p à moins de 1 mm du dernier sommet (double clic) : ignoré ;
   *   - sinon p est ajouté à la fin, ferme: false.
   */
  poserPoint(trace: readonly Point[], p: Point, toleranceM: number): { sommets: Point[]; ferme: boolean };
  /**
   * Verdict en direct : celui de validerContour du cœur, message compris.
   * Valide : { ok: true, contour } (sens antihoraire, x et y seulement) ; sinon { ok: false, code, message }.
   */
  verifierContour(contour: readonly Point[]): { ok: true; contour: Point[] } | { ok: false; code: string; message: string };
  /**
   * Décision du chef (T28d) : quand le contour d'une zone sans serre change, son repère change
   * (centroïde, cap du plus long côté : repereZone du cœur), mais les planches placées de la zone
   * NE BOUGENT PAS sur le terrain. Rend, dans le même ordre, le placement de chaque planche dans le
   * repère du NOUVEAU contour qui garde sa position et son cap ABSOLUS (repère de la ferme) : à
   * 1 mm et 0,01° près, orientation_deg dans [0, 360[. Contour ancien ou nouveau sans repère
   * (invalide) : copie inchangée.
   */
  replacerPlanches(ancien: readonly Point[], nouveau: readonly Point[], planches: readonly PlancheDansZone[]): PlancheDansZone[];
}

export interface PlancheDansZone {
  readonly id: string;
  readonly placement: { readonly x: number; readonly y: number; readonly orientation_deg: number };
}

/** Messages exacts (contenus dans le texte affiché). */
export const MESSAGES_CONTOURS = {
  /** Zone abritée par une serre (ou un autre bâtiment) : pas de contour à tracer. */
  zoneAbritee: 'sa forme est celle de la serre',
  /** Retrait refusé à 3 sommets. */
  sommetsMin: 'au moins 3 sommets',
} as const;

export const TESTID_CONTOURS = {
  listeZones: 'liste-zones',
  zoneChoix: 'zone-choix',
  zoneAbritee: 'zone-abritee',
  edition: 'contour-edition',
  sommet: 'sommet',
  cote: 'cote-contour',
  erreur: 'contour-erreur',
} as const;

/** Libellés exacts des boutons. */
export const BOUTONS_CONTOURS = {
  tracer: 'Tracer le contour',
  renoncer: 'Renoncer au tracé',
} as const;
