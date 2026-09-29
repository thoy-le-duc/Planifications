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
 * Demandes de suppression lancées par cette page et pas encore abouties, par nom de base. Une
 * demande bloquée (base ouverte dans un autre onglet) reste en file dans IndexedDB même si on
 * cesse de l'attendre : elle s'exécutera à la fermeture de l'autre onglet, et rien ne l'annule.
 * On n'en empile donc pas d'autre tant qu'elle n'a pas abouti. Rangées par fabrique IndexedDB
 * (une seule dans le navigateur).
 */
const demandesEnFile = new WeakMap<IDBFactory, Map<string, Promise<void>>>();

/** Demandes en file auprès de la fabrique IndexedDB courante. */
function fileDe(fabrique: IDBFactory): Map<string, Promise<void>> {
  let file = demandesEnFile.get(fabrique);
  if (file === undefined) {
    file = new Map();
    demandesEnFile.set(fabrique, file);
  }
  return file;
}

/** Lance `indexedDB.deleteDatabase(nom)` ; `bloquee` est appelé si une autre page la garde ouverte. */
function demanderSuppression(nom: string, bloquee: () => void): Promise<void> {
  return new Promise<void>((ok, echec) => {
    let requete: IDBOpenDBRequest;
    try {
      requete = indexedDB.deleteDatabase(nom);
    } catch (erreur) {
      echec(erreur instanceof Error ? erreur : new Error(String(erreur)));
      return;
    }
    requete.onsuccess = () => {
      ok();
    };
    requete.onerror = () => {
      echec(requete.error ?? new Error('base locale : effacement impossible'));
    };
    requete.onblocked = bloquee;
  });
}

/**
 * Supprime la base IndexedDB `nom`. Si une autre page la garde ouverte, la suppression attend sa
 * fermeture ; au-delà de `delaiMs`, la promesse rejette (l'écran doit le dire). Tant qu'une
 * demande précédente pour `nom` est en file, on l'attend au lieu d'en lancer une autre.
 */
export function supprimerBaseIndexedDb(nom: string, delaiMs = DELAI_BASE_OUVERTE_MS): Promise<void> {
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  let abandon: ((raison: Error) => void) | undefined;
  const delai = new Promise<never>((_, echec) => {
    abandon = echec;
  });
  const demarrerDelai = () => {
    minuterie ??= setTimeout(() => {
      abandon?.(new Error('Base locale ouverte dans une autre page : fermez-la, puis recommencez.'));
    }, delaiMs);
  };

  let file: Map<string, Promise<void>> | undefined;
  try {
    file = fileDe(indexedDB);
  } catch {
    // IndexedDB absent : demanderSuppression le dira.
  }
  let demande = file?.get(nom);
  if (demande === undefined) {
    const neuve = demanderSuppression(nom, demarrerDelai);
    demande = neuve;
    file?.set(nom, neuve);
    const liberer = () => {
      if (file?.get(nom) === neuve) file.delete(nom);
    };
    neuve.then(liberer, liberer);
  } else {
    // Déjà en file (sans doute bloquée) : le délai court dès maintenant.
    demarrerDelai();
  }
  return Promise.race([demande, delai]).finally(() => {
    clearTimeout(minuterie);
  });
}

/**
 * Vrai si une base locale de l'utilisateur existe (indexedDB.databases()), sans charger
 * PowerSync. Sans moyen de le savoir (indexedDB ou databases() absents, ou qui rejettent) : vrai,
 * pour demander confirmation plutôt que de risquer une perte silencieuse.
 */
export async function baseLocaleExiste(utilisateurId: string): Promise<boolean> {
  try {
    const idb: Partial<Pick<IDBFactory, 'databases'>> | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB;
    if (idb?.databases === undefined) return true;
    const bases = await idb.databases();
    const nom = nomBaseLocale(utilisateurId);
    return bases.some((b) => b.name === nom);
  } catch {
    return true;
  }
}

/** Efface toute la base locale de l'utilisateur (données synchronisées et écritures en attente). */
export function effacerDonneesLocales(utilisateurId: string): Promise<void> {
  return supprimerBaseIndexedDb(nomBaseLocale(utilisateurId));
}
