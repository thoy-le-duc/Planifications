/** Motifs de refus d'une écriture du téléphone (T10, T10c, T10d), partagés par upload.ts et stock.ts. */

export type MotifRefus = 'ferme_interdite' | 'auteur_invalide' | 'ajout_seul' | 'table_interdite' | 'ecriture_invalide' | 'lot_trop_gros';

export interface Refus {
  readonly motif: MotifRefus;
  /** Précision ajoutée au message (données invalides). Jamais de donnée d'une autre ferme. */
  readonly precision?: string;
  /** Ferme visée, si connue. */
  readonly fermeId?: string | null;
}
