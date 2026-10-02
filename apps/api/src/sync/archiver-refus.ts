/**
 * T10l : archiver un refus vu. Le téléphone écrit une seule chose dans refus_synchro :
 *
 *   { op: 'PATCH', table: 'refus_synchro', id, donnees: { archive_le: <instant ISO> } }
 *
 * accepté seulement pour un refus de l'utilisateur authentifié. Contrat :
 * archiver-refus.integration.test.ts.
 *
 * Isolement (T10d) : le refus d'un autre utilisateur, même d'un collègue de la même ferme, répond
 * exactement comme un id inconnu ('table_interdite', ferme nulle). Les vérifications qui précèdent
 * la lecture de la ligne (opération, colonnes, valeur) ne dépendent que de l'écriture reçue : la
 * réponse ne dit jamais si l'id existe chez quelqu'un d'autre. La borne basse (cree_le − 1 jour)
 * ne se vérifie qu'une fois la ligne trouvée parmi les refus de l'utilisateur.
 */
import type { Id } from '@planif/core';
import { sql } from 'drizzle-orm';
import { estUuid } from '../auth/jetons.ts';
import type { Refus } from './motifs.ts';
import type { TransactionDb } from './references.ts';

export const TABLE_REFUS = 'refus_synchro';

/** Instant ISO 8601 complet, avec fuseau (celui que rend `Date.toISOString()`). */
const INSTANT_ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](\d{2}):(\d{2}))$/;

const JOUR_MS = 86_400_000;

/**
 * L'instant, ou null s'il est illisible ou impossible : le jour (31 février…) doit exister, et
 * l'heure, les minutes, les secondes et le décalage rester dans leurs bornes (le moteur de dates
 * de JavaScript, lui, reporterait le 31 février au 3 mars).
 */
function lireInstant(valeur: unknown): Date | null {
  if (typeof valeur !== 'string') return null;
  const m = INSTANT_ISO.exec(valeur);
  if (m === null) return null;
  // Groupes absents (secondes, décalage de « Z ») : 0.
  const champ = (i: number): number => Number(m[i] ?? '0');
  const [annee, mois, jour] = [champ(1), champ(2), champ(3)];
  const calendrier = new Date(Date.UTC(annee, mois - 1, jour));
  if (calendrier.getUTCFullYear() !== annee || calendrier.getUTCMonth() !== mois - 1 || calendrier.getUTCDate() !== jour) return null;
  if (champ(4) > 23 || champ(5) > 59 || champ(6) > 59 || champ(7) > 23 || champ(8) > 59) return null;
  const date = new Date(valeur);
  return Number.isNaN(date.getTime()) ? null : date;
}

interface EcritureArchivage {
  readonly op: 'PUT' | 'PATCH' | 'DELETE' | null;
  readonly id: string;
  readonly donnees: Readonly<Record<string, unknown>> | null;
  readonly donneesIllisibles: boolean;
}

/**
 * Archive le refus `e.id` de `utilisateurId` : null si accepté (déjà archivé compris : la première
 * date est gardée), sinon le refus. Dans la transaction de l'appelant.
 */
export async function archiverRefus(
  tx: TransactionDb,
  e: EcritureArchivage,
  utilisateurId: Id<'Utilisateur'>,
  maintenant: Date,
): Promise<Refus | null> {
  const interdit: Refus = { motif: 'table_interdite', fermeId: null };
  // Un refus ne se crée ni ne s'efface depuis le téléphone.
  if (e.op !== 'PATCH') return interdit;
  if (e.donneesIllisibles || e.donnees === null) return { motif: 'ecriture_invalide', detail: 'archivage sans données', fermeId: null };
  // Seule la date d'archivage se modifie.
  const colonnes = Object.keys(e.donnees);
  if (colonnes.length !== 1 || colonnes[0] !== 'archive_le') return interdit;
  const archiveLe = lireInstant(e.donnees.archive_le);
  if (archiveLe === null) return { motif: 'ecriture_invalide', detail: 'archive_le illisible', fermeId: null };
  // Plus d'un jour d'avance sur l'heure du serveur : horloge du téléphone déréglée ou envoi forgé.
  if (archiveLe.getTime() > maintenant.getTime() + JOUR_MS) return { motif: 'ecriture_invalide', detail: 'archive_le dans le futur', fermeId: null };
  if (!estUuid(e.id)) return interdit;

  const id = e.id.toLowerCase();
  const { rows } = await tx.execute<{ archive_le: unknown; cree_le: unknown }>(
    sql`SELECT archive_le, cree_le FROM refus_synchro WHERE id = ${id}::uuid AND utilisateur_id = ${utilisateurId}::uuid FOR UPDATE`,
  );
  const [ligne] = rows;
  // Id inconnu ou refus d'autrui : même réponse.
  if (ligne === undefined) return interdit;
  // Archivé plus d'un jour avant d'avoir été refusé : impossible (lu seulement pour son propre refus).
  const creeLe = new Date(ligne.cree_le instanceof Date ? ligne.cree_le.getTime() : String(ligne.cree_le));
  if (!Number.isNaN(creeLe.getTime()) && archiveLe.getTime() < creeLe.getTime() - JOUR_MS) {
    return { motif: 'ecriture_invalide', detail: 'archive_le antérieur au refus', fermeId: null };
  }
  // Déjà archivé (autre téléphone, envoi rejoué) : accepté, la première date est gardée.
  if (ligne.archive_le !== null) return null;
  await tx.execute(
    sql`UPDATE refus_synchro SET archive_le = ${archiveLe.toISOString()}::timestamptz
        WHERE id = ${id}::uuid AND utilisateur_id = ${utilisateurId}::uuid AND archive_le IS NULL`,
  );
  return null;
}
