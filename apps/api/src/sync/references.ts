/**
 * Références d'un événement reçu du téléphone (relecture T10, B1) : chaque identifiant qu'il
 * porte doit désigner une ligne de SA ferme. Sinon un téléphone pourrait rattacher une saisie à
 * la série, la vanne ou l'événement d'une autre ferme, et en apprendre l'existence.
 *
 * Vérifié dans la transaction de l'insertion, lignes verrouillées (FOR SHARE) jusqu'à la fin :
 * pas de fenêtre où la ligne visée changerait de ferme ou disparaîtrait entre la vérification
 * et l'écriture. Une ligne supprimée (supprime_le non nul) ne se référence plus (relecture T10, R4).
 *
 * T10d : la ferme est filtrée dans la requête même du verrou. Une ligne d'une autre ferme n'est
 * ni lue ni verrouillée (la requête n'attend jamais le verrou d'une autre ferme), et elle se
 * comporte exactement comme une ligne inexistante : même motif, même message.
 *
 * Une requête par table, avec un seul paramètre tableau (`= ANY($1::uuid[])`) quel que soit le
 * nombre d'identifiants (relecture T10, R1).
 */
import type { LigneEvenement } from '@planif/db';
import { sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

/** Transaction Drizzle (celle de `db.transaction`). */
export type TransactionDb = Parameters<Parameters<NodePgDatabase['transaction']>[0]>[0];

export interface RefusReference {
  readonly motif: 'ecriture_invalide';
  readonly precision: string;
}

/** Profondeur au plus d'une chaîne de corrections (garde-fou : le journal n'a pas de cycle). */
export const PROFONDEUR_MAX_CHAINE = 1_000;

interface Reference {
  /** Table Postgres visée. */
  readonly table: 'serie' | 'campagne' | 'emplacement' | 'evenement' | 'secteur_irrigation' | 'produit_phyto';
  readonly ids: readonly string[];
  /** Ce que le maraîcher lit dans le message. */
  readonly libelle: string;
  /** Ligne partagée (ferme_id nul) acceptée : la bibliothèque de produits phyto. */
  readonly bibliothequeAcceptee?: boolean;
  /** La table a une colonne supprime_le (toutes sauf `evenement`, en ajout seul). */
  readonly suppressionDouce: boolean;
}

/** Identifiants portés par l'événement, table par table (seuls ces deux-là existent dans les Detail* de T01). */
function references(l: LigneEvenement): Reference[] {
  const liste: Reference[] = [];
  if (l.serieId !== null) liste.push({ table: 'serie', ids: [l.serieId], libelle: 'série', suppressionDouce: true });
  if (l.campagneId !== null) liste.push({ table: 'campagne', ids: [l.campagneId], libelle: 'campagne', suppressionDouce: true });
  if (l.emplacementIds.length > 0) {
    liste.push({ table: 'emplacement', ids: [...new Set(l.emplacementIds)], libelle: 'emplacement', suppressionDouce: true });
  }
  if (l.remplaceEvenementId !== null) {
    liste.push({ table: 'evenement', ids: [l.remplaceEvenementId], libelle: 'événement remplacé', suppressionDouce: false });
  }
  // Le détail a été lu selon son type (evenement.ts) : ces clés n'existent que pour l'irrigation et le traitement.
  const detail = l.detail;
  if ('secteurIrrigationId' in detail) {
    liste.push({
      table: 'secteur_irrigation',
      ids: [detail.secteurIrrigationId.toLowerCase()],
      libelle: "secteur d'irrigation",
      suppressionDouce: true,
    });
  }
  if ('produitPhytoId' in detail) {
    liste.push({
      table: 'produit_phyto',
      ids: [detail.produitPhytoId.toLowerCase()],
      libelle: 'produit phytosanitaire',
      bibliothequeAcceptee: true,
      suppressionDouce: true,
    });
  }
  return liste;
}

/**
 * Condition « ligne visible par la ferme » : la sienne, ou la bibliothèque commune (ferme_id nul)
 * là où elle est acceptée. À mettre dans la requête même du verrou FOR SHARE (T10d).
 */
export function visibleParLaFerme(fermeId: string, bibliotheque: boolean): SQL {
  return bibliotheque ? sql`(ferme_id = ${fermeId}::uuid OR ferme_id IS NULL)` : sql`ferme_id = ${fermeId}::uuid`;
}

/** null si toutes les références sont dans la ferme de l'événement ; sinon le refus. */
export async function verifierReferences(tx: TransactionDb, l: LigneEvenement): Promise<RefusReference | null> {
  for (const r of references(l)) {
    const supprimee = r.suppressionDouce ? sql`supprime_le IS NOT NULL` : sql`false`;
    // sql.param : le tableau part en UN paramètre (sinon Drizzle le déplie, un paramètre par id).
    // La ferme est dans le WHERE : une ligne d'une autre ferme n'est ni rendue ni verrouillée.
    const lignes = await tx.execute<{ id: string; supprimee: boolean }>(
      sql`SELECT id::text AS id, ${supprimee} AS supprimee
          FROM ${sql.identifier(r.table)}
          WHERE id = ANY(${sql.param([...r.ids])}::uuid[]) AND ${visibleParLaFerme(l.fermeId, r.bibliothequeAcceptee === true)}
          FOR SHARE`,
    );
    const trouvees = new Map(lignes.rows.map((x) => [x.id, x]));
    for (const id of r.ids) {
      const ligne = trouvees.get(id);
      if (ligne === undefined) return { motif: 'ecriture_invalide', precision: `${r.libelle} introuvable` };
      if (ligne.supprimee) return { motif: 'ecriture_invalide', precision: `${r.libelle} : ligne supprimée` };
    }
  }
  return null;
}
