/**
 * Lancement de l'export (T15, T15b) : lecture de la base locale par la porte, archive ZIP
 * compressée, téléchargement.
 * Aucun réseau : fonctionne hors ligne.
 */
import { exporterFerme, type ArchiveExport, type Avancement, type Compresseur, type PorteDonnees } from '@planif/sync/export';
import { compresseurEnWorker, ErreurWorkerCompression } from './compression.ts';
import { construireEnWorker } from './construction.ts';
import { rendreLaMain } from './rendre-la-main.ts';

export { rendreLaMain };

export interface OptionsLancerExport {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  readonly maintenant: () => Date;
  /**
   * Donne l'archive à l'utilisateur. Peut être asynchrone (T15d : Blob construit par tranches) ;
   * reçoit l'annulation, pour ne rien télécharger si l'export est annulé entre-temps.
   */
  readonly telecharger: (nomFichier: string, octets: Uint8Array, signal?: AbortSignal) => void | Promise<void>;
  /** Barre d'avancement (T15b) : transmis à `exporterFerme`. */
  readonly avancement?: (a: Avancement) => void;
  /** Annulation (bouton « Annuler ») : transmis à `exporterFerme`. */
  readonly signal?: AbortSignal;
  /**
   * Deflate brut ; défaut (T16b) : dans un worker (./compression.ts), hors du fil principal, ou
   * sans Worker celui d'`exporterFerme`.
   */
  readonly compresseur?: Compresseur;
  /**
   * T47 : toute la construction de l'archive (lignes, CSV, ferme.json, ZIP, compression) dans le
   * worker de l'export (./construction.ts) ; le fil principal ne fait que lire les pages de la
   * base et les lui passer. Sans worker, ou s'il tombe : construction au fil principal, comme
   * avant. Ignoré si `compresseur` est donné.
   */
  readonly constructionEnWorker?: boolean;
}

const deux = (n: number): string => String(n).padStart(2, '0');

/** 'AAAA-MM-JJ' à l'heure du téléphone (pas en UTC) : un export à 23 h 30 porte la date du jour. */
export function jourLocal(d: Date): string {
  return `${String(d.getFullYear()).padStart(4, '0')}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

/** Construit l'archive de la ferme et la donne à `telecharger`, une fois. */
export async function lancerExport(o: OptionsLancerExport): Promise<ArchiveExport> {
  const quand = o.maintenant();
  const genereLe = quand.toISOString();
  const jour = jourLocal(quand);
  // Barre d'avancement : jamais en recul, même si l'export recommence sans le worker.
  const vu = { fait: 0, total: 0 };
  const avancement =
    o.avancement === undefined
      ? undefined
      : (a: Avancement) => {
          if (a.total === vu.total && a.fait < vu.fait) return;
          vu.fait = a.fait;
          vu.total = a.total;
          o.avancement?.(a);
        };
  let archive: ArchiveExport | null = null;
  /** Le worker de construction est tombé en cours d'export : la nouvelle tentative se fait sans aucun worker. */
  let sansWorker = false;
  if (o.constructionEnWorker === true && o.compresseur === undefined) {
    try {
      // null : pas de worker (ou il ne s'est pas chargé), rien n'a été lu ; l'export se fait ci-dessous.
      archive = await construireEnWorker({
        porte: o.porte,
        fermeId: o.fermeId,
        genereLe,
        jour,
        ...(avancement === undefined ? {} : { avancement }),
        ...(o.signal === undefined ? {} : { signal: o.signal }),
      });
    } catch (erreur: unknown) {
      // Le worker a lâché en cours d'export (pas la base, pas une annulation) : une seule
      // nouvelle tentative, au fil principal. La base se relit sans risque (lecture seule).
      if (!(erreur instanceof ErreurWorkerCompression) || o.signal?.aborted === true) throw erreur;
      console.warn(`Export : ${erreur.message} ; nouvelle tentative, construction au fil principal.`);
      sansWorker = true;
    }
  }
  archive ??= await exporterAuFilPrincipal(o, genereLe, jour, avancement, sansWorker);
  // Annulé au tout dernier moment : pas de téléchargement tardif.
  o.signal?.throwIfAborted();
  await o.telecharger(archive.nomFichier, archive.octets, o.signal);
  return archive;
}

/**
 * Construction au fil principal ; compression dans le worker de compression s'il se charge (T16b,
 * T15c). `sansWorker` : nouvelle tentative après la chute du worker de construction (T47) ; une
 * seule, entièrement au fil principal (compression par défaut).
 */
async function exporterAuFilPrincipal(
  o: OptionsLancerExport,
  genereLe: string,
  jour: string,
  avancement: ((a: Avancement) => void) | undefined,
  sansWorker: boolean,
): Promise<ArchiveExport> {
  const enWorker = o.compresseur === undefined && !sansWorker ? compresseurEnWorker() : null;
  const exporter = (compresseur: Compresseur | undefined) =>
    exporterFerme(o.porte, {
      fermeId: o.fermeId,
      genereLe,
      jour,
      ...(compresseur === undefined ? {} : { compresseur }),
      ...(avancement === undefined ? {} : { avancement }),
      ...(o.signal === undefined ? {} : { signal: o.signal }),
    });
  try {
    return await exporter(o.compresseur ?? enWorker?.compresseur);
  } catch (erreur: unknown) {
    // Le worker de compression a lâché (pas la base, pas une annulation) : une seule nouvelle
    // tentative, compression au fil principal. La base se relit sans risque (lecture seule).
    if (!(erreur instanceof ErreurWorkerCompression) || o.signal?.aborted === true) throw erreur;
    enWorker?.fermer();
    console.warn(`Export : ${erreur.message} ; nouvelle tentative sans le worker.`);
    return await exporter(undefined);
  } finally {
    enWorker?.fermer();
  }
}

/** Taille d'une tranche du Blob : sa copie reste bien sous 50 ms, CPU ×4, sur un téléphone moyen. */
const TRANCHE_BLOB = 256 * 1024;

/**
 * Téléchargement dans le navigateur : Blob ZIP et lien `download`, sans réseau.
 *
 * Blob construit par tranches (T15d) : `new Blob([octets])` recopie toute l'archive d'un coup
 * (plusieurs Mo pour la ferme de T07) ; avec la copie finale de l'archive, c'était la tâche la plus
 * longue de l'export (≈ 37 à 51 ms, CPU ×4). Chaque tranche est recopiée dans sa propre tâche ; le
 * Blob final ne fait que les référencer.
 */
export async function telechargerDansLeNavigateur(nomFichier: string, octets: Uint8Array, signal?: AbortSignal): Promise<void> {
  // creerZip écrit dans un ArrayBuffer ordinaire (jamais partagé) : la conversion de type est sûre.
  const tout = octets as Uint8Array<ArrayBuffer>;
  const tranches: Blob[] = [];
  for (let i = 0; i < tout.length; i += TRANCHE_BLOB) {
    if (i > 0) await rendreLaMain();
    signal?.throwIfAborted();
    tranches.push(new Blob([tout.subarray(i, i + TRANCHE_BLOB)]));
  }
  signal?.throwIfAborted();
  const url = URL.createObjectURL(new Blob(tranches, { type: 'application/zip' }));
  const lien = document.createElement('a');
  lien.href = url;
  lien.download = nomFichier;
  lien.style.display = 'none';
  document.body.append(lien);
  lien.click();
  lien.remove();
  // Laisse au navigateur le temps de lire le Blob avant de le libérer.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60_000);
}
