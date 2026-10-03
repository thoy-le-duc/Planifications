/**
 * Dernière ferme choisie par un utilisateur sur ce téléphone (T11), rangée à part de
 * ./ferme-active.ts : sans aucun import, elle se lit aussi avant l'ouverture de la base, depuis
 * l'écran Aujourd'hui (T13g, instantané de la journée montré seulement s'il est de cette ferme),
 * sans charger @planif/sync ni PowerSync. Contrat : en-tête de ./ferme-active.test.ts.
 */

const cleMemoire = (utilisateurId: string) => `planif.ferme-active.${utilisateurId}`;

/** Ferme choisie par cet utilisateur sur ce téléphone ; null si aucune ou stockage indisponible. */
export function lireFermeMemorisee(stockage: Pick<Storage, 'getItem'>, utilisateurId: string): string | null {
  try {
    const valeur = stockage.getItem(cleMemoire(utilisateurId));
    return valeur === null || valeur === '' ? null : valeur;
  } catch {
    return null;
  }
}

/** Retient le choix ('' : aucune ferme) ; un stockage indisponible (navigation privée, quota) est ignoré. */
export function memoriserFerme(stockage: Pick<Storage, 'setItem'>, utilisateurId: string, fermeId: string): void {
  try {
    stockage.setItem(cleMemoire(utilisateurId), fermeId);
  } catch {
    // Le choix ne sera pas retenu : la première ferme sera reprise au prochain démarrage.
  }
}
