/**
 * Fermes retenues sur ce téléphone, par utilisateur, rangées à part de ./ferme-active.ts : sans
 * aucun import, elles se lisent aussi avant l'ouverture de la base, sans charger @planif/sync ni
 * PowerSync. Deux clés distinctes :
 *   - le CHOIX de l'utilisateur (T11, `planif.ferme-active.<id>`) : jamais réécrit par l'appli,
 *     il revient avec l'adhésion si elle a disparu un temps. Contrat : en-tête de
 *     ./ferme-active.test.ts ;
 *   - la dernière ferme MONTRÉE (T13g, `planif.ferme-montree.<id>`) : la ferme active telle que
 *     la base l'a désignée la dernière fois ('' : aucune). L'écran Aujourd'hui ne montre avant la
 *     base que l'instantané de cette ferme-là.
 * Stockage indisponible (navigation privée, quota) : rien n'est lu (null) ni retenu.
 */

/** Clé du choix de la ferme (T11) ; effacée à la déconnexion (connexion/deconnexion.ts, T13l). */
export const cleChoix = (utilisateurId: string): string => `planif.ferme-active.${utilisateurId}`;
/** Clé de la dernière ferme montrée (T13g) ; effacée à la déconnexion (T13l). */
export const cleMontree = (utilisateurId: string): string => `planif.ferme-montree.${utilisateurId}`;
/**
 * Clé de la ferme créée depuis ce téléphone et pas encore arrivée par la synchro (T39,
 * ecrans/creer-ferme/) ; effacée quand la base la désigne (./ferme-active.ts, T39b) et à la
 * déconnexion.
 */
export const cleFermeCreee = (utilisateurId: string): string => `planif.ferme-creee.${utilisateurId}`;
/**
 * T39b : id de la ferme en cours d'envoi (POST /fermes), rangé avant l'envoi et repris après un
 * rechargement : une réponse perdue ne crée jamais une seconde ferme. Effacée quand la ferme est
 * créée, quand la base la désigne, et à la déconnexion.
 */
export const cleFermeEnCours = (utilisateurId: string): string => `planif.ferme-en-cours.${utilisateurId}`;

/**
 * T39b : la ferme créée est arrivée par la synchro : plus rien à attendre ni à renvoyer. Stockage
 * sans removeItem (bancs d'essai) : rien n'est retiré.
 */
export function oublierFermeCreee(stockage: Partial<Pick<Storage, 'removeItem'>>, utilisateurId: string): void {
  for (const cle of [cleFermeCreee(utilisateurId), cleFermeEnCours(utilisateurId)]) {
    try {
      stockage.removeItem?.(cle);
    } catch {
      // Stockage refusé : rien de lisible à retirer.
    }
  }
}

function lire(stockage: Pick<Storage, 'getItem'>, cle: string): string | null {
  try {
    const valeur = stockage.getItem(cle);
    return valeur === null || valeur === '' ? null : valeur;
  } catch {
    return null;
  }
}

function ecrire(stockage: Pick<Storage, 'setItem'>, cle: string, valeur: string): void {
  try {
    stockage.setItem(cle, valeur);
  } catch {
    // Non retenu : la première ferme sera reprise (choix), ou rien ne sera montré avant la base.
  }
}

/** Ferme choisie par cet utilisateur sur ce téléphone ; null si aucune ou stockage indisponible. */
export function lireFermeMemorisee(stockage: Pick<Storage, 'getItem'>, utilisateurId: string): string | null {
  return lire(stockage, cleChoix(utilisateurId));
}

/** Retient le choix de l'utilisateur. */
export function memoriserFerme(stockage: Pick<Storage, 'setItem'>, utilisateurId: string, fermeId: string): void {
  ecrire(stockage, cleChoix(utilisateurId), fermeId);
}

/** T13g : dernière ferme active montrée à cet utilisateur ; null si aucune. */
export function lireFermeMontree(stockage: Pick<Storage, 'getItem'>, utilisateurId: string): string | null {
  return lire(stockage, cleMontree(utilisateurId));
}

/** T13g : retient la ferme active que la base vient de désigner ('' : aucune). */
export function noterFermeMontree(stockage: Pick<Storage, 'setItem'>, utilisateurId: string, fermeId: string): void {
  ecrire(stockage, cleMontree(utilisateurId), fermeId);
}
