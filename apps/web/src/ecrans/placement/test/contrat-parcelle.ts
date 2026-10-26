/**
 * Contrat de T85 — dessiner la parcelle d'une zone à partir de ses planches, la déplacer et la
 * tourner d'un bloc (docs/backlog/T85-parcelle-depuis-planches.md). Complète ./contrat.ts (T28b) et
 * ./contrat-contours.ts (T28d). Calcul pur du cœur : packages/core/src/placement/parcelle.test.ts.
 *
 * ── Modules ──────────────────────────────────────────────────────────────────────────────────
 *
 * contours.ts (pur) — le bloc d'une zone avec contour :
 *   `mouvoirBloc(contour, calage, mouvement)` : le contour et le repère de ses planches (« calage »)
 *   subissent le même mouvement rigide : rotation de `rotationDeg` (sens horaire) autour du centre du
 *   repère du contour, puis translation (dx, dy). Les planches gardent leur placement DANS le calage :
 *   elles suivent. Contour sans repère (invalide) : null.
 *   `replacerEntreReperes(avant, apres, planches)` : comme `replacerPlanches`, mais entre deux repères.
 *
 * parcelle-planches.ts (chargé à la demande) — `preparerParcelle(zoneId, emplacements, passePiedCm, centre)` :
 *   le rectangle de la parcelle (4 sommets, sens antihoraire, longueur vers le nord, centré sur `centre`),
 *   son repère, et le placement de chaque emplacement dans ce repère (millimètre, millième de degré) ;
 *   ou un refus { ok: false, message } (passe-pied invalide, contour refusé par le cœur).
 *
 * ── Écran (EditeurPlacement) ─────────────────────────────────────────────────────────────────
 *
 * Zone sélectionnée, en édition, non abritée, de type qui se trace (plein champ, hors-sol), SANS contour
 * (lu ou au brouillon), qui a au moins un emplacement en service (non supprimé, actif_au nul, longueur
 * connue) : bouton « Dessiner depuis les planches » AVANT « Tracer le contour » (qui reste), désactivé
 * sans point de départ du plan ; champ « Passe-pied (cm) » (entier de 0 à 500, 45 au départ) ;
 * message `parcelle-annonce` quand des emplacements sont déjà placés (« 2 planches déjà placées seront
 * rangées »). Le toucher met au brouillon le contour (4 sommets, au centre de la vue) et le placement de
 * chaque emplacement de la zone (recalés compris) ; rien n'est écrit. « Enregistrer » : UN porte.placer
 * (zone puis emplacements).
 *
 * Zone avec contour valide, en édition, non abritée : `zone-interieur` (glisser l'intérieur déplace le
 * contour ET les planches du même vecteur), `poignee-rotation-zone` (tourne le bloc autour de son centre,
 * Maj : par 15°), champ « Orientation (°) » (cap de l'axe de la zone, [0, 180[). Les planches gardent
 * leur place dans la zone. En lecture (équipier) : aucun des trois.
 */
export const TESTID_PARCELLE = {
  interieur: 'zone-interieur',
  poigneeRotation: 'poignee-rotation-zone',
  annonce: 'parcelle-annonce',
} as const;

export const BOUTONS_PARCELLE = {
  dessiner: 'Dessiner depuis les planches',
  tracer: 'Tracer le contour',
} as const;

export const CHAMPS_PARCELLE = {
  passePied: 'Passe-pied (cm)',
  orientation: 'Orientation (°)',
} as const;

export const PASSE_PIED_DEPART_CM = 45;
