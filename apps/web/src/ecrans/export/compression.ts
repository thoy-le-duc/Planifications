/**
 * Compresseur de l'export dans un worker (T16b) : même deflate brut que le compresseur par défaut
 * de @planif/sync (`CompressionStream('deflate-raw')`), donc mêmes octets, mais calculé hors du
 * fil principal (./compression.worker.ts). Un seul worker par export, fermé à la fin.
 *
 * Sans Worker (tests sous Node), `compresseurEnWorker()` rend null : l'export garde son
 * compresseur par défaut.
 */
import type { Compresseur } from '@planif/sync/export';

export type MessageCompression =
  | { readonly id: number; readonly type: 'morceau'; readonly octets: Uint8Array }
  | { readonly id: number; readonly type: 'fin' }
  | { readonly id: number; readonly type: 'abandon' };

export type ReponseCompression =
  | { readonly id: number; readonly type: 'morceau'; readonly octets: Uint8Array<ArrayBuffer> }
  | { readonly id: number; readonly type: 'fin' }
  | { readonly id: number; readonly type: 'erreur'; readonly message: string };

/** Sortie d'un flux en attente de lecture. */
interface FileSortie {
  readonly morceaux: Uint8Array[];
  fini: boolean;
  erreur: { readonly erreur: unknown } | undefined;
  reveiller: (() => void) | undefined;
}

export interface CompresseurWorker {
  readonly compresseur: Compresseur;
  /** Arrête le worker (fin de l'export, réussi, annulé ou en échec). */
  fermer(): void;
}

export function compresseurEnWorker(): CompresseurWorker | null {
  if (typeof Worker === 'undefined' || typeof CompressionStream === 'undefined') return null;
  const worker = new Worker(new URL('./compression.worker.ts', import.meta.url), { type: 'module', name: 'compression-export' });
  const sorties = new Map<number, FileSortie>();
  let suivant = 0;
  let arret: { readonly erreur: unknown } | undefined;

  const reveiller = (s: FileSortie) => {
    const r = s.reveiller;
    s.reveiller = undefined;
    r?.();
  };
  const echouer = (erreur: unknown) => {
    arret ??= { erreur };
    for (const s of sorties.values()) {
      s.erreur ??= { erreur };
      reveiller(s);
    }
  };

  worker.onmessage = (e: MessageEvent<ReponseCompression>) => {
    const r = e.data;
    const s = sorties.get(r.id);
    if (s === undefined) return;
    if (r.type === 'morceau') s.morceaux.push(r.octets);
    else if (r.type === 'fin') s.fini = true;
    else s.erreur = { erreur: new Error(`compression impossible : ${r.message}`) };
    reveiller(s);
  };
  worker.onerror = (e: ErrorEvent) => {
    e.preventDefault();
    echouer(new Error(`worker de compression en échec : ${e.message}`));
  };

  const compresseur: Compresseur = async function* (brut) {
    if (arret !== undefined) throw arret.erreur;
    const id = suivant++;
    const s: FileSortie = { morceaux: [], fini: false, erreur: undefined, reveiller: undefined };
    sorties.set(id, s);
    const envoyer = (m: MessageCompression) => {
      worker.postMessage(m);
    };
    // Source envoyée au worker au fil de sa production (copie : le bloc peut être réutilisé).
    let echecSource: { readonly erreur: unknown } | undefined;
    // Dans un objet : posé depuis le `finally` plus bas, TypeScript ne le suit pas sur une variable.
    const lecture = { abandonnee: false };
    const envoi = (async () => {
      try {
        for await (const morceau of brut) {
          if (lecture.abandonnee) return;
          envoyer({ id, type: 'morceau', octets: morceau });
        }
        envoyer({ id, type: 'fin' });
      } catch (erreur: unknown) {
        echecSource = { erreur };
        envoyer({ id, type: 'abandon' });
        s.erreur ??= { erreur };
        reveiller(s);
      }
    })();
    let fini = false;
    try {
      for (;;) {
        const morceau = s.morceaux.shift();
        if (morceau !== undefined) {
          yield morceau;
          continue;
        }
        // L'erreur de la source prime sur celle qu'elle cause dans le flux.
        if (s.erreur !== undefined) throw (echecSource ?? s.erreur).erreur;
        if (s.fini) break;
        await new Promise<void>((ok) => {
          s.reveiller = ok;
        });
      }
      fini = true;
    } finally {
      sorties.delete(id);
      if (!fini) {
        lecture.abandonnee = true;
        envoyer({ id, type: 'abandon' });
      }
    }
    await envoi;
    if (echecSource !== undefined) throw echecSource.erreur;
  };

  return {
    compresseur,
    fermer: () => {
      echouer(new Error('worker de compression fermé'));
      worker.terminate();
    },
  };
}
