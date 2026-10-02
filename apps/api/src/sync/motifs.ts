/** Motifs de refus d'une écriture du téléphone (T10, T10c, T10d, T10g), partagés par upload.ts et stock.ts. */

export type MotifRefus =
  | 'ferme_interdite'
  | 'auteur_invalide'
  | 'ajout_seul'
  | 'table_interdite'
  | 'ecriture_invalide'
  | 'lot_trop_gros'
  /** T10g (Q20) : correction d'une récolte annulée, ou annulation d'une annulation. */
  | 'recolte_annulee';

export interface Refus {
  readonly motif: MotifRefus;
  /**
   * Précision ajoutée au message ('ecriture_invalide' seulement : messages.ts), en français simple,
   * sans jargon. Jamais de donnée d'une autre ferme.
   */
  readonly precision?: string;
  /**
   * Détail technique (code SQLSTATE, colonne, code d'erreur du cœur…), écrit au journal du
   * serveur, jamais envoyé au téléphone. Ni adresse e-mail, ni note, ni valeur saisie.
   */
  readonly detail?: string;
  /** Ferme visée, si connue. */
  readonly fermeId?: string | null;
}
