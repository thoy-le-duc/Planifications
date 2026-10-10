/**
 * Lancement de l'export (T15, T15b) : lecture de la base locale par la porte, archive ZIP
 * compressée, téléchargement.
 * Aucun réseau : fonctionne hors ligne.
 */
import { exporterFerme, type ArchiveExport, type Avancement, type Compresseur, type PorteDonnees } from '@planif/sync/export';
import { compresseurEnWorker, ErreurWorkerCompression } from './compression.ts';

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
}

const deux = (n: number): string => String(n).padStart(2, '0');

/** 'AAAA-MM-JJ' à l'heure du téléphone (pas en UTC) : un export à 23 h 30 porte la date du jour. */
export function jourLocal(d: Date): string {
  return `${String(d.getFullYear()).padStart(4, '0')}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

/** Construit l'archive de la ferme et la donne à `telecharger`, une fois. */
export async function lancerExport(o: OptionsLancerExport): Promise<ArchiveExport> {
  const quand = o.maintenant();
  const enWorker = o.compresseur === undefined ? compresseurEnWorker() : null;
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
  const exporter = (compresseur: Compresseur | undefined) =>
    exporterFerme(o.porte, {
      fermeId: o.fermeId,
      genereLe: quand.toISOString(),
      jour: jourLocal(quand),
      ...(compresseur === undefined ? {} : { compresseur }),
      ...(avancement === undefined ? {} : { avancement }),
      ...(o.signal === undefined ? {} : { signal: o.signal }),
    });
  let archive: ArchiveExport;
  try {
    archive = await exporter(o.compresseur ?? enWorker?.compresseur);
  } catch (erreur: unknown) {
    // Le worker de compression a lâché (pas la base, pas une annulation) : une seule nouvelle
    // tentative, compression au fil principal. La base se relit sans risque (lecture seule).
    if (!(erreur instanceof ErreurWorkerCompression) || o.signal?.aborted === true) throw erreur;
    enWorker?.fermer();
    console.warn(`Export : ${erreur.message} ; nouvelle tentative sans le worker.`);
    archive = await exporter(undefined);
  } finally {
    enWorker?.fermer();
  }
  // Annulé au tout dernier moment : pas de téléchargement tardif.
  o.signal?.throwIfAborted();
  await o.telecharger(archive.nomFichier, archive.octets, o.signal);
  return archive;
}

/** Taille d'une tranche du Blob : sa copie reste bien sous 50 ms, CPU ×4, sur un téléphone moyen. */
const TRANCHE_BLOB = 256 * 1024;

/** Rend la main à la boucle d'événements (une vraie tâche : le rendu et les saisies passent). */
const rendreLaMain = () =>
  new Promise<void>((ok) => {
    setTimeout(ok, 0);
  });

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
