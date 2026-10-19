/**
 * Construction de l'archive dans le worker de l'export (T47).
 *
 * Mesuré (docs/mesures/T47.md, 20 passages, CPU ×4, ferme de T07) : avec la construction au fil
 * principal, ses tranches de 8 ms rendent bien la main, mais le tas de la page monte à 60 à 85 Mo
 * (lignes lues d'avance, CSV, morceaux compressés gardés jusqu'à la fin) ; les ramasse-miettes
 * qui tombent dans une tranche la portent à 52 à 145 ms. Ici, tout ce qui fait ce tas vit dans le
 * worker (./compression.worker.ts, le même script que la compression seule) : `exporterFerme` y
 * tourne avec une porte distante. Le fil principal ne fait plus que lire chaque page demandée par
 * le worker et la lui passer (clonage), sans la garder : rien n'y survit d'une page à l'autre.
 *
 * Protocole (en plus de « bonjour » → « pret », ./compression.ts) :
 *   page → worker : { type: 'exporter', fermeId, genereLe, jour }
 *                   | { type: 'page', n, lignes } | { type: 'page-echec', n } | { type: 'annuler' }
 *   worker → page : { type: 'lire', n, sql, parametres } (une lecture à la fois)
 *                   | { type: 'avancement', fait, total }
 *                   | { type: 'archive', nomFichier, octets (tampon transféré), lignes }
 *                   | { type: 'echec', message }
 *
 * Repli : sans Worker, constructeur qui lève, script qui ne répond pas à « bonjour » (erreur, ou
 * DELAI_PRET_MS) : `construireEnWorker` rend null avant toute lecture, et l'appelant construit
 * au fil principal. Worker qui tombe (ou se tait SILENCE_MAX_MS sans lecture en cours) après
 * s'être chargé : rejet ErreurWorkerCompression, l'appelant recommence une fois sans lui.
 * Erreur de lecture de la base : rejet avec cette erreur (pas de nouvelle tentative).
 */
import type { ArchiveExport, Avancement, PorteDonnees } from '@planif/sync/export';
import { ErreurWorkerCompression, SILENCE_MAX_MS, type MessageCompression, type ReponseCompression } from './compression.ts';
import { rendreLaMain } from './rendre-la-main.ts';

export type MessageConstruction =
  | { readonly type: 'exporter'; readonly fermeId: string; readonly genereLe: string; readonly jour: string }
  | { readonly type: 'page'; readonly n: number; readonly lignes: readonly unknown[] }
  | { readonly type: 'page-echec'; readonly n: number }
  | { readonly type: 'annuler' };

export type ReponseConstruction =
  | { readonly type: 'lire'; readonly n: number; readonly sql: string; readonly parametres: readonly unknown[] }
  | { readonly type: 'avancement'; readonly fait: number; readonly total: number }
  | { readonly type: 'archive'; readonly nomFichier: string; readonly octets: Uint8Array<ArrayBuffer>; readonly lignes: Readonly<Record<string, number>> }
  | { readonly type: 'echec'; readonly message: string };

/** Sans réponse à « bonjour » passé ce délai, l'export se construit au fil principal (même délai que la compression seule). */
const DELAI_PRET_MS = 5_000;
/** Fréquence de la vérification du chien de garde. */
const RONDE_MS = 1_000;

export interface OptionsConstructionEnWorker {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  readonly genereLe: string;
  readonly jour: string;
  readonly avancement?: (a: Avancement) => void;
  readonly signal?: AbortSignal;
}

function raison(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Export annulé', 'AbortError');
}

/**
 * L'archive construite dans le worker de l'export ; null si le worker n'est pas disponible (rien
 * n'a été lu : l'appelant construit au fil principal).
 */
export async function construireEnWorker(o: OptionsConstructionEnWorker): Promise<ArchiveExport | null> {
  const { porte, signal } = o;
  signal?.throwIfAborted();
  if (typeof Worker === 'undefined' || typeof CompressionStream === 'undefined') return null;
  let worker: Worker;
  try {
    worker = new Worker(new URL('./compression.worker.ts', import.meta.url), { type: 'module', name: 'construction-export' });
  } catch {
    // URL refusée, CSP… : construction au fil principal.
    return null;
  }
  const poster = (m: MessageConstruction | MessageCompression) => {
    worker.postMessage(m);
  };

  // Issue du worker : l'archive, null (worker indisponible), ou l'erreur à rendre (levée plus bas).
  type Issue = { readonly archive: ArchiveExport | null } | { readonly erreur: unknown };
  const issue = await new Promise<Issue>((rendre) => {
    const resoudre = (archive: ArchiveExport | null) => {
      rendre({ archive });
    };
    const rejeter = (erreur: unknown) => {
      rendre({ erreur });
    };
    let etat: 'chargement' | 'en_cours' | 'fini' = 'chargement';
    let dernierSigne = Date.now();
    let lectureEnCours = false;
    /** Première erreur de lecture de la base : c'est elle que l'export rend, pas le message du worker. */
    let echecLecture: { readonly erreur: unknown } | undefined;
    let ronde: ReturnType<typeof setInterval> | undefined;

    const finir = () => {
      etat = 'fini';
      clearTimeout(delai);
      clearInterval(ronde);
      signal?.removeEventListener('abort', annuler);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    };
    const tomber = (cause: string) => {
      if (etat === 'fini') return;
      const enChargement = etat === 'chargement';
      finir();
      if (enChargement) {
        console.warn(`Export : worker de l’export indisponible (${cause}), construction au fil principal.`);
        resoudre(null);
        return;
      }
      rejeter(new ErreurWorkerCompression(`worker de l’export en échec : ${cause}`));
    };
    const annuler = () => {
      if (etat === 'fini') return;
      if (etat === 'en_cours') poster({ type: 'annuler' });
      finir();
      if (signal !== undefined) rejeter(raison(signal));
    };
    signal?.addEventListener('abort', annuler, { once: true });

    const delai = setTimeout(() => {
      tomber(`aucune réponse en ${String(DELAI_PRET_MS / 1000)} s`);
    }, DELAI_PRET_MS);

    const lire = (n: number, sql: string, parametres: readonly unknown[]) => {
      lectureEnCours = true;
      porte.lire<unknown>(sql, parametres).then(
        async (lignes) => {
          // Le clonage de la page vers le worker dans sa propre tâche, pas dans celle qui a reçu
          // la page de la base (désérialisée d'un bloc) : deux petites tâches plutôt qu'une.
          await rendreLaMain();
          lectureEnCours = false;
          dernierSigne = Date.now();
          if (etat === 'en_cours') poster({ type: 'page', n, lignes });
        },
        (erreur: unknown) => {
          lectureEnCours = false;
          dernierSigne = Date.now();
          echecLecture ??= { erreur };
          if (etat === 'en_cours') poster({ type: 'page-echec', n });
        },
      );
    };

    worker.onmessage = (e: MessageEvent<ReponseConstruction | ReponseCompression>) => {
      if (etat === 'fini') return;
      dernierSigne = Date.now();
      const r = e.data;
      switch (r.type) {
        case 'pret':
          if (etat !== 'chargement') return;
          etat = 'en_cours';
          clearTimeout(delai);
          ronde = setInterval(() => {
            if (!lectureEnCours && Date.now() - dernierSigne > SILENCE_MAX_MS) tomber(`aucune nouvelle depuis ${String(SILENCE_MAX_MS / 1000)} s`);
          }, RONDE_MS);
          poster({ type: 'exporter', fermeId: o.fermeId, genereLe: o.genereLe, jour: o.jour });
          return;
        case 'lire':
          lire(r.n, r.sql, r.parametres);
          return;
        case 'avancement':
          if (signal?.aborted !== true) o.avancement?.({ fait: r.fait, total: r.total });
          return;
        case 'archive':
          finir();
          resoudre({ nomFichier: r.nomFichier, octets: r.octets, lignes: r.lignes });
          return;
        case 'echec':
          finir();
          // La base a refusé une lecture : cette erreur. Sinon, c'est le worker qui n'a pas pu
          // construire l'archive : l'appelant recommence une fois sans lui.
          if (echecLecture !== undefined) rejeter(echecLecture.erreur);
          else rejeter(new ErreurWorkerCompression(`construction impossible dans le worker : ${r.message}`));
          return;
        default:
          return;
      }
    };
    worker.onerror = (e: ErrorEvent) => {
      e.preventDefault();
      tomber(`erreur : ${e.message}`);
    };
    worker.onmessageerror = () => {
      tomber('message illisible');
    };
    poster({ type: 'bonjour' });
  });
  if ('erreur' in issue) throw issue.erreur;
  return issue.archive;
}
