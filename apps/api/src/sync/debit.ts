/**
 * Débit de la synchro (T10f), compté en base depuis T38a : au plus `ctx.envoisMaxParMinute`
 * envois POST /sync/upload par utilisateur et par minute glissante, quel que soit le processus
 * d'API ou la fonction Vercel qui reçoit la requête (aucun état en mémoire).
 *
 * Une ligne par utilisateur dans `securite.debit_synchro` (packages/db/src/securite.ts) : les
 * instants des envois acceptés encore dans la fenêtre. L'envoi est accepté et enregistré par UNE
 * écriture atomique (`INSERT … ON CONFLICT … DO UPDATE … WHERE … RETURNING`) : la ligne est
 * verrouillée le temps de l'écriture, deux envois simultanés du même utilisateur ne passent pas
 * ensemble au-delà de la limite. Refusé : rien n'est écrit (un client refusé ne prolonge pas son
 * propre blocage), une seconde lecture donne le délai d'attente.
 *
 * Nettoyage au passage, sans tâche planifiée : quand un utilisateur ouvre une nouvelle ligne,
 * les lignes des autres dont la fenêtre est passée sont effacées, en sautant celles qu'un envoi
 * tient verrouillées (SKIP LOCKED : jamais d'attente ni d'interblocage).
 */
import { debitSynchro } from '@planif/db/securite';
import { eq, sql } from 'drizzle-orm';
import type { Contexte } from '../dependances.ts';
import { libreSelonFenetre, secondesAvant } from '../limites.ts';

/** Fenêtre glissante du débit de la synchro. */
export const FENETRE_DEBIT_MS = 60_000;

/** Instants (ms) gardés en base pour `utilisateurId`, triés ; [] si aucune ligne. */
async function instantsEnBase(ctx: Contexte, utilisateurId: string): Promise<number[]> {
  const [ligne] = await ctx.db
    .select({ instants: debitSynchro.instants })
    .from(debitSynchro)
    .where(eq(debitSynchro.utilisateurId, utilisateurId));
  return (ligne?.instants ?? []).map((t) => t.getTime()).sort((a, b) => a - b);
}

/**
 * Enregistre l'envoi de `utilisateurId` à `ctx.maintenant()` si la limite le permet et rend null ;
 * sinon rend le délai (secondes, Retry-After, au moins 1) sans rien enregistrer.
 */
export async function enregistrerEnvoiSynchro(ctx: Contexte, utilisateurId: string): Promise<number | null> {
  const max = ctx.envoisMaxParMinute;
  const t = ctx.maintenant().getTime();
  const maintenant = new Date(t).toISOString();
  const debut = new Date(t - FENETRE_DEBIT_MS).toISOString();
  // Instants de la fenêtre, triés : seuls ceux-là sont gardés et comptés.
  const recents = sql`ARRAY(SELECT i FROM unnest(d.instants) AS i WHERE i > ${debut}::timestamptz ORDER BY i)`;
  const r = await ctx.db.execute<{ nouvelle: boolean }>(sql`
    INSERT INTO securite.debit_synchro AS d (utilisateur_id, instants, maj_le)
    VALUES (${utilisateurId}::uuid, ARRAY[${maintenant}::timestamptz], ${maintenant}::timestamptz)
    ON CONFLICT (utilisateur_id) DO UPDATE
      SET instants = ${recents} || ${maintenant}::timestamptz, maj_le = ${maintenant}::timestamptz
      WHERE cardinality(${recents}) < ${max}
    RETURNING (xmax = 0) AS nouvelle`);
  const ligne = r.rows[0];
  if (ligne !== undefined) {
    // Ligne créée (premier envoi de la fenêtre) : on efface celles des autres dont la fenêtre est passée.
    if (ligne.nouvelle) {
      await ctx.db.execute(sql`
        DELETE FROM securite.debit_synchro WHERE utilisateur_id IN (
          SELECT utilisateur_id FROM securite.debit_synchro
          WHERE maj_le <= ${debut}::timestamptz AND utilisateur_id <> ${utilisateurId}::uuid
          FOR UPDATE SKIP LOCKED)`);
    }
    return null;
  }
  const libreA = libreSelonFenetre(
    (await instantsEnBase(ctx, utilisateurId)).filter((i) => i > t - FENETRE_DEBIT_MS),
    max,
    FENETRE_DEBIT_MS,
    t,
  );
  return secondesAvant(libreA, t);
}
