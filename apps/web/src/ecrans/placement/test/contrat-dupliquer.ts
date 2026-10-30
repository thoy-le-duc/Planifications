/**
 * Contrat de T90 — « Dupliquer une serre ou une parcelle » (docs/backlog/T90-dupliquer.md). Complète ./contrat-serre.ts (T89).
 * Calcul pur (noms, positions) : packages/core/src/placement/duplication.test.ts ; écran : ../dupliquer-editeur.test.tsx.
 *
 * ── Le bouton « Dupliquer » ──────────────────────────────────────────────────────────────────
 *
 * Dans le panneau de l'élément (`panneau-placement`), en mode modification (gérant, plan déverrouillé), un bouton « Dupliquer »
 * (data-testid `dupliquer`) est proposé pour :
 *   - une serre (serre_tunnel ou serre_chapelle) choisie sur le plan et qui abrite une zone ;
 *   - la zone abritée par une serre, ou une zone de plein champ AVEC contour, choisies dans la liste des zones.
 * Pas pour : un autre bâtiment (hangar), une serre sans zone, une zone sans contour, une sous-zone qui est une bande de serre, ni en lecture
 * (équipier, plan verrouillé). Pendant un enregistrement le bouton est désactivé.
 *
 * ── La fiche (role="dialog", nom accessible « Dupliquer », data-testid `fiche-duplication`) ──
 *
 * Champs <input> par nom accessible EXACT (CHAMPS_DUPLICATION) : « Nombre de copies » (1 par défaut), « Écart (m) » (1,5 par défaut).
 * Élément `resume-duplication` : ce que la copie crée (« 1 copie : 4 zones, 24 planches, 1 bâtiment », pluriels accordés).
 * Boutons : « Dupliquer » (dans la fiche ; désactivé avec un message `aide-duplication` quand la demande est refusée : nombre hors 1-20 ou non entier,
 * écart négatif ou illisible, ou plus de 500 changements en un enregistrement, ceux déjà au brouillon compris) et « Annuler » (ferme sans rien changer).
 *
 * « Dupliquer » ferme la fiche et met les copies AU BROUILLON (rien n'est écrit) : serre : bâtiment, zone abritée, sous-zones, planches ; plein
 * champ : zone, contour, planches. Les copies sont alignées du côté x positif de l'original (largeur + écart entre deux copies voisines), même cap.
 * Les éléments du brouillon sont comptés par `brouillon-serre` (data-batiments, data-zones, data-sous-zones, data-emplacements, comme T89).
 * « Enregistrer » : UN SEUL porte.placer. « Annuler » (après l'enregistrement) et « Abandonner les changements » retirent toutes les copies.
 */
export const BOUTONS_DUPLICATION = {
  dupliquer: 'Dupliquer',
  annuler: 'Annuler',
} as const;

export const CHAMPS_DUPLICATION = {
  nombre: 'Nombre de copies',
  ecart: 'Écart (m)',
} as const;

export const TESTID_DUPLICATION = {
  ouvrir: 'dupliquer',
  fiche: 'fiche-duplication',
  resume: 'resume-duplication',
  aide: 'aide-duplication',
} as const;
