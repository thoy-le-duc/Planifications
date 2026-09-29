/**
 * Lecture d'un événement reçu du téléphone (PUT de POST /sync/upload) : ligne SQLite de
 * PowerSync (texte, nombre ou null ; jsonb et tableaux en texte JSON) → ligne Postgres typée.
 *
 * Les règles d'une saisie sont celles du cœur (`validerSaisie`, @planif/core), les mêmes que sur
 * le téléphone : ce fichier ne fait que l'adaptation. Les CHECK de la base restent le dernier
 * rempart (voir upload.ts). La ferme et l'auteur sont comparés au jeton, et l'appartenance des
 * références à la ferme vérifiée, par l'appelant.
 */
import { validerSaisie } from '@planif/core';
import { ligneDepuisEvenement, type LigneEvenement } from '@planif/db';

export type Lecture<T> = { readonly ok: true; readonly valeur: T } | { readonly ok: false; readonly raison: string };

/**
 * Données d'un PUT sur `evenement` → ligne à insérer (hors horodatages remplis par le serveur),
 * ou la raison du refus (message du cœur, en français).
 */
export function lireEvenement(id: string, donnees: Readonly<Record<string, unknown>>): Lecture<LigneEvenement> {
  // L'identifiant est celui de l'écriture PowerSync ; un `id` glissé dans les données est refusé.
  if (Object.hasOwn(donnees, 'id')) return { ok: false, raison: 'colonne inconnue : id' };
  const r = validerSaisie({ ...donnees, id });
  return r.ok ? { ok: true, valeur: ligneDepuisEvenement(r.saisie) } : { ok: false, raison: r.erreur.message };
}
