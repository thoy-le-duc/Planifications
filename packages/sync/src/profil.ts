/**
 * T32c : l'écriture du profil de croissance d'une espèce (`porte.reglerProfilCroissance`),
 * chargée à la demande (le réglage, dans l'écran Itinéraires, n'est pas au démarrage de l'appli).
 * Contrat : test/contrat-profil.ts.
 *
 * Elle rejoue avant d'écrire ce que le serveur refuserait (apps/api/src/sync/structure.ts) :
 * gérant actif de la ferme de la porte (Q35), règles du cœur (validerProfilCroissance), espèce de
 * la ferme de la porte (ni d'une autre ferme, ni de la bibliothèque commune). Le serveur reste
 * l'arbitre. Une transaction locale, un seul UPDATE : un envoi, tout ou rien.
 */
import { validerProfilCroissance } from '@planif/core';
import type { BaseLocale, TransactionLocale } from './types.ts';

export const SEUL_LE_GERANT_PROFIL = 'Seul le gérant peut régler le profil de croissance.';

/** Ce que la porte sait d'elle-même. */
export interface ContexteProfil {
  readonly fermeId: string;
  readonly utilisateurId: string;
  readonly maintenant: () => Date;
}

async function estGerant(tx: TransactionLocale, ctx: ContexteProfil): Promise<boolean> {
  try {
    const lignes = await tx.getAll<{ n: number }>(
      `SELECT 1 AS n FROM membre WHERE utilisateur_id = ? AND ferme_id = ? AND role = 'gerant' AND etat = 'accepte' AND supprime_le IS NULL`,
      [ctx.utilisateurId, ctx.fermeId],
    );
    return lignes.length > 0;
  } catch {
    // Table des membres absente : on ne sait pas qui est gérant, rien n'est écrit.
    return false;
  }
}

/** Écrit le profil (null : « Rétablir la valeur par défaut ») ; rejette sans rien écrire. */
export async function ecrireProfilCroissance(base: BaseLocale, ctx: ContexteProfil, especeId: string, profil: unknown): Promise<void> {
  const r = validerProfilCroissance(profil);
  if (!r.ok) throw new Error(r.erreur.message);
  const texte = r.valeur === null ? null : JSON.stringify(r.valeur);
  await base.writeTransaction(async (tx) => {
    if (!(await estGerant(tx, ctx))) throw new Error(SEUL_LE_GERANT_PROFIL);
    const especes = await tx.getAll<{ ferme_id: unknown }>('SELECT ferme_id FROM espece WHERE id = ? AND supprime_le IS NULL', [especeId]);
    const espece = especes[0];
    if (espece === undefined) throw new Error('Espèce introuvable : rien n’est modifié.');
    if (espece.ferme_id === null) throw new Error('Espèce de la bibliothèque : personnalisez-la pour régler sa croissance.');
    if (espece.ferme_id !== ctx.fermeId) throw new Error('Cette espèce n’est pas celle de votre ferme : rien n’est modifié.');
    await tx.execute('UPDATE espece SET profil_croissance = ?, modifie_le = ? WHERE id = ?', [texte, ctx.maintenant().toISOString(), especeId]);
  });
}
