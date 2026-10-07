/**
 * Compresseur de l'export dans un worker (T16b) : même deflate brut que le compresseur par défaut
 * de @planif/sync (`CompressionStream('deflate-raw')`), donc mêmes octets, mais calculé hors du
 * fil principal (./compression.worker.ts). Un seul worker par export, fermé à la fin.
 *
 * T15c :
 *   - repli : tant que le worker n'a pas répondu à « bonjour », aucune entrée ne lui est confiée.
 *     S'il ne se charge pas (constructeur qui lève, événement `error`, pas de réponse sous
 *     DELAI_PRET_MS), chaque entrée est compressée sur le fil principal (compresseur par défaut
 *     de @planif/sync) : l'export va au bout, mêmes octets. Un worker qui tombe APRÈS s'être
 *     chargé fait échouer l'export (les entrées en cours sont perdues avec lui) ;
 *   - chien de garde : des entrées attendent une réponse et le worker se tait SILENCE_MAX_MS →
 *     échec propre (ErreurWorkerCompression) plutôt qu'une barre figée ; lancerExport recommence
 *     alors une fois l'export au fil principal (./lancer.ts) ;
 *   - contre-pression : au plus LIMITE_EN_VOL octets envoyés au worker et pas encore pris par son
 *     flux de compression (accusés `recu`), toutes entrées confondues ; au-delà, le producteur
 *     attend. Sans elle, une lecture plus rapide que le deflate empilait l'entrée côté worker.
 *
 * Sans Worker (tests sous Node), `compresseurEnWorker()` rend null : l'export garde son
 * compresseur par défaut.
 */
import { compresseurParDefaut, type Compresseur } from '@planif/sync/export';

export type MessageCompression =
  | { readonly type: 'bonjour' }
  | { readonly id: number; readonly type: 'morceau'; readonly octets: Uint8Array }
  | { readonly id: number; readonly type: 'fin' }
  | { readonly id: number; readonly type: 'abandon' };

export type ReponseCompression =
  | { readonly type: 'pret' }
  | { readonly id: number; readonly type: 'recu'; readonly taille: number }
  | { readonly id: number; readonly type: 'morceau'; readonly octets: Uint8Array<ArrayBuffer> }
  | { readonly id: number; readonly type: 'fin' }
  | { readonly id: number; readonly type: 'erreur'; readonly message: string };

/** Octets envoyés au worker et pas encore pris par son flux, au plus (un morceau seul passe toujours). */
const LIMITE_EN_VOL = 1024 * 1024;
/**
 * Sans réponse à « bonjour » passé ce délai, l'export se fait sans le worker. Le script est
 * petit et précaché : il se charge en quelques dizaines de ms, quelques centaines au pire sur un
 * téléphone lent. 5 s laisse une large marge sans faire attendre longtemps un export dont le
 * worker ne viendra jamais (le repli ne coûte que du temps : même archive).
 */
const DELAI_PRET_MS = 5_000;
/** Worker silencieux alors que des entrées attendent sa réponse : au-delà, l'export échoue. */
export const SILENCE_MAX_MS = 15_000;
/** Fréquence de la vérification du chien de garde. */
const RONDE_MS = 1_000;

/** Échec venu du worker de compression (et non de la base ou d'une annulation) : l'export peut se refaire sans lui. */
export class ErreurWorkerCompression extends Error {
  override readonly name = 'ErreurWorkerCompression';
}

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

/** Compression au fil principal, si le worker ne se charge pas. */
const compresseurDeRepli: Compresseur = (brut) => {
  const repli = compresseurParDefaut();
  if (repli === undefined) throw new Error('compression impossible : CompressionStream absent');
  return repli(brut);
};

export function compresseurEnWorker(): CompresseurWorker | null {
  if (typeof Worker === 'undefined' || typeof CompressionStream === 'undefined') return null;
  let worker: Worker;
  try {
    worker = new Worker(new URL('./compression.worker.ts', import.meta.url), { type: 'module', name: 'compression-export' });
  } catch {
    // URL refusée, CSP… : l'export garde le compresseur par défaut, au fil principal.
    return null;
  }
  const sorties = new Map<number, FileSortie>();
  let suivant = 0;
  let arret: { readonly erreur: unknown } | undefined;

  // Chargement : « bonjour » → « pret ». Avant la réponse, rien n'est confié au worker.
  let etat: 'chargement' | 'pret' | 'repli' = 'chargement';
  let annoncer: (pret: boolean) => void = () => undefined;
  const pret = new Promise<boolean>((ok) => {
    annoncer = ok;
  });
  const passerAuRepli = (cause: string) => {
    if (etat !== 'chargement') return;
    etat = 'repli';
    clearTimeout(delai);
    worker.terminate();
    console.warn(`Export : worker de compression indisponible (${cause}), compression sur le fil principal.`);
    annoncer(false);
  };
  const delai = setTimeout(() => {
    passerAuRepli(`aucune réponse en ${String(DELAI_PRET_MS / 1000)} s`);
  }, DELAI_PRET_MS);

  // Chien de garde : réponses attendues (accusés, fins de flux) et dernier signe du worker.
  const finsAttendues = new Set<number>();
  let dernierSigne = Date.now();
  let ronde: ReturnType<typeof setInterval> | undefined;
  const attendReponse = () => enVol > 0 || finsAttendues.size > 0;

  // Contre-pression : octets envoyés au worker et pas encore pris par son flux.
  let enVol = 0;
  const attenteCredit: (() => void)[] = [];
  const debloquer = () => {
    for (const ok of attenteCredit.splice(0)) ok();
  };

  const reveiller = (s: FileSortie) => {
    const r = s.reveiller;
    s.reveiller = undefined;
    r?.();
  };
  const echouer = (erreur: unknown) => {
    clearInterval(ronde);
    arret ??= { erreur };
    for (const s of sorties.values()) {
      s.erreur ??= { erreur };
      reveiller(s);
    }
    debloquer();
  };

  worker.onmessage = (e: MessageEvent<ReponseCompression>) => {
    const r = e.data;
    dernierSigne = Date.now();
    if (r.type === 'pret') {
      if (etat !== 'chargement') return;
      etat = 'pret';
      clearTimeout(delai);
      ronde = setInterval(() => {
        if (attendReponse() && Date.now() - dernierSigne > SILENCE_MAX_MS) {
          echouer(new ErreurWorkerCompression(`le worker de compression ne répond plus depuis ${String(SILENCE_MAX_MS / 1000)} s`));
        }
      }, RONDE_MS);
      annoncer(true);
      return;
    }
    if (r.type === 'recu') {
      enVol -= r.taille;
      debloquer();
      return;
    }
    const s = sorties.get(r.id);
    if (s === undefined) return;
    if (r.type !== 'morceau') finsAttendues.delete(r.id);
    if (r.type === 'morceau') s.morceaux.push(r.octets);
    else if (r.type === 'fin') s.fini = true;
    else s.erreur = { erreur: new ErreurWorkerCompression(`compression impossible : ${r.message}`) };
    reveiller(s);
  };
  worker.onerror = (e: ErrorEvent) => {
    e.preventDefault();
    // Script introuvable ou refusé avant sa première réponse : repli sur le fil principal.
    if (etat === 'chargement') passerAuRepli(`erreur : ${e.message}`);
    else echouer(new ErreurWorkerCompression(`worker de compression en échec : ${e.message}`));
  };
  worker.onmessageerror = () => {
    if (etat === 'chargement') passerAuRepli('message illisible');
    else echouer(new ErreurWorkerCompression('worker de compression : message illisible'));
  };
  worker.postMessage({ type: 'bonjour' } satisfies MessageCompression);

  /** Attend que le worker ait pris assez d'octets pour en recevoir `taille` de plus. */
  const credit = async (taille: number): Promise<void> => {
    while (arret === undefined && enVol > 0 && enVol + taille > LIMITE_EN_VOL) {
      await new Promise<void>((ok) => {
        attenteCredit.push(ok);
      });
    }
  };

  async function* enWorker(brut: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array, void, undefined> {
    if (arret !== undefined) throw arret.erreur;
    const id = suivant++;
    const s: FileSortie = { morceaux: [], fini: false, erreur: undefined, reveiller: undefined };
    sorties.set(id, s);
    const envoyer = (m: MessageCompression) => {
      // Une attente commence : le silence du worker se compte à partir d'ici.
      if (!attendReponse()) dernierSigne = Date.now();
      if (m.type === 'fin') finsAttendues.add(id);
      else if (m.type === 'abandon') finsAttendues.delete(id);
      worker.postMessage(m);
    };
    // Source envoyée au worker au fil de sa production (copie : le bloc peut être réutilisé).
    let echecSource: { readonly erreur: unknown } | undefined;
    // Dans un objet : posé depuis le `finally` plus bas, TypeScript ne le suit pas sur une variable.
    const lecture = { abandonnee: false };
    /** Lecture abandonnée, ou worker arrêté : plus rien à lui envoyer (relu après chaque attente). */
    const coupee = () => lecture.abandonnee || arret !== undefined;
    const envoi = (async () => {
      try {
        for await (const morceau of brut) {
          if (lecture.abandonnee) return;
          await credit(morceau.byteLength);
          if (coupee()) return;
          envoyer({ id, type: 'morceau', octets: morceau });
          enVol += morceau.byteLength;
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
  }

  const compresseur: Compresseur = async function* (brut) {
    if (await pret) yield* enWorker(brut);
    else yield* compresseurDeRepli(brut);
  };

  return {
    compresseur,
    fermer: () => {
      clearTimeout(delai);
      clearInterval(ronde);
      if (etat === 'chargement') {
        etat = 'repli';
        annoncer(false);
      }
      echouer(new Error('worker de compression fermé'));
      worker.terminate();
    },
  };
}
