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

/**
 * T10d : une correction de récolte garde la série, la campagne et l'unité de la récolte
 * d'ORIGINE de sa chaîne (l'événement sans remplace_evenement_id tout en haut). Corriger une
 * récolte saisie sur la mauvaise série ou dans la mauvaise unité : on l'annule, puis on la
 * ressaisit. À appeler après verifierReferences (l'événement remplacé est de la ferme). Les
 * événements sont en ajout seul : la chaîne ne change pas, rien à verrouiller.
 */
export async function verifierCorrection(tx: TransactionDb, l: LigneEvenement): Promise<RefusReference | null> {
  if (l.type !== 'recolte' || l.remplaceSorte !== 'correction' || l.remplaceEvenementId === null) return null;
  const unite = 'unite' in l.detail && typeof l.detail.unite === 'string' ? l.detail.unite : null;
  // Montée par la clé composée (ferme_id, remplace_evenement_id) : toute la chaîne est de la ferme.
  const r = await tx.execute<{ garde: boolean }>(
    sql`WITH RECURSIVE montee(id, parent, profondeur) AS (
          SELECT id, remplace_evenement_id, 0 FROM evenement WHERE id = ${l.remplaceEvenementId}::uuid AND ferme_id = ${l.fermeId}::uuid
          UNION ALL
          SELECT e.id, e.remplace_evenement_id, m.profondeur + 1
          FROM evenement e JOIN montee m ON e.id = m.parent
          WHERE m.profondeur < ${PROFONDEUR_MAX_CHAINE}
        )
        SELECT (o.serie_id IS NOT DISTINCT FROM ${l.serieId}::uuid
                AND o.campagne_id IS NOT DISTINCT FROM ${l.campagneId}::uuid
                AND o.detail ->> 'unite' IS NOT DISTINCT FROM ${unite}::text) AS garde
        FROM montee m JOIN evenement o ON o.id = m.id
        WHERE m.parent IS NULL`,
  );
  const origine = r.rows[0];
  if (origine === undefined) return { motif: 'ecriture_invalide', precision: "récolte d'origine introuvable" };
  if (!origine.garde) {
    return { motif: 'ecriture_invalide', precision: "une correction garde la série, la campagne et l'unité de la récolte : annulez-la puis ressaisissez-la" };
  }
  return null;
}

/** Un événement de la chaîne d'une récolte, tel que la base le connaît. */
export interface MaillonChaine {
  readonly id: string;
  readonly remplace_sorte: 'correction' | 'annulation' | null;
  /** detail.quantite si c'est un nombre (toujours, pour une récolte : CHECK de la base). */
  readonly quantite: number | null;
  readonly profondeur: number;
}

/**
 * Chaîne de l'événement `id` : son origine (l'événement sans remplace_evenement_id tout en haut),
 * les corrections de l'origine, les corrections de ces corrections, et toutes leurs annulations,
 * dans l'ordre (origine d'abord, puis horodatage, puis id). null si `id` est introuvable dans la
 * ferme, ou si la chaîne dépasse PROFONDEUR_MAX_CHAINE niveaux (jamais de chaîne partielle).
 * Montée par la clé composée (ferme_id, remplace_evenement_id) : toute la chaîne est de la ferme.
 */
export async function lireMaillons(tx: TransactionDb, id: string, fermeId: string): Promise<MaillonChaine[] | null> {
  const racine = await tx.execute<{ id: string }>(
    sql`WITH RECURSIVE montee(id, parent, profondeur) AS (
          SELECT id, remplace_evenement_id, 0 FROM evenement WHERE id = ${id}::uuid AND ferme_id = ${fermeId}::uuid
          UNION ALL
          SELECT e.id, e.remplace_evenement_id, m.profondeur + 1
          FROM evenement e JOIN montee m ON e.id = m.parent
          WHERE m.profondeur < ${PROFONDEUR_MAX_CHAINE}
        )
        SELECT id::text AS id FROM montee WHERE parent IS NULL`,
  );
  const origine = racine.rows[0]?.id;
  if (origine === undefined) return null;
  const r = await tx.execute<{ id: string; remplace_sorte: MaillonChaine['remplace_sorte']; quantite: number | null; profondeur: number }>(
    sql`WITH RECURSIVE chaine(id, profondeur) AS (
          SELECT ${origine}::uuid, 0
          UNION ALL
          SELECT e.id, c.profondeur + 1 FROM evenement e JOIN chaine c ON e.remplace_evenement_id = c.id
          WHERE c.profondeur <= ${PROFONDEUR_MAX_CHAINE}
        )
        SELECT e.id::text AS id, e.remplace_sorte, c.profondeur,
               CASE WHEN jsonb_typeof(e.detail -> 'quantite') = 'number' THEN (e.detail ->> 'quantite')::float8 END AS quantite
        FROM chaine c JOIN evenement e ON e.id = c.id
        ORDER BY (e.remplace_sorte IS NOT NULL), e.horodatage, e.id`,
  );
  return r.rows.some((l) => l.profondeur > PROFONDEUR_MAX_CHAINE) ? null : r.rows;
}

/**
 * Maillon en vigueur d'une chaîne (T10g, décision 4) : aucun si la chaîne contient une
 * annulation ; sinon la correction la plus récente de TOUTE la chaîne (horodatage, puis id), à
 * défaut l'origine. `maillons` dans l'ordre de `lireMaillons`. Même règle que la vue
 * evenements_en_vigueur et que `enVigueur` du téléphone.
 */
export function maillonEnVigueur(maillons: readonly MaillonChaine[]): MaillonChaine | undefined {
  if (maillons.some((m) => m.remplace_sorte === 'annulation')) return undefined;
  return [...maillons].reverse().find((m) => m.remplace_sorte === 'correction') ?? maillons.find((m) => m.remplace_sorte === null);
}

export interface RefusRemplacement {
  readonly motif: 'recolte_annulee' | 'ecriture_invalide';
  readonly precision?: string;
}

/**
 * T10g (Q20) : un remplacement de récolte (correction ou annulation) reçu du téléphone.
 *   - viser une annulation (la corriger, ou « annuler l'annulation ») : 'recolte_annulee' ;
 *   - corriger une récolte dont la chaîne est annulée (par une annulation de l'origine ou de
 *     n'importe quelle correction) : 'recolte_annulee'. Une annulation redondante reste acceptée
 *     (T10d) ;
 *   - une correction plus ancienne (horodatage du téléphone, puis id) qu'une correction déjà
 *     écrite de la chaîne ne serait jamais en vigueur : refusée (décision 5, forme figée par les
 *     tests), le stock et la vue restent sur la plus récente.
 * Un événement déjà écrit (renvoi du même lot) n'est pas un nouveau remplacement : pas vérifié
 * ici, la règle du renvoi identique s'applique. À appeler après verifierReferences (l'événement
 * remplacé est de la ferme) ; sous le verrou de la ferme (upload.ts), deux remplacements d'une
 * même ferme passent l'un après l'autre.
 */
export async function verifierRemplacementRecolte(tx: TransactionDb, l: LigneEvenement): Promise<RefusRemplacement | null> {
  if (l.type !== 'recolte' || l.remplaceSorte === null || l.remplaceEvenementId === null) return null;
  const deja = await tx.execute<{ n: number }>(sql`SELECT 1 AS n FROM evenement WHERE id = ${l.id}::uuid`);
  if (deja.rows.length > 0) return null;
  const maillons = await lireMaillons(tx, l.remplaceEvenementId, l.fermeId);
  if (maillons === null) return { motif: 'ecriture_invalide', precision: `chaîne de corrections trop longue (${String(PROFONDEUR_MAX_CHAINE)} au plus)` };
  const cible = maillons.find((m) => m.id === l.remplaceEvenementId);
  if (cible?.remplace_sorte === 'annulation') return { motif: 'recolte_annulee' };
  if (l.remplaceSorte === 'annulation') return null;
  if (maillons.some((m) => m.remplace_sorte === 'annulation')) return { motif: 'recolte_annulee' };

  const corrections = maillons.filter((m) => m.remplace_sorte === 'correction').map((m) => m.id);
  if (corrections.length === 0) return null;
  const r = await tx.execute<{ plus_recente: boolean }>(
    sql`SELECT EXISTS (
          SELECT 1 FROM evenement
          WHERE id = ANY(${sql.param(corrections)}::uuid[])
            AND (horodatage, id) > (${l.horodatage.toISOString()}::timestamptz, ${l.id}::uuid)
        ) AS plus_recente`,
  );
  if (r.rows[0]?.plus_recente === true) {
    return { motif: 'ecriture_invalide', precision: 'une correction plus récente de cette récolte est déjà enregistrée' };
  }
  return null;
}
