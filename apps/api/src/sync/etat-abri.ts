/**
 * T58 : changement d'état d'une serre reçu du téléphone (événement `etat_abri`, détail
 * { zoneId, equipement, actif }). Contrat : en-tête de etat-abri.integration.test.ts.
 *
 * Le détail a été lu par les règles du cœur (validerSaisie, evenement.ts) ; ce fichier ajoute ce
 * que la base seule sait :
 *   - la zone est une zone de LA ferme de l'événement : la ferme est filtrée dans la requête même
 *     du verrou (T10d), si bien qu'une zone d'une autre ferme se comporte comme une zone
 *     inexistante (même refus, même message). Une zone supprimée reste acceptée : la saisie a pu
 *     être faite hors ligne avant la suppression ;
 *   - pour une saisie nouvelle, l'équipement est déclaré par la zone (`equipementsDeZone` du cœur :
 *     sa liste, sinon le défaut de son type d'abri). Une correction ou une annulation n'est pas
 *     soumise à cette règle : retirer un équipement de la liste ne doit pas empêcher d'annuler un
 *     tap fait par erreur (le remplacement vise déjà un événement de la ferme, references.ts, et du
 *     même type, déclencheur de la base).
 * La ligne de la zone reste verrouillée (FOR SHARE) jusqu'à la fin de la transaction du lot.
 */
import { equipementsDeZone, validerEquipementsAbri, type TypeAbri } from '@planif/core';
import type { LigneEvenement } from '@planif/db';
import { sql } from 'drizzle-orm';
import type { RefusReference, TransactionDb } from './references.ts';

export const PRECISION_ABRI_INTROUVABLE = 'serre ou tunnel introuvable';
export const PRECISION_EQUIPEMENT_NON_DECLARE = "cet équipement n'est pas déclaré pour cette serre";

/** null si le changement d'état est permis ; sinon le refus. Sans effet sur les autres types. */
export async function verifierEtatAbri(tx: TransactionDb, l: LigneEvenement): Promise<RefusReference | null> {
  if (l.type !== 'etat_abri') return null;
  const detail = l.detail as { readonly zoneId: string; readonly equipement: string };
  const r = await tx.execute<{ type_abri: TypeAbri; equipements_abri: unknown }>(
    sql`SELECT type_abri, equipements_abri FROM zone
        WHERE id = ${detail.zoneId.toLowerCase()}::uuid AND ferme_id = ${l.fermeId}::uuid
        FOR SHARE`,
  );
  const zone = r.rows[0];
  if (zone === undefined) return { motif: 'ecriture_invalide', precision: PRECISION_ABRI_INTROUVABLE };
  if (l.remplaceSorte !== null) return null;
  // La liste en base a passé le CHECK zone_equipements_abri ; relue quand même par la règle du cœur.
  const liste = zone.equipements_abri === null ? null : validerEquipementsAbri(zone.equipements_abri);
  const declares = equipementsDeZone({ typeAbri: zone.type_abri, equipementsAbri: liste === null ? null : liste.ok ? liste.valeur : [] });
  return (declares as readonly string[]).includes(detail.equipement) ? null : { motif: 'ecriture_invalide', precision: PRECISION_EQUIPEMENT_NON_DECLARE };
}
