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

const cleChoix = (utilisateurId: string) => `planif.ferme-active.${utilisateurId}`;
const cleMontree = (utilisateurId: string) => `planif.ferme-montree.${utilisateurId}`;

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
