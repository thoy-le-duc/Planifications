/**
 * Contrat de T86 — les sous-zones d'une serre se dessinent en bandes dans l'éditeur de placement
 * (docs/backlog/T86-sous-zones-dans-serre.md). Complète ./contrat.ts et ./contrat-parcelle.ts. Calcul pur du
 * cœur : packages/core/src/placement/bandes.test.ts. Aucune table ni colonne nouvelle : les bandes sont calculées.
 *
 * ── Écran (EditeurPlacement) ─────────────────────────────────────────────────────────────────
 *
 * Une zone abritée par une serre (tunnel ou chapelle) qui a des sous-zones non supprimées (`zone_parente_id`) : chaque
 * sous-zone est dessinée en bande, par l'élément `bande-serre` (bouton nommé d'après la sous-zone ; toucher le bouton
 * choisit la sous-zone), et par un `zone-contour` (data-id = la sous-zone), en lecture comme en édition. Attributs de
 * `bande-serre` : data-id (la sous-zone), data-rang et data-total (« bande 2 sur 3 »), data-x et data-y (centre dans le
 * repère de la ferme, mètres), data-longueur et data-largeur (mètres, au millimètre). Les bandes suivent la serre.
 *
 * Panneau d'une sous-zone de zone abritée : « Dans la serre Tri-tunnel, bande 2 sur 3 » ; ni « Tracer le contour » ni
 * « Dessiner depuis les planches » ni « Placer la serre ».
 *
 * Panneau de la zone abritée, en édition : champ « Passe-pied (cm) » (45 au départ) et bouton « Ranger les planches dans
 * les bandes » : les emplacements en service de chaque sous-zone se rangent dans leur bande (règle de T85), les emplacements
 * rattachés à la zone elle-même gardent leur place. Au brouillon ; « Enregistrer » : UN porte.placer, un placement par
 * emplacement rangé. Une sous-zone dont les planches ne tiennent pas : message `bande-avertissement` (« Manon 2 : 2 planches
 * dépassent de la bande »), qui ne bloque pas « Enregistrer ». Une sous-zone qui a un contour tracé à la main : le bouton
 * demande d'abord « Effacer et ranger » (le contour passe à null dans le même appel) ou « Ranger sans effacer ».
 */
export const TESTID_BANDES = {
  bande: 'bande-serre',
  avertissement: 'bande-avertissement',
} as const;

export const BOUTONS_BANDES = {
  ranger: 'Ranger les planches dans les bandes',
  effacerEtRanger: 'Effacer et ranger',
  rangerSansEffacer: 'Ranger sans effacer',
} as const;

export const CHAMPS_BANDES = {
  passePied: 'Passe-pied (cm)',
} as const;

export const PASSE_PIED_DEPART_CM = 45;
