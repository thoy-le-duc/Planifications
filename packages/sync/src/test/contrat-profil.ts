/**
 * Contrat de T32c, porte du téléphone (docs/backlog/T32c-reglage-profils.md ; Q35) : l'écriture
 * du profil de croissance d'une espèce, par la porte, sans réseau. Proposé par le testeur ; la
 * réglage de l'écran Itinéraires culturaux (apps/web/src/ecrans/itineraires, Q39) s'en sert.
 *
 *   porte.reglerProfilCroissance(especeId: string, profil: unknown): Promise<void>
 *
 * Méthode de `PorteDonnees` (packages/sync/src/types.ts). Les tests la cherchent sur la porte
 * rendue par `creerPorte` et échouent clairement tant qu'elle manque.
 *
 * - `profil` : un objet profil (ProfilCroissance de @planif/core, champ `fougereApresRecolte`
 *   compris), ou null = « Rétablir la valeur par défaut ».
 * - UNE transaction locale par appel (un envoi au serveur, tout ou rien) ; dedans, exactement un
 *   `UPDATE espece SET profil_croissance = ?, modifie_le = ? WHERE id = ?` (autres colonnes
 *   intouchées ; jamais d'INSERT, de DELETE ni de REPLACE ; jamais d'écriture dans
 *   `modification`, que le serveur écrit). `profil_croissance` = le texte JSON de la valeur rendue
 *   par `validerProfilCroissance` (forme normalisée du cœur : `cycleAnnuel` null s'il manquait),
 *   ou NULL. `modifie_le` = maintenant de la porte, ISO UTC.
 * - Rejet (promesse rejetée, RIEN d'écrit) dans les cas que le serveur refuserait :
 *     · l'utilisateur de la porte n'est pas gérant actif de la ferme de la porte (ligne locale
 *       `membre` : role 'gerant', etat 'accepte', non supprimée) → message EXACTEMENT
 *       SEUL_LE_GERANT_PROFIL ;
 *     · profil refusé par `validerProfilCroissance` → le message du cœur (en français) ;
 *     · espèce introuvable, d'une autre ferme que celle de la porte, ou de la bibliothèque
 *       commune (ferme_id nul) → rejet (message libre, en français).
 */
import type { PorteDonnees } from './contrat.ts';

export const SEUL_LE_GERANT_PROFIL = 'Seul le gérant peut régler le profil de croissance.';

export type PorteProfil = PorteDonnees & { reglerProfilCroissance?: (especeId: string, profil: unknown) => Promise<void> };

/** La méthode de T32c, ou une erreur claire tant qu'elle n'existe pas. */
export function exigerReglerProfil(porte: PorteDonnees): (especeId: string, profil: unknown) => Promise<void> {
  const p = porte as PorteProfil;
  const f = p.reglerProfilCroissance;
  if (typeof f !== 'function') throw new Error('la porte n’a pas encore reglerProfilCroissance (T32c)');
  return (especeId, profil) => f.call(p, especeId, profil);
}
