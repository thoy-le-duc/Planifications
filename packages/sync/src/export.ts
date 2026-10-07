/**
 * Export complet de la ferme depuis la base locale du téléphone (T15, principe 5, puis T15b) :
 * hors ligne, lecture seule par la porte, aucun réseau. Le format de l'archive est dans
 * @planif/core ; l'archive est construite morceau par morceau et compressée (deflate), table par
 * table pendant la lecture (T15c).
 */
import { annulable, creerConstructeurArchive, nomArchive, TABLES_EXPORTEES, type Avancement, type Compresseur, type LigneLocale } from '@planif/core';
import type { PorteDonnees } from './types.ts';

export type { Avancement, Compresseur };

export interface OptionsExportFerme {
  readonly fermeId: string;
  /** Instant ISO de l'export (ferme.json `genere_le`). */
  readonly genereLe: string;
  /** Jour de l'export, 'AAAA-MM-JJ' : nom du fichier et date des entrées du ZIP. */
  readonly jour: string;
  /** Deflate brut injecté ; défaut : `CompressionStream('deflate-raw')` s'il existe, sinon archive stockée. */
  readonly compresseur?: Compresseur;
  /** Barre d'avancement (appels de `construireArchive`). */
  readonly avancement?: (a: Avancement) => void;
  /** Annulation (bouton « Annuler ») : promesse rejetée (AbortError) dès l'annulation. */
  readonly signal?: AbortSignal;
}

export interface ArchiveExport {
  readonly nomFichier: string;
  /** L'archive ZIP complète. */
  readonly octets: Uint8Array;
  /** Nombre de lignes de chaque CSV, par chemin sans « .csv » ('zone', 'bibliotheque/famille'). */
  readonly lignes: Readonly<Record<string, number>>;
}

// ── Compression par défaut : CompressionStream du fil courant ────────────────────────────────

/** Le strict nécessaire des flux web, décrit ici : le code de @planif/sync ne dépend pas des types du DOM. */
interface Ecrivain {
  write(morceau: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(raison?: unknown): Promise<void>;
}
interface Lecteur {
  read(): Promise<{ readonly done: boolean; readonly value?: Uint8Array | undefined }>;
  cancel(raison?: unknown): Promise<void>;
}
interface FluxCompression {
  readonly writable: { getWriter(): Ecrivain };
  readonly readable: { getReader(): Lecteur };
}
type ConstructeurCompression = new (format: 'deflate-raw') => FluxCompression;

/** Compresseur deflate brut sur `CompressionStream` (navigateur, Node 22), ou undefined s'il n'existe pas. */
export function compresseurParDefaut(): Compresseur | undefined {
  const Flux = (globalThis as unknown as { readonly CompressionStream?: ConstructeurCompression }).CompressionStream;
  if (Flux === undefined) return undefined;
  return async function* (brut) {
    const flux = new Flux('deflate-raw');
    const ecrivain = flux.writable.getWriter();
    const lecteur = flux.readable.getReader();
    let echec: { readonly erreur: unknown } | undefined;
    // Écriture et lecture en parallèle : le flux n'avance que si on le lit.
    const ecriture = (async () => {
      try {
        for await (const morceau of brut) await ecrivain.write(morceau);
        await ecrivain.close();
      } catch (erreur: unknown) {
        echec = { erreur };
        await ecrivain.abort(erreur).catch(() => undefined);
      }
    })();
    let fini = false;
    try {
      for (;;) {
        const { done, value } = await lecteur.read();
        if (done) break;
        if (value !== undefined) yield value;
      }
      fini = true;
    } catch (erreur: unknown) {
      // Flux interrompu par l'écriture : l'erreur d'origine (celle de la source) prime.
      await ecriture;
      throw echec === undefined ? erreur : echec.erreur;
    } finally {
      if (!fini) await lecteur.cancel().catch(() => undefined);
    }
    await ecriture;
    if (echec !== undefined) throw echec.erreur;
  };
}

// ── Lecture de la base ───────────────────────────────────────────────────────────────────────

/**
 * Lecture par pages (T16b). Dans le navigateur, PowerSync lit dans un worker et renvoie chaque
 * résultat en un seul message, désérialisé d'un bloc sur le fil principal : les 30 000
 * événements de la ferme de T07 lus d'un coup (et les 20 autres tables en même temps), c'était
 * une tâche de 190 à 260 ms, CPU ×4 : l'écran gelait. Par pages de `PAGE` lignes, table après
 * table, chaque message reste petit (mesuré : aucune tâche de plus de 50 ms), et le fil
 * principal reprend la main entre deux pages, le temps que le worker lise la suivante.
 * Mesuré aussi : lire par pages ne coûte pas plus cher que d'un bloc ; la lecture elle-même
 * (IndexedDB, dans le worker) domine.
 */
const PAGE = 2_000;

interface LectureTable {
  /** Première page (ou la seule : table ferme). */
  readonly premiere: string;
  /** Pages suivantes : un paramètre de plus, le dernier id lu ; null si une seule lecture. */
  readonly suivante: string | null;
  readonly parametres: readonly string[];
}

/**
 * Lecture d'une table : seulement les colonnes de la liste blanche, et seulement les lignes
 * qui peuvent être de la ferme (ou de la bibliothèque de référence). `construireArchive` refiltre.
 * Pagination par clé (`id > dernier id lu`, `ORDER BY id`) : mêmes lignes, dans le même ordre,
 * qu'une lecture d'un seul tenant, sans le coût croissant d'un OFFSET.
 *
 * Filtre de ferme écrit `coalesce(ferme_id, ?) = ?` (même sens que `ferme_id = ? OR ferme_id
 * IS NULL`) : il ne peut pas prendre l'index (ferme_id, date) des événements, et SQLite suit la
 * clé, page après page. Avec l'index, chaque page triait de nouveau tous les événements de la
 * ferme (mesuré : 2,4 s la première page, 150 à 500 ms les suivantes).
 *
 * Limite assumée (relecture T16b) : la lecture se fait en plusieurs requêtes, sans transaction
 * (≈ 6 s sur la ferme de T07, CPU ×4). Une synchro qui écrit entre deux pages peut donner une
 * archive où des références manquent (une ligne qui pointe vers une ligne arrivée après la
 * lecture de sa table). Une transaction de lecture bloquerait les saisies pendant tout ce temps,
 * ce qui est pire au champ. C'était déjà vrai avec les lectures parallèles d'avant T16b.
 */
function lectureTable(table: string, colonnes: readonly string[], fermeId: string): LectureTable {
  const select = `SELECT ${colonnes.map((c) => `"${c}"`).join(', ')} FROM "${table}"`;
  if (table === 'ferme') return { premiere: `${select} WHERE id = ?`, suivante: null, parametres: [fermeId] };
  const filtre =
    table === 'utilisateur'
      ? { condition: 'id IN (SELECT utilisateur_id FROM "membre" WHERE ferme_id = ?)', parametres: [fermeId] }
      : colonnes.includes('ferme_id')
        ? { condition: 'coalesce(ferme_id, ?) = ?', parametres: [fermeId, fermeId] }
        : { condition: null, parametres: [] };
  const ou = (conditions: readonly (string | null)[]) => {
    const c = conditions.filter((x): x is string => x !== null);
    return c.length === 0 ? '' : ` WHERE ${c.join(' AND ')}`;
  };
  return {
    premiere: `${select}${ou([filtre.condition])} ORDER BY id LIMIT ${String(PAGE)}`,
    suivante: `${select}${ou([filtre.condition, 'id > ?'])} ORDER BY id LIMIT ${String(PAGE)}`,
    parametres: filtre.parametres,
  };
}

/** Toutes les lignes d'une table, page par page ; s'arrête (AbortError) entre deux pages si l'export est annulé. */
async function lireTable(porte: PorteDonnees, table: string, fermeId: string, signal: AbortSignal | undefined): Promise<LigneLocale[]> {
  const { premiere, suivante, parametres } = lectureTable(table, Object.keys(TABLES_EXPORTEES[table]?.colonnes ?? {}), fermeId);
  const lignes: LigneLocale[] = [];
  let sql = premiere;
  let valeurs: readonly unknown[] = parametres;
  for (;;) {
    signal?.throwIfAborted();
    const page = await porte.lire<LigneLocale>(sql, valeurs);
    for (const l of page) lignes.push(l);
    const dernier = page.at(-1)?.id;
    if (suivante === null || page.length < PAGE || typeof dernier !== 'string') return lignes;
    sql = suivante;
    valeurs = [...parametres, dernier];
  }
}

/**
 * Construit l'archive ZIP de la ferme, depuis la base locale seulement.
 *
 * Lecture et construction en parallèle (T15c) : chaque table lue est donnée aussitôt au
 * constructeur de @planif/core (son CSV et sa part de ferme.json s'écrivent et partent au
 * compresseur), pendant que la lecture continue avec la table suivante. La lecture se fait dans
 * le worker de la base ; le fil principal écrit l'archive pendant qu'il attend les pages. Le
 * constructeur traite les tables l'une après l'autre, dans l'ordre de lecture.
 */
export async function exporterFerme(porte: PorteDonnees, options: OptionsExportFerme): Promise<ArchiveExport> {
  const { fermeId, genereLe, jour, avancement, signal } = options;
  const compresseur = options.compresseur ?? compresseurParDefaut();
  // Annulé : rejet immédiat, sans attendre la base ni le compresseur ; plus aucune page lue ensuite.
  return annulable(signal, async () => {
    // Arrêt du constructeur : annulation de l'export, ou lecture en échec (plus rien à écrire).
    const arretConstruction = new AbortController();
    const relayer = () => {
      arretConstruction.abort(signal?.reason);
    };
    signal?.addEventListener('abort', relayer, { once: true });
    try {
      const constructeur = creerConstructeurArchive({
        fermeId,
        genereLe,
        date: jour,
        ...(compresseur === undefined ? {} : { compresseur }),
        ...(avancement === undefined ? {} : { avancement }),
        signal: arretConstruction.signal,
      });
      // Dans un objet : posé depuis une fermeture, TypeScript ne le suit pas sur une variable.
      const etat: { echec: { readonly erreur: unknown } | undefined; nom: string | null } = { echec: undefined, nom: null };
      let derniere: Promise<void> = Promise.resolve();
      for (const table of Object.keys(TABLES_EXPORTEES)) {
        // La construction a échoué : inutile de lire la suite.
        if (etat.echec !== undefined) throw etat.echec.erreur;
        const lignes = await lireTable(porte, table, fermeId, signal);
        if (table === 'ferme') {
          const ferme = lignes.find((l) => l.id === fermeId);
          etat.nom = typeof ferme?.nom === 'string' ? ferme.nom : null;
        }
        derniere = constructeur.ajouterTable(table, lignes);
        derniere.catch((erreur: unknown) => {
          etat.echec ??= { erreur };
        });
      }
      await derniere;
      const { octets, lignes } = await constructeur.terminer();
      return { nomFichier: nomArchive(etat.nom, jour), octets, lignes };
    } catch (erreur: unknown) {
      arretConstruction.abort(erreur);
      throw erreur;
    } finally {
      signal?.removeEventListener('abort', relayer);
    }
  });
}
