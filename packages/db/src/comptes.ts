/**
 * Règles de découpage par ferme (T09) : quelles fermes un utilisateur voit, avec quel rôle.
 *
 * C'est la règle que l'API applique à chaque requête (les droits sont relus en base, jamais
 * portés par le jeton) et que reprendront les règles de synchro PowerSync (T10).
 * Membre actif : membre accepté (`membre.etat = 'accepte'`, pas seulement invité), et
 * `supprime_le` nul sur le membre, la ferme et l'utilisateur.
 */
import type { Id } from '@planif/core';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ferme, membre, utilisateur } from './schema.ts';
import { ETATS_MEMBRE, ROLES_MEMBRE, type EtatMembre, type RoleMembre } from './valeurs.ts';

export { ETATS_MEMBRE, ROLES_MEMBRE, type EtatMembre, type RoleMembre };

/** Ce que rend `drizzle(client)` de drizzle-orm/node-postgres (client ou pool, avec ou sans schéma). */
type BaseDrizzle = NodePgDatabase;

/** Condition « membre actif », sur `membre` joint à `ferme` et `utilisateur`. */
function membreActif(utilisateurId: Id<'Utilisateur'>) {
  return and(
    eq(membre.utilisateurId, utilisateurId),
    eq(membre.etat, 'accepte'),
    isNull(membre.supprimeLe),
    isNull(ferme.supprimeLe),
    isNull(utilisateur.supprimeLe),
  );
}

/** Fermes dont l'utilisateur est membre actif, triées par id. */
export async function fermesDeLUtilisateur(db: BaseDrizzle, utilisateurId: Id<'Utilisateur'>): Promise<Id<'Ferme'>[]> {
  const lignes = await db
    .select({ id: ferme.id })
    .from(membre)
    .innerJoin(ferme, eq(ferme.id, membre.fermeId))
    .innerJoin(utilisateur, eq(utilisateur.id, membre.utilisateurId))
    .where(membreActif(utilisateurId))
    .orderBy(asc(ferme.id));
  return lignes.map((l) => l.id);
}

/** Rôle du membre actif dans la ferme, ou null s'il n'en est pas (ou plus) membre. */
export async function roleDansLaFerme(
  db: BaseDrizzle,
  utilisateurId: Id<'Utilisateur'>,
  fermeId: Id<'Ferme'>,
): Promise<RoleMembre | null> {
  const [ligne] = await db
    .select({ role: membre.role })
    .from(membre)
    .innerJoin(ferme, eq(ferme.id, membre.fermeId))
    .innerJoin(utilisateur, eq(utilisateur.id, membre.utilisateurId))
    .where(and(membreActif(utilisateurId), eq(membre.fermeId, fermeId)))
    .limit(1);
  return ligne?.role ?? null;
}
