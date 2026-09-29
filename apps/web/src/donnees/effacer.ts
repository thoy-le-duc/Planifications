/**
 * Effacement de la base locale d'un utilisateur (T09b, déconnexion sur un téléphone partagé),
 * SANS charger PowerSync : hors ligne, les fichiers de PowerSync (hors précache) sont
 * injoignables, et la déconnexion doit aboutir quand même.
 *
 * La base locale vit dans IndexedDB : PowerSync web (2.4) range SQLite par le VFS
 * IDBBatchAtomicVFS, son défaut, dans une base IndexedDB qui porte le nom du fichier
 * (`dbFilename` d'ouvrir.ts). Si un jour ouvrir.ts choisit un VFS OPFS, cet effacement devra
 * suivre. Aucun test ne le verrait : e2e/deconnexion.e2e.ts crée lui-même la base IndexedDB à
 * effacer, et e2e-synchro/deconnexion.e2e.ts efface par PowerSync (DonneesLocales.effacer).
 */

/** Nom du fichier SQLite (et de la base IndexedDB) de l'utilisateur : une base par compte. */
export function nomBaseLocale(utilisateurId: string): string {
  return `planif-${utilisateurId}.sqlite`;
}

/** Attente maximale quand la base est encore ouverte ailleurs (autre onglet). */
export const DELAI_BASE_OUVERTE_MS = 10_000;

/**
 * Supprime la base IndexedDB `nom`. Si une autre page la garde ouverte, la suppression attend sa
 * fermeture ; au-delà de `delaiMs`, la promesse rejette (l'écran doit le dire).
 */
export function supprimerBaseIndexedDb(nom: string, delaiMs = DELAI_BASE_OUVERTE_MS): Promise<void> {
  return new Promise<void>((ok, echec) => {
    let minuterie: ReturnType<typeof setTimeout> | undefined;
    let requete: IDBOpenDBRequest;
    try {
      requete = indexedDB.deleteDatabase(nom);
    } catch (erreur) {
      echec(erreur instanceof Error ? erreur : new Error(String(erreur)));
      return;
    }
    requete.onsuccess = () => {
      clearTimeout(minuterie);
      ok();
    };
    requete.onerror = () => {
      clearTimeout(minuterie);
      echec(requete.error ?? new Error('base locale : effacement impossible'));
    };
    requete.onblocked = () => {
      minuterie ??= setTimeout(() => {
        echec(new Error('Base locale ouverte dans une autre page : fermez-la, puis recommencez.'));
      }, delaiMs);
    };
  });
}

/** Efface toute la base locale de l'utilisateur (données synchronisées et écritures en attente). */
export function effacerDonneesLocales(utilisateurId: string): Promise<void> {
  return supprimerBaseIndexedDb(nomBaseLocale(utilisateurId));
}
