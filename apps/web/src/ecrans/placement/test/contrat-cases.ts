/**
 * Contrat de T88 — une serre découpée en cases (chapelles × tronçons) dans l'éditeur de placement
 * (docs/backlog/T88-serre-en-grille-modele.md). Complète ./contrat-bandes.ts (T86). Calcul pur du cœur :
 * packages/core/src/placement/cases.test.ts.
 *
 * ── Écran (EditeurPlacement) ─────────────────────────────────────────────────────────────────
 *
 * Quand le bâtiment qui abrite la zone a une grille (nb_chapelles ou nb_troncons non nul), l'éditeur dessine une case par
 * (chapelle, tronçon) à la place des bandes : élément `case-serre`, bouton nommé d'après la sous-zone ; toucher le bouton choisit la
 * sous-zone. Une case vide (moins de sous-zones que de cases) est dessinée sans nom, `data-vide="true"`, non cliquable pour choisir.
 * Attributs de `case-serre` : data-id (la sous-zone, vide si case vide), data-chapelle et data-troncon (de 1), data-x et data-y (centre
 * dans le repère de la FERME, mètres), data-longueur et data-largeur (mètres, au millimètre), data-vide ("true" ou "false").
 * Colonnes nulles : T86 inchangé (éléments `bande-serre`, aucun `case-serre`). Une sous-zone sans case n'est dessinée nulle part.
 *
 * Plus de sous-zones que de cases : élément `serre-avertissement`, texte « 2 zones n'ont pas de place dans la serre » (non bloquant).
 *
 * « Ranger les planches dans les bandes » (même bouton, même passe-pied qu'en T86) range les planches de chaque sous-zone dans SA case
 * (règle de T85, bloc centré dans la case) ; les planches d'une sous-zone sans case restent où elles sont.
 */
export const TESTID_CASES = {
  casesSerre: 'case-serre',
  avertissementSerre: 'serre-avertissement',
} as const;
