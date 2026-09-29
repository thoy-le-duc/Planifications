/**
 * Références d'un événement reçu du téléphone (relecture T10, B1) : chaque identifiant qu'il
 * porte doit désigner une ligne de SA ferme. Sinon un téléphone pourrait rattacher une saisie à
 * la série, la vanne ou l'événement d'une autre ferme, et en apprendre l'existence.
 *
 * Vérifié dans la transaction de l'insertion, lignes verrouillées (FOR SHARE) jusqu'à la fin :
 * pas de fenêtre où la ligne visée changerait de ferme ou disparaîtrait entre la vérification
 * et l'écriture.
 */
import type { LigneEvenement } from '@planif/db';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

/** Transaction Drizzle (celle de `db.transaction`). */
export type TransactionDb = Parameters<Parameters<NodePgDatabase['transaction']>[0]>[0];

export type RefusReference =
  | { readonly motif: 'ferme_interdite'; readonly precision: string }
  | { readonly motif: 'ecriture_invalide'; readonly precision: string };

interface Reference {
  /** Table Postgres visée. */
  readonly table: 'serie' | 'campagne' | 'emplacement' | 'evenement' | 'secteur_irrigation' | 'produit_phyto';
  readonly ids: readonly string[];
  /** Ce que le maraîcher lit dans le message. */
  readonly libelle: string;
  /** Ligne partagée (ferme_id nul) acceptée : la bibliothèque de produits phyto. */
  readonly bibliothequeAcceptee?: boolean;
}

/** Identifiants portés par l'événement, table par table (seuls ces deux-là existent dans les Detail* de T01). */
function references(l: LigneEvenement): Reference[] {
  const liste: Reference[] = [];
  if (l.serieId !== null) liste.push({ table: 'serie', ids: [l.serieId], libelle: 'série' });
  if (l.campagneId !== null) liste.push({ table: 'campagne', ids: [l.campagneId], libelle: 'campagne' });
  if (l.emplacementIds.length > 0) liste.push({ table: 'emplacement', ids: [...new Set(l.emplacementIds)], libelle: 'emplacement' });
  if (l.remplaceEvenementId !== null) {
    liste.push({ table: 'evenement', ids: [l.remplaceEvenementId], libelle: 'événement remplacé' });
  }
  // Le détail a été lu selon son type (evenement.ts) : ces clés n'existent que pour l'irrigation et le traitement.
  const detail = l.detail;
  if ('secteurIrrigationId' in detail) {
    liste.push({ table: 'secteur_irrigation', ids: [detail.secteurIrrigationId.toLowerCase()], libelle: "secteur d'irrigation" });
  }
  if ('produitPhytoId' in detail) {
    liste.push({
      table: 'produit_phyto',
      ids: [detail.produitPhytoId.toLowerCase()],
      libelle: 'produit phytosanitaire',
      bibliothequeAcceptee: true,
    });
  }
  return liste;
}

/** null si toutes les références sont dans la ferme de l'événement ; sinon le refus. */
export async function verifierReferences(tx: TransactionDb, l: LigneEvenement): Promise<RefusReference | null> {
  for (const r of references(l)) {
    const ids = sql.join(
      r.ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    const lignes = await tx.execute<{ id: string; ferme_id: string | null }>(
      sql`SELECT id::text AS id, ferme_id::text AS ferme_id FROM ${sql.identifier(r.table)} WHERE id IN (${ids}) FOR SHARE`,
    );
    const fermes = new Map(lignes.rows.map((x) => [x.id, x.ferme_id]));
    for (const id of r.ids) {
      if (!fermes.has(id)) return { motif: 'ecriture_invalide', precision: `${r.libelle} introuvable` };
      const ferme = fermes.get(id) ?? null;
      const partagee = ferme === null && r.bibliothequeAcceptee === true;
      if (ferme !== l.fermeId && !partagee) return { motif: 'ferme_interdite', precision: `${r.libelle} d'une autre ferme` };
    }
  }
  return null;
}
